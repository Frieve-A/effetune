import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSfz } from '../../js/sfz/parser.js';
import { packSfzModulation, sfzModulationFootprint } from '../../js/sfz/modulation.js';
import { SFZ_MOD_KINDS as K, SFZ_MOD_PROPERTY_IDS as P } from '../../js/sfz/modulation-schema.js';
import { createSfzGeneratorSample } from '../../js/sfz/generators.js';
import { prepareSfzOscillatorSources, resizeSfzCycle, prepareSfzCyclePyramid, sfzCyclePyramidFrames } from '../../js/sfz/oscillator-source.js';

const parse = source => parseSfz({ selectedPath: 'source.sfz', readText: async () => source,
  hasSample: () => true, onDiagnostic: null });
const properties = region => new Map(region.parameters.filter(parameter =>
  region.instances[parameter.instance].kind === K.Oscillator).map(parameter => [parameter.property, parameter.value]));

test('oscillator instances expose actual source controls and reuse ordinary controller routes', async () => {
  const parsed = await parse('<region> sample=*saw oscillator_multi=9 oscillator_mode=2 oscillator_phase=-20 ' +
    'oscillator_quality=3 oscillator_detune=100 oscillator_mod_depth=50 oscillator_detune_oncc1=20 ' +
    'oscillator_mod_depth_oncc2=100 oscillator_mod_smoothcc2=25');
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  assert.deepEqual(parsed.modulation.diagnostics, []);
  const region = parsed.modulation.regions[0], values = properties(region);
  assert.equal(values.get(P.SourceWave), 2);
  assert.equal(values.get(P.Enabled), 1);
  assert.equal(values.get(P.OscillatorMulti), 9);
  assert.equal(values.get(P.OscillatorMode), 2);
  assert.equal(values.get(P.OscillatorPhase), -20);
  assert.equal(values.get(P.OscillatorQuality), 3);
  assert.equal(region.routes.find(route => route.sourceA === 0x10002).smooth, 25);
  assert.doesNotThrow(() => packSfzModulation(parsed.modulation));
  const ordinary = await parse('<region> sample=wave.wav');
  assert.ok(!ordinary.modulation.regions[0].instances.some(instance => instance.kind === K.Oscillator));
  assert.ok(sfzModulationFootprint(parsed.modulation) > sfzModulationFootprint(ordinary.modulation) + 144 * 257);
});

test('CONTROL resampling preserves periodic pitch and removes harmonics beyond the new table Nyquist', () => {
  const input = Float32Array.from({ length: 128 }, (_, index) => Math.sin(2 * Math.PI * index / 128));
  for (const size of [32, 256]) {
    const output = resizeSfzCycle(input, size);
    for (let i = 0; i < size; i++) assert.ok(Math.abs(output[i] - Math.sin(2 * Math.PI * i / size)) < .001);
  }
  const high = Float32Array.from({ length: 128 }, (_, index) => Math.sin(2 * Math.PI * 51 * index / 128));
  assert.ok(Math.max(...resizeSfzCycle(high, 32).map(Math.abs)) < .001);
  assert.deepEqual([...resizeSfzCycle(new Float32Array([.25]), 16)], Array(16).fill(.25));
});

test('prepared cycles share one bounded table, ignore file rate and preserve ordinary sample use', async () => {
  const parsed = await parse('<global> oscillator=on oscillator_table_size=32 <region> sample=wave.wav key=60 ' +
    '<region> sample=wave.wav key=61 <region> sample=wave.wav oscillator=off key=62');
  let reads = 0;
  const pcm = { sampleRate: 12345, channels: [Float32Array.from({ length: 64 }, (_, i) => Math.sin(i * Math.PI / 32))] };
  const result = await prepareSfzOscillatorSources(parsed, async () => { reads++; return pcm; }, 4096);
  assert.equal(reads, 1);
  assert.equal(result.samples.size, 1);
  assert.equal(result.parsed.regions[0].sample, result.parsed.regions[1].sample);
  assert.equal(result.parsed.regions[2].sample, 'wave.wav');
  assert.equal([...result.samples.values()][0].channels[0].length, 63);
  assert.equal(result.parsed.regions[0].end, 31);
  assert.equal(result.parsed.regions[1].pitch_keycenter, 60);
  assert.equal(result.parsed.regions[0].loop_mode, 2);
  assert.equal(parsed.regions[0].sample, 'wave.wav');
  await assert.rejects(prepareSfzOscillatorSources(parsed, async () => pcm, 128), { code: 'too-large' });
});

test('built-in waves and noise use dedicated native source kinds without repeated noise PCM', async () => {
  for (const [wave, id] of [['*sine', 1], ['*saw', 2], ['*square', 3], ['*triangle', 4], ['*tri', 4], ['*noise', 5], ['*silence', 6]]) {
    const parsed = await parse(`<region> sample=${wave}`);
    assert.equal(properties(parsed.modulation.regions[0]).get(P.SourceWave), id);
    const result = await prepareSfzOscillatorSources(parsed, async path => createSfzGeneratorSample(path), 131072);
    assert.equal(result.samples.size, 1);
    if (id >= 5) assert.deepEqual([...result.samples.values()][0].channels[0], new Float32Array(3));
  }
});

test('oscillator invalid domains remain explicit and sample playback slices define the cycle', async () => {
  for (const opcode of ['oscillator=maybe', 'oscillator_mode=3', 'oscillator_multi=10',
    'oscillator_quality=4', 'oscillator_phase=361', 'oscillator_table_size=2.5']) {
    const parsed = await parse(`<region> sample=*sine ${opcode}`);
    assert.ok(parsed.modulation.diagnostics.length, opcode);
    assert.throws(() => packSfzModulation(parsed.modulation));
  }
  assert.equal((await parse('<control> oscillator=on <region> sample=wave.wav')).modulation.diagnostics[0].code, 'oscillator-scope');
  const parsed = await parse('<region> sample=wave.wav oscillator=on offset=2 end=3');
  const result = await prepareSfzOscillatorSources(parsed, async () => ({ sampleRate: 48000,
    channels: [new Float32Array([0, 0, 1, -1, 0])] }), 1024);
  assert.deepEqual([...result.samples.values()][0].channels[0], new Float32Array([1, -1, 0]));
});


test('cyclic half-rate pyramid retains logical phase, odd lengths and original DC with bounded packed geometry', () => {
  const input = Float32Array.from({ length: 128 }, (_, index) => .25 + Math.sin(2 * Math.PI * index / 128) + .3 * Math.sin(2 * Math.PI * 51 * index / 128));
  const output = prepareSfzCyclePyramid(input, 128);
  assert.equal(output.length, 255);
  assert.deepEqual(output.subarray(0, 128), input);
  for (let index = 0; index < 32; index++) assert.ok(Math.abs(output[192 + index] - (.25 + Math.sin(2 * Math.PI * index / 32))) < .002);
  assert.ok(Math.abs(output.at(-1) - .25) < 1e-7);
  assert.equal(sfzCyclePyramidFrames(8193), 16398);
  assert.equal(prepareSfzCyclePyramid(new Float32Array([1, 0, 0]), 1)[0], Math.fround(1 / 3));
  assert.throws(() => sfzCyclePyramidFrames(0xffffffff), { code: 'too-large' });
});

test('pyramid peak admission counts existing resident audio as well as all packed levels', async () => {
  const parsed = await parse('<region> sample=wave.wav oscillator=on oscillator_table_size=32');
  const load = async () => ({ sampleRate: 48000, channels: [new Float32Array(64)] });
  await assert.rejects(prepareSfzOscillatorSources(parsed, load, 1024, { residentBytes: 800 }), { code: 'too-large' });
  assert.equal((await prepareSfzOscillatorSources(parsed, load, 1052, { residentBytes: 800 })).samples.size, 1);
});
