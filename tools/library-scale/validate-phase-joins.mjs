import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMain, parseArgs } from './cli.mjs';
import { validateConsumerJoin } from './validate-phase0-artifacts.mjs';

const STAGE_FILES = Object.freeze({
  phase1: 'phase1-contract.json',
  phase2: 'phase2-gate.json',
  release: 'release-phase0-join.json'
});

export async function validatePhaseJoinStage(stage, { directory } = {}) {
  const file = STAGE_FILES[stage];
  if (!file) return { valid: false, errors: [`unknown Phase 0 join stage: ${stage}`] };
  const base = directory ?? path.dirname(fileURLToPath(import.meta.url));
  const phase0 = JSON.parse(await fs.readFile(path.join(base, 'phase0-decisions.json'), 'utf8'));
  const consumer = JSON.parse(await fs.readFile(path.join(base, file), 'utf8'));
  return validateConsumerJoin(consumer, phase0);
}

export async function runPhaseJoinCli(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  const stage = args.stage;
  const result = await validatePhaseJoinStage(stage, {
    directory: args.directory ? path.resolve(args.directory) : undefined
  });
  if (!result.valid) throw new Error(`${stage || 'unknown'} Phase 0 exact join failed:\n- ${result.errors.join('\n- ')}`);
  io.log(`Validated ${stage} Phase 0 exact join (${result.digest})`);
  return result;
}

if (isMain(import.meta.url)) {
  runPhaseJoinCli().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
