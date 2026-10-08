const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadFreshModule, withModuleLoadStub } = require('../helpers/cjs-module-utils.cjs');
const { registerIrLibraryIpc, IR_LIBRARY_CHANNELS, IR_LIBRARY_SIZE_LIMITS } = require('../../electron/ir-library-ipc.js');

const name = '0123456789abcdef01234567.sfzbank';
const MiB = 1024 * 1024;

test('Electron SFZ storage accepts a bank above the IR limit and rejects its hard ceiling before reading', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-sfz-capacity-')));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const handlers = new Map();
  const diagnostics = [];
  const dispose = registerIrLibraryIpc({ ipcMain: {
    handle(channel, fn) { handlers.set(channel, fn); }, removeHandler(channel) { handlers.delete(channel); }
  }, getUserDataPath: () => root, logger: { error(...detail) { diagnostics.push(detail); } } });
  t.after(dispose);
  const list = handlers.get(IR_LIBRARY_CHANNELS.list);
  const read = handlers.get(IR_LIBRARY_CHANNELS.read);
  for (const namespace of ['ir-library', 'sfz-library']) {
    await list({}, { namespace });
    const handle = await fs.promises.open(path.join(root, namespace, name), 'w');
    try { await handle.truncate(64 * MiB + 1); } finally { await handle.close(); }
  }
  assert.equal((await read({}, { namespace: 'ir-library', name })).ok, false);
  const response = await read({}, { namespace: 'sfz-library', name });
  assert.equal(response.ok, true);
  assert.equal(response.data.byteLength, 64 * MiB + 1);
  assert.equal(IR_LIBRARY_SIZE_LIMITS.sfzBank, 1024 * MiB);
  assert.equal(IR_LIBRARY_SIZE_LIMITS.original, 64 * MiB);
  assert.equal(IR_LIBRARY_SIZE_LIMITS.cacheEntry, 64 * MiB);
  const handle = await fs.promises.open(path.join(root, 'sfz-library', name), 'w');
  try { await handle.truncate(IR_LIBRARY_SIZE_LIMITS.sfzBank + 1); } finally { await handle.close(); }
  assert.equal((await read({}, { namespace: 'sfz-library', name })).ok, false);

  const write = handlers.get(IR_LIBRARY_CHANNELS.writeAtomic);
  assert.equal((await write({}, { namespace: 'ir-library', name, bytes: response.data })).ok, false);
  assert.equal((await write({}, { namespace: 'sfz-library', name: 'fedcba9876543210fedcba98.sfzbank', bytes: response.data })).ok, true,
    JSON.stringify(diagnostics));
});

test('preload grants the larger write allowance only to SFZ banks, not IR or cache data', async () => {
  const exposed = {};
  const invocations = [];
  withModuleLoadStub({ electron: {
    contextBridge: { exposeInMainWorld(key, api) { exposed[key] = api; } },
    ipcRenderer: { on() {}, removeListener() {}, send() {},
      invoke(channel, request) { invocations.push([channel, request]); return Promise.resolve({ ok: true }); } },
    webUtils: { getPathForFile() { return ''; } }
  } }, () => loadFreshModule('../../electron/preload.js'));
  const bridge = exposed.electronAPI.irLibraryV1;
  const bytes = new Uint8Array(64 * MiB + 1);
  assert.throws(() => bridge.writeAtomic({ namespace: 'ir-library', name, bytes }), /too large/);
  assert.throws(() => bridge.writeAtomic({ namespace: 'sfz-library', name: name.replace('.sfzbank', '.wav'), bytes }), /too large/);
  assert.throws(() => bridge.writeCacheAtomic({ namespace: 'sfz-library', name, bytes }), /too large/);
  await bridge.writeAtomic({ namespace: 'sfz-library', name, bytes });
  assert.equal(invocations.filter(([channel]) => channel === IR_LIBRARY_CHANNELS.writeAtomic).length, 1);
});
