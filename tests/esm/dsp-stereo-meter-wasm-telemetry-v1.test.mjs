import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';

const SAMPLE_RATE = 9600;
const BLOCK_SIZE = 160;
const PAYLOAD_BYTES = 1464 + BLOCK_SIZE * 8;
const FRAME_BYTES = (16 + PAYLOAD_BYTES + 3) & ~3;

function near(actual, expected, tolerance = 2e-5) {
  return Math.abs(actual - expected) <= tolerance;
}

function readPacket(binding, packet) {
  const bytes = binding.telemetryRead(packet);
  assert.equal(binding.lastTelemetryDroppedFrames, 0);
  const frames = [];
  const parsed = parseTelemetryPacket(packet, bytes, frame => frames.push(frame));
  assert.equal(parsed.ok, true);
  return { bytes, frames };
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`Stereo Meter telemetry from ${artifact} streams v2 sample deltas at 60 Hz`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(SAMPLE_RATE, 2, BLOCK_SIZE, 256 * 1024), 0);
      const instanceId = binding.createInstance('StereoMeterPlugin');
      assert.notEqual(instanceId, 0);
      assert.equal(binding.instanceSetTap(instanceId, 79), 0);

      const packer = DSP_PARAM_PACKERS.get('StereoMeterPlugin');
      assert.ok(packer);
      assert.equal(packer.hash, 0xb0de3212);
      assert.equal(binding.instanceSetParams(
        instanceId,
        packer.pack({ wt: 0.01 }),
        packer.hash
      ), 0);

      const arena = binding.getArenaViews();
      const packet = new ArrayBuffer(256 * 1024);
      let processed = 0;
      for (let block = 0; block < 2; block++) {
        arena.combined.fill(0.5, 0, BLOCK_SIZE);
        assert.equal(binding.instanceProcess(
          instanceId,
          arena.offsets.combined,
          1,
          BLOCK_SIZE,
          processed / SAMPLE_RATE
        ), 0);
        assert.equal(arena.combined[0], 0.5);
        processed += BLOCK_SIZE;
      }

      let packetResult = readPacket(binding, packet);
      assert.equal(packetResult.bytes, FRAME_BYTES * 2);
      assert.equal(packetResult.frames.length, 2);
      let frame = packetResult.frames[1];
      assert.equal(frame.frameType, TelemetryFrameType.TAP_STEREO_FIELD);
      assert.equal(frame.formatVersion, 2);
      assert.equal(frame.tapId, 79);
      assert.equal(frame.sequence, 1);
      assert.equal(frame.payloadBytes, PAYLOAD_BYTES);
      assert.equal(frame.payload.getFloat32(0, true), SAMPLE_RATE);
      assert.equal(frame.payload.getUint16(4, true), BLOCK_SIZE);
      assert.equal(frame.payload.getUint16(6, true), 0);
      assert.ok(near(frame.payload.getFloat32(8, true), 0));
      assert.ok(near(frame.payload.getFloat32(12, true), 1));
      const envelopeOffset = 8 + BLOCK_SIZE * 8;
      const statisticsOffset = envelopeOffset + 360 * 4;
      assert.ok(frame.payload.getFloat32(envelopeOffset + 270 * 4, true) > 0.9);
      assert.ok(near(frame.payload.getFloat32(statisticsOffset, true), 1));
      assert.ok(near(frame.payload.getFloat32(statisticsOffset + 4, true), 0));
      assert.ok(near(frame.payload.getFloat32(statisticsOffset + 8, true), 0.5));
      assert.ok(near(frame.payload.getFloat32(statisticsOffset + 12, true), 0.5));

      for (let block = 0; block < 2; block++) {
        arena.combined.fill(1, 0, BLOCK_SIZE);
        arena.combined.fill(-1, BLOCK_SIZE, 2 * BLOCK_SIZE);
        assert.equal(binding.instanceProcess(
          instanceId,
          arena.offsets.combined,
          2,
          BLOCK_SIZE,
          processed / SAMPLE_RATE
        ), 0);
        assert.equal(arena.combined[0], 1);
        assert.equal(arena.combined[BLOCK_SIZE], -1);
        processed += BLOCK_SIZE;
      }

      packetResult = readPacket(binding, packet);
      assert.equal(packetResult.bytes, FRAME_BYTES * 2);
      assert.equal(packetResult.frames.length, 2);
      frame = packetResult.frames[1];
      assert.equal(frame.frameType, TelemetryFrameType.TAP_STEREO_FIELD);
      assert.equal(frame.formatVersion, 2);
      assert.equal(frame.sequence, 3);
      assert.equal(frame.payloadBytes, PAYLOAD_BYTES);
      assert.ok(near(frame.payload.getFloat32(8, true), -2));
      assert.ok(near(frame.payload.getFloat32(12, true), 0));
      assert.ok(frame.payload.getFloat32(envelopeOffset + 180 * 4, true) > 1.8);
      assert.ok(near(frame.payload.getFloat32(statisticsOffset, true), -1));
      assert.ok(near(frame.payload.getFloat32(statisticsOffset + 4, true), 0));
      assert.ok(near(frame.payload.getFloat32(statisticsOffset + 8, true), 1));
      assert.ok(near(frame.payload.getFloat32(statisticsOffset + 12, true), 1));
    } finally {
      binding.close();
    }
  });
}
