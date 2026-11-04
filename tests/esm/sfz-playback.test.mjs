import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSfz, resolveSfzRegionOffset } from '../../js/sfz/parser.js';
import { packSfzModulation } from '../../js/sfz/modulation.js';
import { packSfzAsset, SFZ_REGION_FIELDS, SFZ_TABLE_HEADER_WORDS } from '../../js/sfz/asset.js';
import { SFZ_MOD_KINDS as K, SFZ_MOD_PROPERTY_IDS as P, SFZ_MOD_ROUTE_FLAGS as Flags } from '../../js/sfz/modulation-schema.js';
const parse = source => parseSfz({ selectedPath: 'playback.sfz', readText: async () => source,
  hasSample: () => true, onDiagnostic: null });
const value = (parsed, kind, property, index = 0) => {
  const region = parsed.modulation.regions[0];
  return region.parameters.find(parameter => parameter.property === property &&
    region.instances[parameter.instance].kind === kind && region.instances[parameter.instance].index === index)?.value;
};

test('beat scheduling and sample lifecycle normalize used instances and public string values', async () => {
  const parsed = await parse('<group> sync_beats=4 sync_offset=1 sustain_lo=64 <region> sample=a.wav ' +
    'delay_beats=0.25 stop_beats=1 delay_samples=48 sample_fadeout=0.1 loop_type=alternate ' +
    'note_selfmask=off rt_dead=on sustain_sw=off sw_vel=previous polyphony_stealing=1');
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  assert.deepEqual(parsed.modulation.diagnostics, []);
  assert.equal(value(parsed, K.SamplePlayback, P.SyncBeats), 4);
  assert.equal(value(parsed, K.SamplePlayback, P.LoopType), 2);
  assert.equal(value(parsed, K.Lifecycle, P.SustainLow), 64);
  assert.equal(value(parsed, K.Lifecycle, P.SostenutoLow), .5);
  assert.equal(value(parsed, K.Lifecycle, P.SwitchVelocity), 1);
  assert.equal(value(parsed, K.Lifecycle, P.NoteSelfMask), 0);
  assert.doesNotThrow(() => packSfzModulation(parsed.modulation));
});

test('static addresses stay exact and CC address contributions are deltas', async () => {
  const plain = await parse('<region> sample=a.wav offset=16777217 loop_start=16777219 delay=1 loop_count=2');
  assert.ok(!plain.modulation.regions[0].instances.some(instance => instance.kind === K.SamplePlayback));
  assert.equal(plain.regions[0].offset, 16777217);
  const parsed = await parse('<region> sample=a.wav offset=25.5 offset_mode=percent offset_cc1=50 ' +
    'loop_start=100 loop_startcc2=-50 loop_lengthcc3=200');
  assert.deepEqual(parsed.modulation.diagnostics, []);
  assert.equal(resolveSfzRegionOffset(parsed.regions[0], 1000), 255);
  assert.equal(value(parsed, K.SamplePlayback, P.Offset), 0);
  assert.equal(value(parsed, K.SamplePlayback, P.LoopStartDelta), 0);
  const region = parsed.modulation.regions[0];
  assert.deepEqual(region.routes.filter(route => region.instances[region.parameters[route.target].instance].kind === K.SamplePlayback)
    .map(route => [region.parameters[route.target].property, route.depth]), [[P.Offset, 50], [P.LoopStartDelta, -50], [P.LoopEndDelta, 200]]);
});

test('release segments retain negative authored rates and independent note-age stages', async () => {
  const parsed = await parse('<region> sample=a.wav trigger=release rt_decay1=-9 rt_decay1_time=2 ' +
    'rt_decay2=4 rt_decay2_time=1 rt_decay3=9 off_shape=-3.8 off_curve=0');
  assert.deepEqual(parsed.modulation.diagnostics, []);
  assert.equal(value(parsed, K.ReleaseDecaySegment, P.ReleaseDecay, 1), -9);
  assert.equal(value(parsed, K.ReleaseDecaySegment, P.Time, 3), -1);
  assert.equal(value(parsed, K.Lifecycle, P.OffShape), -3.8);
});

test('unknown enums and out-of-range integer controls cannot silently compile', async () => {
  for (const body of ['polyphony_stealing=2', 'off_curve=3', 'loop_type=reverse', 'sustain_lo=128',
    'sustain_cc=1.5', 'count=4294967297', 'delay_samples=-1', 'offset_mode=unknown']) {
    const parsed = await parse(`<region> sample=a.wav ${body}`);
    assert.ok(parsed.modulation.diagnostics.length, body);
    assert.throws(() => packSfzModulation(parsed.modulation));
  }
});

test('full-width integer settings use exact raw words instead of float rounding', async () => {
  for (const exact of [16777217, 0xffffffff, 0x100000000]) {
    const parsed = await parse(`<region> sample=a.wav count=${exact} offset_random=${exact} delay_samples=${exact}`);
    assert.deepEqual(parsed.modulation.diagnostics, []);
    const packed = packSfzModulation(parsed.modulation), words = new Uint32Array(packed.buffer);
    for (const property of [P.PlayCount, P.OffsetRandom, P.DelaySamples]) {
      const index = parsed.modulation.regions[0].parameters.findIndex(parameter => parameter.property === property);
      const at = words[10] + index * 4;
      assert.equal(words[at + 2] + words[at + 3] * 0x100000000, exact);
    }
  }
  const parsed = await parse('<region> sample=a.wav oscillator=on oscillator_table_size=4294967295');
  assert.deepEqual(parsed.modulation.diagnostics, []);
  const packed = packSfzModulation(parsed.modulation), words = new Uint32Array(packed.buffer);
  const index = parsed.modulation.regions[0].parameters.findIndex(parameter => parameter.property === P.OscillatorTableSize);
  assert.equal(words[words[10] + index * 4 + 2], 0xffffffff);
  assert.equal(words[words[10] + index * 4 + 3], 0);
});

test('integer sample-delay controller depths retain exact signed magnitude', async () => {
  for (const exact of [16777217, 0xffffffff, 0x100000000, -16777217, -0x100000000]) {
    const parsed = await parse(`<region> sample=a.wav delay_samples_oncc1=${exact}`);
    assert.deepEqual(parsed.modulation.diagnostics, []);
    const region = parsed.modulation.regions[0], index = region.routes.findIndex(route => route.flags & Flags.IntegerDepth);
    const words = new Uint32Array(packSfzModulation(parsed.modulation).buffer), at = words[6] + index * 10;
    const flags = words[at + 8];
    const decoded = (words[at + 3] + (flags & Flags.IntegerHigh ? 0x100000000 : 0)) * (flags & Flags.IntegerNegative ? -1 : 1);
    assert.equal(decoded, exact);
  }
});

test('sample-unit offset controller depth is exact while percent mode stays continuous', async () => {
  for (const opcode of ['offset_cc1', 'offset_oncc1']) {
    const parsed = await parse(`<region> sample=a.wav ${opcode}=16777217`);
    const route = parsed.modulation.regions[0].routes.find(route => route.sourceA === 0x10001);
    assert.ok(route.flags & Flags.IntegerDepth);
    assert.equal(route.depth, 16777217);
  }
  const percent = await parse('<region> sample=a.wav offset_mode=percent offset_oncc1=12.5');
  const route = percent.modulation.regions[0].routes.find(route => route.sourceA === 0x10001);
  assert.equal(route.flags & Flags.IntegerDepth, 0);
  assert.equal(route.depth, 12.5);
});

test('high resolution controller defaults preserve normalized values and effective source order', async () => {
  const parsed = await parse('<control> set_cc1=12 set_realcc1=0.5 set_hdcc2=0.25 set_cc2=100 ' +
    '<region> sample=a.wav <control> set_hdcc3=0.123456 <region> sample=b.wav');
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  assert.deepEqual(parsed.modulation.diagnostics, []);
  for (const [index, region] of parsed.modulation.regions.entries()) {
    const controllers = region.instances.filter(instance => instance.kind === K.InitialController);
    assert.deepEqual(controllers.map(instance => instance.index), [1, 3]);
    const initial = cc => region.parameters.find(parameter => parameter.property === P.InitialValue &&
      region.instances[parameter.instance].index === cc).value;
    assert.equal(initial(1), .5); assert.equal(initial(3), .123456);
    assert.equal(parsed.regions[index].set_cc1, 64);
    assert.equal(parsed.regions[index].set_cc2, 100);
  }
  await assert.rejects(parse('<control> set_hdcc1=1.1 <region> sample=a.wav'), { code: 'prepare' });
});

test('per-voice DSP and noise destinations use the agreed independent typed controls', async () => {
  const parsed = await parse('<region> sample=a.wav dsp_order=14 drive=25 bitred=5 decim=10 ' +
    'noise_level=6 noise_tone=80 noise_step=4 noise_stereo=off noise_filter=hpf_2p ' +
    'eg1_driveshape=50 eg1_time1=1 eg1_level1=1 lfo1_noiselevel=20 lfo1_freq=2');
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  assert.deepEqual(parsed.modulation.diagnostics, []);
  assert.equal(value(parsed, K.VoiceDSP, P.DspOrder), 14);
  assert.equal(value(parsed, K.VoiceDSP, P.Drive), 25);
  assert.equal(value(parsed, K.NoiseLayer, P.NoiseLevel), 6);
  assert.equal(value(parsed, K.NoiseLayer, P.NoiseFilter), 4);
  assert.equal(value(parsed, K.NoiseLayer, P.NoiseStereo), 0);
  assert.doesNotThrow(() => packSfzModulation(parsed.modulation));
});

test('scope gains inherit each named scope and reset with new group/master/global headers', async () => {
  const parsed = await parse('<global> global_volume=-6 global_amplitude=50 ' +
    '<master> master_volume=-3 master_amplitude=50 <group> group_volume=-1 group_amplitude=50 ' +
    '<region> sample=a.wav volume=2 amplitude=75 <region> sample=a.wav group_volume=2 ' +
    '<group> group_volume=-2 <region> sample=a.wav <master> master_volume=-4 <region> sample=a.wav ' +
    '<global> global_volume=-1 <region> sample=a.wav');
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  assert.deepEqual(parsed.modulation.diagnostics, []);
  const root = property => parsed.modulation.regions.map(region => region.parameters.find(parameter =>
    parameter.property === property && region.instances[parameter.instance].kind === K.Region).value);
  assert.deepEqual(root(P.ScopeVolume), [-10, -7, -11, -10, -1]);
  assert.deepEqual(root(P.ScopeAmplitude), [12.5, 12.5, 25, 50, 100]);
  assert.equal(root(P.Volume)[0], 2);
  assert.equal(root(P.Amplitude)[0], 75);
});

test('full signed32 exclusive-group identities pack without precision collisions or zero aliasing', async () => {
  const pairs = [[0, 0], [-2147483648, 2147483647], [2147483647, -2147483648], [16777216, 16777217], [16777217, 16777216]];
  const parsed = await parse(pairs.map(([group, off]) => `<region> sample=a.wav group=${group} off_by=${off}`).join(' '));
  assert.deepEqual(parsed.regions.map(region => [region.group, region.off_by]), pairs);
  const asset = packSfzAsset(parsed.regions, new Map([['a.wav', { sampleRate: 48000, channels: [new Float32Array(8)] }]]),
    { modulation: parsed.modulation });
  const floats = new Float32Array(asset.payload, 32), row = SFZ_REGION_FIELDS.length;
  const get = (region, name) => floats[SFZ_TABLE_HEADER_WORDS + region * row + SFZ_REGION_FIELDS.indexOf(name)];
  assert.equal(get(0, 'group'), 0); assert.equal(get(0, 'off_by'), 0);
  for (const [a, b] of [[1, 2], [3, 4]]) {
    assert.equal(get(a, 'group'), get(b, 'off_by'));
    assert.equal(get(b, 'group'), get(a, 'off_by'));
    assert.notEqual(get(a, 'group'), get(b, 'group'));
  }
  assert.equal(new Set(pairs.map((_, index) => get(index, 'group'))).size, 5);
  assert.deepEqual(parsed.regions.map(region => [region.group, region.off_by]), pairs, 'Authored metadata remains unchanged');
});

test('sample delay CC, reverse conditions and full uint32 loop limits have real prepared destinations', async () => {
  const parsed = await parse('<region> sample=a.wav delay=0.25 delay_cc1=0.5 delay_curvecc1=1 ' +
    'reverse_locc2=64 reverse_hicc2=127 loopcount=4294967295 looptype=alternate looptune=1200');
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  assert.deepEqual(parsed.modulation.diagnostics, []);
  assert.equal(parsed.regions[0].delay, .25);
  assert.equal(value(parsed, K.SamplePlayback, P.Delay), 0, 'Only controller delta enters the generic delay slot');
  assert.equal(value(parsed, K.SamplePlayback, P.LoopRepeatLimit), 0xffffffff);
  assert.equal(value(parsed, K.SamplePlayback, P.LoopRepeatLimited), 1);
  assert.equal(value(parsed, K.ReverseController, P.ReverseLow, 2), 64);
  assert.equal(value(parsed, K.SamplePlayback, P.LoopType), 2);
  const invalid = await parse('<region> sample=a.wav reverse_locc1=100 reverse_hicc1=20');
  assert.ok(invalid.modulation.diagnostics.some(item => item.code === 'reverse-range'));
});
