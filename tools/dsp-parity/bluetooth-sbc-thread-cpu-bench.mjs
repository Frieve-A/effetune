import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceDigest } from '../../scripts/build-dsp-wasm.mjs';
import { parseArgs } from './cli.mjs';
import { runWasmCase } from './runners.mjs';
import {
  SBC_MODES,
  SBC_PLUGIN_TYPE,
  SBC_REALTIME_GATE_THRESHOLDS,
  SBC_SAMPLE_RATES,
  SBC_SETTINGS,
  createSbcProductionEquivalenceManifest,
  createSbcSnapshotStabilityManifest,
  preflightSbcArtifacts
} from './bluetooth-sbc-audioworklet-bench.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const CHANNELS = 2;
const BLOCK_SIZE = 128;
const BATCHES_PER_TRIAL = 22;
const REPETITIONS = 3;
const WARMUP_BATCHES = 2;
const INPUT_FREQUENCY_HZ = 997;
const INPUT_AMPLITUDE = 0.5;
const BATCH_QUANTA = Object.freeze({
  96000: 1024,
  352800: 4096,
  384000: 4096
});

function usage() {
  return [
    'Usage: node tools/dsp-parity/bluetooth-sbc-thread-cpu-bench.mjs --artifacts-dir <path> --json <file> --power-mode <label> [--modes wasm|simd]',
    '',
    'Runs the fixed Bluetooth SBC current-thread CPU batch gate.',
    'The scratch artifacts must include the production Bluetooth SBC kernel.'
  ].join('\n');
}

function parseModes(value) {
  if (value === undefined) return [...SBC_MODES];
  const modes = String(value).split(',').map(mode => mode.trim()).filter(Boolean);
  if (modes.length === 0 || new Set(modes).size !== modes.length ||
      modes.some(mode => !SBC_MODES.includes(mode))) {
    throw new Error('--modes must contain wasm and/or simd without duplicates.');
  }
  return modes;
}

function batchQuanta(sampleRate) {
  const value = BATCH_QUANTA[sampleRate];
  if (!value) throw new Error(`No Bluetooth SBC CPU batch contract for ${sampleRate} Hz.`);
  return value;
}

function batchFrames(sampleRate) {
  return batchQuanta(sampleRate) * BLOCK_SIZE;
}

function batchBudgetMilliseconds(sampleRate) {
  return batchFrames(sampleRate) * 1000 / sampleRate;
}

function createInput(sampleRate) {
  const frames = batchFrames(sampleRate) * BATCHES_PER_TRIAL;
  const input = new Float32Array(frames * CHANNELS);
  const phaseStep = 2 * Math.PI * INPUT_FREQUENCY_HZ / sampleRate;
  for (let frame = 0; frame < frames; frame++) {
    const value = Math.sin(frame * phaseStep) * INPUT_AMPLITUDE;
    input[frame] = value;
    input[frames + frame] = value;
  }
  return input;
}

function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function greatestCommonDivisor(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

export function describeCpuTimerResolution(results, platform = process.platform) {
  const measurements = results.flatMap(result => result.rawBatchTrials)
    .flatMap(trial => trial)
    .map(batch => batch.cpuMicroseconds)
    .filter(value => Number.isSafeInteger(value) && value > 0);
  if (measurements.length === 0) {
    throw new Error('Current-thread CPU timer produced no positive measurements.');
  }
  const observedGcdMicroseconds = measurements.reduce(greatestCommonDivisor);
  const conservativePlatformFloorMicroseconds = platform === 'win32' ? 16000 : 0;
  return {
    inference: platform === 'win32'
      ? 'max(observed-gcd, conservative-windows-accounting-tick)'
      : 'observed-gcd',
    observedGcdMicroseconds,
    conservativePlatformFloorMicroseconds,
    evaluationTickMicroseconds: Math.max(
      observedGcdMicroseconds,
      conservativePlatformFloorMicroseconds
    )
  };
}

export function inferCpuTimerTickMicroseconds(results, platform = process.platform) {
  return describeCpuTimerResolution(results, platform).evaluationTickMicroseconds;
}

function nearestRank(values, percentile) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * percentile) - 1];
}

export function summarizeSbcCpuBatches(batches, field = 'cpuMicroseconds') {
  if (!Array.isArray(batches) || batches.length === 0) {
    throw new Error('No Bluetooth SBC CPU batch observations were collected.');
  }
  const percentages = batches.map(batch => {
    const elapsedMicroseconds = batch[field];
    if (!(elapsedMicroseconds >= 0) || !(batch.budgetMicroseconds > 0)) {
      throw new Error('Invalid Bluetooth SBC CPU batch observation.');
    }
    return elapsedMicroseconds * 100 / batch.budgetMicroseconds;
  });
  const total = percentages.reduce((sum, value) => sum + value, 0);
  return {
    buildType: 'Release',
    clock: field === 'cpuMicroseconds' ? 'current-thread-cpu' : 'high-resolution-wall',
    batchCount: percentages.length,
    averagePercent: total / percentages.length,
    p99Percent: nearestRank(percentages, 0.99),
    maxPercent: Math.max(...percentages),
    batchBudgetOverruns: percentages.filter(value => value >= 100).length,
    p99Method: 'nearest-rank'
  };
}

function evaluateTiming(timing, sampleRate, timerTickMicroseconds) {
  const failures = [];
  const inconclusive = [];
  const tickPercent = timerTickMicroseconds * 100 /
    (batchBudgetMilliseconds(sampleRate) * 1000);
  const checkUpperBound = (name, value, limit, hardGate = true) => {
    if (!hardGate) return;
    if (!(value < limit)) {
      failures.push(name);
    } else if (limit - value <= tickPercent) {
      inconclusive.push(`${name}TimerResolution`);
    }
  };
  checkUpperBound(
    'averagePercent',
    timing.averagePercent,
    SBC_REALTIME_GATE_THRESHOLDS.average96kPercent,
    sampleRate === 96000
  );
  checkUpperBound('p99Percent', timing.p99Percent, SBC_REALTIME_GATE_THRESHOLDS.p99Percent);
  checkUpperBound('maxPercent', timing.maxPercent, SBC_REALTIME_GATE_THRESHOLDS.maxPercent);
  if (timing.batchBudgetOverruns !== SBC_REALTIME_GATE_THRESHOLDS.deadlineMisses) {
    failures.push('batchBudgetOverruns');
  }
  return {
    passed: failures.length === 0 && inconclusive.length === 0,
    failures,
    inconclusive,
    normalizedTimerTickPercent: tickPercent,
    averageGoalMet: timing.averagePercent <=
      SBC_REALTIME_GATE_THRESHOLDS.averageGoalPercent,
    averageHardGateApplied: sampleRate === 96000,
    timing
  };
}

export function evaluateSbcThreadCpuGate(
  benchmark,
  {
    powerMode,
    artifactProvenance,
    modes = SBC_MODES,
    timerResolution = null,
    timerTickMicroseconds = timerResolution?.evaluationTickMicroseconds
  }
) {
  if (!Number.isSafeInteger(timerTickMicroseconds) || timerTickMicroseconds <= 0) {
    throw new Error('Bluetooth SBC CPU gate requires a positive timer tick in microseconds.');
  }
  const checks = benchmark.results.map(result => {
    const aggregate = evaluateTiming(result.batchStats, result.sampleRate, timerTickMicroseconds);
    const trials = result.batchTrials.map(timing =>
      evaluateTiming(timing, result.sampleRate, timerTickMicroseconds));
    return {
      mode: result.mode,
      sampleRate: result.sampleRate,
      channels: result.channels,
      setting: result.setting,
      passed: aggregate.passed && trials.every(trial => trial.passed),
      aggregate,
      trials
    };
  });
  return {
    gate: 'bluetooth-sbc-current-thread-cpu-batch-v1',
    passed: checks.every(check => check.passed),
    thresholds: {
      averageGoalPercent: SBC_REALTIME_GATE_THRESHOLDS.averageGoalPercent,
      average96kPercent: SBC_REALTIME_GATE_THRESHOLDS.average96kPercent,
      p99Percent: SBC_REALTIME_GATE_THRESHOLDS.p99Percent,
      maxPercent: SBC_REALTIME_GATE_THRESHOLDS.maxPercent,
      batchBudgetOverruns: 0,
      resolutionBoundaryPolicy: 'within-one-normalized-timer-tick-is-inconclusive-fail'
    },
    configuration: {
      modes,
      sampleRates: SBC_SAMPLE_RATES,
      channels: CHANNELS,
      blockSize: BLOCK_SIZE,
      batchesPerTrial: BATCHES_PER_TRIAL,
      repetitions: REPETITIONS,
      warmupBatches: WARMUP_BATCHES,
      input: { type: 'sine', frequencyHz: INPUT_FREQUENCY_HZ, amplitude: INPUT_AMPLITUDE },
      settings: SBC_SETTINGS,
      rateBatches: Object.fromEntries(SBC_SAMPLE_RATES.map(sampleRate => [sampleRate, {
        quanta: batchQuanta(sampleRate),
        frames: batchFrames(sampleRate),
        budgetMilliseconds: batchBudgetMilliseconds(sampleRate),
        trialAudioSeconds: batchFrames(sampleRate) * BATCHES_PER_TRIAL / sampleRate
      }]))
    },
    powerMode,
    machine: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model ?? 'unknown',
      processPriority: os.getPriority()
    },
    timerResolution: {
      ...(timerResolution ?? {
        inference: 'explicit-evaluation-tick',
        observedGcdMicroseconds: timerTickMicroseconds,
        conservativePlatformFloorMicroseconds: 0,
        evaluationTickMicroseconds: timerTickMicroseconds
      }),
      rawTickMicroseconds: timerTickMicroseconds,
      normalizedTickPercentBySampleRate: Object.fromEntries(SBC_SAMPLE_RATES.map(sampleRate => [
        sampleRate,
        timerTickMicroseconds * 100 / (batchBudgetMilliseconds(sampleRate) * 1000)
      ]))
    },
    artifactProvenance,
    checks,
    benchmark
  };
}

function workSignature(trial) {
  return trial.map(batch => ({
    processCalls: batch.processCalls,
    blockFrames: batch.blockFrames,
    budgetMicroseconds: batch.budgetMicroseconds
  }));
}

export function assertIdenticalModeWork(results, modes) {
  if (modes.length < 2) return;
  const referenceMode = modes[0];
  for (const result of results.filter(entry => entry.mode !== referenceMode)) {
    const reference = results.find(entry =>
      entry.mode === referenceMode && entry.sampleRate === result.sampleRate &&
      entry.setting === result.setting);
    if (!reference || JSON.stringify(reference.rawBatchTrials.map(workSignature)) !==
        JSON.stringify(result.rawBatchTrials.map(workSignature))) {
      throw new Error(
        `Bluetooth SBC batch work differs between ${referenceMode} and ${result.mode} ` +
        `at ${result.sampleRate} Hz ${result.setting}.`
      );
    }
  }
}

async function runTrial({ artifactPath, mode, sampleRate, setting, schema, input }) {
  const rawBatches = [];
  const quanta = batchQuanta(sampleRate);
  const frames = batchFrames(sampleRate) * BATCHES_PER_TRIAL;
  await runWasmCase({
    type: SBC_PLUGIN_TYPE,
    testCase: {
      id: `sbc-cpu-${sampleRate}-${setting.id}`,
      sampleRate,
      channels: CHANNELS,
      blockSize: BLOCK_SIZE,
      frames,
      seed: 0x534243n,
      params: setting.parameters
    },
    input,
    schema,
    variant: mode === 'simd' ? 'simd' : 'baseline',
    wasmPath: artifactPath,
    repoRoot: REPO_ROOT,
    processWarmupCalls: quanta * WARMUP_BATCHES,
    processBatchCalls: quanta,
    collectOutput: false,
    onProcessBatch(observation) {
      if (observation.clock !== 'current-thread-cpu' ||
          observation.wallClock !== 'high-resolution-wall') {
        throw new Error(
          `Bluetooth SBC CPU batch used unsupported clocks ${observation.clock}/` +
          `${observation.wallClock}.`
        );
      }
      rawBatches.push({
        cpuMicroseconds: Math.round(observation.elapsedMilliseconds * 1000),
        wallMicroseconds: Math.round(observation.wallElapsedMilliseconds * 1000),
        processCalls: observation.processCalls,
        blockFrames: observation.blockFrames,
        budgetMicroseconds: Math.round(observation.blockFrames * 1_000_000 / sampleRate)
      });
    }
  });
  if (rawBatches.length !== BATCHES_PER_TRIAL || rawBatches.some(batch =>
    batch.processCalls !== quanta || batch.blockFrames !== batchFrames(sampleRate))) {
    throw new Error(
      `Bluetooth SBC CPU trial produced an invalid batch workload at ${sampleRate} Hz.`
    );
  }
  return {
    rawBatches,
    cpu: summarizeSbcCpuBatches(rawBatches),
    wall: summarizeSbcCpuBatches(rawBatches, 'wallMicroseconds')
  };
}

function artifactProvenance(artifactSet, baselineSha256, simdSha256) {
  return {
    root: artifactSet.root,
    sourceDigest: artifactSet.metadata.sourceDigest,
    emsdkVersion: artifactSet.metadata.emsdkVersion,
    abiVersion: artifactSet.metadata.abiVersion,
    baseline: {
      sha256: baselineSha256,
      buildFlags: artifactSet.baseline.buildFlags,
      bytes: artifactSet.baseline.bytes
    },
    simd: {
      sha256: simdSha256,
      buildFlags: artifactSet.simd.buildFlags,
      bytes: artifactSet.simd.bytes
    }
  };
}

export async function runBluetoothSbcThreadCpuGate({
  artifactsDir,
  outputPath,
  powerMode,
  modes = SBC_MODES
}) {
  const startedAt = new Date().toISOString();
  const [startStabilityManifest, startProductionEquivalenceManifest] = await Promise.all([
    createSbcSnapshotStabilityManifest(),
    createSbcProductionEquivalenceManifest()
  ]);
  const { artifactSet, baselineSha256, simdSha256 } =
    await preflightSbcArtifacts(artifactsDir);
  const schema = JSON.parse(await fs.readFile(path.join(
    REPO_ROOT,
    'dsp',
    'plugins',
    'lofi',
    'bluetooth_sbc_simulator',
    'params.json'
  ), 'utf8'));
  const results = [];
  const digestBoundaries = [];
  const inputProvenance = [];
  for (const sampleRate of SBC_SAMPLE_RATES) {
    const input = createInput(sampleRate);
    inputProvenance.push({
      sampleRate,
      frames: input.length / CHANNELS,
      sha256: sha256Bytes(new Uint8Array(input.buffer))
    });
    for (const mode of modes) {
      for (const setting of SBC_SETTINGS) {
        const boundaryDigest = sourceDigest();
        const boundaryManifest = await createSbcSnapshotStabilityManifest();
        if (boundaryDigest !== artifactSet.metadata.sourceDigest ||
            boundaryManifest.aggregateSha256 !== startStabilityManifest.aggregateSha256) {
          throw new Error(
            `Snapshot inputs changed before ${mode} ${sampleRate} Hz ${setting.id}; ` +
            'the complete CPU campaign is invalid.'
          );
        }
        digestBoundaries.push({
          mode,
          sampleRate,
          setting: setting.id,
          sourceDigest: boundaryDigest,
          stabilityManifest: boundaryManifest.aggregateSha256
        });
        const trials = [];
        for (let repetition = 0; repetition < REPETITIONS; repetition++) {
          process.stdout.write(
            `Bluetooth SBC thread CPU ${mode} ${sampleRate} Hz ${setting.id} ` +
            `trial ${repetition + 1}/${REPETITIONS}\n`
          );
          trials.push(await runTrial({
            artifactPath: mode === 'simd'
              ? artifactSet.simdPath
              : artifactSet.baselinePath,
            mode,
            sampleRate,
            setting,
            schema,
            input
          }));
        }
        const rawBatchTrials = trials.map(trial => trial.rawBatches);
        results.push({
          mode,
          sampleRate,
          channels: CHANNELS,
          setting: setting.id,
          parameters: setting.parameters,
          batchStats: summarizeSbcCpuBatches(rawBatchTrials.flat()),
          batchTrials: trials.map(trial => trial.cpu),
          wallStats: summarizeSbcCpuBatches(rawBatchTrials.flat(), 'wallMicroseconds'),
          wallTrials: trials.map(trial => trial.wall),
          rawBatchTrials
        });
      }
    }
  }
  assertIdenticalModeWork(results, modes);
  const timerResolution = describeCpuTimerResolution(results);
  const provenance = artifactProvenance(artifactSet, baselineSha256, simdSha256);
  const evaluated = evaluateSbcThreadCpuGate({ results }, {
    powerMode,
    artifactProvenance: provenance,
    modes,
    timerResolution
  });
  const finalDigest = sourceDigest();
  const [endStabilityManifest, endProductionEquivalenceManifest] = await Promise.all([
    createSbcSnapshotStabilityManifest(),
    createSbcProductionEquivalenceManifest()
  ]);
  const inputsStable = startStabilityManifest.aggregateSha256 ===
    endStabilityManifest.aggregateSha256 &&
    startProductionEquivalenceManifest.aggregateSha256 ===
    endProductionEquivalenceManifest.aggregateSha256;
  const output = {
    ...evaluated,
    passed: evaluated.passed && finalDigest === artifactSet.metadata.sourceDigest && inputsStable,
    measurementAuthority: 'isolated-node-current-thread-cpu-fixed-batch-v1',
    timingClock: 'process.threadCpuUsage()',
    wallTimingPolicy: 'diagnostic-only',
    workEquality: {
      modes,
      identical: true,
      signatureSha256: sha256Bytes(Buffer.from(JSON.stringify(
        results.filter(result => result.mode === modes[0])
          .map(result => result.rawBatchTrials.map(workSignature))
      )))
    },
    inputProvenance,
    digestBoundaries,
    inputManifests: {
      stable: inputsStable,
      snapshotStability: { start: startStabilityManifest, end: endStabilityManifest },
      productionEquivalence: {
        start: startProductionEquivalenceManifest,
        end: endProductionEquivalenceManifest
      }
    },
    artifactCurrentAtCompletion: finalDigest === artifactSet.metadata.sourceDigest,
    finalSourceDigest: finalDigest,
    startedAt,
    completedAt: new Date().toISOString()
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  if (!output.passed) {
    throw new Error(`Bluetooth SBC current-thread CPU hard gate failed; see ${outputPath}`);
  }
  return output;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args['artifacts-dir'] || !args.json || !args['power-mode']) {
    throw new Error(usage());
  }
  await runBluetoothSbcThreadCpuGate({
    artifactsDir: path.resolve(REPO_ROOT, String(args['artifacts-dir'])),
    outputPath: path.resolve(REPO_ROOT, String(args.json)),
    powerMode: String(args['power-mode']),
    modes: parseModes(args.modes)
  });
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
