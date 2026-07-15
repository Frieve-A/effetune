import assert from 'node:assert/strict';
import test from 'node:test';

import { WebCatalogRepositoryClient } from '../../js/library/repository/web-catalog-client.js';
import {
  installWebCatalogWorker,
  WEB_CATALOG_MAX_MESSAGE_BYTES,
  WEB_CATALOG_WORKER_PROTOCOL_VERSION
} from '../../js/library/repository/web-catalog-worker.js';

function createWorkerScope() {
  const listeners = new Set();
  const messages = [];
  return {
    messages,
    addEventListener(type, listener) {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'message') listeners.delete(listener);
    },
    postMessage(message) {
      messages.push(message);
    },
    dispatch(data) {
      for (const listener of listeners) listener({ data });
    }
  };
}

test('Worker protocol accepts only versioned bounded method requests and forwards invalidations', async () => {
  const scope = createWorkerScope();
  let invalidationListener;
  let closed = false;
  const repository = {
    async open(options) { return { mode: options.mode }; },
    subscribeInvalidations(listener) {
      invalidationListener = listener;
      return () => { invalidationListener = null; };
    },
    close() { closed = true; }
  };
  const uninstall = installWebCatalogWorker(scope, { repository });
  scope.dispatch({ protocolVersion: 99, requestId: 'bad', method: 'open', args: [] });
  assert.equal(scope.messages.at(-1).error.code, 'invalidWorkerRequest');

  scope.dispatch({
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    requestId: 'oversized',
    method: 'open',
    args: [{ padding: 'x'.repeat(WEB_CATALOG_MAX_MESSAGE_BYTES) }]
  });
  assert.equal(scope.messages.at(-1).error.code, 'requestTooLarge');

  scope.dispatch({
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    requestId: 'open-1',
    method: 'open',
    args: [{ mode: 'readwrite' }]
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(scope.messages.at(-1), {
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    requestId: 'open-1',
    ok: true,
    result: { mode: 'readwrite' }
  });
  invalidationListener({ catalogVersion: 1, changedScopes: ['tracks'] });
  assert.equal(scope.messages.at(-1).type, 'invalidation');
  uninstall();
  assert.equal(closed, true);
});

test('Worker reports a resumed Web folder removal after catalog open', async () => {
  const scope = createWorkerScope();
  const repository = {
    async open() { return { mode: 'readwrite' }; },
    subscribeInvalidations() { return () => {}; },
    async listFolderRecords() {
      return [{ id: 'folder-removed', status: 'removed' }];
    },
    async getScanFolderTrackCount() { return { trackCount: 3 }; },
    async upsertFolders() {},
    async setFolderAvailability() {},
    async tombstoneFolder() {},
    async runFolderDeletion() {},
    async resumeFolderDeletionJobs() { return { resumed: 0, hasMore: false }; },
    async repairInterruptedDeletionItems() { return { repaired: 0, hasMore: false }; },
    async cleanupExpiredContextItems() { return { deleted: 0, hasMore: false }; },
    async cleanupPlaylistItems() { return { deleted: 0, hasMore: false }; },
    async gcOperationSnapshots() { return { deleted: 0, hasMore: false }; },
    async gcPlaylistItems() { return { deleted: 0, hasMore: false }; },
    async gcTerminalOperations() { return { deleted: 0, hasMore: false }; },
    close() {}
  };
  const uninstall = installWebCatalogWorker(scope, { repository });
  scope.dispatch({
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    requestId: 'open-with-removal',
    method: 'open',
    args: [{ mode: 'readwrite' }]
  });
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.deepEqual(
    scope.messages.find(message => message.type === 'folder-removal-progress')?.progress,
    { folderId: 'folder-removed', phase: 'removing', deleted: 0, total: 3 }
  );
  uninstall();
});

test('Worker exposes only the durable operation controls and bounded sequence access', async () => {
  const scope = createWorkerScope();
  const calls = [];
  const serviceCoordinator = Object.fromEntries([
    ['start', { state: 'accepted' }],
    ['status', { phase: 'SNAPSHOTTING' }],
    ['cancel', { state: 'cancelRequested' }],
    ['previewPlaylistImport', { previewToken: 'preview-1' }],
    ['commitPlaylistImportPreview', { playlistId: 'playlist-1', version: 1 }],
    ['cancelPlaylistImportPreview', { kind: 'cancelled' }],
    ['readSequencePage', { items: [], nextCursor: null }],
    ['resolveSequenceEntrySource', { name: 'track.flac' }]
  ].map(([method, result]) => [method, async (...args) => {
    calls.push([method, args]);
    return result;
  }]));
  serviceCoordinator.close = () => {};
  const repository = { close() {} };
  const uninstall = installWebCatalogWorker(scope, { repository, serviceCoordinator });
  const requests = [
    ['startOperation', [{ operationType: 'queue' }]],
    ['getOperationStatus', ['operation-1']],
    ['cancelOperation', ['operation-1']],
    ['previewPlaylistImport', [{ source: { name: 'list.m3u8' } }]],
    ['commitPlaylistImportPreview', [{ previewToken: 'preview-1', playlistId: 'playlist-1' }]],
    ['cancelPlaylistImportPreview', [{ previewToken: 'preview-2', playlistId: 'playlist-2' }]],
    ['readSequencePage', [{ sequenceId: 'sequence-1', limit: 25 }]],
    ['resolveSequenceEntrySource', [{ sequenceId: 'sequence-1', ordinal: 0 }]]
  ];
  for (const [index, [method, args]] of requests.entries()) {
    scope.dispatch({
      protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
      requestId: `service-${index}`,
      method,
      args
    });
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls.map(([method]) => method), [
    'start',
    'status',
    'cancel',
    'previewPlaylistImport',
    'commitPlaylistImportPreview',
    'cancelPlaylistImportPreview',
    'readSequencePage',
    'resolveSequenceEntrySource'
  ]);
  assert.equal(scope.messages.filter(message => message.ok).length, requests.length);

  for (const method of [
    'completeOperation',
    'appendPlaylistItems',
    'publishPlaylist',
    'upsertFolders',
    'upsertTracks',
    'loadReferenceFixture'
  ]) {
    scope.dispatch({
      protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
      requestId: `raw-mutation-${method}`,
      method,
      args: []
    });
    assert.equal(scope.messages.at(-1).error.code, 'invalidWorkerRequest');
  }
  uninstall();
});

test('reference fixture loading is enabled only by the dedicated Worker boundary', async () => {
  const scope = createWorkerScope();
  const calls = [];
  const repository = { close() {} };
  const uninstall = installWebCatalogWorker(scope, {
    repository,
    async referenceFixtureLoader(options) {
      calls.push(options);
      return { folders: 1, tracks: options.count };
    }
  });
  scope.dispatch({
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    requestId: 'reference-fixture',
    method: 'loadReferenceFixture',
    args: [{ count: 7, seed: 123 }]
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, [{ count: 7, seed: 123 }]);
  assert.deepEqual(scope.messages.at(-1), {
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    requestId: 'reference-fixture',
    ok: true,
    result: { folders: 1, tracks: 7 }
  });
  uninstall();
});

test('Worker replaces an oversized repository response with a bounded typed error', async () => {
  const scope = createWorkerScope();
  const repository = {
    async getTrack() { return { title: 'x'.repeat(WEB_CATALOG_MAX_MESSAGE_BYTES) }; },
    close() {}
  };
  const uninstall = installWebCatalogWorker(scope, { repository });
  scope.dispatch({
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    requestId: 'large-response',
    method: 'getTrack',
    args: ['track-1']
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(scope.messages.at(-1).error.code, 'responseTooLarge');
  uninstall();
});

class FakeWorker {
  constructor() {
    this.listeners = { message: new Set(), error: new Set() };
    this.terminated = false;
    this.messages = [];
  }

  addEventListener(type, listener) {
    this.listeners[type].add(listener);
  }

  postMessage(message) {
    this.messages.push(message);
    queueMicrotask(() => {
      const response = message.method === 'getCounts'
        ? { tracks: 3 }
        : null;
      this.emit('message', {
        protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        ok: true,
        result: response
      });
    });
  }

  emit(type, data) {
    for (const listener of this.listeners[type]) listener({ data });
  }

  terminate() {
    this.terminated = true;
  }
}

test('client uses the dedicated Worker protocol and relays invalidation messages', async () => {
  const worker = new FakeWorker();
  const client = new WebCatalogRepositoryClient({ worker });
  assert.equal(client.appendPlaylistItems, undefined);
  assert.equal(client.publishPlaylist, undefined);
  assert.deepEqual(await client.getCounts(), { tracks: 3 });
  await client.resetCatalog();
  assert.equal(worker.messages.at(-1).method, 'resetCatalog');
  const invalidations = [];
  const unsubscribeInvalidations = client.subscribeInvalidations(event => invalidations.push(event));
  worker.emit('message', {
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    type: 'invalidation',
    invalidation: { catalogVersion: 4, changedScopes: ['tracks'] }
  });
  assert.deepEqual(invalidations, [{ catalogVersion: 4, changedScopes: ['tracks'] }]);
  unsubscribeInvalidations();
  worker.emit('message', {
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    type: 'invalidation',
    invalidation: { catalogVersion: 5, changedScopes: ['folders'] }
  });
  assert.deepEqual(invalidations, [{ catalogVersion: 4, changedScopes: ['tracks'] }]);
  await assert.rejects(
    client.getTrack('x'.repeat(WEB_CATALOG_MAX_MESSAGE_BYTES)),
    error => error.code === 'requestTooLarge'
  );
  assert.equal(worker.messages.length, 2);
  await client.close();
  assert.equal(worker.terminated, true);
  await assert.rejects(client.getCounts(), error => error?.code === 'workerClosed');
  const messageCount = worker.messages.length;
  await client.close();
  assert.equal(worker.messages.length, messageCount);
});

test('client maps its catalog, scan, operation, and playlist API to the versioned Worker protocol', async () => {
  const worker = new FakeWorker();
  const client = new WebCatalogRepositoryClient({ worker });
  const mappings = [
    ['open', [{ mode: 'readwrite' }], 'open'],
    ['getCapabilities', [], 'getCapabilities'],
    ['addFolder', [{ handle: { kind: 'directory', name: 'Music' } }], 'addFolder'],
    ['scanFolders', [{ folderIds: ['folder-1'] }], 'scanFolders'],
    ['cancelScan', [{ scanId: 'scan-1' }], 'cancelScan'],
    ['requestFolderAccess', [{ folderId: 'folder-1', handle: { kind: 'directory', name: 'Music' } }], 'requestFolderAccess'],
    ['removeFolder', [{ folderId: 'folder-1' }], 'removeFolder'],
    ['requestArtwork', [{ trackUid: 'track-1', reason: 'viewport' }], 'requestArtwork'],
    ['start', [{ operationKind: 'queue' }], 'startOperation'],
    ['status', ['operation-1'], 'getOperationStatus'],
    ['cancel', ['operation-1'], 'cancelOperation'],
    ['previewPlaylistImport', [{ source: { name: 'list.m3u8' } }], 'previewPlaylistImport'],
    ['commitPlaylistImportPreview', [{ previewToken: 'preview-1' }], 'commitPlaylistImportPreview'],
    ['cancelPlaylistImportPreview', [{ previewToken: 'preview-1' }], 'cancelPlaylistImportPreview'],
    ['getProvisionalEntry', ['operation-1'], 'getProvisionalEntry'],
    ['readSequencePage', [{ sequenceId: 'sequence-1', ordinal: 0 }], 'readSequencePage'],
    ['resolveSequenceEntrySource', [{ sequenceId: 'sequence-1', ordinal: 0 }], 'resolveSequenceEntrySource'],
    ['createContext', [{ endpoint: 'tracks', query: '' }], 'createContext'],
    ['releaseContext', ['context-1'], 'releaseContext'],
    ['queryTracks', [{ query: '', limit: 20 }], 'queryTracks'],
    ['queryEntities', [{ type: 'album', query: '', limit: 20 }], 'queryEntities'],
    ['getContextCount', [{ contextToken: 'context-1' }], 'getContextCount'],
    ['readContextPageAtOrdinal', [{ contextToken: 'context-1', ordinal: 0, limit: 20 }], 'readContextPageAtOrdinal'],
    ['resolveEntityAnchor', [{ contextToken: 'context-1', entityId: 'track-1' }], 'resolveEntityAnchor'],
    ['getTrack', ['track-1'], 'getTrack'],
    ['resolvePlaylistExportSource', ['track-1'], 'resolvePlaylistExportSource'],
    ['createPlaylist', [{ playlistId: 'playlist-1' }], 'createPlaylist'],
    ['createPlaylistWithItems', [{ playlistId: 'playlist-2', items: [] }], 'createPlaylistWithItems'],
    ['renamePlaylist', [{ playlistId: 'playlist-1', name: 'Renamed' }], 'renamePlaylist'],
    ['duplicatePlaylist', [{ playlistId: 'playlist-1', targetPlaylistId: 'playlist-2' }], 'duplicatePlaylist'],
    ['reorderPlaylistItem', [{ playlistId: 'playlist-1', itemKey: 1 }], 'reorderPlaylistItem'],
    ['removePlaylistItem', [{ playlistId: 'playlist-1', itemKey: 1 }], 'removePlaylistItem'],
    ['queryPlaylistItems', [{ playlistId: 'playlist-1', limit: 20 }], 'queryPlaylistItems'],
    ['tombstonePlaylist', [{ playlistId: 'playlist-1' }], 'tombstonePlaylist']
  ];

  for (const [clientMethod, args] of mappings) await client[clientMethod](...args);

  assert.deepEqual(worker.messages.map(message => ({ method: message.method, args: message.args })),
    mappings.map(([, args, workerMethod]) => ({ method: workerMethod, args })));
  await client.close();
  assert.equal(worker.messages.at(-1).method, 'close');
});

test('client relays scan and operation events and rejects every pending request after Worker failure', async () => {
  const worker = new FakeWorker();
  worker.postMessage = message => worker.messages.push(message);
  const client = new WebCatalogRepositoryClient({ worker });
  const scanEvents = [];
  const operationEvents = [];
  const folderRemovalEvents = [];
  const unsubscribeScan = client.subscribeScanProgress(event => scanEvents.push(event));
  const unsubscribeOperation = client.subscribeOperations(event => operationEvents.push(event));
  const unsubscribeFolderRemoval = client.subscribeFolderRemovalEvents(
    event => folderRemovalEvents.push(event)
  );

  worker.emit('message', {
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    type: 'scan-progress',
    progress: { scanId: 'scan-1', found: 2 }
  });
  worker.emit('message', {
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    type: 'library-service-event',
    event: { kind: 'terminal', operationId: 'operation-1' }
  });
  worker.emit('message', {
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    type: 'folder-removal-progress',
    progress: { folderId: 'folder-one', phase: 'removing', deleted: 1, total: 3 }
  });
  assert.deepEqual(scanEvents, [{ scanId: 'scan-1', found: 2 }]);
  assert.deepEqual(operationEvents, [{ kind: 'terminal', operationId: 'operation-1' }]);
  assert.deepEqual(folderRemovalEvents, [
    { folderId: 'folder-one', phase: 'removing', deleted: 1, total: 3 }
  ]);
  unsubscribeScan();
  unsubscribeOperation();
  unsubscribeFolderRemoval();
  assert.throws(() => client.subscribeScanProgress(null), /must be a function/);
  assert.throws(() => client.subscribeOperations(null), /must be a function/);
  assert.throws(() => client.subscribeFolderRemovalEvents(null), /must be a function/);

  const pending = Array.from({ length: 32 }, () => client.getCounts());
  await assert.rejects(client.getCounts(), error => error?.code === 'tooManyOutstandingRequests');
  for (const listener of worker.listeners.error) listener({ message: 'Worker stopped' });
  const settled = await Promise.allSettled(pending);
  assert.equal(settled.every(result => result.status === 'rejected' && result.reason.code === 'workerFailure'), true);
  assert.equal(client.pending.size, 0);
  await assert.rejects(client.getCounts(), error => error?.code === 'workerFailure');
  assert.equal(worker.messages.length, 32);
  await client.close();
  assert.equal(worker.terminated, true);
  await assert.rejects(client.getCounts(), error => error?.code === 'workerFailure');
});

test('client binds non-FSA session files before adding or reconnecting a folder', async () => {
  class SessionWorker extends FakeWorker {
    postMessage(message) {
      this.messages.push(message);
      queueMicrotask(() => {
        const result = message.method === 'beginSessionFolder'
          ? { token: `token-${message.requestId}` }
          : message.method === 'commitSessionFolder'
            ? { folder: { id: message.args[0].token } }
            : null;
        this.emit('message', {
          protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
          requestId: message.requestId,
          ok: true,
          result
        });
      });
    }
  }
  const worker = new SessionWorker();
  const client = new WebCatalogRepositoryClient({ worker });
  const sessionFiles = [
    { file: { name: 'One.flac' }, relativePath: 'Album/One.flac' },
    { file: { name: 'Two.flac' }, relativePath: 'Album/Two.flac' }
  ];

  await client.addFolder({
    sessionFiles,
    displayName: 'Imported Music',
    scan: true,
    scanReason: 'manual',
    languageHints: { language: 'ja' }
  });
  await client.requestFolderAccess({
    folderId: 'folder-session',
    sessionFiles,
    displayName: 'Imported Music'
  });

  assert.deepEqual(worker.messages.map(message => message.method), [
    'beginSessionFolder', 'appendSessionFolderFiles', 'commitSessionFolder',
    'beginSessionFolder', 'appendSessionFolderFiles', 'commitSessionFolder'
  ]);
  assert.deepEqual(worker.messages[0].args[0], {
    folderId: null,
    displayName: 'Imported Music'
  });
  assert.deepEqual(worker.messages[1].args[0].entries, sessionFiles);
  assert.equal(worker.messages[2].args[0].scan, true);
  assert.deepEqual(worker.messages[3].args[0], {
    folderId: 'folder-session',
    displayName: 'Imported Music'
  });
  assert.equal(worker.messages[5].args[0].scan, false);
  await client.close();
  assert.equal(worker.terminated, true);
});

test('client preserves a session append failure when cleanup also fails', async () => {
  class FailingSessionWorker extends FakeWorker {
    postMessage(message) {
      this.messages.push(message);
      queueMicrotask(() => {
        const result = message.method === 'beginSessionFolder' ? { token: 'token-failed' } : null;
        const code = message.method === 'appendSessionFolderFiles'
          ? 'sessionAppendFailed'
          : message.method === 'abortSessionFolder'
            ? 'sessionAbortFailed'
            : null;
        this.emit('message', {
          protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
          requestId: message.requestId,
          ok: code === null,
          result,
          error: code ? { code, message: code } : undefined
        });
      });
    }
  }
  const worker = new FailingSessionWorker();
  const client = new WebCatalogRepositoryClient({ worker });

  await assert.rejects(
    client.addFolder({
      displayName: 'Failed import',
      sessionFiles: [{ file: { name: 'One.flac' }, relativePath: 'One.flac' }]
    }),
    error => error?.code === 'sessionAppendFailed'
  );
  assert.deepEqual(worker.messages.map(message => message.method), [
    'beginSessionFolder',
    'appendSessionFolderFiles',
    'abortSessionFolder'
  ]);
  worker.terminate();
});
