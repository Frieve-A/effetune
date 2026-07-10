import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;
const TELEMETRY_BYTES = 32768;

function readFrames(binding, packet) {
  const bytes = binding.telemetryRead(packet);
  assert.equal(binding.lastTelemetryDroppedFrames, 0);
  const frames = [];
  const parsed = parseTelemetryPacket(packet, bytes, frame => frames.push(frame));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.bytesRead, bytes);
  return frames;
}

function assertGainReductionFrame(frame, { tapId, sequence, positive }) {
  assert.equal(frame.frameType, TelemetryFrameType.TAP_GAIN_REDUCTION);
  assert.equal(frame.formatVersion, 1);
  assert.equal(frame.tapId, tapId);
  assert.equal(frame.sequence, sequence);
  assert.equal(frame.payloadBytes, 4);
  assert.equal(frame.flags, 0);
  assert.equal(frame.payload.byteLength, 4);
  const amountDb = frame.payload.getFloat32(0, true);
  assert.equal(Number.isFinite(amountDb), true);
  assert.equal(amountDb >= 0, true);
  if (positive) assert.equal(amountDb > 0, true);
  else assert.equal(amountDb, 0);
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`Compressor gain-reduction telemetry from ${artifact} honors v1 and reset`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(SAMPLE_RATE, 1, BLOCK_SIZE, TELEMETRY_BYTES), 0);
      const instanceId = binding.createInstance('CompressorPlugin');
      assert.notEqual(instanceId, 0);
      const tapId = 0xabc123;
      assert.equal(binding.instanceSetTap(instanceId, tapId), 0);

      const packer = DSP_PARAM_PACKERS.get('CompressorPlugin');
      assert.ok(packer);
      assert.equal(packer.hash, 0x2d876fa2);
      const activeParams = { th: -60, rt: 20, at: 0.1, rl: 10, kn: 0, gn: 0 };
      assert.equal(binding.instanceSetParams(instanceId, packer.pack(activeParams), packer.hash), 0);

      const arena = binding.getArenaViews();
      const packet = new ArrayBuffer(TELEMETRY_BYTES);
      let processedFrames = 0;
      const processBlock = () => {
        arena.combined.fill(1, 0, BLOCK_SIZE);
        assert.equal(binding.instanceProcess(
          instanceId,
          arena.offsets.combined,
          1,
          BLOCK_SIZE,
          processedFrames / SAMPLE_RATE
        ), 0);
        processedFrames += BLOCK_SIZE;
      };

      for (let block = 0; block < 7; block++) processBlock();
      let frames = readFrames(binding, packet);
      assert.equal(frames.length, 1);
      assertGainReductionFrame(frames[0], { tapId, sequence: 0, positive: true });

      assert.equal(binding.instanceSetParams(
        instanceId,
        packer.pack({ ...activeParams, rt: 1 }),
        packer.hash
      ), 0);
      for (let block = 0; block < 6; block++) processBlock();
      frames = readFrames(binding, packet);
      assert.equal(frames.length, 1);
      assertGainReductionFrame(frames[0], { tapId, sequence: 1, positive: false });

      assert.equal(binding.resetInstance(instanceId), 0);
      assert.deepEqual(readFrames(binding, packet), []);
      assert.equal(binding.instanceSetParams(instanceId, packer.pack(activeParams), packer.hash), 0);
      for (let block = 0; block < 6; block++) processBlock();
      assert.deepEqual(readFrames(binding, packet), []);
      processBlock();
      frames = readFrames(binding, packet);
      assert.equal(frames.length, 1);
      assertGainReductionFrame(frames[0], { tapId, sequence: 0, positive: true });
    } finally {
      binding.close();
    }
  });
}
