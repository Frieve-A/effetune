import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSfz, normalizeSfzPath } from '../../js/sfz/parser.js';
import { decodeSfzBank, encodeSfzBank, identifySfzBank, readSfzAudioHeader } from '../../js/sfz/bank.js';
import { packSfzAsset, sfzAssetTailSeconds, SFZ_REGION_FIELDS, SFZ_TABLE_VERSION } from '../../js/sfz/asset.js';
import { SFZ_CONTROLLER_FAMILIES, sfzControllerValue } from '../../js/sfz/schema.js';
import { compileSfzScriptAsync } from '../../js/sfz/script-worker.js';

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

test('dynamic conditions retain regions while unknown opcodes and missing samples log once', async () => {
  const messages = [];
  const result = await parse('<group> cutoff=123 unknown_effect=1\n<region> sample=a.wav trigger=release\n' +
    '<region> sample=a.wav locc64=1\n<region> sample=a.wav sw_last=60\n' +
    '<region> sample=gone.wav\n<region> sample=a.wav trigger=attack', {
    hasSample: path => path === 'a.wav', onDiagnostic: detail => messages.push(detail)
  });
  assert.equal(result.regions.length, 4);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].ignoredOpcodes, ['unknown_effect']);
  assert.deepEqual(messages[0].excludedOpcodes, []);
  assert.deepEqual(messages[0].missingSamples, ['gone.wav']);
});

test('CC conditions retain both pedal layers and preserve inherited bounds and sequence groups', async () => {
  const result = await parse('<group> hicc64=63 key=60 seq_length=2\n' +
    '<region> sample=off1.wav seq_position=1 lorand=0 hirand=.5\n' +
    '<region> sample=off2.wav seq_position=2 lorand=.5 hirand=1\n' +
    '<region> sample=on.wav locc64=64 hicc64=127');
  assert.deepEqual(result.regions.map(region => region.sample), ['off1.wav', 'off2.wav', 'on.wav']);
  assert.deepEqual(result.regions.map(region => [region.seq_length, region.seq_position, region.lorand, region.hirand]),
    [[2, 1, 0, .5], [2, 2, .5, 1], [2, 1, 0, 1]]);
  assert.deepEqual(result.regions.map(region => [sfzControllerValue(region, 'locc', 64),
    sfzControllerValue(region, 'hicc', 64)]), [[0, 63], [0, 63], [64, 127]]);
  assert.equal(result.regions[0].seqGroup, result.regions[1].seqGroup);
});

test('instrument initial CC settings remain runtime state regardless of header order', async () => {
  const result = await parse('<group> key=60\n<region> sample=off.wav hicc64=63\n' +
    '<region> sample=on.wav locc64=64\n<control> set_cc64=127');
  assert.deepEqual(result.regions.map(region => region.sample), ['off.wav', 'on.wav']);
  assert.deepEqual(result.regions.map(region => region.set_cc64), [127, 127]);
});

test('external bank defines expand opcode names and local SFZ defines take priority', async () => {
  const result = await parse('#define $key 61\n<group> sustain_sw=off sostenuto_sw=on\n' +
    '<region> sample=tone$extension key=$key locc$cc=0 hicc$cc=64', {
    defines: new Map([['$key', '60'], ['$extension', '.flac'], ['$cc', '64']])
  });
  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0].sample, 'tone.flac');
  assert.equal(result.regions[0].lokey, 61);
  assert.deepEqual(result.diagnostics.ignoredOpcodes, []);
  assert.deepEqual(result.modulation.diagnostics, []);
  assert.equal(result.regions[0].opcodes.sustain_sw, 'off');
  assert.equal(result.regions[0].opcodes.sostenuto_sw, 'on');
});

test('CC conditions are never frozen against initial channel values', async () => {
  for (const [cc, value] of [[7, 100], [10, 64], [11, 127], [1, 0]]) {
    const result = await parse(`<region> sample=match.wav locc${cc}=${value} hicc${cc}=${value}\n` +
      `<region> sample=other.wav locc${cc}=${value === 127 ? 0 : value + 1} hicc${cc}=${value === 127 ? 126 : 127}`);
    assert.deepEqual(result.regions.map(region => region.sample), ['match.wav', 'other.wav']);
    assert.equal(result.regions[0][`locc${cc}`], value);
  }
});

test('CC, release and keyswitch trigger semantics remain distinct in compiled regions', async () => {
  const result = await parse('<group> hicc64=63\n<region> sample=attack.wav trigger=attack\n' +
    '<region> sample=cc.wav on_locc64=0 on_hicc64=127\n' +
    '<region> sample=release.wav trigger=release\n<region> sample=switch.wav sw_last=60');
  assert.deepEqual(result.regions.map(region => region.sample), ['attack.wav', 'cc.wav', 'release.wav', 'switch.wav']);
  assert.deepEqual(result.regions.map(region => region.trigger), [0, 0, 1, 0]);
  assert.equal(result.regions[1].on_locc64, 0);
  assert.equal(result.regions[3].sw_last, 60);
  assert.deepEqual(result.diagnostics.excludedOpcodes, []);
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

test('keyswitch defaults and all dynamic articulations survive parsing', async () => {
  const result = await parse('#define $NATURAL c2\n<global> sw_default=$NATURAL sw_lokey=c2 sw_hikey=c#2\n' +
    '<group> sw_last=c2\n<region> sample=natural.wav\n' +
    '<region> sample=held.wav sw_down=c2\n<group> sw_last=c#2\n<region> sample=other.wav');
  assert.deepEqual(result.regions.map(region => region.sample), ['natural.wav', 'held.wav', 'other.wav']);
  assert.deepEqual(result.regions.map(region => region.sw_default), [36, 36, 36]);
  assert.equal((await parse('<group> sw_last=c2 <region> sample=a.wav')).regions[0].sw_last, 36);
  assert.equal((await parse('<region> sample=a.wav volume=144')).regions[0].volume, 144);
});

test('keyswitch range conditions remain dynamic without reporting unsupported layers', async () => {
  const result = await parse('<global> sw_default=24\n' +
    '<group> sw_lolast=24 sw_hilast=24\n<region> sample=single.wav\n' +
    '<group> sw_lolast=26 sw_hilast=28\n<region> sample=other.wav');
  assert.deepEqual(result.regions.map(region => region.sample), ['single.wav', 'other.wav']);
  assert.deepEqual(result.regions.map(region => [region.sw_lolast, region.sw_hilast]), [[24, 24], [26, 28]]);
  assert.deepEqual(result.warnings, []);
});

test('compiled MIDI conditions validate channel/CC bounds and aliases share the same lane', async () => {
  const result = await parse('<global> volume_cc001=6\n<group> lochan=2 hichan=3 sw_previous=c3\n' +
    '<region> sample=valid.wav locc1=4 hicc1=120 pitch_oncc1=1200 fil_type=lpf_2p\n' +
    '<region> sample=bad-channel.wav lochan=0\n<region> sample=bad-range.wav locc2=100 hicc2=50\n' +
    '<region> sample=bad-key.wav sw_last=128\n<region> sample=bad-enum.wav trigger=madeup');
  assert.equal(result.regions.length, 1);
  assert.equal(result.diagnostics.invalidRegions.length, 4);
  const region = result.regions[0];
  assert.deepEqual([region.lochan, region.hichan, region.sw_previous, region.volume_oncc1, region.pitch_oncc1, region.fil_type],
    [2, 3, 48, 6, 1200, 2]);
  assert.equal(result.unsupportedOpcodes.length, 0);
  const extended = await parse('<region> sample=a.wav volume_oncc128=4');
  assert.deepEqual(extended.unsupportedOpcodes, []);
  assert.ok(extended.modulation.regions[0].routes.some(route => route.sourceA === (0x10000 | 128)));
});

test('classic envelope/LFO/sample lanes preserve defaults and curve validation remains explicit', async () => {
  const source = '<curve> curve_index=1 v000=0 v127=1\n<global> pitcheg_depth=1200 pitcheg_attack=.2\n' +
    '<group> fileg_depth=-2400 fillfo_freq=4 fillfo_depth=200\n' +
    '<region> sample=a.wav direction=reverse loop_count=3 loop_crossfade=.01';
  const result = await parse(source);
  const region = result.regions[0];
  assert.deepEqual([region.pitcheg_sustain, region.fileg_sustain, region.pitcheg_depth, region.pitcheg_attack,
    region.fileg_depth, region.fillfo_freq, region.fillfo_depth, region.direction, region.loop_count, region.loop_crossfade],
    [0, 0, 1200, .2, -2400, 4, 200, 1, 3, .01]);
  assert.deepEqual(result.diagnostics.unsupportedHeaders, []);
  assert.equal(result.modulation.diagnostics[0].code, 'curve-index');
  assert.equal(result.headers[0].opcodes.v127, '1');
  assert.ok(result.source.includes('<curve>'));
  const packed = packSfzAsset([region], new Map([['a.wav', { sampleRate: 48000, channels: [new Float32Array(8)] }]]));
  const floats = new Float32Array(packed.payload, 32);
  assert.equal(floats[12 + SFZ_REGION_FIELDS.indexOf('pitcheg_depth')], 1200);
  assert.equal(floats[12 + SFZ_REGION_FIELDS.indexOf('direction')], 1);
});

test('documented aliases select identical compiled semantic lanes without accepting a second filter as an alias', async () => {
  const canonical = await parse('<region> sample=a.wav loop_count=2 loop_start=1 loop_end=7 loop_mode=loop_continuous ' +
    'group=2 off_by=3 off_mode=normal bend_up=400 bend_down=-300 tune=12 fil_type=lpf_2p ' +
    'ampeg_attack=.1 fileg_depth=200 pitcheg_release=.3 volume_oncc7=6 pitch_oncc1=1200 on_locc64=100');
  const aliases = await parse('<region> sample=a.wav loopcount=2 loopstart=1 loopend=7 loopmode=loop_continuous ' +
    'polyphony_group=2 offby=3 offmode=normal bendup=400 benddown=-300 pitch=12 filtype=lpf_2p ' +
    'amp_attack=.1 fil_depth=200 pitch_release=.3 gain_cc7=6 tune_oncc1=1200 start_locc64=100');
  assert.deepEqual(aliases.regions, canonical.regions);
  assert.deepEqual(aliases.unsupportedOpcodes, []);
  const second = await parse('<region> sample=a.wav cutoff2=1000 fil2_type=lpf_2p');
  assert.deepEqual(second.unsupportedOpcodes, []);
  assert.ok(second.modulation.regions[0].instances.some(instance => instance.kind === 12 && instance.index === 2));
});

test('group labels preserve presentation metadata without claiming unsupported audio behavior', async () => {
  const source = '<global> group_label=Instrument Info\n<group> group_label=Long Notes\n' +
    '<region> sample=tone.wav\n<group> group_label=Short Notes\n<region> sample=tone.wav';
  const result = await parse(source);
  assert.deepEqual(result.unsupportedOpcodes, []);
  assert.deepEqual(result.regions.map(region => region.opcodes.group_label), ['Long Notes', 'Short Notes']);
  assert.equal(result.headers[0].opcodes.group_label, 'Instrument Info');
  assert.equal(result.headers[1].opcodes.group_label, 'Long Notes');
  assert.ok(result.source.includes('group_label=Long Notes'));
  const unsupported = await parse('<group> group_label=Long Notes ampeg_attack_curvecc1=2\n<region> sample=tone.wav');
  assert.deepEqual(unsupported.unsupportedOpcodes, []);
  assert.ok(unsupported.modulation.regions[0].routes.some(route => route.curveA === 2));
});

test('ampeg_dynamic preserves its flag and leaves constant envelope coefficients unchanged', async () => {
  const definition = '<global> ampeg_delay=.01 ampeg_start=3 ampeg_attack=.02 ampeg_hold=.03 ' +
    'ampeg_decay=.04 ampeg_sustain=60 ampeg_release=.05\n<group> group_label=Long Notes\n<region> sample=tone.wav';
  const samples = new Map([['tone.wav', { sampleRate: 48000, channels: [new Float32Array([1, .5, 0, -.5])] }]]);
  const plain = await parse(definition);
  const original = packSfzAsset(plain.regions, samples);
  for (const flag of [0, 1]) {
    const result = await parse(definition.replace('<global>', `<global> ampeg_dynamic=${flag}`));
    assert.deepEqual(result.unsupportedOpcodes, []);
    assert.equal(result.regions[0].opcodes.ampeg_dynamic, String(flag));
    assert.equal(result.headers[0].opcodes.ampeg_dynamic, String(flag));
    assert.ok(result.source.includes(`ampeg_dynamic=${flag}`));
    assert.equal(result.regions[0].ampeg_dynamic, flag);
    const packed = new Uint32Array(packSfzAsset(result.regions, samples).payload, 32);
    const baseline = new Uint32Array(original.payload, 32);
    const dynamic = 12 + SFZ_REGION_FIELDS.indexOf('ampeg_dynamic');
    assert.equal(new Float32Array(packed.buffer, 32)[dynamic], flag);
    packed[dynamic] = baseline[dynamic];
    assert.deepEqual(packed, baseline);
  }
  for (const dependency of ['ampeg_attack_curvecc1=2', 'ampeg_vel2attack=.5', 'amp_vel2attack=.5']) {
    const result = await parse(`<global> ampeg_dynamic=1 ${dependency}\n<group>\n<region> sample=tone.wav`);
    assert.deepEqual(result.unsupportedOpcodes, [], dependency);
    assert.deepEqual(result.modulation.diagnostics, [], dependency);
  }
  assert.deepEqual((await parse('<region> sample=tone.wav ampeg_unknown=1')).unsupportedOpcodes, ['ampeg_unknown']);
  const repaired = await parse('<global> ampeg_dynamic=1 ampeg_attack=200\n<region> sample=tone.wav');
  assert.equal(repaired.regions[0].ampeg_attack, 100);
  assert.deepEqual(repaired.warnings, [{ code: 'envelope-times-adjusted', count: 1 }]);
  for (const flag of ['2', '-1', '.5', 'on']) {
    const invalid = await parse(`<global> ampeg_dynamic=${flag}\n<region> sample=tone.wav`);
    assert.equal(invalid.regions.length, 0);
    assert.equal(invalid.diagnostics.invalidRegions.length, 1);
  }
});

test('amplitude CC and three-band EQ routes inherit, normalize aliases and serialize sparse ABI IDs', async () => {
  const source = '<global> ampeg_dynamic=1 ampeg_attackcc001=.5 eq1_freq=700 eq1_gain=-6\n' +
    '<group> ampeg_release_oncc64=2 eq2_bw=.4 eq2_gaincc11=12\n' +
    '<region> sample=tone.wav eq3_freq_oncc127=-15000 eq3_gain=3';
  const parsed = await parse(source);
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  const region = parsed.regions[0];
  assert.deepEqual([region.ampeg_dynamic, region.ampeg_attack_oncc1, region.ampeg_release_oncc64,
    region.eq1_freq, region.eq1_gain, region.eq2_bw, region.eq2_gain_oncc11, region.eq3_freq_oncc127],
  [1, .5, 2, 700, -6, .4, 12, -15000]);
  assert.equal(region.opcodes.ampeg_attack_oncc1, '.5');
  assert.equal(Object.keys(region).filter(key => /(?:cc|oncc)[0-9]+$/.test(key)).length, 4);
  assert.ok(parsed.source.includes('ampeg_attackcc001=.5'));
  const asset = packSfzAsset(parsed.regions, new Map([['tone.wav', {
    sampleRate: 48000, channels: [new Float32Array([1, 0])]
  }]]));
  const words = new Uint32Array(asset.payload, 32), floats = new Float32Array(asset.payload, 32);
  assert.equal(SFZ_REGION_FIELDS.length, 113);
  assert.equal(SFZ_REGION_FIELDS.indexOf('ampeg_dynamic'), 101);
  assert.equal(SFZ_REGION_FIELDS.indexOf('controlOffset'), 111);
  assert.equal(words[1], 6);
  assert.equal(words[7], 8);
  const offset = words[12 + 111];
  assert.deepEqual(Array.from({ length: 4 }, (_, index) => [words[offset + index * 2], floats[offset + index * 2 + 1]]),
    [[12 * 512 + 1, .5], [16 * 512 + 64, 2], [22 * 512 + 11, 12], [23 * 512 + 127, -15000]]);
  const prefixes = Object.keys(SFZ_CONTROLLER_FAMILIES);
  for (const prefix of prefixes.slice(10)) {
    const base = prefix.replace('_oncc', '');
    for (const spelling of [`${base}cc127`, `${base}_oncc127`]) {
      const result = await parse(`<region> sample=tone.wav ${spelling}=.25`);
      assert.equal(result.regions[0][`${prefix}127`], .25, spelling);
      assert.deepEqual(result.unsupportedOpcodes, []);
    }
  }
});

test('sparse controller defaults match explicit defaults without expanding each region', async () => {
  const implicit = await parse('<region> sample=tone.wav');
  const explicit = await parse('<region> sample=tone.wav locc1=0 hicc1=127 ampeg_attackcc1=0 eq3_gaincc127=0');
  assert.equal(Object.hasOwn(implicit.regions[0], 'locc1'), false);
  assert.equal(sfzControllerValue(implicit.regions[0], 'hicc', 1), 127);
  assert.equal(sfzControllerValue(implicit.regions[0], 'set_cc', 1), -1);
  const samples = new Map([['tone.wav', { sampleRate: 48000, channels: [new Float32Array([1, 0])] }]]);
  assert.deepEqual(packSfzAsset(implicit.regions, samples).payload, packSfzAsset(explicit.regions, samples).payload);
  assert.throws(() => packSfzAsset([{ ...implicit.regions[0], ampeg_attack_oncc1: NaN }], samples), /controller/);
});

test('global script dependencies are relative to the selected definition and survive compiled packing', async () => {
  const sources = new Map([
    ['bank/instrument.sfz', '<control> default_path=samples/\n<global> script=old.txt\nscript=scripts/play.txt\n<region> sample=tone.wav'],
    ['bank/scripts/play.txt', 'on note\n ignore_event($EVENT_ID)\n play_note($EVENT_NOTE + 12, $EVENT_VELOCITY)\nend on']
  ]);
  const parsed = await parse('', { selectedPath: 'bank/instrument.sfz', readText: async name => sources.get(name) });
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  assert.deepEqual(parsed.dependencies, ['bank/instrument.sfz', 'bank/scripts/play.txt']);
  assert.equal(parsed.script.path, 'bank/scripts/play.txt');
  assert.equal(parsed.regions[0].opcodes.script, 'scripts/play.txt');
  const script = await compileSfzScriptAsync(parsed.script.source);
  assert.deepEqual(script.requiredBuiltins, ['ignore_event', 'play_note']);
  const packed = packSfzAsset(parsed.regions, new Map([['bank/samples/tone.wav', {
    sampleRate: 48000, channels: [new Float32Array([1, 0])]
  }]]), { script });
  const words = new Uint32Array(packed.payload, 32);
  assert.equal(words[9], script.bytes.byteLength);
  assert.equal(words[4], words[8] + words[9] / 4);
  assert.deepEqual(new Uint8Array(packed.payload, 32 + words[8] * 4, words[9]), script.bytes);
  assert.equal(packed.tailSeconds, null, 'A script can schedule future audio beyond the last MIDI event');
  const invalidScope = await parse('<control> script=play.txt\n<region> sample=tone.wav');
  assert.deepEqual(invalidScope.unsupportedOpcodes, ['script']);
  assert.equal(invalidScope.script, null);
  await assert.rejects(parse('<global> script=missing.txt\n<region> sample=tone.wav'), { code: 'prepare' });
  await assert.rejects(compileSfzScriptAsync('on note\nunknown_function()\nend on'), { code: 'script-invalid' });
});

test('amplitude CC and EQ parameters validate public domains without accepting unrelated indexed routes', async () => {
  for (const opcode of ['ampeg_attackcc1=101', 'ampeg_start_oncc1=-101', 'eq1_freq=30001', 'eq2_bw=0',
    'eq3_gain=25', 'eq1_freqcc1=-30001', 'eq2_bwcc1=4.01', 'eq3_gaincc1=-97']) {
    const result = await parse(`<region> sample=tone.wav ${opcode}`);
    assert.equal(result.regions.length, 0, opcode);
    assert.equal(result.diagnostics.invalidRegions.length, 1, opcode);
  }
  const unsupported = await parse('<region> sample=tone.wav ampeg_attackcc128=1 eq4_freq=100 ' +
    'eq1_gain_curvecc1=2 eq2_vel2freq=1');
  assert.deepEqual(unsupported.unsupportedOpcodes,
    ['eq4_freq']);
});

test('v6 tail proof includes maximum positive amplitude delay/release CC sums and rejects future ABI', async () => {
  const result = await parse('<region> sample=tone.wav key=60 delay=.3 delay_random=.2 ampeg_delay=.25 ' +
    'ampeg_delaycc1=2 ampeg_delaycc2=-3 ampeg_release=.5 ampeg_releasecc64=4 eq1_gain=12');
  const bank = packSfzAsset(result.regions, new Map([['tone.wav', {
    sampleRate: 48000, channels: [new Float32Array([1, 0])]
  }]]));
  assert.ok(bank.tailSeconds >= 7.25 && bank.tailSeconds < 7.251);
  const future = bank.payload.slice(0);
  new Uint32Array(future, 32)[1]++;
  assert.equal(sfzAssetTailSeconds(future), null);
  const capped = await parse('<region> sample=tone.wav ampeg_delay=10 ampeg_delaycc1=100 ' +
    'ampeg_release=10 ampeg_releasecc1=100 ampeg_releasecc2=100');
  assert.equal(packSfzAsset(capped.regions, new Map([['tone.wav', {
    sampleRate: 48000, channels: [new Float32Array([1, 0])]
  }]])).tailSeconds, 200);
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

test('SFZ invalid envelope times are repaired within playback limits and reported without discarding sounds', async () => {
  for (const key of ['ampeg_attack', 'ampeg_hold', 'ampeg_decay', 'ampeg_release']) {
    const { regions } = await parse(`<region> sample=a.wav ${key}=100`);
    assert.equal(regions[0][key], 100);
    for (const [value, expected] of [['163.6', 100], ['-1', 0], ['bad', key === 'ampeg_release' ? .001 : 0]]) {
      const repaired = await parse(`<region> sample=a.wav ${key}=${value}`);
      assert.equal(repaired.regions.length, 1);
      assert.equal(repaired.regions[0][key], expected);
      assert.deepEqual(repaired.warnings, [{ code: 'envelope-times-adjusted', count: 1 }]);
      assert.equal(repaired.diagnostics.adjustedEnvelopes.length, 1);
    }
  }
});

test('unused invalid loop points are canonicalized while active loops and playback ranges stay strict', async () => {
  const samples = new Map([['a.wav', { sampleRate: 48000, channels: [new Float32Array(4)] }]]);
  for (const mode of ['', 'loop_mode=no_loop', 'loop_mode=one_shot']) {
    const { regions } = await parse(`<region> sample=a.wav key=60 end=1 ${mode}`);
    const warnings = [];
    const descriptor = packSfzAsset(regions, samples, { onWarning: warning => warnings.push(warning) });
    const integers = new Uint32Array(descriptor.payload, 32);
    assert.equal(integers[12 + SFZ_REGION_FIELDS.indexOf('end')], 1);
    assert.equal(integers[12 + SFZ_REGION_FIELDS.indexOf('loop_end')], 1);
    assert.deepEqual(warnings, []);
    for (const points of [{ loop_end: 4294967295 }, { loop_start: -1 }, { loop_start: 3, loop_end: 2 }]) {
      const repaired = packSfzAsset([{ ...regions[0], ...points }], samples, {
        onWarning: warning => warnings.push(warning)
      });
      const table = new Uint32Array(repaired.payload, 32);
      assert.equal(table[12 + SFZ_REGION_FIELDS.indexOf('loop_start')], 0);
      assert.equal(table[12 + SFZ_REGION_FIELDS.indexOf('loop_end')], 1);
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
  const poolOffset = 12 + SFZ_REGION_FIELDS.length;
  assert.deepEqual([...integers.slice(0, 12)], [0x53465a, SFZ_TABLE_VERSION, 1, SFZ_REGION_FIELDS.length, poolOffset, poolOffset + 6, 1, 0, poolOffset, 0, 0, 0]);
  const field = key => 12 + SFZ_REGION_FIELDS.indexOf(key);
  assert.deepEqual([integers[field('sampleFrames')], floats[field('channels')], floats[field('sampleRate')],
    integers[field('end')], integers[field('loop_end')], floats[field('loop_mode')]], [3, 2, 44100, 2, 2, 3]);
  assert.deepEqual([...floats.slice(poolOffset)], [1, 4, 2, 5, 3, 6]);
  assert.equal(descriptor.footprintBytes, descriptor.payload.byteLength);
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
