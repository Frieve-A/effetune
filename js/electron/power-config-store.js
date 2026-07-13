const REVISION_KEYS = Object.freeze(['counter', 'writerInstanceId']);
const DEFAULT_WRITER_INSTANCE_ID = 'local';

export class PowerConfigStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PowerConfigStoreError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) throw new TypeError(`${name} must be a plain object`);
}

function cloneValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('durable numbers must be finite');
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`unsupported durable value type: ${typeof value}`);
  }
  if (Array.isArray(value)) {
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError('durable arrays must not be sparse');
      }
      result.push(cloneValue(value[index]));
    }
    return result;
  }
  if (!isPlainObject(value)) throw new TypeError('durable values must contain only plain data');
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => typeof key !== 'string') || ownKeys.length !== Object.keys(value).length) {
    throw new TypeError('durable objects require enumerable string keys');
  }
  const result = {};
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError('durable objects must not contain accessors');
    }
    result[key] = cloneValue(descriptor.value);
  }
  return result;
}

function freezeValue(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) freezeValue(entry);
  return Object.freeze(value);
}

function cloneFrozen(value) {
  return freezeValue(cloneValue(value));
}

function assertSynchronousResult(value, name) {
  if (value && typeof value.then === 'function') {
    throw new TypeError(`${name} must be synchronous inside the durable transaction`);
  }
}

function normalizeWriterInstanceId(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('writerInstanceId must be a nonempty string');
  }
  return value;
}

export function normalizeConfigRevision(value, name = 'revision') {
  assertPlainObject(value, name);
  const keys = Object.keys(value).sort();
  if (keys.length !== REVISION_KEYS.length ||
      keys.some((key, index) => key !== REVISION_KEYS[index])) {
    throw new TypeError(`${name} must contain exactly: ${REVISION_KEYS.join(', ')}`);
  }
  if (!Number.isSafeInteger(value.counter) || value.counter < 0) {
    throw new RangeError(`${name}.counter must be a nonnegative safe integer`);
  }
  return freezeValue({
    counter: value.counter,
    writerInstanceId: normalizeWriterInstanceId(value.writerInstanceId)
  });
}

function revisionsEqual(left, right) {
  if (left === null || right === null) return left === right;
  return left.counter === right.counter && left.writerInstanceId === right.writerInstanceId;
}

function createInitialState() {
  return {
    schemaVersion: 1,
    revisionCounter: 0,
    config: {},
    currentRevision: null
  };
}

function normalizeState(value) {
  if (value === undefined || value === null) return createInitialState();
  assertPlainObject(value, 'power config state');
  const currentRevision = value.currentRevision === null || value.currentRevision === undefined
    ? null
    : normalizeConfigRevision(value.currentRevision, 'power config state.currentRevision');
  const storedCounter = Number.isSafeInteger(value.revisionCounter) && value.revisionCounter >= 0
    ? value.revisionCounter
    : 0;
  const revisionCounter = currentRevision === null
    ? storedCounter
    : Math.max(storedCounter, currentRevision.counter);
  const config = value.config === undefined ? {} : cloneValue(value.config);
  assertPlainObject(config, 'power config state.config');
  return {
    schemaVersion: 1,
    revisionCounter,
    config,
    currentRevision: currentRevision === null ? null : cloneValue(currentRevision)
  };
}

function replaceState(target, state) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, cloneValue(state));
}

export class SerializedMemoryPowerConfigBackend {
  #state;
  #tail = Promise.resolve();

  constructor({ initialState = createInitialState() } = {}) {
    this.#state = cloneValue(initialState);
  }

  runTransaction(mutator) {
    const operation = this.#tail.then(() => {
      const draft = cloneValue(this.#state);
      const result = mutator(draft);
      assertSynchronousResult(result, 'memory transaction mutator');
      const durableState = cloneValue(draft);
      const durableResult = result === undefined ? undefined : cloneValue(result);
      this.#state = durableState;
      return durableResult;
    });
    this.#tail = operation.catch(() => {});
    return operation;
  }

  async readState() {
    await this.#tail;
    return cloneValue(this.#state);
  }

  close() {}
}

export class IndexedDbPowerConfigBackend {
  constructor({
    indexedDB,
    databaseName = 'effetune-power-config-v1',
    databaseVersion = 1
  }) {
    if (!indexedDB || typeof indexedDB.open !== 'function') {
      throw new TypeError('IndexedDbPowerConfigBackend requires indexedDB');
    }
    this.indexedDB = indexedDB;
    this.databaseName = databaseName;
    this.databaseVersion = databaseVersion;
    this.dbPromise = null;
  }

  open() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.databaseName, this.databaseVersion);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('state')) {
          db.createObjectStore('state', { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Failed to open power config database'));
    });
    return this.dbPromise;
  }

  async runTransaction(mutator) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('state', 'readwrite');
      const store = transaction.objectStore('state');
      const request = store.get('origin-state');
      let result;
      let failure = null;

      request.onsuccess = () => {
        try {
          const draft = cloneValue(request.result?.value || createInitialState());
          result = mutator(draft);
          assertSynchronousResult(result, 'IndexedDB transaction mutator');
          result = result === undefined ? undefined : cloneValue(result);
          const writeRequest = store.put({ key: 'origin-state', value: cloneValue(draft) });
          writeRequest.onerror = () => {
            failure = writeRequest.error || new Error('Failed to write power config state');
          };
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      request.onerror = () => {
        failure = request.error || new Error('Failed to read power config state');
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(
        failure || transaction.error || new Error('Power config transaction aborted')
      );
      transaction.onerror = () => {
        failure ||= transaction.error || new Error('Power config transaction failed');
      };
    });
  }

  async readState() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('state', 'readonly');
      const request = transaction.objectStore('state').get('origin-state');
      let state;
      let failure = null;
      request.onsuccess = () => {
        state = cloneValue(request.result?.value || createInitialState());
      };
      request.onerror = () => {
        failure = request.error || new Error('Failed to read power config state');
      };
      transaction.oncomplete = () => resolve(state);
      transaction.onabort = () => reject(
        failure || transaction.error || new Error('Power config read transaction aborted')
      );
      transaction.onerror = () => {
        failure ||= transaction.error || new Error('Power config read transaction failed');
      };
    });
  }

  async close() {
    const db = await this.dbPromise;
    db?.close();
    this.dbPromise = null;
  }
}

function assertExpectedRevision(actual, expected) {
  const normalizedExpected = expected === null
    ? null
    : normalizeConfigRevision(expected, 'expectedRevision');
  if (!revisionsEqual(actual, normalizedExpected)) {
    throw new PowerConfigStoreError(
      'revision-mismatch',
      'expectedRevision does not match current revision'
    );
  }
}

export class PowerConfigStore {
  constructor({
    indexedDB = globalThis.indexedDB,
    backend = null,
    memoryBackend = null,
    databaseName = 'effetune-power-config-v1',
    writerInstanceId = DEFAULT_WRITER_INSTANCE_ID
  } = {}) {
    this.writerInstanceId = normalizeWriterInstanceId(writerInstanceId);
    this.backend = backend || (indexedDB
      ? new IndexedDbPowerConfigBackend({ indexedDB, databaseName })
      : memoryBackend || new SerializedMemoryPowerConfigBackend());
    if (typeof this.backend.runTransaction !== 'function' ||
        typeof this.backend.readState !== 'function') {
      throw new TypeError('PowerConfigStore backend must implement runTransaction and readState');
    }
  }

  async readCurrentConfig() {
    const state = normalizeState(await this.backend.readState());
    return cloneFrozen({
      revision: state.currentRevision,
      config: state.config
    });
  }

  async updateConfig(updater, { expectedRevision } = {}) {
    if (typeof updater !== 'function') throw new TypeError('config updater must be a function');
    const snapshot = await this.backend.runTransaction(rawState => {
      const state = normalizeState(rawState);
      if (expectedRevision !== undefined) {
        assertExpectedRevision(state.currentRevision, expectedRevision);
      }
      const updatedConfig = updater(cloneValue(state.config));
      assertSynchronousResult(updatedConfig, 'config updater');
      assertPlainObject(updatedConfig, 'updated config');
      const config = cloneValue(updatedConfig);
      const nextCounter = state.revisionCounter + 1;
      if (!Number.isSafeInteger(nextCounter)) {
        throw new RangeError('revision counter exceeds Number.MAX_SAFE_INTEGER');
      }
      const revision = {
        counter: nextCounter,
        writerInstanceId: this.writerInstanceId
      };
      replaceState(rawState, {
        schemaVersion: 1,
        revisionCounter: nextCounter,
        config,
        currentRevision: revision
      });
      return { revision, config };
    });
    return cloneFrozen(snapshot);
  }

  async close() {
    await this.backend.close?.();
  }
}
