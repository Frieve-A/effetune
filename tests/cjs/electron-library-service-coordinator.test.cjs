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

async function openFixture(t, { repositoryFactory, importSourceProvider, now } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-library-service-'));
  const host = await LibraryCatalogHost.open({ dbPath: path.join(directory, 'catalog.sqlite') });
  await seedTracks(host, directory, 6);
  const repository = repositoryFactory ? repositoryFactory(host) : host;
  const coordinator = await LibraryServiceCoordinator.open({ repository, importSourceProvider, now });
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
  const request = {
    operationKind: 'queue',
    selectionDescriptor: { mode: 'all', contextToken, exclusions: [] },
    target: { transport: 'main' },
    options: {},
    ...overrides
  };
  if (request.operationKind === 'addToPlaylist' || request.operationKind === 'importPlaylist') {
    request.clientRequestId ??= `request-${Math.random()}`;
    request.expectedTargetVersion ??= 0;
  } else {
    delete request.clientRequestId;
    delete request.expectedTargetVersion;
  }
  return request;
}

async function waitForTerminal(coordinator, operationId) {
  const status = await coordinator.waitForTerminal(operationId);
  assert.ok(status?.result, 'Operation did not become terminal');
  return status.result;
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
        inclusions: ['track-6', 'track-3'],
        exclusions: ['track-3']
      },
      expected: ['track-2', 'track-4', 'track-5', 'track-6']
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
    const terminal = await waitForTerminal(coordinator, receipt.operationId);
    assert.equal(terminal.state, 'succeeded');
    assert.deepEqual(
      await readSequenceTrackUids(host, terminal.result.sequenceId),
      entry.expected
    );
  }
});

test('recent selection materializes only the newest 500 tracks at the 501-item boundary', async t => {
  const { coordinator, host } = await openFixture(t);
  const tracks = Array.from({ length: 501 }, (_, offset) => {
    const index = offset + 1;
    return {
      trackUid: `recent-${String(index).padStart(4, '0')}`,
      folderId: 'folder-music',
      relativePath: `Recent/Track-${index}.flac`,
      fileName: `Track-${index}.flac`,
      title: `Recent Track ${index}`,
      artist: 'Recent Artist',
      albumArtist: 'Recent Artist',
      album: 'Recent Album',
      genre: 'Genre',
      trackNo: index,
      durationSec: 120,
      addedAt: 1000 + index,
      updatedAt: 1000 + index
    };
  });
  await host.upsertTracks(tracks.slice(0, 500));
  await host.upsertTracks(tracks.slice(500));
  const context = await host.createContext({
    endpoint: 'tracks', query: '', sort: 'added', direction: 'desc', scope: { recent: true }
  });
  const clientRequestId = 'materialize-recent-500';
  const receipt = await coordinator.start(createRequest(context.contextToken, {
    clientRequestId,
    selectionDescriptor: { mode: 'all', contextToken: context.contextToken, exclusions: [] }
  }));
  assert.equal(receipt.kind, 'started');
  const terminal = await waitForTerminal(coordinator, receipt.operationId);
  assert.equal(terminal.state, 'succeeded');
  const sequence = await host.queryPlaybackSequence({
    sequenceId: terminal.result.sequenceId, ordinal: 0, limit: 500
  });
  assert.equal(sequence.items.length, 500);
  assert.equal(sequence.items[0].trackUid, 'recent-0501');
  assert.equal(sequence.items.at(-1).trackUid, 'recent-0002');
  assert.equal(sequence.items.some(item => item.trackUid === 'recent-0001'), false);
});

test('playlist materialization selects occurrences, preserves duplicates, and skips unresolved rows', async t => {
  const { coordinator, host } = await openFixture(t);
  await host.createPlaylistWithItems({
    playlistId: 'occurrences',
    name: 'Occurrences',
    createdAt: 1,
    items: [
      { trackUid: 'track-2' },
      { unresolved: { basename: 'missing.flac', relativePathHint: 'missing.flac' } },
      { trackUid: 'track-2' },
      { trackUid: 'track-4' }
    ]
  });
  const context = await host.createContext({
    endpoint: 'tracks',
    query: '',
    sort: 'title',
    direction: 'asc',
    scope: { playlistId: 'occurrences' }
  });
  const page = await host.readContextPage({ contextToken: context.contextToken, cursor: null, limit: 10 });
  assert.deepEqual(page.rows.map(row => row.trackUid), ['track-2', null, 'track-2', 'track-4']);

  const allReceipt = await coordinator.start(createRequest(context.contextToken, {
    clientRequestId: 'playlist-occurrences-all',
    selectionDescriptor: { mode: 'all', contextToken: context.contextToken, exclusions: [] }
  }));
  const allTerminal = await waitForTerminal(coordinator, allReceipt.operationId);
  assert.equal(allReceipt.kind, 'started');
  assert.deepEqual(
    await readSequenceTrackUids(host, allTerminal.result.sequenceId),
    ['track-2', 'track-2', 'track-4']
  );

  const explicitIds = [page.rows[3].playlistItemKey, page.rows[2].playlistItemKey];
  const explicitReceipt = await coordinator.start(createRequest(context.contextToken, {
    clientRequestId: 'playlist-occurrences-explicit',
    expectedTargetVersion: 1,
    selectionDescriptor: {
      mode: 'explicit',
      contextToken: context.contextToken,
      trackUids: explicitIds
    }
  }));
  const explicitTerminal = await waitForTerminal(coordinator, explicitReceipt.operationId);
  assert.equal(explicitReceipt.kind, 'started');
  assert.deepEqual(
    await readSequenceTrackUids(host, explicitTerminal.result.sequenceId),
    ['track-4', 'track-2']
  );
});

test('playback materialization retains its context until the complete logical selection is built', async t => {
  let resumeRead;
  let signalReadStarted;
  const readStarted = new Promise(resolve => { signalReadStarted = resolve; });
  const readGate = new Promise(resolve => { resumeRead = resolve; });
  let blocked = false;
  let retainCalls = 0;
  let releaseCalls = 0;
  const { coordinator, host } = await openFixture(t, {
    repositoryFactory: catalogHost => new Proxy(catalogHost, {
      get(target, property) {
        if (property === 'retainContext') {
          return async contextToken => {
            retainCalls += 1;
            return target.retainContext(contextToken);
          };
        }
        if (property === 'releaseRetainedContext') {
          return async contextToken => {
            releaseCalls += 1;
            return target.releaseRetainedContext(contextToken);
          };
        }
        if (property === 'readContextPage') {
          return async options => {
            if (!blocked) {
              blocked = true;
              signalReadStarted();
              await readGate;
            }
            return target.readContextPage(options);
          };
        }
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      }
    })
  });
  const { contextToken } = await createTrackContext(host);
  const receipt = await coordinator.start(createRequest(contextToken));
  await readStarted;
  assert.deepEqual(await host.releaseContext(contextToken), { released: true, retained: true });
  resumeRead();
  const terminal = await waitForTerminal(coordinator, receipt.operationId);
  assert.equal(terminal.state, 'succeeded');
  assert.deepEqual(await readSequenceTrackUids(host, terminal.result.sequenceId), [
    'track-1', 'track-2', 'track-3', 'track-4', 'track-5', 'track-6'
  ]);
  assert.equal(retainCalls, 1);
  assert.equal(releaseCalls, 1);
  await assert.rejects(
    host.readContextPage({ contextToken, cursor: null, limit: 1 }),
    error => error?.code === 'STALE_CURSOR'
  );
});

test('failed playback materialization releases its context retention', async t => {
  let retainCalls = 0;
  let releaseCalls = 0;
  const { coordinator, host } = await openFixture(t, {
    repositoryFactory: catalogHost => new Proxy(catalogHost, {
      get(target, property) {
        if (property === 'retainContext') {
          return async contextToken => {
            retainCalls += 1;
            return target.retainContext(contextToken);
          };
        }
        if (property === 'releaseRetainedContext') {
          return async contextToken => {
            releaseCalls += 1;
            return target.releaseRetainedContext(contextToken);
          };
        }
        if (property === 'readContextPage') {
          return async () => {
            const error = new Error('Forced context read failure');
            error.code = 'forcedReadFailure';
            throw error;
          };
        }
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      }
    })
  });
  const { contextToken } = await createTrackContext(host);
  const receipt = await coordinator.start(createRequest(contextToken));
  const terminal = await waitForTerminal(coordinator, receipt.operationId);
  assert.equal(terminal.state, 'failed');
  assert.equal(terminal.code, 'forcedReadFailure');
  assert.equal(retainCalls, 1);
  assert.equal(releaseCalls, 1);
  assert.deepEqual(await host.releaseContext(contextToken), { released: true });
});

test('play returns a stable provisional entry and cancellation stops the session operation', async t => {
  let releaseSeal;
  const sealGate = new Promise(resolve => { releaseSeal = resolve; });
  let retainCalls = 0;
  let releaseCalls = 0;
  const { coordinator, host } = await openFixture(t, {
    repositoryFactory: catalogHost => new Proxy(catalogHost, {
      get(target, property) {
        if (property === 'retainContext') {
          return async contextToken => {
            retainCalls += 1;
            return target.retainContext(contextToken);
          };
        }
        if (property === 'releaseRetainedContext') {
          return async contextToken => {
            releaseCalls += 1;
            return target.releaseRetainedContext(contextToken);
          };
        }
        if (property === 'sealPlaybackSequence') {
          return async options => {
            await sealGate;
            return target.sealPlaybackSequence(options);
          };
        }
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      }
    })
  });
  const { contextToken } = await createTrackContext(host);
  const request = createRequest(contextToken, {
    operationKind: 'play',
    selectionDescriptor: { mode: 'all', contextToken, exclusions: [] }
  });
  const first = await coordinator.start(request);
  assert.equal(first.kind, 'started');
  const provisionalEntry = await coordinator.getProvisionalEntry(first.operationId);
  assert.equal(provisionalEntry.trackUid, 'track-1');
  assert.equal(provisionalEntry.ordinal, 0);
  assert.deepEqual(await host.releaseContext(contextToken), { released: true, retained: true });
  const cancelled = await coordinator.cancel(first.operationId);
  assert.equal(cancelled.kind, 'cancelRequested');
  releaseSeal();
  const terminal = await waitForTerminal(coordinator, first.operationId);
  assert.equal(terminal.state, 'cancelled');
  assert.equal(retainCalls, 1);
  assert.equal(releaseCalls, 1);
  await assert.rejects(
    host.readContextPage({ contextToken, cursor: null, limit: 1 }),
    error => error?.code === 'STALE_CURSOR'
  );
  assert.equal((await coordinator.cancel(first.operationId)).kind, 'tooLate');
});

test('play publishes a session sequence with the exact provisional entry contract', async t => {
  const { coordinator, host } = await openFixture(t);
  const { contextToken } = await createTrackContext(host);
  const request = createRequest(contextToken, {
    operationKind: 'play',
    selectionDescriptor: { mode: 'explicit', contextToken, trackUids: ['track-2', 'track-3'] },
    options: { currentOrdinal: 1 }
  });
  const receipt = await coordinator.start(request);
  const provisionalEntry = await coordinator.getProvisionalEntry(receipt.operationId);
  assert.deepEqual(Object.keys(provisionalEntry).sort(), [
    'album', 'albumArtist', 'artist', 'artworkId', 'entryInstanceId',
    'ordinal', 'title', 'trackUid'
  ]);
  assert.equal(provisionalEntry.trackUid, 'track-3');
  assert.equal(provisionalEntry.ordinal, 1);
  assert.equal(provisionalEntry.title, 'Track 3');
  assert.equal(provisionalEntry.artist, 'Artist');
  assert.equal(provisionalEntry.albumArtist, 'Artist');
  assert.equal(provisionalEntry.album, 'Album');
  assert.equal(provisionalEntry.artworkId, null);
  const terminal = await waitForTerminal(coordinator, receipt.operationId);
  assert.equal(terminal.state, 'succeeded');
  assert.deepEqual(terminal.result.firstEntry, provisionalEntry);
  assert.equal(terminal.result.destination, 'replace');
  assert.equal(terminal.result.itemCount, 2);
  assert.equal(terminal.result.firstOrdinal, 1);
  assert.deepEqual(Object.keys(terminal.result).sort(), [
    'destination', 'firstEntry', 'firstOrdinal', 'itemCount',
    'operationKind', 'sequenceId', 'shuffleSeed'
  ]);
  const page = await host.queryPlaybackSequence({
    sequenceId: terminal.result.sequenceId,
    ordinal: 0,
    limit: 2
  });
  assert.equal(page.items[1].entryInstanceId, provisionalEntry.entryInstanceId);
  assert.deepEqual(page.items.map(item => item.trackUid), ['track-2', 'track-3']);
});

test('Electron session playback retains bounded terminal handoffs without evicting active operations', async t => {
  class StubDurableLibraryService {
    status() { return null; }
    waitForTerminal() { return null; }
    cancel() { return Promise.resolve({ kind: 'tooLate' }); }
  }
  const gates = new Map();
  const terminalEvents = [];
  const coordinator = new LibraryServiceCoordinator({
    repository: {
      readContextPage() {},
      retainContext() { return Promise.resolve({ retained: true }); },
      releaseRetainedContext() { return Promise.resolve({ released: true }); }
    },
    DurableLibraryService: StubDurableLibraryService,
    validateBulkOperationStart: request => request,
    now: (() => { let value = 0; return () => ++value; })()
  });
  t.after(() => coordinator.dispose());
  coordinator.on('event', event => {
    if (event.kind === 'terminal') terminalEvents.push(event.operationId);
  });
  coordinator.handlePlaybackOperation = async ({ operationId, request }) => {
    if (request.selectionDescriptor.contextToken.startsWith('hold-')) {
      await new Promise(resolve => gates.set(operationId, resolve));
    }
    const firstEntry = Object.freeze({
      ordinal: 0,
      entryInstanceId: `entry-${operationId}`,
      trackUid: `track-${operationId}`
    });
    coordinator.resolveProvisional(operationId, firstEntry);
    return {
      operationKind: request.operationKind,
      destination: 'replace',
      sequenceId: `sequence-${operationId}`,
      itemCount: 1,
      firstOrdinal: 0,
      firstEntry,
      shuffleSeed: 0
    };
  };
  const start = contextToken => coordinator.start({
    operationKind: 'play',
    selectionDescriptor: { mode: 'all', contextToken, exclusions: [] },
    target: { transport: 'main' },
    options: { currentOrdinal: 0 }
  });

  let firstTerminalId;
  let latestTerminalId;
  for (let index = 0; index < 130; index += 1) {
    const receipt = await start(`terminal-${index}`);
    firstTerminalId ??= receipt.operationId;
    latestTerminalId = receipt.operationId;
    await coordinator.waitForTerminal(receipt.operationId);
  }
  assert.equal(coordinator.playbackOperations.size, 128);
  assert.equal(coordinator.provisionals.size, 128);
  assert.equal(await coordinator.status(firstTerminalId), null);
  assert.equal((await coordinator.status(latestTerminalId)).result.state, 'succeeded');
  assert.equal((await coordinator.getProvisionalEntry(latestTerminalId)).ordinal, 0);

  const active = [];
  terminalEvents.length = 0;
  for (let index = 0; index < 129; index += 1) active.push(await start(`hold-${index}`));
  assert.equal(
    [...coordinator.playbackOperations.values()].filter(operation => operation.finishedAt === null).length,
    129
  );
  assert.notEqual(await coordinator.status(active[0].operationId), null);
  const terminalPromises = active.map(receipt => coordinator.waitForTerminal(receipt.operationId));
  for (const resolve of gates.values()) resolve();
  await Promise.all(terminalPromises);
  assert.equal(coordinator.playbackOperations.size, 128);
  const latestActiveTerminalId = terminalEvents.at(-1);
  assert.equal((await coordinator.status(latestActiveTerminalId)).result.state, 'succeeded');
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
  const terminal = await waitForTerminal(coordinator, receipt.operationId);
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
  const terminal = await waitForTerminal(coordinator, receipt.operationId);
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
  assert.ok(detailPage.totalCount === entryCount || detailPage.totalCount?.pending === true);
  assert.equal((await host.getContextCount({ contextToken: detailPage.contextToken })).totalCount, entryCount);
  assert.ok(detailPage.rows.some(row => row.trackUid === 'track-1' && row.metadataStatus !== 'unresolved'));
  assert.equal(detailPage.rows[0].playlistVersion, 1);
  assert.ok(Number.isSafeInteger(detailPage.rows[0].itemKey));
});

test('manual playlist import remains hidden until preview commit and cancel releases its lease', async t => {
  const bytes = Buffer.from('#EXTM3U\nAlbum/Track-1.flac\nMissing/Unknown.flac\n');
  const sources = new Map([
    ['preview-commit-grant', bytes],
    ['preview-cancel-grant', bytes]
  ]);
  const { coordinator, host } = await openFixture(t, {
    importSourceProvider: {
      async consumePlaylistImportGrant(source) {
        const content = sources.get(source.token);
        assert.ok(content);
        sources.delete(source.token);
        return {
          name: source.name,
          stream: () => (async function* stream() { yield content; })()
        };
      }
    }
  });
  const source = token => ({
    kind: 'electron-import-grant', token, name: 'Preview.m3u8',
    size: bytes.length, lastModified: 123, type: ''
  });

  const preview = await coordinator.previewPlaylistImport({
    clientRequestId: 'preview-commit-request',
    playlistId: 'preview-commit-playlist',
    name: 'Preview commit',
    source: source('preview-commit-grant'),
    encoding: null,
    limits: null
  });
  assert.equal(preview.playlistName, 'Preview commit');
  assert.equal(preview.totalCount, 2);
  assert.equal(preview.resolvedCount, 1);
  assert.equal(preview.unresolvedCount, 1);
  assert.deepEqual(preview.unresolvedItems, [{ label: 'Unknown.flac' }]);
  await assert.rejects(
    host.queryPlaylistItems({ playlistId: 'preview-commit-playlist', limit: 10 }),
    error => error.code === 'playlistNotFound'
  );
  const { contextToken } = await createTrackContext(host);
  const playbackReceipt = await coordinator.start(createRequest(contextToken, {
    clientRequestId: 'playback-during-preview',
    operationKind: 'queue',
    expectedTargetVersion: 0
  }));
  assert.equal(playbackReceipt.kind, 'started');
  assert.equal((await waitForTerminal(coordinator, playbackReceipt.operationId)).state, 'succeeded');

  const committed = await coordinator.commitPlaylistImportPreview({
    previewToken: preview.previewToken,
    playlistId: preview.playlistId
  });
  assert.deepEqual(committed, {
    playlistId: 'preview-commit-playlist', version: 1, itemCount: 2,
    resolvedCount: 1, unresolvedCount: 1
  });
  assert.deepEqual(await coordinator.commitPlaylistImportPreview({
    previewToken: preview.previewToken,
    playlistId: preview.playlistId
  }), committed);

  const cancelledPreview = await coordinator.previewPlaylistImport({
    clientRequestId: 'preview-cancel-request',
    playlistId: 'preview-cancel-playlist',
    name: 'Preview cancel',
    source: source('preview-cancel-grant'),
    encoding: null,
    limits: null
  });
  assert.deepEqual(await coordinator.cancelPlaylistImportPreview({
    previewToken: cancelledPreview.previewToken,
    playlistId: cancelledPreview.playlistId
  }), { kind: 'cancelled' });
  await assert.rejects(
    host.queryPlaylistItems({ playlistId: 'preview-cancel-playlist', limit: 10 }),
    error => error.code === 'playlistNotFound'
  );
});

test('expired playlist import preview is cancelled without publication', async t => {
  let clock = 1_000;
  const bytes = Buffer.from('#EXTM3U\nAlbum/Track-1.flac\n');
  const { coordinator, host } = await openFixture(t, {
    now: () => clock,
    importSourceProvider: {
      async consumePlaylistImportGrant() {
        return {
          name: 'Expires.m3u8',
          stream: () => (async function* stream() { yield bytes; })()
        };
      }
    }
  });
  const preview = await coordinator.previewPlaylistImport({
    clientRequestId: 'preview-expiry-request',
    playlistId: 'preview-expiry-playlist',
    name: 'Expiring preview',
    source: {
      kind: 'electron-import-grant', token: 'expiry-grant', name: 'Expires.m3u8',
      size: bytes.length, lastModified: 1, type: ''
    },
    encoding: null,
    limits: null
  });
  clock += 11 * 60 * 1000;
  await assert.rejects(
    coordinator.commitPlaylistImportPreview({
      previewToken: preview.previewToken,
      playlistId: preview.playlistId
    }),
    error => error.code === 'playlistImportPreviewExpired'
  );
  await assert.rejects(
    host.queryPlaylistItems({ playlistId: preview.playlistId, limit: 10 }),
    error => error.code === 'playlistNotFound'
  );
});

test('playback resolution never falls back to the raw catalog repository path resolver', async t => {
  const { coordinator, host } = await openFixture(t);
  let rawResolverCalls = 0;
  host.resolvePlaybackSource = async () => {
    rawResolverCalls += 1;
    return { kind: 'electron-file', path: path.resolve('Music', 'unsafe.flac') };
  };

  await assert.rejects(
    coordinator.resolveSequenceEntrySource({ trackUid: 'track-1' }),
    error => error?.code === 'playbackSourceBoundaryUnavailable'
  );
  assert.equal(rawResolverCalls, 0);
});

test('playback resolution returns the grant-aware absolute path without a post-await identity payload', async t => {
  const playbackPath = path.resolve('Music', 'Track.flac');
  const resolverCalls = [];
  const { coordinator, host } = await openFixture(t, {
    importSourceProvider: {
      async resolvePlaybackSource(...args) {
        resolverCalls.push(args);
        return {
          kind: 'electron-file', trackUid: args[0], folderId: 'folder-music',
          lifecycleVersion: 0, path: playbackPath
        };
      }
    }
  });
  await host.createPlaybackSequence({
    sequenceId: 'absolute-path-sequence', sourceContext: 'test', catalogVersion: 0,
    seed: null, createdAt: 100
  });
  await host.appendPlaybackSequenceItems({
    sequenceId: 'absolute-path-sequence',
    items: [{ ordinal: 0, trackUid: 'track-1', entryInstanceId: 'absolute-path-entry' }]
  });
  await host.sealPlaybackSequence({
    sequenceId: 'absolute-path-sequence', itemCount: 1, currentOrdinal: 0, sealedAt: 101
  });
  const source = await coordinator.resolveSequenceEntrySource({
    sequenceId: 'absolute-path-sequence', ordinal: 0, entryInstanceId: 'absolute-path-entry'
  });

  assert.equal(source.path, playbackPath);
  assert.equal(path.isAbsolute(source.path), true);
  assert.equal(Object.hasOwn(source, 'mediaUrl'), false);
  assert.deepEqual(resolverCalls, [['track-1']]);
});

test('IPC exposes session operation tracking and grant-verified playback paths without transport history', async () => {
  const ipcMain = createFakeIpcMain();
  const coordinator = new EventEmitter();
  coordinator.start = async request => ({ method: 'start', request });
  coordinator.status = async value => ({ method: 'status', value });
  coordinator.cancel = async value => ({ method: 'cancel', value });
  coordinator.readSequencePage = async value => ({ method: 'readSequencePage', value });
  const playbackPath = path.resolve('Music', 'track.flac');
  coordinator.resolveSequenceEntrySource = async value => ({
    kind: 'electron-file',
    trackUid: value.trackUid,
    folderId: 'folder-1',
    lifecycleVersion: 2,
    path: playbackPath
  });
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
  assert.equal(Object.hasOwn(LIBRARY_SERVICE_CHANNELS, 'lookupResult'), false);
  assert.equal(Object.hasOwn(LIBRARY_PLAYBACK_CHANNELS, 'applyTransportUndo'), false);
  const sourceRequest = { trackUid: 'track-1' };
  assert.deepEqual(
    await ipcMain.handlers.get(LIBRARY_PLAYBACK_CHANNELS.resolveSequenceEntrySource)(
      { sender: webContents },
      sourceRequest
    ),
    {
      kind: 'electron-file',
      trackUid: 'track-1',
      folderId: 'folder-1',
      lifecycleVersion: 2,
      path: playbackPath,
      fileName: 'track.flac'
    }
  );
  coordinator.emit('event', { kind: 'progress', progress: { operationId: 'op', processed: 1 } });
  assert.deepEqual(sends, [[
    LIBRARY_SERVICE_EVENT_CHANNEL,
    { kind: 'progress', progress: { operationId: 'op', processed: 1 } }
  ]]);
  dispose();
  assert.equal(ipcMain.handlers.size, 0);
});

test('playback source IPC preserves the folder permission envelope', async t => {
  const ipcMain = createFakeIpcMain();
  const coordinator = new EventEmitter();
  coordinator.start = async () => ({ kind: 'inactive' });
  coordinator.resolveSequenceEntrySource = async () => {
    const error = new Error('permission required');
    error.code = 'folderPermissionRequired';
    error.details = { folderId: 'folder-1', lifecycleVersion: 7 };
    throw error;
  };
  const webContents = { isDestroyed: () => false, send() {} };
  const dispose = registerLibraryServiceIpc({
    ipcMain,
    coordinator,
    getMainWindow: () => ({ isDestroyed: () => false, webContents })
  });
  t.after(dispose);

  const envelope = await ipcMain.handlers.get(LIBRARY_PLAYBACK_CHANNELS.resolveSequenceEntrySource)(
    { sender: webContents },
    { trackUid: 'track-1' }
  );
  assert.deepEqual(envelope, {
    code: 'folderPermissionRequired',
    details: { folderId: 'folder-1', lifecycleVersion: 7 }
  });
});

function createFakeIpcMain() {
  return {
    handlers: new Map(),
    handle(channel, handler) { this.handlers.set(channel, handler); },
    removeHandler(channel) { this.handlers.delete(channel); }
  };
}
