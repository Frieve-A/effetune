import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';

const SAMPLE_RATE = 96000;
const BLOCK_SIZE = 128;
const TELEMETRY_BYTES = 32768;
const TELEMETRY_BLOCKS = 13;
const TUBE_PARAMS_HASH = 0xe7aae286;
const SUPPORTED_SAMPLE_RATES = [44100, 48000, 88200, 96000, 176400, 192000];
const PHASE_A_PROJECTION_PARAMS = Object.freeze({
  dr: -30,
  tp: '12AU7',
  bi: 0,
  pv: 250,
  sz: 10,
  su: 10,
  og: 39,
  mx: 100,
  iv: 2.828,
  nf: 0
});

function readFrames(binding) {
  const packet = new ArrayBuffer(TELEMETRY_BYTES);
  const bytes = binding.telemetryRead(packet);
  const frames = [];
  const parsed = parseTelemetryPacket(packet, bytes, frame => frames.push(frame));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.bytesRead, bytes);
  return { bytes, frames };
}

function assertTubeFrame(frame, tapId) {
  assert.equal(frame.frameType, TelemetryFrameType.TAP_TUBE_SIMULATOR);
  assert.equal(frame.formatVersion, 2);
  assert.equal(frame.tapId, tapId);
  assert.equal(frame.payloadBytes, 164);
  assert.equal(frame.byteLength, 180);
  assert.equal(frame.flags, 0);
  const values = [];
  for (let offset = 0; offset < 164; offset += 4) {
    const value = frame.payload.getFloat32(offset, true);
    assert.equal(Number.isFinite(value), true, `non-finite telemetry at byte ${offset}`);
    values.push(value);
  }
  assert.equal(values.length, 41);
  return values;
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`Tube Simulator in ${artifact} processes every supported sample rate`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const packer = DSP_PARAM_PACKERS.get('TubeSimulatorPlugin');

    for (const sampleRate of SUPPORTED_SAMPLE_RATES) {
      const binding = await instantiateDsp(bytes);
      try {
        assert.notEqual(binding.createEngine(), 0);
        assert.equal(binding.prepare(sampleRate, 2, BLOCK_SIZE, TELEMETRY_BYTES), 0);
        const instance = binding.createInstance('TubeSimulatorPlugin');
        assert.notEqual(instance, 0);
        assert.equal(binding.instanceLatency(instance), 64);
        assert.equal(binding.instanceSetParams(
          instance,
          packer.pack(PHASE_A_PROJECTION_PARAMS),
          packer.hash
        ), 0);

        const arena = binding.getArenaViews();
        for (let channel = 0; channel < 2; channel++) {
          const channelOffset = channel * BLOCK_SIZE;
          for (let frame = 0; frame < BLOCK_SIZE; frame++) {
            arena.combined[channelOffset + frame] =
              Math.sin(2 * Math.PI * 1000 * frame / sampleRate) * 0.25;
          }
        }
        assert.equal(binding.instanceProcess(
          instance,
          arena.offsets.combined,
          2,
          BLOCK_SIZE,
          0
        ), 0);
        assert.ok(
          arena.combined.subarray(0, BLOCK_SIZE * 2).every(Number.isFinite),
          `${sampleRate} Hz output remains finite`
        );
      } finally {
        binding.close();
      }
    }
  });

  test(`Tube Simulator in ${artifact} handles repeated faults deterministically`,
    async () => {
      const bytes = fs.readFileSync(
        new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
      const binding = await instantiateDsp(bytes);
      try {
        assert.notEqual(binding.createEngine(), 0);
        assert.equal(binding.prepare(SAMPLE_RATE, 2, BLOCK_SIZE, TELEMETRY_BYTES), 0);
        const recovered = binding.createInstance('TubeSimulatorPlugin');
        const replayed = binding.createInstance('TubeSimulatorPlugin');
        assert.notEqual(recovered, 0);
        assert.notEqual(replayed, 0);
        assert.deepEqual(binding.instanceRuntimeEvent(recovered), {
          generation: 0,
          latched: false,
          cause: 0
        });
        assert.deepEqual(binding.instanceRuntimeEvent(replayed), {
          generation: 0,
          latched: false,
          cause: 0
        });
        const packer = DSP_PARAM_PACKERS.get('TubeSimulatorPlugin');
        const packed = packer.pack({
          dr: -6, tp: '12AU7', bi: 25, pv: 285, sz: 3.3, su: 22,
          og: -4, mx: 37, iv: 4, nf: 0
        });
        assert.equal(binding.instanceSetParams(recovered, packed, packer.hash), 0);
        assert.equal(binding.instanceSetParams(replayed, packed, packer.hash), 0);
        const arena = binding.getArenaViews();
        arena.combined[0] = Number.NaN;
        arena.combined[1] = 0;
        assert.equal(binding.instanceProcess(
          recovered, arena.offsets.combined, 2, 1, 0), 0);
        assert.ok(arena.combined.subarray(0, 2).every(Number.isFinite));
        assert.deepEqual(binding.instanceRuntimeEvent(recovered), {
          generation: 1,
          latched: true,
          cause: 2
        });
        arena.combined[0] = Number.NaN;
        arena.combined[1] = 0;
        assert.equal(binding.instanceProcess(
          replayed, arena.offsets.combined, 2, 1, 0), 0);
        assert.ok(arena.combined.subarray(0, 2).every(Number.isFinite));
        assert.deepEqual(binding.instanceRuntimeEvent(replayed), {
          generation: 1,
          latched: true,
          cause: 2
        });

        const input = Float32Array.from(
          { length: BLOCK_SIZE * 2 },
          (_, index) => 0.2 * Math.sin(2 * Math.PI * index / 41)
        );
        arena.combined.set(input);
        assert.equal(binding.instanceProcess(
          recovered, arena.offsets.combined, 2, BLOCK_SIZE, 0), 0);
        const recoveredOutput =
          new Float32Array(arena.combined.subarray(0, input.length));
        arena.combined.set(input);
        assert.equal(binding.instanceProcess(
          replayed, arena.offsets.combined, 2, BLOCK_SIZE, 0), 0);
        assert.deepEqual(
          new Float32Array(arena.combined.subarray(0, input.length)),
          recoveredOutput
        );
        assert.deepEqual(binding.instanceRuntimeEvent(recovered), {
          generation: 1,
          latched: true,
          cause: 2
        });
        assert.deepEqual(binding.instanceRuntimeEvent(replayed), {
          generation: 1,
          latched: true,
          cause: 2
        });
      } finally {
        binding.close();
      }
    });

  test(`Tube Simulator telemetry from ${artifact} discovers the kernel and isolates taps`, async () => {
    assert.equal(TelemetryFrameType.TAP_TUBE_SIMULATOR, 19);
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      const capabilities = binding.getCapabilities();
      const kernel = capabilities.kernels.find(candidate =>
        candidate.name === 'TubeSimulatorPlugin');
      assert.ok(kernel, 'TubeSimulatorPlugin kernel was not discovered');
      assert.equal(kernel.hash, TUBE_PARAMS_HASH);

      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(SAMPLE_RATE, 2, BLOCK_SIZE, TELEMETRY_BYTES), 0);
      assert.equal(binding.setTelemetryRate(60), 0);
      const leftTapInstance = binding.createInstance('TubeSimulatorPlugin');
      const rightTapInstance = binding.createInstance('TubeSimulatorPlugin');
      assert.notEqual(leftTapInstance, 0);
      assert.notEqual(rightTapInstance, 0);
      assert.notEqual(leftTapInstance, rightTapInstance);
      assert.equal(binding.instanceLatency(leftTapInstance), 64);
      assert.equal(binding.instanceLatency(rightTapInstance), 64);
      assert.equal(binding.instanceSetTap(leftTapInstance, 1919), 0);
      assert.equal(binding.instanceSetTap(rightTapInstance, 1920), 0);

      const packer = DSP_PARAM_PACKERS.get('TubeSimulatorPlugin');
      assert.equal(packer.hash, TUBE_PARAMS_HASH);
      assert.equal(packer.floatCount, 20);
      assert.equal(binding.instanceSetParams(
        leftTapInstance,
        packer.pack({
          dr: 0, tp: '12AX7', bi: -12, pv: 260, sz: 8, su: 12,
          og: 39, mx: 100, iv: 2.828, nf: 0
        }),
        packer.hash
      ), 0);
      assert.equal(binding.instanceSetParams(
        rightTapInstance,
        packer.pack({
          dr: -6, tp: '12AU7', bi: 15, pv: 225, sz: 18, su: 6,
          og: 39, mx: 100, iv: 2.828, nf: 0
        }),
        packer.hash
      ), 0);

      const arena = binding.getArenaViews();
      let processedFrames = 0;
      const processBoth = (blocks, signal) => {
        for (let block = 0; block < blocks; block++) {
          for (let channel = 0; channel < 2; channel++) {
            const channelOffset = channel * BLOCK_SIZE;
            for (let frame = 0; frame < BLOCK_SIZE; frame++) {
              arena.combined[channelOffset + frame] = signal
                ? Math.sin(2 * Math.PI * (440 + channel * 110) *
                  (processedFrames + frame) / SAMPLE_RATE) * 0.25
                : 0;
            }
          }
          assert.equal(binding.instanceProcess(
            leftTapInstance,
            arena.offsets.combined,
            2,
            BLOCK_SIZE,
            processedFrames / SAMPLE_RATE
          ), 0);
          assert.equal(binding.instanceProcess(
            rightTapInstance,
            arena.offsets.combined,
            2,
            BLOCK_SIZE,
            processedFrames / SAMPLE_RATE
          ), 0);
          processedFrames += BLOCK_SIZE;
        }
      };

      processBoth(TELEMETRY_BLOCKS, true);
      const first = readFrames(binding);
      assert.equal(first.bytes, 360);
      assert.equal(first.frames.length, 2);
      const byTap = new Map(first.frames.map(frame => [frame.tapId, frame]));
      assert.deepEqual([...byTap.keys()].sort((left, right) => left - right), [1919, 1920]);
      const firstLeftValues = assertTubeFrame(byTap.get(1919), 1919);
      const firstRightValues = assertTubeFrame(byTap.get(1920), 1920);
      assert.notDeepEqual(firstLeftValues, firstRightValues);

      assert.equal(binding.resetInstance(leftTapInstance), 0);
      processBoth(TELEMETRY_BLOCKS, false);
      const afterReset = readFrames(binding);
      assert.equal(afterReset.bytes, 360);
      assert.equal(afterReset.frames.length, 2);
      const resetByTap = new Map(afterReset.frames.map(frame => [frame.tapId, frame]));
      const resetValues = assertTubeFrame(resetByTap.get(1919), 1919);
      assertTubeFrame(resetByTap.get(1920), 1920);
      assert.ok(resetValues[2] > 0);
      assert.equal(resetValues[11], 0);
      assert.ok(resetValues[22] > 0);
      assert.equal(resetByTap.get(1919).sequence, 0);
      assert.equal(resetByTap.get(1920).sequence, 1);
    } finally {
      binding.close();
    }
  });
}
