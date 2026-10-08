import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { bindNumberInput } from '../../js/ui/range-fill.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }

  _classes() {
    return new Set(this.owner.className.split(/\s+/).filter(Boolean));
  }

  contains(name) {
    return this._classes().has(name);
  }

  toggle(name, force) {
    const classes = this._classes();
    const enabled = force === undefined ? !classes.has(name) : Boolean(force);
    if (enabled) classes.add(name);
    else classes.delete(name);
    this.owner.className = [...classes].join(' ');
    return enabled;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
    this.classList = new FakeClassList(this);
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.style = { setProperty() {} };
    this.value = '';
    this.checked = false;
    this.textContent = '';
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatch(type, fields = {}) {
    const event = { target: this, ...fields };
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  matches() {
    return false;
  }
}

async function loadPlugin() {
  const document = {
    activeElement: null,
    body: new FakeElement('body'),
    documentElement: new FakeElement('html'),
    createElement: tagName => new FakeElement(tagName),
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const sandbox = {
    bindEffeTuneNumberInput: bindNumberInput,
    window: { audioContext: { destination: { channelCount: 6 } } },
    document,
    console,
    structuredClone,
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = document;
  const context = vm.createContext(sandbox);
  for (const file of ['plugins/plugin-base.js', 'plugins/spatial/spatial_mapper.js']) {
    vm.runInContext(await fs.readFile(path.join(repoRoot, file), 'utf8'), context, { filename: file });
  }
  return context.window.SpatialMapperPlugin;
}

test('Spatial Mapper preserves fixed-stride matrices and validates public parameters', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  assert.equal(Plugin.executionCapabilities.requiresWasm, true);
  assert.equal(plugin.temporalCapability, 'reset-on-resume');
  const defaults = plugin.getParameters();
  assert.equal(defaults.dm.length, 256);
  assert.equal(defaults.fm.length, 256);
  assert.equal(defaults.rm.length, 256);
  for (let index = 0; index < 256; index++) {
    assert.equal(defaults.dm[index], index % 17 === 0 ? 1 : 0);
  }

  plugin.setParameters({
    ic: 17.8,
    bd: 31,
    dr: -10,
    ep: false,
    dm: [2, -2, Number.POSITIVE_INFINITY, '0.25']
  });
  const updated = plugin.getParameters();
  assert.equal(updated.ic, 16);
  assert.equal(updated.bd, '24');
  assert.equal(updated.dr, 0);
  assert.equal(updated.ep, false);
  assert.deepEqual(Array.from(updated.dm.slice(0, 5)), [1, -1, 0, 0.25, 0]);
  assert.equal(updated.dm.length, 256);

  updated.dm[0] = 0;
  assert.equal(plugin.getParameters().dm[0], 1);
  plugin.setParameters({ ic: 3, dm: plugin.getParameters().dm });
  assert.equal(plugin.getParameters().dm[1], -1);
});

test('Spatial Mapper routing UI edits the selected component at out * 16 + in', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const ui = plugin.createUI();
  assert.equal(ui.className, 'plugin-parameter-ui spatial-mapper-ui');
  // Stereo bus routing hands the plugin two channels of the six-channel pipeline.
  assert.equal(plugin._routingControls.length, 2);
  assert.equal(plugin._routingControls[0].length, 2);
  plugin.setParameters({ ic: 4 });
  assert.equal(plugin._routingControls[0].length, 2);
  plugin.channel = 'L';
  plugin.updateParameters();
  assert.equal(plugin._routingControls.length, 1);
  assert.equal(plugin._routingControls[0].length, 1);
  plugin.channel = 'A';
  plugin.updateParameters();
  assert.equal(plugin._routingControls.length, 6);
  assert.equal(plugin._routingControls[0].length, 4);
  plugin.setParameters({ ic: 2 });
  assert.equal(plugin._routingControls[0].length, 2);

  for (const key of ['dm', 'fm', 'rm']) {
    const tab = plugin._componentTabs.get(key);
    assert.equal(tab.tabIndex, 0);
    tab.dispatch('click');
    assert.equal(tab.getAttribute('aria-selected'), 'true');
  }

  plugin._componentTabs.get('fm').dispatch('click');
  const { slider, numberInput } = plugin._routingControls[2][1];
  slider.value = '-0.6';
  slider.dispatch('input');
  assert.equal(plugin.fm[2 * 16 + 1], -0.6);
  assert.equal(Number(numberInput.value), -0.6);
  assert.equal(numberInput.classList.contains('negative'), true);
  assert.equal(plugin.dm[2 * 16 + 1], 0);
  assert.equal(plugin.rm[2 * 16 + 1], 0);

  numberInput.value = '0.35';
  numberInput.dispatch('input');
  assert.equal(plugin.fm[2 * 16 + 1], 0.35);
  assert.equal(Number(slider.value), 0.35);
  assert.equal(numberInput.classList.contains('negative'), false);

  plugin._componentTabs.get('dm').dispatch('click');
  assert.equal(Number(slider.value), 0);
  assert.equal(Number(numberInput.value), 0);
  plugin._componentTabs.get('fm').dispatch('click');
  assert.equal(Number(slider.value), 0.35);
  assert.equal(Number(numberInput.value), 0.35);

  plugin.setParameters({ ic: 4 });
  assert.equal(plugin._routingControls.length, 6);
  assert.equal(plugin._routingControls[0].length, 4);
  assert.equal(plugin.fm[2 * 16 + 1], 0.35);
  assert.equal(Number(plugin._routingControls[2][1].slider.value), 0.35);
});

test('Spatial Mapper presets expose the documented sparse routes', async () => {
  const Plugin = await loadPlugin();
  const presets = new Map(Plugin.getSystemPresetGroups()[0].presets
    .map(preset => [preset.id, preset.params]));
  assert.equal(presets.size, 6);
  assert.equal(presets.get('stereo-enhance').rm[1], -0.4);
  assert.equal(presets.get('stereo-enhance').rm[16], -0.4);
  assert.equal(presets.get('center-extract').dm[2 * 16], 0.7);
  assert.equal(presets.get('upmix-5-1').fm[4 * 16], 1);
  assert.equal(presets.get('upmix-5-1').fm[5 * 16 + 1], 1);
  assert.equal(presets.get('upmix-7-1-4').fm[11 * 16 + 1], 0.5);
  assert.ok(presets.get('ambience-extract').dm.every(value => value === 0));
  assert.ok(presets.get('ambience-extract').rm.every(value => value === 0));
});
