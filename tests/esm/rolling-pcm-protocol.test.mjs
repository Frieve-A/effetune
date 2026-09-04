import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioSampleSink } from 'mediabunny';
import {
  createRollingPcmEnvelope,
  FixedPlanarSlabAssembler,
  RollingPcmCommand,
  RollingPcmEvent,
  validateRollingPcmEnvelope,
  validateRollingPcmFragment,
  validateRollingPcmSlab
} from '../../js/ui/audio-player/rolling-pcm-protocol.js';

const ids = { transportId: 'transport', generation: 1, segmentId: 'current' };

test('protocol carries authenticated PCM source and output domains without aliases', () => {
  const source = new ArrayBuffer(44);
  const open = createRollingPcmEnvelope(RollingPcmCommand.OPEN, ids, {
    sourceKind: 'bytes',
    source,
    slabFrames: 128,
    freePoolPerSizeClass: 0,
    outputSampleRate: 96000,
    decoderProfile: 'native-decode-audio-data-pcm16le-stereo-v1',
    resamplerProfile: 'pcm16le-stereo-native-fragment-electron44-chromium152-v1'
  });
  const ready = createRollingPcmEnvelope(RollingPcmEvent.READY, ids, {
    sampleRate: 96000,
    sourceSampleRate: 44100,
    outputSampleRate: 96000,
    channelCount: 2,
    durationSec: 1,
    sourceTotalFrames: 44100,
    sourceByteLength: 176444,
    dataOffset: 44,
    dataByteLength: 176400,
    bitsPerSample: 16,
    blockAlign: 4,
    totalFrames: 96000,
    containerMimeType: 'audio/wav',
    codec: 'pcm-s16',
    decoderConfigCodec: 'pcm-s16',
    decoderConfigVerified: true,
    decoderProfile: 'native-decode-audio-data-pcm16le-stereo-v1',
    resamplerProfile: 'pcm16le-stereo-native-fragment-electron44-chromium152-v1'
  });

  assert.equal(validateRollingPcmEnvelope(open), true);
  assert.equal(validateRollingPcmEnvelope(ready), true);
  assert.equal(validateRollingPcmEnvelope({ ...open, sourceSampleRate: 44100 }), false);
  assert.equal(validateRollingPcmEnvelope({ ...ready, sourceFrames: 44100 }), false);
  const seekState = createRollingPcmEnvelope(RollingPcmEvent.QUEUE_STATE, ids, {
    decodedFrame: 123467,
    sentFrame: 123467,
    ended: false,
    requestedFrame: 123457,
    sourceFrame: 56718,
    adoptedFrame: 123467
  });
  assert.equal(validateRollingPcmEnvelope(seekState), true);
});

test('protocol envelopes reject stale generations and malformed slabs', () => {
  const envelope = createRollingPcmEnvelope(RollingPcmEvent.QUEUE_STATE, ids);
  assert.equal(validateRollingPcmEnvelope(envelope, { expectedGeneration: 1 }), true);
  assert.equal(validateRollingPcmEnvelope(envelope, { expectedGeneration: 2 }), false);
  assert.equal(validateRollingPcmEnvelope({ ...envelope, unexpected: true }), false);
  assert.equal(validateRollingPcmEnvelope({ ...envelope, type: 'futureCommand' }), false);
  const slab = createRollingPcmEnvelope(RollingPcmEvent.SLAB, ids, {
    slabId: 1,
    startFrame: 0,
    frameCount: 2,
    channelCount: 1,
    planes: [new Float32Array([1, 2]).buffer]
  });
  assert.equal(validateRollingPcmSlab(slab, { ...ids, maxFrames: 2 }), true);
  assert.equal(validateRollingPcmSlab({ ...slab, frameCount: 3 }, { ...ids, maxFrames: 3 }), false);
});

test('fragment envelopes bind exact source, crop, and output ranges to one token', () => {
  const fragment = createRollingPcmEnvelope(RollingPcmEvent.FRAGMENT, ids, {
    fragmentId: 1,
    fragmentToken: 'authenticated-fragment-token',
    fragmentBytes: new ArrayBuffer(176444),
    fragmentSourceStartFrame: 0,
    fragmentSourceFrameCount: 44100,
    logicalSourceStartFrame: 0,
    logicalSourceFrameCount: 22050,
    outputStartFrame: 0,
    outputFrameCount: 48000,
    cropStartFrame: 0,
    decodedOutputFrameCount: 96000,
    sourceSampleRate: 44100,
    outputSampleRate: 96000,
    channelCount: 2,
    decoderProfile: 'native-decode-audio-data-pcm16le-stereo-v1',
    resamplerProfile: 'pcm16le-stereo-native-fragment-electron44-chromium152-v1'
  });
  assert.equal(validateRollingPcmFragment(fragment, {
    ...ids,
    maxFragmentBytes: 264644,
    maxOutputFrames: 48000
  }), true);
  assert.equal(validateRollingPcmFragment({ ...fragment, cropStartFrame: 48001 }, {
    ...ids,
    maxFragmentBytes: 264644,
    maxOutputFrames: 48000
  }), false);
  assert.equal(validateRollingPcmEnvelope({ ...fragment, source: new ArrayBuffer(1) }), false);
});

test('fixed planar assembly pauses emission until one-slab credit is returned', async () => {
  const assembler = new FixedPlanarSlabAssembler({ channelCount: 1, slabFrames: 2 });
  const emitted = [];
  let releaseFirst;
  const firstCredit = new Promise(resolve => { releaseFirst = resolve; });
  const appending = assembler.appendWithBackpressure(
    [new Float32Array([1, 2, 3, 4])],
    0,
    4,
    async slab => {
      emitted.push(slab);
      if (emitted.length === 1) await firstCredit;
      return true;
    }
  );
  await Promise.resolve();
  assert.equal(emitted.length, 1);
  releaseFirst();
  assert.equal(await appending, true);
  assert.equal(emitted.length, 2);
});

test('fixed planar assembly emits exact full and final slabs', () => {
  const emitted = [];
  const assembler = new FixedPlanarSlabAssembler({ channelCount: 2, slabFrames: 4 });
  assembler.append([
    new Float32Array([1, 2, 3, 4, 5, 6]),
    new Float32Array([11, 12, 13, 14, 15, 16])
  ], 0, 6, slab => emitted.push(slab));
  assembler.flush(slab => emitted.push(slab));
  assert.deepEqual(emitted.map(slab => [slab.startFrame, slab.frameCount]), [[0, 4], [4, 2]]);
  assert.deepEqual([...new Float32Array(emitted[0].planes[0])], [1, 2, 3, 4]);
  assert.deepEqual([...new Float32Array(emitted[1].planes[1])], [15, 16]);
});

function createSilentPcm16StereoWave(frames, sampleRate = 48000) {
  const dataBytes = frames * 2 * Int16Array.BYTES_PER_ELEMENT;
  const wave = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(wave);
  const writeAscii = (offset, value) => {
    for (let index = 0; index < value.length; index++) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return wave;
}

async function waitForPostedEvent(posted, type) {
  const deadline = Date.now() + 5000;
  while (!posted.some(message => message.type === type)) {
    if (Date.now() > deadline) {
      throw new Error(`Worker never posted ${type}: ${JSON.stringify(posted.map(m => m.type))}`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('Worker DISPOSE is acknowledged with DISPOSED even when decoder teardown throws', async () => {
  const posted = [];
  const hadPostMessage = Object.hasOwn(globalThis, 'postMessage');
  const previousPostMessage = globalThis.postMessage;
  const originalSamples = AudioSampleSink.prototype.samples;
  globalThis.postMessage = message => posted.push(message);
  AudioSampleSink.prototype.samples = () => ({
    [Symbol.asyncIterator]: () => ({
      next: async () => ({ done: true, value: undefined }),
      return: async () => { throw new Error('decoder-teardown-failed'); }
    })
  });
  try {
    await import('../../js/ui/audio-player/rolling-pcm-worker-entry.js');
    const ids = { transportId: 'transport-teardown', generation: 1, segmentId: 'segment-teardown' };
    const deliver = message => globalThis.onmessage({ data: message });
    deliver(createRollingPcmEnvelope(RollingPcmCommand.OPEN, ids, {
      sourceKind: 'bytes',
      source: createSilentPcm16StereoWave(4800),
      slabFrames: 4800,
      freePoolPerSizeClass: 1
    }));
    await waitForPostedEvent(posted, RollingPcmEvent.READY);
    deliver(createRollingPcmEnvelope(RollingPcmCommand.DISPOSE, { ...ids, generation: 2 }));
    await waitForPostedEvent(posted, RollingPcmEvent.DISPOSED);
    assert.deepEqual(posted.map(message => message.type),
      [RollingPcmEvent.READY, RollingPcmEvent.DISPOSED]);
    assert.equal(posted[1].generation, 2);
  } finally {
    AudioSampleSink.prototype.samples = originalSamples;
    if (hadPostMessage) globalThis.postMessage = previousPostMessage;
    else delete globalThis.postMessage;
  }
});
