import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';

const LEFT = [-1, -0.5, 0, 0.5, 1, 0.75, 0.25, -0.25];
const RIGHT = [1, 0.5, 0, -0.5, -1, 0.25, 0.75, -0.75];

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`Oscilloscope telemetry from ${artifact} contains a v1 raw snapshot`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(8000, 2, 128, 32768), 0);
      const instanceId = binding.createInstance('OscilloscopePlugin');
      assert.notEqual(instanceId, 0);
      assert.equal(binding.instanceSetTap(instanceId, 77), 0);

      const packer = DSP_PARAM_PACKERS.get('OscilloscopePlugin');
      assert.ok(packer);
      assert.equal(binding.instanceSetParams(instanceId, packer.pack({
        dt: 0.001,
        tm: 'Normal',
        tl: 1,
        te: 'Rising',
        ho: 0.0001,
        dl: 0,
        vo: 0
      }), packer.hash), 0);

      const arena = binding.getArenaViews();
      let telemetryBytes = 0;
      const packet = new ArrayBuffer(32768);
      for (let block = 0; block < 8 && telemetryBytes === 0; block++) {
        arena.combined.fill(0, 0, 256);
        if (block === 0) {
          for (let frame = 0; frame < LEFT.length; frame++) {
            arena.combined[frame] = LEFT[frame];
            arena.combined[128 + frame] = RIGHT[frame];
          }
        }
        assert.equal(binding.instanceProcess(
          instanceId,
          arena.offsets.combined,
          2,
          128,
          block * 128 / 8000
        ), 0);
        telemetryBytes = binding.telemetryRead(packet);
        assert.equal(binding.lastTelemetryDroppedFrames, 0);
      }

      const frames = [];
      const parsed = parseTelemetryPacket(packet, telemetryBytes, frame => frames.push(frame));
      assert.equal(parsed.ok, true);
      assert.equal(frames.length, 1);
      const frame = frames[0];
      assert.equal(frame.frameType, TelemetryFrameType.TAP_SCOPE_SNAPSHOT);
      assert.equal(frame.formatVersion, 1);
      assert.equal(frame.tapId, 77);
      assert.equal(frame.sequence, 0);
      assert.equal(frame.payload.getFloat32(0, true), 8000);
      assert.equal(frame.payload.getUint32(4, true), 0);
      assert.equal(frame.payload.getUint32(8, true), 8);
      assert.equal(frame.payload.getUint8(12), 0);
      assert.equal(frame.payload.getUint8(13), 0);
      assert.equal(frame.payload.getUint16(14, true), 0);
      for (let index = 0; index < LEFT.length; index++) {
        assert.equal(
          frame.payload.getFloat32(16 + index * 4, true),
          (LEFT[index] + RIGHT[index]) * 0.5
        );
      }
    } finally {
      binding.close();
    }
  });
}
