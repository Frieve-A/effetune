import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { sourceDigest } from '../../scripts/build-dsp-wasm.mjs';
import {
  createQuantumTimingAccumulator,
  evaluateG726RealtimeGate,
  preflightArtifactDirectory
} from './bench.mjs';
import { parseArgs } from './cli.mjs';
import {
  startIsolatedStaticServer,
  stopIsolatedStaticServer
} from '../run-power-browser-smoke.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FIXTURE_PATH = '/tools/dsp-parity/g726-audioworklet-bench.html';
const AUDIO_WORKLET_AUTHOR_EVENT =
  'AudioWorkletProcessor::Process (author script execution)';
const SAMPLE_RATES = Object.freeze([96000, 352800, 384000]);
const MODES = Object.freeze(['wasm', 'simd']);
const CHANNELS = 2;
const BLOCK_SIZE = 128;
const DURATION_SECONDS = 30;
const REPETITIONS = 3;
const DIAGNOSTIC_DURATION_SECONDS = 5;
const IDENTITY_PLUGIN_TYPE = 'VolumePlugin';
const G726_PLUGIN_TYPE = 'G726ADPCMSimulatorPlugin';
const TRACE_CONFIG = Object.freeze({
  transferMode: 'ReportEvents',
  bufferUsageReportingInterval: 1000,
  traceConfig: {
    recordMode: 'recordAsMuchAsPossible',
    traceBufferSizeInKb: 1048576,
    includedCategories: ['disabled-by-default-audio-worklet']
  }
});

function usage() {
  return [
    'Usage: node tools/dsp-parity/g726-audioworklet-bench.mjs --artifacts-dir <path> --json <file> --power-mode <label>',
    '',
    'Runs the fixed G.726 Release baseline/SIMD hard gate in a real Chromium AudioWorklet.',
    'Use --diagnostic-384 for a non-gating 5-second baseline/SIMD measurement at 384 kHz.',
    'Use --identity-384 for a 3 x 30-second Volume 0 dB host baseline at 384 kHz.',
    'Use --inspect-events for a 1-second G.726 trace-event inventory at 384 kHz.'
  ].join('\n');
}

function withTimeout(promise, timeoutMs, label) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timeout));
}

function artifactUrl(baseURL, artifactPath) {
  const relative = path.relative(REPO_ROOT, artifactPath);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('G.726 AudioWorklet artifacts must be inside the repository root.');
  }
  const encoded = relative.split(path.sep).map(encodeURIComponent).join('/');
  return `${baseURL}/${encoded}`;
}

export function validateAudioWorkletAuthorSlice(traceEvent) {
  if (!Number.isFinite(traceEvent.tdur) || traceEvent.tdur < 0 ||
      !Number.isFinite(traceEvent.dur) || traceEvent.dur < 0 ||
      !Number.isInteger(traceEvent.pid) || !Number.isInteger(traceEvent.tid)) {
    return 'invalid-fields';
  }
  return null;
}

export function startAudioWorkletTraceCapture(cdp, {
  sampleRate,
  aggregateTiming,
  aggregateWallTiming,
  inspectEvents,
  deferTiming = false,
  capThreadDurationToWall = false
}) {
  const timing = createQuantumTimingAccumulator();
  const wallTiming = createQuantumTimingAccumulator();
  const threadKeys = new Set();
  const samples = [];
  const invalidEvents = [];
  const eventTypes = new Map();
  const eventSamples = [];
  const threadDurationExcessSamples = [];
  const authorSlices = [];
  let dataBatches = 0;
  let dataEvents = 0;
  let authorEvents = 0;
  let maximumBufferPercentFull = 0;
  let threadDurationExceedsWallCount = 0;
  let maximumThreadDurationExcessMicroseconds = 0;
  let tracingComplete = null;
  let selectedAuthorSlices = null;
  let selectedRawThreadDurationMicroseconds = null;
  let resolveComplete;
  const completePromise = new Promise(resolve => { resolveComplete = resolve; });

  const onDataCollected = event => {
    dataBatches++;
    if (!Array.isArray(event.value)) {
      invalidEvents.push('Tracing.dataCollected value was not an array');
      return;
    }
    dataEvents += event.value.length;
    for (const traceEvent of event.value) {
      if (inspectEvents) {
        const key = `${traceEvent.cat ?? ''}\u0000${traceEvent.name ?? ''}\u0000${traceEvent.ph ?? ''}`;
        let eventType = eventTypes.get(key);
        if (!eventType) {
          eventType = {
            category: traceEvent.cat ?? '',
            name: traceEvent.name ?? '',
            phase: traceEvent.ph ?? '',
            count: 0,
            threads: new Set()
          };
          eventTypes.set(key, eventType);
        }
        eventType.count++;
        if (Number.isInteger(traceEvent.pid) && Number.isInteger(traceEvent.tid)) {
          eventType.threads.add(`${traceEvent.pid}:${traceEvent.tid}`);
        }
        if (eventSamples.length < 20_000 && traceEvent.ph === 'X') {
          eventSamples.push({
            category: traceEvent.cat ?? '',
            name: traceEvent.name ?? '',
            phase: traceEvent.ph,
            ts: traceEvent.ts,
            dur: traceEvent.dur,
            tts: traceEvent.tts,
            tdur: traceEvent.tdur,
            pid: traceEvent.pid,
            tid: traceEvent.tid
          });
        }
      }
      if (traceEvent.name !== AUDIO_WORKLET_AUTHOR_EVENT || traceEvent.ph !== 'X') continue;
      authorEvents++;
      const invalidReason = validateAudioWorkletAuthorSlice(traceEvent);
      if (invalidReason !== null) {
        invalidEvents.push(
          `Invalid AudioWorklet author slice ${authorEvents}: ${invalidReason}`
        );
        continue;
      }
      if (deferTiming && (!Number.isFinite(traceEvent.ts) || traceEvent.ts < 0 ||
          (authorSlices.length > 0 && traceEvent.ts < authorSlices.at(-1).ts))) {
        invalidEvents.push(`Invalid AudioWorklet author slice ${authorEvents}: invalid-order`);
        continue;
      }
      const threadDurationExcessMicroseconds = traceEvent.tdur - traceEvent.dur;
      if (threadDurationExcessMicroseconds > 0) {
        threadDurationExceedsWallCount++;
        if (threadDurationExcessMicroseconds > maximumThreadDurationExcessMicroseconds) {
          maximumThreadDurationExcessMicroseconds = threadDurationExcessMicroseconds;
        }
        if (threadDurationExcessSamples.length < 12) {
          threadDurationExcessSamples.push({
            index: authorEvents,
            dur: traceEvent.dur,
            tdur: traceEvent.tdur,
            delta: threadDurationExcessMicroseconds,
            pid: traceEvent.pid,
            tid: traceEvent.tid
          });
        }
      }
      threadKeys.add(`${traceEvent.pid}:${traceEvent.tid}`);
      const effectiveThreadDuration = capThreadDurationToWall
        ? Math.min(traceEvent.tdur, traceEvent.dur)
        : traceEvent.tdur;
      const observation = {
        elapsedMilliseconds: effectiveThreadDuration / 1000,
        blockFrames: BLOCK_SIZE,
        sampleRate,
        clock: capThreadDurationToWall
          ? 'chromium-audioworklet-effective-thread-cpu'
          : 'chromium-audioworklet-thread-cpu'
      };
      const wallObservation = {
        elapsedMilliseconds: traceEvent.dur / 1000,
        blockFrames: BLOCK_SIZE,
        sampleRate,
        clock: 'chromium-audioworklet-wall-diagnostic'
      };
      if (deferTiming) {
        authorSlices.push({
          ts: traceEvent.ts,
          dur: traceEvent.dur,
          tts: traceEvent.tts,
          tdur: traceEvent.tdur,
          pid: traceEvent.pid,
          tid: traceEvent.tid
        });
      } else {
        timing.observe(observation);
        wallTiming.observe(wallObservation);
        aggregateTiming.observe(observation);
        aggregateWallTiming.observe(wallObservation);
      }
      if (samples.length < 12) {
        samples.push({
          ts: traceEvent.ts,
          dur: traceEvent.dur,
          tts: traceEvent.tts,
          tdur: traceEvent.tdur,
          pid: traceEvent.pid,
          tid: traceEvent.tid
        });
      }
    }
  };
  const onBufferUsage = event => {
    if (Number.isFinite(event.percentFull) && event.percentFull > maximumBufferPercentFull) {
      maximumBufferPercentFull = event.percentFull;
    }
  };
  const onTracingComplete = event => {
    tracingComplete = event;
    resolveComplete(event);
  };
  cdp.on('Tracing.dataCollected', onDataCollected);
  cdp.on('Tracing.bufferUsage', onBufferUsage);
  cdp.on('Tracing.tracingComplete', onTracingComplete);

  const traceSnapshot = () => ({
    transferMode: TRACE_CONFIG.transferMode,
    eventName: AUDIO_WORKLET_AUTHOR_EVENT,
    dataBatches,
    dataEvents,
    authorEvents,
    thread: threadKeys.size === 1 ? [...threadKeys][0] : null,
    threads: [...threadKeys],
    maximumBufferPercentFull,
    dataLossOccurred: tracingComplete?.dataLossOccurred === true,
    invalidEvents: [...invalidEvents],
    threadDurationPolicy: capThreadDurationToWall
      ? 'min(raw tdur, raw dur)'
      : 'raw tdur',
    threadDurationExceedsWallCount,
    maximumThreadDurationExcessMicroseconds,
    threadDurationExcessSamples,
    samples,
    ...(deferTiming ? {
      capturedAuthorSlices: authorSlices.length,
      selectedAuthorSlices: selectedAuthorSlices?.length ?? null,
      selectedRawThreadDurationMicroseconds,
      preRollAuthorSlices: selectedAuthorSlices === null
        ? null
        : authorSlices.length - selectedAuthorSlices.length,
      firstCapturedSlice: authorSlices[0] ?? null,
      lastCapturedSlice: authorSlices.at(-1) ?? null,
      firstSelectedSlice: selectedAuthorSlices?.[0] ?? null,
      lastSelectedSlice: selectedAuthorSlices?.at(-1) ?? null
    } : {}),
    ...(inspectEvents ? {
      eventTypes: [...eventTypes.values()]
        .map(eventType => ({
          ...eventType,
          threads: [...eventType.threads]
        }))
        .sort((left, right) => right.count - left.count),
      eventSamples
    } : {})
  });

  return {
    snapshot: traceSnapshot,
    async stop({ expectedAuthorSlices = null } = {}) {
      await cdp.send('Tracing.end');
      await withTimeout(completePromise, 30_000, 'Chromium trace completion');
      cdp.off('Tracing.dataCollected', onDataCollected);
      cdp.off('Tracing.bufferUsage', onBufferUsage);
      cdp.off('Tracing.tracingComplete', onTracingComplete);
      if (tracingComplete?.dataLossOccurred === true) {
        throw new Error('Chromium reported AudioWorklet trace data loss.');
      }
      if (invalidEvents.length > 0) throw new Error(invalidEvents[0]);
      if (authorEvents === 0) throw new Error('Chromium produced no AudioWorklet author slices.');
      if (threadKeys.size !== 1) {
        throw new Error(`AudioWorklet author slices used ${threadKeys.size} trace threads.`);
      }
      if (deferTiming) {
        if (expectedAuthorSlices === null) {
          return { timing: null, wallTiming: null, trace: traceSnapshot() };
        }
        if (!Number.isInteger(expectedAuthorSlices) || expectedAuthorSlices <= 0) {
          throw new Error('Deferred AudioWorklet timing requires expectedAuthorSlices.');
        }
        if (authorSlices.length < expectedAuthorSlices) {
          throw new Error(
            `AudioWorklet trace has ${authorSlices.length} author slices; ` +
            `${expectedAuthorSlices} required.`
          );
        }
        selectedAuthorSlices = authorSlices.slice(-expectedAuthorSlices);
        selectedRawThreadDurationMicroseconds = selectedAuthorSlices.reduce(
          (total, traceEvent) => total + traceEvent.tdur,
          0
        );
        if (!Number.isFinite(selectedRawThreadDurationMicroseconds) ||
            selectedRawThreadDurationMicroseconds < 0) {
          throw new Error('AudioWorklet trace has an invalid raw thread CPU total.');
        }
        for (const traceEvent of selectedAuthorSlices) {
          const effectiveThreadDuration = capThreadDurationToWall
            ? Math.min(traceEvent.tdur, traceEvent.dur)
            : traceEvent.tdur;
          const observation = {
            elapsedMilliseconds: effectiveThreadDuration / 1000,
            blockFrames: BLOCK_SIZE,
            sampleRate,
            clock: capThreadDurationToWall
              ? 'chromium-audioworklet-effective-thread-cpu'
              : 'chromium-audioworklet-thread-cpu'
          };
          const wallObservation = {
            elapsedMilliseconds: traceEvent.dur / 1000,
            blockFrames: BLOCK_SIZE,
            sampleRate,
            clock: 'chromium-audioworklet-wall-diagnostic'
          };
          timing.observe(observation);
          wallTiming.observe(wallObservation);
          aggregateTiming.observe(observation);
          aggregateWallTiming.observe(wallObservation);
        }
      }
      return {
        timing: timing.result(),
        wallTiming: wallTiming.result(),
        trace: traceSnapshot()
      };
    }
  };
}

async function runTrial({
  browser,
  baseURL,
  artifactPath,
  mode,
  sampleRate,
  durationSeconds,
  pluginType,
  inspectEvents,
  aggregateTiming,
  aggregateWallTiming
}) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const cdp = await page.context().newCDPSession(page);
  try {
    await page.goto(`${baseURL}${FIXTURE_PATH}`, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForFunction(() => window.g726AudioWorkletBench !== undefined, {
      timeout: 10_000
    });
    const initialization = await page.evaluate(config =>
      window.g726AudioWorkletBench.initialize(config), {
      sampleRate,
      artifactUrl: artifactUrl(baseURL, artifactPath),
      simd: mode === 'simd',
      pluginType
    });
    if (pageErrors.length > 0) throw new Error(`AudioWorklet page error: ${pageErrors[0]}`);

    const capture = startAudioWorkletTraceCapture(cdp, {
      sampleRate,
      aggregateTiming,
      aggregateWallTiming,
      inspectEvents
    });
    await cdp.send('Tracing.start', TRACE_CONFIG);
    const measurement = await page.evaluate(durationMs =>
      window.g726AudioWorkletBench.measure(durationMs), durationSeconds * 1000);
    const captured = await capture.stop();
    const observedAudioSeconds = captured.timing.quantumCount * BLOCK_SIZE / sampleRate;
    if (measurement.state !== 'suspended' ||
        measurement.contextSeconds < durationSeconds - 0.5) {
      throw new Error(
        `AudioWorklet did not complete the ${durationSeconds}-second measurement interval.`
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
    await page.evaluate(() => window.g726AudioWorkletBench?.close()).catch(() => {});
    await cdp.detach().catch(() => {});
    await page.close().catch(() => {});
  }
}

export async function runG726AudioWorkletGate({
  artifactsDir,
  outputPath,
  powerMode,
  diagnostic384 = false,
  identity384 = false,
  inspectEvents = false
}) {
  const artifactSet = await preflightArtifactDirectory(artifactsDir, REPO_ROOT);
  const sampleRates = diagnostic384 || identity384 || inspectEvents ? [384000] : SAMPLE_RATES;
  const modes = inspectEvents ? ['wasm'] : MODES;
  const durationSeconds = inspectEvents
    ? 1
    : diagnostic384 ? DIAGNOSTIC_DURATION_SECONDS : DURATION_SECONDS;
  const repetitions = diagnostic384 || inspectEvents ? 1 : REPETITIONS;
  const pluginType = identity384 ? IDENTITY_PLUGIN_TYPE : G726_PLUGIN_TYPE;
  const diagnosticOnly = diagnostic384 || identity384 || inspectEvents;
  const server = await startIsolatedStaticServer();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--autoplay-policy=no-user-gesture-required']
    });
    const browserVersion = await browser.version();
    const results = [];
    for (const sampleRate of sampleRates) {
      for (const mode of modes) {
        const aggregateTiming = createQuantumTimingAccumulator();
        const aggregateWallTiming = createQuantumTimingAccumulator();
        const trials = [];
        for (let repetition = 0; repetition < repetitions; repetition++) {
          process.stdout.write(
            `G.726 AudioWorklet ${mode} ${sampleRate} Hz ` +
            `trial ${repetition + 1}/${repetitions}\n`
          );
          const trial = await runTrial({
            browser,
            baseURL: server.baseURL,
            artifactPath: mode === 'simd' ? artifactSet.simdPath : artifactSet.baselinePath,
            mode,
            sampleRate,
            durationSeconds,
            pluginType,
            inspectEvents,
            aggregateTiming,
            aggregateWallTiming
          });
          trials.push(trial);
        }
        results.push({
          mode,
          sampleRate,
          channels: CHANNELS,
          pluginType,
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

    const benchmark = { results };
    const evaluated = evaluateG726RealtimeGate(benchmark, {
      powerMode,
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
    const finalDigest = sourceDigest();
    const output = {
      ...evaluated,
      passed: diagnosticOnly
        ? null
        : evaluated.passed && finalDigest === artifactSet.metadata.sourceDigest,
      diagnosticOnly,
      formalGatePassedIfApplied: diagnosticOnly ? evaluated.passed : undefined,
      configuration: diagnosticOnly
        ? {
            ...evaluated.configuration,
            modes,
            sampleRates,
            durationSeconds,
            repetitions,
            pluginType
          }
        : evaluated.configuration,
      measurementAuthority: 'chromium-production-audioworklet-author-slice-v1',
      timingClock: 'CDP thread duration (tdur)',
      wallTimingPolicy: 'diagnostic-only',
      browserVersion,
      artifactCurrentAtCompletion: finalDigest === artifactSet.metadata.sourceDigest,
      finalSourceDigest: finalDigest,
      nodeWallDiagnostic: 'performance-gate.json is diagnostic and is not acceptance evidence'
    };
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
    if (!diagnosticOnly && !output.passed) {
      throw new Error(`G.726 AudioWorklet hard gate failed; see ${outputPath}`);
    }
    return output;
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
  await runG726AudioWorkletGate({
    artifactsDir: path.resolve(REPO_ROOT, String(args['artifacts-dir'])),
    outputPath: path.resolve(REPO_ROOT, String(args.json)),
    powerMode: String(args['power-mode']),
    diagnostic384: args['diagnostic-384'] === true,
    identity384: args['identity-384'] === true,
    inspectEvents: args['inspect-events'] === true
  });
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
