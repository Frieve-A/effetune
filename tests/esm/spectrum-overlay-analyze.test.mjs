import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { loadOverlay } from '../helpers/spectrum-overlay-harness.mjs';

const overlay = loadOverlay();
const size = 4096;
const displayFloor = -96;
const smoothingEdgeRatio = 2 ** (1 / 24);
function sine(frequency, sampleRate) {
  return Float32Array.from({ length: size }, (_, i) => Math.sin(2 * Math.PI * frequency * i / sampleRate));
}

function smoothReference(levels) {
  return Float64Array.from(levels, (_, center) => {
    const first = Math.ceil(center / smoothingEdgeRatio);
    const end = Math.min(levels.length, Math.floor(center * smoothingEdgeRatio) + 1);
    let power = 0;
    for (let bin = first; bin < end; bin++) power += 10 ** (levels[bin] / 10);
    return 10 * Math.log10(power / (end - first));
  });
}

test('Hann FFT keeps analyzer calibration, rotation, and sample-rate behavior before 1/12-octave smoothing', () => {
  const context = { window: {}, PluginBase: class { registerProcessor() {} }, performance, console };
  const source = fs.readFileSync(new URL('../../plugins/analyzer/spectrum_analyzer.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  const reference = new context.window.SpectrumAnalyzerPlugin();
  reference.enabled = true;
  for (const sampleRate of [48000, 96000]) {
    const bin = Math.round(1000 * size / sampleRate);
    const aligned = sine(bin * sampleRate / size, sampleRate);
    for (const buffer of [sine(1000, sampleRate), aligned, new Float32Array(size).fill(1), new Float32Array(size)]) {
      for (const bufferPosition of [0, 2048]) {
        const actual = overlay.analyze(buffer, bufferPosition, sampleRate);
        reference.process({ measurements: { buffer: [buffer], bufferPosition, sampleRate, time: 1 } });
        const expected = smoothReference(reference.spectrum);
        for (let i = 0; i < actual.length; i++) {
          assert.ok(
            Math.abs(Math.max(displayFloor, actual[i]) - Math.max(displayFloor, expected[i])) <= 0.01,
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

test('1/12-octave smoothing suppresses narrow high-frequency peaks over a proportional band', () => {
  const sampleRate = 48000;
  const bin = 1000;
  const levels = overlay.analyze(sine(bin * sampleRate / size, sampleRate), 0, sampleRate);
  assert.ok(levels[bin] < -14 && levels[bin] > -18, `center level ${levels[bin]}`);
  assert.ok(levels[980] > displayFloor, `inside level ${levels[980]}`);
  assert.ok(levels[950] < displayFloor, `outside level ${levels[950]}`);
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
