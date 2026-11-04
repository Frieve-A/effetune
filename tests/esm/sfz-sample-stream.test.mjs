import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { SfzSampleStream, SFZ_SAMPLE_MAX_READ_BYTES } from '../../js/sfz/sample-stream.js';
import { SfzSampleStreamWorker } from '../../js/sfz/sample-stream-worker.js';
import { SfzSamplePageProvider, createSfzSampleProviderFactory } from '../../js/sfz/sample-page-provider.js';
import { PersistentIrPcmCache } from '../../js/ir-library/ir-pcm-cache.js';
import { prepareStreamedSfzBank } from '../../js/sfz/streamed-bank.js';
import { parseSfz } from '../../js/sfz/parser.js';
import { SFZ_EXTRA_DEFAULTS } from '../../js/sfz/schema.js';
import { sfzSampleCacheFootprint, packSfzAsset } from '../../js/sfz/asset.js';
import { sfzStorageVariants, sfzResidentRanges, sfzStorageSlots } from '../../js/sfz/storage-plan.js';
import { createSf2SampleReader } from '../../js/sf2/sample-reader.js';


function queriedCacheBytes(payload) {
  const words = new Uint32Array(payload, 32);
  if (words[1] !== 10) return 0;
  let channels = 1;
  for (let i = 0; i < words[13]; ++i) channels = Math.max(channels, words[words[12] + i * 16 + 2]);
  return sfzSampleCacheFootprint(words[13], words[14], channels, { slots16: words[16] });
}

const crc = (bytes, width, polynomial) => {
  let register = 0;
  for (const byte of bytes) for (let bit = 7; bit >= 0; bit--) {
    const outgoing = register >>> (width - 1);
    register = (register * 2 + ((byte >>> bit) & 1)) & (2 ** width - 1);
    if (outgoing) register ^= polynomial;
  }
  for (let i = 0; i < width; i++) {
    const outgoing = register >>> (width - 1);
    register = (register * 2) & (2 ** width - 1);
    if (outgoing) register ^= polynomial;
  }
  return register;
};

class BitWriter {
  constructor() { this.bits = []; }
  write(value, width) {
    if (value < 0) value += 2 ** width;
    for (let bit = width - 1; bit >= 0; bit--) this.bits.push(Math.floor(value / 2 ** bit) % 2);
  }
  bytes() {
    const result = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, index) => { result[index >>> 3] |= bit << (7 - index % 8); });
    return result;
  }
}

function flac({ depth = 24, assignment = 1, blocks = [4096, 4096, 4096, 17], prediction = false, overflow = false } = {}) {
  const frames = blocks.reduce((sum, count) => sum + count, 0), channels = 2;
  const expected = new Float32Array(frames * channels), chunks = [];
  let first = 0, maximum = 0;
  blocks.forEach((count, number) => {
    const header = Uint8Array.from([255, 248, 0x79, assignment * 16 + (depth === 32 ? 14 : 12), number, (count - 1) >>> 8, (count - 1) & 255]);
    const writer = new BitWriter();
    for (const byte of header) writer.write(byte, 8);
    writer.write(crc(header, 8, 7), 8);
    const left = [], right = [];
    for (let i = 0; i < count; i++) {
      const l = overflow ? [8388607, 8388608, 8388606, -8388609, -8388608][i % 5] : prediction ? i * 3 - 600 : depth === 32 ? [2147483647, -2147483648, 1, -1, 123456789][(first + i) % 5] : (first + i) * 19 - 200000;
      const r = overflow ? -l : prediction ? i * -2 + 900 : depth === 32 ? [-2147483648, 2147483647, -2, 2, -987654321][(first + i) % 5] : 150000 - (first + i) * 7;
      expected[(first + i) * 2] = l * 2 ** (1 - depth); expected[(first + i) * 2 + 1] = r * 2 ** (1 - depth);
      if (overflow) {
        expected[(first + i) * 2] = ((l << 8) >> 8) / 8388608;
        expected[(first + i) * 2 + 1] = ((r << 8) >> 8) / 8388608;
      }
      left.push(assignment === 10 ? Math.floor((l + r) / 2) : assignment === 9 ? l - r : l);
      right.push(assignment === 8 || assignment === 10 ? l - r : r);
    }
    [left, right].forEach((values, channel) => {
      const side = assignment === 9 ? channel === 0 : (assignment === 8 || assignment === 10) && channel === 1;
      const bits = depth + (side ? 1 : 0);
      writer.write(0, 1); writer.write(overflow ? 9 : prediction ? 33 : 1, 6); writer.write(0, 1);
      if (overflow) {
        writer.write(values[0], bits);
        writer.write(0, 2); writer.write(0, 4); writer.write(15, 4); writer.write(25, 5);
        for (let i = 1; i < values.length; i++) writer.write(values[i] - values[i - 1], 25);
      } else if (prediction) {
        writer.write(values[0], bits); writer.write(values[1], bits);
        writer.write(2, 4); writer.write(0, 5); writer.write(2, 3); writer.write(-1, 3);
        writer.write(0, 2); writer.write(0, 4); writer.write(0, 4);
        for (let i = 2; i < count; i++) writer.write(1, 1);
      } else for (const value of values) writer.write(value, bits);
    });
    const body = writer.bytes(), checksum = crc(body, 16, 0x8005);
    const frame = new Uint8Array(body.length + 2); frame.set(body); frame.set([checksum >>> 8, checksum & 255], body.length);
    maximum = Math.max(maximum, frame.length); chunks.push(frame); first += count;
  });
  const bytes = new Uint8Array(42 + chunks.reduce((sum, chunk) => sum + chunk.length, 0)), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('fLaC')); bytes.set([128, 0, 0, 34], 4);
  view.setUint16(8, 4096); view.setUint16(10, 4096);
  bytes[15] = maximum >>> 16; bytes[16] = maximum >>> 8 & 255; bytes[17] = maximum & 255;
  view.setBigUint64(18, BigInt(44100) << 44n | 1n << 41n | BigInt(depth - 1) << 36n | BigInt(frames));
  let offset = 42;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { bytes, expected, frames };
}

function reader(bytes) {
  const reads = [];
  return { size: bytes.length, revision: 'fixture', reads,
    async readRange(offset, length) { reads.push({ offset, length }); return bytes.slice(offset, offset + length); } };
}

test('SoundFont smpl/sm24 sample views preserve signed24bit PCM and source offsets above4GiB through the worker', async () => {
  const smplOffset = 2 ** 32 + 17, frames = 4102, lowOffset = smplOffset + frames * 2 + 18;
  const high = new Uint8Array(frames * 2), low = new Uint8Array(frames), expected = new Float32Array(frames);
  const view = new DataView(high.buffer);
  for (let index = 0; index < frames; index++) {
    const value = [-32768, 32767, -1, 0, 1][index % 5];
    view.setInt16(index * 2, value, true); low[index] = [0, 255, 128, 255, 0][index % 5];
    expected[index] = (value * 256 + low[index]) / 8388608;
  }
  const ranges = [], source = { size: lowOffset + frames, revision: 'sf2-source', async readRange(offset, length) {
    ranges.push({ offset, length }); assert.ok(length <= 1024 * 1024);
    if (offset >= lowOffset) return low.slice(offset - lowOffset, offset - lowOffset + length);
    return high.slice(offset - smplOffset, offset - smplOffset + length);
  } };
  const sample = createSf2SampleReader(source, { start: 3, frames: frames - 3, sampleRate: 48000,
    smplOffset, sm24Offset: lowOffset });
  const worker = new SfzSampleStreamWorker({ workerFactory });
  try {
    const metadata = await worker.open(0, sample); assert.equal(metadata.frames, 4099); assert.equal(metadata.channels, 1);
    assert.deepEqual((await worker.readPage(0, 1)).pcm, expected.subarray(4099));
    assert.deepEqual((await worker.readPage(0, 0)).pcm, expected.subarray(3, 4099));
    assert.ok(ranges.every(range => range.offset > 2 ** 32));
    const sixteen = createSf2SampleReader(source, { start: 0, frames, sampleRate: 48000, smplOffset });
    const stream = await SfzSampleStream.open(sixteen.readRange, sixteen.size, sixteen.pcm);
    assert.deepEqual([...await stream.readFrames(0, 5)], [-1, 32767 / 32768, -1 / 32768, 0, 1 / 32768]);
  } finally { worker.close(); }
});

test('independent FLAC pages preserve signed 32-bit mid-side extremes and final nominal frame position', async () => {
  for (const assignment of [1, 8, 9, 10]) {
    const fixture = flac({ depth: 32, assignment }), source = reader(fixture.bytes);
    const stream = await SfzSampleStream.open(source.readRange, source.size);
    assert.equal(stream.metadata.frames, fixture.frames);
    assert.equal(stream.metadata.seekPoints.length, 0);
    for (const page of [3, 1, 0, 2, 3]) {
      const result = await stream.readPage(page);
      assert.deepEqual(result.pcm, fixture.expected.subarray(page * 4096 * 2, (page * 4096 + result.frames) * 2));
    }
    assert.ok(source.reads.every(read => read.length <= SFZ_SAMPLE_MAX_READ_BYTES));
  }
});

test('contiguous tail requests batch bounded SF2 reads and publish independent exact final pages', async () => {
  const frames = 17 * 4096 + 19, highOffset = 16, lowOffset = highOffset + frames * 2;
  const bytes = new Uint8Array(lowOffset + frames), view = new DataView(bytes.buffer), expected = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    const high = frame % 65536 - 32768, low = frame % 256;
    view.setInt16(highOffset + frame * 2, high, true); bytes[lowOffset + frame] = low;
    expected[frame] = (high * 256 + low) / 8388608;
  }
  const source = reader(bytes), sample = createSf2SampleReader(source, { start: 0, frames, sampleRate: 44100,
    smplOffset: highOffset, sm24Offset: lowOffset });
  const publications = [], provider = new SfzSamplePageProvider({ assetId: 'c'.repeat(24), generation: 3,
    createReader: () => sample, worker: new SfzSampleStreamWorker({ workerFactory }),
    async publish(page) {
      assert.equal(page.pcm.byteLength, page.pcm.buffer.byteLength);
      publications.push(page);
      await Promise.resolve();
    } });
  try {
    await provider.prepare(['sample']);
    await provider.requestPages(Array.from({ length: 18 }, (_, pageIndex) => ({ generation: 3, sample: 0, pageIndex })));
    assert.equal(source.reads.length, 4);
    assert.deepEqual(source.reads.map(range => range.length), [131072, 65536, 8230, 4115]);
    assert.equal(publications.length, 18);
    for (const page of publications) assert.deepEqual(page.pcm,
      expected.subarray(page.firstFrame, page.firstFrame + page.frames));
    assert.equal(publications.at(-1).frames, 19);
  } finally { provider.close(); }
});

test('independent FLAC LPC and Rice reconstruction crosses compressed frames exactly', async () => {
  const fixture = flac({ prediction: true }), source = reader(fixture.bytes);
  const stream = await SfzSampleStream.open(source.readRange, source.size);
  assert.deepEqual(await stream.readFrames(4000, 4300), fixture.expected.subarray(8000, 16600));
  const corrupt = fixture.bytes.slice(); corrupt[100] ^= 32;
  const bad = await SfzSampleStream.open(reader(corrupt).readRange, corrupt.length);
  await assert.rejects(bad.readPage(0), { code: 'sample-format' });
  await assert.rejects(stream.readPage(-1), { code: 'sample-range' });
  await assert.rejects(stream.readFrames(fixture.frames - 1, 2), { code: 'sample-range' });
});

test('FLAC signed PCM store preserves legacy endpoint encodings without narrowing predictor history', async () => {
  const fixture = flac({ overflow: true }), source = reader(fixture.bytes);
  const stream = await SfzSampleStream.open(source.readRange, source.size);
  assert.deepEqual((await stream.readPage(0)).pcm, fixture.expected.subarray(0, 8192));
});

function wave() {
  const bytes = new Uint8Array(44 + 8193 * 6), view = new DataView(bytes.buffer), expected = new Float32Array(8193 * 2);
  bytes.set(new TextEncoder().encode('RIFF')); bytes.set(new TextEncoder().encode('WAVEfmt '), 8);
  view.setUint32(4, bytes.length - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, 48000, true); view.setUint16(32, 6, true); view.setUint16(34, 24, true);
  bytes.set(new TextEncoder().encode('data'), 36); view.setUint32(40, bytes.length - 44, true);
  for (let i = 0; i < expected.length; i++) {
    const value = i * 5 - 32768, at = 44 + i * 3;
    bytes[at] = value & 255; bytes[at + 1] = value >>> 8 & 255; bytes[at + 2] = value >>> 16 & 255;
    expected[i] = value / 8388608;
  }
  return { bytes, expected };
}

test('PCM sample pages read only the requested data span including the final partial page', async () => {
  const fixture = wave(), source = reader(fixture.bytes), stream = await SfzSampleStream.open(source.readRange, source.size);
  source.reads.length = 0;
  const tail = await stream.readPage(2);
  assert.equal(tail.frames, 1); assert.deepEqual(tail.pcm, fixture.expected.subarray(16384));
  assert.deepEqual(source.reads, [{ offset: 44 + 8192 * 6, length: 6 }]);
});

test('AIFF pages honor big-endian 24-bit PCM and the extended sample-rate header', async () => {
  const fixture = wave(), bytes = new Uint8Array(fixture.bytes.length + 10), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('FORM')); view.setUint32(4, bytes.length - 8);
  bytes.set(new TextEncoder().encode('AIFFCOMM'), 8); view.setUint32(16, 18);
  view.setUint16(20, 2); view.setUint32(22, 8193); view.setUint16(26, 24);
  view.setUint16(28, 16383 + 15); view.setBigUint64(30, 44100n << 48n);
  bytes.set(new TextEncoder().encode('SSND'), 38); view.setUint32(42, bytes.length - 46);
  for (let source = 44, destination = 54; source < fixture.bytes.length; source += 3, destination += 3) {
    bytes[destination] = fixture.bytes[source + 2]; bytes[destination + 1] = fixture.bytes[source + 1]; bytes[destination + 2] = fixture.bytes[source];
  }
  const source = reader(bytes), stream = await SfzSampleStream.open(source.readRange, source.size);
  assert.equal(stream.metadata.sampleRate, 44100);
  assert.deepEqual(await stream.readFrames(4090, 12), fixture.expected.subarray(8180, 8204));
});

function workerFactory() {
  const entry = new URL('../../js/sfz/sample-stream-worker.js', import.meta.url).href;
  const worker = new Worker(`const {parentPort}=require('node:worker_threads'); import(${JSON.stringify(entry)}).then(({attachSfzSampleStreamWorker})=>{const endpoint={postMessage:(...args)=>parentPort.postMessage(...args)};attachSfzSampleStreamWorker(endpoint);parentPort.on('message',data=>endpoint.onmessage({data}));});`, { eval: true });
  const adapter = { postMessage: (...args) => worker.postMessage(...args), terminate: () => worker.terminate() };
  worker.on('message', data => adapter.onmessage?.({ data })); worker.on('error', error => adapter.onerror?.(error));
  return adapter;
}

test('known raw SoundFont metadata stays worker-free until a selected page is read across a large source extent', async () => {
  const reads = [], paths = Array.from({ length: 16 }, (_, i) => `sample:${i}`);
  let workers = 0, opens = 0;
  const source = { size: 512 * 2 ** 30, revision: 'bounded-virtual-raw', async readRange(offset, length) {
    reads.push({ offset, length });
    const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
    for (let i = 0; i < length; i += 2) view.setInt16(i, 8192, true);
    return bytes;
  } };
  const factory = await createSfzSampleProviderFactory({ assetId: 'd'.repeat(24), paths,
    createReader: path => createSf2SampleReader(source, { start: Number(path.split(':')[1]) * 16384,
      frames: 12288, sampleRate: 48000, smplOffset: 128 * 2 ** 30 }),
    workerFactory() {
      workers++;
      const worker = workerFactory(), send = worker.postMessage;
      worker.postMessage = (...args) => { if (args[0].type === 'open') opens++; return send(...args); };
      return worker;
    } });
  const pages = [], first = await factory({ generation: 1, publish: page => pages.push(page) });
  const second = await factory({ generation: 2, publish: page => pages.push(page) });
  try {
    assert.equal(workers, 0); assert.equal(opens, 0); assert.equal(reads.length, 0);
    await first.requestPages([{ generation: 1, sample: 15, pageIndex: 1 }]);
    await second.requestPages([{ generation: 2, sample: 15, pageIndex: 1 }]);
    assert.equal(workers, 2); assert.equal(opens, 2, 'Each generation opens only its selected sample');
    assert.equal(reads.length, 2);
    assert.ok(reads.every(read => read.offset > 2 ** 32 && read.length === 8192));
    assert.ok(pages.every(page => page.pcm.length === 4096 && page.pcm.every(value => value === .25)));
  } finally { first.close(); second.close(); }
});

test('actual Worker protocol decodes off-thread and cancellation rejects pending work', async () => {
  const fixture = flac({ prediction: true }), source = reader(fixture.bytes), worker = new SfzSampleStreamWorker({ workerFactory });
  try {
    const metadata = await worker.open(0, source);
    assert.equal(metadata.revision, 'fixture'); assert.equal(metadata.frames, fixture.frames);
    assert.deepEqual((await worker.readPage(0, 1)).pcm, fixture.expected.subarray(8192, 16384));
    const pending = worker.readPage(0, 2); worker.close();
    await assert.rejects(pending, { code: 'sample-cancelled' });
  } finally { worker.close(); }
});

test('page provider deduplicates concurrent demands, pins prebuffer and resumes from existing persistent PCM cache', async () => {
  const fixture = flac({ prediction: true }), source = reader(fixture.bytes), stored = new Map(), publications = [], progress = [];
  const cache = await new PersistentIrPcmCache({
    async readCache(name) { return stored.get(name)?.slice() || null; },
    async writeCacheAtomic(name, bytes) { stored.set(name, bytes.slice()); },
    async removeCache(name) { stored.delete(name); },
    async listCache() { return [...stored].map(([name, bytes]) => ({ name, byteLength: bytes.length })); }
  }, { indexWriteInterval: 128 }).open();
  const create = () => new SfzSamplePageProvider({ assetId: 'a'.repeat(24), generation: 7,
    createReader: () => source, worker: new SfzSampleStreamWorker({ workerFactory }), persistentCache: cache,
    publish: page => { publications.push(page); }, onProgress: value => progress.push(value) });
  let provider = create();
  try {
    const metadata = await provider.prepare(['sample.flac']);
    assert.equal(metadata[0].frames, fixture.frames); assert.match(metadata[0].revision, /^[a-f0-9]{64}$/);
    await provider.preload([{ sample: 0, pageIndex: 0 }]);
    assert.ok(stored.has('index.json'), 'preload flushes its partial checkpoint');
    await provider.preload([{ sample: 0, pageIndex: 0 }]);
    assert.equal(publications.length, 1); assert.equal(publications[0].resident, true);
    assert.deepEqual(publications[0].pcm, fixture.expected.subarray(0, 8192));
    const request = { generation: 7, sample: 0, pageIndex: 2 };
    await Promise.all([provider.requestPages([request, request]), provider.requestPages([request])]);
    assert.equal(publications.length, 2);
    assert.deepEqual(publications[1].pcm, fixture.expected.subarray(16384, 24576));
    await assert.rejects(provider.requestPages([{ ...request, generation: 6 }]), { code: 'sample-generation' });
    await assert.rejects(provider.requestPages([{ ...request, sample: '__proto__' }]), { code: 'sample-range' });
    assert.equal(cache.getStats().entryCount, 1);
    provider.close(); provider = create();
    await provider.prepare(['sample.flac']); source.reads.length = 0;
    await provider.preload([{ sample: 0, pageIndex: 0 }]);
    assert.equal(source.reads.length, 0);
    assert.deepEqual(publications.at(-1).pcm, fixture.expected.subarray(0, 8192));
    assert.ok(progress.some(item => item.phase === 'prebuffer' && item.completedCount === 1));
  } finally { provider.close(); }
});

test('page provider cannot publish stale decoded pages after cancellation', async () => {
  let complete, published = false;
  const worker = { async open() { return { frames: 8192, channels: 1, sampleRate: 44100 }; },
    readPage() { return new Promise(resolve => { complete = resolve; }); }, close() {} };
  const provider = new SfzSamplePageProvider({ assetId: 'b'.repeat(24), generation: 8, worker,
    createReader: () => ({ revision: 'source' }), publish() { published = true; } });
  await provider.prepare(['sample.wav']);
  const pending = provider.requestPages([{ generation: 8, sample: 0, pageIndex: 0 }]);
  provider.close(); complete({ pcm: new Float32Array(4096), channels: 1, frames: 4096 });
  await assert.rejects(pending, { code: 'sample-cancelled' });
  assert.equal(published, false);
});

test('preload checkpoints after cancellation and keeps the source error when the checkpoint also fails', async t => {
  t.mock.method(console, 'warn', () => {});
  for (const cancel of [false, true]) {
    let failRead, readStarted, flushes = 0;
    const started = new Promise(resolve => { readStarted = resolve; });
    const sourceError = Object.assign(new Error('source revision changed'), { code: 'source-revision' });
    const provider = new SfzSamplePageProvider({ assetId: 'b'.repeat(24), generation: 8,
      createReader: () => ({ revision: 'source' }), publish() { assert.fail('failed page published'); },
      persistentCache: { async get() { return null; }, async flush() { flushes++; throw new Error('checkpoint failure'); } },
      worker: { async open() { return { frames: 4096, channels: 1, sampleRate: 44100 }; },
        readPage() { return new Promise((_resolve, reject) => { failRead = reject; readStarted(); }); }, close() {} }
    });
    await provider.prepare(['sample.wav']);
    const pending = provider.preload([{ sample: 0, pageIndex: 0 }]);
    const rejected = assert.rejects(pending, { code: cancel ? 'sample-cancelled' : 'source-revision' });
    await started;
    if (cancel) provider.close();
    failRead(sourceError);
    await rejected;
    assert.equal(flushes, 1);
    provider.close();
  }
});

test('captured provider factories retain their source and create independent export workers', async () => {
  const fixture = flac({ prediction: true }), original = reader(fixture.bytes);
  let selected = original, captured = 0, workers = 0, revoked = false;
  const granted = { ...original, revision: 'original', readRange(...args) {
    if (revoked) throw Object.assign(new Error('Source changed'), { code: 'sample-generation' });
    return original.readRange(...args);
  } };
  selected = granted;
  const factory = await createSfzSampleProviderFactory({ assetId: 'c'.repeat(24), paths: ['sample.flac'],
    createReader: () => { captured++; return selected; }, workerFactory() { workers++; return workerFactory(); } });
  selected = { revision: 'replacement', readRange() { assert.fail('A captured export must not read the new selection'); } };
  const firstPages = [], secondPages = [];
  const first = await factory({ generation: 3, publish: page => firstPages.push(page) });
  const second = await factory({ generation: 4, publish: page => secondPages.push(page) });
  try {
    assert.equal(captured, 1); assert.equal(workers, 3);
    assert.ok(Object.isFrozen(factory.samples)); assert.ok(Object.isFrozen(factory.samples[0]));
    await first.requestPages([{ generation: 3, sample: 0, pageIndex: 1 }]);
    first.close();
    await second.requestPages([{ generation: 4, sample: 0, pageIndex: 2 }]);
    assert.deepEqual(firstPages[0].pcm, fixture.expected.subarray(8192, 16384));
    assert.deepEqual(secondPages[0].pcm, fixture.expected.subarray(16384, 24576));
    revoked = true;
    await assert.rejects(factory({ generation: 5, publish() {} }), { code: 'sample-generation' });
  } finally { first.close(); second.close(); }
});

test('ordinary streamed SFZ keeps complete coordinates without requiring all onset pages resident', async () => {
  const fixture = flac({ prediction: true }), source = reader(fixture.bytes);
  const parsed = await parseSfz({ selectedPath: 'a.sfz', hasSample: () => true, onDiagnostic: null,
    readText: async () => '<region> sample=one.flac key=60 offset=4090 <region> sample=one.flac key=61 direction=reverse end=9000' });
  const prepared = await prepareStreamedSfzBank({ id: 'd'.repeat(24), parsed, maxBytes: 2 * 1024 * 1024,
    createSampleReader: () => source,
    preparationContext: { sampleRate: 48000, processingChannels: 2, maxFrames: 128, minimumPhysicalBpm: 0 },
    // Native storage/query geometry is covered by the owning C++ test. This
    // injected cost verifies that the producer uses its authoritative result.
    estimateEffectBytes: async payload => 100000 + queriedCacheBytes(payload) }, { workerFactory, persistentCache: null });
  assert.equal(prepared.regionCount, 2);
  assert.ok(prepared.descriptor.payload.byteLength < 4096);
  assert.ok(prepared.descriptor.footprintBytes <= 2 * 1024 * 1024);
  const pages = [], provider = await prepared.descriptor.sampleProviderFactory({ generation: 9, publish: page => pages.push(page) });
  try {
    assert.deepEqual(pages.map(page => page.pageIndex), []);
    assert.ok(pages.every(page => page.resident));
    await provider.requestPages([{ generation: 9, sample: 0, pageIndex: 3 }]);
    assert.equal(pages.at(-1).resident, false);
    assert.deepEqual(pages.at(-1).pcm, fixture.expected.subarray(24576));
  } finally { provider.close(); }
});

test('streamed wavetable preparation pins the entire resized cycle through the real decode worker', async () => {
  const fixture = flac({ prediction: true }), source = reader(fixture.bytes);
  const parsed = await parseSfz({ selectedPath: 'a.sfz', hasSample: () => true, onDiagnostic: null,
    readText: async () => '<region> sample=one.flac oscillator=on oscillator_table_size=8193' });
  const prepared = await prepareStreamedSfzBank({ id: 'e'.repeat(24), parsed, maxBytes: 2 * 1024 * 1024,
    createSampleReader: () => source,
    preparationContext: { sampleRate: 48000, processingChannels: 2, maxFrames: 128, minimumPhysicalBpm: 0 },
    // Native storage/query geometry is covered by the owning C++ test. This
    // injected cost verifies that the producer uses its authoritative result.
    estimateEffectBytes: async payload => 100000 + queriedCacheBytes(payload) }, { workerFactory, persistentCache: null });
  const pages = [], provider = await prepared.descriptor.sampleProviderFactory({ generation: 10, publish: page => pages.push(page) });
  try {
    assert.deepEqual(pages.map(page => [page.pageIndex, page.frames, page.resident]), [[0, 4096, true], [1, 4096, true], [2, 4096, true], [3, 4096, true], [4, 14, true]]);
    assert.ok(pages[0].pcm.some(value => value !== 0));
    assert.ok(prepared.descriptor.footprintBytes <= 2 * 1024 * 1024);
  } finally { provider.close(); }
});

test('per-region loading variants share the source reader and union only authored residency windows', async () => {
  const fixture = flac({ prediction: true }), source = reader(fixture.bytes);
  const parsed = await parseSfz({ selectedPath: 'a.sfz', hasSample: () => true, onDiagnostic: null,
    readText: async () => '<group> sample=one.flac load_mode=1 load_start=4095 load_end=4096 ' +
      '<region> key=60 offset=9000 loop_mode=loop_continuous loop_start=9000 loop_end=10000 ' +
      '<region> key=61 load_start=8191 load_end=8192 <region> key=62 load_mode=0 load_start=0 load_end=4095' });
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  let captures = 0;
  const queries = [];
  const prepared = await prepareStreamedSfzBank({ id: 'f'.repeat(24), parsed, maxBytes: 2 * 1024 * 1024,
    createSampleReader: () => { captures++; return source; },
    preparationContext: { sampleRate: 48000, processingChannels: 2, maxFrames: 128, minimumPhysicalBpm: 0 },
    estimateEffectBytes: async payload => { queries.push(payload); return 123456 + queriedCacheBytes(payload); }
  }, { workerFactory, persistentCache: null });
  assert.equal(captures, 2); // Loop metadata probe, then one captured reader shared by both variants.
  assert.equal(prepared.sampleCount, 2);
  const words = new Uint32Array(prepared.descriptor.payload, 32);
  assert.equal(words[1], 10); assert.equal(words[15], 2);
  const formats = Array.from({ length: 2 }, (_, sample) => words[words[12] + sample * 16 + 12]);
  assert.deepEqual(formats.sort(), [0, 1]);
  assert.equal(words[18], 2); // One merged interval for each variant.
  assert.ok(queries.length > 0);
  assert.equal(prepared.descriptor.nativeNonCacheBytes, 123456);
  const publications = [];
  const provider = await prepared.descriptor.sampleProviderFactory({ generation: 30, publish: page => publications.push(page) });
  try {
    const packed = provider.samples.find(sample => sample.storageMode === 1);
    const floating = provider.samples.find(sample => sample.storageMode === 0);
    assert.notEqual(packed.revision, floating.revision);
    assert.deepEqual(publications.filter(page => page.sample === packed.sample).map(page => page.pageIndex), [0, 1, 2]);
    assert.deepEqual(publications.filter(page => page.sample === floating.sample).map(page => page.pageIndex), [0]);
    await provider.requestPages([{ generation: 30, sample: packed.sample, pageIndex: 3 }]);
    assert.equal(publications.at(-1).resident, false);
    assert.deepEqual(publications.at(-1).pcm, fixture.expected.subarray(24576));
  } finally { provider.close(); }
});

test('loading endpoints clamp in source-frame precision and omission never becomes whole residency', async () => {
  const parsed = await parseSfz({ selectedPath: 'a.sfz', onDiagnostic: null, readText: async () =>
    '<region> sample=a.wav key=60 load_start=0 load_end=4294967296 load_mode=1 <region> sample=a.wav key=61' });
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  assert.equal(parsed.regions[0].load_end, 4294967296);
  assert.throws(() => packSfzAsset(parsed.regions, new Map()), { code: 'prepare' });
  const variants = sfzStorageVariants(parsed);
  const samples = new Map(variants.paths.map(path => [path, { frames: 9001, storageMode: variants.modes.get(path) }]));
  const ranges = sfzResidentRanges(variants.parsed.regions, samples);
  assert.deepEqual(ranges.get('a.wav'), []);
  assert.deepEqual([...ranges].find(([path]) => path !== 'a.wav')[1], [[0, 9001]]);
  const slots = sfzStorageSlots(6, samples, ranges);
  assert.equal(slots.slots16, 4);
  assert.equal(sfzStorageSlots(4, samples, ranges), null);
  const omitted = sfzStorageVariants({ ...parsed, regions: [parsed.regions[1]] });
  assert.deepEqual(sfzResidentRanges(omitted.parsed.regions, new Map([['a.wav', { frames: 2 ** 32 + 123 }]])).get('a.wav'), []);
  for (const opcode of ['load_mode=2', 'load_start=-1', 'load_end=4294967297']) {
    const invalid = await parseSfz({ selectedPath: 'a.sfz', onDiagnostic: null, readText: async () => `<region> sample=a.wav ${opcode}` });
    assert.equal(invalid.regions.length, 0);
    assert.equal(invalid.diagnostics.invalidRegions.length, 1);
  }
});

test('ordinary preparation admits more onset pages than the cache without reading or pinning source PCM', { timeout: 15000 }, async () => {
  const count = 16385; // Each offset straddles two distinct FIR onset pages:32770.
  const frames = count * 8192 + 8192, size = 44 + frames * 2;
  const header = new Uint8Array(44), view = new DataView(header.buffer);
  header.set(new TextEncoder().encode('RIFF'), 0); view.setUint32(4, size - 8, true);
  header.set(new TextEncoder().encode('WAVEfmt '), 8); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 48000, true);
  view.setUint32(28, 96000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  header.set(new TextEncoder().encode('data'), 36); view.setUint32(40, frames * 2, true);
  const reads = [], source = { size, revision: 'virtual-many-heads', async readRange(offset, length) {
    reads.push([offset, length]);
    assert.ok(offset >= 0 && offset + length <= 44, 'Preparation must read metadata only');
    return header.slice(offset, offset + length);
  } };
  const parsed = await parseSfz({ selectedPath: 'many.sfz', onDiagnostic: null,
    readText: async () => '<region> sample=virtual.wav key=60' });
  // Legacy/basic SFZ is an approved path too. Keep the large fixture metadata
  // small and omit typed modulation which is unrelated to onset residency.
  const basic = Object.fromEntries(Object.entries(parsed.regions[0]).filter(([key]) => !Object.hasOwn(SFZ_EXTRA_DEFAULTS, key)));
  parsed.regions = Array.from({ length: count }, (_, index) => ({ ...basic, offset: index * 8192 + 4096 }));
  parsed.modulation = null;
  let queries = 0;
  const prepared = await prepareStreamedSfzBank({ id: '1'.repeat(24), parsed, maxBytes: 64 * 1024 * 1024,
    createSampleReader: () => source,
    preparationContext: { sampleRate: 48000, processingChannels: 2, maxFrames: 128, minimumPhysicalBpm: 0 },
    estimateEffectBytes: async payload => { queries++; return queriedCacheBytes(payload); }
  }, { workerFactory, persistentCache: null });
  assert.equal(queries, 1);
  assert.equal(prepared.regionCount, count);
  assert.ok(count * 2 > 32768 && prepared.descriptor.sampleCacheSlots <= 32768);
  assert.ok(prepared.descriptor.footprintBytes <= 64 * 1024 * 1024);
  const words = new Uint32Array(prepared.descriptor.payload, 32);
  assert.equal(words[1], 10); assert.equal(words[18], 0);
  const publications = [], provider = await prepared.descriptor.sampleProviderFactory({ generation: 31,
    publish: page => publications.push(page) });
  try { assert.equal(publications.length, 0); assert.ok(reads.length > 0); }
  finally { provider.close(); }
});
