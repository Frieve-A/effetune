'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  LIBRARY_CATALOG_FOLDER_REMOVAL_EVENT_CHANNEL,
  LIBRARY_CATALOG_INVALIDATION_CHANNEL,
  LIBRARY_CATALOG_CONTROL_CHANNELS,
  LIBRARY_CATALOG_RENDERER_CHANNELS,
  LibraryCatalogHost,
  LibraryCatalogLifecycle,
  registerLibraryCatalogControlIpc
} = require('../../electron/library-catalog-host.cjs');
const {
  LIBRARY_SERVICE_CHANNELS,
  LIBRARY_SERVICE_EVENT_CHANNEL,
  LIBRARY_PLAYBACK_CHANNELS
} = require('../../electron/library-service-coordinator.cjs');
const { loadFreshModule, withModuleLoadStub } = require('../helpers/cjs-module-utils.cjs');

class FakeCatalogHost extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.closed = false;
  }

  request(command, payload = {}) {
    this.calls.push([command, payload]);
    return Promise.resolve({ command, payload });
  }

  getCapabilities() {
    return this.request('getCapabilities');
  }

  createContext(request) {
    return this.request('createContext', request);
  }

  queryTracks(request) {
    return this.request('queryTracks', request);
  }

  queryEntities(request) {
    return this.request('queryEntities', request);
  }

  readContextPageAtOrdinal(request) {
    return this.request('readContextPageAtOrdinal', request);
  }

  async close() {
    this.closed = true;
  }
}

function createIpcMain() {
  const handlers = new Map();
  const removed = [];
  return {
    handlers,
    removed,
    handle(channel, handler) {
      assert.equal(handlers.has(channel), false, `duplicate handler ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
      removed.push(channel);
    }
  };
}

function createMainWindow() {
  const sends = [];
  const webContents = {
    sends,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    send(...args) {
      sends.push(args);
    }
  };
  return {
    webContents,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    }
  };
}

function createShell() {
  const shownPaths = [];
  return {
    shownPaths,
    showItemInFolder(filePath) {
      shownPaths.push(filePath);
    }
  };
}

test('catalog lifecycle opens one canonical profile host and registers only bounded renderer reads', async () => {
  const ipcMain = createIpcMain();
  const mainWindow = createMainWindow();
  const host = new FakeCatalogHost();
  const calls = [];
  const userDataPath = path.join(os.tmpdir(), 'effetune-profile');
  const lifecycle = new LibraryCatalogLifecycle({
    hostFactory: async options => {
      calls.push(['open', options]);
      return host;
    },
    makeDirectory: directory => calls.push(['mkdir', directory])
  });

  const [first, second] = await Promise.all([
    lifecycle.open({ userDataPath, ipcMain, getMainWindow: () => mainWindow }),
    lifecycle.open({ userDataPath, ipcMain, getMainWindow: () => mainWindow })
  ]);
  assert.equal(first, host);
  assert.equal(second, host);
  assert.equal(lifecycle.getHost(), host);
  assert.deepEqual(calls, [
    ['mkdir', path.join(userDataPath, 'music-library-v2')],
    ['open', { dbPath: path.join(userDataPath, 'music-library-v2', 'catalog.sqlite') }]
  ]);
  assert.deepEqual([...ipcMain.handlers.keys()].sort(), Object.values(LIBRARY_CATALOG_RENDERER_CHANNELS).sort());
  assert.ok([...ipcMain.handlers.keys()].every(channel => !/upsert|insert|mutation|scan/i.test(channel)));

  await lifecycle.close();
  assert.equal(host.closed, true);
  assert.equal(lifecycle.getHost(), null);
  assert.equal(ipcMain.handlers.size, 0);
});

test('catalog IPC rejects stale senders, forwards worker-validated payloads, and strips invalidation rows', async () => {
  const ipcMain = createIpcMain();
  const mainWindow = createMainWindow();
  const host = new FakeCatalogHost();
  const lifecycle = new LibraryCatalogLifecycle({
    hostFactory: async () => host,
    makeDirectory() {}
  });
  await lifecycle.open({
    userDataPath: path.join(os.tmpdir(), 'effetune-profile-ipc'),
    ipcMain,
    getMainWindow: () => mainWindow
  });
  const senderEvent = { sender: mainWindow.webContents };
  const query = { query: 'café', sort: 'title', direction: 'asc', scope: null, limit: 200 };
  const result = await ipcMain.handlers.get(LIBRARY_CATALOG_RENDERER_CHANNELS.queryTracks)(senderEvent, query);
  assert.deepEqual(result, { command: 'queryTracks', payload: query });
  assert.equal(host.calls.at(-1)[1], query);

  assert.throws(
    () => ipcMain.handlers.get(LIBRARY_CATALOG_RENDERER_CHANNELS.getCounts)({ sender: {} }, {}),
    error => error?.code === 'unauthorizedCatalogSender'
  );
  mainWindow.destroyed = true;
  assert.throws(
    () => ipcMain.handlers.get(LIBRARY_CATALOG_RENDERER_CHANNELS.getCounts)(senderEvent, {}),
    error => error?.code === 'unauthorizedCatalogSender'
  );
  mainWindow.destroyed = false;

  host.emit('invalidation', {
    catalogVersion: 7,
    changedScopes: ['tracks'],
    scopeVersions: { tracks: 4 },
    counts: { tracks: 1000001 },
    rows: [{ path: 'must-not-leak' }],
    dbPath: 'must-not-leak'
  });
  assert.deepEqual(mainWindow.webContents.sends, [[
    LIBRARY_CATALOG_INVALIDATION_CHANNEL,
    {
      catalogVersion: 7,
      changedScopes: ['tracks'],
      scopeVersions: { tracks: 4 },
      counts: { tracks: 1000001 }
    }
  ]]);
  await lifecycle.close();
});

test('catalog control IPC relays bounded folder removal progress', () => {
  const ipcMain = createIpcMain();
  const mainWindow = createMainWindow();
  const runtime = new EventEmitter();
  runtime.scanFolders = async () => ({ accepted: true });
  const dispose = registerLibraryCatalogControlIpc({
    ipcMain,
    runtime,
    shell: createShell(),
    getMainWindow: () => mainWindow
  });
  const progress = {
    folderId: 'folder-one', phase: 'removing', deleted: 4, total: 12,
    remaining: 8, terminal: false
  };

  runtime.emit('folder-removal-event', progress);
  assert.deepEqual(mainWindow.webContents.sends, [[
    LIBRARY_CATALOG_FOLDER_REMOVAL_EVENT_CHANNEL,
    progress
  ]]);

  dispose();
  assert.equal(runtime.listenerCount('folder-removal-event'), 0);
});

test('catalog control IPC resolves playback and shows folders only through the grant-aware runtime', async t => {
  const ipcMain = createIpcMain();
  const mainWindow = createMainWindow();
  const runtime = new EventEmitter();
  runtime.scanFolders = async () => ({ accepted: true });
  const playbackPath = path.resolve('Music', 'Track # 100%.flac');
  runtime.resolvePlaybackSource = async trackUid => ({
    kind: 'electron-file',
    trackUid,
    folderId: 'folder-1',
    lifecycleVersion: 5,
    path: playbackPath
  });
  const shell = createShell();
  const dispose = registerLibraryCatalogControlIpc({
    ipcMain,
    runtime,
    shell,
    getMainWindow: () => mainWindow
  });
  t.after(dispose);
  const senderEvent = { sender: mainWindow.webContents };
  const handler = ipcMain.handlers.get(LIBRARY_CATALOG_CONTROL_CHANNELS.resolvePlaybackSource);

  assert.deepEqual(await handler(senderEvent, { trackUid: 'track-1' }), {
    kind: 'electron-file',
    trackUid: 'track-1',
    folderId: 'folder-1',
    lifecycleVersion: 5,
    path: playbackPath
  });
  const showHandler = ipcMain.handlers.get(LIBRARY_CATALOG_CONTROL_CHANNELS.showTrackInFolder);
  assert.deepEqual(await showHandler(senderEvent, { trackUid: 'track-1' }), { success: true });
  assert.deepEqual(shell.shownPaths, [playbackPath]);
  await assert.rejects(
    handler(senderEvent, { trackUid: 'track-1', path: playbackPath }),
    error => error?.code === 'invalidRequest'
  );
  await assert.rejects(
    showHandler(senderEvent, { trackUid: 'track-1', path: playbackPath }),
    error => error?.code === 'invalidRequest'
  );

  runtime.resolvePlaybackSource = async () => {
    const error = new Error('permission required');
    error.code = 'folderPermissionRequired';
    error.details = { folderId: 'folder-1', lifecycleVersion: 5 };
    throw error;
  };
  assert.deepEqual(await handler(senderEvent, { trackUid: 'track-1' }), {
    code: 'folderPermissionRequired',
    details: { folderId: 'folder-1', lifecycleVersion: 5 }
  });
  assert.deepEqual(await showHandler(senderEvent, { trackUid: 'track-1' }), {
    code: 'folderPermissionRequired',
    details: { folderId: 'folder-1', lifecycleVersion: 5 }
  });
  assert.deepEqual(shell.shownPaths, [playbackPath]);
});

test('catalog lifecycle cleans up partial opens and permits an explicit retry', async () => {
  const ipcMain = createIpcMain();
  const mainWindow = createMainWindow();
  const host = new FakeCatalogHost();
  let attempts = 0;
  const lifecycle = new LibraryCatalogLifecycle({
    hostFactory: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('open failed'), { code: 'openFailed' });
      return host;
    },
    makeDirectory() {}
  });
  const options = {
    userDataPath: path.join(os.tmpdir(), 'effetune-profile-retry'),
    ipcMain,
    getMainWindow: () => mainWindow
  };
  await assert.rejects(lifecycle.open(options), error => error?.code === 'openFailed');
  assert.equal(lifecycle.getHost(), null);
  assert.equal(ipcMain.handlers.size, 0);
  assert.equal(await lifecycle.open(options), host);
  assert.equal(attempts, 2);
  await lifecycle.close();
});

test('catalog host close terminates an unresponsive worker within its deadline', async () => {
  class UnresponsiveWorker extends EventEmitter {
    constructor() {
      super();
      this.terminated = false;
      queueMicrotask(() => this.emit('message', {
        protocolVersion: 1,
        type: 'ready',
        ok: true,
        payload: {}
      }));
    }

    postMessage() {}

    async terminate() {
      this.terminated = true;
      return 0;
    }
  }

  const worker = new UnresponsiveWorker();
  const host = await LibraryCatalogHost.open({
    dbPath: path.resolve('unresponsive-catalog.sqlite'),
    workerFactory: () => worker
  });
  await host.close({ timeoutMs: 10 });
  assert.equal(worker.terminated, true);
  await assert.rejects(host.getCounts(), error => error?.code === 'catalogClosed');
});

test('preload exposes versioned bounded catalog and playlist wrappers', async () => {
  const exposed = {};
  const invocations = [];
  const listeners = new Map();
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, value) {
        exposed[name] = value;
      }
    },
    ipcRenderer: {
      invoke(channel, ...args) {
        invocations.push([channel, ...args]);
        return Promise.resolve({ channel, args });
      },
      on(channel, listener) {
        listeners.set(channel, listener);
      },
      removeListener(channel, listener) {
        if (listeners.get(channel) === listener) listeners.delete(channel);
      },
      send() {}
    }
  };
  const originalDocument = global.document;
  const originalWindow = global.window;
  global.document = { addEventListener() {} };
  global.window = {};
  try {
    withModuleLoadStub({ electron }, () => loadFreshModule('../../electron/preload.js'));
  } finally {
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
  }

  const api = exposed.electronAPI.libraryCatalogV1;
  assert.equal(api.apiVersion, 1);
  assert.equal(Object.hasOwn(api, 'upsertTracks'), false);
  assert.equal(Object.hasOwn(api, 'upsertFolders'), false);
  assert.equal(Object.hasOwn(api, 'request'), false);
  await api.getCapabilities();
  await api.getCounts({ catalogVersion: 3 });
  await api.createContext({ query: '' });
  await api.getContextCount({ contextToken: 'ctx' });
  await api.queryTracks({ query: '', limit: 200 });
  await api.queryEntities({ type: 'album', query: '', limit: 200 });
  await api.readContextPageAtOrdinal({ contextToken: 'ctx', ordinal: 10, limit: 200 });
  await api.resolveEntityAnchor({ contextToken: 'ctx', entityId: 'album-1' });
  await api.releaseContext('ctx');
  await api.getTrack('track');
  await api.resolvePlaylistExportSource('track');
  await api.resolvePlaybackSource('track');
  await api.showTrackInFolder('track');
  await api.createPlaylist({ playlistId: 'playlist' });
  await api.createPlaylistWithItems({ playlistId: 'playlist-with-items', items: [{ trackUid: 'track' }] });
  await api.renamePlaylist({ playlistId: 'playlist', name: 'Renamed' });
  await api.reorderPlaylistItem({ playlistId: 'playlist', itemKey: 1, target: { direction: 'up' } });
  await api.removePlaylistItem({ playlistId: 'playlist', itemKey: 1 });
  await api.duplicatePlaylist({ playlistId: 'playlist', targetPlaylistId: 'copy' });
  assert.equal(api.appendPlaylistItems, undefined);
  assert.equal(api.publishPlaylist, undefined);
  await api.queryPlaylistItems({ playlistId: 'playlist', limit: 200 });
  await api.tombstonePlaylist({ playlistId: 'playlist' });
  const expectedChannels = Object.values(LIBRARY_CATALOG_RENDERER_CHANNELS);
  expectedChannels.splice(
    expectedChannels.indexOf(LIBRARY_CATALOG_RENDERER_CHANNELS.resolvePlaylistExportSource) + 1,
    0,
    LIBRARY_CATALOG_CONTROL_CHANNELS.resolvePlaybackSource,
    LIBRARY_CATALOG_CONTROL_CHANNELS.showTrackInFolder
  );
  assert.deepEqual(invocations.map(call => call[0]), expectedChannels);
  await api.requestArtwork({ trackUid: 'track', reason: 'viewport' });
  assert.equal(invocations.at(-1)[0], 'library-catalog-v1:request-artwork');

  const events = [];
  const unsubscribe = api.onInvalidation(event => events.push(event));
  listeners.get(LIBRARY_CATALOG_INVALIDATION_CHANNEL)({}, { catalogVersion: 4 });
  assert.deepEqual(events, [{ catalogVersion: 4 }]);
  unsubscribe();
  assert.equal(listeners.has(LIBRARY_CATALOG_INVALIDATION_CHANNEL), false);
  const removalEvents = [];
  const unsubscribeRemoval = api.onFolderRemovalEvent(event => removalEvents.push(event));
  listeners.get(LIBRARY_CATALOG_FOLDER_REMOVAL_EVENT_CHANNEL)({}, {
    folderId: 'folder-one', phase: 'removing', deleted: 4, total: 12
  });
  assert.deepEqual(removalEvents, [{
    folderId: 'folder-one', phase: 'removing', deleted: 4, total: 12
  }]);
  unsubscribeRemoval();
  assert.equal(listeners.has(LIBRARY_CATALOG_FOLDER_REMOVAL_EVENT_CHANNEL), false);

  const serviceApi = exposed.electronAPI.libraryServiceV1;
  assert.equal(serviceApi.apiVersion, 1);
  assert.deepEqual(Object.keys(serviceApi).sort(), [
    'apiVersion', 'cancel', 'cancelPlaylistImportPreview', 'commitPlaylistImportPreview',
    'onEvent', 'previewPlaylistImport', 'start', 'status'
  ]);
  const serviceInvocationOffset = invocations.length;
  await serviceApi.start({ clientRequestId: 'request' });
  await serviceApi.status('operation');
  await serviceApi.cancel('operation');
  await serviceApi.previewPlaylistImport({ source: 'grant' });
  await serviceApi.commitPlaylistImportPreview({ previewToken: 'preview', playlistId: 'playlist' });
  await serviceApi.cancelPlaylistImportPreview({ previewToken: 'preview', playlistId: 'playlist' });
  assert.deepEqual(
    invocations.slice(serviceInvocationOffset).map(call => call[0]),
    Object.values(LIBRARY_SERVICE_CHANNELS)
  );
  const playbackApi = exposed.electronAPI.libraryPlaybackV1;
  assert.deepEqual(Object.keys(playbackApi).sort(), [
    'apiVersion', 'getProvisionalEntry', 'readSequencePage', 'resolveSequenceEntrySource'
  ]);
  const playbackInvocationOffset = invocations.length;
  await playbackApi.getProvisionalEntry('operation');
  await playbackApi.readSequencePage({ sequenceId: 'sequence', ordinal: 0, limit: 80 });
  await playbackApi.resolveSequenceEntrySource({ trackUid: 'track' });
  assert.deepEqual(
    invocations.slice(playbackInvocationOffset).map(call => call[0]),
    Object.values(LIBRARY_PLAYBACK_CHANNELS)
  );
  const serviceEvents = [];
  const unsubscribeService = serviceApi.onEvent(event => serviceEvents.push(event));
  listeners.get(LIBRARY_SERVICE_EVENT_CHANNEL)({}, { kind: 'terminal', operationId: 'operation' });
  assert.deepEqual(serviceEvents, [{ kind: 'terminal', operationId: 'operation' }]);
  unsubscribeService();
  assert.equal(listeners.has(LIBRARY_SERVICE_EVENT_CHANNEL), false);
});
