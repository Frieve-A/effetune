import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertIdenticalModeWork,
  describeCpuTimerResolution,
  evaluateSbcThreadCpuGate,
  inferCpuTimerTickMicroseconds,
  summarizeSbcCpuBatches
} from '../../tools/dsp-parity/bluetooth-sbc-thread-cpu-bench.mjs';

const BUDGET_96K_MICROSECONDS = Math.round(1024 * 128 * 1_000_000 / 96000);

function rawBatch(percent, budgetMicroseconds = BUDGET_96K_MICROSECONDS) {
  return {
    cpuMicroseconds: Math.round(percent * budgetMicroseconds / 100),
    wallMicroseconds: Math.round(percent * budgetMicroseconds / 100),
    processCalls: 1024,
    blockFrames: 1024 * 128,
    budgetMicroseconds
  };
}

function resultFor(mode, percentages, sampleRate = 96000) {
  const raw = percentages.map(percent => rawBatch(percent));
  const timing = summarizeSbcCpuBatches(raw);
  return {
    mode,
    sampleRate,
    channels: 2,
    setting: 'bp53-stereo-bl4',
    batchStats: timing,
    batchTrials: [timing, timing, timing],
    rawBatchTrials: [raw, raw, raw]
  };
}

test('Bluetooth SBC batch summary uses exact nearest-rank p99', () => {
  const percentages = [...Array(21).fill(10), 49];
  const summary = summarizeSbcCpuBatches(percentages.map(percent => rawBatch(percent)));
  assert.equal(summary.batchCount, 22);
  assert.equal(summary.p99Method, 'nearest-rank');
  assert.equal(summary.p99Percent, summary.maxPercent);
  assert.equal(summary.batchBudgetOverruns, 0);
});

test('Bluetooth SBC CPU gate applies the 96 kHz average gate to every trial and aggregate', () => {
  const passing = resultFor('wasm', Array(22).fill(10));
  const failing = resultFor('simd', Array(22).fill(16));
  const evaluated = evaluateSbcThreadCpuGate({ results: [passing, failing] }, {
    powerMode: 'test',
    artifactProvenance: {},
    modes: ['wasm', 'simd'],
    timerTickMicroseconds: 1
  });
  assert.equal(evaluated.passed, false);
  assert.equal(evaluated.checks[0].passed, true);
  assert.deepEqual(evaluated.checks[1].aggregate.failures, ['averagePercent']);
  assert.ok(evaluated.checks[1].trials.every(trial =>
    trial.failures.includes('averagePercent')));
});

test('Bluetooth SBC CPU gate fails closed within one normalized timer tick', () => {
  const nearBoundary = resultFor('wasm', [...Array(21).fill(10), 49.95]);
  const evaluated = evaluateSbcThreadCpuGate({ results: [nearBoundary] }, {
    powerMode: 'test',
    artifactProvenance: {},
    modes: ['wasm'],
    timerTickMicroseconds: 1000
  });
  assert.equal(evaluated.passed, false);
  assert.deepEqual(
    evaluated.checks[0].aggregate.inconclusive,
    ['p99PercentTimerResolution']
  );
});

test('Bluetooth SBC CPU timer tick is inferred from raw microsecond quanta', () => {
  const first = resultFor('wasm', Array(22).fill(10));
  const second = resultFor('simd', Array(22).fill(10));
  first.rawBatchTrials[0][0].cpuMicroseconds = 31250;
  second.rawBatchTrials[0][0].cpuMicroseconds = 46875;
  for (const result of [first, second]) {
    for (const trial of result.rawBatchTrials) {
      for (const batch of trial) batch.cpuMicroseconds = 31250;
    }
  }
  second.rawBatchTrials[0][0].cpuMicroseconds = 46875;
  const windows = describeCpuTimerResolution([first, second], 'win32');
  assert.equal(windows.observedGcdMicroseconds, 15625);
  assert.equal(windows.conservativePlatformFloorMicroseconds, 16000);
  assert.equal(windows.evaluationTickMicroseconds, 16000);
  assert.equal(inferCpuTimerTickMicroseconds([first, second], 'linux'), 15625);
});

test('Bluetooth SBC baseline and SIMD work multisets must match', () => {
  const baseline = resultFor('wasm', Array(22).fill(10));
  const simd = resultFor('simd', Array(22).fill(10));
  assert.doesNotThrow(() => assertIdenticalModeWork([baseline, simd], ['wasm', 'simd']));
  simd.rawBatchTrials[0][0].processCalls++;
  assert.throws(
    () => assertIdenticalModeWork([baseline, simd], ['wasm', 'simd']),
    /batch work differs/
  );
});
