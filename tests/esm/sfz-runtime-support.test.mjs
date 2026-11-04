import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseSfz } from '../../js/sfz/parser.js';
import { packSfzAsset } from '../../js/sfz/asset.js';
import { requireSfzRuntimeSupport, sfzRuntimeLimitations } from '../../js/sfz/runtime-support.js';

async function descriptor(fields) {
  const parsed = await parseSfz({ selectedPath: 'test.sfz',
    readText: async () => `<region> sample=tone.wav ${fields}`, onDiagnostic: null });
  assert.deepEqual(parsed.modulation.diagnostics, []);
  const samples = new Map(parsed.regions.map(region => [region.sample, {
    sampleRate: 48000, channels: [new Float32Array(64)]
  }]));
  const asset = packSfzAsset(parsed.regions, samples, { modulation: parsed.modulation, effects: parsed.effects });
  return { parsed, asset };
}

test('production checkpoint retains existing sample, CC trigger and peak EQ behavior', async () => {
  for (const fields of ['', 'delay=.1 offset=3 loop_start=1 loop_end=20 loop_count=2',
    'on_locc64=64 on_hicc64=127', 'locc64=0 hicc64=63', 'amp_veltrack=100',
    'offset_mode=samples delay_samples=0', 'eq1_type=peak eq1_freq=1000 eq1_gain=3']) {
    const { asset } = await descriptor(fields);
    assert.deepEqual(asset.unsupportedRuntime, [], fields);
    assert.doesNotThrow(() => requireSfzRuntimeSupport(asset));
  }
  const plain = await descriptor('eq1_freq=1000 eq1_gain=3');
  const explicit = await descriptor('offset_mode=samples delay_samples=0 eq1_type=peak eq1_freq=1000 eq1_gain=3');
  assert.deepEqual(explicit.asset.payload, plain.asset.payload, 'Explicit no-op defaults retain identical native behavior');
});

test('the matching native profile admits implemented playback, lifecycle, conditions and optional voice DSP', async () => {
  for (const fields of [
    'delay_samples=1', 'offset_mode=percent', 'rt_decay=1', 'stop_locc64=64',
    'lohdcc64=.5', 'lobpm=120', 'eq1_type=lshelf', 'eq1_type=peak eq1_dynamic=1',
    'key=-1 on_locc64=64', 'end=-1', 'dsp_order=1 drive=40', 'noise_level=-30'
  ]) {
    const { asset } = await descriptor(fields);
    assert.deepEqual(asset.unsupportedRuntime, [], fields);
    assert.doesNotThrow(() => requireSfzRuntimeSupport(asset));
  }
  const { parsed, asset } = await descriptor('delay_samples=0 delay_samples_oncc1=16777217');
  assert.ok(parsed.modulation.regions[0].routes.some(route => route.depth === 16777217));
  assert.deepEqual(asset.unsupportedRuntime, [], 'A default base retains its authored route and implemented consumer');
  assert.deepEqual(sfzRuntimeLimitations({ version: 4, regions: [{ instances: [{ kind: 999 }] }] }, null), ['kind:999']);
});

test('unsupported runtime uses a useful distinct live and offline error message', () => {
  const window = {};
  class PluginBase { constructor() {} }
  vm.runInNewContext(fs.readFileSync(new URL('../../plugins/sfz-instrument.js', import.meta.url), 'utf8'),
    { window, PluginBase, console: { error() {} } });
  const plugin = new window.SFZInstrumentPlugin();
  plugin._renderStatus = () => {};
  plugin._showError({ code: 'unsupported-runtime' });
  assert.equal(plugin.offlineDspAssetErrorMessageKey, 'sfzNotePlayer.error.unsupportedRuntime');
  assert.match(plugin._errorMessage(), /features.*not available.*Choose another SoundFont/);
  assert.doesNotMatch(plugin._errorMessage(), /kind:|property:|sample files/);
});

test('only the implemented effects profile is admitted, even without modulation metadata', () => {
  for (const modulation of [null, { version: 3, regions: [] }, { version: 4, regions: [] }]) {
    assert.deepEqual(sfzRuntimeLimitations(modulation, { version: 1, nodes: [{ type: 2 }, { type: 14 }] }), []);
    assert.deepEqual(sfzRuntimeLimitations(modulation, { nodes: [{}] }), ['effects']);
    assert.deepEqual(sfzRuntimeLimitations(modulation, { version: 2, nodes: [] }), ['effects']);
    assert.deepEqual(sfzRuntimeLimitations(modulation, { version: 1, nodes: [{ type: 999 }] }), ['effects']);
  }
});

test('implemented random velocity tracking is accepted while unresolved storage settings are rejected', async () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(new URL('../../plugins/sfz-instrument.js', import.meta.url), 'utf8'),
    { window, PluginBase: class {}, console: { error() {} } });
  const plugin = new window.SFZInstrumentPlugin();
  const supported = await descriptor('amp_veltrack_random=25');
  assert.deepEqual(supported.parsed.unsupportedOpcodes, []);
  assert.doesNotThrow(() => plugin.validatePreparedSfzBank({ descriptor: {
    ...supported.asset, unsupportedOpcodes: supported.parsed.unsupportedOpcodes
  } }, false));
  await assert.rejects(() => descriptor('load_mode=3'), error => error.code === 'no-regions');
});
