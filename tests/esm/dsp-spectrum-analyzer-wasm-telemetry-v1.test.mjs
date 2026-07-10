import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';

function near(actual, expected, tolerance = 3e-3) {
  return Math.abs(actual - expected) <= tolerance;
}

function readFrames(binding, packet) {
  const bytes = binding.telemetryRead(packet);
  assert.equal(binding.lastTelemetryDroppedFrames, 0);
  const frames = [];
  const parsed = parseTelemetryPacket(packet, bytes, frame => frames.push(frame));
  assert.equal(parsed.ok, true);
  return frames;
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`Spectrum Analyzer telemetry from ${artifact} honors v1 bins and max payload`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(32000, 2, 128, 256 * 1024), 0);
      const instanceId = binding.createInstance('SpectrumAnalyzerPlugin');
      assert.notEqual(instanceId, 0);
      assert.equal(binding.instanceSetTap(instanceId, 77), 0);

      const packer = DSP_PARAM_PACKERS.get('SpectrumAnalyzerPlugin');
      assert.ok(packer);
      assert.equal(packer.hash, 0xc99dcc20);
      assert.equal(binding.instanceSetParams(instanceId, packer.pack({ dr: -96, pt: 8 }),
        packer.hash), 0);

      const arena = binding.getArenaViews();
      const packet = new ArrayBuffer(256 * 1024);
      let processed = 0;
      for (let block = 0; block < 5; block++) {
        for (let frame = 0; frame < 128; frame++) {
          const sample = Math.sin(2 * Math.PI * 1000 * (processed + frame) / 32000);
          arena.combined[frame] = sample;
          arena.combined[128 + frame] = sample;
        }
        assert.equal(binding.instanceProcess(
          instanceId,
          arena.offsets.combined,
          2,
          128,
          processed / 32000
        ), 0);
        processed += 128;
      }

      let frames = readFrames(binding, packet);
      assert.equal(frames.length, 1);
      let frame = frames[0];
      assert.equal(frame.frameType, TelemetryFrameType.TAP_SPECTRUM);
      assert.equal(frame.formatVersion, 1);
      assert.equal(frame.tapId, 77);
      assert.equal(frame.payloadBytes, 1044);
      assert.equal(frame.payload.getFloat32(0, true), 32000);
      assert.equal(frame.payload.getUint32(4, true), 129);
      assert.equal(frame.payload.getUint16(8, true), 8);
      assert.equal(frame.payload.getUint16(10, true), 0);
      assert.ok(near(frame.payload.getFloat32(12 + 8 * 4, true), 0));
      assert.ok(near(frame.payload.getFloat32(12 + 129 * 4 + 8 * 4, true), 0));

      assert.equal(binding.instanceSetParams(instanceId, packer.pack({ dr: -144, pt: 14 }),
        packer.hash), 0);
      for (let block = 0; block < 66; block++) {
        arena.combined.fill(0, 0, 256);
        assert.equal(binding.instanceProcess(
          instanceId,
          arena.offsets.combined,
          2,
          128,
          processed / 32000
        ), 0);
        processed += 128;
      }

      frames = readFrames(binding, packet);
      assert.equal(frames.length, 1);
      frame = frames[0];
      assert.equal(frame.frameType, TelemetryFrameType.TAP_SPECTRUM);
      assert.equal(frame.formatVersion, 1);
      assert.equal(frame.tapId, 77);
      assert.equal(frame.payloadBytes, 65532);
      assert.equal(frame.payload.getFloat32(0, true), 32000);
      assert.equal(frame.payload.getUint32(4, true), 8190);
      assert.equal(frame.payload.getUint16(8, true), 14);
      assert.equal(frame.payload.getUint16(10, true), 1);
      assert.ok(Number.isFinite(frame.payload.getFloat32(12 + 8189 * 4, true)));
      assert.ok(Number.isFinite(
        frame.payload.getFloat32(12 + 8190 * 4 + 8189 * 4, true)
      ));
    } finally {
      binding.close();
    }
  });
}
