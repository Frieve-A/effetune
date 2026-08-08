import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;
const TELEMETRY_BYTES = 32768;

function readFrames(binding) {
  const packet = new ArrayBuffer(TELEMETRY_BYTES);
  const bytes = binding.telemetryRead(packet);
  const frames = [];
  const parsed = parseTelemetryPacket(packet, bytes, frame => frames.push(frame));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.bytesRead, bytes);
  return { bytes, frames };
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`AM Radio Simulator telemetry from ${artifact} honors v2 payload and 60 Hz cadence`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(SAMPLE_RATE, 2, BLOCK_SIZE, TELEMETRY_BYTES), 0);
      assert.equal(binding.setTelemetryRate(60), 0);
      const instanceId = binding.createInstance('AMRadioSimulatorPlugin');
      assert.notEqual(instanceId, 0);
      assert.equal(binding.instanceSetTap(instanceId, 1717), 0);
      const packer = DSP_PARAM_PACKERS.get('AMRadioSimulatorPlugin');
      assert.equal(packer.hash, 0x70fa4967);
      assert.equal(packer.floatCount, 21);
      const cleanCquam = {
        sm: 'C-QUAM', sg: 0, sk: 0, st: 0, in: -80, tn: 0,
        tb: 10, bw: 20, hm: -80, sp: 'Off'
      };
      assert.equal(binding.instanceSetParams(
        instanceId, packer.pack(cleanCquam), packer.hash), 0);

      const arena = binding.getArenaViews();
      let processedFrames = 0;
      const processBlocks = count => {
        for (let block = 0; block < count; block++) {
          arena.combined.fill(0.1, 0, BLOCK_SIZE * 2);
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

      processBlocks(6);
      assert.deepEqual(readFrames(binding), { bytes: 0, frames: [] });

      processBlocks(1);
      const first = readFrames(binding);
      assert.equal(first.bytes, 44);
      assert.equal(first.frames.length, 1);
      const [frame] = first.frames;
      assert.equal(frame.frameType, TelemetryFrameType.TAP_AM_RADIO_SIMULATOR);
      assert.equal(frame.formatVersion, 2);
      assert.equal(frame.tapId, 1717);
      assert.equal(frame.sequence, 0);
      assert.equal(frame.payloadBytes, 28);
      assert.equal(frame.flags, 0);
      for (const offset of [0, 4, 8, 12, 16]) {
        assert.equal(Number.isFinite(frame.payload.getFloat32(offset, true)), true);
      }
      const stereoBlend = frame.payload.getFloat32(16, true);
      assert.equal(stereoBlend >= 0 && stereoBlend <= 1, true);
      frame.payload.getUint32(20, true);
      frame.payload.getUint32(24, true);

      processBlocks(5);
      assert.deepEqual(readFrames(binding), { bytes: 0, frames: [] });
      processBlocks(1);
      const second = readFrames(binding);
      assert.equal(second.bytes, 44);
      assert.equal(second.frames.length, 1);
      assert.equal(second.frames[0].sequence, 1);

      processBlocks(750);
      const locked = readFrames(binding);
      assert.ok(locked.frames.length > 0);
      const lockedStereoBlend =
        locked.frames.at(-1).payload.getFloat32(16, true);
      assert.ok(lockedStereoBlend > 0.75,
        `clean C-QUAM stereoBlend was ${lockedStereoBlend}`);

      assert.equal(binding.instanceSetParams(
        instanceId, packer.pack({ ...cleanCquam, sm: 'Mono' }), packer.hash), 0);
      processBlocks(40);
      const mono = readFrames(binding);
      assert.ok(mono.frames.length > 0);
      const monoStereoBlend = mono.frames.at(-1).payload.getFloat32(16, true);
      assert.ok(monoStereoBlend < 0.01,
        `Mono stereoBlend was ${monoStereoBlend}`);
    } finally {
      binding.close();
    }
  });
}
