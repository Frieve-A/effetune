import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;
const TELEMETRY_BYTES = 32768;

function readSingleFrame(binding, packet) {
  const bytes = binding.telemetryRead(packet);
  assert.equal(bytes, 40);
  assert.equal(binding.lastTelemetryDroppedFrames, 0);
  const frames = [];
  const parsed = parseTelemetryPacket(packet, bytes, frame => frames.push(frame));
  assert.equal(parsed.ok, true);
  assert.equal(frames.length, 1);
  return frames[0];
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`FiveBandDynamicEQ telemetry from ${artifact} honors v1 payload and reset`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(SAMPLE_RATE, 2, BLOCK_SIZE, TELEMETRY_BYTES), 0);
      const arena = binding.getArenaViews();
      const packet = new ArrayBuffer(TELEMETRY_BYTES);
      const instance = binding.createInstance('FiveBandDynamicEQ');
      assert.notEqual(instance, 0);
      assert.equal(binding.instanceSetTap(instance, 1414), 0);
      const packer = DSP_PARAM_PACKERS.get('FiveBandDynamicEQ');
      assert.equal(packer.hash, 0xb02487c7);
      assert.equal(packer.floatCount, 60);
      assert.equal(binding.instanceSetParams(instance, packer.pack(), packer.hash), 0);

      let processedFrames = 0;
      const processBlocks = (blocks = 7) => {
        for (let block = 0; block < blocks; block++) {
          for (let channel = 0; channel < 2; channel++) {
            const offset = channel * BLOCK_SIZE;
            for (let frame = 0; frame < BLOCK_SIZE; frame++) {
              const phase = 2 * Math.PI * 1000 * (processedFrames + frame) / SAMPLE_RATE;
              arena.combined[offset + frame] = 0.5 * Math.sin(phase + channel * 0.17);
            }
          }
          assert.equal(binding.instanceProcess(
            instance,
            arena.offsets.combined,
            2,
            BLOCK_SIZE,
            processedFrames / SAMPLE_RATE
          ), 0);
          processedFrames += BLOCK_SIZE;
        }
      };

      processBlocks();
      let frame = readSingleFrame(binding, packet);
      assert.equal(frame.frameType, TelemetryFrameType.TAP_FIVE_BAND_DYNAMIC_EQ);
      assert.equal(frame.formatVersion, 1);
      assert.equal(frame.tapId, 1414);
      assert.equal(frame.sequence, 0);
      assert.equal(frame.flags, 0);
      assert.equal(frame.payloadBytes, 24);
      assert.equal(frame.payload.getUint8(0), 5);
      assert.equal(frame.payload.getUint8(1), 0);
      assert.equal(frame.payload.getUint16(2, true), 0);
      const gains = Array.from({ length: 5 }, (_, band) =>
        frame.payload.getFloat32(4 + band * 4, true));
      assert.ok(gains.every(gain => Number.isFinite(gain) && gain >= -24 && gain <= 24));
      assert.equal(gains[0], 0);
      assert.equal(gains[1], 0);
      assert.ok(gains[2] < 0);
      assert.equal(gains[3], 0);
      assert.equal(gains[4], 0);

      assert.equal(binding.resetInstance(instance), 0);
      assert.equal(binding.telemetryRead(packet), 0);
      processBlocks();
      frame = readSingleFrame(binding, packet);
      assert.equal(frame.sequence, 0);
    } finally {
      binding.close();
    }
  });
}
