import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { loadOverlay } from '../helpers/spectrum-overlay-harness.mjs';

const overlay = loadOverlay();
const size = 4096;
const displayFloor = -96;
function sine(frequency, sampleRate) {
  return Float32Array.from({ length: size }, (_, i) => Math.sin(2 * Math.PI * frequency * i / sampleRate));
}

test('Hann FFT keeps the existing analyzer calibration, rotation, and sample-rate behavior', () => {
  const context = { window: {}, PluginBase: class { registerProcessor() {} }, performance, console };
  const source = fs.readFileSync(new URL('../../plugins/analyzer/spectrum_analyzer.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  const reference = new context.window.SpectrumAnalyzerPlugin();
  reference.enabled = true;
  for (const sampleRate of [48000, 96000]) {
    const bin = Math.round(1000 * size / sampleRate);
    const aligned = sine(bin * sampleRate / size, sampleRate);
    const calibrated = overlay.analyze(aligned, 0, sampleRate);
    assert.ok(Math.abs(calibrated[bin]) < 0.01);
    for (const buffer of [sine(1000, sampleRate), aligned, new Float32Array(size).fill(1), new Float32Array(size)]) {
      for (const bufferPosition of [0, 2048]) {
        const actual = overlay.analyze(buffer, bufferPosition, sampleRate);
        reference.process({ measurements: { buffer: [buffer], bufferPosition, sampleRate, time: 1 } });
        for (let i = 0; i < actual.length; i++) {
          assert.ok(
            Math.abs(Math.max(displayFloor, actual[i]) - Math.max(displayFloor, reference.spectrum[i])) <= 0.01,
            `bin ${i}`
          );
        }
      }
    }
  }
});

test('DC is 0 dBFS and silence remains below the display range without mutating inputs', () => {
  const dc = new Float32Array(size).fill(1);
  assert.ok(Math.abs(overlay.analyze(dc, 0, 48000)[0]) < 0.01);
  assert.ok(dc.every(value => value === 1));
  const silence = overlay.analyze(new Float32Array(size), 0, 48000);
  assert.ok(silence.every(value => Number.isFinite(value) && value < displayFloor));
});

test('4096-point analysis avoids algorithmic performance regressions', t => {
  const input = sine(1000, 96000);
  const timings = [];
  for (let i = 0; i < 110; i++) {
    const start = performance.now();
    overlay.analyze(input, 0, 96000);
    if (i >= 10) timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  const median = timings[50];
  t.diagnostic(`analyze median: ${median.toFixed(3)} ms`);
  assert.ok(median < 10);
});
