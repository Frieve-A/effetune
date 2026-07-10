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

function checkOuterFrame(frame, { frameType, tapId, sequence, payloadBytes }) {
  assert.equal(frame.frameType, frameType);
  assert.equal(frame.formatVersion, 1);
  assert.equal(frame.tapId, tapId);
  assert.equal(frame.sequence, sequence);
  assert.equal(frame.payloadBytes, payloadBytes);
  assert.equal(frame.flags, 0);
  assert.equal(frame.payload.byteLength, payloadBytes);
  assert.equal((16 + payloadBytes + 3) & ~3, 16 + payloadBytes);
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`Basics topology telemetry from ${artifact} honors v1 payloads and reset`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(SAMPLE_RATE, 4, BLOCK_SIZE, TELEMETRY_BYTES), 0);
      const arena = binding.getArenaViews();
      const packet = new ArrayBuffer(TELEMETRY_BYTES);
      let processedFrames = 0;
      const processBlocks = (instanceId, amplitudes, blocks = 7) => {
        for (let block = 0; block < blocks; block++) {
          for (let channel = 0; channel < amplitudes.length; channel++) {
            const start = channel * BLOCK_SIZE;
            arena.combined.fill(amplitudes[channel], start, start + BLOCK_SIZE);
          }
          assert.equal(binding.instanceProcess(
            instanceId,
            arena.offsets.combined,
            amplitudes.length,
            BLOCK_SIZE,
            processedFrames / SAMPLE_RATE
          ), 0);
          processedFrames += BLOCK_SIZE;
        }
      };

      const matrix = binding.createInstance('MatrixPlugin');
      assert.notEqual(matrix, 0);
      assert.equal(binding.instanceSetTap(matrix, 909), 0);
      const matrixPacker = DSP_PARAM_PACKERS.get('MatrixPlugin');
      assert.equal(matrixPacker.hash, 0x07080f45);
      assert.equal(matrixPacker.byteCapacity, 3076);
      assert.equal(binding.instanceSetParams(matrix, matrixPacker.pack(), matrixPacker.hash), 0);
      assert.equal(binding.instanceSetParamBytes(
        matrix,
        matrixPacker.packBytes({ mx: '00112233' }),
        matrixPacker.hash
      ), 0);

      processBlocks(matrix, [0.1, 0.2, 0.3, 0.4]);
      let frame = readSingleFrame(binding, packet, 20);
      checkOuterFrame(frame, {
        frameType: TelemetryFrameType.TAP_CHANNEL_COUNT,
        tapId: 909,
        sequence: 0,
        payloadBytes: 4
      });
      assert.equal(frame.payload.getUint32(0, true), 4);

      processBlocks(matrix, [0.4, 0.3, 0.2, 0.1]);
      frame = readSingleFrame(binding, packet, 20);
      checkOuterFrame(frame, {
        frameType: TelemetryFrameType.TAP_CHANNEL_COUNT,
        tapId: 909,
        sequence: 1,
        payloadBytes: 4
      });
      assert.equal(frame.payload.getUint32(0, true), 4);

      assert.equal(binding.resetInstance(matrix), 0);
      assert.equal(binding.telemetryRead(packet), 0);
      processBlocks(matrix, [0.1, 0.2, 0.3, 0.4]);
      frame = readSingleFrame(binding, packet, 20);
      checkOuterFrame(frame, {
        frameType: TelemetryFrameType.TAP_CHANNEL_COUNT,
        tapId: 909,
        sequence: 0,
        payloadBytes: 4
      });
      assert.equal(frame.payload.getUint32(0, true), 4);

      const panel = binding.createInstance('MultiChannelPanelPlugin');
      assert.notEqual(panel, 0);
      assert.equal(binding.instanceSetTap(panel, 1010), 0);
      const panelPacker = DSP_PARAM_PACKERS.get('MultiChannelPanelPlugin');
      assert.equal(panelPacker.hash, 0xf9d33420);
      assert.equal(binding.instanceSetParams(panel, panelPacker.pack({
        m: [false, true],
        s: [false, false],
        v: [0, 0],
        d: [0, 0],
        l: [false, false]
      }), panelPacker.hash), 0);

      processBlocks(panel, [0.25, -0.75]);
      frame = readSingleFrame(binding, packet, 36);
      checkOuterFrame(frame, {
        frameType: TelemetryFrameType.TAP_MULTI_CHANNEL_LEVELS,
        tapId: 1010,
        sequence: 0,
        payloadBytes: 20
      });
      assert.equal(frame.payload.getUint8(0), 2);
      assert.deepEqual(
        [frame.payload.getUint8(1), frame.payload.getUint8(2), frame.payload.getUint8(3)],
        [0, 0, 0]
      );
      assert.equal(frame.payload.getFloat32(4, true), 0.25);
      assert.equal(frame.payload.getUint8(8), 0);
      assert.deepEqual(
        [frame.payload.getUint8(9), frame.payload.getUint8(10), frame.payload.getUint8(11)],
        [0, 0, 0]
      );
      assert.equal(frame.payload.getFloat32(12, true), 0.75);
      assert.equal(frame.payload.getUint8(16), 1);
      assert.deepEqual(
        [frame.payload.getUint8(17), frame.payload.getUint8(18), frame.payload.getUint8(19)],
        [0, 0, 0]
      );
    } finally {
      binding.close();
    }
  });
}
