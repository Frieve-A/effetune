import { ElectronCatalogClient } from './electron-catalog-client.js';
import { ElectronLibraryServiceClient } from '../operations/electron-library-service-client.js';
import { createRepositoryError } from './contract-errors.js';
import { MUSIC_LIBRARY_SCHEMA_VERSION } from './schema-v2.js';
import { WebCatalogRepositoryClient } from './web-catalog-client.js';

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
      capabilities,
      productionQualified: capabilities?.productionQualified === true
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
      capabilities,
      // The current Web repository reports false until its release gate passes.
      // Preserve that fact; opening it must not imply the million-track claim.
      productionQualified: capabilities?.productionQualified === true
    });
  } catch (error) {
    await Promise.resolve(client.close?.()).catch(() => {});
    throw error;
  }
}
