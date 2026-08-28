import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { encodeDspPipelineDescriptor } from '../../js/audio/dsp-pipeline-descriptor.js';
import { buildIrAssetPayload, IR_ASSET_TOPOLOGY } from '../../js/ir-library/ir-asset-payload.js';
import { estimateIrKernelCommitFootprint } from '../../js/ir-library/ir-plugin-contract.js';
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
      assert.equal(panelPacker.hash, 0x9d3d18b9);
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

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`${artifact} routes the last single/pair, hex Matrix paths, and 16 IR channels`, async () => {
    const binding = await instantiateDsp(fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url)));
    try {
      assert.ok(binding.createEngine());
      assert.equal(binding.prepare(96000, 16, BLOCK_SIZE, 0), 0);
      const arena = binding.getArenaViews();
      const volume = binding.createInstance('VolumePlugin');
      const volumePacker = DSP_PARAM_PACKERS.get('VolumePlugin');
      assert.equal(binding.instanceSetParams(volume, volumePacker.pack({ vl: -6 }), volumePacker.hash), 0);
      for (const channelSpec of [15, 23]) {
        assert.equal(binding.pipelineConfigure(encodeDspPipelineDescriptor([{
          instanceId: volume, enabled: true, inputBus: 0, outputBus: 0, channelSpec, sectionGate: true
        }])), 0);
        arena.buses.get(0).fill(1);
        assert.equal(binding.pipelineProcess(16, BLOCK_SIZE, 0), 0);
        assert.equal(arena.buses.get(0)[13 * BLOCK_SIZE], 1);
        assert.ok(Math.abs(arena.buses.get(0)[15 * BLOCK_SIZE] - 10 ** (-6 / 20)) < 1e-6);
        assert.ok(Math.abs(arena.buses.get(0)[14 * BLOCK_SIZE] - (channelSpec === 23 ? 10 ** (-6 / 20) : 1)) < 1e-6);
      }
      const matrix = binding.createInstance('MatrixPlugin');
      const matrixPacker = DSP_PARAM_PACKERS.get('MatrixPlugin');
      assert.equal(binding.instanceSetParams(matrix, matrixPacker.pack(), matrixPacker.hash), 0);
      assert.equal(binding.instanceSetParamBytes(matrix, matrixPacker.packBytes({ mx: 'efpfe' }), matrixPacker.hash), 0);
      arena.combined.fill(0);
      arena.combined.fill(0.25, 14 * BLOCK_SIZE, 15 * BLOCK_SIZE);
      arena.combined.fill(0.5, 15 * BLOCK_SIZE, 16 * BLOCK_SIZE);
      assert.equal(binding.instanceProcess(matrix, arena.offsets.combined, 16, BLOCK_SIZE, 0), 0);
      assert.equal(arena.combined[14 * BLOCK_SIZE], -0.5);
      assert.equal(arena.combined[15 * BLOCK_SIZE], 0.25);

      const reverb = binding.createInstance('IRReverbPlugin');
      const packer = DSP_PARAM_PACKERS.get('IRReverbPlugin');
      assert.equal(binding.instanceSetParams(reverb, packer.pack({ cm: 'multi', lt: '0', cr: 'full', dw: 0, dl: -96, pd: 0 }), packer.hash), 0);
      const channels = Array.from({ length: 16 }, (_, channel) => {
        const taps = new Float32Array(BLOCK_SIZE);
        taps[0] = (channel + 1) / 16;
        return taps;
      });
      const topology = IR_ASSET_TOPOLOGY.matrix;
      const paths = channels.map((_, channel) => ({ inputSlot: channel, outputSlot: channel, irChannel: channel }));
      const payload = buildIrAssetPayload({ channels, sampleRate: 96000, topology, paths });
      const asset = { channels: 16, frames: BLOCK_SIZE, topology, headBlock: 0, rateDivider: 1,
        pathCount: 16, inputCount: 16, processingChannels: 16,
        footprintBytes: estimateIrKernelCommitFootprint({ frames: BLOCK_SIZE, assetChannels: 16, topology, processingChannels: 16, headBlock: 0, pathCount: 16, inputCount: 16 }) };
      assert.equal(binding.instanceAssetBegin(reverb, 0, { ...asset, channels: 17, byteSize: payload.byteLength }), 0);
      assert.equal(binding.instanceSetAsset(reverb, 0, payload, asset, 1), 0);
      for (let block = 0; block < 128 && (binding.instanceAssetState(reverb, 0) & 0xff) === 2; block++) {
        arena.combined.fill(0);
        assert.equal(binding.instanceProcess(reverb, arena.offsets.combined, 16, BLOCK_SIZE, 0), 0);
      }
      assert.equal(binding.instanceAssetState(reverb, 0) & 0xff, 3);
      assert.equal(binding.resetInstance(reverb), 0);
      arena.combined.fill(0.25);
      assert.equal(binding.instanceProcess(reverb, arena.offsets.combined, 16, BLOCK_SIZE, 0), 0);
      for (let channel = 0; channel < 16; channel++) {
        assert.ok(Math.abs(arena.combined[channel * BLOCK_SIZE + 64] - 0.25 * (channel + 1) / 16) < 1e-5);
      }
      assert.notEqual(binding.prepare(96000, 17, BLOCK_SIZE, 0), 0);
    } finally {
      binding.close();
    }
  });
}
