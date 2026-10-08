import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSfz, normalizeSfzPath } from '../../js/sfz/parser.js';
import { decodeSfzBank, encodeSfzBank, identifySfzBank, readSfzAudioHeader } from '../../js/sfz/bank.js';
import { packSfzAsset, SFZ_REGION_FIELDS } from '../../js/sfz/asset.js';

const encode = text => new TextEncoder().encode(text);
const parse = (text, extra = {}) => parseSfz({ selectedPath: 'instrument.sfz',
  readText: async path => path === 'instrument.sfz' ? text : null, onDiagnostic: null, ...extra });

test('SFZ headers inherit, key expands at its own scope, and paths/includes/defines resolve', async () => {
  const texts = new Map([
    ['bank/instrument.sfz', '#define $sample Grand Piano.wav\n<control> default_path=../samples/\n<global> key=c4 volume=-4\n<master> ampeg_release=.2\n<group> lokey=48 hikey=72\n#include "parts/regions.sfz"'],
    ['bank/parts/regions.sfz', '<region> sample=$sample lovel=32 hivel=90\n<region> sample=$sample key=67 volume=-2']
  ]);
  const result = await parse('', { selectedPath: 'bank/instrument.sfz', readText: async path => texts.get(path),
    hasSample: path => path === 'samples/Grand Piano.wav' });
  assert.deepEqual(result.dependencies, ['bank/instrument.sfz', 'bank/parts/regions.sfz']);
  assert.deepEqual(result.regions.map(region => [region.lokey, region.hikey, region.pitch_keycenter, region.volume]),
    [[48, 72, 60, -4], [67, 67, 67, -2]]);
  assert.equal(result.regions[0].sample, 'samples/Grand Piano.wav');
  assert.equal(result.regions[0].ampeg_release, .2);
  assert.equal(result.regions[0].seqGroup, result.regions[1].seqGroup);
});

test('repeated acyclic includes stop within the definition budget before region parsing', async () => {
  const texts = new Map(Array.from({ length: 17 }, (_, index) => [`${index}.sfz`, index === 16
    ? '<region> sample=tone.wav key=60' : `#include "${index + 1}.sfz"\n#include "${index + 1}.sfz"`]));
  let reads = 0;
  await assert.rejects(parse('', { selectedPath: '0.sfz', maxBytes: 1024,
    readText: async path => { reads++; return texts.get(path); },
    hasSample: () => assert.fail('Expansion must stop before parsing regions') }), error => error.code === 'too-large');
  assert.ok(reads < 100, `Definition budget allowed ${reads} reads`);
  // Even tiny definitions under a large byte budget have a finite work bound.
  texts.set('16.sfz', '');
  reads = 0;
  await assert.rejects(parse('', { selectedPath: '0.sfz', maxBytes: 1024 * 1024 * 1024,
    readText: async path => { reads++; return texts.get(path); } }), error => error.code === 'too-large');
  assert.equal(reads, 10000);
});

test('define expansion is bounded and ordinary repeated includes retain their current define context', async () => {
  await assert.rejects(parse('#define $value ' + 'a'.repeat(80) + '\n<region> sample=' + '$value'.repeat(5),
    { maxBytes: 256 }), error => error.code === 'too-large');
  const reads = [];
  const texts = new Map([
    ['instrument.sfz', '#define $key 60\n#include "region.inc"\n#define $key 61\n#include "region.inc"'],
    ['region.inc', '<region> sample=tone.wav key=$key']
  ]);
  const result = await parse('', { maxBytes: 1024, readText: async path => {
    reads.push(path); return texts.get(path);
  } });
  assert.deepEqual(result.regions.map(region => region.lokey), [60, 61]);
  assert.deepEqual(reads, ['instrument.sfz', 'region.inc', 'region.inc']);
  assert.deepEqual(result.dependencies, ['instrument.sfz', 'region.inc']);
});

test('unsupported conditions exclude regions and other opcodes/missing samples log once', async () => {
  const messages = [];
  const result = await parse('<group> cutoff=123\n<region> sample=a.wav trigger=release\n' +
    '<region> sample=a.wav locc64=1\n<region> sample=a.wav sw_last=60\n' +
    '<region> sample=gone.wav\n<region> sample=a.wav trigger=attack', {
    hasSample: path => path === 'a.wav', onDiagnostic: detail => messages.push(detail)
  });
  assert.equal(result.regions.length, 1);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].ignoredOpcodes, ['cutoff']);
  assert.deepEqual(messages[0].excludedOpcodes, ['locc64', 'sw_last', 'trigger']);
  assert.deepEqual(messages[0].missingSamples, ['gone.wav']);
});

test('CC conditions keep the pedal-off layer with inherited bounds and region overrides', async () => {
  const result = await parse('<group> hicc64=63 key=60 seq_length=2\n' +
    '<region> sample=off1.wav seq_position=1 lorand=0 hirand=.5\n' +
    '<region> sample=off2.wav seq_position=2 lorand=.5 hirand=1\n' +
    '<region> sample=on.wav locc64=64 hicc64=127');
  assert.deepEqual(result.regions.map(region => region.sample), ['off1.wav', 'off2.wav']);
  assert.deepEqual(result.regions.map(region => [region.seq_length, region.seq_position, region.lorand, region.hirand]),
    [[2, 1, 0, .5], [2, 2, .5, 1]]);
  assert.equal(result.regions[0].seqGroup, result.regions[1].seqGroup);
});

test('instrument initial CC settings select the opposite layer regardless of header order', async () => {
  const result = await parse('<group> key=60\n<region> sample=off.wav hicc64=63\n' +
    '<region> sample=on.wav locc64=64\n<control> set_cc64=127');
  assert.deepEqual(result.regions.map(region => region.sample), ['on.wav']);
});

test('initial CC values use volume, centered pan, expression, and zero for other controllers', async () => {
  for (const [cc, value] of [[7, 100], [10, 64], [11, 127], [1, 0]]) {
    const result = await parse(`<region> sample=match.wav locc${cc}=${value} hicc${cc}=${value}\n` +
      `<region> sample=other.wav locc${cc}=${value === 127 ? 0 : value + 1} hicc${cc}=${value === 127 ? 126 : 127}`);
    assert.deepEqual(result.regions.map(region => region.sample), ['match.wav']);
  }
});

test('initial CC projection does not turn CC, release, or keyswitch events into note attacks', async () => {
  const result = await parse('<group> hicc64=63\n<region> sample=attack.wav trigger=attack\n' +
    '<region> sample=cc.wav on_locc64=0 on_hicc64=127\n' +
    '<region> sample=release.wav trigger=release\n<region> sample=switch.wav sw_last=60');
  assert.deepEqual(result.regions.map(region => region.sample), ['attack.wav']);
  assert.deepEqual(result.diagnostics.excludedOpcodes, ['on_hicc64', 'on_locc64', 'sw_last', 'trigger']);
});

test('group headers clear prior group values while global/master remain inherited', async () => {
  const result = await parse('<global> volume=-3 <master> pan=20 <group> lovel=30 ' +
    '<region> sample=a.wav <group> hivel=80 <region> sample=b.wav');
  assert.deepEqual(result.regions.map(region => [region.lovel, region.hivel, region.volume, region.pan]),
    [[30, 127, -3, 20], [1, 80, -3, 20]]);
  assert.notEqual(result.regions[0].seqGroup, result.regions[1].seqGroup);
});

test('SFZ retains valid regions when local values or paths are invalid', async () => {
  await assert.rejects(parse('#include "instrument.sfz"'), /recursive/);
  const result = await parse('<region> sample=good.wav lovel=0 volume=29.651838\n' +
    '<region> sample=velocity.wav hivel=0\n<region> sample=pan.wav pan=bad\n' +
    '<region> sample=sequence.wav seq_length=0\n<region> sample=transpose.wav transpose=128\n' +
    '<region> sample=gain.wav volume=145\n<region> sample=../escape.wav');
  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0].lovel, 1);
  assert.equal(result.regions[0].volume, 29.651838);
  assert.equal(result.diagnostics.invalidRegions.length, 6);
  for (const path of ['../a.wav', '/a.wav', 'C:\\a.wav']) assert.throws(() => normalizeSfzPath(path), /inside/);
  assert.equal(normalizeSfzPath('../samples/a.wav', 'bank'), 'samples/a.wav');
});

test('explicit keyswitch defaults select one static articulation without enabling dynamic switches', async () => {
  const result = await parse('#define $NATURAL c2\n<global> sw_default=$NATURAL sw_lokey=c2 sw_hikey=c#2\n' +
    '<group> sw_last=c2\n<region> sample=natural.wav\n' +
    '<region> sample=held.wav sw_down=c2\n<group> sw_last=c#2\n<region> sample=other.wav');
  assert.deepEqual(result.regions.map(region => region.sample), ['natural.wav']);
  assert.deepEqual((await parse('<group> sw_last=c2 <region> sample=a.wav')).regions, []);
  assert.equal((await parse('<region> sample=a.wav volume=144')).regions[0].volume, 144);
});

test('bank serialization and IDs are deterministic and include only supplied dependencies', async () => {
  const one = encodeSfzBank('a.sfz', new Map([['sample.wav', new Uint8Array([1, 2])], ['a.sfz', encode('<region> sample=sample.wav')]]));
  const two = encodeSfzBank('a.sfz', new Map([['a.sfz', encode('<region> sample=sample.wav')], ['sample.wav', new Uint8Array([1, 2])]]));
  assert.deepEqual(one, two);
  assert.equal(await identifySfzBank(one), await identifySfzBank(two));
  assert.deepEqual([...decodeSfzBank(one).files.keys()], ['a.sfz', 'sample.wav']);
  assert.throws(() => decodeSfzBank(one.subarray(0, one.length - 1)), /range/);
});

test('sample metadata reads seek over WAV chunk bodies without reading PCM', async () => {
  const bytes = new Uint8Array(1068); const view = new DataView(bytes.buffer);
  bytes.set(encode('RIFF'), 0); bytes.set(encode('WAVEJUNK'), 8); view.setUint32(16, 1000, true);
  bytes.set(encode('fmt '), 1020); view.setUint32(1024, 16, true);
  view.setUint16(1030, 2, true); view.setUint32(1032, 44100, true); view.setUint16(1040, 4, true);
  bytes.set(encode('data'), 1044); view.setUint32(1048, 40000000, true);
  const reads = [];
  const result = await readSfzAudioHeader(async (position, length) => {
    reads.push([position, length]); return bytes.slice(position, position + length);
  }, bytes.length);
  assert.deepEqual(result, { channels: 2, sampleRate: 44100, frames: 10000000 });
  assert.deepEqual(reads, [[0, 12], [12, 8], [1020, 8], [1028, 16], [1044, 8]]);
});

test('SFZ envelope times accept the kernel limit and reject values above it', async () => {
  for (const key of ['ampeg_attack', 'ampeg_hold', 'ampeg_decay', 'ampeg_release']) {
    const { regions } = await parse(`<region> sample=a.wav ${key}=100`);
    assert.equal(regions[0][key], 100);
    const invalid = await parse(`<region> sample=a.wav ${key}=101`);
    assert.equal(invalid.regions.length, 0);
    assert.equal(invalid.diagnostics.invalidRegions.length, 1);
  }
});

test('unused invalid loop points are canonicalized while active loops and playback ranges stay strict', async () => {
  const samples = new Map([['a.wav', { sampleRate: 48000, channels: [new Float32Array(4)] }]]);
  for (const mode of ['', 'loop_mode=no_loop', 'loop_mode=one_shot']) {
    const { regions } = await parse(`<region> sample=a.wav key=60 end=1 ${mode}`);
    const warnings = [];
    const descriptor = packSfzAsset(regions, samples, { onWarning: warning => warnings.push(warning) });
    const integers = new Uint32Array(descriptor.payload, 32);
    assert.equal(integers[8 + SFZ_REGION_FIELDS.indexOf('end')], 1);
    assert.equal(integers[8 + SFZ_REGION_FIELDS.indexOf('loop_end')], 1);
    assert.deepEqual(warnings, []);
    for (const points of [{ loop_end: 4294967295 }, { loop_start: -1 }, { loop_start: 3, loop_end: 2 }]) {
      const repaired = packSfzAsset([{ ...regions[0], ...points }], samples, {
        onWarning: warning => warnings.push(warning)
      });
      const table = new Uint32Array(repaired.payload, 32);
      assert.equal(table[8 + SFZ_REGION_FIELDS.indexOf('loop_start')], 0);
      assert.equal(table[8 + SFZ_REGION_FIELDS.indexOf('loop_end')], 1);
      assert.deepEqual(warnings.pop(), { code: 'loop-points-ignored', count: 1 });
    }
    assert.throws(() => packSfzAsset([{ ...regions[0], offset: 2, loop_end: 4294967295 }], samples), /playback/);
    assert.throws(() => packSfzAsset([{ ...regions[0], end: 4, loop_end: 4294967295 }], samples), /playback/);
  }
  for (const mode of ['loop_continuous', 'loop_sustain']) {
    const { regions } = await parse(`<region> sample=a.wav key=60 end=1 loop_mode=${mode}`);
    assert.throws(() => packSfzAsset([{ ...regions[0], loop_end: 4294967295 }], samples), /loop points/);
  }
});

test('ETA1 mixed table packs inherited defaults, original rates, stereo interleaving and footprint', async () => {
  const { regions } = await parse('<region> sample=a.wav key=60 loop_mode=loop_sustain');
  const descriptor = packSfzAsset(regions, new Map([['a.wav', { sampleRate: 44100,
    channels: [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])] }]]));
  const outer = new DataView(descriptor.payload);
  assert.deepEqual([outer.getUint32(0, true), outer.getUint32(4, true), outer.getUint32(12, true)], [0x31415445, 1, 1]);
  const floats = new Float32Array(descriptor.payload, 32);
  const integers = new Uint32Array(descriptor.payload, 32);
  assert.deepEqual([...integers.slice(0, 8)], [0x53465a, 2, 1, 30, 38, 44, 1, 0]);
  const field = key => 8 + SFZ_REGION_FIELDS.indexOf(key);
  assert.deepEqual([integers[field('sampleFrames')], floats[field('channels')], floats[field('sampleRate')],
    integers[field('end')], integers[field('loop_end')], floats[field('loop_mode')]], [3, 2, 44100, 2, 2, 3]);
  assert.deepEqual([...floats.slice(38)], [1, 4, 2, 5, 3, 6]);
  assert.equal(descriptor.footprintBytes, descriptor.payload.byteLength + 4 * (129 + 2 + 1));
  assert.deepEqual([descriptor.rateDivider, descriptor.headBlock, descriptor.processingChannels], [1, 128, 1]);
});

test('packing rejects unsupported channels, nonfinite PCM, playback ranges, and oversized assets', async () => {
  const { regions } = await parse('<region> sample=a.wav key=60');
  const pcm = channels => new Map([['a.wav', { channels, sampleRate: 48000 }]]);
  assert.throws(() => packSfzAsset(regions, pcm([new Float32Array(2), new Float32Array(2), new Float32Array(2)])), /mono or stereo/);
  assert.throws(() => packSfzAsset(regions, pcm([new Float32Array([NaN])])), /invalid samples/);
  assert.throws(() => packSfzAsset([{ ...regions[0], end: 9 }], pcm([new Float32Array(2)])), /exceed/);
  assert.throws(() => packSfzAsset(regions, pcm([new Float32Array(16777216)]), { maxBytes: 64 * 1024 * 1024 }),
    error => error.code === 'too-large');
});
