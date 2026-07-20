import {
  IR_LIBRARY_INDEX_TOO_LARGE_CODE,
  maxIrCacheBytesForName,
  maxIrLibraryBytesForName,
  requireBoundedIrBytes
} from './ir-library-limits.js';

const ROOT_NAME = 'ir-library';
const ALLOWED_NAME = /^(?:index\.json|[a-f0-9]{24}(?:\.(?:L|R))?\.[a-z0-9]{1,10})$/;
const CACHE_NAME = /^(?:index\.json|[a-f0-9]{24}@[1-9][0-9]{3,5}(?:-[a-f0-9]{64})?\.f32)$/;

function indexTooLargeError() {
  const error = new RangeError('The IR library index is too large.');
  error.code = IR_LIBRARY_INDEX_TOO_LARGE_CODE;
  return error;
}

function requireName(name) {
  if (typeof name !== 'string' || !ALLOWED_NAME.test(name)) {
    throw new TypeError('Invalid IR library item.');
  }
  return name;
}

function requireCacheName(name) {
  if (typeof name !== 'string' || !CACHE_NAME.test(name)) throw new TypeError('Invalid IR cache item.');
  return name;
}

function asBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('IR library data must be binary.');
}

export class OpfsIrLibraryBackend {
  constructor(directory) {
    this.directory = directory;
    this.cacheDirectoryPromise = null;
  }

  async read(name) {
    requireName(name);
    try {
      const handle = await this.directory.getFileHandle(name);
      const file = await handle.getFile();
      if (Number.isSafeInteger(file.size) && file.size > maxIrLibraryBytesForName(name)) {
        if (name === 'index.json') throw indexTooLargeError();
        throw new RangeError('IR library item is too large.');
      }
      const buffer = await file.arrayBuffer();
      try {
        requireBoundedIrBytes(buffer, maxIrLibraryBytesForName(name), 'IR library item');
      } catch (error) {
        if (name === 'index.json' && error instanceof RangeError) throw indexTooLargeError();
        throw error;
      }
      return new Uint8Array(buffer);
    } catch (error) {
      if (error?.name === 'NotFoundError') return null;
      throw error;
    }
  }

  async exists(name) {
    requireName(name);
    try {
      await this.directory.getFileHandle(name);
      return true;
    } catch (error) {
      if (error?.name === 'NotFoundError') return false;
      throw error;
    }
  }

  async writeAtomic(name, bytes) {
    requireName(name);
    requireBoundedIrBytes(bytes, maxIrLibraryBytesForName(name), 'IR library item');
    const handle = await this.directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable({ keepExistingData: false });
    try {
      await writable.write(asBytes(bytes));
      await writable.close();
    } catch (error) {
      await writable.abort?.().catch(() => {});
      throw error;
    }
  }

  async remove(name) {
    requireName(name);
    try {
      await this.directory.removeEntry(name);
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
  }

  async list() {
    const names = [];
    for await (const [name, handle] of this.directory.entries()) {
      if (handle.kind === 'file' && ALLOWED_NAME.test(name)) names.push(name);
    }
    return names;
  }

  async cleanupTemporary() {}

  async readCache(name) {
    requireCacheName(name);
    const directory = await this.#getCacheDirectory();
    try {
      const handle = await directory.getFileHandle(name);
      const file = await handle.getFile();
      if (Number.isSafeInteger(file.size) && file.size > maxIrCacheBytesForName(name)) {
        throw new RangeError('IR cache item is too large.');
      }
      const buffer = await file.arrayBuffer();
      requireBoundedIrBytes(buffer, maxIrCacheBytesForName(name), 'IR cache item');
      return new Uint8Array(buffer);
    } catch (error) {
      if (error?.name === 'NotFoundError') return null;
      throw error;
    }
  }

  async writeCacheAtomic(name, bytes) {
    requireCacheName(name);
    requireBoundedIrBytes(bytes, maxIrCacheBytesForName(name), 'IR cache item');
    const directory = await this.#getCacheDirectory();
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable({ keepExistingData: false });
    try {
      await writable.write(asBytes(bytes));
      await writable.close();
    } catch (error) {
      await writable.abort?.().catch(() => {});
      throw error;
    }
  }

  async removeCache(name) {
    requireCacheName(name);
    const directory = await this.#getCacheDirectory();
    try {
      await directory.removeEntry(name);
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
  }

  async listCache() {
    const directory = await this.#getCacheDirectory();
    const entries = [];
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind !== 'file' || name === 'index.json' || !CACHE_NAME.test(name)) continue;
      const file = await handle.getFile();
      entries.push({ name, byteLength: file.size });
    }
    return entries;
  }

  #getCacheDirectory() {
    this.cacheDirectoryPromise ||= this.directory.getDirectoryHandle('cache', { create: true });
    return this.cacheDirectoryPromise;
  }
}

export async function openOpfsIrLibraryBackend(storage = globalThis.navigator?.storage) {
  if (typeof storage?.getDirectory !== 'function') throw new Error('OPFS is unavailable.');
  const originRoot = await storage.getDirectory();
  const directory = await originRoot.getDirectoryHandle(ROOT_NAME, { create: true });
  return new OpfsIrLibraryBackend(directory);
}
