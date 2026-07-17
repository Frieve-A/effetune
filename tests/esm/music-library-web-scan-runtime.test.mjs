import assert from 'node:assert/strict';
import test from 'node:test';

import { WebCatalogScanRuntime } from '../../js/library/scan/web-scan-runtime.js';

async function withTimeout(promise, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 1_000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('Web scan discovers playlist files, imports them after track enumeration, and reports repeats', async () => {
  const playlistBytes = new TextEncoder().encode('#EXTM3U\none.mp3\n');
  const playlistFile = {
    name: 'Daily.m3u8',
    size: playlistBytes.byteLength,
    lastModified: 100,
    type: 'audio/x-mpegurl',
    stream() {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(playlistBytes);
          controller.close();
        }
      });
    }
  };
  const fileHandles = new Map([
    ['one.mp3', { kind: 'file', name: 'one.mp3', getFile: async () => ({ name: 'one.mp3', size: 3, lastModified: 100 }) }],
    ['Daily.m3u8', { kind: 'file', name: 'Daily.m3u8', getFile: async () => playlistFile }]
  ]);
  const rootHandle = {
    kind: 'directory',
    name: 'Music',
    queryPermission: async () => 'granted',
    async *values() { yield* fileHandles.values(); },
    getFileHandle: async name => fileHandles.get(name)
  };
  const handles = new Map();
  const handleStore = {
    list: async () => [],
    put: async ({ folderId, handle }) => handles.set(folderId, handle),
    get: async folderId => handles.get(folderId),
    delete: async folderId => handles.delete(folderId),
    close() {}
  };
  const folders = [];
  const repository = {
    upsertFolders: async rows => folders.push(...rows),
    listFolderRecords: async () => folders,
    setFolderAvailability: async ({ folderId, status }) => {
      const folder = folders.find(item => item.id === folderId);
      folder.status = status;
      return folder;
    },
    tombstoneFolder: async () => { throw new Error('not expected'); },
    runFolderDeletion: async () => { throw new Error('not expected'); },
    getScanFolderTrackCount: async () => ({ trackCount: 0 })
  };
  const progress = [];
  const requests = [];
  let automaticState = { state: 'missing', version: null, contentDigest: null };
  const playlistImportService = {
    async getAutomaticPlaylistImportState() {
      return automaticState;
    },
    async startAutomaticPlaylistImport(request) {
      requests.push(request);
      return { kind: 'started', operationId: 'operation-1' };
    },
    async waitForTerminal() {
      automaticState = {
        state: 'active',
        version: 1,
        contentDigest: requests.at(-1).options.automaticSource.contentDigest
      };
      return { terminalKind: 'success', result: { state: 'succeeded' } };
    },
    cancel: async () => ({ kind: 'cancelRequested' })
  };
  const runtime = new WebCatalogScanRuntime({
    repository,
    handleStore,
    playlistImportService,
    idFactory: () => 'folder-id',
    onProgress: event => progress.push(event),
    scanServiceFactory: ({ filesystem, onProgress }) => ({
      async runFolder({ folder }) {
        const audioFiles = [];
        for await (const entry of filesystem.enumerateDirectory({ relativeDirectory: '' })) {
          if (entry.kind === 'file') audioFiles.push(entry.relativePath);
        }
        assert.deepEqual(audioFiles, ['one.mp3']);
        const result = {
          folderId: folder.id,
          generation: 1,
          status: 'completed',
          continuityBroken: false,
          sweepEligibility: 'ELIGIBLE',
          counts: { found: 1 }
        };
        onProgress(result);
        return result;
      }
    })
  });

  const added = await runtime.addFolder({ handle: rootHandle });
  assert.equal(added.scan.counts.playlistsFound, 1);
  assert.equal(added.scan.counts.playlistsImported, 1);
  assert.equal(added.scan.playlistImportState, 'completed');
  assert.equal(added.scan.counts.playlistImportsCanceled, 0);
  assert.equal(progress.length, 1);
  assert.equal(progress[0].counts.playlistsImported, 1);
  assert.equal(requests[0].options.name, 'Daily');
  assert.equal(requests[0].options.source, playlistFile);

  const rescanned = await runtime.scanFolders({ folderIds: [added.folder.id] });
  assert.equal(rescanned.results[0].counts.playlistsImported, 0);
  assert.equal(rescanned.results[0].counts.playlistsAlreadyImported, 1);
  assert.equal(requests.length, 1);
  runtime.close();
});

test('Web scan remains completed while reporting playlist-import-canceled explicitly', async () => {
  const bytes = new TextEncoder().encode('#EXTM3U\none.mp3\n');
  const playlistFile = {
    name: 'Cancel.m3u8', size: bytes.byteLength, lastModified: 1, type: '',
    stream() {
      return new ReadableStream({
        start(controller) { controller.enqueue(bytes); controller.close(); }
      });
    }
  };
  const fileHandle = { kind: 'file', name: playlistFile.name, getFile: async () => playlistFile };
  const rootHandle = {
    kind: 'directory',
    name: 'Music',
    queryPermission: async () => 'granted',
    async *values() { yield fileHandle; },
    getFileHandle: async () => fileHandle
  };
  const folder = {
    id: 'folder-cancel-import', kind: 'web', displayName: 'Music',
    status: 'active', lifecycleVersion: 1, normalizedRoot: 'Music'
  };
  let importStarted;
  const importStartedPromise = new Promise(resolve => { importStarted = resolve; });
  let finishImport;
  const importTerminal = new Promise(resolve => { finishImport = resolve; });
  let cancelCalls = 0;
  const runtime = new WebCatalogScanRuntime({
    repository: {
      listFolderRecords: async () => [folder],
      upsertFolders: async () => {},
      setFolderAvailability: async () => folder,
      tombstoneFolder: async () => { throw new Error('not expected'); },
      runFolderDeletion: async () => { throw new Error('not expected'); },
      getScanFolderTrackCount: async () => ({ trackCount: 0 })
    },
    handleStore: {
      list: async () => [{ folderId: folder.id, handle: rootHandle }],
      put: async () => {},
      get: async () => rootHandle,
      delete: async () => {},
      close() {}
    },
    playlistImportService: {
      async getAutomaticPlaylistImportState() {
        return { state: 'missing', version: null, contentDigest: null };
      },
      async startAutomaticPlaylistImport() {
        importStarted();
        return { kind: 'started', operationId: 'cancel-operation' };
      },
      waitForTerminal: async () => importTerminal,
      async cancel() {
        cancelCalls += 1;
        finishImport({ terminalKind: 'cancelled', result: { state: 'cancelled' } });
        return { kind: 'cancelRequested' };
      }
    },
    scanServiceFactory: ({ filesystem }) => ({
      async runFolder({ folder: scannedFolder }) {
        for await (const _entry of filesystem.enumerateDirectory({ relativeDirectory: '' })) {
          // Enumerating reports playlist files through the adapter callback.
        }
        return {
          folderId: scannedFolder.id,
          generation: 1,
          status: 'completed',
          continuityBroken: false,
          sweepEligibility: 'ELIGIBLE',
          counts: { found: 0 }
        };
      }
    })
  });

  const pending = runtime.scanFolders({
    folderIds: [folder.id],
    scanId: 'scan-cancel-import'
  });
  await withTimeout(importStartedPromise, 'playlist import did not start');
  assert.deepEqual(runtime.cancelScan({ scanId: 'scan-cancel-import' }), { accepted: true });
  const result = await withTimeout(pending, 'playlist import did not cancel');
  assert.equal(result.results[0].status, 'completed');
  assert.equal(result.results[0].playlistImportState, 'playlist-import-canceled');
  assert.equal(result.results[0].counts.playlistImportsCanceled, 1);
  assert.equal(cancelCalls, 1);
  runtime.close();
});

test('canceling a Web scan resolves as paused and does not start the next folder', async () => {
  const folders = ['one', 'two'].map(name => ({
    id: `folder-${name}`,
    kind: 'web',
    displayName: name,
    status: 'active',
    lifecycleVersion: 1,
    normalizedRoot: name
  }));
  const handles = new Map(folders.map(folder => [folder.id, {
    kind: 'directory',
    name: folder.displayName,
    queryPermission: async () => 'granted',
    async *values() {}
  }]));
  const progress = [];
  const scannedFolders = [];
  const scanIds = ['one', 'two'];
  let scanStarted;
  const scanStartedPromise = new Promise(resolve => { scanStarted = resolve; });
  const runtime = new WebCatalogScanRuntime({
    repository: {
      listFolderRecords: async () => folders,
      upsertFolders: async () => {},
      setFolderAvailability: async ({ folderId }) => folders.find(folder => folder.id === folderId),
      tombstoneFolder: async () => { throw new Error('not expected'); },
      runFolderDeletion: async () => { throw new Error('not expected'); },
      getScanFolderTrackCount: async () => ({ trackCount: 0 })
    },
    handleStore: {
      list: async () => [...handles].map(([folderId, handle]) => ({ folderId, handle })),
      put: async ({ folderId, handle }) => handles.set(folderId, handle),
      get: async folderId => handles.get(folderId) ?? null,
      delete: async folderId => handles.delete(folderId),
      close() {}
    },
    idFactory: () => scanIds.shift(),
    onProgress: event => progress.push(event),
    scanServiceFactory: ({ onProgress }) => ({
      async runFolder({ scanId, folder, signal }) {
        scannedFolders.push(folder.id);
        onProgress({
          scanId,
          folderId: folder.id,
          generation: 4,
          status: 'metadata',
          continuityBroken: false,
          sweepEligibility: 'PENDING',
          counts: { found: 9, parsed: 3 }
        });
        scanStarted();
        await new Promise((resolve, reject) => {
          const abort = () => reject(signal.reason);
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        });
      }
    })
  });

  const pending = runtime.scanFolders({ folderIds: folders.map(folder => folder.id) });
  await withTimeout(scanStartedPromise, 'Web scan did not start');
  assert.deepEqual(runtime.cancelScan({ scanId: 'web-scan-one' }), { accepted: true });
  const result = await withTimeout(pending, 'Web scan cancellation did not settle');

  assert.deepEqual(scannedFolders, ['folder-one']);
  assert.deepEqual(result.results, [{
    scanId: 'web-scan-one',
    folderId: 'folder-one',
    generation: 4,
    status: 'paused',
    continuityBroken: true,
    sweepEligibility: 'INELIGIBLE',
    counts: { found: 9, parsed: 3 }
  }]);
  assert.deepEqual(progress.at(-1), result.results[0]);
  assert.equal(runtime.activeScans.size, 0);
  runtime.close();
});

test('Web folder registration compensates handle persistence when catalog registration fails', async () => {
  const handles = new Map();
  const handle = {
    kind: 'directory',
    name: 'Music',
    queryPermission: async () => 'granted',
    async *values() {}
  };
  const runtime = new WebCatalogScanRuntime({
    repository: {
      listFolderRecords: async () => [],
      upsertFolders: async () => { throw new Error('catalog write failed'); },
      setFolderAvailability: async () => {},
      tombstoneFolder: async () => {},
      runFolderDeletion: async () => {},
      getScanFolderTrackCount: async () => ({ trackCount: 0 })
    },
    handleStore: {
      list: async () => [...handles].map(([folderId, storedHandle]) => ({ folderId, handle: storedHandle })),
      put: async ({ folderId, handle: storedHandle }) => handles.set(folderId, storedHandle),
      get: async folderId => handles.get(folderId) ?? null,
      delete: async folderId => handles.delete(folderId),
      close() {}
    },
    idFactory: () => 'registration-failure'
  });

  await assert.rejects(runtime.addFolder({ handle, scan: false }), /catalog write failed/);
  assert.equal(handles.size, 0);
  runtime.close();
});

test('Web folder registration rejects exact and nested roots and requires parent confirmation', async () => {
  const createHandle = (name, rootKey, resolve = () => null) => ({
    kind: 'directory',
    name,
    rootKey,
    queryPermission: async () => 'granted',
    isSameEntry: async other => other?.rootKey === rootKey,
    resolve: async other => resolve(other),
    async *values() {}
  });
  const child = createHandle('Album', 'child');
  const parent = createHandle('Music', 'parent', other => (
    other?.rootKey === 'child' ? ['Album'] : null
  ));
  const ancestor = createHandle('Home', 'ancestor', other => (
    other?.rootKey === 'parent' ? ['Music'] :
      other?.rootKey === 'child' ? ['Music', 'Album'] : null
  ));
  const parentReselection = createHandle('Music', 'parent');
  const handles = new Map();
  const folders = [];
  const ids = ['parent'];
  const runtime = new WebCatalogScanRuntime({
    repository: {
      async upsertFolders(rows) { folders.push(...rows); },
      async listFolderRecords() { return folders; },
      async setFolderAvailability({ folderId, status }) {
        const folder = folders.find(item => item.id === folderId);
        folder.status = status;
        return folder;
      },
      async tombstoneFolder() { throw new Error('not expected'); },
      async runFolderDeletion() { throw new Error('not expected'); },
      async getScanFolderTrackCount() { return { trackCount: 0 }; }
    },
    handleStore: {
      async list() {
        return [...handles].map(([folderId, handle]) => ({ folderId, handle }));
      },
      async put({ folderId, handle }) { handles.set(folderId, handle); },
      async get(folderId) { return handles.get(folderId) ?? null; },
      async delete(folderId) { handles.delete(folderId); },
      close() {}
    },
    idFactory: () => ids.shift()
  });

  const addedParent = await runtime.addFolder({ handle: parent, scan: false });
  const rejectedChild = await runtime.addFolder({ handle: child, scan: false });
  const parentConfirmation = await runtime.addFolder({ handle: ancestor, scan: false });
  const rejectedExact = await runtime.addFolder({ handle: parentReselection, scan: false });
  const broken = createHandle('Broken', 'broken', () => {
    throw new DOMException('Permission lost', 'NotAllowedError');
  });

  await assert.rejects(
    runtime.addFolder({ handle: broken, scan: false }),
    error => error?.code === 'folderContainmentUnavailable'
  );
  assert.equal(addedParent.folder.id, 'web-folder-parent');
  assert.deepEqual({ rejected: rejectedChild.rejected, reason: rejectedChild.reason }, {
    rejected: true,
    reason: 'descendant-root'
  });
  assert.deepEqual(parentConfirmation, {
    canceled: false,
    confirmationRequired: true,
    candidate: { displayName: 'Home' },
    contained: [{ id: addedParent.folder.id, displayName: 'Music' }]
  });
  assert.deepEqual({ rejected: rejectedExact.rejected, reason: rejectedExact.reason }, {
    rejected: true,
    reason: 'same-root'
  });
  assert.equal(folders.length, 1);
  runtime.close();
});

test('Web permission initialization joins catalog roots and removes orphan or tombstoned handles', async () => {
  const activeHandle = {
    kind: 'directory', name: 'Active', queryPermission: async () => 'granted', async *values() {}
  };
  const staleHandle = {
    kind: 'directory', name: 'Stale', queryPermission: async () => 'granted', async *values() {}
  };
  const handles = new Map([
    ['active', activeHandle],
    ['removed', staleHandle],
    ['orphan', staleHandle]
  ]);
  const availability = [];
  const removals = [];
  const runtime = new WebCatalogScanRuntime({
    repository: {
      listFolderRecords: async () => [
        { id: 'active', status: 'needs-permission' },
        { id: 'removed', status: 'removed' }
      ],
      upsertFolders: async () => {},
      setFolderAvailability: async request => { availability.push(request); return request; },
      tombstoneFolder: async () => {},
      runFolderDeletion: async () => {},
      getScanFolderTrackCount: async ({ folderId }) => ({
        trackCount: folderId === 'removed' ? 3 : 0
      })
    },
    handleStore: {
      list: async () => [...handles].map(([folderId, handle]) => ({ folderId, handle })),
      put: async ({ folderId, handle }) => handles.set(folderId, handle),
      get: async folderId => handles.get(folderId) ?? null,
      delete: async folderId => handles.delete(folderId),
      close() {}
    },
    onFolderRemoval: progress => removals.push(progress)
  });

  assert.deepEqual(await runtime.initializePermissions(), { checked: 1, cleaned: 2 });
  assert.deepEqual([...handles.keys()], ['active']);
  assert.deepEqual(availability, [{ folderId: 'active', status: 'active' }]);
  assert.deepEqual(removals, [{
    folderId: 'removed', phase: 'removing', deleted: 0, total: 3
  }]);
  runtime.close();
});

test('Web folder removal reports foreground progress and includes the tombstone deletion chunk', async () => {
  const folder = {
    id: 'folder-remove', kind: 'web', displayName: 'Music',
    status: 'active', lifecycleVersion: 3
  };
  const removals = [];
  const deletionCalls = [];
  let handleDeleted = false;
  const runtime = new WebCatalogScanRuntime({
    repository: {
      listFolderRecords: async () => [folder],
      upsertFolders: async () => {},
      setFolderAvailability: async () => folder,
      getScanFolderTrackCount: async () => ({ trackCount: 2 }),
      tombstoneFolder: async () => ({
        folder: { ...folder, status: 'removed', lifecycleVersion: 4 },
        deletion: { folderId: folder.id, lifecycleVersion: 4, deleted: 1, hasMore: true }
      }),
      async runFolderDeletion(request) {
        deletionCalls.push(request);
        return deletionCalls.length === 1
          ? { ...request, deleted: 1, hasMore: true }
          : { ...request, deleted: 0, hasMore: false };
      }
    },
    handleStore: {
      list: async () => [],
      put: async () => {},
      get: async () => null,
      delete: async () => { handleDeleted = true; },
      close() {}
    },
    onFolderRemoval: progress => removals.push(progress)
  });

  const result = await runtime.removeFolder({ folderId: folder.id });
  assert.equal(result.deletion.deleted, 2);
  assert.deepEqual(deletionCalls, [
    { folderId: folder.id, lifecycleVersion: 4 },
    { folderId: folder.id, lifecycleVersion: 4 }
  ]);
  assert.equal(handleDeleted, true);
  assert.deepEqual(removals, [
    { folderId: folder.id, phase: 'removing', deleted: 0, total: 2 },
    { folderId: folder.id, phase: 'done', deleted: 2, total: 2 }
  ]);
  runtime.close();
});

test('Web folder removal continues tombstone deletion when persisted handle cleanup fails', async () => {
  const folder = {
    id: 'folder-remove-handle-failure', kind: 'web', displayName: 'Music',
    status: 'active', lifecycleVersion: 2
  };
  const removals = [];
  let deletionCalls = 0;
  const runtime = new WebCatalogScanRuntime({
    repository: {
      listFolderRecords: async () => [folder],
      upsertFolders: async () => {},
      setFolderAvailability: async () => folder,
      getScanFolderTrackCount: async () => ({ trackCount: 1 }),
      tombstoneFolder: async () => ({
        folder: { ...folder, status: 'removed', lifecycleVersion: 3 },
        deletion: { folderId: folder.id, lifecycleVersion: 3, deleted: 0, hasMore: true }
      }),
      async runFolderDeletion(request) {
        deletionCalls += 1;
        return { ...request, deleted: 1, hasMore: false };
      }
    },
    handleStore: {
      list: async () => [],
      put: async () => {},
      get: async () => null,
      delete: async () => { throw new Error('handle cleanup failed'); },
      close() {}
    },
    onFolderRemoval: progress => removals.push(progress)
  });

  const result = await runtime.removeFolder({ folderId: folder.id });
  assert.equal(result.deletion.deleted, 1);
  assert.equal(deletionCalls, 1);
  assert.deepEqual(removals, [
    { folderId: folder.id, phase: 'removing', deleted: 0, total: 1 },
    { folderId: folder.id, phase: 'done', deleted: 1, total: 1 }
  ]);
  runtime.close();
});

test('non-FSA folder files stay session-only and reconnect catalog tracks by relative path', async () => {
  const folders = [];
  const repository = {
    async listFolderRecords() { return folders; },
    async upsertFolders(rows) { folders.push(...rows); },
    async setFolderAvailability({ folderId, status }) {
      const folder = folders.find(item => item.id === folderId);
      folder.status = status;
      return folder;
    },
    async tombstoneFolder() { throw new Error('not expected'); },
    async runFolderDeletion() { throw new Error('not expected'); },
    async getScanFolderTrackCount() { return { trackCount: 0 }; }
  };
  const handleStore = {
    async list() { return []; },
    async get() { return null; },
    async put() { throw new Error('session files must not be persisted as handles'); },
    async delete() {},
    close() {}
  };
  const file = { name: 'Song.flac', size: 4, lastModified: 100 };
  const first = new WebCatalogScanRuntime({ repository, handleStore, idFactory: () => 'session-id' });
  const begun = await first.beginSessionFolder({ displayName: 'Music' });
  await first.appendSessionFolderFiles({
    token: begun.token,
    entries: [{ relativePath: 'Album/Song.flac', file }]
  });
  const added = await first.commitSessionFolder({ token: begun.token, scan: false });
  assert.equal(added.folder.kind, 'web-session');
  assert.equal(await first.resolveTrackFile({
    folderId: added.folder.id,
    relativePath: 'Album/Song.flac',
    lifecycleVersion: 0
  }), file);
  first.close();

  const restored = new WebCatalogScanRuntime({ repository, handleStore, idFactory: () => 'restore-id' });
  await restored.initializePermissions();
  assert.equal(folders[0].status, 'needs-permission');
  await assert.rejects(
    restored.resolveTrackFile({
      folderId: added.folder.id,
      relativePath: 'Album/Song.flac',
      lifecycleVersion: 0
    }),
    error => error.code === 'folderPermissionRequired'
  );

  const rebound = await restored.beginSessionFolder({ folderId: added.folder.id, displayName: 'Music' });
  await restored.appendSessionFolderFiles({
    token: rebound.token,
    entries: [{ relativePath: 'Album/Song.flac', file }]
  });
  await restored.commitSessionFolder({ token: rebound.token, scan: false });
  assert.equal(await restored.resolveTrackFile({
    folderId: added.folder.id,
    relativePath: 'Album/Song.flac',
    lifecycleVersion: 0
  }), file);
  restored.close();
});
