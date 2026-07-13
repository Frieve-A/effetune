import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IndexedDbPowerConfigBackend,
  PowerConfigStore,
  SerializedMemoryPowerConfigBackend
} from '../../js/electron/power-config-store.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFakeIndexedDB({ holdWriteCompletion = false } = {}) {
  const databases = new Map();
  const heldWriteCompletions = [];
  const transactionModes = [];

  function createConnection(database) {
    return {
      objectStoreNames: {
        contains(name) {
          return database.stores.has(name);
        }
      },
      createObjectStore(name) {
        database.stores.set(name, new Map());
        return {};
      },
      transaction(storeName, mode) {
        transactionModes.push(mode);
        const records = database.stores.get(storeName);
        if (!records) throw new Error(`Missing fake object store: ${storeName}`);
        const predecessor = database.writeTail;
        let releaseWrite = null;
        if (mode === 'readwrite') {
          database.writeTail = new Promise(resolve => {
            releaseWrite = resolve;
          });
        }
        let getRequest = null;
        let putRecord = null;
        let aborted = false;
        const transaction = {
          error: null,
          objectStore() {
            return {
              get(key) {
                getRequest = { key };
                return getRequest;
              },
              put(record) {
                putRecord = clone(record);
                return {};
              }
            };
          },
          abort() {
            aborted = true;
          }
        };
        queueMicrotask(async () => {
          await predecessor;
          const finish = () => {
            try {
              if (aborted) {
                transaction.onabort?.();
              } else {
                if (putRecord !== null) records.set(putRecord.key, clone(putRecord));
                transaction.oncomplete?.();
              }
            } finally {
              releaseWrite?.();
            }
          };
          getRequest.result = records.has(getRequest.key)
            ? clone(records.get(getRequest.key))
            : undefined;
          getRequest.onsuccess?.();
          if (mode === 'readwrite' && holdWriteCompletion) {
            heldWriteCompletions.push(finish);
          } else {
            finish();
          }
        });
        return transaction;
      },
      close() {}
    };
  }

  return {
    transactionModes,
    get heldWriteCompletionCount() {
      return heldWriteCompletions.length;
    },
    releaseNextWriteCompletion() {
      const finish = heldWriteCompletions.shift();
      if (!finish) throw new Error('No held write completion');
      finish();
    },
    open(name) {
      const request = {};
      queueMicrotask(() => {
        let database = databases.get(name);
        const isNew = !database;
        if (!database) {
          database = { stores: new Map(), writeTail: Promise.resolve() };
          databases.set(name, database);
        }
        request.result = createConnection(database);
        if (isNew) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }
  };
}

test('one store serializes functional updates without losing nested values', async () => {
  const store = new PowerConfigStore({
    indexedDB: null,
    backend: new SerializedMemoryPowerConfigBackend(),
    writerInstanceId: 'writer-a'
  });

  const [first, second] = await Promise.all([
    store.updateConfig(config => ({
      ...config,
      ui: { ...(config.ui || {}), language: 'ja' }
    })),
    store.updateConfig(config => ({
      ...config,
      power: { ...(config.power || {}), policy: 'maximum' }
    }))
  ]);

  assert.deepEqual(first.revision, { counter: 1, writerInstanceId: 'writer-a' });
  assert.deepEqual(second.revision, { counter: 2, writerInstanceId: 'writer-a' });
  assert.deepEqual(await store.readCurrentConfig(), {
    revision: second.revision,
    config: {
      ui: { language: 'ja' },
      power: { policy: 'maximum' }
    }
  });
});

test('IndexedDB updates resolve only after their transaction completes', async () => {
  const indexedDB = createFakeIndexedDB({ holdWriteCompletion: true });
  const store = new PowerConfigStore({
    indexedDB,
    databaseName: 'transaction-completion-test',
    writerInstanceId: 'writer-indexed'
  });
  let resolved = false;
  const update = store.updateConfig(() => ({ language: 'ja' })).then(result => {
    resolved = true;
    return result;
  });

  for (let attempt = 0; attempt < 10 && indexedDB.heldWriteCompletionCount === 0; attempt += 1) {
    await Promise.resolve();
  }
  assert.equal(indexedDB.heldWriteCompletionCount, 1);
  assert.equal(resolved, false);
  assert.deepEqual(indexedDB.transactionModes, ['readwrite']);

  indexedDB.releaseNextWriteCompletion();
  const committed = await update;
  assert.equal(resolved, true);
  assert.deepEqual(committed, {
    revision: { counter: 1, writerInstanceId: 'writer-indexed' },
    config: { language: 'ja' }
  });
  await store.close();
});

test('a stale expected revision aborts without changing durable state', async () => {
  const store = new PowerConfigStore({
    indexedDB: null,
    backend: new SerializedMemoryPowerConfigBackend(),
    writerInstanceId: 'writer-a'
  });
  const first = await store.updateConfig(() => ({ language: 'en' }));
  const second = await store.updateConfig(
    config => ({ ...config, theme: 'dark' }),
    { expectedRevision: first.revision }
  );

  await assert.rejects(() => store.updateConfig(
    config => ({ ...config, stale: true }),
    { expectedRevision: first.revision }
  ), error => error?.code === 'revision-mismatch');
  assert.deepEqual(await store.readCurrentConfig(), {
    revision: second.revision,
    config: { language: 'en', theme: 'dark' }
  });
});

test('an injected durable backend preserves config across store replacements', async () => {
  const indexedDB = createFakeIndexedDB();
  const firstBackend = new IndexedDbPowerConfigBackend({
    indexedDB,
    databaseName: 'persistent-backend-test'
  });
  const first = new PowerConfigStore({
    indexedDB: null,
    backend: firstBackend,
    writerInstanceId: 'writer-first'
  });
  assert.equal(first.backend, firstBackend);
  const committed = await first.updateConfig(() => ({ power: { policy: 'balanced' } }));
  await first.close();

  const replacementBackend = new IndexedDbPowerConfigBackend({
    indexedDB,
    databaseName: 'persistent-backend-test'
  });
  const replacement = new PowerConfigStore({
    indexedDB: null,
    backend: replacementBackend,
    writerInstanceId: 'writer-replacement'
  });
  assert.deepEqual(await replacement.readCurrentConfig(), {
    revision: committed.revision,
    config: committed.config
  });
  await replacement.close();
});

test('legacy state is read safely and compacted on the next update', async () => {
  const backend = new SerializedMemoryPowerConfigBackend({
    initialState: {
      schemaVersion: 1,
      revisionCounter: 7,
      currentRevision: { counter: 7, writerInstanceId: 'legacy-writer' },
      config: { language: 'en' },
      fencingTokenCounter: 9,
      audioStages: { obsolete: true },
      audioStageFences: { obsolete: true }
    }
  });
  const store = new PowerConfigStore({
    indexedDB: null,
    backend,
    writerInstanceId: 'writer-a'
  });

  assert.deepEqual(await store.readCurrentConfig(), {
    revision: { counter: 7, writerInstanceId: 'legacy-writer' },
    config: { language: 'en' }
  });
  const committed = await store.updateConfig(config => ({ ...config, theme: 'dark' }));
  assert.deepEqual(committed.revision, { counter: 8, writerInstanceId: 'writer-a' });
  assert.deepEqual(Object.keys(await backend.readState()).sort(), [
    'config',
    'currentRevision',
    'revisionCounter',
    'schemaVersion'
  ]);
});
