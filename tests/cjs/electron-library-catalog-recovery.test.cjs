'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  LIBRARY_CATALOG_RECOVERY_CHANNELS,
  LibraryCatalogRecovery,
  registerLibraryCatalogRecoveryIpc,
  removeLibraryCatalogDirectory,
  resolveLibraryCatalogPaths
} = require('../../electron/library-catalog-recovery.cjs');
const {
  LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION,
  LibraryCatalogUtilityHost
} = require('../../electron/library-catalog-utility-host.cjs');

async function createTemporaryUserData(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-library-recovery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('catalog initialization failure degrades only the Library with a sanitized public state', async t => {
  const userDataPath = await createTemporaryUserData(t);
  const diagnostics = [];
  let closes = 0;
  const recovery = new LibraryCatalogRecovery({
    userDataPath,
    openCatalog: async () => {
      const error = new Error(`corrupt catalog at ${path.join(userDataPath, 'music-library-v2')}`);
      error.code = 'SQLITE_CORRUPT';
      throw error;
    },
    closeCatalog: async () => { closes += 1; },
    onDiagnostic: error => diagnostics.push(error)
  });

  const state = await recovery.initialize();

  assert.deepEqual(state, {
    apiVersion: 1,
    status: 'unavailable',
    available: false,
    canReset: true,
    message: 'The Music Library is unavailable. Audio effects remain available. You can reset the saved Library catalog without changing your audio files, presets, or other settings.'
  });
  assert.equal(closes, 1);
  assert.equal(diagnostics[0].code, 'SQLITE_CORRUPT');
  assert.doesNotMatch(JSON.stringify(state), /SQLITE|music-library-v2|corrupt/i);
});

test('an initial utility failure leaves the Library unavailable to recovery', async t => {
  const userDataPath = await createTemporaryUserData(t);
  const children = [];
  const processFactory = () => {
    const child = new EventEmitter();
    child.killed = false;
    child.sent = [];
    child.kill = () => { child.killed = true; };
    child.postMessage = message => {
      child.sent.push(message);
      if (message.type === 'initialize') {
        queueMicrotask(() => child.emit('message', {
          protocolVersion: LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION,
          type: 'ready',
          ok: false,
          error: { code: 'initialFailure', message: 'initial utility failure', details: {} }
        }));
      } else if (message.type === 'request' && message.target === 'system' && message.method === 'close') {
        queueMicrotask(() => child.emit('message', {
          protocolVersion: LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION,
          type: 'response', requestId: message.requestId, ok: true, payload: { closed: true }
        }));
      }
    };
    children.push(child);
    return child;
  };
  let activeHost = null;
  const diagnostics = [];
  const recovery = new LibraryCatalogRecovery({
    userDataPath,
    openCatalog: async ({ catalogPath }) => {
      activeHost = await LibraryCatalogUtilityHost.open({
        dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
        processFactory,
        dbPath: catalogPath,
        openTimeoutMs: 1_000,
        closeTimeoutMs: 1_000
      });
    },
    closeCatalog: async () => {
      await activeHost?.close();
      activeHost = null;
    },
    onDiagnostic: error => diagnostics.push(error)
  });

  const state = await recovery.initialize();

  assert.equal(state.status, 'unavailable');
  assert.equal(state.canReset, true);
  assert.equal(children.length, 1);
  assert.ok(children.every(child => child.killed));
  assert.equal(diagnostics[0]?.code, 'utilityUnavailable');
});

test('a utility failure during initialization is applied after the active open completes', async t => {
  const userDataPath = await createTemporaryUserData(t);
  let finishOpen;
  let closes = 0;
  const recovery = new LibraryCatalogRecovery({
    userDataPath,
    openCatalog: () => new Promise(resolve => { finishOpen = resolve; }),
    closeCatalog: async () => { closes += 1; }
  });

  const initialization = recovery.initialize();
  await new Promise(resolve => setImmediate(resolve));
  const prematureReset = await recovery.resetCatalog({ confirmed: true });
  assert.deepEqual({ reset: prematureReset.reset, canceled: prematureReset.canceled }, {
    reset: false,
    canceled: false
  });
  const unavailable = recovery.markUnavailable(Object.assign(new Error('utility failed'), {
    code: 'utilityFailed'
  }));
  finishOpen();

  assert.equal((await initialization).status, 'available');
  assert.equal((await unavailable).status, 'unavailable');
  assert.equal(recovery.getState().status, 'unavailable');
  assert.equal(closes, 1);
});

test('confirmed catalog reset deletes only the fixed catalog directory', async t => {
  const userDataPath = await createTemporaryUserData(t);
  const paths = resolveLibraryCatalogPaths(userDataPath);
  const audioPath = path.join(userDataPath, 'keep-audio.flac');
  const settingsPath = path.join(userDataPath, 'config.json');
  const staleCatalogPath = path.join(paths.catalogDirectory, 'damaged.sqlite');
  await fs.mkdir(paths.catalogDirectory, { recursive: true });
  await fs.writeFile(staleCatalogPath, 'damaged');
  await fs.writeFile(audioPath, 'audio');
  await fs.writeFile(settingsPath, 'settings');
  let openCount = 0;
  let closeCount = 0;
  const recovery = new LibraryCatalogRecovery({
    userDataPath,
    openCatalog: async ({ catalogDirectory, catalogPath }) => {
      openCount += 1;
      if (openCount === 1) throw Object.assign(new Error('catalog failed'), { code: 'openFailed' });
      await fs.mkdir(catalogDirectory, { recursive: true });
      await fs.writeFile(catalogPath, 'fresh');
    },
    closeCatalog: async () => { closeCount += 1; }
  });
  assert.equal((await recovery.initialize()).status, 'unavailable');

  const result = await recovery.resetCatalog({ confirmed: true });

  assert.equal(result.reset, true);
  assert.equal(result.recovered, true);
  assert.equal(result.state.status, 'available');
  assert.equal(openCount, 2);
  assert.equal(closeCount, 2);
  await assert.rejects(fs.access(staleCatalogPath), error => error?.code === 'ENOENT');
  assert.equal(await fs.readFile(paths.catalogPath, 'utf8'), 'fresh');
  assert.equal(await fs.readFile(audioPath, 'utf8'), 'audio');
  assert.equal(await fs.readFile(settingsPath, 'utf8'), 'settings');
});

test('catalog reset without renderer confirmation preserves the saved catalog', async t => {
  const userDataPath = await createTemporaryUserData(t);
  const paths = resolveLibraryCatalogPaths(userDataPath);
  await fs.mkdir(paths.catalogDirectory, { recursive: true });
  await fs.writeFile(paths.catalogPath, 'keep');
  const recovery = new LibraryCatalogRecovery({
    userDataPath,
    openCatalog: async () => { throw Object.assign(new Error('failed'), { code: 'openFailed' }); },
    closeCatalog: async () => {}
  });
  await recovery.initialize();

  const result = await recovery.resetCatalog({ confirmed: false });

  assert.deepEqual({ reset: result.reset, canceled: result.canceled }, {
    reset: false,
    canceled: true
  });
  assert.equal(await fs.readFile(paths.catalogPath, 'utf8'), 'keep');
});

test('catalog reset does not delete data when the catalog cannot be closed safely', async t => {
  const userDataPath = await createTemporaryUserData(t);
  const paths = resolveLibraryCatalogPaths(userDataPath);
  await fs.mkdir(paths.catalogDirectory, { recursive: true });
  await fs.writeFile(paths.catalogPath, 'keep');
  let closes = 0;
  const recovery = new LibraryCatalogRecovery({
    userDataPath,
    openCatalog: async () => { throw Object.assign(new Error('failed'), { code: 'openFailed' }); },
    closeCatalog: async () => {
      closes += 1;
      if (closes === 2) throw Object.assign(new Error('still in use'), { code: 'closeFailed' });
    }
  });
  await recovery.initialize();

  const result = await recovery.resetCatalog({ confirmed: true });

  assert.deepEqual({ reset: result.reset, recovered: result.recovered }, {
    reset: false,
    recovered: false
  });
  assert.equal(result.state.status, 'unavailable');
  assert.equal(await fs.readFile(paths.catalogPath, 'utf8'), 'keep');
});

test('catalog deletion rejects any target outside the fixed recovery directory', async t => {
  const userDataPath = await createTemporaryUserData(t);
  const paths = resolveLibraryCatalogPaths(userDataPath);
  const siblingPath = path.join(userDataPath, 'config.json');
  await fs.writeFile(siblingPath, 'keep');

  await assert.rejects(
    removeLibraryCatalogDirectory({ ...paths, catalogDirectory: siblingPath }),
    /reset target is invalid/
  );
  assert.equal(await fs.readFile(siblingPath, 'utf8'), 'keep');
});

test('catalog recovery IPC authenticates the main renderer and relays public state', async () => {
  const handlers = new Map();
  const removed = [];
  const sent = [];
  const webContents = { send: (...args) => sent.push(args), isDestroyed: () => false };
  const mainWindow = { webContents, isDestroyed: () => false };
  const recovery = new EventEmitter();
  recovery.getState = () => ({ apiVersion: 1, status: 'unavailable', available: false, canReset: true, message: 'Unavailable' });
  recovery.resetCatalog = async request => {
    assert.deepEqual(request, { confirmed: true });
    return { reset: false, canceled: true, recovered: false, state: recovery.getState() };
  };
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { removed.push(channel); handlers.delete(channel); }
  };
  const dispose = registerLibraryCatalogRecoveryIpc({
    ipcMain,
    recovery,
    getMainWindow: () => mainWindow
  });

  assert.deepEqual(
    handlers.get(LIBRARY_CATALOG_RECOVERY_CHANNELS.getState)({ sender: webContents }, {}),
    recovery.getState()
  );
  assert.throws(
    () => handlers.get(LIBRARY_CATALOG_RECOVERY_CHANNELS.resetCatalog)(
      { sender: {} },
      { confirmed: true }
    ),
    /not authorized/
  );
  assert.throws(
    () => handlers.get(LIBRARY_CATALOG_RECOVERY_CHANNELS.resetCatalog)(
      { sender: webContents },
      { confirmed: false }
    ),
    /reset request is invalid/
  );
  await handlers.get(LIBRARY_CATALOG_RECOVERY_CHANNELS.resetCatalog)(
    { sender: webContents },
    { confirmed: true }
  );
  recovery.emit('state', recovery.getState());
  assert.deepEqual(sent, [[LIBRARY_CATALOG_RECOVERY_CHANNELS.state, recovery.getState()]]);

  dispose();
  assert.deepEqual(removed.sort(), [
    LIBRARY_CATALOG_RECOVERY_CHANNELS.getState,
    LIBRARY_CATALOG_RECOVERY_CHANNELS.resetCatalog
  ].sort());
});
