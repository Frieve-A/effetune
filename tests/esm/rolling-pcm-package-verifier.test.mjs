import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyRollingPcmPackage } from '../../tools/verify-rolling-pcm-package.mjs';

const repoRoot = path.resolve('.');
const mediabunnyVersion = '1.55.7';
const packagedFiles = [
  'js/vendor/rolling-pcm-decoder-worker.mjs',
  'js/vendor/rolling-pcm-decoder-worker.NOTICE.txt',
  'js/ui/audio-player/rolling-pcm-transport.js'
];

test('generated rolling PCM Worker matches its current source bundle', async () => {
  const generated = await build({
    entryPoints: [path.join(repoRoot, 'js', 'ui', 'audio-player', 'rolling-pcm-worker-entry.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2021'],
    minify: true,
    legalComments: 'none',
    banner: {
      js: `/* EffeTune rolling PCM decoder; mediabunny ${mediabunnyVersion} (MPL-2.0) */`
    },
    write: false
  });
  const vendor = await fs.readFile(path.join(
    repoRoot,
    'js',
    'vendor',
    'rolling-pcm-decoder-worker.mjs'
  ));
  assert.deepEqual(Buffer.from(generated.outputFiles[0].contents), vendor);
});

async function createPackagedApplication(root, name) {
  const appRoot = path.join(root, name, 'resources', 'app');
  for (const relativePath of packagedFiles) {
    const destination = path.join(appRoot, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(repoRoot, ...relativePath.split('/')), destination);
  }
  return appRoot;
}

test('rolling PCM package verifier checks every discovered application', async t => {
  const fixtureRoot = await fs.realpath(await fs.mkdtemp(
    path.join(os.tmpdir(), 'effetune-rolling-package-')
  ));
  t.after(() => fs.rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5 }));
  const firstApp = await createPackagedApplication(fixtureRoot, 'first');
  const secondApp = await createPackagedApplication(fixtureRoot, 'second');

  assert.deepEqual(
    verifyRollingPcmPackage(fixtureRoot).map(application => application.path),
    [firstApp, secondApp]
  );

  const noticePath = path.join(
    secondApp,
    'js',
    'vendor',
    'rolling-pcm-decoder-worker.NOTICE.txt'
  );
  await fs.rm(noticePath);
  assert.throws(
    () => verifyRollingPcmPackage(fixtureRoot),
    error => error.message.includes(secondApp) &&
      error.message.includes('rolling-pcm-decoder-worker.NOTICE.txt')
  );

  await fs.copyFile(
    path.join(repoRoot, 'js', 'vendor', 'rolling-pcm-decoder-worker.NOTICE.txt'),
    noticePath
  );
  const workerPath = path.join(secondApp, 'js', 'vendor', 'rolling-pcm-decoder-worker.mjs');
  await fs.appendFile(workerPath, '\n// fixture mismatch\n');
  assert.throws(
    () => verifyRollingPcmPackage(fixtureRoot),
    error => error.message.includes(secondApp) &&
      error.message.includes('must match the generated source asset')
  );
});
