import assert from 'node:assert/strict';
import test from 'node:test';

import { MidiMappingEngine } from '../../js/midi/midi-mapping-engine.js';
import { ParamAdapter } from '../../js/midi/param-adapter.js';
import { DSP_AUTOMATION_CATALOG } from '../../js/audio/dsp-params.generated.js';

const descriptor = {
  key: 'gain', element: 0, field: 'gn', containerKey: '', memberKey: '', kind: 'float',
  normalization: 'linear', minimum: 0, maximum: 1, step: 0.01, default: 0
};

function plugin(id, value = 0) {
  return {
    id,
    constructor: { name: 'TestPlugin' },
    gn: value,
    setParameters(parameters) { Object.assign(this, parameters); },
    getSerializableParameters() { return { gn: this.gn }; },
    setEnabled(on) { this.enabled = on; },
    syncUIControls() { this.synced = (this.synced || 0) + 1; }
  };
}

function mapping(id, source, instance = 'first') {
  return {
    id, device: 'Device', source,
    target: { type: 'TestPlugin', instance, param: 'gain', element: 0 },
    map: { lo: 0, hi: 1, sensitivity: 1, dir: 1, buttonMode: 'toggle' }
  };
}

function harness(mappings, pipeline) {
  const calls = { worklet: 0, url: 0, history: 0 };
  const windowRef = {
    audioManager: { pipeline },
    pipelineManager: {
      core: { updateWorkletPlugin() { calls.worklet++; } },
      historyManager: {
        withHistorySuppressed(callback) { return callback(); },
        saveState() { calls.history++; }
      }
    },
    uiManager: {
      urlReflectionEnabled: true,
      isDoubleBlindActive: () => false,
      updateURL() { calls.url++; }
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {}
  };
  const engine = new MidiMappingEngine({
    store: { mappings },
    adapter: new ParamAdapter({ catalog: { TestPlugin: [descriptor] } }),
    windowRef,
    documentRef: { hidden: false },
    requestFrame: () => 1,
    setTimeoutFn: () => 1,
    clearTimeoutFn() {}
  });
  return { engine, calls, windowRef };
}

test('absolute messages coalesce and all targets update with one URL reflection', () => {
  const plugins = [plugin(1), plugin(2)];
  const item = mapping('absolute', { kind: 'cc', channel: 0, number: 7, mode: 'abs' }, 'all');
  const { engine, calls, windowRef } = harness([item], plugins);
  for (let value = 1; value <= 10; value++) engine.onSourceEvent('Device', item.source, value);
  engine.applyFrame();
  assert.equal(plugins[0].gn, 10 / 127);
  assert.equal(plugins[1].gn, 10 / 127);
  assert.equal(calls.worklet, 2);
  assert.equal(calls.url, 1);
  assert.equal(windowRef.uiManager.urlReflectionEnabled, true);
  const switched = plugin(3);
  windowRef.audioManager.pipeline = [switched];
  engine.onSourceEvent('Device', item.source, 10);
  engine.applyFrame();
  assert.equal(switched.gn, 10 / 127);
});

test('absolute mappings use real parameter values for their configured range', () => {
  const target = {
    ...plugin(1),
    constructor: { name: 'RangePlugin' }
  };
  const item = mapping('real-range', { kind: 'cc', channel: 0, number: 7, mode: 'abs' });
  item.target.type = 'RangePlugin';
  item.map = { ...item.map, lo: -6, hi: 9 };
  const { engine } = harness([item], [target]);
  engine.adapter.catalog.RangePlugin = [{
    ...descriptor,
    minimum: -12,
    maximum: 12,
    step: 0.5
  }];
  engine.onSourceEvent('Device', item.source, 127);
  engine.applyFrame();
  assert.equal(target.gn, 9);
  engine.onSourceEvent('Device', item.source, 0);
  engine.applyFrame();
  assert.equal(target.gn, -6);
});

test('integer endpoints use the same canonical grid at runtime as persisted mappings', () => {
  const target = {
    ...plugin(1),
    constructor: { name: 'IntegerPlugin' },
    st: 2,
    setParameters(parameters) { Object.assign(this, parameters); },
    getSerializableParameters() { return { st: this.st }; }
  };
  const item = mapping('integer-range', { kind: 'cc', channel: 0, number: 7, mode: 'abs' });
  item.target = { type: 'IntegerPlugin', instance: 'first', param: 'steps', element: 0 };
  item.map = { ...item.map, lo: 6.4, hi: 99 };
  const { engine } = harness([item], [target]);
  engine.adapter.catalog.IntegerPlugin = [{
    ...descriptor, key: 'steps', field: 'st', kind: 'int', normalization: 'integer',
    minimum: 2, maximum: 14, step: 3, stepCount: 4, default: 2
  }];
  engine.onSourceEvent('Device', item.source, 0);
  engine.applyFrame();
  assert.equal(target.st, 5);
  engine.onSourceEvent('Device', item.source, 127);
  engine.applyFrame();
  assert.equal(target.st, 14);
});

test('absolute same-value skip follows mapping definition and resolved targets', () => {
  const first = plugin(1);
  const second = plugin(2);
  const item = mapping('absolute', { kind: 'cc', channel: 0, number: 7, mode: 'abs' });
  const { engine, windowRef } = harness([item], [first]);
  engine.onSourceEvent('Device', item.source, 64);
  engine.applyFrame();
  item.target = { ...item.target, param: 'gain', instance: 'last' };
  windowRef.audioManager.pipeline = [first, second];
  engine.onSourceEvent('Device', item.source, 64);
  engine.applyFrame();
  assert.equal(second.gn, 64 / 127);
  windowRef.audioManager.pipeline = [];
  engine.onSourceEvent('Device', item.source, 64);
  engine.applyFrame();
  windowRef.audioManager.pipeline = [first, second];
  second.gn = 0;
  engine.onSourceEvent('Device', item.source, 64);
  engine.applyFrame();
  assert.equal(second.gn, 64 / 127);
});

test('relative messages accumulate and re-seed after an external change', () => {
  const target = plugin(1, 0.25);
  const item = mapping('relative', { kind: 'cc', channel: 0, number: 8, mode: 'rel2c' });
  const { engine } = harness([item], [target]);
  for (let index = 0; index < 10; index++) engine.onSourceEvent('Device', item.source, 1);
  engine.applyFrame();
  assert.ok(Math.abs(target.gn - (0.25 + 10 / 127)) < 1e-9);
  target.gn = 0.5;
  engine.onSourceEvent('Device', item.source, 1);
  engine.applyFrame();
  assert.ok(Math.abs(target.gn - (0.5 + 1 / 127)) < 1e-9);
});

test('relative accumulators re-seed when a mapping changes to a coarse integer target', () => {
  const continuous = plugin(1, 0.5);
  const stepped = {
    ...plugin(2, 1),
    constructor: { name: 'SteppedPlugin' },
    steps: 1,
    setParameters(parameters) { Object.assign(this, parameters); },
    getSerializableParameters() { return { steps: this.steps }; }
  };
  const item = mapping('relative-target', { kind: 'cc', channel: 0, number: 8, mode: 'rel2c' });
  const { engine, windowRef } = harness([item], [continuous]);
  engine.onSourceEvent('Device', item.source, 32);
  engine.applyFrame();
  assert.ok(continuous.gn > 0.7);

  item.target = { type: 'SteppedPlugin', instance: 'first', param: 'steps', element: 0 };
  engine.adapter.catalog.SteppedPlugin = [{
    ...descriptor, key: 'steps', field: 'steps', kind: 'int', normalization: 'integer',
    minimum: 0, maximum: 4, step: 1, stepCount: 4
  }];
  windowRef.audioManager.pipeline = [stepped];
  engine.onSourceEvent('Device', item.source, 1);
  engine.applyFrame();
  assert.equal(stepped.steps, 1, 'one small increment must remain below the next integer step');
});

test('relative sign-and-magnitude treats 64 as neutral', () => {
  const target = plugin(1, 0.5);
  const item = mapping('relative-sign', { kind: 'cc', channel: 0, number: 8, mode: 'relSign' });
  const { engine } = harness([item], [target]);
  engine.onSourceEvent('Device', item.source, 64);
  engine.applyFrame();
  assert.equal(target.gn, 0.5);
  engine.onSourceEvent('Device', item.source, 65);
  engine.applyFrame();
  assert.ok(Math.abs(target.gn - (0.5 - 1 / 127)) < 1e-9);
});

test('enum relative mappings stop and button mappings cycle inside their configured range', () => {
  const target = {
    ...plugin(1),
    constructor: { name: 'EnumPlugin' },
    en: 'middle',
    setParameters(parameters) { Object.assign(this, parameters); },
    getSerializableParameters() { return { en: this.en }; }
  };
  const enumDescriptor = {
    ...descriptor, key: 'mode', field: 'en', kind: 'enum', normalization: 'enum',
    values: ['low', 'middle', 'high', 'maximum'], minimum: 0, maximum: 3,
    step: 1, stepCount: 3, default: 'low'
  };
  const relative = mapping('enum-relative', { kind: 'cc', channel: 0, number: 8, mode: 'rel2c' });
  relative.target = { type: 'EnumPlugin', instance: 'first', param: 'mode', element: 0 };
  relative.map = { ...relative.map, lo: 'middle', hi: 'maximum' };
  const button = mapping('enum-button', { kind: 'note', channel: 0, number: 9 });
  button.target = relative.target;
  button.map = { ...button.map, lo: 'middle', hi: 'maximum', dir: 1 };
  const { engine } = harness([relative, button], [target]);
  engine.adapter.catalog.EnumPlugin = [enumDescriptor];

  engine.onSourceEvent('Device', relative.source, 1);
  engine.applyFrame();
  assert.equal(target.en, 'high');
  engine.onSourceEvent('Device', relative.source, 1);
  engine.applyFrame();
  assert.equal(target.en, 'maximum');
  engine.onSourceEvent('Device', relative.source, 1);
  engine.applyFrame();
  assert.equal(target.en, 'maximum');
  engine.onSourceEvent('Device', relative.source, 126);
  engine.applyFrame();
  assert.equal(target.en, 'middle');

  target.en = 'maximum';
  engine.onSourceEvent('Device', button.source, { pressed: true });
  engine.applyFrame();
  assert.equal(target.en, 'middle');
  button.map = { ...button.map, dir: -1 };
  engine.onSourceEvent('Device', button.source, { pressed: true });
  engine.applyFrame();
  assert.equal(target.en, 'maximum');

  relative.map = { ...relative.map, lo: 'maximum', hi: 'middle' };
  target.en = 'high';
  engine.onSourceEvent('Device', relative.source, 1);
  engine.applyFrame();
  assert.equal(target.en, 'middle');
  button.map = { ...button.map, lo: 'maximum', hi: 'middle', dir: 1 };
  target.en = 'middle';
  engine.onSourceEvent('Device', button.source, { pressed: true });
  engine.applyFrame();
  assert.equal(target.en, 'maximum');
});

test('timer automation applies direct, random, and random-walk actions without URL or history writes', () => {
  const target = plugin(1, 0.8);
  const direct = mapping('timer-direct', { kind: 'timer', intervalMs: 1000 });
  direct.device = '';
  direct.map = { ...direct.map, lo: 0.2, hi: 0.9, dir: -1, behavior: 'direct', amount: 0.3 };
  const random = mapping('timer-random', { kind: 'timer', intervalMs: 1000 });
  random.device = '';
  random.map = { ...random.map, lo: 0.2, hi: 0.8, behavior: 'random', amount: 0.1 };
  const walk = mapping('timer-walk', { kind: 'timer', intervalMs: 1000 });
  walk.device = '';
  walk.map = { ...walk.map, lo: 0.2, hi: 0.8, behavior: 'randomWalk', amount: 0.3 };
  const { engine, calls } = harness([direct, random, walk], [target]);

  assert.equal(engine.onAutomationEvent(direct.id, { kind: 'timer' }), true);
  engine.applyFrame();
  assert.equal(target.gn, 0.5);
  engine.randomFn = () => 0.5;
  engine.onAutomationEvent(random.id, { kind: 'timer' });
  engine.applyFrame();
  assert.equal(target.gn, 0.5);
  engine.randomFn = () => 0.1;
  engine.onAutomationEvent(walk.id, { kind: 'timer' });
  engine.applyFrame();
  assert.equal(target.gn, 0.2);
  engine.randomFn = () => 0.9;
  engine.onAutomationEvent(walk.id, { kind: 'timer' });
  engine.applyFrame();
  assert.equal(target.gn, 0.5);
  assert.deepEqual(calls, { worklet: 4, url: 0, history: 0 });
});

test('timer random-walk uses AM Radio Static Rate public values and refreshes its runtime target', () => {
  const target = {
    ...plugin(1, 0),
    constructor: { name: 'AMRadioSimulatorPlugin' },
    st: 0.3,
    setParameters(parameters) { Object.assign(this, parameters); },
    getSerializableParameters() { return { st: this.st }; }
  };
  const item = mapping('am-static-walk', { kind: 'timer', schedule: 'interval', intervalMs: 1000 });
  item.device = '';
  item.target = { type: 'AMRadioSimulatorPlugin', instance: 'first', param: 'st', element: 0 };
  item.map = { ...item.map, lo: 0, hi: 100, behavior: 'randomWalk', amount: 0.1 };
  const { engine, calls } = harness([item], [target]);
  engine.adapter.catalog.AMRadioSimulatorPlugin = DSP_AUTOMATION_CATALOG.AMRadioSimulatorPlugin;
  const randomValues = [0.9, 0.1, 0.1];
  engine.randomFn = () => randomValues.shift();

  for (const expected of [0.4, 0.3, 0.2]) {
    assert.equal(engine.onAutomationEvent(item.id, { kind: 'timer' }), true);
    engine.applyFrame();
    assert.ok(Math.abs(target.st - expected) < 1e-12);
  }
  assert.equal(calls.worklet, 3);
  assert.equal(target.synced, 3);
  assert.equal(calls.url, 0);
  assert.equal(calls.history, 0);
});

test('automation uses adapter public values, integer grids, all targets, and the Double Blind gate', () => {
  const targets = [
    { ...plugin(1, 2), constructor: { name: 'IntegerPlugin' }, st: 2,
      setParameters(parameters) { Object.assign(this, parameters); },
      getSerializableParameters() { return { st: this.st }; } },
    { ...plugin(2, 2), constructor: { name: 'IntegerPlugin' }, st: 2,
      setParameters(parameters) { Object.assign(this, parameters); },
      getSerializableParameters() { return { st: this.st }; } }
  ];
  const item = mapping('integer-walk', { kind: 'timer', intervalMs: 1000 }, 'all');
  item.device = '';
  item.target = { type: 'IntegerPlugin', instance: 'all', param: 'steps', element: 0 };
  item.map = { ...item.map, lo: 2, hi: 14, behavior: 'random', amount: 3 };
  const { engine, windowRef } = harness([item], targets);
  engine.adapter.catalog.IntegerPlugin = [{
    ...descriptor, key: 'steps', field: 'st', kind: 'int', normalization: 'integer',
    minimum: 2, maximum: 14, step: 3, stepCount: 4, default: 2
  }];
  engine.randomFn = () => 0.999;
  engine.onAutomationEvent(item.id, { kind: 'timer' });
  engine.applyFrame();
  assert.deepEqual(targets.map(target => target.st), [14, 14]);
  windowRef.uiManager.isDoubleBlindActive = () => true;
  assert.equal(engine.onAutomationEvent(item.id, { kind: 'timer' }), false);
});

test('timer direct action reads and applies transformed public values through ParamAdapter', () => {
  const target = {
    ...plugin(1),
    constructor: { name: 'TransformedPlugin' },
    packed: Math.log(2),
    setParameters(parameters) { Object.assign(this, parameters); },
    getSerializableParameters() { return { packed: this.packed }; }
  };
  const item = mapping('transformed', { kind: 'timer', intervalMs: 1000 });
  item.device = '';
  item.target = { type: 'TransformedPlugin', instance: 'first', param: 'value', element: 0 };
  item.map = { ...item.map, lo: 1, hi: 4, behavior: 'direct', amount: 1 };
  const { engine } = harness([item], [target]);
  engine.adapter.catalog.TransformedPlugin = [{
    ...descriptor, key: 'value', field: 'packed', transform: 'naturalLog', transformReference: 1,
    minimum: 1, maximum: 4, step: 0.1, default: 2
  }];
  engine.onAutomationEvent(item.id, { kind: 'timer' });
  engine.applyFrame();
  const resolved = engine.adapter.resolve('TransformedPlugin', 'value', 0);
  assert.ok(Math.abs(engine.adapter.read(target, resolved) - 3) < 1e-12);
});

test('mixed automation and physical events preserve insertion order and commit once', () => {
  const target = plugin(1);
  const physical = mapping('physical', { kind: 'cc', channel: 0, number: 7, mode: 'abs' });
  const timer = mapping('timer', { kind: 'timer', intervalMs: 1000 });
  timer.device = '';
  timer.map = { ...timer.map, behavior: 'direct', amount: 0.1 };
  const { engine, calls } = harness([physical, timer], [target]);
  engine.onSourceEvent('Device', physical.source, 64);
  engine.onAutomationEvent(timer.id, { kind: 'timer' });
  engine.applyFrame();
  assert.ok(Math.abs(target.gn - (64 / 127 + 0.1)) < 1e-12);
  assert.equal(calls.url, 1);
  assert.equal(calls.history, 0);
});

test('Double Blind Test rejects source events before they are queued', () => {
  const target = plugin(1);
  const item = mapping('blocked', { kind: 'cc', channel: 0, number: 9, mode: 'abs' });
  const { engine, windowRef } = harness([item], [target]);
  windowRef.uiManager.isDoubleBlindActive = () => true;
  assert.equal(engine.onSourceEvent('Device', item.source, 127), false);
  engine.applyFrame();
  assert.equal(target.gn, 0);
});

test('button edges toggle Enabled and invoke both global operations', () => {
  const target = plugin(1);
  target.enabled = true;
  const enabled = mapping('enabled', { kind: 'key', keyCombo: 'E' });
  enabled.device = '';
  enabled.target.param = '_enabled';
  const master = mapping('master', { kind: 'key', keyCombo: 'M' });
  master.device = '';
  master.target = { type: '_global', instance: 'first', param: 'masterBypass', element: 0 };
  const ab = mapping('ab', { kind: 'key', keyCombo: 'B' });
  ab.device = '';
  ab.target = { type: '_global', instance: 'first', param: 'abToggle', element: 0 };
  const { engine, windowRef } = harness([enabled, master, ab], [target]);
  let masterClicks = 0;
  let abToggles = 0;
  windowRef.pipelineManager.core.masterToggle = { click() { masterClicks++; } };
  windowRef.pipelineManager.core.updateAllPluginDisplayState = () => {};
  windowRef.uiManager.togglePipeline = () => { abToggles++; };
  engine.onSourceEvent('', enabled.source, { pressed: true });
  engine.onSourceEvent('', master.source, { pressed: true });
  engine.onSourceEvent('', ab.source, { pressed: true });
  engine.applyFrame();
  assert.equal(target.enabled, false);
  assert.equal(masterClicks, 1);
  assert.equal(abToggles, 1);
  engine.dispose();
});

test('engine default timer wrappers preserve the global native receiver for frame and history cleanup', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const calls = [];
  let handle = 0;
  try {
    globalThis.setTimeout = function nativeSetTimeout(...args) {
      assert.equal(this, globalThis);
      calls.push({ kind: 'set', args });
      return ++handle;
    };
    globalThis.clearTimeout = function nativeClearTimeout(...args) {
      assert.equal(this, globalThis);
      calls.push({ kind: 'clear', args });
    };
    const engine = new MidiMappingEngine({ store: { mappings: [] }, windowRef: {}, documentRef: { hidden: true } });
    engine.scheduleFrame();
    engine.scheduleHistorySave();
    engine.scheduleHistorySave();
    engine.dispose();
    assert.deepEqual(calls.map(call => [call.kind, call.args.at(-1)]), [
      ['set', 33], ['set', 1000], ['clear', 2], ['set', 1000], ['clear', 1], ['clear', 3]
    ]);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
