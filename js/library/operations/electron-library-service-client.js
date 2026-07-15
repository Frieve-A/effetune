import { OperationProgressFence } from './bulk-operation-protocol.js';

export const ELECTRON_LIBRARY_SERVICE_API_VERSION = 1;

export class ElectronLibraryServiceClient {
  constructor({
    api = globalThis.window?.electronAPI?.libraryServiceV1,
    playbackApi = globalThis.window?.electronAPI?.libraryPlaybackV1
  } = {}) {
    if (!api || api.apiVersion !== ELECTRON_LIBRARY_SERVICE_API_VERSION) {
      throw new Error(`Electron LibraryService API v${ELECTRON_LIBRARY_SERVICE_API_VERSION} is unavailable`);
    }
    if (!playbackApi || playbackApi.apiVersion !== ELECTRON_LIBRARY_SERVICE_API_VERSION) {
      throw new Error(`Electron Library playback API v${ELECTRON_LIBRARY_SERVICE_API_VERSION} is unavailable`);
    }
    this.api = api;
    this.playbackApi = playbackApi;
  }

  start(request) {
    return this.api.start(request);
  }

  status(operationId) {
    return this.api.status(operationId);
  }

  cancel(operationId) {
    return this.api.cancel(operationId);
  }

  previewPlaylistImport(request) {
    return this.api.previewPlaylistImport(request);
  }

  commitPlaylistImportPreview(request) {
    return this.api.commitPlaylistImportPreview(request);
  }

  cancelPlaylistImportPreview(request) {
    return this.api.cancelPlaylistImportPreview(request);
  }

  getProvisionalEntry(operationId) {
    return this.playbackApi.getProvisionalEntry(operationId);
  }

  readSequencePage(request) {
    return this.playbackApi.readSequencePage(request);
  }

  async resolveSequenceEntrySource(request) {
    const source = unwrapPlaybackResponse(await this.playbackApi.resolveSequenceEntrySource(request));
    return source;
  }

  subscribeEvents(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('LibraryService event listener must be a function');
    }
    return this.api.onEvent(listener);
  }

  subscribeOperation(operationId, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('LibraryService operation listener must be a function');
    }
    const fence = new OperationProgressFence(operationId);
    let terminal = false;
    return this.subscribeEvents(event => {
      if (!event || terminal) return;
      if (event.kind === 'progress') {
        if (fence.accept(event.progress)) listener(event);
        return;
      }
      if (event.kind === 'terminal' && event.operationId === operationId) {
        terminal = true;
        listener(event);
      }
    });
  }
}

function unwrapPlaybackResponse(response) {
  if (response?.code !== 'folderPermissionRequired') return response;
  const error = new Error('Playback folder access must be restored');
  error.name = 'LibraryRepositoryError';
  error.code = response.code;
  error.details = response.details && typeof response.details === 'object' ? response.details : {};
  throw error;
}

export function createElectronLibraryServiceClient(options) {
  return new ElectronLibraryServiceClient(options);
}
