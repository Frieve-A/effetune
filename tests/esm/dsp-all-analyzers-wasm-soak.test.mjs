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

const bandwidthTargets = new Map([
  [202, ['Oscilloscope', 300_000]],
  [203, ['Spectrum Analyzer', 600_000]],
  [204, ['Spectrogram', 50_000]],
  [205, ['Stereo Meter', 200_000]]
]);

const analyzers = [
  ['LevelMeterPlugin', 201, TelemetryFrameType.TAP_LEVEL],
  ['OscilloscopePlugin', 202, TelemetryFrameType.TAP_SCOPE_SNAPSHOT],
  ['SpectrumAnalyzerPlugin', 203, TelemetryFrameType.TAP_SPECTRUM],
  ['SpectrogramPlugin', 204, TelemetryFrameType.TAP_SPECTROGRAM_COL],
  ['StereoMeterPlugin', 205, TelemetryFrameType.TAP_STEREO_FIELD]
];

function fillInput(audio, block) {
  for (let channel = 0; channel < CHANNELS; ++channel) {
    const offset = channel * BLOCK_SIZE;
    for (let frame = 0; frame < BLOCK_SIZE; ++frame) {
      const absoluteFrame = block * BLOCK_SIZE + frame;
      const frequency = channel === 0 ? 997 : 1499;
      audio[offset + frame] = Math.sin(
        2 * Math.PI * frequency * absoluteFrame / SAMPLE_RATE
      ) * 0.25;
    }
  }
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
      for (const [type, tapId, frameType] of analyzers) {
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
      }

      const arena = binding.getArenaViews();
      const packet = new ArrayBuffer(TELEMETRY_BYTES);
      const frameCounts = new Map(analyzers.map(([, tapId]) => [tapId, 0]));
      const telemetryBytes = new Map(analyzers.map(([, tapId]) => [tapId, 0]));
      const lastSequences = new Map();
      let droppedFrames = 0;

      for (let block = 0; block < QUANTUM_COUNT; ++block) {
        fillInput(arena.combined, block);
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
          assert.equal(frame.formatVersion, 1);
          assert.equal(frame.frameType, expectedTypeByTap.get(frame.tapId));
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
