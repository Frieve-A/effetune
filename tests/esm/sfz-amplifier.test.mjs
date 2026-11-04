import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSfz } from '../../js/sfz/parser.js';
import { SFZ_MOD_KINDS as K, SFZ_MOD_PROPERTY_IDS as P } from '../../js/sfz/modulation-schema.js';
const parse = source => parseSfz({ selectedPath: 'instrument.sfz', readText: async () => source, hasSample: () => true, onDiagnostic: null });
const value = (region, kind, property, index = 0) => region.parameters.find(parameter => parameter.property === property &&
  region.instances[parameter.instance].kind === kind && region.instances[parameter.instance].index === index)?.value;

test('velocity curve points and tracking controllers use sparse actual typed destinations', async () => {
  const parsed = await parse('<region> sample=tone.wav amp_veltrack=50 amp_veltrack_cc1=20 amp_veltrack_curvecc1=1 amp_velcurve_1=.2 amp_velcurve_3=.3');
  assert.deepEqual(parsed.unsupportedOpcodes, []); assert.deepEqual(parsed.modulation.diagnostics, []);
  const region = parsed.modulation.regions[0];
  assert.equal(value(region, K.Amplifier, P.VelocityTrack), 50);
  assert.equal(value(region, K.VelocityCurvePoint, P.Level, 1), .2);
  assert.equal(value(region, K.VelocityCurvePoint, P.Level, 3), .3);
  assert.equal(region.instances.filter(instance => instance.kind === K.VelocityCurvePoint).length, 2);
  const route = region.routes.find(route => route.sourceA === 0x10001);
  assert.equal(region.parameters[route.target].property, P.VelocityTrack);
  assert.equal(route.depth, 20); assert.equal(route.curveA, 1);
});

test('pan tracking, explicit pan law and polarity retain defaults and named musical keys', async () => {
  const parsed = await parse('<region> sample=tone.wav pan_keycenter=c4 pan_keytrack=2 pan_veltrack=20 pan_random=-10 pan_law=mma phase=invert');
  assert.deepEqual(parsed.unsupportedOpcodes, []); assert.deepEqual(parsed.modulation.diagnostics, []);
  const region = parsed.modulation.regions[0];
  assert.equal(value(region, K.Amplifier, P.PanKeyCenter), 60);
  assert.equal(value(region, K.Amplifier, P.PanKeyTrack), 2);
  assert.equal(value(region, K.Amplifier, P.PanVelocityTrack), 20);
  assert.equal(value(region, K.Amplifier, P.PanRandom), -10);
  assert.equal(value(region, K.Amplifier, P.PanLaw), 2);
  assert.equal(value(region, K.Amplifier, P.PhaseInvert), 1);
});

test('key velocity and sparse CC crossfades keep independent curves and do not become trigger conditions', async () => {
  const parsed = await parse('<group> xf_cccurve=gain xf_keycurve=power <region> sample=tone.wav ' +
    'xfin_lokey=c3 xfin_hikey=c5 xfout_lovel=90 xfout_hivel=127 xfin_locc1=20 xfin_hicc1=90 xfout_locc127=100');
  assert.deepEqual(parsed.unsupportedOpcodes, []); assert.deepEqual(parsed.modulation.diagnostics, []);
  const region = parsed.modulation.regions[0];
  assert.equal(region.instances.filter(instance => instance.kind === K.Crossfade).length, 4);
  assert.equal(value(region, K.Crossfade, P.InLow, 0), 48);
  assert.equal(value(region, K.Crossfade, P.InHigh, 0), 72);
  assert.equal(value(region, K.Crossfade, P.Curve, 0), 1);
  assert.equal(value(region, K.Crossfade, P.OutLow, 1), 90);
  assert.equal(value(region, K.Crossfade, P.Curve, 3), 0);
  assert.equal(value(region, K.Crossfade, P.OutLow, 129), 100);
  assert.equal(parsed.regions[0].locc1, undefined);
});

test('out-of-domain authored points and crossfade ranges report preparation errors', async () => {
  for (const source of ['amp_velcurve_128=.5', 'amp_velcurve_2=1.1', 'xfin_locc128=2',
    'xfin_lokey=80 xfin_hikey=60', 'phase=unknown', 'pan_law=unknown', 'xf_cccurve=custom']) {
    const parsed = await parse(`<region> sample=tone.wav ${source}`);
    assert.ok(parsed.modulation.diagnostics.length > 0, source);
  }
});


test('measured position tracking preserves inherited values and separate one-sided random depth', async () => {
  const parsed = await parse('<global> position_keycenter=c3 position_random=-100 <group> position_keytrack=2 ' +
    '<region> sample=tone.wav position_veltrack=-200 <region> sample=tone.wav position_keycenter=127 position_random=0');
  assert.deepEqual(parsed.unsupportedOpcodes, []); assert.deepEqual(parsed.modulation.diagnostics, []);
  const [first, second] = parsed.modulation.regions;
  assert.equal(value(first, K.Amplifier, P.PositionKeyCenter), 48);
  assert.equal(value(first, K.Amplifier, P.PositionKeyTrack), 2);
  assert.equal(value(first, K.Amplifier, P.PositionVelocityTrack), -200);
  assert.equal(value(first, K.Amplifier, P.PositionRandom), -100);
  assert.equal(value(second, K.Amplifier, P.PositionKeyCenter), 127);
  assert.equal(value(second, K.Amplifier, P.PositionRandom), 0);
  assert.equal(value(second, K.Amplifier, P.PositionVelocityTrack), 0);
  const plain = (await parse('<region> sample=tone.wav amp_veltrack=100')).modulation.regions[0];
  for (const [property, expected] of [[P.PositionKeyCenter, 60], [P.PositionKeyTrack, 0],
    [P.PositionVelocityTrack, 0], [P.PositionRandom, 0]]) assert.equal(value(plain, K.Amplifier, property), expected);
  for (const invalid of ['position_random=101', 'position_veltrack=201', 'position_veltrack=.5',
    'position_keycenter=128', 'position_random_oncc1=20']) {
    assert.ok((await parse(`<region> sample=tone.wav ${invalid}`)).modulation.diagnostics.length, invalid);
  }
});

test('raw velocity random inherits signed scalar birth depth without percent scaling', async () => {
  const parsed = await parse('<global> amp_veltrack_random=-2 <group> amp_veltrack=50 <region> sample=tone.wav amp_velcurve_64=.75');
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  assert.deepEqual(parsed.modulation.diagnostics, []);
  const region = parsed.modulation.regions[0];
  assert.equal(value(region, K.Amplifier, P.Random), -2);
  assert.equal(value(region, K.Amplifier, P.VelocityTrack), 50);
  const explicit = await parse('<region> sample=tone.wav amp_veltrack_random=0');
  assert.deepEqual(explicit.modulation.diagnostics, []);
  assert.equal(value(explicit.modulation.regions[0], K.Amplifier, P.Random), undefined);
  assert.ok(!explicit.modulation.regions[0].instances.some(instance => instance.kind === K.Amplifier));
  for (const suffix of ['_oncc1', '_chanaft', '_mod']) {
    const unsupported = await parse(`<region> sample=tone.wav amp_veltrack_random${suffix}=1`);
    assert.ok(unsupported.modulation.diagnostics.length > 0);
  }
  const mode = await parse('<region> sample=tone.wav amp_veltrack_random_mod=add');
  assert.ok(mode.modulation.diagnostics.length > 0);
});
