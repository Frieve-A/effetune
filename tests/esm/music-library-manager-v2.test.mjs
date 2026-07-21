import assert from 'node:assert/strict';
import test from 'node:test';

import { LibraryManagerV2 } from '../../js/library/library-manager-v2.js';
import { createProductionCatalogClient } from '../../js/library/repository/catalog-client-factory.js';

function invalidation(version, scope, count) {
  return {
    catalogVersion: version,
    changedScopes: [scope],
    scopeVersions: { [scope]: version },
    counts: { [scope]: count }
  };
}

function createClient(overrides = {}) {
  const calls = [];
  let invalidationListener = null;
  const client = {
    async getCounts(request) {
      calls.push(['getCounts', request]);
      return { tracks: 1_000_001 };
    },
    async createContext(request) {
      calls.push(['createContext', request]);
      return `context-${calls.filter(call => call[0] === 'createContext').length}`;
    },
    async queryTracks(request) {
      calls.push(['queryTracks', request]);
      return { rows: [{ trackUid: 'track-1' }], nextCursor: null, previousCursor: null };
    },
    async browseFolderChildren(request) {
      calls.push(['browseFolderChildren', request]);
      return { children: [], hasMore: false, cursor: null, nodeExists: true };
    },
    async queryEntities(request) {
      calls.push(['queryEntities', request]);
      return { rows: [{ albumKey: 'album-1' }], nextCursor: null, previousCursor: null };
    },
    async releaseContext(contextToken) {
      calls.push(['releaseContext', contextToken]);
    },
    async getTrack(trackUid) {
      calls.push(['getTrack', trackUid]);
      return { trackUid };
    },
    subscribeInvalidations(listener) {
      invalidationListener = listener;
      return () => calls.push(['unsubscribeInvalidations']);
    },
    async close() {
      calls.push(['close']);
    },
    ...overrides
  };
  return {
    client,
    calls,
    emitInvalidation(event) {
      invalidationListener?.(event);
    }
  };
}

function createManager(client, options = {}) {
  return new LibraryManagerV2({
    catalogClientFactory: async () => ({
      client,
      runtime: options.runtime ?? 'web',
      capabilities: options.capabilities ?? {}
    }),
    ...options
  });
}

test('production catalog factory prefers the existing Electron host without opening Web', async () => {
  const calls = [];
  const api = { apiVersion: 1 };
  const serviceApi = { apiVersion: 1 };
  const playbackApi = { apiVersion: 1 };
  const serviceClient = { start() {} };
  const result = await createProductionCatalogClient({
    windowRef: { electronAPI: { libraryCatalogV1: api, libraryServiceV1: serviceApi, libraryPlaybackV1: playbackApi } },
    electronClientFactory(options) {
      calls.push(['electron', options]);
      return {
        async getCapabilities() {
          calls.push(['capabilities']);
          return { protocolVersion: 1 };
        }
      };
    },
    electronServiceClientFactory(options) {
      calls.push(['service', options]);
      return serviceClient;
    },
    webClientFactory() {
      calls.push(['web']);
      throw new Error('Web must not be selected');
    }
  });

  assert.equal(result.runtime, 'electron');
  assert.equal(Object.hasOwn(result, 'productionQualified'), false);
  assert.equal(result.bulkOperationService, serviceClient);
  assert.deepEqual(calls, [
    ['electron', { api }],
    ['service', { api: serviceApi, playbackApi }],
    ['capabilities']
  ]);
});

test('production catalog factory never falls back to IndexedDB in Electron', async () => {
  let webFactoryCalls = 0;
  await assert.rejects(
    createProductionCatalogClient({
      windowRef: {
        electronAPI: { getAppVersion() {} },
        navigator: { userAgent: 'Mozilla/5.0 Electron/40.0.0' }
      },
      webClientFactory() {
        webFactoryCalls += 1;
        throw new Error('Web must not be selected in Electron');
      }
    }),
    error => error?.code === 'electronCatalogUnavailable'
  );
  assert.equal(webFactoryCalls, 0);
});

test('production catalog factory opens the dedicated Web v3 repository readwrite', async () => {
  const calls = [];
  const client = {
    async open(options) {
      calls.push(['open', options]);
      return { schemaVersion: 3 };
    },
    async getCapabilities() {
      calls.push(['capabilities']);
      return { schemaVersion: 3 };
    },
    async close() {
      calls.push(['close']);
    }
  };
  const result = await createProductionCatalogClient({
    windowRef: {},
    webClientFactory: () => client
  });

  assert.equal(result.runtime, 'web');
  assert.equal(Object.hasOwn(result, 'productionQualified'), false);
  assert.equal(result.bulkOperationService, client);
  assert.deepEqual(calls, [
    ['open', { mode: 'readwrite', expectedSchemaVersion: 3 }],
    ['capabilities']
  ]);
});

test('LibraryManagerV2 initializes without a full count and serves the first bounded Tracks page', async () => {
  const harness = createClient();
  const manager = createManager(harness.client);

  assert.equal(await manager.init(), manager);
  assert.equal(harness.calls.some(call => call[0] === 'getCounts'), false);
  assert.equal(Object.hasOwn(manager.getRuntimeStatus(), 'productionQualified'), false);
  const contextToken = await manager.createContext({
    endpoint: 'tracks',
    query: '',
    sort: 'title',
    direction: 'asc',
    scope: null
  });
  const page = await manager.queryTracks({ contextToken, limit: 200 });

  assert.equal(page.rows[0].trackUid, 'track-1');
  assert.deepEqual(harness.calls.find(call => call[0] === 'createContext')[1], {
    endpoint: 'tracks',
    query: '',
    sort: 'title',
    direction: 'asc',
    scope: null
  });
});

test('LibraryManagerV2 forwards bounded physical folder browse requests', async () => {
  const harness = createClient();
  const manager = createManager(harness.client);
  await manager.init();
  const request = { folderId: 'folder-1', path: '音楽', cursor: null, limit: 200 };

  assert.deepEqual(await manager.browseFolderChildren(request), {
    children: [], hasMore: false, cursor: null, nodeExists: true
  });
  assert.deepEqual(harness.calls.at(-1), ['browseFolderChildren', request]);
});

test('LibraryManagerV2 requests bounded lazy artwork and releases its URL cache on close', async () => {
  const harness = createClient({
    async requestArtwork(request) {
      harness.calls.push(['requestArtwork', request]);
      return {
        kind: 'thumbnail',
        bytes: new Uint8Array([1, 2, 3]),
        width: 1,
        height: 1,
        mimeType: 'image/jpeg'
      };
    }
  });
  const urlCalls = [];
  const manager = createManager(harness.client, {
    windowRef: {
      Blob,
      URL: {
        createObjectURL(blob) {
          urlCalls.push(['create', blob.type, blob.size]);
          return 'blob:artwork-1';
        },
        revokeObjectURL(url) {
          urlCalls.push(['revoke', url]);
        }
      }
    }
  });
  await manager.init();

  assert.equal(await manager.getArtworkThumbURL('track-1', { reason: 'now-playing' }), 'blob:artwork-1');
  assert.equal(await manager.getArtworkThumbURL('track-1', { reason: 'viewport' }), 'blob:artwork-1');
  assert.deepEqual(harness.calls.filter(call => call[0] === 'requestArtwork'), [[
    'requestArtwork',
    { trackUid: 'track-1', reason: 'now-playing' }
  ]]);
  assert.deepEqual(urlCalls, [['create', 'image/jpeg', 3]]);

  harness.emitInvalidation(invalidation(2, 'tracks', 2));
  assert.deepEqual(urlCalls.at(-1), ['revoke', 'blob:artwork-1']);
  await manager.close();
  assert.deepEqual(urlCalls.at(-1), ['revoke', 'blob:artwork-1']);
});

test('LibraryManagerV2 closes a client that fails contract validation', async () => {
  let closed = 0;
  const manager = createManager({
    async close() {
      closed += 1;
    }
  });

  await assert.rejects(manager.init(), error => error.code === 'catalogContractMismatch');
  assert.equal(closed, 1);
});

test('LibraryManagerV2 normalizes entity contexts and delegates queryEntities', async () => {
  const harness = createClient();
  const manager = createManager(harness.client);
  await manager.init();
  const contextToken = await manager.createContext({
    endpoint: 'entities',
    entityType: 'album',
    sort: 'name',
    direction: 'desc'
  });
  await manager.queryEntities({ type: 'album', contextToken, limit: 50 });
  await manager.createContext({
    endpoint: 'entities',
    entityType: 'playlist',
    sort: 'name',
    direction: 'asc',
    includeSystemPlaylists: true
  });

  assert.deepEqual(harness.calls.find(call => call[0] === 'createContext')[1], {
    endpoint: 'entities:album',
    query: '',
    sort: 'name',
    direction: 'desc',
    scope: null
  });
  assert.deepEqual(harness.calls.find(call => call[0] === 'queryEntities')[1], {
    type: 'album',
    contextToken,
    limit: 50
  });
  assert.deepEqual(harness.calls.filter(call => call[0] === 'createContext')[1][1], {
    endpoint: 'entities:playlist',
    query: '',
    sort: 'name',
    direction: 'asc',
    scope: null,
    includeSystemPlaylists: true
  });
});

test('LibraryManagerV2 requires queryEntities instead of a generic page compatibility fallback', async () => {
  const harness = createClient({
    queryEntities: undefined,
    async readContextPage() {
      assert.fail('legacy generic page reads must not satisfy the manager contract');
    }
  });
  const manager = createManager(harness.client);

  await assert.rejects(
    manager.init(),
    error => error.code === 'catalogContractMismatch' && error.details?.method === 'queryEntities'
  );
  assert.equal(harness.calls.filter(call => call[0] === 'close').length, 1);
});

test('LibraryManagerV2 delegates ordinal reads and Electron track actions when supported', async () => {
  const harness = createClient({
    async readContextPageAtOrdinal(request) {
      harness.calls.push(['readContextPageAtOrdinal', request]);
      return { rows: [{ trackUid: 'track-9' }] };
    },
    async resolvePlaybackSource(trackUid) {
      harness.calls.push(['resolvePlaybackSource', trackUid]);
      return { kind: 'file', token: 'source-token' };
    },
    async showTrackInFolder(trackUid) {
      harness.calls.push(['showTrackInFolder', trackUid]);
      return { success: true };
    }
  });
  const manager = createManager(harness.client, { runtime: 'electron' });
  await manager.init();

  assert.equal((await manager.readContextPageAtOrdinal({
    contextToken: 'context-1',
    ordinal: 900,
    limit: 50
  })).rows[0].trackUid, 'track-9');
  assert.deepEqual(await manager.resolvePlaybackSource('track-9'), {
    kind: 'file',
    token: 'source-token'
  });
  assert.deepEqual(await manager.showTrackInFolder('track-9'), { success: true });
  assert.deepEqual(harness.calls.at(-1), ['showTrackInFolder', 'track-9']);
});

test('LibraryManagerV2 publishes page starts for cursor and canonical ordinal chunks', async () => {
  const harness = createClient({
    async createContext(request) {
      harness.calls.push(['createContext', request]);
      return { contextToken: 'context-pages', totalCount: 1001 };
    },
    async queryTracks(request) {
      harness.calls.push(['queryTracks', request]);
      return request.cursor
        ? { rows: [{ trackUid: 'track-201' }], nextCursor: null, previousCursor: 'before', totalCount: 1001 }
        : {
            rows: Array.from({ length: 200 }, (_, index) => ({ trackUid: `track-${index + 1}` })),
            nextCursor: 'after-200',
            previousCursor: null,
            totalCount: 1001
          };
    },
    async readContextPageAtOrdinal() {
      return {
        rows: [{ trackUid: 'track-1000' }],
        nextCursor: null,
        previousCursor: 'before-end',
        totalCount: 1001,
        catalogVersion: 7
      };
    }
  });
  const manager = createManager(harness.client, { runtime: 'electron' });
  await manager.init();
  const contextToken = await manager.createContext({ endpoint: 'tracks' });

  const first = await manager.queryTracks({ contextToken, cursor: null, limit: 200 });
  const second = await manager.queryTracks({ contextToken, cursor: first.nextCursor, limit: 200 });
  const end = await manager.readContextPageAtOrdinal({ contextToken, ordinal: 1000, limit: 200 });

  assert.equal(first.pageStartOrdinal, 0);
  assert.equal(second.pageStartOrdinal, 200);
  assert.equal(end.pageStartOrdinal, 1000);
});

test('LibraryManagerV2 coalesces invalidations and emits bounded view events', async () => {
  const queued = [];
  const harness = createClient();
  const manager = createManager(harness.client, {
    queueMicrotaskFn: callback => queued.push(callback)
  });
  const events = [];
  manager.addListener('catalog-changed', event => events.push(['catalog', event]));
  manager.addListener('folders-changed', event => events.push(['folders', event]));
  await manager.init();

  harness.emitInvalidation(invalidation(2, 'tracks', 20));
  harness.emitInvalidation(invalidation(3, 'folders', 4));
  harness.emitInvalidation({
    catalogVersion: 4,
    changedScopes: ['artwork'],
    scopeVersions: { artwork: 1 },
    counts: {}
  });
  assert.equal(queued.length, 1);
  queued.shift()();

  assert.equal(events.length, 2);
  assert.deepEqual(events[0][1], {
    catalogVersion: 4,
    changedScopes: ['tracks', 'folders', 'artwork'],
    scopeVersions: { tracks: 2, folders: 3, artwork: 1 },
    counts: { tracks: 20, folders: 4 }
  });
});

test('LibraryManagerV2 schedules invalidations through the native global receiver', async () => {
  const originalQueueMicrotask = globalThis.queueMicrotask;
  const queued = [];
  globalThis.queueMicrotask = function queueMicrotaskWithReceiver(callback) {
    assert.equal(this, globalThis);
    queued.push(callback);
  };
  try {
    const harness = createClient();
    const manager = createManager(harness.client);
    const events = [];
    manager.addListener('catalog-changed', event => events.push(event));
    await manager.init();

    harness.emitInvalidation(invalidation(2, 'tracks', 20));
    assert.equal(queued.length, 1);
    queued.shift()();
    assert.equal(events.length, 1);
  } finally {
    globalThis.queueMicrotask = originalQueueMicrotask;
  }
});

test('LibraryManagerV2 publishes and releases Electron and Web scan progress subscriptions', async () => {
  let electronListener;
  let folderRemovalListener;
  let electronUnsubscribed = false;
  let folderRemovalUnsubscribed = false;
  const electronHarness = createClient({
    subscribeScanEvents(listener) {
      electronListener = listener;
      return () => { electronUnsubscribed = true; };
    },
    subscribeFolderRemovalEvents(listener) {
      folderRemovalListener = listener;
      return () => { folderRemovalUnsubscribed = true; };
    }
  });
  const warningLogs = [];
  const electronManager = createManager(electronHarness.client, {
    runtime: 'electron',
    logger: {
      warn(...args) { warningLogs.push(args); },
      error() {}
    }
  });
  const electronStates = [];
  const folderRemovalStates = [];
  electronManager.addListener('scan-state', state => electronStates.push(state));
  electronManager.addListener('folder-removal-state', state => folderRemovalStates.push(state));
  await electronManager.init();
  electronListener({
    scanId: 'scan-electron', folderIds: ['folder-electron'], active: true, status: 'running',
    progress: { folderId: 'folder-electron', status: 'metadata', counts: { found: 20, parsed: 7 } }
  });
  electronListener({
    scanId: 'scan-electron', active: false, terminal: true, status: 'completed',
    results: [
      {
        counts: { found: 10, parsed: 10 },
        warnings: [{
          category: 'cue-invalid', count: 2,
          samples: [{ code: 'cue-missing-reference', path: 'Disc One.cue' }]
        }]
      },
      {
        counts: { found: 10, parsed: 10 },
        warnings: [
          { category: 'cue-invalid', count: 1, samples: [] },
          {
            category: 'cue-too-large', count: 1,
            samples: [{ code: 'cue-too-large', path: 'Disc Two.cue' }]
          }
        ]
      }
    ]
  });
  assert.equal(electronStates[0].phase, 'scanning');
  assert.equal(electronStates[0].found, 20);
  assert.equal(electronStates[0].parsed, 7);
  assert.deepEqual(electronStates[0].folderIds, ['folder-electron']);
  assert.equal(electronStates[1].phase, 'done');
  assert.deepEqual(electronStates[1].warnings, [
    { category: 'cue-invalid', count: 3 },
    { category: 'cue-too-large', count: 1 }
  ]);
  assert.deepEqual(electronStates[1].results[0].warnings, [
    { category: 'cue-invalid', count: 2 }
  ]);
  assert.equal(warningLogs.length, 1);
  assert.deepEqual(warningLogs[0][1], [
    {
      category: 'cue-invalid', count: 3,
      samples: [{ code: 'cue-missing-reference', path: 'Disc One.cue' }]
    },
    {
      category: 'cue-too-large', count: 1,
      samples: [{ code: 'cue-too-large', path: 'Disc Two.cue' }]
    }
  ]);
  folderRemovalListener({
    folderId: 'folder-one', phase: 'removing', deleted: 7, total: 20
  });
  assert.deepEqual(folderRemovalStates, [{
    folderId: 'folder-one', phase: 'removing', deleted: 7, total: 20,
    remaining: 13, terminal: false
  }]);
  await electronManager.close();
  assert.equal(electronUnsubscribed, true);
  assert.equal(folderRemovalUnsubscribed, true);

  let webListener;
  let webFolderRemovalListener;
  let webFolderRemovalUnsubscribed = false;
  const webHarness = createClient({
    subscribeScanProgress(listener) {
      webListener = listener;
      return () => {};
    },
    subscribeFolderRemovalEvents(listener) {
      webFolderRemovalListener = listener;
      return () => { webFolderRemovalUnsubscribed = true; };
    }
  });
  const webManager = createManager(webHarness.client, { runtime: 'web' });
  const webStates = [];
  const webFolderRemovalStates = [];
  webManager.addListener('scan-state', state => webStates.push(state));
  webManager.addListener('folder-removal-state', state => webFolderRemovalStates.push(state));
  await webManager.init();
  webListener({
    scanId: 'scan-web', folderId: 'folder-web', status: 'enumerating',
    counts: { found: 3, parsed: 1 }
  });
  assert.deepEqual(
    {
      phase: webStates[0].phase,
      folderIds: webStates[0].folderIds,
      found: webStates[0].found,
      parsed: webStates[0].parsed
    },
    { phase: 'scanning', folderIds: ['folder-web'], found: 3, parsed: 1 }
  );
  webFolderRemovalListener({
    folderId: 'folder-removed', phase: 'removing', deleted: 2, total: 5
  });
  assert.deepEqual(webFolderRemovalStates, [{
    folderId: 'folder-removed', phase: 'removing', deleted: 2, total: 5,
    remaining: 3, terminal: false
  }]);
  await webManager.close();
  assert.equal(webFolderRemovalUnsubscribed, true);
});

test('LibraryManagerV2 exposes typed unavailable results instead of legacy fallbacks', async () => {
  const harness = createClient();
  const manager = createManager(harness.client);
  await manager.init();

  await assert.rejects(manager.scanFolders(), error => error.code === 'operationUnavailable');
  await assert.rejects(
    manager.readContextPageAtOrdinal({ contextToken: 'missing', ordinal: 0, limit: 200 }),
    error => error.code === 'operationUnavailable'
  );
  await assert.rejects(
    manager.resolvePlaybackSource('track-1'),
    error => error.code === 'operationUnavailable'
  );
  assert.equal(manager.showTrackInFolder, undefined);
});

test('LibraryManagerV2 forwards current UI and browser language hints to catalog scans', async () => {
  const harness = createClient();
  const calls = [];
  const manager = createManager(harness.client, {
    uiManager: { userLanguage: 'ja', languagePreference: 'auto' },
    windowRef: {
      navigator: { language: 'ja-JP', languages: ['ja-JP', 'en-US'] }
    },
    folderService: {
      async addFolder(options) {
        calls.push(['addFolder', options]);
        return { id: 'folder-1' };
      }
    },
    scanService: {
      async scanFolders(options) {
        calls.push(['scanFolders', options]);
        return { accepted: true };
      }
    }
  });
  await manager.init();

  await manager.addFolder();
  await manager.scanFolders(['folder-1']);

  const languageHints = {
    language: 'ja',
    languagePreference: 'auto',
    browserLanguage: 'ja-JP',
    browserLanguages: ['ja-JP', 'en-US']
  };
  assert.deepEqual(calls, [
    ['addFolder', { languageHints }],
    ['scanFolders', { folderIds: ['folder-1'], languageHints }]
  ]);
});

test('LibraryManagerV2 delegates service operations and releases contexts on close', async () => {
  const harness = createClient();
  const serviceCalls = [];
  const manager = createManager(harness.client, {
    folderService: {
      async addFolder() {
        serviceCalls.push(['addFolder']);
        return { id: 'folder-1' };
      }
    },
    bulkOperationService: {
      async start(request) {
        serviceCalls.push(['start', request]);
        return { operationId: 'operation-1' };
      },
      async status(operationId) { return { operationId, phase: 'READY' }; },
      async cancel(operationId) { return { kind: 'cancelRequested', operationId }; },
      subscribeOperation(operationId, listener) {
        serviceCalls.push(['subscribe', operationId, listener]);
        return () => serviceCalls.push(['unsubscribe', operationId]);
      }
    },
    clientRequestIdFactory: () => 'request-1'
  });
  await manager.init();
  const contextToken = await manager.createContext({ endpoint: 'tracks' });

  assert.deepEqual(await manager.addFolder(), { id: 'folder-1' });
  assert.deepEqual(await manager.performSelectionAction('play', {
    mode: 'all',
    contextToken,
    exclusions: []
  }), { operationId: 'operation-1' });
  assert.equal(manager.createOperationRequestId(), 'request-1');
  assert.deepEqual(await manager.getLibraryOperationStatus('operation-1'), {
    operationId: 'operation-1', phase: 'READY'
  });
  assert.deepEqual(await manager.cancelLibraryOperation('operation-1'), {
    kind: 'cancelRequested', operationId: 'operation-1'
  });
  const unsubscribe = manager.subscribeLibraryOperation('operation-1', () => {});
  unsubscribe();
  await manager.close();

  assert.equal(harness.calls.some(call => call[0] === 'releaseContext' && call[1] === contextToken), true);
  assert.equal(harness.calls.some(call => call[0] === 'close'), true);
  assert.deepEqual(serviceCalls[1][1], {
    operationKind: 'play',
    selectionDescriptor: { mode: 'all', contextToken, exclusions: [] },
    target: {},
    options: {}
  });
});
