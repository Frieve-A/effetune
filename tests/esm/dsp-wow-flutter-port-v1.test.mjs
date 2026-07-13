import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import { readGoldenSet } from '../../tools/dsp-parity/golden-io.mjs';
import { runParityCli } from '../../tools/dsp-parity/run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('Wow Flutter freezes seeded draw order, state precision, and golden parity', async () => {
  const root = path.join(repoRoot, 'dsp', 'plugins', 'modulation', 'wow_flutter');
  const schemaPath = path.join(root, 'params.json');
  const [schemaText, casesText, kernel] = await Promise.all([
    fs.readFile(schemaPath, 'utf8'),
    fs.readFile(path.join(root, 'cases.json'), 'utf8'),
    fs.readFile(path.join(root, 'kernel.cpp'), 'utf8')
  ]);
  const schema = validateParamSpec(JSON.parse(schemaText), schemaPath);
  const cases = JSON.parse(casesText).cases;
  assert.equal(schema.type, 'WowFlutterPlugin');
  assert.equal(schema.hash, 0x6d7713b8);
  assert.equal(schema.floatCount, 7);
  assert.equal(cases.length, 9);
  assert.ok(cases.some(item => item.sampleRate === 192000 && item.channels === 4));
  assert.ok(cases.some(item => item.blockSize === 1));
  assert.ok(cases.some(item => item.channels === 8));
  assert.ok(cases.some(item => item.events?.length === 4));

  const commonDraw = kernel.indexOf('const double common_noise = random_.nextFloat01()');
  const channelLoop = kernel.indexOf('for (std::uint32_t channel = 0u; channel < channel_count;');
  const channelDraw = kernel.indexOf('const double channel_noise = random_.nextFloat01()');
  assert.ok(commonDraw >= 0 && channelLoop > commonDraw && channelDraw > channelLoop);
  assert.match(kernel, /std::vector<float> delay_buffers_/);
  assert.match(kernel, /double common_x1_/);
  assert.match(kernel, /channel_x1_\[channel\] = static_cast<float>/);
  assert.match(kernel, /void setRandomSeed\(/);
  assert.match(kernel, /random_\.seed\(selected_seed_low_, selected_seed_high_\)/);
  assert.doesNotMatch(kernel, /\b(?:malloc|calloc|realloc|free)\s*\(/);

  const goldens = await readGoldenSet(path.join(root, 'golden'));
  assert.equal(goldens.length, 9);
  assert.ok(goldens.every(item =>
    item.metadata.jsEngineHash === '65b606e082428dca8d4b4b74b4838d2d8a6af1015cef8bf1bce25cae27c27eca'
  ));
  const result = await runParityCli([
    '--root', repoRoot,
    '--type', 'WowFlutterPlugin',
    '--self-check'
  ], { log() {} });
  assert.equal(result.results.length, 9);
  assert.ok(result.results.every(item => item.comparison.pass));
});
