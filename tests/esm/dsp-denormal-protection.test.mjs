import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import {
  addDenormalNoise,
  DENORMAL_NOISE_AMPLITUDE
} from '../../dsp/bindings/js/src/denormal-noise.js';

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;
const MAX_OUTPUT_NOISE = 10 ** (-288 / 20);
const MAX_PLUGIN_COUNT = 128;
const MAX_INTERNAL_COHERENT_SITES_PER_PLUGIN = 38;
const MAX_COHERENT_SITES_PER_PLUGIN = 1 + MAX_INTERNAL_COHERENT_SITES_PER_PLUGIN;

function channel(audio, index, frames) {
  return audio.subarray(index * frames, (index + 1) * frames);
}

function loadWorkletProcessor() {
  const source = fs.readFileSync(new URL('../../plugins/audio-processor.js', import.meta.url), 'utf8');
  const registrations = new Map();
  class AudioWorkletProcessor {
    constructor() {
      this.port = { onmessage: null, postMessage() {} };
    }
  }
  const context = vm.createContext({
    AudioWorkletProcessor,
    console,
    currentFrame: 0,
    Date,
    registerProcessor(name, processor) { registrations.set(name, processor); },
    sampleRate: SAMPLE_RATE,
    TextDecoder,
    TextEncoder,
    WebAssembly
  });
  vm.runInContext(source, context, { filename: 'audio-processor.js' });
  const Processor = registrations.get('plugin-processor');
  assert.equal(typeof Processor, 'function');
  return new Processor({ processorOptions: { initialOutputChannelCount: 2 } });
}

function loadDynamicSaturationProcessor() {
  const source = fs.readFileSync(
    new URL('../../plugins/saturation/dynamic_saturation.js', import.meta.url),
    'utf8'
  );
  let processorSource = '';
  class PluginBase {
    registerProcessor(value) {
      processorSource = value;
    }
  }
  const context = vm.createContext({ PluginBase, window: {} });
  vm.runInContext(source, context, { filename: 'dynamic_saturation.js' });
  const Plugin = context.window.DynamicSaturationPlugin;
  assert.equal(typeof Plugin, 'function');
  new Plugin();
  assert.notEqual(processorSource, '');
  return vm.compileFunction(processorSource, ['data', 'parameters', 'context']);
}

test('denormal noise is continuous, DC-free, inaudible, and transparent to normal samples', () => {
  const headerSource = fs.readFileSync(
    new URL('../../dsp/include/effetune/dsp/denormal_noise.h', import.meta.url),
    'utf8'
  );
  const perEffectMatch = headerSource.match(/kAmplitude\s*=\s*([0-9.e+-]+);/i);
  assert.ok(perEffectMatch);
  assert.equal(Number(perEffectMatch[1]), DENORMAL_NOISE_AMPLITUDE);
  const maximumCoherentSum = DENORMAL_NOISE_AMPLITUDE *
    MAX_PLUGIN_COUNT * MAX_COHERENT_SITES_PER_PLUGIN;
  assert.ok(maximumCoherentSum <= MAX_OUTPUT_NOISE);
  assert.ok(20 * Math.log10(maximumCoherentSum) <= -306);
  assert.ok(Math.fround(DENORMAL_NOISE_AMPLITUDE) >= 1.1754943508222875e-38);

  const whole = new Float32Array(2 * 256);
  addDenormalNoise(whole, 2, 256, 0);

  const split = new Float32Array(2 * 256);
  for (let channelIndex = 0; channelIndex < 2; channelIndex++) {
    const first = new Float32Array(127);
    const second = new Float32Array(129);
    addDenormalNoise(first, 1, 127, 0);
    addDenormalNoise(second, 1, 129, 127);
    channel(split, channelIndex, 256).set(first);
    channel(split, channelIndex, 256).set(second, first.length);
  }
  assert.deepEqual(split, whole);

  for (let channelIndex = 0; channelIndex < 2; channelIndex++) {
    const samples = channel(whole, channelIndex, 256);
    assert.equal(samples.reduce((sum, value) => sum + value, 0), 0);
    assert.ok(samples.every(value => Math.abs(value) <= MAX_OUTPUT_NOISE));
  }
  assert.equal(whole[0], Math.fround(DENORMAL_NOISE_AMPLITUDE));
  assert.equal(whole[1], Math.fround(-DENORMAL_NOISE_AMPLITUDE));

  const coherentSourceCount = MAX_PLUGIN_COUNT * MAX_COHERENT_SITES_PER_PLUGIN;
  const combinedWhole = new Float32Array(256);
  for (let source = 0; source < coherentSourceCount; source++) {
    addDenormalNoise(combinedWhole, 1, 256, 0);
  }
  const combinedSplit = new Float32Array(256);
  for (let source = 0; source < coherentSourceCount; source++) {
    addDenormalNoise(combinedSplit.subarray(0, 127), 1, 127, 0);
    addDenormalNoise(combinedSplit.subarray(127), 1, 129, 127);
  }
  assert.deepEqual(combinedSplit, combinedWhole);
  assert.ok(combinedWhole.every(value => Math.abs(value) <= MAX_OUTPUT_NOISE));
  assert.equal(combinedWhole.reduce((sum, value) => sum + value, 0), 0);

  const normal = new Float32Array(2 * BLOCK_SIZE).fill(0.125);
  const original = Float32Array.from(normal);
  addDenormalNoise(normal, 2, BLOCK_SIZE, 0);
  assert.deepEqual(normal, original);
});

test('power detector noise cannot wake monitoring and prevents a subnormal silent decay', () => {
  const processor = loadWorkletProcessor();
  const power = processor.powerPolicy;
  const channels = [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
  const result = new Float64Array(3);
  channels[0][0] = 0.25;
  channels[1][0] = -0.25;
  processor._measurePowerWithDcBlock(
    channels,
    power.inputDcX,
    power.inputDcY,
    BLOCK_SIZE,
    0,
    result
  );
  assert.ok(result[1] > power.wakeFloorPower);

  channels[0].fill(0);
  channels[1].fill(0);
  const blocks = Math.ceil(60 * SAMPLE_RATE / BLOCK_SIZE);
  for (let block = 1; block <= blocks; block++) {
    processor._measurePowerWithDcBlock(
      channels,
      power.inputDcX,
      power.inputDcY,
      BLOCK_SIZE,
      (block - 1) * BLOCK_SIZE,
      result
    );
    processor.currentFrame = block * BLOCK_SIZE;
    processor._finishPowerRender(result[0], result[0], BLOCK_SIZE);
  }

  assert.equal(result[1], 0, 'internal noise must not affect wakeOnAnyInput raw peak');
  assert.ok(power.inputPowerEwma > 1e-40);
  assert.ok(power.inputPowerEwma < power.silenceThresholdPower);
  assert.ok([...power.inputDcY.subarray(0, 2)]
    .every(value => Number.isFinite(value) && Math.abs(value) > 1e-40));
  assert.equal(power.lastReportedInputActive, false);
  assert.equal(power.lastReportedOutputActive, false);
});

test('dynamic saturation reaches exact zero after an excited cone tail decays', () => {
  const process = loadDynamicSaturationProcessor();
  const parameters = {
    enabled: true,
    sd: 1,
    ss: 0.1,
    sp: 0.2,
    sm: 1,
    dd: 1.5,
    db: 0,
    dm: 100,
    cm: 100,
    og: 0,
    channelCount: 1,
    blockSize: BLOCK_SIZE,
    sampleRate: SAMPLE_RATE
  };

  const idleContext = {};
  const idle = new Float32Array(BLOCK_SIZE);
  process(idle, parameters, idleContext);
  assert.ok(idle.every(sample => sample === 0));
  assert.equal(idleContext.xpos[0], 0);
  assert.equal(idleContext.vel[0], 0);

  const coneContext = {};
  const excitation = new Float32Array(BLOCK_SIZE);
  excitation[0] = 1;
  process(excitation, parameters, coneContext);
  assert.notEqual(coneContext.xpos[0], 0);
  assert.notEqual(coneContext.vel[0], 0);

  for (let block = 1; block < 7; block++) {
    process(new Float32Array(BLOCK_SIZE), parameters, coneContext);
  }
  assert.equal(coneContext.xpos[0], 0);
  assert.equal(coneContext.vel[0], 0);

  const settled = new Float32Array(BLOCK_SIZE);
  process(settled, parameters, coneContext);
  assert.ok(settled.every(sample => sample === 0));
  assert.equal(coneContext.xpos[0], 0);
  assert.equal(coneContext.vel[0], 0);
});
