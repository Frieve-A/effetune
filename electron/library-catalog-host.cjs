'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const LIBRARY_CATALOG_PROTOCOL_VERSION = 1;
const LIBRARY_CATALOG_RENDERER_API_VERSION = 1;
const MAX_LIBRARY_CATALOG_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_LIBRARY_CATALOG_RESPONSE_BYTES = 1024 * 1024;
const MAX_LIBRARY_CATALOG_OUTSTANDING_REQUESTS = 16;
const LIBRARY_CATALOG_INVALIDATION_CHANNEL = 'library-catalog-v1:invalidation';
const LIBRARY_CATALOG_SCAN_EVENT_CHANNEL = 'library-catalog-v1:scan-event';
const LIBRARY_CATALOG_FOLDER_REMOVAL_EVENT_CHANNEL = 'library-catalog-v1:folder-removal-event';
const LIBRARY_CATALOG_RENDERER_CHANNELS = Object.freeze({
  getCapabilities: 'library-catalog-v1:get-capabilities',
  getCounts: 'library-catalog-v1:get-counts',
  createContext: 'library-catalog-v1:create-context',
  getContextCount: 'library-catalog-v1:get-context-count',
  queryTracks: 'library-catalog-v1:query-tracks',
  queryEntities: 'library-catalog-v1:query-entities',
  readContextPageAtOrdinal: 'library-catalog-v1:read-context-page-at-ordinal',
  resolveEntityAnchor: 'library-catalog-v1:resolve-entity-anchor',
  releaseContext: 'library-catalog-v1:release-context',
  getTrack: 'library-catalog-v1:get-track',
  resolvePlaylistExportSource: 'library-catalog-v1:resolve-playlist-export-source',
  createPlaylist: 'library-catalog-v1:create-playlist',
  createPlaylistWithItems: 'library-catalog-v1:create-playlist-with-items',
  renamePlaylist: 'library-catalog-v1:rename-playlist',
  reorderPlaylistItem: 'library-catalog-v1:reorder-playlist-item',
  removePlaylistItem: 'library-catalog-v1:remove-playlist-item',
  duplicatePlaylist: 'library-catalog-v1:duplicate-playlist',
  queryPlaylistItems: 'library-catalog-v1:query-playlist-items',
  tombstonePlaylist: 'library-catalog-v1:tombstone-playlist'
});
const LIBRARY_CATALOG_CONTROL_CHANNELS = Object.freeze({
  addFolder: 'library-catalog-v1:add-folder',
  requestFolderAccess: 'library-catalog-v1:request-folder-access',
  resolvePlaybackSource: 'library-catalog-v1:resolve-playback-source',
  showTrackInFolder: 'library-catalog-v1:show-track-in-folder',
  scanFolders: 'library-catalog-v1:scan-folders',
  cancelScan: 'library-catalog-v1:cancel-scan',
  removeFolder: 'library-catalog-v1:remove-folder',
  requestArtwork: 'library-catalog-v1:request-artwork',
  pickPlaylistImport: 'library-catalog-v1:pick-playlist-import',
  grantDroppedPlaylistImport: 'library-catalog-v1:grant-dropped-playlist-import',
});
class LibraryCatalogHost extends EventEmitter {
  constructor({
    dbPath,
    contextTtlMs,
    contextWalCapBytes,
    maxContexts,
    workerFactory = options => new Worker(path.join(__dirname, 'library-catalog-worker.cjs'), options)
  } = {}) {
    super();
    if (
      typeof dbPath !== 'string' ||
      !path.isAbsolute(dbPath) ||
      path.resolve(dbPath) !== dbPath ||
      path.normalize(dbPath) !== dbPath
    ) {
      throw createHostError('invalidDatabasePath', 'A canonical absolute catalog database path is required');
    }
    this.dbPath = dbPath;
    this.closed = false;
    this.closePromise = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.maintenanceTimer = null;
    this.maintenanceIndex = 0;
    this._worker = workerFactory({
      workerData: {
        protocolVersion: LIBRARY_CATALOG_PROTOCOL_VERSION,
        dbPath,
        contextTtlMs,
        contextWalCapBytes,
        maxContexts
      }
    });
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.ready.then(() => this.scheduleMaintenance()).catch(() => {});
    this._worker.on('message', message => this.handleMessage(message));
    this._worker.on('error', error => this.handleWorkerFailure(error));
    this._worker.on('exit', code => {
      if (!this.closed && code !== 0) {
        this.handleWorkerFailure(createHostError('workerExited', `Catalog worker exited with code ${code}`));
      } else if (!this.closed) {
        this.handleWorkerFailure(createHostError('workerExited', 'Catalog worker exited unexpectedly'));
      }
    });
  }

  static async open(options) {
    const host = new LibraryCatalogHost(options);
    await host.ready;
    return host;
  }

  async request(command, payload = {}) {
    await this.ready;
    if (this.closed) throw createHostError('catalogClosed', 'Catalog host is closed');
    if (this.pending.size >= MAX_LIBRARY_CATALOG_OUTSTANDING_REQUESTS) {
      throw createHostError('tooManyRequests', 'Catalog outstanding request limit reached');
    }
    const request = {
      protocolVersion: LIBRARY_CATALOG_PROTOCOL_VERSION,
      requestId: this.nextRequestId++,
      command,
      payload
    };
    const byteLength = measureMessageBytes(request);
    if (byteLength > MAX_LIBRARY_CATALOG_REQUEST_BYTES) {
      throw createHostError('requestTooLarge', 'Catalog request exceeds the byte limit', {
        byteLength,
        maximum: MAX_LIBRARY_CATALOG_REQUEST_BYTES
      });
    }
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject });
      try {
        this._worker.postMessage(request);
      } catch (error) {
        this.pending.delete(request.requestId);
        reject(error);
      }
    });
  }

  getCapabilities() {
    return this.request('getCapabilities');
  }

  getCounts() {
    return this.request('getCounts');
  }

  upsertFolders(folders) {
    return this.request('upsertFolders', { folders });
  }

  upsertTracks(tracks) {
    return this.request('upsertTracks', { tracks });
  }

  createContext(query) {
    return this.request('createContext', query);
  }

  getContextCount(request) {
    return this.request('getContextCount', request);
  }

  queryTracks(query) {
    return this.request('queryTracks', query);
  }

  queryEntities(query) {
    return this.request('queryEntities', query);
  }

  readContextPage(query) {
    return this.request('readContextPage', query);
  }

  readContextPageAtOrdinal(query) {
    return this.request('readContextPageAtOrdinal', query);
  }

  resolveEntityAnchor(query) {
    return this.request('resolveEntityAnchor', query);
  }

  retainContext(contextToken) {
    return this.request('retainContext', { contextToken });
  }

  releaseRetainedContext(contextToken) {
    return this.request('releaseRetainedContext', { contextToken });
  }

  releaseContext(contextToken) {
    return this.request('releaseContext', { contextToken });
  }

  getTrack(trackUid) {
    return this.request('getTrack', { trackUid });
  }

  getTrackStorageIdentity(trackUid) {
    return this.request('getTrackStorageIdentity', { trackUid });
  }

  resolvePlaylistExportSource(trackUid) {
    return this.request('resolvePlaylistExportSource', { trackUid });
  }

  getCachedArtwork(trackUid) {
    return this.request('getCachedArtwork', { trackUid });
  }

  beginArtworkUtilitySession(options) {
    return this.request('beginArtworkUtilitySession', options);
  }

  getArtworkSource(options) {
    return this.request('getArtworkSource', options);
  }

  claimArtworkSource(options) {
    return this.request('claimArtworkSource', options);
  }

  bindArtworkSourceDetails(options) {
    return this.request('bindArtworkSourceDetails', options);
  }

  preflightArtworkBatch(options) {
    return this.request('preflightArtworkBatch', options);
  }

  publishArtwork(options) {
    return this.request('publishArtwork', options);
  }

  recordArtworkFailure(options) {
    return this.request('recordArtworkFailure', options);
  }

  scheduleArtworkStagingGc(options) {
    return this.request('scheduleArtworkStagingGc', options);
  }

  evictArtworkCache(options) {
    return this.request('evictArtworkCache', options);
  }

  listScanFolders(options = {}) { return this.request('listScanFolders', options); }
  getScanFolderTrackCount(options) { return this.request('getScanFolderTrackCount', options); }
  beginScanFolder(options) { return this.request('beginScanFolder', options); }
  preflightScanBatch(options) { return this.request('preflightScanBatch', options); }
  commitScanSeenBatch(options) { return this.request('commitScanSeenBatch', options); }
  cueDirectoryStage(options) { return this.request('cueDirectoryStage', options); }
  listMetadataCandidates(options) { return this.request('listMetadataCandidates', options); }
  advanceScanMetadataCursor(options) { return this.request('advanceScanMetadataCursor', options); }
  markScanEnumerationIneligible(options) { return this.request('markScanEnumerationIneligible', options); }
  recordScanErrors(options) { return this.request('recordScanErrors', options); }
  finalizeScanEnumeration(options) { return this.request('finalizeScanEnumeration', options); }
  enqueueScanSweep(options) { return this.request('enqueueScanSweep', options); }
  runScanSweep(options) { return this.request('runScanSweep', options); }
  completeScanFolder(options) { return this.request('completeScanFolder', options); }
  completeScanFolderNoSweep(options) { return this.request('completeScanFolderNoSweep', options); }
  pauseScanFolder(options) { return this.request('pauseScanFolder', options); }
  claimMetadataParse(options) { return this.request('claimMetadataParse', options); }
  claimMetadataParseBatch(options) { return this.request('claimMetadataParseBatch', options); }
  completeMetadataParseSuccess(options) { return this.request('completeMetadataParseSuccess', options); }
  completeMetadataParseFailure(options) { return this.request('completeMetadataParseFailure', options); }
  completeMetadataParseBatch(options) { return this.request('completeMetadataParseBatch', options); }
  requeueLatestMetadata(options) { return this.request('requeueLatestMetadata', options); }
  recoverInterruptedMetadataClaims(options) { return this.request('recoverInterruptedMetadataClaims', options); }
  removeScanFolder(options) { return this.request('removeScanFolder', options); }

  receiveOperation(request) {
    return this.request('receiveOperation', request);
  }

  getOperationStatus(operationId) {
    return this.request('getOperationStatus', { operationId });
  }

  requestOperationCancel(operationId, { requestedAt }) {
    return this.request('requestOperationCancel', { operationId, requestedAt });
  }

  transitionOperation(operationId, phase, { updatedAt }) {
    return this.request('transitionOperation', { operationId, phase, updatedAt });
  }

  recordOperationProgress(operationId, progress) {
    return this.request('recordOperationProgress', { operationId, progress });
  }

  completeOperation(operationId, result) {
    return this.request('completeOperation', { operationId, result });
  }

  gcTerminalOperations(options) {
    return this.request('gcTerminalOperations', options);
  }

  createOperationSnapshot(options) {
    return this.request('createOperationSnapshot', options);
  }

  appendOperationSnapshotItems(options) {
    return this.request('appendOperationSnapshotItems', options);
  }

  sealOperationSnapshot(options) {
    return this.request('sealOperationSnapshot', options);
  }

  queryOperationSnapshot(options) {
    return this.request('queryOperationSnapshot', options);
  }

  createPlaybackSequence(options) {
    return this.request('createPlaybackSequence', options);
  }

  appendPlaybackSequenceItems(options) {
    return this.request('appendPlaybackSequenceItems', options);
  }

  sealPlaybackSequence(options) {
    return this.request('sealPlaybackSequence', options);
  }

  queryPlaybackSequence(options) {
    return this.request('queryPlaybackSequence', options);
  }

  queryTransportDescriptorPage(options) {
    return this.request('queryTransportDescriptorPage', options);
  }

  gcOperationSnapshots(limit) {
    return this.request('gcOperationSnapshots', { limit });
  }

  createPlaylist(options) {
    return this.request('createPlaylist', options);
  }

  createPlaylistWithItems(options) {
    return this.request('createPlaylistWithItems', options);
  }

  renamePlaylist(options) {
    return this.request('renamePlaylist', options);
  }

  reorderPlaylistItem(options) {
    return this.request('reorderPlaylistItem', options);
  }

  removePlaylistItem(options) {
    return this.request('removePlaylistItem', options);
  }

  duplicatePlaylist(options) {
    return this.request('duplicatePlaylist', options);
  }

  prepareSequencePlaylistSave(options) {
    return this.request('prepareSequencePlaylistSave', options);
  }

  getAutomaticPlaylistImportState(options) {
    return this.request('getAutomaticPlaylistImportState', options);
  }

  prepareAutomaticPlaylistImport(options) {
    return this.request('prepareAutomaticPlaylistImport', options);
  }

  appendSequencePlaylistPage(options) {
    return this.request('appendSequencePlaylistPage', options);
  }

  appendPlaylistItems(options) {
    return this.request('appendPlaylistItems', options);
  }

  appendPlaylistImportRecords(options) {
    return this.request('appendPlaylistImportRecords', options);
  }

  finalizePlaylistImportPage(options) {
    return this.request('finalizePlaylistImportPage', options);
  }

  publishPlaylist(options) {
    return this.request('publishPlaylist', options);
  }

  queryPlaylistItems(options) {
    return this.request('queryPlaylistItems', options);
  }

  tombstonePlaylist(options) {
    return this.request('tombstonePlaylist', options);
  }

  cleanupPlaylistItems(limit) {
    return this.request('cleanupPlaylistItems', { limit });
  }

  gcPlaylistItems(limit) {
    return this.request('gcPlaylistItems', { limit });
  }

  scheduleMaintenance(delay = 30_000) {
    if (this.closed || this.maintenanceTimer) return;
    this.maintenanceTimer = setTimeout(async () => {
      this.maintenanceTimer = null;
      const jobs = [
        () => this.cleanupPlaylistItems(500),
        () => this.gcPlaylistItems(500),
        () => this.gcOperationSnapshots(500),
        () => this.gcTerminalOperations({ finishedBefore: Date.now() - 7 * 24 * 60 * 60 * 1000, limit: 100 })
      ];
      try {
        const result = await jobs[this.maintenanceIndex % jobs.length]();
        this.maintenanceIndex += 1;
        this.scheduleMaintenance(result?.hasMore === true ? 0 : 30_000);
      } catch {
        this.scheduleMaintenance(30_000);
      }
    }, delay);
    this.maintenanceTimer.unref?.();
  }

  close({ timeoutMs = 2000 } = {}) {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.closeWithin(timeoutMs);
    return this.closePromise;
  }

  async closeWithin(timeoutMs) {
    if (this.closed) return;
    let timeoutId;
    try {
      await Promise.race([
        this.request('close'),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(createHostError('catalogCloseTimeout', 'Catalog worker close timed out'));
          }, timeoutMs);
        })
      ]);
    } catch (error) {
      if (error && error.code !== 'catalogCloseTimeout' && error.code !== 'catalogClosed') throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (this.maintenanceTimer) clearTimeout(this.maintenanceTimer);
      this.maintenanceTimer = null;
      this.closed = true;
      await this._worker.terminate();
      this.rejectAll(createHostError('catalogClosed', 'Catalog host is closed'));
    }
  }

  handleMessage(message) {
    if (!message || message.protocolVersion !== LIBRARY_CATALOG_PROTOCOL_VERSION) {
      this.handleWorkerFailure(createHostError('protocolMismatch', 'Catalog worker protocol mismatch'));
      return;
    }
    if (message.type === 'ready') {
      if (message.ok === false) {
        const error = deserializeWorkerError(message.error);
        this.rejectReady(error);
        this.rejectAll(error);
      } else {
        this.resolveReady(message.payload);
      }
      return;
    }
    if (message.type === 'invalidation') {
      this.emit('invalidation', message.payload);
      return;
    }
    if (message.type !== 'response') return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    const byteLength = measureMessageBytes(message);
    if (byteLength > MAX_LIBRARY_CATALOG_RESPONSE_BYTES) {
      pending.reject(createHostError('responseTooLarge', 'Catalog response exceeds the byte limit', {
        byteLength,
        maximum: MAX_LIBRARY_CATALOG_RESPONSE_BYTES
      }));
      return;
    }
    if (message.ok) {
      pending.resolve(message.payload);
    } else {
      pending.reject(deserializeWorkerError(message.error));
    }
  }

  handleWorkerFailure(error) {
    this.emit('failure', error);
    this.rejectReady(error);
    this.rejectAll(error);
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

class LibraryCatalogLifecycle {
  constructor({
    hostFactory = options => LibraryCatalogHost.open(options),
    makeDirectory = directory => fs.mkdirSync(directory, { recursive: true })
  } = {}) {
    this.hostFactory = hostFactory;
    this.makeDirectory = makeDirectory;
    this.host = null;
    this.openPromise = null;
    this.closePromise = null;
    this.disposeIpc = null;
  }

  open({ userDataPath, ipcMain, getMainWindow }) {
    if (this.host) return Promise.resolve(this.host);
    if (this.openPromise) return this.openPromise;
    if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
      return Promise.reject(createHostError('invalidUserDataPath', 'A canonical user data path is required'));
    }
    this.openPromise = this.openCatalog({ userDataPath, ipcMain, getMainWindow });
    return this.openPromise;
  }

  async openCatalog({ userDataPath, ipcMain, getMainWindow }) {
    const directory = path.resolve(userDataPath, 'music-library-v3');
    const dbPath = path.join(directory, 'catalog.sqlite');
    this.makeDirectory(directory);
    let host;
    try {
      host = await this.hostFactory({ dbPath });
      this.disposeIpc = registerLibraryCatalogIpc({ ipcMain, host, getMainWindow });
      this.host = host;
      return host;
    } catch (error) {
      if (host) await host.close().catch(() => {});
      this.openPromise = null;
      throw error;
    }
  }

  getHost() {
    return this.host;
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.closeCatalog();
    return this.closePromise;
  }

  async closeCatalog() {
    this.disposeIpc?.();
    this.disposeIpc = null;
    const host = this.host;
    this.host = null;
    this.openPromise = null;
    if (host) await host.close();
  }
}

function registerLibraryCatalogIpc({ ipcMain, host, getMainWindow }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function') {
    throw createHostError('invalidIpcAdapter', 'Catalog IPC adapter is invalid');
  }
  if (!host || typeof host.request !== 'function' || typeof getMainWindow !== 'function') {
    throw createHostError('invalidIpcAdapter', 'Catalog IPC dependencies are invalid');
  }
  const handlers = {
    getCapabilities: (_event, request = {}) => {
      assertEmptyRendererRequest(request);
      return host.getCapabilities();
    },
    getCounts: (_event, request = {}) => host.request('getCounts', request),
    createContext: (_event, request) => host.createContext(request),
    getContextCount: (_event, request) => host.getContextCount(request),
    queryTracks: (_event, request) => host.queryTracks(request),
    queryEntities: (_event, request) => host.queryEntities(request),
    readContextPageAtOrdinal: (_event, request) => host.readContextPageAtOrdinal(request),
    resolveEntityAnchor: (_event, request) => host.resolveEntityAnchor(request),
    releaseContext: (_event, request) => host.request('releaseContext', request),
    getTrack: (_event, request) => host.request('getTrack', request),
    resolvePlaylistExportSource: (_event, request) => host.request('resolvePlaylistExportSource', request),
    createPlaylist: (_event, request) => host.createPlaylist(request),
    createPlaylistWithItems: (_event, request) => host.createPlaylistWithItems(request),
    renamePlaylist: (_event, request) => host.renamePlaylist(request),
    reorderPlaylistItem: (_event, request) => host.reorderPlaylistItem(request),
    removePlaylistItem: (_event, request) => host.removePlaylistItem(request),
    duplicatePlaylist: (_event, request) => host.duplicatePlaylist(request),
    queryPlaylistItems: (_event, request) => host.queryPlaylistItems(request),
    tombstonePlaylist: (_event, request) => host.tombstonePlaylist(request)
  };
  const registeredChannels = [];
  try {
    for (const [method, channel] of Object.entries(LIBRARY_CATALOG_RENDERER_CHANNELS)) {
      ipcMain.handle(channel, (event, request) => {
        assertCurrentMainWindowSender(event, getMainWindow);
        return handlers[method](event, request);
      });
      registeredChannels.push(channel);
    }
  } catch (error) {
    for (const channel of registeredChannels) ipcMain.removeHandler(channel);
    throw error;
  }

  const relayInvalidation = invalidation => {
    const mainWindow = getMainWindow();
    if (!isUsableMainWindow(mainWindow)) return;
    mainWindow.webContents.send(LIBRARY_CATALOG_INVALIDATION_CHANNEL, {
      catalogVersion: invalidation.catalogVersion,
      changedScopes: invalidation.changedScopes,
      scopeVersions: invalidation.scopeVersions,
      counts: invalidation.counts
    });
  };
  host.on('invalidation', relayInvalidation);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    host.removeListener('invalidation', relayInvalidation);
    for (const channel of registeredChannels) ipcMain.removeHandler(channel);
  };
}

function registerLibraryCatalogControlIpc({ ipcMain, runtime, shell, getMainWindow }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function') {
    throw createHostError('invalidIpcAdapter', 'Catalog control IPC adapter is invalid');
  }
  if (!runtime || typeof runtime.scanFolders !== 'function' ||
      typeof shell?.showItemInFolder !== 'function' || typeof getMainWindow !== 'function') {
    throw createHostError('invalidIpcAdapter', 'Catalog control dependencies are invalid');
  }
  const resolvePlaybackSource = async request => {
    assertTrackUidRendererRequest(request);
    try {
      return publicCatalogPlaybackSource(await runtime.resolvePlaybackSource(request.trackUid));
    } catch (error) {
      if (error?.code === 'folderPermissionRequired') return publicCatalogFolderPermissionError(error);
      throw error;
    }
  };
  const handlers = {
    addFolder: request => runtime.addFolder(request),
    requestFolderAccess: request => runtime.requestFolderAccess(request),
    resolvePlaybackSource,
    showTrackInFolder: async request => {
      const source = await resolvePlaybackSource(request);
      if (source?.code === 'folderPermissionRequired') return source;
      try {
        shell.showItemInFolder(source.path);
      } catch {
        throw createHostError('showInFolderFailed', 'Unable to show the track in its folder');
      }
      return { success: true };
    },
    scanFolders: request => runtime.scanFolders(request),
    cancelScan: request => runtime.cancelScan(request),
    removeFolder: request => runtime.removeFolder(request),
    requestArtwork: request => runtime.requestArtwork(request),
    pickPlaylistImport: request => runtime.pickPlaylistImport(request),
    grantDroppedPlaylistImport: request => runtime.grantDroppedPlaylistImport(request)
  };
  const registeredChannels = [];
  try {
    for (const [method, channel] of Object.entries(LIBRARY_CATALOG_CONTROL_CHANNELS)) {
      ipcMain.handle(channel, (event, request) => {
        assertCurrentMainWindowSender(event, getMainWindow);
        return handlers[method](request);
      });
      registeredChannels.push(channel);
    }
  } catch (error) {
    for (const channel of registeredChannels) ipcMain.removeHandler(channel);
    throw error;
  }

  const relayScanEvent = event => {
    const mainWindow = getMainWindow();
    if (!isUsableMainWindow(mainWindow)) return;
    mainWindow.webContents.send(LIBRARY_CATALOG_SCAN_EVENT_CHANNEL, event);
  };
  runtime.on('scan-event', relayScanEvent);
  const relayFolderRemovalEvent = event => {
    const mainWindow = getMainWindow();
    if (!isUsableMainWindow(mainWindow)) return;
    mainWindow.webContents.send(LIBRARY_CATALOG_FOLDER_REMOVAL_EVENT_CHANNEL, event);
  };
  runtime.on('folder-removal-event', relayFolderRemovalEvent);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    runtime.removeListener('scan-event', relayScanEvent);
    runtime.removeListener('folder-removal-event', relayFolderRemovalEvent);
    for (const channel of registeredChannels) ipcMain.removeHandler(channel);
  };
}

function assertCurrentMainWindowSender(event, getMainWindow) {
  const mainWindow = getMainWindow();
  if (!isUsableMainWindow(mainWindow) || !event || event.sender !== mainWindow.webContents) {
    throw createHostError('unauthorizedCatalogSender', 'Catalog request sender is not authorized');
  }
}

function isUsableMainWindow(mainWindow) {
  return Boolean(
    mainWindow &&
    typeof mainWindow.isDestroyed === 'function' &&
    !mainWindow.isDestroyed() &&
    mainWindow.webContents &&
    (typeof mainWindow.webContents.isDestroyed !== 'function' || !mainWindow.webContents.isDestroyed())
  );
}

function assertEmptyRendererRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).length !== 0) {
    throw createHostError('invalidRequest', 'Catalog capabilities request must be empty');
  }
}

function assertTrackUidRendererRequest(request) {
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    Object.keys(request).length !== 1 ||
    typeof request.trackUid !== 'string' ||
    request.trackUid.length === 0 ||
    request.trackUid.length > 512
  ) {
    throw createHostError('invalidRequest', 'Catalog playback source request is invalid');
  }
}

function publicCatalogPlaybackSource(source) {
  const sourcePath = source?.path;
  if (source?.kind !== 'electron-file' || typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
    throw createHostError('sourceUnavailable', 'Track source is unavailable');
  }
  const publicSource = { ...source };
  delete publicSource.mediaUrl;
  return publicSource;
}

function publicCatalogFolderPermissionError(error) {
  const folderId = typeof error?.details?.folderId === 'string'
    ? error.details.folderId.slice(0, 512)
    : '';
  const lifecycleVersion = Number(error?.details?.lifecycleVersion);
  if (!folderId || !Number.isSafeInteger(lifecycleVersion) || lifecycleVersion < 0) {
    throw createHostError('sourceUnavailable', 'Track source is unavailable');
  }
  return { code: 'folderPermissionRequired', details: { folderId, lifecycleVersion } };
}

function measureMessageBytes(value) {
  let json;
  let binaryBytes = 0;
  try {
    json = JSON.stringify(value, (_key, item) => {
      if (ArrayBuffer.isView(item)) {
        binaryBytes += item.byteLength;
        return { binaryByteLength: item.byteLength };
      }
      if (item instanceof ArrayBuffer) {
        binaryBytes += item.byteLength;
        return { binaryByteLength: item.byteLength };
      }
      return item;
    });
  } catch (error) {
    throw createHostError('unserializableRequest', 'Catalog message is not serializable', {
      cause: error && error.message ? error.message : String(error)
    });
  }
  if (json === undefined) throw createHostError('unserializableRequest', 'Catalog message is not serializable');
  return Buffer.byteLength(json, 'utf8') + binaryBytes;
}

function deserializeWorkerError(payload = {}) {
  return createHostError(payload.code || 'catalogError', payload.message || 'Catalog worker request failed', payload.details || {});
}

function createHostError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'LibraryCatalogError';
  error.code = code;
  error.details = details;
  return error;
}

module.exports = {
  LIBRARY_CATALOG_PROTOCOL_VERSION,
  LIBRARY_CATALOG_RENDERER_API_VERSION,
  LIBRARY_CATALOG_INVALIDATION_CHANNEL,
  LIBRARY_CATALOG_SCAN_EVENT_CHANNEL,
  LIBRARY_CATALOG_FOLDER_REMOVAL_EVENT_CHANNEL,
  LIBRARY_CATALOG_RENDERER_CHANNELS,
  LIBRARY_CATALOG_CONTROL_CHANNELS,
  LibraryCatalogHost,
  LibraryCatalogLifecycle,
  MAX_LIBRARY_CATALOG_OUTSTANDING_REQUESTS,
  MAX_LIBRARY_CATALOG_REQUEST_BYTES,
  MAX_LIBRARY_CATALOG_RESPONSE_BYTES,
  registerLibraryCatalogIpc,
  registerLibraryCatalogControlIpc
};
