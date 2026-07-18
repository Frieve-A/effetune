import { LibraryRepositoryError } from './contract-errors.js';
import { WebSqliteCatalogRepository } from './web-catalog-repository.js';
import { WebCatalogScanRuntime } from '../scan/web-scan-runtime.js';
import { WebLibraryServiceCoordinator } from '../operations/web-library-service-coordinator.js';

export const WEB_CATALOG_WORKER_PROTOCOL_VERSION = 1;
export const WEB_CATALOG_MAX_MESSAGE_BYTES = 1024 * 1024;
const BUSY_MAINTENANCE_DELAY_MS = 50;

const ALLOWED_METHODS = Object.freeze(new Set([
  'open',
  'resetCatalog',
  'close',
  'getCapabilities',
  'getCounts',
  'addFolder',
  'beginSessionFolder',
  'appendSessionFolderFiles',
  'commitSessionFolder',
  'abortSessionFolder',
  'scanFolders',
  'cancelScan',
  'requestFolderAccess',
  'removeFolder',
  'requestArtwork',
  'startOperation',
  'getOperationStatus',
  'cancelOperation',
  'previewPlaylistImport',
  'commitPlaylistImportPreview',
  'cancelPlaylistImportPreview',
  'getProvisionalEntry',
  'readSequencePage',
  'resolveSequenceEntrySource',
  'createContext',
  'releaseContext',
  'queryTracks',
  'queryEntities',
  'getContextCount',
  'readContextPageAtOrdinal',
  'resolveEntityAnchor',
  'getTrack',
  'resolvePlaylistExportSource',
  'createPlaylist',
  'createPlaylistWithItems',
  'recordRecentlyPlayed',
  'setTrackFavorite',
  'getFavoriteTrackUids',
  'getSystemPlaylists',
  'renamePlaylist',
  'duplicatePlaylist',
  'reorderPlaylistItem',
  'removePlaylistItem',
  'queryPlaylistItems',
  'tombstonePlaylist'
]));

const CONTROL_METHODS = new Set([
  'addFolder',
  'beginSessionFolder',
  'appendSessionFolderFiles',
  'commitSessionFolder',
  'abortSessionFolder',
  'scanFolders',
  'cancelScan',
  'requestFolderAccess',
  'removeFolder',
  'requestArtwork'
]);

const SERVICE_METHODS = new Map([
  ['startOperation', 'start'],
  ['getOperationStatus', 'status'],
  ['cancelOperation', 'cancel'],
  ['previewPlaylistImport', 'previewPlaylistImport'],
  ['commitPlaylistImportPreview', 'commitPlaylistImportPreview'],
  ['cancelPlaylistImportPreview', 'cancelPlaylistImportPreview'],
  ['getProvisionalEntry', 'getProvisionalEntry'],
  ['readSequencePage', 'readSequencePage'],
  ['resolveSequenceEntrySource', 'resolveSequenceEntrySource']
]);

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    code: error instanceof LibraryRepositoryError ? error.code : 'workerFailure',
    message: error?.message || String(error),
    details: error instanceof LibraryRepositoryError ? error.details : {}
  };
}

export function installWebCatalogWorker(scope = globalThis, {
  repository,
  runtime,
  serviceCoordinator,
  referenceFixtureLoader
} = {}) {
  const adapter = repository ?? new WebSqliteCatalogRepository({ authority: 'worker' });
  if (referenceFixtureLoader !== undefined && typeof referenceFixtureLoader !== 'function') {
    throw new TypeError('The reference fixture loader must be a function');
  }
  let scanRuntime = runtime ?? null;
  let libraryService = serviceCoordinator ?? null;
  const getScanRuntime = () => {
    scanRuntime ??= new WebCatalogScanRuntime({
      repository: adapter,
      onProgress: progress => postBoundedMessage(scope, {
        protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
        type: 'scan-progress',
        progress
      }),
      onFolderRemoval: progress => postBoundedMessage(scope, {
        protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
        type: 'folder-removal-progress',
        progress
      })
    });
    return scanRuntime;
  };
  const getLibraryService = () => {
    libraryService ??= new WebLibraryServiceCoordinator({
      repository: adapter,
      handleStore: getScanRuntime().handleStore,
      sourceProvider: getScanRuntime(),
      onEvent: event => postBoundedMessage(scope, {
        protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
        type: 'library-service-event',
        event
      })
    });
    return libraryService;
  };
  const getControlRuntime = () => {
    const runtime = getScanRuntime();
    runtime.setPlaylistImportService?.(getLibraryService());
    return runtime;
  };
  let unsubscribe = null;
  let maintenanceTimer = null;
  let maintenanceIndex = 0;
  const maintenanceJobs = [
    () => adapter.resumeFolderDeletionJobs({ limit: 1 }),
    () => adapter.repairInterruptedDeletionItems({ limit: 500 }),
    () => adapter.cleanupExpiredContextItems(500),
    () => adapter.cleanupPlaylistItems(500),
    () => adapter.gcOperationSnapshots(500),
    () => adapter.gcPlaylistItems(500),
    () => adapter.gcTerminalOperations({ finishedBefore: Date.now() - 7 * 24 * 60 * 60 * 1000, limit: 100 })
  ];
  const scheduleMaintenance = (delay = 30_000) => {
    if (maintenanceTimer !== null) return;
    maintenanceTimer = setTimeout(async () => {
      maintenanceTimer = null;
      try {
        const result = await maintenanceJobs[maintenanceIndex % maintenanceJobs.length]();
        maintenanceIndex += 1;
        scheduleMaintenance(result?.hasMore === true ? BUSY_MAINTENANCE_DELAY_MS : 30_000);
      } catch {
        scheduleMaintenance(30_000);
      }
    }, delay);
  };
  const handleMessage = async event => {
    const request = event.data;
    let requestByteLength = Number.POSITIVE_INFINITY;
    try {
      requestByteLength = measureWebCatalogMessageBytes(request);
    } catch {
      // Invalid structured data is rejected by the same protocol boundary below.
    }
    if (requestByteLength > WEB_CATALOG_MAX_MESSAGE_BYTES) {
      postBoundedMessage(scope, {
        protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
        requestId: typeof request?.requestId === 'string' ? request.requestId : null,
        ok: false,
        error: {
          name: 'LibraryRepositoryError',
          code: 'requestTooLarge',
          message: 'Web catalog Worker request exceeds the byte limit',
          details: { maximum: WEB_CATALOG_MAX_MESSAGE_BYTES }
        }
      });
      return;
    }
    if (!request
        || request.protocolVersion !== WEB_CATALOG_WORKER_PROTOCOL_VERSION
        || typeof request.requestId !== 'string'
        || (!ALLOWED_METHODS.has(request.method)
          && !(request.method === 'loadReferenceFixture' && referenceFixtureLoader))
        || !Array.isArray(request.args)) {
      postBoundedMessage(scope, {
        protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
        requestId: request?.requestId ?? null,
        ok: false,
        error: {
          name: 'LibraryRepositoryError',
          code: 'invalidWorkerRequest',
          message: 'Web catalog Worker request is invalid',
          details: {}
        }
      });
      return;
    }
    try {
      if (request.method === 'loadReferenceFixture') {
        const result = await referenceFixtureLoader(...request.args);
        postBoundedMessage(scope, {
          protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
          requestId: request.requestId,
          ok: true,
          result
        });
        return;
      }
      const serviceMethod = SERVICE_METHODS.get(request.method);
      const target = serviceMethod
        ? getLibraryService()
        : CONTROL_METHODS.has(request.method) ? getControlRuntime() : adapter;
      const result = await target[serviceMethod ?? request.method](...request.args);
      if (request.method === 'open' && !unsubscribe) {
        unsubscribe = adapter.subscribeInvalidations(invalidation => {
          postBoundedMessage(scope, {
            protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
            type: 'invalidation',
            invalidation
          });
        });
        queueMicrotask(() => {
          try {
            Promise.resolve(getScanRuntime().initializePermissions()).catch(() => {});
          } catch {
            // Folder permission refresh must never block catalog open.
          }
        });
        scheduleMaintenance(0);
      }
      if (request.method === 'close') {
        if (maintenanceTimer !== null) clearTimeout(maintenanceTimer);
        maintenanceTimer = null;
        unsubscribe?.();
        unsubscribe = null;
        scanRuntime?.close();
        libraryService?.close();
      }
      postBoundedMessage(scope, {
        protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: true,
        result
      });
    } catch (error) {
      postBoundedMessage(scope, {
        protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: false,
        error: serializeError(error)
      });
    }
  };
  scope.addEventListener('message', handleMessage);
  return () => {
    scope.removeEventListener('message', handleMessage);
    if (maintenanceTimer !== null) clearTimeout(maintenanceTimer);
    unsubscribe?.();
    scanRuntime?.close();
    libraryService?.close();
    adapter.close();
  };
}

export function measureWebCatalogMessageBytes(value) {
  const seen = new Set();
  const encoder = new TextEncoder();
  const visit = current => {
    if (current === null || current === undefined) return 1;
    if (typeof current === 'string') return 4 + encoder.encode(current).byteLength;
    if (typeof current === 'number' || typeof current === 'bigint') return 8;
    if (typeof current === 'boolean') return 1;
    if (typeof current !== 'object') throw new TypeError('Unsupported Worker message value');
    if (seen.has(current)) return 0;
    seen.add(current);
    if (current instanceof ArrayBuffer) return 8 + current.byteLength;
    if (ArrayBuffer.isView(current)) return 8 + current.byteLength;
    if (typeof Blob !== 'undefined' && current instanceof Blob) {
      const name = typeof current.name === 'string' ? current.name : '';
      return 32 + encoder.encode(name).byteLength + encoder.encode(current.type || '').byteLength;
    }
    if (Array.isArray(current)) return 8 + current.reduce((bytes, item) => bytes + visit(item), 0);
    if (current instanceof Set) return 8 + [...current].reduce((bytes, item) => bytes + visit(item), 0);
    if (current instanceof Map) {
      return 8 + [...current].reduce((bytes, [key, item]) => bytes + visit(key) + visit(item), 0);
    }
    let bytes = 16;
    for (const key of Object.keys(current)) bytes += encoder.encode(key).byteLength + visit(current[key]);
    return bytes;
  };
  return visit(value);
}

function postBoundedMessage(scope, message) {
  const byteLength = measureWebCatalogMessageBytes(message);
  if (byteLength <= WEB_CATALOG_MAX_MESSAGE_BYTES) {
    scope.postMessage(message);
    return true;
  }
  if (typeof message.requestId === 'string') {
    scope.postMessage({
      protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
      requestId: message.requestId,
      ok: false,
      error: {
        name: 'LibraryRepositoryError',
        code: 'responseTooLarge',
        message: 'Web catalog Worker response exceeds the byte limit',
        details: { maximum: WEB_CATALOG_MAX_MESSAGE_BYTES }
      }
    });
  }
  return false;
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  installWebCatalogWorker();
}
