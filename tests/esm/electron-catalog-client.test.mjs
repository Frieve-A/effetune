import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createElectronCatalogClient,
  ELECTRON_CATALOG_API_VERSION,
  ElectronCatalogClient
} from '../../js/library/repository/electron-catalog-client.js';

function createApi({ protocolVersion = 1 } = {}) {
  const calls = [];
  const api = {
    apiVersion: 1,
    async getCapabilities() {
      calls.push(['getCapabilities']);
      return { protocolVersion, maxQueryLimit: 500 };
    }
  };
  for (const method of [
    'getCounts',
    'createContext',
    'queryTracks',
    'queryEntities',
    'readContextPageAtOrdinal',
    'resolveEntityAnchor',
    'releaseContext',
    'getTrack',
    'resolvePlaybackSource',
    'showTrackInFolder',
    'createPlaylist',
    'createPlaylistWithItems',
    'renamePlaylist',
    'reorderPlaylistItem',
    'removePlaylistItem',
    'duplicatePlaylist',
    'queryPlaylistItems',
    'tombstonePlaylist',
    'addFolder',
    'requestFolderAccess',
    'scanFolders',
    'cancelScan',
    'removeFolder',
    'requestArtwork'
  ]) {
    api[method] = async value => {
      calls.push([method, value]);
      return { method, value };
    };
  }
  api.resolvePlaybackSource = async value => {
    calls.push(['resolvePlaybackSource', value]);
    return {
      kind: 'electron-file',
      trackUid: value,
      folderId: 'folder',
      lifecycleVersion: 1,
      path: '/Music/Track.flac'
    };
  };
  api.showTrackInFolder = async value => {
    calls.push(['showTrackInFolder', value]);
    return { success: true };
  };
  api.onInvalidation = listener => {
    calls.push(['onInvalidation', listener]);
    return () => calls.push(['unsubscribe']);
  };
  api.onScanEvent = listener => {
    calls.push(['onScanEvent', listener]);
    return () => calls.push(['unsubscribe-scan']);
  };
  api.onFolderRemovalEvent = listener => {
    calls.push(['onFolderRemovalEvent', listener]);
    return () => calls.push(['unsubscribe-folder-removal']);
  };
  return { api, calls };
}

test('Electron catalog client mirrors bounded repository read methods', async () => {
  const { api, calls } = createApi();
  const client = createElectronCatalogClient({ api });
  assert.ok(client instanceof ElectronCatalogClient);
  assert.equal(ELECTRON_CATALOG_API_VERSION, 1);
  assert.deepEqual(await client.getCapabilities(), { protocolVersion: 1, maxQueryLimit: 500 });
  assert.deepEqual(await client.getCounts(), { method: 'getCounts', value: {} });

  const requestMethods = [
    'createContext',
    'queryTracks',
    'queryEntities',
    'readContextPageAtOrdinal',
    'resolveEntityAnchor'
  ];
  for (const method of requestMethods) {
    const request = { method };
    assert.deepEqual(await client[method](request), { method, value: request });
  }
  assert.deepEqual(await client.releaseContext('ctx'), { method: 'releaseContext', value: 'ctx' });
  assert.deepEqual(await client.getTrack('track'), { method: 'getTrack', value: 'track' });
  assert.deepEqual(
    await client.resolvePlaybackSource('track'),
    {
      kind: 'electron-file',
      trackUid: 'track',
      folderId: 'folder',
      lifecycleVersion: 1,
      path: '/Music/Track.flac'
    }
  );
  assert.deepEqual(await client.showTrackInFolder('track'), { success: true });
  for (const method of [
    'createPlaylist',
    'createPlaylistWithItems',
    'renamePlaylist',
    'reorderPlaylistItem',
    'removePlaylistItem',
    'duplicatePlaylist',
    'queryPlaylistItems',
    'tombstonePlaylist'
  ]) {
    const request = { method };
    assert.deepEqual(await client[method](request), { method, value: request });
  }
  assert.equal(client.appendPlaylistItems, undefined);
  assert.equal(client.publishPlaylist, undefined);
  assert.deepEqual(await client.addFolder(), { method: 'addFolder', value: undefined });
  const languageHints = { language: 'ja', browserLanguage: 'ja-JP' };
  assert.deepEqual(await client.addFolder({ languageHints }), {
    method: 'addFolder', value: { languageHints }
  });
  assert.deepEqual(await client.requestFolderAccess('folder'), { method: 'requestFolderAccess', value: 'folder' });
  assert.deepEqual(await client.scanFolders({ folderIds: ['folder'] }), {
    method: 'scanFolders', value: { folderIds: ['folder'] }
  });
  assert.deepEqual(await client.scanFolders(['folder']), {
    method: 'scanFolders', value: { folderIds: ['folder'] }
  });
  assert.deepEqual(await client.scanFolders(null), {
    method: 'scanFolders', value: { folderIds: null }
  });
  assert.deepEqual(await client.cancelScan('scan'), { method: 'cancelScan', value: 'scan' });
  assert.deepEqual(await client.removeFolder('folder'), { method: 'removeFolder', value: 'folder' });
  assert.deepEqual(await client.requestArtwork({ trackUid: 'track', reason: 'viewport' }), {
    method: 'requestArtwork', value: { trackUid: 'track', reason: 'viewport' }
  });
  const listener = () => {};
  const unsubscribe = client.subscribeInvalidations(listener);
  unsubscribe();
  assert.ok(calls.some(call => call[0] === 'onInvalidation' && call[1] === listener));
  assert.equal(calls.at(-1)[0], 'unsubscribe');
  const scanListener = () => {};
  const unsubscribeScan = client.subscribeScanEvents(scanListener);
  unsubscribeScan();
  assert.ok(calls.some(call => call[0] === 'onScanEvent' && call[1] === scanListener));
  assert.equal(calls.at(-1)[0], 'unsubscribe-scan');
  const folderRemovalListener = () => {};
  const unsubscribeFolderRemoval = client.subscribeFolderRemovalEvents(folderRemovalListener);
  unsubscribeFolderRemoval();
  assert.ok(calls.some(call => (
    call[0] === 'onFolderRemovalEvent' && call[1] === folderRemovalListener
  )));
  assert.equal(calls.at(-1)[0], 'unsubscribe-folder-removal');
});

test('Electron catalog client restores a typed folder permission error from the control IPC envelope', async () => {
  const { api } = createApi();
  api.resolvePlaybackSource = async () => ({
    code: 'folderPermissionRequired',
    details: { folderId: 'folder-7', lifecycleVersion: 7 }
  });
  const client = createElectronCatalogClient({ api });

  await assert.rejects(
    client.resolvePlaybackSource('track'),
    error => error?.name === 'LibraryRepositoryError' &&
      error?.code === 'folderPermissionRequired' &&
      error?.details?.folderId === 'folder-7' &&
      error?.details?.lifecycleVersion === 7
  );

  api.showTrackInFolder = async () => ({
    code: 'folderPermissionRequired',
    details: { folderId: 'folder-7', lifecycleVersion: 7 }
  });
  await assert.rejects(
    client.showTrackInFolder('track'),
    error => error?.name === 'LibraryRepositoryError' &&
      error?.code === 'folderPermissionRequired' &&
      error?.details?.folderId === 'folder-7' &&
      error?.details?.lifecycleVersion === 7
  );
});

test('Electron catalog client rejects a playback source that is not an absolute path', async () => {
  const { api } = createApi();
  api.resolvePlaybackSource = async () => ({ kind: 'electron-file', path: 'Music/Track.flac' });
  const client = createElectronCatalogClient({ api });

  await assert.rejects(
    client.resolvePlaybackSource('track'),
    /playback source response is invalid/
  );
});

test('Electron catalog client starts the first scan when an older add response has no receipt', async () => {
  const { api, calls } = createApi();
  api.addFolder = async request => {
    calls.push(['addFolder', request]);
    return { canceled: false, folder: { id: 'folder-new', displayName: 'Music' } };
  };
  const client = createElectronCatalogClient({ api });
  const languageHints = { language: 'ja', browserLanguage: 'ja-JP' };

  const result = await client.addFolder({ languageHints });
  assert.deepEqual(calls.slice(-2), [
    ['addFolder', { languageHints }],
    ['scanFolders', { folderIds: ['folder-new'], scanReason: 'automatic', languageHints }]
  ]);
  assert.deepEqual(result.scan, {
    method: 'scanFolders',
    value: { folderIds: ['folder-new'], scanReason: 'automatic', languageHints }
  });
});

test('Electron catalog client does not scan after a rejected folder selection', async () => {
  const { api, calls } = createApi();
  api.addFolder = async request => {
    calls.push(['addFolder', request]);
    return { canceled: false, rejected: true, reason: 'same-root' };
  };
  const client = createElectronCatalogClient({ api });

  const result = await client.addFolder();
  assert.equal(result.rejected, true);
  assert.equal(calls.filter(call => call[0] === 'scanFolders').length, 0);
});

test('Electron catalog client rejects unavailable or mismatched API versions', async () => {
  assert.throws(() => new ElectronCatalogClient({ api: null }), /API v1 is unavailable/);
  assert.throws(() => new ElectronCatalogClient({ api: { apiVersion: 2 } }), /API v1 is unavailable/);
  const { api } = createApi({ protocolVersion: 2 });
  const client = new ElectronCatalogClient({ api });
  await assert.rejects(client.getCapabilities(), /protocol version mismatch/);
  assert.throws(() => client.subscribeInvalidations(null), /must be a function/);
  assert.throws(() => client.subscribeScanEvents(null), /must be a function/);
  assert.throws(() => client.subscribeFolderRemovalEvents(null), /must be a function/);
});
