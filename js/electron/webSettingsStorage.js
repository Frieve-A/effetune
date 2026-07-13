import {
  mergePowerSavingSettings,
  normalizePowerSettings
} from '../audio/power-policy.js';
import {
  PowerConfigStore,
  PowerConfigStoreError
} from './power-config-store.js';

export const WEB_APP_CONFIG_KEY = 'effetune_app_config';
export const WEB_AUDIO_PREFERENCES_KEY = 'effetune_audio_preferences';

let defaultRuntime = null;
let runtimeOverride = undefined;
let fallbackPowerApplyHandler = null;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneValue);
  const result = {};
  for (const [key, entry] of Object.entries(value)) result[key] = cloneValue(entry);
  return result;
}

function recordsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function revisionsEqual(left, right) {
  if (left === null || right === null) return left === right;
  return left.counter === right.counter && left.writerInstanceId === right.writerInstanceId;
}

function normalizeAppConfig(config) {
  const normalized = isPlainObject(config) ? cloneValue(config) : {};
  normalized.powerSaving = normalizePowerSettings(normalized.powerSaving);
  return normalized;
}

function changedTopLevelKeys(previousConfig, nextConfig) {
  const keys = new Set([
    ...Object.keys(previousConfig || {}),
    ...Object.keys(nextConfig || {})
  ]);
  return [...keys].filter(key => !recordsEqual(previousConfig?.[key], nextConfig?.[key])).sort();
}

function getLocalStorage(windowRef = typeof window !== 'undefined' ? window : null) {
  try {
    return windowRef?.localStorage || globalThis.localStorage || null;
  } catch (error) {
    console.warn('Failed to access localStorage:', error);
    return null;
  }
}

function readObject(storage, key, fallback) {
  if (!storage) return fallback;

  try {
    const rawValue = storage.getItem(key);
    if (!rawValue) return fallback;
    const parsed = JSON.parse(rawValue);
    if (isPlainObject(parsed)) return parsed;
    console.warn(`Ignoring invalid ${key} value in localStorage`);
  } catch (error) {
    console.warn(`Failed to read ${key} from localStorage:`, error);
  }
  return fallback;
}

function writeObject(storage, key, value) {
  if (!storage) return false;

  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Failed to save ${key} to localStorage:`, error);
    return false;
  }
}

export class WebAppConfigRuntime {
  constructor({
    store,
    storage = getLocalStorage(),
    windowRef = typeof window !== 'undefined' ? window : null
  } = {}) {
    if (!store || typeof store.readCurrentConfig !== 'function' ||
        typeof store.updateConfig !== 'function') {
      throw new TypeError('WebAppConfigRuntime requires a PowerConfigStore');
    }
    this.store = store;
    this.storage = storage;
    this.windowRef = windowRef;
    this.powerApplyHandler = null;
    this.initializationPromise = null;
    this.publishedSnapshot = { revision: null, config: {} };
    this.commitTail = Promise.resolve();
    this.closed = false;
    this.backend = 'indexeddb';
    this.fallbackWarningShown = false;
  }

  async initialize() {
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = this.initializeOnce().catch(error => {
      this.initializationPromise = null;
      throw error;
    });
    return this.initializationPromise;
  }

  async initializeOnce() {
    try {
      let snapshot = await this.store.readCurrentConfig();
      if (snapshot.revision === null) {
        const legacyConfig = readObject(this.storage, WEB_APP_CONFIG_KEY, null);
        if (legacyConfig) {
          snapshot = await this.store.updateConfig(
            () => normalizeAppConfig(legacyConfig),
            { expectedRevision: null }
          );
        }
      }
      await this.publishSnapshot(snapshot, { dispatch: false });
      return this.getPublishedSnapshot();
    } catch (error) {
      return this.activateLocalStorageFallback(error, { dispatch: false });
    }
  }

  prepareLocalStorageFallback(error) {
    const indexedDbSnapshot = this.publishedSnapshot.revision !== null
      ? this.getPublishedSnapshot()
      : null;
    if (this.backend !== 'localStorage') {
      this.backend = 'localStorage';
      if (!this.fallbackWarningShown) {
        console.warn('IndexedDB App Config failed; using localStorage for this session:', error);
        this.fallbackWarningShown = true;
      }
    }
    const storedConfig = readObject(this.storage, WEB_APP_CONFIG_KEY, null);
    const config = normalizeAppConfig(
      indexedDbSnapshot?.config || storedConfig || this.publishedSnapshot.config
    );
    if (!writeObject(this.storage, WEB_APP_CONFIG_KEY, config)) {
      console.warn(
        'Could not establish the localStorage fallback snapshot; continuing with the in-memory config for this session.'
      );
    }
    return { revision: null, config };
  }

  async activateLocalStorageFallback(error, { dispatch = true } = {}) {
    return this.publishSnapshot(this.prepareLocalStorageFallback(error), { dispatch });
  }

  persistLocalStorageConfig(config) {
    const normalized = normalizeAppConfig(config);
    if (!writeObject(this.storage, WEB_APP_CONFIG_KEY, normalized)) {
      throw new PowerConfigStoreError(
        'localstorage-write-failed',
        'Failed to persist Web App Config in localStorage'
      );
    }
    return { revision: null, config: normalized };
  }

  commitLocalStorageConfig(config, options = {}) {
    return this.publishSnapshot(this.persistLocalStorageConfig(config), options);
  }

  getPublishedSnapshot() {
    return {
      revision: this.publishedSnapshot.revision
        ? cloneValue(this.publishedSnapshot.revision)
        : null,
      config: cloneValue(this.publishedSnapshot.config)
    };
  }

  async loadConfig() {
    await this.initialize();
    await this.commitTail;
    if (this.backend === 'localStorage') {
      return cloneValue(this.publishedSnapshot.config);
    }
    let latest;
    try {
      latest = await this.store.readCurrentConfig();
    } catch (error) {
      await this.activateLocalStorageFallback(error, { dispatch: false });
      return cloneValue(this.publishedSnapshot.config);
    }
    if (!revisionsEqual(latest.revision, this.publishedSnapshot.revision)) {
      await this.publishSnapshot(latest, { dispatch: false });
    }
    return cloneValue(this.publishedSnapshot.config);
  }

  setPowerApplyHandler(handler) {
    if (handler !== null && typeof handler !== 'function') {
      throw new TypeError('power apply handler must be a function or null');
    }
    this.powerApplyHandler = handler;
  }

  async publishSnapshot(snapshot, {
    changedKeys = null,
    dispatch = true
  } = {}) {
    const config = normalizeAppConfig(snapshot.config);
    const revision = snapshot.revision ? cloneValue(snapshot.revision) : null;
    const publishedRevision = this.publishedSnapshot.revision;
    if (this.backend !== 'localStorage' && publishedRevision !== null &&
        (revision === null || revision.counter < publishedRevision.counter)) {
      return this.getPublishedSnapshot();
    }
    const effectiveChangedKeys = changedKeys || changedTopLevelKeys(
      this.publishedSnapshot.config,
      config
    );

    if (revision !== null) writeObject(this.storage, WEB_APP_CONFIG_KEY, config);
    this.publishedSnapshot = { revision, config: cloneValue(config) };
    if (this.windowRef) {
      this.windowRef.appConfig = cloneValue(config);
      this.windowRef.appConfigRevision = revision ? cloneValue(revision) : null;
      if (this.windowRef.electronIntegration) {
        this.windowRef.electronIntegration.config = cloneValue(config);
      }
    }

    if (dispatch && effectiveChangedKeys.length > 0) {
      const detail = {
        changedKeys: [...effectiveChangedKeys],
        config: cloneValue(config),
        revision: revision ? cloneValue(revision) : null
      };
      const CustomEventClass = this.windowRef?.CustomEvent || globalThis.CustomEvent;
      const event = typeof CustomEventClass === 'function'
        ? new CustomEventClass('appconfigchange', { detail })
        : { type: 'appconfigchange', detail };
      this.windowRef?.dispatchEvent?.(event);
    }

    return { revision, config: cloneValue(config) };
  }

  enqueueCommit(operation) {
    const result = this.commitTail.then(async () => {
      if (this.closed) {
        throw new PowerConfigStoreError('runtime-closed', 'Web App Config runtime is closed');
      }
      return operation();
    });
    this.commitTail = result.catch(() => {});
    return result;
  }

  commitPatch(partialConfig) {
    if (!isPlainObject(partialConfig)) {
      return Promise.reject(new TypeError('config patch must be a plain object'));
    }
    const patch = cloneValue(partialConfig);
    return this.enqueueCommit(async () => {
      await this.initialize();
      if (this.backend === 'localStorage') {
        return this.commitLocalStorageConfig({
          ...this.publishedSnapshot.config,
          ...patch
        });
      }
      try {
        const committed = await this.store.updateConfig(currentConfig => normalizeAppConfig({
          ...currentConfig,
          ...patch
        }));
        return this.publishSnapshot(committed);
      } catch (error) {
        await this.activateLocalStorageFallback(error, { dispatch: false });
        return this.commitLocalStorageConfig({
          ...this.publishedSnapshot.config,
          ...patch
        });
      }
    });
  }

  commitPowerSettings(partialPowerSaving, { applyPowerSettings = null } = {}) {
    if (!isPlainObject(partialPowerSaving)) {
      return Promise.reject(new TypeError('power settings patch must be a plain object'));
    }
    if (applyPowerSettings !== null && typeof applyPowerSettings !== 'function') {
      return Promise.reject(new TypeError('applyPowerSettings must be a function or null'));
    }
    const partial = cloneValue(partialPowerSaving);
    const applySettings = applyPowerSettings || this.powerApplyHandler || (async () => {});
    return this.enqueueCommit(async () => {
      await this.initialize();
      const previousConfig = this.getPublishedSnapshot().config;
      let committed;
      if (this.backend === 'localStorage') {
        committed = this.persistLocalStorageConfig({
          ...this.publishedSnapshot.config,
          powerSaving: mergePowerSavingSettings(
            this.publishedSnapshot.config.powerSaving,
            partial
          )
        });
      } else {
        try {
          committed = await this.store.updateConfig(currentConfig => normalizeAppConfig({
            ...currentConfig,
            powerSaving: mergePowerSavingSettings(currentConfig.powerSaving, partial)
          }));
        } catch (error) {
          const fallback = this.prepareLocalStorageFallback(error);
          committed = this.persistLocalStorageConfig({
            ...fallback.config,
            powerSaving: mergePowerSavingSettings(
              fallback.config.powerSaving,
              partial
            )
          });
        }
      }
      let authoritative = committed;

      try {
        await applySettings(cloneValue(normalizePowerSettings(committed.config.powerSaving)));
      } catch (error) {
        if (this.backend === 'localStorage') {
          authoritative = committed;
        } else {
          try {
            authoritative = await this.store.readCurrentConfig();
          } catch (readError) {
            console.warn(
              'Failed to read back committed power settings; using the committed snapshot:',
              readError
            );
            authoritative = committed;
          }
        }
        try {
          await applySettings(cloneValue(
            normalizePowerSettings(authoritative.config.powerSaving)
          ));
        } catch (reconcileError) {
          console.error('Failed to reconcile persisted power settings:', reconcileError);
          await this.publishSnapshot(authoritative, {
            changedKeys: changedTopLevelKeys(previousConfig, authoritative.config)
          });
          throw error;
        }
      }

      const published = await this.publishSnapshot(authoritative, {
        changedKeys: changedTopLevelKeys(previousConfig, authoritative.config)
      });
      return {
        revision: published.revision,
        config: published.config,
        powerSaving: cloneValue(published.config.powerSaving)
      };
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.commitTail;
    await this.initializationPromise?.catch?.(() => {});
    await this.store.close?.();
  }
}

function createDefaultRuntime() {
  const windowRef = typeof window !== 'undefined' ? window : null;
  const indexedDB = windowRef?.indexedDB || globalThis.indexedDB;
  const store = indexedDB && typeof indexedDB.open === 'function'
    ? new PowerConfigStore({ indexedDB })
    : {
        async readCurrentConfig() {
          throw new PowerConfigStoreError(
            'indexeddb-unavailable',
            'IndexedDB is unavailable'
          );
        },
        async updateConfig() {
          throw new PowerConfigStoreError(
            'indexeddb-unavailable',
            'IndexedDB is unavailable'
          );
        },
        async close() {}
      };
  return new WebAppConfigRuntime({
    store,
    storage: getLocalStorage(windowRef),
    windowRef
  });
}

export function getWebAppConfigRuntime() {
  if (runtimeOverride !== undefined) return runtimeOverride;
  if (!defaultRuntime) defaultRuntime = createDefaultRuntime();
  return defaultRuntime;
}

export function setWebAppConfigRuntimeForTests(runtime) {
  runtimeOverride = runtime;
}

export function resetWebAppConfigRuntimeForTests() {
  runtimeOverride = undefined;
  defaultRuntime = null;
  fallbackPowerApplyHandler = null;
}

export function setWebPowerSettingsApplyHandler(handler) {
  const runtime = getWebAppConfigRuntime();
  if (!runtime) {
    if (handler !== null && typeof handler !== 'function') {
      throw new TypeError('power apply handler must be a function or null');
    }
    fallbackPowerApplyHandler = handler;
    return true;
  }
  runtime.setPowerApplyHandler(handler);
  return true;
}

export async function loadWebAppConfig() {
  const runtime = getWebAppConfigRuntime();
  if (!runtime) {
    return normalizeAppConfig(readObject(getLocalStorage(), WEB_APP_CONFIG_KEY, {}));
  }
  try {
    return await runtime.loadConfig();
  } catch (error) {
    console.warn('IndexedDB App Config read failed; using the localStorage mirror:', error);
    return normalizeAppConfig(readObject(getLocalStorage(), WEB_APP_CONFIG_KEY, {}));
  }
}

export async function saveWebAppConfig(config) {
  if (!isPlainObject(config)) return false;
  const runtime = getWebAppConfigRuntime();
  if (!runtime) {
    const storage = getLocalStorage();
    const current = normalizeAppConfig(readObject(storage, WEB_APP_CONFIG_KEY, {}));
    return writeObject(storage, WEB_APP_CONFIG_KEY, normalizeAppConfig({
      ...current,
      ...cloneValue(config)
    }));
  }
  await runtime.commitPatch(config);
  return true;
}

export async function saveWebPowerSavingSettings(partialPowerSaving, options = {}) {
  if (!isPlainObject(partialPowerSaving)) return false;
  const runtime = getWebAppConfigRuntime();
  if (!runtime) {
    const storage = getLocalStorage();
    const current = normalizeAppConfig(readObject(storage, WEB_APP_CONFIG_KEY, {}));
    const powerSaving = mergePowerSavingSettings(current.powerSaving, partialPowerSaving);
    if (!writeObject(storage, WEB_APP_CONFIG_KEY, {
      ...current,
      powerSaving
    })) {
      throw new PowerConfigStoreError(
        'localstorage-write-failed',
        'Failed to persist power settings in localStorage'
      );
    }
    const applySettings = options.applyPowerSettings || fallbackPowerApplyHandler;
    if (typeof applySettings === 'function') await applySettings(cloneValue(powerSaving));
    return cloneValue(powerSaving);
  }
  const result = await runtime.commitPowerSettings(partialPowerSaving, options);
  return result.powerSaving;
}

export function loadWebAudioPreferences() {
  return readObject(getLocalStorage(), WEB_AUDIO_PREFERENCES_KEY, null);
}

export function saveWebAudioPreferences(preferences) {
  if (!isPlainObject(preferences)) return false;
  return writeObject(getLocalStorage(), WEB_AUDIO_PREFERENCES_KEY, { ...preferences });
}
