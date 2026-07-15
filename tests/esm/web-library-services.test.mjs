import assert from 'node:assert/strict';
import test from 'node:test';

import { WebFolderHandleStore } from '../../js/library/scan/web-folder-handle-store.js';
import { createWebLibraryServices } from '../../js/library/scan/web-library-services.js';
import { createFakeIndexedDb } from './web-folder-handle-store-fake-idb.mjs';

test('Web folder services select an FSA directory and reconnect its persisted permission grant', async () => {
  const indexedDB = createFakeIndexedDb();
  const pickerRequests = [];
  const clientCalls = [];
  let persisted = 0;
  let permissionRequests = 0;
  const handle = {
    kind: 'directory',
    name: 'Music',
    async *values() {},
    async queryPermission(options) {
      assert.deepEqual(options, { mode: 'read' });
      return 'prompt';
    },
    async requestPermission(options) {
      assert.deepEqual(options, { mode: 'read' });
      permissionRequests += 1;
      return 'granted';
    }
  };
  const windowRef = {
    indexedDB,
    navigator: { storage: { async persist() { persisted += 1; return true; } } },
    async showDirectoryPicker(options) {
      pickerRequests.push(options);
      return handle;
    }
  };
  const client = {
    async addFolder(request) {
      clientCalls.push(['addFolder', request]);
      return { folder: { id: 'folder-fsa' } };
    },
    async requestFolderAccess(request) {
      clientCalls.push(['requestFolderAccess', request]);
      return { folder: { id: request.folderId } };
    }
  };
  const services = createWebLibraryServices({ client, windowRef });

  await services.folderService.addFolder({
    scan: false,
    scanReason: 'manual',
    languageHints: { language: 'ja' }
  });
  const store = new WebFolderHandleStore({ indexedDB });
  await store.put({ folderId: 'folder-fsa', handle });
  await services.folderService.requestFolderAccess('folder-fsa');
  store.close();

  assert.deepEqual(pickerRequests, [{ mode: 'read', startIn: 'music', id: 'effetune-library-v2' }]);
  assert.equal(permissionRequests, 1);
  assert.equal(persisted, 2);
  assert.deepEqual(clientCalls, [
    ['addFolder', {
      handle,
      displayName: 'Music',
      scan: false,
      scanReason: 'manual',
      languageHints: { language: 'ja' }
    }],
    ['requestFolderAccess', { folderId: 'folder-fsa', handle, displayName: 'Music' }]
  ]);
});

test('Web folder services connect non-FSA directory files as a bounded session source', async () => {
  const files = [
    { name: 'One.flac', webkitRelativePath: 'Music/Album/One.flac' },
    { name: 'Two.flac', webkitRelativePath: 'Music/Two.flac' }
  ];
  const clientCalls = [];
  let createdInput = null;
  let focusListener = null;
  const windowRef = {
    navigator: { storage: { async persist() { return true; } } },
    document: {
      body: { appendChild() {} },
      createElement(tagName) {
        assert.equal(tagName, 'input');
        const listeners = new Map();
        createdInput = {
          style: {},
          files: [],
          addEventListener(type, listener) { listeners.set(type, listener); },
          remove() {},
          click() {
            focusListener?.();
            this.files = files;
            listeners.get('change')?.();
          }
        };
        return createdInput;
      }
    },
    addEventListener(type, listener) {
      if (type === 'focus') focusListener = listener;
    },
    removeEventListener(type, listener) {
      if (type === 'focus' && focusListener === listener) focusListener = null;
    }
  };
  const client = {
    async addFolder(request) {
      clientCalls.push(['addFolder', request]);
      return { folder: { id: 'folder-session' } };
    },
    async requestFolderAccess(request) {
      clientCalls.push(['requestFolderAccess', request]);
      return { folder: { id: request.folderId } };
    }
  };
  const services = createWebLibraryServices({ client, windowRef });

  await services.folderService.addFolder();
  await services.folderService.requestFolderAccess('folder-session', {
    files,
    displayName: 'Reconnected Music'
  });

  assert.equal(createdInput.type, 'file');
  assert.equal(createdInput.multiple, true);
  assert.equal(createdInput.webkitdirectory, true);
  assert.deepEqual(clientCalls.map(([method, request]) => ({
    method,
    folderId: request.folderId ?? null,
    displayName: request.displayName,
    relativePaths: request.sessionFiles.map(entry => entry.relativePath)
  })), [
    {
      method: 'addFolder',
      folderId: null,
      displayName: 'Music',
      relativePaths: ['Album/One.flac', 'Two.flac']
    },
    {
      method: 'requestFolderAccess',
      folderId: 'folder-session',
      displayName: 'Reconnected Music',
      relativePaths: ['Album/One.flac', 'Two.flac']
    }
  ]);
});

test('Web folder services confirm a parent merge once and remove children before adding it', async () => {
  const parent = { kind: 'directory', name: 'Music', async *values() {} };
  const calls = [];
  let addCount = 0;
  let confirmationCount = 0;
  const client = {
    async addFolder(request) {
      calls.push(['addFolder', request.handle]);
      addCount += 1;
      return addCount === 1
        ? {
          confirmationRequired: true,
          candidate: { displayName: 'Music' },
          contained: [
            { id: 'child-a', displayName: 'Album A' },
            { id: 'child-b', displayName: 'Album B' }
          ]
        }
        : { folder: { id: 'parent' }, scan: { status: 'completed' } };
    },
    async removeFolder(request) {
      calls.push(['removeFolder', request.folderId]);
      return { folder: { id: request.folderId, status: 'removed' } };
    }
  };
  const windowRef = {
    navigator: { storage: { async persist() { return true; } } },
    confirm(message) {
      confirmationCount += 1;
      assert.equal(message, 'Localized parent merge confirmation');
      return true;
    }
  };
  const services = createWebLibraryServices({
    client,
    windowRef,
    translate: key => key === 'library.confirm.mergeFolders'
      ? 'Localized parent merge confirmation'
      : key
  });

  const result = await services.folderService.addFolder({ handle: parent, scan: true });

  assert.equal(result.folder.id, 'parent');
  assert.equal(confirmationCount, 1);
  assert.deepEqual(calls, [
    ['addFolder', parent],
    ['removeFolder', 'child-a'],
    ['removeFolder', 'child-b'],
    ['addFolder', parent]
  ]);
});

test('canceling a Web parent merge leaves existing roots unchanged', async () => {
  const parent = { kind: 'directory', name: 'Music', async *values() {} };
  const calls = [];
  const client = {
    async addFolder(request) {
      calls.push(['addFolder', request.handle]);
      return {
        confirmationRequired: true,
        contained: [{ id: 'child-a', displayName: 'Album A' }]
      };
    },
    async removeFolder(request) {
      calls.push(['removeFolder', request.folderId]);
    }
  };
  const services = createWebLibraryServices({
    client,
    windowRef: {
      navigator: { storage: { async persist() { return true; } } },
      confirm: () => false
    }
  });

  assert.deepEqual(await services.folderService.addFolder({ handle: parent }), { canceled: true });
  assert.deepEqual(calls, [['addFolder', parent]]);
});

test('Web folder and scan service facades preserve command argument contracts', async () => {
  const calls = [];
  const client = {
    async removeFolder(request) {
      calls.push(['removeFolder', request]);
      return { removed: true };
    },
    async scanFolders(request) {
      calls.push(['scanFolders', request]);
      return { scanId: 'scan-1' };
    },
    async cancelScan(request) {
      calls.push(['cancelScan', request]);
      return { cancelled: true };
    }
  };
  const services = createWebLibraryServices({ client, windowRef: {} });

  await services.folderService.removeFolder('folder-1');
  await services.scanService.scanFolders();
  await services.scanService.cancelScan('scan-1');

  assert.deepEqual(calls, [
    ['removeFolder', { folderId: 'folder-1' }],
    ['scanFolders', {}],
    ['cancelScan', { scanId: 'scan-1' }]
  ]);
});
