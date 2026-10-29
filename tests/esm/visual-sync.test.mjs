import assert from 'node:assert/strict';
import test from 'node:test';
import { VISUAL_SYNC_RULES as rules, isVisualSyncEnabled, requiredOutputDelayFrames,
  audibleFrameTime, audibleContextTime, audiblePlaybackPosition, telemetryCaptureTiming } from '../../js/audio/visual-sync.js';

test('visual sync capture ages follow FFT, staged slot, HQ and pitch window formulas', () => {
  for (const pt of [8, 12, 14]) {
    const size = 2 ** pt;
    assert.equal(rules.SpectrumAnalyzerPlugin.generationFrames({ pt }, 48000, 'js'), size / 2);
    assert.equal(rules.SpectrumAnalyzerPlugin.generationFrames({ pt }, 48000, 'wasm'),
      size / 2 + Math.min(512, Math.floor(Math.max(size / 2, 1600) / 16)) * 16);
    assert.equal(rules.SpectrogramPlugin.generationFrames({ pt }, 48000, 'wasm'), size);
    assert.equal(rules.SpectrogramPlugin.generationFrames({ pt, sc: 'log-hq' }, 48000, 'js'), size * 2 + 48 + size / 2);
  }
  assert.ok(Math.abs(rules.NoteSpectrogramPlugin.generationFrames({}, 48000, 'wasm') - 5244.474399459274) < 1e-8);
  assert.equal(rules.PitchMeterPlugin.generationFrames({ rf: 440, mn: 69 }, 48000, 'wasm'), 360 + 480);
  assert.equal(rules.RhythmAnalyzerPlugin.generationFrames({}, 48000, 'wasm'), 1024 / 2 + 2 * 128);
  assert.equal(rules.RhythmAnalyzerPlugin.generationFrames({}, 96000, 'wasm'), 2048 / 2 + 2 * 256);
  assert.equal(rules.OscilloscopePlugin.generationFrames({ dt: 0.01 }, 48000, 'wasm'), 240);
  assert.equal(rules.StereoMeterPlugin.generationFrames({ wt: 0.1 }, 48000, 'wasm'), 2400);
  assert.equal(rules.spectrumOverlay.generationFrames(), 2048);
  assert.equal(rules.CompressorPlugin.generationFrames(), 0);
  assert.equal(rules.UnknownPlugin, undefined);
  assert.equal(isVisualSyncEnabled({ visualSync: true }), true);
  for (const config of [undefined, {}, { visualSync: 'true' }]) assert.equal(isVisualSyncEnabled(config), false);
});

test('SFZ voice display follows its positive wet playback delay without adding analysis latency', () => {
  const rule = rules.SFZNotePlayerPlugin;
  assert.equal(rule.tap, 'output');
  for (const [timing, frames] of [[-100, 0], [0, 0], [25, -1200], [100, -4800]]) {
    assert.equal(rule.generationFrames({ tm: timing }, 48000), frames === 0 ? -0 : frames);
  }
  assert.equal(audibleFrameTime({ endFrame: 48000, generationFrames: -4800,
    outputDelayFrames: 0, sampleRate: 48000 }), 1100);
});

test('Note Spectrogram sync follows the asymmetric long-window energy centroid at each rate', () => {
  // Reference centroids use raw double windows and count the newest sample at age one.
  for (const [rate, centroid] of [[16000, 1428.4148630939314], [44100, 3936.447441538596],
    [48000, 4284.474399459274], [96000, 8568.448798918569], [384000, 34272.29519567371]]) {
    const completion = Math.floor(Math.min(8192, Math.max(16, Math.round(rate * 0.02))) / 16) * 16;
    assert.ok(Math.abs(rules.NoteSpectrogramPlugin.generationFrames({}, rate, 'wasm') - centroid - completion) < 1e-7);
    const payload = new DataView(new ArrayBuffer(9192));
    payload.setFloat32(0, rate, true);
    payload.setFloat32(4, 1, true);
    const timing = telemetryCaptureTiming({ frameType: 24, formatVersion: 6, payload }, rate);
    assert.equal(timing.endFrame, rate * 2);
    assert.ok(Math.abs(timing.generationFrames - centroid) < 1e-7);
  }
});

test('visual sync output delay uses the greatest enabled capture deficit and clamps it', () => {
  const options = { targets: [
    { id: 1, ruleKey: 'SpectrumAnalyzerPlugin', generationFrames: 4096 },
    { id: 2, ruleKey: 'SpectrogramPlugin', generationFrames: 8192, enabled: false },
    { id: 3, ruleKey: 'UnknownPlugin', generationFrames: 9000 }
  ], taps: { 1: { output: 500 }, 2: { output: 0 }, 3: { output: 0 } },
  dbtFrames: 100, deviceLatencyFrames: 480, maxFrames: 24000 };
  assert.equal(requiredOutputDelayFrames(options), 3016);
  assert.equal(requiredOutputDelayFrames({ ...options, maxFrames: 1000 }), 1000);
  assert.equal(requiredOutputDelayFrames({ ...options, deviceLatencyFrames: 9000 }), 0);
  assert.equal(requiredOutputDelayFrames({ ...options, taps: {} }), 0);
});

test('Oscilloscope sync follows full triggered captures and the buffered rolling right edge', () => {
  for (const rate of [44100, 48000, 96000, 192000]) {
    for (const dt of [.001, .04, .045, 1, 10]) {
      const samples = Math.floor(rate * dt);
      for (const tm of ['Auto', 'Normal']) {
        assert.equal(rules.OscilloscopePlugin.generationFrames({ dt, tm }, rate), samples / 2);
      }
      assert.equal(rules.OscilloscopePlugin.generationFrames({ dt, tm: 'Off' }, rate),
        samples > 2048 ? rate / 30 : samples / 2);
    }
  }
  const generationFrames = rules.OscilloscopePlugin.generationFrames({ dt: 10, tm: 'Off' }, 48000);
  assert.equal(requiredOutputDelayFrames({ targets: [{ id: 7, ruleKey: 'OscilloscopePlugin', generationFrames }],
    taps: { 7: { output: 0 } }, maxFrames: 24000 }), 1600);
});

test('visual sync deadlines stay on the sample timeline while delivery follows the output clock', () => {
  const options = { endFrame: 48000, sampleRate: 48000, generationFrames: 480,
    tapFrames: 960, outputDelayFrames: 480,
    fallback: { currentTime: 1, performanceTime: 1000, outputLatency: 0.1 } };
  assert.equal(audibleFrameTime(options), 1020);
  assert.equal(audibleContextTime({ ...options.fallback,
    outputTimestamp: { contextTime: 1, performanceTime: 900 } }), 1100);
  assert.equal(audibleContextTime(options.fallback), 900);
});

test('audible playback position converts latency to content seconds and preserves pre-start time', () => {
  assert.equal(audiblePlaybackPosition({ position: 3, latencySeconds: 0.25, playbackSpeed: 2 }), 2.5);
  assert.equal(audiblePlaybackPosition({ position: 0.1, latencySeconds: 0.3 }), -0.19999999999999998);
  assert.equal(audiblePlaybackPosition({ position: 3 }), 3);
});


test('Phase Select EQ sync follows the input window and staged completion before its delayed output', () => {
  const definition = rules.PhaseSelectEqPlugin;
  assert.equal(definition.tap, 'input');
  for (const [rate, size] of [[44100, 4096], [48000, 4096], [88200, 8192], [96000, 8192],
    [176400, 16384], [192000, 16384], [32000, 4096], [768000, 32768]]) {
    assert.equal(definition.generationFrames({}, rate, 'wasm'), size * 3 / 4);
    assert.equal(definition.generationFrames({}, rate, 'js'), 0);
  }
  const generationFrames = definition.generationFrames({}, 48000, 'wasm');
  assert.equal(requiredOutputDelayFrames({ targets: [{ id: 7, ruleKey: 'PhaseSelectEqPlugin', generationFrames }],
    taps: { 7: { input: 5120, output: 0 } }, deviceLatencyFrames: 480, maxFrames: 24000 }), 0);
  const due = audibleFrameTime({ endFrame: 48000, generationFrames, tapFrames: 5120,
    sampleRate: 48000, outputTimestamp: { contextTime: 1, performanceTime: 1000 } });
  assert.ok(Math.abs(due - (1000 + 2048 / 48)) < 1e-10);
});


test('Analog Meter aligns only its windowed RMS and Loudness readings', () => {
  const age = params => rules.AnalogMeterPlugin.generationFrames(params, 48000, 'wasm');
  for (const md of ['VU', 'PPM', 'Sample Peak', 'True Peak']) assert.equal(age({ md, it: 0.3 }), 0);
  assert.equal(age({ md: 'RMS', it: 0.3 }), 7200);
  assert.equal(age({ md: 'Custom', de: 'RMS', it: 0.3 }), 7200);
  assert.equal(age({ md: 'Custom', de: 'RMS', it: 3 }), 72000);
  for (const de of ['Average Rectified', 'Sample Peak', 'True Peak']) {
    assert.equal(age({ md: 'Custom', de, it: 3 }), 0);
  }
  assert.equal(age({ md: 'Loudness', ln: 0 }), 9600);
  assert.equal(age({ md: 'Loudness', ln: 1 }), 72000);
});

test('Chroma Spiral automatic HQ capture age matches fixed sample-rate contracts', () => {
  for (const [rate, age] of [[44100, 20528], [48000, 20528], [88200, 41008], [96000, 41008], [192000, 41008]]) {
    for (const execution of ['js', 'wasm']) {
      assert.equal(rules.ChromaSpiralPlugin.generationFrames({}, rate, execution), age);
    }
  }
});


test('Drum visual sync reserves future frames, scheduling and the active resampler delay', () => {
  for (const rate of [44100, 48000, 96000, 192000]) {
    const actual = rules.RhythmAnalyzerPlugin.generationFrames({ dm: 'drums' }, rate, 'wasm');
    assert.ok(Math.abs(actual / rate - (0.07775 + (rate === 44100 ? 0 : 191 / rate))) < 1e-10);
  }
});


test('Drum telemetry delivery uses its actual scheduling age and host sample clock', () => {
  const payload = new DataView(new ArrayBuffer(2024));
  payload.setFloat32(0, 48000, true);
  payload.setFloat32(16, 2, true);
  payload.setUint32(1496, 1, true);
  payload.setFloat32(1504, .07225, true);
  const frame = { frameType: 28, formatVersion: 5, payload };
  const timing = telemetryCaptureTiming(frame, 128, 44100);
  assert.equal(timing.endFrame, 2 * 44100 + 128);
  assert.equal(timing.generationFrames, payload.getFloat32(1504, true) * 44100);
  assert.ok(timing.generationFrames < rules.RhythmAnalyzerPlugin.generationFrames({ dm: 'drums' }, 44100));
  assert.equal(telemetryCaptureTiming(frame, 128), null, 'Band analysis rate cannot replace the missing host rate');
  payload.setFloat32(1504, NaN, true);
  assert.equal(telemetryCaptureTiming(frame, 128, 44100), null);
  payload.setFloat32(1504, .07225, true);
  payload.setFloat32(16, 0, true);
  assert.equal(telemetryCaptureTiming(frame, 128, 44100), null, 'An empty reset snapshot has no source capture time');
  payload.setFloat32(16, 2, true);
  payload.setUint32(1496, 0, true);
  assert.equal(telemetryCaptureTiming(frame, 128, 44100), null, 'Band mode retains its existing timing rule');
});
