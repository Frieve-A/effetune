import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createReferenceFixtureLoader,
  REFERENCE_FIXTURE_MAX_COUNT
} from '../../tools/library-scale/reference-fixture.mjs';
import {
  createFolderTreeScaleTrack,
  FOLDER_TREE_FIRST_LEVEL_COUNT,
  SCALE_PRESETS
} from '../../tools/library-scale/catalog-fixture.mjs';

test('folder-tree scale fixtures keep more than 100000 deterministic first-level children', () => {
  assert.ok(FOLDER_TREE_FIRST_LEVEL_COUNT > 100_000);
  for (const preset of ['million', 'boundary']) {
    const count = SCALE_PRESETS[preset];
    const first = createFolderTreeScaleTrack(0);
    const lastFirstLevel = createFolderTreeScaleTrack(FOLDER_TREE_FIRST_LEVEL_COUNT - 1);
    const nextCycle = createFolderTreeScaleTrack(FOLDER_TREE_FIRST_LEVEL_COUNT);
    assert.ok(count > FOLDER_TREE_FIRST_LEVEL_COUNT);
    assert.match(first.relativePath, /^Directory-000000\/Album-000\//);
    assert.match(lastFirstLevel.relativePath, /^Directory-100002\/Album-000\//);
    assert.match(nextCycle.relativePath, /^Directory-000000\/Album-000\//);
    assert.notEqual(first.trackUid, nextCycle.trackUid);
  }
});

test('reference fixture loader writes bounded batches through the production repository contract', async () => {
  const folders = [];
  const batches = [];
  const load = createReferenceFixtureLoader({
    async upsertFolders(rows) { folders.push(...rows); },
    async upsertTracks(rows) { batches.push(rows); }
  });

  assert.deepEqual(await load({ count: 7, seed: 123 }), { folders: 1, tracks: 7 });
  assert.equal(folders.length, 1);
  assert.equal(folders[0].id, 'reference-folder');
  assert.deepEqual(batches.map(batch => batch.length), [7]);
  assert.ok(batches.flat().every(track => track.folderId === 'reference-folder'));

  assert.deepEqual(await load({ count: 501, seed: 123 }), { folders: 1, tracks: 501 });
  assert.deepEqual(batches.slice(1).map(batch => batch.length), [500, 1]);

  await assert.rejects(
    load({ count: REFERENCE_FIXTURE_MAX_COUNT + 1, seed: 123 }),
    /count must be between/
  );
  await assert.rejects(
    load({ count: 1, seed: 123, rows: [] }),
    /options are invalid/
  );
  await assert.rejects(
    load({ count: 1, seed: 123 }, { unexpected: true }),
    /options are invalid/
  );
});

test('reference browser harness seeds only through its dedicated fixture verb', () => {
  const harness = fs.readFileSync(
    new URL('../../tools/library-scale/reference-browser-harness.mjs', import.meta.url),
    'utf8'
  );
  const worker = fs.readFileSync(
    new URL('../../tools/library-scale/reference-browser-worker.mjs', import.meta.url),
    'utf8'
  );
  assert.match(harness, /loadReferenceFixture/);
  assert.doesNotMatch(harness, /request\(['"]upsert(?:Folders|Tracks)/);
  assert.match(worker, /referenceFixtureLoader:\s*createReferenceFixtureLoader/);
});
