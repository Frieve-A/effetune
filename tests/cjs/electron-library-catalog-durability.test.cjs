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
    operationKind: 'queue',
    target: { transport: 'main' },
    expectedTargetVersion: null,
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

test('catalog host is a complete DurableLibraryService repository adapter', async t => {
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
      queue: async ({ reportProgress }) => {
        await reportProgress({
          phase: 'materializing',
          processed: 2,
          total: 2,
          state: 'running'
        });
        return { sequenceId: 'sequence-service' };
      }
    }
  });
  const started = await service.start({
    clientRequestId: 'service-request',
    operationKind: 'queue',
    selectionDescriptor: { mode: 'all', contextToken: source.contextToken, exclusions: [] },
    target: { transport: 'main' },
    expectedTargetVersion: 0,
    options: {}
  });
  assert.equal(started.kind, 'started');
  await service.running.get(started.operationId).task;
  const lookup = await service.lookupResult('service-request');
  assert.equal(lookup.kind, 'terminal');
  assert.equal(lookup.result.state, 'succeeded');
  assert.deepEqual(lookup.result.result, { sequenceId: 'sequence-service' });
});

test('operation ledger joins response loss, rejects request ID reuse, enforces busy and stores cancellation', async t => {
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
  assert.equal((await host.lookupOperationResult('request-1')).result.state, 'cancelled');
  assert.deepEqual(await host.requestOperationCancel(created.operationId, { requestedAt: 105 }), {
    kind: 'tooLate'
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
  const result = await host.lookupOperationResult('request-1');
  assert.equal(result.kind, 'terminal');
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

test('playback sequences preserve duplicate occurrences with stable entry instance IDs and bounded GC', async t => {
  const { host } = await openCatalog(t);
  await host.createPlaybackSequence({
    sequenceId: 'sequence-1',
    sourceContext: 'all-tracks',
    catalogVersion: 0,
    seed: 42,
    snapshotId: null,
    createdAt: 100
  });
  await host.appendPlaybackSequenceItems({
    sequenceId: 'sequence-1',
    items: [
      { trackUid: 'track-1', entryInstanceId: 'entry-1' },
      { trackUid: 'track-1', entryInstanceId: 'entry-2' },
      { trackUid: 'track-2', entryInstanceId: 'entry-3' }
    ]
  });
  await host.sealPlaybackSequence({
    sequenceId: 'sequence-1',
    itemCount: 3,
    currentOrdinal: 0,
    sealedAt: 101
  });
  await host.publishPlaybackSequence({ sequenceId: 'sequence-1', finishedAt: 102 });
  const page = await host.queryPlaybackSequence({ sequenceId: 'sequence-1', ordinal: 0, limit: 2 });
  assert.deepEqual(page.items.map(item => [item.trackUid, item.entryInstanceId]), [
    ['track-1', 'entry-1'],
    ['track-1', 'entry-2']
  ]);
  assert.equal(page.nextOrdinal, 2);

  const save = await host.receiveOperation(playlistOperationRequest('playlist-owner', {
    clientRequestId: 'request-playlist-owner',
    requestDigest: 'sha256:playlist-owner',
    sourceContextToken: null,
    sourceSequenceIds: ['sequence-1'],
    sourceSequenceItemCount: 3,
    buildDeadlineAt: 1_000
  }));
  assert.equal(save.kind, 'created');
  await host.tombstonePlaybackSequence('sequence-1');
  assert.deepEqual(await host.gcPlaybackSequences(10), {
    deletedItemCount: 0,
    deletedSequenceCount: 0,
    hasMore: false
  });
  const ownedPage = await host.queryTransportSegmentPage({
    operationId: save.operationId,
    segment: { sequenceId: 'sequence-1', startOrdinal: 0, endOrdinal: 3 },
    transportOrdinal: 0,
    limit: 3
  });
  assert.deepEqual(ownedPage.items.map(item => item.entryInstanceId), ['entry-1', 'entry-2', 'entry-3']);
  const { canonicalOrdinalForTransport } = await import('../../js/library/repository/transport-shuffle.js');
  const shuffledDescriptor = {
    segments: [{ sequenceId: 'sequence-1', startOrdinal: 0, endOrdinal: 3 }],
    currentOrdinal: 0,
    shuffleSeed: 29,
    shuffleEpoch: 4,
    shuffleTransportOffset: 1
  };
  const shuffledPage = await host.queryTransportDescriptorPage({
    operationId: save.operationId,
    descriptor: shuffledDescriptor,
    transportOrdinal: 0,
    limit: 3
  });
  const sourceEntries = ['entry-1', 'entry-2', 'entry-3'];
  assert.deepEqual(
    shuffledPage.items.map(item => item.entryInstanceId),
    [0, 1, 2].map(ordinal => sourceEntries[
      canonicalOrdinalForTransport(shuffledDescriptor, ordinal, 3)
    ])
  );
  await assert.rejects(host.queryTransportSegmentPage({
    segment: { sequenceId: 'sequence-1', startOrdinal: 0, endOrdinal: 3 },
    transportOrdinal: 0,
    limit: 3
  }), error => error.code === 'sequenceNotFound');
  await host.completeOperation(save.operationId, {
    state: 'cancelled', code: 'cancelled', finishedAt: 103
  });
  assert.deepEqual(await host.gcPlaybackSequences(1), {
    deletedItemCount: 1,
    deletedSequenceCount: 0,
    hasMore: true
  });
  await host.gcPlaybackSequences(10);
  await assert.rejects(
    host.queryPlaybackSequence({ sequenceId: 'sequence-1', ordinal: 0, limit: 1 }),
    error => error.code === 'sequenceNotFound'
  );
});

test('desktop provisional Play keeps one durable authority and restores the prior queue after restart', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-provisional-undo-'));
  const dbPath = path.join(directory, 'catalog.sqlite');
  let host = await LibraryCatalogHost.open({ dbPath });
  t.after(async () => {
    await host.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await seedTracks(host, directory);
  const source = await host.createContext({ query: '', sort: 'title', direction: 'asc', scope: null });
  await host.createPlaybackSequence({
    sequenceId: 'desktop-before-provisional', sourceContext: source.contextToken,
    catalogVersion: source.catalogVersion, seed: null, snapshotId: null, createdAt: 100
  });
  await host.appendPlaybackSequenceItems({
    sequenceId: 'desktop-before-provisional',
    items: [{ trackUid: 'track-1', entryInstanceId: 'desktop-before-entry' }]
  });
  await host.sealPlaybackSequence({
    sequenceId: 'desktop-before-provisional', itemCount: 1, currentOrdinal: 0, sealedAt: 101
  });
  await host.publishPlaybackSequence({ sequenceId: 'desktop-before-provisional', finishedAt: 102 });
  await host.commitTransportState({
    expectedTransportVersion: 0,
    descriptor: {
      segments: [{ sequenceId: 'desktop-before-provisional', startOrdinal: 0, endOrdinal: 1 }],
      currentOrdinal: 0
    },
    updatedAt: 103
  });
  const replacing = await host.receiveOperation(operationRequest({
    clientRequestId: 'desktop-provisional', requestDigest: 'sha256:desktop-provisional',
    operationKind: 'play', target: { transport: 'main' }, expectedTargetVersion: 1,
    sourceContextToken: source.contextToken, receivedAt: 200
  }));
  await host.transitionOperation(replacing.operationId, 'SNAPSHOTTING', { updatedAt: 201 });
  const provisional = await host.publishProvisionalTransport({
    operationId: replacing.operationId,
    sourceContext: source.contextToken,
    catalogVersion: source.catalogVersion,
    expectedTransportVersion: 1,
    firstEntry: { ordinal: 0, entryInstanceId: 'desktop-provisional-entry', trackUid: 'track-2' },
    publishedAt: 202
  });
  assert.equal(provisional.transportVersion, 2);
  assert.equal((await host.getTransportState()).descriptor.segments[0].sequenceId, `provisional:${replacing.operationId}`);
  await host.createPlaybackSequence({
    sequenceId: 'desktop-abandoned-build', operationId: replacing.operationId,
    sourceContext: source.contextToken, catalogVersion: source.catalogVersion,
    seed: null, snapshotId: null, createdAt: 202
  });
  await host.appendPlaybackSequenceItems({
    sequenceId: 'desktop-abandoned-build',
    items: [{ trackUid: 'track-2', entryInstanceId: 'desktop-abandoned-entry' }]
  });
  await host.sealPlaybackSequence({
    sequenceId: 'desktop-abandoned-build', itemCount: 1, currentOrdinal: 0, sealedAt: 202
  });
  const cancelled = await host.completeOperation(replacing.operationId, {
    state: 'cancelled', code: 'cancelled', finishedAt: 203
  });
  assert.equal(cancelled.result.undoId, provisional.undoId);
  await host.close();

  host = await LibraryCatalogHost.open({ dbPath });
  assert.equal((await host.getTransportState()).transportVersion, 2);
  await assert.rejects(host.queryPlaybackSequence({
    sequenceId: 'desktop-abandoned-build', ordinal: 0, limit: 1
  }), error => error.code === 'sequenceNotFound');
  assert.deepEqual(await host.applyTransportUndo({
    undoId: provisional.undoId, expectedTransportVersion: 1, appliedAt: 204
  }), { kind: 'conflict', currentTransportVersion: 2 });
  const restored = await host.applyTransportUndo({
    undoId: provisional.undoId, expectedTransportVersion: 2, appliedAt: 205
  });
  assert.equal(restored.kind, 'published');
  assert.equal(restored.transportVersion, 3);
  assert.equal(restored.descriptor.segments[0].sequenceId, 'desktop-before-provisional');
  assert.equal((await host.queryPlaybackSequence({
    sequenceId: 'desktop-before-provisional', ordinal: 0, limit: 1
  })).items[0].trackUid, 'track-1');
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
  assert.equal((await host.lookupOperationResult('request-playlist-1')).result.state, 'succeeded');

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
