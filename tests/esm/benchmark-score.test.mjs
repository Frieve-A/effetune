import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BENCHMARK_SCORE_EFFECTS,
  BENCHMARK_SCORE_PROTOCOL,
  BENCHMARK_SCORE_VERSION,
  computeBenchmarkScore,
  formatScore,
  median
} from '../../features/effetune-benchmark-score.js';
import { BENCHMARK_SCORE_REFERENCE } from '../../features/benchmark-score-reference.js';
import { SHIPPED_ENABLED_TYPES } from '../../js/audio/dsp-rollout.js';

const effectNames = BENCHMARK_SCORE_EFFECTS.map(effect => effect.name);

function referenceValues(value = 1) {
  return Object.fromEntries(effectNames.map(name => [name, value]));
}

test('score is 100 at reference performance and scales linearly', () => {
  const reference = { effects: referenceValues(2) };
  assert.equal(computeBenchmarkScore(referenceValues(2), reference).score, 100);
  assert.equal(computeBenchmarkScore(referenceValues(4), reference).score, 200);
});

test('score uses the geometric mean of normalized effect ratios', () => {
  const measured = referenceValues(1);
  measured['5Band PEQ'] = 4;
  const result = computeBenchmarkScore(measured, { effects: referenceValues(1) });
  assert.ok(Math.abs(result.score - 100 * Math.pow(4, 1 / 6)) < 1e-10);
  assert.equal(result.ratios['5Band PEQ'], 4);
});

test('score rejects incomplete or invalid effect measurements', () => {
  for (const invalid of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const measured = referenceValues(1);
    measured.Delay = invalid;
    const result = computeBenchmarkScore(measured, { effects: referenceValues(1) });
    assert.equal(result.complete, false);
    assert.equal(result.score, null);
    assert.deepEqual(result.missing, ['Delay']);
  }
});

test('score helpers use stable display and median rules', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([3, 1, 4, 2]), 2.5);
  assert.equal(formatScore(99.94), '99.9');
  assert.equal(formatScore(100.4), '100');
});

test('selected effects are shipped, named in the plugin catalog, and non-identity', () => {
  assert.equal(BENCHMARK_SCORE_EFFECTS.length, 6);
  assert.equal(new Set(effectNames).size, BENCHMARK_SCORE_EFFECTS.length);
  const catalog = readFileSync(new URL('../../plugins/plugins.txt', import.meta.url), 'utf8');
  for (const effect of BENCHMARK_SCORE_EFFECTS) {
    assert.ok(SHIPPED_ENABLED_TYPES.includes(effect.className));
    assert.match(catalog, new RegExp(`: ${effect.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|`));
  }
  assert.deepEqual(BENCHMARK_SCORE_EFFECTS[0].parameters, { g0: 1, g1: -1, g2: 1, g3: -1, g4: 1 });
  assert.deepEqual(BENCHMARK_SCORE_EFFECTS.at(-1).parameters, { ps: 1 });
  assert.equal(effectNames.includes('IR Reverb'), false);
  assert.equal(effectNames.includes('Room EQ'), false);
});

test('generated reference matches the score protocol and has complete provenance', () => {
  assert.equal(BENCHMARK_SCORE_REFERENCE.version, BENCHMARK_SCORE_VERSION);
  assert.equal(BENCHMARK_SCORE_REFERENCE.mode, 'simd');
  for (const key of ['sampleRate', 'channelCount', 'blockSize', 'inputSeconds']) {
    assert.equal(BENCHMARK_SCORE_REFERENCE[key], BENCHMARK_SCORE_PROTOCOL[key]);
  }
  assert.ok(Number.isFinite(BENCHMARK_SCORE_REFERENCE.browserCalibrationScale));
  assert.ok(BENCHMARK_SCORE_REFERENCE.browserCalibrationScale > 0);
  assert.deepEqual(Object.keys(BENCHMARK_SCORE_REFERENCE.effects).sort(), [...effectNames].sort());
  for (const value of Object.values(BENCHMARK_SCORE_REFERENCE.effects)) {
    assert.ok(Number.isFinite(value));
    assert.ok(value > 0);
  }
  for (const key of ['capturedAt', 'machine', 'node', 'commit']) {
    assert.equal(typeof BENCHMARK_SCORE_REFERENCE[key], 'string');
    assert.ok(BENCHMARK_SCORE_REFERENCE[key].length > 0);
  }
});
