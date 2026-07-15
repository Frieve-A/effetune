'use strict';

const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { LibraryCatalogHost } = require('../../electron/library-catalog-host.cjs');

async function openCatalog(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-durable-catalog-'));
  const dbPath = path.join(directory, 'catalog.sqlite');
  const host = await LibraryCatalogHost.open({ dbPath });
  t.after(async () => {
    await host.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, dbPath, host };
}

function operationRequest(overrides = {}) {
  return {
    clientRequestId: 'request-1',
    requestDigest: 'sha256:digest-1',
    canonicalRequestVersion: 1,
    operationKind: 'addToPlaylist',
    target: { playlistId: 'ledger-target' },
    expectedTargetVersion: 0,
    sourceContextToken: null,
    sourceSequenceIds: [],
    sourceSequenceItemCount: 0,
    buildDeadlineAt: 10_000,
    receivedAt: 100,
    ...overrides
  };
}

function playlistOperationRequest(playlistId, overrides = {}) {
  return operationRequest({
    clientRequestId: `request-${playlistId}`,
    requestDigest: `sha256:${playlistId}`,
    operationKind: 'addToPlaylist',
    target: { playlistId },
    expectedTargetVersion: 0,
    ...overrides
  });
}

function createTrack(index) {
  return {
    trackUid: `track-${index}`,
    folderId: 'folder-music',
    relativePath: `Album/Track-${index}.flac`,
    fileName: `Track-${index}.flac`,
    title: `Track ${index}`,
    artist: 'Artist',
    albumArtist: 'Artist',
    album: 'Album',
    genre: 'Genre',
    trackNo: index,
    durationSec: 120 + index,
    addedAt: index,
    updatedAt: index
  };
}

async function seedTracks(host, directory) {
  await host.upsertFolders([{
    id: 'folder-music',
    kind: 'electron',
    displayName: 'Music',
    path: directory,
    status: 'ok',
    lifecycleVersion: 1
  }]);
  await host.upsertTracks([createTrack(1), createTrack(2)]);
}

test('catalog host is a complete durable Add/import repository adapter', async t => {
  const { host } = await openCatalog(t);
  const source = await host.createContext({ query: '', sort: 'title', direction: 'asc', scope: null });
  const { DurableLibraryService } = await import('../../js/library/operations/durable-library-service.js');
  const service = new DurableLibraryService({
    repository: host,
    cryptoApi: webcrypto,
    now: (() => {
      let now = 100;
      return () => now++;
    })(),
    handlers: {
      addToPlaylist: async ({ reportProgress }) => {
        await reportProgress({
          phase: 'materializing',
          processed: 2,
          total: 2,
          state: 'running'
        });
        return { playlistId: 'playlist-service' };
      }
    }
  });
  const started = await service.start({
    clientRequestId: 'service-request',
    operationKind: 'addToPlaylist',
    selectionDescriptor: { mode: 'all', contextToken: source.contextToken, exclusions: [] },
    target: { playlistId: 'playlist-service' },
    expectedTargetVersion: 0,
    options: {}
  });
  assert.equal(started.kind, 'started');
  await service.running.get(started.operationId).task;
  const status = await service.status(started.operationId);
  assert.equal(status.terminalKind, 'success');
  assert.equal(status.result.state, 'succeeded');
  assert.deepEqual(status.result.result, { playlistId: 'playlist-service' });
});

test('operation ledger deduplicates starts, rejects request ID reuse, enforces busy and stores cancellation', async t => {
  const { host } = await openCatalog(t);
  const source = await host.createContext({ query: '', sort: 'title', direction: 'asc', scope: null });
  const request = operationRequest({ sourceContextToken: source.contextToken });
  const created = await host.receiveOperation(request);
  assert.equal(created.kind, 'created');
  assert.deepEqual(await host.receiveOperation(request), {
    kind: 'active',
    operationId: created.operationId
  });
  assert.deepEqual(
    await host.receiveOperation({ ...request, requestDigest: 'sha256:changed' }),
    { kind: 'requestIdReuse' }
  );
  assert.deepEqual(
    await host.receiveOperation(operationRequest({
      clientRequestId: 'request-2',
      requestDigest: 'sha256:digest-2',
      sourceContextToken: source.contextToken
    })),
    { kind: 'busy', activeOperationId: created.operationId }
  );

  await host.transitionOperation(created.operationId, 'SNAPSHOTTING', { updatedAt: 101 });
  await host.recordOperationProgress(created.operationId, {
    operationId: created.operationId,
    sequence: 1,
    phase: 'snapshot',
    processed: 25,
    total: 100,
    state: 'running',
    updatedAt: 102
  });
  const status = await host.getOperationStatus(created.operationId);
  assert.equal(status.phase, 'SNAPSHOTTING');
  assert.equal(status.progress.sequence, 1);
  assert.equal(status.processed, 25);

  assert.deepEqual(await host.requestOperationCancel(created.operationId, { requestedAt: 103 }), {
    kind: 'cancelRequested',
    operationId: created.operationId
  });
  await host.completeOperation(created.operationId, {
    state: 'cancelled',
    code: 'cancelled',
    finishedAt: 104
  });
  assert.equal((await host.getOperationStatus(created.operationId)).result.state, 'cancelled');
  assert.deepEqual(await host.requestOperationCancel(created.operationId, { requestedAt: 105 }), {
    kind: 'tooLate'
  });
});

test('sealing a materialized operation snapshot releases its requested source context', async t => {
  const { host } = await openCatalog(t);
  const source = await host.createContext({ query: '', sort: 'title', direction: 'asc', scope: null });
  const created = await host.receiveOperation(operationRequest({ sourceContextToken: source.contextToken }));
  assert.equal(created.kind, 'created');
  assert.deepEqual(await host.releaseContext(source.contextToken), {
    released: true,
    retained: true
  });

  await host.createOperationSnapshot({
    snapshotId: 'snapshot-releases-context',
    operationId: created.operationId,
    snapshotKind: 'selection',
    createdAt: 100,
    expiresAt: 1000
  });
  await host.appendOperationSnapshotItems({
    snapshotId: 'snapshot-releases-context',
    trackUids: ['track-a']
  });
  await host.sealOperationSnapshot({
    snapshotId: 'snapshot-releases-context',
    itemCount: 1,
    membershipDigest: 'membership',
    orderDigest: 'order',
    ownerKind: 'operation',
    ownerId: created.operationId
  });

  await assert.rejects(
    host.readContextPage({ contextToken: source.contextToken, cursor: null, limit: 1 }),
    error => error?.code === 'STALE_CURSOR'
  );
  await host.completeOperation(created.operationId, {
    state: 'cancelled',
    code: 'test-complete',
    finishedAt: 101
  });
});

test('startup durably interrupts abandoned operations and releases snapshot ownership for bounded GC', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-durable-restart-'));
  const dbPath = path.join(directory, 'catalog.sqlite');
  let host = await LibraryCatalogHost.open({ dbPath });
  t.after(async () => {
    await host.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const source = await host.createContext({ query: '', sort: 'title', direction: 'asc', scope: null });
  const created = await host.receiveOperation(operationRequest({ sourceContextToken: source.contextToken }));
  await host.createOperationSnapshot({
    snapshotId: 'snapshot-1',
    operationId: created.operationId,
    snapshotKind: 'selection',
    createdAt: 100,
    expiresAt: 1000
  });
  await host.appendOperationSnapshotItems({
    snapshotId: 'snapshot-1',
    trackUids: ['track-a', 'track-a', 'track-b']
  });
  await host.sealOperationSnapshot({
    snapshotId: 'snapshot-1',
    itemCount: 3,
    membershipDigest: 'membership',
    orderDigest: 'order',
    ownerKind: 'operation',
    ownerId: created.operationId
  });
  await host.close();

  host = await LibraryCatalogHost.open({ dbPath });
  const result = await host.getOperationStatus(created.operationId);
  assert.equal(result.terminalKind, 'interrupted');
  assert.equal(result.result.state, 'interrupted');
  assert.equal(result.result.code, 'service-interrupted');
  const snapshot = await host.queryOperationSnapshot({ snapshotId: 'snapshot-1', ordinal: 1, limit: 2 });
  assert.deepEqual(snapshot.items, [
    { ordinal: 1, trackUid: 'track-a' },
    { ordinal: 2, trackUid: 'track-b' }
  ]);
  assert.deepEqual(await host.gcOperationSnapshots(2), {
    deletedItemCount: 2, deletedSnapshotCount: 0, hasMore: true
  });
  assert.deepEqual(await host.gcOperationSnapshots(2), {
    deletedItemCount: 1, deletedSnapshotCount: 1, hasMore: false
  });
  await assert.rejects(
    host.queryOperationSnapshot({ snapshotId: 'snapshot-1', ordinal: 0, limit: 1 }),
    error => error.code === 'snapshotNotFound'
  );
});

test('playback sequences preserve duplicate occurrences for one catalog session only', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-session-sequence-'));
  const dbPath = path.join(directory, 'catalog.sqlite');
  let host = await LibraryCatalogHost.open({ dbPath });
  t.after(async () => {
    await host.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await host.createPlaybackSequence({
    sequenceId: 'sequence-1',
    sourceContext: 'all-tracks',
    catalogVersion: 0,
    seed: 42,
    createdAt: 100
  });
  await host.appendPlaybackSequenceItems({
    sequenceId: 'sequence-1',
    items: [
      { ordinal: 0, trackUid: 'track-1', entryInstanceId: 'entry-1' },
      { ordinal: 1, trackUid: 'track-1', entryInstanceId: 'entry-2' },
      { ordinal: 2, trackUid: 'track-2', entryInstanceId: 'entry-3' }
    ]
  });
  const sealed = await host.sealPlaybackSequence({
    sequenceId: 'sequence-1',
    itemCount: 3,
    currentOrdinal: 0,
    sealedAt: 101
  });
  assert.equal(sealed.state, 'active');
  const page = await host.queryPlaybackSequence({ sequenceId: 'sequence-1', ordinal: 0, limit: 2 });
  assert.deepEqual(page.items.map(item => [item.ordinal, item.trackUid, item.entryInstanceId]), [
    [0, 'track-1', 'entry-1'],
    [1, 'track-1', 'entry-2']
  ]);
  assert.equal(page.nextOrdinal, 2);

  const { canonicalOrdinalForTransport } = await import('../../js/library/repository/transport-shuffle.js');
  const descriptor = {
    segments: [{ sequenceId: 'sequence-1', startOrdinal: 0, endOrdinal: 3 }],
    currentOrdinal: 0,
    shuffleSeed: 29,
    shuffleEpoch: 4,
    shuffleTransportOffset: 1
  };
  const shuffledPage = await host.queryTransportDescriptorPage({
    descriptor,
    transportOrdinal: 0,
    limit: 3
  });
  const sourceEntries = ['entry-1', 'entry-2', 'entry-3'];
  assert.deepEqual(
    shuffledPage.items.map(item => item.entryInstanceId),
    [0, 1, 2].map(ordinal => sourceEntries[
      canonicalOrdinalForTransport(descriptor, ordinal, 3)
    ])
  );

  await host.close();
  host = await LibraryCatalogHost.open({ dbPath });
  await assert.rejects(
    host.queryPlaybackSequence({ sequenceId: 'sequence-1', ordinal: 0, limit: 1 }),
    error => error.code === 'sequenceNotFound'
  );
});

test('playlist staging is invisible until CAS publish and cleanup releases operation retention', async t => {
  const { host, directory } = await openCatalog(t);
  await seedTracks(host, directory);
  await host.createPlaylist({ playlistId: 'playlist-1', name: 'Favorites', createdAt: 100 });
  const source = await host.createContext({ query: '', sort: 'title', direction: 'asc', scope: null });
  const created = await host.receiveOperation(playlistOperationRequest('playlist-1', {
    sourceContextToken: source.contextToken
  }));
  assert.equal(created.kind, 'created');
  await host.appendPlaylistItems({
    playlistId: 'playlist-1',
    operationId: created.operationId,
    items: [
      { trackUid: 'track-1' },
      { trackUid: 'track-1' },
      { unresolved: { basename: 'missing.flac', title: 'Missing', artist: 'Artist', durationSec: 123 } }
    ]
  });
  assert.equal((await host.queryPlaylistItems({ playlistId: 'playlist-1', limit: 10 })).items.length, 0);
  assert.deepEqual(await host.tombstonePlaylist({
    playlistId: 'playlist-1',
    expectedVersion: 0,
    updatedAt: 101
  }), { kind: 'busy', activeOperationId: created.operationId });
  assert.deepEqual(await host.publishPlaylist({
    playlistId: 'playlist-1',
    operationId: created.operationId,
    expectedVersion: 1,
    finishedAt: 102
  }), { kind: 'conflict', currentVersion: 0 });
  assert.equal((await host.queryPlaylistItems({ playlistId: 'playlist-1', limit: 10 })).items.length, 0);

  const published = await host.publishPlaylist({
    playlistId: 'playlist-1',
    operationId: created.operationId,
    expectedVersion: 0,
    finishedAt: 103
  });
  assert.equal(published.kind, 'published');
  const visible = await host.queryPlaylistItems({ playlistId: 'playlist-1', limit: 10 });
  assert.deepEqual(visible.items.slice(0, 2).map(item => item.trackUid), ['track-1', 'track-1']);
  assert.equal(visible.items[2].unresolved.title, 'Missing');
  assert.equal((await host.getOperationStatus(created.operationId)).result.state, 'succeeded');

  assert.equal((await host.gcTerminalOperations({ finishedBefore: 200, limit: 10 })).deletedCount, 0);
  assert.deepEqual(await host.cleanupPlaylistItems(2), { cleanedCount: 2, cleanedPageCount: 0, hasMore: true });
  assert.deepEqual(await host.cleanupPlaylistItems(2), { cleanedCount: 1, cleanedPageCount: 0, hasMore: false });
  assert.equal((await host.gcTerminalOperations({ finishedBefore: 200, limit: 10 })).deletedCount, 1);

  const cancelledSource = await host.createContext({ query: '', sort: 'title', direction: 'asc', scope: null });
  const cancelled = await host.receiveOperation(playlistOperationRequest('playlist-1', {
    clientRequestId: 'request-playlist-cancelled',
    requestDigest: 'sha256:playlist-cancelled',
    expectedTargetVersion: 1,
    sourceContextToken: cancelledSource.contextToken,
    receivedAt: 105
  }));
  await host.appendPlaylistItems({
    playlistId: 'playlist-1',
    operationId: cancelled.operationId,
    items: [{ trackUid: 'track-2' }]
  });
  await host.completeOperation(cancelled.operationId, {
    state: 'cancelled',
    code: 'cancelled',
    finishedAt: 106
  });
  assert.equal((await host.queryPlaylistItems({ playlistId: 'playlist-1', limit: 10 })).items.length, 3);
  assert.equal((await host.gcTerminalOperations({ finishedBefore: 200, limit: 10 })).deletedCount, 0);
  assert.deepEqual(await host.gcPlaylistItems(1), {
    deletedItemCount: 1,
    deletedPageCount: 0,
    deletedPlaylistCount: 0,
    hasMore: true
  });
  assert.equal((await host.gcTerminalOperations({ finishedBefore: 200, limit: 10 })).deletedCount, 1);

  assert.equal((await host.tombstonePlaylist({
    playlistId: 'playlist-1',
    expectedVersion: 1,
    updatedAt: 107
  })).kind, 'tombstoned');
  assert.deepEqual(await host.gcPlaylistItems(1), {
    deletedItemCount: 1,
    deletedPageCount: 0,
    deletedPlaylistCount: 0,
    hasMore: true
  });
  await host.gcPlaylistItems(10);
  await assert.rejects(
    host.queryPlaylistItems({ playlistId: 'playlist-1', limit: 10 }),
    error => error.code === 'playlistNotFound'
  );
});
