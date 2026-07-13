import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, isMain } from './cli.mjs';
import {
  DEFAULT_REPO_ROOT,
  discoverCasePlan,
  pathExists,
  readParamsSchema
} from './cases.mjs';
import { readGoldenSet, writeFloat32File } from './golden-io.mjs';
import { executeReferenceCase, loadReferencePlugin } from './node-host.mjs';
import { runNativeCase, runWasmCase } from './runners.mjs';
import { generateStimulus, noiseSeedForCase } from './stimuli.mjs';
import { compareAudio, formatComparison } from './tolerance.mjs';

function usage() {
  return [
    'Usage: node tools/dsp-parity/run.mjs [--type <PluginType>] <mode> [options]',
    'Modes: --self-check, --native, --wasm, --simd (multiple modes may be selected)',
    '  With no --type, run every dsp/plugins/**/params.json that has a golden/index.json.',
    '  --golden <directory>       override golden discovery',
    '  --native-runner <path>     override native runner executable',
    '  --wasm-path <path>         override baseline WASM artifact',
    '  --simd-path <path>         override SIMD WASM artifact',
    '  --case <id>                run one golden case',
    '  --dump-dir <directory>     failure dumps (default tmp/dsp-parity)'
  ].join('\n');
}

export async function discoverGoldenTargets(repoRoot = DEFAULT_REPO_ROOT) {
  const pluginsRoot = path.join(repoRoot, 'dsp', 'plugins');
  const pending = [pluginsRoot];
  const schemaPaths = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT' && directory === pluginsRoot) return [];
      throw new Error(`Unable to discover DSP parity schemas in ${directory}: ${error.message}`, { cause: error });
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile() && entry.name === 'params.json') schemaPaths.push(entryPath);
    }
  }

  schemaPaths.sort((left, right) => left.localeCompare(right, 'en'));
  const targets = [];
  const typePaths = new Map();
  for (const schemaPath of schemaPaths) {
    const goldenDir = path.join(path.dirname(schemaPath), 'golden');
    if (!await pathExists(path.join(goldenDir, 'index.json'))) continue;
    const schema = await readParamsSchema(schemaPath);
    const duplicate = typePaths.get(schema.type);
    if (duplicate) {
      throw new Error(`Duplicate DSP parity schemas for ${schema.type}: ${duplicate} and ${schemaPath}`);
    }
    typePaths.set(schema.type, schemaPath);
    targets.push({ type: schema.type, schemaPath, goldenDir });
  }
  return targets;
}

function testCaseFromMetadata(metadata) {
  return {
    id: metadata.id,
    stimulus: metadata.stimulus,
    sampleRate: metadata.sampleRate,
    frames: metadata.frameCount,
    channels: metadata.channels,
    blockSize: metadata.blockSize ?? 128,
    channelMode: metadata.channelMode,
    channel: metadata.channel,
    caseIndex: metadata.caseIndex ?? 0,
    seed: metadata.seed ? BigInt(metadata.seed) : noiseSeedForCase(metadata.caseIndex ?? 0),
    params: metadata.params ?? {},
    events: metadata.events ?? [],
    tolerance: metadata.tolerance,
    toleranceNote: metadata.toleranceNote
  };
}

function assertToleranceJustified(metadata, schemaTolerance) {
  if (!metadata.tolerance || !schemaTolerance || metadata.toleranceNote) return;
  for (const key of ['abs', 'rel', 'db', 'spectralDb']) {
    if (metadata.tolerance[key] !== undefined && schemaTolerance[key] !== undefined &&
        metadata.tolerance[key] > schemaTolerance[key]) {
      throw new Error(`Case ${metadata.id} loosens ${key} tolerance without toleranceNote`);
    }
  }
}

async function dumpFailure(dumpDir, type, mode, testCase, expected, actual, comparison) {
  const caseDir = path.join(dumpDir, type, mode, testCase.id);
  await fs.mkdir(caseDir, { recursive: true });
  await Promise.all([
    writeFloat32File(path.join(caseDir, 'expected.f32'), expected),
    writeFloat32File(path.join(caseDir, 'actual.f32'), actual),
    fs.writeFile(path.join(caseDir, 'report.json'), `${JSON.stringify(comparison, null, 2)}\n`)
  ]);
  return caseDir;
}

// Golden metadata hashes cover each plugin's own source only; the shared
// plugins/plugin-base.js is guarded once via dsp/plugins/golden-base-hash.json.
async function assertPluginBaseUnchanged(repoRoot, baseSourceHash) {
  const baseHashPath = path.join(repoRoot, 'dsp', 'plugins', 'golden-base-hash.json');
  let guard = null;
  try {
    guard = JSON.parse(await fs.readFile(baseHashPath, 'utf8'));
  } catch {
    guard = null;
  }
  if (!guard || guard.formatVersion !== 1 || guard.pluginBaseHash !== baseSourceHash) {
    throw new Error(
      'plugins/plugin-base.js changed since goldens were generated ' +
      '(or dsp/plugins/golden-base-hash.json is missing); regenerate all goldens'
    );
  }
}

async function runParityForType({
  type,
  modes,
  repoRoot = DEFAULT_REPO_ROOT,
  goldenDir = null,
  schemaPath = null,
  caseId = null,
  nativeRunner = null,
  wasmPath = null,
  simdPath = null,
  dumpDir = path.join(repoRoot, 'tmp', 'dsp-parity'),
  allocations = false,
  allowEmptyCase = false,
  throwOnFailure = true,
  log = console.log
}) {
  if (!type) throw new Error(`Missing --type.\n${usage()}`);
  if (!modes?.length) throw new Error(`Select at least one parity mode.\n${usage()}`);
  const plan = await discoverCasePlan({ type, repoRoot, schemaPath });
  if (!plan.schema) throw new Error(`No params.json was found for ${plan.definition.type}`);
  const resolvedGoldenDir = goldenDir
    ? path.resolve(repoRoot, goldenDir)
    : path.join(path.dirname(plan.schemaPath), 'golden');
  let goldens = await readGoldenSet(resolvedGoldenDir);
  if (caseId) goldens = goldens.filter(item => item.metadata.id === caseId);
  if (goldens.length === 0) {
    if (allowEmptyCase) return { type: plan.definition.type, results: [], skipped: true };
    throw new Error(`No golden case matched ${caseId}`);
  }
  const loaded = await loadReferencePlugin(plan.definition.type, { repoRoot });
  await assertPluginBaseUnchanged(repoRoot, loaded.baseSourceHash);
  for (const golden of goldens) {
    if (golden.metadata.type !== plan.definition.type) {
      throw new Error(
        `Golden ${golden.metadata.id} declares ${golden.metadata.type}; expected ${plan.definition.type}`
      );
    }
    if (golden.metadata.jsEngineHash !== loaded.jsEngineHash) {
      throw new Error(`Golden ${golden.metadata.id} was generated from a different JS engine revision; regenerate it before parity testing`);
    }
    assertToleranceJustified(golden.metadata, plan.schema.tolerance);
  }

  const results = [];
  for (const mode of modes) {
    for (const golden of goldens) {
      const testCase = testCaseFromMetadata(golden.metadata);
      const input = generateStimulus({
        id: testCase.stimulus,
        sampleRate: testCase.sampleRate,
        frames: testCase.frames,
        channels: testCase.channels,
        caseIndex: testCase.caseIndex,
        seed: testCase.seed
      });
      let actual;
      if (mode === 'self-check') {
        actual = (await executeReferenceCase(plan.definition.type, testCase, input, { repoRoot })).output;
      } else if (mode === 'native') {
        actual = await runNativeCase({
          type: plan.definition.type,
          testCase,
          input,
          schema: plan.schema,
          repoRoot,
          runnerPath: nativeRunner ?? undefined,
          allocations
        });
      } else {
        actual = await runWasmCase({
          type: plan.definition.type,
          testCase,
          input,
          schema: plan.schema,
          repoRoot,
          variant: mode === 'simd' ? 'simd' : 'baseline',
          wasmPath: mode === 'simd' ? (simdPath ?? undefined) : (wasmPath ?? undefined)
        });
      }
      const tolerance = golden.metadata.tolerance ?? plan.schema.tolerance ?? { abs: 0, policy: 'per-sample' };
      const comparison = compareAudio(golden.expected, actual, tolerance, {
        frames: testCase.frames,
        channels: testCase.channels
      });
      let failureDump = null;
      if (!comparison.pass) {
        failureDump = await dumpFailure(dumpDir, plan.definition.type, mode, testCase, golden.expected, actual, comparison);
      }
      log(`${comparison.pass ? 'PASS' : 'FAIL'} ${mode} ${plan.definition.type}/${testCase.id}: ${formatComparison(comparison)}` +
        (failureDump ? `; dumped to ${failureDump}` : ''));
      results.push({ type: plan.definition.type, mode, caseId: testCase.id, comparison, failureDump });
    }
  }
  const failed = results.filter(result => !result.comparison.pass);
  if (throwOnFailure && failed.length > 0) {
    throw new Error(`${failed.length} of ${results.length} DSP parity comparisons failed`);
  }
  return { type: plan.definition.type, results };
}

export async function runParity(options) {
  if (options.type) return runParityForType(options);
  if (!options.modes?.length) throw new Error(`Select at least one parity mode.\n${usage()}`);
  if (options.goldenDir) throw new Error('--golden requires --type');
  if (options.schemaPath) throw new Error('--schema requires --type');

  const targets = await discoverGoldenTargets(options.repoRoot ?? DEFAULT_REPO_ROOT);
  if (targets.length === 0) {
    throw new Error('No DSP parameter schemas with committed golden/index.json files were found');
  }

  const results = [];
  const errors = [];
  for (const target of targets) {
    try {
      const targetResult = await runParityForType({
        ...options,
        type: target.type,
        schemaPath: target.schemaPath,
        goldenDir: target.goldenDir,
        allowEmptyCase: Boolean(options.caseId),
        throwOnFailure: false
      });
      results.push(...targetResult.results);
    } catch (error) {
      errors.push(`${target.type}: ${error.message}`);
    }
  }

  if (options.caseId && results.length === 0 && errors.length === 0) {
    throw new Error(`No golden case matched ${options.caseId}`);
  }
  const failed = results.filter(result => !result.comparison.pass);
  if (failed.length > 0) {
    errors.push(`${failed.length} of ${results.length} DSP parity comparisons failed`);
  }
  if (errors.length > 0) {
    throw new Error(`Aggregate DSP parity failed:\n${errors.map(message => `  ${message}`).join('\n')}`);
  }
  return { types: targets.map(target => target.type), results };
}

export async function runParityCli(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(usage());
    return { help: true };
  }
  const modes = [
    args['self-check'] && 'self-check',
    args.native && 'native',
    args.wasm && 'wasm',
    args.simd && 'simd'
  ].filter(Boolean);
  const repoRoot = args.root ? path.resolve(args.root) : DEFAULT_REPO_ROOT;
  return runParity({
    type: args.type,
    modes,
    repoRoot,
    goldenDir: args.golden ?? null,
    schemaPath: args.schema ?? null,
    caseId: args.case ?? null,
    nativeRunner: args['native-runner'] ?? null,
    wasmPath: args['wasm-path'] ?? null,
    simdPath: args['simd-path'] ?? null,
    dumpDir: args['dump-dir'] ? path.resolve(repoRoot, args['dump-dir']) : path.join(repoRoot, 'tmp', 'dsp-parity'),
    allocations: args.allocations === true,
    log: message => io.log(message)
  });
}

if (isMain(import.meta.url)) {
  runParityCli().catch(error => {
    console.error(`DSP parity failed: ${error.message}`);
    process.exitCode = 1;
  });
}
