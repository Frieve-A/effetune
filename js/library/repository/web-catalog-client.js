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
    this.operationListeners = new Set();
    this.sequence = 0;
    this.worker.addEventListener('message', event => this.#handleMessage(event));
    this.worker.addEventListener('error', event => this.#failAll(
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

  subscribeOperations(listener) {
    if (typeof listener !== 'function') throw new TypeError('Operation listener must be a function');
    this.operationListeners.add(listener);
    return () => this.operationListeners.delete(listener);
  }

  request(method, ...args) {
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
  async getCapabilities() { return this.request('getCapabilities'); }
  async getCounts() { return this.request('getCounts'); }
  async addFolder(options) { return this.request('addFolder', options); }
  async scanFolders(options) { return this.request('scanFolders', options); }
  async cancelScan(options) { return this.request('cancelScan', options); }
  async requestFolderAccess(options) { return this.request('requestFolderAccess', options); }
  async removeFolder(options) { return this.request('removeFolder', options); }
  async requestArtwork(options) { return this.request('requestArtwork', options); }
  async start(request) { return this.request('startOperation', request); }
  async lookupResult(clientRequestId) { return this.request('lookupOperationResult', clientRequestId); }
  async status(operationId) { return this.request('getOperationStatus', operationId); }
  async cancel(operationId) { return this.request('cancelOperation', operationId); }
  async getProvisionalEntry(operationId) { return this.request('getProvisionalEntry', operationId); }
  async commitTransportCommand(request) { return this.request('commitTransportCommand', request); }
  async getTransportState() { return this.request('getTransportState'); }
  async applyTransportUndo(request) { return this.request('applyTransportUndo', request); }
  async readSequencePage(options) { return this.request('readSequencePage', options); }
  async resolveSequenceEntrySource(options) { return this.request('resolveSequenceEntrySource', options); }
  async createContext(options) { return this.request('createContext', options); }
  async releaseContext(contextToken) { return this.request('releaseContext', contextToken); }
  async queryTracks(options) { return this.request('queryTracks', options); }
  async queryEntities(options) { return this.request('queryEntities', options); }
  async getContextCount(options) { return this.request('getContextCount', options); }
  async lookupContextTrack(options) { return this.request('lookupContextTrack', options); }
  async readContextPageAtOrdinal(options) { return this.request('readContextPageAtOrdinal', options); }
  async resolveEntityAnchor(options) { return this.request('resolveEntityAnchor', options); }
  async getTrack(trackUid) { return this.request('getTrack', trackUid); }
  async createPlaylist(options) { return this.request('createPlaylist', options); }
  async createPlaylistWithItems(options) { return this.request('createPlaylistWithItems', options); }
  async renamePlaylist(options) { return this.request('renamePlaylist', options); }
  async duplicatePlaylist(options) { return this.request('duplicatePlaylist', options); }
  async reorderPlaylistItem(options) { return this.request('reorderPlaylistItem', options); }
  async removePlaylistItem(options) { return this.request('removePlaylistItem', options); }
  async queryPlaylistItems(options) { return this.request('queryPlaylistItems', options); }
  async tombstonePlaylist(options) { return this.request('tombstonePlaylist', options); }

  async close() {
    try {
      await this.request('close');
    } finally {
      this.worker.terminate();
      this.#failAll(createRepositoryError('workerClosed', 'Web catalog Worker closed'));
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
}
