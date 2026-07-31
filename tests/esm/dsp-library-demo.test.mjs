import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(
  path.join(repoRoot, 'examples', 'dsp-library', 'app.js'),
  'utf8'
);
const styles = readFileSync(
  path.join(repoRoot, 'examples', 'dsp-library', 'styles.css'),
  'utf8'
);
const html = readFileSync(
  path.join(repoRoot, 'examples', 'dsp-library', 'index.html'),
  'utf8'
);

test('DSP library demo restores idle controls and closes partial startup resources', () => {
  assert.match(source, /function setIdleControls\(\) \{[\s\S]*startButton\.disabled = false;[\s\S]*stopButton\.disabled = true;/);
  assert.match(source, /let pendingGraph;[\s\S]*pendingGraph = \{ node \};[\s\S]*pendingGraph\.source = source;/);
  assert.match(source, /catch \(error\) \{[\s\S]*closeGraph\(pendingGraph\);[\s\S]*closeActiveGraph\(\);/);
  assert.match(source, /function closeActiveGraph\(\) \{[\s\S]*setIdleControls\(\);[\s\S]*\}/);
});

test('DSP library demo offers generated audio and real worklet bypass', () => {
  assert.match(source, /function generatedBuffer\(audioContext\)/);
  assert.match(source, /sourceMode\.value === 'local'[\s\S]*generatedBuffer\(context\)/);
  assert.match(source, /type: 'Volume'/);
  assert.match(
    source,
    /bypassButton\.addEventListener\('click'[\s\S]*setParam\(\s*'demo-volume',\s*'volume'/
  );
});

test('DSP library demo includes padding and border inside its 320px width', () => {
  assert.match(
    styles,
    /\*,\s*\n\*::before,\s*\n\*::after\s*\{\s*box-sizing:\s*border-box;/
  );
  assert.match(styles, /main\s*\{[\s\S]*width:\s*min\(38rem,\s*calc\(100% - 3rem\)\);/);
  assert.match(
    styles,
    /body\.is-compact main\s*\{[\s\S]*width:\s*min\(34rem,\s*calc\(100% - 2rem\)\);/
  );
});

test('DSP library demo declares its canonical launch URL', () => {
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/effetune\.frieve\.com\/dsp\/demo\/">/
  );
});
