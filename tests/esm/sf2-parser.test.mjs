import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSf2 } from '../../js/sf2/parser.js';
import { compileSf2, SF2_DEFAULT_MODULATORS, SF2_INITIAL_PITCH } from '../../js/sf2/compiler.js';
import { openSf2Source } from '../../js/sf2/source.js';
import { sf2SamplerRegions } from '../../js/sf2/asset.js';
import { packSf2Modulation } from '../../js/sf2/modulation.js';
import { packStreamedSfzAsset, SFZ_REGION_FIELDS } from '../../js/sfz/asset.js';

import { createSf2Fixture as fixture } from '../helpers/sf2-fixture.mjs';

const reader = bytes => ({ size: bytes.length, async readRange(offset, length) { return bytes.subarray(offset, offset + length); } });

test('SF2 parses bounded metadata and resolves local/global replacement, preset addition and intersecting ranges', async () => {
  const parsed = await parseSf2(reader(fixture()));
  assert.equal(parsed.presets[0].name, 'Preset');
  assert.equal(parsed.sampleFrames, 110); assert.ok(parsed.sm24Offset > parsed.smplOffset);
  const compiled = compileSf2(parsed), region = compiled.regions[0];
  assert.deepEqual(region.keyRange, [70, 80]); assert.deepEqual(region.velocityRange, [0, 127]);
  assert.equal(region.generators[48], 120); assert.equal(region.generators[34], -12000);
  assert.equal(region.sample.end, 64); assert.equal(region.sample.loopEnd, 56);
  assert.equal(region.modulators.find(m => m.source === 0x0502).amount, 0);
  assert.equal(region.modulators.length, 10);
  assert.equal(region.modulators.find(m => m.destination === SF2_INITIAL_PITCH).amountSource, 16);
  assert.equal(SF2_DEFAULT_MODULATORS.find(m => m.source === 0x0587).destination, 48);
});

test('SF2 honors instrument-global loop defaults and local zero, one or three overrides', async () => {
  for (const globalMode of [1, 3]) for (const localMode of [null, 0, 1, 3]) {
    const parsed = await parseSf2(reader(fixture()));
    const generator = (operator, amount) => ({ operator, amount, unsignedAmount: amount });
    parsed.tables.igen[0] = generator(54, globalMode);
    if (localMode === null) parsed.tables.igen.splice(3, 1);
    else parsed.tables.igen[3] = generator(54, localMode);
    if (localMode === null) parsed.tables.ibag[2].generator--;
    // The same instrument-only generator remains invalid at preset level.
    parsed.tables.pgen[0] = generator(54, 1);
    const compiled = compileSf2(parsed), region = compiled.regions[0];
    assert.equal(region.generators[54], localMode ?? globalMode);
    assert.equal(region.sample.loopStart, 8);
    assert.equal(region.sample.loopEnd, 56);
    const source = { compiled, samples: [{ sampleId: 0, start: 0, frames: 64, path: 'sample:00000' }] };
    assert.equal(sf2SamplerRegions(source)[0].loop_mode, ((localMode ?? globalMode) & 1)
      ? ((localMode ?? globalMode) & 2 ? 3 : 2) : 0);
  }
});

test('SF2 ignores sm24 for older versions and rejects broken RIFF/HYDRA bounds', async () => {
  assert.equal((await parseSf2(reader(fixture({ version: 1 })))).sm24Offset, null);
  assert.equal((await parseSf2(reader(fixture({ sm24: false })))).sm24Offset, null);
  await assert.rejects(parseSf2(reader(fixture({ invalidIndex: true }))), { code: 'invalid-sf2' });
  const bytes = fixture(); bytes.writeUInt32LE(bytes.length, 4);
  await assert.rejects(parseSf2(reader(bytes)), { code: 'invalid-sf2' });
});

test('SF2 metadata parsing skips a sample pool above signed 32-bit offsets without reading sample bytes', async () => {
  const bytes = fixture(), original = await parseSf2(reader(bytes));
  const poolOffset = original.smplOffset, oldLength = original.sampleFrames * 2, extra = 0x80000000;
  const prefix = Buffer.from(bytes.subarray(0, poolOffset)), suffix = bytes.subarray(poolOffset + oldLength);
  prefix.writeUInt32LE(bytes.length + extra - 8, 4);
  prefix.writeUInt32LE(oldLength + extra, poolOffset - 4);
  prefix.writeUInt32LE(prefix.readUInt32LE(poolOffset - 16) + extra, poolOffset - 16);
  const reads = [];
  const parsed = await parseSf2({ size: bytes.length + extra, async readRange(offset, length) {
    reads.push([offset, length]);
    if (offset < poolOffset) return prefix.subarray(offset, offset + length);
    assert.ok(offset >= poolOffset + oldLength + extra, 'sample data must not be read');
    return suffix.subarray(offset - poolOffset - oldLength - extra, offset - poolOffset - oldLength - extra + length);
  } });
  assert.equal(parsed.presets.length, 1); assert.equal(parsed.sm24Offset, null);
  assert.ok(reads.some(([offset]) => offset > 0x80000000));
});

test('SF2 keeps stereo links as individual mono zones and preserves signed coarse sample addresses', async () => {
  const parsed = await parseSf2(reader(fixture()));
  parsed.tables.shdr[0].sampleType = 4; parsed.tables.shdr[0].sampleLink = 1;
  parsed.tables.shdr.splice(1, 0, { ...parsed.tables.shdr[0], sampleType: 2, sampleLink: 0 });
  const compiled = compileSf2(parsed);
  assert.equal(compiled.regions.length, 1); assert.equal(compiled.regions[0].sample.sampleType, 4);
  assert.equal(compiled.regions[0].sample.sampleLink, 1);
});

test('SF2 resolves chained modulation by zone-local indices and removes circular links', async () => {
  const parsed = await parseSf2(reader(fixture()));
  const values = [
    { source: 0x81, destination: 0x8001, amount: 100, amountSource: 0, transform: 0 },
    { source: 127, destination: 48, amount: 2, amountSource: 0, transform: 2 }
  ];
  parsed.tables.imod = [...values, {}]; parsed.tables.ibag[1].modulator = 0; parsed.tables.ibag[2].modulator = 2;
  let compiled = compileSf2(parsed), mods = compiled.regions[0].modulators;
  const linked = mods.find(m => m.destination === 0x8001);
  assert.equal(mods[linked.link].source, 127); assert.equal(mods[linked.link].transform, 2);
  values[0].source = 127; values[1].destination = 0x8000;
  compiled = compileSf2(parsed);
  assert.equal(compiled.regions[0].modulators.length, 10);
  assert.equal(compiled.diagnostics.ignoredModulators, 2);
});

test('SF2 preset selector validates indices and complete-bank compilation preserves preset addresses', async () => {
  const parsed = await parseSf2(reader(fixture()));
  assert.equal(compileSf2(parsed, { presetIndex: 0 }).presets[0].regionCount, 1);
  assert.throws(() => compileSf2(parsed, { presetIndex: 1 }), { code: 'invalid-sf2' });
});

test('SF2 whole collections preserve distinct bank/program addresses with one shared sample provider', async () => {
  const presets = Array.from({ length: 16 }, (_, channel) => ({ name: `Tone ${channel + 1}`,
    bank: channel === 9 ? 128 : channel, program: 127 - channel }));
  const source = await openSf2Source(reader(fixture({ presets })));
  assert.equal(source.samples.length, 1);
  assert.equal(source.compiled.regions.length, 16);
  assert.deepEqual(source.compiled.presets.map(({ bank, program, firstRegion, regionCount }) =>
    ({ bank, program, firstRegion, regionCount })), presets.map(({ bank, program }, index) =>
    ({ bank, program, firstRegion: index, regionCount: 1 })));
  assert.ok(sf2SamplerRegions(source).every(region => region.sample === source.samples[0].path));
});

test('SF2 unpitched header 255 uses the specified middle-C root and retains root-key overrides', async () => {
  const parsed = await parseSf2(reader(fixture()));
  parsed.tables.shdr[0].originalPitch = 255;
  let region = compileSf2(parsed).regions[0];
  assert.equal(parsed.tables.shdr[0].originalPitch, 255);
  assert.equal(region.sample.originalPitch, 60);
  assert.equal(region.generators[56], 100);
  parsed.tables.igen.splice(4, 0, { operator: 58, amount: 72, unsignedAmount: 72 });
  parsed.tables.ibag[2].generator++;
  region = compileSf2(parsed).regions[0];
  assert.equal(region.sample.originalPitch, 60);
  assert.equal(region.generators[58], 72);
});

test('SF2 v9 serialization keeps preset directory, source profile, raw generators and exclusive sample bounds', async () => {
  const source = await openSf2Source(reader(fixture()));
  const samples = new Map(source.samples.map(sample => [sample.path,
    { frames: sample.frames, channels: 1, sampleRate: sample.sampleRate, revision: 'a'.repeat(64) }]));
  const descriptor = packStreamedSfzAsset(sf2SamplerRegions(source), samples, { cacheSlots: 8,
    sourceProfile: source.compiled.sourceProfile, presets: source.compiled.presets, modulation: source.compiled });
  const words = new Uint32Array(descriptor.payload, 32), values = new Float32Array(descriptor.payload, 32);
  assert.equal(words[1], 9); assert.equal(words[15], 0x10001); assert.equal(words[17], 1);
  assert.equal(words[16], words[12] + words[13] * 12); assert.equal(words[4], words[16] + 4);
  assert.deepEqual([...words.subarray(words[16], words[16] + 4)], [0, 0, 0, 1]);
  assert.equal(words[18 + SFZ_REGION_FIELDS.indexOf('end')], 63);
  assert.equal(words[18 + SFZ_REGION_FIELDS.indexOf('loop_end')], 55);
  const modOffset = words[10]; assert.equal(words[modOffset + 1], 2);
  assert.equal(words[modOffset + 9], 61);
  assert.equal(values[modOffset + words[modOffset + 8] + 48], 120);
});

test('SF2 linked route serialization uses region-local buses and retains source mapping flags', () => {
  const region = { generators: new Float64Array(61), modulators: [
    { source: 0x057f, destination: 48, amount: 2, amountSource: 0, transform: 2, link: -1 },
    { source: 0x81, destination: 0x8000, amount: 1, amountSource: 0, transform: 0, link: 0 },
    { source: 13, destination: 0x8000, amount: 1, amountSource: 0, transform: 0, link: 0 }
  ] };
  const bytes = packSf2Modulation({ regions: [region, region] });
  const words = new Uint32Array(bytes.buffer), routeOffset = words[6];
  assert.deepEqual([...words.subarray(10, 18)], [0, 3, 0, 61, 3, 3, 61, 61]);
  for (const first of [0, 3]) {
    assert.equal(words[routeOffset + first * 10], 0x20002);
    assert.equal(words[routeOffset + (first + 1) * 10], 0x20002);
    assert.equal(words[routeOffset + (first + 2) * 10 + 1], 0x20002);
    assert.equal(words[routeOffset + (first + 2) * 10 + 8], 0x057f);
  }
});
