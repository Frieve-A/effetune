import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { buildDspPipelineDescriptor } from '../../js/audio/dsp-pipeline-descriptor.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { DENORMAL_NOISE_AMPLITUDE } from '../../dsp/bindings/js/src/denormal-noise.js';

const FRAME_COUNT = 128;
const CHANNEL_COUNT = 4;
const FLOAT32_MIN_NORMAL = 1.1754943508222875e-38;

function stageDefaults(binding, type, instanceId) {
  const packer = DSP_PARAM_PACKERS.get(type);
  assert.ok(packer, `missing packer for ${type}`);
  assert.equal(binding.instanceSetParams(instanceId, packer.pack({}), packer.hash), 0);
}

function fillInput(buffer) {
  for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
    for (let frame = 0; frame < FRAME_COUNT; frame++) {
      buffer[channel * FRAME_COUNT + frame] = channel + 1 + frame / FRAME_COUNT;
    }
  }
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`native pipeline routing executes in one ${artifact} call`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(48000, CHANNEL_COUNT, FRAME_COUNT, 256 * 1024), 0);

      const invertAll = binding.createInstance('PolarityInversionPlugin');
      const invertPair = binding.createInstance('PolarityInversionPlugin');
      const muteLeft = binding.createInstance('MutePlugin');
      assert.notEqual(invertAll, 0);
      assert.notEqual(invertPair, 0);
      assert.notEqual(muteLeft, 0);
      stageDefaults(binding, 'PolarityInversionPlugin', invertAll);
      stageDefaults(binding, 'PolarityInversionPlugin', invertPair);
      stageDefaults(binding, 'MutePlugin', muteLeft);

      const descriptor = buildDspPipelineDescriptor([
        { enabled: true, inputBus: 0, outputBus: 1, channel: 'A' },
        { enabled: true, inputBus: 1, outputBus: 0, channel: '34' },
        { enabled: true, inputBus: 0, outputBus: 0, channel: 'L' }
      ], {
        getInstanceId(plugin) {
          if (plugin.outputBus === 1) return invertAll;
          if (plugin.channel === '34') return invertPair;
          return muteLeft;
        }
      });
      assert.equal(binding.pipelineConfigure(descriptor), 0);

      const combined = binding.getArenaViews().combined;
      fillInput(combined);
      const original = Float32Array.from(combined.subarray(0, CHANNEL_COUNT * FRAME_COUNT));
      assert.equal(binding.pipelineProcess(CHANNEL_COUNT, FRAME_COUNT, 0, false), 0);
      for (let frame = 0; frame < FRAME_COUNT; frame++) {
        assert.equal(combined[frame], 0);
        assert.equal(combined[FRAME_COUNT + frame], original[FRAME_COUNT + frame]);
        assert.equal(combined[2 * FRAME_COUNT + frame], 2 * original[2 * FRAME_COUNT + frame]);
        assert.equal(combined[3 * FRAME_COUNT + frame], 2 * original[3 * FRAME_COUNT + frame]);
      }

      fillInput(combined);
      const bypassInput = Float32Array.from(combined.subarray(0, CHANNEL_COUNT * FRAME_COUNT));
      assert.equal(binding.pipelineProcess(CHANNEL_COUNT, FRAME_COUNT, 1, true), 0);
      assert.deepEqual(
        combined.subarray(0, CHANNEL_COUNT * FRAME_COUNT),
        bypassInput
      );
    } finally {
      binding.close();
    }
  });

  test(`per-stage ${artifact} noise preserves Dynamic Saturation silence and Delay tails`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    const sampleRate = 48000;
    const channels = 2;
    const maximumFrames = 129;
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(sampleRate, channels, maximumFrames, 256 * 1024), 0);

      const mute = binding.createInstance('MutePlugin');
      const delay = binding.createInstance('DelayPlugin');
      const dynamicSaturation = binding.createInstance('DynamicSaturationPlugin');
      const volumeA = binding.createInstance('VolumePlugin');
      const volumeB = binding.createInstance('VolumePlugin');
      const volumeC = binding.createInstance('VolumePlugin');
      const volumeD = binding.createInstance('VolumePlugin');
      assert.notEqual(mute, 0);
      assert.notEqual(delay, 0);
      assert.notEqual(dynamicSaturation, 0);
      assert.notEqual(volumeA, 0);
      assert.notEqual(volumeB, 0);
      assert.notEqual(volumeC, 0);
      assert.notEqual(volumeD, 0);
      stageDefaults(binding, 'MutePlugin', mute);
      stageDefaults(binding, 'VolumePlugin', volumeA);
      stageDefaults(binding, 'VolumePlugin', volumeB);
      stageDefaults(binding, 'VolumePlugin', volumeC);
      stageDefaults(binding, 'VolumePlugin', volumeD);
      const delayPacker = DSP_PARAM_PACKERS.get('DelayPlugin');
      assert.ok(delayPacker);
      assert.equal(binding.instanceSetParams(delay, delayPacker.pack({
        pd: 0,
        ds: 1,
        dp: 0,
        hd: 20000,
        ld: 20,
        mx: 100,
        fb: 99,
        pp: 0
      }), delayPacker.hash), 0);
      const dynamicSaturationPacker = DSP_PARAM_PACKERS.get('DynamicSaturationPlugin');
      assert.ok(dynamicSaturationPacker);
      assert.equal(binding.instanceSetParams(
        dynamicSaturation,
        dynamicSaturationPacker.pack({
          sd: 10,
          ss: 10,
          sp: 0.1,
          sm: 0.1,
          dd: 10,
          db: 1,
          dm: 100,
          cm: 100,
          og: 18
        }),
        dynamicSaturationPacker.hash
      ), 0);

      const configure = stages => binding.pipelineConfigure(buildDspPipelineDescriptor(
        stages.map(instanceId => ({
          enabled: true,
          inputBus: 0,
          outputBus: 0,
          channel: 'A',
          instanceId
        })),
        { getInstanceId(plugin) { return plugin.instanceId; } }
      ));

      const combined = binding.getArenaViews().combined;
      const seedFrames = 127;
      assert.equal(configure([volumeA, volumeB]), 0);
      combined.fill(0, 0, channels * seedFrames);
      assert.equal(binding.pipelineProcess(channels, seedFrames, 0, false), 0);
      const rebasedNoise = Math.fround(DENORMAL_NOISE_AMPLITUDE);
      assert.equal(combined[0], rebasedNoise);
      assert.equal(combined[1], -rebasedNoise);
      assert.equal(combined[seedFrames], rebasedNoise);
      assert.equal(combined[seedFrames + 1], -rebasedNoise);

      let frameOrigin = seedFrames;
      assert.equal(configure([volumeA, dynamicSaturation]), 0);
      let maximumDynamicSilenceError = 0;
      for (let frame = 0; frame < 67; frame++) {
        combined.fill(0, 0, channels);
        assert.equal(binding.pipelineProcess(channels, 1, frameOrigin / sampleRate, false), 0);
        const expectedNoise = Math.fround(
          (frameOrigin & 1) === 0 ? DENORMAL_NOISE_AMPLITUDE : -DENORMAL_NOISE_AMPLITUDE
        );
        maximumDynamicSilenceError = Math.max(
          maximumDynamicSilenceError,
          Math.abs(combined[0] - expectedNoise),
          Math.abs(combined[1] - expectedNoise)
        );
        frameOrigin++;
      }
      assert.equal(maximumDynamicSilenceError, 0);

      const volumePacker = DSP_PARAM_PACKERS.get('VolumePlugin');
      assert.ok(volumePacker);
      for (const volume of [volumeA, volumeB, volumeC, volumeD]) {
        assert.equal(binding.instanceSetParams(
          volume,
          volumePacker.pack({ vl: 24 }),
          volumePacker.hash
        ), 0);
      }
      assert.equal(configure([volumeA, volumeB, volumeC, volumeD, dynamicSaturation]), 0);
      maximumDynamicSilenceError = 0;
      for (let frame = 0; frame < 67; frame++) {
        combined.fill(0, 0, channels);
        assert.equal(binding.pipelineProcess(channels, 1, frameOrigin / sampleRate, false), 0);
        const expectedNoise = Math.fround(
          (frameOrigin & 1) === 0 ? DENORMAL_NOISE_AMPLITUDE : -DENORMAL_NOISE_AMPLITUDE
        );
        maximumDynamicSilenceError = Math.max(
          maximumDynamicSilenceError,
          Math.abs(combined[0] - expectedNoise),
          Math.abs(combined[1] - expectedNoise)
        );
        frameOrigin++;
      }
      assert.equal(maximumDynamicSilenceError, 0);

      assert.equal(configure([delay]), 0);
      combined.fill(0, 0, channels * seedFrames);
      combined[0] = 1;
      combined[seedFrames] = 1;
      assert.equal(
        binding.pipelineProcess(channels, seedFrames, frameOrigin / sampleRate, false),
        0
      );
      frameOrigin += seedFrames;

      assert.equal(configure([mute, dynamicSaturation, delay]), 0);
      let subnormalCount = 0;
      const finalFrame = frameOrigin + 10 * sampleRate;
      for (let block = 0; frameOrigin < finalFrame; block++) {
        const requestedFrames = (block & 1) === 0 ? 129 : 127;
        const frameCount = Math.min(requestedFrames, finalFrame - frameOrigin);
        combined.fill(0, 0, channels * frameCount);
        assert.equal(
          binding.pipelineProcess(channels, frameCount, frameOrigin / sampleRate, false),
          0
        );
        for (const value of combined.subarray(0, channels * frameCount)) {
          assert.ok(Number.isFinite(value));
          const magnitude = Math.abs(value);
          if (magnitude > 0 && magnitude < FLOAT32_MIN_NORMAL) subnormalCount++;
        }
        frameOrigin += frameCount;
      }
      assert.equal(subnormalCount, 0);
    } finally {
      binding.close();
    }
  });
}
