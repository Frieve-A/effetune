import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePcmWaveFormatFromBytes } from '../../js/library/metadata/riff-info.js';
import {
  createPcm16WaveFragmentSource,
  normalizePcm16WaveFillTarget,
  normalizePcm16WaveSeekFrame,
  PCM16_STEREO_44100_TO_96000_PROFILE,
  planPcm16WaveFragment,
  sourceToOutputFrames
} from '../../js/ui/audio-player/rolling-pcm-core.js';

function createWave(frameCount = 88200, { channelCount = 2, sampleRate = 44100 } = {}) {
  const blockAlign = channelCount * Int16Array.BYTES_PER_ELEMENT;
  const bytes = new Uint8Array(44 + frameCount * blockAlign);
  const view = new DataView(bytes.buffer);
  const ascii = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, frameCount * blockAlign, true);
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const value = ((frame * 811 + channel * 1291 + (frame % 17) * 97) % 65535) - 32767;
      view.setInt16(44 + (frame * channelCount + channel) * 2, value, true);
    }
  }
  return bytes;
}

test('native fragment plans form exact first, middle, and final output intervals', () => {
  const profile = PCM16_STEREO_44100_TO_96000_PROFILE;
  const source = createPcm16WaveFragmentSource(createWave());
  assert.ok(source);
  assert.equal(source.totalFrames, 192000);
  const fragments = [];
  for (let outputStartFrame = 0; outputStartFrame < source.totalFrames;
    outputStartFrame += profile.logicalOutputFrames) {
    fragments.push(source.createFragment(outputStartFrame, profile.logicalOutputFrames));
  }

  assert.deepEqual(fragments.map(fragment => ({
    output: [fragment.outputStartFrame, fragment.outputFrameCount],
    logicalSource: [fragment.logicalSourceStartFrame, fragment.logicalSourceFrameCount],
    fragmentSource: [fragment.fragmentSourceStartFrame, fragment.fragmentSourceFrameCount],
    crop: fragment.cropStartFrame,
    decoded: fragment.decodedOutputFrameCount
  })), [
    { output: [0, 48000], logicalSource: [0, 22050], fragmentSource: [0, 44100],
      crop: 0, decoded: 96000 },
    { output: [48000, 48000], logicalSource: [22050, 22050], fragmentSource: [0, 66150],
      crop: 48000, decoded: 144000 },
    { output: [96000, 48000], logicalSource: [44100, 22050],
      fragmentSource: [22050, 66150], crop: 48000, decoded: 144000 },
    { output: [144000, 48000], logicalSource: [66150, 22050],
      fragmentSource: [44100, 44100], crop: 48000, decoded: 96000 }
  ]);
  assert.deepEqual(fragments.map(fragment => [
    fragment.outputStartFrame,
    fragment.outputStartFrame + fragment.outputFrameCount
  ]), [[0, 48000], [48000, 96000], [96000, 144000], [144000, 192000]]);
  assert.equal(Math.max(...fragments.map(fragment => fragment.fragmentBytes.byteLength)),
    profile.maxFragmentByteLength);
  for (const fragment of fragments) {
    const format = parsePcmWaveFormatFromBytes(fragment.fragmentBytes);
    assert.equal(format.sourceFrames, fragment.fragmentSourceFrameCount);
    assert.equal(format.sampleRate, profile.sourceSampleRate);
    assert.equal(format.channelCount, profile.channelCount);
  }
});

test('native fragments contain the exact guarded PCM16 source range', () => {
  const wave = createWave();
  const source = createPcm16WaveFragmentSource(wave);
  const fragment = source.createFragment(96000, 48000);
  const format = parsePcmWaveFormatFromBytes(fragment.fragmentBytes);
  const original = new Uint8Array(
    wave.buffer,
    44 + fragment.fragmentSourceStartFrame * 4,
    fragment.fragmentSourceFrameCount * 4
  );
  const copied = new Uint8Array(
    fragment.fragmentBytes,
    format.dataOffset,
    format.dataByteLength
  );
  assert.deepEqual(copied, original);
});

test('native final fragment keeps exact partial output with available trailing guard', () => {
  const source = createPcm16WaveFragmentSource(createWave(67620));
  assert.equal(source.totalFrames, 147200);
  const finalFragment = source.createFragment(144000, 3200);
  assert.deepEqual({
    logicalSource: [
      finalFragment.logicalSourceStartFrame,
      finalFragment.logicalSourceFrameCount
    ],
    fragmentSource: [
      finalFragment.fragmentSourceStartFrame,
      finalFragment.fragmentSourceFrameCount
    ],
    cropStartFrame: finalFragment.cropStartFrame,
    decodedOutputFrameCount: finalFragment.decodedOutputFrameCount,
    outputFrameCount: finalFragment.outputFrameCount
  }, {
    logicalSource: [66150, 1470],
    fragmentSource: [44100, 23520],
    cropStartFrame: 48000,
    decodedOutputFrameCount: 51200,
    outputFrameCount: 3200
  });
});

test('every final source-frame remainder produces exact native output intervals', () => {
  for (let remainder = 1; remainder < 147; remainder += 1) {
    const sourceTotalFrames = 88200 + remainder;
    const totalFrames = sourceToOutputFrames(sourceTotalFrames);
    const finalFrameCount = totalFrames - 192000;
    const plan = planPcm16WaveFragment({
      sourceTotalFrames,
      outputStartFrame: 192000,
      outputFrameCount: finalFrameCount
    });
    assert.ok(plan, `remainder ${remainder}`);
    assert.equal(plan.logicalSourceStartFrame, 88200);
    assert.equal(plan.logicalSourceFrameCount, remainder);
    assert.equal(plan.outputStartFrame + plan.outputFrameCount, totalFrames);
  }

  const tail = createPcm16WaveFragmentSource(createWave(88201));
  assert.equal(tail.totalFrames, 192002);
  assert.equal(tail.createFragment(192000, 2).logicalSourceFrameCount, 1);
});

test('fill and seek normalize arbitrary output requests to canonical source identities', () => {
  const sourceTotalFrames = 44100 * 12 + 83;
  const totalFrames = sourceToOutputFrames(sourceTotalFrames);
  assert.deepEqual(normalizePcm16WaveSeekFrame(96001, sourceTotalFrames), {
    requestedOutputFrame: 96001,
    sourceFrame: 44100,
    adoptedOutputFrame: 96000
  });
  assert.equal(normalizePcm16WaveFillTarget(0, 1, sourceTotalFrames), 48000);
  assert.equal(normalizePcm16WaveFillTarget(0, 48001, sourceTotalFrames), 96000);
  assert.equal(normalizePcm16WaveFillTarget(0, totalFrames - 1, sourceTotalFrames), totalFrames);
});

test('native fragment planning rejects formats and noncanonical ranges', () => {
  assert.equal(createPcm16WaveFragmentSource(createWave(88200, { channelCount: 1 })), null);
  assert.equal(createPcm16WaveFragmentSource(createWave(88200, { sampleRate: 48000 })), null);
  assert.equal(createPcm16WaveFragmentSource(createWave(), { outputSampleRate: 48000 }), null);
  assert.equal(planPcm16WaveFragment({
    sourceTotalFrames: 88200,
    outputStartFrame: 1,
    outputFrameCount: 48000
  }), null);
  assert.equal(planPcm16WaveFragment({
    sourceTotalFrames: 88200,
    outputStartFrame: 0,
    outputFrameCount: 480
  }), null);
});

test('seek adoption keeps the fragment origin on the resampling lattice', () => {
  const profile = PCM16_STEREO_44100_TO_96000_PROFILE;
  const sourceTotalFrames = 44100 * 12 + 83;
  const totalFrames = sourceToOutputFrames(sourceTotalFrames);
  const requests = [];
  // Three whole lattice periods at the head plus the last period before the end
  // cover every residue class of the 320/147 output grid.
  for (let offset = 0; offset < 960; offset += 1) requests.push(offset);
  for (let offset = 1; offset <= 320; offset += 1) requests.push(totalFrames - offset);
  for (const requestedOutputFrame of requests) {
    const seek = normalizePcm16WaveSeekFrame(requestedOutputFrame, sourceTotalFrames);
    assert.ok(seek, `seek ${requestedOutputFrame}`);
    assert.equal(seek.sourceFrame % profile.sourceStepNumerator, 0,
      `seek ${requestedOutputFrame} left the lattice at source ${seek.sourceFrame}`);
    assert.equal(seek.adoptedOutputFrame, sourceToOutputFrames(seek.sourceFrame));
    assert.ok(seek.adoptedOutputFrame <= requestedOutputFrame);
    assert.ok(requestedOutputFrame - seek.adoptedOutputFrame < profile.sourceStepDenominator);
  }
  assert.deepEqual(normalizePcm16WaveSeekFrame(totalFrames, sourceTotalFrames), {
    requestedOutputFrame: totalFrames,
    sourceFrame: sourceTotalFrames,
    adoptedOutputFrame: totalFrames
  });
});

test('every adopted seek plays through to the final fragment of the track', () => {
  const profile = PCM16_STEREO_44100_TO_96000_PROFILE;
  const playThrough = (sourceTotalFrames, startFrame) => {
    const totalFrames = sourceToOutputFrames(sourceTotalFrames);
    let sent = startFrame;
    while (sent < totalFrames) {
      const target = normalizePcm16WaveFillTarget(sent, sent + 1, sourceTotalFrames);
      assert.ok(target !== null && target > sent, `fill target stalled at ${sent}`);
      assert.ok(planPcm16WaveFragment({
        sourceTotalFrames,
        outputStartFrame: sent,
        outputFrameCount: target - sent
      }), `unplannable fragment at ${sent} of ${totalFrames} (source ${sourceTotalFrames})`);
      sent = target;
    }
  };
  // The final fragment clips its trailing guard against the end of the track, so
  // its crop arithmetic is only exact when the whole run started on the lattice.
  for (const remainder of [0, 1, 2, 73, 145, 146]) {
    const sourceTotalFrames = 44100 * 7 + remainder;
    const totalFrames = sourceToOutputFrames(sourceTotalFrames);
    const requests = [0, 1, 2, 319, 320, 321, 96000, 96001];
    for (let offset = 1; offset <= 640; offset += 1) requests.push(totalFrames - offset);
    for (const requestedOutputFrame of requests) {
      if (requestedOutputFrame < 0 || requestedOutputFrame > totalFrames) continue;
      const seek = normalizePcm16WaveSeekFrame(requestedOutputFrame, sourceTotalFrames);
      assert.ok(seek, `seek ${requestedOutputFrame}`);
      playThrough(sourceTotalFrames, seek.adoptedOutputFrame);
    }
  }
  assert.equal(profile.sourceStepNumerator, 147);
});
