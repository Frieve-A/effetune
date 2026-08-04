import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  combineBluetoothSbcAudioWorkletGate,
  evaluateSbcRealtimeGate,
  SBC_REALTIME_GATE_THRESHOLDS
} from '../../tools/dsp-parity/bluetooth-sbc-audioworklet-bench.mjs';
import {
  startAudioWorkletTraceCapture,
  validateAudioWorkletAuthorSlice
} from
  '../../tools/dsp-parity/g726-audioworklet-bench.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function timing(overrides = {}) {
  return {
    averagePercent: 5,
    p99Percent: 20,
    maxPercent: 40,
    deadlineMisses: 0,
    ...overrides
  };
}

function result({ sampleRate = 96000, aggregate, trials } = {}) {
  return {
    mode: 'wasm',
    sampleRate,
    channels: 2,
    setting: 'bp53-stereo-bl4',
    quantumStats: aggregate ?? timing(),
    quantumTrials: trials ?? [timing(), timing(), timing()]
  };
}

test('SBC gate requires every trial as well as the aggregate to pass', () => {
  const evaluated = evaluateSbcRealtimeGate({
    results: [result({
      trials: [timing(), timing({ maxPercent: 80 }), timing()]
    })]
  }, {
    powerMode: 'test',
    artifactProvenance: { sourceDigest: 'test' }
  });

  assert.equal(evaluated.passed, false);
  assert.equal(evaluated.checks[0].aggregate.passed, true);
  assert.equal(evaluated.checks[0].trials[1].passed, false);
  assert.deepEqual(evaluated.checks[0].trials[1].failures, ['maxPercent']);
});

test('SBC average strict gate applies only at 96 kHz', () => {
  const highRate = evaluateSbcRealtimeGate({
    results: [result({
      sampleRate: 384000,
      aggregate: timing({ averagePercent: 20 }),
      trials: [
        timing({ averagePercent: 20 }),
        timing({ averagePercent: 20 }),
        timing({ averagePercent: 20 })
      ]
    })]
  }, {
    powerMode: 'test',
    artifactProvenance: { sourceDigest: 'test' }
  });
  const strict96k = evaluateSbcRealtimeGate({
    results: [result({ aggregate: timing({ averagePercent: 15 }) })]
  }, {
    powerMode: 'test',
    artifactProvenance: { sourceDigest: 'test' }
  });

  assert.equal(highRate.passed, true);
  assert.equal(highRate.checks[0].aggregate.averageGoalMet, false);
  assert.equal(highRate.checks[0].aggregate.averageHardGateApplied, false);
  assert.equal(strict96k.passed, false);
  assert.deepEqual(strict96k.checks[0].aggregate.failures, ['averagePercent']);
  assert.deepEqual(SBC_REALTIME_GATE_THRESHOLDS, {
    averageGoalPercent: 10,
    average96kPercent: 15,
    p99Percent: 50,
    maxPercent: 80,
    deadlineMisses: 0
  });
});

test('SBC AudioWorklet fixture uses the production schema and fixed benchmark ABI', async () => {
  const fixture = await fs.readFile(path.join(
    repoRoot, 'tools', 'dsp-parity', 'bluetooth-sbc-audioworklet-bench.html'
  ), 'utf8');

  assert.match(fixture, /bluetooth_sbc_simulator\/params\.json/);
  assert.match(fixture, /PARAMS_HASH = 0xa0d7750b/);
  assert.match(fixture, /Float32Array\.of\(\s*parameters\.bp, channelMode, blocks, parameters\.og, parameters\.mx, parameters\.pl\s*\)/);
  assert.match(fixture, /message\.state === 'active'/);
});

test('SBC backend subcampaigns combine only with matching provenance', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-sbc-combine-'));
  try {
    const createSubcampaign = mode => ({
      gate: 'bluetooth-sbc-realtime-v1',
      passed: true,
      powerMode: 'test',
      configuration: { modes: [mode] },
      artifactProvenance: { sourceDigest: 'same' },
      measurementAuthority: 'test-authority',
      timingClock: 'tdur',
      wallTimingPolicy: 'diagnostic-only',
      browserVersion: 'test',
      inputManifests: {
        stable: true,
        snapshotStability: {
          start: { aggregateSha256: 'snapshot' },
          end: { aggregateSha256: 'snapshot' }
        },
        productionEquivalence: {
          start: { aggregateSha256: 'production' },
          end: { aggregateSha256: 'production' }
        }
      },
      benchmark: {
        results: [96000, 352800, 384000].flatMap(sampleRate =>
          ['bp53-stereo-bl4', 'bp53-joint-bl4', 'bp53-dual-bl4'].map(setting => ({
            ...result({ sampleRate }),
            mode,
            setting
          })))
      }
    });
    const baselinePath = path.join(temporaryRoot, 'baseline.json');
    const simdPath = path.join(temporaryRoot, 'simd.json');
    const outputPath = path.join(temporaryRoot, 'combined.json');
    await Promise.all([
      fs.writeFile(baselinePath, JSON.stringify(createSubcampaign('wasm'))),
      fs.writeFile(simdPath, JSON.stringify(createSubcampaign('simd')))
    ]);

    const combined = await combineBluetoothSbcAudioWorkletGate({
      baselinePath,
      simdPath,
      outputPath
    });
    assert.equal(combined.passed, true);
    assert.equal(combined.benchmark.results.length, 18);
    assert.deepEqual(combined.configuration.modes, ['wasm', 'simd']);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('AudioWorklet trace accepts valid thread CPU duration beyond wall duration', () => {
  const event = { tdur: 100, dur: 100, pid: 1, tid: 2 };
  assert.equal(validateAudioWorkletAuthorSlice(event), null);
  assert.equal(validateAudioWorkletAuthorSlice({ ...event, tdur: 101 }), null);
  assert.equal(validateAudioWorkletAuthorSlice({ ...event, tdur: 101.01 }), null);
  assert.equal(
    validateAudioWorkletAuthorSlice({ ...event, tdur: Number.NaN }),
    'invalid-fields'
  );
});

test('AudioWorklet trace records thread duration excess without changing tdur', async () => {
  const cdp = new EventEmitter();
  cdp.send = async method => {
    if (method === 'Tracing.end') {
      queueMicrotask(() => cdp.emit('Tracing.tracingComplete', { dataLossOccurred: false }));
    }
  };
  const aggregateTiming = { observe() {} };
  const aggregateWallTiming = { observe() {} };
  const capture = startAudioWorkletTraceCapture(cdp, {
    sampleRate: 96000,
    aggregateTiming,
    aggregateWallTiming,
    inspectEvents: false
  });
  cdp.emit('Tracing.dataCollected', {
    value: [{
      name: 'AudioWorkletProcessor::Process (author script execution)',
      ph: 'X',
      ts: 1,
      tts: 2,
      dur: 100,
      tdur: 110,
      pid: 3,
      tid: 4
    }]
  });

  const result = await capture.stop();
  assert.equal(result.timing.maxPercent, 8.25);
  assert.equal(result.trace.threadDurationExceedsWallCount, 1);
  assert.equal(result.trace.maximumThreadDurationExcessMicroseconds, 10);
  assert.deepEqual(result.trace.threadDurationExcessSamples, [{
    index: 1,
    dur: 100,
    tdur: 110,
    delta: 10,
    pid: 3,
    tid: 4
  }]);
});

test('deferred AudioWorklet trace uses the expected tail after event-driven pre-roll', async () => {
  const cdp = new EventEmitter();
  cdp.send = async method => {
    if (method === 'Tracing.end') {
      queueMicrotask(() => cdp.emit('Tracing.tracingComplete', { dataLossOccurred: false }));
    }
  };
  const aggregateObservations = [];
  const capture = startAudioWorkletTraceCapture(cdp, {
    sampleRate: 96000,
    aggregateTiming: { observe(value) { aggregateObservations.push(value); } },
    aggregateWallTiming: { observe() {} },
    inspectEvents: false,
    deferTiming: true
  });
  const authorSlice = (ts, tdur) => ({
    name: 'AudioWorkletProcessor::Process (author script execution)',
    ph: 'X',
    ts,
    tts: ts,
    dur: tdur,
    tdur,
    pid: 3,
    tid: 4
  });
  cdp.emit('Tracing.dataCollected', {
    value: [
      authorSlice(1, 1000),
      authorSlice(2, 1000),
      authorSlice(3, 10),
      authorSlice(4, 10),
      authorSlice(5, 10)
    ]
  });

  const result = await capture.stop({ expectedAuthorSlices: 3 });
  assert.equal(result.timing.quantumCount, 3);
  assert.equal(result.timing.maxPercent, 0.75);
  assert.equal(aggregateObservations.length, 3);
  assert.equal(result.trace.capturedAuthorSlices, 5);
  assert.equal(result.trace.selectedAuthorSlices, 3);
  assert.equal(result.trace.preRollAuthorSlices, 2);
  assert.equal(result.trace.firstSelectedSlice.ts, 3);
  assert.equal(result.trace.lastSelectedSlice.ts, 5);
});

test('deferred AudioWorklet trace can finalize invalid evidence without selection', async () => {
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
    value: [{
      name: 'AudioWorkletProcessor::Process (author script execution)',
      ph: 'X',
      ts: 1,
      dur: 10,
      tdur: 9,
      pid: 3,
      tid: 4
    }]
  });

  const result = await capture.stop();
  assert.equal(result.timing, null);
  assert.equal(result.wallTiming, null);
  assert.equal(result.trace.capturedAuthorSlices, 1);
  assert.equal(result.trace.selectedAuthorSlices, null);
  assert.equal(result.trace.preRollAuthorSlices, null);
});
