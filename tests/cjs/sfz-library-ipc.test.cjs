const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadFreshModule, withModuleLoadStub } = require('../helpers/cjs-module-utils.cjs');
const { registerSfzLibraryIpc, SFZ_LIBRARY_CHANNELS: channels, SFZ_SOURCE_MAX_BYTES,
  SFZ_RANGE_MAX_BYTES } = require('../../electron/sfz-library-ipc.js');

async function fixture(t) {
  const root = await fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sfz-reference-')));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const data = path.join(root, 'settings');
  const source = path.join(root, 'instrument');
  await fs.promises.mkdir(data);
  await fs.promises.mkdir(source);
  const selected = path.join(source, 'Example.sfz');
  await fs.promises.writeFile(selected, '<region> sample=tone.wav');
  await fs.promises.writeFile(path.join(source, 'tone.wav'), 'audio');
  const handlers = new Map();
  let selection = { canceled: false, filePaths: [source] };
  const install = () => registerSfzLibraryIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: channel => handlers.delete(channel) },
    getUserDataPath: () => data, showOpenDialog: async options => {
      assert.deepEqual(options.properties, ['openDirectory']);
      return selection;
    }, logger: { error() {} }
  });
  let dispose = install();
  t.after(() => dispose());
  return { root, data, source, selected,
    call: (method, request) => handlers.get(channels[method])({}, request),
    selection: next => { selection = next; },
    restart: () => { dispose(); dispose = install(); } };
}

test('SFZ selection persists references only and reads current source bytes after restart', async t => {
  const f = await fixture(t);
  const result = await f.call('select');
  assert.equal(result.ok, true);
  const entry = result.data.banks[0];
  assert.match(entry.id, /^[a-f0-9]{24}$/);
  assert.deepEqual(Object.keys(entry).sort(), ['id', 'importedAt', 'name', 'selectedPath']);
  assert.match(entry.importedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(entry.selectedPath, 'Example.sfz');
  const reselected = (await f.call('select')).data.banks[0];
  assert.deepEqual({ id: reselected.id, name: reselected.name, selectedPath: reselected.selectedPath },
    { id: entry.id, name: entry.name, selectedPath: entry.selectedPath });
  assert.match(reselected.importedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(await fs.promises.readdir(f.data), ['sfz-references.json']);
  const stored = JSON.parse(await fs.promises.readFile(path.join(f.data, 'sfz-references.json'), 'utf8'));
  assert.equal(stored[0].path, await fs.promises.realpath(f.selected));
  assert.equal(stored[0].importedAt, reselected.importedAt);
  f.restart();
  assert.deepEqual((await f.call('list')).data, [reselected]);
  await fs.promises.writeFile(path.join(f.source, 'tone.wav'), 'updated');
  const request = { id: entry.id, relativePath: 'tone.wav', maxBytes: 1024 };
  assert.equal(Buffer.from((await f.call('readRelative', request)).data).toString(), 'updated');
  const metadata = (await f.call('statRelative', request)).data;
  assert.equal(metadata.size, 7);
  assert.match(metadata.revision, /^[a-f0-9]{64}$/);
  assert.equal((await f.call('remove', { id: entry.id })).data, true);
  assert.deepEqual((await f.call('list')).data, []);
  assert.equal(await fs.promises.readFile(path.join(f.source, 'tone.wav'), 'utf8'), 'updated');
  assert.equal((await f.call('readRelative', request)).ok, false);
});

test('SoundFont SF2 and SF3 collections share granted references and bounded range readers', async t => {
  const f = await fixture(t);
  await fs.promises.writeFile(path.join(f.source, 'Compressed.sf3'), Buffer.from([5, 6, 7, 8]));
  await fs.promises.writeFile(path.join(f.source, 'Collection.sf2'), Buffer.from([1, 2, 3, 4]));
  const entry = (await f.call('select')).data.banks.find(bank => bank.name === 'Collection.sf2');
  assert.ok(entry);
  f.restart();
  assert.ok((await f.call('list')).data.some(bank => bank.id === entry.id));
  const stats = (await f.call('statRelative', { id: entry.id, relativePath: entry.selectedPath })).data;
  const result = await f.call('readRelativeRange', { id: entry.id, relativePath: entry.selectedPath,
    revision: stats.revision, offset: 2, length: 2 });
  assert.equal(result.ok, true); assert.deepEqual([...result.data.bytes], [3, 4]);
  const compressed = (await f.call('list')).data.find(bank => bank.name === 'Compressed.sf3');
  assert.ok(compressed);
  const compressedStats = (await f.call('statRelative', { id: compressed.id, relativePath: compressed.selectedPath })).data;
  const compressedResult = await f.call('readRelativeRange', { id: compressed.id, relativePath: compressed.selectedPath,
    revision: compressedStats.revision, offset: 2, length: 2 });
  assert.equal(compressedResult.ok, true); assert.deepEqual([...compressedResult.data.bytes], [7, 8]);
});

test('SFZ relative reads reject escapes, foreign IDs, directories and oversized sources', async t => {
  const f = await fixture(t);
  const { id } = (await f.call('select')).data.banks[0];
  const request = { id, relativePath: 'tone.wav', maxBytes: 4 };
  assert.deepEqual(await f.call('readRelative', request), { ok: false, code: 'too-large' });
  for (const relativePath of ['../secret', '/absolute', 'C:\\absolute', 'tone.wav:stream', '.']) {
    assert.equal((await f.call('readRelative', { ...request, relativePath, maxBytes: 1024 })).ok, false);
  }
  assert.equal((await f.call('readRelative', { ...request, id: '0'.repeat(24) })).ok, false);
  assert.deepEqual(await f.call('readRelative', { ...request, relativePath: 'missing.wav' }), { ok: true, data: null });
  const large = await fs.promises.open(path.join(f.source, 'large.wav'), 'w');
  try { await large.truncate(SFZ_SOURCE_MAX_BYTES + 1); } finally { await large.close(); }
  assert.equal((await f.call('statRelative', { id, relativePath: 'large.wav' })).data.size, SFZ_SOURCE_MAX_BYTES + 1);
  assert.deepEqual(await f.call('readRelative', { id, relativePath: 'large.wav', maxBytes: Number.MAX_SAFE_INTEGER }),
    { ok: false, code: 'too-large' });
});

test('selected package roots preserve nested SFZ paths and sibling dependencies across restart', async t => {
  const f = await fixture(t);
  const presets = path.join(f.source, 'Presets');
  const samples = path.join(f.source, 'Samples');
  const definitions = path.join(f.source, 'Definitions');
  await fs.promises.mkdir(presets);
  await fs.promises.mkdir(samples);
  await fs.promises.mkdir(definitions);
  await fs.promises.writeFile(path.join(presets, 'Grand.sfz'), '#include "../Definitions/regions.inc"');
  await fs.promises.writeFile(path.join(definitions, 'regions.inc'), '<region> sample=../Samples/C4.wav');
  await fs.promises.writeFile(path.join(samples, 'C4.wav'), 'sample');
  f.selection({ canceled: false, filePaths: [presets] });
  const original = (await f.call('select')).data.banks[0];
  f.selection({ canceled: false, filePaths: [f.source] });
  const banks = (await f.call('select')).data.banks;
  assert.equal(banks.length, 2);
  const nested = banks.find(entry => entry.id === original.id);
  assert.equal(nested.selectedPath, 'Presets/Grand.sfz');
  assert.equal(nested.name, 'Presets/Grand.sfz');
  f.restart();
  assert.deepEqual((await f.call('list')).data.find(entry => entry.id === nested.id), nested);
  for (const [relativePath, content] of [['Definitions/regions.inc', '<region> sample=../Samples/C4.wav'],
    ['Samples/C4.wav', 'sample']]) {
    const value = await f.call('readRelative', { id: nested.id, relativePath, maxBytes: 1024 });
    assert.equal(value.ok, true);
    assert.equal(Buffer.from(value.data).toString(), content);
  }
  await f.call('remove', { id: nested.id });
  assert.equal(await fs.promises.readFile(path.join(samples, 'C4.wav'), 'utf8'), 'sample');
});

test('SFZ sample stat reads WAV, FLAC and AIFF metadata without loading audio bodies', async t => {
  const f = await fixture(t);
  const { id } = (await f.call('select')).data.banks[0];
  const wav = Buffer.alloc(60);
  wav.write('RIFF', 0); wav.write('WAVE', 8);
  wav.write('JUNK', 12); wav.writeUInt32LE(8, 16);
  wav.write('fmt ', 28); wav.writeUInt32LE(16, 32);
  wav.writeUInt16LE(1, 36); wav.writeUInt16LE(2, 38);
  wav.writeUInt32LE(44100, 40); wav.writeUInt16LE(4, 48);
  wav.write('data', 52); wav.writeUInt32LE(19730340 * 4, 56);
  const wavPath = path.join(f.source, 'large-stereo.wav');
  await fs.promises.writeFile(wavPath, wav);
  const sparse = await fs.promises.open(wavPath, 'r+');
  const wavSize = wav.length + 19730340 * 4;
  try { await sparse.truncate(wavSize); } finally { await sparse.close(); }
  const flac = Buffer.alloc(42);
  flac.write('fLaC'); flac[4] = 0x80; flac[7] = 34;
  flac.writeBigUInt64BE((48000n << 44n) | (1n << 41n) | 96000n, 18);
  await fs.promises.writeFile(path.join(f.source, 'compressed.flac'), flac);
  const aiff = Buffer.alloc(38);
  aiff.write('FORM'); aiff.write('AIFF', 8); aiff.write('COMM', 12);
  aiff.writeUInt32BE(18, 16); aiff.writeUInt16BE(1, 20); aiff.writeUInt32BE(128, 22);
  aiff.writeUInt16BE(16, 26); aiff.writeUInt16BE(16398, 28); aiff.writeUInt32BE(0xac440000, 30);
  await fs.promises.writeFile(path.join(f.source, 'sample.aiff'), aiff);
  for (const [relativePath, expected] of [
    ['large-stereo.wav', { size: wavSize, channels: 2, frames: 19730340, sampleRate: 44100 }],
    ['compressed.flac', { size: 42, channels: 2, frames: 96000, sampleRate: 48000 }],
    ['sample.aiff', { size: 38, channels: 1, frames: 128, sampleRate: 44100 }],
    ['tone.wav', { size: 5 }]
  ]) {
    const result = await f.call('statRelative', { id, relativePath });
    assert.equal(result.ok, true);
    const { revision, ...metadata } = result.data;
    assert.match(revision, /^[a-f0-9]{64}$/);
    assert.deepEqual(metadata, expected);
  }
});

test('SFZ canonical containment rejects dependencies linked outside the selected folder', async t => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside');
  await fs.promises.mkdir(outside);
  await fs.promises.writeFile(path.join(outside, 'secret.wav'), 'outside');
  await fs.promises.writeFile(path.join(outside, 'Outside.sfz'), '<region> sample=secret.wav');
  try { await fs.promises.symlink(outside, path.join(f.source, 'linked'), 'junction'); }
  catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip(`Host cannot create directory links (${error.code})`); return; }
    throw error;
  }
  const banks = (await f.call('select')).data.banks;
  assert.equal(banks.length, 1, 'Folder discovery must not follow outside directory links');
  const { id } = banks[0];
  const request = { id, relativePath: 'linked/secret.wav', maxBytes: 1024 };
  assert.equal((await f.call('readRelative', request)).ok, false);
  assert.equal((await f.call('statRelative', request)).ok, false);
  assert.equal((await f.call('readRelativeRange', { ...request, offset: 0, length: 1,
    revision: 'a'.repeat(64) })).ok, false);
});

test('SFZ range reads return exact bytes with bounded requests and a stable revision', async t => {
  const f = await fixture(t);
  const { id } = (await f.call('select')).data.banks[0];
  const request = { id, relativePath: 'tone.wav' };
  const { revision, size } = (await f.call('statRelative', request)).data;
  const range = { ...request, revision, offset: 1, length: 3 };
  const result = await f.call('readRelativeRange', range);
  assert.equal(result.ok, true);
  assert.equal(Buffer.from(result.data.bytes).toString(), 'udi');
  assert.equal(result.data.revision, revision);
  assert.equal((await f.call('statRelative', request)).data.revision, revision);
  assert.equal((await f.call('readRelativeRange', { ...range, offset: size, length: 0 })).data.bytes.length, 0);
  for (const change of [{ offset: -1 }, { offset: .5 }, { offset: Number.MAX_SAFE_INTEGER },
    { length: -1 }, { length: .5 }, { length: SFZ_RANGE_MAX_BYTES + 1 }, { offset: 4, length: 2 },
    { revision: '' }, { revision: 'not-a-revision' }, { id: '0'.repeat(24) },
    { relativePath: '../outside' }, { relativePath: '.' }]) {
    assert.equal((await f.call('readRelativeRange', { ...range, ...change })).ok, false, JSON.stringify(change));
  }
  await fs.promises.writeFile(path.join(f.source, 'tone.wav'), 'changed');
  assert.deepEqual(await f.call('readRelativeRange', range), { ok: false, code: 'source-changed' });
  await fs.promises.unlink(path.join(f.source, 'tone.wav'));
  assert.deepEqual(await f.call('readRelativeRange', range), { ok: false, code: 'source-changed' });
});

test('SFZ range reads address sparse files past4GiB without whole-file admission', async t => {
  const f = await fixture(t);
  const { id } = (await f.call('select')).data.banks[0];
  const target = path.join(f.source, 'large-sample.wav');
  await fs.promises.writeFile(target, '');
  if (process.platform === 'win32') {
    const { execFile } = require('node:child_process');
    const { promisify } = require('node:util');
    await promisify(execFile)('fsutil.exe', ['sparse', 'setflag', target], { windowsHide: true });
  }
  const position = 2 ** 32 + 37;
  const handle = await fs.promises.open(target, 'r+');
  try { await handle.write(Buffer.from([11, 22, 33, 44]), 0, 4, position); }
  finally { await handle.close(); }
  const request = { id, relativePath: 'large-sample.wav' };
  const metadata = await f.call('statRelative', request);
  assert.equal(metadata.ok, true);
  assert.equal(metadata.data.size, position + 4);
  const range = await f.call('readRelativeRange', { ...request, revision: metadata.data.revision,
    offset: position, length: 4 });
  assert.equal(range.ok, true);
  assert.deepEqual([...range.data.bytes], [11, 22, 33, 44]);
  const fullPage = await f.call('readRelativeRange', { ...request, revision: metadata.data.revision,
    offset: 0, length: SFZ_RANGE_MAX_BYTES });
  assert.equal(fullPage.ok, true);
  assert.equal(fullPage.data.bytes.length, SFZ_RANGE_MAX_BYTES);
  assert.ok(fullPage.data.bytes.every(byte => byte === 0));
  assert.deepEqual(await f.call('readRelative', { ...request, maxBytes: Number.MAX_SAFE_INTEGER }),
    { ok: false, code: 'too-large' });
});

test('SFZ range revision rejects a replaced file even when size and modification time match', async t => {
  const f = await fixture(t);
  const { id } = (await f.call('select')).data.banks[0];
  const target = path.join(f.source, 'tone.wav');
  const original = await fs.promises.stat(target);
  const request = { id, relativePath: 'tone.wav' };
  const { revision } = (await f.call('statRelative', request)).data;
  const replacement = path.join(f.source, 'replacement.wav');
  await fs.promises.writeFile(replacement, 'other');
  await fs.promises.utimes(replacement, original.atime, original.mtime);
  await fs.promises.rename(replacement, target);
  assert.deepEqual(await f.call('readRelativeRange', { ...request, revision, offset: 0, length: 5 }),
    { ok: false, code: 'source-changed' });
});

test('SFZ range reads reject a source modified during the admitted read', async t => {
  const f = await fixture(t);
  const { id } = (await f.call('select')).data.banks[0];
  const target = await fs.promises.realpath(path.join(f.source, 'tone.wav'));
  const request = { id, relativePath: 'tone.wav' };
  const { revision } = (await f.call('statRelative', request)).data;
  const open = fs.promises.open;
  t.after(() => { fs.promises.open = open; });
  fs.promises.open = async (file, ...args) => {
    const handle = await open(file, ...args);
    if (file === target) {
      const read = handle.read.bind(handle);
      handle.read = async (...readArgs) => {
        const result = await read(...readArgs);
        await fs.promises.writeFile(target, 'replaced');
        return result;
      };
    }
    return handle;
  };
  assert.deepEqual(await f.call('readRelativeRange', { ...request, revision, offset: 0, length: 5 }),
    { ok: false, code: 'source-changed' });
});

test('SFZ chooser cancellation changes no references and missing dependencies stay missing', async t => {
  const f = await fixture(t);
  f.selection({ canceled: true, filePaths: [] });
  assert.deepEqual(await f.call('select'), { ok: true, data: null });
  assert.deepEqual((await f.call('list')).data, []);
  f.selection({ canceled: false, filePaths: [f.source] });
  const { id } = (await f.call('select')).data.banks[0];
  await fs.promises.unlink(f.selected);
  assert.deepEqual(await f.call('readRelative', { id, relativePath: 'Example.sfz', maxBytes: 1024 }), { ok: true, data: null });
  assert.equal((await f.call('list')).data.length, 1);
});

test('preload exposes only the SFZ reference operations through the dedicated channels', async () => {
  const exposed = {};
  const calls = [];
  withModuleLoadStub({ electron: {
    contextBridge: { exposeInMainWorld(key, value) { exposed[key] = value; } },
    ipcRenderer: { on() {}, removeListener() {}, send() {}, invoke(channel, request) {
      calls.push([channel, request]); return Promise.resolve({ ok: true, data: null });
    } }, webUtils: { getPathForFile() { return ''; } }
  } }, () => loadFreshModule('../../electron/preload.js'));
  const api = exposed.electronAPI.sfzLibraryV1;
  assert.equal(api.apiVersion, 1);
  for (const method of Object.keys(channels)) await api[method]({ id: 'a'.repeat(24) });
  assert.deepEqual(calls.map(([channel]) => channel), Object.values(channels));
});

test('fingerprint candidates stay in the requested granted parent and reject exhausted or revoked grants', async t => {
  const f = await fixture(t);
  await fs.promises.mkdir(path.join(f.source, 'Samples'));
  await fs.promises.mkdir(path.join(f.source, 'Samples', 'Nested'));
  await fs.promises.writeFile(path.join(f.source, 'Samples', 'renamed.wav'), 'audio');
  await fs.promises.writeFile(path.join(f.source, 'Samples', 'Nested', 'other.wav'), 'other');
  const { id } = (await f.call('select')).data.banks[0];
  const request = { id, relativePath: 'Samples/missing.wav', maxEntries: 10 };
  assert.deepEqual(await f.call('listSampleCandidates', request), { ok: true, data: ['Samples/renamed.wav'] });
  assert.deepEqual(await f.call('listSampleCandidates', { ...request, relativePath: 'Absent/missing.wav' }),
    { ok: true, data: [] });
  for (const relativePath of ['../settings/missing.wav', 'C:\\secret.wav', '/secret.wav']) {
    assert.equal((await f.call('listSampleCandidates', { ...request, relativePath })).ok, false);
  }
  assert.deepEqual(await f.call('listSampleCandidates', { ...request, relativePath: 'missing.wav', maxEntries: 1 }),
    { ok: false, code: 'sample-lookup-limit' });
  await f.call('remove', { id });
  assert.equal((await f.call('listSampleCandidates', request)).ok, false);
});

test('fingerprint candidate search rejects a linked parent outside its granted root', async t => {
  const f = await fixture(t);
  const { id } = (await f.call('select')).data.banks[0];
  try { await fs.promises.symlink(f.data, path.join(f.source, 'Escape'), 'junction'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip(`Host cannot create directory links (${error.code})`); return; }
    throw error;
  }
  assert.equal((await f.call('listSampleCandidates', { id, relativePath: 'Escape/missing.wav', maxEntries: 10 })).ok, false);
});
