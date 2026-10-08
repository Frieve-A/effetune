import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { NativeSfzLibraryService } from '../../js/sfz/native-service.js';
import { getDefaultSfzLibraryService, selectSfzRegionsForBudget } from '../../js/sfz/service.js';
import { parseSfz } from '../../js/sfz/parser.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { parseIrAudioHeader } from '../../js/ir-library/audio-header-metadata.js';

const encode = text => new TextEncoder().encode(text);
const id = 'a'.repeat(24);
const entry = { id, name: 'piano.sfz', selectedPath: 'piano.sfz' };
const ok = data => ({ ok: true, data });

function wav(frames = 3) {
  const bytes = new Uint8Array(44);
  bytes.set(encode('RIFF'), 0); bytes.set(encode('WAVEfmt '), 8); bytes.set(encode('data'), 36);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 16, true); view.setUint16(22, 1, true); view.setUint32(24, 44100, true);
  view.setUint16(32, 2, true); view.setUint32(40, frames * 2, true);
  return bytes;
}

function harness(definition = '<region> sample=tone.wav key=60', options = {}) {
  const files = new Map([['piano.sfz', encode(definition)], ['tone.wav', wav()]]);
  const reads = [];
  const stats = [];
  let entries = [entry];
  const bridge = {
    apiVersion: 1,
    async select() { return ok({ banks: [entry] }); },
    async list() { return ok(entries.map(item => ({ ...item }))); },
    async remove({ id: removed }) { entries = entries.filter(item => item.id !== removed); return ok(true); },
    async readRelative(request) {
      reads.push({ ...request });
      const bytes = files.get(request.relativePath);
      return bytes && bytes.byteLength > request.maxBytes ? { ok: false, code: 'too-large' } : ok(bytes?.slice() ?? null);
    },
    async statRelative({ relativePath }) {
      stats.push(relativePath);
      return ok(files.has(relativePath) ? { size: files.get(relativePath).byteLength,
        ...parseIrAudioHeader(files.get(relativePath)) } : null);
    }
  };
  const diagnostics = [];
  const service = new NativeSfzLibraryService(bridge, { onDiagnostic: detail => diagnostics.push(detail), ...options });
  return { service, bridge, files, reads, stats, diagnostics };
}

const decode = () => ({ sampleRate: 44100, channels: [new Float32Array([.1, .2, .3])] });

test('native sample-aware invalid regions retain usable notes with additive warnings on reload', async () => {
  const h = harness('<region> sample=tone.wav key=60\n<region> sample=tone.wav key=61 end=99\n' +
    '<region> sample=tone.wav key=62 loop_mode=loop_sustain loop_end=99\n' +
    '<region> sample=tone.wav key=63 pan=101');
  h.files.set('tone.wav', wav(8));
  const decodeEight = () => ({ sampleRate: 44100, channels: [new Float32Array(8)] });
  const first = await h.service.prepare(id, { decode: decodeEight });
  const second = await h.service.prepare(id, { decode: decodeEight });
  assert.equal(first.regionCount, 1);
  assert.equal(second.regionCount, 1);
  assert.deepEqual(first.warnings, [{ code: 'invalid-regions', count: 3 }]);
  assert.deepEqual(second.warnings, first.warnings);
  assert.deepEqual(second.descriptor.payload, first.descriptor.payload);
  assert.equal(new Float32Array(first.descriptor.payload, 64)[4], 60);
  assert.equal(h.diagnostics[0].invalidRegions.length, 1);
  assert.equal(h.diagnostics[1].invalidRegions.length, 2);
  assert.match(h.diagnostics[1].invalidRegions[0], /tone.wav:.*playback/);
  assert.match(h.diagnostics[1].invalidRegions[1], /tone.wav:.*loop points/);
  h.files.set('piano.sfz', encode('<region> sample=tone.wav key=61 end=99'));
  await assert.rejects(h.service.prepare(id, { decode: decodeEight }), error => error.code === 'prepare');
});

test('native include expansion respects the load budget before inspecting or decoding samples', async () => {
  const h = harness('#include "0.sfz"', { getMaxBytes: () => 1024 });
  for (let index = 0; index < 17; index++) h.files.set(`${index}.sfz`, encode(index === 16
    ? '<region> sample=tone.wav key=60' : `#include "${index + 1}.sfz"\n#include "${index + 1}.sfz"`));
  await assert.rejects(h.service.prepare(id, { decode() { assert.fail('No sample should be decoded'); } }),
    error => error.code === 'too-large');
  assert.ok(h.reads.length <= 18);
  assert.deepEqual(h.stats, []);
});

test('native service consumes the production broker shape and stores reference metadata only', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-sfz-native-service-')));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const source = path.join(root, 'source');
  const userData = path.join(root, 'user-data');
  await fs.mkdir(source); await fs.mkdir(userData);
  await fs.mkdir(path.join(source, 'Keys'));
  await fs.mkdir(path.join(source, 'libs'));
  await fs.writeFile(path.join(source, 'Keys', 'piano.sfz'), '<region> sample=../libs/tone.wav key=60');
  await fs.writeFile(path.join(source, 'libs', 'tone.wav'), wav());
  const { registerSfzLibraryIpc, SFZ_LIBRARY_CHANNELS } = createRequire(import.meta.url)('../../electron/sfz-library-ipc.js');
  const handlers = new Map();
  const diagnostics = [];
  t.after(registerSfzLibraryIpc({ ipcMain: {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); }
  }, getUserDataPath: () => userData,
  showOpenDialog: async () => ({ canceled: false, filePaths: [source] }),
  logger: { error(...detail) { diagnostics.push(detail); } } }));
  const bridge = { apiVersion: 1 };
  for (const [method, channel] of Object.entries(SFZ_LIBRARY_CHANNELS)) {
    bridge[method] = request => handlers.get(channel)({}, request);
  }
  const service = new NativeSfzLibraryService(bridge);
  const [selected] = await service.selectFolder().catch(() => assert.fail(JSON.stringify(diagnostics)));
  assert.match(selected.id, /^[a-f0-9]{24}$/);
  assert.equal(selected.name, 'Keys/piano.sfz');
  assert.equal((await service.prepare(selected.id, { decode })).regionCount, 1);
  assert.deepEqual(await fs.readdir(userData), ['sfz-references.json']);
  await service.remove(selected.id);
  assert.deepEqual(await service.list(), []);
  assert.deepEqual(await fs.readdir(source), ['Keys', 'libs']);
  assert.equal((await fs.stat(path.join(source, 'libs', 'tone.wav'))).size, 44);
});

test('native SFZ reads includes and adopted samples only, without copying source files', async () => {
  const h = harness('#include "defs.inc"');
  h.files.set('defs.inc', encode('<group> key=60 <region> sample=tone.wav hicc64=63 ' +
    '<region> sample=pedal.wav locc64=64 <region> sample=missing.wav'));
  h.files.set('pedal.wav', wav());
  const hints = [];
  const prepared = await h.service.prepare(id, { decode: (bytes, rate) => { hints.push(rate); return decode(bytes); } });
  assert.equal(prepared.name, 'piano.sfz');
  assert.equal(prepared.regionCount, 1);
  assert.deepEqual(h.reads.map(item => item.relativePath), ['piano.sfz', 'defs.inc', 'tone.wav']);
  assert.deepEqual(h.stats, ['missing.wav', 'tone.wav']);
  assert.deepEqual(hints, [44100]);
  assert.deepEqual(h.diagnostics[0].missingSamples, ['missing.wav']);
  assert.deepEqual(prepared.warnings, [{ code: 'missing-samples', count: 1 }]);
  assert.equal(prepared.descriptor.rateDivider, 1);
  assert.equal(prepared.descriptor.headBlock, 128);
  assert.equal(prepared.descriptor.processingChannels, 1);
  assert.equal(h.files.size, 4);
});

test('native preparation rereads external definitions and samples on every load', async () => {
  const h = harness();
  const first = await h.service.prepare(id, { decode });
  h.files.set('piano.sfz', encode('<region> sample=tone.wav key=61'));
  const second = await h.service.prepare(id, { decode: () => ({ sampleRate: 44100,
    channels: [new Float32Array([.3, .2, .1])] }) });
  assert.notDeepEqual(first.descriptor.payload, second.descriptor.payload);
  assert.equal(h.reads.filter(item => item.relativePath === 'piano.sfz').length, 2);
  assert.equal(h.reads.filter(item => item.relativePath === 'tone.wav').length, 2);
  const reopened = new NativeSfzLibraryService(h.bridge);
  assert.deepEqual(await reopened.list(), [{ id, name: 'piano.sfz' }]);
  await reopened.remove(id);
  assert.deepEqual(await reopened.list(), []);
  assert.equal(await reopened.prepare(id, { decode }), null);
  assert.equal(h.files.has('piano.sfz'), true);
  assert.equal(h.files.has('tone.wav'), true);
});

test('native selection handles cancellation and stale completion without applying an entry', async () => {
  const h = harness();
  let finish;
  h.bridge.select = () => new Promise(resolve => { finish = resolve; });
  let current = true;
  const pending = h.service.selectFolder({ isCurrent: () => current });
  current = false;
  finish(ok({ banks: [entry] }));
  assert.equal(await pending, null);
  h.bridge.select = async () => ok(null);
  assert.equal(await h.service.selectFolder(), null);
  h.bridge.select = async () => ok({ banks: [entry] });
  assert.deepEqual(await h.service.selectFolder(), [{ id, name: 'piano.sfz' }]);
});

test('native load preserves raw, decoded-header and packed footprint capacity checks', async () => {
  const raw = harness(undefined, { getMaxBytes: () => 1024 });
  raw.bridge.statRelative = async () => ok({ size: 1024 });
  await assert.rejects(raw.service.prepare(id, { decode }), error => error.code === 'too-large');
  assert.deepEqual(raw.reads.map(item => item.relativePath), ['piano.sfz']);
  const decoded = harness(undefined, { getMaxBytes: () => 1024 });
  decoded.files.set('tone.wav', wav(1000));
  await assert.rejects(decoded.service.prepare(id, { decode() { assert.fail('Header must reject before decode'); } }),
    error => error.code === 'too-large');
  const packed = harness(undefined, { getMaxBytes: () => 128 });
  await assert.rejects(packed.service.prepare(id, { decode }), error => error.code === 'too-large');
});

test('native prepare snapshots its limit and discards a removed reference', async () => {
  let limit = 2048;
  let snapshots = 0;
  const h = harness(undefined, { getMaxBytes: () => { snapshots++; return limit; } });
  const read = h.bridge.readRelative;
  h.bridge.readRelative = request => { limit = 1; return read(request); };
  assert.equal((await h.service.prepare(id, { decode })).regionCount, 1);
  assert.equal(snapshots, 1);
  assert.equal(h.reads[0].maxBytes, 2048);
  limit = 2048;
  await h.service.prepare(id, { decode: async () => { await h.service.remove(id); return decode(); } }).then(value =>
    assert.equal(value, null));
});

test('native missing files and broker failures retain useful SFZ error categories', async () => {
  const h = harness();
  h.files.delete('piano.sfz');
  assert.equal(await h.service.prepare(id, { decode }), null);
  h.files.set('piano.sfz', encode('<region> sample=missing.wav'));
  await assert.rejects(h.service.prepare(id, { decode }), error => error.code === 'no-regions');
  h.bridge.readRelative = async () => ({ ok: false, code: 'storage-failed' });
  await assert.rejects(h.service.prepare(id, { decode }), error => error.code === 'prepare');
  h.bridge.readRelative = async () => ({ ok: false, code: 'too-large' });
  await assert.rejects(h.service.prepare(id, { decode }), error => error.code === 'too-large');
});

test('native source failures reach the plugin load message while registry failures stay storage errors', async () => {
  const window = {};
  class PluginBase { registerProcessor() {} }
  vm.runInNewContext(await fs.readFile(new URL('../../plugins/others/sfz_note_player.js', import.meta.url), 'utf8'),
    { window, PluginBase, console: { error() {} } });
  const plugin = new window.SFZNotePlayerPlugin();
  plugin._status = { dataset: {} };
  const failure = code => ({ ok: false, code });
  for (const [method, relativePath] of [
    ['readRelative', 'piano.sfz'], ['readRelative', 'included.sfz'],
    ['readRelative', 'tone.wav'], ['statRelative', 'tone.wav']
  ]) {
    const h = harness('#include "included.sfz"');
    h.files.set('included.sfz', encode('<region> sample=tone.wav'));
    const original = h.bridge[method];
    h.bridge[method] = request => request.relativePath === relativePath
      ? failure('storage-failed') : original(request);
    await assert.rejects(h.service.prepare(id, { decode }), error => {
      assert.equal(error.code, 'prepare');
      plugin._showError(error);
      assert.match(plugin._status.textContent, /could not be loaded/);
      assert.match(plugin._status.textContent, /sample files are available/);
      assert.doesNotMatch(plugin._status.textContent, /saved|storage space/);
      return true;
    });
    h.bridge[method] = request => request.relativePath === relativePath
      ? failure('too-large') : original(request);
    await assert.rejects(h.service.prepare(id, { decode }), error => error.code === 'too-large');
  }
  for (const [method, action] of [
    ['select', h => h.service.selectFolder()], ['list', h => h.service.list()],
    ['list', h => h.service.prepare(id, { decode })], ['remove', h => h.service.remove(id)]
  ]) {
    const h = harness();
    h.bridge[method] = async () => failure('storage-failed');
    await assert.rejects(action(h), error => error.code === 'storage');
    h.bridge[method] = async () => failure('too-large');
    await assert.rejects(action(h), error => error.code === 'too-large');
  }
});

test('default SFZ service uses the dedicated desktop bridge', async () => {
  const h = harness();
  await withGlobals({ window: { electronAPI: { sfzLibraryV1: h.bridge } } }, async () => {
    assert.equal(await getDefaultSfzLibraryService() instanceof NativeSfzLibraryService, true);
  });
});

test('over-budget native banks retain every key with one representative and continuous velocity response', async () => {
  const h = harness('<group> lokey=60 hikey=61 lovel=0 hivel=64 seq_length=2\n' +
    '<region> sample=soft1.wav seq_position=1 lorand=0 hirand=.5\n' +
    '<region> sample=soft2.wav seq_position=2 lorand=.5 hirand=1\n' +
    '<group> lokey=60 hikey=61 lovel=65 hivel=127\n<region> sample=loud.wav');
  h.files.set('soft1.wav', wav(300)); h.files.set('soft2.wav', wav(300));
  h.files.set('loud.wav', wav(2000));
  const parsed = await parseSfz({ selectedPath: 'piano.sfz',
    readText: async name => name === 'piano.sfz' ? new TextDecoder().decode(h.files.get(name)) : null,
    onDiagnostic: null });
  const metadata = new Map([...h.files].map(([name, bytes]) => [name,
    { size: bytes.length, ...parseIrAudioHeader(bytes) }]));
  const full = selectSfzRegionsForBudget(parsed.regions, metadata, 12000);
  assert.equal(full.reduced, false);
  assert.equal(full.regions, parsed.regions);
  const partial = selectSfzRegionsForBudget(parsed.regions, metadata, 2048);
  assert.equal(partial.reduced, true);
  assert.equal(partial.keyCount, 2);
  assert.deepEqual(partial.regions.map(r => [r.lokey, r.hikey, r.lovel, r.hivel,
    r.seq_length, r.seq_position, r.lorand, r.hirand]), [[60, 61, 1, 127, 1, 1, 0, 1]]);
  h.service.getMaxBytes = () => 2048;
  const prepared = await h.service.prepare(id, { decode: () => ({ sampleRate: 44100,
    channels: [new Float32Array(300)] }) });
  assert.equal(prepared.regionCount, 1);
  assert.deepEqual(h.reads.map(r => r.relativePath), ['piano.sfz', 'soft1.wav']);
  assert.equal(h.diagnostics.at(-1).reducedBank.keys, 2);
  assert.deepEqual(prepared.warnings, [{ code: 'reduced-bank', count: 1 }]);
  assert.throws(() => selectSfzRegionsForBudget(parsed.regions, metadata, 100),
    error => error.code === 'too-large');
});

test('native loop recovery warns once per result and normal source reloads retain no warning', async () => {
  const h = harness('<region> sample=tone.wav key=60 end=1 loop_end=4294967295');
  const first = await h.service.prepare(id, { decode });
  assert.deepEqual(first.warnings, [{ code: 'loop-points-ignored', count: 1 }]);
  assert.equal(Object.hasOwn(first.descriptor, 'warnings'), false);
  const second = await new NativeSfzLibraryService(h.bridge, { onDiagnostic: null }).prepare(id, { decode });
  assert.deepEqual(second.warnings, first.warnings);
  h.files.set('piano.sfz', encode('<region> sample=tone.wav key=60 end=1'));
  assert.equal((await h.service.prepare(id, { decode })).warnings, undefined);
});
