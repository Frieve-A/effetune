import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  BENCHMARK_SCORE_EFFECTS,
  BENCHMARK_SCORE_PROTOCOL,
  BENCHMARK_SCORE_VERSION,
  median
} from '../features/effetune-benchmark-score.js';
import { runBenchmarks } from './dsp-parity/bench.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const referencePath = path.join(repoRoot, 'features', 'benchmark-score-reference.js');

function usage() {
  return [
    'Usage: node tools/benchmark-score-reference.mjs [options]',
    '  --write                         generate features/benchmark-score-reference.js',
    '  --json <path>                   save raw benchmark measurements',
    '  --modes <simd>                  benchmark mode (default simd)',
    '  --repetitions <positive integer> measurement repetitions (default 7)',
    '  --check                         validate the existing reference without measuring',
    '  --calibration-scale <positive>   set the browser calibration scale',
    '  --rescale <json>                 rewrite reference from saved raw measurements'
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unknown argument ${token}`);
    const key = token.slice(2);
    if (['write', 'check', 'help'].includes(key)) {
      args[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    if (!['json', 'modes', 'repetitions', 'calibration-scale', 'rescale'].includes(key)) {
      throw new Error(`Unknown argument --${key}`);
    }
    args[key] = value;
    index++;
  }
  return args;
}

function positiveNumber(value, name, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive number`);
  return parsed;
}

function positiveInteger(value, name, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive integer`);
  return parsed;
}

function parseModes(value) {
  const modes = value === undefined ? ['simd'] : value.split(',').filter(Boolean);
  if (modes.length !== 1 || modes[0] !== 'simd') {
    throw new Error('Benchmark score references require --modes simd');
  }
  return modes;
}

function readReferenceSource(source) {
  const match = /export const BENCHMARK_SCORE_REFERENCE = Object\.freeze\((\{[\s\S]*\})\);\s*$/.exec(source);
  if (!match) throw new Error('Benchmark score reference has an invalid module shape');
  return JSON.parse(match[1]);
}

async function readExistingReference() {
  try {
    return readReferenceSource(await fs.readFile(referencePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function validateReference(reference) {
  if (!reference || typeof reference !== 'object') throw new Error('Benchmark score reference must be an object');
  const protocolKeys = ['sampleRate', 'channelCount', 'blockSize', 'inputSeconds'];
  if (reference.version !== BENCHMARK_SCORE_VERSION || reference.mode !== 'simd') {
    throw new Error('Benchmark score reference version or mode is invalid');
  }
  for (const key of protocolKeys) {
    if (reference[key] !== BENCHMARK_SCORE_PROTOCOL[key]) {
      throw new Error(`Benchmark score reference ${key} does not match the protocol`);
    }
  }
  if (!Number.isFinite(reference.browserCalibrationScale) || reference.browserCalibrationScale <= 0) {
    throw new Error('Benchmark score reference browserCalibrationScale is invalid');
  }
  if (typeof reference.machine !== 'string' || typeof reference.node !== 'string' ||
      typeof reference.commit !== 'string' || typeof reference.capturedAt !== 'string') {
    throw new Error('Benchmark score reference provenance is incomplete');
  }
  const names = Object.keys(reference.effects ?? {}).sort();
  const expectedNames = BENCHMARK_SCORE_EFFECTS.map(effect => effect.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error('Benchmark score reference effects do not match the score protocol');
  }
  for (const name of expectedNames) {
    if (!Number.isFinite(reference.effects[name]) || reference.effects[name] <= 0) {
      throw new Error(`Benchmark score reference for ${name} is invalid`);
    }
  }
  return reference;
}

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8'
    }).trim();
  } catch {
    return 'unknown';
  }
}

function createReference({ raw, calibrationScale }) {
  const effects = {};
  for (const effect of BENCHMARK_SCORE_EFFECTS) {
    const result = raw.effects?.[effect.name];
    if (!result || !Number.isFinite(result.rtf) || result.rtf <= 0) {
      throw new Error(`Raw score measurement for ${effect.name} is invalid`);
    }
    effects[effect.name] = result.rtf * calibrationScale;
  }
  return {
    version: BENCHMARK_SCORE_VERSION,
    sampleRate: BENCHMARK_SCORE_PROTOCOL.sampleRate,
    channelCount: BENCHMARK_SCORE_PROTOCOL.channelCount,
    blockSize: BENCHMARK_SCORE_PROTOCOL.blockSize,
    inputSeconds: BENCHMARK_SCORE_PROTOCOL.inputSeconds,
    mode: 'simd',
    capturedAt: raw.capturedAt,
    machine: raw.machine,
    node: raw.node,
    commit: raw.commit,
    browserCalibrationScale: calibrationScale,
    effects
  };
}

function serializeReference(reference) {
  return `export const BENCHMARK_SCORE_REFERENCE = Object.freeze(${JSON.stringify(reference, null, 2)});\n`;
}

async function collectRawMeasurements({ modes, repetitions }) {
  const effects = {};
  for (const effect of BENCHMARK_SCORE_EFFECTS) {
    const benchmark = await runBenchmarks({
      type: effect.className,
      repoRoot,
      modes,
      sampleRates: [BENCHMARK_SCORE_PROTOCOL.sampleRate],
      channelCounts: [BENCHMARK_SCORE_PROTOCOL.channelCount],
      blockSize: BENCHMARK_SCORE_PROTOCOL.blockSize,
      durationSeconds: BENCHMARK_SCORE_PROTOCOL.inputSeconds,
      warmup: 2,
      repetitions,
      params: effect.parameters ?? {},
      quantumStats: true
    });
    const trials = benchmark.results[0]?.quantumTrials;
    if (!Array.isArray(trials) || trials.length !== repetitions) {
      throw new Error(`No complete quantum measurements were collected for ${effect.name}`);
    }
    const rtfTrials = trials.map(trial => {
      if (!Number.isFinite(trial.averagePercent) || trial.averagePercent <= 0) {
        throw new Error(`Invalid quantum measurement for ${effect.name}`);
      }
      return 100 / trial.averagePercent;
    });
    effects[effect.name] = {
      rtf: median(rtfTrials),
      rtfTrials,
      quantumStats: benchmark.results[0].quantumStats
    };
  }
  return {
    version: BENCHMARK_SCORE_VERSION,
    protocol: {
      sampleRate: BENCHMARK_SCORE_PROTOCOL.sampleRate,
      channelCount: BENCHMARK_SCORE_PROTOCOL.channelCount,
      blockSize: BENCHMARK_SCORE_PROTOCOL.blockSize,
      inputSeconds: BENCHMARK_SCORE_PROTOCOL.inputSeconds
    },
    mode: 'simd',
    repetitions,
    capturedAt: new Date().toISOString(),
    machine: `${os.cpus()[0]?.model ?? 'unknown'} (${os.release()})`,
    node: process.version,
    commit: currentCommit(),
    effects
  };
}

async function writeJson(outputPath, value) {
  const resolved = path.resolve(repoRoot, outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

export async function runBenchmarkScoreReferenceCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  if (args.check) {
    if (args.write || args.json || args.rescale || args['calibration-scale'] || args.modes || args.repetitions) {
      throw new Error('--check cannot be combined with measurement or write options');
    }
    return validateReference(await readExistingReference());
  }
  if (args.rescale && args.write) throw new Error('--rescale cannot be combined with --write');
  const existing = await readExistingReference();
  const calibrationScale = positiveNumber(
    args['calibration-scale'],
    'calibration-scale',
    existing?.browserCalibrationScale ?? 1
  );
  let raw;
  if (args.rescale) {
    raw = JSON.parse(await fs.readFile(path.resolve(repoRoot, args.rescale), 'utf8'));
  } else {
    const modes = parseModes(args.modes);
    const repetitions = positiveInteger(args.repetitions, 'repetitions', 7);
    raw = await collectRawMeasurements({ modes, repetitions });
    if (args.json) await writeJson(args.json, raw);
  }
  if (args.rescale || args.write) {
    const reference = createReference({ raw, calibrationScale });
    validateReference(reference);
    await fs.writeFile(referencePath, serializeReference(reference));
    return reference;
  }
  return raw;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBenchmarkScoreReferenceCli().catch(error => {
    console.error(`Benchmark score reference failed: ${error.message}`);
    process.exitCode = 1;
  });
}
