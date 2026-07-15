import {
  catalogBatches,
  DEFAULT_BATCH_SIZE,
  DEFAULT_FIXTURE_SEED,
  resolveScaleSize
} from './catalog-fixture.mjs';
import { elapsedMilliseconds, isMain, parseArgs, printResult } from './cli.mjs';

function usage() {
  return [
    'Usage: node tools/library-scale/benchmark-web-opfs.mjs --url <existing-origin-url> [options]',
    '  --url <url>            user-managed secure origin; this tool never starts a server',
    '  --size <rows>          row count (safe default: 10000)',
    '  --preset <name>        million or boundary',
    '  --batch-size <rows>    rows per bounded browser message (default: 1000)',
    '  --seed <uint32>        deterministic fixture seed',
    '  --file <name>          OPFS file name (default: unique temporary name)',
    '  --keep                 retain the generated OPFS file',
    '  --json                 print JSON'
  ].join('\n');
}

export async function runWebOpfsBenchmark(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(usage());
    return { help: true };
  }
  if (!args.url) throw new TypeError('--url is required; start and stop the origin outside this tool');
  const { chromium } = await import('playwright');
  const count = resolveScaleSize({ size: args.size, preset: args.preset });
  const batchSize = args['batch-size'] === undefined ? DEFAULT_BATCH_SIZE : Number(args['batch-size']);
  const seed = args.seed === undefined ? DEFAULT_FIXTURE_SEED : Number(args.seed);
  const fileName = args.file ?? `effetune-scale-${process.pid}-${Date.now()}.ndjson`;
  const browser = await chromium.launch({ headless: true });
  const startedAt = process.hrtime.bigint();
  let page;
  let rootHandle;
  let fileHandle;
  let writableHandle;
  try {
    page = await browser.newPage();
    await page.goto(args.url, { waitUntil: 'domcontentloaded' });
    rootHandle = await page.evaluateHandle(async () => {
      if (!navigator.storage?.getDirectory) throw new Error('OPFS is unavailable on this origin');
      return navigator.storage.getDirectory();
    });
    fileHandle = await rootHandle.evaluateHandle(
      (root, name) => root.getFileHandle(name, { create: true }),
      fileName
    );
    writableHandle = await fileHandle.evaluateHandle(handle => handle.createWritable());
    let written = 0;
    for (const batch of catalogBatches({ count, seed, batchSize })) {
      const payload = `${batch.map(track => JSON.stringify(track)).join('\n')}\n`;
      await writableHandle.evaluate((writable, chunk) => writable.write(chunk), payload);
      written += batch.length;
    }
    await writableHandle.evaluate(writable => writable.close());
    await writableHandle.dispose();
    writableHandle = null;
    const byteLength = await fileHandle.evaluate(async handle => (await handle.getFile()).size);
    const result = {
      runtime: await page.evaluate(() => navigator.userAgent),
      url: args.url,
      fileName,
      retained: args.keep === true,
      count: written,
      batchSize,
      byteLength,
      elapsedMs: elapsedMilliseconds(startedAt)
    };
    if (!args.keep) {
      await rootHandle.evaluate((root, name) => root.removeEntry(name), fileName);
    }
    printResult(result, { json: args.json, output: io });
    return result;
  } finally {
    if (writableHandle) {
      await writableHandle.evaluate(writable => writable.abort()).catch(() => {});
      await writableHandle.dispose();
    }
    if (fileHandle) await fileHandle.dispose();
    if (rootHandle) await rootHandle.dispose();
    await browser.close();
  }
}

if (isMain(import.meta.url)) {
  runWebOpfsBenchmark().catch(error => {
    console.error(`Web OPFS benchmark failed: ${error.message}`);
    process.exitCode = 1;
  });
}
