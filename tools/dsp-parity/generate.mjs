import path from 'node:path';
import { parseArgs, positiveInteger, isMain, formatBytes } from './cli.mjs';
import {
  DEFAULT_REPO_ROOT,
  buildDefaultCaseMatrix,
  discoverCasePlan,
  findPluginDefinition
} from './cases.mjs';
import { createGoldenArtifacts, DEFAULT_GOLDEN_BUDGET_BYTES, writeGoldenSet } from './golden-io.mjs';
import { createReferenceSession, executeReferenceCase } from './node-host.mjs';
import { generateStimulus, noiseSeedForCase, STIMULUS_IDS } from './stimuli.mjs';
import { comparePerSample, formatComparison } from './tolerance.mjs';

function usage() {
  return [
    'Usage: node tools/dsp-parity/generate.mjs --type <PluginType> [options]',
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
  const generated = [];
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
    const first = await executeReferenceCase(definition.type, normalizedCase, input, { repoRoot });
    if (selfCheck) {
      const second = await executeReferenceCase(definition.type, normalizedCase, input, { repoRoot });
      const comparison = comparePerSample(first.output, second.output, { abs: 0, rel: 0 });
      log(`${comparison.pass ? 'PASS' : 'FAIL'} ${testCase.id}: ${formatComparison(comparison)}`);
      if (!comparison.pass) throw new Error(`JS reference self-check failed for ${testCase.id}`);
    }
    generated.push({ testCase: normalizedCase, output: first.output, jsEngineHash: first.jsEngineHash });
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
  return { type: definition.type, selfCheck: false, outputDir: resolvedOutput, ...result };
}

export async function runGenerateCli(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(usage());
    return { help: true };
  }
  return generateGoldens({
    type: args.type,
    repoRoot: args.root ? path.resolve(args.root) : DEFAULT_REPO_ROOT,
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

