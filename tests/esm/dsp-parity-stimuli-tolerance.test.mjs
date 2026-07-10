import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateStimulus,
  noiseSeedForCase,
  STIMULUS_IDS,
  XorShift64
} from '../../tools/dsp-parity/stimuli.mjs';
import {
  compareAudio,
  comparePerSample,
  compareSpectral
} from '../../tools/dsp-parity/tolerance.mjs';

test('standard stimuli are deterministic finite channel-major buffers', () => {
  for (const id of STIMULUS_IDS) {
    const first = generateStimulus({ id, sampleRate: 48000, frames: 2048, channels: 3, caseIndex: 4 });
    const second = generateStimulus({ id, sampleRate: 48000, frames: 2048, channels: 3, caseIndex: 4 });
    assert.equal(first.length, 6144);
    assert.deepEqual(first, second);
    assert.equal(first.every(Number.isFinite), true);
  }
});

test('seeded noise changes by case index and XorShift64 repeats its sequence', () => {
  const firstNoise = generateStimulus({ id: 'noise', sampleRate: 48000, frames: 32, channels: 2, caseIndex: 1 });
  const secondNoise = generateStimulus({ id: 'noise', sampleRate: 48000, frames: 32, channels: 2, caseIndex: 2 });
  assert.notDeepEqual(firstNoise, secondNoise);
  assert.notEqual(noiseSeedForCase(1), noiseSeedForCase(2));

  const firstRng = new XorShift64(123n);
  const secondRng = new XorShift64(123n);
  assert.deepEqual(
    Array.from({ length: 8 }, () => firstRng.nextUint64()),
    Array.from({ length: 8 }, () => secondRng.nextUint64())
  );
});

test('impulse, full-scale, and step stimuli preserve their specified landmarks', () => {
  const impulse = generateStimulus({ id: 'imp', sampleRate: 48000, frames: 1100, channels: 2 });
  assert.equal(impulse[0], 1);
  assert.equal(impulse[1000], 1);
  assert.equal(impulse[1100], 1);
  assert.equal(impulse[1100 + 1001], 1);

  const fullScale = generateStimulus({ id: 'fs', sampleRate: 48000, frames: 4, channels: 1 });
  assert.deepEqual([...fullScale], [1, -1, 1, -1]);

  const step = generateStimulus({ id: 'step', sampleRate: 48000, frames: 6, channels: 1 });
  assert.deepEqual([...step], [0, 0, 0, 0.5, 0.5, 0.5]);
});

test('per-sample comparison reports absolute, relative, RMS, and first failure metrics', () => {
  const expected = Float32Array.from([100, 0.001, -2]);
  const close = Float32Array.from([100.005, 0.00105, -2]);
  const passing = comparePerSample(expected, close, { abs: 0.01, rel: 0.1 });
  assert.equal(passing.pass, true);
  assert.equal(passing.firstOffendingIndex, -1);
  assert.ok(passing.maxAbsError > 0);
  assert.ok(passing.rmsError > 0);

  const relativeFailure = comparePerSample(
    Float32Array.from([0.001]),
    Float32Array.from([0.0015]),
    { abs: 0.001, rel: 0.1 }
  );
  assert.equal(relativeFailure.pass, false);
  assert.equal(relativeFailure.firstOffendingIndex, 0);
  assert.equal(relativeFailure.failureCount, 1);
});

test('spectral comparison accepts identical signals and reports changed magnitudes', () => {
  const expected = generateStimulus({ id: 'sin1k', sampleRate: 48000, frames: 4096, channels: 2 });
  const identical = compareSpectral(expected, expected.slice(), { db: 0.001, fftSize: 4096 }, {
    frames: 4096,
    channels: 2
  });
  assert.equal(identical.pass, true);

  const louder = Float32Array.from(expected, value => value * 1.25);
  const changed = compareAudio(expected, louder, { policy: 'spectral', db: 0.5, fftSize: 4096 }, {
    frames: 4096,
    channels: 2
  });
  assert.equal(changed.pass, false);
  assert.ok(changed.maxDbError > 1);
  assert.ok(changed.firstOffendingBin >= 0);
});

