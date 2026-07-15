import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PagedPlaylistService
} from '../../js/library/playlists/paged-playlist-service.js';

function createServiceClient(overrides = {}) {
  return {
    async createContext() { return { contextToken: 'playlist-context' }; },
    async queryEntities(request) {
      return { rows: [{ playlistId: 'playlist-1', name: 'One' }], request };
    },
    async releaseContext() {},
    async createPlaylist(request) { return { kind: 'created', playlistId: request.playlistId }; },
    async createPlaylistWithItems(request) { return { kind: 'created', playlistId: request.playlistId }; },
    async renamePlaylist(request) { return { kind: 'renamed', ...request }; },
    async duplicatePlaylist(request) { return { kind: 'duplicated', ...request }; },
    async reorderPlaylistItem(request) { return { kind: 'reordered', ...request }; },
    async removePlaylistItem(request) { return { kind: 'removed', ...request }; },
    async queryPlaylistItems() {
      return { playlist: { playlistId: 'playlist-1', version: 3 }, items: [], nextPosition: null };
    },
    async tombstonePlaylist(request) { return { kind: 'tombstoned', ...request }; },
    async start(request) { return { operationId: 'operation', request }; },
    async getTrack(trackUid) { return { trackUid, path: `${trackUid}.flac`, title: trackUid }; },
    ...overrides
  };
}

function createService(client) {
  let id = 0;
  return new PagedPlaylistService({
    client,
    requestIdFactory: () => `id-${++id}`,
    now: () => 1234
  });
}

test('addTracks uses the separately supplied four-verb operation service', async () => {
  const starts = [];
  const client = createServiceClient({
    start() { throw new Error('catalog client start must not be used'); }
  });
  const service = new PagedPlaylistService({
    client,
    operationService: { async start(request) { starts.push(request); return { kind: 'started' }; } },
    requestIdFactory: () => 'request-separated',
    now: () => 1234
  });
  await service.addTracks('playlist-1', { mode: 'all', contextToken: 'context-1', exclusions: [] }, {
    expectedTargetVersion: 3
  });
  assert.deepEqual(starts, [{
    clientRequestId: 'request-separated',
    operationKind: 'addToPlaylist',
    selectionDescriptor: { mode: 'all', contextToken: 'context-1', exclusions: [] },
    target: { playlistId: 'playlist-1' },
    expectedTargetVersion: 3,
    options: {}
  }]);
});

test('playlist list and CRUD calls stay on bounded repository methods', async () => {
  const calls = [];
  const client = createServiceClient({
    async releaseContext(token) { calls.push(['release', token]); },
    async queryEntities(request) {
      calls.push(['query', request]);
      return { rows: [{ playlistId: 'playlist-1', name: 'One' }], nextCursor: null };
    }
  });
  const service = createService(client);

  const page = await service.listPage({ limit: 999 });
  assert.equal(page.rows[0].playlistId, 'playlist-1');
  assert.equal(calls[0][1].limit, 500);
  assert.deepEqual(calls[1], ['release', 'playlist-context']);
  assert.equal((await service.create('New')).playlistId, 'id-1');
  assert.equal((await service.create('With items', ['track-1', { trackId: 'track-2' }])).playlistId, 'id-2');
  assert.equal((await service.get('playlist-1')).version, 3);
  assert.equal((await service.delete('playlist-1')).kind, 'tombstoned');
});

test('playlist picker pages and searches within one explicitly owned context', async () => {
  const calls = [];
  const client = createServiceClient({
    async createContext(request) {
      calls.push(['open', request]);
      return { contextToken: 'picker-context' };
    },
    async queryEntities(request) {
      calls.push(['read', request]);
      return { rows: [], nextCursor: request.cursor ? null : 'next-page' };
    },
    async releaseContext(token) {
      calls.push(['release', token]);
    }
  });
  const service = createService(client);

  const context = await service.openListContext({ query: 'daily' });
  await service.readListContext(context.contextToken, { cursor: null, limit: 100 });
  await service.readListContext(context.contextToken, { cursor: 'next-page', limit: 100 });
  await service.releaseListContext(context.contextToken);

  assert.equal(calls[0][1].query, 'daily');
  assert.deepEqual(calls.slice(1, 3).map(call => call[1].contextToken), [
    'picker-context', 'picker-context'
  ]);
  assert.deepEqual(calls.at(-1), ['release', 'picker-context']);
});

test('local playlist mutations supply current versions and bounded create items', async () => {
  const calls = [];
  const client = createServiceClient({
    async createPlaylistWithItems(request) {
      calls.push(['create', request]);
      return { kind: 'created', playlistId: request.playlistId };
    },
    async renamePlaylist(request) { calls.push(['rename', request]); return { kind: 'renamed' }; },
    async duplicatePlaylist(request) { calls.push(['duplicate', request]); return { kind: 'duplicated' }; },
    async reorderPlaylistItem(request) { calls.push(['reorder', request]); return { kind: 'reordered' }; },
    async removePlaylistItem(request) { calls.push(['remove', request]); return { kind: 'removed' }; }
  });
  const service = createService(client);

  await service.create('Items', ['track-1', { trackId: 'track-2' }, { trackUid: 'track-3' }]);
  await service.rename('playlist-1', 'Renamed');
  await service.duplicate('playlist-1', 'Copy');
  await service.reorderItem('playlist-1', 'item-1', { direction: 'down' });
  await service.removeItem('playlist-1', 'item-1');

  assert.deepEqual(calls[0][1].items, [
    { trackUid: 'track-1' },
    { trackUid: 'track-2' },
    { trackUid: 'track-3' }
  ]);
  for (const [, request] of calls.slice(1)) assert.equal(request.expectedVersion, 3);
  assert.equal(calls[1][1].updatedAt, 1234);
  assert.equal(calls[2][1].targetPlaylistId, 'id-2');
  assert.equal(calls[2][1].createdAt, 1234);
  assert.equal(calls[3][1].updatedAt, 1234);
  assert.equal(calls[4][1].updatedAt, 1234);
});

test('streaming import is owned by the four-verb operation service', async () => {
  let startRequest = null;
  let streamOpened = 0;
  let unsubscribed = 0;
  const file = {
    name: 'large.m3u8',
    size: 123,
    lastModified: 456,
    type: 'audio/x-mpegurl',
    stream() {
      streamOpened += 1;
      return (async function* chunks() { yield new Uint8Array(); }());
    }
  };
  const client = createServiceClient();
  const service = new PagedPlaylistService({
    client,
    operationService: {
      async start(request) { startRequest = request; return { kind: 'started', operationId: 'import-1' }; },
      subscribeOperation(operationId, listener) {
        queueMicrotask(() => listener({
          kind: 'terminal',
          operationId,
          result: { state: 'succeeded', result: { playlistId: 'import-id-1', version: 1, itemCount: 1 } }
        }));
        return () => { unsubscribed += 1; };
      },
      async status(operationId) { return { operationId, phase: 'SNAPSHOTTING', terminalKind: null, result: null }; },
      beginPlaylistImport() { assert.fail('dedicated import verbs must not be exposed'); }
    },
    requestIdFactory: (() => { let id = 0; return () => `import-id-${++id}`; })(),
    now: () => 1234
  });

  const result = await service.importFile(file, { limits: { maxInputChunkBytes: 64 * 1024 } });

  assert.deepEqual(result, { playlistId: 'import-id-1', version: 1, itemCount: 1 });
  assert.equal(unsubscribed, 1);
  assert.equal(streamOpened, 0);
  assert.deepEqual(startRequest, {
    clientRequestId: 'import-id-2',
    operationKind: 'importPlaylist',
    selectionDescriptor: null,
    target: { playlistId: 'import-id-1' },
    expectedTargetVersion: 0,
    options: {
      name: 'large',
      source: file,
      encoding: null,
      limits: { maxInputChunkBytes: 64 * 1024 }
    }
  });
});

test('streaming import closes its event subscription for status-race success and typed failure', async () => {
  const file = { name: 'race.m3u8', stream() {} };
  let successUnsubscribed = 0;
  const success = new PagedPlaylistService({
    client: createServiceClient(),
    operationService: {
      async start() { return { kind: 'started', operationId: 'race-success' }; },
      subscribeOperations() { return () => { successUnsubscribed += 1; }; },
      async status() {
        return {
          operationId: 'race-success',
          terminalKind: 'success',
          result: { state: 'succeeded', result: { playlistId: 'race-playlist', version: 1, itemCount: 2 } }
        };
      }
    },
    requestIdFactory: () => 'race-playlist',
    now: () => 1234
  });
  assert.deepEqual(await success.importFile(file), {
    playlistId: 'race-playlist', version: 1, itemCount: 2
  });
  assert.equal(successUnsubscribed, 1);

  let failureListener;
  let failureUnsubscribed = 0;
  const failure = new PagedPlaylistService({
    client: createServiceClient(),
    operationService: {
      async start() { return { kind: 'started', operationId: 'race-failure' }; },
      subscribeOperation(_operationId, listener) {
        failureListener = listener;
        return () => { failureUnsubscribed += 1; };
      },
      async status() { return { operationId: 'race-failure', terminalKind: null, result: null }; }
    },
    requestIdFactory: () => 'failed-playlist',
    now: () => 1234
  });
  const failed = failure.importFile(file);
  await Promise.resolve();
  failureListener({
    kind: 'terminal', operationId: 'race-failure',
    result: { state: 'failed', code: 'playlistMalformed' }
  });
  await assert.rejects(failed, error => error.code === 'playlistMalformed');
  assert.equal(failureUnsubscribed, 1);
});

test('atomic streaming export pages repository rows and aborts a failed sink', async () => {
  const pageLimits = [];
  let query = 0;
  const client = createServiceClient({
    async queryPlaylistItems(request) {
      pageLimits.push(request.limit);
      query += 1;
      return query === 1
        ? {
            playlist: { playlistId: 'playlist-1' },
            items: [{ trackUid: 'one' }, { unresolved: { sourceLine: 'missing.flac' } }],
            nextPosition: 2048
          }
        : { playlist: { playlistId: 'playlist-1' }, items: [{ trackUid: 'two' }], nextPosition: null };
    }
  });
  const writes = [];
  let committed = 0;
  const service = createService(client);
  await service.exportToSink('playlist-1', {
    format: 'm3u8',
    sink: {
      async write(chunk) { writes.push(chunk); },
      async commit() { committed += 1; },
      async abort() { assert.fail('successful export must not abort'); }
    }
  });
  assert.deepEqual(pageLimits, [500, 500]);
  assert.equal(committed, 1);
  assert.match(writes.join(''), /one\.flac/);
  assert.match(writes.join(''), /missing\.flac/);

  let aborted = 0;
  query = 0;
  await assert.rejects(service.exportToSink('playlist-1', {
    sink: {
      async write() { throw new Error('write failed'); },
      async commit() { assert.fail('failed export must not commit'); },
      async abort() { aborted += 1; }
    }
  }), /write failed/);
  assert.equal(aborted, 1);
});

test('relative streaming export resolves entries from the selected destination directory', async () => {
  const client = createServiceClient({
    async queryPlaylistItems() {
      return {
        playlist: { playlistId: 'playlist-1' },
        items: [{ trackUid: 'one' }],
        nextPosition: null
      };
    },
    async getTrack() {
      return { trackUid: 'one', path: 'D:\\Music\\Album\\one.flac', title: 'One' };
    }
  });
  const writes = [];
  await createService(client).exportToSink('playlist-1', {
    format: 'm3u8',
    relative: true,
    sink: {
      destinationPath: 'D:\\Exports\\Lists\\portable.m3u8',
      async write(chunk) { writes.push(chunk); },
      async commit() {},
      async abort() {}
    }
  });
  assert.match(writes.join(''), /\.\.\/\.\.\/Music\/Album\/one\.flac/);
  assert.doesNotMatch(writes.join(''), /D:\\/);
});
