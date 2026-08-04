import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { smokeWasm, sourceDigest } from '../../scripts/build-dsp-wasm.mjs';
import { createQuantumTimingAccumulator } from './bench.mjs';
import { parseArgs } from './cli.mjs';
import { startAudioWorkletTraceCapture } from './g726-audioworklet-bench.mjs';
import {
  startIsolatedStaticServer,
  stopIsolatedStaticServer
} from '../run-power-browser-smoke.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FIXTURE_PATH = '/tools/dsp-parity/gsm-full-rate-audioworklet-bench.html';
const PLUGIN_TYPE = 'GSMFullRateSimulatorPlugin';
const PARAMS_HASH = 0xb9a2741c;
const PARAMETERS = Object.freeze({ tc: 3, og: 0, mx: 100, ci: 30 });
const SAMPLE_RATES = Object.freeze([96000, 352800, 384000]);
const MODES = Object.freeze(['wasm', 'simd']);
const CHANNELS = 2;
const BLOCK_SIZE = 128;
const WARMUP_SECONDS = 1;
const DURATION_SECONDS = 30;
const REPETITIONS = 3;
const THREAD_CPU_CLOCK = 'chromium-audioworklet-raw-thread-cpu-aggregate';
const EXPECTED_ABI_VERSION = 1;
const EXPECTED_BASELINE_BUILD_FLAGS = 0;
const EXPECTED_SIMD_BUILD_FLAGS = 1;
const SERVED_ASSET_PATHS = Object.freeze({
  fixture: path.join(REPO_ROOT, 'tools', 'dsp-parity', 'gsm-full-rate-audioworklet-bench.html'),
  audioProcessor: path.join(REPO_ROOT, 'plugins', 'audio-processor.js')
});
const TRACE_CONFIG = Object.freeze({
  transferMode: 'ReportEvents',
  bufferUsageReportingInterval: 1000,
  traceConfig: {
    recordMode: 'recordAsMuchAsPossible',
    traceBufferSizeInKb: 1048576,
    includedCategories: ['disabled-by-default-audio-worklet']
  }
});

export const GSM_FULL_RATE_AUDIOWORKLET_CONFIGURATION = Object.freeze({
  modes: MODES,
  sampleRates: SAMPLE_RATES,
  channels: CHANNELS,
  blockSize: BLOCK_SIZE,
  warmupSeconds: WARMUP_SECONDS,
  durationSeconds: DURATION_SECONDS,
  repetitions: REPETITIONS,
  pluginType: PLUGIN_TYPE,
  parameters: PARAMETERS,
  stimulus: 'noise'
});

export const GSM_FULL_RATE_REALTIME_THRESHOLDS = Object.freeze({
  hardLimitPercent: 15,
  goalPercent: 10
});

function usage() {
  return [
    'Usage: node tools/dsp-parity/gsm-full-rate-audioworklet-bench.mjs',
    '  --artifacts-dir <path> --json <file> --power-mode <label>',
    '',
    'Runs the fixed GSM Full Rate Phase 0 gate with Chromium AudioWorklet tdur.'
  ].join('\n');
}

function artifactUrl(baseURL, artifactPath) {
  const relative = path.relative(REPO_ROOT, artifactPath);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('GSM Full Rate AudioWorklet artifacts must be inside the repository root.');
  }
  const encoded = relative.split(path.sep).map(encodeURIComponent).join('/');
  return `${baseURL}/${encoded}`;
}

export function createGsmCpuAggregate({
  rawThreadCpuTotalMicroseconds,
  formalRenderDurationMilliseconds,
  quantumCount
}) {
  if (!Number.isFinite(rawThreadCpuTotalMicroseconds) ||
      rawThreadCpuTotalMicroseconds < 0 ||
      !Number.isFinite(formalRenderDurationMilliseconds) ||
      formalRenderDurationMilliseconds <= 0 ||
      !Number.isInteger(quantumCount) || quantumCount <= 0) {
    throw new Error('Invalid GSM raw thread CPU aggregate input.');
  }
  const rawThreadCpuTotalMilliseconds = rawThreadCpuTotalMicroseconds / 1000;
  return {
    clock: THREAD_CPU_CLOCK,
    clockPolicy: 'sum(raw tdur) / formal render duration',
    rawThreadCpuTotalMilliseconds,
    formalRenderDurationMilliseconds,
    cpuUtilizationPercent:
      rawThreadCpuTotalMilliseconds * 100 / formalRenderDurationMilliseconds,
    quantumCount
  };
}

function combineCpuAggregates(trials) {
  return createGsmCpuAggregate({
    rawThreadCpuTotalMicroseconds: trials.reduce(
      (total, trial) => total + trial.rawThreadCpuTotalMilliseconds * 1000,
      0
    ),
    formalRenderDurationMilliseconds: trials.reduce(
      (total, trial) => total + trial.formalRenderDurationMilliseconds,
      0
    ),
    quantumCount: trials.reduce((total, trial) => total + trial.quantumCount, 0)
  });
}

function evaluateCpuAggregate(cpuAggregate) {
  const failures = [];
  if (cpuAggregate.clock !== THREAD_CPU_CLOCK) failures.push('clock');
  if (!(cpuAggregate.cpuUtilizationPercent <
        GSM_FULL_RATE_REALTIME_THRESHOLDS.hardLimitPercent)) {
    failures.push('cpuUtilizationPercent');
  }
  return {
    passed: failures.length === 0,
    goalMet: cpuAggregate.cpuUtilizationPercent <=
      GSM_FULL_RATE_REALTIME_THRESHOLDS.goalPercent,
    failures,
    cpuAggregate
  };
}

function validateCampaignResults(results) {
  if (!Array.isArray(results) || results.length !== SAMPLE_RATES.length * MODES.length) {
    throw new Error('GSM Full Rate AudioWorklet campaign has an incomplete result matrix.');
  }
  const expected = new Set(
    SAMPLE_RATES.flatMap(sampleRate => MODES.map(mode => `${mode}:${sampleRate}`))
  );
  for (const result of results) {
    const key = `${result.mode}:${result.sampleRate}`;
    if (!expected.delete(key) || result.channels !== CHANNELS ||
        result.pluginType !== PLUGIN_TYPE || result.blockSize !== BLOCK_SIZE ||
        result.stimulus !== 'noise' ||
        JSON.stringify(result.parameters) !== JSON.stringify(PARAMETERS) ||
        !result.cpuAggregate ||
        result.cpuTrials?.length !== REPETITIONS ||
        result.quantumTrials?.length !== REPETITIONS ||
        result.wallTrials?.length !== REPETITIONS ||
        result.traceTrials?.length !== REPETITIONS) {
      throw new Error(`Invalid GSM Full Rate AudioWorklet result ${key}.`);
    }
  }
  if (expected.size !== 0) {
    throw new Error('GSM Full Rate AudioWorklet campaign omitted a required result.');
  }
}

export function evaluateGsmFullRateRealtimeGate(benchmark, {
  powerMode,
  artifactProvenance
}) {
  validateCampaignResults(benchmark.results);
  const checks = benchmark.results.map(result => {
    const aggregate = evaluateCpuAggregate(result.cpuAggregate);
    const trials = result.cpuTrials.map(evaluateCpuAggregate);
    return {
      mode: result.mode,
      sampleRate: result.sampleRate,
      channels: result.channels,
      passed: trials.every(trial => trial.passed),
      goalMet: trials.every(trial => trial.goalMet),
      failures: [...new Set(trials.flatMap(trial => trial.failures))],
      trials,
      aggregateCpu: result.cpuAggregate,
      perEventTimingPolicy: 'diagnostic-only; excluded from acceptance'
    };
  });
  return {
    gate: 'gsm-full-rate-realtime-v1',
    passed: checks.every(check => check.passed),
    goalMet: checks.every(check => check.goalMet),
    thresholds: GSM_FULL_RATE_REALTIME_THRESHOLDS,
    configuration: GSM_FULL_RATE_AUDIOWORKLET_CONFIGURATION,
    powerMode,
    artifactProvenance,
    checks,
    benchmark
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function assetDescriptor(filePath) {
  const bytes = await fs.readFile(filePath);
  return {
    path: path.relative(REPO_ROOT, filePath).replaceAll('\\', '/'),
    bytes: bytes.length,
    sha256: sha256(bytes)
  };
}

async function readGsmArtifactMetadata(metadataPath) {
  let metadata;
  try {
    metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read GSM DSP metadata ${metadataPath}: ${error.message}`, {
      cause: error
    });
  }
  if (!Array.isArray(metadata.kernels)) {
    throw new Error(`GSM DSP metadata ${metadataPath} has no kernels array.`);
  }
  const kernels = new Map();
  for (const [index, kernel] of metadata.kernels.entries()) {
    if (!kernel || typeof kernel.name !== 'string' ||
        !Number.isInteger(kernel.hash) || kernel.hash < 0 || kernel.hash > 0xffffffff ||
        kernels.has(kernel.name)) {
      throw new Error(`GSM DSP metadata ${metadataPath} has an invalid kernel at index ${index}.`);
    }
    kernels.set(kernel.name, kernel.hash >>> 0);
  }
  return { metadata, kernels };
}

export async function preflightGsmFullRateArtifacts(artifactsDir) {
  const root = path.resolve(REPO_ROOT, artifactsDir);
  const metadataPath = path.join(root, 'effetune-dsp.meta.json');
  const baselinePath = path.join(root, 'effetune-dsp.wasm');
  const simdPath = path.join(root, 'effetune-dsp.simd.wasm');
  const [{ metadata, kernels }, baseline, simd] = await Promise.all([
    readGsmArtifactMetadata(metadataPath),
    smokeWasm(baselinePath, false),
    smokeWasm(simdPath, true)
  ]);
  if (JSON.stringify(baseline.kernels) !== JSON.stringify(simd.kernels) ||
      JSON.stringify(metadata.kernels) !== JSON.stringify(baseline.kernels)) {
    throw new Error('GSM DSP metadata and baseline/SIMD kernel registries do not match.');
  }
  if (metadata.abiVersion !== EXPECTED_ABI_VERSION ||
      baseline.abiVersion !== EXPECTED_ABI_VERSION ||
      simd.abiVersion !== EXPECTED_ABI_VERSION) {
    throw new Error(`GSM DSP artifacts must use ABI ${EXPECTED_ABI_VERSION}.`);
  }
  if (baseline.buildFlags !== EXPECTED_BASELINE_BUILD_FLAGS ||
      simd.buildFlags !== EXPECTED_SIMD_BUILD_FLAGS) {
    throw new Error('GSM DSP artifacts have unexpected baseline/SIMD build flags.');
  }
  if (metadata.sizes?.baseline !== baseline.bytes ||
      metadata.sizes?.simd !== simd.bytes) {
    throw new Error('GSM DSP metadata does not match the artifact byte sizes.');
  }
  const artifactSet = {
    root,
    metadataPath,
    baselinePath,
    simdPath,
    metadata,
    kernels,
    baseline,
    simd
  };
  if (!artifactSet.metadata.phase0Plugins?.includes(PLUGIN_TYPE)) {
    throw new Error('DSP artifacts were not built with --phase0-gsm-fr.');
  }
  const actualHash = artifactSet.kernels.get(PLUGIN_TYPE);
  if (actualHash !== PARAMS_HASH) {
    throw new Error(
      `GSM Full Rate scratch artifact parameter hash is ${actualHash ?? 'missing'}, ` +
      `expected ${PARAMS_HASH}.`
    );
  }
  return artifactSet;
}

async function snapshotServedAssets(artifactSet) {
  const entries = {
    fixture: SERVED_ASSET_PATHS.fixture,
    audioProcessor: SERVED_ASSET_PATHS.audioProcessor,
    metadata: artifactSet.metadataPath,
    baselineWasm: artifactSet.baselinePath,
    simdWasm: artifactSet.simdPath
  };
  return Object.fromEntries(await Promise.all(Object.entries(entries).map(async ([key, filePath]) =>
    [key, await assetDescriptor(filePath)]
  )));
}

function requiredServedAssetKeys(mode) {
  return [
    'fixture',
    'audioProcessor',
    'metadata',
    mode === 'simd' ? 'simdWasm' : 'baselineWasm'
  ];
}

export function gsmServedAssetHashMismatches(expected, observed, requiredKeys) {
  const mismatches = [];
  for (const key of requiredKeys) {
    if (!expected[key]) {
      mismatches.push(`${key}:missing-snapshot`);
    } else if (!observed[key]) {
      mismatches.push(`${key}:not-served`);
    } else if (observed[key].sha256 !== expected[key].sha256 ||
               observed[key].bytes !== expected[key].bytes) {
      mismatches.push(`${key}:content-drift`);
    }
  }
  return mismatches;
}

function assertServedAssetHashes(expected, observed, requiredKeys) {
  const mismatches = gsmServedAssetHashMismatches(expected, observed, requiredKeys);
  if (mismatches.length > 0) {
    const error = new Error(`GSM served asset hash mismatch: ${mismatches.join(', ')}`);
    error.gsmAssetHashEvidence = { observed, mismatches };
    throw error;
  }
}

async function assertLocalAssetSnapshot(expected) {
  const current = await snapshotServedAssets({
    metadataPath: path.join(REPO_ROOT, ...expected.metadata.path.split('/')),
    baselinePath: path.join(REPO_ROOT, ...expected.baselineWasm.path.split('/')),
    simdPath: path.join(REPO_ROOT, ...expected.simdWasm.path.split('/'))
  });
  assertServedAssetHashes(expected, current, Object.keys(expected));
  return current;
}

function artifactProvenance(artifactSet) {
  return {
    root: artifactSet.root,
    sourceDigest: artifactSet.metadata.sourceDigest,
    abiVersion: artifactSet.metadata.abiVersion,
    phase0Plugins: artifactSet.metadata.phase0Plugins,
    baseline: {
      buildFlags: artifactSet.baseline.buildFlags,
      bytes: artifactSet.baseline.bytes
    },
    simd: {
      buildFlags: artifactSet.simd.buildFlags,
      bytes: artifactSet.simd.bytes
    }
  };
}

async function writeJsonAtomic(outputPath, value) {
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    await fs.rename(temporaryPath, outputPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function createServedAssetCapture(page, baseURL, artifactSet, mode) {
  const assetPaths = {
    fixture: SERVED_ASSET_PATHS.fixture,
    audioProcessor: SERVED_ASSET_PATHS.audioProcessor,
    metadata: artifactSet.metadataPath,
    [mode === 'simd' ? 'simdWasm' : 'baselineWasm']:
      mode === 'simd' ? artifactSet.simdPath : artifactSet.baselinePath
  };
  const keysByUrl = new Map(Object.entries(assetPaths).map(([key, filePath]) =>
    [artifactUrl(baseURL, filePath), key]
  ));
  const observations = new Map();
  const onResponse = response => {
    const key = keysByUrl.get(response.url());
    if (!key || observations.has(key)) return;
    observations.set(key, response.body().then(bytes => ({
      url: response.url(),
      status: response.status(),
      bytes: bytes.length,
      sha256: sha256(bytes)
    })).catch(error => ({
      url: response.url(),
      status: response.status(),
      error: error.message
    })));
  };
  page.on('response', onResponse);
  return {
    async snapshot() {
      return Object.fromEntries(await Promise.all([...observations].map(async ([key, value]) =>
        [key, await value]
      )));
    },
    dispose() {
      page.off('response', onResponse);
    }
  };
}

async function runTrial({
  browser,
  baseURL,
  artifactSet,
  assetSnapshot,
  mode,
  sampleRate,
  aggregateTiming,
  aggregateWallTiming
}) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const cdp = await page.context().newCDPSession(page);
  let phase = 'page-initialization';
  let initialization = null;
  let preRoll = null;
  let measurement = null;
  let expectedQuanta = null;
  let capture = null;
  let captured = null;
  let cpuAggregate = null;
  let servedAssets = null;
  let stopAttempted = false;
  const servedAssetCapture = createServedAssetCapture(page, baseURL, artifactSet, mode);
  try {
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.goto(`${baseURL}${FIXTURE_PATH}`, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForFunction(() => window.gsmFullRateAudioWorkletBench !== undefined, {
      timeout: 10_000
    });
    initialization = await page.evaluate(config =>
      window.gsmFullRateAudioWorkletBench.initialize(config), {
      sampleRate,
      artifactUrl: artifactUrl(
        baseURL,
        mode === 'simd' ? artifactSet.simdPath : artifactSet.baselinePath
      ),
      metadataUrl: artifactUrl(baseURL, artifactSet.metadataPath),
      simd: mode === 'simd'
    });
    servedAssets = await servedAssetCapture.snapshot();
    assertServedAssetHashes(
      assetSnapshot,
      servedAssets,
      requiredServedAssetKeys(mode)
    );
    if (pageErrors.length > 0) throw new Error(`AudioWorklet page error: ${pageErrors[0]}`);
    if (initialization.state !== 'suspended' ||
        initialization.warmupContextSeconds < WARMUP_SECONDS - 0.1 ||
        initialization.pluginType !== PLUGIN_TYPE || initialization.channels !== CHANNELS ||
        initialization.blockSize !== BLOCK_SIZE || initialization.stimulus !== 'noise' ||
        JSON.stringify(initialization.parameters) !== JSON.stringify(PARAMETERS)) {
      throw new Error('AudioWorklet did not complete the one-second GSM warm-up.');
    }

    capture = startAudioWorkletTraceCapture(cdp, {
      sampleRate,
      aggregateTiming,
      aggregateWallTiming,
      inspectEvents: false,
      deferTiming: true
    });
    phase = 'trace-start';
    await cdp.send('Tracing.start', TRACE_CONFIG);
    phase = 'one-second-pre-roll';
    preRoll = await page.evaluate(durationMs =>
      window.gsmFullRateAudioWorkletBench.startPreRoll(durationMs), WARMUP_SECONDS * 1000);
    if (preRoll.state !== 'running' ||
        preRoll.contextSeconds < WARMUP_SECONDS - 0.1) {
      throw new Error('AudioWorklet trace pre-roll did not complete.');
    }

    phase = 'formal-measurement';
    measurement = await page.evaluate(durationMs =>
      window.gsmFullRateAudioWorkletBench.measure(durationMs), DURATION_SECONDS * 1000);
    if (measurement.state !== 'suspended' ||
        !Number.isFinite(measurement.startTime) || !Number.isFinite(measurement.endTime) ||
        measurement.endTime < measurement.startTime) {
      throw new Error('AudioWorklet returned an invalid formal measurement interval.');
    }
    const formalContextSeconds = measurement.endTime - measurement.startTime;
    if (formalContextSeconds < DURATION_SECONDS - 0.5 ||
        Math.abs(formalContextSeconds - measurement.contextSeconds) > 1e-9) {
      throw new Error('AudioWorklet did not complete the 30-second measurement interval.');
    }
    const exactQuanta = formalContextSeconds * sampleRate / BLOCK_SIZE;
    expectedQuanta = Math.round(exactQuanta);
    if (Math.abs(exactQuanta - expectedQuanta) > 1e-6) {
      throw new Error('AudioWorklet formal interval was not an integer render-quantum count.');
    }
    phase = 'trace-stop';
    stopAttempted = true;
    captured = await capture.stop({ expectedAuthorSlices: expectedQuanta });
    if (pageErrors.length > 0) throw new Error(`AudioWorklet page error: ${pageErrors[0]}`);
    if (captured.timing.quantumCount !== expectedQuanta ||
        captured.trace.selectedAuthorSlices !== expectedQuanta ||
        !Number.isFinite(captured.trace.selectedRawThreadDurationMicroseconds) ||
        captured.trace.selectedRawThreadDurationMicroseconds < 0) {
      throw new Error(
        `AudioWorklet trace quantum count mismatch: expected ${expectedQuanta}, ` +
        `observed ${captured.timing.quantumCount}.`
      );
    }
    cpuAggregate = createGsmCpuAggregate({
      rawThreadCpuTotalMicroseconds:
        captured.trace.selectedRawThreadDurationMicroseconds,
      formalRenderDurationMilliseconds:
        expectedQuanta * BLOCK_SIZE * 1000 / sampleRate,
      quantumCount: expectedQuanta
    });
    return {
      ...captured,
      cpuAggregate,
      initialization,
      servedAssets,
      measurement: {
        ...measurement,
        expectedQuanta,
        observedQuanta: captured.timing.quantumCount,
        observedAudioSeconds: captured.timing.quantumCount * BLOCK_SIZE / sampleRate
      }
    };
  } catch (error) {
    if (capture && !stopAttempted) {
      stopAttempted = true;
      await capture.stop().catch(() => {});
    }
    servedAssets ??= await servedAssetCapture.snapshot().catch(() => null);
    error.gsmTrialEvidence = {
      phase,
      initialization,
      servedAssets,
      assetHashMismatches: error.gsmAssetHashEvidence?.mismatches ?? null,
      preRoll,
      measurement,
      expectedQuanta,
      observedQuanta: captured?.timing?.quantumCount ??
        capture?.snapshot().capturedAuthorSlices ?? null,
      timing: captured?.timing ?? null,
      wallTiming: captured?.wallTiming ?? null,
      cpuAggregate,
      trace: captured?.trace ?? capture?.snapshot() ?? null
    };
    throw error;
  } finally {
    servedAssetCapture.dispose();
    await page.evaluate(() => window.gsmFullRateAudioWorkletBench?.close()).catch(() => {});
    await cdp.send('Network.disable').catch(() => {});
    await cdp.detach().catch(() => {});
    await page.close().catch(() => {});
  }
}

export async function runGsmFullRateAudioWorkletGate({
  artifactsDir,
  outputPath,
  powerMode
}) {
  const artifactSet = await preflightGsmFullRateArtifacts(artifactsDir);
  const servedAssetSnapshot = await snapshotServedAssets(artifactSet);
  const startingSourceDigest = sourceDigest({ includePhase0: true });
  const server = await startIsolatedStaticServer();
  let browser;
  let browserVersion = null;
  const results = [];
  let activeTrial = null;
  let outputWritten = false;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--autoplay-policy=no-user-gesture-required']
    });
    browserVersion = await browser.version();
    for (const sampleRate of SAMPLE_RATES) {
      for (const mode of MODES) {
        const aggregateTiming = createQuantumTimingAccumulator();
        const aggregateWallTiming = createQuantumTimingAccumulator();
        const trials = [];
        for (let repetition = 0; repetition < REPETITIONS; repetition++) {
          activeTrial = { mode, sampleRate, repetition: repetition + 1 };
          await assertLocalAssetSnapshot(servedAssetSnapshot);
          process.stdout.write(
            `GSM Full Rate AudioWorklet ${mode} ${sampleRate} Hz ` +
            `trial ${repetition + 1}/${REPETITIONS}\n`
          );
          trials.push(await runTrial({
            browser,
            baseURL: server.baseURL,
            artifactSet,
            assetSnapshot: servedAssetSnapshot,
            mode,
            sampleRate,
            aggregateTiming,
            aggregateWallTiming
          }));
          activeTrial = null;
        }
        const cpuTrials = trials.map((trial, index) => ({
          mode,
          sampleRate,
          trial: index + 1,
          ...trial.cpuAggregate
        }));
        results.push({
          mode,
          sampleRate,
          channels: CHANNELS,
          blockSize: BLOCK_SIZE,
          pluginType: PLUGIN_TYPE,
          parameters: PARAMETERS,
          stimulus: 'noise',
          cpuAggregate: {
            mode,
            sampleRate,
            trial: 'aggregate',
            ...combineCpuAggregates(cpuTrials)
          },
          cpuTrials,
          quantumStats: aggregateTiming.result(),
          quantumTrials: trials.map(trial => trial.timing),
          wallStats: aggregateWallTiming.result(),
          wallTrials: trials.map(trial => trial.wallTiming),
          traceTrials: trials.map((trial, index) => ({
            initialization: trial.initialization,
            servedAssets: trial.servedAssets,
            measurement: trial.measurement,
            cpuAggregate: cpuTrials[index],
            trace: trial.trace
          }))
        });
      }
    }

    const benchmark = { results };
    const evaluated = evaluateGsmFullRateRealtimeGate(benchmark, {
      powerMode,
      artifactProvenance: artifactProvenance(artifactSet)
    });
    await assertLocalAssetSnapshot(servedAssetSnapshot);
    const finalDigest = sourceDigest({ includePhase0: true });
    const output = {
      ...evaluated,
      valid: true,
      measurementAuthority: 'chromium-production-audioworklet-author-slice-v3',
      timingClock: THREAD_CPU_CLOCK,
      timingClockPolicy: 'sum(raw tdur) / exact formal render duration',
      perEventTimingPolicy: 'diagnostic-only; max/p99/deadline misses excluded from acceptance',
      wallTimingPolicy: 'raw dur retained only in trace diagnostics',
      browserVersion,
      servedAssetSnapshot,
      runtimeAssetsCurrentAtCompletion: true,
      sourceDigestDiagnostics: {
        artifact: artifactSet.metadata.sourceDigest,
        start: startingSourceDigest,
        end: finalDigest,
        changedDuringCampaign: finalDigest !== startingSourceDigest
      }
    };
    await writeJsonAtomic(outputPath, output);
    outputWritten = true;
    if (!output.passed) {
      throw new Error(`GSM Full Rate AudioWorklet hard gate failed; see ${outputPath}`);
    }
    return output;
  } catch (error) {
    if (!outputWritten) {
      const finalDigest = sourceDigest({ includePhase0: true });
      const evidence = error.gsmTrialEvidence ?? {};
      let currentServedAssets = null;
      let runtimeAssetMismatches = error.gsmAssetHashEvidence?.mismatches ?? [];
      try {
        currentServedAssets = await snapshotServedAssets(artifactSet);
        runtimeAssetMismatches = [
          ...new Set([
            ...runtimeAssetMismatches,
            ...gsmServedAssetHashMismatches(
              servedAssetSnapshot,
              currentServedAssets,
              Object.keys(servedAssetSnapshot)
            )
          ])
        ];
      } catch (snapshotError) {
        runtimeAssetMismatches.push(`snapshot-error:${snapshotError.message}`);
      }
      await writeJsonAtomic(outputPath, {
        gate: 'gsm-full-rate-realtime-v1',
        valid: false,
        passed: null,
        reason: error.message,
        phase: evidence.phase ?? 'campaign',
        configuration: GSM_FULL_RATE_AUDIOWORKLET_CONFIGURATION,
        powerMode,
        activeTrial,
        contextSeconds: evidence.measurement?.contextSeconds ?? null,
        expectedQuanta: evidence.expectedQuanta ?? null,
        observedQuanta: evidence.observedQuanta ?? null,
        trialEvidence: evidence,
        completedResults: results,
        browserVersion,
        artifactProvenance: artifactProvenance(artifactSet),
        servedAssetSnapshot,
        currentServedAssets,
        runtimeAssetMismatches,
        runtimeAssetsCurrentAtFailure: runtimeAssetMismatches.length === 0,
        sourceDigestDiagnostics: {
          artifact: artifactSet.metadata.sourceDigest,
          start: startingSourceDigest,
          end: finalDigest,
          changedDuringCampaign: finalDigest !== startingSourceDigest
        },
        completedAt: new Date().toISOString()
      });
    }
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    await stopIsolatedStaticServer(server.child);
  }
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
  await runGsmFullRateAudioWorkletGate({
    artifactsDir: path.resolve(REPO_ROOT, String(args['artifacts-dir'])),
    outputPath: path.resolve(REPO_ROOT, String(args.json)),
    powerMode: String(args['power-mode'])
  });
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
