import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildDemo, validateBuildOutput } from '../../examples/dsp-library/build.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = path.join(repoRoot, 'examples', 'dsp-library');
const schemaRoot = path.join(repoRoot, 'dsp', 'bindings', 'schema');
const packageRoot = path.join(repoRoot, 'dsp', 'bindings', 'js');
const packageDist = path.join(packageRoot, 'dist');

test('DSP demo output validation rejects dangerous paths before deletion', () => {
  const sourceSentinel = path.join(sourceRoot, 'index.html');
  assert.equal(fs.existsSync(sourceSentinel), true);
  for (const dangerous of [
    path.parse(repoRoot).root,
    repoRoot,
    sourceRoot,
    schemaRoot,
    packageRoot,
    packageDist,
    path.join(repoRoot, 'dsp', 'unsafe-output'),
    path.join(path.parse(repoRoot).root, 'effetune-unsafe-output')
  ]) {
    assert.throws(() => validateBuildOutput(dangerous), /Refusing|must be under/);
    assert.equal(fs.existsSync(sourceSentinel), true);
  }
});

test('DSP demo output validation accepts only owned repository roots or OS temp', () => {
  assert.doesNotThrow(() =>
    validateBuildOutput(path.join(repoRoot, 'out', 'examples', 'dsp-library'), {
      repoOutputRoots: [path.join(repoRoot, 'out', 'examples', 'dsp-library')]
    })
  );
  assert.doesNotThrow(() => validateBuildOutput(
    path.join(os.tmpdir(), 'effetune-dsp-output-test', 'demo')
  ));
});

test('DSP demo identifies the package version and the artifacts it actually serves', () => {
  const temporaryRoot = fs.realpathSync.native(fs.mkdtempSync(
    path.join(os.tmpdir(), 'effetune-dsp-demo-identity-')
  ));
  try {
    const output = path.join(temporaryRoot, 'demo');
    const manifest = buildDemo(output);
    const packageInfo = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    const metadata = JSON.parse(fs.readFileSync(path.join(
      output, 'vendor', '@effetune', 'dsp', 'assets', 'effetune-dsp.meta.json'
    ), 'utf8'));
    assert.deepEqual(manifest.package, {
      name: packageInfo.name,
      version: packageInfo.version,
      sourceDigest: metadata.sourceDigest
    });
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    assert.ok(html.includes(`data-dsp-version>EffeTune DSP v${packageInfo.version}</p>`));
    for (const entry of manifest.files) {
      const bytes = fs.readFileSync(path.join(output, entry.path));
      assert.equal(entry.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
      if (entry.path.startsWith('vendor/@effetune/dsp/')) {
        assert.deepEqual(bytes, fs.readFileSync(path.join(
          packageDist, entry.path.slice('vendor/@effetune/dsp/'.length)
        )));
      }
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
