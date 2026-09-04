const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Measurement results live in the renderer's IndexedDB. The desktop app also
// mirrors every saved measurement as a JSON file (the same format as the
// measurement Export command) under userData/measurement-backups, so a damaged
// or locked browser storage layer never costs the user their measurements. The
// files are restored with the regular measurement Import.
const CHANNELS = Object.freeze({
  write: 'measurement-backup-v1:write',
  remove: 'measurement-backup-v1:remove',
  list: 'measurement-backup-v1:list'
});
const DIRECTORY_NAME = 'measurement-backups';
const ALLOWED_ID = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,119}$/;
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const MAX_LIST_ENTRIES = 100000;

function comparable(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function validateId(id) {
  if (typeof id !== 'string' || !ALLOWED_ID.test(id) || id.includes('..')) throw new Error('invalidId');
  return id;
}

async function verifyDirectoryRoot(expectedPath) {
  const stats = await fs.promises.lstat(expectedPath);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('linkedBackupRoot');
  const realPath = await fs.promises.realpath(expectedPath);
  if (comparable(realPath) !== comparable(expectedPath)) throw new Error('linkedBackupRoot');
  return expectedPath;
}

async function safeTarget(rootPath, id, { mustExist = false } = {}) {
  validateId(id);
  const target = path.resolve(rootPath, `${id}.json`);
  if (path.dirname(target) !== rootPath) throw new Error('outsideRoot');
  try {
    const stats = await fs.promises.lstat(target);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error('linkedTarget');
    const realTarget = await fs.promises.realpath(target);
    if (comparable(realTarget) !== comparable(target)) throw new Error('linkedTarget');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (mustExist) return null;
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

function failure(logger, operation, error) {
  logger.error(
    `Measurement backup ${operation} diagnostic:`,
    String(error?.code || error?.message || 'storageFailed').slice(0, 128)
  );
  return { ok: false, code: 'storage-failed' };
}

function registerMeasurementBackupIpc({ ipcMain, getUserDataPath, logger = console }) {
  if (!ipcMain?.handle || typeof getUserDataPath !== 'function') {
    throw new TypeError('Measurement backup IPC dependencies are required.');
  }
  let rootReady;
  const initializeRootPath = () => {
    if (!rootReady) {
      const currentPromise = (async () => {
        const userDataPath = await fs.promises.realpath(getUserDataPath());
        const expectedRoot = path.join(userDataPath, DIRECTORY_NAME);
        await fs.promises.mkdir(expectedRoot, { recursive: true });
        const realRoot = await fs.promises.realpath(expectedRoot);
        if (comparable(realRoot) !== comparable(expectedRoot)) throw new Error('linkedBackupRoot');
        return verifyDirectoryRoot(realRoot);
      })().catch(error => {
        if (rootReady === currentPromise) rootReady = null;
        throw error;
      });
      rootReady = currentPromise;
    }
    return rootReady;
  };
  const getRootPath = async () => verifyDirectoryRoot(await initializeRootPath());

  const handlers = {
    [CHANNELS.write]: async (_event, request = {}) => {
      try {
        if (typeof request.json !== 'string') throw new Error('invalidData');
        const data = Buffer.from(request.json, 'utf8');
        if (data.byteLength > MAX_BACKUP_BYTES) throw new Error('dataTooLarge');
        const rootPath = await getRootPath();
        const target = await safeTarget(rootPath, request.id);
        await writeAtomic(rootPath, target, data);
        return { ok: true, data: true };
      } catch (error) {
        return failure(logger, 'write', error);
      }
    },
    [CHANNELS.remove]: async (_event, request = {}) => {
      try {
        const rootPath = await getRootPath();
        const target = await safeTarget(rootPath, request.id, { mustExist: true });
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
        const data = [];
        for (const entry of entries) {
          if (/^\.tmp-[a-f0-9-]+$/i.test(entry.name)) {
            await fs.promises.unlink(path.join(rootPath, entry.name)).catch(() => {});
            continue;
          }
          if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
          const id = entry.name.slice(0, -'.json'.length);
          if (!ALLOWED_ID.test(id) || id.includes('..')) continue;
          data.push(id);
        }
        if (data.length > MAX_LIST_ENTRIES) throw new Error('tooManyFiles');
        return { ok: true, data };
      } catch (error) {
        return failure(logger, 'list', error);
      }
    }
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  return () => {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler?.(channel);
  };
}

module.exports = {
  MEASUREMENT_BACKUP_CHANNELS: CHANNELS,
  MEASUREMENT_BACKUP_DIRECTORY: DIRECTORY_NAME,
  MEASUREMENT_BACKUP_MAX_BYTES: MAX_BACKUP_BYTES,
  registerMeasurementBackupIpc
};
