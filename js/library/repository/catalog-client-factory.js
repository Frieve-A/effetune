import { ElectronCatalogClient } from './electron-catalog-client.js';
import { ElectronLibraryServiceClient } from '../operations/electron-library-service-client.js';
import { createRepositoryError } from './contract-errors.js';
import { MUSIC_LIBRARY_SCHEMA_VERSION } from './schema-v2.js';
import { WebCatalogRepositoryClient } from './web-catalog-client.js';

const WEB_RECOVERY_API_VERSION = 1;

function defaultWindowRef() {
  return typeof window === 'undefined' ? globalThis : window;
}

export async function createProductionCatalogClient({
  windowRef = defaultWindowRef(),
  electronClientFactory = options => new ElectronCatalogClient(options),
  electronServiceClientFactory = options => new ElectronLibraryServiceClient(options),
  webClientFactory = () => new WebCatalogRepositoryClient()
} = {}) {
  const electronApi = windowRef?.electronAPI?.libraryCatalogV1;
  const isElectronRuntime = Boolean(windowRef?.electronAPI) ||
    /\bElectron\//i.test(String(windowRef?.navigator?.userAgent ?? ''));
  if (electronApi) {
    const client = electronClientFactory({ api: electronApi });
    const serviceApi = windowRef?.electronAPI?.libraryServiceV1;
    const playbackApi = windowRef?.electronAPI?.libraryPlaybackV1;
    const bulkOperationService = serviceApi && playbackApi
      ? electronServiceClientFactory({ api: serviceApi, playbackApi })
      : null;
    const capabilities = await client.getCapabilities();
    return Object.freeze({
      client,
      bulkOperationService,
      runtime: 'electron',
      capabilities
    });
  }
  if (isElectronRuntime) {
    throw createRepositoryError(
      'electronCatalogUnavailable',
      'The Electron Music Library catalog bridge is unavailable'
    );
  }

  const client = webClientFactory();
  try {
    const openResult = await client.open({
      mode: 'readwrite',
      expectedSchemaVersion: MUSIC_LIBRARY_SCHEMA_VERSION
    });
    const capabilities = await client.getCapabilities();
    return Object.freeze({
      client,
      bulkOperationService: client,
      runtime: 'web',
      openResult,
      capabilities
    });
  } catch (error) {
    await Promise.resolve(client.close?.()).catch(() => {});
    throw error;
  }
}

export function createWebCatalogRecoveryController({
  webClientFactory = () => new WebCatalogRepositoryClient()
} = {}) {
  return new WebCatalogRecoveryController({ webClientFactory });
}

class WebCatalogRecoveryController {
  constructor({ webClientFactory }) {
    if (typeof webClientFactory !== 'function') {
      throw new TypeError('A Web catalog client factory is required');
    }
    this.webClientFactory = webClientFactory;
    this.state = createWebRecoveryState('available');
    this.listeners = new Set();
    this.operation = null;
  }

  getState() {
    return this.state;
  }

  onStateChange(listener) {
    if (typeof listener !== 'function') throw new TypeError('A recovery state listener is required');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reportOpenFailure() {
    if (this.state.status !== 'resetting') this.#setStatus('unavailable');
    return this.state;
  }

  resetCatalog({ confirmed = false } = {}) {
    if (confirmed !== true) {
      return Promise.resolve(createWebResetResult({ reset: false, canceled: true, recovered: false }, this.state));
    }
    if (this.state.status !== 'unavailable' || this.operation) {
      return this.operation ?? Promise.resolve(
        createWebResetResult({ reset: false, canceled: false, recovered: false }, this.state)
      );
    }
    const operation = this.#resetCatalog();
    const settled = operation.finally(() => {
      if (this.operation === settled) this.operation = null;
    });
    this.operation = settled;
    return settled;
  }

  async #resetCatalog() {
    this.#setStatus('resetting');
    let client = null;
    try {
      client = this.webClientFactory();
      await client.resetCatalog();
      this.#setStatus('available');
      return createWebResetResult({ reset: true, canceled: false, recovered: true }, this.state);
    } catch (error) {
      console.error('Failed to reset the Web Music Library catalog.', error);
      this.#setStatus('unavailable');
      return createWebResetResult({ reset: false, canceled: false, recovered: false }, this.state);
    } finally {
      await Promise.resolve(client?.close?.()).catch(error => {
        console.warn('Failed to close the Web Music Library recovery worker.', error);
      });
    }
  }

  #setStatus(status) {
    if (this.state.status === status) return;
    this.state = createWebRecoveryState(status);
    for (const listener of this.listeners) listener(this.state);
  }
}

function createWebRecoveryState(status) {
  return Object.freeze({
    apiVersion: WEB_RECOVERY_API_VERSION,
    status,
    available: status === 'available',
    canReset: status === 'unavailable'
  });
}

function createWebResetResult(result, state) {
  return Object.freeze({ ...result, state });
}
