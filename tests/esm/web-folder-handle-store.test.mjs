import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WEB_FOLDER_HANDLE_DATABASE_NAME,
  WEB_FOLDER_HANDLE_DATABASE_VERSION,
  WebFolderHandleStore
} from '../../js/library/scan/web-folder-handle-store.js';
import { createFakeIndexedDb } from './web-folder-handle-store-fake-idb.mjs';

function directoryHandle(name) {
  return {
    kind: 'directory',
    name,
    async *values() {}
  };
}

test('folder handles persist within the independent v3 handle database', async () => {
  const indexedDB = createFakeIndexedDb();
  const originalHandle = directoryHandle('Original Music');
  const initial = new WebFolderHandleStore({ indexedDB, now: () => 10 });
  await initial.put({ folderId: 'folder-original', handle: originalHandle });
  initial.close();

  const reopened = new WebFolderHandleStore({ indexedDB, now: () => 20 });
  assert.equal(await reopened.get('folder-original'), originalHandle);
  assert.equal(indexedDB.databases.get(WEB_FOLDER_HANDLE_DATABASE_NAME).version, 1);
  assert.equal(WEB_FOLDER_HANDLE_DATABASE_VERSION, 1);
  reopened.close();
});

test('folder handle persistence opens only its fixed v3 database identity', async () => {
  const fake = createFakeIndexedDb();
  const opens = [];
  const trappedIndexedDb = {
    open(name, version) {
      opens.push({ name, version });
      if (name !== WEB_FOLDER_HANDLE_DATABASE_NAME) {
        throw new Error(`Unexpected database identity: ${name}`);
      }
      return fake.open(name, version);
    },
    databases() {
      throw new Error('Database enumeration is forbidden');
    },
    deleteDatabase() {
      throw new Error('Database deletion is forbidden');
    }
  };
  const store = new WebFolderHandleStore({ indexedDB: trappedIndexedDb });
  const handle = directoryHandle('Fresh v3 Music');

  await store.put({ folderId: 'folder-v3', handle });
  assert.equal(await store.get('folder-v3'), handle);
  assert.deepEqual(opens, [{
    name: WEB_FOLDER_HANDLE_DATABASE_NAME,
    version: WEB_FOLDER_HANDLE_DATABASE_VERSION
  }]);
  store.close();
});

test('persisted folder handles can be enumerated with a bound and removed', async () => {
  const indexedDB = createFakeIndexedDb();
  const store = new WebFolderHandleStore({ indexedDB });
  const firstHandle = directoryHandle('First Music');
  const secondHandle = directoryHandle('Second Music');
  await store.put({ folderId: 'folder-first', handle: firstHandle });
  await store.put({ folderId: 'folder-second', handle: secondHandle });

  assert.deepEqual(await store.list({ limit: 1 }), [{
    folderId: 'folder-first',
    handle: firstHandle
  }]);
  await store.delete('folder-first');
  assert.equal(await store.get('folder-first'), null);
  assert.deepEqual(await store.list(), [{
    folderId: 'folder-second',
    handle: secondHandle
  }]);
  store.close();
});

test('an incomplete current folder-handle store fails with a typed open error', async () => {
  const indexedDB = createFakeIndexedDb();
  const initial = new WebFolderHandleStore({ indexedDB });
  await initial.open();
  initial.close();
  const definition = indexedDB.databases.get(WEB_FOLDER_HANDLE_DATABASE_NAME);
  definition.stores.delete('folderHandlesV3');

  const incomplete = new WebFolderHandleStore({ indexedDB });
  await assert.rejects(
    incomplete.open(),
    error => error?.code === 'incompleteHandleStoreUpgrade'
  );
});

test('a blocked folder-handle database open fails with the concurrent-use contract', async () => {
  const indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => request.onblocked());
      return request;
    }
  };
  const store = new WebFolderHandleStore({ indexedDB });

  await assert.rejects(
    store.open(),
    error => error?.code === 'concurrentUseUnsupported'
  );
});
