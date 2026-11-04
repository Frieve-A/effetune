import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSfz } from '../../js/sfz/parser.js';
import { SFZ_MOD_KINDS as K, SFZ_MOD_PROPERTY_IDS as P } from '../../js/sfz/modulation-schema.js';
const parse = source => parseSfz({ selectedPath: 'instrument.sfz', readText: async () => source, hasSample: () => true, onDiagnostic: null });
const value = (region, property, band) => region.parameters.find(parameter => parameter.property === property &&
  region.instances[parameter.instance].kind === K.Equalizer && region.instances[parameter.instance].index === band)?.value;

test('EQ type and update settings preserve independent inherited bands and existing frequency routes', async () => {
  const parsed = await parse('<global> eq1_type=lshelf eq1_mode=cents <group> eq2_dynamic=1 ' +
    '<region> sample=tone.wav eq1_freq=100 eq1_freq_oncc1=1200 eq2_type=hshelf ' +
    '<group> <region> sample=tone.wav eq1_type=peak');
  assert.deepEqual(parsed.unsupportedOpcodes, []); assert.deepEqual(parsed.modulation.diagnostics, []);
  const [first, second] = parsed.modulation.regions;
  assert.equal(value(first, P.EqType, 1), 1);
  assert.equal(value(first, P.FilterMode, 1), 0);
  assert.equal(value(first, P.Dynamic, 1), 0);
  assert.equal(value(first, P.EqType, 2), 2);
  assert.equal(value(first, P.Dynamic, 2), 1);
  assert.equal(value(first, P.FilterMode, 2), 1);
  assert.equal(value(second, P.EqType, 1), 0);
  assert.equal(value(second, P.Dynamic, 2), undefined);
  assert.ok(!first.instances.some(instance => instance.kind === K.Filter));
  const route = first.routes.find(route => first.parameters[route.target].property === P.Eq1Frequency);
  assert.equal(route.sourceA, 0x10001); assert.equal(route.depth, 1200);
});

test('EQ public enums and static settings reject invalid or invented modulation values', async () => {
  for (const setting of ['eq1_type=lowpass', 'eq2_dynamic=2', 'eq3_mode=semitones', 'eq1_type_oncc1=1']) {
    const parsed = await parse(`<region> sample=tone.wav ${setting}`);
    assert.ok(parsed.modulation.diagnostics.length, setting);
  }
});
