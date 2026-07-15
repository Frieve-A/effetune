import path from 'node:path';

import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_FIXTURE_SEED,
  resolveScaleSize,
  summarizeCatalog,
  writeCatalogFile,
  writeCatalogNdjson
} from './catalog-fixture.mjs';
import { isMain, parseArgs, printResult } from './cli.mjs';

function usage() {
  return [
    'Usage: node tools/library-scale/generate-catalog.mjs [options]',
    '  --size <rows>          row count (safe default: 10000)',
    '  --preset <name>        million (1000000) or boundary (5000000)',
    '  --batch-size <rows>    maximum rows materialized at once (default: 1000)',
    '  --seed <uint32>        deterministic fixture seed',
    '  --output <path>        write NDJSON to a file',
    '  --write                write NDJSON to stdout',
    '  --json                 print the summary as JSON',
    '',
    'Without --output or --write, the command computes a streaming digest only.'
  ].join('\n');
}

export async function runGenerateCatalog(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(usage());
    return { help: true };
  }
  if (args.output && args.write) throw new TypeError('Use either --output or --write, not both');

  const count = resolveScaleSize({ size: args.size, preset: args.preset });
  const seed = args.seed === undefined ? DEFAULT_FIXTURE_SEED : Number(args.seed);
  const batchSize = args['batch-size'] === undefined
    ? DEFAULT_BATCH_SIZE
    : Number(args['batch-size']);

  if (args.output) {
    const outputPath = path.resolve(args.output);
    const written = await writeCatalogFile(outputPath, { count, seed, batchSize });
    const result = { outputPath, written, count, seed, batchSize };
    printResult(result, { json: args.json, output: io });
    return result;
  }
  if (args.write) {
    const written = await writeCatalogNdjson({ output: process.stdout, count, seed, batchSize });
    return { outputPath: null, written, count, seed, batchSize };
  }

  const result = summarizeCatalog({ count, seed, batchSize });
  printResult(result, { json: args.json, output: io });
  return result;
}

if (isMain(import.meta.url)) {
  runGenerateCatalog().catch(error => {
    console.error(`Catalog generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
