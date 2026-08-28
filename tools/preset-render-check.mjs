import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DSP_PARAM_PACKERS } from '../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../js/audio/dsp-wasm-loader.js';
import { DEFAULT_REPO_ROOT, readPluginManifest } from './dsp-parity/cases.mjs';
import { isMain, parseArgs } from './dsp-parity/cli.mjs';
import { createReferenceSession, loadReferencePlugin } from './dsp-parity/node-host.mjs';
import { XorShift64 } from './dsp-parity/stimuli.mjs';

const SAMPLE_RATE = 96000;
const CHANNELS = 2;
const DEFAULT_SECONDS = 2;
const ALL_RUN_VINYL_SIMULATOR_SECONDS = 0.5;
const CLIP_THRESHOLD = 1;
const PEAK_LIMIT = 10 ** (6 / 20);
const PROGRAM_SEED = 0xEFFE7A5En;

function parseOptions(argv) {
  const args = parseArgs(argv);
  const allowedOptions = new Set(['_', 'type', 'seconds', 'help', 'h']);
  if (Object.keys(args).some(key => !allowedOptions.has(key))) {
    throw new Error('Usage: node tools/preset-render-check.mjs [--type <PluginType>] [--seconds <duration>]');
  }
  if (args.help || args.h) {
    return { help: true };
  }
  if (args._.length > 0 || (args.type !== undefined && typeof args.type !== 'string')) {
    throw new Error('Usage: node tools/preset-render-check.mjs [--type <PluginType>] [--seconds <duration>]');
  }
  const seconds = args.seconds === undefined ? null : Number(args.seconds);
  if (seconds !== null && (typeof args.seconds !== 'string' || !Number.isFinite(seconds) ||
    seconds <= 0 || Math.round(SAMPLE_RATE * seconds) < 1)) {
    throw new Error('--seconds must be a positive number');
  }
  return { type: args.type ?? null, seconds };
}

function usage() {
  console.log('Usage: node tools/preset-render-check.mjs [--type <PluginType>] [--seconds <duration>]');
  console.log('Processes each system preset through baseline WASM at 96 kHz with silence and a deterministic program signal.');
}

export function programSignal(frames) {
  const output = new Float32Array(frames * CHANNELS);
  const random = new XorShift64(PROGRAM_SEED);
  for (let channel = 0; channel < CHANNELS; channel++) {
    const offset = channel * frames;
    const phase = channel * 0.19;
    for (let frame = 0; frame < frames; frame++) {
      const seconds = frame / SAMPLE_RATE;
      output[offset + frame] = 0.18 * Math.sin(2 * Math.PI * 127 * seconds + phase) +
        0.11 * Math.sin(2 * Math.PI * 997 * seconds + phase * 2) +
        0.07 * Math.sin(2 * Math.PI * 3137 * seconds + phase * 3) +
        0.04 * random.nextBipolar();
    }
  }
  return output;
}

function analyze(output) {
  let squares = 0;
  let peak = 0;
  let clipCount = 0;
  let nonFiniteCount = 0;
  for (const sample of output) {
    if (!Number.isFinite(sample)) {
      nonFiniteCount++;
      continue;
    }
    const magnitude = sample < 0 ? -sample : sample;
    if (magnitude > peak) peak = magnitude;
    if (magnitude >= CLIP_THRESHOLD) clipCount++;
    squares += sample * sample;
  }
  const rms = nonFiniteCount === 0 ? Math.sqrt(squares / output.length) : Number.NaN;
  return { rms, peak, clipCount, nonFiniteCount };
}

function dbfs(value) {
  if (Number.isNaN(value)) return 'NaN dBFS';
  if (value === 0) return '-Infinity dBFS';
  return `${(20 * Math.log10(value)).toFixed(2)} dBFS`;
}

function presetsFor(PluginClass, type) {
  if (typeof PluginClass.getSystemPresetGroups !== 'function') return [];
  const groups = PluginClass.getSystemPresetGroups();
  if (!Array.isArray(groups)) {
    throw new Error(`${type} returned a non-array system preset group list`);
  }
  const presets = [];
  for (const group of groups) {
    if (!Array.isArray(group?.presets)) {
      throw new Error(`${type} returned an invalid system preset group`);
    }
    for (const preset of group.presets) {
      if (typeof preset?.id !== 'string' || !preset.params || typeof preset.params !== 'object') {
        throw new Error(`${type} returned an invalid system preset`);
      }
      presets.push(preset);
    }
  }
  return presets;
}

async function presetProviders(repoRoot, type) {
  const definitions = await readPluginManifest(repoRoot);
  const selected = type
    ? definitions.filter(definition => definition.type === type)
    : definitions;
  if (type && selected.length === 0) throw new Error(`Unknown plugin type: ${type}`);

  const providers = [];
  for (const definition of selected) {
    const loaded = await loadReferencePlugin(definition.type, { repoRoot });
    const presets = presetsFor(loaded.PluginClass, definition.type);
    if (presets.length > 0) providers.push({ definition, presets });
  }
  if (type && providers.length === 0) throw new Error(`${type} has no system presets`);
  return providers;
}

async function effectivePresetParameters(type, preset, repoRoot) {
  const session = await createReferenceSession(type, {
    repoRoot
  });
  if (typeof session.plugin.applySystemPreset === 'function') {
    if (session.plugin.applySystemPreset(preset.id) !== true) {
      throw new Error(`${type} rejected system preset ${preset.id}`);
    }
  } else {
    session.plugin.setParameters(structuredClone(preset.params));
  }
  return structuredClone(session.plugin.getParameters());
}

function requireSuccess(status, operation, type) {
  if (status !== 0) throw new Error(`${type} ${operation} failed (${status})`);
}

async function createWasmPresetRenderer(repoRoot) {
  const wasmPath = path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.wasm');
  const binding = await instantiateDsp(await fs.readFile(wasmPath));
  let closed = false;
  try {
    if (!binding.createEngine()) throw new Error('Baseline WASM engine creation failed');
    requireSuccess(binding.prepare(SAMPLE_RATE, CHANNELS, 128, 8192), 'prepare', 'Baseline WASM');
  } catch (error) {
    binding.close();
    throw error;
  }

  return {
    render(type, parameters, stimulus, frames) {
      if (closed) throw new Error('Baseline WASM preset renderer is closed');
      const packer = DSP_PARAM_PACKERS.get(type);
      if (!packer) throw new Error(`${type} has no baseline WASM parameter packer`);
      const instance = binding.createInstance(type);
      if (!instance) throw new Error(`Baseline WASM could not create ${type}`);
      try {
        requireSuccess(binding.instanceSetParams(instance, packer.pack(parameters), packer.hash),
          'parameter setup', type);
        if (typeof packer.packBytes === 'function') {
          requireSuccess(binding.instanceSetParamBytes(instance, packer.packBytes(parameters), packer.hash),
            'structured parameter setup', type);
        }

        const output = new Float32Array(frames * CHANNELS);
        for (let offset = 0; offset < frames; offset += 128) {
          const blockFrames = Math.min(128, frames - offset);
          const arena = binding.getArenaViews();
          for (let channel = 0; channel < CHANNELS; channel++) {
            const start = channel * frames + offset;
            arena.combined.set(stimulus.subarray(start, start + blockFrames), channel * blockFrames);
          }
          requireSuccess(binding.instanceProcess(
            instance,
            arena.offsets.combined,
            CHANNELS,
            blockFrames,
            offset / SAMPLE_RATE
          ), 'processing', type);
          const processed = binding.getArenaViews().combined;
          for (let channel = 0; channel < CHANNELS; channel++) {
            output.set(processed.subarray(channel * blockFrames, channel * blockFrames + blockFrames),
              channel * frames + offset);
          }
        }

        const runtimeEvent = binding.instanceRuntimeEvent(instance);
        if (!runtimeEvent || runtimeEvent.generation !== 0 || runtimeEvent.latched ||
            runtimeEvent.cause !== 0) {
          throw new Error(`${type} baseline WASM runtime event ${JSON.stringify(runtimeEvent)}`);
        }
        return { output, runtimeEvent };
      } finally {
        binding.destroyInstance(instance);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      binding.close();
    }
  };
}

export async function renderPreset(type, preset, stimulus, frames, repoRoot, renderer = null) {
  const parameters = await effectivePresetParameters(type, preset, repoRoot);
  const ownRenderer = renderer === null;
  const activeRenderer = renderer ?? await createWasmPresetRenderer(repoRoot);
  try {
    const { output, runtimeEvent } = activeRenderer.render(type, parameters, stimulus, frames);
    const metrics = analyze(output);
    return {
      ...metrics,
      output,
      parameters,
      runtimeEvent,
      backend: 'baseline-wasm',
      hardFailure: metrics.nonFiniteCount > 0 || metrics.peak > PEAK_LIMIT
    };
  } finally {
    if (ownRenderer) activeRenderer.close();
  }
}

function report(type, presetId, stimulusId, metrics) {
  console.log([
    `${type}/${presetId}`,
    stimulusId,
    `rms=${dbfs(metrics.rms)}`,
    `peak=${dbfs(metrics.peak)}`,
    `clipSamples=${metrics.clipCount}`,
    `nonFinite=${metrics.nonFiniteCount}`
  ].join(' '));
}

export async function runPresetRenderCheck({ repoRoot = DEFAULT_REPO_ROOT, type = null, seconds = null } = {}) {
  const providers = await presetProviders(repoRoot, type);
  const allRun = type === null;
  const failures = [];
  const startedAt = performance.now();
  let budgetExceeded = false;
  const renderer = await createWasmPresetRenderer(repoRoot);
  console.log(`Checking ${providers.length} preset providers through baseline WASM at ${SAMPLE_RATE} Hz.`);

  try {
    for (const { definition, presets } of providers) {
      const duration = seconds ?? (allRun && definition.type === 'VinylSimulatorPlugin'
        ? ALL_RUN_VINYL_SIMULATOR_SECONDS
        : DEFAULT_SECONDS);
      const frames = Math.round(SAMPLE_RATE * duration);
      const stimuli = [
        ['silence', new Float32Array(frames * CHANNELS)],
        ['program', programSignal(frames)]
      ];
      const typeStartedAt = performance.now();
      for (const preset of presets) {
        for (const [stimulusId, stimulus] of stimuli) {
          const metrics = await renderPreset(definition.type, preset, stimulus, frames, repoRoot, renderer);
          report(definition.type, preset.id, stimulusId, metrics);
          if (metrics.hardFailure) failures.push({ type: definition.type, preset: preset.id, stimulus: stimulusId });
        }
      }
      console.log(`${definition.type}: ${(performance.now() - typeStartedAt).toFixed(0)} ms`);
      if (allRun && performance.now() - startedAt > 30 * 60 * 1000) {
        budgetExceeded = true;
        break;
      }
    }
  } finally {
    renderer.close();
  }

  const elapsedMs = performance.now() - startedAt;
  console.log(`${budgetExceeded ? 'Stopped' : 'Completed'} in ${(elapsedMs / 1000).toFixed(1)} s; hard failures: ${failures.length}.`);
  if (budgetExceeded) {
    console.warn('Full run exceeded the 30 minute budget; review the per-type timings above.');
  }
  if (budgetExceeded) throw new Error('Preset render check exceeded the 30 minute budget');
  if (failures.length > 0) {
    throw new Error(`Preset render check found ${failures.length} hard failures`);
  }
}

if (isMain(import.meta.url)) {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    usage();
  } else {
    runPresetRenderCheck({
      repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
      type: options.type,
      seconds: options.seconds
    }).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
