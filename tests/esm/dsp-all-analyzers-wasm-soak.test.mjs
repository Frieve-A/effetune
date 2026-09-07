import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';

const SAMPLE_RATE = 96000;
const CHANNELS = 2;
const BLOCK_SIZE = 128;
const QUANTUM_COUNT = SAMPLE_RATE / BLOCK_SIZE;
const TELEMETRY_BYTES = 256 * 1024;
const MULTI_F0_TAP_ID = 206;
const MULTI_F0_NOTE_COUNT = 88;
const MULTI_F0_FINE_DIVISIONS = 5;
const MULTI_F0_PITCH_COUNT = MULTI_F0_NOTE_COUNT * MULTI_F0_FINE_DIVISIONS;
const MULTI_F0_PAYLOAD_BYTES = 28 + MULTI_F0_PITCH_COUNT * 4;
const MULTI_F0_VALUES_OFFSET = 28;
const MULTI_F0_FIRST_MIDI = 21;
const MULTI_F0_EXPECTED_PITCHES = [69, 72].map(midi => midi - MULTI_F0_FIRST_MIDI);
const MULTI_F0_PRESENCE_HARMONIC_END_BLOCK = 225;
const MULTI_F0_PRESENCE_END_BLOCK = 480;
const MULTI_F0_HARMONIC_ASSERT_START_SECONDS = 0.18;
const MULTI_F0_HARMONIC_ASSERT_END_SECONDS = 0.29;
const MULTI_F0_NOISE_ASSERT_START_SECONDS = 0.5;
const MULTI_F0_NOISE_ASSERT_END_SECONDS = 0.62;

const bandwidthTargets = new Map([
  [202, ['Oscilloscope', 300_000]],
  [203, ['Spectrum Analyzer', 600_000]],
  [204, ['Spectrogram', 50_000]],
  [205, ['Stereo Meter', 900_000]]
]);

const analyzers = [
  ['LevelMeterPlugin', 201, TelemetryFrameType.TAP_LEVEL, 1],
  ['OscilloscopePlugin', 202, TelemetryFrameType.TAP_SCOPE_SNAPSHOT, 2],
  ['SpectrumAnalyzerPlugin', 203, TelemetryFrameType.TAP_SPECTRUM, 1],
  ['SpectrogramPlugin', 204, TelemetryFrameType.TAP_SPECTROGRAM_COL, 1],
  ['StereoMeterPlugin', 205, TelemetryFrameType.TAP_STEREO_FIELD, 2],
  ['NoteSpectrogramPlugin', MULTI_F0_TAP_ID, 24, 2]
];

function deterministicNoise(sample, channel) {
  let value = (sample + Math.imul(channel + 1, 0x9e3779b9)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return (value / 0xffffffff * 2 - 1) * 0.25;
}

function fillInput(audio, block, useNoise) {
  for (let channel = 0; channel < CHANNELS; ++channel) {
    const offset = channel * BLOCK_SIZE;
    for (let frame = 0; frame < BLOCK_SIZE; ++frame) {
      const absoluteFrame = block * BLOCK_SIZE + frame;
      if (useNoise) {
        audio[offset + frame] = deterministicNoise(absoluteFrame, channel);
        continue;
      }
      const midi = channel === 0 ? 69 : 72;
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      audio[offset + frame] = Math.sin(
        2 * Math.PI * frequency * absoluteFrame / SAMPLE_RATE
      ) * 0.25;
    }
  }
}

function multiF0BagMaximum(payload, pitch) {
  let maximum = 0;
  for (let division = 0; division < MULTI_F0_FINE_DIVISIONS; division++) {
    maximum = Math.max(maximum, payload.getFloat32(
      MULTI_F0_VALUES_OFFSET + (pitch * MULTI_F0_FINE_DIVISIONS + division) * 4,
      true
    ));
  }
  return maximum;
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`all analyzers sustain 96 kHz telemetry without drops in ${artifact}`, async t => {
    const wasm = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(wasm);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(
        binding.prepare(SAMPLE_RATE, CHANNELS, BLOCK_SIZE, TELEMETRY_BYTES),
        0
      );
      assert.equal(binding.setTelemetryRate(60), 0);

      const instances = [];
      const expectedTypeByTap = new Map();
      const expectedVersionByTap = new Map();
      for (const [type, tapId, frameType, formatVersion] of analyzers) {
        const instanceId = binding.createInstance(type);
        assert.notEqual(instanceId, 0, `${type} instance`);
        const packer = DSP_PARAM_PACKERS.get(type);
        assert.ok(packer, `${type} packer`);
        assert.equal(binding.instanceSetParams(
          instanceId,
          packer.pack({}),
          packer.hash
        ), 0);
        assert.equal(binding.instanceSetTap(instanceId, tapId), 0);
        instances.push(instanceId);
        expectedTypeByTap.set(tapId, frameType);
        expectedVersionByTap.set(tapId, formatVersion);
      }

      const arena = binding.getArenaViews();
      const packet = new ArrayBuffer(TELEMETRY_BYTES);
      const frameCounts = new Map(analyzers.map(([, tapId]) => [tapId, 0]));
      const telemetryBytes = new Map(analyzers.map(([, tapId]) => [tapId, 0]));
      const lastSequences = new Map();
      const multiF0Modes = new Set();
      const multiF0GenerationByMode = new Map();
      const multiF0LastFrameByGeneration = new Map();
      const multiF0HarmonicMax = new Float32Array(MULTI_F0_PITCH_COUNT);
      const multiF0NoiseMax = new Float32Array(MULTI_F0_PITCH_COUNT);
      let multiF0HarmonicFrames = 0;
      let multiF0NoiseFrames = 0;
      let droppedFrames = 0;

      for (let block = 0; block < QUANTUM_COUNT; ++block) {
        const useNoise = block >= MULTI_F0_PRESENCE_HARMONIC_END_BLOCK &&
          block < MULTI_F0_PRESENCE_END_BLOCK;
        fillInput(arena.combined, block, useNoise);
        const time = block * BLOCK_SIZE / SAMPLE_RATE;
        for (const instanceId of instances) {
          assert.equal(binding.instanceProcess(
            instanceId,
            arena.offsets.combined,
            CHANNELS,
            BLOCK_SIZE,
            time
          ), 0);
        }

        const bytes = binding.telemetryRead(packet);
        droppedFrames += binding.lastTelemetryDroppedFrames;
        if (bytes === 0) continue;
        const parsed = parseTelemetryPacket(packet, bytes, frame => {
          assert.equal(frame.formatVersion, expectedVersionByTap.get(frame.tapId));
          assert.equal(frame.frameType, expectedTypeByTap.get(frame.tapId));
          if (frame.tapId === MULTI_F0_TAP_ID) {
            assert.equal(frame.payload.byteLength, MULTI_F0_PAYLOAD_BYTES);
            const mode = frame.payload.getUint32(20, true);
            const generation = frame.payload.getUint32(24, true);
            const frameIndex = frame.payload.getUint32(16, true);
            const frameTime = frame.payload.getFloat32(4, true);
            assert.equal(mode, MULTI_F0_FINE_DIVISIONS);
            assert.equal(Number.isFinite(frameTime), true);
            const firstGeneration = multiF0GenerationByMode.get(mode);
            if (firstGeneration === undefined) {
              multiF0GenerationByMode.set(mode, generation);
              assert.equal(frameIndex, 0);
            } else {
              assert.equal(generation, firstGeneration);
            }
            const previousFrame = multiF0LastFrameByGeneration.get(generation);
            if (previousFrame !== undefined) {
              assert.equal(frameIndex, (previousFrame + 1) >>> 0);
            }
            multiF0LastFrameByGeneration.set(generation, frameIndex);
            multiF0Modes.add(mode);
            const harmonicFrame = mode === MULTI_F0_FINE_DIVISIONS &&
              frameTime >= MULTI_F0_HARMONIC_ASSERT_START_SECONDS &&
              frameTime < MULTI_F0_HARMONIC_ASSERT_END_SECONDS;
            const noiseFrame = mode === MULTI_F0_FINE_DIVISIONS &&
              frameTime >= MULTI_F0_NOISE_ASSERT_START_SECONDS &&
              frameTime < MULTI_F0_NOISE_ASSERT_END_SECONDS;
            let weakestExpectedPresence = 1;
            if (harmonicFrame) {
              multiF0HarmonicFrames++;
              for (const pitch of MULTI_F0_EXPECTED_PITCHES) {
                const value = multiF0BagMaximum(frame.payload, pitch);
                assert.ok(
                  value >= 0.1,
                  `expected pitch ${pitch + MULTI_F0_FIRST_MIDI} lost substantial presence`
                );
                weakestExpectedPresence = Math.min(weakestExpectedPresence, value);
              }
            }
            if (noiseFrame) multiF0NoiseFrames++;
            for (let pitch = 0; pitch < MULTI_F0_PITCH_COUNT; pitch++) {
              const value = frame.payload.getFloat32(
                MULTI_F0_VALUES_OFFSET + pitch * 4,
                true
              );
              assert.equal(Number.isFinite(value), true);
              if (mode === MULTI_F0_FINE_DIVISIONS) {
                assert.ok(value >= 0 && value <= 1);
                if (harmonicFrame) {
                  if (value > multiF0HarmonicMax[pitch]) {
                    multiF0HarmonicMax[pitch] = value;
                  }
                  if (!MULTI_F0_EXPECTED_PITCHES.includes(
                    Math.floor(pitch / MULTI_F0_FINE_DIVISIONS))) {
                    assert.ok(
                      value < weakestExpectedPresence,
                      'the two expected pitches must remain the two strongest rows'
                    );
                  }
                }
                if (noiseFrame && value > multiF0NoiseMax[pitch]) {
                  multiF0NoiseMax[pitch] = value;
                }
              }
            }
          }
          const previousSequence = lastSequences.get(frame.tapId);
          if (previousSequence !== undefined) {
            assert.equal(frame.sequence, (previousSequence + 1) >>> 0);
          }
          lastSequences.set(frame.tapId, frame.sequence);
          frameCounts.set(frame.tapId, frameCounts.get(frame.tapId) + 1);
          telemetryBytes.set(frame.tapId, telemetryBytes.get(frame.tapId) + frame.byteLength);
        });
        assert.equal(parsed.ok, true);
      }

      assert.equal(droppedFrames, 0);
      for (const [, tapId] of analyzers) {
        assert.ok(frameCounts.get(tapId) > 0, `tap ${tapId} emitted telemetry`);
      }
      assert.deepEqual([...multiF0Modes], [MULTI_F0_FINE_DIVISIONS]);
      assert.ok(multiF0HarmonicFrames > 0, 'F0 Presence emitted warm harmonic frames');
      assert.ok(multiF0NoiseFrames > 0, 'F0 Presence emitted settled noise frames');
      for (let pitch = 0; pitch < MULTI_F0_NOTE_COUNT; pitch++) {
        const harmonicMaximum = Math.max(...multiF0HarmonicMax.slice(
          pitch * MULTI_F0_FINE_DIVISIONS,
          (pitch + 1) * MULTI_F0_FINE_DIVISIONS
        ));
        const noiseMaximum = Math.max(...multiF0NoiseMax.slice(
          pitch * MULTI_F0_FINE_DIVISIONS,
          (pitch + 1) * MULTI_F0_FINE_DIVISIONS
        ));
        if (!MULTI_F0_EXPECTED_PITCHES.includes(pitch)) {
          assert.ok(
            harmonicMaximum <= 0.5,
            `unexpected pitch ${pitch + MULTI_F0_FIRST_MIDI} exceeded 0.5 confidence`
          );
        }
        assert.ok(
          noiseMaximum <= 0.5,
          `noise pitch ${pitch + MULTI_F0_FIRST_MIDI} exceeded 0.5 confidence`
        );
      }
      for (const [tapId, [label, maximumBytesPerSecond]] of bandwidthTargets) {
        const actualBytesPerSecond = telemetryBytes.get(tapId);
        assert.ok(
          actualBytesPerSecond <= maximumBytesPerSecond,
          `${label} emitted ${actualBytesPerSecond} B/s, above ${maximumBytesPerSecond} B/s`
        );
      }
      t.diagnostic(analyzers.map(([type, tapId]) =>
        `${type}=${telemetryBytes.get(tapId)} B/s`).join(', '));
    } finally {
      binding.close();
    }
  });
}
