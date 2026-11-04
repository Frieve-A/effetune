import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSfz } from '../../js/sfz/parser.js';
import { packSfzModulation } from '../../js/sfz/modulation.js';
import { SFZ_MOD_KINDS as K, SFZ_MOD_PROPERTY_IDS as P } from '../../js/sfz/modulation-schema.js';

const parse = source => parseSfz({ selectedPath: 'pitch.sfz', readText: async () => source,
  hasSample: () => true, onDiagnostic: null });
const rootValue = (parsed, property, region = 0) => parsed.modulation.regions[region].parameters.find(parameter =>
  parameter.property === property && parsed.modulation.regions[region].instances[parameter.instance].kind === K.Region).value;

test('bend step aliases and asymmetric inherited overrides use the effective authored order', async () => {
  const parsed = await parse('<global> bendstep=100 bend_smooth=50 <group> bend_stepup=200 ' +
    '<region> sample=a.wav bendup=-1200 benddown=700 <region> sample=b.wav bend_step=300');
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  assert.deepEqual(parsed.modulation.diagnostics, []);
  assert.equal(rootValue(parsed, P.BendStepUp), 200);
  assert.equal(rootValue(parsed, P.BendStepDown), 100);
  assert.equal(rootValue(parsed, P.BendSmooth), 50);
  assert.equal(rootValue(parsed, P.BendStepUp, 1), 300);
  assert.equal(rootValue(parsed, P.BendStepDown, 1), 300);
  assert.equal(parsed.regions[0].bend_up, -1200);
  assert.equal(parsed.regions[0].bend_down, 700);
  assert.equal(rootValue(await parse('<region> sample=a.wav'), P.BendStepUp), 1);
  assert.doesNotThrow(() => packSfzModulation(parsed.modulation));
});

test('scope tuning adds distinct scopes while overriding the same inherited opcode once', async () => {
  const parsed = await parse('<global> global_tune=100 <master> master_tune=200 <group> group_tune=300 ' +
    '<region> sample=a.wav tune=25 <region> sample=b.wav group_tune=400 ' +
    '<group> group_tune=-50 <region> sample=c.wav <master> master_tune=-10 <region> sample=d.wav');
  assert.deepEqual(parsed.modulation.diagnostics, []);
  assert.deepEqual(parsed.regions.map((_, index) => rootValue(parsed, P.ScopeTune, index)), [600, 700, 250, 90]);
  assert.equal(parsed.regions[0].tune, 25);
  assert.equal(rootValue(parsed, P.Pitch), 25);
  const maximum = await parse('<global> global_tune=9600 <master> master_tune=9600 <group> group_tune=9600 <region> sample=a.wav');
  assert.equal(rootValue(maximum, P.ScopeTune), 28800);
});

test('control offsets apply bank-wide with independent keyswitch settings and preserve region keys', async () => {
  const parsed = await parse('<control> note_offset=2 octave_offset=-1 sw_note_offset=-1 sw_octave_offset=1 ' +
    '<region> sample=a.wav key=60 sw_last=24 <control> note_offset=3 <region> sample=b.wav key=64');
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  assert.deepEqual(parsed.modulation.diagnostics, []);
  for (let index = 0; index < 2; index++) {
    assert.equal(rootValue(parsed, P.NoteOffset, index), -9);
    assert.equal(rootValue(parsed, P.SwitchOffset, index), 11);
  }
  assert.equal(parsed.regions[0].lokey, 60);
  assert.equal(parsed.regions[0].pitch_keycenter, 60);
  assert.equal(parsed.regions[0].sw_last, 24);
  assert.equal(parsed.regions[0].transpose, 0);
});

test('invalid pitch controls cannot be silently accepted or packed', async () => {
  for (const body of ['bend_step=0', 'bend_stepup=1201', 'bend_stepdown=2.5',
    'bend_smooth=-1', 'bend_smooth=Infinity', 'group_tune=9601', 'master_tune=1.5', 'note_offset=1']) {
    const parsed = await parse(`<region> sample=a.wav ${body}`);
    assert.ok(parsed.modulation.diagnostics.length, body);
    assert.throws(() => packSfzModulation(parsed.modulation), body);
  }
  for (const body of ['note_offset=128', 'octave_offset=-11', 'sw_note_offset=1.5', 'sw_octave_offset=11']) {
    const parsed = await parse(`<control> ${body} <region> sample=a.wav`);
    assert.ok(parsed.modulation.diagnostics.length, body);
  }
  for (const body of ['global_tune=100', 'bend_step=100']) {
    const parsed = await parse(`<control> ${body} <region> sample=a.wav`);
    assert.equal(parsed.modulation.diagnostics[0].code, 'pitch-region-scope');
  }
  for (const body of ['bend_up=9601', 'bend_down=1.5']) {
    const parsed = await parse(`<region> sample=a.wav ${body}`);
    assert.equal(parsed.regions.length, 0);
    assert.equal(parsed.warnings[0].code, 'invalid-regions');
  }
});
