import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(scriptPath), '..');
const repositoryRoot = path.resolve(packageRoot, '..', '..', '..');

// Assembles the package layout in `target` from the sources under `repoRoot`.
export async function buildPackage(target, repoRoot = repositoryRoot) {
  await mkdir(path.join(target, 'internal'), { recursive: true });
  await mkdir(path.join(target, 'assets'), { recursive: true });
  await mkdir(path.join(target, 'schemas'), { recursive: true });
  await mkdir(path.join(target, 'catalog'), { recursive: true });

  const sourceDir = path.join(repoRoot, 'dsp', 'bindings', 'js', 'src');
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || (!entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts'))) continue;
    await cp(path.join(sourceDir, entry.name), path.join(target, entry.name));
  }

  const copies = [
    ['js/audio/dsp-engine-binding.js', 'internal/dsp-engine-binding.js'],
    ['js/audio/dsp-wasm-loader.js', 'internal/dsp-wasm-loader.js'],
    ['js/audio/dsp-params.generated.js', 'internal/dsp-params.generated.js'],
    ['js/ir-library/ir-asset-payload.js', 'internal/ir-asset-payload.js'],
    ['js/ir-library/ir-plugin-contract.js', 'internal/ir-plugin-contract.js'],
    ['plugins/dsp/effetune-dsp.wasm', 'assets/effetune-dsp.wasm'],
    ['plugins/dsp/effetune-dsp.simd.wasm', 'assets/effetune-dsp.simd.wasm'],
    ['plugins/dsp/effetune-dsp.meta.json', 'assets/effetune-dsp.meta.json'],
    ['plugins/dsp/NOTICE.txt', 'assets/NOTICE.txt'],
    ['dsp/bindings/schema/chain-v1.schema.json', 'schemas/chain-v1.schema.json'],
    ['dsp/bindings/schema/graph-v1.schema.json', 'schemas/graph-v1.schema.json'],
    ['dsp/bindings/schema/bundle-v1.schema.json', 'schemas/bundle-v1.schema.json'],
    ['dsp/bindings/generated/effects-v1.json', 'catalog/effects-v1.json']
  ];
  for (const [source, destination] of copies) {
    await cp(path.join(repoRoot, source), path.join(target, destination));
  }

  // Package sources reach unmodified app modules through './internal/js/...'.
  // Copy the transitive closure of their relative imports at the same repository
  // paths, together with the notice file that accompanies any vendored module.
  const importPattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|new URL\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
  const appModules = new Set();
  const pending = [];
  for (const name of await readdir(target)) {
    if (!name.endsWith('.js')) continue;
    for (const [, specifier] of (await readFile(path.join(target, name), 'utf8')).matchAll(importPattern)) {
      if (specifier.startsWith('./internal/js/')) pending.push(path.join(repoRoot, specifier.slice('./internal/'.length)));
    }
  }
  while (pending.length) {
    const file = pending.pop();
    if (appModules.has(file)) continue;
    appModules.add(file);
    for (const [, specifier] of (await readFile(file, 'utf8')).matchAll(importPattern)) {
      pending.push(path.resolve(path.dirname(file), specifier));
    }
  }
  for (const file of appModules) {
    const destination = path.join(target, 'internal', path.relative(repoRoot, file));
    if (!destination.startsWith(path.join(target, 'internal', 'js') + path.sep)) {
      throw new Error(`Packaged app module escapes js/: ${file}`);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(file, destination);
    const notice = file.replace(/\.m?js$/, '.NOTICE.txt');
    if (existsSync(notice)) await cp(notice, destination.replace(/\.m?js$/, '.NOTICE.txt'));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const dist = path.join(packageRoot, 'dist');
  if (path.dirname(dist) !== packageRoot || path.basename(dist) !== 'dist') {
    throw new Error('Refusing to clean an unexpected distribution path.');
  }
  await rm(dist, { recursive: true, force: true });
  await buildPackage(dist);
}
