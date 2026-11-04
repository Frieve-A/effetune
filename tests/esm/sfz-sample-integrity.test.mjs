import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SfzMd5 } from '../../js/sfz/md5.js';
import { createSfzSampleIntegrity, hashSfzSample, SFZ_MD5_CHUNK_BYTES } from '../../js/sfz/sample-integrity.js';
import { createSfzFileSampleReader, createSfzMemorySampleReader } from '../../js/sfz/sample-reader.js';
import { NativeSfzLibraryService } from '../../js/sfz/native-service.js';

const encode = text => new TextEncoder().encode(text);
const digest = bytes => createHash('md5').update(bytes).digest('hex');
const reader = (bytes, revision = digest(bytes)) => ({ size: bytes.length, revision,
    readRange: async (offset, length) => bytes.slice(offset, offset + length) });

test('independent incremental MD5 matches RFC 1321 vectors and byte-block boundaries', () => {
    for (const [text, expected] of [['', 'd41d8cd98f00b204e9800998ecf8427e'],
        ['a', '0cc175b9c0f1b6a831c399e269772661'], ['abc', '900150983cd24fb0d6963f7d28e17f72'],
        ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
        ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
        ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
        ['1234567890'.repeat(8), '57edf4a22be3c955ac49da2e2107b67a']]) {
        const hash = new SfzMd5();
        for (const byte of encode(text)) hash.update(Uint8Array.of(byte));
        assert.equal(hash.digest(), expected);
        assert.equal(hash.digest(), expected);
    }
    for (const size of [55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 10003]) {
        const bytes = Uint8Array.from({ length: size }, (_, index) => index * 37 + 11);
        const hash = new SfzMd5();
        for (let offset = 0; offset < size; offset += 17) hash.update(bytes.subarray(offset, offset + 17));
        assert.equal(hash.digest(), digest(bytes));
    }
});

test('sample hashing uses bounded original-byte reads, reports progress and cancels between chunks', async () => {
    const bytes = Uint8Array.from({ length: SFZ_MD5_CHUNK_BYTES + 77 }, (_, index) => index * 13);
    const reads = [], progress = [];
    const source = { ...reader(bytes), async readRange(offset, length) {
        reads.push([offset, length]); return bytes.slice(offset, offset + length);
    } };
    assert.equal(await hashSfzSample(source, { onProgress: item => progress.push(item) }), digest(bytes));
    assert.deepEqual(reads.map(item => item[1]), [SFZ_MD5_CHUNK_BYTES, 77]);
    assert.equal(progress.at(-1).completedBytes, bytes.length);
    let current = true;
    reads.length = 0;
    await assert.rejects(hashSfzSample(source, { isCurrent: () => current,
        onProgress: () => { current = false; } }), { code: 'cancelled' });
    assert.equal(reads.length, 1);
    await assert.rejects(hashSfzSample({ size: 20, readRange: async () => new Uint8Array(19) }), { code: 'source-changed' });
});

test('fingerprints resolve renamed bytes, cache stable revisions and distinguish mismatch from exhausted search', async () => {
    const bytes = encode('encoded sample contents'), wrong = encode('wrong sample');
    const files = new Map([['old.wav', wrong], ['new.wav', bytes]]), reads = [], events = [];
    const integrity = createSfzSampleIntegrity({ candidatePaths: [...files.keys()],
        maxLookupBytes: 100, maxLookupFiles: files.size, onDiagnostic: item => events.push(item),
        openReader: async name => files.has(name) ? { ...reader(files.get(name)),
            readRange: async (offset, length) => { reads.push([name, length]); return files.get(name).slice(offset, offset + length); } } : null });
    assert.equal(await integrity.resolve('old.wav', digest(bytes).toUpperCase()), 'new.wav');
    assert.equal(await integrity.resolve('old.wav', digest(bytes)), 'new.wav');
    assert.equal(reads.filter(([, length]) => length > 0).length, 2);
    files.set('old.wav', bytes);
    assert.equal(await integrity.resolve('old.wav', digest(bytes)), 'old.wav');
    assert.equal(reads.filter(([, length]) => length > 0).length, 3);
    assert.equal(events[0].code, 'sample-renamed');
    await assert.rejects(integrity.resolve('old.wav', '0'.repeat(32)), { code: 'sample-integrity' });
    const limited = createSfzSampleIntegrity({ openReader: async name => name === 'new.wav' ? reader(bytes) : null,
        candidatePaths: ['new.wav'], maxLookupBytes: bytes.length - 1, maxLookupFiles: 1, onDiagnostic: null });
    await assert.rejects(limited.resolve('missing.wav', digest(bytes)), { code: 'sample-lookup-limit' });
    // The resident or lookup budget never limits verification of an authored file.
    assert.equal(await limited.resolve('new.wav', digest(bytes)), 'new.wav');
});

test('File snapshots and embedded samples use identical encoded-byte identity', async () => {
    const bytes = encode('same encoded file'), expected = digest(bytes);
    assert.equal(await hashSfzSample(await createSfzMemorySampleReader(bytes)), expected);
    assert.equal(await hashSfzSample(await createSfzFileSampleReader(new File([bytes], 'sample.wav', { lastModified: 1 }))), expected);
    let file = new File([bytes], 'sample.wav', { lastModified: 1 });
    const source = await createSfzFileSampleReader({ getFile: async () => file });
    file = new File([bytes], 'sample.wav', { lastModified: 2 });
    await assert.rejects(hashSfzSample(source), { code: 'source-changed' });
});

test('native granted sample preparation verifies renamed file bytes and rejects changed content after reopen', async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sfz-md5-')));
    t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
    const source = path.join(root, 'instrument'), data = path.join(root, 'settings');
    await fs.mkdir(source); await fs.mkdir(data);
    const bytes = new Uint8Array(48), v = new DataView(bytes.buffer);
    bytes.set(encode('RIFF'), 0); v.setUint32(4, 40, true); bytes.set(encode('WAVEfmt '), 8);
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 44100, true); v.setUint32(28, 88200, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    bytes.set(encode('data'), 36); v.setUint32(40, 4, true); v.setInt16(44, 1000, true);
    const definition = `<region> sample=original.wav md5=${digest(bytes)} key=60`;
    await fs.writeFile(path.join(source, 'test.sfz'), definition);
    await fs.writeFile(path.join(source, 'renamed.wav'), bytes);
    const { registerSfzLibraryIpc, SFZ_LIBRARY_CHANNELS: channels } = createRequire(import.meta.url)('../../electron/sfz-library-ipc.js');
    const handlers = new Map();
    const install = () => registerSfzLibraryIpc({ ipcMain: { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) },
        getUserDataPath: () => data, showOpenDialog: async () => ({ canceled: false, filePaths: [source] }), logger: { error() {} } });
    let dispose = install(); t.after(() => dispose());
    const bridge = { apiVersion: 1, ...Object.fromEntries(Object.entries(channels).map(([key, channel]) =>
        [key, request => handlers.get(channel)({}, request)])) };
    const service = () => new NativeSfzLibraryService(bridge, { onDiagnostic() {} });
    const id = (await bridge.select()).data.banks[0].id;
    let decodes = 0;
    const decode = buffer => { assert.deepEqual(new Uint8Array(buffer), bytes); decodes++;
        return { sampleRate: 44100, channels: [Float32Array.of(.1, 0)] }; };
    assert.equal((await service().prepare(id, { decode })).regionCount, 1);
    dispose(); dispose = install();
    assert.equal((await service().prepare(id, { decode })).regionCount, 1);
    assert.equal(decodes, 2);
    const changed = bytes.slice(); changed[44] ^= 1;
    await fs.writeFile(path.join(source, 'renamed.wav'), changed);
    await assert.rejects(service().prepare(id, { decode }), { code: 'sample-integrity' });
    assert.equal(decodes, 2, 'a changed encoded sample never reaches audio decoding');
    assert.equal(await fs.readFile(path.join(source, 'test.sfz'), 'utf8'), definition);
});
