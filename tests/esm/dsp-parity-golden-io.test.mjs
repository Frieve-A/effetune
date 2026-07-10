import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createGoldenArtifacts,
  decodeFloat32LE,
  encodeFloat32LE,
  enforceGoldenBudget,
  GoldenBudgetError,
  readGoldenSet,
  writeGoldenSet
} from '../../tools/dsp-parity/golden-io.mjs';

function fixtureArtifacts(count = 1) {
  return createGoldenArtifacts({
    type: 'FixturePlugin',
    schemaTolerance: { policy: 'per-sample', abs: 1e-6 },
    cases: Array.from({ length: count }, (_, index) => ({
      testCase: {
        id: index === 0 ? 'fixture' : `fixture-${index + 1}`,
        stimulus: 'imp',
        sampleRate: 48000,
        frames: 2,
        channels: 2,
        blockSize: 128,
        channelMode: 'stereo',
        channel: null,
        caseIndex: index,
        seed: 123n + BigInt(index),
        params: { gain: index + 1 }
      },
      output: Float32Array.from([1 + index, -2.5, 0.25, index]),
      jsEngineHash: 'abc123'
    }))
  });
}

async function createWrittenFixture(t, count = 2) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-dsp-golden-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeGoldenSet(root, fixtureArtifacts(count), { budgetBytes: 4096, type: 'FixturePlugin' });
  return root;
}

test('float32 codec writes and reads explicit little-endian values', () => {
  const encoded = encodeFloat32LE(Float32Array.from([1, -2.5]));
  assert.deepEqual([...encoded], [0, 0, 128, 63, 0, 0, 32, 192]);
  assert.deepEqual([...decodeFloat32LE(encoded)], [1, -2.5]);
  assert.throws(() => decodeFloat32LE(Buffer.alloc(3)), /not divisible by 4/);
});

test('golden set round-trips metadata and channel-major samples', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-dsp-golden-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const artifacts = fixtureArtifacts();
  const written = await writeGoldenSet(root, artifacts, { budgetBytes: 4096, type: 'FixturePlugin' });
  assert.equal(written.caseCount, 1);
  const loaded = await readGoldenSet(root);
  assert.equal(loaded[0].metadata.type, 'FixturePlugin');
  assert.equal(loaded[0].metadata.seed, '0x7b');
  assert.deepEqual([...loaded[0].expected], [1, -2.5, 0.25, 0]);
});

test('golden budget failure lists the cases that must be trimmed', () => {
  const artifacts = fixtureArtifacts();
  assert.throws(
    () => enforceGoldenBudget(artifacts, 8),
    error => {
      assert.equal(error instanceof GoldenBudgetError, true);
      assert.equal(error.budgetBytes, 8);
      assert.match(error.message, /fixture/);
      assert.match(error.message, /Trim cases/);
      return true;
    }
  );
});

test('golden regeneration removes only stale case artifacts and accounts for the final set', async t => {
  const root = await createWrittenFixture(t, 3);
  await fs.writeFile(path.join(root, 'notes.txt'), 'keep');

  const written = await writeGoldenSet(root, fixtureArtifacts(1), {
    budgetBytes: 4096,
    type: 'FixturePlugin'
  });
  const names = (await fs.readdir(root)).sort();
  assert.deepEqual(names, ['case-001.f32', 'case-001.json', 'index.json', 'notes.txt']);

  const accountedNames = names.filter(name => name !== 'notes.txt');
  const actualBytes = (await Promise.all(accountedNames.map(async name =>
    (await fs.stat(path.join(root, name))).size
  ))).reduce((sum, bytes) => sum + bytes, 0);
  assert.equal(written.totalBytes, actualBytes);
  assert.equal((await readGoldenSet(root)).length, 1);
});

test('golden index is authoritative for case order', async t => {
  const root = await createWrittenFixture(t);
  const indexPath = path.join(root, 'index.json');
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  index.cases.reverse();
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);

  const loaded = await readGoldenSet(root);
  assert.deepEqual(loaded.map(entry => entry.metadata.id), ['fixture-2', 'fixture']);
});

test('golden reader rejects missing, duplicate, and extra indexed case files', async t => {
  await t.test('missing index', async st => {
    const root = await createWrittenFixture(st);
    await fs.unlink(path.join(root, 'index.json'));
    await assert.rejects(() => readGoldenSet(root), /Unable to parse golden index/);
  });

  await t.test('duplicate index case', async st => {
    const root = await createWrittenFixture(st);
    const indexPath = path.join(root, 'index.json');
    const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    index.cases[1] = index.cases[0];
    await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
    await assert.rejects(() => readGoldenSet(root), /duplicate case case-001\.json/);
  });

  await t.test('missing indexed metadata', async st => {
    const root = await createWrittenFixture(st);
    await fs.unlink(path.join(root, 'case-002.json'));
    await assert.rejects(() => readGoldenSet(root), /missing \[case-002\.json\]/);
  });

  await t.test('extra metadata', async st => {
    const root = await createWrittenFixture(st);
    await fs.copyFile(path.join(root, 'case-001.json'), path.join(root, 'case-999.json'));
    await assert.rejects(() => readGoldenSet(root), /extra \[case-999\.json\]/);
  });

  await t.test('extra binary', async st => {
    const root = await createWrittenFixture(st);
    await fs.copyFile(path.join(root, 'case-001.f32'), path.join(root, 'case-999.f32'));
    await assert.rejects(() => readGoldenSet(root), /extra \[case-999\.f32\]/);
  });
});
