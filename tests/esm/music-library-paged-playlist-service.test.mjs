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
    async resolvePlaylistExportSource(trackUid) {
      return { kind: 'portable-relative', trackUid, folderId: 'folder-1', rootName: 'Music', path: `${trackUid}.flac` };
    },
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

test('playlist CRUD calls stay on bounded repository methods', async () => {
  const service = createService(createServiceClient());

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
  await service.reorderItem('playlist-1', 'item-1', { beforeItemKey: 'item-9' });
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
  assert.deepEqual(calls[4][1].target, { beforeItemKey: 'item-9' });
  assert.equal(calls[5][1].updatedAt, 1234);
});

test('manual paged import previews before publication and commits or cancels by opaque token', async () => {
  const calls = [];
  const source = {
    name: 'Road Trip.m3u8', size: 42, lastModified: 7, type: '', stream() {}
  };
  const operationService = {
    async previewPlaylistImport(request) {
      calls.push(['preview', request]);
      return {
        previewToken: 'preview-token',
        playlistId: request.playlistId,
        playlistName: request.name,
        totalCount: 3,
        resolvedCount: 2,
        unresolvedCount: 1,
        unresolvedItems: [{ label: 'Missing.flac' }],
        expiresAt: 9999
      };
    },
    async commitPlaylistImportPreview(request) {
      calls.push(['commit', request]);
      return { playlistId: request.playlistId, version: 1, itemCount: 3 };
    },
    async cancelPlaylistImportPreview(request) {
      calls.push(['cancel', request]);
      return { kind: 'cancelled' };
    }
  };
  const service = new PagedPlaylistService({
    client: createServiceClient(),
    operationService,
    requestIdFactory: (() => { let id = 0; return () => `preview-${++id}`; })(),
    now: () => 1234
  });

  const preview = await service.previewImport(source);
  assert.equal(preview.totalCount, 3);
  assert.equal(preview.unresolvedItems[0].label, 'Missing.flac');
  assert.deepEqual(await service.commitImport(preview), {
    playlistId: preview.playlistId, version: 1, itemCount: 3
  });
  assert.deepEqual(await service.cancelImportPreview(preview), { kind: 'cancelled' });
  assert.deepEqual(calls.map(call => call[0]), ['preview', 'commit', 'cancel']);
  assert.equal(calls[0][1].source, source);
  assert.equal(calls[0][1].name, 'Road Trip');
  assert.deepEqual(calls[1][1], {
    previewToken: 'preview-token', playlistId: preview.playlistId
  });
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
    },
    async resolvePlaylistExportSource() {
      return { kind: 'absolute-path', trackUid: 'one', folderId: 'folder-1', lifecycleVersion: 1, path: 'D:\\Music\\Album\\one.flac' };
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

test('portable Web export preserves root names for tracks from multiple folders', async () => {
  const sources = new Map([
    ['one', { kind: 'portable-relative', trackUid: 'one', folderId: 'folder-a', rootName: 'Library A', path: 'Album/Song.flac' }],
    ['two', { kind: 'portable-relative', trackUid: 'two', folderId: 'folder-b', rootName: 'Library B', path: 'Album/Song.flac' }]
  ]);
  const client = createServiceClient({
    async queryPlaylistItems() {
      return {
        playlist: { playlistId: 'playlist-1' },
        items: [{ trackUid: 'one' }, { trackUid: 'two' }],
        nextPosition: null
      };
    },
    async resolvePlaylistExportSource(trackUid) { return sources.get(trackUid); }
  });
  const writes = [];
  await createService(client).exportToSink('playlist-1', {
    format: 'm3u8',
    relative: false,
    sink: {
      async write(chunk) { writes.push(chunk); },
      async commit() {},
      async abort() {}
    }
  });
  const output = writes.join('');
  assert.match(output, /Library A\/Album\/Song\.flac/);
  assert.match(output, /Library B\/Album\/Song\.flac/);
});

test('M3U8 and XSPF exports skip resolved and unresolved CUE tracks without resolving physical paths', async () => {
  for (const format of ['m3u8', 'xspf']) {
    const resolvedSources = [];
    const client = createServiceClient({
      async queryPlaylistItems() {
        return {
          playlist: { playlistId: 'playlist-1' },
          items: [
            { trackUid: 'plain' },
            { trackUid: 'cue-resolved' },
            {
              unresolved: {
                sourceKind: 'cue-track',
                entryKey: 'cue:Album/Disc.cue#02',
                sourceLine: 'D:\\Private\\Album.flac',
                title: 'Cue Two'
              }
            },
            { unresolved: { sourceLine: 'missing.flac', title: 'Missing' } }
          ],
          nextPosition: null
        };
      },
      async getTrack(trackUid) {
        return trackUid === 'cue-resolved'
          ? {
              trackUid,
              sourceKind: 'cue-track',
              entryKey: 'cue:Album/Disc.cue#01',
              relativePath: 'Album.flac',
              title: 'Cue One'
            }
          : { trackUid, sourceKind: 'file', relativePath: 'plain.flac', title: 'Plain' };
      },
      async resolvePlaylistExportSource(trackUid) {
        resolvedSources.push(trackUid);
        return {
          kind: 'absolute-path',
          path: trackUid === 'cue-resolved'
            ? 'D:\\Private\\Album.flac'
            : 'D:\\Music\\plain.flac'
        };
      }
    });
    const writes = [];
    const summary = await createService(client).exportToSink('playlist-1', {
      format,
      relative: false,
      sink: {
        async write(chunk) { writes.push(chunk); },
        async commit() {},
        async abort() {}
      }
    });

    const output = writes.join('');
    assert.deepEqual(summary, { exportedCount: 2, skippedCueCount: 2 });
    assert.deepEqual(resolvedSources, ['plain']);
    assert.match(output, /plain\.flac/);
    assert.match(output, /missing\.flac/);
    assert.doesNotMatch(output, /Album\.flac|Cue One|Cue Two|Private/);
  }
});
