import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';

const SAMPLE_RATE = 192000;
const CHANNEL_COUNT = 8;
const FRAME_COUNT = 128;
const MAX_PITCH_SHIFTER_ATTEMPTS = 64;

function capOomFixtureMemory(source) {
  const bytes = Uint8Array.from(source);
  assert.deepEqual([...bytes.subarray(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0]);
  let offset = 8;
  const readU32 = (end = bytes.length) => {
    let value = 0;
    for (let index = 0; index < 5; index++) {
      assert.ok(offset < end, 'truncated unsigned LEB128 value');
      const byte = bytes[offset++];
      assert.ok(index < 4 || byte <= 15, 'unsupported unsigned LEB128 value');
      value += (byte & 127) * 2 ** (index * 7);
      if ((byte & 128) === 0) return value;
    }
    assert.fail('unterminated unsigned LEB128 value');
  };
  while (offset < bytes.length) {
    const section = bytes[offset++];
    const size = readU32();
    const end = offset + size;
    assert.ok(end <= bytes.length, 'truncated WebAssembly section');
    if (section === 5) {
      assert.equal(readU32(end), 1, 'expected one defined memory');
      assert.equal(readU32(end), 1, 'expected unshared 32-bit memory with a maximum');
      const initial = readU32(end);
      const maximumOffset = offset;
      const maximum = readU32(end);
      assert.equal(offset, end, 'unexpected memory section contents');
      const maximumPages = 4096; // Retain the original 256 MiB OOM fixture budget.
      assert.ok(initial <= maximumPages && maximum >= maximumPages);
      let remaining = maximumPages;
      // Keep the original LEB width so no section sizes or other bytes change.
      for (let index = maximumOffset; index < end; index++) {
        bytes[index] = (remaining & 127) | (index + 1 < end ? 128 : 0);
        remaining = Math.floor(remaining / 128);
      }
      assert.equal(remaining, 0, 'memory maximum does not fit its encoded width');
      return bytes;
    }
    offset = end;
  }
  assert.fail('WebAssembly binary has no defined memory');
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`instance allocation failure is transactional in ${artifact}`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(capOomFixtureMemory(bytes));
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

      // Leave enough memory for exception handling, but not a delay-line buffer.
      const reservations = [];
      try {
        for (const size of [1024 * 1024, 64 * 1024]) {
          for (;;) {
            const pointer = binding.exports.malloc(size) >>> 0;
            if (pointer === 0) break;
            reservations.push(pointer);
          }
        }
        assert.equal(
          binding.createInstance('TimeAlignmentPlugin'),
          0,
          'delay-line preparation failure must reject the instance'
        );
      } finally {
        for (const pointer of reservations) binding.exports.free(pointer);
      }
      const timeAlignment = binding.createInstance('TimeAlignmentPlugin');
      assert.notEqual(timeAlignment, 0, 'delay-line preparation must recover after memory is freed');
      binding.destroyInstance(timeAlignment);
    } finally {
      binding.close();
    }
  });
}
