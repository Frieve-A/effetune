import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSfzOpcode, SFZ_MODULATION_TARGETS, sfzModulationOpcode } from '../../js/sfz/schema.js';
import { compileSfzModulation, packSfzModulation } from '../../js/sfz/modulation.js';
import { parseSfz } from '../../js/sfz/parser.js';
import { SFZ_MOD_KINDS as K, SFZ_MOD_PROPERTY_IDS as P, SFZ_MOD_FILTER_TYPES,
  SFZ_MOD_VIRTUAL_CONTROLLERS } from '../../js/sfz/modulation-schema.js';
import { packSfzAsset, SFZ_REGION_FIELDS } from '../../js/sfz/asset.js';
import { generateSfzSchema } from '../../scripts/gen-sfz-schema.mjs';
import { generateOutputs } from '../../scripts/gen-dsp-params.mjs';
import fs from 'node:fs/promises';

const parse = source => parseSfz({ selectedPath: 'instrument.sfz', readText: async () => source,
  hasSample: () => true, onDiagnostic: null });
const compile = (opcodes, headers = []) => compileSfzModulation([{ opcodes }], headers);
const curve = (id, opcodes = {}) => ({ name: 'curve', opcodes: { curve_index: String(id), ...opcodes } });
const parameter = (region, kind, property, index = 0) => region.parameters.find(item =>
  item.property === property && region.instances[item.instance].kind === kind && region.instances[item.instance].index === index);

test('modulation target IDs preserve the existing sparse bank contract and aliases', () => {
  assert.deepEqual(Object.values(SFZ_MODULATION_TARGETS), [3, 4, 5, 6, 7,
    10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
  for (const [alias, canonical] of [
    ['tune_curvecc001', 'pitch_curvecc1'], ['tune_smoothcc128', 'pitch_smoothcc128'],
    ['tune_stepcc129', 'pitch_stepcc129'], ['gain_cc128', 'volume_oncc128'],
    ['ampeg_attackcc131', 'ampeg_attack_oncc131'], ['ampeg_attack_cc132', 'ampeg_attack_oncc132'],
    ['eq2_gaincc130', 'eq2_gain_oncc130'], ['cutoff_cc127', 'cutoff_oncc127']
  ]) assert.equal(canonicalSfzOpcode(alias), canonical);
  assert.deepEqual(sfzModulationOpcode('tune_smoothcc128'),
    { target: 5, source: 128, property: 'smooth', canonical: 'pitch_smoothcc128' });
  assert.equal(sfzModulationOpcode('locc1'), null);
  assert.equal(sfzModulationOpcode('unknown_oncc1'), null);
  for (const key of ['set_cc6', 'locc1', 'hicc1', 'on_locc1', 'on_hicc1', 'label_cc1', 'unknown_cc1']) {
    assert.equal(canonicalSfzOpcode(key), key);
  }
});

test('custom curves have implicit endpoints and linearly interpolate explicit positions', () => {
  const result = compile({}, [curve(9, { v032: '.5', v096: '-.5' }), curve(7)]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.curves.map(item => item.id), [7, 9]);
  const [linear, shaped] = result.curves.map(item => item.values);
  assert.equal(linear[0], 0);
  assert.equal(linear[127], 1);
  assert.equal(linear[63], Math.fround(63 / 127));
  assert.equal(shaped[16], .25);
  assert.equal(shaped[64], 0);
  assert.equal(shaped[96], -.5);
  assert.equal(shaped[127], 1);
  assert.equal(compile({}, [curve(7, { v000: '-1', v127: '0' })]).curves[0].values[64],
    Math.fround(-1 + 64 / 127));
});

test('all published fixed-LFO aftertouch spellings produce actual channel or per-note pressure routes', async () => {
  for (const family of ['amplfo', 'fillfo', 'pitchlfo']) for (const field of ['depth', 'freq']) {
    for (const [suffix, source] of [['chanaft', 129], ['polyaft', 130]]) {
      const parsed = await parse(`<region> sample=tone.wav ${family}_${field}${suffix}=2`);
      assert.deepEqual(parsed.unsupportedOpcodes, []);
      assert.deepEqual(parsed.modulation.diagnostics, []);
      assert.ok(parsed.modulation.regions[0].routes.some(route => route.sourceA === (0x10000 | source)));
    }
  }
});

test('invalid, protected and duplicate curve declarations remain explicit errors', () => {
  for (const id of [0, 1, 6, 255, -1, 7.5, '']) {
    const result = compile({}, [curve(id)]);
    assert.equal(result.diagnostics[0].code, 'curve-index');
    assert.throws(() => packSfzModulation(result));
  }
  for (const opcodes of [{ v128: '.5' }, { v1: '.5' }, { v010: '' },
    { v010: 'Infinity' }, { v010: '1e100' }, { unknown: '.5' }]) {
    assert.equal(compile({}, [curve(7, opcodes)]).diagnostics[0].code, 'curve-point');
  }
  assert.equal(compile({}, [curve(7), curve(7)]).diagnostics[0].code, 'duplicate-curve');
});

test('v3 routes resolve aliases and inherited modifiers to typed parameter slots', async () => {
  const parsed = await parse('<global> tune_oncc131=100 pitch_oncc131=200 tune_smoothcc131=50 ' +
    '<group> pitch_stepcc131=100 <region> sample=a.wav tune_oncc131=300 <group> <region> sample=b.wav');
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  assert.deepEqual(parsed.modulation.diagnostics, []);
  const routes = parsed.modulation.regions.map(region => region.routes.find(route => route.sourceA === (0x10000 | 131)));
  assert.deepEqual(routes.map(route => [route.depth, route.smooth, route.step]), [[300, 50, 100], [200, 50, 0]]);
  for (const [index, route] of routes.entries()) assert.equal(parsed.modulation.regions[index].parameters[route.target].property, P.Pitch);
});

test('used indexed generators keep authored identity without dense allocation or filter aliasing', () => {
  const result = compile({ lfo99_freq: '2', lfo99_wave2: '6', lfo99_ratio2: '4', lfo99_cutoff2: '1200',
    eg37_time2: '.5', eg37_level2: '1', eg37_pitch: '100', cutoff: '1000', cutoff2: '800' });
  assert.deepEqual(result.diagnostics, []);
  const region = result.regions[0];
  assert.equal(region.instances.filter(item => item.kind === K.LFO).length, 1);
  assert.equal(region.instances.filter(item => item.kind === K.FlexEG).length, 1);
  assert.equal(region.instances.filter(item => item.kind === K.EGStage).length, 3);
  assert.equal(region.instances.filter(item => item.kind === K.LFOSubosc).length, 1);
  assert.equal(parameter(region, K.Filter, P.Cutoff, 1).value, 1000);
  assert.equal(parameter(region, K.Filter, P.Cutoff, 2).value, 800);
  const route = region.routes.find(item => item.depth === 1200);
  assert.equal(region.instances[region.parameters[route.target].instance].index, 2);
  assert.equal(region.instances[route.sourceA & 65535].index, 99);
});

test('fixed envelope velocity differs from mutable virtual CC and depth is applied once', () => {
  const region = compile({ pitcheg_depth: '100', pitcheg_vel2attack: '.5', pitcheg_attack_oncc131: '.25',
    pitchlfo_depth: '200' }).regions[0];
  assert.ok(region.routes.some(route => route.sourceA === 0x50001 && route.depth === .5));
  assert.ok(region.routes.some(route => route.sourceA === (0x10000 | 131) && route.depth === .25));
  const direct = region.routes.filter(route => (route.sourceA >>> 16) === 3 || (route.sourceA >>> 16) === 4);
  assert.ok(direct.filter(route => region.parameters[route.target].property === P.Pitch).every(route => route.depth === 1));
  assert.equal(parameter(region, K.PitchEG, P.Depth).value, 100);
  assert.equal(parameter(region, K.PitchLFO, P.Depth).value, 200);
});

test('flexible amplitude replacement and additive envelopes have distinct routing', () => {
  const replaced = compile({ eg1_level1: '1', eg1_ampeg: '1' }).regions[0];
  const multiplied = compile({ eg1_level1: '1', eg1_amplitude: '100' }).regions[0];
  const amplitudeRoutes = region => region.routes.filter(route => region.parameters[route.target].property === P.Amplitude);
  assert.equal(amplitudeRoutes(replaced).length, 1);
  assert.equal(replaced.instances[amplitudeRoutes(replaced)[0].sourceA & 65535].kind, K.FlexEG);
  assert.equal(amplitudeRoutes(multiplied).length, 2);
  assert.ok(amplitudeRoutes(multiplied).every(route => route.flags & 1));
});

test('cross-generator modulation and CC-controlled depth use two sources and preserve cycles', () => {
  const result = compile({ eg2_depth_lfo1: '200', lfo1_freq_lfo2_oncc1: '2', lfo2_freq_lfo1: '3' });
  assert.deepEqual(result.diagnostics, []);
  const region = result.regions[0];
  const product = region.routes.find(route => route.sourceB === 0x10001);
  assert.equal(region.instances[product.sourceA & 65535].index, 1);
  assert.equal(region.instances[region.parameters[product.target].instance].index, 2);
  assert.ok(region.routes.find(route => route.depth === 200).flags & 1);
  assert.doesNotThrow(() => packSfzModulation(result));
});

test('last wave or step assignment wins across effective scopes and repeated assignments', async () => {
  for (const [source, wave, steps] of [
    ['<global> lfo1_wave=0 <group> lfo1_steps=4 <region> lfo1_wave=1', 1, 0],
    ['<global> lfo1_steps=4 <group> lfo1_wave=1 <region> lfo1_steps=2', 13, 2],
    ['<region> lfo1_wave=0 lfo1_steps=3 lfo1_wave=1', 1, 0]
  ]) {
    const parsed = await parse(`${source} sample=tone.wav`);
    const region = parsed.modulation.regions[0];
    assert.equal(parameter(region, K.LFO, P.Wave, 1).value, wave);
    assert.equal(parameter(region, K.LFO, P.Steps, 1).value, steps);
  }
});

test('explicit add/multiply mode changes authored routes without changing the required amplitude envelope', () => {
  for (const mode of ['add', 'mult']) {
    const region = compile({ eg1_level1: '1', eg1_amplitude: '100', amplitude_mod: mode }).regions[0];
    const authored = region.routes.find(route => region.instances[route.sourceA & 65535]?.kind === K.FlexEG);
    const fixed = region.routes.find(route => region.instances[route.sourceA & 65535]?.kind === K.AmpEG);
    assert.equal(authored.flags & 1, mode === 'mult' ? 1 : 0);
    assert.equal(fixed.flags & 1, 1);
  }
});

test('stage custom curves share the declared LUT and missing or opaque curves fail explicitly', () => {
  const compiled = compile({ eg1_time1: '1', eg1_level1: '1', eg1_curve1: '10', eg1_shape1: '2' }, [curve(10, { v064: '.25' })]);
  assert.deepEqual(compiled.diagnostics, []);
  assert.equal(parameter(compiled.regions[0], K.EGStage, P.Curve, 1).value, 10);
  assert.equal(compile({ eg1_curve1: '10' }).diagnostics[0].code, 'curve-missing');
  for (const value of [4, 5, 6]) assert.equal(compile({ pitch_curvecc1: String(value) }).diagnostics[0].code, 'curve-unverified');
  for (const value of [8, 9, 10, 11]) assert.equal(compile({ lfo1_wave: String(value) }).diagnostics[0].code, 'wave-unverified');
});

test('the independent EG pan-curve profile shapes only that source contribution', () => {
  const result = compile({ eg2_level1: '1', eg2_pan: '50', eg2_pan_curve: '7', pan_oncc1: '10' }, [curve(7, { v064: '.25' })]);
  assert.deepEqual(result.diagnostics, []);
  const region = result.regions[0];
  const egRoute = region.routes.find(route => region.parameters[route.target].property === P.Pan && (route.sourceA >>> 16) === 3);
  assert.equal(egRoute.curveA, 7);
  assert.equal(egRoute.depth, 50);
  assert.equal(region.routes.find(route => route.sourceA === 0x10001).curveA, 0);
  assert.equal(compile({ eg2_pan_curve: '8' }).diagnostics[0].code, 'curve-missing');
});

test('virtual pitch bend and sample offset preserve the explicit source profile without implicit routes', () => {
  assert.equal(SFZ_MOD_VIRTUAL_CONTROLLERS.find(source => source.id === 128).unit, 'normalized');
  assert.equal(SFZ_MOD_VIRTUAL_CONTROLLERS.find(source => source.id === 155).unit, 'sample-frames');
  const empty = compile({}).regions[0];
  assert.ok(empty.routes.every(route => route.sourceA !== 0x10080));
  const region = compile({ pitch_oncc128: '1200', pitch_curvecc128: '1', pan_oncc155: '.5' }).regions[0];
  const bend = region.routes.filter(route => route.sourceA === 0x10080);
  assert.equal(bend.length, 1);
  assert.equal(bend[0].curveA, 1);
  assert.equal(bend[0].depth, 1200);
  assert.equal(region.routes.find(route => route.sourceA === 0x1009b).depth, .5);
});

test('all pinned filter names have distinct typed enums and physical units remain separate', () => {
  assert.equal(Object.keys(SFZ_MOD_FILTER_TYPES).length, 23);
  assert.equal(new Set(Object.values(SFZ_MOD_FILTER_TYPES)).size, 23);
  for (const [name, id] of Object.entries(SFZ_MOD_FILTER_TYPES)) {
    const result = compile({ fil2_type: name, fil2_mode: 'hz', cutoff2: '800', cutoff2_oncc1: '100' });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(parameter(result.regions[0], K.Filter, P.FilterType, 2).value, id);
    assert.equal(parameter(result.regions[0], K.Filter, P.FilterMode, 2).value, 1);
  }
});

test('invalid source, instance and numeric input cannot become packed routes', () => {
  for (const opcodes of [{ pitch_oncc138: '1' }, { pitch_oncc139: '1' }, { pitch_oncc156: '1' },
    { lfo0_freq: '1' }, { lfo1_wave9: '0' }, { pitch_oncc1: 'Infinity' }, { eg1_time1: '-1' },
    { cutoff2_curvecc1: '2.5' }, { fileg_attack_smoothcc1: '-1' }, { unknown_oncc1: '3' }]) {
    const result = compile(opcodes);
    assert.ok(result.diagnostics.length, JSON.stringify(opcodes));
    assert.throws(() => packSfzModulation(result));
  }
});

test('v3 section word offsets and local indices address every record without overlap', () => {
  const result = compileSfzModulation([{ opcodes: { lfo1_pitch_oncc1: '200', lfo1_pitch_curvecc1: '7' } },
    { opcodes: { eg3_time1: '1', eg3_level1: '.5', eg3_amplitude: '100' } }], [curve(7)]);
  const bytes = packSfzModulation(result), words = new Uint32Array(bytes.buffer), values = new Float32Array(bytes.buffer);
  assert.equal(words[0], 0x31525453); assert.equal(words[1], 3); assert.equal(words[2], 2);
  assert.equal(words[5], 14); assert.equal(words[6], 26);
  assert.equal(words[7], words[6] + words[3] * 10);
  assert.equal(words[8], words[7] + words[4] * 129);
  assert.equal(words[10], words[8] + words[9] * 6);
  assert.equal(bytes.length, 4 * (words[10] + words[11] * 4));
  for (let regionIndex = 0; regionIndex < 2; regionIndex++) {
    const dir = 14 + regionIndex * 6;
    for (let index = 0; index < words[dir + 1]; index++) {
      const route = words[6] + (words[dir] + index) * 10;
      assert.ok(words[route] < words[dir + 5]);
      const target = words[10] + (words[dir + 4] + words[route]) * 4;
      assert.ok(words[target] < words[dir + 3]);
      assert.ok(Number.isFinite(values[target + 2]));
    }
  }
});

test('resident v7 carries v3 once while retaining controller conditions and initialization', async () => {
  const parsed = await parse('<control> set_cc7=100 <region> sample=tone.wav locc1=2 on_locc2=1 volume_oncc7=-6 ampeg_attack_oncc1=.5');
  const asset = packSfzAsset(parsed.regions, new Map([['tone.wav', { sampleRate: 48000, channels: [new Float32Array(8)] }]]),
    { modulation: parsed.modulation });
  const words = new Uint32Array(asset.payload, 32);
  assert.equal(words[1], 7);
  assert.equal(words[words[10] + 1], 3);
  const first = words[12 + SFZ_REGION_FIELDS.indexOf('controlOffset')];
  const count = words[12 + SFZ_REGION_FIELDS.indexOf('controlCount')];
  const ids = Array.from({ length: count }, (_, index) => words[first + index * 2]);
  assert.ok(ids.includes(1)); assert.ok(ids.includes(2 * 512 + 7)); assert.ok(ids.includes(8 * 512 + 2));
  assert.ok(!ids.includes(3 * 512 + 7)); assert.ok(!ids.includes(12 * 512 + 1));
});

test('native property schema is generated deterministically from the compiler table', async () => {
  const generated = await fs.readFile(new URL('../../dsp/generated/cpp/SFZModulationSchema.h', import.meta.url), 'utf8');
  assert.equal(generated, generateSfzSchema());
  assert.equal([...generateOutputs([])].find(([path]) => path.endsWith('SFZModulationSchema.h'))[1], generated);
});
