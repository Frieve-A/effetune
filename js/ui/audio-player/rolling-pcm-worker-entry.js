import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  BufferSource,
  Input
} from 'mediabunny';
import {
  createRollingPcmEnvelope,
  FixedPlanarSlabAssembler,
  RollingPcmCommand,
  RollingPcmEvent,
  validateRollingPcmEnvelope
} from './rolling-pcm-protocol.js';
import {
  createPcm16WaveFragmentSource,
  normalizePcm16WaveFillTarget,
  normalizePcm16WaveSeekFrame,
  outputToSourceFrames,
  PCM16_STEREO_44100_TO_96000_PROFILE
} from './rolling-pcm-core.js';

let owner = null;
let operationTail = Promise.resolve();

globalThis.onmessage = event => {
  const message = event.data;
  const validEnvelope = validateRollingPcmEnvelope(message);
  if (owner && validEnvelope &&
      message.transportId === owner.ids.transportId &&
      message.segmentId === owner.ids.segmentId &&
      message.generation > owner.ids.generation &&
      [RollingPcmCommand.SEEK, RollingPcmCommand.DISPOSE].includes(message.type)) {
    owner.pendingGeneration = message.generation;
    releaseSlabCreditWaiter(owner);
  }
  // RECYCLE is the only command handled outside operationTail: it returns the
  // single outstanding slab/fragment credit that a queued FILL is waiting on.
  if (validEnvelope && message.type === RollingPcmCommand.RECYCLE) {
    recycle(message);
    return;
  }
  operationTail = operationTail.then(() => handleMessage(message)).catch(error => {
    postFailure(message, errorCode(error));
  });
};

async function handleMessage(message) {
  if (!validateRollingPcmEnvelope(message)) return;
  switch (message.type) {
    case RollingPcmCommand.OPEN:
      await openSource(message);
      break;
    case RollingPcmCommand.FILL:
      await fill(message);
      break;
    case RollingPcmCommand.SEEK:
      await seek(message);
      break;
    case RollingPcmCommand.DISPOSE:
      await dispose(message, true);
      break;
    default:
      postFailure(message, 'protocol-command-unsupported');
  }
}

async function openSource(message) {
  await dispose(message, false);
  if (!Number.isSafeInteger(message.slabFrames) || message.slabFrames < 128 ||
      message.slabFrames > 2_000_000 ||
      !Number.isSafeInteger(message.freePoolPerSizeClass) ||
      message.freePoolPerSizeClass < 0 || message.freePoolPerSizeClass > 2) {
    throw codedError('slab-frame-limit');
  }
  if (message.decoderProfile !== undefined || message.resamplerProfile !== undefined ||
      message.outputSampleRate !== undefined) {
    openPcm16WaveSource(message);
    return;
  }
  let source;
  if (message.sourceKind === 'blob' && message.source instanceof Blob) {
    source = new BlobSource(message.source);
  } else if (message.sourceKind === 'bytes' && message.source instanceof ArrayBuffer) {
    source = new BufferSource(message.source);
  } else {
    throw codedError('source-invalid');
  }
  let input = new Input({ source, formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw codedError('audio-track-missing');
    const [format, sampleRate, channelCount, durationSec, codec, decoderConfig, canDecode] =
      await Promise.all([
        input.getFormat(),
        track.getSampleRate(),
        track.getNumberOfChannels(),
        track.computeDuration(),
        track.getCodec(),
        track.getDecoderConfig(),
        track.canDecode()
      ]);
    if (!canDecode) throw codedError('decoder-unsupported');
    if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 ||
        !Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 2 ||
        !Number.isFinite(durationSec) || durationSec < 0 ||
        typeof format?.mimeType !== 'string' || format.mimeType.length === 0 ||
        (codec !== null && typeof codec !== 'string') ||
        (decoderConfig?.codec !== undefined && typeof decoderConfig.codec !== 'string')) {
      throw codedError('metadata-invalid');
    }
    const totalFrames = Math.ceil(durationSec * sampleRate);
    if (!Number.isSafeInteger(totalFrames) || totalFrames < 0) {
      throw codedError('duration-overflow');
    }
    const ids = idsFrom(message);
    const recycledPlanes = [];
    const assembler = new FixedPlanarSlabAssembler({
      channelCount,
      slabFrames: message.slabFrames,
      acquirePlane: () => recycledPlanes.pop() ?? null
    });
    owner = {
      ids,
      input,
      track,
      sink: new AudioSampleSink(track),
      iterator: null,
      assembler,
      recycledPlanes,
      freePoolPerSizeClass: message.freePoolPerSizeClass,
      sampleRate,
      channelCount,
      durationSec,
      totalFrames,
      containerMimeType: format.mimeType,
      codec,
      decoderConfigCodec: decoderConfig?.codec ?? null,
      decodedFrame: 0,
      sentFrame: 0,
      ended: false,
      disposed: false,
      pendingGeneration: null,
      nextSlabId: 1,
      outstandingSlabId: null,
      outstandingFragment: null,
      slabCreditWaiter: null
    };
    input = null;
    owner.iterator = owner.sink.samples(0, durationSec)[Symbol.asyncIterator]();
    post(createRollingPcmEnvelope(RollingPcmEvent.READY, ids, {
      sampleRate,
      channelCount,
      durationSec,
      totalFrames,
      containerMimeType: owner.containerMimeType,
      codec,
      decoderConfigCodec: owner.decoderConfigCodec,
      decoderConfigVerified: true
    }));
  } finally {
    input?.dispose();
  }
}

async function fill(message) {
  const state = currentOwner(message);
  if (!state || state.ended) return;
  if (state.fragmentSource) {
    await fillPcm16Wave(state, message);
    return;
  }
  if (!Number.isSafeInteger(message.targetFrame) || message.targetFrame < state.sentFrame ||
      message.targetFrame > state.totalFrames) {
    throw codedError('fill-target-invalid');
  }
  while (!state.ended && state.sentFrame < message.targetFrame) {
    const result = await state.iterator.next();
    if (!currentOwner(message) || state.disposed) {
      result.value?.close?.();
      return;
    }
    if (result.done) {
      if (!await state.assembler.flushWithBackpressure(slab => emitSlab(state, slab))) return;
      state.ended = true;
      post(createRollingPcmEnvelope(RollingPcmEvent.SEGMENT_END, state.ids, {
        totalFrames: state.sentFrame
      }));
      return;
    }
    const sample = result.value;
    try {
      if (!await appendSample(state, sample)) return;
    } finally {
      sample.close();
    }
  }
  if (!state.ended && state.sentFrame === state.totalFrames) {
    state.ended = true;
    post(createRollingPcmEnvelope(RollingPcmEvent.SEGMENT_END, state.ids, {
      totalFrames: state.sentFrame
    }));
    return;
  }
  post(createRollingPcmEnvelope(RollingPcmEvent.QUEUE_STATE, state.ids, {
    decodedFrame: state.decodedFrame,
    sentFrame: state.sentFrame,
    ended: state.ended
  }));
}

async function appendSample(state, sample) {
  if (sample.sampleRate !== state.sampleRate || sample.numberOfChannels !== state.channelCount) {
    throw codedError('decoded-format-changed');
  }
  let sourceOffset = 0;
  let frameCount = sample.numberOfFrames;
  const timestampFrame = Math.round(sample.timestamp * state.sampleRate);
  if (!Number.isSafeInteger(timestampFrame)) throw codedError('decoded-timestamp-invalid');
  if (timestampFrame + frameCount <= state.decodedFrame) return true;
  if (timestampFrame > state.decodedFrame) throw codedError('decoded-timestamp-gap');
  if (timestampFrame < state.decodedFrame) {
    sourceOffset = state.decodedFrame - timestampFrame;
    frameCount -= sourceOffset;
  }
  if (frameCount <= 0) return true;
  const sourcePlanes = Array.from({ length: state.channelCount }, (_, channel) => {
    const plane = new Float32Array(sample.numberOfFrames);
    sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
    return plane;
  });
  if (!await state.assembler.appendWithBackpressure(
    sourcePlanes,
    sourceOffset,
    frameCount,
    slab => emitSlab(state, slab)
  )) return false;
  state.decodedFrame += frameCount;
  return true;
}

async function emitSlab(state, slab) {
  await waitForSlabCredit(state);
  if (state.disposed || owner !== state || state.pendingGeneration !== null) return false;
  const slabId = state.nextSlabId++;
  state.outstandingSlabId = slabId;
  state.sentFrame = slab.startFrame + slab.frameCount;
  const message = createRollingPcmEnvelope(RollingPcmEvent.SLAB, state.ids, {
    slabId,
    startFrame: slab.startFrame,
    frameCount: slab.frameCount,
    channelCount: state.channelCount,
    planes: slab.planes
  });
  post(message, slab.planes);
  return true;
}

async function seek(message) {
  const state = ownerForReplacementGeneration(message);
  if (!state || !Number.isSafeInteger(message.frame) || message.frame < 0 ||
      message.frame > state.totalFrames) return;
  if (state.fragmentSource) {
    seekPcm16Wave(state, message);
    return;
  }
  state.ids = idsFrom(message);
  state.pendingGeneration = null;
  state.nextSlabId = 1;
  state.outstandingSlabId = null;
  state.decodedFrame = message.frame;
  state.sentFrame = message.frame;
  state.ended = message.frame === state.totalFrames;
  state.assembler.reset(message.frame);
  await state.iterator?.return?.();
  state.iterator = state.sink.samples(
    message.frame / state.sampleRate,
    state.durationSec
  )[Symbol.asyncIterator]();
  post(createRollingPcmEnvelope(RollingPcmEvent.QUEUE_STATE, state.ids, {
    decodedFrame: state.decodedFrame,
    sentFrame: state.sentFrame,
    ended: state.ended
  }));
}

function openPcm16WaveSource(message) {
  const profile = PCM16_STEREO_44100_TO_96000_PROFILE;
  if (message.sourceKind !== 'bytes' || !(message.source instanceof ArrayBuffer)) {
    throw codedError('source-invalid');
  }
  if (message.outputSampleRate !== profile.outputSampleRate ||
      message.decoderProfile !== profile.codec ||
      message.resamplerProfile !== profile.id) {
    throw codedError('partial-decode-profile-unsupported');
  }
  const fragmentSource = createPcm16WaveFragmentSource(message.source, {
    outputSampleRate: message.outputSampleRate
  });
  if (!fragmentSource) throw codedError('wav-partial-decode-ineligible');
  const ids = idsFrom(message);
  owner = {
    ids,
    input: null,
    sink: null,
    iterator: null,
    assembler: { slabFrames: message.slabFrames },
    fragmentSource,
    recycledPlanes: [],
    freePoolPerSizeClass: message.freePoolPerSizeClass,
    sampleRate: fragmentSource.outputSampleRate,
    sourceSampleRate: fragmentSource.sourceSampleRate,
    channelCount: fragmentSource.channelCount,
    durationSec: fragmentSource.totalFrames / fragmentSource.outputSampleRate,
    sourceTotalFrames: fragmentSource.sourceTotalFrames,
    sourceByteLength: fragmentSource.sourceByteLength,
    dataOffset: fragmentSource.dataOffset,
    dataByteLength: fragmentSource.dataByteLength,
    bitsPerSample: fragmentSource.bitsPerSample,
    blockAlign: fragmentSource.blockAlign,
    totalFrames: fragmentSource.totalFrames,
    containerMimeType: 'audio/wav',
    codec: 'pcm-s16',
    decoderConfigCodec: 'pcm-s16',
    decodedFrame: 0,
    sentFrame: 0,
    ended: false,
    disposed: false,
    pendingGeneration: null,
    nextSlabId: 1,
    outstandingSlabId: null,
    outstandingFragment: null,
    slabCreditWaiter: null
  };
  post(createRollingPcmEnvelope(RollingPcmEvent.READY, ids, {
    sourceSampleRate: owner.sourceSampleRate,
    outputSampleRate: owner.sampleRate,
    sampleRate: owner.sampleRate,
    channelCount: owner.channelCount,
    durationSec: owner.durationSec,
    sourceTotalFrames: owner.sourceTotalFrames,
    sourceByteLength: owner.sourceByteLength,
    dataOffset: owner.dataOffset,
    dataByteLength: owner.dataByteLength,
    bitsPerSample: owner.bitsPerSample,
    blockAlign: owner.blockAlign,
    totalFrames: owner.totalFrames,
    containerMimeType: owner.containerMimeType,
    codec: owner.codec,
    decoderConfigCodec: owner.decoderConfigCodec,
    decoderConfigVerified: true,
    decoderProfile: profile.codec,
    resamplerProfile: profile.id,
    workerCompressedBytes: owner.sourceByteLength
  }));
}

async function fillPcm16Wave(state, message) {
  const normalizedTarget = normalizePcm16WaveFillTarget(
    state.sentFrame,
    message.targetFrame,
    state.sourceTotalFrames
  );
  if (normalizedTarget === null) {
    throw codedError('fill-target-invalid');
  }
  while (!state.ended && state.sentFrame < normalizedTarget) {
    const sourceStartFrame = outputToSourceFrames(state.sentFrame);
    const fragmentTarget = normalizePcm16WaveFillTarget(
      state.sentFrame,
      state.sentFrame + 1,
      state.sourceTotalFrames
    );
    if (sourceStartFrame === null || fragmentTarget === null ||
        fragmentTarget <= state.sentFrame || fragmentTarget > normalizedTarget) {
      throw codedError('fill-target-invalid');
    }
    const startFrame = state.sentFrame;
    const fragment = state.fragmentSource.createFragment(
      startFrame,
      fragmentTarget - startFrame
    );
    if (!await emitFragment(state, fragment)) return;
  }
  await waitForSlabCredit(state);
  if (state.disposed || owner !== state || state.pendingGeneration !== null) return;
  if (state.sentFrame === state.totalFrames) {
    state.ended = true;
    post(createRollingPcmEnvelope(RollingPcmEvent.SEGMENT_END, state.ids, {
      totalFrames: state.totalFrames
    }));
    return;
  }
  post(createRollingPcmEnvelope(RollingPcmEvent.QUEUE_STATE, state.ids, {
    decodedFrame: state.sentFrame,
    sentFrame: state.sentFrame,
    ended: false
  }));
}

function seekPcm16Wave(state, message) {
  const normalized = normalizePcm16WaveSeekFrame(
    message.frame,
    state.sourceTotalFrames
  );
  if (!normalized) throw codedError('seek-frame-invalid');
  state.ids = idsFrom(message);
  state.pendingGeneration = null;
  state.nextSlabId = 1;
  state.outstandingSlabId = null;
  state.outstandingFragment = null;
  state.decodedFrame = normalized.adoptedOutputFrame;
  state.sentFrame = normalized.adoptedOutputFrame;
  state.ended = normalized.adoptedOutputFrame === state.totalFrames;
  post(createRollingPcmEnvelope(RollingPcmEvent.QUEUE_STATE, state.ids, {
    decodedFrame: state.sentFrame,
    sentFrame: state.sentFrame,
    ended: state.ended,
    requestedFrame: normalized.requestedOutputFrame,
    sourceFrame: normalized.sourceFrame,
    adoptedFrame: normalized.adoptedOutputFrame
  }));
}

async function emitFragment(state, fragment) {
  await waitForSlabCredit(state);
  if (state.disposed || owner !== state || state.pendingGeneration !== null) return false;
  const fragmentId = state.nextSlabId++;
  const fragmentToken = createFragmentToken(state.ids, fragmentId);
  state.outstandingFragment = { fragmentId, fragmentToken };
  state.sentFrame = fragment.outputStartFrame + fragment.outputFrameCount;
  state.decodedFrame = state.sentFrame;
  post(createRollingPcmEnvelope(RollingPcmEvent.FRAGMENT, state.ids, {
    fragmentId,
    fragmentToken,
    fragmentBytes: fragment.fragmentBytes,
    fragmentSourceStartFrame: fragment.fragmentSourceStartFrame,
    fragmentSourceFrameCount: fragment.fragmentSourceFrameCount,
    logicalSourceStartFrame: fragment.logicalSourceStartFrame,
    logicalSourceFrameCount: fragment.logicalSourceFrameCount,
    outputStartFrame: fragment.outputStartFrame,
    outputFrameCount: fragment.outputFrameCount,
    cropStartFrame: fragment.cropStartFrame,
    decodedOutputFrameCount: fragment.decodedOutputFrameCount,
    sourceSampleRate: state.sourceSampleRate,
    outputSampleRate: state.sampleRate,
    channelCount: state.channelCount,
    decoderProfile: PCM16_STEREO_44100_TO_96000_PROFILE.codec,
    resamplerProfile: PCM16_STEREO_44100_TO_96000_PROFILE.id
  }), [fragment.fragmentBytes]);
  return true;
}

function createFragmentToken(ids, fragmentId) {
  const random = new Uint32Array(4);
  globalThis.crypto.getRandomValues(random);
  return `${ids.generation}:${fragmentId}:${[...random]
    .map(value => value.toString(16).padStart(8, '0')).join('')}`;
}

function recycle(message) {
  const state = currentOwner(message);
  if (!state) return;
  if (state.fragmentSource) {
    if (!Number.isSafeInteger(message.fragmentId) ||
        message.fragmentId !== state.outstandingFragment?.fragmentId ||
        message.fragmentToken !== state.outstandingFragment?.fragmentToken) return;
    state.outstandingFragment = null;
    releaseSlabCreditWaiter(state);
    return;
  }
  if (!Number.isSafeInteger(message.slabId) ||
      message.slabId !== state.outstandingSlabId) return;
  if (Array.isArray(message.planes)) {
    for (const plane of message.planes) {
      if (plane instanceof ArrayBuffer &&
          plane.byteLength === state.assembler.slabFrames * Float32Array.BYTES_PER_ELEMENT &&
          state.recycledPlanes.length < state.channelCount * state.freePoolPerSizeClass) {
        state.recycledPlanes.push(plane);
      }
    }
  }
  state.outstandingSlabId = null;
  releaseSlabCreditWaiter(state);
}

async function dispose(message, notify) {
  const state = owner;
  owner = null;
  if (state) {
    state.disposed = true;
    releaseSlabCreditWaiter(state);
    // Decoder teardown failures never turn DISPOSE into ERROR: the transport
    // waits for DISPOSED and would otherwise fail and terminate the Worker.
    try {
      await state.iterator?.return?.();
    } catch (_) {
      // Ignored: the iterator is unreachable after this point.
    }
    try {
      state.input?.dispose?.();
    } catch (_) {
      // Ignored: the input is unreachable after this point.
    }
    state.recycledPlanes.length = 0;
    state.fragmentSource = null;
  }
  if (notify && validateRollingPcmEnvelope(message)) {
    post(createRollingPcmEnvelope(RollingPcmEvent.DISPOSED, idsFrom(message)));
  }
}

function waitForSlabCredit(state) {
  if ((state.outstandingSlabId === null && state.outstandingFragment === null) ||
      state.disposed || state.pendingGeneration !== null) {
    return Promise.resolve();
  }
  if (!state.slabCreditWaiter) {
    state.slabCreditWaiter = {};
    state.slabCreditWaiter.promise = new Promise(resolve => {
      state.slabCreditWaiter.resolve = resolve;
    });
  }
  return state.slabCreditWaiter.promise;
}

function releaseSlabCreditWaiter(state) {
  const waiter = state?.slabCreditWaiter;
  if (!waiter) return;
  state.slabCreditWaiter = null;
  waiter.resolve();
}

function currentOwner(message) {
  return owner && owner.pendingGeneration === null && validateRollingPcmEnvelope(message, {
    expectedTransportId: owner.ids.transportId,
    expectedGeneration: owner.ids.generation,
    expectedSegmentId: owner.ids.segmentId
  }) ? owner : null;
}

function ownerForReplacementGeneration(message) {
  return owner && validateRollingPcmEnvelope(message, {
    expectedTransportId: owner.ids.transportId,
    expectedSegmentId: owner.ids.segmentId
  }) && message.generation > owner.ids.generation &&
    (owner.pendingGeneration === null || owner.pendingGeneration === message.generation)
    ? owner
    : null;
}

function idsFrom(message) {
  return {
    transportId: message.transportId,
    generation: message.generation,
    segmentId: message.segmentId
  };
}

function post(message, transfer = []) {
  globalThis.postMessage(message, transfer);
}

function postFailure(message, code) {
  if (!validateRollingPcmEnvelope(message)) return;
  post(createRollingPcmEnvelope(RollingPcmEvent.ERROR, idsFrom(message), { code }));
}

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

function errorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'decode-failed';
}
