import fs from 'node:fs/promises';

import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_FIXTURE_SEED,
  resolveScaleSize,
  summarizeCatalog
} from './catalog-fixture.mjs';
import { elapsedMilliseconds, isMain, parseArgs, printResult } from './cli.mjs';
import { createVirtualizationPlan, locateVirtualRow } from './benchmark-virtualization.mjs';
import { validatePhase0Artifact } from './validate-phase0-artifacts.mjs';

function usage() {
  return [
    'Usage: node tools/library-scale/run-scale.mjs [options]',
    '  --size <rows>          row count (safe default: 10000)',
    '  --preset <name>        million or boundary',
    '  --batch-size <rows>    maximum generated rows held at once (default: 1000)',
    '  --seed <uint32>        deterministic fixture seed',
    '  --json                 print JSON'
  ].join('\n');
}

export async function runScale(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(usage());
    return { help: true };
  }
  const count = resolveScaleSize({ size: args.size, preset: args.preset });
  const batchSize = args['batch-size'] === undefined ? DEFAULT_BATCH_SIZE : Number(args['batch-size']);
  const seed = args.seed === undefined ? DEFAULT_FIXTURE_SEED : Number(args.seed);
  const startedAt = process.hrtime.bigint();
  const catalog = summarizeCatalog({ count, seed, batchSize });
  const virtualization = createVirtualizationPlan({ rowCount: count });
  const boundaryProbes = [0, Math.floor(count / 2), count - 1]
    .map(ordinal => ({ ordinal, ...locateVirtualRow(virtualization, ordinal) }));
  const artifactUrl = new URL('./phase0-decisions.json', import.meta.url);
  const artifact = JSON.parse(await fs.readFile(artifactUrl, 'utf8'));
  const phase0 = validatePhase0Artifact(artifact);
  if (!phase0.valid) throw new Error(`Phase 0 artifact is invalid: ${phase0.errors.join('; ')}`);
  const result = {
    catalog,
    virtualization: { ...virtualization, boundaryProbes },
    phase0: {
      artifactId: artifact.artifactId,
      qualificationStatus: artifact.qualification.status,
      digest: phase0.digest
    },
    elapsedMs: elapsedMilliseconds(startedAt)
  };
  printResult(result, { json: true, output: io });
  return result;
}

if (isMain(import.meta.url)) {
  runScale().catch(error => {
    console.error(`Library scale runner failed: ${error.message}`);
    process.exitCode = 1;
  });
}
