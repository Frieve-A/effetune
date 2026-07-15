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
    'readContextPage',
    'readContextPageAtOrdinal',
    'resolveEntityAnchor',
    'releaseContext',
    'getTrack',
    'resolvePlaybackSource',
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
    'requestArtwork',
    'getScanStatus'
  ]) {
    api[method] = async value => {
      calls.push([method, value]);
      return { method, value };
    };
  }
  api.onInvalidation = listener => {
    calls.push(['onInvalidation', listener]);
    return () => calls.push(['unsubscribe']);
  };
  api.onScanEvent = listener => {
    calls.push(['onScanEvent', listener]);
    return () => calls.push(['unsubscribe-scan']);
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
    'readContextPage',
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
    { method: 'resolvePlaybackSource', value: 'track' }
  );
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
  assert.deepEqual(await client.getScanStatus('scan'), { method: 'getScanStatus', value: 'scan' });
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
});

test('Electron catalog client starts the first scan when an older add response has no receipt', async () => {
  const { api, calls } = createApi();
  api.addFolder = async () => {
    calls.push(['addFolder', undefined]);
    return { canceled: false, folder: { id: 'folder-new', displayName: 'Music' } };
  };
  const client = createElectronCatalogClient({ api });

  const result = await client.addFolder();
  assert.deepEqual(calls.slice(-2), [
    ['addFolder', undefined],
    ['scanFolders', { folderIds: ['folder-new'], scanReason: 'automatic' }]
  ]);
  assert.deepEqual(result.scan, {
    method: 'scanFolders',
    value: { folderIds: ['folder-new'], scanReason: 'automatic' }
  });
});

test('Electron catalog client rejects unavailable or mismatched API versions', async () => {
  assert.throws(() => new ElectronCatalogClient({ api: null }), /API v1 is unavailable/);
  assert.throws(() => new ElectronCatalogClient({ api: { apiVersion: 2 } }), /API v1 is unavailable/);
  const { api } = createApi({ protocolVersion: 2 });
  const client = new ElectronCatalogClient({ api });
  await assert.rejects(client.getCapabilities(), /protocol version mismatch/);
  assert.throws(() => client.subscribeInvalidations(null), /must be a function/);
  assert.throws(() => client.subscribeScanEvents(null), /must be a function/);
});
