import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { buildDspPipelineDescriptor } from '../../js/audio/dsp-pipeline-descriptor.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';

const FRAME_COUNT = 128;
const CHANNEL_COUNT = 4;

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
}
