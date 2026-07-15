'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { LibraryCatalogHost } = require('../../electron/library-catalog-host.cjs');
const {
  LIBRARY_SERVICE_CHANNELS,
  LIBRARY_PLAYBACK_CHANNELS,
  LIBRARY_SERVICE_EVENT_CHANNEL,
  LibraryServiceCoordinator,
  registerLibraryServiceIpc
} = require('../../electron/library-service-coordinator.cjs');

async function openFixture(t, { repositoryFactory, importSourceProvider } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-library-service-'));
  const host = await LibraryCatalogHost.open({ dbPath: path.join(directory, 'catalog.sqlite') });
  await seedTracks(host, directory, 6);
  const repository = repositoryFactory ? repositoryFactory(host) : host;
  const coordinator = await LibraryServiceCoordinator.open({ repository, importSourceProvider });
  t.after(async () => {
    coordinator.dispose();
    await host.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { coordinator, directory, host };
}

async function seedTracks(host, directory, count) {
  await host.upsertFolders([{
    id: 'folder-music',
    kind: 'electron',
    displayName: 'Music',
    path: directory,
    status: 'ok',
    lifecycleVersion: 1
  }]);
  await host.upsertTracks(Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
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
  }));
}

async function createTrackContext(host) {
  return host.createContext({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });
}

function createRequest(contextToken, overrides = {}) {
  return {
    clientRequestId: `request-${Math.random()}`,
    operationKind: 'queue',
    selectionDescriptor: { mode: 'all', contextToken, exclusions: [] },
    target: { transport: 'main' },
    expectedTargetVersion: 0,
    options: {},
    ...overrides
  };
}

async function waitForTerminal(coordinator, clientRequestId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await coordinator.lookupResult(clientRequestId);
    if (result.kind === 'terminal') return result.result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Operation did not become terminal');
}

async function readSequenceTrackUids(host, sequenceId) {
  const result = [];
  let ordinal = 0;
  while (true) {
    const page = await host.queryPlaybackSequence({ sequenceId, ordinal, limit: 2 });
    result.push(...page.items.map(item => item.trackUid));
    if (page.nextOrdinal === null) return result;
    ordinal = page.nextOrdinal;
  }
}

test('coordinator preserves explicit descriptor order and materializes all and range in context order', async t => {
  const { coordinator, host } = await openFixture(t);
  const { contextToken } = await createTrackContext(host);
  const cases = [
    {
      descriptor: { mode: 'explicit', contextToken, trackUids: ['track-4', 'track-2'] },
      expected: ['track-4', 'track-2']
    },
    {
      descriptor: { mode: 'all', contextToken, exclusions: ['track-2', 'track-5'] },
      expected: ['track-1', 'track-3', 'track-4', 'track-6']
    },
    {
      descriptor: {
        mode: 'range',
        contextToken,
        startUid: 'track-5',
        endUid: 'track-2',
        exclusions: ['track-3']
      },
      expected: ['track-2', 'track-4', 'track-5']
    }
  ];

  for (const [index, entry] of cases.entries()) {
    const clientRequestId = `materialize-${index}`;
    const receipt = await coordinator.start(createRequest(contextToken, {
      clientRequestId,
      expectedTargetVersion: index,
      selectionDescriptor: entry.descriptor
    }));
    assert.equal(receipt.kind, 'started');
    const terminal = await waitForTerminal(coordinator, clientRequestId);
    assert.equal(terminal.state, 'succeeded');
    assert.deepEqual(
      await readSequenceTrackUids(host, terminal.result.sequenceId),
      entry.expected
    );
  }
});

test('play returns a stable provisional entry, joins response loss, and cancellation prevents publish', async t => {
  let releaseSnapshot;
  const snapshotGate = new Promise(resolve => { releaseSnapshot = resolve; });
  const { coordinator, host } = await openFixture(t, {
    repositoryFactory: catalogHost => new Proxy(catalogHost, {
      get(target, property) {
        if (property === 'appendOperationSnapshotItems') {
          return async options => {
            await snapshotGate;
            return target.appendOperationSnapshotItems(options);
          };
        }
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      }
    })
  });
  const { contextToken } = await createTrackContext(host);
  const request = createRequest(contextToken, {
    clientRequestId: 'play-response-loss',
    operationKind: 'play',
    selectionDescriptor: { mode: 'all', contextToken, exclusions: [] }
  });
  const first = await coordinator.start(request);
  assert.equal(first.kind, 'started');
  const provisionalEntry = await coordinator.getProvisionalEntry(first.operationId);
  assert.equal(provisionalEntry.trackUid, 'track-1');
  assert.equal(provisionalEntry.ordinal, 0);
  const joined = await coordinator.start(request);
  assert.deepEqual(joined, {
    kind: 'active',
    operationId: first.operationId
  });
  assert.deepEqual(await coordinator.start({ ...request, options: { changed: true } }), {
    kind: 'requestIdReuse'
  });
  assert.equal((await coordinator.start(createRequest(contextToken))).kind, 'busy');

  const cancelled = await coordinator.cancel(first.operationId);
  assert.equal(cancelled.kind, 'cancelRequested');
  releaseSnapshot();
  const terminal = await waitForTerminal(coordinator, 'play-response-loss');
  assert.equal(terminal.state, 'cancelled');
  assert.equal((await coordinator.cancel(first.operationId)).kind, 'tooLate');
});

test('play publishes a disk sequence and a renderer-owned transport CAS token', async t => {
  const { coordinator, host } = await openFixture(t);
  const { contextToken } = await createTrackContext(host);
  const request = createRequest(contextToken, {
    clientRequestId: 'play-publish',
    operationKind: 'play',
    expectedTargetVersion: 0,
    selectionDescriptor: { mode: 'explicit', contextToken, trackUids: ['track-2', 'track-3'] }
  });
  const receipt = await coordinator.start(request);
  const provisionalEntry = await coordinator.getProvisionalEntry(receipt.operationId);
  assert.equal(provisionalEntry.trackUid, 'track-2');
  assert.equal(provisionalEntry.transportVersion, 1);
  assert.equal((await coordinator.getTransportState()).descriptor.segments[0].sequenceId, `provisional:${receipt.operationId}`);
  const terminal = await waitForTerminal(coordinator, 'play-publish');
  assert.equal(terminal.state, 'succeeded');
  assert.deepEqual(terminal.result.firstEntry, provisionalEntry);
  assert.equal(terminal.result.destination, 'replace');
  assert.equal(terminal.result.itemCount, 2);
  assert.equal(terminal.result.expectedTransportVersion, 0);
  assert.equal(terminal.result.transportVersion, provisionalEntry.transportVersion);
  assert.equal((await coordinator.getTransportState()).descriptor.segments[0].sequenceId, terminal.result.sequenceId);
  assert.equal(terminal.result.publishToken.expectedTransportVersion, 0);
  const page = await host.queryPlaybackSequence({
    sequenceId: terminal.result.sequenceId,
    ordinal: 0,
    limit: 2
  });
  assert.equal(page.items[0].entryInstanceId, provisionalEntry.entryInstanceId);
  assert.deepEqual(page.items.map(item => item.trackUid), ['track-2', 'track-3']);
});

test('addToPlaylist stages invisibly and publishes with the expected playlist version', async t => {
  const { coordinator, host } = await openFixture(t);
  const { contextToken } = await createTrackContext(host);
  await host.createPlaylist({ playlistId: 'playlist-1', name: 'List', createdAt: 100 });
  const clientRequestId = 'add-playlist';
  const receipt = await coordinator.start(createRequest(contextToken, {
    clientRequestId,
    operationKind: 'addToPlaylist',
    target: { playlistId: 'playlist-1' },
    expectedTargetVersion: 0,
    selectionDescriptor: {
      mode: 'explicit',
      contextToken,
      trackUids: ['track-2', 'track-4']
    }
  }));
  assert.equal(receipt.kind, 'started');
  const terminal = await waitForTerminal(coordinator, clientRequestId);
  assert.equal(terminal.state, 'succeeded');
  assert.deepEqual(terminal.result, { playlistId: 'playlist-1', version: 1 });
  const playlist = await host.queryPlaylistItems({ playlistId: 'playlist-1', limit: 10 });
  assert.deepEqual(playlist.items.map(item => item.trackUid), ['track-2', 'track-4']);
});

test('playlist import consumes an Electron grant, resolves indexed matches, and publishes atomically', async t => {
  const entryCount = 1_001;
  const bytes = Buffer.from([
    '#EXTM3U',
    ...Array.from({ length: entryCount }, (_, index) => `Imported/Track-${index + 1}.flac`),
    ''
  ].join('\n'));
  const source = {
    kind: 'electron-import-grant',
    token: 'grant-token',
    name: 'Million Sample.m3u8',
    size: bytes.length,
    lastModified: 123,
    type: ''
  };
  let consumed = 0;
  const { coordinator, host } = await openFixture(t, {
    importSourceProvider: {
      async consumePlaylistImportGrant(received) {
        assert.deepEqual(received, source);
        consumed += 1;
        return {
          name: source.name,
          stream: () => (async function* stream() { yield bytes; })()
        };
      }
    }
  });
  const clientRequestId = 'playlist-import';
  const receipt = await coordinator.start({
    clientRequestId,
    operationKind: 'importPlaylist',
    selectionDescriptor: null,
    target: { playlistId: 'imported-playlist' },
    expectedTargetVersion: 0,
    options: { name: 'Imported', source, encoding: null, limits: null }
  });
  assert.equal(receipt.kind, 'started');
  const terminal = await waitForTerminal(coordinator, clientRequestId);
  assert.equal(terminal.state, 'succeeded');
  assert.deepEqual(terminal.result, { playlistId: 'imported-playlist', version: 1, itemCount: entryCount });
  assert.equal(consumed, 1);

  const firstPage = await host.queryPlaylistItems({ playlistId: 'imported-playlist', limit: 500 });
  assert.equal(firstPage.items.length, 500);
  assert.equal(firstPage.items[0].trackUid, 'track-1');
  assert.equal(firstPage.items[0].unresolved, null);
  assert.equal(firstPage.items[6].unresolved.relativePathHint, 'Imported/Track-7.flac');
  assert.ok(Number.isSafeInteger(firstPage.nextPosition));
  const secondPage = await host.queryPlaylistItems({
    playlistId: 'imported-playlist',
    afterPosition: firstPage.nextPosition,
    limit: 500
  });
  assert.equal(secondPage.items.length, 500);
  const lastPage = await host.queryPlaylistItems({
    playlistId: 'imported-playlist',
    afterPosition: secondPage.nextPosition,
    limit: 500
  });
  assert.equal(lastPage.items.length, 1);
  assert.equal(lastPage.items[0].unresolved.relativePathHint, 'Imported/Track-1001.flac');

  const detailPage = await host.queryTracks({
    query: '',
    sort: 'title',
    direction: 'asc',
    scope: { playlistId: 'imported-playlist' },
    limit: 10
  });
  assert.deepEqual(detailPage.totalCount, { pending: true });
  assert.equal((await host.getContextCount({ contextToken: detailPage.contextToken })).totalCount, entryCount);
  assert.ok(detailPage.rows.some(row => row.trackUid === 'track-1' && row.metadataStatus !== 'unresolved'));
  assert.equal(detailPage.rows[0].playlistVersion, 1);
  assert.ok(Number.isSafeInteger(detailPage.rows[0].itemKey));
});

test('IPC keeps four durable verbs and exposes bounded playback sequence reads separately', async () => {
  const ipcMain = createFakeIpcMain();
  const coordinator = new EventEmitter();
  coordinator.start = async request => ({ method: 'start', request });
  coordinator.lookupResult = async value => ({ method: 'lookupResult', value });
  coordinator.status = async value => ({ method: 'status', value });
  coordinator.cancel = async value => ({ method: 'cancel', value });
  coordinator.applyTransportUndo = async value => ({ method: 'applyTransportUndo', value });
  coordinator.readSequencePage = async value => ({ method: 'readSequencePage', value });
  coordinator.resolveSequenceEntrySource = async value => ({ method: 'resolveSequenceEntrySource', value });
  const sends = [];
  const webContents = {
    isDestroyed: () => false,
    send: (...args) => sends.push(args)
  };
  const mainWindow = { isDestroyed: () => false, webContents };
  const dispose = registerLibraryServiceIpc({
    ipcMain,
    coordinator,
    getMainWindow: () => mainWindow
  });
  assert.deepEqual(
    [...ipcMain.handlers.keys()].sort(),
    [...Object.values(LIBRARY_SERVICE_CHANNELS), ...Object.values(LIBRARY_PLAYBACK_CHANNELS)].sort()
  );
  assert.throws(
    () => ipcMain.handlers.get(LIBRARY_SERVICE_CHANNELS.status)({ sender: {} }, { operationId: 'op' }),
    error => error.code === 'unauthorizedLibraryServiceSender'
  );
  assert.deepEqual(
    await ipcMain.handlers.get(LIBRARY_SERVICE_CHANNELS.status)({ sender: webContents }, { operationId: 'op' }),
    { method: 'status', value: 'op' }
  );
  assert.deepEqual(
    await ipcMain.handlers.get(LIBRARY_PLAYBACK_CHANNELS.applyTransportUndo)(
      { sender: webContents },
      { undoId: 'transport:op', expectedTransportVersion: 2 }
    ),
    { method: 'applyTransportUndo', value: { undoId: 'transport:op', expectedTransportVersion: 2 } }
  );
  coordinator.emit('event', { kind: 'progress', progress: { operationId: 'op', processed: 1 } });
  assert.deepEqual(sends, [[
    LIBRARY_SERVICE_EVENT_CHANNEL,
    { kind: 'progress', progress: { operationId: 'op', processed: 1 } }
  ]]);
  dispose();
  assert.equal(ipcMain.handlers.size, 0);
});

function createFakeIpcMain() {
  return {
    handlers: new Map(),
    handle(channel, handler) { this.handlers.set(channel, handler); },
    removeHandler(channel) { this.handlers.delete(channel); }
  };
}
