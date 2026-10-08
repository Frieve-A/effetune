const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024 * 1024;
const REGISTRY_MAX_BYTES = 1024 * 1024;
const CHANNELS = Object.freeze({
  select: 'sfz-library-v1:select', list: 'sfz-library-v1:list',
  remove: 'sfz-library-v1:remove', readRelative: 'sfz-library-v1:read-relative',
  statRelative: 'sfz-library-v1:stat-relative'
});
const samePath = (a, b) => process.platform === 'win32'
  ? a.toLowerCase() === b.toLowerCase() : a === b;
const missing = error => error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
const relativePath = (root, file) => path.relative(root, file).split(path.sep).join('/');
const isWithin = (root, file) => {
  const relative = path.relative(root, file);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const publicEntry = entry => ({ id: entry.id, name: entry.name, selectedPath: relativePath(entry.root, entry.path) });

function boundedSize(size, limit = MAX_BYTES) {
  if (!Number.isSafeInteger(size) || size < 0 || size > limit) {
    const error = new Error('SFZ source exceeds the read limit');
    error.code = 'too-large';
    throw error;
  }
}

async function readAudioMetadata(handle, size) {
  const { readSfzAudioHeader } = await import('../js/sfz/bank.js');
  return readSfzAudioHeader(async (position, length) => {
    const bytes = Buffer.alloc(length);
    const result = await handle.read(bytes, 0, length, position);
    return result.bytesRead === length ? bytes : null;
  }, size);
}

function registerSfzLibraryIpc({ ipcMain, getUserDataPath, showOpenDialog, logger = console }) {
  let registryPromise;
  let mutation = Promise.resolve();
  const registryPath = () => path.join(getUserDataPath(), 'sfz-references.json');
  const load = () => {
    if (!registryPromise) registryPromise = (async () => {
      try {
        const stats = await fs.promises.lstat(registryPath());
        if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Invalid SFZ registry');
        boundedSize(stats.size, REGISTRY_MAX_BYTES);
        const data = JSON.parse(await fs.promises.readFile(registryPath(), 'utf8'));
        if (!Array.isArray(data)) throw new Error('Invalid SFZ registry');
        const entries = new Map();
        for (const entry of data) {
          if (!/^[a-f0-9]{24}$/.test(entry?.id) || typeof entry.name !== 'string' ||
              !path.isAbsolute(entry.path || '') || !path.isAbsolute(entry.root || '') ||
              !isWithin(entry.root, entry.path) || path.extname(entry.path).toLowerCase() !== '.sfz') {
            throw new Error('Invalid SFZ reference');
          }
          entries.set(entry.id, entry);
        }
        return entries;
      } catch (error) {
        if (missing(error)) return new Map();
        throw error;
      }
    })().catch(error => { registryPromise = undefined; throw error; });
    return registryPromise;
  };
  const update = operation => {
    const next = mutation.then(async () => {
      const entries = new Map(await load());
      const result = operation(entries);
      const text = JSON.stringify([...entries.values()]);
      boundedSize(Buffer.byteLength(text), REGISTRY_MAX_BYTES);
      const target = registryPath();
      const temporary = `${target}.${crypto.randomBytes(8).toString('hex')}.tmp`;
      try {
        await fs.promises.writeFile(temporary, text, { flag: 'wx' });
        await fs.promises.rename(temporary, target);
      } finally {
        await fs.promises.unlink(temporary).catch(() => {});
      }
      registryPromise = Promise.resolve(entries);
      return result;
    });
    mutation = next.catch(() => {});
    return next;
  };
  const resolve = async request => {
    const entry = (await load()).get(request?.id);
    const relative = request?.relativePath;
    if (!entry || typeof relative !== 'string' || !relative || relative.includes('\0') ||
        relative.includes(':') || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) ||
        relative.split(/[\\/]/).some(part => part === '..')) throw new Error('Invalid SFZ relative path');
    if (!samePath(await fs.promises.realpath(entry.root), entry.root)) throw new Error('Changed SFZ root');
    const target = await fs.promises.realpath(path.resolve(entry.root, relative.replaceAll('\\', '/')));
    if (!isWithin(entry.root, target)) {
      throw new Error('SFZ dependency is outside its folder');
    }
    return target;
  };
  const handlers = {
    [CHANNELS.select]: async () => {
      const selection = await showOpenDialog({ properties: ['openDirectory'] });
      if (selection.canceled || !selection.filePaths?.length) return null;
      const root = await fs.promises.realpath(selection.filePaths[0]);
      if (!(await fs.promises.stat(root)).isDirectory()) throw new Error('Invalid SFZ folder');
      const files = [];
      const visit = async (directory, depth) => {
        if (depth > 32) throw new Error('SFZ folder is nested too deeply');
        const canonicalDirectory = await fs.promises.realpath(directory);
        if (depth && !isWithin(root, canonicalDirectory)) throw new Error('SFZ directory is outside its folder');
        for (const entry of await fs.promises.readdir(canonicalDirectory, { withFileTypes: true })) {
          const file = path.join(canonicalDirectory, entry.name);
          if (entry.isDirectory()) await visit(file, depth + 1);
          else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.sfz') {
            if (files.length >= 10000) throw new Error('SFZ folder contains too many instruments');
            const canonical = await fs.promises.realpath(file);
            if (!isWithin(root, canonical)) throw new Error('SFZ file is outside its folder');
            files.push(canonical);
          }
        }
      };
      await visit(root, 0);
      files.sort();
      return update(entries => {
        const byPath = new Map([...entries.values()].map(entry =>
          [process.platform === 'win32' ? entry.path.toLowerCase() : entry.path, entry]));
        const banks = files.map(selected => {
          const existing = byPath.get(process.platform === 'win32' ? selected.toLowerCase() : selected);
          const entry = { id: existing?.id || crypto.randomBytes(12).toString('hex'),
            name: relativePath(root, selected), path: selected, root };
          entries.set(entry.id, entry);
          return publicEntry(entry);
        });
        return { banks };
      });
    },
    [CHANNELS.list]: async () => [...(await load()).values()].map(publicEntry),
    [CHANNELS.remove]: async request => update(entries => {
      if (!/^[a-f0-9]{24}$/.test(request?.id)) throw new Error('Invalid SFZ reference');
      entries.delete(request.id);
      return true;
    }),
    [CHANNELS.statRelative]: async request => {
      let handle;
      try {
        handle = await fs.promises.open(await resolve(request), 'r');
        const stats = await handle.stat();
        if (!stats.isFile()) throw new Error('SFZ dependency is not a file');
        boundedSize(stats.size);
        return { size: stats.size, ...await readAudioMetadata(handle, stats.size) };
      } catch (error) { if (missing(error)) return null; throw error; }
      finally { await handle?.close(); }
    },
    [CHANNELS.readRelative]: async request => {
      if (!Number.isSafeInteger(request?.maxBytes) || request.maxBytes < 1) throw new Error('Invalid SFZ read limit');
      const limit = Math.min(request.maxBytes, MAX_BYTES);
      let handle;
      try {
        handle = await fs.promises.open(await resolve(request), 'r');
        const stats = await handle.stat();
        if (!stats.isFile()) throw new Error('SFZ dependency is not a file');
        boundedSize(stats.size, limit);
        // Read the admitted size only, even if another program grows the source file.
        const bytes = Buffer.alloc(stats.size);
        let offset = 0;
        while (offset < bytes.length) {
          const result = await handle.read(bytes, offset, bytes.length - offset, offset);
          if (!result.bytesRead) throw new Error('SFZ dependency changed while reading');
          offset += result.bytesRead;
        }
        return bytes;
      } catch (error) { if (missing(error)) return null; throw error; }
      finally { await handle?.close(); }
    }
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, async (_event, request) => {
    try { return { ok: true, data: await handler(request) }; }
    catch (error) {
      logger.error('SFZ file reference diagnostic:', channel, error?.code || error?.message);
      return { ok: false, code: error?.code === 'too-large' ? 'too-large' : 'storage-failed' };
    }
  });
  return () => { for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel); };
}

module.exports = { registerSfzLibraryIpc, SFZ_LIBRARY_CHANNELS: CHANNELS, SFZ_SOURCE_MAX_BYTES: MAX_BYTES };
