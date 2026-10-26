import assert from 'node:assert/strict';
import test from 'node:test';
import { PEQCalculator, peqResponse, processCollisions, designPEQ, createDefaultBands } from '../../features/measurement/peq-calculator/peq-calculator.js';
import { createConsoleHarness, withGlobals } from '../helpers/global-test-utils.mjs';

const quiet = callback => withGlobals({ console: createConsoleHarness({ log() {}, warn() {}, error() {} }) }, callback);
const frequencies = Array.from({ length: 181 }, (_, index) => 40 * 400 ** (index / 180));

test('flat measurements produce neutral, ordered bands without inventing correction', () => quiet(() => {
  for (const count of [1, 5, 15]) {
    const response = frequencies.map(frequency => [frequency, 12]);
    const bands = new PEQCalculator().calculatePEQParameters(response, 40, 16000, count, 48000);
    assert.equal(bands.length, count);
    assert.ok(bands.every(band => band.gain === 0 && band.Q > 0 && band.type === 'peaking'));
    assert.ok(bands.every((band, index) => band.frequency >= 40 && band.frequency <= 16000 &&
      (index === 0 || bands[index - 1].frequency <= band.frequency)));
  }
}));

test('PEQ correction reduces separated measured peaks and dips while preserving the source data', () => quiet(() => {
  const response = frequencies.map(frequency => [frequency,
    7 * Math.exp(-((Math.log2(frequency / 160) / 0.55) ** 2)) -
    5 * Math.exp(-((Math.log2(frequency / 2500) / 0.7) ** 2))]);
  const original = structuredClone(response);
  const bands = new PEQCalculator().calculatePEQParameters(response, 40, 16000, 5, 48000, 12);
  const mean = response.reduce((sum, point) => sum + point[1], 0) / response.length;
  const before = response.map(point => point[1] - mean);
  const corrected = before.slice();
  for (const band of bands) {
    const correction = peqResponse(frequencies, band.frequency, band.gain, band.Q, 48000);
    correction.forEach((value, index) => { corrected[index] += value; });
  }
  const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
  assert.ok(rms(corrected) < rms(before) * 0.5, `RMS error ${rms(before)} -> ${rms(corrected)}`);
  assert.ok(bands.some(band => band.frequency > 100 && band.frequency < 250 && band.gain < -3));
  assert.ok(bands.some(band => band.frequency > 1500 && band.frequency < 4000 && band.gain > 2));
  assert.ok(bands.every(band => Number.isFinite(band.Q) && band.Q > 0 && Math.abs(band.gain) <= 18));
  assert.deepEqual(response, original);
}));

test('PEQ fallback remains neutral and stays inside the requested correction band', () => quiet(() => {
  const defaults = createDefaultBands(3, 100, 10000);
  assert.deepEqual(defaults.map(band => band.frequency), [316, 1000, 3162]);
  assert.ok(defaults.every(band => band.gain === 0 && band.Q === 1.41));
  assert.equal(createDefaultBands(100).length, 15);
  assert.equal(createDefaultBands(0).length, 1);
  assert.deepEqual(designPEQ([100, 1000], [1], 3, 6, 100, 10000, 48000), defaults);
}));

test('PEQ collision handling rejects invalid bands without mutating the requested settings', () => {
  const bands = [
    { frequency: 1000, gain: 4, Q: 1 }, { frequency: 100, gain: -3, Q: 2 },
    null, { frequency: -1, gain: 3, Q: 1 }, { frequency: 200, gain: NaN, Q: 1 },
    { frequency: 300, gain: 3, Q: 0 }, { frequency: 400, gain: 0.05, Q: 1 }
  ];
  const original = structuredClone(bands);
  assert.deepEqual(processCollisions(bands, 5), [bands[1], bands[0]]);
  assert.deepEqual(bands, original);
  assert.deepEqual(processCollisions(null, 5), []);
});

test('PEQ collision reduction combines nearby same-sign bands and keeps the strongest distinct corrections', () => {
  const bands = [
    { frequency: 1000, gain: 3, Q: 3 }, { frequency: 1050, gain: 3, Q: 2 },
    { frequency: 200, gain: -5, Q: 1 }, { frequency: 5000, gain: 1, Q: 1 }
  ];
  const original = structuredClone(bands);
  const result = processCollisions(bands, 2);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], bands[2]);
  assert.equal(result[1].gain, 6);
  assert.equal(result[1].Q, 2);
  assert.ok(result[1].frequency > 1000 && result[1].frequency < 1050);
  assert.deepEqual(bands, original);
  const opposite = processCollisions([
    { frequency: 1000, gain: 6, Q: 1 }, { frequency: 1050, gain: -5, Q: 1 },
    { frequency: 5000, gain: 0.3, Q: 1 }
  ], 2);
  assert.deepEqual(opposite.map(band => band.gain), [6, -5]);
});

test('PEQ filter response has the stated center gain and inverse boost/cut responses', () => quiet(() => {
  const grid = [0, 100, 1000, 10000, 24000];
  const boost = peqResponse(grid, 1000, 6, 2, 48000);
  const cut = peqResponse(grid, 1000, -6, 2, 48000);
  assert.ok(Math.abs(boost[2] - 6) < 1e-9);
  assert.equal(boost[0], 0);
  assert.equal(boost[4], 0);
  assert.ok(boost.every((value, index) => Math.abs(value + cut[index]) < 1e-9));
  for (const [center, gain, q] of [[0, 6, 1], [24000, 6, 1], [1000, Infinity, 1], [1000, 6, 0]]) {
    assert.deepEqual(peqResponse(grid, center, gain, q, 48000), grid.map(() => 0));
  }
}));
