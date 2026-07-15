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

  lookupResult(clientRequestId) {
    return this.api.lookupResult(clientRequestId);
  }

  status(operationId) {
    return this.api.status(operationId);
  }

  cancel(operationId) {
    return this.api.cancel(operationId);
  }

  getProvisionalEntry(operationId) {
    return this.playbackApi.getProvisionalEntry(operationId);
  }

  commitTransportCommand(request) {
    return this.playbackApi.commitTransportCommand(request);
  }

  getTransportState() {
    return this.playbackApi.getTransportState();
  }

  applyTransportUndo(request) {
    return this.playbackApi.applyTransportUndo(request);
  }

  readSequencePage(request) {
    return this.playbackApi.readSequencePage(request);
  }

  resolveSequenceEntrySource(request) {
    return this.playbackApi.resolveSequenceEntrySource(request);
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

export function createElectronLibraryServiceClient(options) {
  return new ElectronLibraryServiceClient(options);
}
