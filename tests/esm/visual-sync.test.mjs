import assert from 'node:assert/strict';
import test from 'node:test';
import { VISUAL_SYNC_RULES as rules, isVisualSyncEnabled, requiredOutputDelayFrames,
  audibleFrameTime, audibleContextTime } from '../../js/audio/visual-sync.js';

test('visual sync capture ages follow FFT, staged slot, HQ and pitch window formulas', () => {
  for (const pt of [8, 12, 14]) {
    const size = 2 ** pt;
    assert.equal(rules.SpectrumAnalyzerPlugin.generationFrames({ pt }, 48000, 'js'), size / 2);
    assert.equal(rules.SpectrumAnalyzerPlugin.generationFrames({ pt }, 48000, 'wasm'),
      size / 2 + Math.min(512, Math.floor(Math.max(size / 2, 1600) / 16)) * 16);
    assert.equal(rules.SpectrogramPlugin.generationFrames({ pt }, 48000, 'wasm'), size);
    assert.equal(rules.SpectrogramPlugin.generationFrames({ pt, sc: 'log-hq' }, 48000, 'js'), size * 2 + 48 + size / 2);
  }
  assert.equal(rules.NoteSpectrogramPlugin.generationFrames({}, 48000, 'wasm'), 8192 + 960);
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

test('visual sync deadlines stay on the sample timeline while delivery follows the output clock', () => {
  const options = { endFrame: 48000, sampleRate: 48000, generationFrames: 480,
    tapFrames: 960, outputDelayFrames: 480,
    fallback: { currentTime: 1, performanceTime: 1000, outputLatency: 0.1 } };
  assert.equal(audibleFrameTime(options), 1020);
  assert.equal(audibleContextTime({ ...options.fallback,
    outputTimestamp: { contextTime: 1, performanceTime: 900 } }), 1100);
  assert.equal(audibleContextTime(options.fallback), 900);
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
