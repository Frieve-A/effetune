import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateBuildOutput } from '../../examples/dsp-library/build.mjs';

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
