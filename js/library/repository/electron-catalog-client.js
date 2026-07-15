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

  readContextPageAtOrdinal(request) {
    return this.api.readContextPageAtOrdinal(request);
  }

  resolveEntityAnchor(request) {
    return this.api.resolveEntityAnchor(request);
  }

  releaseContext(contextToken) {
    return this.api.releaseContext(contextToken);
  }

  getTrack(trackUid) {
    return this.api.getTrack(trackUid);
  }

  resolvePlaylistExportSource(trackUid) {
    return this.api.resolvePlaylistExportSource(trackUid);
  }

  async resolvePlaybackSource(trackUid) {
    const response = await this.api.resolvePlaybackSource(trackUid);
    throwFolderPermissionRequired(response, 'Playback folder access must be restored');
    if (
      response?.kind !== 'electron-file' ||
      !isAbsoluteElectronPath(response.path)
    ) {
      throw new Error('Electron playback source response is invalid');
    }
    return response;
  }

  async showTrackInFolder(trackUid) {
    const response = await this.api.showTrackInFolder(trackUid);
    throwFolderPermissionRequired(response, 'Music folder access must be restored');
    if (response?.success !== true) {
      throw new Error('Electron show-in-folder response is invalid');
    }
    return response;
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

  async addFolder(options) {
    const result = await this.api.addFolder(options);
    if (result?.canceled || result?.rejected || !result?.folder?.id || result.scan) return result;
    const scanRequest = {
      folderIds: [result.folder.id],
      scanReason: 'automatic'
    };
    if (options?.languageHints) scanRequest.languageHints = options.languageHints;
    const scan = await this.scanFolders(scanRequest);
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

  subscribeFolderRemovalEvents(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Catalog folder removal listener must be a function');
    }
    return this.api.onFolderRemovalEvent(listener);
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

function isAbsoluteElectronPath(value) {
  return typeof value === 'string' && (
    value.startsWith('/') || value.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(value)
  );
}

function throwFolderPermissionRequired(response, message) {
  if (response?.code !== 'folderPermissionRequired') return;
  const error = new Error(message);
  error.name = 'LibraryRepositoryError';
  error.code = response.code;
  error.details = response.details && typeof response.details === 'object' ? response.details : {};
  throw error;
}
