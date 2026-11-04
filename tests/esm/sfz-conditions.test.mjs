import assert from 'node:assert/strict';
import test from 'node:test';
import { packSfzAsset, packStreamedSfzAsset, sfzSampleCacheFootprint } from '../../js/sfz/asset.js';
import { sfzTimerFootprint } from '../../js/sfz/modulation.js';
import { parseSfz } from '../../js/sfz/parser.js';
import { SFZ_MOD_KINDS as K, SFZ_MOD_PROPERTY_IDS as P } from '../../js/sfz/modulation-schema.js';
const parse = source => parseSfz({ selectedPath: 'instrument.sfz', readText: async () => source, hasSample: () => true, onDiagnostic: null });
const value = (region, kind, property, index = 0) => region.parameters.find(parameter => parameter.property === property &&
  region.instances[parameter.instance].kind === kind && region.instances[parameter.instance].index === index)?.value;

test('high-resolution conditions and CC start/stop retain precise scoped controller values', async () => {
  const parsed = await parse('<region> sample=tone.wav lohdcc90=.333 hihdcc90=.7 start_lohdcc64=1 on_hihdcc64=1 ' +
    'stop_locc2=64 stop_hicc2=127 stop_lohdcc3=.25 stop_hihdcc3=.75');
  assert.deepEqual(parsed.unsupportedOpcodes, []); assert.deepEqual(parsed.modulation.diagnostics, []);
  const region = parsed.modulation.regions[0];
  assert.equal(value(region, K.ControllerCondition, P.ConditionLow, 90), .333);
  assert.equal(value(region, K.ControllerStart, P.ConditionHigh, 64), 1);
  assert.equal(value(region, K.ControllerStop, P.ConditionLow, 2), 64 / 127);
  assert.equal(value(region, K.ControllerStop, P.ConditionHigh, 3), .75);
  assert.equal(region.instances.filter(instance => instance.kind === K.ControllerStop).length, 2);
});

test('ordinary controller trigger bounds retain the published unassigned sentinel', async () => {
  const parsed = await parse('<region> sample=tone.wav on_locc64=-1 on_hicc64=-1');
  assert.equal(parsed.regions.length, 1);
  assert.deepEqual(parsed.diagnostics.invalidRegions, []);
  assert.equal(parsed.regions[0].on_locc64, -1);
  assert.equal(parsed.regions[0].on_hicc64, -1);
});

test('tempo timer and sample-quality controls have separate used typed settings', async () => {
  const parsed = await parse('<region> sample=tone.wav lobpm=100 hibpm=200.5 lotimer=.25 hitimer=2 sample_quality=10');
  assert.deepEqual(parsed.unsupportedOpcodes, []); assert.deepEqual(parsed.modulation.diagnostics, []);
  const region = parsed.modulation.regions[0];
  assert.equal(value(region, K.TempoCondition, P.BpmHigh), 200.5);
  assert.equal(value(region, K.TimerCondition, P.TimerLow), .25);
  assert.equal(value(region, K.SamplePlayback, P.SampleQuality), 10);
  const timer = (await parse('<region> sample=tone.wav lotimer=.25')).modulation.regions[0];
  assert.ok(!timer.instances.some(instance => instance.kind === K.TempoCondition));
});

test('invalid source indices and public condition domains cannot enter a descriptor', async () => {
  for (const opcodes of ['lohdcc128=.5', 'lohdcc1=1.1', 'on_lohdcc1=-.5', 'stop_locc1=1.5',
    'lobpm=501', 'lotimer=-1', 'sample_quality=0', 'sample_quality=11', 'lohdcc1=.8 hihdcc1=.2']) {
    const parsed = await parse(`<region> sample=tone.wav ${opcodes}`);
    assert.ok(parsed.modulation.diagnostics.length, opcodes);
  }
});


test('timer budget uses actual lexical groups and includes independent live and trial channel clocks', async () => {
  const parsed = await parse('<group> lotimer=.25 <region> sample=tone.wav <region> sample=tone.wav ' +
    '<group> <region> sample=tone.wav');
  const groups = new Set(parsed.regions.map(region => region.seqGroup)).size;
  assert.equal(groups, 2);
  assert.equal(sfzTimerFootprint(parsed.modulation, groups), 512);
  const plain = await parse('<group> <region> sample=tone.wav');
  assert.equal(sfzTimerFootprint(plain.modulation, 1), 0);
  for (const streamed of [false, true]) {
    const samples = new Map([['tone.wav', streamed
      ? { frames: 8, channels: 1, sampleRate: 48000, revision: 'a'.repeat(64) }
      : { channels: [new Float32Array(8)], sampleRate: 48000 }]]);
    const asset = (streamed ? packStreamedSfzAsset : packSfzAsset)(parsed.regions, samples,
      { modulation: parsed.modulation, cacheSlots: 1 });
    const words = new Uint32Array(asset.payload, 32);
    assert.equal(words[6], groups);
    assert.equal(asset.footprintBytes, asset.payload.byteLength);
    if (streamed) assert.equal(asset.sampleCacheBytes, sfzSampleCacheFootprint(1, 1, 1));
  }
});
