import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  DSP_AUTOMATION_CATALOG,
  packDSPAutomationValue
} from '../../js/audio/dsp-params.generated.js';
import {
  canonicalizeAutomationAmount,
  defaultAutomationAmount,
  ParamAdapter,
  UNASSIGNABLE_DESCRIPTORS
} from '../../js/midi/param-adapter.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginRoot = path.join(repoRoot, 'plugins');

class FakeObserver {
  observe() {}
  disconnect() {}
}

function documentStub() {
  const element = () => ({
    addEventListener() {}, appendChild() {}, append() {}, remove() {}, setAttribute() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: { setProperty() {} }, children: [], dataset: {}, querySelector() { return null; },
    querySelectorAll() { return []; }, getContext() { return null; }
  });
  return {
    body: element(), documentElement: element(), createElement: element, getElementById() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {}
  };
}

async function loadPluginClasses() {
  const document = documentStub();
  const sandbox = {
    window: {}, console, document, MutationObserver: FakeObserver, IntersectionObserver: FakeObserver,
    performance: { now: () => 0 }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    setTimeout, clearTimeout, setInterval, clearInterval, structuredClone
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = document;
  const context = vm.createContext(sandbox);
  vm.runInContext(await fs.readFile(path.join(pluginRoot, 'plugin-base.js'), 'utf8'), context, {
    filename: 'plugins/plugin-base.js'
  });
  const entries = (await fs.readFile(path.join(pluginRoot, 'plugins.txt'), 'utf8'))
    .split(/\r?\n/)
    .map(line => /^([^#\s][^:]*):\s*[^|]+\|\s*[^|]+\|\s*([^|\s]+)/.exec(line))
    .filter(Boolean)
    .map(([, relativePath, className]) => ({ className, relativePath: `${relativePath.trim()}.js` }));
  const classes = new Map();
  for (const entry of entries) {
    vm.runInContext(await fs.readFile(path.join(pluginRoot, entry.relativePath), 'utf8'), context, {
      filename: `plugins/${entry.relativePath}`
    });
    classes.set(entry.className, context.window[entry.className]);
  }
  return classes;
}

function descriptorId(type, descriptor) {
  return `${type}:${descriptor.key}:${descriptor.element}`;
}

function probeValues(descriptor) {
  if (descriptor.kind === 'bool') return [!descriptor.default, descriptor.default, !descriptor.default];
  if (descriptor.kind === 'enum') {
    const values = descriptor.values || [];
    return [values[0], values[Math.floor(values.length / 2)], values.at(-1)];
  }
  return [descriptor.minimum, (descriptor.minimum + descriptor.maximum) / 2, descriptor.maximum];
}

function prepareDependentPhaseRegion(plugin, descriptor) {
  if (plugin.constructor.name !== 'PhaseSelectEqPlugin') return;
  const region = plugin.regions?.[descriptor.element];
  if (!region) return;
  if (descriptor.key === 'opl') region.pl = 90;
  if (descriptor.key === 'obl') region.bl = 0;
  if (descriptor.key === 'obh') region.bh = 0;
}

const catalog = {
  TestPlugin: [
    { key: 'gain', element: 0, field: 'gn', containerKey: '', memberKey: '' },
    { key: 'band', element: 1, field: 'g1', containerKey: 'bands', memberKey: 'gain' },
    { key: 'channel', element: 2, field: 'm2', containerKey: 'modes', memberKey: '' }
  ]
};

test('ParamAdapter applies flat fields and reads serializable values', () => {
  const adapter = new ParamAdapter({ catalog });
  const plugin = {
    gn: 0,
    setParameters(parameters) { Object.assign(this, parameters); },
    getSerializableParameters() { return { gn: this.gn }; }
  };
  const resolved = adapter.resolve('TestPlugin', 'gain', 0);
  assert.equal(adapter.apply(plugin, resolved, 0.75), true);
  assert.equal(adapter.read(plugin, resolved), 0.75);
});

test('ParamAdapter uses live containers for member and scalar read-modify-write', () => {
  const adapter = new ParamAdapter({ catalog });
  const plugin = {
    bands: [{ gain: 1, q: 2 }, { gain: 3, q: { value: 4 } }, { gain: 5, q: 6 }],
    modes: ['a', 'b', 'c', 'd'],
    setParameters(parameters) { Object.assign(this, parameters); },
    getSerializableParameters() { return { bands: this.bands.slice(0, 1), modes: this.modes.slice(0, 1) }; }
  };
  const member = adapter.resolve('TestPlugin', 'band', 1);
  const scalar = adapter.resolve('TestPlugin', 'channel', 2);
  const nestedMember = plugin.bands[1].q;
  adapter.apply(plugin, member, 9);
  adapter.apply(plugin, scalar, 'z');
  assert.deepEqual(plugin.bands, [{ gain: 1, q: 2 }, { gain: 9, q: { value: 4 } }, { gain: 5, q: 6 }]);
  assert.notEqual(plugin.bands[1].q, nestedMember);
  assert.deepEqual(plugin.modes, ['a', 'b', 'z', 'd']);
  assert.equal(adapter.read(plugin, member), 9);
  assert.equal(adapter.read(plugin, scalar), 'z');
});

test('automation amounts use public values and integer descriptor grids', () => {
  assert.equal(defaultAutomationAmount({ kind: 'float', step: 0.25 }), 0.25);
  assert.equal(canonicalizeAutomationAmount({ kind: 'float', step: 0.25 }, 0.3), 0.3);
  assert.equal(canonicalizeAutomationAmount({ kind: 'int', step: 3 }, 4), 3);
  assert.equal(canonicalizeAutomationAmount({ kind: 'int', step: 3 }, 0), 3);
});

test('ParamAdapter converts transformed public values at the plugin boundary', async () => {
  const classes = await loadPluginClasses();
  const adapter = new ParamAdapter();
  const cases = [
    ['DigitalErrorEmulatorPlugin', 'be', 1e-7],
    ['G726ADPCMSimulatorPlugin', 're', 1e-4],
    ['SimpleJitterPlugin', 'rj', 100],
    ['TiltEQPlugin', 'f0', Math.exp(6.45)]
  ];

  for (const [type, key, publicValue] of cases) {
    const descriptor = DSP_AUTOMATION_CATALOG[type].find(candidate => candidate.key === key);
    const Plugin = classes.get(type);
    const plugin = new Plugin();
    const resolved = adapter.resolve(type, key, descriptor.element);
    const expectedPacked = packDSPAutomationValue(descriptor, publicValue);

    assert.equal(adapter.apply(plugin, resolved, publicValue), true, `${type}:${key} must apply`);
    assert.ok(Math.abs(plugin[descriptor.field] - expectedPacked) < 1e-12,
      `${type}:${key} must receive its packed plugin value`);
    assert.ok(Math.abs(adapter.read(plugin, resolved) - publicValue) < 1e-9,
      `${type}:${key} must read back its public value`);
  }
});

test('ParamAdapter leaves identity enum and bool values unchanged', async () => {
  const classes = await loadPluginClasses();
  const adapter = new ParamAdapter();
  const cases = [
    ['DigitalErrorEmulatorPlugin', 'md', '5C'],
    ['FMRadioSimulatorPlugin', 'rd', false]
  ];

  for (const [type, key, value] of cases) {
    const descriptor = DSP_AUTOMATION_CATALOG[type].find(candidate => candidate.key === key);
    const Plugin = classes.get(type);
    const plugin = new Plugin();
    const resolved = adapter.resolve(type, key, descriptor.element);

    assert.equal(adapter.apply(plugin, resolved, value), true, `${type}:${key} must apply`);
    assert.equal(plugin[descriptor.field], value, `${type}:${key} must retain its plugin value`);
    assert.equal(adapter.read(plugin, resolved), value, `${type}:${key} must retain its public value`);
  }
});

test('ParamAdapter reachability matches the frozen exclusions for every generated descriptor', async () => {
  const classes = await loadPluginClasses();
  const adapter = new ParamAdapter();
  const observedUnassignable = [];
  let descriptorCount = 0;
  for (const [type, descriptors] of Object.entries(DSP_AUTOMATION_CATALOG)) {
    const Plugin = classes.get(type);
    assert.equal(typeof Plugin, 'function', `${type} must be loadable in the plugin VM`);
    for (const descriptor of descriptors) {
      descriptorCount += 1;
      const id = descriptorId(type, descriptor);
      if (UNASSIGNABLE_DESCRIPTORS.includes(id)) {
        observedUnassignable.push(id);
        continue;
      }
      const plugin = new Plugin();
      prepareDependentPhaseRegion(plugin, descriptor);
      const resolved = adapter.resolve(type, descriptor.key, descriptor.element);
      assert.ok(resolved, `${id} must remain assignable`);
      let changed = false;
      for (const value of probeValues(descriptor)) {
        const before = adapter.read(plugin, resolved);
        assert.equal(adapter.apply(plugin, resolved, value), true, `${id} must apply`);
        const after = adapter.read(plugin, resolved);
        changed ||= !Object.is(before, after);
      }
      assert.equal(changed, true, `${id} must change through the adapter`);
    }
  }
  assert.equal(descriptorCount, 951);
  assert.deepEqual(observedUnassignable, UNASSIGNABLE_DESCRIPTORS);
});
