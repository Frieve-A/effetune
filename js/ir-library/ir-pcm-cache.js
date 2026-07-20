import {
  IR_LIBRARY_MAX_CACHE_ENTRY_BYTES,
  IR_LIBRARY_MAX_CACHE_INDEX_BYTES,
  requireBoundedIrBytes
} from './ir-library-limits.js';

export const DEFAULT_IR_PCM_CACHE_BYTES = 256 * 1024 * 1024;

const PCM_CACHE_INDEX_VERSION = 1;
const PCM_CACHE_INDEX_NAME = 'index.json';
const PCM_MAGIC = 0x43505249;
const PCM_VERSION = 1;
const PCM_HEADER_BYTES = 24;
const MAX_PCM_CHANNELS = 32;
const CACHE_FILE_PATTERN = /^[a-f0-9]{24}@[1-9][0-9]{3,5}(?:-[a-f0-9]{64})?\.f32$/;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = stableValue(value[key]);
  return result;
}

function countBinaryBytes(value, seen = new Set()) {
  if (value instanceof ArrayBuffer) {
    if (seen.has(value)) return 0;
    seen.add(value);
    return value.byteLength;
  }
  if (ArrayBuffer.isView(value)) {
    if (seen.has(value.buffer)) return 0;
    seen.add(value.buffer);
    return value.buffer.byteLength;
  }
  if (!value || typeof value !== 'object') return 0;
  let total = 0;
  for (const item of Object.values(value)) total += countBinaryBytes(item, seen);
  return total;
}

export function createIrPcmCacheKey(irId, sampleRate, preparation = {}) {
  if (!/^[a-f0-9]{24}$/.test(irId) || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new TypeError('A valid IR ID and sample rate are required.');
  }
  return `${irId}@${sampleRate}:${JSON.stringify(stableValue(preparation))}`;
}

async function sha256Hex(value, cryptoProvider) {
  if (!cryptoProvider?.subtle?.digest) throw new Error('SHA-256 is unavailable.');
  const digest = new Uint8Array(await cryptoProvider.subtle.digest('SHA-256', textEncoder.encode(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createPersistentIrPcmCacheName(
  irId,
  sampleRate,
  preparation = {},
  cryptoProvider = globalThis.crypto
) {
  if (!/^[a-f0-9]{24}$/.test(irId) || !Number.isSafeInteger(sampleRate) || sampleRate < 1000 || sampleRate > 999999) {
    throw new TypeError('A valid IR ID and integer sample rate are required.');
  }
  const canonicalPreparation = JSON.stringify(stableValue(preparation));
  if (canonicalPreparation === '{}') return `${irId}@${sampleRate}.f32`;
  const suffix = await sha256Hex(canonicalPreparation, cryptoProvider);
  return `${irId}@${sampleRate}-${suffix}.f32`;
}

export function encodePersistentIrPcm({ sampleRate, channelData }) {
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 1000 || sampleRate > 999999 ||
      !Array.isArray(channelData) || channelData.length < 1 || channelData.length > MAX_PCM_CHANNELS) {
    throw new TypeError('Valid PCM sample rate and channels are required.');
  }
  const frames = channelData[0] instanceof Float32Array ? channelData[0].length : -1;
  if (frames < 1 || !channelData.every(channel => channel instanceof Float32Array && channel.length === frames)) {
    throw new TypeError('PCM channels must be equally sized Float32Arrays.');
  }
  const payloadBytes = channelData.length * frames * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(payloadBytes) || PCM_HEADER_BYTES + payloadBytes > IR_LIBRARY_MAX_CACHE_ENTRY_BYTES) {
    throw new RangeError('Persistent PCM cache entry is too large.');
  }
  const buffer = new ArrayBuffer(PCM_HEADER_BYTES + payloadBytes);
  const view = new DataView(buffer);
  view.setUint32(0, PCM_MAGIC, true);
  view.setUint16(4, PCM_VERSION, true);
  view.setUint16(6, channelData.length, true);
  view.setUint32(8, frames, true);
  view.setUint32(12, sampleRate, true);
  view.setUint32(16, payloadBytes, true);
  view.setUint32(20, 0, true);
  const payload = new Float32Array(buffer, PCM_HEADER_BYTES);
  channelData.forEach((channel, index) => payload.set(channel, index * frames));
  return new Uint8Array(buffer);
}

export function decodePersistentIrPcm(value) {
  requireBoundedIrBytes(value, IR_LIBRARY_MAX_CACHE_ENTRY_BYTES, 'Persistent PCM cache entry');
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : null;
  if (!bytes || bytes.byteLength < PCM_HEADER_BYTES) throw new Error('Invalid persistent PCM cache entry.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = view.getUint16(6, true);
  const frames = view.getUint32(8, true);
  const sampleRate = view.getUint32(12, true);
  const payloadBytes = view.getUint32(16, true);
  if (view.getUint32(0, true) !== PCM_MAGIC || view.getUint16(4, true) !== PCM_VERSION ||
      view.getUint32(20, true) !== 0 || channels < 1 || channels > MAX_PCM_CHANNELS || frames < 1 ||
      sampleRate < 1000 || sampleRate > 999999 || payloadBytes !== channels * frames * Float32Array.BYTES_PER_ELEMENT ||
      bytes.byteLength !== PCM_HEADER_BYTES + payloadBytes) throw new Error('Invalid persistent PCM cache entry.');
  const payload = new Float32Array(channels * frames);
  new Uint8Array(payload.buffer).set(bytes.subarray(PCM_HEADER_BYTES));
  for (const sample of payload) {
    if (!Number.isFinite(sample)) throw new Error('Invalid persistent PCM cache entry.');
  }
  return Object.freeze({
    sampleRate,
    channelData: Object.freeze(Array.from({ length: channels }, (_, index) => payload.subarray(index * frames, (index + 1) * frames)))
  });
}

export class IrPcmCache {
  constructor(maxBytes = DEFAULT_IR_PCM_CACHE_BYTES) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new TypeError('The PCM cache limit must be a non-negative integer.');
    }
    this.maxBytes = maxBytes;
    this.entries = new Map();
    this.byteLength = 0;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    const byteLength = countBinaryBytes(value);
    if (byteLength > this.maxBytes) return false;
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.byteLength -= previous.byteLength;
    }
    while (this.byteLength + byteLength > this.maxBytes && this.entries.size > 0) {
      const oldestKey = this.entries.keys().next().value;
      this.delete(oldestKey);
    }
    this.entries.set(key, { value, byteLength });
    this.byteLength += byteLength;
    return true;
  }

  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.byteLength -= entry.byteLength;
    return true;
  }

  clear() {
    this.entries.clear();
    this.byteLength = 0;
  }

  getStats() {
    return Object.freeze({
      byteLength: this.byteLength,
      entryCount: this.entries.size,
      maxBytes: this.maxBytes
    });
  }
}

function emptyPersistentIndex() {
  return { version: PCM_CACHE_INDEX_VERSION, entries: {} };
}

function validPersistentEntry(name, entry) {
  return CACHE_FILE_PATTERN.test(name) && entry && Number.isSafeInteger(entry.byteLength) && entry.byteLength > 0 &&
    entry.byteLength <= IR_LIBRARY_MAX_CACHE_ENTRY_BYTES &&
    Number.isSafeInteger(entry.lastAccess) && entry.lastAccess >= 0;
}

export class PersistentIrPcmCache {
  constructor(backend, options = {}) {
    const required = ['readCache', 'writeCacheAtomic', 'removeCache', 'listCache'];
    if (!backend || !required.every(name => typeof backend[name] === 'function')) {
      throw new TypeError('A cache-capable IR library backend is required.');
    }
    this.backend = backend;
    this.maxBytes = options.maxBytes ?? DEFAULT_IR_PCM_CACHE_BYTES;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 0) throw new TypeError('Invalid persistent PCM cache limit.');
    this.diagnostic = options.onDiagnostic || (error => console.error('IR PCM cache diagnostic:', error));
    this.cryptoProvider = options.cryptoProvider || globalThis.crypto;
    this.clock = options.clock || (() => Date.now());
    this.index = emptyPersistentIndex();
    this.byteLength = 0;
    this.sequence = 0;
    this.opened = false;
    this.healthy = true;
    this.mutation = Promise.resolve();
  }

  async open() {
    if (this.opened) return this;
    let parsed;
    try {
      const bytes = await this.backend.readCache(PCM_CACHE_INDEX_NAME);
      if (bytes) requireBoundedIrBytes(bytes, IR_LIBRARY_MAX_CACHE_INDEX_BYTES, 'Persistent PCM cache index');
      parsed = bytes ? JSON.parse(textDecoder.decode(bytes)) : emptyPersistentIndex();
      if (parsed?.version !== PCM_CACHE_INDEX_VERSION || !parsed.entries ||
          typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
        throw new Error('Invalid persistent PCM cache index.');
      }
    } catch (error) {
      this.diagnostic(error);
      await this.#recoverCorruptIndex();
      this.opened = true;
      return this;
    }
    const listed = await this.backend.listCache().catch(async error => {
      this.diagnostic(error);
      await this.#disableAndReset();
      return [];
    });
    if (!this.healthy) {
      this.opened = true;
      return this;
    }
    const files = new Map(listed.filter(item => CACHE_FILE_PATTERN.test(item.name)).map(item => [item.name, item.byteLength]));
    let changed = false;
    for (const [name, entry] of Object.entries(parsed.entries)) {
      if (!validPersistentEntry(name, entry) || files.get(name) !== entry.byteLength) {
        delete parsed.entries[name];
        changed = true;
      }
    }
    for (const name of files.keys()) {
      if (!parsed.entries[name]) {
        await this.backend.removeCache(name).catch(error => this.diagnostic(error));
        changed = true;
      }
    }
    this.index = parsed;
    this.byteLength = Object.values(parsed.entries).reduce((total, entry) => total + entry.byteLength, 0);
    this.sequence = Object.values(parsed.entries).reduce((latest, entry) => Math.max(latest, entry.lastAccess), 0);
    await this.#evictToLimit();
    if (changed && this.healthy) await this.#writeIndexSafely();
    this.opened = true;
    return this;
  }

  get(irId, sampleRate, preparation = {}) {
    return this.#serialize(async () => {
      if (!this.healthy) return null;
      const name = await createPersistentIrPcmCacheName(irId, sampleRate, preparation, this.cryptoProvider);
      const entry = this.index.entries[name];
      if (!entry) return null;
      try {
        const bytes = await this.backend.readCache(name);
        if (!bytes || bytes.byteLength !== entry.byteLength) throw new Error('Persistent PCM cache entry is missing or corrupt.');
        const decoded = decodePersistentIrPcm(bytes);
        if (decoded.sampleRate !== sampleRate) throw new Error('Persistent PCM cache rate does not match.');
        entry.lastAccess = this.#nextAccess();
        await this.#writeIndexSafely();
        return decoded;
      } catch (error) {
        this.diagnostic(error);
        await this.#discardEntry(name);
        return null;
      }
    });
  }

  set(irId, sampleRate, preparation, pcm) {
    return this.#serialize(async () => {
      if (!this.healthy) return false;
      let bytes;
      let name;
      try {
        name = await createPersistentIrPcmCacheName(irId, sampleRate, preparation, this.cryptoProvider);
        bytes = encodePersistentIrPcm(pcm);
        if (pcm.sampleRate !== sampleRate || bytes.byteLength > this.maxBytes) return false;
        await this.backend.writeCacheAtomic(name, bytes);
      } catch (error) {
        this.diagnostic(error);
        return false;
      }
      const previous = this.index.entries[name];
      if (previous) this.byteLength -= previous.byteLength;
      this.index.entries[name] = { byteLength: bytes.byteLength, lastAccess: this.#nextAccess() };
      this.byteLength += bytes.byteLength;
      await this.#evictToLimit(name);
      if (!await this.#writeIndexSafely()) return false;
      return this.healthy && Boolean(this.index.entries[name]);
    });
  }

  delete(irId, sampleRate, preparation = {}) {
    return this.#serialize(async () => {
      const name = await createPersistentIrPcmCacheName(irId, sampleRate, preparation, this.cryptoProvider);
      if (!this.index.entries[name]) return false;
      await this.#discardEntry(name);
      return true;
    });
  }

  deleteAll(irId) {
    return this.#serialize(async () => {
      if (!/^[a-f0-9]{24}$/.test(irId)) throw new TypeError('A valid IR ID is required.');
      const prefix = `${irId}@`;
      const names = Object.keys(this.index.entries).filter(name => name.startsWith(prefix));
      for (const name of names) {
        const entry = this.index.entries[name];
        delete this.index.entries[name];
        this.byteLength -= entry.byteLength;
        await this.backend.removeCache(name).catch(error => this.diagnostic(error));
      }
      if (names.length > 0) await this.#writeIndexSafely();
      return names.length;
    });
  }

  clear() {
    return this.#serialize(async () => {
      const files = await this.backend.listCache().catch(error => {
        this.diagnostic(error);
        return [];
      });
      for (const file of files) await this.backend.removeCache(file.name).catch(error => this.diagnostic(error));
      this.index = emptyPersistentIndex();
      this.byteLength = 0;
      await this.#writeIndexSafely();
    });
  }

  getStats() {
    return Object.freeze({ byteLength: this.byteLength, entryCount: Object.keys(this.index.entries).length, maxBytes: this.maxBytes });
  }

  #serialize(task) {
    const run = this.mutation.then(() => {
      if (!this.opened) throw new Error('Open the persistent PCM cache before using it.');
      return task();
    });
    this.mutation = run.catch(() => {});
    return run;
  }

  #nextAccess() {
    this.sequence = Math.max(this.sequence + 1, Math.floor(this.clock()));
    return this.sequence;
  }

  async #discardEntry(name) {
    const entry = this.index.entries[name];
    if (!entry) return;
    delete this.index.entries[name];
    this.byteLength -= entry.byteLength;
    await this.backend.removeCache(name).catch(error => this.diagnostic(error));
    await this.#writeIndexSafely();
  }

  async #evictToLimit(protectedName = null) {
    while (this.byteLength > this.maxBytes) {
      const candidates = Object.entries(this.index.entries)
        .filter(([name]) => name !== protectedName)
        .sort((left, right) => left[1].lastAccess - right[1].lastAccess);
      const oldest = candidates[0] || Object.entries(this.index.entries).sort((left, right) => left[1].lastAccess - right[1].lastAccess)[0];
      if (!oldest) break;
      const [name, entry] = oldest;
      delete this.index.entries[name];
      this.byteLength -= entry.byteLength;
      await this.backend.removeCache(name).catch(error => this.diagnostic(error));
    }
  }

  async #writeIndexSafely() {
    if (!this.healthy) return false;
    try {
      const bytes = textEncoder.encode(JSON.stringify(this.index));
      requireBoundedIrBytes(bytes, IR_LIBRARY_MAX_CACHE_INDEX_BYTES, 'Persistent PCM cache index');
      await this.backend.writeCacheAtomic(PCM_CACHE_INDEX_NAME, bytes);
      return true;
    } catch (error) {
      this.diagnostic(error);
      await this.#disableAndReset();
      return false;
    }
  }

  async #disableAndReset() {
    this.healthy = false;
    const files = await this.backend.listCache().catch(() => []);
    for (const file of files) await this.backend.removeCache(file.name).catch(() => {});
    this.index = emptyPersistentIndex();
    this.byteLength = 0;
    await this.backend.writeCacheAtomic(PCM_CACHE_INDEX_NAME, textEncoder.encode(JSON.stringify(this.index))).catch(() => {});
  }

  async #recoverCorruptIndex() {
    const files = await this.backend.listCache().catch(error => {
      this.diagnostic(error);
      return [];
    });
    for (const file of files) await this.backend.removeCache(file.name).catch(error => this.diagnostic(error));
    this.index = emptyPersistentIndex();
    this.byteLength = 0;
    try {
      await this.backend.writeCacheAtomic(PCM_CACHE_INDEX_NAME, textEncoder.encode(JSON.stringify(this.index)));
      this.healthy = true;
    } catch (error) {
      this.diagnostic(error);
      this.healthy = false;
    }
  }
}
