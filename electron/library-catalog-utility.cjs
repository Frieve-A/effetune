'use strict';

const {
  LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION
} = require('./library-catalog-utility-host.cjs');
const { LibraryCatalogHost } = require('./library-catalog-host.cjs');
const { LibraryCatalogScanRuntime } = require('./library-catalog-scan-runtime.cjs');
const { LibraryServiceCoordinator } = require('./library-service-coordinator.cjs');

const parentPort = process.parentPort;
if (!parentPort) throw new Error('Library catalog utility requires an Electron parent port');

let runtime = null;
let coordinator = null;
let repository = null;
let initialized = false;
let closed = false;
let nextBridgeRequestId = 1;
const pendingBridgeRequests = new Map();

parentPort.on('message', event => {
  const message = event?.data ?? event;
  handleMessage(message).catch(error => {
    if (message?.type === 'request') respond(message.requestId, false, null, error);
    else if (message?.type === 'initialize') {
      closeUtility().catch(() => {}).finally(() => ready(false, null, error));
    }
  });
});

async function handleMessage(message) {
  if (!message || message.protocolVersion !== LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION) {
    throw createUtilityError('utilityProtocolMismatch', 'Library utility protocol mismatch');
  }
  if (message.type === 'initialize') {
    if (initialized) throw createUtilityError('utilityAlreadyInitialized', 'Library utility is already initialized');
    initialized = true;
    const dialog = createDialogProxy();
    repository = await LibraryCatalogHost.open({ dbPath: message.dbPath });
    repository.on('invalidation', payload => emitEvent('repository', 'invalidation', payload));
    repository.on('failure', error => post({ type: 'fatal', error: serializeError(error) }));
    runtime = await LibraryCatalogScanRuntime.open({
      host: repository,
      dialog,
      getMainWindow: () => null,
      artworkThumbnailer: source => bridgeRequest('artwork-thumbnail-request', {
        bytes: new Uint8Array(source)
      }),
      utilitySessionId: `${process.pid}:${Date.now()}`
    });
    coordinator = await LibraryServiceCoordinator.open({
      repository,
      importSourceProvider: runtime
    });
    runtime.setPlaylistImportService(coordinator);
    runtime.on('scan-event', payload => emitEvent('runtime', 'scan-event', payload));
    runtime.on('folder-removal-event', payload => emitEvent('runtime', 'folder-removal-event', payload));
    coordinator.on('event', payload => emitEvent('coordinator', 'event', payload));
    ready(true, {
      processId: process.pid
    });
    return;
  }
  if (message.type === 'dialog-response' || message.type === 'artwork-thumbnail-response') {
    const pending = pendingBridgeRequests.get(message.requestId);
    if (!pending) return;
    pendingBridgeRequests.delete(message.requestId);
    if (message.ok) pending.resolve(message.payload);
    else pending.reject(deserializeError(message.error));
    return;
  }
  if (message.type !== 'request') return;
  if (!initialized || closed) throw createUtilityError('utilityNotReady', 'Library utility is not ready');
  if (message.target === 'system' && message.method === 'close') {
    await closeUtility();
    respond(message.requestId, true, { closed: true });
    return;
  }
  const target = message.target === 'runtime'
    ? runtime
    : message.target === 'coordinator'
      ? coordinator
      : message.target === 'repository' ? repository : null;
  if (!target || typeof target[message.method] !== 'function' || String(message.method).startsWith('_')) {
    throw createUtilityError('unknownUtilityMethod', 'Library utility method is unavailable');
  }
  try {
    const payload = await target[message.method](...(Array.isArray(message.args) ? message.args : []));
    respond(message.requestId, true, payload);
  } catch (error) {
    respond(message.requestId, false, null, error);
  }
}

function createDialogProxy() {
  return {
    showOpenDialog(_window, options = {}) {
      const kind = options.properties?.includes('openDirectory') ? 'folder' : 'playlist';
      return bridgeRequest('dialog-request', { kind });
    },
    showMessageBox() {
      return bridgeRequest('dialog-request', { kind: 'folder-consolidation' });
    }
  };
}

function bridgeRequest(type, extra) {
  if (closed) return Promise.reject(createUtilityError('utilityClosed', 'Library utility is closed'));
  const requestId = nextBridgeRequestId++;
  return new Promise((resolve, reject) => {
    pendingBridgeRequests.set(requestId, { resolve, reject });
    post({ type, requestId, ...extra });
  });
}

async function closeUtility() {
  if (closed) return;
  closed = true;
  await runtime?.close().catch(() => {});
  coordinator?.dispose();
  await repository?.close().catch(() => {});
  const error = createUtilityError('utilityClosed', 'Library utility is closed');
  for (const pending of pendingBridgeRequests.values()) pending.reject(error);
  pendingBridgeRequests.clear();
}

function emitEvent(target, eventName, payload) {
  post({ type: 'event', target, eventName, payload });
}

function ready(ok, payload, error) {
  post({ type: 'ready', ok, ...(ok ? { payload } : { error: serializeError(error) }) });
}

function respond(requestId, ok, payload, error) {
  post({ type: 'response', requestId, ok, ...(ok ? { payload } : { error: serializeError(error) }) });
}

function post(message) {
  parentPort.postMessage({
    protocolVersion: LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION,
    ...message
  });
}

function serializeError(error) {
  return {
    name: String(error?.name || 'Error').slice(0, 128),
    code: String(error?.code || 'utilityError').slice(0, 128),
    message: String(error?.message || 'Library utility request failed').slice(0, 1024),
    details: error?.details && typeof error.details === 'object' ? error.details : {}
  };
}

function deserializeError(payload = {}) {
  return createUtilityError(payload.code || 'utilityError', payload.message || 'Library utility request failed', payload.details);
}

function createUtilityError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'LibraryCatalogUtilityError';
  error.code = code;
  error.details = details || {};
  return error;
}
