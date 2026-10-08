const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadFreshModule, withModuleLoadStub } = require('../helpers/cjs-module-utils.cjs');
const { registerSfzLibraryIpc, SFZ_LIBRARY_CHANNELS: channels, SFZ_SOURCE_MAX_BYTES } = require('../../electron/sfz-library-ipc.js');

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
  assert.deepEqual(Object.keys(entry).sort(), ['id', 'name', 'selectedPath']);
  assert.equal(entry.selectedPath, 'Example.sfz');
  assert.deepEqual((await f.call('select')).data.banks, [entry]);
  assert.deepEqual(await fs.promises.readdir(f.data), ['sfz-references.json']);
  const stored = JSON.parse(await fs.promises.readFile(path.join(f.data, 'sfz-references.json'), 'utf8'));
  assert.equal(stored[0].path, await fs.promises.realpath(f.selected));
  f.restart();
  assert.deepEqual((await f.call('list')).data, [entry]);
  await fs.promises.writeFile(path.join(f.source, 'tone.wav'), 'updated');
  const request = { id: entry.id, relativePath: 'tone.wav', maxBytes: 1024 };
  assert.equal(Buffer.from((await f.call('readRelative', request)).data).toString(), 'updated');
  assert.deepEqual((await f.call('statRelative', request)).data, { size: 7 });
  assert.equal((await f.call('remove', { id: entry.id })).data, true);
  assert.deepEqual((await f.call('list')).data, []);
  assert.equal(await fs.promises.readFile(path.join(f.source, 'tone.wav'), 'utf8'), 'updated');
  assert.equal((await f.call('readRelative', request)).ok, false);
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
  assert.deepEqual(await f.call('statRelative', { id, relativePath: 'large.wav' }), { ok: false, code: 'too-large' });
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
  ]) assert.deepEqual(await f.call('statRelative', { id, relativePath }), { ok: true, data: expected });
});

test('SFZ canonical containment rejects dependencies linked outside the selected folder', async t => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside');
  await fs.promises.mkdir(outside);
  await fs.promises.writeFile(path.join(outside, 'secret.wav'), 'outside');
  await fs.promises.writeFile(path.join(outside, 'Outside.sfz'), '<region> sample=secret.wav');
  try { await fs.promises.symlink(outside, path.join(f.source, 'linked'), 'junction'); }
  catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('Host cannot create directory links'); return; }
    throw error;
  }
  const banks = (await f.call('select')).data.banks;
  assert.equal(banks.length, 1, 'Folder discovery must not follow outside directory links');
  const { id } = banks[0];
  const request = { id, relativePath: 'linked/secret.wav', maxBytes: 1024 };
  assert.equal((await f.call('readRelative', request)).ok, false);
  assert.equal((await f.call('statRelative', request)).ok, false);
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
