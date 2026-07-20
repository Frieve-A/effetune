import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';

const SAMPLE_RATE = 192000;
const CHANNEL_COUNT = 8;
const FRAME_COUNT = 128;
const MAX_PITCH_SHIFTER_ATTEMPTS = 64;

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`instance allocation failure is transactional in ${artifact}`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(SAMPLE_RATE, CHANNEL_COUNT, FRAME_COUNT, 0), 0);

      const pitchShifters = [];
      let exhaustedInstance;
      assert.doesNotThrow(() => {
        for (let index = 0; index < MAX_PITCH_SHIFTER_ATTEMPTS; index++) {
          const instanceId = binding.createInstance('PitchShifterPlugin');
          if (instanceId === 0) {
            exhaustedInstance = instanceId;
            break;
          }
          pitchShifters.push(instanceId);
        }
      });
      assert.equal(
        exhaustedInstance,
        0,
        `allocation must fail within ${MAX_PITCH_SHIFTER_ATTEMPTS} attempts`
      );
      assert.notEqual(pitchShifters.length, 0, 'at least one Pitch Shifter must fit');

      const volume = binding.createInstance('VolumePlugin');
      assert.notEqual(volume, 0, 'the engine must remain usable after allocation failure');
      binding.destroyInstance(volume);

      binding.destroyInstance(pitchShifters.pop());
      const reusedInstance = binding.createInstance('PitchShifterPlugin');
      assert.notEqual(
        reusedInstance,
        0,
        'destroying an instance must make its allocation reusable'
      );
      binding.destroyInstance(reusedInstance);
    } finally {
      binding.close();
    }
  });
}
