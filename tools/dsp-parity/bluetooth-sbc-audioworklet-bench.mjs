import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  sourceDigest,
  sourceDigestInputPaths
} from '../../scripts/build-dsp-wasm.mjs';
import {
  createQuantumTimingAccumulator,
  preflightArtifactDirectory
} from './bench.mjs';
import { parseArgs } from './cli.mjs';
import { startAudioWorkletTraceCapture } from './g726-audioworklet-bench.mjs';
import {
  startIsolatedStaticServer,
  stopIsolatedStaticServer
} from '../run-power-browser-smoke.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FIXTURE_PATH = '/tools/dsp-parity/bluetooth-sbc-audioworklet-bench.html';
export const SBC_PLUGIN_TYPE = 'BluetoothSBCSimulatorPlugin';
export const SBC_PARAMS_HASH = 0xa0d7750b;
export const SBC_SAMPLE_RATES = Object.freeze([96000, 352800, 384000]);
export const SBC_MODES = Object.freeze(['wasm', 'simd']);
export const SBC_SETTINGS = Object.freeze([
  Object.freeze({
    id: 'bp53-stereo-bl4',
    parameters: Object.freeze({ bp: 53, cm: 'Stereo', bl: '4', og: 0, mx: 100, pl: 0 })
  }),
  Object.freeze({
    id: 'bp53-joint-bl4',
    parameters: Object.freeze({ bp: 53, cm: 'Joint Stereo', bl: '4', og: 0, mx: 100, pl: 0 })
  }),
  // Dual Channel allocates and quantizes both channels independently at the full bitpool, so this
  // is the heaviest configuration the plugin can be asked to run in real time.
  Object.freeze({
    id: 'bp53-dual-bl4',
    parameters: Object.freeze({ bp: 53, cm: 'Dual Channel', bl: '4', og: 0, mx: 100, pl: 0 })
  })
]);
const CHANNELS = 2;
const BLOCK_SIZE = 128;
const DURATION_SECONDS = 30;
const REPETITIONS = 3;
const RUNTIME_INPUT_PATHS = Object.freeze([
  'js/audio/dsp-engine-binding.js',
  'package-lock.json',
  'package.json',
  'plugins/audio-processor.js',
  'tools/dsp-parity/bench.mjs',
  'tools/dsp-parity/bluetooth-sbc-audioworklet-bench.html',
  'tools/dsp-parity/bluetooth-sbc-audioworklet-bench.mjs',
  'tools/dsp-parity/bluetooth-sbc-production-equivalence.mjs',
  'tools/dsp-parity/bluetooth-sbc-thread-cpu-bench.mjs',
  'tools/dsp-parity/cli.mjs',
  'tools/dsp-parity/g726-audioworklet-bench.mjs',
  'tools/dsp-parity/runners.mjs',
  'tools/dsp-parity/stimuli.mjs',
  'tools/run-power-browser-smoke.mjs'
]);
const PRODUCTION_EQUIVALENCE_PATHS = Object.freeze([
  'dsp/core/abi.cpp',
  'dsp/core/allocation_guard.cpp',
  'dsp/core/allocation_guard.h',
  'dsp/core/arena.cpp',
  'dsp/core/arena.h',
  'dsp/core/engine.cpp',
  'dsp/core/engine.h',
  'dsp/core/registry.cpp',
  'dsp/core/registry.h',
  'dsp/core/telemetry.cpp',
  'dsp/exports.txt',
  'dsp/include/effetune/abi.h',
  'dsp/include/effetune/dsp/halfband.h',
  'dsp/include/effetune/kernel.h',
  'dsp/include/effetune/telemetry.h',
  'dsp/plugins/lofi/bluetooth_sbc_simulator/kernel.cpp',
  'js/audio/dsp-engine-binding.js',
  'plugins/audio-processor.js'
]);
const EFFECTIVE_BUILD_TUPLE = Object.freeze({
  buildType: 'Release',
  cxxStandard: 20,
  buildTesting: false,
  debugState: false,
  commonFlags: ['-O3', '-flto', '-fwasm-exceptions', '-fno-rtti'],
  baseline: { buildFlags: 0, extraFlags: [] },
  simd: { buildFlags: 1, extraFlags: ['-msimd128'] },
  wasm: {
    standalone: true,
    allowMemoryGrowth: true,
    initialMemoryBytes: 8388608,
    maximumMemoryBytes: 268435456,
    exportsFile: 'dsp/exports.txt'
  }
});

export const SBC_REALTIME_GATE_THRESHOLDS = Object.freeze({
  averageGoalPercent: 10,
  average96kPercent: 15,
  p99Percent: 50,
  maxPercent: 80,
  deadlineMisses: 0
});

function usage() {
  return [
    'Usage: node tools/dsp-parity/bluetooth-sbc-audioworklet-bench.mjs --artifacts-dir <path> --json <file> --power-mode <label> [--modes wasm|simd]',
    '       node tools/dsp-parity/bluetooth-sbc-audioworklet-bench.mjs --combine-baseline <file> --combine-simd <file> --json <file>',
    '',
    'Runs the fixed Bluetooth SBC baseline/SIMD hard gate in Chromium AudioWorklet.',
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

function artifactUrl(baseURL, artifactPath) {
  const relative = path.relative(REPO_ROOT, artifactPath);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Bluetooth SBC AudioWorklet artifacts must be inside the repository root.');
  }
  const encoded = relative.split(path.sep).map(encodeURIComponent).join('/');
  return `${baseURL}/${encoded}`;
}

async function sha256File(filePath) {
  const bytes = await fs.readFile(filePath);
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

async function createFileManifest(repoRoot, relativePaths, contract) {
  const files = [];
  const aggregate = crypto.createHash('sha256');
  for (const relativePath of relativePaths) {
    const filePath = path.join(repoRoot, ...relativePath.split('/'));
    const sha256 = await sha256File(filePath);
    const bytes = (await fs.stat(filePath)).size;
    files.push({ path: relativePath, sha256, bytes });
    aggregate.update(relativePath);
    aggregate.update('\0');
    aggregate.update(sha256);
    aggregate.update('\0');
    aggregate.update(String(bytes));
    aggregate.update('\0');
  }
  return {
    contract,
    aggregateSha256: `sha256:${aggregate.digest('hex')}`,
    files
  };
}

export async function createSbcSnapshotStabilityManifest(repoRoot = REPO_ROOT) {
  const relativePaths = [...new Set([
    ...sourceDigestInputPaths(),
    ...RUNTIME_INPUT_PATHS
  ])].sort((left, right) => left.localeCompare(right, 'en'));
  return createFileManifest(
    repoRoot,
    relativePaths,
    'bluetooth-sbc-snapshot-stability-manifest-v1'
  );
}

export async function createSbcProductionEquivalenceManifest(repoRoot = REPO_ROOT) {
  const fileManifest = await createFileManifest(
    repoRoot,
    PRODUCTION_EQUIVALENCE_PATHS,
    'bluetooth-sbc-production-equivalence-files-v1'
  );
  const schema = JSON.parse(await fs.readFile(path.join(
    repoRoot, 'dsp', 'plugins', 'lofi', 'bluetooth_sbc_simulator', 'params.json'
  ), 'utf8'));
  const paramsHeader = await fs.readFile(path.join(
    repoRoot, 'dsp', 'generated', 'cpp', 'BluetoothSBCSimulatorPluginParams.h'
  ), 'utf8');
  const hashMatch = /kHash = 0x([0-9a-f]+)u/i.exec(paramsHeader);
  const countMatch = /kFloatCount = (\d+)u/.exec(paramsHeader);
  if (!hashMatch || !countMatch || Number.parseInt(hashMatch[1], 16) !== SBC_PARAMS_HASH ||
      Number.parseInt(countMatch[1], 10) !== schema.fields.length ||
      schema.type !== SBC_PLUGIN_TYPE) {
    throw new Error('Bluetooth SBC semantic parameter projection is inconsistent.');
  }
  const semanticProjection = {
    pluginType: schema.type,
    paramsHash: SBC_PARAMS_HASH,
    layout: schema.fields.map(field => ({
      key: field.key,
      kind: field.kind,
      default: field.default,
      ...(field.values ? { values: field.values } : {})
    })),
    build: {
      emsdkVersion: (await fs.readFile(path.join(repoRoot, 'dsp', 'EMSDK_VERSION'), 'utf8')).trim(),
      ...EFFECTIVE_BUILD_TUPLE
    }
  };
  const aggregate = crypto.createHash('sha256');
  aggregate.update(fileManifest.aggregateSha256);
  aggregate.update('\0');
  aggregate.update(JSON.stringify(semanticProjection));
  return {
    contract: 'bluetooth-sbc-production-equivalence-manifest-v1',
    aggregateSha256: `sha256:${aggregate.digest('hex')}`,
    files: fileManifest.files,
    semanticProjection
  };
}

function evaluateTiming(timing, sampleRate) {
  const failures = [];
  if (sampleRate === 96000 &&
      !(timing.averagePercent < SBC_REALTIME_GATE_THRESHOLDS.average96kPercent)) {
    failures.push('averagePercent');
  }
  if (!(timing.p99Percent < SBC_REALTIME_GATE_THRESHOLDS.p99Percent)) {
    failures.push('p99Percent');
  }
  if (!(timing.maxPercent < SBC_REALTIME_GATE_THRESHOLDS.maxPercent)) {
    failures.push('maxPercent');
  }
  if (timing.deadlineMisses !== SBC_REALTIME_GATE_THRESHOLDS.deadlineMisses) {
    failures.push('deadlineMisses');
  }
  return {
    passed: failures.length === 0,
    failures,
    averageGoalMet: timing.averagePercent <=
      SBC_REALTIME_GATE_THRESHOLDS.averageGoalPercent,
    averageHardGateApplied: sampleRate === 96000,
    timing
  };
}

export function evaluateSbcRealtimeGate(
  benchmark,
  { powerMode, artifactProvenance, modes = SBC_MODES }
) {
  const checks = benchmark.results.map(result => {
    const aggregate = evaluateTiming(result.quantumStats, result.sampleRate);
    const trials = result.quantumTrials.map(timing =>
      evaluateTiming(timing, result.sampleRate));
    return {
      mode: result.mode,
      sampleRate: result.sampleRate,
      channels: result.channels,
      setting: result.setting,
      passed: aggregate.passed && trials.every(trial => trial.passed),
      failures: aggregate.failures,
      aggregate,
      trials
    };
  });
  return {
    gate: 'bluetooth-sbc-realtime-v1',
    passed: checks.every(check => check.passed),
    thresholds: SBC_REALTIME_GATE_THRESHOLDS,
    configuration: {
      modes,
      sampleRates: SBC_SAMPLE_RATES,
      channels: CHANNELS,
      blockSize: BLOCK_SIZE,
      durationSeconds: DURATION_SECONDS,
      repetitions: REPETITIONS,
      settings: SBC_SETTINGS
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

async function runTrial({
  browser,
  baseURL,
  artifactPath,
  mode,
  sampleRate,
  setting,
  aggregateTiming,
  aggregateWallTiming
}) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const cdp = await page.context().newCDPSession(page);
  try {
    await page.goto(`${baseURL}${FIXTURE_PATH}`, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForFunction(() => window.bluetoothSbcAudioWorkletBench !== undefined, {
      timeout: 10_000
    });
    const initialization = await page.evaluate(config =>
      window.bluetoothSbcAudioWorkletBench.initialize(config), {
      sampleRate,
      artifactUrl: artifactUrl(baseURL, artifactPath),
      simd: mode === 'simd',
      parameters: setting.parameters
    });
    if (pageErrors.length > 0) {
      throw new Error(`AudioWorklet page error: ${pageErrors[0]}`);
    }

    const capture = startAudioWorkletTraceCapture(cdp, {
      sampleRate,
      aggregateTiming,
      aggregateWallTiming,
      inspectEvents: false
    });
    await cdp.send('Tracing.start', {
      transferMode: 'ReportEvents',
      bufferUsageReportingInterval: 1000,
      traceConfig: {
        recordMode: 'recordAsMuchAsPossible',
        traceBufferSizeInKb: 1048576,
        includedCategories: ['disabled-by-default-audio-worklet']
      }
    });
    const measurement = await page.evaluate(durationMs =>
      window.bluetoothSbcAudioWorkletBench.measure(durationMs), DURATION_SECONDS * 1000);
    const captured = await capture.stop();
    if (pageErrors.length > 0) {
      throw new Error(`AudioWorklet page error: ${pageErrors[0]}`);
    }
    const observedAudioSeconds = captured.timing.quantumCount * BLOCK_SIZE / sampleRate;
    if (measurement.state !== 'suspended' ||
        measurement.contextSeconds < DURATION_SECONDS - 0.5) {
      throw new Error(
        `AudioWorklet did not complete the ${DURATION_SECONDS}-second measurement interval.`
      );
    }
    if (observedAudioSeconds + 0.1 < measurement.contextSeconds) {
      throw new Error('AudioWorklet trace omitted measured render quanta.');
    }
    return {
      ...captured,
      initialization,
      measurement: { ...measurement, observedAudioSeconds }
    };
  } finally {
    await page.evaluate(() => window.bluetoothSbcAudioWorkletBench?.close()).catch(() => {});
    await cdp.detach().catch(() => {});
    await page.close().catch(() => {});
  }
}

export async function preflightSbcArtifacts(artifactsDir) {
  const artifactSet = await preflightArtifactDirectory(artifactsDir, REPO_ROOT);
  const kernelHash = artifactSet.kernels.get(SBC_PLUGIN_TYPE);
  if (kernelHash !== SBC_PARAMS_HASH) {
    throw new Error(
      `Bluetooth SBC scratch artifact parameter hash is ${kernelHash ?? 'missing'}, ` +
      `expected ${SBC_PARAMS_HASH}.`
    );
  }
  const [baselineSha256, simdSha256] = await Promise.all([
    sha256File(artifactSet.baselinePath),
    sha256File(artifactSet.simdPath)
  ]);
  return { artifactSet, baselineSha256, simdSha256 };
}

export async function runBluetoothSbcAudioWorkletGate({
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
  const server = await startIsolatedStaticServer();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--autoplay-policy=no-user-gesture-required']
    });
    const browserVersion = await browser.version();
    const results = [];
    const digestBoundaries = [];
    for (const sampleRate of SBC_SAMPLE_RATES) {
      for (const mode of modes) {
        for (const setting of SBC_SETTINGS) {
          const boundaryDigest = sourceDigest();
          const boundaryManifest = await createSbcSnapshotStabilityManifest();
          if (boundaryDigest !== artifactSet.metadata.sourceDigest ||
              boundaryManifest.aggregateSha256 !==
              startStabilityManifest.aggregateSha256) {
            throw new Error(
              `Snapshot inputs changed before ${mode} ${sampleRate} Hz ${setting.id}; ` +
              'the complete campaign is invalid.'
            );
          }
          digestBoundaries.push({
            mode,
            sampleRate,
            setting: setting.id,
            sourceDigest: boundaryDigest,
            stabilityManifest: boundaryManifest.aggregateSha256
          });
          const aggregateTiming = createQuantumTimingAccumulator();
          const aggregateWallTiming = createQuantumTimingAccumulator();
          const trials = [];
          for (let repetition = 0; repetition < REPETITIONS; repetition++) {
            process.stdout.write(
              `Bluetooth SBC AudioWorklet ${mode} ${sampleRate} Hz ${setting.id} ` +
              `trial ${repetition + 1}/${REPETITIONS}\n`
            );
            trials.push(await runTrial({
              browser,
              baseURL: server.baseURL,
              artifactPath: mode === 'simd'
                ? artifactSet.simdPath
                : artifactSet.baselinePath,
              mode,
              sampleRate,
              setting,
              aggregateTiming,
              aggregateWallTiming
            }));
          }
          results.push({
            mode,
            sampleRate,
            channels: CHANNELS,
            setting: setting.id,
            parameters: setting.parameters,
            quantumStats: aggregateTiming.result(),
            quantumTrials: trials.map(trial => trial.timing),
            wallStats: aggregateWallTiming.result(),
            wallTrials: trials.map(trial => trial.wallTiming),
            traceTrials: trials.map(trial => ({
              initialization: trial.initialization,
              measurement: trial.measurement,
              trace: trial.trace
            }))
          });
        }
      }
    }

    const artifactProvenance = {
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
    const evaluated = evaluateSbcRealtimeGate({ results }, {
      powerMode,
      artifactProvenance,
      modes
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
      passed: evaluated.passed && finalDigest === artifactSet.metadata.sourceDigest &&
        inputsStable,
      measurementAuthority: 'chromium-production-audioworklet-author-slice-v1',
      timingClock: 'CDP thread duration (tdur)',
      wallTimingPolicy: 'diagnostic-only',
      browserVersion,
      digestBoundaries,
      inputManifests: {
        stable: inputsStable,
        snapshotStability: {
          start: startStabilityManifest,
          end: endStabilityManifest
        },
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
      throw new Error(`Bluetooth SBC AudioWorklet hard gate failed; see ${outputPath}`);
    }
    return output;
  } finally {
    await browser?.close().catch(() => {});
    await stopIsolatedStaticServer(server.child);
  }
}

function requireSubcampaign(result, expectedMode) {
  if (result.gate !== 'bluetooth-sbc-realtime-v1' ||
      JSON.stringify(result.configuration?.modes) !== JSON.stringify([expectedMode]) ||
      result.benchmark?.results?.length !== SBC_SAMPLE_RATES.length * SBC_SETTINGS.length ||
      result.benchmark.results.some(entry => entry.mode !== expectedMode) ||
      result.inputManifests?.stable !== true) {
    throw new Error(`Invalid Bluetooth SBC ${expectedMode} subcampaign result.`);
  }
}

export async function combineBluetoothSbcAudioWorkletGate({
  baselinePath,
  simdPath,
  outputPath
}) {
  const [baseline, simd] = await Promise.all([
    fs.readFile(baselinePath, 'utf8').then(JSON.parse),
    fs.readFile(simdPath, 'utf8').then(JSON.parse)
  ]);
  requireSubcampaign(baseline, 'wasm');
  requireSubcampaign(simd, 'simd');
  const sameArtifact = JSON.stringify(baseline.artifactProvenance) ===
    JSON.stringify(simd.artifactProvenance);
  const baselineStability = baseline.inputManifests.snapshotStability.start.aggregateSha256;
  const simdStability = simd.inputManifests.snapshotStability.start.aggregateSha256;
  const baselineProduction =
    baseline.inputManifests.productionEquivalence.start.aggregateSha256;
  const simdProduction = simd.inputManifests.productionEquivalence.start.aggregateSha256;
  if (!sameArtifact || baselineStability !== simdStability ||
      baselineProduction !== simdProduction || baseline.powerMode !== simd.powerMode) {
    throw new Error('Bluetooth SBC subcampaign provenance does not match.');
  }
  const results = [...baseline.benchmark.results, ...simd.benchmark.results];
  const evaluated = evaluateSbcRealtimeGate({ results }, {
    powerMode: baseline.powerMode,
    artifactProvenance: baseline.artifactProvenance,
    modes: SBC_MODES
  });
  const output = {
    ...evaluated,
    passed: baseline.passed && simd.passed && evaluated.passed,
    measurementAuthority: baseline.measurementAuthority,
    timingClock: baseline.timingClock,
    wallTimingPolicy: baseline.wallTimingPolicy,
    browserVersion: baseline.browserVersion,
    inputManifests: {
      stable: true,
      snapshotStability: baseline.inputManifests.snapshotStability,
      productionEquivalence: baseline.inputManifests.productionEquivalence
    },
    subcampaigns: {
      baseline: {
        path: baselinePath,
        startedAt: baseline.startedAt,
        completedAt: baseline.completedAt,
        passed: baseline.passed
      },
      simd: {
        path: simdPath,
        startedAt: simd.startedAt,
        completedAt: simd.completedAt,
        passed: simd.passed
      }
    },
    combinedAt: new Date().toISOString()
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  if (!output.passed) {
    throw new Error(`Bluetooth SBC combined hard gate failed; see ${outputPath}`);
  }
  return output;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (args['combine-baseline'] || args['combine-simd']) {
    if (!args['combine-baseline'] || !args['combine-simd'] || !args.json) {
      throw new Error(usage());
    }
    await combineBluetoothSbcAudioWorkletGate({
      baselinePath: path.resolve(REPO_ROOT, String(args['combine-baseline'])),
      simdPath: path.resolve(REPO_ROOT, String(args['combine-simd'])),
      outputPath: path.resolve(REPO_ROOT, String(args.json))
    });
    return;
  }
  if (!args['artifacts-dir'] || !args.json || !args['power-mode']) {
    throw new Error(usage());
  }
  await runBluetoothSbcAudioWorkletGate({
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
