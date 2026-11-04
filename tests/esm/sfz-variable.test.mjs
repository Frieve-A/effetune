import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { sfzRuntimeLimitations } from '../../js/sfz/runtime-support.js';
import { compileSfzEffects } from '../../js/sfz/effects.js';
import { compileSfzModulation, packSfzModulation, isSfzModulationOpcode } from '../../js/sfz/modulation.js';
import { SFZ_MOD_KINDS as K, SFZ_MOD_PROPERTY_IDS as P, SFZ_MOD_SOURCES as S } from '../../js/sfz/modulation-schema.js';

const compile = (opcodes, headers = []) => compileSfzModulation([{ opcodes }], headers);
const entry = region => region.instances.findIndex(instance => instance.kind === K.Variable);
const value = (region, id) => region.parameters.find(parameter => parameter.instance === id && parameter.property === P.VariableValue);

test('the documented variable multiplication compiles all controller inputs and one cutoff destination', () => {
  const result = compile({ cutoff: '120', var01_cutoff: '4800', var01_mod: 'mult', var01_oncc131: '1', var01_oncc111: '1', var01_oncc84: '.5' });
  assert.deepEqual(result.diagnostics, []);
  const region = result.regions[0], id = entry(region), target = value(region, id);
  assert.equal(region.instances[id].index, 1);
  assert.equal(target.value, 1);
  const inputs = region.routes.filter(route => region.parameters[route.target] === target);
  assert.deepEqual(inputs.map(route => route.sourceA), [S.Controller | 131, S.Controller | 111, S.Controller | 84]);
  assert.deepEqual(inputs.map(route => route.depth), [1, 1, .5]);
  assert.ok(inputs.every(route => route.flags === 1));
  const destination = region.routes.find(route => route.sourceA === (S.Variable | id));
  assert.equal(destination.depth, 4800);
  assert.equal(region.parameters[destination.target].property, P.Cutoff);
  assert.ok(packSfzModulation(result).byteLength > 0);
});

test('add mode, per-input curves and shared variable destinations retain distinct routes', () => {
  const result = compile({ var7_mod: 'add', var7_cutoff: '2400', var7_pitch: '100',
    var7_curvecc84: '2', var7_oncc84: '.25', var7_oncc85: '.75' });
  assert.deepEqual(result.diagnostics, []);
  const region = result.regions[0], id = entry(region), target = value(region, id);
  assert.equal(target.value, 0);
  const inputs = region.routes.filter(route => region.parameters[route.target] === target);
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].curveA, 2);
  assert.equal(inputs[0].depth, .25);
  assert.ok(inputs.every(route => route.flags === 0));
  assert.equal(region.routes.filter(route => route.sourceA === (S.Variable | id)).length, 2);
});

test('region plans own their variables and unused regions allocate no variable instance', () => {
  const result = compileSfzModulation([{ opcodes: { var1_mod: 'mult', var1_pitch: '100', var1_oncc84: '1' } },
    { opcodes: { var1_mod: 'add', var1_pan: '50', var1_oncc85: '.5' } }, { opcodes: {} }]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.regions.map(region => region.instances.filter(instance => instance.kind === K.Variable).length), [1, 1, 0]);
  assert.equal(value(result.regions[0], entry(result.regions[0])).value, 1);
  assert.equal(value(result.regions[1], entry(result.regions[1])).value, 0);

  const interleaved = compile({ cutoff_oncc83: '10', var2_pitch: '100', var1_pan: '50',
    var1_oncc84: '1', pan_oncc88: '25', var2_oncc85: '.5', var1_oncc86: '.25', var2_oncc87: '.75' });
  assert.deepEqual(interleaved.diagnostics, []);
  const region = interleaved.regions[0];
  const variable1 = region.instances.findIndex(instance => instance.kind === K.Variable && instance.index === 1);
  const variable2 = region.instances.findIndex(instance => instance.kind === K.Variable && instance.index === 2);
  const input = route => region.parameters[route.target].property === P.VariableValue;
  const audio = region.routes.filter(route => !input(route));
  assert.deepEqual(audio.slice(0, 4).map(route => [region.parameters[route.target].property, route.sourceA]),
    [[P.Cutoff, S.Controller | 83], [P.Pitch, S.Variable | variable2],
      [P.Pan, S.Variable | variable1], [P.Pan, S.Controller | 88]]);
  assert.equal(audio.length, 5);
  assert.equal(region.parameters[audio.at(-1).target].property, P.Amplitude);
  const grouped = region.routes.slice(audio.length);
  assert.ok(grouped.every(input));
  assert.deepEqual(grouped.map(route => [region.parameters[route.target].instance, route.sourceA]),
    [[variable1, S.Controller | 84], [variable1, S.Controller | 86],
      [variable2, S.Controller | 85], [variable2, S.Controller | 87]]);
});

test('omitted mode uses the measured additive identity and leaves existing instruments byte-identical', () => {
  const result = compile({ var1_cutoff: '4800', var1_oncc84: '1', var1_oncc85: '1' });
  assert.deepEqual(result.diagnostics, []);
  const region = result.regions[0], id = entry(region), target = value(region, id);
  assert.equal(target.value, 0);
  assert.ok(region.routes.filter(route => region.parameters[route.target] === target).every(route => route.flags === 0));
  const ordinary = [{ opcodes: { cutoff: '1000', cutoff_oncc84: '4800', lfo2_freq: '5', lfo2_pitch: '20' } }];
  const packed = new Uint8Array(packSfzModulation(compileSfzModulation(ordinary)));
  assert.equal(packed.byteLength, 1272);
  assert.equal(createHash('sha256').update(packed).digest('hex'),
    '3470ba3c7e1068fe5db7123db0b1fcf20aed107871f01109143c38939d06f2a3');
});

test('variable inputs validate their public domain and existing curve contract', () => {
  for (const opcodes of [{ var1_mod: 'unknown' }, { var1_oncc84: '-.1' }, { var1_oncc84: '1.1' },
    { var1_oncc138: '1' }, { var1_curvecc84: '1.5' }, { var0_pitch: '100' }]) {
    const result = compile(opcodes);
    assert.ok(result.diagnostics.length, JSON.stringify(opcodes));
    assert.throws(() => packSfzModulation(result));
  }
  assert.equal(compile({ var1_curvecc84: '4' }).diagnostics[0].code, 'curve-unverified');
  assert.equal(compile({ var1_curvecc84: '9' }).diagnostics[0].code, 'curve-missing');
});

test('variable grammar identifies the four families without accepting generator or variable targets', () => {
  for (const key of ['var01_cutoff', 'var01_pitch', 'var01_mod', 'var01_oncc131', 'var01_curvecc84'])
    assert.equal(isSfzModulationOpcode(key), true, key);
  for (const key of ['var01_lfo1_freq', 'var01_eg1_attack', 'var01_var2_pitch', 'var01_unknown'])
    assert.equal(isSfzModulationOpcode(key), false, key);
  assert.equal(compile({ var1_oncc84: '1' }, [{ name: 'control', opcodes: { var1_oncc84: '1' } }]).diagnostics[0].code, 'variable-region-scope');
});


test('matching variable and gain/rectify consumers pass the explicit runtime gate', () => {
  const modulation = compile({ var1_mod: 'mult', var1_oncc1: '1', var1_volume: '-12' });
  const effects = compileSfzEffects([], [{ name: 'effect', opcodes: { type: 'gain', gain: '-6' } },
    { name: 'effect', opcodes: { type: 'rectify', rectify: '100' } }]);
  assert.deepEqual(modulation.diagnostics, []);
  assert.deepEqual(effects.diagnostics, []);
  assert.deepEqual(sfzRuntimeLimitations(modulation, effects), []);
  assert.deepEqual(sfzRuntimeLimitations({ version: 4, regions: [{ instances: [{ kind: 31 }] }] }, null), ['kind:31']);
  assert.deepEqual(sfzRuntimeLimitations(null, { version: 1, nodes: [{ type: 18 }] }), ['effects']);
});
