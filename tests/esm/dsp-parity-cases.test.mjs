import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildDefaultCaseMatrix,
  defaultParamsFromSchema,
  discoverCasePlan
} from '../../tools/dsp-parity/cases.mjs';

const schema = {
  type: 'FixturePlugin',
  tolerance: { policy: 'per-sample', abs: 1e-6 },
  fields: [
    { name: 'gain', key: 'gn', kind: 'float', min: -6, max: 6, default: 0 },
    { name: 'mode', key: 'md', kind: 'enum', values: ['a', 'b'], default: 'a' },
    { name: 'bands', key: 'b', kind: 'float', count: 2, min: 1, max: 3, default: [1, 2] }
  ]
};

const objectArraySchema = {
  type: 'ObjectArrayFixturePlugin',
  tolerance: { policy: 'per-sample', abs: 1e-6 },
  fields: [
    {
      name: 'drive', key: 'dr', objectArrayKey: 'bands', memberKey: 'dr',
      kind: 'float', count: 3, min: 0, max: 6, default: [1, 2, 3]
    },
    {
      name: 'mix', key: 'mx', objectArrayKey: 'bands', memberKey: 'mx',
      kind: 'float', count: 3, min: 0, max: 100, default: [25, 50, 75]
    }
  ]
};

test('schema defaults map scalar, enum, and indexed fields to legacy parameter keys', () => {
  assert.deepEqual(defaultParamsFromSchema(schema), {
    gn: 0,
    md: 'a',
    b0: 1,
    b1: 2
  });
});

test('schema defaults aggregate object-array fields into shared indexed objects', () => {
  assert.deepEqual(defaultParamsFromSchema(objectArraySchema), {
    bands: [
      { dr: 1, mx: 25 },
      { dr: 2, mx: 50 },
      { dr: 3, mx: 75 }
    ]
  });
});

test('default case matrix includes every stimulus and parameter variants in all channel modes', () => {
  const cases = buildDefaultCaseMatrix(schema, { sampleRate: 1000, fullFrames: 1000, shortFrames: 250 });
  assert.equal(cases.filter(item => item.id.startsWith('default-')).length, 8);
  assert.ok(cases.some(item => item.id === 'gain-min-mono' && item.channels === 1 && item.params.gn === -6));
  assert.ok(cases.some(item => item.id === 'mode-b-all4' && item.channels === 4 && item.params.md === 'b'));
  assert.ok(cases.some(item => item.id === 'bands-max-stereo' && item.params.b0 === 3 && item.params.b1 === 3));
  assert.equal(cases.every((item, index) => item.caseIndex === index), true);
});

test('object-array case variants replace one member while preserving sibling defaults', () => {
  const cases = buildDefaultCaseMatrix(objectArraySchema, {
    sampleRate: 1000,
    fullFrames: 1000,
    shortFrames: 250,
    stimuli: ['noise']
  });
  const driveMaximum = cases.find(item => item.id === 'drive-max-stereo');
  assert.deepEqual(driveMaximum.params.bands, [
    { dr: 6, mx: 25 },
    { dr: 6, mx: 50 },
    { dr: 6, mx: 75 }
  ]);
  const defaults = cases.find(item => item.id === 'default-noise');
  assert.deepEqual(defaults.params.bands, [
    { dr: 1, mx: 25 },
    { dr: 2, mx: 50 },
    { dr: 3, mx: 75 }
  ]);
});

test('case discovery reads the registered plugin schema and expands custom sample rates', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-dsp-cases-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'plugins'), { recursive: true });
  await fs.mkdir(path.join(root, 'dsp', 'plugins', 'fixture', 'effect'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'plugins', 'plugins.txt'),
    '[plugins]\nfixture/effect: Fixture | Basics | FixturePlugin\n'
  );
  await fs.writeFile(
    path.join(root, 'dsp', 'plugins', 'fixture', 'effect', 'params.json'),
    JSON.stringify(schema)
  );
  await fs.writeFile(
    path.join(root, 'dsp', 'plugins', 'fixture', 'effect', 'cases.json'),
    JSON.stringify({
      parity: 'spectral',
      cases: [{ id: 'rates', stimulus: 'imp', frames: 16, sampleRates: [44100, 96000] }]
    })
  );

  const plan = await discoverCasePlan({ type: 'FixturePlugin', repoRoot: root });
  assert.equal(plan.schema.type, 'FixturePlugin');
  assert.deepEqual(plan.cases.map(item => item.sampleRate), [44100, 96000]);
  assert.equal(plan.cases.every(item => item.params.md === 'a'), true);
  assert.equal(plan.cases.every(item => item.tolerance.policy === 'spectral'), true);
});
