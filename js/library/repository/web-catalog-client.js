import { createRepositoryError } from './contract-errors.js';
import {
  measureWebCatalogMessageBytes,
  WEB_CATALOG_MAX_MESSAGE_BYTES,
  WEB_CATALOG_WORKER_PROTOCOL_VERSION
} from './web-catalog-worker.js';

const MAX_OUTSTANDING_REQUESTS = 32;

export class WebCatalogRepositoryClient {
  constructor({ worker } = {}) {
    const WorkerConstructor = globalThis.Worker;
    this.worker = worker ?? (WorkerConstructor
      ? new WorkerConstructor(new URL('./web-catalog-worker.js', import.meta.url), { type: 'module' })
      : null);
    if (!this.worker) {
      throw createRepositoryError('workerUnavailable', 'A dedicated Worker is required for the Web catalog');
    }
    this.pending = new Map();
    this.listeners = new Set();
    this.scanProgressListeners = new Set();
    this.folderRemovalListeners = new Set();
    this.operationListeners = new Set();
    this.sequence = 0;
    this.failure = null;
    this.closed = false;
    this.worker.addEventListener('message', event => this.#handleMessage(event));
    this.worker.addEventListener('error', event => this.#markFailed(
      createRepositoryError('workerFailure', event.message || 'Web catalog Worker failed')
    ));
  }

  subscribeInvalidations(listener) {
    if (typeof listener !== 'function') throw new TypeError('Invalidation listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeScanProgress(listener) {
    if (typeof listener !== 'function') throw new TypeError('Scan progress listener must be a function');
    this.scanProgressListeners.add(listener);
    return () => this.scanProgressListeners.delete(listener);
  }

  subscribeFolderRemovalEvents(listener) {
    if (typeof listener !== 'function') throw new TypeError('Folder removal listener must be a function');
    this.folderRemovalListeners.add(listener);
    return () => this.folderRemovalListeners.delete(listener);
  }

  subscribeOperations(listener) {
    if (typeof listener !== 'function') throw new TypeError('Operation listener must be a function');
    this.operationListeners.add(listener);
    return () => this.operationListeners.delete(listener);
  }

  request(method, ...args) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) {
      return Promise.reject(createRepositoryError('workerClosed', 'Web catalog Worker closed'));
    }
    if (this.pending.size >= MAX_OUTSTANDING_REQUESTS) {
      return Promise.reject(createRepositoryError('tooManyOutstandingRequests', 'Web catalog request limit reached', {
        maximum: MAX_OUTSTANDING_REQUESTS
      }));
    }
    const requestId = `web_catalog_${(this.sequence += 1).toString(36)}`;
    const message = {
      protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
      requestId,
      method,
      args
    };
    let byteLength;
    try {
      byteLength = measureWebCatalogMessageBytes(message);
    } catch {
      return Promise.reject(createRepositoryError('invalidWorkerRequest', 'Web catalog request contains an unsupported value'));
    }
    if (byteLength > WEB_CATALOG_MAX_MESSAGE_BYTES) {
      return Promise.reject(createRepositoryError('requestTooLarge', 'Web catalog request exceeds the byte limit', {
        maximum: WEB_CATALOG_MAX_MESSAGE_BYTES,
        byteLength
      }));
    }
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        this.worker.postMessage(message);
      } catch (error) {
        this.pending.delete(requestId);
        reject(createRepositoryError('invalidWorkerRequest', error?.message || 'Web catalog request could not be cloned'));
      }
    });
  }

  async open(options) { return this.request('open', options); }
  async resetCatalog() { return this.request('resetCatalog'); }
  async getCapabilities() { return this.request('getCapabilities'); }
  async getCounts() { return this.request('getCounts'); }
  async addFolder(options = {}) {
    if (!Array.isArray(options.sessionFiles)) return this.request('addFolder', options);
    return this.#bindSessionFolder(null, options);
  }
  async scanFolders(options) { return this.request('scanFolders', options); }
  async cancelScan(options) { return this.request('cancelScan', options); }
  async requestFolderAccess(options = {}) {
    if (!Array.isArray(options.sessionFiles)) return this.request('requestFolderAccess', options);
    return this.#bindSessionFolder(options.folderId, { ...options, scan: false });
  }
  async removeFolder(options) { return this.request('removeFolder', options); }
  async requestArtwork(options) { return this.request('requestArtwork', options); }
  async start(request) { return this.request('startOperation', request); }
  async status(operationId) { return this.request('getOperationStatus', operationId); }
  async cancel(operationId) { return this.request('cancelOperation', operationId); }
  async previewPlaylistImport(request) { return this.request('previewPlaylistImport', request); }
  async commitPlaylistImportPreview(request) { return this.request('commitPlaylistImportPreview', request); }
  async cancelPlaylistImportPreview(request) { return this.request('cancelPlaylistImportPreview', request); }
  async getProvisionalEntry(operationId) { return this.request('getProvisionalEntry', operationId); }
  async readSequencePage(options) { return this.request('readSequencePage', options); }
  async resolveSequenceEntrySource(options) { return this.request('resolveSequenceEntrySource', options); }
  async createContext(options) { return this.request('createContext', options); }
  async releaseContext(contextToken) { return this.request('releaseContext', contextToken); }
  async queryTracks(options) { return this.request('queryTracks', options); }
  async browseFolderChildren(options) { return this.request('browseFolderChildren', options); }
  async queryEntities(options) { return this.request('queryEntities', options); }
  async getContextCount(options) { return this.request('getContextCount', options); }
  async readContextPageAtOrdinal(options) { return this.request('readContextPageAtOrdinal', options); }
  async resolveEntityAnchor(options) { return this.request('resolveEntityAnchor', options); }
  async getTrack(trackUid) { return this.request('getTrack', trackUid); }
  async resolvePlaylistExportSource(trackUid) { return this.request('resolvePlaylistExportSource', trackUid); }
  async createPlaylist(options) { return this.request('createPlaylist', options); }
  async createPlaylistWithItems(options) { return this.request('createPlaylistWithItems', options); }
  async recordRecentlyPlayed(options) { return this.request('recordRecentlyPlayed', options); }
  async setTrackFavorite(options) { return this.request('setTrackFavorite', options); }
  async getFavoriteTrackUids(options = {}) { return this.request('getFavoriteTrackUids', options); }
  async getSystemPlaylists() { return this.request('getSystemPlaylists'); }
  async renamePlaylist(options) { return this.request('renamePlaylist', options); }
  async duplicatePlaylist(options) { return this.request('duplicatePlaylist', options); }
  async reorderPlaylistItem(options) { return this.request('reorderPlaylistItem', options); }
  async removePlaylistItem(options) { return this.request('removePlaylistItem', options); }
  async queryPlaylistItems(options) { return this.request('queryPlaylistItems', options); }
  async tombstonePlaylist(options) { return this.request('tombstonePlaylist', options); }

  async close() {
    if (this.closed) {
      this.worker.terminate();
      return;
    }
    if (this.failure) {
      this.closed = true;
      this.worker.terminate();
      this.#failAll(this.failure);
      return;
    }
    try {
      await this.request('close');
    } finally {
      this.closed = true;
      this.worker.terminate();
      this.#failAll(createRepositoryError('workerClosed', 'Web catalog Worker closed'));
    }
  }

  async #bindSessionFolder(folderId, options) {
    const sessionFiles = options.sessionFiles;
    const begun = await this.request('beginSessionFolder', {
      folderId,
      displayName: options.displayName ?? 'Imported Folder'
    });
    try {
      for (const entries of createSessionFileBatches(sessionFiles)) {
        await this.request('appendSessionFolderFiles', { token: begun.token, entries });
      }
      return await this.request('commitSessionFolder', {
        token: begun.token,
        scan: options.scan !== false,
        scanReason: options.scanReason ?? 'automatic',
        languageHints: options.languageHints ?? null
      });
    } catch (error) {
      await this.request('abortSessionFolder', { token: begun.token }).catch(() => {});
      throw error;
    }
  }

  #handleMessage(event) {
    const message = event.data;
    if (!message || message.protocolVersion !== WEB_CATALOG_WORKER_PROTOCOL_VERSION) return;
    let byteLength;
    try {
      byteLength = measureWebCatalogMessageBytes(message);
    } catch {
      byteLength = Number.POSITIVE_INFINITY;
    }
    if (byteLength > WEB_CATALOG_MAX_MESSAGE_BYTES) {
      const pending = this.pending.get(message.requestId);
      if (pending) {
        this.pending.delete(message.requestId);
        pending.reject(createRepositoryError('responseTooLarge', 'Web catalog response exceeds the byte limit', {
          maximum: WEB_CATALOG_MAX_MESSAGE_BYTES
        }));
      }
      return;
    }
    if (message.type === 'invalidation') {
      for (const listener of this.listeners) listener(message.invalidation);
      return;
    }
    if (message.type === 'scan-progress') {
      for (const listener of this.scanProgressListeners) listener(message.progress);
      return;
    }
    if (message.type === 'folder-removal-progress') {
      for (const listener of this.folderRemovalListeners) listener(message.progress);
      return;
    }
    if (message.type === 'library-service-event') {
      for (const listener of this.operationListeners) listener(message.event);
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(createRepositoryError(
        message.error?.code || 'workerFailure',
        message.error?.message || 'Web catalog Worker request failed',
        message.error?.details || {}
      ));
    }
  }

  #failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  #markFailed(error) {
    if (this.closed) return;
    if (!this.failure) this.failure = error;
    this.#failAll(this.failure);
  }
}

function *createSessionFileBatches(entries) {
  const encoder = new TextEncoder();
  let batch = [];
  let bytes = 0;
  for (const entry of entries) {
    const entryBytes = 128 + encoder.encode(String(entry?.relativePath ?? '')).byteLength;
    if (batch.length > 0 && bytes + entryBytes > WEB_CATALOG_MAX_MESSAGE_BYTES / 2) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(entry);
    bytes += entryBytes;
  }
  if (batch.length > 0) yield batch;
}
