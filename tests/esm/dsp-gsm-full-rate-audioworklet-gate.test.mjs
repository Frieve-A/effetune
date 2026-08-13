import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  createGsmCpuAggregate,
  evaluateGsmFullRateRealtimeGate,
  gsmServedAssetHashMismatches,
  GSM_FULL_RATE_AUDIOWORKLET_CONFIGURATION,
  GSM_FULL_RATE_REALTIME_THRESHOLDS,
  validateGsmSourceDigest
} from '../../tools/dsp-parity/gsm-full-rate-audioworklet-bench.mjs';
import { startAudioWorkletTraceCapture } from
  '../../tools/dsp-parity/g726-audioworklet-bench.mjs';

const CLOCK = 'chromium-audioworklet-raw-thread-cpu-aggregate';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function cpuAggregate(cpuUtilizationPercent = 9, overrides = {}) {
  const formalRenderDurationMilliseconds = 30_000;
  return {
    clock: CLOCK,
    clockPolicy: 'sum(raw tdur) / formal render duration',
    rawThreadCpuTotalMilliseconds:
      cpuUtilizationPercent * formalRenderDurationMilliseconds / 100,
    formalRenderDurationMilliseconds,
    cpuUtilizationPercent,
    quantumCount: 22_500,
    ...overrides
  };
}

function benchmark(overrides = {}) {
  const results = [];
  for (const sampleRate of [96000, 352800, 384000]) {
    for (const mode of ['wasm', 'simd']) {
      const selected = overrides[`${mode}:${sampleRate}`] ?? {};
      const trials = [cpuAggregate(), cpuAggregate(), cpuAggregate()];
      for (const [index, trial] of Object.entries(selected.trials ?? {})) {
        trials[Number(index)] = cpuAggregate(trial.cpuUtilizationPercent, trial);
      }
      const aggregate = cpuAggregate(
        trials.reduce((total, trial) => total + trial.cpuUtilizationPercent, 0) /
          trials.length,
        selected.aggregate
      );
      results.push({
        mode,
        sampleRate,
        channels: 2,
        blockSize: 128,
        pluginType: 'GSMFullRateSimulatorPlugin',
        parameters: { tc: 3, og: 0, mx: 100, ci: 30 },
        stimulus: 'noise',
        cpuAggregate: aggregate,
        cpuTrials: trials,
        quantumStats: {
          clock: 'diagnostic', averagePercent: 999, p99Percent: 999,
          maxPercent: 999, deadlineMisses: 999
        },
        quantumTrials: [{}, {}, {}],
        wallTrials: [{}, {}, {}],
        traceTrials: [{}, {}, {}]
      });
    }
  }
  return { results };
}

function evaluate(input) {
  return evaluateGsmFullRateRealtimeGate(input, {
    powerMode: 'test',
    artifactProvenance: { sourceDigest: 'test' }
  });
}

test('GSM AudioWorklet gate fixes the complete formal configuration and CPU boundary', () => {
  assert.deepEqual(GSM_FULL_RATE_AUDIOWORKLET_CONFIGURATION, {
    modes: ['wasm', 'simd'],
    sampleRates: [96000, 352800, 384000],
    channels: 2,
    blockSize: 128,
    warmupSeconds: 1,
    durationSeconds: 30,
    repetitions: 3,
    pluginType: 'GSMFullRateSimulatorPlugin',
    parameters: { tc: 3, og: 0, mx: 100, ci: 30 },
    stimulus: 'noise'
  });
  assert.equal(evaluate(benchmark()).passed, true);
  assert.deepEqual(GSM_FULL_RATE_REALTIME_THRESHOLDS, {
    hardLimitPercent: 15,
    goalPercent: 10
  });
  assert.equal(evaluate(benchmark({
    'wasm:96000': { trials: { 0: { cpuUtilizationPercent: 14.99 } } }
  })).passed, true);
  const boundary = evaluate(benchmark({
    'wasm:96000': { trials: { 0: { cpuUtilizationPercent: 15 } } }
  }));
  assert.equal(boundary.passed, false);
  assert.deepEqual(boundary.checks.find(check =>
    check.mode === 'wasm' && check.sampleRate === 96000
  ).trials[0].failures, ['cpuUtilizationPercent']);
});

test('GSM AudioWorklet gate records the 10 percent goal separately', () => {
  assert.equal(evaluate(benchmark({
    'simd:384000': { trials: { 1: { cpuUtilizationPercent: 10 } } }
  })).goalMet, true);
  const aboveGoal = evaluate(benchmark({
    'simd:384000': { trials: { 1: { cpuUtilizationPercent: 10.01 } } }
  }));
  assert.equal(aboveGoal.passed, true);
  assert.equal(aboveGoal.goalMet, false);
});

test('GSM AudioWorklet gate rejects an incomplete campaign', () => {
  const input = benchmark();
  input.results.pop();
  assert.throws(
    () => evaluate(input),
    /incomplete result matrix/
  );
});

test('GSM artifact provenance requires an exact current source digest', () => {
  const expected = `sha256:${'a'.repeat(64)}`;
  assert.doesNotThrow(() => validateGsmSourceDigest({ sourceDigest: expected }, expected));
  assert.throws(
    () => validateGsmSourceDigest({ sourceDigest: `${expected}0` }, expected),
    /source digest does not match/
  );
  assert.throws(
    () => validateGsmSourceDigest({ sourceDigest: expected.slice(0, -1) }, expected),
    /source digest does not match/
  );
});

test('GSM campaign revalidates artifact provenance before writing valid evidence', async () => {
  const source = await fs.readFile(path.join(
    repoRoot, 'tools', 'dsp-parity', 'gsm-full-rate-audioworklet-bench.mjs'
  ), 'utf8');
  assert.match(
    source,
    /const finalDigest = sourceDigest\(\);\s*validateGsmSourceDigest\(artifactSet\.metadata, finalDigest\);\s*const output =/
  );
});

test('GSM fixture packs its four floats without production runtime exports', async () => {
  const source = await fs.readFile(path.join(
    repoRoot, 'tools', 'dsp-parity', 'gsm-full-rate-audioworklet-bench.html'
  ), 'utf8');
  assert.doesNotMatch(source, /dsp-params\.generated\.js/);
  assert.doesNotMatch(source, /packGSMFullRateSimulatorPluginParams/);
  assert.match(source, /const PARAMS_HASH = 0xb9a2741c/);
  assert.match(
    source,
    /Float32Array\.of\(\s*transcodes,\s*outputGain,\s*mix,\s*carrierToInterference\s*\)/
  );
  // The fixture must pack the transcode count itself, not an option index.
  assert.doesNotMatch(source, /\['1', '2', '3'\]\.indexOf/);
  assert.match(
    source,
    /Math\.min\(3, Math\.max\(1, Math\.round\(params\.tc\)\)\)/
  );
});

async function captureRawTail(wallDurations) {
  const cdp = new EventEmitter();
  cdp.send = async method => {
    if (method === 'Tracing.end') {
      queueMicrotask(() => cdp.emit('Tracing.tracingComplete', { dataLossOccurred: false }));
    }
  };
  const capture = startAudioWorkletTraceCapture(cdp, {
    sampleRate: 96000,
    aggregateTiming: { observe() {} },
    aggregateWallTiming: { observe() {} },
    inspectEvents: false,
    deferTiming: true
  });
  cdp.emit('Tracing.dataCollected', {
    value: [100, 200, 300].map((tdur, index) => ({
      name: 'AudioWorkletProcessor::Process (author script execution)',
      ph: 'X',
      ts: index + 1,
      tts: index + 1,
      dur: wallDurations[index],
      tdur,
      pid: 3,
      tid: 4
    }))
  });
  return capture.stop({ expectedAuthorSlices: 2 });
}

test('GSM raw thread CPU aggregate sums the exact tail independent of wall duration', async () => {
  const normalWall = await captureRawTail([120, 220, 320]);
  const unrelatedWall = await captureRawTail([10_000, 1, 50_000]);
  assert.equal(normalWall.trace.selectedAuthorSlices, 2);
  assert.equal(normalWall.trace.preRollAuthorSlices, 1);
  assert.equal(normalWall.trace.selectedRawThreadDurationMicroseconds, 500);
  assert.equal(unrelatedWall.trace.selectedRawThreadDurationMicroseconds, 500);

  const normalAggregate = createGsmCpuAggregate({
    rawThreadCpuTotalMicroseconds:
      normalWall.trace.selectedRawThreadDurationMicroseconds,
    formalRenderDurationMilliseconds: 10,
    quantumCount: 2
  });
  const unrelatedWallAggregate = createGsmCpuAggregate({
    rawThreadCpuTotalMicroseconds:
      unrelatedWall.trace.selectedRawThreadDurationMicroseconds,
    formalRenderDurationMilliseconds: 10,
    quantumCount: 2
  });
  assert.deepEqual(normalAggregate, unrelatedWallAggregate);
  assert.equal(normalAggregate.rawThreadCpuTotalMilliseconds, 0.5);
  assert.equal(normalAggregate.cpuUtilizationPercent, 5);
  assert.equal(normalAggregate.clock, CLOCK);
});

test('GSM served asset hash comparison rejects missing or changed bytes', () => {
  const expected = {
    fixture: { bytes: 10, sha256: 'same' },
    baselineWasm: { bytes: 20, sha256: 'wasm' }
  };
  assert.deepEqual(gsmServedAssetHashMismatches(expected, {
    fixture: { bytes: 10, sha256: 'same' },
    baselineWasm: { bytes: 20, sha256: 'wasm' }
  }, ['fixture', 'baselineWasm']), []);
  assert.deepEqual(gsmServedAssetHashMismatches(expected, {
    fixture: { bytes: 10, sha256: 'changed' }
  }, ['fixture', 'baselineWasm']), [
    'fixture:content-drift',
    'baselineWasm:not-served'
  ]);
});
