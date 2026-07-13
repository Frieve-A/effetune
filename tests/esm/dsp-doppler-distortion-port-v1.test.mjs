import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import { readGoldenSet } from '../../tools/dsp-parity/golden-io.mjs';
import { runParityCli } from '../../tools/dsp-parity/run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('Doppler Distortion freezes schema, state precision, and golden parity', async () => {
  const root = path.join(repoRoot, 'dsp', 'plugins', 'modulation', 'doppler_distortion');
  const schemaPath = path.join(root, 'params.json');
  const [schemaText, casesText, kernel] = await Promise.all([
    fs.readFile(schemaPath, 'utf8'),
    fs.readFile(path.join(root, 'cases.json'), 'utf8'),
    fs.readFile(path.join(root, 'kernel.cpp'), 'utf8')
  ]);
  const schema = validateParamSpec(JSON.parse(schemaText), schemaPath);
  const cases = JSON.parse(casesText).cases;
  assert.equal(schema.type, 'DopplerDistortionPlugin');
  assert.equal(schema.hash, 0x009e46d0);
  assert.equal(schema.floatCount, 4);
  assert.equal(cases.length, 9);
  assert.ok(cases.some(item => item.sampleRate === 192000 && item.channels === 4));
  assert.ok(cases.some(item => item.blockSize === 1));
  assert.ok(cases.some(item => item.channels === 8));
  assert.ok(cases.some(item => item.events?.length === 4));

  assert.match(kernel, /std::vector<float> delay_buffers_/);
  assert.match(kernel, /std::vector<float> speaker_positions_/);
  assert.match(kernel, /speaker_positions_\[channel\] = static_cast<float>\(position\)/);
  assert.match(kernel, /\[\[nodiscard\]\] double interpolate/);
  assert.match(kernel, /void reset\(\) noexcept override/);
  assert.doesNotMatch(kernel, /\b(?:malloc|calloc|realloc|free)\s*\(/);

  const goldens = await readGoldenSet(path.join(root, 'golden'));
  assert.equal(goldens.length, 9);
  assert.ok(goldens.every(item =>
    item.metadata.jsEngineHash === 'fc6a44aa5e0700d5a5e83efa0d7aae93622b660892545225ad66a173ee8c0e72'
  ));
  const stress = goldens.find(item => item.metadata.id === 'maximum-force-minimum-mass');
  assert.equal(stress.metadata.tolerance.abs, 0.001);
  assert.match(stress.metadata.toleranceNote, /float parameter ABI quantization/);
  assert.ok(goldens
    .filter(item => item !== stress)
    .every(item => item.metadata.tolerance.abs === 0.00001));
  const result = await runParityCli([
    '--root', repoRoot,
    '--type', 'DopplerDistortionPlugin',
    '--self-check'
  ], { log() {} });
  assert.equal(result.results.length, 9);
  assert.ok(result.results.every(item => item.comparison.pass));
});
