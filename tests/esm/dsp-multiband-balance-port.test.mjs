import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import {
  DEFAULT_GOLDEN_BUDGET_BYTES,
  readGoldenSet
} from '../../tools/dsp-parity/golden-io.mjs';
import { runParityCli } from '../../tools/dsp-parity/run.mjs';
import { generateStimulus } from '../../tools/dsp-parity/stimuli.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginRoot = path.join(repoRoot, 'dsp', 'plugins', 'spatial', 'multiband_balance');

async function directoryBytes(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    if (entry.isFile()) bytes += (await fs.stat(path.join(directory, entry.name))).size;
  }
  return bytes;
}

function stimulusFor(metadata) {
  return generateStimulus({
    id: metadata.stimulus,
    sampleRate: metadata.sampleRate,
    frames: metadata.frameCount,
    channels: metadata.channels,
    caseIndex: metadata.caseIndex,
    seed: BigInt(metadata.seed)
  });
}

test('MultibandBalance freezes its object-array layout and generated packer', async () => {
  const schemaPath = path.join(pluginRoot, 'params.json');
  const raw = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const schema = validateParamSpec(raw, schemaPath);
  assert.equal(schema.type, 'MultibandBalancePlugin');
  assert.equal(schema.hash, 0xdd7a7ec7);
  assert.equal(schema.floatCount, 9);
  assert.deepEqual(
    raw.fields.map(({ name, key }) => ({ name, key })),
    [
      { name: 'frequency1', key: 'f1' },
      { name: 'frequency2', key: 'f2' },
      { name: 'frequency3', key: 'f3' },
      { name: 'frequency4', key: 'f4' },
      { name: 'balance', key: 'balance' }
    ]
  );
  assert.deepEqual(
    raw.fields[4],
    {
      name: 'balance',
      key: 'balance',
      objectArrayKey: 'bands',
      memberKey: 'balance',
      kind: 'float',
      count: 5,
      min: -100,
      max: 100,
      default: [0, 0, 0, 0, 0],
      unit: '%'
    }
  );

  const descriptor = DSP_PARAM_PACKERS.get('MultibandBalancePlugin');
  assert.ok(descriptor);
  assert.equal(descriptor.hash, 0xdd7a7ec7);
  assert.equal(descriptor.floatCount, 9);
  assert.deepEqual(
    [...descriptor.pack({
      f1: 80,
      f2: 600,
      f3: 2400,
      f4: 12000,
      bands: [
        { balance: -100 }, { balance: -50 }, { balance: 0 },
        { balance: 50 }, { balance: 100 }
      ]
    })],
    [80, 600, 2400, 12000, -100, -50, 0, 50, 100]
  );
});

test('MultibandBalance goldens preserve deterministic crossover reset behavior', async () => {
  const goldenDir = path.join(pluginRoot, 'golden');
  assert.ok(await directoryBytes(goldenDir) <= DEFAULT_GOLDEN_BUDGET_BYTES);
  const goldens = await readGoldenSet(goldenDir);
  assert.equal(goldens.length, 9);
  assert.equal(goldens.every(item => item.metadata.type === 'MultibandBalancePlugin'), true);
  assert.equal(
    goldens.every(item => item.metadata.jsEngineHash ===
      'b50536f566a81ab4ba291f0b5e78e797960579d0ed164d4a5490dc678ae1cfea'),
    true
  );
  assert.ok(goldens.some(item => item.metadata.sampleRate === 192000));
  assert.ok(goldens.some(item => item.metadata.blockSize === 1));
  assert.ok(goldens.some(item => item.metadata.channels === 4));
  assert.ok(goldens.some(item => item.metadata.events.length > 0));

  const mono = goldens.find(item => item.metadata.id === 'mono-bypass');
  assert.ok(mono);
  assert.deepEqual(mono.expected, stimulusFor(mono.metadata));

  const faded = goldens.find(item => item.metadata.id === 'default-impulse-fade');
  assert.ok(faded);
  assert.equal(faded.expected[0], 0);
  assert.equal(faded.expected[faded.metadata.frameCount], 0);

  const result = await runParityCli([
    '--root', repoRoot,
    '--type', 'MultibandBalancePlugin',
    '--self-check'
  ], { log() {} });
  assert.equal(result.results.length, 9);
  assert.equal(result.results.every(item => item.comparison.pass), true);
});

test('MultibandBalance registry and process path remain allocation-free', async () => {
  const [registry, source] = await Promise.all([
    fs.readFile(path.join(repoRoot, 'dsp', 'registry.inc'), 'utf8'),
    fs.readFile(path.join(pluginRoot, 'kernel.cpp'), 'utf8')
  ]);
  assert.match(
    registry,
    /EFFETUNE_PLUGIN\(MultibandBalancePlugin, spatial\/multiband_balance\)/
  );
  const processStart = source.indexOf('  void process(');
  const privateStart = source.indexOf('\nprivate:', processStart);
  assert.ok(processStart >= 0 && privateStart > processStart);
  const processBody = source.slice(processStart, privateStart);
  assert.doesNotMatch(processBody, /\b(?:new|delete|resize|reserve|assign|push_back)\b/);
  assert.match(source, /quantizeLinkwitzRiley24StateToFloat/);
  assert.match(source, /channel_count < 2u/);
});
