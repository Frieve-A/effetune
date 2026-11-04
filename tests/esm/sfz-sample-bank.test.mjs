import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { File } from 'node:buffer';
import { encodeSfzBank, SFZ_BANK_MAGIC } from '../../js/sfz/bank.js';
import { encodeSfzBankBlob, openSfzBankSource } from '../../js/sfz/sample-bank-source.js';
import { SfzLibraryService } from '../../js/sfz/service.js';
import { SfzSampleStream } from '../../js/sfz/sample-stream.js';
import { OpfsIrLibraryBackend } from '../../js/ir-library/opfs-ir-library-backend.js';

const encode = text => new TextEncoder().encode(text);

test('streamed portable banks retain the existing format and never require a whole-file read', async () => {
  const files = new Map([['a.sfz', encode('<region> sample=one.wav')], ['one.wav', new Uint8Array([1, 2, 3])]]);
  const blob = encodeSfzBankBlob('a.sfz', files);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), encodeSfzBank('a.sfz', files));
  const file = new File([blob], 'bank.sfzbank', { lastModified: 10 });
  file.arrayBuffer = () => assert.fail('The bank must be sliced');
  const source = await openSfzBankSource(file);
  assert.equal(source.selectedPath, 'a.sfz');
  assert.deepEqual([...await source.createSampleReader('one.wav').readRange(1, 2)], [2, 3]);
  await assert.rejects(source.createSampleReader('one.wav').readRange(2, 2), { code: 'prepare' });
});

test('portable bank indices and file slices retain exact offsets beyond4GiB on a real sparse file', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sfz-bank-range-')));
  const target = path.join(root, 'source.sfzbank');
  let handle;
  t.after(async () => { await handle?.close(); await fs.rm(root, { recursive: true, force: true }); });
  await fs.writeFile(target, new Uint8Array());
  if (process.platform === 'win32') await promisify(execFile)('fsutil.exe', ['sparse', 'setflag', target], { windowsHide: true });
  const offset = 2 ** 32 + 17;
  const metadata = encode(JSON.stringify({ selectedPath: 'a.sfz', files: [
    { path: 'padding.wav', offset: 0, length: offset }, { path: 'a.sfz', offset, length: 3 }
  ] }));
  const prefix = new Uint8Array(12), view = new DataView(prefix.buffer);
  view.setUint32(0, SFZ_BANK_MAGIC, true); view.setUint32(4, 1, true); view.setUint32(8, metadata.length, true);
  handle = await fs.open(target, 'r+');
  await handle.write(prefix, 0, prefix.length, 0); await handle.write(metadata, 0, metadata.length, 12);
  await handle.write(encode('sfz'), 0, 3, 12 + metadata.length + offset);
  const size = (await handle.stat()).size, ranges = [];
  const source = await openSfzBankSource({ size, lastModified: 1,
    arrayBuffer() { assert.fail('No whole sparse-file read'); },
    slice(first, last) {
      ranges.push([first, last]); assert.ok(last - first <= 1024 * 1024);
      return { async arrayBuffer() {
        const bytes = new Uint8Array(last - first), result = await handle.read(bytes, 0, bytes.length, first);
        assert.equal(result.bytesRead, bytes.length); return bytes.buffer;
      } };
    } });
  assert.equal(new TextDecoder().decode(await source.createSampleReader('a.sfz').readRange(0, 3)), 'sfz');
  assert.deepEqual(ranges.at(-1), [12 + metadata.length + offset, 15 + metadata.length + offset]);
  assert.equal(ranges.length, 3);
});

test('OPFS SFZ copy uses bounded slices and aborts before committing a cancelled import', async () => {
  const chunks = [], names = []; let closed = false, aborted = false, current = true;
  const destination = { async createWritable() { return {
    async write(bytes) { chunks.push(bytes.length); }, async close() { closed = true; }, async abort() { aborted = true; }
  }; } };
  const backend = new OpfsIrLibraryBackend({ async getFileHandle(name) { names.push(name); return destination; } }, 'sfz-library');
  const file = new File([new Uint8Array(2 * 1024 * 1024 + 13)], 'source.sfzbank');
  file.arrayBuffer = () => assert.fail('No whole-bank copy');
  await backend.writeSfzBankFile(`${'a'.repeat(24)}.sfzbank`, file);
  assert.deepEqual(chunks, [1024 * 1024, 1024 * 1024, 13]); assert.equal(closed, true);
  chunks.length = 0; closed = false;
  await assert.rejects(backend.writeSfzBankFile(`${'b'.repeat(24)}.sfzbank`, file,
    { isCurrent: () => current, onProgress() { current = false; } }), { name: 'AbortError' });
  assert.deepEqual(chunks, [1024 * 1024]); assert.equal(closed, false); assert.equal(aborted, true);
  await assert.rejects(backend.writeSfzBankFile('index.json', file), TypeError);
  assert.equal(names.length, 2);
});

function wave() {
  const bytes = new Uint8Array(44 + 65536 * 2), view = new DataView(bytes.buffer);
  bytes.set(encode('RIFF')); view.setUint32(4, bytes.length - 8, true); bytes.set(encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  bytes.set(encode('data'), 36); view.setUint32(40, bytes.length - 44, true);
  for (let i = 0; i < 65536; i++) view.setInt16(44 + i * 2, i % 32768 - 16384, true);
  return new File([bytes], 'one.wav', { lastModified: 1 });
}

class BankBackend {
  files = new Map();
  async cleanupTemporary() {}
  async read(name) { return this.files.get(name) || null; }
  async writeAtomic(name, bytes) { this.files.set(name, bytes.slice()); }
  async remove(name) { this.files.delete(name); }
  async writeSfzBankFile(name, blob) { this.files.set(name, new File([blob], name, { lastModified: 1 })); }
  async readSfzBankFile(name) {
    const file = this.files.get(name); file.arrayBuffer = () => assert.fail('No whole-bank reopen'); return file;
  }
}

test('Web overflow imports and reopens through ranged sources; failed preparation removes only its new entry', async () => {
  const backend = new BankBackend(), options = { onDiagnostic: null, getMaxBytes: () => 64 * 1024 };
  const service = await new SfzLibraryService(backend, options).open();
  const definition = new File(['<region> sample=one.wav key=60'], 'a.sfz', { lastModified: 1 });
  const sample = wave(); sample.arrayBuffer = () => assert.fail('No whole-source decode');
  let calls = 0;
  const prepareStreamedBank = async candidate => {
    calls++; assert.equal(candidate.parsed.regions.length, 1); assert.equal(candidate.metadata.get('one.wav').frames, 65536);
    const reader = candidate.createSampleReader('one.wav'), stream = await SfzSampleStream.open(reader.readRange, reader.size);
    assert.equal((await stream.readPage(1)).pcm[0], (4096 - 16384) / 32768);
    return { descriptor: { payload: new ArrayBuffer(32), footprintBytes: 40000 }, regionCount: 1 };
  };
  const entry = await service.importFolderFiles([definition, sample], 'a.sfz', { prepareStreamedBank });
  assert.equal(entry.streamedSource, true); assert.ok(entry.size > 64 * 1024); assert.equal(calls, 1);
  const reopened = await new SfzLibraryService(backend, options).open();
  assert.equal((await reopened.prepare(entry.id, { prepareStreamedBank })).regionCount, 1); assert.equal(calls, 2);
  const before = [...backend.files.keys()];
  await assert.rejects(service.importFolderFiles([definition, sample], 'a.sfz', {
    prepareStreamedBank: () => { throw new Error('Preparation failed'); }
  }), /Preparation failed/);
  assert.deepEqual([...backend.files.keys()], before);
  await service.remove(entry.id); assert.equal(backend.files.has(`${entry.id}.sfzbank`), false);
});
