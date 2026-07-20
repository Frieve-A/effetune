import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs, positiveInteger, isMain, formatBytes } from './cli.mjs';
import {
  DEFAULT_REPO_ROOT,
  buildDefaultCaseMatrix,
  discoverCasePlan,
  findPluginDefinition
} from './cases.mjs';
import {
  createGoldenArtifacts,
  DEFAULT_GOLDEN_BUDGET_BYTES,
  readGoldenSet,
  writeGoldenSet
} from './golden-io.mjs';
import { createReferenceSession, executeReferenceCase } from './node-host.mjs';
import { runNativeReferenceCase } from './runners.mjs';
import { discoverGoldenTargets } from './run.mjs';
import { generateStimulus, noiseSeedForCase, STIMULUS_IDS } from './stimuli.mjs';
import { comparePerSample, formatComparison } from './tolerance.mjs';

function usage() {
  return [
    'Usage: node tools/dsp-parity/generate.mjs (--type <PluginType> | --all) [options]',
    '  --all                  regenerate every existing golden set and update the shared base guard',
    '  --self-check           execute the JS reference twice without requiring a DSP schema',
    '  --schema <path>        override params.json discovery',
    '  --cases <path>         override cases.json discovery',
    '  --output <directory>   override the plugin golden directory',
    '  --stimulus <id>        restrict generation to one standard stimulus',
    '  --frames <count>       override case lengths (useful for a quick self-check)',
    '  --limit-cases <count>  process only the first cases',
    '  --budget <bytes>       golden budget (default 2 MiB)'
  ].join('\n');
}

async function nativeDirectReferenceHash(repoRoot) {
  const source = await fs.readFile(path.join(repoRoot, 'dsp', 'test', 'parity_runner.cpp'), 'utf8');
  return crypto.createHash('sha256').update(source.replace(/\r\n?/g, '\n')).digest('hex');
}

function filterCases(cases, args) {
  let selected = cases;
  if (args.stimulus) {
    if (!STIMULUS_IDS.includes(args.stimulus)) throw new Error(`Unknown stimulus ${args.stimulus}`);
    selected = selected.filter(testCase => testCase.stimulus === args.stimulus);
  }
  if (args.frames !== undefined) {
    const frames = positiveInteger(args.frames, 'frames');
    selected = selected.map(testCase => ({ ...testCase, frames, fullLength: false }));
  }
  if (args['limit-cases'] !== undefined) {
    selected = selected.slice(0, positiveInteger(args['limit-cases'], 'limit-cases'));
  }
  if (selected.length === 0) throw new Error('No parity cases matched the requested filters');
  return selected.map((testCase, caseIndex) => ({ ...testCase, caseIndex }));
}

async function unportedSelfCheckCases(type, repoRoot, args) {
  const session = await createReferenceSession(type, { repoRoot });
  const params = typeof session.plugin.getParameters === 'function' ? session.plugin.getParameters() : {};
  const sampleRate = positiveInteger(args['sample-rate'], 'sample-rate', 48000);
  const frames = positiveInteger(args.frames, 'frames', sampleRate);
  const stimuli = args.stimulus ? [args.stimulus] : STIMULUS_IDS;
  if (stimuli.some(id => !STIMULUS_IDS.includes(id))) throw new Error(`Unknown stimulus ${args.stimulus}`);
  return stimuli.map((stimulus, caseIndex) => ({
    id: `self-check-${stimulus}`,
    stimulus,
    sampleRate,
    frames,
    channels: positiveInteger(args.channels, 'channels', 2),
    channelMode: 'stereo',
    channel: null,
    blockSize: positiveInteger(args['block-size'], 'block-size', 128),
    params,
    caseIndex
  }));
}

export async function generateGoldens({
  type,
  repoRoot = DEFAULT_REPO_ROOT,
  schemaPath = null,
  casesPath = null,
  outputDir = null,
  selfCheck = false,
  args = {},
  log = console.log
}) {
  if (!type) throw new Error(`Missing --type.\n${usage()}`);
  const definition = await findPluginDefinition(type, repoRoot);
  const plan = await discoverCasePlan({
    type: definition.type,
    repoRoot,
    schemaPath,
    casesPath,
    fullFrames: args.frames ? positiveInteger(args.frames, 'frames') : undefined,
    shortFrames: args.frames ? positiveInteger(args.frames, 'frames') : undefined
  });
  let cases = plan.schema
    ? plan.cases
    : await unportedSelfCheckCases(definition.type, repoRoot, args);
  if (!plan.schema && !selfCheck) {
    throw new Error(`No params.json was found for ${definition.type}. Use --self-check for an unported plugin.`);
  }
  cases = filterCases(cases, args);
  const nativeReference = plan.schema?.parityReference === 'native-ir-direct-double-v1';
  const referenceHash = nativeReference ? await nativeDirectReferenceHash(repoRoot) : null;
  const generated = [];
  let baseSourceHash = null;
  for (const testCase of cases) {
    const seed = noiseSeedForCase(testCase.caseIndex);
    const normalizedCase = { ...testCase, seed };
    const input = generateStimulus({
      id: testCase.stimulus,
      sampleRate: testCase.sampleRate,
      frames: testCase.frames,
      channels: testCase.channels,
      caseIndex: testCase.caseIndex,
      seed
    });
    const first = nativeReference
      ? {
          output: await runNativeReferenceCase({
            type: definition.type,
            testCase: normalizedCase,
            input,
            schema: plan.schema,
            repoRoot,
            runnerPath: args['native-runner'] ?? undefined
          }),
          jsEngineHash: undefined,
          baseSourceHash: null
        }
      : await executeReferenceCase(definition.type, normalizedCase, input, { repoRoot });
    if (selfCheck) {
      const second = nativeReference
        ? {
            output: await runNativeReferenceCase({
              type: definition.type,
              testCase: normalizedCase,
              input,
              schema: plan.schema,
              repoRoot,
              runnerPath: args['native-runner'] ?? undefined
            })
          }
        : await executeReferenceCase(definition.type, normalizedCase, input, { repoRoot });
      const comparison = comparePerSample(first.output, second.output, { abs: 0, rel: 0 });
      log(`${comparison.pass ? 'PASS' : 'FAIL'} ${testCase.id}: ${formatComparison(comparison)}`);
      if (!comparison.pass) throw new Error(`JS reference self-check failed for ${testCase.id}`);
    }
    if (!nativeReference && baseSourceHash !== null && first.baseSourceHash !== baseSourceHash) {
      throw new Error('plugins/plugin-base.js changed during golden generation; run it again');
    }
    generated.push({
      testCase: normalizedCase,
      output: first.output,
      jsEngineHash: first.jsEngineHash,
      referenceEngine: nativeReference ? plan.schema.parityReference : undefined,
      referenceHash: nativeReference ? referenceHash : undefined
    });
    if (!nativeReference) baseSourceHash = first.baseSourceHash;
  }

  if (selfCheck) {
    return { type: definition.type, selfCheck: true, caseCount: generated.length, cases: generated };
  }
  const artifacts = createGoldenArtifacts({
    type: definition.type,
    schemaTolerance: plan.schema.tolerance,
    cases: generated
  });
  const resolvedOutput = outputDir
    ? path.resolve(repoRoot, outputDir)
    : path.join(path.dirname(plan.schemaPath), 'golden');
  const result = await writeGoldenSet(resolvedOutput, artifacts, {
    budgetBytes: positiveInteger(args.budget, 'budget', DEFAULT_GOLDEN_BUDGET_BYTES),
    type: definition.type
  });
  log(`Wrote ${result.caseCount} golden cases for ${definition.type} to ${resolvedOutput} (${formatBytes(result.totalBytes)})`);
  return {
    type: definition.type,
    selfCheck: false,
    outputDir: resolvedOutput,
    pluginBaseHash: baseSourceHash,
    ...result
  };
}

const ALL_GENERATION_INCOMPATIBLE_OPTIONS = [
  'type', 'schema', 'cases', 'output', 'self-check', 'stimulus', 'frames',
  'limit-cases', 'sample-rate', 'channels', 'block-size'
];

async function writePluginBaseGuard(baseHashPath, pluginBaseHash) {
  await fs.mkdir(path.dirname(baseHashPath), { recursive: true });
  await fs.writeFile(baseHashPath, `${JSON.stringify({
    formatVersion: 1,
    pluginBaseHash
  }, null, 2)}\n`);
}

async function pathExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function rollBackPromotions(entries, rename) {
  const errors = [];
  for (const entry of [...entries].reverse()) {
    if (entry.stagedMoved) {
      try {
        await rename(entry.livePath, entry.stagedPath);
      } catch {
        try {
          await fs.rm(entry.livePath, { recursive: entry.directory, force: true });
        } catch (removeError) {
          errors.push(removeError);
        }
      }
    }
    if (entry.liveMoved) {
      try {
        await rename(entry.backupPath, entry.livePath);
      } catch (error) {
        errors.push(error);
      }
    }
  }
  return errors;
}

async function promoteStagedArtifacts(entries, rename) {
  const attempted = [];
  try {
    for (const entry of entries) {
      attempted.push(entry);
      entry.hadLive = await pathExists(entry.livePath);
      if (entry.hadLive) {
        await rename(entry.livePath, entry.backupPath);
        entry.liveMoved = true;
      }
      await rename(entry.stagedPath, entry.livePath);
      entry.stagedMoved = true;
    }
  } catch (error) {
    const rollbackErrors = await rollBackPromotions(attempted, rename);
    const detail = rollbackErrors.length > 0
      ? `; rollback also encountered ${rollbackErrors.length} error(s)`
      : '';
    const promotionError = new Error(
      `Failed to promote the complete DSP golden set${detail}`,
      { cause: error }
    );
    promotionError.rollbackErrors = rollbackErrors;
    throw promotionError;
  }
}

export async function generateAllGoldens({
  repoRoot = DEFAULT_REPO_ROOT,
  args = {},
  log = console.log,
  rename = fs.rename
} = {}) {
  const incompatible = ALL_GENERATION_INCOMPATIBLE_OPTIONS.filter(name => args[name] !== undefined);
  if (incompatible.length > 0) {
    throw new Error(`--all cannot be combined with ${incompatible.map(name => `--${name}`).join(', ')}`);
  }
  const targets = await discoverGoldenTargets(repoRoot);
  if (targets.length === 0) {
    throw new Error('No existing DSP golden sets were found for --all generation');
  }

  const pluginsRoot = path.join(repoRoot, 'dsp', 'plugins');
  const transactionRoot = await fs.mkdtemp(path.join(pluginsRoot, '.golden-all-'));
  const stagedRoot = path.join(transactionRoot, 'staged');
  const backupRoot = path.join(transactionRoot, 'backup');
  const guardPath = path.join(pluginsRoot, 'golden-base-hash.json');
  const stagedGuardPath = path.join(stagedRoot, 'golden-base-hash.json');
  const results = [];
  const stagedTargets = [];
  let pluginBaseHash = null;
  let retainTransaction = false;

  try {
    await Promise.all([fs.mkdir(stagedRoot), fs.mkdir(backupRoot)]);
    for (const [index, target] of targets.entries()) {
      const number = String(index + 1).padStart(3, '0');
      const stagedOutput = path.join(stagedRoot, number);
      await fs.cp(target.goldenDir, stagedOutput, { recursive: true });
      const result = await generateGoldens({
        type: target.type,
        repoRoot,
        schemaPath: target.schemaPath,
        outputDir: stagedOutput,
        args,
        log
      });
      if (result.pluginBaseHash !== null && pluginBaseHash !== null &&
          result.pluginBaseHash !== pluginBaseHash) {
        throw new Error('plugins/plugin-base.js changed during --all generation; run it again');
      }
      const validatedCases = await readGoldenSet(stagedOutput);
      if (validatedCases.length !== result.caseCount) {
        throw new Error(`Staged golden validation found an incomplete set for ${target.type}`);
      }
      if (result.pluginBaseHash !== null) pluginBaseHash = result.pluginBaseHash;
      stagedTargets.push({ target, stagedOutput, number });
      results.push({ ...result, outputDir: target.goldenDir });
    }

    await writePluginBaseGuard(stagedGuardPath, pluginBaseHash);
    const stagedGuard = JSON.parse(await fs.readFile(stagedGuardPath, 'utf8'));
    if (stagedGuard.pluginBaseHash !== pluginBaseHash) {
      throw new Error('Staged plugin base guard validation failed');
    }

    const promotionEntries = stagedTargets.map(({ target, stagedOutput, number }) => ({
      livePath: target.goldenDir,
      stagedPath: stagedOutput,
      backupPath: path.join(backupRoot, number),
      directory: true,
      liveMoved: false,
      stagedMoved: false
    }));
    promotionEntries.push({
      livePath: guardPath,
      stagedPath: stagedGuardPath,
      backupPath: path.join(backupRoot, 'golden-base-hash.json'),
      directory: false,
      liveMoved: false,
      stagedMoved: false
    });
    await promoteStagedArtifacts(promotionEntries, rename);
    log(`Updated ${results.length} golden sets and the shared plugin base guard atomically`);
    return { all: true, types: results.map(result => result.type), results, pluginBaseHash };
  } catch (error) {
    if (error.rollbackErrors?.length > 0) {
      retainTransaction = true;
      log(`Retained incomplete DSP golden transaction for recovery at ${transactionRoot}`);
    }
    throw error;
  } finally {
    if (!retainTransaction) {
      try {
        await fs.rm(transactionRoot, { recursive: true, force: true });
      } catch (error) {
        log(`Warning: unable to remove DSP golden staging directory ${transactionRoot}: ${error.message}`);
      }
    }
  }
}

export async function runGenerateCli(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(usage());
    return { help: true };
  }
  const repoRoot = args.root ? path.resolve(args.root) : DEFAULT_REPO_ROOT;
  if (args.all === true) {
    return generateAllGoldens({
      repoRoot,
      args,
      log: message => io.log(message)
    });
  }
  return generateGoldens({
    type: args.type,
    repoRoot,
    schemaPath: args.schema ?? null,
    casesPath: args.cases ?? null,
    outputDir: args.output ?? null,
    selfCheck: args['self-check'] === true,
    args,
    log: message => io.log(message)
  });
}

if (isMain(import.meta.url)) {
  runGenerateCli().catch(error => {
    console.error(`DSP golden generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
