import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySerializedState,
  convertLongToShortFormat,
  convertPresetToLongFormat,
  convertPresetToShortFormat,
  convertShortToLongFormat,
  getSerializablePluginStateLong,
  getSerializablePluginStateShort
} from '../../js/utils/serialization-utils.js';

function createPlugin(overrides = {}) {
  const calls = [];
  const plugin = {
    name: 'Original',
    enabled: true,
    inputBus: null,
    outputBus: undefined,
    channel: undefined,
    parameters: {},
    calls,
    setEnabled(value) {
      calls.push(['setEnabled', value]);
      this.enabled = value;
    },
    setParameters(params) {
      calls.push(['setParameters', params]);
      this.parameters = { ...this.parameters, ...params };
    },
    updateParameters() {
      calls.push(['updateParameters']);
    },
    ...overrides
  };
  return plugin;
}

test('getSerializablePluginStateShort removes internal fields and keeps routing aliases', () => {
  const plugin = createPlugin({
    name: 'Tone Control',
    enabled: false,
    inputBus: 1,
    outputBus: 2,
    channel: 'L',
    getSerializableParameters: () => ({ id: 'plugin-id', type: 'eq', enabled: true, gain: -2 })
  });

  assert.deepEqual(getSerializablePluginStateShort(plugin), {
    gain: -2,
    nm: 'Tone Control',
    en: false,
    ib: 1,
    ob: 2,
    ch: 'L'
  });
});

test('getSerializablePluginStateShort falls back through getParameters, parameters, and empty params', () => {
  const noSerializableMethod = createPlugin({
    name: 'NoSerializableMethod',
    getParameters: () => ({ balance: 0.25 })
  });
  assert.deepEqual(getSerializablePluginStateShort(noSerializableMethod), {
    nm: 'NoSerializableMethod',
    en: true
  });

  const fromGetter = createPlugin({
    name: 'Getter',
    getSerializableParameters: () => null,
    getParameters: () => ({ enabled: false, nested: { value: 1 } })
  });
  const getterResult = getSerializablePluginStateShort(fromGetter);
  assert.deepEqual(getterResult, { nested: { value: 1 }, nm: 'Getter', en: true });
  getterResult.nested.value = 99;
  assert.deepEqual(fromGetter.getParameters(), { enabled: false, nested: { value: 1 } });

  const fromParameters = createPlugin({
    name: 'Parameters',
    getSerializableParameters: () => null,
    parameters: { id: 'id', type: 'type', enabled: false, mix: 0.25 }
  });
  assert.deepEqual(getSerializablePluginStateShort(fromParameters), {
    mix: 0.25,
    nm: 'Parameters',
    en: true
  });

  const empty = createPlugin({
    name: 'Empty',
    getSerializableParameters: () => null,
    getParameters: () => null,
    parameters: null
  });
  assert.deepEqual(getSerializablePluginStateShort(empty), { nm: 'Empty', en: true });
});

test('getSerializablePluginStateLong deep-copies params and preserves long routing fields', () => {
  const params = { id: 'id', enabled: false, nested: { value: 1 } };
  const plugin = createPlugin({
    name: 'Long',
    enabled: false,
    inputBus: 0,
    outputBus: 3,
    channel: 'R',
    getSerializableParameters: () => params
  });

  const result = getSerializablePluginStateLong(plugin, true);
  params.nested.value = 99;

  assert.deepEqual(result, {
    name: 'Long',
    enabled: false,
    parameters: { nested: { value: 1 } },
    inputBus: 0,
    outputBus: 3,
    channel: 'R'
  });
});

test('getSerializablePluginStateLong falls back to getParameters, parameters, and empty params', () => {
  const noSerializableMethod = createPlugin({
    name: 'NoSerializableMethodLong',
    getParameters: () => ({ balance: 0.25 })
  });
  assert.deepEqual(getSerializablePluginStateLong(noSerializableMethod), {
    name: 'NoSerializableMethodLong',
    enabled: true,
    parameters: {}
  });

  const fromGetter = createPlugin({
    name: 'GetterLong',
    getSerializableParameters: () => null,
    getParameters: () => ({ id: 'id', enabled: false, gain: -1 })
  });
  assert.deepEqual(getSerializablePluginStateLong(fromGetter), {
    name: 'GetterLong',
    enabled: true,
    parameters: { gain: -1 }
  });

  const fromParameters = createPlugin({
    name: 'ParametersLong',
    getSerializableParameters: () => null,
    parameters: { id: 'id', enabled: true, width: 0.7 }
  });
  assert.deepEqual(getSerializablePluginStateLong(fromParameters), {
    name: 'ParametersLong',
    enabled: true,
    parameters: { width: 0.7 }
  });

  const empty = createPlugin({
    name: 'EmptyLong',
    getSerializableParameters: () => null,
    getParameters: () => null,
    parameters: null
  });
  assert.deepEqual(getSerializablePluginStateLong(empty), {
    name: 'EmptyLong',
    enabled: true,
    parameters: {}
  });
});

test('applySerializedState applies short state through setSerializedParameters', () => {
  const plugin = createPlugin({
    setSerializedParameters(state) {
      this.calls.push(['setSerializedParameters', state]);
    }
  });
  const state = { nm: 'Short', en: false, ib: 1, ob: 2, ch: 'Left', gain: -4 };

  applySerializedState(plugin, state);

  assert.equal(plugin.name, 'Short');
  assert.equal(plugin.enabled, false);
  assert.equal(plugin.inputBus, 1);
  assert.equal(plugin.outputBus, 2);
  assert.equal(plugin.channel, 'L');
  assert.deepEqual(plugin.calls, [
    ['setEnabled', false],
    ['setSerializedParameters', state],
    ['updateParameters']
  ]);
});

test('applySerializedState applies short params through setParameters or direct parameters', () => {
  const viaSetParameters = createPlugin();
  applySerializedState(viaSetParameters, { nm: 'ShortParams', ch: 'Right', mix: 0.5 });
  assert.equal(viaSetParameters.channel, 'R');
  assert.deepEqual(viaSetParameters.parameters, { mix: 0.5 });

  const viaParameters = createPlugin({ setParameters: undefined, parameters: { existing: true } });
  applySerializedState(viaParameters, { nm: 'DirectParams', ch: 'All', tone: 1 });
  assert.equal(viaParameters.channel, 'A');
  assert.deepEqual(viaParameters.parameters, { existing: true, tone: 1 });
});

test('applySerializedState applies long state and normalizes channel values', () => {
  const plugin = createPlugin();
  applySerializedState(plugin, {
    name: 'LongState',
    enabled: false,
    inputBus: 0,
    outputBus: 1,
    channel: '5',
    parameters: { depth: 0.8 }
  });

  assert.equal(plugin.name, 'LongState');
  assert.equal(plugin.enabled, false);
  assert.equal(plugin.inputBus, 0);
  assert.equal(plugin.outputBus, 1);
  assert.equal(plugin.channel, '5');
  assert.deepEqual(plugin.parameters, { depth: 0.8 });
});

test('applySerializedState preserves already-normalized channel aliases', () => {
  const left = createPlugin();
  applySerializedState(left, { nm: 'LeftAlias', ch: 'L' });
  assert.equal(left.channel, 'L');

  const right = createPlugin();
  applySerializedState(right, { name: 'RightAlias', channel: 'R' });
  assert.equal(right.channel, 'R');

  const all = createPlugin();
  applySerializedState(all, { name: 'AllAlias', channel: 'A' });
  assert.equal(all.channel, 'A');
});

test('applySerializedState handles numeric channel boundaries and missing parameters', () => {
  const lower = createPlugin();
  applySerializedState(lower, { name: 'TooLow', channel: '2' });
  assert.equal(lower.channel, null);

  const upper = createPlugin();
  applySerializedState(upper, { name: 'TooHigh', channel: '9' });
  assert.equal(upper.channel, null);

  const number = createPlugin();
  applySerializedState(number, { name: 'Number', channel: 4 });
  assert.equal(number.channel, null);

  const noParameters = createPlugin();
  applySerializedState(noParameters, { name: 'NoParameters' });
  assert.equal(noParameters.name, 'NoParameters');
  assert.deepEqual(noParameters.parameters, {});
});

test('applySerializedState supports long setSerializedParameters and direct parameter assignment', () => {
  const serialized = createPlugin({
    setSerializedParameters(params) {
      this.calls.push(['setSerializedParameters', params]);
    }
  });
  applySerializedState(serialized, { name: 'SerializedLong', channel: '', parameters: { a: 1 } });
  assert.equal(serialized.channel, null);
  assert.deepEqual(serialized.calls, [
    ['setSerializedParameters', { a: 1 }],
    ['updateParameters']
  ]);

  const direct = createPlugin({ setParameters: undefined, parameters: { existing: true } });
  applySerializedState(direct, { name: 'DirectLong', channel: 'invalid', parameters: { b: 2 } });
  assert.equal(direct.channel, null);
  assert.deepEqual(direct.parameters, { existing: true, b: 2 });
});

test('applySerializedState tolerates plugins without parameter or update hooks', () => {
  const shortPlugin = createPlugin({
    setParameters: undefined,
    parameters: undefined,
    updateParameters: undefined
  });
  applySerializedState(shortPlugin, { nm: 'NoParamHooks', gain: -1 });
  assert.equal(shortPlugin.name, 'NoParamHooks');

  const longPlugin = createPlugin({
    setParameters: undefined,
    parameters: undefined,
    updateParameters: undefined
  });
  applySerializedState(longPlugin, { name: 'NoLongParamHooks', parameters: { gain: -2 } });
  assert.equal(longPlugin.name, 'NoLongParamHooks');
});

test('applySerializedState preserves and restores undo-redo guard around updates', () => {
  const historyManager = { isUndoRedoOperation: false };
  const plugin = createPlugin({
    audioManager: { pipelineManager: { historyManager } },
    updateParameters() {
      this.calls.push(['updateParameters', historyManager.isUndoRedoOperation]);
      throw new Error('update failed');
    }
  });

  assert.throws(() => applySerializedState(plugin, { name: 'Throws', channel: null }), /update failed/);
  assert.equal(historyManager.isUndoRedoOperation, false);
  assert.deepEqual(plugin.calls, [['updateParameters', true]]);
});

test('applySerializedState updates when audioManager lacks a pipeline manager', () => {
  const plugin = createPlugin({
    audioManager: {},
    updateParameters() {
      this.calls.push(['updateParameters']);
    }
  });

  applySerializedState(plugin, { name: 'PartialAudioManager' });
  assert.deepEqual(plugin.calls, [['updateParameters']]);
});

test('applySerializedState safely ignores missing plugin, missing state, and unknown format', () => {
  assert.equal(applySerializedState(null, { name: 'NoPlugin' }), undefined);
  const plugin = createPlugin();
  assert.equal(applySerializedState(plugin, null), undefined);
  assert.equal(applySerializedState(plugin, { parameters: { ignored: true } }), undefined);
  assert.deepEqual(plugin.parameters, {});
});

test('format converters handle nulls, routing, channels, and parameters', () => {
  assert.equal(convertLongToShortFormat(null), null);
  assert.equal(convertShortToLongFormat(null), null);

  assert.deepEqual(convertLongToShortFormat({
    name: 'Long',
    enabled: true,
    inputBus: 1,
    outputBus: 2,
    channel: '3',
    parameters: { gain: -2 }
  }), {
    nm: 'Long',
    en: true,
    gain: -2,
    ib: 1,
    ob: 2,
    ch: '3'
  });

  assert.deepEqual(convertLongToShortFormat({
    name: 'NoChannel',
    enabled: false,
    channel: null,
    parameters: {}
  }), {
    nm: 'NoChannel',
    en: false
  });

  assert.deepEqual(convertLongToShortFormat({
    name: 'NoParams',
    enabled: true
  }), {
    nm: 'NoParams',
    en: true
  });

  assert.deepEqual(convertShortToLongFormat({
    nm: 'Short',
    en: false,
    ib: 0,
    ob: 1,
    ch: 'A',
    mix: 0.5
  }), {
    name: 'Short',
    enabled: false,
    parameters: { mix: 0.5 },
    inputBus: 0,
    outputBus: 1,
    channel: 'A'
  });

  assert.deepEqual(convertShortToLongFormat({ nm: 'NoChannel', en: true, ch: null }), {
    name: 'NoChannel',
    enabled: true,
    parameters: {}
  });
});

test('preset converters preserve unsupported formats and convert supported presets', () => {
  const untouchedLong = { name: 'Untouched', plugins: [] };
  const untouchedShort = { name: 'Untouched', pipeline: [] };
  const nonArrayPipeline = { name: 'NonArrayPipeline', pipeline: 'not array' };
  const nonArrayPlugins = { name: 'NonArrayPlugins', plugins: 'not array' };
  assert.equal(convertPresetToShortFormat(null), null);
  assert.equal(convertPresetToShortFormat(untouchedLong), untouchedLong);
  assert.equal(convertPresetToShortFormat(nonArrayPipeline), nonArrayPipeline);
  assert.equal(convertPresetToLongFormat(null), null);
  assert.equal(convertPresetToLongFormat(untouchedShort), untouchedShort);
  assert.equal(convertPresetToLongFormat(nonArrayPlugins), nonArrayPlugins);

  assert.deepEqual(convertPresetToShortFormat({
    pipeline: [{ name: 'Volume', enabled: true, parameters: { gain: -1 } }]
  }), {
    name: 'Converted Preset',
    plugins: [{ nm: 'Volume', en: true, gain: -1 }]
  });

  assert.deepEqual(convertPresetToLongFormat({
    name: 'Short Preset',
    timestamp: 123,
    plugins: [{ nm: 'Volume', en: true, gain: -1 }]
  }), {
    name: 'Short Preset',
    pipeline: [{ name: 'Volume', enabled: true, parameters: { gain: -1 } }],
    timestamp: 123
  });

  const before = Date.now();
  const converted = convertPresetToLongFormat({ plugins: [] });
  const after = Date.now();
  assert.equal(converted.name, 'Converted Preset');
  assert.deepEqual(converted.pipeline, []);
  assert.ok(converted.timestamp >= before && converted.timestamp <= after);
});
