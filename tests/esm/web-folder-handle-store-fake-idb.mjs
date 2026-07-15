function clone(value) {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value);
  } catch (error) {
    if (value?.kind === 'directory' && typeof value.values === 'function') return value;
    if (value?.handle?.kind === 'directory' && typeof value.handle.values === 'function') {
      return { ...value, handle: value.handle };
    }
    throw error;
  }
}

function keyTypeRank(value) {
  if (typeof value === 'number') return 0;
  if (typeof value === 'string') return 1;
  if (Array.isArray(value)) return 2;
  throw new TypeError(`Unsupported fake IndexedDB key: ${String(value)}`);
}

function compareKeys(left, right) {
  const leftRank = keyTypeRank(left);
  const rightRank = keyTypeRank(right);
  if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1;
  if (Array.isArray(left)) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const result = compareKeys(left[index], right[index]);
      if (result !== 0) return result;
    }
    return Math.sign(left.length - right.length);
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function keyAt(value, keyPath) {
  if (Array.isArray(keyPath)) {
    const key = keyPath.map(path => keyAt(value, path));
    return key.some(part => part === undefined || part === null) ? undefined : key;
  }
  return keyPath.split('.').reduce((current, part) => current?.[part], value);
}

function serializeKey(key) {
  return JSON.stringify(key);
}

class FakeKeyRange {
  constructor(lower, upper, lowerOpen, upperOpen) {
    this.lower = lower;
    this.upper = upper;
    this.lowerOpen = lowerOpen;
    this.upperOpen = upperOpen;
  }

  includes(key) {
    if (this.lower !== undefined) {
      const result = compareKeys(key, this.lower);
      if (result < 0 || (result === 0 && this.lowerOpen)) return false;
    }
    if (this.upper !== undefined) {
      const result = compareKeys(key, this.upper);
      if (result > 0 || (result === 0 && this.upperOpen)) return false;
    }
    return true;
  }

  static bound(lower, upper, lowerOpen = false, upperOpen = false) {
    return new FakeKeyRange(lower, upper, lowerOpen, upperOpen);
  }

  static lowerBound(lower, open = false) {
    return new FakeKeyRange(lower, undefined, open, false);
  }

  static upperBound(upper, open = false) {
    return new FakeKeyRange(undefined, upper, false, open);
  }
}

class FakeTransaction {
  constructor(connection, storeNames, mode) {
    this.connection = connection;
    this.storeNames = new Set(Array.isArray(storeNames) ? storeNames : [storeNames]);
    this.mode = mode;
    this.error = null;
    this.pending = 0;
    this.completionTimer = null;
    this.finished = false;
  }

  objectStore(name) {
    if (!this.storeNames.has(name)) throw new Error(`Store is outside transaction: ${name}`);
    const definition = this.connection.definition.stores.get(name);
    if (!definition) throw new Error(`Missing fake object store: ${name}`);
    return new FakeObjectStore(this, definition);
  }

  request(operation) {
    if (this.finished) throw new Error('Fake IndexedDB transaction is inactive');
    clearTimeout(this.completionTimer);
    this.pending += 1;
    const request = { result: undefined, error: null };
    queueMicrotask(() => {
      if (this.finished) return;
      try {
        request.result = clone(operation());
        request.onsuccess?.();
      } catch (error) {
        request.error = error;
        this.error = error;
        request.onerror?.();
        this.abort();
        return;
      }
      this.pending -= 1;
      this.scheduleCompletion();
    });
    return request;
  }

  cursor(entries, deleteEntry, updateEntry) {
    if (this.finished) throw new Error('Fake IndexedDB transaction is inactive');
    clearTimeout(this.completionTimer);
    this.pending += 1;
    const request = { result: undefined, error: null };
    let index = 0;
    const emit = () => queueMicrotask(() => {
      if (this.finished) return;
      if (index >= entries.length) {
        request.result = undefined;
        request.onsuccess?.();
        this.pending -= 1;
        this.scheduleCompletion();
        return;
      }
      const entry = entries[index];
      let continued = false;
      request.result = {
        key: clone(entry.key),
        primaryKey: clone(entry.primaryKey),
        value: clone(entry.value),
        continue() {
          continued = true;
          index += 1;
          emit();
        },
        advance(count) {
          if (!Number.isSafeInteger(count) || count < 1) throw new TypeError('Cursor advance count must be positive');
          continued = true;
          index += count;
          emit();
        },
        delete: () => this.request(() => deleteEntry(entry.primaryKey)),
        update: value => this.request(() => updateEntry(entry.primaryKey, value))
      };
      request.onsuccess?.();
      if (!continued) {
        this.pending -= 1;
        this.scheduleCompletion();
      }
    });
    emit();
    return request;
  }

  scheduleCompletion() {
    if (this.pending !== 0 || this.finished) return;
    clearTimeout(this.completionTimer);
    this.completionTimer = setTimeout(() => {
      if (this.pending !== 0 || this.finished) return;
      this.finished = true;
      this.oncomplete?.();
    }, 0);
  }

  abort() {
    if (this.finished) return;
    clearTimeout(this.completionTimer);
    this.finished = true;
    this.onabort?.();
  }
}

class FakeIndex {
  constructor(transaction, definition, indexDefinition) {
    this.transaction = transaction;
    this.definition = definition;
    this.indexDefinition = indexDefinition;
  }

  entries(range, direction) {
    const entries = [];
    for (const { key: primaryKey, value } of this.definition.records.values()) {
      const key = keyAt(value, this.indexDefinition.keyPath);
      if (key === undefined || key === null || range && !range.includes(key)) continue;
      entries.push({ key, primaryKey, value });
    }
    entries.sort((left, right) => compareKeys(left.key, right.key) || compareKeys(left.primaryKey, right.primaryKey));
    if (direction === 'prev' || direction === 'prevunique') entries.reverse();
    return entries;
  }

  openCursor(range = null, direction = 'next') {
    return this.transaction.cursor(
      this.entries(range, direction),
      primaryKey => this.definition.records.delete(serializeKey(primaryKey)),
      (primaryKey, value) => {
        const record = clone(value);
        const key = keyAt(record, this.definition.keyPath);
        if (compareKeys(key, primaryKey) !== 0) throw new Error('Fake cursor update changed the primary key');
        this.definition.records.set(serializeKey(primaryKey), { key: clone(primaryKey), value: record });
        return primaryKey;
      }
    );
  }

  count(range = null) {
    return this.transaction.request(() => this.entries(range, 'next').length);
  }
}

class FakeObjectStore {
  constructor(transaction, definition) {
    this.transaction = transaction;
    this.definition = definition;
  }

  get indexNames() {
    return { contains: name => this.definition.indexes.has(name) };
  }

  createIndex(name, keyPath, options = {}) {
    this.definition.indexes.set(name, { keyPath, options });
    return new FakeIndex(this.transaction, this.definition, this.definition.indexes.get(name));
  }

  index(name) {
    const definition = this.definition.indexes.get(name);
    if (!definition) throw new Error(`Missing fake index: ${name}`);
    return new FakeIndex(this.transaction, this.definition, definition);
  }

  put(value) {
    return this.transaction.request(() => {
      const record = clone(value);
      const key = keyAt(record, this.definition.keyPath);
      if (key === undefined || key === null) throw new Error('Missing fake object-store key');
      for (const indexDefinition of this.definition.indexes.values()) {
        if (!indexDefinition.options.unique) continue;
        const indexKey = keyAt(record, indexDefinition.keyPath);
        for (const existing of this.definition.records.values()) {
          if (compareKeys(keyAt(existing.value, indexDefinition.keyPath), indexKey) === 0
              && compareKeys(existing.key, key) !== 0) {
            throw new Error('Fake IndexedDB unique index constraint failed');
          }
        }
      }
      this.definition.records.set(serializeKey(key), { key: clone(key), value: record });
      return key;
    });
  }

  get(key) {
    return this.transaction.request(() => this.definition.records.get(serializeKey(key))?.value);
  }

  delete(key) {
    return this.transaction.request(() => this.definition.records.delete(serializeKey(key)));
  }

  count(range = null) {
    return this.transaction.request(() => {
      if (!range) return this.definition.records.size;
      return [...this.definition.records.values()].filter(entry => range.includes(entry.key)).length;
    });
  }

  openCursor(range = null, direction = 'next') {
    let entries = [...this.definition.records.values()]
      .filter(entry => !range || range.includes(entry.key))
      .map(entry => ({ key: entry.key, primaryKey: entry.key, value: entry.value }))
      .sort((left, right) => compareKeys(left.key, right.key));
    if (direction === 'prev' || direction === 'prevunique') entries = entries.reverse();
    return this.transaction.cursor(
      entries,
      primaryKey => this.definition.records.delete(serializeKey(primaryKey)),
      (primaryKey, value) => {
        const record = clone(value);
        const key = keyAt(record, this.definition.keyPath);
        if (compareKeys(key, primaryKey) !== 0) throw new Error('Fake cursor update changed the primary key');
        this.definition.records.set(serializeKey(primaryKey), { key: clone(primaryKey), value: record });
        return primaryKey;
      }
    );
  }
}

function createUpgradeStore(definition) {
  return {
    createIndex(name, keyPath, options = {}) {
      definition.indexes.set(name, { keyPath, options });
      return {};
    },
    indexNames: { contains: name => definition.indexes.has(name) }
  };
}

function createConnection(definition) {
  return {
    definition,
    objectStoreNames: { contains: name => definition.stores.has(name) },
    createObjectStore(name, options) {
      const store = { keyPath: options.keyPath, records: new Map(), indexes: new Map() };
      definition.stores.set(name, store);
      return createUpgradeStore(store);
    },
    transaction(storeNames, mode) {
      return new FakeTransaction(this, storeNames, mode);
    },
    close() {
      this.closed = true;
    }
  };
}

export function createFakeIndexedDb() {
  const databases = new Map();
  const opens = [];
  return {
    opens,
    databases,
    keyRange: FakeKeyRange,
    open(name, version) {
      opens.push({ name, version });
      const request = { result: undefined, error: null };
      queueMicrotask(() => {
        let definition = databases.get(name);
        const oldVersion = definition?.version ?? 0;
        if (!definition) {
          definition = { version, stores: new Map() };
          databases.set(name, definition);
        }
        request.result = createConnection(definition);
        if (oldVersion < version) {
          request.transaction = {
            objectStore(name) {
              const store = definition.stores.get(name);
              if (!store) throw new Error(`Missing fake object store during upgrade: ${name}`);
              return createUpgradeStore(store);
            }
          };
          request.onupgradeneeded?.({ oldVersion, newVersion: version });
          definition.version = version;
        }
        request.onsuccess?.();
      });
      return request;
    }
  };
}

export function createFakeLockManager() {
  const held = new Set();
  return {
    request(name, options, callback) {
      if (!options.ifAvailable) throw new Error('Fake lock requires ifAvailable');
      if (held.has(name)) return Promise.resolve(callback(null));
      held.add(name);
      return Promise.resolve(callback({ name })).finally(() => held.delete(name));
    }
  };
}
