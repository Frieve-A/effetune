import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';
import { DENORMAL_NOISE_AMPLITUDE } from '../../dsp/bindings/js/src/denormal-noise.js';

const DENORMAL_NOISE_OUTPUT_LIMIT = 10 ** (-288 / 20);

function near(actual, expected, tolerance = 1e-6) {
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
  test(`Spectrogram telemetry from ${artifact} honors v1 columns and hop cadence`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(32000, 2, 128, 256 * 1024), 0);
      assert.equal(binding.setTelemetryRate(60), 0);
      const instanceId = binding.createInstance('SpectrogramPlugin');
      assert.notEqual(instanceId, 0);
      assert.equal(binding.instanceSetTap(instanceId, 78), 0);

      const packer = DSP_PARAM_PACKERS.get('SpectrogramPlugin');
      assert.ok(packer);
      assert.equal(packer.hash, 0xc99dcc20);
      assert.equal(binding.instanceSetParams(
        instanceId,
        packer.pack({ dr: -96, pt: 8 }),
        packer.hash
      ), 0);

      const arena = binding.getArenaViews();
      const packet = new ArrayBuffer(256 * 1024);
      let processed = 0;
      for (let block = 0; block < 5; block++) {
        for (let frame = 0; frame < 128; frame++) {
          const sample = Math.sin(2 * Math.PI * 1000 * (processed + frame) / 32000);
          arena.combined[frame] = sample;
          arena.combined[128 + frame] = sample;
        }
        const expectedFirst = arena.combined[0];
        assert.equal(binding.instanceProcess(
          instanceId,
          arena.offsets.combined,
          2,
          128,
          processed / 32000
        ), 0);
        const expectedAudible = Math.abs(expectedFirst) <= DENORMAL_NOISE_OUTPUT_LIMIT
          ? 0
          : expectedFirst;
        assert.ok(
          Math.abs(arena.combined[0] - expectedAudible) <= DENORMAL_NOISE_AMPLITUDE,
          'passthrough may canonicalize the noise floor and add only the denormal carrier'
        );
        processed += 128;
      }

      let frames = readFrames(binding, packet);
      // The first staged column completes one hop after its trigger, so four columns are ready at
      // the first 60 Hz telemetry tick.
      assert.equal(frames.length, 4);
      for (let index = 0; index < frames.length; index++) {
        const frame = frames[index];
        assert.equal(frame.frameType, TelemetryFrameType.TAP_SPECTROGRAM_COL);
        assert.equal(frame.formatVersion, 1);
        assert.equal(frame.tapId, 78);
        assert.equal(frame.sequence, index);
        assert.equal(frame.payloadBytes, 268);
        assert.equal(frame.payload.getFloat32(0, true), 32000);
        assert.ok(near(frame.payload.getFloat32(4, true), (index + 1) * 128 / 32000));
        assert.equal(frame.payload.getUint16(8, true), 256);
        assert.equal(frame.payload.getUint16(10, true), 8);
      }
      assert.equal(frames[1].payload.getUint8(12), 0);
      assert.ok(frames[1].payload.getUint8(12 + 123) >= 250);
      assert.ok(frames[1].payload.getUint8(12 + 124) >= 250);

      assert.equal(binding.instanceSetParams(
        instanceId,
        packer.pack({ dr: -144, pt: 14 }),
        packer.hash
      ), 0);
      for (let block = 0; block < 133; block++) {
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
      const frame = frames[0];
      assert.equal(frame.frameType, TelemetryFrameType.TAP_SPECTROGRAM_COL);
      assert.equal(frame.formatVersion, 1);
      assert.equal(frame.tapId, 78);
      assert.equal(frame.payloadBytes, 268);
      assert.equal(frame.payload.getFloat32(0, true), 32000);
      assert.equal(frame.payload.getUint16(8, true), 256);
      assert.equal(frame.payload.getUint16(10, true), 14);
      for (let row = 0; row < 256; row++) {
        assert.equal(frame.payload.getUint8(12 + row), 0);
      }
    } finally {
      binding.close();
    }
  });
}
