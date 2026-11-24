'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { registerLibraryCatalogIpc, registerLibraryCatalogControlIpc } = require('../../electron/library-catalog-host.cjs');
const { loadFreshModule, withModuleLoadStub } = require('../helpers/cjs-module-utils.cjs');

const catalogRequests = [
  ['getCapabilities', [], undefined], ['getCounts', [], {}],
  ['createContext', [{ scope: { kind: 'library' } }]],
  ['getContextCount', [{ contextToken: 'context-1' }]],
  ['queryTracks', [{ contextToken: 'context-1', limit: 20 }]],
  ['browseFolderChildren', [{ folderId: 'folder-1' }]],
  ['queryEntities', [{ entity: 'album', limit: 20 }]],
  ['readContextPageAtOrdinal', [{ contextToken: 'context-1', ordinal: 20 }]],
  ['resolveEntityAnchor', [{ contextToken: 'context-1', entityId: 'album-1' }]],
  ['releaseContext', ['context-1'], { contextToken: 'context-1' }],
  ['getTrack', ['track-1'], { trackUid: 'track-1' }],
  ['getTrackLoudness', [{ trackUid: 'track-1' }]],
  ['getLoudnessStats', [{ coverage: 95 }]],
  ['listPendingLoudness', [{ afterTrackUid: '', limit: 64 }]],
  ['saveTrackLoudness', [{ measurements: [] }]],
  ['finalizeLoudness', [{}]],
  ['resolvePlaylistExportSource', ['track-1'], { trackUid: 'track-1' }],
  ['createPlaylist', [{ name: 'New playlist' }]],
  ['createPlaylistWithItems', [{ name: 'Selection', trackUids: ['track-1', 'track-2'] }]],
  ['recordRecentlyPlayed', [{ trackUid: 'track-1' }]],
  ['setTrackFavorite', [{ trackUid: 'track-1', favorite: true }]],
  ['getFavoriteTrackUids', [], {}], ['getSystemPlaylists', [], {}],
  ['renamePlaylist', [{ playlistId: 'playlist-1', name: 'Renamed' }]],
  ['reorderPlaylistItem', [{ playlistId: 'playlist-1', itemId: 'item-1', ordinal: 2 }]],
  ['removePlaylistItem', [{ playlistId: 'playlist-1', itemId: 'item-1' }]],
  ['duplicatePlaylist', [{ playlistId: 'playlist-1', name: 'Copy' }]],
  ['queryPlaylistItems', [{ playlistId: 'playlist-1', limit: 20 }]],
  ['tombstonePlaylist', [{ playlistId: 'playlist-1' }]]
];
const controlRequests = [
  ['addFolder', [], {}],
  ['requestFolderAccess', ['folder-1', { includeVideo: true, includeMidi: true, includeMidiArchives: true }], { folderId: 'folder-1', includeVideo: true, includeMidi: true, includeMidiArchives: true }],
  ['scanFolders', [{ folderIds: ['folder-1'], scanReason: 'manual' }]],
  ['cancelScan', ['scan-1'], { scanId: 'scan-1' }],
  ['removeFolder', ['folder-1'], { folderId: 'folder-1' }],
  ['requestArtwork', [{ trackUid: 'track-1' }]],
  ['pickPlaylistImport', [], {}],
  ['grantDroppedPlaylistImport', [{ nativePath: '/selected/list.m3u', path: '/forged/secret' }], { path: '/selected/list.m3u' }]
];

function createHarness(t) {
  const handlers = new Map();
  const ipcRenderer = new EventEmitter();
  const calls = [];
  const sent = [];
  let windowDestroyed = false, contentsDestroyed = false;
  let mainWindow = {
    isDestroyed: () => windowDestroyed,
    webContents: {
      isDestroyed: () => contentsDestroyed,
      send(channel, data) { sent.push([channel, data]); ipcRenderer.emit(channel, { sender: 'private Electron event' }, data); }
    }
  };
  const sender = mainWindow.webContents;
  const host = new EventEmitter();
  const runtime = new EventEmitter();
  const record = (method, request) => { calls.push([method, request]); return Promise.resolve({ method, request }); };
  host.request = record;
  for (const [method] of catalogRequests) host[method] = request => record(method, request);
  for (const [method] of controlRequests) runtime[method] = request => record(method, request);
  const ipcMain = {
    handle(channel, callback) { assert.equal(handlers.has(channel), false); handlers.set(channel, callback); },
    removeHandler(channel) { handlers.delete(channel); }
  };
  const disposeCatalog = registerLibraryCatalogIpc({ ipcMain, host, getMainWindow: () => mainWindow });
  const disposeControl = registerLibraryCatalogControlIpc({ ipcMain, runtime,
    shell: { showItemInFolder() {} }, getMainWindow: () => mainWindow });
  t.after(() => { disposeCatalog(); disposeControl(); });
  let api;
  ipcRenderer.invoke = async (channel, request) => {
    assert.equal(typeof handlers.get(channel), 'function', `Missing handler: ${channel}`);
    return handlers.get(channel)({ sender }, request);
  };
  withModuleLoadStub({ electron: {
    ipcRenderer,
    webUtils: { getPathForFile: file => file.nativePath },
    contextBridge: { exposeInMainWorld(name, value) { if (name === 'electronAPI') api = value.libraryCatalogV1; } }
  } }, () => loadFreshModule('../../electron/preload.js'));
  return { api, host, runtime, handlers, calls, sent, sender, ipcRenderer,
    disposeCatalog, disposeControl,
    destroyWindow() { windowDestroyed = true; },
    destroyContents() { contentsDestroyed = true; },
    replaceWindow(value) { mainWindow = value; }
  };
}

test('catalog preload requests reach their registered main-process handlers with the public payload', async t => {
  const { api, calls } = createHarness(t);
  assert.equal(Object.isFrozen(api), true);
  for (const [method, args, explicitRequest] of [...catalogRequests, ...controlRequests]) {
    const request = explicitRequest ?? args[0];
    assert.deepEqual(await api[method](...args), { method, request });
    assert.deepEqual(calls.at(-1), [method, request]);
  }
  await api.requestFolderAccess('folder-2', { includeVideo: 'true', includeMidi: 'true', includeMidiArchives: 'true', path: '/untrusted' });
  assert.deepEqual(calls.at(-1), ['requestFolderAccess', { folderId: 'folder-2', includeVideo: false, includeMidi: false, includeMidiArchives: false }]);
});

test('every catalog and control handler rejects foreign senders before accessing the host', t => {
  const { handlers, calls } = createHarness(t);
  assert.equal(handlers.size, 43);
  for (const [channel, handler] of handlers) {
    for (const event of [undefined, {}, { sender: {} }]) {
      assert.throws(() => handler(event, {}), { code: 'unauthorizedCatalogSender' }, channel);
    }
  }
  assert.deepEqual(calls, []);
});

test('session IPC requires the main frame, binds the active profile and filters file rows through existing grants', async t => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const access = require('../../electron/file-access.cjs');
  const profile = require('../../electron/settings-profile.cjs');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-session-ipc-')));
  t.after(() => {
    profile.configureSettingsProfile([]);
    access.clear();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const h = createHarness(t);
  const invoke = h.handlers.get('library-catalog-v1:playback-session');
  h.sender.mainFrame = {};
  assert.throws(() => invoke({ sender: h.sender, senderFrame: {} }, { action: 'read' }), /cannot access files/);
  const event = { sender: h.sender, senderFrame: h.sender.mainFrame };
  const song = path.join(root, 'selected.mid');
  fs.writeFileSync(song, 'music');
  access.grantRead(song);
  const expectedPath = access.getGrantedReadPath(song);
  fs.unlinkSync(song);
  profile.configureSettingsProfile(['--settings-name=default']);
  const track = { path: song, byteLength: 5, meta: { title: 'Song', picture: new Uint8Array(20) } };
  const paths = [path.join(root, 'player-state.json'), 'https://example.invalid/media', path.join(root, 'other.mid')];
  assert.deepEqual(await invoke(event, { action: 'append', profileKey: 'forged', rows: [
    { ordinal: 0, track }, ...paths.map((value, i) => ({ ordinal: i + 1, track: { path: value } }))
  ] }), { excludedCount: 3 });
  const saved = h.calls.at(-1)[1];
  assert.equal(saved.profileKey, 'default');
  assert.deepEqual(saved.rows[0].track, { path: expectedPath, byteLength: 5, meta: { title: 'Song' } });
  access.clear();
  h.host.request = async () => ({ rows: saved.rows, nextOrdinal: null });
  await invoke(event, { action: 'page', startOrdinal: 0 });
  assert.equal(access.getGrantedReadPath(song), expectedPath);
});

test('catalog sender authority follows the current live main window', async t => {
  for (const state of ['window', 'contents', 'replaced', 'missing']) {
    const h = createHarness(t);
    if (state === 'window') h.destroyWindow();
    if (state === 'contents') h.destroyContents();
    if (state === 'missing') h.replaceWindow(null);
    if (state === 'replaced') h.replaceWindow({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send() {} } });
    await assert.rejects(h.api.getCounts(), { code: 'unauthorizedCatalogSender' });
    assert.deepEqual(h.calls, []);
    h.host.emit('invalidation', { catalogVersion: 1 });
    h.runtime.emit('scan-event', { status: 'scanning' });
    assert.deepEqual(h.sent, []);
  }
});

test('catalog capabilities reject unexpected renderer data', async t => {
  const h = createHarness(t);
  const handler = h.handlers.get('library-catalog-v1:get-capabilities');
  for (const request of [null, [], 'data', { path: '/outside' }]) {
    assert.throws(() => handler({ sender: h.sender }, request), { code: 'invalidRequest' });
  }
  assert.deepEqual(h.calls, []);
  await h.api.getCapabilities();
  assert.deepEqual(h.calls, [['getCapabilities', undefined]]);
});

test('tag writing accepts only the previously issued snapshot and no renderer paths', async t => {
  const h = createHarness(t);
  const event = { sender: h.sender };
  const write = h.handlers.get('library-catalog-v1:write-loudness-tags');
  assert.throws(() => write(event, { snapshotId: 'guessed', path: '/file' }), { code: 'invalidRequest' });
  assert.throws(() => write(event, { snapshotId: 'guessed', scanOptions: { folderIds: ['chosen'] } }),
    { code: 'invalidRequest' });
  assert.throws(() => write(event, { snapshotId: 'guessed', scanOptions: { languageHints: { path: '/file' } } }),
    { code: 'invalidLanguageHints' });
  await assert.rejects(write(event, { snapshotId: 'guessed' }));
  assert.throws(() => h.handlers.get('library-catalog-v1:prepare-loudness-tag-write')(event, { path: '/file' }),
    { code: 'invalidRequest' });
});

test('catalog events expose public invalidation data and unsubscribe without leaking Electron events', t => {
  const h = createHarness(t);
  const received = [];
  const offInvalidation = h.api.onInvalidation((...args) => received.push(args));
  const offScan = h.api.onScanEvent((...args) => received.push(args));
  const offRemoval = h.api.onFolderRemovalEvent((...args) => received.push(args));
  const invalidation = { catalogVersion: 2, changedScopes: ['tracks'], scopeVersions: { tracks: 2 }, counts: { tracks: 7 } };
  h.host.emit('invalidation', { ...invalidation, databasePath: '/private/catalog.sqlite' });
  h.runtime.emit('scan-event', { status: 'scanning' });
  h.runtime.emit('folder-removal-event', { status: 'complete' });
  assert.deepEqual(received, [[invalidation], [{ status: 'scanning' }], [{ status: 'complete' }]]);
  offInvalidation(); offScan(); offRemoval();
  h.host.emit('invalidation', invalidation);
  h.runtime.emit('scan-event', { status: 'done' });
  assert.equal(received.length, 3);
  h.disposeCatalog(); h.disposeControl();
  assert.equal(h.handlers.size, 0);
  assert.equal(h.host.listenerCount('invalidation'), 0);
  assert.equal(h.runtime.listenerCount('scan-event'), 0);
  assert.equal(h.runtime.listenerCount('folder-removal-event'), 0);
});

test('partial catalog IPC registration is rolled back when a channel cannot be registered', () => {
  for (const control of [false, true]) {
    const registered = new Set();
    const failure = new Error('Channel already registered');
    const ipcMain = {
      handle(channel) { if (registered.size === 2) throw failure; registered.add(channel); },
      removeHandler(channel) { registered.delete(channel); }
    };
    const register = control ? registerLibraryCatalogControlIpc : registerLibraryCatalogIpc;
    assert.throws(() => register({
      ipcMain, host: { request() {} }, runtime: { scanFolders() {} },
      shell: { showItemInFolder() {} }, getMainWindow: () => null
    }), error => error === failure);
    assert.equal(registered.size, 0);
  }
});

test('archive catalog lookup returns the path without granting raw file access', async t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const access = require('../../electron/file-access.cjs');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-archive-grant-')));
  t.after(() => { access.clear(); fs.rmSync(root, { recursive: true, force: true }); });
  const h = createHarness(t);
  for (const [kind, name] of [['archive-entry', 'scores.zip'], ['file', 'song.mid']]) {
    const sourcePath = path.join(root, name);
    fs.writeFileSync(sourcePath, 'data');
    h.runtime.resolvePlaybackSource = async () => ({ kind: 'electron-file', path: sourcePath, sourceKind: kind });
    assert.equal((await h.api.resolvePlaybackSource('track')).path, sourcePath);
    assert.equal(Boolean(access.getGrantedReadPath(sourcePath)), kind === 'file');
  }
});
