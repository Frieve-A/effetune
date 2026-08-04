import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { smokeWasm, sourceDigest } from '../../scripts/build-dsp-wasm.mjs';
import { parseArgs, positiveInteger, nonNegativeInteger, integerList, isMain } from './cli.mjs';
import { DEFAULT_REPO_ROOT, discoverCasePlan, findPluginDefinition } from './cases.mjs';
import { createReferenceSession } from './node-host.mjs';
import {
  activePipelinePlugins,
  paramsLayoutHash,
  runNativeCase,
  runWasmCase,
  runWasmPipelineCase
} from './runners.mjs';
import { generateStimulus, noiseSeedForCase } from './stimuli.mjs';

function usage() {
  return [
    'Usage: node tools/dsp-parity/bench.mjs (--type <PluginType> | --preset <file>) [options]',
    '  --modes <list>          js,native,wasm,simd (default all)',
    '  --sample-rates <list>   default 48000,96000,192000',
    '  --channels <list>       default 2,8',
    '  --duration <seconds>    default 10',
    '  --warmup <count>        default 5',
    '  --repetitions <count>   default 20',
    '  --allocations           enable the native runner allocation guard',
    '  --single-call           preset WASM/SIMD only; one pipeline process call per quantum',
    '  --artifacts-dir <path>  use a scratch baseline/SIMD/metadata artifact set',
    '  --quantum-stats         collect bounded process-time histograms for WASM/SIMD',
    '  --g726-hard-gate        run the fixed 128-frame G.726 release acceptance gate',
    '  --power-mode <label>    required machine power-mode provenance for the hard gate',
    '  --json <file>           write machine-readable results',
    '  Preset external modes keep pipeline order, using JS for unavailable kernels.',
    '  Single-call presets require every active plugin in the selected artifact.',
    '  Single --type external modes require a matching schema and kernel.'
  ].join('\n');
}

function positiveNumber(value, name, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive number`);
  return parsed;
}

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error('median requires at least one value');
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[midpoint - 1] + sorted[midpoint]) / 2 : sorted[midpoint];
}

class BenchmarkPresetPlugin {
  constructor(item, definition, params) {
    this.definition = definition;
    this.enabled = item.enabled !== false;
    this.inputBus = item.inputBus;
    this.outputBus = item.outputBus;
    this.channel = item.channel;
    this.params = params;
  }
}

class SectionPlugin {
  constructor(enabled) {
    this.enabled = enabled;
  }
}

async function loadPreset(presetPath, repoRoot) {
  const resolved = path.resolve(repoRoot, presetPath);
  let preset;
  try {
    preset = JSON.parse(await fs.readFile(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read benchmark preset ${resolved}: ${error.message}`, { cause: error });
  }
  if (!Array.isArray(preset.pipeline)) throw new Error(`Benchmark preset ${resolved} has no pipeline array`);
  const pipeline = [];
  let insideSection = false;
  let sectionEnabled = true;
  for (const item of preset.pipeline) {
    let definition = null;
    try {
      definition = await findPluginDefinition(item.type ?? item.name, repoRoot);
    } catch (error) {
      const active = item.enabled !== false && (!insideSection || sectionEnabled);
      if (active) throw error;
    }
    if (definition?.type === 'SectionPlugin') {
      const section = new SectionPlugin(item.enabled !== false);
      pipeline.push(section);
      insideSection = true;
      sectionEnabled = section.enabled;
      continue;
    }
    const params = item.parameters ?? item.params ?? {};
    const plugin = new BenchmarkPresetPlugin(item, definition, params);
    pipeline.push(plugin);
  }
  const plugins = activePipelinePlugins(pipeline);
  if (plugins.length === 0) throw new Error(`Benchmark preset ${resolved} has no enabled DSP plugins`);
  return { path: resolved, plugins, pipeline };
}

async function benchmarkTargets({ type, preset, repoRoot, params }) {
  if ((type ? 1 : 0) + (preset ? 1 : 0) !== 1) throw new Error(`Select exactly one of --type or --preset.\n${usage()}`);
  if (type) {
    const definition = await findPluginDefinition(type, repoRoot);
    return { label: definition.type, selection: 'type', plugins: [{ definition, params }] };
  }
  const loaded = await loadPreset(preset, repoRoot);
  return {
    label: loaded.path,
    selection: 'preset',
    plugins: loaded.plugins,
    pipeline: loaded.pipeline
  };
}

function makeTestCase({ sampleRate, channels, frames, blockSize, params, caseIndex = 0 }) {
  return {
    id: 'benchmark-noise',
    stimulus: 'noise',
    sampleRate,
    frames,
    channels,
    blockSize,
    channelMode: channels === 1 ? 'mono' : channels === 4 ? 'all4' : 'stereo',
    channel: channels === 1 ? 'L' : channels === 4 ? 'A' : null,
    caseIndex,
    seed: noiseSeedForCase(caseIndex),
    params,
    events: []
  };
}

async function prepareJsOperation(target, testCase, input, repoRoot, implementations = {}) {
  const createSession = implementations.createReferenceSession ?? createReferenceSession;
  const sessions = [];
  for (const plugin of target.plugins) {
    sessions.push(await createSession(plugin.definition.type, {
      repoRoot,
      params: plugin.params,
      caseIndex: testCase.caseIndex,
      seed: testCase.seed
    }));
  }
  return async () => {
    let audio = input;
    for (let index = 0; index < sessions.length; index++) {
      audio = await sessions[index].process(audio, { ...testCase, params: target.plugins[index].params });
    }
    return audio;
  };
}

async function readWasmKernels(metadataPath) {
  let source;
  try {
    source = await fs.readFile(metadataPath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read DSP metadata ${metadataPath}: ${error.message}`, { cause: error });
  }
  let metadata;
  try {
    metadata = JSON.parse(source);
  } catch (error) {
    throw new Error(`Unable to parse DSP metadata ${metadataPath}: ${error.message}`, { cause: error });
  }
  if (!Array.isArray(metadata.kernels)) {
    throw new Error(`DSP metadata ${metadataPath} has no kernels array`);
  }
  const kernels = new Map();
  for (const [index, kernel] of metadata.kernels.entries()) {
    if (!kernel || typeof kernel.name !== 'string' || kernel.name.length === 0 ||
        !Number.isInteger(kernel.hash) || kernel.hash < 0 || kernel.hash > 0xffffffff) {
      throw new Error(`DSP metadata ${metadataPath} has an invalid kernel at index ${index}`);
    }
    if (kernels.has(kernel.name)) {
      throw new Error(`DSP metadata ${metadataPath} contains duplicate kernel ${kernel.name}`);
    }
    kernels.set(kernel.name, kernel.hash >>> 0);
  }
  return { metadataPath, metadata, kernels };
}

export async function preflightArtifactDirectory(artifactsDir, repoRoot = DEFAULT_REPO_ROOT) {
  const root = path.resolve(repoRoot, artifactsDir);
  const metadataPath = path.join(root, 'effetune-dsp.meta.json');
  const baselinePath = path.join(root, 'effetune-dsp.wasm');
  const simdPath = path.join(root, 'effetune-dsp.simd.wasm');
  const support = await readWasmKernels(metadataPath);
  const currentDigest = sourceDigest();
  if (support.metadata.sourceDigest !== currentDigest) {
    throw new Error(
      `DSP artifact source digest mismatch in ${metadataPath}; rebuild the scratch artifacts`
    );
  }
  const [baseline, simd] = await Promise.all([
    smokeWasm(baselinePath, false),
    smokeWasm(simdPath, true)
  ]);
  if (JSON.stringify(baseline.kernels) !== JSON.stringify(simd.kernels)) {
    throw new Error(`Baseline and SIMD DSP artifacts in ${root} expose different kernel registries`);
  }
  if (JSON.stringify(support.metadata.kernels) !== JSON.stringify(baseline.kernels)) {
    throw new Error(`DSP metadata ${metadataPath} does not match the artifact kernel registry`);
  }
  if (support.metadata.abiVersion !== baseline.abiVersion ||
      support.metadata.abiVersion !== simd.abiVersion) {
    throw new Error(`DSP metadata ${metadataPath} does not match the artifact ABI version`);
  }
  if (support.metadata.sizes?.baseline !== baseline.bytes ||
      support.metadata.sizes?.simd !== simd.bytes) {
    throw new Error(`DSP metadata ${metadataPath} does not match the artifact byte sizes`);
  }
  return { root, baselinePath, simdPath, baseline, simd, ...support };
}

async function readNativeKernelTypes(repoRoot) {
  const registryPath = path.join(repoRoot, 'dsp', 'registry.inc');
  let source;
  try {
    source = await fs.readFile(registryPath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read native DSP registry ${registryPath}: ${error.message}`, { cause: error });
  }
  const types = new Set();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    const match = /^EFFETUNE_PLUGIN\(\s*([A-Za-z_$][\w$]*)\s*,/.exec(line);
    if (!match) continue;
    if (types.has(match[1])) {
      throw new Error(`Native DSP registry ${registryPath} contains duplicate kernel ${match[1]}`);
    }
    types.add(match[1]);
  }
  return { registryPath, types };
}

function missingKernelError(mode, type, sourcePath) {
  const source = mode === 'native' ? 'native DSP registry' : 'committed DSP metadata';
  return new Error(`No ${source} kernel was found for benchmark plugin ${type} in ${sourcePath}`);
}

async function externalSupport(mode, repoRoot, artifactSet = null) {
  if (mode === 'native') {
    const { registryPath, types } = await readNativeKernelTypes(repoRoot);
    return {
      sourcePath: registryPath,
      has(type) { return types.has(type); },
      expectedHash() { return null; }
    };
  }
  const { metadataPath, kernels } = artifactSet ?? await readWasmKernels(
    path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.meta.json')
  );
  return {
    sourcePath: metadataPath,
    has(type) { return kernels.has(type); },
    expectedHash(type) { return kernels.get(type); }
  };
}

async function prepareExternalOperation(mode, target, testCase, input, options) {
  const support = await externalSupport(mode, options.repoRoot, options.artifactSet);
  const stages = [];
  const implementations = {
    createReferenceSession,
    runNativeCase,
    runWasmCase,
    ...(options.implementations ?? {})
  };
  for (const plugin of target.plugins) {
    const type = plugin.definition.type;
    if (!support.has(type)) {
      if (target.selection !== 'preset') throw missingKernelError(mode, type, support.sourcePath);
      const session = await implementations.createReferenceSession(type, {
        repoRoot: options.repoRoot,
        params: plugin.params,
        caseIndex: testCase.caseIndex,
        seed: testCase.seed
      });
      stages.push({ kind: 'js', plugin, session });
      continue;
    }

    const plan = await discoverCasePlan({ type, repoRoot: options.repoRoot });
    if (!plan.schema) throw new Error(`No params.json was found for benchmark plugin ${type}`);
    const expectedHash = support.expectedHash(type);
    if (expectedHash !== null) {
      const schemaHash = paramsLayoutHash(plan.schema);
      if (schemaHash !== expectedHash) {
        throw new Error(
          `DSP parameter hash mismatch for benchmark plugin ${type}: ` +
          `${support.sourcePath} declares ${expectedHash}, but params.json produces ${schemaHash}`
        );
      }
    }
    stages.push({ kind: 'external', plugin, schema: plan.schema });
  }

  return async () => {
    let audio = input;
    for (const stage of stages) {
      const { plugin } = stage;
      const pluginCase = { ...testCase, params: plugin.params };
      if (stage.kind === 'js') {
        audio = await stage.session.process(audio, pluginCase);
      } else if (mode === 'native') {
        audio = await implementations.runNativeCase({
          type: plugin.definition.type,
          testCase: pluginCase,
          input: audio,
          schema: stage.schema,
          repoRoot: options.repoRoot,
          runnerPath: options.nativeRunner ?? undefined,
          allocations: options.allocations
        });
      } else {
        audio = await implementations.runWasmCase({
          type: plugin.definition.type,
          testCase: pluginCase,
          input: audio,
          schema: stage.schema,
          repoRoot: options.repoRoot,
          variant: mode === 'simd' ? 'simd' : 'baseline',
          wasmPath: mode === 'simd' ? (options.simdPath ?? undefined) : (options.wasmPath ?? undefined),
          onProcess: options.onProcess,
          processWarmupCalls: options.processWarmupCalls
        });
      }
    }
    return audio;
  };
}

async function prepareSingleCallOperation(mode, target, testCase, input, options) {
  const support = await externalSupport(mode, options.repoRoot, options.artifactSet);
  const active = activePipelinePlugins(target.pipeline);
  if (active.length === 0) {
    throw new Error(`Single-call benchmark preset ${target.label} has no active plugins`);
  }
  const schemas = new Map();
  for (const plugin of active) {
    const type = plugin.definition?.type;
    if (!type || !support.has(type)) {
      throw new Error(
        `Single-call ${mode} benchmark requires every active preset plugin in ` +
        `${support.sourcePath}; missing ${type ?? 'an unresolved plugin'}`
      );
    }
    if (schemas.has(type)) continue;
    const plan = await discoverCasePlan({ type, repoRoot: options.repoRoot });
    if (!plan.schema) throw new Error(`No params.json was found for benchmark plugin ${type}`);
    const expectedHash = support.expectedHash(type);
    const schemaHash = paramsLayoutHash(plan.schema);
    if (expectedHash !== null && schemaHash !== expectedHash) {
      throw new Error(
        `DSP parameter hash mismatch for benchmark plugin ${type}: ` +
        `${support.sourcePath} declares ${expectedHash}, but params.json produces ${schemaHash}`
      );
    }
    schemas.set(type, plan.schema);
  }
  const implementations = {
    runWasmPipelineCase,
    ...(options.implementations ?? {})
  };
  return () => implementations.runWasmPipelineCase({
    pipeline: target.pipeline,
    testCase,
    input,
    schemas,
    repoRoot: options.repoRoot,
    variant: mode === 'simd' ? 'simd' : 'baseline',
    wasmPath: mode === 'simd' ? (options.simdPath ?? undefined) : (options.wasmPath ?? undefined)
  });
}

export async function measureRealtimeFactor({ operationFactory, warmup, repetitions, audioSeconds }) {
  for (let index = 0; index < warmup; index++) {
    const operation = await operationFactory(index);
    await operation();
  }
  const elapsedSeconds = [];
  for (let index = 0; index < repetitions; index++) {
    const operation = await operationFactory(warmup + index);
    const started = performance.now();
    await operation();
    elapsedSeconds.push((performance.now() - started) / 1000);
  }
  const medianSeconds = median(elapsedSeconds);
  return {
    medianSeconds,
    realtimeFactor: audioSeconds / medianSeconds,
    repetitions,
    samples: elapsedSeconds
  };
}

const QUANTUM_HISTOGRAM_BIN_WIDTH_PERCENT = 0.25;
const QUANTUM_HISTOGRAM_UPPER_BOUND_PERCENT = 100;

export function createQuantumTimingAccumulator() {
  const counts = new Uint32Array(
    Math.ceil(QUANTUM_HISTOGRAM_UPPER_BOUND_PERCENT / QUANTUM_HISTOGRAM_BIN_WIDTH_PERCENT) + 1
  );
  let count = 0;
  let totalPercent = 0;
  let maximumPercent = 0;
  let deadlineMisses = 0;
  let clock = null;

  return {
    observe({ elapsedMilliseconds, blockFrames, sampleRate, clock: observedClock = 'wall' }) {
      if (!(elapsedMilliseconds >= 0) || !(blockFrames > 0) || !(sampleRate > 0)) {
        throw new Error('Invalid process timing observation');
      }
      const deadlineMilliseconds = blockFrames * 1000 / sampleRate;
      const cpuPercent = elapsedMilliseconds * 100 / deadlineMilliseconds;
      if (clock !== null && clock !== observedClock) {
        throw new Error('Process timing observations use inconsistent clocks');
      }
      clock = observedClock;
      count++;
      totalPercent += cpuPercent;
      if (cpuPercent > maximumPercent) maximumPercent = cpuPercent;
      if (cpuPercent >= 100) deadlineMisses++;
      const bucket = Math.min(
        counts.length - 1,
        Math.floor(cpuPercent / QUANTUM_HISTOGRAM_BIN_WIDTH_PERCENT)
      );
      counts[bucket]++;
    },
    result() {
      if (count === 0) throw new Error('No process timing observations were collected');
      const percentileRank = Math.ceil(count * 0.99);
      let cumulative = 0;
      let percentileBucket = counts.length - 1;
      for (let index = 0; index < counts.length; index++) {
        cumulative += counts[index];
        if (cumulative >= percentileRank) {
          percentileBucket = index;
          break;
        }
      }
      const overflowBucket = counts.length - 1;
      const p99Percent = percentileBucket === overflowBucket
        ? maximumPercent
        : (percentileBucket + 1) * QUANTUM_HISTOGRAM_BIN_WIDTH_PERCENT;
      const bins = [];
      for (let index = 0; index < counts.length; index++) {
        if (counts[index] === 0) continue;
        bins.push({
          upperBoundPercent: index === overflowBucket
            ? null
            : (index + 1) * QUANTUM_HISTOGRAM_BIN_WIDTH_PERCENT,
          count: counts[index]
        });
      }
      return {
        buildType: 'Release',
        clock,
        quantumCount: count,
        averagePercent: totalPercent / count,
        p99Percent,
        maxPercent: maximumPercent,
        deadlineMisses,
        histogram: {
          binWidthPercent: QUANTUM_HISTOGRAM_BIN_WIDTH_PERCENT,
          upperBoundPercent: QUANTUM_HISTOGRAM_UPPER_BOUND_PERCENT,
          bins
        }
      };
    }
  };
}

export const G726_REALTIME_GATE_THRESHOLDS = Object.freeze({
  averagePercent: 15,
  p99Percent: 50,
  maxPercent: 80,
  deadlineMisses: 0
});

export function evaluateG726RealtimeGate(benchmark, { powerMode, artifactProvenance }) {
  const checks = benchmark.results.map(result => {
    const evaluateTiming = timing => {
      const failures = [];
      if (!(timing.averagePercent < G726_REALTIME_GATE_THRESHOLDS.averagePercent)) {
        failures.push('averagePercent');
      }
      if (!(timing.p99Percent < G726_REALTIME_GATE_THRESHOLDS.p99Percent)) {
        failures.push('p99Percent');
      }
      if (!(timing.maxPercent < G726_REALTIME_GATE_THRESHOLDS.maxPercent)) {
        failures.push('maxPercent');
      }
      if (timing.deadlineMisses !== G726_REALTIME_GATE_THRESHOLDS.deadlineMisses) {
        failures.push('deadlineMisses');
      }
      return { passed: failures.length === 0, failures, timing };
    };
    const aggregate = evaluateTiming(result.quantumStats);
    const trials = (result.quantumTrials ?? [result.quantumStats]).map(evaluateTiming);
    return {
      mode: result.mode,
      sampleRate: result.sampleRate,
      channels: result.channels,
      passed: aggregate.passed,
      failures: aggregate.failures,
      trials,
      aggregateTiming: result.quantumStats
    };
  });
  return {
    gate: 'g726-adpcm-realtime-v1',
    passed: checks.every(check => check.passed),
    thresholds: G726_REALTIME_GATE_THRESHOLDS,
    configuration: {
      modes: ['wasm', 'simd'],
      sampleRates: [96000, 352800, 384000],
      channels: 2,
      blockSize: 128,
      durationSeconds: 30,
      repetitions: 3,
      bitrateKbps: 40
    },
    powerMode,
    machine: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model ?? 'unknown',
      processPriority: os.getPriority()
    },
    artifactProvenance,
    checks,
    benchmark
  };
}

export async function runBenchmarks({
  type = null,
  preset = null,
  repoRoot = DEFAULT_REPO_ROOT,
  modes = ['js', 'native', 'wasm', 'simd'],
  sampleRates = [48000, 96000, 192000],
  channelCounts = [2, 8],
  durationSeconds = 10,
  blockSize = 128,
  warmup = 5,
  repetitions = 20,
  params = {},
  allocations = false,
  nativeRunner = null,
  wasmPath = null,
  simdPath = null,
  artifactsDir = null,
  singleCall = false,
  quantumStats = false,
  implementations = {},
  log = console.log
}) {
  const knownModes = new Set(['js', 'native', 'wasm', 'simd']);
  for (const mode of modes) if (!knownModes.has(mode)) throw new Error(`Unknown benchmark mode ${mode}`);
  if (allocations && modes.some(mode => mode !== 'native')) {
    throw new Error('--allocations requires --modes native so the debug native runner can enforce the guard');
  }
  if (singleCall && !preset) {
    throw new Error('--single-call requires --preset');
  }
  if (singleCall && modes.some(mode => mode !== 'wasm' && mode !== 'simd')) {
    throw new Error('--single-call supports only --modes wasm,simd');
  }
  if (quantumStats && (singleCall || modes.some(mode => mode !== 'wasm' && mode !== 'simd'))) {
    throw new Error('--quantum-stats supports per-instance --modes wasm,simd only');
  }
  if (artifactsDir !== null && (wasmPath !== null || simdPath !== null)) {
    throw new Error('--artifacts-dir cannot be combined with --wasm-path or --simd-path');
  }
  const artifactSet = artifactsDir !== null &&
    modes.some(mode => mode === 'wasm' || mode === 'simd')
    ? await preflightArtifactDirectory(artifactsDir, repoRoot)
    : null;
  const selectedWasmPath = artifactSet?.baselinePath ?? wasmPath;
  const selectedSimdPath = artifactSet?.simdPath ?? simdPath;
  const target = await benchmarkTargets({ type, preset, repoRoot, params });
  const results = [];
  for (const sampleRate of sampleRates) {
    const frames = Math.round(sampleRate * durationSeconds);
    for (const channels of channelCounts) {
      const testCase = makeTestCase({ sampleRate, channels, frames, blockSize, params });
      const input = generateStimulus({
        id: 'noise', sampleRate, frames, channels, caseIndex: 0, seed: testCase.seed
      });
      for (const mode of modes) {
        const quantumTiming = quantumStats ? createQuantumTimingAccumulator() : null;
        const quantumTrials = quantumStats
          ? Array.from({ length: repetitions }, () => createQuantumTimingAccumulator())
          : null;
        const operationFactory = async measurementIndex => {
          if (singleCall) {
            return prepareSingleCallOperation(mode, target, testCase, input, {
              repoRoot,
              wasmPath: selectedWasmPath,
              simdPath: selectedSimdPath,
              artifactSet,
              implementations
            });
          }
          return mode === 'js'
            ? prepareJsOperation(target, testCase, input, repoRoot, implementations)
            : prepareExternalOperation(mode, target, testCase, input, {
                repoRoot,
                nativeRunner,
                wasmPath: selectedWasmPath,
                simdPath: selectedSimdPath,
                artifactSet,
                allocations,
                onProcess: measurementIndex >= warmup
                  ? observation => {
                      quantumTiming.observe(observation);
                      quantumTrials[measurementIndex - warmup].observe(observation);
                    }
                  : null,
                processWarmupCalls: measurementIndex >= warmup && quantumStats
                  ? Math.ceil(sampleRate / blockSize)
                  : 0,
                implementations
              });
        };
        const measurement = await measureRealtimeFactor({
          operationFactory,
          warmup,
          repetitions,
          audioSeconds: frames / sampleRate
        });
        const result = {
          mode,
          sampleRate,
          channels,
          frames,
          singleCall,
          ...measurement,
          ...(quantumTiming ? {
            quantumStats: quantumTiming.result(),
            quantumTrials: quantumTrials.map(timing => timing.result())
          } : {})
        };
        results.push(result);
        log(`${mode.padEnd(6)} ${String(sampleRate).padStart(6)} Hz ${channels} ch: ` +
          `${measurement.realtimeFactor.toFixed(2)}x realtime (${measurement.medianSeconds.toFixed(4)} s median)`);
        if (result.quantumStats) {
          const timing = result.quantumStats;
          log(`       quantum CPU: avg ${timing.averagePercent.toFixed(2)}%, ` +
            `p99 ${timing.p99Percent.toFixed(2)}%, max ${timing.maxPercent.toFixed(2)}%, ` +
            `misses ${timing.deadlineMisses}`);
        }
      }
    }
  }
  return {
    target: target.label,
    durationSeconds,
    blockSize,
    warmup,
    repetitions,
    singleCall,
    quantumStats,
    results
  };
}

export async function runBenchCli(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(usage());
    return { help: true };
  }
  let params = {};
  if (args.params) {
    try {
      params = JSON.parse(args.params);
    } catch (error) {
      throw new Error(`--params must be JSON: ${error.message}`);
    }
  }
  const repoRoot = args.root ? path.resolve(args.root) : DEFAULT_REPO_ROOT;
  if (args['g726-hard-gate'] === true) {
    if (!args.json || !args['power-mode'] || !args['artifacts-dir']) {
      throw new Error(
        '--g726-hard-gate requires --json, --power-mode, and --artifacts-dir provenance inputs'
      );
    }
    try {
      os.setPriority(os.constants.priority.PRIORITY_HIGHEST);
    } catch (error) {
      throw new Error(`Unable to raise the G.726 benchmark process priority: ${error.message}`);
    }
    const artifactSet = await preflightArtifactDirectory(args['artifacts-dir'], repoRoot);
    const benchmark = await runBenchmarks({
      type: 'G726ADPCMSimulatorPlugin',
      repoRoot,
      modes: ['wasm', 'simd'],
      sampleRates: [96000, 352800, 384000],
      channelCounts: [2],
      durationSeconds: 30,
      blockSize: 128,
      warmup: 0,
      repetitions: 3,
      params: { br: '40', og: 0, mx: 100 },
      artifactsDir: args['artifacts-dir'],
      quantumStats: true,
      log: message => io.log(message)
    });
    const result = evaluateG726RealtimeGate(benchmark, {
      powerMode: String(args['power-mode']),
      artifactProvenance: {
        root: artifactSet.root,
        sourceDigest: artifactSet.metadata.sourceDigest,
        abiVersion: artifactSet.metadata.abiVersion,
        baseline: {
          buildFlags: artifactSet.baseline.buildFlags,
          bytes: artifactSet.baseline.bytes
        },
        simd: {
          buildFlags: artifactSet.simd.buildFlags,
          bytes: artifactSet.simd.bytes
        }
      }
    });
    const outputPath = path.resolve(repoRoot, args.json);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) {
      throw new Error(`G.726 realtime hard gate failed; see ${outputPath}`);
    }
    return result;
  }
  const result = await runBenchmarks({
    type: args.type ?? null,
    preset: args.preset ?? null,
    repoRoot,
    modes: args.modes ? String(args.modes).split(',').filter(Boolean) : ['js', 'native', 'wasm', 'simd'],
    sampleRates: integerList(args['sample-rates'], 'sample-rates', [48000, 96000, 192000]),
    channelCounts: integerList(args.channels, 'channels', [2, 8]),
    durationSeconds: positiveNumber(args.duration, 'duration', 10),
    blockSize: positiveInteger(args['block-size'], 'block-size', 128),
    warmup: nonNegativeInteger(args.warmup, 'warmup', 5),
    repetitions: positiveInteger(args.repetitions, 'repetitions', 20),
    params,
    allocations: args.allocations === true,
    nativeRunner: args['native-runner'] ?? null,
    wasmPath: args['wasm-path'] ?? null,
    simdPath: args['simd-path'] ?? null,
    artifactsDir: args['artifacts-dir'] ?? null,
    singleCall: args['single-call'] === true,
    quantumStats: args['quantum-stats'] === true,
    log: message => io.log(message)
  });
  if (args.json) {
    const outputPath = path.resolve(repoRoot, args.json);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}

if (isMain(import.meta.url)) {
  runBenchCli().catch(error => {
    console.error(`DSP benchmark failed: ${error.message}`);
    process.exitCode = 1;
  });
}
