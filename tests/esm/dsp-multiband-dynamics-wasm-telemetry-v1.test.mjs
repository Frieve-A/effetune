import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;
const TELEMETRY_BYTES = 32768;

function readSingleFrame(binding, packet, expectedBytes) {
  const bytes = binding.telemetryRead(packet);
  assert.equal(bytes, expectedBytes);
  assert.equal(binding.lastTelemetryDroppedFrames, 0);
  const frames = [];
  const parsed = parseTelemetryPacket(packet, bytes, frame => frames.push(frame));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.bytesRead, bytes);
  assert.equal(frames.length, 1);
  return frames[0];
}

function checkFrame(frame, { tapId, sequence, bandCount, kind }) {
  assert.equal(frame.frameType, TelemetryFrameType.TAP_MULTIBAND_DYNAMICS);
  assert.equal(frame.formatVersion, 1);
  assert.equal(frame.tapId, tapId);
  assert.equal(frame.sequence, sequence);
  assert.equal(frame.payloadBytes, 4 + bandCount * 4);
  assert.equal(frame.flags, 0);
  assert.equal(frame.payload.getUint8(0), bandCount);
  assert.equal(frame.payload.getUint8(1), kind);
  assert.equal(frame.payload.getUint8(2), 0);
  assert.equal(frame.payload.getUint8(3), 0);
  const values = [];
  for (let band = 0; band < bandCount; band++) {
    const value = frame.payload.getFloat32(4 + band * 4, true);
    assert.equal(Number.isFinite(value), true);
    if (kind !== 2) assert.equal(value >= 0, true);
    values.push(value);
  }
  return values;
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`Multiband dynamics telemetry from ${artifact} honors v1 payloads and reset`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(SAMPLE_RATE, 2, BLOCK_SIZE, TELEMETRY_BYTES), 0);
      const arena = binding.getArenaViews();
      const packet = new ArrayBuffer(TELEMETRY_BYTES);
      let processedFrames = 0;
      const processBlocks = (instanceId, blocks = 7) => {
        for (let block = 0; block < blocks; block++) {
          arena.combined.fill(0.75, 0, BLOCK_SIZE);
          arena.combined.fill(-0.5, BLOCK_SIZE, BLOCK_SIZE * 2);
          assert.equal(binding.instanceProcess(
            instanceId,
            arena.offsets.combined,
            2,
            BLOCK_SIZE,
            processedFrames / SAMPLE_RATE
          ), 0);
          processedFrames += BLOCK_SIZE;
        }
      };

      const compressor = binding.createInstance('MultibandCompressorPlugin');
      assert.notEqual(compressor, 0);
      assert.equal(binding.instanceSetTap(compressor, 1300), 0);
      const compressorPacker = DSP_PARAM_PACKERS.get('MultibandCompressorPlugin');
      assert.equal(binding.instanceSetParams(
        compressor,
        compressorPacker.pack(),
        compressorPacker.hash
      ), 0);
      processBlocks(compressor);
      let frame = readSingleFrame(binding, packet, 40);
      checkFrame(frame, { tapId: 1300, sequence: 0, bandCount: 5, kind: 0 });
      processBlocks(compressor);
      frame = readSingleFrame(binding, packet, 40);
      checkFrame(frame, { tapId: 1300, sequence: 1, bandCount: 5, kind: 0 });
      assert.equal(binding.resetInstance(compressor), 0);
      assert.equal(binding.telemetryRead(packet), 0);
      processBlocks(compressor);
      frame = readSingleFrame(binding, packet, 40);
      checkFrame(frame, { tapId: 1300, sequence: 0, bandCount: 5, kind: 0 });

      const expander = binding.createInstance('MultibandExpanderPlugin');
      assert.notEqual(expander, 0);
      assert.equal(binding.instanceSetTap(expander, 1301), 0);
      const expanderPacker = DSP_PARAM_PACKERS.get('MultibandExpanderPlugin');
      assert.equal(binding.instanceSetParams(
        expander,
        expanderPacker.pack(),
        expanderPacker.hash
      ), 0);
      processBlocks(expander);
      frame = readSingleFrame(binding, packet, 40);
      checkFrame(frame, { tapId: 1301, sequence: 0, bandCount: 5, kind: 1 });

      const transient = binding.createInstance('MultibandTransientPlugin');
      assert.notEqual(transient, 0);
      assert.equal(binding.instanceSetTap(transient, 1302), 0);
      const transientPacker = DSP_PARAM_PACKERS.get('MultibandTransientPlugin');
      assert.equal(binding.instanceSetParams(
        transient,
        transientPacker.pack(),
        transientPacker.hash
      ), 0);
      processBlocks(transient);
      frame = readSingleFrame(binding, packet, 32);
      checkFrame(frame, { tapId: 1302, sequence: 0, bandCount: 3, kind: 2 });
    } finally {
      binding.close();
    }
  });
}
