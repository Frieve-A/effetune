import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';

const SAMPLE_RATE = 192000;
const CHANNEL_COUNT = 8;
const FRAME_COUNT = 128;

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`instance allocation failure is transactional in ${artifact}`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(SAMPLE_RATE, CHANNEL_COUNT, FRAME_COUNT, 0), 0);

      const pitchShifters = [];
      for (let index = 0; index < 4; index++) {
        const instanceId = binding.createInstance('PitchShifterPlugin');
        assert.notEqual(instanceId, 0, `Pitch Shifter ${index + 1} must fit`);
        pitchShifters.push(instanceId);
      }

      let exhaustedInstance;
      assert.doesNotThrow(() => {
        exhaustedInstance = binding.createInstance('PitchShifterPlugin');
      });
      assert.equal(exhaustedInstance, 0);

      const volume = binding.createInstance('VolumePlugin');
      assert.notEqual(volume, 0, 'the engine must remain usable after allocation failure');
      binding.destroyInstance(volume);

      binding.destroyInstance(pitchShifters.pop());
      assert.notEqual(binding.createInstance('PitchShifterPlugin'), 0,
        'destroying an instance must make its allocation reusable');
    } finally {
      binding.close();
    }
  });
}
