import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli || path.basename(npmCli) !== 'npm-cli.js') {
  throw new Error('npm_execpath does not identify npm-cli.js.');
}
const temporaryRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-npm-pack-')));
let stdout;
try {
  ({ stdout } = await run(process.execPath, [npmCli, 'pack', '--dry-run', '--json'], {
    cwd: packageRoot,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, npm_config_cache: path.join(temporaryRoot, 'cache') }
  }));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
const report = JSON.parse(stdout)[0];
const files = report.files.map(file => file.path).sort();

const forbidden = files.filter(file =>
  file.startsWith('src/') || file.startsWith('test/') || file.startsWith('scripts/') ||
  file === 'package-lock.json'
);
if (forbidden.length > 0) {
  throw new Error(`npm pack includes forbidden files: ${forbidden.join(', ')}`);
}

const required = [
  'LICENSE',
  'README.md',
  'THIRD_PARTY_NOTICES.txt',
  'dist/index.js',
  'dist/index.d.ts',
  'dist/catalog-entry.js',
  'dist/catalog-entry.d.ts',
  'dist/generated-effects.js',
  'dist/generated-effects.d.ts',
  'dist/worklet.js',
  'dist/worklet.d.ts',
  'dist/worklet-processor.js',
  'dist/assets/effetune-dsp.wasm',
  'dist/assets/effetune-dsp.simd.wasm',
  'dist/assets/effetune-dsp.meta.json',
  'dist/assets/NOTICE.txt',
  'dist/schemas/chain-v1.schema.json',
  'dist/schemas/bundle-v1.schema.json',
  'dist/catalog/effects-v1.json',
  'package.json'
];
for (const file of required) {
  if (!files.includes(file)) throw new Error(`npm pack is missing ${file}`);
}

console.log(`npm pack allowlist verified (${files.length} files, ${report.size} bytes).`);
