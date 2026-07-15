import sqlite3InitModule from '../../vendor/sqlite/sqlite3.mjs';
import { assertRepositoryContract, createRepositoryError, LibraryRepositoryError } from './contract-errors.js';
import {
  MUSIC_LIBRARY_SCHEMA_VERSION,
  MUSIC_LIBRARY_V2_WEB_DATABASE,
  MUSIC_LIBRARY_V2_WEB_OPFS_DIRECTORY
} from './schema-v2.js';
import { Oo1DatabaseSyncAdapter } from './sqlite-oo1-adapter.js';
import {
  dispatchWebSqliteCommand,
  initializeWebSqliteRuntime,
  updateWebSqliteStorageEstimate
} from './web-sqlite-runtime.js';

const INTERNAL_ACTIVE_STATUS = 'ok';
const INTERNAL_UNAVAILABLE_STATUS = 'offline';

export class WebSqliteCatalogRepository {
  constructor({
    authority,
    sqliteFactory = sqlite3InitModule,
    storageManager = globalThis.navigator?.storage,
    now = () => Date.now(),
    contextTtlMs,
    maxContexts,
    contextWalCapBytes,
    clearOnInit = false
  } = {}) {
    assertRepositoryContract(authority === 'worker' || authority === 'test', 'invalidAuthority', 'Direct Web repository use is restricted to the catalog Worker and tests');
    this.authority = authority;
    this.sqliteFactory = sqliteFactory;
    this.storageManager = storageManager;
    this.now = now;
    this.contextTtlMs = contextTtlMs;
    this.maxContexts = maxContexts;
    this.contextWalCapBytes = contextWalCapBytes;
    this.clearOnInit = clearOnInit;
    this.artworkUtilitySessionId = `web-artwork-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    this.sqlite3 = null;
    this.pool = null;
    this.database = null;
    this.mode = null;
    this.invalidationListeners = new Set();
  }

  async open({ mode = 'readwrite', expectedSchemaVersion = MUSIC_LIBRARY_SCHEMA_VERSION } = {}) {
    assertRepositoryContract(!this.database, 'alreadyOpen', 'Web catalog repository is already open');
    assertRepositoryContract(mode === 'readwrite' || mode === 'readonly', 'invalidOpenMode', 'Open mode must be readonly or readwrite');
    assertRepositoryContract(expectedSchemaVersion === MUSIC_LIBRARY_SCHEMA_VERSION, 'schemaVersionMismatch', 'Unexpected Web catalog schema version');
    try {
      if (this.sqliteFactory === sqlite3InitModule) configureSqliteWasmVfs();
      this.sqlite3 = await this.sqliteFactory({
        print: (...args) => console.debug('[SQLite WASM]', ...args),
        printErr: (...args) => console.error('[SQLite WASM]', ...args)
      });
      this.pool = await this.sqlite3.installOpfsSAHPoolVfs({
        directory: `/${MUSIC_LIBRARY_V2_WEB_OPFS_DIRECTORY}`,
        initialCapacity: 4,
        clearOnInit: this.clearOnInit
      });
      const rawDatabase = new this.pool.OpfsSAHPoolDb({
        filename: MUSIC_LIBRARY_V2_WEB_DATABASE,
        flags: 'c'
      });
      this.database = new Oo1DatabaseSyncAdapter(rawDatabase, this.sqlite3);
      const capabilities = await initializeWebSqliteRuntime(this.database, {
        contextTtlMs: this.contextTtlMs,
        maxContexts: this.maxContexts,
        contextWalCapBytes: this.contextWalCapBytes,
        storageManager: this.storageManager,
        onEvent: event => this.#handleRuntimeEvent(event)
      });
      dispatchWebSqliteCommand('beginArtworkUtilitySession', {
        utilitySessionId: this.artworkUtilitySessionId
      });
      if (mode === 'readonly') this.database.exec('PRAGMA query_only = ON');
      this.mode = mode;
      return {
        databaseName: MUSIC_LIBRARY_V2_WEB_DATABASE,
        opfsDirectory: MUSIC_LIBRARY_V2_WEB_OPFS_DIRECTORY,
        schemaVersion: MUSIC_LIBRARY_SCHEMA_VERSION,
        mode,
        backend: capabilities.backend
      };
    } catch (error) {
      this.#closeHandles();
      throw translateWebSqliteError(error, 'catalogOpenFailed');
    }
  }

  close() {
    if (!this.database) return;
    try {
      dispatchWebSqliteCommand('close', {});
    } catch (error) {
      console.warn('Unable to close the Web music catalog cleanly.', error);
    } finally {
      this.#closeHandles();
    }
  }

  getCapabilities() { return this.#call('getCapabilities'); }
  getCounts() { return this.#call('getCounts'); }
  getRuntimeDiagnostics() { return this.#call('getRuntimeDiagnostics'); }

  subscribeInvalidations(listener) {
    assertRepositoryContract(typeof listener === 'function', 'invalidListener', 'Invalidation listener must be a function');
    this.invalidationListeners.add(listener);
    return () => this.invalidationListeners.delete(listener);
  }

  upsertFolders(folders) {
    return this.#call('upsertFolders', { folders: folders.map(folder => ({
      id: folder.id,
      kind: folder.kind ?? 'web-fsa',
      displayName: folder.displayName,
      path: `/fsa/${encodeURIComponent(folder.id)}`,
      status: toInternalFolderStatus(folder.status),
      scanGeneration: folder.scanGeneration ?? 0,
      lifecycleVersion: folder.lifecycleVersion ?? 0,
      addedAt: folder.addedAt ?? this.now(),
      lastScanAt: folder.lastScanAt ?? null
    })) });
  }

  async listFolderRecords({ includeRemoved = false, limit = 1_000 } = {}) {
    assertRepositoryContract(Number.isSafeInteger(limit) && limit > 0 && limit <= 1_000, 'invalidLimit', 'Folder record limit must be 1..1000');
    const result = await this.#call('listScanFolders', { folderIds: null, includeRemoved });
    return result.folders.slice(0, limit).map(fromInternalFolder);
  }

  async setFolderAvailability({ folderId, status } = {}) {
    const folder = (await this.listFolderRecords({ includeRemoved: true })).find(item => item.id === folderId);
    assertRepositoryContract(folder && folder.status !== 'removed', 'unknownFolder', 'Folder does not exist');
    await this.upsertFolders([{ ...folder, status }]);
    return Object.freeze({ ...folder, status });
  }

  async tombstoneFolder({ folderId, expectedLifecycleVersion } = {}) {
    await this.#call('removeScanFolder', { folderId, expectedLifecycleVersion });
    const folder = (await this.listFolderRecords({ includeRemoved: true })).find(item => item.id === folderId);
    return { folder: Object.freeze(folder), enqueued: 1 };
  }

  runFolderDeletion({ folderId, lifecycleVersion } = {}) {
    return this.#call('removeScanFolder', {
      folderId,
      expectedLifecycleVersion: lifecycleVersion - 1
    });
  }

  async resumeFolderDeletionJobs({ limit = 1 } = {}) {
    const removed = (await this.listFolderRecords({ includeRemoved: true, limit: 1_000 }))
      .filter(folder => folder.status === 'removed')
      .slice(0, limit);
    let hasMore = false;
    for (const folder of removed) {
      const result = await this.runFolderDeletion({ folderId: folder.id, lifecycleVersion: folder.lifecycleVersion });
      hasMore ||= result.hasMore === true;
    }
    return { resumed: removed.length, hasMore };
  }

  repairInterruptedDeletionItems({ limit = 500 } = {}) {
    return this.#call('repairInterruptedDeletionItems', { limit });
  }

  receiveOperation(request = {}) { return this.#call('receiveOperation', request); }
  lookupOperationResult(clientRequestId) { return this.#call('lookupOperationResult', { clientRequestId }); }
  getOperationStatus(operationId) { return this.#call('getOperationStatus', { operationId }); }
  requestOperationCancel(operationId, { requestedAt = this.now() } = {}) { return this.#call('requestOperationCancel', { operationId, requestedAt }); }
  transitionOperation(operationId, phase, { updatedAt = this.now() } = {}) { return this.#call('transitionOperation', { operationId, phase, updatedAt }); }
  recordOperationProgress(operationId, progress) { return this.#call('recordOperationProgress', { operationId, progress }); }
  completeOperation(operationId, result) { return this.#call('completeOperation', { operationId, result }); }
  gcTerminalOperations(request) { return this.#call('gcTerminalOperations', request); }
  createOperationSnapshot(request) { return this.#call('createOperationSnapshot', request); }
  appendOperationSnapshotItems(request) { return this.#call('appendOperationSnapshotItems', request); }
  sealOperationSnapshot(request) { return this.#call('sealOperationSnapshot', request); }
  queryOperationSnapshot(request) { return this.#call('queryOperationSnapshot', request); }
  gcOperationSnapshots(limit = 500) { return this.#call('gcOperationSnapshots', { limit }); }

  createPlaybackSequence(request) { return this.#call('createPlaybackSequence', request); }
  appendPlaybackSequenceItems(request) { return this.#call('appendPlaybackSequenceItems', request); }
  sealPlaybackSequence(request) { return this.#call('sealPlaybackSequence', request); }
  publishPlaybackSequence(request) { return this.#call('publishPlaybackSequence', request); }
  publishProvisionalTransport(request) { return this.#call('publishProvisionalTransport', request); }
  publishTransportSequence(request) { return this.#call('publishTransportSequence', request); }
  applyTransportUndo(request) { return this.#call('applyTransportUndo', request); }
  getTransportState() { return this.#call('getTransportState'); }
  commitTransportState(request) { return this.#call('commitTransportState', request); }
  queryPlaybackSequence(request) { return this.#call('queryPlaybackSequence', request); }
  queryTransportSegmentPage(request) { return this.#call('queryTransportSegmentPage', request); }
  queryTransportDescriptorPage(request) { return this.#call('queryTransportDescriptorPage', request); }
  tombstonePlaybackSequence(sequenceId) { return this.#call('tombstonePlaybackSequence', { sequenceId }); }
  gcPlaybackSequences(limit = 500) { return this.#call('gcPlaybackSequences', { limit }); }

  createPlaylist(request) { return this.#call('createPlaylist', request); }
  createPlaylistWithItems(request) { return this.#call('createPlaylistWithItems', request); }
  renamePlaylist(request) { return this.#call('renamePlaylist', request); }
  removePlaylistItem(request) { return this.#call('removePlaylistItem', request); }
  reorderPlaylistItem(request) { return this.#call('reorderPlaylistItem', request); }
  duplicatePlaylist(request) { return this.#call('duplicatePlaylist', request); }
  prepareSequencePlaylistSave(request) { return this.#call('prepareSequencePlaylistSave', request); }
  appendSequencePlaylistPage(request) { return this.#call('appendSequencePlaylistPage', request); }
  appendPlaylistItems(request) { return this.#call('appendPlaylistItems', request); }
  appendPlaylistImportRecords(request) { return this.#call('appendPlaylistImportRecords', request); }
  finalizePlaylistImportPage(request) { return this.#call('finalizePlaylistImportPage', request); }
  publishPlaylist(request) { return this.#call('publishPlaylist', request); }
  queryPlaylistItems(request) { return this.#call('queryPlaylistItems', request); }
  tombstonePlaylist(request) { return this.#call('tombstonePlaylist', request); }
  cleanupPlaylistItems(limit = 500) { return this.#call('cleanupPlaylistItems', { limit }); }
  gcPlaylistItems(limit = 500) { return this.#call('gcPlaylistItems', { limit }); }

  upsertTracks(tracks) { return this.#call('upsertTracks', { tracks }); }
  deleteTracks(trackUids) { return this.#call('deleteTracks', { trackUids }); }
  upsertEntities(type, entities) { return this.#call('upsertEntities', { type, entities }); }

  beginScanFolder(request) { return this.#call('beginScanFolder', request); }
  async preflightScanBatch(request = {}) {
    await updateWebSqliteStorageEstimate(this.storageManager);
    return this.#call('preflightScanBatch', request);
  }
  commitScanSeenBatch(request) { return this.#call('commitScanSeenBatch', request); }
  listMetadataCandidates(request) { return this.#call('listMetadataCandidates', request); }
  advanceScanMetadataCursor(request) { return this.#call('advanceScanMetadataCursor', request); }
  markScanEnumerationIneligible(request) { return this.#call('markScanEnumerationIneligible', request); }
  recordScanErrors(request) { return this.#call('recordScanErrors', request); }
  finalizeScanEnumeration(request) { return this.#call('finalizeScanEnumeration', request); }
  enqueueScanSweep(request) { return this.#call('enqueueScanSweep', request); }
  runScanSweep(request) { return this.#call('runScanSweep', request); }
  completeScanFolder(request) { return this.#call('completeScanFolder', request); }
  completeScanFolderNoSweep(request) { return this.#call('completeScanFolderNoSweep', request); }
  pauseScanFolder(request) { return this.#call('pauseScanFolder', request); }
  claimMetadataParse(request) { return this.#call('claimMetadataParse', request); }
  completeMetadataParseSuccess({ metadataStatus: _metadataStatus, clearErrorAndRetryState: _clear, ...request }) { return this.#call('completeMetadataParseSuccess', request); }
  completeMetadataParseFailure({ createMinimalRecordIfNoLastKnownGood: _create, ...request }) { return this.#call('completeMetadataParseFailure', request); }
  requeueLatestMetadata(request) { return this.#call('requeueLatestMetadata', request); }
  recoverInterruptedMetadataClaims(request) { return this.#call('recoverInterruptedMetadataClaims', request); }

  getCachedArtwork({ trackUid } = {}) { return this.#call('getCachedArtwork', { trackUid }); }
  getArtworkSource({ trackUid } = {}) { return this.#call('getArtworkSource', { trackUid }); }
  beginArtworkUtilitySession({ utilitySessionId = this.artworkUtilitySessionId } = {}) {
    this.artworkUtilitySessionId = utilitySessionId;
    return this.#call('beginArtworkUtilitySession', { utilitySessionId });
  }
  claimArtworkSource({ claim } = {}) {
    return this.#call('claimArtworkSource', {
      claim: { ...claim, utilitySessionId: claim?.utilitySessionId ?? this.artworkUtilitySessionId }
    });
  }
  bindArtworkSourceDetails(request) { return this.#call('bindArtworkSourceDetails', request); }
  async preflightArtworkBatch(request = {}) {
    await updateWebSqliteStorageEstimate(this.storageManager);
    return this.#call('preflightArtworkBatch', request);
  }
  publishArtwork(request) { return this.#call('publishArtwork', request); }
  recordArtworkFailure(request) { return this.#call('recordArtworkFailure', request); }
  scheduleArtworkStagingGc(request) { return this.#call('scheduleArtworkStagingGc', request); }
  evictArtworkCache(request) { return this.#call('evictArtworkCache', request); }
  enterReadOnlyDiagnostic(request) { return this.#call('enterReadOnlyDiagnostic', request); }

  createContext(request) { return this.#call('createContext', request); }
  releaseContext(contextToken) { return this.#call('releaseContext', { contextToken }); }
  cleanupExpiredContexts() { return this.#call('cleanupExpiredContexts'); }
  cleanupExpiredContextItems(limit = 500) { return this.#call('cleanupExpiredContextItems', { limit }); }
  queryTracks(request) { return this.#call('queryTracks', request); }
  queryEntities(request) { return this.#call('queryEntities', request); }
  getContextCount(request) { return this.#call('getContextCount', request); }
  readContextPage(request) { return this.#call('readContextPage', request); }
  readContextPageAtOrdinal(request) { return this.#call('readContextPageAtOrdinal', request); }
  resolveEntityAnchor(request) { return this.#call('resolveEntityAnchor', request); }
  lookupContextTrack(request) { return this.#call('lookupContextTrack', request); }
  getTrack(trackUid) { return this.#call('getTrack', { trackUid }); }
  getTrackStorageIdentity(trackUid) { return this.#call('getTrackStorageIdentity', { trackUid }); }
  checkIntegrity(options = {}) { return this.#call('checkIntegrity', options); }

  #call(command, payload = {}) {
    assertRepositoryContract(this.database, 'catalogClosed', 'Web catalog repository is not open');
    if (this.mode === 'readonly' && !READ_COMMANDS.has(command)) {
      throw createRepositoryError('readOnlyCatalog', 'The Web catalog is open read-only');
    }
    try {
      return dispatchWebSqliteCommand(command, payload);
    } catch (error) {
      throw translateWebSqliteError(error);
    }
  }

  #handleRuntimeEvent(event) {
    if (event?.type !== 'invalidation') return;
    for (const listener of this.invalidationListeners) listener(event.payload);
  }

  #closeHandles() {
    try {
      this.database?.close();
    } catch {
      // The runtime may already have closed the database.
    }
    try {
      this.pool?.pauseVfs?.();
    } catch {
      // Worker termination releases any remaining OPFS handles.
    }
    this.database = null;
    this.pool = null;
    this.sqlite3 = null;
    this.mode = null;
  }
}

function configureSqliteWasmVfs() {
  const config = globalThis.sqlite3ApiConfig ??= {};
  const disabled = config.disable ??= {};
  const vfs = disabled.vfs ??= {};
  vfs.kvvfs = true;
  vfs.opfs = true;
  vfs['opfs-vfs'] = true;
  vfs['opfs-wl'] = true;
}

const READ_COMMANDS = new Set([
  'getCapabilities', 'getCounts', 'getRuntimeDiagnostics', 'listScanFolders', 'lookupOperationResult',
  'getOperationStatus', 'queryOperationSnapshot', 'getTransportState',
  'queryPlaybackSequence', 'queryTransportSegmentPage', 'queryTransportDescriptorPage',
  'queryPlaylistItems', 'getCachedArtwork', 'getArtworkSource', 'queryTracks',
  'queryEntities', 'getContextCount', 'readContextPage', 'readContextPageAtOrdinal',
  'resolveEntityAnchor', 'lookupContextTrack', 'getTrack', 'getTrackStorageIdentity',
  'checkIntegrity'
]);

function toInternalFolderStatus(status) {
  if (status === 'removed') return 'removed';
  return status === 'active' ? INTERNAL_ACTIVE_STATUS : INTERNAL_UNAVAILABLE_STATUS;
}

function fromInternalFolder(folder) {
  return Object.freeze({
    ...folder,
    normalizedRoot: `fsa:${folder.id}`,
    status: folder.status === 'removed'
      ? 'removed'
      : folder.status === INTERNAL_ACTIVE_STATUS ? 'active' : 'needs-permission'
  });
}

function translateWebSqliteError(error, fallbackCode = 'catalogError') {
  if (error instanceof LibraryRepositoryError) return error;
  const numericCode = Number(error?.resultCode ?? error?.sqlite3Rc);
  const diagnosticMessage = String(error?.message ?? 'Web music catalog request failed');
  let code = typeof error?.code === 'string' ? error.code : fallbackCode;
  if (numericCode === 13 || /SQLITE_FULL|database or disk is full/i.test(diagnosticMessage)) code = 'insufficientStorage';
  else if (numericCode === 5 || /SQLITE_BUSY|locked|SyncAccessHandle|SAH pool/i.test(diagnosticMessage)) code = 'concurrentUseUnsupported';
  else if ([11, 26].includes(numericCode) || /SQLITE_CORRUPT|SQLITE_NOTADB|malformed/i.test(diagnosticMessage)) code = 'catalogCorrupt';
  else if (numericCode === 14 || /Missing required OPFS APIs|cannot open/i.test(diagnosticMessage)) code = 'opfsUnavailable';
  console.error('Web music catalog SQLite request failed.', error);
  return createRepositoryError(code, userFacingSqliteMessage(code), {});
}

function userFacingSqliteMessage(code) {
  if (code === 'insufficientStorage') return 'The music library could not be saved because browser storage is full. Free some space and try again.';
  if (code === 'concurrentUseUnsupported') return 'The music library is already open in another tab or window. Close the other copy and try again.';
  if (code === 'catalogCorrupt') return 'The saved music library cannot be read. Rebuild the library to continue.';
  if (code === 'opfsUnavailable' || code === 'catalogOpenFailed') return 'This browser cannot open the music library storage. Check site storage permissions or use a supported browser.';
  return 'The music library request could not be completed. Try again.';
}

export { MUSIC_LIBRARY_V2_WEB_DATABASE as WEB_CATALOG_DATABASE_NAME };
