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

test('folder handles survive earlier physical revisions of the v2 handle database', async () => {
  const indexedDB = createFakeIndexedDb();
  const originalHandle = directoryHandle('Original Music');
  const initial = new WebFolderHandleStore({ indexedDB, now: () => 10 });
  await initial.put({ folderId: 'folder-original', handle: originalHandle });
  initial.close();

  const definition = indexedDB.databases.get(WEB_FOLDER_HANDLE_DATABASE_NAME);
  definition.version = 1;
  const fromV1 = new WebFolderHandleStore({ indexedDB, now: () => 20 });
  assert.equal(await fromV1.get('folder-original'), originalHandle);
  fromV1.close();

  definition.version = 2;
  definition.stores.delete('folderHandles');
  const fromIncompleteV2 = new WebFolderHandleStore({ indexedDB, now: () => 30 });
  const replacementHandle = directoryHandle('Replacement Music');
  await fromIncompleteV2.put({ folderId: 'folder-replacement', handle: replacementHandle });
  assert.equal(await fromIncompleteV2.get('folder-replacement'), replacementHandle);
  assert.equal(definition.version, WEB_FOLDER_HANDLE_DATABASE_VERSION);
  assert.equal(WEB_FOLDER_HANDLE_DATABASE_VERSION, 3);
  fromIncompleteV2.close();
});

test('folder handle persistence opens only its fixed v2 database identity', async () => {
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
  const handle = directoryHandle('Fresh v2 Music');

  await store.put({ folderId: 'folder-v2', handle });
  assert.equal(await store.get('folder-v2'), handle);
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
  definition.stores.delete('folderHandles');

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
