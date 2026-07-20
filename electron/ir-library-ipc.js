const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CHANNELS = Object.freeze({
  read: 'ir-library-v1:read',
  exists: 'ir-library-v1:exists',
  writeAtomic: 'ir-library-v1:write-atomic',
  remove: 'ir-library-v1:remove',
  list: 'ir-library-v1:list',
  cleanupTemporary: 'ir-library-v1:cleanup-temporary',
  readCache: 'ir-library-v1:cache-read',
  writeCacheAtomic: 'ir-library-v1:cache-write-atomic',
  removeCache: 'ir-library-v1:cache-remove',
  listCache: 'ir-library-v1:cache-list'
});
const ALLOWED_NAME = /^(?:index\.json|[a-f0-9]{24}(?:\.(?:L|R))?\.[a-z0-9]{1,10})$/;
const CACHE_NAME = /^(?:index\.json|[a-f0-9]{24}@[1-9][0-9]{3,5}(?:-[a-f0-9]{64})?\.f32)$/;
const ANALYSIS_NAME = /^[a-f0-9]{24}(?:\.analysis|\.a[0-9]{9})$/;
const INDEX_TOO_LARGE_CODE = 'ir-library-index-too-large';
const SIZE_LIMITS = Object.freeze({
  original: 64 * 1024 * 1024,
  index: 32 * 1024 * 1024,
  analysis: 4 * 1024 * 1024,
  cacheEntry: 64 * 1024 * 1024,
  cacheIndex: 4 * 1024 * 1024,
  listEntries: 100000
});

function comparable(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function maxLibraryBytes(name) {
  if (name === 'index.json') return SIZE_LIMITS.index;
  if (ANALYSIS_NAME.test(name)) return SIZE_LIMITS.analysis;
  return SIZE_LIMITS.original;
}

function maxCacheBytes(name) {
  return name === 'index.json' ? SIZE_LIMITS.cacheIndex : SIZE_LIMITS.cacheEntry;
}

function requireBoundedData(value, maxBytes) {
  const byteLength = Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)
    ? value.byteLength
    : null;
  if (!Number.isSafeInteger(byteLength)) throw new Error('invalidData');
  if (byteLength > maxBytes) throw new Error('dataTooLarge');
  return byteLength;
}

function requireBoundedFile(stats, maxBytes) {
  if (!Number.isSafeInteger(stats?.size) || stats.size < 0 || stats.size > maxBytes) throw new Error('fileTooLarge');
}

function validateName(name) {
  if (typeof name !== 'string' || !ALLOWED_NAME.test(name)) throw new Error('invalidName');
  return name;
}

function validateCacheName(name) {
  if (typeof name !== 'string' || !CACHE_NAME.test(name)) throw new Error('invalidCacheName');
  return name;
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error('invalidData');
}

async function safeTarget(root, name, options = {}) {
  (options.validate || validateName)(name);
  const rootPath = await fs.promises.realpath(root);
  const target = path.resolve(rootPath, name);
  if (path.dirname(target) !== rootPath) throw new Error('outsideRoot');
  try {
    const stats = await fs.promises.lstat(target);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error('linkedTarget');
    const realTarget = await fs.promises.realpath(target);
    if (comparable(realTarget) !== comparable(target)) throw new Error('linkedTarget');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (options.mustExist) return null;
  }
  return target;
}

async function writeAtomic(rootPath, target, data) {
  const tempPath = path.join(rootPath, `.tmp-${crypto.randomUUID()}`);
  try {
    const handle = await fs.promises.open(tempPath, 'wx');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(tempPath, target);
  } catch (error) {
    await fs.promises.unlink(tempPath).catch(() => {});
    throw error;
  }
}

function failure(logger, operation, error, publicCode = 'storage-failed') {
  logger.error(`IR library ${operation} diagnostic:`, String(error?.code || error?.message || 'storageFailed').slice(0, 128));
  return { ok: false, code: publicCode };
}

async function verifyDirectoryRoot(expectedPath, errorCode) {
  const stats = await fs.promises.lstat(expectedPath);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(errorCode);
  const realPath = await fs.promises.realpath(expectedPath);
  if (comparable(realPath) !== comparable(expectedPath)) throw new Error(errorCode);
  return expectedPath;
}

function registerIrLibraryIpc({ ipcMain, getUserDataPath, logger = console }) {
  if (!ipcMain?.handle || typeof getUserDataPath !== 'function') throw new TypeError('IR library IPC dependencies are required.');
  let rootReady;
  const initializeRootPath = () => {
    if (!rootReady) {
      const currentPromise = (async () => {
        const userDataPath = await fs.promises.realpath(getUserDataPath());
        const expectedRoot = path.join(userDataPath, 'ir-library');
        await fs.promises.mkdir(expectedRoot, { recursive: true });
        const realRoot = await fs.promises.realpath(expectedRoot);
        if (comparable(realRoot) !== comparable(expectedRoot)) throw new Error('linkedLibraryRoot');
        return verifyDirectoryRoot(realRoot, 'linkedLibraryRoot');
      })().catch(error => {
        if (rootReady === currentPromise) rootReady = null;
        throw error;
      });
      rootReady = currentPromise;
    }
    return rootReady;
  };
  const getRootPath = async () => verifyDirectoryRoot(await initializeRootPath(), 'linkedLibraryRoot');
  let cacheReady;
  const initializeCacheRootPath = () => {
    if (!cacheReady) {
      const currentPromise = initializeRootPath()
        .then(async rootPath => {
          const cachePath = path.join(rootPath, 'cache');
          await fs.promises.mkdir(cachePath, { recursive: true });
          const realCachePath = await fs.promises.realpath(cachePath);
          if (comparable(realCachePath) !== comparable(cachePath)) throw new Error('linkedCacheRoot');
          return verifyDirectoryRoot(realCachePath, 'linkedCacheRoot');
        })
        .catch(error => {
          if (cacheReady === currentPromise) cacheReady = null;
          throw error;
        });
      cacheReady = currentPromise;
    }
    return cacheReady;
  };
  const getCacheRootPath = async () => {
    await getRootPath();
    return verifyDirectoryRoot(await initializeCacheRootPath(), 'linkedCacheRoot');
  };

  const handlers = {
    [CHANNELS.read]: async (_event, request = {}) => {
      try {
        const rootPath = await getRootPath();
        const target = await safeTarget(rootPath, request.name, { mustExist: true });
        if (!target) return { ok: true, data: null };
        const maxBytes = maxLibraryBytes(request.name);
        const stats = await fs.promises.stat(target);
        if (request.name === 'index.json' && Number.isSafeInteger(stats?.size) && stats.size > maxBytes) {
          const error = new Error('fileTooLarge');
          error.code = INDEX_TOO_LARGE_CODE;
          throw error;
        }
        requireBoundedFile(stats, maxBytes);
        const data = await fs.promises.readFile(target);
        requireBoundedData(data, maxBytes);
        return { ok: true, data: new Uint8Array(data) };
      } catch (error) {
        const publicCode = request.name === 'index.json' && error?.code === INDEX_TOO_LARGE_CODE
          ? INDEX_TOO_LARGE_CODE
          : 'storage-failed';
        return failure(logger, 'read', error, publicCode);
      }
    },
    [CHANNELS.exists]: async (_event, request = {}) => {
      try {
        const rootPath = await getRootPath();
        return { ok: true, data: Boolean(await safeTarget(rootPath, request.name, { mustExist: true })) };
      } catch (error) {
        return failure(logger, 'existence check', error);
      }
    },
    [CHANNELS.writeAtomic]: async (_event, request = {}) => {
      try {
        const rootPath = await getRootPath();
        const target = await safeTarget(rootPath, request.name);
        requireBoundedData(request.bytes, maxLibraryBytes(request.name));
        const data = asBuffer(request.bytes);
        await writeAtomic(rootPath, target, data);
        return { ok: true, data: true };
      } catch (error) {
        return failure(logger, 'write', error);
      }
    },
    [CHANNELS.remove]: async (_event, request = {}) => {
      try {
        const rootPath = await getRootPath();
        const target = await safeTarget(rootPath, request.name, { mustExist: true });
        if (target) await fs.promises.unlink(target);
        return { ok: true, data: true };
      } catch (error) {
        return failure(logger, 'remove', error);
      }
    },
    [CHANNELS.list]: async () => {
      try {
        const rootPath = await getRootPath();
        const entries = await fs.promises.readdir(rootPath, { withFileTypes: true });
        const data = entries.filter(entry => entry.isFile() && ALLOWED_NAME.test(entry.name)).map(entry => entry.name);
        if (data.length > SIZE_LIMITS.listEntries) throw new Error('tooManyFiles');
        return {
          ok: true,
          data
        };
      } catch (error) {
        return failure(logger, 'list', error);
      }
    },
    [CHANNELS.cleanupTemporary]: async () => {
      try {
        const rootPath = await getRootPath();
        const names = await fs.promises.readdir(rootPath);
        for (const name of names.filter(item => /^\.tmp-[a-f0-9-]+$/i.test(item))) {
          await fs.promises.unlink(path.join(rootPath, name)).catch(() => {});
        }
        return { ok: true, data: true };
      } catch (error) {
        return failure(logger, 'temporary cleanup', error);
      }
    },
    [CHANNELS.readCache]: async (_event, request = {}) => {
      try {
        const cacheRoot = await getCacheRootPath();
        const target = await safeTarget(cacheRoot, request.name, { mustExist: true, validate: validateCacheName });
        if (!target) return { ok: true, data: null };
        const maxBytes = maxCacheBytes(request.name);
        requireBoundedFile(await fs.promises.stat(target), maxBytes);
        const data = await fs.promises.readFile(target);
        requireBoundedData(data, maxBytes);
        return { ok: true, data: new Uint8Array(data) };
      } catch (error) {
        return failure(logger, 'cache read', error);
      }
    },
    [CHANNELS.writeCacheAtomic]: async (_event, request = {}) => {
      try {
        const cacheRoot = await getCacheRootPath();
        const target = await safeTarget(cacheRoot, request.name, { validate: validateCacheName });
        requireBoundedData(request.bytes, maxCacheBytes(request.name));
        await writeAtomic(cacheRoot, target, asBuffer(request.bytes));
        return { ok: true, data: true };
      } catch (error) {
        return failure(logger, 'cache write', error);
      }
    },
    [CHANNELS.removeCache]: async (_event, request = {}) => {
      try {
        const cacheRoot = await getCacheRootPath();
        const target = await safeTarget(cacheRoot, request.name, { mustExist: true, validate: validateCacheName });
        if (target) await fs.promises.unlink(target);
        return { ok: true, data: true };
      } catch (error) {
        return failure(logger, 'cache remove', error);
      }
    },
    [CHANNELS.listCache]: async () => {
      try {
        const cacheRoot = await getCacheRootPath();
        const entries = await fs.promises.readdir(cacheRoot, { withFileTypes: true });
        const data = [];
        for (const entry of entries) {
          if (/^\.tmp-[a-f0-9-]+$/i.test(entry.name)) {
            await fs.promises.unlink(path.join(cacheRoot, entry.name)).catch(() => {});
            continue;
          }
          if (!entry.isFile() || entry.name === 'index.json' || !CACHE_NAME.test(entry.name)) continue;
          const target = await safeTarget(cacheRoot, entry.name, { mustExist: true, validate: validateCacheName });
          if (target) data.push({ name: entry.name, byteLength: (await fs.promises.stat(target)).size });
        }
        if (data.length > SIZE_LIMITS.listEntries) throw new Error('tooManyCacheFiles');
        return { ok: true, data };
      } catch (error) {
        return failure(logger, 'cache list', error);
      }
    }
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  return () => {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler?.(channel);
  };
}

module.exports = { IR_LIBRARY_CHANNELS: CHANNELS, IR_LIBRARY_SIZE_LIMITS: SIZE_LIMITS, registerIrLibraryIpc };
