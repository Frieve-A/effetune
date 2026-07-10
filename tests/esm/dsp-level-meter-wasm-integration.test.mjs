import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`LevelMeter telemetry from ${artifact} contains exact v1 measurements`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(48000, 2, 128, 2048), 0);
      const instanceId = binding.createInstance('LevelMeterPlugin');
      assert.notEqual(instanceId, 0);
      assert.equal(binding.instanceSetTap(instanceId, 0x1234), 0);

      const arena = binding.getArenaViews();
      for (let block = 0; block < 7; block++) {
        for (let frame = 0; frame < 128; frame++) {
          arena.combined[frame] = 0.5;
          arena.combined[128 + frame] = -0.25;
        }
        if (block === 0) arena.combined[0] = 1.25;
        assert.equal(binding.instanceProcess(
          instanceId,
          arena.offsets.combined,
          2,
          128,
          block * 128 / 48000
        ), 0);
        assert.equal(arena.combined[0], block === 0 ? 1.25 : 0.5);
        assert.equal(arena.combined[128], -0.25);
      }

      const packet = new ArrayBuffer(2048);
      const packetBytes = binding.telemetryRead(packet);
      assert.equal(binding.lastTelemetryDroppedFrames, 0);
      const frames = [];
      assert.deepEqual(parseTelemetryPacket(packet, packetBytes, frame => frames.push(frame)), {
        ok: true,
        frames: 1,
        bytesRead: 40
      });

      const frame = frames[0];
      assert.equal(frame.frameType, TelemetryFrameType.TAP_LEVEL);
      assert.equal(frame.formatVersion, 1);
      assert.equal(frame.tapId, 0x1234);
      assert.equal(frame.sequence, 0);
      assert.equal(frame.payloadBytes, 24);
      assert.equal(frame.payload.getUint32(0, true), 2);
      near(frame.payload.getFloat32(4, true), 1.25);
      near(
        frame.payload.getFloat32(8, true),
        Math.sqrt((1.25 * 1.25 + 895 * 0.5 * 0.5) / 896)
      );
      near(frame.payload.getFloat32(12, true), 0.25);
      near(frame.payload.getFloat32(16, true), 0.25);
      assert.equal(frame.payload.getUint32(20, true), 1);
    } finally {
      binding.close();
    }
  });
}
