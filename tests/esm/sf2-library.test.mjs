import assert from 'node:assert/strict';
import test from 'node:test';
import { createSf2Fixture } from '../helpers/sf2-fixture.mjs';
import { SfzLibraryService, listSfzFolderFiles } from '../../js/sfz/service.js';
import { openSf2Source } from '../../js/sf2/source.js';
import { prepareSoundFontBank as prepareActualSoundFontBank, sf2SamplerRegions } from '../../js/sf2/asset.js';
import { packStreamedSfzAsset, sfzSampleCacheFootprint } from '../../js/sfz/asset.js';
import { NativeSfzLibraryService } from '../../js/sfz/native-service.js';

const prepareSoundFontBank = async ({ source }) => {
  assert.equal(source.compiled.presets.length, 1);
  assert.equal(source.samples.length, 1);
  const reader = source.createSampleReader(source.samples[0].path);
  assert.equal(reader.pcm.channels, 1); assert.equal(reader.pcm.frames, 64);
  return { regionCount: source.compiled.regions.length, descriptor: { footprintBytes: 4096 } };
};

test('SoundFont browser storage copies a Blob and reopens the collection through range reads', async () => {
  const saved = new Map(), file = new File([createSf2Fixture()], 'Collection.sf2', { lastModified: 1 });
  const backend = {
    async read(name) { return saved.get(name) || null; },
    async writeAtomic(name, value) { saved.set(name, value); },
    async remove(name) { saved.delete(name); },
    async writeSfzBankFile(name, blob) { assert.ok(blob instanceof Blob); saved.set(name, new File([blob], name, { lastModified: 2 })); },
    async readSfzBankFile(name) { return saved.get(name); }
  };
  // Whole-file reads on the source are forbidden; Blob slicing remains available.
  file.arrayBuffer = () => { throw new Error('Unexpected whole-file read'); };
  assert.deepEqual(listSfzFolderFiles([file]), ['Collection.sf2']);
  let service = await new SfzLibraryService(backend).open();
  const entry = await service.importFolderFiles([file], file.name, { prepareSoundFontBank });
  assert.equal(entry.format, 'sf2');
  service = await new SfzLibraryService(backend).open();
  const bank = await service.prepare(entry.id, { prepareSoundFontBank });
  assert.equal(bank.format, 'sf2'); assert.equal(bank.regionCount, 1);
  assert.equal(bank.presets[0].name, 'Preset');
  assert.equal((await service.readMetadata(entry.id)).fileCount, 1);
  await service.remove(entry.id); assert.equal(saved.has(`${entry.id}.sfzbank`), false);
});

test('native SoundFont preparation uses one revision-granted range reader and preserves preset directory', async () => {
  const bytes = createSf2Fixture(), id = 'a'.repeat(24), revision = 'b'.repeat(64);
  const entry = { id, name: 'Collection.sf2', selectedPath: 'Collection.sf2' }, reads = [];
  const service = new NativeSfzLibraryService({ apiVersion: 1,
    async list() { return { ok: true, data: [entry] }; },
    async statRelative() { return { ok: true, data: { size: bytes.length, revision } }; },
    async readRelative() { throw new Error('Unexpected whole-file read'); },
    async readRelativeRange(request) {
      assert.equal(request.id, id); assert.equal(request.relativePath, entry.selectedPath); assert.equal(request.revision, revision);
      reads.push(request); return { ok: true, data: { revision, bytes: bytes.subarray(request.offset, request.offset + request.length) } };
    }
  });
  const bank = await service.prepare(id, { prepareSoundFontBank });
  assert.equal(bank.format, 'sf2'); assert.equal(bank.presets[0].program, 0); assert.equal(bank.presets[0].bank, 0);
  assert.ok(reads.every(read => read.length <= 1024 * 1024));
  const metadata = await service.readMetadata(id); assert.equal(metadata.size, bytes.length); assert.equal(metadata.regionCount, 1);
});


test('an actual compiled SF2 bank prepares metadata without opening or publishing every sample onset', async () => {
  const bytes = createSf2Fixture(), reads = [];
  const source = await openSf2Source({ size: bytes.length, revision: 'onset-lazy-fixture',
    async readRange(offset, length) { reads.push({ offset, length }); return bytes.slice(offset, offset + length); } });
  const metadataReads = reads.length;
  let workers = 0, publications = 0;
  const bank = await prepareActualSoundFontBank({ id: 'a'.repeat(24), source, maxBytes: 1024 * 1024 },
    { persistentCache: null, workerFactory() { workers++; throw new Error('Unused sample must stay unopened'); } });
  const provider = await bank.descriptor.sampleProviderFactory({ generation: 1, publish() { publications++; return true; } });
  try {
    assert.equal(bank.sampleCount, 1); assert.equal(bank.sourceBytes, bytes.length);
    assert.equal(workers, 0); assert.equal(publications, 0); assert.equal(reads.length, metadataReads);
  } finally { provider.close(); }
});

test('SoundFont slot selection reuses the packed payload across capacities and contexts', async () => {
  const bytes = createSf2Fixture(), id = 'c'.repeat(24);
  const opened = await openSf2Source({ size: bytes.length, revision: 'slot-selection-fixture',
    async readRange(offset, length) { return bytes.slice(offset, offset + length); } });
  let readerCalls = 0;
  const source = { ...opened, createSampleReader(path) { readerCalls++; return opened.createSampleReader(path); } };
  const firstContext = { sampleRate: 48000, processingChannels: 1, maxFrames: 128, playerKind: 1 };
  const secondContext = { sampleRate: 96000, processingChannels: 2, maxFrames: 256, playerKind: 1 };
  const thirdContext = { sampleRate: 44100, processingChannels: 4, maxFrames: 64, playerKind: 1 };
  const noteContext = { ...firstContext, playerKind: 0 };
  const nonCacheBytes = playerKind => playerKind ? 4096 : 2048;
  const queriedSlots = [];
  const estimateEffectBytes = async (payload, context) => {
    const header = new Uint32Array(payload, 32);
    queriedSlots.push({ slots: header[14], context });
    await Promise.resolve();
    return nonCacheBytes(context.playerKind) + sfzSampleCacheFootprint(header[13], header[14], 1);
  };
  const bank = await prepareActualSoundFontBank({ id, source, maxBytes: 1024 * 1024,
    preparationContext: firstContext, estimateEffectBytes }, { persistentCache: null });
  const first = bank.descriptor;
  const initialReaderCalls = readerCalls;
  const firstBytes = Buffer.from(first.payload).toString('hex');
  const samples = new Map(source.samples.map((sample, index) => {
    const header = new Uint32Array(first.payload, 32), table = header[12] + index * 12;
    const row = new Uint32Array(first.payload, 32 + table * 4, 12);
    return [sample.path, { frames: row[0] + row[1] * 0x100000000, channels: row[2], sampleRate: row[3],
      revision: Buffer.from(first.payload, 32 + (table + 4) * 4, 32).toString('hex') }];
  }));
  const cacheBytes = slots => sfzSampleCacheFootprint(samples.size, slots, 1);
  const compareCanonical = (descriptor, context) => {
    const canonical = packStreamedSfzAsset(sf2SamplerRegions(source), samples, {
      cacheSlots: descriptor.sampleCacheSlots, modulation: source.compiled,
      sourceProfile: source.compiled.sourceProfile, presets: source.compiled.presets,
      preparationContext: context });
    assert.deepEqual(Buffer.from(descriptor.payload), Buffer.from(canonical.payload));
    assert.equal(descriptor.sampleCacheBytes, canonical.sampleCacheBytes);
    for (const key of ['warmupSamples', 'tailSeconds', 'channels', 'samples', 'sampleRate', 'layout',
      'formatTag', 'rateDivider', 'headBlock']) assert.equal(descriptor[key], canonical[key]);
    assert.deepEqual(descriptor.unsupportedRuntime, canonical.unsupportedRuntime);
    assert.equal(descriptor.nativeNonCacheBytes, nonCacheBytes(context.playerKind));
    assert.equal(descriptor.nativePreparationBytes, nonCacheBytes(context.playerKind) + cacheBytes(descriptor.sampleCacheSlots));
    assert.equal(descriptor.footprintBytes, descriptor.payload.byteLength + descriptor.nativePreparationBytes);
    assert.equal(descriptor.processingChannels, context.processingChannels);
    assert.deepEqual(descriptor.preparationContext, { ...context, minimumPhysicalBpm: 0 });
  };
  assert.ok(first.sampleCacheSlots > 1);
  compareCanonical(first, firstContext);
  const lowBudget = first.payload.byteLength + nonCacheBytes(1) + cacheBytes(1);
  const [second, third, note] = await Promise.all([
    first.materializeForContext(secondContext, lowBudget, estimateEffectBytes),
    first.materializeForContext(thirdContext, 1024 * 1024, estimateEffectBytes),
    first.materializeForContext(noteContext, 1024 * 1024, estimateEffectBytes)
  ]);
  assert.notEqual(second, first);
  assert.equal(second.sampleCacheSlots, 1);
  compareCanonical(second, secondContext);
  assert.notEqual(third, first);
  assert.equal(third.sampleCacheSlots, first.sampleCacheSlots);
  compareCanonical(third, thirdContext);
  assert.notEqual(note, first);
  assert.notEqual(note.payload, first.payload);
  compareCanonical(note, noteContext);
  assert.equal(Buffer.from(first.payload).toString('hex'), firstBytes);
  assert.equal(readerCalls, initialReaderCalls, 'Context changes reuse the prepared sample metadata');
  assert.deepEqual(queriedSlots.map(query => query.slots), [1, 1, 1, 1]);
});
