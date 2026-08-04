import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflightArtifactDirectory } from './bench.mjs';
import { discoverCasePlan } from './cases.mjs';
import { parseArgs, isMain } from './cli.mjs';
import { g726PerformanceInputManifest } from './g726-performance-inputs.mjs';
import { runWasmCase } from './runners.mjs';
import { generateStimulus } from './stimuli.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAMPLE_RATES = Object.freeze([96000, 352800, 384000]);
const MODES = Object.freeze(['wasm', 'simd']);
const BLOCK_SIZE = 128;
const CHANNELS = 2;
const DURATION_SECONDS = 30;
const REPETITIONS = 3;
const MINIMUM_CLOCK_ALLOWANCE_MICROSECONDS = 16000;

export const G726_CPU_GATE_THRESHOLDS = Object.freeze({
  averagePercent: 15,
  modeledP99Percent: 50,
  modeledMaxPercent: 80,
  modeledDeadlinePercent: 100
});

const WORK_MODEL = Object.freeze({
  rationalTapIterations: 383,
  halfbandConvolutionIterations: 33,
  halfbandInterpolationIterations: 34,
  codecRoundTripPrimitiveUpperBound: 1024,
  generatedWetSamplePrimitiveUpperBound: 16
});

function gcd(left, right) {
  let a = left;
  let b = right;
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

class RationalSchedule {
  constructor(inputRate, outputRate) {
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    this.phaseStep = gcd(inputRate, outputRate);
    this.inputIndex = 0;
    this.nextOutputNumerator = 0;
  }

  push() {
    const currentNumerator = this.inputIndex * this.outputRate;
    let count = 0;
    while (this.nextOutputNumerator <= currentNumerator && count < 6) {
      count++;
      this.nextOutputNumerator += this.inputRate;
    }
    this.inputIndex++;
    return count;
  }
}

function summarize(values) {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let total = 0;
  for (const value of values) {
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
    total += value;
  }
  return { minimum, maximum, average: total / values.length };
}

export function analyzeG726QuantumWork(sampleRate, {
  blockSize = BLOCK_SIZE,
  durationSeconds = DURATION_SECONDS
} = {}) {
  if (!SAMPLE_RATES.includes(sampleRate) || blockSize !== BLOCK_SIZE) {
    throw new Error('G.726 CPU gate work analysis only supports the formal 128-frame matrix');
  }
  const baseRate = sampleRate === 352800 ? 44100 : 48000;
  const halfbandStages = sampleRate === 96000 ? 1 : 3;
  const halfbandPhases = new Uint8Array(halfbandStages);
  const downsampler = new RationalSchedule(baseRate, 8000);
  const upsampler = new RationalSchedule(8000, baseRate);
  const quantumCount = Math.ceil(sampleRate * durationSeconds / blockSize);
  const codecTicks = [];
  const baseOutputs = [];
  const wetOutputs = [];
  const filterWork = [];
  const upperWork = [];
  const patterns = new Set();

  for (let quantum = 0; quantum < quantumCount; quantum++) {
    let quantumCodecTicks = 0;
    let quantumBaseOutputs = 0;
    for (let frame = 0; frame < blockSize; frame++) {
      let reachesBaseRate = true;
      for (let stage = 0; stage < halfbandStages; stage++) {
        halfbandPhases[stage] ^= 1;
        if (halfbandPhases[stage] !== 0) {
          reachesBaseRate = false;
          break;
        }
      }
      if (!reachesBaseRate) continue;
      const generatedCodecTicks = downsampler.push();
      quantumCodecTicks += generatedCodecTicks;
      for (let tick = 0; tick < generatedCodecTicks; tick++) {
        quantumBaseOutputs += upsampler.push();
      }
    }

    const inputHalfbandConvolutions = halfbandStages === 1 ? 64 : 112;
    const quantumWetOutputs = quantumBaseOutputs * (1 << halfbandStages);
    const outputHalfbandInterpolations =
      quantumBaseOutputs * ((1 << halfbandStages) - 1);
    const quantumFilterWork =
      inputHalfbandConvolutions * WORK_MODEL.halfbandConvolutionIterations +
      quantumCodecTicks * WORK_MODEL.rationalTapIterations +
      quantumBaseOutputs * WORK_MODEL.rationalTapIterations +
      outputHalfbandInterpolations * WORK_MODEL.halfbandInterpolationIterations;
    const quantumUpperWork =
      quantumFilterWork +
      quantumCodecTicks * WORK_MODEL.codecRoundTripPrimitiveUpperBound +
      quantumWetOutputs * WORK_MODEL.generatedWetSamplePrimitiveUpperBound;

    codecTicks.push(quantumCodecTicks);
    baseOutputs.push(quantumBaseOutputs);
    wetOutputs.push(quantumWetOutputs);
    filterWork.push(quantumFilterWork);
    upperWork.push(quantumUpperWork);
    patterns.add(`${quantumCodecTicks}/${quantumBaseOutputs}/${quantumWetOutputs}`);
  }

  const filterSummary = summarize(filterWork);
  const upperSummary = summarize(upperWork);
  return {
    sampleRate,
    blockSize,
    renderedFrames: quantumCount * blockSize,
    renderedDurationSeconds: quantumCount * blockSize / sampleRate,
    quantumCount,
    halfbandStages,
    inputHalfbandConvolutionsPerQuantum: halfbandStages === 1 ? 64 : 112,
    codecTicks: summarize(codecTicks),
    baseRateOutputs: summarize(baseOutputs),
    wetOutputs: summarize(wetOutputs),
    observedSchedulePatterns: [...patterns],
    filterWork: filterSummary,
    conservativeUpperWork: upperSummary,
    maxWorkToAverageWorkRatio: upperSummary.maximum / filterSummary.average,
    workUnits: WORK_MODEL,
    conservatism: [
      'The maximum numerator charges every codec tick at a 1024-primitive ceiling.',
      'The maximum numerator charges queue and cascade bookkeeping at 16 primitives per wet sample.',
      'The average denominator contains FIR tap iterations only; fixed host, dry, mix, and control work is omitted.',
      'A scalar integer primitive is charged at the same unit cost as a floating-point FIR tap iteration.'
    ]
  };
}

export function evaluateG726AggregateCpuGate({
  trials,
  workAnalysis,
  clockQuantumMicroseconds
}) {
  const workByRate = new Map(workAnalysis.map(entry => [entry.sampleRate, entry]));
  const quantizationAllowanceMicroseconds = Math.max(
    MINIMUM_CLOCK_ALLOWANCE_MICROSECONDS,
    clockQuantumMicroseconds
  );
  const checks = trials.map(trial => {
    const work = workByRate.get(trial.sampleRate);
    if (!work) throw new Error(`Missing G.726 work analysis for ${trial.sampleRate} Hz`);
    const durationMicroseconds = trial.renderedDurationSeconds * 1000000;
    const rawAveragePercent = trial.cpu.totalMicroseconds * 100 / durationMicroseconds;
    const quantizationAdjustedAveragePercent =
      (trial.cpu.totalMicroseconds + quantizationAllowanceMicroseconds) * 100 /
      durationMicroseconds;
    const modeledWorstFramePercent =
      quantizationAdjustedAveragePercent * work.maxWorkToAverageWorkRatio;
    const failures = [];
    if (!(quantizationAdjustedAveragePercent < G726_CPU_GATE_THRESHOLDS.averagePercent)) {
      failures.push('averagePercent');
    }
    if (!(modeledWorstFramePercent < G726_CPU_GATE_THRESHOLDS.modeledP99Percent)) {
      failures.push('modeledP99Percent');
    }
    if (!(modeledWorstFramePercent < G726_CPU_GATE_THRESHOLDS.modeledMaxPercent)) {
      failures.push('modeledMaxPercent');
    }
    if (!(modeledWorstFramePercent < G726_CPU_GATE_THRESHOLDS.modeledDeadlinePercent)) {
      failures.push('modeledDeadlineMissEquivalent');
    }
    return {
      ...trial,
      rawAveragePercent,
      quantizationAdjustedAveragePercent,
      maxWorkToAverageWorkRatio: work.maxWorkToAverageWorkRatio,
      modeledWorstFramePercent,
      modeledP99Percent: modeledWorstFramePercent,
      modeledMaxPercent: modeledWorstFramePercent,
      modeledDeadlineMisses: modeledWorstFramePercent < 100 ? 0 : 1,
      passed: failures.length === 0,
      failures
    };
  });
  return {
    gate: 'g726-adpcm-aggregate-current-thread-cpu-v1',
    passed: checks.length === MODES.length * SAMPLE_RATES.length * REPETITIONS &&
      checks.every(check => check.passed),
    thresholds: G726_CPU_GATE_THRESHOLDS,
    quantizationAllowanceMicroseconds,
    checks
  };
}

export function evaluateG726PerformanceInputProvenance({
  artifact,
  start,
  end,
  current
}) {
  const failures = [];
  if (!artifact || artifact.contract !== start.contract ||
      artifact.hashAlgorithm !== start.hashAlgorithm) {
    failures.push('artifactContract');
  }
  if (artifact?.digest !== start.digest) failures.push('artifactDigest');
  if (artifact?.registryEntry !== start.registryEntry) failures.push('registryEntry');
  if (JSON.stringify(artifact?.buildAuthority) !== JSON.stringify(start.buildAuthority)) {
    failures.push('buildAuthority');
  }
  if (JSON.stringify(artifact?.inputs) !== JSON.stringify(start.inputs)) {
    failures.push('artifactInputs');
  }
  if (end.digest !== start.digest) failures.push('endDigest');
  if (current.digest !== start.digest) failures.push('currentDigest');
  return {
    passed: failures.length === 0,
    failures,
    contract: start.contract,
    hashAlgorithm: start.hashAlgorithm,
    inputs: start.inputs,
    registryEntry: start.registryEntry,
    buildAuthority: start.buildAuthority,
    artifactDigest: artifact?.digest ?? null,
    startDigest: start.digest,
    endDigest: end.digest,
    currentDigest: current.digest
  };
}

function totalCpuMicroseconds(value) {
  return value.user + value.system;
}

function calibrateThreadCpuClock() {
  const increments = [];
  let previous = totalCpuMicroseconds(process.threadCpuUsage());
  let accumulator = 0;
  while (increments.length < 8) {
    for (let index = 0; index < 50000; index++) {
      accumulator = Math.imul(accumulator + index, 1664525) + 1013904223;
    }
    const current = totalCpuMicroseconds(process.threadCpuUsage());
    if (current > previous) increments.push(current - previous);
    previous = current;
  }
  return {
    clock: 'process.threadCpuUsage current-thread user+system',
    positiveIncrementsMicroseconds: increments,
    minimumPositiveIncrementMicroseconds: Math.min(...increments),
    accumulator
  };
}

function measureEmptyControl(quantumCount) {
  let accumulator = 0;
  const started = process.threadCpuUsage();
  for (let quantum = 0; quantum < quantumCount; quantum++) {
    accumulator = (accumulator + quantum) >>> 0;
  }
  const cpu = process.threadCpuUsage(started);
  return {
    quantumCount,
    userMicroseconds: cpu.user,
    systemMicroseconds: cpu.system,
    totalMicroseconds: totalCpuMicroseconds(cpu),
    accumulator
  };
}

async function hashFile(filePath) {
  const bytes = await fs.readFile(filePath);
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

async function runCpuTrial({
  type,
  schema,
  params,
  sampleRate,
  mode,
  artifactSet,
  input,
  repetition
}) {
  const quantumCount = Math.ceil(sampleRate * DURATION_SECONDS / BLOCK_SIZE);
  const frames = quantumCount * BLOCK_SIZE;
  let started = null;
  let elapsed = null;
  const output = await runWasmCase({
    type,
    testCase: {
      sampleRate,
      channels: CHANNELS,
      frames,
      blockSize: BLOCK_SIZE,
      seed: 0x72640n + BigInt(repetition),
      params,
      events: []
    },
    input,
    schema,
    variant: mode === 'simd' ? 'simd' : 'baseline',
    wasmPath: mode === 'simd' ? artifactSet.simdPath : artifactSet.baselinePath,
    repoRoot: REPO_ROOT,
    processWarmupCalls: Math.ceil(sampleRate / BLOCK_SIZE),
    onProcessBatchBoundary({ phase }) {
      if (phase === 'start') {
        started = process.threadCpuUsage();
      } else {
        elapsed = process.threadCpuUsage(started);
      }
    }
  });
  if (!elapsed) throw new Error('The aggregate current-thread CPU interval was not observed');
  return {
    type,
    mode,
    sampleRate,
    repetition,
    channels: CHANNELS,
    blockSize: BLOCK_SIZE,
    quantumCount,
    renderedFrames: frames,
    renderedDurationSeconds: frames / sampleRate,
    cpu: {
      clock: 'process.threadCpuUsage current-thread',
      userMicroseconds: elapsed.user,
      systemMicroseconds: elapsed.system,
      totalMicroseconds: totalCpuMicroseconds(elapsed)
    },
    outputSentinel: [output[0], output[Math.floor(output.length / 2)], output.at(-1)]
  };
}

function usage() {
  return [
    'Usage: electron.exe tools/dsp-parity/g726-cpu-gate.mjs --artifacts-dir <path> --json <file> --power-mode <label>',
    '',
    'Run with ELECTRON_RUN_AS_NODE=1 using the shipping Electron 43 runtime.'
  ].join('\n');
}

export async function runG726AggregateCpuGate({ artifactsDir, outputPath, powerMode }) {
  if (Number.parseInt(process.versions.electron ?? '', 10) !== 43) {
    throw new Error('The G.726 aggregate CPU gate requires the shipping Electron 43 runtime');
  }
  if (typeof process.threadCpuUsage !== 'function') {
    throw new Error('The Electron runtime does not expose process.threadCpuUsage()');
  }
  os.setPriority(os.constants.priority.PRIORITY_HIGHEST);
  const artifactSet = await preflightArtifactDirectory(artifactsDir, REPO_ROOT);
  const resolvedBuildAuthority =
    artifactSet.metadata.g726PerformanceInput?.buildAuthority?.resolved;
  if (!resolvedBuildAuthority) {
    throw new Error('G.726 performance artifact has no resolved build authority');
  }
  const performanceInputStart = g726PerformanceInputManifest({
    repoRoot: REPO_ROOT,
    resolvedBuildAuthority
  });
  const performanceInputPreflight = evaluateG726PerformanceInputProvenance({
    artifact: artifactSet.metadata.g726PerformanceInput,
    start: performanceInputStart,
    end: performanceInputStart,
    current: performanceInputStart
  });
  if (!performanceInputPreflight.passed) {
    throw new Error(
      `G.726 performance artifact provenance is stale (${performanceInputPreflight.failures.join(', ')})`
    );
  }
  const workAnalysis = SAMPLE_RATES.map(sampleRate => analyzeG726QuantumWork(sampleRate));
  const clockCalibration = calibrateThreadCpuClock();
  const emptyControl = measureEmptyControl(workAnalysis.at(-1).quantumCount);
  const g726Schema = (await discoverCasePlan({
    type: 'G726ADPCMSimulatorPlugin', repoRoot: REPO_ROOT
  })).schema;
  const volumeSchema = (await discoverCasePlan({
    type: 'VolumePlugin', repoRoot: REPO_ROOT
  })).schema;
  const trials = [];
  let volumeControl;

  for (const sampleRate of SAMPLE_RATES) {
    const analysis = workAnalysis.find(entry => entry.sampleRate === sampleRate);
    const input = generateStimulus({
      id: 'noise',
      sampleRate,
      frames: analysis.renderedFrames,
      channels: CHANNELS,
      caseIndex: 0,
      seed: 0x72640n
    });
    if (sampleRate === 384000) {
      volumeControl = await runCpuTrial({
        type: 'VolumePlugin',
        schema: volumeSchema,
        params: { vl: 0 },
        sampleRate,
        mode: 'wasm',
        artifactSet,
        input,
        repetition: 1
      });
    }
    for (const mode of MODES) {
      for (let repetition = 1; repetition <= REPETITIONS; repetition++) {
        trials.push(await runCpuTrial({
          type: 'G726ADPCMSimulatorPlugin',
          schema: g726Schema,
          params: { br: '40', og: 0, mx: 100 },
          sampleRate,
          mode,
          artifactSet,
          input,
          repetition
        }));
      }
    }
  }

  const evaluated = evaluateG726AggregateCpuGate({
    trials,
    workAnalysis,
    clockQuantumMicroseconds: clockCalibration.minimumPositiveIncrementMicroseconds
  });
  const performanceInputEnd = g726PerformanceInputManifest({
    repoRoot: REPO_ROOT,
    resolvedBuildAuthority
  });
  const performanceInputCurrent = g726PerformanceInputManifest({
    repoRoot: REPO_ROOT,
    resolvedBuildAuthority
  });
  const performanceInput = evaluateG726PerformanceInputProvenance({
    artifact: artifactSet.metadata.g726PerformanceInput,
    start: performanceInputStart,
    end: performanceInputEnd,
    current: performanceInputCurrent
  });
  const output = {
    ...evaluated,
    passed: evaluated.passed && performanceInput.passed,
    performanceInput,
    authority: {
      measurement: 'aggregate current-thread CPU over a production-shaped WASM process batch',
      runtime: `Electron ${process.versions.electron} / Node ${process.versions.node} / V8 ${process.versions.v8}`,
      rawCpuPolicy: 'user+system CPU is used without baseline subtraction',
      quantizationPolicy: 'one 16 ms-or-observed clock quantum is added to every raw 30-second-equivalent trial',
      tailPolicy: 'modeled from the conservative static maxWork/averageWork ratio; wall and CDP tails are diagnostic only',
      tailFormula: '(rawCpuMicroseconds + max(16000, observedClockQuantumMicroseconds)) / renderedDurationMicroseconds * 100 * maxWorkToAverageWorkRatio'
    },
    configuration: {
      modes: MODES,
      sampleRates: SAMPLE_RATES,
      channels: CHANNELS,
      blockSize: BLOCK_SIZE,
      durationSecondsEquivalent: DURATION_SECONDS,
      repetitions: REPETITIONS,
      bitrateKbps: 40,
      outputGainDb: 0,
      mixPercent: 100,
      stimulus: 'deterministic noise'
    },
    powerMode,
    machine: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: os.cpus().length,
      processPriority: os.getPriority()
    },
    artifact: {
      root: artifactSet.root,
      sourceDigest: artifactSet.metadata.sourceDigest,
      abiVersion: artifactSet.metadata.abiVersion,
      buildType: 'Release',
      baseline: {
        buildFlags: artifactSet.baseline.buildFlags,
        bytes: artifactSet.baseline.bytes,
        sha256: await hashFile(artifactSet.baselinePath)
      },
      simd: {
        buildFlags: artifactSet.simd.buildFlags,
        bytes: artifactSet.simd.bytes,
        sha256: await hashFile(artifactSet.simdPath)
      }
    },
    clockCalibration,
    controls: {
      empty: emptyControl,
      volume0Db384kBaseline: volumeControl,
      interpretation: 'Controls demonstrate the aggregate clock magnitude and are not subtracted.'
    },
    workAnalysis,
    diagnosticsExcludedFromAuthority: [
      'performance-gate.json (Node per-quantum wall clock)',
      'performance-audioworklet-gate.json (CDP author-slice clock)',
      'performance-audioworklet-diagnostic-after-opt.json (wall diagnostic)'
    ]
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  if (!output.passed) {
    throw new Error(`G.726 aggregate CPU hard gate failed; see ${outputPath}`);
  }
  return output;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
  } else if (!args['artifacts-dir'] || !args.json || !args['power-mode']) {
    console.error(usage());
    process.exitCode = 1;
  } else {
    const keepAlive = setInterval(() => {}, 1000);
    runG726AggregateCpuGate({
      artifactsDir: path.resolve(REPO_ROOT, String(args['artifacts-dir'])),
      outputPath: path.resolve(REPO_ROOT, String(args.json)),
      powerMode: String(args['power-mode'])
    }).catch(error => {
      console.error(`G.726 aggregate CPU gate failed: ${error.message}`);
      process.exitCode = 1;
    }).finally(() => {
      clearInterval(keepAlive);
    });
  }
}
