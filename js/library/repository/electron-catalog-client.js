export const ELECTRON_CATALOG_API_VERSION = 1;

export class ElectronCatalogClient {
  constructor({ api = globalThis.window?.electronAPI?.libraryCatalogV1 } = {}) {
    if (!api || api.apiVersion !== ELECTRON_CATALOG_API_VERSION) {
      throw new Error(`Electron catalog API v${ELECTRON_CATALOG_API_VERSION} is unavailable`);
    }
    this.api = api;
  }

  async getCapabilities() {
    const capabilities = await this.api.getCapabilities();
    if (capabilities?.protocolVersion !== ELECTRON_CATALOG_API_VERSION) {
      throw new Error('Electron catalog protocol version mismatch');
    }
    return capabilities;
  }

  getCounts(request = {}) {
    return this.api.getCounts(request);
  }

  createContext(request) {
    return this.api.createContext(request);
  }

  getContextCount(request) {
    return this.api.getContextCount(request);
  }

  queryTracks(request) {
    return this.api.queryTracks(request);
  }

  queryEntities(request) {
    return this.api.queryEntities(request);
  }

  readContextPage(request) {
    return this.api.readContextPage(request);
  }

  readContextPageAtOrdinal(request) {
    return this.api.readContextPageAtOrdinal(request);
  }

  resolveEntityAnchor(request) {
    return this.api.resolveEntityAnchor(request);
  }

  lookupContextTrack(request) {
    return this.api.lookupContextTrack(request);
  }

  releaseContext(contextToken) {
    return this.api.releaseContext(contextToken);
  }

  getTrack(trackUid) {
    return this.api.getTrack(trackUid);
  }

  resolvePlaybackSource(trackUid) {
    return this.api.resolvePlaybackSource(trackUid);
  }

  createPlaylist(request) {
    return this.api.createPlaylist(request);
  }

  createPlaylistWithItems(request) {
    return this.api.createPlaylistWithItems(request);
  }

  renamePlaylist(request) {
    return this.api.renamePlaylist(request);
  }

  reorderPlaylistItem(request) {
    return this.api.reorderPlaylistItem(request);
  }

  removePlaylistItem(request) {
    return this.api.removePlaylistItem(request);
  }

  duplicatePlaylist(request) {
    return this.api.duplicatePlaylist(request);
  }

  queryPlaylistItems(request) {
    return this.api.queryPlaylistItems(request);
  }

  tombstonePlaylist(request) {
    return this.api.tombstonePlaylist(request);
  }

  async addFolder() {
    const result = await this.api.addFolder();
    if (result?.canceled || !result?.folder?.id || result.scan) return result;
    const scan = await this.scanFolders({
      folderIds: [result.folder.id],
      scanReason: 'automatic'
    });
    return { ...result, scan };
  }

  requestFolderAccess(folderId) {
    return this.api.requestFolderAccess(folderId);
  }

  scanFolders(request) {
    return this.api.scanFolders(normalizeScanRequest(request));
  }

  cancelScan(scanId) {
    return this.api.cancelScan(scanId);
  }

  removeFolder(folderId) {
    return this.api.removeFolder(folderId);
  }

  requestArtwork(request) {
    return this.api.requestArtwork(request);
  }

  getScanStatus(scanId) {
    return this.api.getScanStatus(scanId);
  }

  subscribeInvalidations(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Catalog invalidation listener must be a function');
    }
    return this.api.onInvalidation(listener);
  }

  subscribeScanEvents(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Catalog scan listener must be a function');
    }
    return this.api.onScanEvent(listener);
  }
}

export function createElectronCatalogClient(options) {
  return new ElectronCatalogClient(options);
}

function normalizeScanRequest(request) {
  if (request == null) return { folderIds: null };
  if (Array.isArray(request)) return { folderIds: request };
  return request;
}
