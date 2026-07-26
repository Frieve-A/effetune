import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

class PluginBase {
  constructor() {
    this.enabled = true;
    this.id = 31;
  }

  registerProcessor(processor) { this.processorString = processor; }
  updateParameters() {}
  getSerializableParameters() { return this.getParameters(); }
  getWorkletPluginData(parameters) { return parameters; }
  parseFiniteNumber(value, minimum, maximum, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
  }
}

async function loadReference() {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'am_radio_simulator.js'), 'utf8');
  const context = {
    PluginBase,
    performance: { now: () => 1000 },
    window: { dspTelemetryHub: null }
  };
  vm.runInNewContext(source, context);
  const plugin = new context.window.AMRadioSimulatorPlugin();
  return {
    plugin,
    processor: new Function('data', 'parameters', 'context', plugin.processorString)
  };
}

async function renderPilotOnly(tuningKhz, seed, totalFrames) {
  const sampleRate = 96000;
  const blockSize = 128;
  const { plugin, processor } = await loadReference();
  const parameters = {
    ...plugin.getParameters(),
    fr: true,
    enabled: true,
    sm: 'C-QUAM',
    pe: 0,
    cp: 0,
    sg: 0,
    sk: 0,
    st: 0,
    in: -80,
    tn: tuningKhz,
    tb: 10,
    bw: 20,
    hm: -80,
    sp: 'Off',
    sampleRate,
    blockSize,
    channelCount: 2
  };
  const context = { __seededRandom: () => seed };
  let firstTrack = null;
  let maximumBlend = 0;
  for (let offset = 0; offset < totalFrames; offset += blockSize) {
    const frames = Math.min(blockSize, totalFrames - offset);
    parameters.blockSize = frames;
    const output = processor(new Float32Array(frames * 2), parameters, context);
    assert.equal(output.every(Number.isFinite), true);
    const state = context.__amRadioSimulator;
    if (firstTrack === null && state.cquamPllState === 'TRACK') firstTrack = offset + frames;
    if (state.cquamBlend > maximumBlend) maximumBlend = state.cquamBlend;
  }
  return { firstTrack, maximumBlend };
}

const rapidModeSampleRate = 96000;
const rapidModeChannels = 2;
const rapidModeTotalFrames = 6001;
const rapidModeFirstSwitchFrame = 1024;
const rapidModeReverseFrame = 1504;
const rapidModeFirstTransitionEndFrame = rapidModeFirstSwitchFrame +
  Math.round(rapidModeSampleRate * 0.020);

function rapidModeSample(frame, channel) {
  const position = frame + channel * 17;
  return 0.37 * Math.sin(position * 0.071) + 0.18 * Math.cos(position * 0.023);
}

async function renderRapidModeReversal(blockSize, reverseFrame = rapidModeReverseFrame) {
  const { plugin, processor } = await loadReference();
  const parameters = {
    ...plugin.getParameters(),
    fr: true,
    enabled: true,
    sm: 'Mono',
    sampleRate: rapidModeSampleRate,
    blockSize,
    channelCount: rapidModeChannels
  };
  const context = { __seededRandom: () => 0.271828182 };
  const output = new Float32Array(rapidModeTotalFrames * rapidModeChannels);
  const eventFrames = [rapidModeFirstSwitchFrame, reverseFrame];
  let eventIndex = 0;
  let offset = 0;
  while (offset < rapidModeTotalFrames) {
    if (eventIndex < eventFrames.length && offset === eventFrames[eventIndex]) {
      parameters.sm = eventIndex === 0 ? 'C-QUAM' : 'Mono';
      eventIndex++;
    }
    let frames = Math.min(blockSize, rapidModeTotalFrames - offset);
    if (eventIndex < eventFrames.length && offset + frames > eventFrames[eventIndex]) {
      frames = eventFrames[eventIndex] - offset;
    }
    parameters.blockSize = frames;
    const block = new Float32Array(frames * rapidModeChannels);
    for (let channel = 0; channel < rapidModeChannels; channel++) {
      for (let frame = 0; frame < frames; frame++) {
        block[channel * frames + frame] = rapidModeSample(offset + frame, channel);
      }
    }
    processor(block, parameters, context);
    for (let channel = 0; channel < rapidModeChannels; channel++) {
      output.set(block.subarray(channel * frames, (channel + 1) * frames),
        channel * rapidModeTotalFrames + offset);
    }
    offset += frames;
  }
  return { output, state: context.__amRadioSimulator };
}

function firstBitMismatch(left, right, startFrame = 0, endFrame = rapidModeTotalFrames) {
  const leftBits = new Uint32Array(left.buffer, left.byteOffset, left.length);
  const rightBits = new Uint32Array(right.buffer, right.byteOffset, right.length);
  for (let channel = 0; channel < rapidModeChannels; channel++) {
    const channelOffset = channel * rapidModeTotalFrames;
    for (let frame = startFrame; frame < endFrame; frame++) {
      if (leftBits[channelOffset + frame] !== rightBits[channelOffset + frame]) return frame;
    }
  }
  return -1;
}

function firstStereoBitMismatch(output, startFrame, endFrame) {
  const bits = new Uint32Array(output.buffer, output.byteOffset, output.length);
  for (let frame = startFrame; frame < endFrame; frame++) {
    if (bits[frame] !== bits[rapidModeTotalFrames + frame]) return frame;
  }
  return -1;
}

test('C-QUAM total-frequency warmup captures pilot-only +/-450 Hz within one second', async () => {
  const seeds = [0.01, 0.17, 0.33, 0.49, 0.65, 0.81, 0.97];
  for (const tuningKhz of [-0.45, 0.45]) {
    for (const seed of seeds) {
      const result = await renderPilotOnly(tuningKhz, seed, 96000);
      assert.notEqual(result.firstTrack, null,
        `${tuningKhz} kHz seed ${seed} did not reach TRACK`);
      assert.ok(result.firstTrack <= 96000,
        `${tuningKhz} kHz seed ${seed} reached TRACK at ${result.firstTrack / 96000}s`);
    }
  }
});

test('C-QUAM out-of-range pilot-only offsets keep the stereo gate closed', async () => {
  for (const tuningKhz of [0.55, 0.75]) {
    const result = await renderPilotOnly(tuningKhz, 0.271828182, 192000);
    assert.ok(result.maximumBlend < 0.1,
      `${tuningKhz} kHz stereo blend reached ${result.maximumBlend}`);
  }
});

test('sub-20 ms C-QUAM reversal finishes the active transition before returning to Mono', async () => {
  const single = await renderRapidModeReversal(1);
  const odd = await renderRapidModeReversal(127);
  const replay = await renderRapidModeReversal(127);
  const uninterrupted = await renderRapidModeReversal(127, rapidModeTotalFrames);
  const deferred = await renderRapidModeReversal(127, rapidModeFirstTransitionEndFrame);

  assert.equal(firstBitMismatch(single.output, odd.output), -1,
    'rapid reversal output changed with block division');
  assert.equal(firstBitMismatch(odd.output, replay.output), -1,
    'rapid reversal output was not deterministic');
  assert.equal(single.output.every(Number.isFinite), true);
  assert.equal(firstBitMismatch(odd.output, uninterrupted.output,
    rapidModeReverseFrame, rapidModeFirstTransitionEndFrame), -1,
    'the reversal changed output before the active C-QUAM transition finished');
  assert.equal(firstBitMismatch(odd.output, deferred.output), -1,
    'the pending Mono request did not start when the active transition finished');
  assert.notEqual(firstBitMismatch(uninterrupted.output, deferred.output), -1,
    'the deferred Mono reference did not differ from uninterrupted C-QUAM');
  assert.equal(odd.state.stereoMode, 'Mono');
  assert.equal(odd.state.previousStereoMode, null);
  assert.equal(odd.state.stereoBlend, 0);
  assert.equal(firstStereoBitMismatch(
    odd.output, rapidModeTotalFrames - 128, rapidModeTotalFrames), -1,
    'the pending Mono request did not close the stereo output');
});

test('C-QUAM case-015 golden tail contains settled left/right separation', async () => {
  const goldenRoot = path.join(
    repoRoot, 'dsp', 'plugins', 'lofi', 'am_radio_simulator', 'golden');
  const metadata = JSON.parse(await fs.readFile(path.join(goldenRoot, 'case-015.json'), 'utf8'));
  const binary = await fs.readFile(path.join(goldenRoot, metadata.binary));
  const samples = new Float32Array(
    binary.buffer, binary.byteOffset, binary.byteLength / Float32Array.BYTES_PER_ELEMENT);
  const startFrame = metadata.frameCount - 4001;
  let differencePower = 0;
  for (let frame = startFrame; frame < metadata.frameCount; frame++) {
    const difference = samples[frame] - samples[metadata.frameCount + frame];
    differencePower += difference * difference;
  }
  const differenceRms = Math.sqrt(differencePower / (metadata.frameCount - startFrame));
  assert.ok(differenceRms > 0.05, `case-015 tail L/R difference RMS was ${differenceRms}`);
});
