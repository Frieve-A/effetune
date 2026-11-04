const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024 * 1024;
const RANGE_MAX_BYTES = 1024 * 1024;
const REGISTRY_MAX_BYTES = 1024 * 1024;
const CHANNELS = Object.freeze({
  select: 'sfz-library-v1:select', list: 'sfz-library-v1:list',
  remove: 'sfz-library-v1:remove', readRelative: 'sfz-library-v1:read-relative',
  statRelative: 'sfz-library-v1:stat-relative',
  listSampleCandidates: 'sfz-library-v1:list-sample-candidates',
  readRelativeRange: 'sfz-library-v1:read-relative-range'
});
const samePath = (a, b) => process.platform === 'win32'
  ? a.toLowerCase() === b.toLowerCase() : a === b;
const missing = error => error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
const relativePath = (root, file) => path.relative(root, file).split(path.sep).join('/');
const isWithin = (root, file) => {
  const relative = path.relative(root, file);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const publicEntry = entry => ({ id: entry.id, name: entry.name, selectedPath: relativePath(entry.root, entry.path),
  ...(entry.importedAt ? { importedAt: entry.importedAt } : {}),
  ...(entry.bankPaths?.length ? { bankPaths: entry.bankPaths } : {}) });

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

function identityFromStats(stats) {
  if (!stats.isFile()) throw new Error('SFZ dependency is not a file');
  const size = Number(stats.size);
  boundedSize(size, Number.MAX_SAFE_INTEGER);
  const revision = crypto.createHash('sha256').update([
    stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs
  ].join(':')).digest('hex');
  return { size, revision };
}

async function fileIdentity(handle) {
  return identityFromStats(await handle.stat({ bigint: true }));
}

function changedSource() {
  const error = new Error('SFZ dependency changed while streaming');
  error.code = 'source-changed';
  return error;
}

function registerSfzLibraryIpc({ ipcMain, getUserDataPath, showOpenDialog, MessageChannelMain, getMainWindow, logger = console }) {
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
              !isWithin(entry.root, entry.path) || !['.sf2', '.sf3', '.sfz'].includes(path.extname(entry.path).toLowerCase()) ||
              (entry.bankPaths !== undefined && (!Array.isArray(entry.bankPaths) || entry.bankPaths.length > 10000 ||
                entry.bankPaths.some(file => typeof file !== 'string' || !file.toLowerCase().endsWith('.bank.xml') ||
                  !isWithin(entry.root, path.resolve(entry.root, file)))))) {
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
    [CHANNELS.select]: async (_request = {}) => {
      const fileSelection = _request.mode === 'files';
      const selection = await showOpenDialog(fileSelection
        ? { properties: ['openFile', 'multiSelections'], filters: [{ name: 'SoundFont instruments', extensions: ['sf2', 'sf3', 'sfz'] }] }
        : { properties: ['openDirectory'] });
      if (selection.canceled || !selection.filePaths?.length) return null;
      if (fileSelection && selection.filePaths.length > 10000) throw new Error('Too many SFZ files selected');
      const root = await fs.promises.realpath(fileSelection ? path.dirname(selection.filePaths[0]) : selection.filePaths[0]);
      if (!(await fs.promises.stat(root)).isDirectory()) throw new Error('Invalid SFZ folder');
      const files = [];
      const bankPaths = [];
      const visit = async (directory, depth) => {
        if (depth > 32) throw new Error('SFZ folder is nested too deeply');
        const canonicalDirectory = await fs.promises.realpath(directory);
        if (depth && !isWithin(root, canonicalDirectory)) throw new Error('SFZ directory is outside its folder');
        for (const entry of await fs.promises.readdir(canonicalDirectory, { withFileTypes: true })) {
          const file = path.join(canonicalDirectory, entry.name);
          if (entry.isDirectory()) await visit(file, depth + 1);
          else if (entry.isFile() && ['.sf2', '.sf3', '.sfz'].includes(path.extname(entry.name).toLowerCase())) {
            if (files.length >= 10000) throw new Error('SFZ folder contains too many instruments');
            const canonical = await fs.promises.realpath(file);
            if (!isWithin(root, canonical)) throw new Error('SFZ file is outside its folder');
            files.push(canonical);
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.bank.xml')) {
            if (bankPaths.length >= 10000) throw new Error('SFZ folder contains too many bank definitions');
            const canonical = await fs.promises.realpath(file);
            if (!isWithin(root, canonical)) throw new Error('SFZ bank is outside its folder');
            bankPaths.push(relativePath(root, canonical));
          }
        }
      };
      if (fileSelection) {
        for (const selected of selection.filePaths) {
          const canonical = await fs.promises.realpath(selected);
          if (!isWithin(root, canonical) || !['.sf2', '.sf3', '.sfz'].includes(path.extname(canonical).toLowerCase()) ||
              !(await fs.promises.stat(canonical)).isFile()) throw new Error('Invalid SFZ selection');
          files.push(canonical);
        }
        for (const file of await fs.promises.readdir(root, { withFileTypes: true })) {
          if (file.isFile() && file.name.toLowerCase().endsWith('.bank.xml')) bankPaths.push(file.name);
        }
      } else await visit(root, 0);
      files.sort();
      return update(entries => {
        const byPath = new Map([...entries.values()].map(entry =>
          [process.platform === 'win32' ? entry.path.toLowerCase() : entry.path, entry]));
        const banks = files.map(selected => {
          const existing = byPath.get(process.platform === 'win32' ? selected.toLowerCase() : selected);
          const entry = { id: existing?.id || crypto.randomBytes(12).toString('hex'),
            name: relativePath(root, selected), path: selected, root, bankPaths: bankPaths.sort(),
            importedAt: new Date().toISOString() };
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
        const target = await resolve(request);
        handle = await fs.promises.open(target, 'r');
        const identity = await fileIdentity(handle);
        const metadata = await readAudioMetadata(handle, identity.size);
        if ((await fileIdentity(handle)).revision !== identity.revision ||
            identityFromStats(await fs.promises.stat(target, { bigint: true })).revision !== identity.revision) throw changedSource();
        return { ...identity, ...metadata };
      } catch (error) { if (missing(error)) return null; throw error; }
      finally { await handle?.close(); }
    },
    [CHANNELS.listSampleCandidates]: async request => {
      const entry = (await load()).get(request?.id);
      const relative = request?.relativePath, limit = request?.maxEntries;
      if (!entry || typeof relative !== 'string' || !relative || relative.includes('\0') ||
          relative.includes(':') || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) ||
          relative.split(/[\\/]/).some(part => part === '..') ||
          !Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('Invalid SFZ sample search');
      if (!samePath(await fs.promises.realpath(entry.root), entry.root)) throw new Error('Changed SFZ root');
      const requested = path.resolve(entry.root, relative.replaceAll('\\', '/'));
      if (!isWithin(entry.root, requested)) throw new Error('Invalid SFZ sample search parent');
      let parent;
      try { parent = await fs.promises.realpath(path.dirname(requested)); }
      catch (error) { if (missing(error)) return []; throw error; }
      if (!samePath(parent, entry.root) && !isWithin(entry.root, parent)) throw new Error('SFZ search is outside its folder');
      const candidates = [];
      let visited = 0;
      // Search only the requested sample's granted parent, never sibling trees.
      const directory = await fs.promises.opendir(parent);
      for await (const file of directory) {
        if (++visited > limit) {
          const error = new Error('SFZ sample search exceeds the entry limit');
          error.code = 'sample-lookup-limit'; throw error;
        }
        if (!file.isFile()) continue;
        const canonical = await fs.promises.realpath(path.join(parent, file.name));
        if (!isWithin(entry.root, canonical)) throw new Error('SFZ search candidate is outside its folder');
        candidates.push(relativePath(entry.root, canonical));
      }
      if ((await load()).get(request.id) !== entry ||
          !samePath(await fs.promises.realpath(entry.root), entry.root)) throw new Error('Changed SFZ grant');
      return candidates.sort();
    },
    [CHANNELS.readRelativeRange]: async request => {
      const { offset, length, revision } = request || {};
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 ||
          length > RANGE_MAX_BYTES || !Number.isSafeInteger(offset + length) ||
          typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) {
        throw new Error('Invalid SFZ range request');
      }
      let handle;
      try {
        const target = await resolve(request);
        handle = await fs.promises.open(target, 'r');
        const identity = await fileIdentity(handle);
        if (identity.revision !== revision) throw changedSource();
        if (offset + length > identity.size) throw new Error('SFZ range exceeds the file');
        const bytes = Buffer.alloc(length);
        let read = 0;
        while (read < length) {
          const result = await handle.read(bytes, read, length - read, offset + read);
          if (!result.bytesRead) throw changedSource();
          read += result.bytesRead;
        }
        if ((await fileIdentity(handle)).revision !== revision ||
            identityFromStats(await fs.promises.stat(target, { bigint: true })).revision !== revision) throw changedSource();
        return { bytes, revision };
      } catch (error) { if (missing(error)) throw changedSource(); throw error; }
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
  const rangePorts = new Set();
  const portChannel = 'sfz-library-v1:open-range-port';
  if (MessageChannelMain && getMainWindow) ipcMain.handle(portChannel, async (event, request) => {
    const owner = getMainWindow()?.webContents;
    if (!owner || event.sender !== owner || event.senderFrame !== owner.mainFrame ||
        typeof request?.token !== 'string' || !/^[a-f0-9-]{36}$/.test(request.token)) return { ok: false };
    const entry = (await load()).get(request?.id);
    if (!entry) return { ok: false };
    const { port1, port2 } = new MessageChannelMain();
    let closed = false, active = 0;
    const close = () => {
      if (closed) return;
      closed = true; rangePorts.delete(close); port1.close();
      owner.removeListener('destroyed', close);
      owner.removeListener('render-process-gone', close);
      owner.removeListener('did-start-navigation', navigate);
    };
    const navigate = (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) close(); };
    rangePorts.add(close);
    owner.once('destroyed', close); owner.once('render-process-gone', close);
    owner.on('did-start-navigation', navigate);
    port1.on('close', close);
    port1.on('message', async ({ data }) => {
      if (closed) return;
      if (data?.type === 'close') { close(); return; }
      if (!Number.isSafeInteger(data?.requestId) || data.requestId < 1 || active >= 4) {
        port1.postMessage({ requestId: data?.requestId, ok: false, code: 'sample-capacity' }); return;
      }
      active++;
      try {
        if ((await load()).get(request.id) !== entry) throw changedSource();
        // Reuse the complete protected range handler, including canonical path,
        // grant, extent and before/after revision validation on every read.
        const result = await handlers[CHANNELS.readRelativeRange]({ ...data, id: request.id });
        if ((await load()).get(request.id) !== entry) throw changedSource();
        if (!closed) port1.postMessage({ requestId: data.requestId, ok: true, data: result });
      } catch (error) {
        if (!closed) port1.postMessage({ requestId: data.requestId, ok: false,
          code: error?.code === 'source-changed' ? error.code : 'sample-read' });
      } finally { active--; }
    });
    port1.start();
    try { owner.postMessage('sfz-library-v1:range-port', request.token, [port2]); }
    catch { close(); port2.close(); return { ok: false }; }
    return { ok: true };
  });
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, async (_event, request) => {
    try { return { ok: true, data: await handler(request) }; }
    catch (error) {
      logger.error('SFZ file reference diagnostic:', channel, error?.code || error?.message);
      return { ok: false, code: ['too-large', 'source-changed', 'sample-lookup-limit'].includes(error?.code) ? error.code : 'storage-failed' };
    }
  });
  return () => {
    for (const close of [...rangePorts]) close();
    if (MessageChannelMain && getMainWindow) ipcMain.removeHandler(portChannel);
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
  };
}

module.exports = { registerSfzLibraryIpc, SFZ_LIBRARY_CHANNELS: CHANNELS,
  SFZ_SOURCE_MAX_BYTES: MAX_BYTES, SFZ_RANGE_MAX_BYTES: RANGE_MAX_BYTES };
