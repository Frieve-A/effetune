const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MEASUREMENT_BACKUP_CHANNELS,
  MEASUREMENT_BACKUP_DIRECTORY,
  MEASUREMENT_BACKUP_MAX_BYTES,
  registerMeasurementBackupIpc
} = require('../../electron/measurement-backup-ipc.cjs');

function createHarness(t, options = {}) {
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-measurement-backup-')));
  t.after(() => fs.promises.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const handlers = new Map();
  const diagnostics = [];
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); }
  };
  const dispose = registerMeasurementBackupIpc({
    ipcMain,
    getUserDataPath: options.getUserDataPath || (() => tempRoot),
    logger: { error(...args) { diagnostics.push(args); } }
  });
  const call = (channel, request) => handlers.get(channel)({}, request);
  return {
    tempRoot,
    root: path.join(tempRoot, MEASUREMENT_BACKUP_DIRECTORY),
    handlers,
    diagnostics,
    dispose,
    write: request => call(MEASUREMENT_BACKUP_CHANNELS.write, request),
    remove: request => call(MEASUREMENT_BACKUP_CHANNELS.remove, request),
    list: () => call(MEASUREMENT_BACKUP_CHANNELS.list, {})
  };
}

test('measurement backup IPC writes, lists, replaces and removes JSON files by measurement id', async t => {
  const harness = createHarness(t);
  const id = 'measurement_0f2c1e9a-7b7d-4c47-9a5e-1d2b3c4d5e6f';

  assert.deepEqual(await harness.write({ id, json: '{"name":"one"}' }), { ok: true, data: true });
  assert.deepEqual(await harness.write({ id, json: '{"name":"two"}' }), { ok: true, data: true });
  assert.equal(fs.readFileSync(path.join(harness.root, `${id}.json`), 'utf8'), '{"name":"two"}');
  assert.deepEqual(await harness.write({ id: 'other', json: '{}' }), { ok: true, data: true });
  assert.deepEqual((await harness.list()).data.sort(), [id, 'other']);
  assert.deepEqual(await harness.remove({ id }), { ok: true, data: true });
  assert.deepEqual(await harness.remove({ id }), { ok: true, data: true });
  assert.deepEqual(await harness.list(), { ok: true, data: ['other'] });
  assert.deepEqual(harness.diagnostics, []);
  assert.deepEqual(fs.readdirSync(harness.root), ['other.json']);
});

test('measurement backup IPC rejects unsafe ids, non-string payloads and oversized payloads with a generic failure', async t => {
  const harness = createHarness(t);
  const refused = { ok: false, code: 'storage-failed' };

  assert.deepEqual(await harness.write({ id: '../escape', json: '{}' }), refused);
  assert.deepEqual(await harness.write({ id: 'a/b', json: '{}' }), refused);
  assert.deepEqual(await harness.write({ id: '.hidden', json: '{}' }), refused);
  assert.deepEqual(await harness.write({ id: '', json: '{}' }), refused);
  assert.deepEqual(await harness.write({ id: 'x'.repeat(121), json: '{}' }), refused);
  assert.deepEqual(await harness.write({ id: 'fine', json: { name: 'object' } }), refused);
  assert.deepEqual(await harness.write({ id: 'fine', json: 'x'.repeat(MEASUREMENT_BACKUP_MAX_BYTES + 1) }), refused);
  assert.deepEqual(await harness.remove({ id: '../escape' }), refused);
  assert.deepEqual(await harness.list(), { ok: true, data: [] });
  assert.equal(harness.diagnostics.length, 8);
  assert.ok(harness.diagnostics.every(entry => typeof entry[1] === 'string' && !entry[1].includes(harness.tempRoot)));
});

test('measurement backup IPC lists only backup files and clears abandoned temporary files', async t => {
  const harness = createHarness(t);
  assert.deepEqual(await harness.write({ id: 'kept', json: '{}' }), { ok: true, data: true });
  fs.writeFileSync(path.join(harness.root, '.tmp-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'partial');
  fs.writeFileSync(path.join(harness.root, 'notes.txt'), 'ignored');
  fs.writeFileSync(path.join(harness.root, 'bad id!.json'), '{}');
  fs.mkdirSync(path.join(harness.root, 'folder.json'));

  assert.deepEqual(await harness.list(), { ok: true, data: ['kept'] });
  assert.deepEqual(fs.readdirSync(harness.root).sort(), ['bad id!.json', 'folder.json', 'kept.json', 'notes.txt']);
});

test('measurement backup IPC retries root initialization after a failure and unregisters on dispose', async t => {
  let fail = true;
  const harness = createHarness(t, {
    getUserDataPath() {
      if (fail) throw new Error('not yet');
      return harness.tempRoot;
    }
  });
  assert.deepEqual(await harness.write({ id: 'first', json: '{}' }), { ok: false, code: 'storage-failed' });
  fail = false;
  assert.deepEqual(await harness.write({ id: 'first', json: '{}' }), { ok: true, data: true });
  harness.dispose();
  assert.equal(harness.handlers.size, 0);
  assert.throws(() => registerMeasurementBackupIpc({ ipcMain: {}, getUserDataPath: () => '' }), TypeError);
});
