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

function checkOuterFrame(frame, { frameType, tapId, payloadBytes }) {
  assert.equal(frame.frameType, frameType);
  assert.equal(frame.formatVersion, 1);
  assert.equal(frame.tapId, tapId);
  assert.equal(frame.sequence, 0);
  assert.equal(frame.payloadBytes, payloadBytes);
  assert.equal(frame.flags, 0);
  assert.equal(frame.payload.byteLength, payloadBytes);
  assert.equal((16 + payloadBytes + 3) & ~3, 16 + payloadBytes);
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`Dynamics group B telemetry from ${artifact} honors v1 frames and staged latency`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(SAMPLE_RATE, 1, BLOCK_SIZE, TELEMETRY_BYTES), 0);
      const arena = binding.getArenaViews();
      const packet = new ArrayBuffer(TELEMETRY_BYTES);
      let processedFrames = 0;
      const processBlocks = (instanceId, amplitude, blocks = 7) => {
        for (let block = 0; block < blocks; block++) {
          arena.combined.fill(amplitude, 0, BLOCK_SIZE);
          assert.equal(binding.instanceProcess(
            instanceId,
            arena.offsets.combined,
            1,
            BLOCK_SIZE,
            processedFrames / SAMPLE_RATE
          ), 0);
          processedFrames += BLOCK_SIZE;
        }
      };

      const autoLeveler = binding.createInstance('AutoLevelerPlugin');
      assert.notEqual(autoLeveler, 0);
      assert.equal(binding.instanceSetTap(autoLeveler, 707), 0);
      const autoPacker = DSP_PARAM_PACKERS.get('AutoLevelerPlugin');
      assert.equal(autoPacker.hash, 0xe0b1f34d);
      assert.equal(binding.instanceSetParams(autoLeveler, autoPacker.pack({
        tg: -18,
        tw: 1000,
        mg: 12,
        ng: -12,
        at: 50,
        rt: 5000,
        gt: -60
      }), autoPacker.hash), 0);
      processBlocks(autoLeveler, 0.5);
      let frame = readSingleFrame(binding, packet, 24);
      checkOuterFrame(frame, {
        frameType: TelemetryFrameType.TAP_LOUDNESS_LEVELS,
        tapId: 707,
        payloadBytes: 8
      });
      const inputLufs = frame.payload.getFloat32(0, true);
      const outputLufs = frame.payload.getFloat32(4, true);
      assert.equal(Number.isFinite(inputLufs) && inputLufs >= -144, true);
      assert.equal(Number.isFinite(outputLufs) && outputLufs >= -144, true);

      const transient = binding.createInstance('TransientShaperPlugin');
      assert.notEqual(transient, 0);
      assert.equal(binding.instanceSetTap(transient, 808), 0);
      const transientPacker = DSP_PARAM_PACKERS.get('TransientShaperPlugin');
      assert.equal(transientPacker.hash, 0xe2344ceb);
      assert.equal(binding.instanceSetParams(transient, transientPacker.pack({
        fa: 0.1,
        fr: 20,
        sa: 100,
        sr: 300,
        gt: 24,
        gs: 0,
        sm: 0.1
      }), transientPacker.hash), 0);
      processBlocks(transient, 1);
      frame = readSingleFrame(binding, packet, 20);
      checkOuterFrame(frame, {
        frameType: TelemetryFrameType.TAP_TRANSIENT_GAIN,
        tapId: 808,
        payloadBytes: 4
      });
      assert.equal(Number.isFinite(frame.payload.getFloat32(0, true)), true);

      const limiter = binding.createInstance('BrickwallLimiterPlugin');
      assert.notEqual(limiter, 0);
      assert.equal(binding.instanceSetTap(limiter, 202), 0);
      const limiterPacker = DSP_PARAM_PACKERS.get('BrickwallLimiterPlugin');
      assert.equal(limiterPacker.hash, 0xb531a24a);
      const setLimiter = (lookahead, oversampling, expectedLatency) => {
        assert.equal(binding.instanceSetParams(limiter, limiterPacker.pack({
          th: -24,
          rl: 100,
          la: lookahead,
          os: oversampling,
          ig: 0,
          sm: -1
        }), limiterPacker.hash), 0);
        assert.equal(binding.instanceLatency(limiter), expectedLatency);
      };
      setLimiter(0, 1, 1);
      setLimiter(3, 1, 144);
      setLimiter(0, 2, 32);
      setLimiter(0, 4, 17);
      setLimiter(0, 8, 9);
      setLimiter(3, 8, 152);
      setLimiter(0, 1, 1);
      processBlocks(limiter, 1);
      frame = readSingleFrame(binding, packet, 20);
      checkOuterFrame(frame, {
        frameType: TelemetryFrameType.TAP_GAIN_REDUCTION,
        tapId: 202,
        payloadBytes: 4
      });
      const reductionDb = frame.payload.getFloat32(0, true);
      assert.equal(Number.isFinite(reductionDb) && reductionDb > 0, true);
    } finally {
      binding.close();
    }
  });
}
