import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioManager } from '../../js/audio-manager.js';
import { PowerConfigStore } from '../../js/electron/power-config-store.js';
import {
  WEB_APP_CONFIG_KEY,
  WEB_AUDIO_PREFERENCES_KEY,
  getWebAppConfigRuntime,
  loadWebAppConfig,
  loadWebAudioPreferences,
  resetWebAppConfigRuntimeForTests,
  saveWebAppConfig,
  saveWebAudioPreferences,
  saveWebPowerSavingSettings,
  setWebAppConfigRuntimeForTests,
  setWebPowerSettingsApplyHandler,
  WebAppConfigRuntime
} from '../../js/electron/webSettingsStorage.js';
import {
  createConsoleHarness,
  withGlobals
} from '../helpers/global-test-utils.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createLocalStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    snapshot() {
      return Object.fromEntries(values);
    }
  };
}

function createWindowHarness(storage) {
  const events = [];
  return {
    localStorage: storage,
    electronIntegration: { config: null },
    appConfig: null,
    appConfigRevision: null,
    events,
    dispatchEvent(event) {
      events.push(event);
      return true;
    }
  };
}

function createFakeIndexedDB() {
  const databases = new Map();
  let nextWriteCompletionGate = null;

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
        const records = database.stores.get(storeName);
        if (!records) throw new Error(`Missing fake object store: ${storeName}`);
        let getRequest = null;
        let putRecord = null;
        let aborted = false;
        let releaseWrite = null;
        const predecessor = database.writeTail;
        if (mode === 'readwrite') {
          database.writeTail = new Promise(resolve => {
            releaseWrite = resolve;
          });
        }
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
          try {
            getRequest.result = records.has(getRequest.key)
              ? clone(records.get(getRequest.key))
              : undefined;
            getRequest.onsuccess?.();
            if (aborted) {
              transaction.onabort?.();
              return;
            }
            if (putRecord !== null) records.set(putRecord.key, clone(putRecord));
            const gate = mode === 'readwrite' ? nextWriteCompletionGate : null;
            if (gate) {
              nextWriteCompletionGate = null;
              gate.markDurable();
              await gate.waitForRelease;
            }
            transaction.oncomplete?.();
          } finally {
            releaseWrite?.();
          }
        });
        return transaction;
      },
      close() {}
    };
  }

  return {
    open(name) {
      const request = {};
      queueMicrotask(() => {
        let database = databases.get(name);
        const isNew = !database;
        if (!database) {
          database = {
            stores: new Map(),
            writeTail: Promise.resolve()
          };
          databases.set(name, database);
        }
        request.result = createConnection(database);
        if (isNew) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
    pauseNextWriteCompletion() {
      let release;
      let markDurable;
      const durable = new Promise(resolve => {
        markDurable = resolve;
      });
      const waitForRelease = new Promise(resolve => {
        release = resolve;
      });
      nextWriteCompletionGate = { markDurable, waitForRelease };
      return { durable, release };
    }
  };
}

function createRuntime({
  indexedDB = createFakeIndexedDB(),
  databaseName = 'web-config-test',
  writerInstanceId = 'writer-test',
  storage = createLocalStorage(),
  windowRef = createWindowHarness(storage)
} = {}) {
  const store = new PowerConfigStore({
    indexedDB,
    databaseName,
    writerInstanceId
  });
  const runtime = new WebAppConfigRuntime({ store, storage, windowRef });
  return { runtime, store, storage, windowRef, indexedDB };
}

test('unavailable IndexedDB falls back to localStorage while audio preferences remain compatible', async () => {
  assert.throws(() => new WebAppConfigRuntime(), /requires a PowerConfigStore/);
  assert.throws(() => new WebAppConfigRuntime({
    store: { readCurrentConfig() {} }
  }), /requires a PowerConfigStore/);

  const previousWindow = globalThis.window;
  const originalConsoleWarn = console.warn;
  const storage = createLocalStorage({
    [WEB_APP_CONFIG_KEY]: '{invalid-json'
  });
  globalThis.window = { localStorage: storage };
  setWebAppConfigRuntimeForTests(null);
  console['warn'] = () => {};
  try {
    assert.deepEqual(await loadWebAppConfig(), {
      powerSaving: {
        mode: 'balanced',
        silenceThresholdDb: -80,
        fullSuspendDelaySeconds: 300
      }
    });
    assert.equal(await saveWebAppConfig(null), false);
    assert.equal(await saveWebAppConfig({ language: 'ja' }), true);
    assert.equal((await loadWebAppConfig()).language, 'ja');
    assert.equal(await saveWebPowerSavingSettings(null), false);
    let appliedMode = null;
    assert.equal(setWebPowerSettingsApplyHandler(settings => {
      appliedMode = settings.mode;
    }), true);
    assert.equal((await saveWebPowerSavingSettings({ mode: 'maximum' })).mode, 'maximum');
    assert.equal(appliedMode, 'maximum');

    assert.equal(loadWebAudioPreferences(), null);
    assert.equal(saveWebAudioPreferences(null), false);
    assert.equal(saveWebAudioPreferences({ sampleRate: 48000 }), true);
    assert.deepEqual(loadWebAudioPreferences(), { sampleRate: 48000 });
    assert.equal(JSON.parse(storage.snapshot()[WEB_AUDIO_PREFERENCES_KEY]).sampleRate, 48000);

    globalThis.window = {
      localStorage: {
        getItem() { throw new Error('read failed'); },
        setItem() { throw new Error('write failed'); }
      }
    };
    assert.equal(saveWebAudioPreferences({ sampleRate: 44100 }), false);
    assert.equal(await saveWebAppConfig({ language: 'en' }), false);
    await assert.rejects(
      () => saveWebPowerSavingSettings({ mode: 'balanced' }),
      error => error.code === 'localstorage-write-failed'
    );
  } finally {
    console['warn'] = originalConsoleWarn;
    resetWebAppConfigRuntimeForTests();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('the default runtime publishes and dispatches through localStorage when IndexedDB is absent', async () => {
  const previousWindow = globalThis.window;
  const originalConsoleWarn = console.warn;
  const storage = createLocalStorage({
    [WEB_APP_CONFIG_KEY]: JSON.stringify({ language: 'ja' })
  });
  const windowRef = createWindowHarness(storage);
  globalThis.window = windowRef;
  resetWebAppConfigRuntimeForTests();
  console['warn'] = () => {};
  let runtime = null;
  try {
    const loaded = await loadWebAppConfig();
    runtime = getWebAppConfigRuntime();
    assert.equal(loaded.language, 'ja');
    assert.deepEqual(windowRef.appConfig, loaded);
    assert.deepEqual(windowRef.electronIntegration.config, loaded);
    assert.equal(windowRef.events.length, 0);

    assert.equal(await saveWebAppConfig({ startupView: 'library' }), true);
    assert.equal(windowRef.appConfig.startupView, 'library');
    assert.equal(windowRef.electronIntegration.config.startupView, 'library');
    assert.deepEqual(windowRef.events.at(-1).detail.changedKeys, ['startupView']);

    let appliedPowerSaving = null;
    setWebPowerSettingsApplyHandler(settings => {
      appliedPowerSaving = settings;
    });
    const powerSaving = await saveWebPowerSavingSettings({ mode: 'maximum' });
    assert.equal(powerSaving.mode, 'maximum');
    assert.equal(appliedPowerSaving.mode, 'maximum');
    assert.equal(windowRef.appConfig.powerSaving.mode, 'maximum');
    assert.equal(windowRef.electronIntegration.config.powerSaving.mode, 'maximum');
    assert.deepEqual(windowRef.events.at(-1).detail.changedKeys, ['powerSaving']);
  } finally {
    console['warn'] = originalConsoleWarn;
    await runtime?.close();
    resetWebAppConfigRuntimeForTests();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('an IndexedDB open failure selects localStorage for the rest of the session', async () => {
  const storage = createLocalStorage({
    [WEB_APP_CONFIG_KEY]: JSON.stringify({ language: 'ja' })
  });
  let readCount = 0;
  const store = {
    async readCurrentConfig() {
      readCount++;
      throw new Error('open failed');
    },
    async updateConfig() {
      throw new Error('must not retry IndexedDB after fallback');
    }
  };
  const runtime = new WebAppConfigRuntime({
    store,
    storage,
    windowRef: createWindowHarness(storage)
  });
  const originalConsoleWarn = console.warn;
  console['warn'] = () => {};
  try {
    assert.equal((await runtime.loadConfig()).language, 'ja');
    await runtime.commitPatch({ startupView: 'library' });
    assert.equal((await runtime.loadConfig()).startupView, 'library');
    assert.equal(readCount, 1);
    assert.equal(JSON.parse(storage.snapshot()[WEB_APP_CONFIG_KEY]).startupView, 'library');
  } finally {
    console['warn'] = originalConsoleWarn;
    await runtime.close();
  }
});

test('an IndexedDB transaction failure falls back and keeps localStorage authoritative', async () => {
  const storage = createLocalStorage();
  let readCount = 0;
  let updateCount = 0;
  const store = {
    async readCurrentConfig() {
      readCount++;
      return {
        revision: { counter: 1, writerInstanceId: 'writer' },
        config: { language: 'en' }
      };
    },
    async updateConfig() {
      updateCount++;
      throw new Error('transaction failed');
    }
  };
  const runtime = new WebAppConfigRuntime({
    store,
    storage,
    windowRef: createWindowHarness(storage)
  });
  const originalConsoleWarn = console.warn;
  console['warn'] = () => {};
  try {
    await runtime.initialize();
    const committed = await runtime.commitPatch({ language: 'fr' });
    assert.equal(committed.config.language, 'fr');
    assert.equal((await runtime.loadConfig()).language, 'fr');
    assert.equal(readCount, 1);
    assert.equal(updateCount, 1);
    assert.equal(JSON.parse(storage.snapshot()[WEB_APP_CONFIG_KEY]).language, 'fr');
  } finally {
    console['warn'] = originalConsoleWarn;
    await runtime.close();
  }
});

test('fallback keeps the published IndexedDB snapshot when its localStorage mirror is stale', async () => {
  const staleConfig = { language: 'ja', startupView: 'effects' };
  const storage = {
    getItem(key) {
      return key === WEB_APP_CONFIG_KEY ? JSON.stringify(staleConfig) : null;
    },
    setItem() {
      throw new Error('mirror write denied');
    }
  };
  let updateCount = 0;
  const store = {
    async readCurrentConfig() {
      return {
        revision: { counter: 1, writerInstanceId: 'writer' },
        config: { language: 'en', startupView: 'effects' }
      };
    },
    async updateConfig(update) {
      updateCount++;
      if (updateCount > 1) throw new Error('transaction failed');
      return {
        revision: { counter: 2, writerInstanceId: 'writer' },
        config: update({ language: 'en', startupView: 'effects' })
      };
    }
  };
  const windowRef = createWindowHarness(storage);
  const runtime = new WebAppConfigRuntime({ store, storage, windowRef });
  const originalConsoleWarn = console.warn;
  console['warn'] = () => {};
  try {
    await runtime.initialize();
    await runtime.commitPatch({ language: 'fr' });
    await assert.rejects(
      runtime.commitPatch({ startupView: 'library' }),
      error => error.code === 'localstorage-write-failed'
    );

    assert.equal(runtime.backend, 'localStorage');
    assert.equal(windowRef.appConfig.language, 'fr');
    assert.equal(windowRef.appConfig.startupView, 'effects');
    assert.deepEqual(windowRef.electronIntegration.config, windowRef.appConfig);
  } finally {
    console['warn'] = originalConsoleWarn;
    await runtime.close();
  }
});

test('an IndexedDB read failure repairs a stale mirror before the next localStorage-only reload', async () => {
  const storage = createLocalStorage();
  let readCount = 0;
  const store = {
    async readCurrentConfig() {
      readCount++;
      if (readCount > 1) throw new Error('temporary IndexedDB read failure');
      return {
        revision: { counter: 4, writerInstanceId: 'writer' },
        config: { language: 'fr', startupView: 'library' }
      };
    },
    async updateConfig() {
      throw new Error('unexpected update');
    },
    async close() {}
  };
  const runtime = new WebAppConfigRuntime({
    store,
    storage,
    windowRef: createWindowHarness(storage)
  });
  await withGlobals({
    console: createConsoleHarness({ warn() {} })
  }, async () => {
    try {
      await runtime.initialize();
      storage.setItem(WEB_APP_CONFIG_KEY, JSON.stringify({
        language: 'stale-mirror',
        startupView: 'effects'
      }));

      assert.deepEqual(await runtime.loadConfig(), {
        language: 'fr',
        startupView: 'library',
        powerSaving: {
          mode: 'balanced',
          silenceThresholdDb: -80,
          fullSuspendDelaySeconds: 300
        }
      });
      assert.equal(runtime.backend, 'localStorage');
      assert.equal(
        JSON.parse(storage.snapshot()[WEB_APP_CONFIG_KEY]).language,
        'fr'
      );
    } finally {
      await runtime.close();
    }
  });

  const reloaded = new WebAppConfigRuntime({
    store: {
      async readCurrentConfig() {
        throw new Error('IndexedDB unavailable after reload');
      },
      async updateConfig() {
        throw new Error('IndexedDB unavailable after reload');
      },
      async close() {}
    },
    storage,
    windowRef: createWindowHarness(storage)
  });
  await withGlobals({
    console: createConsoleHarness({ warn() {} })
  }, async () => {
    try {
      assert.equal((await reloaded.initialize()).config.language, 'fr');
    } finally {
      await reloaded.close();
    }
  });
});

test('legacy localStorage migrates once and IndexedDB remains authoritative on reload', async () => {
  const indexedDB = createFakeIndexedDB();
  const storage = createLocalStorage({
    [WEB_APP_CONFIG_KEY]: JSON.stringify({
      language: 'ja',
      powerSaving: { mode: 'maximum' }
    })
  });
  const first = createRuntime({
    indexedDB,
    databaseName: 'web-config-migration',
    writerInstanceId: 'writer-first',
    storage,
    windowRef: createWindowHarness(storage)
  });
  const migrated = await first.runtime.initialize();
  assert.equal(migrated.revision.counter, 1);
  assert.equal(migrated.config.language, 'ja');
  assert.equal(migrated.config.powerSaving.mode, 'maximum');
  await first.runtime.close();

  storage.setItem(WEB_APP_CONFIG_KEY, JSON.stringify({ language: 'stale-mirror' }));
  const secondWindow = createWindowHarness(storage);
  const second = createRuntime({
    indexedDB,
    databaseName: 'web-config-migration',
    writerInstanceId: 'writer-second',
    storage,
    windowRef: secondWindow
  });
  const reloaded = await second.runtime.initialize();
  assert.deepEqual(reloaded, migrated);
  assert.deepEqual(secondWindow.appConfig, migrated.config);
  assert.deepEqual(JSON.parse(storage.snapshot()[WEB_APP_CONFIG_KEY]), migrated.config);
  await second.runtime.close();
});

test('functional patches merge in one transaction and publish only after commit completion', async () => {
  const harness = createRuntime({ databaseName: 'web-config-transaction' });
  await harness.runtime.initialize();
  const gate = harness.indexedDB.pauseNextWriteCompletion();
  let settled = false;
  const firstCommit = harness.runtime.commitPatch({ language: 'fr' }).then(result => {
    settled = true;
    return result;
  });

  await gate.durable;
  assert.equal(settled, false);
  assert.equal(harness.windowRef.appConfig.language, undefined);
  assert.equal(harness.windowRef.events.length, 0);
  assert.equal(harness.storage.snapshot()[WEB_APP_CONFIG_KEY], undefined);

  gate.release();
  const first = await firstCommit;
  const second = await harness.runtime.commitPatch({ startupView: 'library' });
  assert.equal(first.config.language, 'fr');
  assert.deepEqual(second.config, {
    language: 'fr',
    startupView: 'library',
    powerSaving: {
      mode: 'balanced',
      silenceThresholdDb: -80,
      fullSuspendDelaySeconds: 300
    }
  });
  assert.deepEqual(harness.windowRef.appConfig, second.config);
  assert.equal(harness.windowRef.events.length, 2);
  await harness.runtime.close();
});

test('ordinary and power commits share one same-instance queue', async () => {
  const harness = createRuntime({ databaseName: 'web-config-unified-queue' });
  await harness.runtime.initialize();
  let releaseApply;
  let markApplyStarted;
  const applyStarted = new Promise(resolve => { markApplyStarted = resolve; });
  const applyGate = new Promise(resolve => { releaseApply = resolve; });
  const order = [];

  const powerCommit = harness.runtime.commitPowerSettings({ mode: 'maximum' }, {
    applyPowerSettings: async settings => {
      order.push(`apply:${settings.mode}`);
      markApplyStarted();
      await applyGate;
    }
  });
  await applyStarted;
  const patchCommit = harness.runtime.commitPatch({ language: 'ja' }).then(result => {
    order.push('patch');
    return result;
  });
  await Promise.resolve();

  const duringApply = await harness.store.readCurrentConfig();
  assert.equal(duringApply.config.powerSaving.mode, 'maximum');
  assert.equal(duringApply.config.language, undefined);
  assert.equal(harness.windowRef.appConfig.powerSaving.mode, 'balanced');

  releaseApply();
  await Promise.all([powerCommit, patchCommit]);
  const finalConfig = await harness.store.readCurrentConfig();
  assert.equal(finalConfig.config.powerSaving.mode, 'maximum');
  assert.equal(finalConfig.config.language, 'ja');
  assert.deepEqual(order, ['apply:maximum', 'patch']);
  assert.deepEqual(harness.windowRef.appConfig, finalConfig.config);
  await harness.runtime.close();
});

test('localStorage power commits stay unpublished while the persisted settings are being applied', async () => {
  const storage = createLocalStorage();
  const windowRef = createWindowHarness(storage);
  const runtime = new WebAppConfigRuntime({
    store: {
      async readCurrentConfig() {
        return {
          revision: { counter: 3, writerInstanceId: 'writer' },
          config: { language: 'en' }
        };
      },
      async updateConfig() {
        throw new Error('IndexedDB transaction failed');
      },
      async close() {}
    },
    storage,
    windowRef
  });
  await withGlobals({
    console: createConsoleHarness({ warn() {} })
  }, async () => {
    try {
      await runtime.initialize();
      const publishedBeforeCommit = runtime.getPublishedSnapshot();
      let releaseApply;
      let markApplyStarted;
      const applyStarted = new Promise(resolve => { markApplyStarted = resolve; });
      const applyGate = new Promise(resolve => { releaseApply = resolve; });

      const commit = runtime.commitPowerSettings({ mode: 'maximum' }, {
        applyPowerSettings: async settings => {
          assert.equal(settings.mode, 'maximum');
          markApplyStarted();
          await applyGate;
        }
      });
      await applyStarted;

      assert.equal(runtime.backend, 'localStorage');
      assert.equal(
        JSON.parse(storage.snapshot()[WEB_APP_CONFIG_KEY]).powerSaving.mode,
        'maximum'
      );
      assert.deepEqual(runtime.getPublishedSnapshot(), publishedBeforeCommit);
      assert.deepEqual(windowRef.appConfig, publishedBeforeCommit.config);
      assert.deepEqual(windowRef.electronIntegration.config, publishedBeforeCommit.config);
      assert.equal(windowRef.events.length, 0);

      releaseApply();
      const committed = await commit;
      assert.equal(committed.powerSaving.mode, 'maximum');
      assert.equal(runtime.getPublishedSnapshot().config.powerSaving.mode, 'maximum');
      assert.equal(windowRef.appConfig.powerSaving.mode, 'maximum');
      assert.equal(windowRef.events.length, 1);
    } finally {
      await runtime.close();
    }
  });
});

test('localStorage power reconciliation retries and publishes the persisted committed snapshot', async () => {
  const storage = createLocalStorage();
  const windowRef = createWindowHarness(storage);
  const runtime = new WebAppConfigRuntime({
    store: {
      async readCurrentConfig() {
        throw new Error('IndexedDB unavailable');
      },
      async updateConfig() {
        throw new Error('IndexedDB unavailable');
      },
      async close() {}
    },
    storage,
    windowRef
  });
  const originalError = new Error('initial apply failure');
  const applyCalls = [];
  await withGlobals({
    console: createConsoleHarness({ warn() {}, error() {} })
  }, async () => {
    await runtime.initialize();
    await assert.rejects(
      runtime.commitPowerSettings({ silenceThresholdDb: -60 }, {
        applyPowerSettings: async settings => {
          applyCalls.push(settings);
          assert.equal(windowRef.appConfig.powerSaving.silenceThresholdDb, -80);
          if (applyCalls.length === 1) throw originalError;
          throw new Error('reconcile failed');
        }
      }),
      error => error === originalError
    );
  });

  assert.equal(applyCalls.length, 2);
  assert.equal(applyCalls[0].silenceThresholdDb, -60);
  assert.deepEqual(applyCalls[1], applyCalls[0]);
  assert.equal(
    JSON.parse(storage.snapshot()[WEB_APP_CONFIG_KEY]).powerSaving.silenceThresholdDb,
    -60
  );
  assert.equal(runtime.getPublishedSnapshot().config.powerSaving.silenceThresholdDb, -60);
  assert.equal(windowRef.appConfig.powerSaving.silenceThresholdDb, -60);
  assert.equal(windowRef.events.length, 1);
  await runtime.close();
});

test('power commits persist before apply and retry the authoritative settings once', async () => {
  const harness = createRuntime({ databaseName: 'web-config-power-retry' });
  await harness.runtime.initialize();
  const applyCalls = [];
  harness.runtime.setPowerApplyHandler(async settings => {
    applyCalls.push(settings);
    const persisted = await harness.store.readCurrentConfig();
    assert.deepEqual(settings, persisted.config.powerSaving);
    assert.equal(harness.windowRef.appConfig.powerSaving.mode, 'balanced');
    if (applyCalls.length === 1) throw new Error('transient apply failure');
  });

  const committed = await harness.runtime.commitPowerSettings({ mode: 'maximum' });
  assert.equal(committed.powerSaving.mode, 'maximum');
  assert.equal(applyCalls.length, 2);
  assert.equal(harness.windowRef.appConfig.powerSaving.mode, 'maximum');
  assert.equal(JSON.parse(harness.storage.snapshot()[WEB_APP_CONFIG_KEY]).powerSaving.mode,
    'maximum');
  await harness.runtime.close();
});

test('a final power apply failure publishes the authoritative snapshot and throws the original error', async () => {
  const harness = createRuntime({ databaseName: 'web-config-power-failure' });
  await harness.runtime.initialize();
  const originalError = new Error('initial apply failure');
  let applyCount = 0;
  const originalConsoleError = console.error;
  console['error'] = () => {};
  try {
    await assert.rejects(
      harness.runtime.commitPowerSettings({ silenceThresholdDb: -60 }, {
        applyPowerSettings: async () => {
          applyCount++;
          if (applyCount === 1) throw originalError;
          throw new Error('authoritative retry failed');
        }
      }),
      error => error === originalError
    );
  } finally {
    console['error'] = originalConsoleError;
  }

  const authoritative = await harness.store.readCurrentConfig();
  assert.equal(applyCount, 2);
  assert.equal(authoritative.config.powerSaving.silenceThresholdDb, -60);
  assert.deepEqual(harness.windowRef.appConfig, authoritative.config);
  assert.deepEqual(JSON.parse(harness.storage.snapshot()[WEB_APP_CONFIG_KEY]),
    authoritative.config);
  await harness.runtime.close();
});

test('committed power settings remain authoritative across apply and readback failures', async () => {
  const indexedDB = createFakeIndexedDB();
  const durableStore = new PowerConfigStore({
    indexedDB,
    databaseName: 'web-config-power-readback-failure',
    writerInstanceId: 'readback-failure-writer'
  });
  let readCount = 0;
  let updateCount = 0;
  const store = {
    async readCurrentConfig() {
      readCount++;
      if (readCount >= 2) throw new Error('readback unavailable');
      return durableStore.readCurrentConfig();
    },
    async updateConfig(...args) {
      updateCount++;
      return durableStore.updateConfig(...args);
    },
    async close() {
      await durableStore.close();
    }
  };
  const storage = createLocalStorage();
  const windowRef = createWindowHarness(storage);
  const runtime = new WebAppConfigRuntime({ store, storage, windowRef });
  const originalApplyError = new Error('initial apply failure');
  let applyCount = 0;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;
  console['warn'] = () => {};
  console['error'] = () => {};
  try {
    await runtime.initialize();
    await assert.rejects(
      runtime.commitPowerSettings({ mode: 'maximum' }, {
        applyPowerSettings: async () => {
          applyCount++;
          if (applyCount === 1) throw originalApplyError;
          throw new Error('authoritative retry failed');
        }
      }),
      error => error === originalApplyError
    );

    const persisted = await durableStore.readCurrentConfig();
    assert.equal(persisted.config.powerSaving.mode, 'maximum');
    assert.deepEqual(runtime.getPublishedSnapshot(), persisted);
    assert.deepEqual(windowRef.appConfig, persisted.config);
    assert.deepEqual(windowRef.electronIntegration.config, persisted.config);
    assert.deepEqual(JSON.parse(storage.snapshot()[WEB_APP_CONFIG_KEY]), persisted.config);
    assert.equal(runtime.backend, 'indexeddb');

    assert.equal((await runtime.loadConfig()).powerSaving.mode, 'maximum');
    assert.equal(runtime.backend, 'localStorage');
    assert.deepEqual(windowRef.appConfig, persisted.config);
    assert.deepEqual(JSON.parse(storage.snapshot()[WEB_APP_CONFIG_KEY]), persisted.config);

    const recovered = await runtime.commitPowerSettings({ silenceThresholdDb: -90 }, {
      applyPowerSettings: async () => {}
    });
    assert.equal(recovered.powerSaving.mode, 'maximum');
    assert.equal(recovered.powerSaving.silenceThresholdDb, -90);
    assert.equal(updateCount, 1);
    assert.deepEqual(windowRef.appConfig, JSON.parse(storage.snapshot()[WEB_APP_CONFIG_KEY]));
  } finally {
    console['warn'] = originalConsoleWarn;
    console['error'] = originalConsoleError;
    await runtime.close();
  }
});

test('rapid same-instance power changes apply and publish in call order', async () => {
  const harness = createRuntime({ databaseName: 'web-config-power-order' });
  await harness.runtime.initialize();
  let releaseFirstApply;
  let markFirstApplyStarted;
  const firstApplyStarted = new Promise(resolve => { markFirstApplyStarted = resolve; });
  const firstApplyGate = new Promise(resolve => { releaseFirstApply = resolve; });
  const modes = [];
  let secondStarted = false;

  const first = harness.runtime.commitPowerSettings({ mode: 'maximum' }, {
    applyPowerSettings: async settings => {
      modes.push(settings.mode);
      markFirstApplyStarted();
      await firstApplyGate;
    }
  });
  await firstApplyStarted;
  const second = harness.runtime.commitPowerSettings({ mode: 'continuous' }, {
    applyPowerSettings: async settings => {
      secondStarted = true;
      modes.push(settings.mode);
    }
  });
  await Promise.resolve();
  assert.equal(secondStarted, false);

  releaseFirstApply();
  await Promise.all([first, second]);
  assert.deepEqual(modes, ['maximum', 'continuous']);
  assert.equal((await harness.store.readCurrentConfig()).config.powerSaving.mode, 'continuous');
  assert.equal(harness.windowRef.appConfig.powerSaving.mode, 'continuous');
  await harness.runtime.close();
});

test('public Web config helpers preserve their API on the single runtime', async () => {
  const harness = createRuntime({ databaseName: 'web-config-public-api' });
  setWebAppConfigRuntimeForTests(harness.runtime);
  try {
    let applied = null;
    assert.equal(setWebPowerSettingsApplyHandler(settings => { applied = settings; }), true);
    assert.equal(await saveWebAppConfig({ language: 'ko' }), true);
    assert.deepEqual(await saveWebPowerSavingSettings({ mode: 'maximum' }), {
      mode: 'maximum',
      silenceThresholdDb: -80,
      fullSuspendDelaySeconds: 300
    });
    assert.equal(applied.mode, 'maximum');
    assert.equal((await loadWebAppConfig()).language, 'ko');
  } finally {
    resetWebAppConfigRuntimeForTests();
    await harness.runtime.close();
  }
});

test('AudioManager sends only the partial Web power patch through the runtime', async () => {
  const previousWindow = globalThis.window;
  const order = [];
  const completeSettings = {
    mode: 'maximum',
    silenceThresholdDb: -90,
    fullSuspendDelaySeconds: 900
  };
  const runtime = {
    async commitPowerSettings(partialPowerSaving, { applyPowerSettings }) {
      order.push(['persisted', clone(partialPowerSaving)]);
      await applyPowerSettings(completeSettings);
      return { powerSaving: completeSettings };
    }
  };
  setWebAppConfigRuntimeForTests(runtime);
  globalThis.window = { appConfig: { powerSaving: { mode: 'balanced' } } };
  try {
    const audioManager = Object.create(AudioManager.prototype);
    audioManager.powerPolicyController = {
      async updateSettings(settings) {
        order.push(['controller', clone(settings)]);
      }
    };

    assert.deepEqual(await audioManager.updatePowerSettings({ mode: 'maximum' }), completeSettings);
    assert.deepEqual(order, [
      ['persisted', { mode: 'maximum' }],
      ['controller', completeSettings]
    ]);
  } finally {
    resetWebAppConfigRuntimeForTests();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
