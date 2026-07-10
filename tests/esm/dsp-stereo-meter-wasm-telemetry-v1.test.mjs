import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';

const SAMPLE_RATE = 8000;
const BLOCK_SIZE = 80;

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
  test(`Stereo Meter telemetry from ${artifact} honors v1 density and 30 Hz cadence`, async () => {
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
      for (let block = 0; block < 4; block++) {
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
      assert.equal(packetResult.bytes, 5572);
      assert.equal(packetResult.frames.length, 1);
      let frame = packetResult.frames[0];
      assert.equal(frame.frameType, TelemetryFrameType.TAP_STEREO_FIELD);
      assert.equal(frame.formatVersion, 1);
      assert.equal(frame.tapId, 79);
      assert.equal(frame.sequence, 0);
      assert.equal(frame.payloadBytes, 5554);
      assert.equal(frame.payload.getUint16(0, true), 64);
      assert.equal(frame.payload.getUint8(2 + 16 * 64 + 32), 255);
      assert.equal(frame.payload.getUint8(2 + 32 * 64 + 32), 0);
      assert.ok(near(frame.payload.getFloat32(4098 + 270 * 4, true), 0.9772372));
      assert.ok(near(frame.payload.getFloat32(5538, true), 1));
      assert.ok(near(frame.payload.getFloat32(5542, true), 0));
      assert.ok(near(frame.payload.getFloat32(5546, true), 0.5));
      assert.ok(near(frame.payload.getFloat32(5550, true), 0.5));
      let packetBytes = new Uint8Array(packet);
      assert.equal(packetBytes[5570], 0);
      assert.equal(packetBytes[5571], 0);

      for (let block = 0; block < 4; block++) {
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
      assert.equal(packetResult.bytes, 5572);
      assert.equal(packetResult.frames.length, 1);
      frame = packetResult.frames[0];
      assert.equal(frame.frameType, TelemetryFrameType.TAP_STEREO_FIELD);
      assert.equal(frame.formatVersion, 1);
      assert.equal(frame.sequence, 1);
      assert.equal(frame.payloadBytes, 5554);
      assert.equal(frame.payload.getUint8(2 + 32 * 64), 255);
      assert.ok(near(frame.payload.getFloat32(4098 + 180 * 4, true), 1.9544744));
      assert.ok(near(frame.payload.getFloat32(5538, true), -1));
      assert.ok(near(frame.payload.getFloat32(5542, true), 0));
      assert.ok(near(frame.payload.getFloat32(5546, true), 1));
      assert.ok(near(frame.payload.getFloat32(5550, true), 1));
      packetBytes = new Uint8Array(packet);
      assert.equal(packetBytes[5570], 0);
      assert.equal(packetBytes[5571], 0);
    } finally {
      binding.close();
    }
  });
}
