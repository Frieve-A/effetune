import assert from 'node:assert/strict';
import test from 'node:test';
import { SpectrumTapContract as contract } from '../../js/audio/visual-sync.js';
import { createOverlayHarness } from '../helpers/spectrum-overlay-harness.mjs';

test('Spectrum Tap schedules window centers with analysis completion and pipeline delay', () => {
  for (const [quality, rate, age, completion] of [
    ['normal', 48000, 2048, 0], ['hq', 48000, 8192, 2096], ['hq', 96000, 8192, 3248]
  ]) {
    const timing = contract.timing(quality, rate, 3, 10, 96000, 512);
    assert.equal(contract.valid(timing), true);
    assert.equal(timing.windowAgeFrames, age);
    assert.equal(timing.completionFrames, completion);
    assert.equal(contract.audibleFrame(timing, 100), 96000 - age + 612);
    assert.equal(contract.requiredOutputDelay(timing, 100, 200, 24000), age + completion - 812);
    assert.equal(contract.requiredOutputDelay(timing, 24000), 0);
    assert.equal(contract.requiredOutputDelay(timing, 100, 200, 24000, 1600), age + completion + 1600 - 812);
  }
});

test('native Normal results draw through the shared overlay and generations discard stale captures', () => {
  const h = createOverlayHarness();
  const { instance } = h.attach();
  instance.setMode('compare');
  let audibleNow = 0;
  h.window.dspTelemetryHub = { visualSyncEpoch: 0, now: () => audibleNow,
    resolveDue: (_id, _end, _key, data) => contract.audibleFrame(data.timing) / 48 };
  const spectrum = level => ({ current: new Float32Array(2048).fill(level),
    peaks: new Float32Array(2048).fill(level), validCellCount: 2048 });
  const message = (generation, frameIndex, level) => ({ type: 'spectrumOverlay',
    spectrumPluginId: 7, mode: 'compare', quality: 'normal', sampleRate: 48000,
    timing: contract.timing('normal', 48000, generation, frameIndex, 48000, 512),
    inputSpectrum: spectrum(level + 6), outputSpectrum: spectrum(level) });
  instance.onSpectrumMessage(message(1, 0, -12));
  h.frame();
  assert.equal(instance.levels, null);
  audibleNow = 1000;
  h.frame();
  assert.equal(instance.levels[0], -12);
  assert.equal(instance.inputLevels[0], -6);
  instance.onSpectrumMessage(message(2, 0, -24));
  instance.onSpectrumMessage(message(1, 100, -48));
  instance.onSpectrumMessage(message(2, 0, -60));
  h.frame();
  assert.equal(instance.levels[0], -24);
  assert.equal(instance.captureGeneration, 2);
  instance.dispose();
});
