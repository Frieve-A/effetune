import assert from 'node:assert/strict';
import test from 'node:test';
import { RollingPcmTransport } from '../../js/ui/audio-player/rolling-pcm-transport.js';
import { RollingPcmAdmissionLedger } from '../../js/ui/audio-player/rolling-pcm-policy.js';
import {
  createRollingPcmEnvelope,
  RollingPcmCommand,
  RollingPcmEvent
} from '../../js/ui/audio-player/rolling-pcm-protocol.js';
import {
  normalizePcm16WaveFillTarget,
  normalizePcm16WaveSeekFrame,
  PCM16_STEREO_44100_TO_96000_PROFILE,
  planPcm16WaveFragment,
  sourceToOutputFrames
} from '../../js/ui/audio-player/rolling-pcm-core.js';

class FakeNode {
  constructor() {
    this.connections = [];
  }
  connect(node) { this.connections.push(node); }
  disconnect() { this.connections = []; }
}

class FakeBufferSource extends FakeNode {
  constructor(starts) {
    super();
    this.starts = starts;
    this.onended = null;
    this.buffer = null;
  }
  start(...args) { this.starts.push(args); }
  stop() {}
}

class FakeAudioContext {
  constructor() {
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.starts = [];
  }
  createGain() {
    const node = new FakeNode();
    node.gain = { value: 1 };
    return node;
  }
  createBuffer(channelCount, frameCount, sampleRate) {
    const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
    return {
      duration: frameCount / sampleRate,
      copyToChannel(source, channel) { channels[channel].set(source); },
      channels
    };
  }
  createBufferSource() { return new FakeBufferSource(this.starts); }
  decodeAudioData(source, onSuccess) {
    const sourceFrames = new DataView(source).getUint32(40, true) /
      (2 * Int16Array.BYTES_PER_ELEMENT);
    const length = Math.floor((sourceFrames / 147) * 320);
    const decoded = {
      sampleRate: 96000,
      numberOfChannels: 2,
      length,
      getChannelData: () => new Float32Array(length)
    };
    queueMicrotask(() => onSuccess(decoded));
  }
}

class DelayedDecodeAudioContext extends FakeAudioContext {
  decodeAudioData(source, onSuccess) {
    this.pendingDecode = { source, onSuccess };
  }
  completeDecode() {
    const { source, onSuccess } = this.pendingDecode;
    this.pendingDecode = null;
    const sourceFrames = new DataView(source).getUint32(40, true) /
      (2 * Int16Array.BYTES_PER_ELEMENT);
    const length = Math.floor((sourceFrames / 147) * 320);
    onSuccess({
      sampleRate: 96000,
      numberOfChannels: 2,
      length,
      getChannelData: () => new Float32Array(length)
    });
  }
}

class FakeWorker {
  constructor({ channelCount = 2, totalFrames = 144000 } = {}) {
    this.onmessage = null;
    this.onerror = null;
    this.channelCount = channelCount;
    this.sentFrame = 0;
    this.slabId = 0;
    this.totalFrames = totalFrames;
    this.terminated = false;
    this.commands = [];
  }
  postMessage(message) {
    this.commands.push(message);
    if (message.type === RollingPcmCommand.OPEN) {
      this.emit(RollingPcmEvent.READY, message, {
        sampleRate: 48000,
        channelCount: this.channelCount,
        durationSec: this.totalFrames / 48000,
        totalFrames: this.totalFrames,
        containerMimeType: 'audio/wav',
        codec: 'pcm-s16',
        decoderConfigCodec: 'pcm-s16',
        decoderConfigVerified: true
      });
    } else if (message.type === RollingPcmCommand.FILL) {
      while (this.sentFrame < message.targetFrame) {
        const frameCount = Math.min(96000, message.targetFrame - this.sentFrame);
        const startFrame = this.sentFrame;
        this.sentFrame += frameCount;
        this.emit(RollingPcmEvent.SLAB, message, {
          slabId: ++this.slabId,
          startFrame,
          frameCount,
          channelCount: this.channelCount,
          planes: Array.from(
            { length: this.channelCount },
            () => new Float32Array(frameCount).buffer
          )
        });
      }
      if (this.sentFrame === this.totalFrames) {
        this.emit(RollingPcmEvent.SEGMENT_END, message, { totalFrames: this.totalFrames });
      }
    } else if (message.type === RollingPcmCommand.SEEK) {
      this.sentFrame = message.frame;
      this.slabId = 0;
      this.emit(RollingPcmEvent.QUEUE_STATE, message, {
        decodedFrame: message.frame,
        sentFrame: message.frame,
        ended: message.frame === this.totalFrames
      });
    } else if (message.type === RollingPcmCommand.DISPOSE) {
      this.emit(RollingPcmEvent.DISPOSED, message);
    }
  }
  emit(type, request, payload = {}) {
    this.onmessage?.({ data: createRollingPcmEnvelope(type, request, payload) });
  }
  terminate() { this.terminated = true; }
}

class Pcm16ContractWorker extends FakeWorker {
  constructor({ sourceTotalFrames = 1000, readyOverrides = {} } = {}) {
    const profile = PCM16_STEREO_44100_TO_96000_PROFILE;
    const totalFrames = Math.floor(
      sourceTotalFrames * profile.sourceStepDenominator / profile.sourceStepNumerator
    );
    super({ channelCount: profile.channelCount, totalFrames });
    this.sourceTotalFrames = sourceTotalFrames;
    this.readyOverrides = readyOverrides;
    this.pendingTargetFrame = null;
    this.outstandingFragment = null;
  }
  postMessage(message) {
    if (message.type === RollingPcmCommand.FILL) {
      this.commands.push(message);
      this.pendingTargetFrame = message.targetFrame;
      this.emitNextFragment(message);
      return;
    }
    if (message.type === RollingPcmCommand.RECYCLE && message.fragmentId) {
      this.commands.push(message);
      if (message.fragmentId === this.outstandingFragment?.fragmentId &&
          message.fragmentToken === this.outstandingFragment?.fragmentToken) {
        this.outstandingFragment = null;
        this.emitNextFragment(message);
      }
      return;
    }
    if (message.type === RollingPcmCommand.SEEK) {
      this.commands.push(message);
      const normalized = normalizePcm16WaveSeekFrame(message.frame, this.sourceTotalFrames);
      this.sentFrame = normalized.adoptedOutputFrame;
      this.slabId = 0;
      this.outstandingFragment = null;
      this.emit(RollingPcmEvent.QUEUE_STATE, message, {
        decodedFrame: normalized.adoptedOutputFrame,
        sentFrame: normalized.adoptedOutputFrame,
        ended: normalized.adoptedOutputFrame === this.totalFrames,
        requestedFrame: normalized.requestedOutputFrame,
        sourceFrame: normalized.sourceFrame,
        adoptedFrame: normalized.adoptedOutputFrame
      });
      return;
    }
    if (message.type !== RollingPcmCommand.OPEN) {
      super.postMessage(message);
      return;
    }
    this.commands.push(message);
    const profile = PCM16_STEREO_44100_TO_96000_PROFILE;
    this.emit(RollingPcmEvent.READY, message, {
      sampleRate: profile.outputSampleRate,
      sourceSampleRate: profile.sourceSampleRate,
      outputSampleRate: profile.outputSampleRate,
      channelCount: profile.channelCount,
      durationSec: this.totalFrames / profile.outputSampleRate,
      sourceTotalFrames: this.sourceTotalFrames,
      sourceByteLength: message.source.byteLength,
      workerCompressedBytes: message.source.byteLength,
      dataOffset: 44,
      dataByteLength: this.sourceTotalFrames * profile.channelCount *
        Int16Array.BYTES_PER_ELEMENT,
      bitsPerSample: 16,
      blockAlign: profile.channelCount * Int16Array.BYTES_PER_ELEMENT,
      totalFrames: this.totalFrames,
      containerMimeType: 'audio/wav',
      codec: 'pcm-s16',
      decoderConfigCodec: 'pcm-s16',
      decoderConfigVerified: true,
      decoderProfile: profile.codec,
      resamplerProfile: profile.id,
      ...this.readyOverrides
    });
  }
  emitNextFragment(request) {
    if (this.outstandingFragment || this.sentFrame >= this.pendingTargetFrame) return;
    const profile = PCM16_STEREO_44100_TO_96000_PROFILE;
    const fragmentTarget = normalizePcm16WaveFillTarget(
      this.sentFrame,
      this.sentFrame + 1,
      this.sourceTotalFrames
    );
    const outputFrameCount = fragmentTarget - this.sentFrame;
    const plan = planPcm16WaveFragment({
      sourceTotalFrames: this.sourceTotalFrames,
      outputStartFrame: this.sentFrame,
      outputFrameCount
    });
    const { fragmentByteLength, ...fragmentPlan } = plan;
    const fragmentBytes = new ArrayBuffer(fragmentByteLength);
    new DataView(fragmentBytes).setUint32(
      40,
      plan.fragmentSourceFrameCount * profile.channelCount * Int16Array.BYTES_PER_ELEMENT,
      true
    );
    const fragmentId = ++this.slabId;
    const fragmentToken = `fake:${request.generation}:${fragmentId}`;
    this.outstandingFragment = { fragmentId, fragmentToken };
    this.sentFrame += outputFrameCount;
    this.emit(RollingPcmEvent.FRAGMENT, request, {
      fragmentId,
      fragmentToken,
      fragmentBytes,
      ...fragmentPlan,
      sourceSampleRate: profile.sourceSampleRate,
      outputSampleRate: profile.outputSampleRate,
      channelCount: profile.channelCount,
      decoderProfile: profile.codec,
      resamplerProfile: profile.id
    });
  }
}

function canonical(bytes) {
  return { sourceKind: 'bytes', bytes, byteLength: bytes.byteLength, format: 'wav' };
}

function canonicalPath(byteLength) {
  return {
    sourceKind: 'other',
    byteLength,
    format: 'wav',
    mediaSource: 'C:\\SyntheticCatalog\\rolling.wav',
    canonicalIdentity: Object.freeze({ kind: 'path-test' })
  };
}

function pcm16Contract() {
  const profile = PCM16_STEREO_44100_TO_96000_PROFILE;
  return {
    outputSampleRate: profile.outputSampleRate,
    decoderProfile: profile.codec,
    resamplerProfile: profile.id
  };
}

function pcm16Source(sourceFrames) {
  return new Uint8Array(44 + sourceFrames * 2 * Int16Array.BYTES_PER_ELEMENT);
}

test('PCM16 transport authenticates source and output domains across prepare and seek', async () => {
  const context = new FakeAudioContext();
  context.sampleRate = 96000;
  const workers = [];
  const transport = new RollingPcmTransport(context, {
    workerFactory: () => {
      const worker = new Pcm16ContractWorker({ sourceTotalFrames: 88200 });
      workers.push(worker);
      return worker;
    }
  });
  const source = pcm16Source(88200);
  const snapshot = canonicalPath(source.byteLength);
  const sourceReads = [];
  transport.sourceReacquirer = async candidate => {
    assert.equal(candidate, snapshot);
    if (sourceReads.length === 0) {
      const reservation = transport.reservationLedger.entries.get(transport.reservationOwner);
      assert.equal(transport.reservationHeld, true);
      // A path snapshot keeps no compressed bytes resident, so only the worker copy is charged.
      assert.equal(reservation.canonicalCompressedBytes, 0);
      assert.equal(reservation.workerCompressedBytes, source.byteLength);
    }
    const bytes = source.buffer.slice(0);
    sourceReads.push(bytes);
    return bytes;
  };
  const metadata = await transport.prepare(snapshot, {
    ...pcm16Contract(),
    minimumHeadFrames: 48000
  });

  assert.deepEqual(metadata, {
    sampleRate: 96000,
    sourceSampleRate: 44100,
    outputSampleRate: 96000,
    channelCount: 2,
    durationSec: 2,
    sourceTotalFrames: 88200,
    totalFrames: 192000,
    containerMimeType: 'audio/wav',
    codec: 'pcm-s16',
    decoderConfigCodec: 'pcm-s16',
    decoderConfigVerified: true,
    sourceByteLength: source.byteLength,
    workerCompressedBytes: source.byteLength,
    dataOffset: 44,
    dataByteLength: 88200 * 4,
    bitsPerSample: 16,
    blockAlign: 4,
    decoderProfile: PCM16_STEREO_44100_TO_96000_PROFILE.codec,
    resamplerProfile: PCM16_STEREO_44100_TO_96000_PROFILE.id
  });
  const firstOpen = workers[0].commands.find(command => command.type === RollingPcmCommand.OPEN);
  assert.deepEqual({
    outputSampleRate: firstOpen.outputSampleRate,
    decoderProfile: firstOpen.decoderProfile,
    resamplerProfile: firstOpen.resamplerProfile,
    sourceKind: firstOpen.sourceKind
  }, { ...pcm16Contract(), sourceKind: 'bytes' });
  assert.equal(firstOpen.source, sourceReads[0]);
  assert.notEqual(firstOpen.source, source.buffer);
  assert.equal(source.byteLength, 352844);
  const firstRecycle = workers[0].commands.find(
    command => command.type === RollingPcmCommand.RECYCLE && command.fragmentId
  );
  assert.equal(firstRecycle.fragmentToken, 'fake:1:1');
  assert.deepEqual({
    maxInput: transport.getDiagnosticSnapshot().maxFragmentInputBytes,
    maxDecoded: transport.getDiagnosticSnapshot().maxFragmentDecodedPcmBytes,
    liveInput: transport.getDiagnosticSnapshot().liveFragmentInputBytes,
    compactBytes: transport.getDiagnosticSnapshot().livePcmBytes
  }, {
    maxInput: 176444,
    maxDecoded: 96000 * 2 * Float32Array.BYTES_PER_ELEMENT,
    liveInput: 0,
    compactBytes: 48000 * 2 * Float32Array.BYTES_PER_ELEMENT
  });

  assert.equal(transport.promoteReservation(), true);
  assert.deepEqual(await transport.seek(96001, { resume: false }), {
    adoptedFrame: normalizePcm16WaveSeekFrame(96001, 88200).adoptedOutputFrame
  });
  const replacementOpen = workers[1].commands.find(
    command => command.type === RollingPcmCommand.OPEN
  );
  assert.deepEqual({
    outputSampleRate: replacementOpen.outputSampleRate,
    decoderProfile: replacementOpen.decoderProfile,
    resamplerProfile: replacementOpen.resamplerProfile
  }, pcm16Contract());
  const replacementSeek = workers[1].commands.find(
    command => command.type === RollingPcmCommand.SEEK
  );
  assert.equal(replacementSeek.frame, 96001);
  // Adoption hands the staging counter to the adopted generation; nothing lingers.
  assert.equal(transport.getDiagnosticSnapshot().inFlightBytes, 0);
  assert.equal(transport.getLiveMemoryCategories().mainStagingSlabBytes, 0);
  assert.equal(sourceReads.length, 2);
  assert.equal(replacementOpen.source, sourceReads[1]);
  assert.equal(
    transport.reservationLedger.entries.get(transport.reservationOwner)
      .canonicalCompressedBytes,
    0
  );
  await transport.dispose();
});

test('native READY accepts every source-frame remainder using authoritative output length', async () => {
  const profile = PCM16_STEREO_44100_TO_96000_PROFILE;
  for (let remainder = 0; remainder < profile.sourceStepNumerator; remainder += 1) {
    const sourceFrames = 44100 + remainder;
    const context = new FakeAudioContext();
    context.sampleRate = profile.outputSampleRate;
    const transport = new RollingPcmTransport(context, {
      workerFactory: () => new Pcm16ContractWorker({ sourceTotalFrames: sourceFrames })
    });
    const source = pcm16Source(sourceFrames);
    await transport.prepare(canonicalPath(source.byteLength), {
      ...pcm16Contract(),
      sourceOverride: { kind: 'bytes', bytes: source.buffer },
      minimumHeadFrames: 1
    });
    const expectedFrames = sourceToOutputFrames(sourceFrames, profile, 'floor');
    assert.equal(transport.metadata.totalFrames, expectedFrames, `remainder ${remainder}`);
    assert.equal(
      transport.metadata.durationSec,
      expectedFrames / profile.outputSampleRate,
      `remainder ${remainder}`
    );
    if (sourceFrames === 44103) assert.equal(expectedFrames, 96006);
    await transport.dispose();
  }
});

test('path seek acquisition failure and Pause race keep the committed transport', async () => {
  const context = new FakeAudioContext();
  context.sampleRate = 96000;
  const source = pcm16Source(88200);
  const snapshot = canonicalPath(source.byteLength);
  const workers = [];
  let readCount = 0;
  let releaseSecondRead;
  const secondRead = new Promise(resolve => { releaseSecondRead = resolve; });
  const transport = new RollingPcmTransport(context, {
    workerFactory: () => {
      const worker = new Pcm16ContractWorker({ sourceTotalFrames: 88200 });
      workers.push(worker);
      return worker;
    },
    sourceReacquirer: async () => {
      readCount += 1;
      if (readCount === 2) {
        await secondRead;
        return source.buffer.slice(0);
      }
      if (readCount === 3) throw new Error('synthetic path acquisition failure');
      return source.buffer.slice(0);
    }
  });
  await transport.prepare(snapshot, { ...pcm16Contract(), minimumHeadFrames: 48000 });
  assert.equal(transport.promoteReservation(), true);
  const committedTransportId = transport.transportId;
  const committedWorker = transport.worker;

  const pausedSeek = transport.seek(96001, { resume: true });
  for (let turn = 0; turn < 10; turn += 1) {
    if (readCount >= 2) break;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(readCount, 2);
  assert.equal(transport.pause(), true);
  releaseSecondRead();
  assert.equal(await pausedSeek, false);
  await transport.waitForCleanupBarrier();
  assert.equal(transport.transportId, committedTransportId);
  assert.equal(transport.worker, committedWorker);
  assert.equal(transport.reservationLedger.entries.size, 1);

  assert.equal(await transport.seek(48001, { resume: false }), false);
  assert.equal(readCount, 3);
  assert.equal(transport.transportId, committedTransportId);
  assert.equal(transport.worker, committedWorker);
  assert.equal(transport.reservationLedger.entries.size, 1);
  await transport.dispose();
});

test('aggregate source reservation rejects next before canonical path acquisition', async () => {
  const context = new FakeAudioContext();
  context.sampleRate = 96000;
  const sourceFrames = 88200;
  const source = pcm16Source(sourceFrames);
  const ledger = new RollingPcmAdmissionLedger({ aggregateByteCap: 13 * 1024 * 1024 });
  let pathReads = 0;
  let workerCount = 0;
  const createTransport = reservationRole => new RollingPcmTransport(context, {
    reservationLedger: ledger,
    reservationRole,
    workerFactory: () => {
      workerCount += 1;
      return new Pcm16ContractWorker({ sourceTotalFrames: sourceFrames });
    },
    sourceReacquirer: async () => {
      pathReads += 1;
      return source.buffer.slice(0);
    }
  });
  const current = createTransport('candidate');
  await current.prepare(canonicalPath(source.byteLength), {
    ...pcm16Contract(),
    minimumHeadFrames: 48000
  });
  assert.equal(current.promoteReservation(), true);
  assert.equal(pathReads, 1);
  assert.equal(workerCount, 1);

  const next = createTransport('next');
  await assert.rejects(
    next.prepare(canonicalPath(source.byteLength), {
      ...pcm16Contract(),
      minimumHeadFrames: 48000
    }),
    error => error?.code === 'rolling-admission-rejected'
  );
  assert.equal(pathReads, 1);
  assert.equal(workerCount, 1);
  assert.equal(next.reservationHeld, false);
  await next.dispose();
  await current.dispose();
  assert.equal(ledger.entries.size, 0);
});

test('fragment credit is acknowledged only after native decode and compact copy settle', async () => {
  const context = new DelayedDecodeAudioContext();
  context.sampleRate = 96000;
  const worker = new Pcm16ContractWorker({ sourceTotalFrames: 88200 });
  const transport = new RollingPcmTransport(context, { workerFactory: () => worker });
  const preparing = transport.prepare(canonical(pcm16Source(88200)), {
    ...pcm16Contract(),
    minimumHeadFrames: 48000
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(context.pendingDecode);
  assert.equal(worker.commands.some(command =>
    command.type === RollingPcmCommand.RECYCLE && command.fragmentId), false);

  context.completeDecode();
  await preparing;

  assert.equal(worker.commands.some(command =>
    command.type === RollingPcmCommand.RECYCLE && command.fragmentId === 1), true);
  assert.equal(transport.queue.length, 1);
  await transport.dispose();
});

test('a stale fragment decode settling after seek adoption neither fails the transport nor leaks staging bytes', async () => {
  class QueuedDecodeAudioContext extends FakeAudioContext {
    constructor() {
      super();
      this.pendingDecodes = [];
    }
    decodeAudioData(source, onSuccess, onFailure) {
      this.pendingDecodes.push({ source, onSuccess, onFailure });
    }
    completeDecode(index) {
      const { source, onSuccess } = this.pendingDecodes[index];
      const sourceFrames = new DataView(source).getUint32(40, true) /
        (2 * Int16Array.BYTES_PER_ELEMENT);
      const length = Math.floor((sourceFrames / 147) * 320);
      onSuccess({
        sampleRate: 96000,
        numberOfChannels: 2,
        length,
        getChannelData: () => new Float32Array(length)
      });
    }
    rejectDecode(index) {
      this.pendingDecodes[index].onFailure(new Error('decode rejected late'));
    }
  }
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const sourceFrames = 44100 * 6;
  const context = new QueuedDecodeAudioContext();
  context.sampleRate = 96000;
  const workers = [];
  const failures = [];
  const transport = new RollingPcmTransport(context, {
    workerFactory: () => {
      const worker = new Pcm16ContractWorker({ sourceTotalFrames: sourceFrames });
      workers.push(worker);
      return worker;
    },
    onFailure: failure => failures.push(failure)
  });
  const preparing = transport.prepare(canonical(pcm16Source(sourceFrames)), {
    ...pcm16Contract(),
    minimumHeadFrames: 48000
  });
  await settle();
  assert.equal(context.pendingDecodes.length, 1);
  context.completeDecode(0);
  await preparing;
  assert.equal(transport.promoteReservation(), true);

  // The second fragment of the first generation is still decoding when the seek arrives.
  assert.equal(transport.requestFill(transport.metadata.totalFrames), true);
  await settle();
  assert.equal(context.pendingDecodes.length, 2);
  const stagedBytes = context.pendingDecodes[1].source.byteLength;
  assert.ok(stagedBytes > 44);
  assert.equal(transport.getDiagnosticSnapshot().inFlightBytes, stagedBytes);
  assert.equal(transport.getLiveMemoryCategories().mainStagingSlabBytes, stagedBytes);

  // Only the candidate's decodes complete; the superseded decode stays pending.
  const seek = { result: null };
  const seeking = transport.seek(96001, { resume: false }).then(value => { seek.result = value; });
  let completed = 2;
  while (seek.result === null) {
    await settle();
    while (completed < context.pendingDecodes.length) context.completeDecode(completed++);
  }
  await seeking;
  assert.deepEqual(seek.result, {
    adoptedFrame: normalizePcm16WaveSeekFrame(96001, sourceFrames).adoptedOutputFrame
  });
  assert.equal(workers.length, 2);
  assert.equal(transport.getDiagnosticSnapshot().inFlightBytes, 0);
  assert.equal(transport.getLiveMemoryCategories().mainStagingSlabBytes, 0);

  // The superseded decode is a stale result: its late rejection must neither
  // fail the adopted generation nor touch the successor's staging counter.
  context.rejectDecode(1);
  await settle();
  assert.deepEqual(failures, []);
  assert.equal(transport.failed, false);
  assert.equal(transport.disposed, false);
  assert.equal(transport.getDiagnosticSnapshot().inFlightBytes, 0);
  assert.equal(transport.getLiveMemoryCategories().mainStagingSlabBytes, 0);
  assert.equal(context.pendingDecodes.length, completed);

  // A decode that rejects while the transport is disposing is stale as well:
  // teardown owns the outcome, so no failure may be published.
  assert.equal(transport.requestFill(transport.metadata.totalFrames), true);
  await settle();
  assert.equal(context.pendingDecodes.length, completed + 1);
  const disposal = transport.dispose();
  assert.equal(transport.disposing, true);
  context.rejectDecode(completed);
  await settle();
  await disposal;
  assert.deepEqual(failures, []);
  assert.equal(transport.failed, false);
  assert.equal(transport.disposed, true);
  assert.equal(transport.getDiagnosticSnapshot().inFlightBytes, 0);
});

test('native refill beyond ten seconds expands to the next legal fragment boundary', async () => {
  const context = new FakeAudioContext();
  context.sampleRate = 96000;
  const sourceFrames = 44100 * 12;
  const worker = new Pcm16ContractWorker({ sourceTotalFrames: sourceFrames });
  const transport = new RollingPcmTransport(context, { workerFactory: () => worker });
  await transport.prepare(canonical(pcm16Source(sourceFrames)), {
    ...pcm16Contract(),
    minimumHeadFrames: 48000
  });
  await transport.fillTo(960001);

  const fillTargets = worker.commands
    .filter(command => command.type === RollingPcmCommand.FILL)
    .map(command => command.targetFrame);
  assert.equal(fillTargets.at(-1), 1008000);
  assert.equal(transport.lastReceivedFrame, 1008000);
  assert.equal(transport.failed, false);
  await transport.dispose();
});

test('PCM16 transport rejects READY metadata that changes the authenticated profile', async () => {
  const context = new FakeAudioContext();
  context.sampleRate = 96000;
  const worker = new Pcm16ContractWorker({
    readyOverrides: { sourceSampleRate: 48000 }
  });
  const transport = new RollingPcmTransport(context, { workerFactory: () => worker });
  await assert.rejects(
    transport.prepare(canonical(pcm16Source(1000)), pcm16Contract()),
    error => error?.code === 'metadata-invalid'
  );
  assert.equal(worker.terminated, true);
  assert.equal(transport.reservationHeld, false);
});

test('rolling transport prepares privately and starts only when activated', async () => {
  const context = new FakeAudioContext();
  const worker = new FakeWorker();
  const transport = new RollingPcmTransport(context, { workerFactory: () => worker });
  const canonical = new Uint8Array([1, 2, 3]);
  await transport.prepare({ sourceKind: 'bytes', bytes: canonical, byteLength: canonical.byteLength });
  assert.equal(context.starts.length, 0);
  assert.equal(transport.activate({ when: 2, frame: 0 }), true);
  assert.equal(context.starts.length > 0, true);
  assert.equal(context.starts[0][0], 2);
  assert.equal(transport.getDiagnosticSnapshot().liveSourceNodes > 0, true);
  await transport.dispose();
  assert.equal(worker.terminated, true);
  assert.deepEqual({
    buffers: transport.getDiagnosticSnapshot().liveAudioBuffers,
    nodes: transport.getDiagnosticSnapshot().liveSourceNodes,
    workers: transport.getDiagnosticSnapshot().liveWorkers,
    handlers: transport.getDiagnosticSnapshot().liveHandlers,
    timers: transport.getDiagnosticSnapshot().liveTimers,
    urls: transport.getDiagnosticSnapshot().liveObjectUrls
  }, { buffers: 0, nodes: 0, workers: 0, handlers: 0, timers: 0, urls: 0 });
  assert.deepEqual([...canonical], [1, 2, 3]);
});

test('unknown compressed size is rejected before candidate cloning or worker construction', async () => {
  let workerConstructions = 0;
  const transport = new RollingPcmTransport(new FakeAudioContext(), {
    workerFactory: () => {
      workerConstructions++;
      return new FakeWorker();
    }
  });
  await assert.rejects(
    transport.prepare({ sourceKind: 'bytes', bytes: new Uint8Array([1]), format: 'wav' }),
    error => error?.code === 'compressed-source-budget'
  );
  assert.equal(workerConstructions, 0);
  assert.equal(transport.getDiagnosticSnapshot().liveWorkers, 0);
  await transport.dispose();
});

test('worker construction failure releases the candidate reservation terminally', async () => {
  const transport = new RollingPcmTransport(new FakeAudioContext(), {
    workerFactory: () => { throw new Error('worker construction failed'); }
  });
  await assert.rejects(
    transport.prepare(canonical(new Uint8Array([1]))),
    /worker construction failed/
  );
  assert.equal(transport.disposed, true);
  assert.equal(transport.reservationHeld, false);
  assert.equal(transport.getDiagnosticSnapshot().liveWorkers, 0);
});

test('mono READY metadata keeps conservative admission promotable', async () => {
  const transport = new RollingPcmTransport(new FakeAudioContext(), {
    workerFactory: () => new FakeWorker({ channelCount: 1 })
  });
  const metadata = await transport.prepare(canonical(new Uint8Array([1])));
  assert.equal(metadata.channelCount, 1);
  assert.equal(transport.promoteReservation(), true);
  await transport.dispose();
});

test('seek generations reject delayed slabs and release the replaced queue', async () => {
  const context = new FakeAudioContext();
  const workers = [];
  const transport = new RollingPcmTransport(context, {
    workerFactory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }
  });
  await transport.prepare(canonical(new Uint8Array([1])));
  assert.equal(transport.promoteReservation(), true);
  const staleIds = transport.ids();
  await transport.seek(48000, { resume: false });
  const before = transport.getDiagnosticSnapshot();
  transport.handleWorkerMessage(createRollingPcmEnvelope(
    RollingPcmEvent.QUEUE_STATE,
    staleIds,
    { decodedFrame: 1, sentFrame: 1, ended: false }
  ));
  const after = transport.getDiagnosticSnapshot();
  assert.equal(after.staleMessages, before.staleMessages + 1);
  assert.equal(after.failed, false);
  await transport.dispose();
  assert.equal(transport.getDiagnosticSnapshot().liveAudioBuffers, 0);
});

test('protocol failure is published once and converges to stopped cleanup', async () => {
  const context = new FakeAudioContext();
  const worker = new FakeWorker();
  const failures = [];
  const transport = new RollingPcmTransport(context, {
    workerFactory: () => worker,
    onFailure: failure => failures.push(failure)
  });
  await transport.prepare(canonical(new Uint8Array([1])));
  transport.activate();
  const ids = transport.ids();
  const malformed = createRollingPcmEnvelope(RollingPcmEvent.SLAB, ids, {
    slabId: 1,
    startFrame: 1,
    frameCount: 1,
    channelCount: 2,
    planes: [new Float32Array(1).buffer, new Float32Array(1).buffer]
  });
  transport.handleWorkerMessage(malformed);
  transport.handleWorkerMessage(malformed);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, 'slab-protocol-invalid');
  assert.equal(transport.getDiagnosticSnapshot().failed, true);
  assert.equal(transport.getDiagnosticSnapshot().liveAudioBuffers, 0);
  assert.equal(transport.getDiagnosticSnapshot().liveSourceNodes, 0);
  await transport.dispose();
  assert.equal(transport.getDiagnosticSnapshot().liveWorkers, 0);
  assert.equal(transport.getDiagnosticSnapshot().liveHandlers, 0);
  assert.equal(transport.getDiagnosticSnapshot().liveTimers, 0);
});

test('decoder error during private preparation can be disposed without live resources', async () => {
  class ErrorWorker extends FakeWorker {
    postMessage(message) {
      if (message.type === RollingPcmCommand.OPEN) {
        this.emit(RollingPcmEvent.ERROR, message, { code: 'decoder-unsupported' });
        return;
      }
      super.postMessage(message);
    }
  }
  const worker = new ErrorWorker();
  const failures = [];
  const transport = new RollingPcmTransport(new FakeAudioContext(), {
    workerFactory: () => worker,
    onFailure: failure => failures.push(failure)
  });
  await assert.rejects(
    transport.prepare(canonical(new Uint8Array([1]))),
    error => error?.code === 'decoder-unsupported'
  );
  assert.equal(failures.length, 1);
  await transport.dispose();
  const final = transport.getDiagnosticSnapshot();
  assert.equal(final.liveAudioBuffers, 0);
  assert.equal(final.liveSourceNodes, 0);
  assert.equal(final.liveWorkers, 0);
  assert.equal(final.liveHandlers, 0);
  assert.equal(final.liveTimers, 0);
  assert.equal(worker.terminated, true);
});

test('failed seek candidate leaves the active transport playing at its old generation', async () => {
  class SeekErrorWorker extends FakeWorker {
    postMessage(message) {
      if (message.type === RollingPcmCommand.OPEN) {
        this.emit(RollingPcmEvent.ERROR, message, { code: 'seek-candidate-failed' });
        return;
      }
      super.postMessage(message);
    }
  }
  let workerCount = 0;
  const transport = new RollingPcmTransport(new FakeAudioContext(), {
    workerFactory: () => workerCount++ === 0 ? new FakeWorker() : new SeekErrorWorker()
  });
  await transport.prepare(canonical(new Uint8Array([1])));
  assert.equal(transport.activate({ frame: 0 }), true);
  const activeGeneration = transport.generation;
  assert.equal(await transport.seek(48000, { resume: true }), false);
  assert.equal(transport.playing, true);
  assert.equal(transport.failed, false);
  assert.equal(transport.generation, activeGeneration);
  await transport.dispose();
});

test('Pause cancels an in-progress seek candidate before it can publish or resume', async () => {
  class DelayedOpenWorker extends FakeWorker {
    postMessage(message) {
      if (message.type === RollingPcmCommand.OPEN) {
        this.commands.push(message);
        return;
      }
      super.postMessage(message);
    }
  }
  let workerCount = 0;
  const transport = new RollingPcmTransport(new FakeAudioContext(), {
    workerFactory: () => workerCount++ === 0 ? new FakeWorker() : new DelayedOpenWorker()
  });
  await transport.prepare(canonical(new Uint8Array([1])));
  assert.equal(transport.promoteReservation(), true);
  transport.activate();
  const seeking = transport.seek(48000, { resume: true });
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  assert.equal(workerCount, 2);
  assert.equal(transport.pause(), true);
  assert.equal(await seeking, false);
  assert.equal(transport.playing, false);
  assert.equal(transport.positionFrame, 0);
  await transport.dispose();
});

test('nonzero preparation requires an absolute resident head before publication', async () => {
  const worker = new FakeWorker({ totalFrames: 480000 });
  const transport = new RollingPcmTransport(new FakeAudioContext(), {
    workerFactory: () => worker
  });
  await transport.prepare(canonical(new Uint8Array([1])), {
    startFrame: 48000,
    minimumHeadFrames: 96000
  });
  const fill = worker.commands.findLast(message => message.type === RollingPcmCommand.FILL);
  assert.equal(fill.targetFrame, 144000);
  assert.equal(transport.lastReceivedFrame, 144000);
  assert.equal(transport.prepared, true);
  await transport.dispose();
});

test('pause freezes the integer position synchronously and requeues resident PCM', async () => {
  const context = new FakeAudioContext();
  const worker = new FakeWorker({ totalFrames: 480000 });
  let workerConstructions = 0;
  const transport = new RollingPcmTransport(context, {
    workerFactory: () => {
      workerConstructions++;
      return worker;
    }
  });
  await transport.prepare(canonical(new Uint8Array([1])));
  transport.activate({ when: 0, frame: 0 });
  context.currentTime = 0.5;
  assert.equal(transport.pause(), true);
  assert.equal(transport.positionFrame, 24000);
  assert.equal(transport.playing, false);
  assert.equal(workerConstructions, 1);
  assert.equal(worker.commands.filter(message => message.type === RollingPcmCommand.SEEK).length, 0);
  assert.equal(transport.queue[0].startFrame, 0);
  const startsBeforeResume = context.starts.length;
  assert.equal(transport.activate({ when: 1, frame: transport.positionFrame }), true);
  assert.equal(context.starts[startsBeforeResume][1], 0.5);
  await transport.dispose();
});

test('next promotion secures current quota and immediately requests current high-water', async () => {
  const worker = new FakeWorker({ totalFrames: 960000 });
  const transport = new RollingPcmTransport(new FakeAudioContext(), {
    workerFactory: () => worker,
    reservationRole: 'next'
  });
  await transport.prepare(canonical(new Uint8Array([1])));
  transport.activate();
  const nextTarget = transport.lastFillTarget;
  assert.equal(transport.canPromoteReservation(), true);
  assert.equal(transport.promoteReservation(), true);
  assert.equal(transport.reservationRole, 'current');
  assert.equal(nextTarget, transport.profile.nextMinimumHeadFrames);
  assert.equal(transport.lastFillTarget, transport.profile.currentHighWaterFrames);
  await transport.dispose();
});

test('Stop terminally releases the decoder, PCM, reservation, and bus', async () => {
  const worker = new FakeWorker({ totalFrames: 480000 });
  const transport = new RollingPcmTransport(new FakeAudioContext(), {
    workerFactory: () => worker
  });
  await transport.prepare(canonical(new Uint8Array([1])));
  transport.activate();
  await transport.stop();
  assert.equal(transport.disposed, true);
  assert.equal(transport.prepared, false);
  assert.equal(transport.sourceNode, null);
  assert.equal(transport.sourceSnapshot, null);
  assert.equal(transport.reservationHeld, false);
  assert.equal(transport.getDiagnosticSnapshot().livePcmBytes, 0);
  assert.equal(transport.getDiagnosticSnapshot().liveWorkers, 0);
  assert.equal(transport.activate(), false);
});

test('an exhausted schedule and queue is a terminal underrun even with an accepted refill', async () => {
  class DelayedRefillWorker extends FakeWorker {
    constructor() {
      super({ totalFrames: 960000 });
      this.delayFills = false;
      this.delayedFills = [];
    }
    postMessage(message) {
      if (message.type === RollingPcmCommand.FILL && this.delayFills) {
        this.commands.push(message);
        this.delayedFills.push(message);
        return;
      }
      super.postMessage(message);
    }
    flushOneFill() {
      const message = this.delayedFills.shift();
      if (!message) return;
      this.delayFills = false;
      super.postMessage(message);
      this.delayFills = true;
    }
  }
  const context = new FakeAudioContext();
  const worker = new DelayedRefillWorker();
  const failures = [];
  const transport = new RollingPcmTransport(context, {
    workerFactory: () => worker,
    onFailure: failure => failures.push(failure)
  });
  await transport.prepare(canonical(new Uint8Array([1])));
  worker.delayFills = true;
  transport.activate();
  const scheduled = [...transport.scheduled][0];
  assert.ok(scheduled);
  context.currentTime = scheduled.record.frameCount / context.sampleRate;
  scheduled.source.onended();
  assert.equal(transport.failed, true);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, 'underrun');
  assert.equal(transport.getDiagnosticSnapshot().underruns, 1);
  worker.flushOneFill();
  assert.equal(failures.length, 1);
  assert.equal(transport.scheduled.size, 0);
  assert.equal(transport.queue.length, 0);
  await transport.dispose();
});

test('a delayed successor cannot start after its audible timeline has already gapped', async () => {
  class DelayedSuccessorWorker extends FakeWorker {
    constructor() {
      super({ totalFrames: 960000 });
      this.delayFills = false;
      this.delayedFills = [];
    }
    postMessage(message) {
      if (message.type === RollingPcmCommand.FILL && this.delayFills) {
        this.commands.push(message);
        this.delayedFills.push(message);
        return;
      }
      super.postMessage(message);
    }
    flushOneFill() {
      const message = this.delayedFills.shift();
      if (!message) return;
      this.delayFills = false;
      super.postMessage(message);
      this.delayFills = true;
    }
  }
  const context = new FakeAudioContext();
  const worker = new DelayedSuccessorWorker();
  const failures = [];
  const transport = new RollingPcmTransport(context, {
    workerFactory: () => worker,
    onFailure: failure => failures.push(failure)
  });
  await transport.prepare(canonical(new Uint8Array([1])));
  worker.delayFills = true;
  transport.activate();
  const prior = [...transport.scheduled][0];
  assert.ok(prior);
  const delayedOnEnded = prior.source.onended;
  context.currentTime = prior.record.frameCount / context.sampleRate + 0.01;

  worker.flushOneFill();

  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, 'underrun');
  assert.equal(context.starts.length, 1);
  assert.equal(transport.scheduled.size, 0);
  assert.equal(transport.queue.length, 0);
  delayedOnEnded();
  assert.equal(failures.length, 1);
  assert.equal(context.starts.length, 1);
  await transport.failureCleanupPromise;
  assert.equal(transport.getDiagnosticSnapshot().liveAudioBuffers, 0);
  assert.equal(transport.getDiagnosticSnapshot().liveSourceNodes, 0);
  assert.equal(transport.getDiagnosticSnapshot().liveWorkers, 0);
});

test('superseding a delayed seek disposes its private reservation without adoption', async () => {
  class DelayedOpenWorker extends FakeWorker {
    postMessage(message) {
      if (message.type === RollingPcmCommand.OPEN) {
        this.commands.push(message);
        return;
      }
      super.postMessage(message);
    }
  }
  let workerCount = 0;
  const transport = new RollingPcmTransport(new FakeAudioContext(), {
    workerFactory: () => workerCount++ === 0 ? new FakeWorker() : new DelayedOpenWorker()
  });
  await transport.prepare(canonical(new Uint8Array([1])));
  assert.equal(transport.promoteReservation(), true);
  const committedTransportId = transport.transportId;
  const seeking = transport.seek(48000, { resume: false });
  for (let turn = 0; turn < 10 && !transport.pendingSeek; turn++) await Promise.resolve();
  const candidate = transport.pendingSeek?.candidate;
  assert.ok(candidate);
  assert.equal(candidate.reservationHeld, true);

  await transport.supersedePendingSeek();
  assert.equal(await seeking, false);
  assert.equal(candidate.disposed, true);
  assert.equal(candidate.reservationHeld, false);
  assert.equal(transport.transportId, committedTransportId);
  assert.equal(transport.failed, false);
  await transport.dispose();
});

test('a replacement seek waits for detached Worker cleanup before admission', async () => {
  class DelayedDisposeWorker extends FakeWorker {
    constructor(options) {
      super(options);
      this.pendingDispose = null;
    }
    postMessage(message) {
      if (message.type === RollingPcmCommand.DISPOSE) {
        this.commands.push(message);
        this.pendingDispose = message;
        return;
      }
      super.postMessage(message);
    }
    acknowledgeDispose() {
      const message = this.pendingDispose;
      this.pendingDispose = null;
      if (message) this.emit(RollingPcmEvent.DISPOSED, message);
    }
  }
  const workers = [];
  const transport = new RollingPcmTransport(new FakeAudioContext(), {
    workerFactory: () => {
      const worker = new DelayedDisposeWorker({ totalFrames: 480000 });
      workers.push(worker);
      return worker;
    }
  });
  await transport.prepare(canonical(new Uint8Array([1])));
  assert.equal(transport.promoteReservation(), true);
  assert.deepEqual(await transport.seek(48000, { resume: false }), {
    adoptedFrame: 48000
  });
  assert.equal(workers.length, 2);
  const replacement = transport.seek(96000, { resume: false });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(workers.length, 2);
  workers[0].acknowledgeDispose();
  assert.deepEqual(await replacement, { adoptedFrame: 96000 });
  assert.equal(workers.length, 3);
  workers[1].acknowledgeDispose();
  const disposal = transport.dispose();
  workers[2].acknowledgeDispose();
  await disposal;
});

test('a Worker ERROR raised while disposing neither fails the transport nor forces termination', async () => {
  class TeardownErrorWorker extends FakeWorker {
    postMessage(message) {
      if (message.type !== RollingPcmCommand.DISPOSE) {
        super.postMessage(message);
        return;
      }
      this.commands.push(message);
      this.emit(RollingPcmEvent.ERROR, message, { code: 'decode-failed' });
      this.emit(RollingPcmEvent.DISPOSED, message);
    }
  }
  const failures = [];
  const worker = new TeardownErrorWorker({ totalFrames: 480000 });
  const transport = new RollingPcmTransport(new FakeAudioContext(), {
    workerFactory: () => worker,
    onFailure: failure => failures.push(failure)
  });
  await transport.prepare(canonical(new Uint8Array([1])));
  await transport.dispose();
  assert.deepEqual(failures, []);
  assert.equal(transport.failed, false);
  assert.equal(transport.disposed, true);
  assert.equal(worker.terminated, true);
  const diagnostics = transport.getDiagnosticSnapshot();
  assert.equal(diagnostics.terminateCount, 0);
  assert.equal(diagnostics.disposeCount, 1);
  assert.equal(diagnostics.staleMessages, 0);
});
