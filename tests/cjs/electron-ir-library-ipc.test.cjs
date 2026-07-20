const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  IR_LIBRARY_CHANNELS,
  IR_LIBRARY_SIZE_LIMITS,
  registerIrLibraryIpc
} = require('../../electron/ir-library-ipc.js');

function createHarness(options = {}) {
  const rawRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-ir-ipc-'));
  const tempRoot = fs.realpathSync(rawRoot);
  const handlers = new Map();
  const diagnostics = [];
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); }
  };
  const dispose = registerIrLibraryIpc({
    ipcMain,
    getUserDataPath: options.getUserDataPath || (() => tempRoot),
    logger: { error(...args) { diagnostics.push(args); } }
  });
  return { tempRoot, handlers, diagnostics, dispose };
}

async function removeTempRoot(tempRoot) {
  await fs.promises.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

test('IR IPC atomically replaces generated logical files without exposing native paths', async t => {
  const harness = createHarness();
  t.after(() => removeTempRoot(harness.tempRoot));
  const write = harness.handlers.get(IR_LIBRARY_CHANNELS.writeAtomic);
  const read = harness.handlers.get(IR_LIBRARY_CHANNELS.read);
  const exists = harness.handlers.get(IR_LIBRARY_CHANNELS.exists);
  const list = harness.handlers.get(IR_LIBRARY_CHANNELS.list);
  const remove = harness.handlers.get(IR_LIBRARY_CHANNELS.remove);

  assert.deepEqual(await write({}, { name: 'index.json', bytes: new TextEncoder().encode('one') }), { ok: true, data: true });
  assert.deepEqual(await write({}, { name: 'index.json', bytes: new TextEncoder().encode('two') }), { ok: true, data: true });
  assert.equal(new TextDecoder().decode((await read({}, { name: 'index.json' })).data), 'two');
  assert.deepEqual(await exists({}, { name: 'index.json' }), { ok: true, data: true });
  assert.deepEqual(await list({}, {}), { ok: true, data: ['index.json'] });
  assert.deepEqual(await remove({}, { name: 'index.json' }), { ok: true, data: true });
  assert.deepEqual(await read({}, { name: 'index.json' }), { ok: true, data: null });
  assert.deepEqual(await exists({}, { name: 'index.json' }), { ok: true, data: false });
  const tempPath = path.join(harness.tempRoot, 'ir-library', '.tmp-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  await fs.promises.writeFile(tempPath, 'partial');
  assert.deepEqual(
    await harness.handlers.get(IR_LIBRARY_CHANNELS.cleanupTemporary)({}, {}),
    { ok: true, data: true }
  );
  assert.equal(fs.existsSync(tempPath), false);

  const cacheName = '0123456789abcdef01234567@48000.f32';
  const cacheWrite = harness.handlers.get(IR_LIBRARY_CHANNELS.writeCacheAtomic);
  const cacheRead = harness.handlers.get(IR_LIBRARY_CHANNELS.readCache);
  assert.deepEqual(await cacheWrite({}, { name: cacheName, bytes: new Uint8Array([1, 2, 3, 4]) }), { ok: true, data: true });
  assert.deepEqual((await cacheRead({}, { name: cacheName })).data, new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual(await harness.handlers.get(IR_LIBRARY_CHANNELS.listCache)({}, {}), {
    ok: true,
    data: [{ name: cacheName, byteLength: 4 }]
  });
  assert.deepEqual(await harness.handlers.get(IR_LIBRARY_CHANNELS.removeCache)({}, { name: cacheName }), { ok: true, data: true });
  harness.dispose();
  assert.equal(harness.handlers.size, 0);
});

test('IR IPC retries failed user-data, library-root, and cache-root initialization', async t => {
  const userDataParent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-ir-ipc-retry-')));
  t.after(() => removeTempRoot(userDataParent));
  const lateUserData = path.join(userDataParent, 'late-user-data');
  let userDataCalls = 0;
  const userDataHarness = createHarness({
    getUserDataPath() {
      userDataCalls += 1;
      return lateUserData;
    }
  });
  t.after(() => removeTempRoot(userDataHarness.tempRoot));
  const listUserData = userDataHarness.handlers.get(IR_LIBRARY_CHANNELS.list);
  const userDataFailures = await Promise.all([listUserData(), listUserData()]);
  assert.deepEqual(userDataFailures, [
    { ok: false, code: 'storage-failed' },
    { ok: false, code: 'storage-failed' }
  ]);
  assert.equal(userDataCalls, 1);
  await fs.promises.mkdir(lateUserData);
  assert.deepEqual(await listUserData(), { ok: true, data: [] });
  assert.equal(userDataCalls, 2);

  let rootCalls = 0;
  const rootHarness = createHarness({
    getUserDataPath() {
      rootCalls += 1;
      return rootHarness.tempRoot;
    }
  });
  t.after(() => removeTempRoot(rootHarness.tempRoot));
  const libraryRoot = path.join(rootHarness.tempRoot, 'ir-library');
  await fs.promises.writeFile(libraryRoot, new Uint8Array([1]));
  const listRoot = rootHarness.handlers.get(IR_LIBRARY_CHANNELS.list);
  assert.deepEqual(await Promise.all([listRoot(), listRoot()]), [
    { ok: false, code: 'storage-failed' },
    { ok: false, code: 'storage-failed' }
  ]);
  assert.equal(rootCalls, 1);
  await fs.promises.unlink(libraryRoot);
  assert.deepEqual(await listRoot(), { ok: true, data: [] });
  assert.equal(rootCalls, 2);

  const cacheHarness = createHarness();
  t.after(() => removeTempRoot(cacheHarness.tempRoot));
  const cacheRoot = path.join(cacheHarness.tempRoot, 'ir-library', 'cache');
  await fs.promises.mkdir(path.dirname(cacheRoot), { recursive: true });
  await fs.promises.writeFile(cacheRoot, new Uint8Array([1]));
  const listCache = cacheHarness.handlers.get(IR_LIBRARY_CHANNELS.listCache);
  assert.deepEqual(await Promise.all([listCache(), listCache()]), [
    { ok: false, code: 'storage-failed' },
    { ok: false, code: 'storage-failed' }
  ]);
  await fs.promises.unlink(cacheRoot);
  assert.deepEqual(await listCache(), { ok: true, data: [] });
});

test('IR IPC rejects traversal and returns a bounded generic failure', async t => {
  const harness = createHarness();
  t.after(() => removeTempRoot(harness.tempRoot));
  const write = harness.handlers.get(IR_LIBRARY_CHANNELS.writeAtomic);
  const result = await write({}, { name: '../outside.json', bytes: new Uint8Array([1]) });
  assert.deepEqual(result, { ok: false, code: 'storage-failed' });
  assert.equal(JSON.stringify(result).includes(harness.tempRoot), false);
  assert.equal(fs.existsSync(path.join(harness.tempRoot, 'outside.json')), false);
  assert.deepEqual(
    await harness.handlers.get(IR_LIBRARY_CHANNELS.exists)({}, { name: '../outside.json' }),
    { ok: false, code: 'storage-failed' }
  );
  assert.deepEqual(
    await harness.handlers.get(IR_LIBRARY_CHANNELS.writeCacheAtomic)({}, { name: '../outside.f32', bytes: new Uint8Array([1]) }),
    { ok: false, code: 'storage-failed' }
  );
  assert.equal(harness.diagnostics.length, 3);
});

test('IR IPC rejects a symlink or reparse-point target inside its root', async t => {
  const harness = createHarness();
  t.after(() => removeTempRoot(harness.tempRoot));
  const root = path.join(harness.tempRoot, 'ir-library');
  await fs.promises.mkdir(root, { recursive: true });
  const outside = path.join(harness.tempRoot, 'outside');
  await fs.promises.mkdir(outside);
  const linkedName = 'aaaaaaaaaaaaaaaaaaaaaaaa.wav';
  try {
    fs.symlinkSync(outside, path.join(root, linkedName), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Symlink creation is unavailable.');
    throw error;
  }
  const write = harness.handlers.get(IR_LIBRARY_CHANNELS.writeAtomic);
  assert.deepEqual(
    await write({}, { name: linkedName, bytes: new Uint8Array([1]) }),
    { ok: false, code: 'storage-failed' }
  );
  assert.equal((await fs.promises.readdir(outside)).length, 0);
});

test('IR IPC rejects a symlink or reparse-point library root itself', async t => {
  const harness = createHarness();
  t.after(() => removeTempRoot(harness.tempRoot));
  const outside = path.join(harness.tempRoot, 'outside-root');
  await fs.promises.mkdir(outside);
  try {
    fs.symlinkSync(outside, path.join(harness.tempRoot, 'ir-library'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Symlink creation is unavailable.');
    throw error;
  }
  assert.deepEqual(
    await harness.handlers.get(IR_LIBRARY_CHANNELS.writeAtomic)(
      {},
      { name: 'index.json', bytes: new Uint8Array([1]) }
    ),
    { ok: false, code: 'storage-failed' }
  );
  assert.equal((await fs.promises.readdir(outside)).length, 0);
});

test('IR IPC rejects a symlink or reparse-point cache namespace', async t => {
  const harness = createHarness();
  t.after(() => removeTempRoot(harness.tempRoot));
  const root = path.join(harness.tempRoot, 'ir-library');
  await fs.promises.mkdir(root, { recursive: true });
  const outside = path.join(harness.tempRoot, 'outside-cache');
  await fs.promises.mkdir(outside);
  try {
    fs.symlinkSync(outside, path.join(root, 'cache'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Symlink creation is unavailable.');
    throw error;
  }
  assert.deepEqual(
    await harness.handlers.get(IR_LIBRARY_CHANNELS.writeCacheAtomic)(
      {},
      { name: '0123456789abcdef01234567@48000.f32', bytes: new Uint8Array([1]) }
    ),
    { ok: false, code: 'storage-failed' }
  );
  assert.equal((await fs.promises.readdir(outside)).length, 0);
});

test('IR IPC revalidates the initialized library root before every operation', async t => {
  const harness = createHarness();
  t.after(() => removeTempRoot(harness.tempRoot));
  const write = harness.handlers.get(IR_LIBRARY_CHANNELS.writeAtomic);
  assert.deepEqual(
    await write({}, { name: 'index.json', bytes: new Uint8Array([1]) }),
    { ok: true, data: true }
  );
  const root = path.join(harness.tempRoot, 'ir-library');
  const displaced = path.join(harness.tempRoot, 'ir-library-original');
  const outside = path.join(harness.tempRoot, 'outside-after-initialization');
  await fs.promises.mkdir(outside);
  await fs.promises.rename(root, displaced);
  try {
    fs.symlinkSync(outside, root, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    await fs.promises.rename(displaced, root);
    if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Symlink creation is unavailable.');
    throw error;
  }

  assert.deepEqual(
    await write({}, { name: 'index.json', bytes: new Uint8Array([2]) }),
    { ok: false, code: 'storage-failed' }
  );
  assert.deepEqual(await fs.promises.readdir(outside), []);
});

test('IR IPC revalidates the initialized cache root before every operation', async t => {
  const harness = createHarness();
  t.after(() => removeTempRoot(harness.tempRoot));
  const write = harness.handlers.get(IR_LIBRARY_CHANNELS.writeCacheAtomic);
  const cacheName = '0123456789abcdef01234567@48000.f32';
  assert.deepEqual(
    await write({}, { name: cacheName, bytes: new Uint8Array([1]) }),
    { ok: true, data: true }
  );
  const root = path.join(harness.tempRoot, 'ir-library');
  const cacheRoot = path.join(root, 'cache');
  const displaced = path.join(root, 'cache-original');
  const outside = path.join(harness.tempRoot, 'outside-cache-after-initialization');
  await fs.promises.mkdir(outside);
  await fs.promises.rename(cacheRoot, displaced);
  try {
    fs.symlinkSync(outside, cacheRoot, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    await fs.promises.rename(displaced, cacheRoot);
    if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Symlink creation is unavailable.');
    throw error;
  }

  assert.deepEqual(
    await harness.handlers.get(IR_LIBRARY_CHANNELS.listCache)({}, {}),
    { ok: false, code: 'storage-failed' }
  );
  assert.deepEqual(await fs.promises.readdir(outside), []);
});

test('IR IPC enforces logical-file size limits before writes and disk reads', async t => {
  const harness = createHarness();
  t.after(() => removeTempRoot(harness.tempRoot));
  const analysisName = 'aaaaaaaaaaaaaaaaaaaaaaaa.analysis';
  const oversizedAnalysis = new Uint8Array(IR_LIBRARY_SIZE_LIMITS.analysis + 1);
  const write = harness.handlers.get(IR_LIBRARY_CHANNELS.writeAtomic);
  assert.deepEqual(
    await write({}, { name: analysisName, bytes: oversizedAnalysis }),
    { ok: false, code: 'storage-failed' }
  );

  const root = path.join(harness.tempRoot, 'ir-library');
  await fs.promises.writeFile(path.join(root, analysisName), oversizedAnalysis);
  assert.deepEqual(
    await harness.handlers.get(IR_LIBRARY_CHANNELS.read)({}, { name: analysisName }),
    { ok: false, code: 'storage-failed' }
  );

  assert.deepEqual(
    await harness.handlers.get(IR_LIBRARY_CHANNELS.writeCacheAtomic)(
      {},
      { name: 'index.json', bytes: new Uint8Array(IR_LIBRARY_SIZE_LIMITS.cacheIndex + 1) }
    ),
    { ok: false, code: 'storage-failed' }
  );
  assert.equal(harness.diagnostics.length, 3);
  assert.ok(harness.diagnostics.every(args => !args.flat().join(' ').includes(harness.tempRoot)));
});

test('IR IPC reports an oversized library index without reading or exposing its payload', async t => {
  const harness = createHarness();
  t.after(() => removeTempRoot(harness.tempRoot));
  const root = path.join(harness.tempRoot, 'ir-library');
  await fs.promises.mkdir(root, { recursive: true });
  const indexPath = path.join(root, 'index.json');
  await fs.promises.writeFile(indexPath, new Uint8Array([1]));
  const matchesIndex = target => {
    const resolved = path.resolve(target);
    return process.platform === 'win32'
      ? resolved.toLowerCase() === indexPath.toLowerCase()
      : resolved === indexPath;
  };
  const stat = fs.promises.stat;
  const readFile = fs.promises.readFile;
  let payloadReads = 0;
  fs.promises.stat = async target => matchesIndex(target)
    ? { size: IR_LIBRARY_SIZE_LIMITS.index + 1 }
    : stat(target);
  fs.promises.readFile = async (...args) => {
    if (matchesIndex(args[0])) payloadReads += 1;
    return readFile(...args);
  };
  t.after(() => {
    fs.promises.stat = stat;
    fs.promises.readFile = readFile;
  });

  const result = await harness.handlers.get(IR_LIBRARY_CHANNELS.read)({}, { name: 'index.json' });

  assert.deepEqual(result, { ok: false, code: 'ir-library-index-too-large' });
  assert.equal(payloadReads, 0);
  assert.equal(harness.diagnostics.length, 1);
  assert.ok(!harness.diagnostics[0].flat().join(' ').includes(harness.tempRoot));
});
