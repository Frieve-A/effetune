import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { parseSfz } from '../../js/sfz/parser.js';
import { generateSfzEffectsFixture } from '../helpers/sfz-effects-fixture.mjs';
import { compileSfzEffects, isSfzEffectOpcode, SFZ_EFFECT_TYPES as T,
    SFZ_EFFECT_PARAMETERS as P, packSfzEffects } from '../../js/sfz/effects.js';
import { compileSfzEffectHeaders, effectSamplePaths, packSfzEffectModulation } from '../../js/sfz/effects-asset.js';
import { compileSfzModulation, packSfzModulation } from '../../js/sfz/modulation.js';

const effect = opcodes => ({ name: 'effect', opcodes });
const parameter = (node, name, type) => node.parameters[P[type].findIndex(item => item.name === name)];

test('native effects fixture is produced by the current JS compiler and packer', async () => {
    const expected = generateSfzEffectsFixture();
    const actual = await fs.readFile(new URL('../../dsp/plugins/others/sfz/sfz_effects_fixture.h', import.meta.url), 'utf8');
    assert.equal(actual.replaceAll('\r\n', '\n'), expected);
});

test('SFZ effects preserve physical outputs and independent ordered bus chains', () => {
    const plan = compileSfzEffects([{ output: '7', effect1: '25' }, { effect4: '100' }], [
        effect({ type: 'comp', bus: 'main', comp_ratio: '100', directtomain: '50' }),
        effect({ type: 'filter', bus: 'fx1', filter_type: 'lpf_2p', fx1tomain: '25' }),
        effect({ type: 'lofi', bus: 'fx1', fx1tomix: '50' }),
        effect({ type: 'apan', bus: 'aux7', directtomain: '75' })
    ]);
    assert.deepEqual(plan.diagnostics, []);
    assert.equal(plan.requiredOutputs, 8);
    assert.equal(plan.regions[0].output, 7);
    assert.deepEqual(plan.regions.map(region => region.sends), [[.25, 0, 0, 0], [0, 0, 0, 1]]);
    assert.deepEqual(plan.nodes.map(node => [node.type, node.bus]), [[T.comp, 0], [T.filter, 9], [T.lofi, 9], [T.apan, 7]]);
    assert.equal(plan.directToMain, .75);
    assert.equal(plan.fxToMain[0], .25);
    assert.equal(plan.fxToMix[0], .5);
    assert.equal(parameter(plan.nodes[0], 'comp_ratio', 'comp'), 100);
    assert.equal(compileSfzEffects([{ output: '1024' }]).requiredOutputs, 1025,
        'the compiler preserves an output that actual host preparation must reject');
});

test('original SFZ sends create wet reverb and chorus only when headers are absent', () => {
    const plan = compileSfzEffects([{ effect1: '30', effect2: '40' }]);
    assert.deepEqual(plan.diagnostics, []);
    assert.deepEqual(plan.nodes.map(node => [node.type, node.bus]), [[T.fverb, 9], [T.chorus, 10]]);
    assert.deepEqual(plan.fxToMain, [1, 1, 0, 0]);
    assert.equal(parameter(plan.nodes[0], 'reverb_dry', 'fverb'), 0);
    assert.equal(parameter(plan.nodes[0], 'reverb_wet', 'fverb'), 100);
    const explicit = compileSfzEffects([{ effect1: '30' }], [effect({ fx1tomix: '25' })]);
    assert.deepEqual(explicit.nodes, []);
    assert.deepEqual(explicit.fxToMain, [0, 0, 0, 0]);
    assert.equal(explicit.fxToMix[0], .25);
});

test('published percent controls retain public ranges and known options', () => {
    const plan = compileSfzEffects([], [effect({ type: 'delay', delay_mode: 'ping',
        delay_panl: '0', delay_panc: '50', delay_panr: '100', delay_damphi: '100', delay_moddepth: '50' })]);
    assert.deepEqual(plan.diagnostics, []);
    assert.equal(parameter(plan.nodes[0], 'delay_panc', 'delay'), 50);
    for (const opcodes of [{ type: 'delay', delay_panl: '-1' }, { type: 'delay', delay_damphi: '101' },
        { type: 'apan', apan_phase: '181' }, { type: 'phaser', phaser_feedback: '-1' }]) {
        assert.equal(compileSfzEffects([], [effect(opcodes)]).diagnostics[0].code, 'effect-value');
    }
});

test('effect parameter controller modifiers compose into one typed route', () => {
    const plan = compileSfzEffects([], [effect({ type: 'comp', comp_gain_oncc7: '12',
        comp_gain_smoothcc7: '25', comp_gain_stepcc7: '.5', comp_gain_curvecc7: '9' }),
    { name: 'curve', opcodes: { curve_index: '9' } }]);
    assert.deepEqual(plan.diagnostics, []);
    assert.deepEqual(plan.nodes[0].routes, [{ parameter: 1, controller: 7, depth: 12,
        curve: 9, smooth: 25, step: .5 }]);
    assert.equal(compileSfzEffects([], [effect({ type: 'comp', comp_gain_oncc156: '1' })]).diagnostics[0].code,
        'effect-modulation');
});

test('FX section packing resolves IR assets and keeps node-local parameters and routes', () => {
    const plan = compileSfzEffects([{ output: '2', effect3: '25' }], [
        effect({ type: 'comp', comp_gain_oncc7: '12' }),
        effect({ type: 'tdfir', bus: 'fx3', tdfir_impulse: 'hall.wav', tdfir_wet: '50' })
    ]);
    assert.throws(() => packSfzEffects(plan), /impulse is not prepared/);
    const bytes = packSfzEffects(plan, path => path === 'hall.wav' ?
        { sampleOffsetOrId: 4, frames: 100, channels: 2, rate: 48000 } : undefined);
    const u = new Uint32Array(bytes.buffer), f = new Float32Array(bytes.buffer);
    assert.deepEqual([...u.subarray(0, 5)], [1, 1, 2, 1, 9]);
    assert.equal(u[u[5]], 2);
    assert.equal(f[u[5] + 3], .25);
    assert.equal(u[u[6] + 8 + 6], 0);
    assert.deepEqual([...u.subarray(u[20])], [4, 100, 2, 48000]);
    assert.equal(u[u[8] + 1], 7);
    assert.equal(f[u[8] + 2], 12);
    assert.equal(f[u[7] + 8], 50);
    assert.throws(() => packSfzEffects(compileSfzEffects([], [effect({ type: 'unknown' })])), /Invalid SFZ effect plan/);
});

test('unavailable type, invalid bus and misplaced parameters remain diagnostics', () => {
    for (const [opcodes, code] of [[{ type: 'mverb' }, 'effect-type'],
        [{ type: 'com.mda.Delay' }, 'effect-type'], [{ type: 'chorus' }, 'effect-type'],
        [{ type: 'comp', bus: 'typo' }, 'effect-bus'], [{ type: 'comp', delay_wet: '50' }, 'effect-parameter'],
        [{ type: 'tdfir' }, 'effect-impulse']]) {
        assert.equal(compileSfzEffects([], [effect(opcodes)]).diagnostics[0].code, code);
    }
    assert.equal(isSfzEffectOpcode('comp_gain_oncc7', 'region'), false);
    assert.equal(isSfzEffectOpcode('comp_gain_oncc7', 'effect'), true);
    assert.equal(isSfzEffectOpcode('bypass_oncc', 'effect'), false);
    assert.equal(isSfzEffectOpcode('dsp_order', 'effect'), false);
});

test('normal modulation serialization embeds FX and deduplicated IR geometry without changing v3', () => {
    const regions = [{ sample: 'tone.wav', opcodes: {} }];
    const v3 = packSfzModulation(compileSfzModulation(regions, []));
    assert.equal(compileSfzEffectHeaders(regions, []), null);
    assert.equal(packSfzEffectModulation(v3, null), v3);
    const plan = compileSfzEffectHeaders(regions, [effect({ type: 'tdfir', tdfir_impulse: 'hall.wav' }),
        effect({ type: 'tdfir', bus: 'fx1', tdfir_impulse: 'hall.wav' })]);
    assert.deepEqual(effectSamplePaths(plan), ['hall.wav']);
    let resolves = 0;
    const bytes = packSfzEffectModulation(v3, plan, () => {
        resolves++;
        return { sampleOffsetOrId: 32, frames: 17, channels: 2, rate: 44100 };
    });
    assert.equal(resolves, 1);
    const original = new Uint32Array(v3.buffer), words = new Uint32Array(bytes.buffer);
    assert.equal(words[1], 4);
    for (const index of [5, 6, 7, 8, 10]) assert.equal(words[index], original[index] + 2);
    assert.deepEqual(words.subarray(16, words[14]), original.subarray(14));
    const fx = words.subarray(words[14]);
    assert.equal(fx.length, words[15]);
    assert.equal(fx[5], 22);
    assert.equal(fx[21], 1);
    assert.deepEqual([...fx.subarray(fx[20])], [32, 17, 2, 44100]);
    assert.equal(fx[fx[6] + 6], 0);
    assert.equal(fx[fx[6] + 8 + 6], 0);
    assert.throws(() => packSfzEffectModulation(bytes, plan), /Invalid SFZ modulation/);
});

const plans={
  gain:compileSfzEffects([], [effect({type:'gain',gain:'-6',gain_oncc7:'12'})]),
  rectify:compileSfzEffects([], [effect({type:'rectify',rectify:'0',rectify_oncc1:'100',rectify_mode:'full'})]),
  half:compileSfzEffects([], [effect({type:'rectify',rectify:'100'})]),
  filter:compileSfzEffects([], [effect({type:'filter',filter_type:'peq',filter_cutoff:'1000',filter_gain:'0',filter_gain_oncc2:'12'})]),
  gate:compileSfzEffects([], [effect({type:'gate',gate_attack:'0',gate_release:'0',gate_threshold:'-20',gate_hold:'.01'})])
};
test('new effect controls preserve old type and parameter identities',()=>{
  for(const p of Object.values(plans))assert.deepEqual(p.diagnostics,[]);
  assert.equal(plans.gain.nodes[0].type,16);assert.equal(plans.rectify.nodes[0].type,17);
  assert.equal(P.filter.findIndex(p=>p.name==='filter_type'),2);assert.equal(P.filter.findIndex(p=>p.name==='filter_gain'),3);
  assert.equal(P.gate.findIndex(p=>p.name==='gate'),4);assert.equal(P.gate.findIndex(p=>p.name==='gate_hold'),5);
  assert.equal(plans.gain.nodes[0].routes[0].parameter,0);assert.equal(plans.filter.nodes[0].routes[0].parameter,3);
  assert.equal(plans.half.nodes[0].parameters[1],0);
});
test('actual parser accepts the new effect controls only in their type context',async()=>{
  const parsed=await parseSfz({selectedPath:'test.sfz',readText:async()=>'<region> sample=*sine key=60\n<effect> type=gain gain=-6 gain_oncc7=12\n<effect> type=rectify rectify=100 rectify_mode=half\n<effect> type=filter filter_gain_oncc1=12\n<effect> type=gate gate_hold=.1'});
  assert.deepEqual(parsed.unsupportedOpcodes,[]);
  assert.equal(parsed.effects.nodes[0].routes[0].controller,7);
  assert.equal(parsed.effects.nodes[0].routes[0].depth,12);
  for(const name of ['gain','rectify','rectify_mode','rectify_oncc1','filter_gain','filter_gain_oncc1','gate_hold'])assert.equal(isSfzEffectOpcode(name,'effect'),true);
  assert.equal(isSfzEffectOpcode('rectify','region'),false);
  assert.ok(compileSfzEffects([], [effect({type:'gain',rectify:'100'})]).diagnostics.some(d=>d.code==='effect-parameter'));
});
test('new controls retain physical ranges and diagnose invalid values',()=>{
  for(const p of [{type:'gain',gain:'49'},{type:'rectify',rectify:'101'}, {type:'rectify',rectify_mode:'1'},
    {type:'filter',filter_gain:'97'},{type:'gate',gate_hold:'-1'}])assert.ok(compileSfzEffects([], [effect(p)]).diagnostics.some(d=>d.code==='effect-value'));
});
