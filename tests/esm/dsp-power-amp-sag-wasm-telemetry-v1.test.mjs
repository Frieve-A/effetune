import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;
const TELEMETRY_BYTES = 32768;

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`Power Amp Sag telemetry from ${artifact} honors the v1 frame`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(SAMPLE_RATE, 2, BLOCK_SIZE, TELEMETRY_BYTES), 0);
      const instanceId = binding.createInstance('PowerAmpSagPlugin');
      assert.notEqual(instanceId, 0);
      assert.equal(binding.instanceSetTap(instanceId, 1212), 0);
      const packer = DSP_PARAM_PACKERS.get('PowerAmpSagPlugin');
      assert.equal(packer.hash, 0x2c736e53);
      assert.equal(binding.instanceSetParams(instanceId, packer.pack({
        ss: 3,
        ps: 50,
        rs: 40,
        mb: false
      }), packer.hash), 0);

      const arena = binding.getArenaViews();
      let processedFrames = 0;
      for (let block = 0; block < 7; block++) {
        arena.combined.fill(0.25, 0, BLOCK_SIZE * 2);
        assert.equal(binding.instanceProcess(
          instanceId,
          arena.offsets.combined,
          2,
          BLOCK_SIZE,
          processedFrames / SAMPLE_RATE
        ), 0);
        processedFrames += BLOCK_SIZE;
      }

      const packet = new ArrayBuffer(TELEMETRY_BYTES);
      const telemetryBytes = binding.telemetryRead(packet);
      assert.equal(telemetryBytes, 24);
      assert.equal(binding.lastTelemetryDroppedFrames, 0);
      const frames = [];
      const parsed = parseTelemetryPacket(packet, telemetryBytes, frame => frames.push(frame));
      assert.equal(parsed.ok, true);
      assert.equal(parsed.bytesRead, telemetryBytes);
      assert.equal(frames.length, 1);
      const [frame] = frames;
      assert.equal(frame.frameType, TelemetryFrameType.TAP_POWER_AMP_SAG);
      assert.equal(frame.formatVersion, 1);
      assert.equal(frame.tapId, 1212);
      assert.equal(frame.sequence, 0);
      assert.equal(frame.payloadBytes, 8);
      assert.equal(frame.flags, 0);
      const inputEnvelope = frame.payload.getFloat32(0, true);
      const gainReduction = frame.payload.getFloat32(4, true);
      assert.equal(Number.isFinite(inputEnvelope) && inputEnvelope >= 0, true);
      assert.equal(Number.isFinite(gainReduction) && gainReduction <= 0, true);
    } finally {
      binding.close();
    }
  });
}
