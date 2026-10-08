import test from 'node:test';
import assert from 'node:assert/strict';
import { SfzLibraryService, enumerateSfzDirectory, listSfzFolderFiles } from '../../js/sfz/service.js';
import { decodeSfzBank, encodeSfzBank } from '../../js/sfz/bank.js';
import { SFZ_MAX_SUPPORTED_BYTES, getSfzMaxBytes, normalizeSfzSizeLimitMiB } from '../../js/sfz/limits.js';
import { maxIrLibraryBytesForName } from '../../js/ir-library/ir-library-limits.js';
import { openIrLibraryBackend } from '../../js/ir-library/ir-library-factory.js';
import { ElectronIrLibraryBackend } from '../../js/ir-library/electron-ir-library-backend.js';
import { openOpfsIrLibraryBackend } from '../../js/ir-library/opfs-ir-library-backend.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

const encode = text => new TextEncoder().encode(text);
class MemoryBackend {
  files = new Map();
  async read(name) { return this.files.get(name) || null; }
  async writeAtomic(name, bytes) { this.files.set(name, bytes.slice()); }
  async remove(name) { this.files.delete(name); }
}
function file(name, bytes, prefix = 'Folder') {
  return { name, size: bytes.length, webkitRelativePath: `${prefix}/${name}`, async arrayBuffer() { return bytes.slice().buffer; } };
}
const pcm = () => ({ sampleRate: 44100, channels: [new Float32Array([.1, .2, .3])] });

test('SFZ library persists dependencies only, reopens, prepares native-rate banks, and removes', async () => {
  const backend = new MemoryBackend();
  const service = await new SfzLibraryService(backend, { onDiagnostic: null }).open();
  const files = [file('a.sfz', encode('#include "inc.sfz"')), file('inc.sfz', encode('<region> sample=one.wav key=60')),
    file('one.wav', new Uint8Array([1, 2])), file('unused.wav', new Uint8Array([3]))];
  assert.deepEqual(listSfzFolderFiles(files), ['a.sfz', 'inc.sfz']);
  const entry = await service.importFolderFiles(files, 'a.sfz', { decode: pcm });
  assert.equal(entry.regionCount, 1);
  assert.deepEqual([...decodeSfzBank(backend.files.get(`${entry.id}.sfzbank`)).files.keys()], ['a.sfz', 'inc.sfz', 'one.wav']);
  const reopened = await new SfzLibraryService(backend, { onDiagnostic: null }).open();
  assert.deepEqual(await reopened.list(), [entry]);
  const prepared = await reopened.prepare(entry.id, { decode: pcm });
  assert.equal(prepared.name, 'a.sfz');
  assert.equal(prepared.descriptor.sampleRate, 1);
  assert.equal(await reopened.prepare('aaaaaaaaaaaaaaaaaaaaaaaa', { decode: pcm }), null);
  await reopened.remove(entry.id);
  assert.deepEqual(await reopened.list(), []);
  assert.equal(backend.files.has(`${entry.id}.sfzbank`), false);
});

test('SFZ import rejects raw and decoded capacity before persisting and excludes absent samples', async () => {
  const backend = new MemoryBackend();
  const service = await new SfzLibraryService(backend, { onDiagnostic: null, getMaxBytes: () => 64 * 1024 * 1024 }).open();
  const missing = [file('a.sfz', encode('<region> sample=gone.wav'))];
  await assert.rejects(service.importFolderFiles(missing, 'a.sfz', { decode: pcm }), error => error.code === 'no-regions');
  const files = [file('a.sfz', encode('<region> sample=one.wav key=60')), file('one.wav', new Uint8Array([1]))];
  const huge = { ...files[1], size: 64 * 1024 * 1024 + 1, arrayBuffer() { throw new Error('Must not read'); } };
  await assert.rejects(service.importFolderFiles([files[0], huge], 'a.sfz', { decode: pcm }), error => error.code === 'too-large');
  await assert.rejects(service.importFolderFiles(files, 'a.sfz', {
    decode: () => ({ sampleRate: 44100, channels: [new Float32Array(16777216)] })
  }), error => error.code === 'too-large');
  assert.equal(backend.files.size, 0);
});

test('folder enumeration retains relative paths, includes text files, and observes cancellation', async () => {
  const sfz = file('a.sfz', encode('<region> sample=one.wav'));
  const wav = file('one.wav', new Uint8Array([1]));
  const leaf = { kind: 'directory', async *entries() { yield ['one.wav', { kind: 'file', getFile: async () => wav }]; } };
  const root = { async *entries() { yield ['a.sfz', { kind: 'file', getFile: async () => sfz }]; yield ['samples', leaf]; } };
  const files = await enumerateSfzDirectory(root);
  assert.deepEqual(listSfzFolderFiles(files), ['a.sfz']);
  await assert.rejects(enumerateSfzDirectory(root, { isCurrent: () => false }), error => error.code === 'cancelled');
});

test('SFZ preparation honors declared original rates and rejects huge decoded headers before decode', async () => {
  const wav = new Uint8Array(44);
  const view = new DataView(wav.buffer);
  wav.set(encode('RIFF'), 0); wav.set(encode('WAVEfmt '), 8); wav.set(encode('data'), 36);
  view.setUint32(16, 16, true); view.setUint16(22, 1, true); view.setUint32(24, 44100, true);
  view.setUint16(32, 2, true); view.setUint32(40, 6, true);
  const backend = new MemoryBackend();
  const service = await new SfzLibraryService(backend, { onDiagnostic: null, getMaxBytes: () => 64 * 1024 * 1024 }).open();
  const sfz = file('a.sfz', encode('<region> sample=one.wav key=60'));
  const hints = [];
  const decode = (_, hint) => { hints.push(hint); return pcm(); };
  await service.importFolderFiles([sfz, file('one.wav', wav)], 'a.sfz', { decode });
  assert.deepEqual(hints, [44100]);
  view.setUint32(40, 40000000, true);
  await assert.rejects(service.importFolderFiles([sfz, file('one.wav', wav)], 'a.sfz', { decode }), error => error.code === 'too-large');
  assert.equal(hints.length, 1);
});

test('removal during preparation discards the decoded bank instead of reviving its cache', async t => {
  const backend = new MemoryBackend();
  const service = await new SfzLibraryService(backend, { onDiagnostic: null }).open();
  const files = [file('a.sfz', encode('<region> sample=one.wav key=60')), file('one.wav', new Uint8Array([1]))];
  const entry = await service.importFolderFiles(files, 'a.sfz', { decode: pcm });
  const reopened = await new SfzLibraryService(backend, { onDiagnostic: null }).open();
  let release;
  let started;
  let guard;
  const start = new Promise((resolve, reject) => {
    started = resolve;
    guard = setTimeout(() => reject(new Error('SFZ decode did not start.')), 2000);
  });
  t.after(() => clearTimeout(guard));
  const decode = async () => { started(); await new Promise(resolve => { release = resolve; }); return pcm(); };
  const pending = reopened.prepare(entry.id, { decode });
  await start;
  await reopened.remove(entry.id);
  release();
  assert.equal(await pending, null);
  assert.equal(await reopened.prepare(entry.id, { decode: pcm }), null);
});

test('OPFS namespaces select separate roots and native SFZ storage bypasses IR migration', async () => {
  const roots = [];
  const directories = new Map();
  const storage = { async getDirectory() { return { async getDirectoryHandle(name) {
    roots.push(name);
    if (!directories.has(name)) directories.set(name, {});
    return directories.get(name);
  } }; } };
  const ir = await openOpfsIrLibraryBackend(storage);
  const sfz = await openOpfsIrLibraryBackend(storage, 'sfz-library');
  assert.notEqual(ir.directory, sfz.directory);
  assert.deepEqual(roots, ['ir-library', 'sfz-library']);
  await assert.rejects(openOpfsIrLibraryBackend(storage, '../escape'), /namespace/);
  const requests = [];
  const bridge = { apiVersion: 1, async list(request) { requests.push(request); return { ok: true, data: [] }; } };
  const native = await openIrLibraryBackend({ namespace: 'sfz-library', electronBridge: bridge,
    storage: { getDirectory() { throw new Error('SFZ must not migrate'); } } });
  assert.ok(native instanceof ElectronIrLibraryBackend);
  assert.deepEqual(await native.list(), []);
  assert.deepEqual(requests, [{ namespace: 'sfz-library' }]);
});

test('SFZ capacity snapshots include raw banks, decoded footprints and cached preparations', async () => {
  let maxBytes = 1024;
  const backend = new MemoryBackend();
  const service = await new SfzLibraryService(backend, { onDiagnostic: null, getMaxBytes: () => maxBytes }).open();
  const files = [file('a.sfz', encode('<region> sample=one.wav key=60')), file('one.wav', new Uint8Array([1]))];
  const largerPcm = () => ({ sampleRate: 44100, channels: [new Float32Array(400)] });
  await assert.rejects(service.importFolderFiles(files, 'a.sfz', { decode: largerPcm }), error => error.code === 'too-large');
  assert.equal(backend.files.size, 0);
  maxBytes = 4096;
  const entry = await service.importFolderFiles(files, 'a.sfz', { decode: () => {
    maxBytes = 1024;
    return largerPcm();
  } });
  assert.equal((await service.list()).length, 1, 'the running import retains its starting limit');
  await assert.rejects(service.prepare(entry.id, { decode: largerPcm }), error => error.code === 'too-large');
  maxBytes = 4096;
  assert.ok((await service.prepare(entry.id)).descriptor.footprintBytes > 1024);
  const reopened = await new SfzLibraryService(backend, { onDiagnostic: null, getMaxBytes: () => maxBytes }).open();
  maxBytes = 1024;
  await assert.rejects(reopened.prepare(entry.id, { decode: largerPcm }), error => error.code === 'too-large');

  const longDefinition = `${'//'.padEnd(2000, 'x')}\n<region> sample=one.wav key=60`;
  maxBytes = 4096;
  const rawEntry = await service.importFolderFiles([file('a.sfz', encode(longDefinition)), files[1]], 'a.sfz', { decode: pcm });
  maxBytes = 1024;
  await assert.rejects(service.prepare(rawEntry.id), error => error.code === 'too-large');
  await assert.rejects(service.importFolderFiles([file('a.sfz', encode(longDefinition)), files[1]], 'a.sfz', { decode: pcm }),
    error => error.code === 'too-large');
  const bank = backend.files.get(`${rawEntry.id}.sfzbank`);
  assert.throws(() => decodeSfzBank(bank, { maxBytes }), error => error.code === 'too-large');
  assert.throws(() => encodeSfzBank('a.sfz', new Map([['a.sfz', encode(longDefinition)]]), { maxBytes }),
    error => error.code === 'too-large');
});

test('SFZ size policy reads app settings and keeps IR namespace limits unchanged', async () => {
  assert.equal(getSfzMaxBytes(undefined), 256 * 1024 * 1024);
  assert.equal(getSfzMaxBytes(256), 256 * 1024 * 1024);
  assert.equal(getSfzMaxBytes(1024), SFZ_MAX_SUPPORTED_BYTES);
  for (const value of [0, -1, 65, Infinity, '256', null]) assert.equal(normalizeSfzSizeLimitMiB(value), 256);
  await withGlobals({ window: { appConfig: { sfzMaxSizeMiB: 256 } } }, async () => {
    const service = new SfzLibraryService(new MemoryBackend());
    assert.equal(service.getMaxBytes(), 256 * 1024 * 1024);
    window.appConfig.sfzMaxSizeMiB = 128;
    assert.equal(service.getMaxBytes(), 128 * 1024 * 1024);
  });
  const name = `${'a'.repeat(24)}.sfzbank`;
  assert.equal(maxIrLibraryBytesForName(name, 'sfz-library'), SFZ_MAX_SUPPORTED_BYTES);
  assert.equal(maxIrLibraryBytesForName(name, 'ir-library'), 64 * 1024 * 1024);
  assert.equal(maxIrLibraryBytesForName(`${'a'.repeat(24)}.wav`, 'sfz-library'), 64 * 1024 * 1024);
  assert.equal(maxIrLibraryBytesForName('index.json', 'sfz-library'), 32 * 1024 * 1024);

  let reads = 0;
  let size = 65 * 1024 * 1024;
  const directory = { async getFileHandle() { return { async getFile() { return {
    size, async arrayBuffer() { reads++; return new ArrayBuffer(1); }
  }; } }; } };
  const storage = { async getDirectory() { return { async getDirectoryHandle() { return directory; } }; } };
  const sfz = await openOpfsIrLibraryBackend(storage, 'sfz-library');
  const ir = await openOpfsIrLibraryBackend(storage);
  assert.equal((await sfz.read(name)).length, 1);
  await assert.rejects(ir.read(name), /too large/);
  size = SFZ_MAX_SUPPORTED_BYTES + 1;
  await assert.rejects(sfz.read(name), /too large/);
  assert.equal(reads, 1, 'oversized storage is rejected before reading the body');

  const bytes = new Uint8Array(65 * 1024 * 1024);
  const requests = [];
  const bridge = { apiVersion: 1, async writeAtomic(request) { requests.push(request.namespace); return { ok: true }; },
    async read() { return { ok: true, data: bytes }; } };
  const nativeSfz = new ElectronIrLibraryBackend(bridge, 'sfz-library');
  await nativeSfz.writeAtomic(name, bytes);
  assert.equal((await nativeSfz.read(name)).length, bytes.length);
  const nativeIr = new ElectronIrLibraryBackend(bridge);
  await assert.rejects(nativeIr.writeAtomic(name, bytes), /too large/);
  await assert.rejects(nativeIr.read(name), /too large/);
  assert.deepEqual(requests, ['sfz-library']);
});
