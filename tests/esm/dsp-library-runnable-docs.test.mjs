import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { convertPresetToLongFormat } from '../../js/utils/serialization-utils.js';
import { verifyWorklet } from '../../examples/dsp-library/verify-docs-acceptance.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const npmRoot = path.join(repoRoot, 'dsp', 'bindings', 'js');
const docsRoot = path.join(repoRoot, 'examples', 'dsp-library', 'docs');

function executeNpmSnippet(name, args = []) {
  const source = path.join(docsRoot, 'snippets', name);
  const temporary = path.join(
    npmRoot,
    `.docs-test-${process.pid}-${path.basename(name)}`
  );
  fs.mkdirSync(temporary);
  const target = path.join(temporary, path.basename(name));
  fs.copyFileSync(source, target);
  fs.copyFileSync(
    path.join(docsRoot, 'snippets', 'asset-fixtures.mjs'),
    path.join(temporary, 'asset-fixtures.mjs')
  );
  try {
    const result = spawnSync(process.execPath, [target, ...args], {
      cwd: npmRoot,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, `${name}\n${result.stdout}${result.stderr}`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

test('published JavaScript and five self-supplied IR examples run unchanged', () => {
  executeNpmSnippet('javascript-start.mjs');
  executeNpmSnippet('asset-required-examples.mjs');
});

test('source-generating overlay is backed by the frozen runtime fixture', () => {
  executeNpmSnippet('verify-source-generation.mjs', [
    path.join(docsRoot, 'fixtures', 'source-generation-v0.1.json'),
    path.join(repoRoot, 'docs', 'dsp', 'catalog', 'effects-v1.json'),
    path.join(docsRoot, 'effects-v1.docs.json')
  ]);
});

test('visual editor export matches the committed golden', () => {
  const input = JSON.parse(fs.readFileSync(path.join(
    docsRoot, 'fixtures', 'visual-editor-input-v0.1.json'
  ), 'utf8'));
  const golden = JSON.parse(fs.readFileSync(path.join(
    docsRoot, 'fixtures', 'visual-editor-golden-v0.1.json'
  ), 'utf8'));
  const nativeNow = Date.now;
  Date.now = () => 1710000000000;
  try {
    assert.deepEqual(convertPresetToLongFormat(input), golden);
  } finally {
    Date.now = nativeNow;
  }
});

test('published AudioWorklet quickstart runs the real package processor', async context => {
  try {
    await verifyWorklet(npmRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("browserType.launch: Executable doesn't exist at ") &&
        message.includes('playwright install')) {
      context.skip('Playwright Chromium is not installed.');
      return;
    }
    throw error;
  }
});
