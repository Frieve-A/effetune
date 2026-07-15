'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { LibraryCatalogHost } = require('../../electron/library-catalog-host.cjs');

async function openCatalog(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-playlist-crud-'));
  const host = await LibraryCatalogHost.open({ dbPath: path.join(directory, 'catalog.sqlite') });
  t.after(async () => {
    await host.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, host };
}

function createTrack(index) {
  return {
    trackUid: `track-${String(index).padStart(4, '0')}`,
    folderId: 'folder-music',
    relativePath: `Album/Track-${index}.flac`,
    fileName: `Track-${index}.flac`,
    title: `Track ${index}`,
    artist: 'Artist',
    albumArtist: 'Artist',
    album: 'Album',
    genre: 'Genre',
    trackNo: index,
    durationSec: 120,
    addedAt: index,
    updatedAt: index
  };
}

async function seedSourcePlaylist(host, directory, itemCount) {
  await host.upsertFolders([{
    id: 'folder-music',
    kind: 'electron',
    displayName: 'Music',
    path: directory,
    status: 'ok',
    lifecycleVersion: 1
  }]);
  const tracks = Array.from({ length: itemCount }, (_, index) => createTrack(index + 1));
  for (let offset = 0; offset < tracks.length; offset += 500) {
    await host.upsertTracks(tracks.slice(offset, offset + 500));
  }
  const context = await host.createContext({
    query: '',
    sort: 'title',
    direction: 'asc',
    scope: null
  });
  const operation = await host.receiveOperation({
    clientRequestId: 'create-source-playlist',
    requestDigest: 'sha256:create-source-playlist',
    canonicalRequestVersion: 1,
    operationKind: 'addToPlaylist',
    target: { playlistId: 'source' },
    expectedTargetVersion: 0,
    sourceContextToken: context.contextToken,
    sourceSequenceIds: [],
    sourceSequenceItemCount: 0,
    buildDeadlineAt: 10_000,
    receivedAt: 100
  });
  await host.createPlaylist({
    playlistId: 'source',
    name: 'Source',
    operationId: operation.operationId,
    createdAt: 100
  });
  for (let offset = 0; offset < tracks.length; offset += 500) {
    await host.appendPlaylistItems({
      playlistId: 'source',
      operationId: operation.operationId,
      items: tracks.slice(offset, offset + 500).map(track => ({ trackUid: track.trackUid }))
    });
  }
  await host.transitionOperation(operation.operationId, 'SNAPSHOTTING', { updatedAt: 101 });
  await host.transitionOperation(operation.operationId, 'READY', { updatedAt: 102 });
  await host.transitionOperation(operation.operationId, 'COMMITTING', { updatedAt: 103 });
  await host.publishPlaylist({
    playlistId: 'source',
    operationId: operation.operationId,
    expectedVersion: 0,
    finishedAt: 104
  });
}

async function collectPlaylistItems(host, playlistId) {
  const items = [];
  let afterPosition = 0;
  for (;;) {
    const page = await host.queryPlaylistItems({ playlistId, afterPosition, limit: 500 });
    items.push(...page.items);
    if (page.nextPosition === null) return { playlist: page.playlist, items };
    afterPosition = page.nextPosition;
  }
}

test('Electron playlist local CRUD preserves CAS, leases, and bounded duplicate publication', async t => {
  const { directory, host } = await openCatalog(t);
  await seedSourcePlaylist(host, directory, 501);

  const createInvalidations = [];
  const onCreateInvalidation = event => createInvalidations.push(event);
  host.on('invalidation', onCreateInvalidation);
  const createdWithItems = await host.createPlaylistWithItems({
    playlistId: 'created-with-items',
    name: 'Created with items',
    operationId: null,
    items: Array.from({ length: 1_001 }, () => ({ trackUid: 'track-0001' })),
    createdAt: 104
  });
  host.removeListener('invalidation', onCreateInvalidation);
  assert.equal(createdWithItems.kind, 'created');
  assert.equal(createdWithItems.state, 'active');
  assert.equal(createInvalidations.length, 1);
  assert.equal((await collectPlaylistItems(host, 'created-with-items')).items.length, 1_001);
  await assert.rejects(host.createPlaylistWithItems({
    playlistId: 'too-large',
    name: 'Too large',
    operationId: null,
    items: Array.from({ length: 4_097 }, () => ({ trackUid: 'track-0001' })),
    createdAt: 104
  }), error => error.code === 'batchLimitExceeded');

  const renamed = await host.renamePlaylist({
    playlistId: 'source', name: 'Renamed', expectedVersion: 1, updatedAt: 105
  });
  assert.equal(renamed.kind, 'renamed');
  assert.equal(renamed.version, 2);
  assert.deepEqual(await host.renamePlaylist({
    playlistId: 'source', name: 'Stale', expectedVersion: 1, updatedAt: 106
  }), { kind: 'conflict', currentVersion: 2 });

  let source = await host.queryPlaylistItems({ playlistId: 'source', limit: 2 });
  const firstItemKey = source.items[0].itemKey;
  const secondItemKey = source.items[1].itemKey;
  const reordered = await host.reorderPlaylistItem({
    playlistId: 'source',
    itemKey: secondItemKey,
    target: { direction: 'up' },
    expectedVersion: 2,
    updatedAt: 107
  });
  assert.equal(reordered.kind, 'reordered');
  assert.equal(reordered.version, 3);
  source = await host.queryPlaylistItems({ playlistId: 'source', limit: 2 });
  assert.deepEqual(source.items.map(item => item.itemKey), [secondItemKey, firstItemKey]);
  assert.deepEqual(await host.reorderPlaylistItem({
    playlistId: 'source',
    itemKey: secondItemKey,
    target: { direction: 'up' },
    expectedVersion: 3,
    updatedAt: 108
  }), {
    kind: 'unchanged', playlistId: 'source', itemKey: secondItemKey, version: 3
  });

  const removed = await host.removePlaylistItem({
    playlistId: 'source', itemKey: firstItemKey, expectedVersion: 3, updatedAt: 109
  });
  assert.equal(removed.kind, 'removed');
  assert.equal(removed.version, 4);

  const invalidations = [];
  const onInvalidation = event => invalidations.push(event);
  host.on('invalidation', onInvalidation);
  const duplicated = await host.duplicatePlaylist({
    playlistId: 'source',
    targetPlaylistId: 'copy',
    name: 'Copy',
    expectedVersion: 4,
    createdAt: 110
  });
  host.removeListener('invalidation', onInvalidation);
  assert.equal(duplicated.kind, 'duplicated');
  assert.equal(duplicated.version, 0);
  assert.equal(invalidations.length, 1);
  assert.deepEqual(invalidations[0].changedScopes, ['playlists']);
  const copy = await collectPlaylistItems(host, 'copy');
  assert.equal(copy.playlist.name, 'Copy');
  assert.equal(copy.items.length, 500);
  assert.equal(copy.items[0].trackUid, 'track-0002');

  assert.deepEqual(await host.duplicatePlaylist({
    playlistId: 'source',
    targetPlaylistId: 'stale-copy',
    name: 'Stale copy',
    expectedVersion: 3,
    createdAt: 111
  }), { kind: 'conflict', currentVersion: 4 });
  await assert.rejects(
    host.queryPlaylistItems({ playlistId: 'stale-copy', limit: 1 }),
    error => error.code === 'playlistNotFound'
  );

  const context = await host.createContext({ query: '', sort: 'title', direction: 'asc', scope: null });
  const active = await host.receiveOperation({
    clientRequestId: 'active-source-lease',
    requestDigest: 'sha256:active-source-lease',
    canonicalRequestVersion: 1,
    operationKind: 'addToPlaylist',
    target: { playlistId: 'source' },
    expectedTargetVersion: 4,
    sourceContextToken: context.contextToken,
    sourceSequenceIds: [],
    sourceSequenceItemCount: 0,
    buildDeadlineAt: 20_000,
    receivedAt: 200
  });
  assert.deepEqual(await host.renamePlaylist({
    playlistId: 'source', name: 'Busy', expectedVersion: 4, updatedAt: 201
  }), { kind: 'busy', activeOperationId: active.operationId });
  await host.completeOperation(active.operationId, {
    state: 'cancelled', code: 'cancelled', finishedAt: 202
  });
  const afterLease = await host.renamePlaylist({
    playlistId: 'source', name: 'Available', expectedVersion: 4, updatedAt: 203
  });
  assert.equal(afterLease.kind, 'renamed');
  assert.equal(afterLease.version, 5);
});
