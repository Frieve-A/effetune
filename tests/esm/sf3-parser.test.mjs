import assert from 'node:assert/strict';
import test from 'node:test';
import { openSf2Source } from '../../js/sf2/source.js';
import { sf2SamplerRegions, prepareSoundFontBank } from '../../js/sf2/asset.js';
import { readOggVorbisMetadata, decodeOggVorbisFrames } from '../../js/sf2/ogg-vorbis.js';
import { SfzSampleStream } from '../../js/sfz/sample-stream.js';
import { createSfzSampleProviderFactory } from '../../js/sfz/sample-page-provider.js';
import { SfzLibraryService, listSfzFolderFiles } from '../../js/sfz/service.js';
import { NativeSfzLibraryService } from '../../js/sfz/native-service.js';
import { createSf3Fixture, createVorbisFramingFixture, createOggPage } from '../helpers/sf3-fixture.mjs';

const reader = bytes => ({ size: bytes.length, revision: 'sf3-framing-fixture',
  async readRange(offset, length) { assert.ok(length <= 1024 * 1024); return new Uint8Array(bytes.subarray(offset, offset + length)); } });

test('SF3 paged decoding primes overlap after seeks and crops final EOS PCM without retaining a sample buffer', async () => {
  const header = createVorbisFramingFixture(), lastPage = header.indexOf(Buffer.from('OggS'), header.indexOf(Buffer.from('OggS'), 4) + 4);
  const packet = index => Buffer.from([0, index]);
  const bytes = Buffer.concat([header.subarray(0, lastPage),
    createOggPage([0, 1, 2, 3].map(packet), { sequence: 2, granule: 48 }),
    createOggPage([4, 5, 6].map(packet), { sequence: 3, granule: 96 }),
    createOggPage([7, 8].map(packet), { sequence: 4, granule: 116, flags: 4 })]);
  const previousDecoder = globalThis.AudioDecoder, previousChunk = globalThis.EncodedAudioChunk;
  let open = 0;
  globalThis.EncodedAudioChunk = class { constructor(value) { Object.assign(this, value); } };
  globalThis.AudioDecoder = class {
    static async isConfigSupported() { return { supported: true }; }
    constructor({ output }) { this.output = output; this.state = 'unconfigured'; open++; }
    configure() { this.state = 'configured'; this.primed = false; }
    reset() { this.state = 'unconfigured'; }
    decode({ data }) {
      if (!this.primed) { this.primed = true; return; }
      const first = (data[1] - 1) * 16;
      this.output({ numberOfChannels: 1, sampleRate: 44100, numberOfFrames: 16,
        copyTo(pcm) { for (let i = 0; i < 16; i++) pcm[i] = Math.sin((first + i) * .1); }, close() {} });
    }
    async flush() {}
    close() { this.state = 'closed'; open--; }
  };
  try {
    const metadata = await readOggVorbisMetadata(reader(bytes).readRange, bytes.length);
    for (const [start, count] of [[0, 40], [35, 50], [48, 40], [91, 25], [108, 8]]) {
      const pcm = await decodeOggVorbisFrames(reader(bytes).readRange, bytes.length, start, count, metadata);
      assert.deepEqual(pcm, Float32Array.from({ length: count }, (_, index) => Math.sin((start + index) * .1)));
      assert.equal(open, 0, 'Every requested window closes its platform decoder');
    }
  } finally {
    if (previousDecoder === undefined) delete globalThis.AudioDecoder; else globalThis.AudioDecoder = previousDecoder;
    if (previousChunk === undefined) delete globalThis.EncodedAudioChunk; else globalThis.EncodedAudioChunk = previousChunk;
  }
});

test('SF3 uses byte sample bounds and decoded-local loop geometry for inclusive and MuseScore exclusive ends', async () => {
  for (const inclusive of [false, true]) for (const minor of [0, 1, 4]) {
    const source = await openSf2Source(reader(createSf3Fixture({ inclusive, minor })));
    assert.equal(source.parsed.format, 'sf3'); assert.equal(source.compiled.sourceProfile, `sf3-3.0${minor}`);
    assert.equal(source.samples.length, 1); assert.equal(source.samples[0].frames, 16384);
    const sampleReader = source.createSampleReader(source.samples[0].path);
    assert.equal(sampleReader.pcm.format, 'sf3-vorbis'); assert.equal(sampleReader.pcm.frames, 16384);
    const [region] = sf2SamplerRegions(source);
    assert.equal(region.end, 16383); assert.equal(region.loop_start, 8); assert.equal(region.loop_end, 8191);
    assert.equal((await SfzSampleStream.open(sampleReader.readRange, sampleReader.size, sampleReader.pcm)).metadata.frames, 16384);
  }
});

test('SF3 rejects damaged Ogg framing and non-mono compression before publishing sample geometry', async () => {
  const ogg = createVorbisFramingFixture(); ogg[30] ^= 1;
  await assert.rejects(readOggVorbisMetadata(reader(ogg).readRange, ogg.length), { code: 'sample-format' });
  await assert.rejects(openSf2Source(reader(createSf3Fixture({ channels: 2 }))), { code: 'sample-format' });
  const bytes = createSf3Fixture(), header = bytes.indexOf(Buffer.from('shdr')) + 8;
  bytes.writeUInt32LE(bytes.length, header + 24);
  await assert.rejects(openSf2Source(reader(bytes)), { code: 'invalid-sf2' });
});

test('SF3 metadata remains lazy across provider generations and asks for a supported platform decoder', async () => {
  const source = await openSf2Source(reader(createSf3Fixture()));
  const factory = await createSfzSampleProviderFactory({ assetId: 'a'.repeat(24), paths: source.samples.map(sample => sample.path),
    createReader: source.createSampleReader, workerFactory() { throw new Error('Metadata must not open a decoder'); } });
  assert.equal(factory.samples[0].sourceGeometry, true); assert.equal(factory.samples[0].rawPcm, undefined);
  const provider = await factory({ generation: 2, publish: () => true }); provider.close();
  assert.equal(typeof globalThis.AudioDecoder, 'undefined');
  await assert.rejects(prepareSoundFontBank({ source }), { code: 'sample-codec-unavailable' });
});

test('SF3 native and browser library registration preserve format, ranges and preset directory', async () => {
  const bytes = createSf3Fixture(), id = 'a'.repeat(24), revision = 'b'.repeat(64);
  const entry = { id, name: 'Compressed.sf3', selectedPath: 'Compressed.sf3' };
  const prepare = async ({ source }) => ({ regionCount: source.compiled.regions.length, descriptor: { footprintBytes: 4096 } });
  const native = new NativeSfzLibraryService({ apiVersion: 1, async list() { return { ok: true, data: [entry] }; },
    async statRelative() { return { ok: true, data: { size: bytes.length, revision } }; },
    async readRelative() { throw new Error('Whole-source reads are forbidden'); },
    async readRelativeRange({ offset, length }) { return { ok: true, data: { revision, bytes: bytes.subarray(offset, offset + length) } }; } });
  assert.equal((await native.readMetadata(id)).format, 'sf3');
  assert.equal((await native.prepare(id, { prepareSoundFontBank: prepare })).presets[0].name, 'Preset');
  const saved = new Map(), file = new File([bytes], entry.name, { lastModified: 1 });
  file.arrayBuffer = () => { throw new Error('Whole-source reads are forbidden'); };
  assert.deepEqual(listSfzFolderFiles([file]), [entry.name]);
  const browser = await new SfzLibraryService({ async read(key) { return saved.get(key) ?? null; },
    async writeAtomic(key, value) { saved.set(key, value); }, async remove(key) { saved.delete(key); },
    async writeSfzBankFile(key, blob) { saved.set(key, new File([blob], key, { lastModified: 2 })); },
    async readSfzBankFile(key) { return saved.get(key); } }).open();
  const stored = await browser.importFolderFiles([file], file.name, { prepareSoundFontBank: prepare });
  assert.equal(stored.format, 'sf3'); assert.equal((await browser.prepare(stored.id, { prepareSoundFontBank: prepare })).format, 'sf3');
});
