import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';

import { decodeIrAnalysisSidecar, encodeIrAnalysisSidecar } from '../../js/ir-library/ir-analysis-sidecar.js';
import { identifyPairedIr, identifySingleIr } from '../../js/ir-library/ir-library-id.js';
import { openIrLibrary } from '../../js/ir-library/ir-library-factory.js';
import { IR_LIBRARY_INDEX_NAME, IrLibraryStore } from '../../js/ir-library/ir-library-store.js';
import {
  IR_LIBRARY_INDEX_TOO_LARGE_CODE,
  IR_LIBRARY_MAX_ANALYSIS_BYTES,
  IR_LIBRARY_MAX_INDEX_BYTES,
  IR_LIBRARY_MAX_ORIGINAL_BYTES
} from '../../js/ir-library/ir-library-limits.js';
import { OpfsIrLibraryBackend } from '../../js/ir-library/opfs-ir-library-backend.js';
import { ElectronIrLibraryBackend } from '../../js/ir-library/electron-ir-library-backend.js';
import { parseIrAudioHeader } from '../../js/ir-library/audio-header-metadata.js';
import {
  enumerateIrDirectory,
  getDefaultIrLibraryService,
  IR_IMPORT_FAILURE_FILE_TOO_LARGE,
  IrLibraryService,
  resetDefaultIrLibraryServiceForTests
} from '../../js/ir-library/service.js';
import {
  createIrPcmCacheKey,
  createPersistentIrPcmCacheName,
  decodePersistentIrPcm,
  encodePersistentIrPcm,
  IrPcmCache,
  PersistentIrPcmCache
} from '../../js/ir-library/ir-pcm-cache.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const encode = value => new TextEncoder().encode(value);

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function withTimeout(promise, message, timeoutMs = 2000) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function wavBytes({ channels = 1, sampleRate = 48000, frames = 4, marker = 0 } = {}) {
  const bytes = new Uint8Array(44 + frames * channels * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => [...value].forEach((character, index) => {
    bytes[offset + index] = character.charCodeAt(0);
  });
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * channels * 2, true);
  view.setInt16(44, marker, true);
  return bytes;
}

class MemoryBackend {
  constructor(files = {}) {
    this.files = new Map(Object.entries(files).map(([name, bytes]) => [name, new Uint8Array(bytes)]));
    this.cacheFiles = new Map();
    this.failName = null;
    this.failCacheName = null;
    this.writes = [];
    this.reads = [];
    this.existenceChecks = [];
  }

  async read(name) {
    this.reads.push(name);
    const value = this.files.get(name);
    return value ? value.slice() : null;
  }

  async exists(name) {
    this.existenceChecks.push(name);
    return this.files.has(name);
  }

  async writeAtomic(name, bytes) {
    this.writes.push(name);
    if (name === this.failName) throw new Error('diagnostic write failure');
    this.files.set(name, new Uint8Array(bytes).slice());
  }

  async remove(name) {
    this.files.delete(name);
  }

  async list() {
    return [...this.files.keys()];
  }

  async cleanupTemporary() {
    for (const name of this.files.keys()) {
      if (/^\.tmp-[a-f0-9-]+$/i.test(name)) this.files.delete(name);
    }
  }

  async readCache(name) {
    const value = this.cacheFiles.get(name);
    return value ? value.slice() : null;
  }

  async writeCacheAtomic(name, bytes) {
    if (name === this.failCacheName) throw new Error('cache index diagnostic');
    this.cacheFiles.set(name, new Uint8Array(bytes).slice());
  }

  async removeCache(name) {
    this.cacheFiles.delete(name);
  }

  async listCache() {
    return [...this.cacheFiles.entries()]
      .filter(([name]) => name !== 'index.json')
      .map(([name, bytes]) => ({ name, byteLength: bytes.byteLength }));
  }
}

function notFoundError() {
  const error = new Error('not found');
  error.name = 'NotFoundError';
  return error;
}

class FakeOpfsDirectory {
  constructor() {
    this.files = new Map();
    this.directories = new Map();
  }

  async getDirectoryHandle(name, options = {}) {
    if (!this.directories.has(name)) {
      if (!options.create) throw notFoundError();
      this.directories.set(name, new FakeOpfsDirectory());
    }
    return this.directories.get(name);
  }

  async getFileHandle(name, options = {}) {
    if (!this.files.has(name) && !options.create) throw notFoundError();
    if (!this.files.has(name)) this.files.set(name, new Uint8Array(0));
    return {
      getFile: async () => {
        const bytes = this.files.get(name);
        return {
          size: bytes.byteLength,
          arrayBuffer: async () => bytes.slice().buffer
        };
      },
      createWritable: async () => {
        let pending = new Uint8Array(0);
        return {
          write: async bytes => { pending = new Uint8Array(bytes).slice(); },
          close: async () => { this.files.set(name, pending); },
          abort: async () => {}
        };
      }
    };
  }

  async removeEntry(name) {
    if (!this.files.delete(name)) throw notFoundError();
  }

  async *entries() {
    for (const name of this.files.keys()) yield [name, { kind: 'file', getFile: async () => ({ size: this.files.get(name).byteLength }) }];
    for (const [name, directory] of this.directories) yield [name, { kind: 'directory', directory }];
  }
}

test('IR identity hashes original bytes and composes ordered pair digests', async () => {
  const single = await identifySingleIr(encode('abc'));
  assert.equal(single.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(single.irId, 'ba7816bf8f01cfea414140de');

  const left = encode('left');
  const right = encode('right');
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  const expected = createHash('sha256').update(Buffer.concat([leftDigest, rightDigest])).digest('hex');
  const pair = await identifyPairedIr(left, right);
  assert.equal(pair.irId, expected.slice(0, 24));
  assert.equal(pair.leftSha256, leftDigest.toString('hex'));
  assert.equal(pair.rightSha256, rightDigest.toString('hex'));
  assert.notEqual((await identifyPairedIr(right, left)).irId, pair.irId);
});

test('IR store persists v1 originals, filenames, analysis, and reuses duplicates', async () => {
  const backend = new MemoryBackend();
  const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  const request = {
    bytes: encode('single IR bytes'),
    fileName: 'Hall.WAV',
    analysis: { peak: 0.9 }
  };
  const first = await store.importSingle(request);
  const writesAfterFirst = backend.writes.length;
  const duplicate = await store.importSingle(request);

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(backend.writes.length, writesAfterFirst);
  assert.equal(first.entry.composition, 'single');
  assert.equal(first.entry.originals[0].fileName, 'Hall.WAV');
  assert.equal(Object.hasOwn(first.entry, 'name'), false);
  assert.equal(Object.hasOwn(first.entry, 'tags'), false);
  assert.equal(Object.hasOwn(first.entry, 'source'), false);
  assert.equal(new TextDecoder().decode(await store.readOriginal(first.entry.irId)), 'single IR bytes');
  assert.ok(backend.files.has(first.entry.analysis.storageName));
  assert.equal(JSON.parse(new TextDecoder().decode(backend.files.get('index.json'))).version, 1);

  backend.reads.length = 0;
  backend.existenceChecks.length = 0;
  await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  assert.deepEqual(backend.reads, ['index.json']);
  assert.deepEqual(
    backend.existenceChecks.sort(),
    [first.entry.originals[0].storageName]
  );
});

test('duplicate imports verify full identity and atomically repair missing or corrupt originals', async () => {
  const backend = new MemoryBackend();
  const diagnostics = [];
  const store = await new IrLibraryStore(backend, { onDiagnostic: error => diagnostics.push(error) }).open();
  const singleRequest = {
    bytes: encode('repair single'),
    fileName: 'Repair.wav'
  };
  const single = await store.importSingle(singleRequest);
  const singleName = single.entry.originals[0].storageName;
  backend.files.delete(singleName);
  assert.equal((await store.importSingle(singleRequest)).duplicate, true);
  assert.deepEqual(backend.files.get(singleName), singleRequest.bytes);

  const pairRequest = {
    left: { bytes: encode('repair left'), fileName: 'Repair_L.wav' },
    right: { bytes: encode('repair right'), fileName: 'Repair_R.wav' }
  };
  const pair = await store.importPair(pairRequest);
  const [left, right] = pair.entry.originals;
  backend.files.delete(left.storageName);
  backend.files.set(right.storageName, encode('corrupt right'));
  assert.equal((await store.importPair(pairRequest)).duplicate, true);
  assert.deepEqual(backend.files.get(left.storageName), pairRequest.left.bytes);
  assert.deepEqual(backend.files.get(right.storageName), pairRequest.right.bytes);

  const collisionBytes = encode('different full digest');
  const collisionIdentity = await identifySingleIr(collisionBytes);
  const forged = structuredClone(single.entry);
  forged.irId = collisionIdentity.irId;
  forged.originals[0].storageName = `${collisionIdentity.irId}.wav`;
  forged.analysis.storageName = `${collisionIdentity.irId}.analysis`;
  store.index.entries[collisionIdentity.irId] = forged;
  await assert.rejects(
    store.importSingle({ bytes: collisionBytes, fileName: 'Collision.wav' }),
    error => error?.code === 'ir-library-unavailable'
  );
  assert.ok(diagnostics.some(error => /identity collision/i.test(error.message)));
});

test('duplicate imports repair originals when a bounded backend rejects the existing file read', async () => {
  const backend = new MemoryBackend();
  const diagnostics = [];
  const store = await new IrLibraryStore(backend, { onDiagnostic: error => diagnostics.push(error) }).open();
  const request = { bytes: encode('bounded repair'), fileName: 'Bounded.wav' };
  const saved = await store.importSingle(request);
  const originalName = saved.entry.originals[0].storageName;
  const read = backend.read.bind(backend);
  backend.read = async name => {
    if (name === originalName) throw new RangeError('IR original is too large to read.');
    return read(name);
  };
  backend.files.set(originalName, encode('untrusted stored bytes'));
  const writesBeforeRepair = backend.writes.length;

  const duplicate = await store.importSingle(request);

  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(backend.files.get(originalName), request.bytes);
  assert.deepEqual(backend.writes.slice(writesBeforeRepair), [originalName]);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /too large to read/i);
});

test('IR store persists ordered paired originals with component hashes', async () => {
  const backend = new MemoryBackend();
  const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  const result = await store.importPair({
    left: { bytes: encode('L original'), fileName: 'room-L.wav' },
    right: { bytes: encode('R original'), fileName: 'room-R.aiff' },
    analysis: { channels: 2 }
  });
  assert.equal(result.entry.composition, 'pair');
  assert.deepEqual(result.entry.originals.map(item => item.role), ['L', 'R']);
  assert.match(result.entry.originals[0].storageName, /\.L\.wav$/);
  assert.match(result.entry.originals[1].storageName, /\.R\.aiff$/);
  assert.deepEqual(result.entry.originals.map(item => item.fileName), ['room-L.wav', 'room-R.aiff']);
  assert.equal(result.entry.originals[0].sha256.length, 64);
  assert.equal(new TextDecoder().decode(await store.readOriginal(result.entry.irId, 'R')), 'R original');
});

test('IR original reads verify each role byte length and full SHA-256 before decode staging', async () => {
  const backend = new MemoryBackend();
  const diagnostics = [];
  const store = await new IrLibraryStore(backend, { onDiagnostic: error => diagnostics.push(error) }).open();
  const saved = await store.importPair({
    left: { bytes: encode('left original'), fileName: 'integrity_L.wav' },
    right: { bytes: encode('right original'), fileName: 'integrity_R.wav' }
  });
  const [left, right] = saved.entry.originals;
  const validLeft = backend.files.get(left.storageName).slice();
  const validRight = backend.files.get(right.storageName).slice();

  const wrongLeft = validLeft.slice();
  wrongLeft[0] ^= 0xff;
  backend.files.set(left.storageName, wrongLeft);
  assert.equal(await store.readOriginal(saved.entry.irId, 'L'), null);
  backend.files.set(left.storageName, validLeft);

  backend.files.set(right.storageName, validRight.subarray(0, validRight.byteLength - 1));
  assert.equal(await store.readOriginal(saved.entry.irId, 'R'), null);
  assert.equal(diagnostics.length, 2);

  let decodeCalls = 0;
  const service = new IrLibraryService(store, { onDiagnostic() {} });
  assert.equal(await service.resolveDecodedPcm(saved.entry.irId, 48000, {
    async decode() {
      decodeCalls += 1;
      return { channels: [new Float32Array([1])], sampleRate: 48000 };
    },
    async resample(pcm) { return pcm; }
  }), null);
  assert.equal(decodeCalls, 1);
});

test('analysis summary stays small while binary envelope and EDC round-trip through the sidecar', async () => {
  const backend = new MemoryBackend();
  const diagnostics = [];
  const store = await new IrLibraryStore(backend, { onDiagnostic: error => diagnostics.push(error) }).open();
  const envelope = new Float32Array([0, 0.5, 1]);
  const edc = new Float32Array([1, 0.25, 0]);
  const saved = await store.importSingle({
    bytes: encode('analysis original'),
    fileName: 'analysis.wav',
    analysis: { onsetFrame: 12, rt60: 1.75, peakDb: -0.25, envelope, edc }
  });
  const persistedIndex = new TextDecoder().decode(backend.files.get('index.json'));
  assert.equal(persistedIndex.includes('envelope'), false);
  assert.equal(persistedIndex.includes('edc'), false);
  assert.deepEqual(saved.entry.analysis, {
    storageName: `${saved.entry.irId}.analysis`,
    onsetFrame: 12,
    rt60: 1.75,
    peakDb: -0.25
  });
  const restored = await store.readAnalysis(saved.entry.irId);
  assert.deepEqual([...restored.envelope], [...envelope]);
  assert.deepEqual([...restored.edc], [...edc]);
  assert.equal(restored.onsetFrame, 12);

  backend.files.set(saved.entry.analysis.storageName, new Uint8Array([1, 2, 3]));
  assert.equal(await store.readAnalysis(saved.entry.irId), null);
  assert.ok(store.get(saved.entry.irId));
  assert.equal(diagnostics.length, 1);
  backend.files.delete(saved.entry.analysis.storageName);
  const reopened = await new IrLibraryStore(backend, { onDiagnostic: error => diagnostics.push(error) }).open();
  assert.ok(reopened.get(saved.entry.irId));
  assert.equal(await reopened.readAnalysis(saved.entry.irId), null);
});

test('IR index recovery preserves every managed file when an entry has an invalid structure', async () => {
  const corruptions = [
    entry => { entry.name = 'Legacy name'; },
    entry => { entry.tags = []; },
    entry => { entry.source = { url: '', files: [] }; },
    entry => { entry.analysis = null; },
    entry => { entry.originals[0].fileName = ''; },
    entry => { entry.originals[0].sha256 = '0'.repeat(63); }
  ];
  for (const corrupt of corruptions) {
    const backend = new MemoryBackend();
    const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
    const saved = await store.importSingle({
      bytes: encode(`shape-${backend.writes.length}`),
      fileName: 'shape.wav'
    });
    const persisted = JSON.parse(new TextDecoder().decode(backend.files.get('index.json')));
    corrupt(persisted.entries[saved.entry.irId]);
    const corruptIndex = encode(JSON.stringify(persisted));
    backend.files.set('index.json', corruptIndex);
    const originalName = saved.entry.originals[0].storageName;
    const analysisName = saved.entry.analysis.storageName;
    const original = backend.files.get(originalName).slice();
    const analysis = backend.files.get(analysisName).slice();
    const names = [...backend.files.keys()].sort();

    const recovered = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
    assert.equal(recovered.recoveryRequired, true);
    assert.deepEqual(backend.files.get('index.json'), corruptIndex);
    assert.deepEqual(backend.files.get(originalName), original);
    assert.deepEqual(backend.files.get(analysisName), analysis);
    assert.deepEqual([...backend.files.keys()].sort(), names);
  }
});

test('IR index recovery preserves files when an entry claims storage belonging to another ID', async () => {
  const backend = new MemoryBackend();
  const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  const first = await store.importSingle({ bytes: encode('first owner'), fileName: 'First.wav' });
  const second = await store.importSingle({ bytes: encode('second owner'), fileName: 'Second.wav' });
  const firstOriginal = first.entry.originals[0].storageName;
  const firstAnalysis = first.entry.analysis.storageName;
  const secondOriginal = second.entry.originals[0].storageName;
  const secondAnalysis = second.entry.analysis.storageName;
  const persisted = JSON.parse(new TextDecoder().decode(backend.files.get('index.json')));
  persisted.entries[second.entry.irId].originals[0].storageName = firstOriginal;
  persisted.entries[second.entry.irId].analysis.storageName = firstAnalysis;
  const corruptIndex = encode(JSON.stringify(persisted));
  backend.files.set('index.json', corruptIndex);
  const names = [...backend.files.keys()].sort();

  const recovered = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  assert.equal(recovered.recoveryRequired, true);
  assert.deepEqual(backend.files.get('index.json'), corruptIndex);
  assert.equal(backend.files.has(firstOriginal), true);
  assert.equal(backend.files.has(firstAnalysis), true);
  assert.equal(backend.files.has(secondOriginal), true);
  assert.equal(backend.files.has(secondAnalysis), true);
  assert.deepEqual([...backend.files.keys()].sort(), names);
});

test('failed analysis index update preserves the previous summary and sidecar', async () => {
  const backend = new MemoryBackend();
  const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  const saved = await store.importSingle({
    bytes: encode('analysis transaction'),
    fileName: 'analysis-transaction.wav',
    analysis: {
      onsetFrame: 3,
      rt60: 1.2,
      peakDb: -0.5,
      envelope: new Float32Array([0.25, 0.5]),
      edc: new Float32Array([0, -12])
    }
  });
  const previousSummary = saved.entry.analysis;
  const previousSidecar = backend.files.get(previousSummary.storageName).slice();
  const previousIndex = backend.files.get('index.json').slice();
  const previousNames = [...backend.files.keys()].sort();

  backend.failName = 'index.json';
  await assert.rejects(
    store.updateAnalysis(saved.entry.irId, {
      onsetFrame: 7,
      rt60: 2.4,
      peakDb: -1,
      envelope: new Float32Array([0.75]),
      edc: new Float32Array([0, -24])
    }),
    error => error.code === 'ir-library-unavailable' && !error.message.includes('diagnostic')
  );
  assert.deepEqual(store.get(saved.entry.irId).analysis, previousSummary);
  assert.deepEqual(backend.files.get(previousSummary.storageName), previousSidecar);
  assert.deepEqual(backend.files.get('index.json'), previousIndex);
  assert.deepEqual([...backend.files.keys()].sort(), previousNames);
  const restored = await store.readAnalysis(saved.entry.irId);
  assert.deepEqual([...restored.envelope], [0.25, 0.5]);
  assert.deepEqual([...restored.edc], [0, -12]);

  backend.failName = null;
  assert.equal(await store.updateAnalysis(saved.entry.irId, {
    onsetFrame: 7,
    rt60: 2.4,
    peakDb: -1,
    envelope: new Float32Array([0.75]),
    edc: new Float32Array([0, -24])
  }), true);
  const updated = store.get(saved.entry.irId).analysis;
  assert.match(updated.storageName, new RegExp(`^${saved.entry.irId}\\.a[0-9]{9}$`));
  assert.notEqual(updated.storageName, previousSummary.storageName);
  assert.equal(backend.files.has(previousSummary.storageName), false);
  assert.equal(backend.files.has(updated.storageName), true);
  assert.deepEqual([...(await store.readAnalysis(saved.entry.irId)).envelope], [0.75]);
  const reopened = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  assert.equal(reopened.get(saved.entry.irId).analysis.storageName, updated.storageName);
  assert.deepEqual([...(await reopened.readAnalysis(saved.entry.irId)).edc], [0, -24]);
});

test('analysis revisions do not change original content identity', async () => {
  const backend = new MemoryBackend();
  const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  const bytes = wavBytes({ marker: 23 });
  const saved = await store.importSingle({ bytes, fileName: 'Revision.wav' });
  const id = saved.entry.irId;
  const originalRevision = store.getOriginalRevision(id);
  const entryRevision = store.getEntryRevision(id);

  await store.updateAnalysis(id, {
    onsetFrame: 1,
    rt60: 0.8,
    peakDb: -2,
    envelope: new Float32Array([1, 0.5]),
    edc: new Float32Array([0, -6])
  });
  assert.ok(store.getEntryRevision(id) > entryRevision);
  assert.equal(store.getOriginalRevision(id), originalRevision);

  assert.equal(await store.remove(id), true);
  assert.equal(store.getOriginalRevision(id), null);
  const restored = await store.importSingle({ bytes, fileName: 'Revision.wav' });
  assert.equal(restored.entry.irId, id);
  assert.ok(store.getOriginalRevision(id) > originalRevision);
});

test('analysis codec rejects malformed and oversized series and normalizes unbounded summary values', async () => {
  const encoded = encodeIrAnalysisSidecar({ envelope: [0.25], edc: [1] });
  assert.deepEqual([...decodeIrAnalysisSidecar(encoded).envelope], [0.25]);
  const corrupt = encoded.slice();
  corrupt[0] = 0;
  assert.throws(() => decodeIrAnalysisSidecar(corrupt));
  const nonFinite = encoded.slice();
  new DataView(nonFinite.buffer).setUint32(16, 0x7fc00000, true);
  assert.throws(() => decodeIrAnalysisSidecar(nonFinite));
  assert.throws(() => encodeIrAnalysisSidecar({ envelope: new Float32Array(262145) }), RangeError);

  const backend = new MemoryBackend();
  const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  const saved = await store.importSingle({
    bytes: encode('bounded summary'),
    fileName: 'bounded.wav',
    analysis: { onsetFrame: Number.MAX_SAFE_INTEGER, rt60: Infinity, peakDb: -5000 }
  });
  assert.deepEqual(saved.entry.analysis, {
    storageName: `${saved.entry.irId}.analysis`,
    onsetFrame: null,
    rt60: null,
    peakDb: null
  });
});

test('Electron fallback exposes the same store API and byte-derived IDs as web storage', async () => {
  const files = new Map();
  const cacheFiles = new Map();
  const bridge = {
    apiVersion: 1,
    async read({ name }) { return { ok: true, data: files.get(name)?.slice() || null }; },
    async exists({ name }) { return { ok: true, data: files.has(name) }; },
    async writeAtomic({ name, bytes }) { files.set(name, new Uint8Array(bytes).slice()); return { ok: true, data: true }; },
    async remove({ name }) { files.delete(name); return { ok: true, data: true }; },
    async list() { return { ok: true, data: [...files.keys()] }; },
    async cleanupTemporary() { return { ok: true, data: true }; },
    async readCache({ name }) { return { ok: true, data: cacheFiles.get(name)?.slice() || null }; },
    async writeCacheAtomic({ name, bytes }) { cacheFiles.set(name, new Uint8Array(bytes).slice()); return { ok: true, data: true }; },
    async removeCache({ name }) { cacheFiles.delete(name); return { ok: true, data: true }; },
    async listCache() {
      return {
        ok: true,
        data: [...cacheFiles.entries()].filter(([name]) => name !== 'index.json').map(([name, bytes]) => ({ name, byteLength: bytes.byteLength }))
      };
    }
  };
  const bytes = encode('portable identity');
  const store = await openIrLibrary({
    storage: { async getDirectory() { throw new Error('OPFS unavailable'); } },
    electronBridge: bridge,
    onDiagnostic() {}
  });
  const saved = await store.importSingle({ bytes, fileName: 'portable.wav' });
  assert.equal(saved.entry.irId, (await identifySingleIr(bytes)).irId);
  assert.equal(typeof store.importPair, 'function');
  assert.ok(store.pcmCache);
  assert.equal(new TextDecoder().decode(await store.readOriginal(saved.entry.irId)), 'portable identity');
});

test('browser persistence is requested once without blocking imports and never requested for Electron fallback', async () => {
  let persistenceCalls = 0;
  let resolvePersistence;
  const persistencePromise = new Promise(resolve => { resolvePersistence = resolve; });
  const backend = new MemoryBackend();
  const store = await new IrLibraryStore(backend, {
    requestPersistence() {
      persistenceCalls += 1;
      return persistencePromise;
    },
    onDiagnostic() {}
  }).open();
  const request = { bytes: encode('persist once'), fileName: 'persist.wav' };
  const first = await store.importSingle(request);
  await store.importSingle(request);
  assert.equal(first.duplicate, false);
  assert.equal(persistenceCalls, 1);
  resolvePersistence(false);
  await Promise.resolve();

  let electronPersistenceCalls = 0;
  const electronFiles = new Map();
  const electronCacheFiles = new Map();
  const electronBridge = {
    apiVersion: 1,
    async read({ name }) { return { ok: true, data: electronFiles.get(name) || null }; },
    async exists({ name }) { return { ok: true, data: electronFiles.has(name) }; },
    async writeAtomic({ name, bytes }) { electronFiles.set(name, new Uint8Array(bytes)); return { ok: true, data: true }; },
    async remove({ name }) { electronFiles.delete(name); return { ok: true, data: true }; },
    async list() { return { ok: true, data: [...electronFiles.keys()] }; },
    async cleanupTemporary() { return { ok: true, data: true }; },
    async readCache({ name }) { return { ok: true, data: electronCacheFiles.get(name) || null }; },
    async writeCacheAtomic({ name, bytes }) { electronCacheFiles.set(name, new Uint8Array(bytes)); return { ok: true, data: true }; },
    async removeCache({ name }) { electronCacheFiles.delete(name); return { ok: true, data: true }; },
    async listCache() { return { ok: true, data: [] }; }
  };
  const electronStore = await openIrLibrary({
    storage: {
      async getDirectory() { throw new Error('OPFS unavailable'); },
      async persist() { electronPersistenceCalls += 1; return true; }
    },
    electronBridge,
    onDiagnostic() {}
  });
  await electronStore.importSingle({ bytes: encode('electron'), fileName: 'electron.wav' });
  assert.equal(electronPersistenceCalls, 0);
});

test('web factory requests persistence once and OPFS cache uses the isolated cache namespace', async () => {
  const origin = new FakeOpfsDirectory();
  let persistenceCalls = 0;
  const storage = {
    async getDirectory() { return origin; },
    async persist() { persistenceCalls += 1; return false; }
  };
  const diagnostics = [];
  const store = await openIrLibrary({ storage, onDiagnostic: error => diagnostics.push(error) });
  const request = { bytes: encode('web persisted'), fileName: 'web.wav' };
  await store.importSingle(request);
  await store.importSingle(request);
  await Promise.resolve();
  assert.equal(persistenceCalls, 1);
  assert.equal(diagnostics.length, 1);

  const cache = store.pcmCache;
  const id = (await identifySingleIr(request.bytes)).irId;
  assert.equal(await cache.set(id, 48000, {}, {
    sampleRate: 48000,
    channelData: [new Float32Array([0.5])]
  }), true);
  const root = origin.directories.get('ir-library');
  assert.ok(root.files.has('index.json'));
  assert.ok(root.directories.get('cache').files.has(`${id}@48000.f32`));
});

test('default IR library service shares concurrent opens and retries after a rejected open', async () => {
  resetDefaultIrLibraryServiceForTests();
  const origin = new FakeOpfsDirectory();
  let attempts = 0;
  const options = {
    storage: {
      async getDirectory() {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary OPFS failure');
        return origin;
      }
    },
    onDiagnostic() {}
  };
  try {
    const first = getDefaultIrLibraryService(options);
    const concurrent = getDefaultIrLibraryService(options);
    assert.strictEqual(concurrent, first);
    const failures = await Promise.allSettled([first, concurrent]);
    assert.deepEqual(failures.map(result => result.status), ['rejected', 'rejected']);
    assert.equal(attempts, 1);

    const retry = getDefaultIrLibraryService(options);
    assert.notStrictEqual(retry, first);
    const service = await retry;
    assert.ok(service instanceof IrLibraryService);
    assert.equal(attempts, 2);
    assert.strictEqual(getDefaultIrLibraryService(options), retry);
  } finally {
    resetDefaultIrLibraryServiceForTests();
  }
});

test('failed atomic index update keeps the previous index and valid startup removes proven orphans', async () => {
  const backend = new MemoryBackend();
  const firstStore = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  const first = await firstStore.importSingle({ bytes: encode('first'), fileName: 'first.wav' });
  const previousIndex = backend.files.get('index.json').slice();
  backend.failName = 'index.json';
  await assert.rejects(
    firstStore.importSingle({ bytes: encode('second'), fileName: 'second.wav' }),
    error => error.code === 'ir-library-unavailable' && !error.message.includes('diagnostic')
  );
  assert.deepEqual(backend.files.get('index.json'), previousIndex);
  backend.failName = null;

  const recovered = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  assert.deepEqual(recovered.list().map(entry => entry.irId), [first.entry.irId]);
  assert.deepEqual(
    [...backend.files.keys()].filter(name => name !== 'index.json').sort(),
    [first.entry.analysis.storageName, first.entry.originals[0].storageName].sort()
  );
});

test('missing or corrupt indexes require recovery without changing managed files while valid indexes repair individual entries', async () => {
  const orphanName = 'aaaaaaaaaaaaaaaaaaaaaaaa.wav';
  const tempName = '.tmp-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const missing = new MemoryBackend({ [orphanName]: encode('valuable'), [tempName]: encode('partial') });
  const missingStore = await new IrLibraryStore(missing, { onDiagnostic() {} }).open();
  assert.equal(missingStore.recoveryRequired, true);
  await assert.rejects(
    missingStore.importSingle({ bytes: encode('replacement'), fileName: 'replacement.wav' }),
    error => error.code === 'ir-library-recovery-required' && !error.message.includes('aaaaaaaa')
  );
  assert.ok(missing.files.has(orphanName));
  assert.ok(missing.files.has(tempName));
  assert.equal(missing.files.has('index.json'), false);
  const missingRestart = await new IrLibraryStore(missing, { onDiagnostic() {} }).open();
  assert.equal(missingRestart.recoveryRequired, true);
  assert.ok(missing.files.has(orphanName));

  const corrupt = new MemoryBackend({ 'index.json': encode('{bad'), [orphanName]: encode('valuable'), [tempName]: encode('partial') });
  const corruptStore = await new IrLibraryStore(corrupt, { onDiagnostic() {} }).open();
  assert.equal(corruptStore.recoveryRequired, true);
  await assert.rejects(
    corruptStore.updateAnalysis(orphanName.slice(0, 24), { onsetFrame: 0 }),
    error => error.code === 'ir-library-recovery-required'
  );
  assert.ok(corrupt.files.has(orphanName));
  assert.ok(corrupt.files.has(tempName));
  assert.equal(new TextDecoder().decode(corrupt.files.get('index.json')), '{bad');
  const corruptRestart = await new IrLibraryStore(corrupt, { onDiagnostic() {} }).open();
  assert.equal(corruptRestart.recoveryRequired, true);
  assert.equal(new TextDecoder().decode(corrupt.files.get('index.json')), '{bad');

  const unsupported = new MemoryBackend({
    'index.json': encode(JSON.stringify({ version: 2, entries: {} })),
    [orphanName]: encode('valuable')
  });
  const unsupportedStore = await new IrLibraryStore(unsupported, { onDiagnostic() {} }).open();
  assert.equal(unsupportedStore.recoveryRequired, true);
  assert.equal(JSON.parse(new TextDecoder().decode(unsupported.files.get('index.json'))).version, 2);

  const valid = new MemoryBackend();
  const initial = await new IrLibraryStore(valid, { onDiagnostic() {} }).open();
  const saved = await initial.importSingle({ bytes: encode('will disappear'), fileName: 'lost.wav' });
  valid.files.set(tempName, encode('partial'));
  valid.files.delete(saved.entry.originals[0].storageName);
  const repaired = await new IrLibraryStore(valid, { onDiagnostic() {} }).open();
  assert.deepEqual(repaired.list(), []);
  assert.equal(valid.files.has(tempName), false);
  assert.equal(Object.keys(JSON.parse(new TextDecoder().decode(valid.files.get('index.json'))).entries).length, 0);
});

test('storage boundaries reject oversized files before renderer reads or bridge cloning', async () => {
  let arrayBufferCalls = 0;
  const diagnostics = [];
  const service = new IrLibraryService({}, { onDiagnostic: error => diagnostics.push(error) });
  const result = await service.importFiles([{
    name: 'Too Large.wav',
    size: IR_LIBRARY_MAX_ORIGINAL_BYTES + 1,
    async arrayBuffer() {
      arrayBufferCalls += 1;
      return new ArrayBuffer(0);
    }
  }]);
  assert.equal(result.failedCount, 1);
  assert.deepEqual(result.failureCodes, [IR_IMPORT_FAILURE_FILE_TOO_LARGE]);
  assert.equal(arrayBufferCalls, 0);
  assert.equal(diagnostics.length, 1);

  const batchResult = await service.importFiles([{
    name: 'Hall_L.wav',
    size: IR_LIBRARY_MAX_ORIGINAL_BYTES + 1,
    async arrayBuffer() { arrayBufferCalls += 1; return new ArrayBuffer(0); }
  }, {
    name: 'Hall_R.wav',
    size: IR_LIBRARY_MAX_ORIGINAL_BYTES + 1,
    async arrayBuffer() { arrayBufferCalls += 1; return new ArrayBuffer(0); }
  }]);
  assert.equal(batchResult.failedCount, 1);
  assert.deepEqual(batchResult.failureCodes, [IR_IMPORT_FAILURE_FILE_TOO_LARGE]);

  const strictResult = await service.importFiles([{
    name: 'Strict_L.wav',
    size: IR_LIBRARY_MAX_ORIGINAL_BYTES + 1,
    async arrayBuffer() { arrayBufferCalls += 1; return new ArrayBuffer(0); }
  }, {
    name: 'Strict_R.wav',
    size: IR_LIBRARY_MAX_ORIGINAL_BYTES + 1,
    async arrayBuffer() { arrayBufferCalls += 1; return new ArrayBuffer(0); }
  }], { strictPair: true });
  assert.deepEqual(strictResult.imported, []);
  assert.equal(strictResult.failedCount, 1);
  assert.deepEqual(strictResult.failureCodes, [IR_IMPORT_FAILURE_FILE_TOO_LARGE]);
  assert.equal(arrayBufferCalls, 0);
  assert.equal(diagnostics.length, 3);

  let opfsArrayBufferCalls = 0;
  const opfsBackend = new OpfsIrLibraryBackend({
    async getFileHandle() {
      return {
        async getFile() {
          return {
            size: IR_LIBRARY_MAX_ANALYSIS_BYTES + 1,
            async arrayBuffer() {
              opfsArrayBufferCalls += 1;
              return new ArrayBuffer(0);
            }
          };
        }
      };
    }
  });
  await assert.rejects(opfsBackend.read('aaaaaaaaaaaaaaaaaaaaaaaa.analysis'), RangeError);
  assert.equal(opfsArrayBufferCalls, 0);

  let bridgeCalls = 0;
  const electronBackend = new ElectronIrLibraryBackend({
    apiVersion: 1,
    async writeAtomic() {
      bridgeCalls += 1;
      return { ok: true, data: true };
    }
  });
  await assert.rejects(
    electronBackend.writeAtomic(
      'aaaaaaaaaaaaaaaaaaaaaaaa.analysis',
      new Uint8Array(IR_LIBRARY_MAX_ANALYSIS_BYTES + 1)
    ),
    RangeError
  );
  assert.equal(bridgeCalls, 0);
});

test('oversized library indexes enter recovery through a bounded safe signal while storage failures remain fatal', async () => {
  let arrayBufferCalls = 0;
  const opfsDiagnostics = [];
  const opfsStore = new IrLibraryStore(new OpfsIrLibraryBackend({
    async getFileHandle() {
      return {
        async getFile() {
          return {
            size: IR_LIBRARY_MAX_INDEX_BYTES + 1,
            async arrayBuffer() {
              arrayBufferCalls += 1;
              return new ArrayBuffer(0);
            }
          };
        }
      };
    }
  }), { onDiagnostic: error => opfsDiagnostics.push(error) });

  assert.equal((await opfsStore.open()).recoveryRequired, true);
  assert.equal(arrayBufferCalls, 0);
  assert.equal(opfsDiagnostics.length, 1);
  assert.equal(opfsDiagnostics[0].code, IR_LIBRARY_INDEX_TOO_LARGE_CODE);

  const electronStore = new IrLibraryStore(new ElectronIrLibraryBackend({
    apiVersion: 1,
    async read() { return { ok: false, code: IR_LIBRARY_INDEX_TOO_LARGE_CODE }; }
  }), { onDiagnostic() {} });
  assert.equal((await electronStore.open()).recoveryRequired, true);

  const fatalBackend = new MemoryBackend();
  fatalBackend.read = async () => {
    const error = new Error('private storage detail');
    error.code = 'EACCES';
    throw error;
  };
  const fatalStore = new IrLibraryStore(fatalBackend, { onDiagnostic() {} });
  await assert.rejects(
    fatalStore.open(),
    error => error?.code === 'ir-library-unavailable' && !error.message.includes('private storage detail')
  );
  assert.equal(fatalStore.recoveryRequired, false);
});

test('OPFS writable close is the commit boundary and a failed close preserves old bytes', async () => {
  let committed = encode('old index');
  let failClose = false;
  const directory = {
    async getFileHandle() {
      return {
        async getFile() {
          return { async arrayBuffer() { return committed.slice().buffer; } };
        },
        async createWritable() {
          let pending;
          return {
            async write(bytes) { pending = new Uint8Array(bytes).slice(); },
            async close() {
              if (failClose) throw new Error('close failed');
              committed = pending;
            },
            async abort() {}
          };
        }
      };
    }
  };
  const backend = new OpfsIrLibraryBackend(directory);
  await backend.writeAtomic('index.json', encode('new index'));
  assert.equal(new TextDecoder().decode(committed), 'new index');
  failClose = true;
  await assert.rejects(backend.writeAtomic('index.json', encode('broken index')));
  assert.equal(new TextDecoder().decode(await backend.read('index.json')), 'new index');
});

test('PCM cache accounts bytes, refreshes LRU, replaces, evicts, and clears', () => {
  const cache = new IrPcmCache(12);
  const id = '0123456789abcdef01234567';
  const keyA = createIrPcmCacheKey(id, 48000, { trim: 2, directCut: true });
  const keyAReordered = createIrPcmCacheKey(id, 48000, { directCut: true, trim: 2 });
  const keyB = createIrPcmCacheKey(id, 96000, {});
  const keyC = createIrPcmCacheKey(id, 44100, {});
  assert.equal(keyA, keyAReordered);
  assert.equal(cache.set(keyA, new Float32Array(2)), true);
  assert.equal(cache.set(keyB, new Float32Array(1)), true);
  assert.equal(cache.get(keyA).byteLength, 8);
  assert.equal(cache.set(keyC, new Float32Array(1)), true);
  assert.equal(cache.get(keyB), undefined);
  assert.equal(cache.set(keyA, new Float32Array(1)), true);
  assert.deepEqual(cache.getStats(), { byteLength: 8, entryCount: 2, maxBytes: 12 });
  assert.equal(cache.set('too-large', new Uint8Array(13)), false);
  assert.equal(cache.delete(keyC), true);
  cache.clear();
  assert.deepEqual(cache.getStats(), { byteLength: 0, entryCount: 0, maxBytes: 12 });
});

test('persistent PCM cache uses deterministic bounded names and validates its binary payload', async () => {
  const id = '0123456789abcdef01234567';
  const nameA = await createPersistentIrPcmCacheName(id, 48000, { trim: 2, directCut: true });
  const nameB = await createPersistentIrPcmCacheName(id, 48000, { directCut: true, trim: 2 });
  assert.equal(nameA, nameB);
  assert.match(nameA, /^[a-f0-9]{24}@48000-[a-f0-9]{64}\.f32$/);
  assert.ok(nameA.length <= 110);
  assert.equal(await createPersistentIrPcmCacheName(id, 48000), `${id}@48000.f32`);
  const bytes = encodePersistentIrPcm({ sampleRate: 48000, channelData: [new Float32Array([0.25, -0.5])] });
  const decoded = decodePersistentIrPcm(bytes);
  assert.equal(decoded.sampleRate, 48000);
  assert.deepEqual([...decoded.channelData[0]], [0.25, -0.5]);
  const corrupt = bytes.slice();
  corrupt[0] = 0;
  assert.throws(() => decodePersistentIrPcm(corrupt));
  const nonFinite = bytes.slice();
  new DataView(nonFinite.buffer).setUint32(24, 0x7fc00000, true);
  assert.throws(() => decodePersistentIrPcm(nonFinite));
});

test('persistent PCM cache restores accounting, persists recency, replaces, evicts, and clears', async () => {
  const backend = new MemoryBackend({ 'aaaaaaaaaaaaaaaaaaaaaaaa.wav': encode('original stays') });
  const id = '0123456789abcdef01234567';
  const pcm = value => ({ sampleRate: 48000, channelData: [new Float32Array([value, value])] });
  const cache = await new PersistentIrPcmCache(backend, { maxBytes: 64, clock: () => 1, onDiagnostic() {} }).open();
  assert.equal(await cache.set(id, 48000, { slot: 'a' }, pcm(1)), true);
  assert.equal(await cache.set(id, 48000, { slot: 'b' }, pcm(2)), true);
  assert.equal((await cache.get(id, 48000, { slot: 'a' })).channelData[0][0], 1);
  assert.equal(await cache.set(id, 48000, { slot: 'c' }, pcm(3)), true);
  assert.equal(await cache.get(id, 48000, { slot: 'b' }), null);
  assert.equal(cache.getStats().byteLength, 64);

  assert.equal(await cache.set(id, 48000, { slot: 'a' }, { sampleRate: 48000, channelData: [new Float32Array([4, 4, 4, 4])] }), true);
  assert.equal(cache.getStats().byteLength, 40);
  const reopened = await new PersistentIrPcmCache(backend, { maxBytes: 64, clock: () => 10, onDiagnostic() {} }).open();
  assert.deepEqual(reopened.getStats(), { byteLength: 40, entryCount: 1, maxBytes: 64 });
  await reopened.clear();
  assert.deepEqual(reopened.getStats(), { byteLength: 0, entryCount: 0, maxBytes: 64 });
  assert.equal(new TextDecoder().decode(backend.files.get('aaaaaaaaaaaaaaaaaaaaaaaa.wav')), 'original stays');
});

test('removing an IR invalidates every persistent PCM rate without rolling back original deletion on cache failure', async () => {
  const backend = new MemoryBackend();
  const diagnostics = [];
  const pcmCache = await new PersistentIrPcmCache(backend, {
    maxBytes: 1024,
    onDiagnostic: error => diagnostics.push(error)
  }).open();
  const store = await new IrLibraryStore(backend, {
    pcmCache,
    onDiagnostic: error => diagnostics.push(error)
  }).open();
  const saved = await store.importSingle({ bytes: encode('remove all rates'), fileName: 'remove.wav' });
  const otherId = 'fedcba9876543210fedcba98';
  const pcm = rate => ({ sampleRate: rate, channelData: [new Float32Array([0.25])] });
  assert.equal(await pcmCache.set(saved.entry.irId, 48000, {}, pcm(48000)), true);
  assert.equal(await pcmCache.set(saved.entry.irId, 96000, { kind: 'decoded' }, pcm(96000)), true);
  assert.equal(await pcmCache.set(otherId, 48000, {}, pcm(48000)), true);

  assert.equal(await store.remove(saved.entry.irId), true);
  assert.equal(backend.files.has(saved.entry.originals[0].storageName), false);
  assert.equal([...backend.cacheFiles.keys()].some(name => name.startsWith(`${saved.entry.irId}@`)), false);
  assert.equal([...backend.cacheFiles.keys()].some(name => name.startsWith(`${otherId}@`)), true);

  const failureBackend = new MemoryBackend();
  const failureDiagnostics = [];
  const failureStore = await new IrLibraryStore(failureBackend, {
    pcmCache: { async deleteAll() { throw new Error('cache diagnostic'); } },
    onDiagnostic: error => failureDiagnostics.push(error)
  }).open();
  const failureSaved = await failureStore.importSingle({ bytes: encode('delete despite cache'), fileName: 'failure.wav' });
  assert.equal(await failureStore.remove(failureSaved.entry.irId), true);
  assert.equal(failureBackend.files.has(failureSaved.entry.originals[0].storageName), false);
  assert.equal(failureStore.get(failureSaved.entry.irId), null);
  assert.equal(failureDiagnostics.length, 1);
});

test('persistent PCM corruption and index write failure reset only regenerable cache data', async () => {
  const backend = new MemoryBackend({ 'bbbbbbbbbbbbbbbbbbbbbbbb.wav': encode('valuable original') });
  const diagnostics = [];
  const id = 'fedcba9876543210fedcba98';
  const cache = await new PersistentIrPcmCache(backend, { maxBytes: 1024, onDiagnostic: error => diagnostics.push(error) }).open();
  const preparation = { trim: 1 };
  assert.equal(await cache.set(id, 44100, preparation, { sampleRate: 44100, channelData: [new Float32Array([1])] }), true);
  const name = await createPersistentIrPcmCacheName(id, 44100, preparation);
  backend.cacheFiles.set(name, new Uint8Array([1, 2, 3]));
  assert.equal(await cache.get(id, 44100, preparation), null);
  assert.equal(backend.cacheFiles.has(name), false);

  backend.failCacheName = 'index.json';
  assert.equal(await cache.set(id, 44100, {}, { sampleRate: 44100, channelData: [new Float32Array([2])] }), false);
  assert.equal(backend.files.has('bbbbbbbbbbbbbbbbbbbbbbbb.wav'), true);
  assert.ok(diagnostics.length >= 2);
});

test('persistent PCM startup discards a corrupt cache index without touching library originals', async () => {
  const backend = new MemoryBackend({ 'cccccccccccccccccccccccc.wav': encode('keep me') });
  backend.cacheFiles.set('index.json', encode('{bad'));
  backend.cacheFiles.set('0123456789abcdef01234567@48000.f32', new Uint8Array([1, 2, 3, 4]));
  const diagnostics = [];
  const cache = await new PersistentIrPcmCache(backend, { maxBytes: 1024, onDiagnostic: error => diagnostics.push(error) }).open();
  assert.deepEqual(cache.getStats(), { byteLength: 0, entryCount: 0, maxBytes: 1024 });
  assert.equal(backend.cacheFiles.has('0123456789abcdef01234567@48000.f32'), false);
  assert.equal(new TextDecoder().decode(backend.files.get('cccccccccccccccccccccccc.wav')), 'keep me');
  assert.equal(diagnostics.length, 1);

  assert.equal(await cache.set('0123456789abcdef01234567', 48000, {}, {
    sampleRate: 48000,
    channelData: [new Float32Array([1])]
  }), true);
});

test('persistent PCM startup resets an array-shaped entry index and remains usable after reopening', async () => {
  const backend = new MemoryBackend();
  const id = '0123456789abcdef01234567';
  const staleName = `${id}@48000.f32`;
  backend.cacheFiles.set('index.json', encode(JSON.stringify({ version: 1, entries: [] })));
  backend.cacheFiles.set(staleName, new Uint8Array([1, 2, 3, 4]));
  const diagnostics = [];
  const cache = await new PersistentIrPcmCache(backend, {
    maxBytes: 1024,
    onDiagnostic: error => diagnostics.push(error)
  }).open();
  const pcm = { sampleRate: 48000, channelData: [new Float32Array([0.25, -0.5])] };

  assert.deepEqual(cache.getStats(), { byteLength: 0, entryCount: 0, maxBytes: 1024 });
  assert.equal(await cache.set(id, 48000, {}, pcm), true);
  const persisted = JSON.parse(new TextDecoder().decode(backend.cacheFiles.get('index.json')));
  assert.equal(Array.isArray(persisted.entries), false);
  assert.equal(typeof persisted.entries, 'object');

  const reopened = await new PersistentIrPcmCache(backend, { maxBytes: 1024, onDiagnostic() {} }).open();
  const restored = await reopened.get(id, 48000, {});
  assert.equal(restored.sampleRate, 48000);
  assert.deepEqual([...restored.channelData[0]], [0.25, -0.5]);
  assert.equal(diagnostics.length, 1);
});

test('IR audio headers expose WAV, AIFF, and FLAC channel, rate, and frame metadata', () => {
  assert.deepEqual(parseIrAudioHeader(wavBytes({ channels: 2, sampleRate: 96000, frames: 7 })), {
    channels: 2,
    sampleRate: 96000,
    frames: 7
  });

  const aiff = new Uint8Array(38);
  aiff.set(new TextEncoder().encode('FORM'), 0);
  new DataView(aiff.buffer).setUint32(4, 30, false);
  aiff.set(new TextEncoder().encode('AIFFCOMM'), 8);
  const aiffView = new DataView(aiff.buffer);
  aiffView.setUint32(16, 18, false);
  aiffView.setUint16(20, 2, false);
  aiffView.setUint32(22, 11, false);
  aiffView.setUint16(26, 16, false);
  aiffView.setUint16(28, 0x400e, false);
  aiffView.setUint32(30, 0xac440000, false);
  assert.deepEqual(parseIrAudioHeader(aiff), { channels: 2, frames: 11, sampleRate: 44100 });

  const flac = new Uint8Array(42);
  flac.set(new TextEncoder().encode('fLaC'), 0);
  flac[4] = 0x80;
  flac[7] = 34;
  const packed = (48000n << 44n) | (3n << 41n) | 123n;
  for (let index = 0; index < 8; index += 1) {
    flac[18 + index] = Number((packed >> BigInt(56 - index * 8)) & 0xffn);
  }
  assert.deepEqual(parseIrAudioHeader(flac), { channels: 4, sampleRate: 48000, frames: 123 });
});

test('IR library batch pairing is deterministic and imports unmatched suffix candidates as singles', async () => {
  const backend = new MemoryBackend();
  const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  const service = new IrLibraryService(store, { onDiagnostic() {} });
  const file = (name, options = {}) => ({
    name,
    async arrayBuffer() { return wavBytes(options).buffer; }
  });
  const result = await service.importFiles([
    file('Room_R.wav', { channels: 2, marker: 4 }),
    file('Unmatched_L.wav', { channels: 1, marker: 5 }),
    file('notes.txt'),
    file('Room_L.wav', { channels: 2, marker: 3 }),
    file('Solo.wav', { channels: 1, marker: 6 })
  ]);

  assert.equal(result.unsupportedCount, 1);
  assert.equal(result.failedCount, 0);
  assert.deepEqual(result.imported.map(entry => [entry.fileLabel, entry.composition]), [
    ['Room_L.wav + Room_R.wav', 'pair'],
    ['Solo.wav', 'single'],
    ['Unmatched_L.wav', 'single']
  ]);
  assert.equal(result.imported[0].channels, 4);
  assert.equal(result.imported[0].sampleRate, 48000);

  const pairId = result.imported[0].irId;
  assert.deepEqual(await service.delete(pairId, { activeIds: new Set([pairId]) }), {
    removed: false,
    reason: 'in-use'
  });
  assert.deepEqual(service.list({ query: 'room_r' }).map(entry => entry.irId), [pairId]);
  assert.deepEqual(await service.delete(pairId), { removed: true, reason: null });
});

test('queued deletion rechecks current in-use state at the serialized mutation boundary', async () => {
  const backend = new MemoryBackend();
  const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  const service = new IrLibraryService(store, { onDiagnostic() {} });
  const saved = await store.importSingle({ bytes: wavBytes(), fileName: 'Queued.wav' });
  const updateStarted = deferred();
  const updateRelease = deferred();
  const writeAtomic = backend.writeAtomic.bind(backend);
  let delayIndexWrite = true;
  backend.writeAtomic = async (name, bytes) => {
    if (delayIndexWrite && name === IR_LIBRARY_INDEX_NAME) {
      delayIndexWrite = false;
      updateStarted.resolve();
      await updateRelease.promise;
    }
    return writeAtomic(name, bytes);
  };

  const updating = store.updateAnalysis(saved.entry.irId, {
    onsetFrame: 1,
    rt60: 0.5,
    peakDb: -1,
    envelope: new Float32Array([1]),
    edc: new Float32Array([0])
  });
  await withTimeout(updateStarted.promise, 'analysis update did not reach the index write');
  const activeIds = new Set();
  const deleting = service.delete(saved.entry.irId, { activeIds });
  activeIds.add(saved.entry.irId);
  updateRelease.resolve();

  await withTimeout(updating, 'analysis update did not settle');
  assert.deepEqual(await withTimeout(deleting, 'queued deletion did not settle'), {
    removed: false,
    reason: 'in-use'
  });
  assert.equal(store.get(saved.entry.irId)?.analysis.onsetFrame, 1);
});

test('direct true-stereo imports reject invalid channels and sample rates before persistence', async () => {
  const backend = new MemoryBackend();
  const diagnostics = [];
  const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  const service = new IrLibraryService(store, { onDiagnostic: error => diagnostics.push(error) });
  const file = (name, options) => ({
    name,
    async arrayBuffer() { return wavBytes(options).buffer; }
  });

  await assert.rejects(service.importFiles([
    file('Channel_L.wav', { channels: 1, sampleRate: 48000 }),
    file('Channel_R.wav', { channels: 2, sampleRate: 48000 })
  ], { strictPair: true }), /exactly two audio channels/);
  assert.deepEqual(store.list(), []);

  await assert.rejects(service.importFiles([
    file('Rate_L.wav', { channels: 2, sampleRate: 48000 }),
    file('Rate_R.wav', { channels: 2, sampleRate: 96000 })
  ], { strictPair: true }), /same sample rate/);
  assert.deepEqual(store.list(), []);
  assert.equal(diagnostics.length, 0);

  const batch = await service.importFiles([
    file('Batch_L.wav', { channels: 1, sampleRate: 48000 }),
    file('Batch_R.wav', { channels: 2, sampleRate: 48000 })
  ]);
  assert.equal(batch.failedCount, 1);
  assert.deepEqual(batch.imported, []);
  assert.deepEqual(store.list(), []);
  assert.equal(diagnostics.length, 1);
});

test('IR folder enumeration is recursive and returns only supported audio files', async () => {
  const fileHandle = file => ({ kind: 'file', async getFile() { return file; } });
  const nested = {
    kind: 'directory',
    async *entries() {
      yield ['deep.wav', fileHandle({ name: 'deep.wav' })];
      yield ['readme.txt', fileHandle({ name: 'readme.txt' })];
    }
  };
  const root = {
    async *entries() {
      yield ['top.flac', fileHandle({ name: 'top.flac' })];
      yield ['nested', nested];
    }
  };
  assert.deepEqual((await enumerateIrDirectory(root)).map(file => file.name), ['top.flac', 'deep.wav']);
});

test('folder import pairs suffix candidates only within the same relative directory', async () => {
  const backend = new MemoryBackend();
  const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  const service = new IrLibraryService(store, { onDiagnostic() {} });
  const file = (name, marker) => ({
    name,
    async arrayBuffer() { return wavBytes({ channels: 2, marker }).buffer; }
  });
  const fileHandle = value => ({ kind: 'file', async getFile() { return value; } });
  const directory = value => ({
    kind: 'directory',
    async *entries() { yield [value.name, fileHandle(value)]; }
  });
  const root = {
    async *entries() {
      yield ['a', directory(file('Room_L.wav', 1))];
      yield ['b', directory(file('Room_R.wav', 2))];
    }
  };

  const result = await service.importDirectory(root);
  assert.equal(result.failedCount, 0);
  assert.deepEqual(result.imported.map(entry => [entry.fileLabel, entry.composition]), [
    ['Room_L.wav', 'single'],
    ['Room_R.wav', 'single']
  ]);
});

test('decoded PCM limits reject declared and decoder-produced oversized resources before downstream work', async () => {
  const backend = new MemoryBackend();
  const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  let cacheSets = 0;
  store.pcmCache = {
    async get() { return null; },
    async set() { cacheSets += 1; return true; },
    async deleteAll() { return true; }
  };
  const service = new IrLibraryService(store, { onDiagnostic() {} });
  const declaredHuge = wavBytes({ frames: 1 });
  new DataView(declaredHuge.buffer).setUint32(40, 16_777_217 * 2, true);
  const declared = await store.importSingle({ bytes: declaredHuge, fileName: 'Declared.wav' });
  let decodeCalls = 0;
  let resampleCalls = 0;
  await assert.rejects(service.resolveDecodedPcm(declared.entry.irId, 48000, {
    async decode() {
      decodeCalls += 1;
      return { channels: [new Float32Array([1])], sampleRate: 48000 };
    },
    async resample(pcm) { resampleCalls += 1; return pcm; }
  }), /too large/);
  assert.equal(decodeCalls, 0);

  const unknown = await store.importSingle({ bytes: encode('unknown codec'), fileName: 'Unknown.mp3' });
  const fakeHugeChannel = new Proxy(new Float32Array(1), {
    get(target, property) {
      return property === 'length' ? 16_777_217 : Reflect.get(target, property, target);
    }
  });
  await assert.rejects(service.resolveDecodedPcm(unknown.entry.irId, 48000, {
    async decode() {
      decodeCalls += 1;
      return { channels: [fakeHugeChannel], sampleRate: 48000 };
    },
    async resample(pcm) { resampleCalls += 1; return pcm; }
  }), /too large/);
  assert.equal(decodeCalls, 1);
  assert.equal(resampleCalls, 0);
  assert.equal(cacheSets, 0);
});

test('decoded IR cache hits are rate-specific and rate changes decode the original again', async () => {
  const backend = new MemoryBackend();
  const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  const cache = new Map();
  const cacheCalls = [];
  store.pcmCache = {
    async get(id, rate, preparation) {
      cacheCalls.push(['get', rate, preparation]);
      return cache.get(`${id}:${rate}:${JSON.stringify(preparation)}`) || null;
    },
    async set(id, rate, preparation, value) {
      cacheCalls.push(['set', rate, preparation]);
      cache.set(`${id}:${rate}:${JSON.stringify(preparation)}`, value);
      return true;
    }
  };
  const service = new IrLibraryService(store, { onDiagnostic() {} });
  const imported = await service.importFiles([{
    name: 'Cache.wav',
    async arrayBuffer() { return wavBytes({ marker: 9 }).buffer; }
  }]);
  const id = imported.imported[0].irId;
  let decodeCalls = 0;
  const resampleRates = [];
  const adapters = {
    async decode() {
      decodeCalls += 1;
      return { channels: [new Float32Array([1, 0])], sampleRate: 48000 };
    },
    async resample(pcm, rate) {
      resampleRates.push(rate);
      return { channels: pcm.channels, sampleRate: rate };
    }
  };

  assert.equal((await service.resolveDecodedPcm(id, 48000, adapters)).sampleRate, 48000);
  assert.equal((await service.resolveDecodedPcm(id, 48000, adapters)).sampleRate, 48000);
  assert.equal((await service.resolveDecodedPcm(id, 24000, adapters)).sampleRate, 24000);
  assert.equal(decodeCalls, 2);
  assert.deepEqual(resampleRates, [48000, 24000]);
  assert.equal(cacheCalls.filter(call => call[0] === 'set').length, 2);
  assert.ok(cacheCalls.every(call => call[2].kind === 'decoded' && call[2].version === 1));
});

test('stale decoded IR work is discarded at decode and cache-write boundaries before plugin staging', async () => {
  const entry = {
    irId: 'eeeeeeeeeeeeeeeeeeeeeeee',
    composition: 'pair',
    originals: [
      { role: 'L', storageName: 'left.wav', fileName: 'Pair_L.wav' },
      { role: 'R', storageName: 'right.wav', fileName: 'Pair_R.wav' }
    ]
  };
  let current = true;
  let reads = 0;
  let cacheSets = 0;
  let cacheDeletes = 0;
  const store = {
    get() { return entry; },
    getOriginalRevision() { return 1; },
    async readOriginal() { reads += 1; return new Uint8Array([reads]); },
    pcmCache: {
      async get() { return null; },
      async set() { cacheSets += 1; return true; },
      async deleteAll() { cacheDeletes += 1; return true; }
    }
  };
  const service = new IrLibraryService(store, { onDiagnostic() {} });
  const adapters = {
    isCurrent: () => current,
    async decode() {
      current = false;
      return { channels: [new Float32Array([1]), new Float32Array([0])], sampleRate: 48000 };
    },
    async resample(pcm) { return pcm; }
  };
  assert.equal(await withTimeout(
    service.resolveDecodedPcm(entry.irId, 48000, adapters),
    'stale decode did not settle'
  ), null);
  assert.equal(reads, 1);
  assert.equal(cacheSets, 0);
  assert.equal(cacheDeletes, 1);

  current = true;
  reads = 0;
  const cacheStarted = deferred();
  const cacheRelease = deferred();
  store.pcmCache.set = async () => {
    cacheSets += 1;
    cacheStarted.resolve();
    await cacheRelease.promise;
    return true;
  };
  adapters.decode = async bytes => ({
    channels: [new Float32Array([bytes[0]]), new Float32Array([0])],
    sampleRate: 48000
  });
  const resolving = service.resolveDecodedPcm(entry.irId, 48000, adapters);
  await withTimeout(cacheStarted.promise, 'cache write did not start');
  current = false;
  cacheRelease.resolve();
  assert.equal(await withTimeout(resolving, 'stale cache write did not settle'), null);
  assert.equal(reads, 2);
  assert.equal(cacheSets, 1);
  assert.equal(cacheDeletes, 2);
});

test('analysis updates do not discard an in-flight decoded IR', async () => {
  const backend = new MemoryBackend();
  const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  const saved = await store.importSingle({ bytes: wavBytes({ marker: 31 }), fileName: 'Concurrent.wav' });
  const decodeStarted = deferred();
  const decodeRelease = deferred();
  let cacheSets = 0;
  let cacheDeletes = 0;
  store.pcmCache = {
    async get() { return null; },
    async set() {
      cacheSets += 1;
      return true;
    },
    async deleteAll() {
      cacheDeletes += 1;
      return true;
    }
  };
  const service = new IrLibraryService(store, { onDiagnostic() {} });
  const resolving = service.resolveDecodedPcm(saved.entry.irId, 48000, {
    async decode() {
      decodeStarted.resolve();
      await decodeRelease.promise;
      return { channels: [new Float32Array([1, 0])], sampleRate: 48000 };
    },
    async resample(pcm) { return pcm; }
  });
  await withTimeout(decodeStarted.promise, 'decode did not start');
  await store.updateAnalysis(saved.entry.irId, {
    onsetFrame: 1,
    rt60: 0.7,
    peakDb: -1,
    envelope: new Float32Array([1, 0.25]),
    edc: new Float32Array([0, -12])
  });
  decodeRelease.resolve();

  const resolved = await withTimeout(resolving, 'concurrent analysis decode did not settle');
  assert.deepEqual([...resolved.channels[0]], [1, 0]);
  assert.equal(cacheSets, 1);
  assert.equal(cacheDeletes, 0);
});

test('deleting an IR during decode-cache commit leaves no stale cache entry', async () => {
  const backend = new MemoryBackend();
  const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  const saved = await store.importSingle({ bytes: wavBytes(), fileName: 'Race.wav' });
  const cache = new Map();
  const cacheStarted = deferred();
  const cacheRelease = deferred();
  let cacheDeletes = 0;
  store.pcmCache = {
    async get() { return null; },
    async set(id, rate, preparation, value) {
      cacheStarted.resolve();
      await cacheRelease.promise;
      cache.set(`${id}:${rate}:${JSON.stringify(preparation)}`, value);
      return true;
    },
    async deleteAll(id) {
      cacheDeletes += 1;
      for (const key of cache.keys()) {
        if (key.startsWith(`${id}:`)) cache.delete(key);
      }
      return true;
    }
  };
  const service = new IrLibraryService(store, { onDiagnostic() {} });
  const resolving = service.resolveDecodedPcm(saved.entry.irId, 48000, {
    async decode() { return { channels: [new Float32Array([1, 0])], sampleRate: 48000 }; },
    async resample(pcm) { return pcm; }
  });
  await withTimeout(cacheStarted.promise, 'cache write did not start');
  assert.equal(await store.remove(saved.entry.irId), true);
  cacheRelease.resolve();

  assert.equal(await withTimeout(resolving, 'deleted IR decode did not settle'), null);
  assert.equal(store.get(saved.entry.irId), null);
  assert.equal(cache.size, 0);
  assert.equal(cacheDeletes, 2);
});

test('removing and re-importing an IR rejects the previous in-flight decode', async () => {
  const backend = new MemoryBackend();
  const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
  const bytes = wavBytes({ marker: 37 });
  const saved = await store.importSingle({ bytes, fileName: 'Replaced.wav' });
  const originalRevision = store.getOriginalRevision(saved.entry.irId);
  const cache = new Map();
  const cacheStarted = deferred();
  const cacheRelease = deferred();
  let cacheDeletes = 0;
  store.pcmCache = {
    async get() { return null; },
    async set(id, rate, preparation, value) {
      cacheStarted.resolve();
      await cacheRelease.promise;
      cache.set(`${id}:${rate}:${JSON.stringify(preparation)}`, value);
      return true;
    },
    async deleteAll(id) {
      cacheDeletes += 1;
      for (const key of cache.keys()) {
        if (key.startsWith(`${id}:`)) cache.delete(key);
      }
      return true;
    }
  };
  const service = new IrLibraryService(store, { onDiagnostic() {} });
  const resolving = service.resolveDecodedPcm(saved.entry.irId, 48000, {
    async decode() { return { channels: [new Float32Array([1, 0])], sampleRate: 48000 }; },
    async resample(pcm) { return pcm; }
  });
  await withTimeout(cacheStarted.promise, 'cache write did not start');
  assert.equal(await store.remove(saved.entry.irId), true);
  const restored = await store.importSingle({ bytes, fileName: 'Replaced.wav' });
  assert.equal(restored.entry.irId, saved.entry.irId);
  assert.ok(store.getOriginalRevision(saved.entry.irId) > originalRevision);
  cacheRelease.resolve();

  assert.equal(await withTimeout(resolving, 'replaced IR decode did not settle'), null);
  assert.notEqual(store.get(saved.entry.irId), null);
  assert.equal(cache.size, 0);
  assert.equal(cacheDeletes, 2);
});

test('web and Electron library entries round-trip through preset state using only ir', async () => {
  const electronFiles = new Map();
  const bridge = {
    apiVersion: 1,
    async read({ name }) { return { ok: true, data: electronFiles.get(name)?.slice() || null }; },
    async exists({ name }) { return { ok: true, data: electronFiles.has(name) }; },
    async writeAtomic({ name, bytes }) {
      electronFiles.set(name, new Uint8Array(bytes).slice());
      return { ok: true, data: true };
    },
    async remove({ name }) { electronFiles.delete(name); return { ok: true, data: true }; },
    async list() { return { ok: true, data: [...electronFiles.keys()] }; },
    async cleanupTemporary() { return { ok: true, data: true }; }
  };
  const backends = [new MemoryBackend(), new ElectronIrLibraryBackend(bridge)];
  for (const backend of backends) {
    const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
    const service = new IrLibraryService(store, { onDiagnostic() {} });
    const result = await service.importFiles([{
      name: 'Preset Hall.wav',
      async arrayBuffer() { return wavBytes({ marker: 12 }).buffer; }
    }]);
    const entry = result.imported[0];
    const presetState = JSON.parse(JSON.stringify({ ir: entry.irId }));
    assert.deepEqual(Object.keys(presetState), ['ir']);

    const reopened = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
    assert.equal(reopened.get(presetState.ir).originals[0].fileName, 'Preset Hall.wav');
    assert.equal((await reopened.readOriginal(presetState.ir)).byteLength, wavBytes().byteLength);
    for (const forbidden of ['bytes', 'analysis', 'originals', 'name', 'tags', 'source', 'sourceUrl', 'irn', 'fileLabel', 'pathSummary']) {
      assert.equal(Object.hasOwn(presetState, forbidden), false);
    }
  }
});
