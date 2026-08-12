import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '..', '..', '..');
const dist = path.join(packageRoot, 'dist');

if (path.dirname(dist) !== packageRoot || path.basename(dist) !== 'dist') {
  throw new Error('Refusing to clean an unexpected distribution path.');
}

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'internal'), { recursive: true });
await mkdir(path.join(dist, 'assets'), { recursive: true });
await mkdir(path.join(dist, 'schemas'), { recursive: true });
await mkdir(path.join(dist, 'catalog'), { recursive: true });

const sourceDir = path.join(packageRoot, 'src');
for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
  if (!entry.isFile() || (!entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts'))) continue;
  await cp(path.join(sourceDir, entry.name), path.join(dist, entry.name));
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
for (const [source, target] of copies) {
  await cp(path.join(repositoryRoot, source), path.join(dist, target));
}
