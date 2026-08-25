import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = { setProperty: (key, value) => { this.style[key] = value; } };
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.textContent = '';
    this.className = '';
    this.classList = {
      toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        const enabled = force === undefined ? !names.has(name) : force;
        if (enabled) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
      }
    };
    this.isContentEditable = false;
    this.clientWidth = 720;
    this.clientHeight = 405;
    this.width = 720;
    this.height = 405;
    this.capturedPointer = null;
    this.contextEvents = [];
    this.context = null;
  }

  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  contains(target) {
    return this === target || this.children.some(child =>
      child && typeof child.contains === 'function' && child.contains(target));
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  querySelectorAll(selector) {
    const type = /^input\[type="([^"]+)"\]$/.exec(selector)?.[1];
    const result = [];
    const visit = node => {
      for (const child of node.children || []) {
        if (child?.tagName === 'INPUT' && (!type || child.type === type)) result.push(child);
        if (child && typeof child === 'object') visit(child);
      }
    };
    visit(this);
    return result;
  }
  setPointerCapture(pointerId) { this.capturedPointer = pointerId; }
  releasePointerCapture(pointerId) {
    if (this.capturedPointer === pointerId) this.capturedPointer = null;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
  }
  matches(selector) {
    return selector.split(',').some(value => value.trim().toUpperCase() === this.tagName);
  }
  getContext() {
    if (this.context) return this.context;
    const element = this;
    const target = {};
    this.context = new Proxy(target, {
      get(object, key) {
        if (!(key in object)) {
          object[key] = (...args) => {
            element.contextEvents.push({
              type: 'call',
              key: String(key),
              args,
              textAlign: object.textAlign,
              textBaseline: object.textBaseline,
              font: object.font
            });
          };
        }
        return object[key];
      },
      set(object, key, value) {
        element.contextEvents.push({ type: 'set', key: String(key), value });
        object[key] = value;
        return true;
      }
    });
    return this.context;
  }
}

function flatten(root) {
  const result = [root];
  for (const child of root.children || []) {
    if (child && typeof child === 'object') result.push(...flatten(child));
  }
  return result;
}

async function loadPlugin() {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'spatial', 'phase_select_eq.js'), 'utf8');
  const listenerGroups = new Map();
  const documentListeners = {
    get(type) {
      return event => {
        for (const listener of listenerGroups.get(type) || []) listener(event);
      };
    }
  };
  const document = {
    activeElement: null,
    createElement: tagName => new FakeElement(tagName),
    createTextNode: text => ({ textContent: text, children: [] }),
    addEventListener(type, listener) {
      if (!listenerGroups.has(type)) listenerGroups.set(type, new Set());
      listenerGroups.get(type).add(listener);
    },
    removeEventListener(type, listener) { listenerGroups.get(type)?.delete(listener); }
  };
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this._sectionEnabled = true;
      this.id = 17;
      this.updateCount = 0;
    }
    registerProcessor(processor) { this.processor = processor; }
    updateParameters() { this.updateCount += 1; }
    _setupMessageHandler() {}
    canRunAnimation() { return false; }
    requestPowerAnimationFrame() { return null; }
    createResponsiveGraph() {
      const container = new FakeElement('div');
      const canvas = new FakeElement('canvas');
      container.appendChild(canvas);
      return { container, canvas, dispose() {} };
    }
    createCheckboxControl(label, checked, setter) {
      const row = new FakeElement('div');
      row.className = 'parameter-row checkbox-row';
      const labelElement = new FakeElement('label');
      labelElement.textContent = `${label}:`;
      const checkbox = new FakeElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!checked;
      checkbox.addEventListener('change', event => setter(event?.target?.checked ?? checkbox.checked));
      row.append(labelElement, checkbox);
      return row;
    }
    createRadioGroup(label, options, value, setter) {
      const row = new FakeElement('div');
      row.className = 'parameter-row radio-group';
      const labelElement = new FakeElement('label');
      labelElement.textContent = `${label}:`;
      row.appendChild(labelElement);
      for (const option of options) {
        const radio = new FakeElement('input');
        radio.type = 'radio';
        radio.value = option.value;
        radio.checked = option.value === value;
        radio.addEventListener('change', event => {
          if (event?.target?.checked ?? radio.checked) setter(radio.value);
        });
        const radioLabel = new FakeElement('label');
        radioLabel.textContent = option.label;
        row.append(radio, radioLabel);
      }
      return row;
    }
    cleanup() {}
  }
  const subscriptions = [];
  const telemetryHub = {
    subscribe(tapId, frameType, callback) {
      const record = { tapId, frameType, callback, disposed: false };
      subscriptions.push(record);
      return () => { record.disposed = true; };
    }
  };
  const window = { dspTelemetryHub: telemetryHub };
  const context = vm.createContext({
    PluginBase,
    window,
    document,
    console,
    Date,
    Math,
    Number,
    Object,
    Array,
    Map,
    Set,
    String,
    performance: { now: () => 1000 },
    setTimeout,
    clearTimeout,
    cancelAnimationFrame() {}
  });
  vm.runInContext(source, context, { filename: 'phase_select_eq.js' });
  return {
    Plugin: window.PhaseSelectEqPlugin,
    document,
    documentListeners,
    subscriptions
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function telemetryFrame({
  sequence = 0,
  phase = -60,
  balance = -25,
  level = -12,
  frequency = 1000,
  sampleRate = 48000,
  fftSize = 4096
} = {}) {
  const buffer = new ArrayBuffer(32);
  const view = new DataView(buffer);
  view.setFloat32(0, sampleRate, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, fftSize, true);
  view.setFloat32(12, -3, true);
  view.setFloat32(16, frequency, true);
  view.setFloat32(20, phase, true);
  view.setFloat32(24, balance, true);
  view.setFloat32(28, level, true);
  return {
    frameType: 20,
    formatVersion: 2,
    sequence,
    flags: 0,
    payload: view
  };
}

test('Phase Select EQ exposes a fixed normalized WASM-only parameter contract', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  assert.equal(Plugin.executionCapabilities.requiresWasm, true);
  assert.equal(plugin.processor, 'return data;');
  assert.equal(plugin.getTemporalCapability(), 'reset-on-resume');
  const parameters = plain(plugin.getParameters());
  assert.equal(parameters.type, 'PhaseSelectEqPlugin');
  assert.equal(parameters.regions.length, 5);
  assert.equal(parameters.regions[0].en, true);
  assert.ok(parameters.regions.slice(1).every(region => region.en === false));
  assert.ok(parameters.regions.every(region => region.gn === 100));
  assert.ok(parameters.regions.every(region => region.so === false));
  assert.ok(parameters.regions.every(region =>
    region.obl === -100 && region.bl === -100 && region.bh === 100 && region.obh === 100));

  plugin.setParameters({ regions: [{
    en: true, ofl: 900, fl: 800, fh: 700, ofh: 600,
    opl: 80, pl: 70, ph: 60, oph: 50, gn: 99,
    obl: 50, bl: 40, bh: 30, obh: 20
  }] });
  const region = plugin.regions[0];
  assert.ok(20 <= region.ofl && region.ofl <= region.fl);
  assert.ok(region.fl < region.fh && region.fh <= region.ofh && region.ofh <= 40000);
  assert.ok(0 <= region.opl && region.opl <= region.pl);
  assert.ok(region.pl < region.ph && region.ph <= region.oph && region.oph <= 180);
  assert.ok(-100 <= region.obl && region.obl <= region.bl);
  assert.ok(region.bl < region.bh && region.bh <= region.obh && region.obh <= 100);
  assert.equal(region.gn, 99);
});

test('absolute phase ranges map to center, mirrored, and wrapped display shapes', async () => {
  const { Plugin } = await loadPlugin();
  assert.deepEqual(plain(Plugin.displaySegments(0, 45)), [
    { low: -45, high: 45, joinedAtCenter: true, wrapped: false }
  ]);
  assert.deepEqual(plain(Plugin.displaySegments(30, 90)), [
    { low: -90, high: -30, joinedAtCenter: false, wrapped: false },
    { low: 30, high: 90, joinedAtCenter: false, wrapped: false }
  ]);
  assert.deepEqual(plain(Plugin.displaySegments(120, 180)), [
    { low: -180, high: -120, joinedAtCenter: false, wrapped: true },
    { low: 120, high: 180, joinedAtCenter: false, wrapped: true }
  ]);
});

test('raised-cosine region weights interpolate percentage gains and multiply overlaps', async () => {
  const { Plugin } = await loadPlugin();
  const first = Plugin.normalizeRegion({
    en: true, ofl: 50, fl: 100, fh: 2000, ofh: 4000,
    opl: 10, pl: 20, ph: 80, oph: 90, gn: 200
  });
  const second = Plugin.normalizeRegion({ ...first, gn: 50 });
  assert.equal(Plugin.regionWeight(first, 500, 40, 0), 1);
  assert.ok(Math.abs(Plugin.regionWeight(first, Math.sqrt(50 * 100), 15, 0) - 0.25) < 1e-12);
  assert.equal(Plugin.compositeGain([first, second], 500, -40), 1);
  assert.ok(Math.abs(Plugin.compositeGain([first], Math.sqrt(50 * 100), 15) - 1.25) < 1e-12);
});

test('solo keeps only the union of soloed band weights and ignores every gain', async () => {
  const { Plugin } = await loadPlugin();
  assert.equal(Plugin.normalizeRegion({}).so, false);
  assert.equal(Plugin.normalizeRegion({ so: true }).so, true);
  const low = Plugin.normalizeRegion({
    en: true, ofl: 50, fl: 100, fh: 2000, ofh: 4000,
    opl: 0, pl: 0, ph: 180, oph: 180, gn: 200, so: true
  });
  const high = Plugin.normalizeRegion({
    ...low, ofl: 4000, fl: 8000, fh: 12000, ofh: 16000, so: false
  });
  assert.equal(Plugin.compositeGain([low, high], 500, 40), 1);
  assert.equal(Plugin.compositeGain([low, high], 10000, 40), 0);
  assert.ok(Math.abs(Plugin.compositeGain([low, high], Math.sqrt(50 * 100), 40) - 0.5) < 1e-12);
  const highSolo = Plugin.normalizeRegion({ ...high, so: true });
  assert.equal(Plugin.compositeGain([low, highSolo], 10000, 40), 1);
  const disabledSolo = Plugin.normalizeRegion({ ...low, en: false });
  assert.equal(Plugin.compositeGain([disabledSolo, high], 10000, 40), 2);
});

test('overlapping soloed bands keep the largest weight instead of accumulating', async () => {
  const { Plugin } = await loadPlugin();
  // Three soloed bands overlap at 400 Hz on their low-frequency ramps only, with the
  // phase axis wide open. smooth01(x) = 0.5 - 0.5 * cos(pi * x) over the log2 ramp gives
  // smooth01(1/3) = 0.25, smooth01(1/2) = 0.5 and smooth01(2/3) = 0.75, so the three
  // weights are 0.25, 0.75 and 0.5 in array order. Only the max union yields 0.75:
  // sum = 1.5, product = 0.09375, first match = 0.25, last match = 0.5, hard gate = 1.
  const band = (ofl, fl) => Plugin.normalizeRegion({
    en: true, so: true, gn: 200,
    ofl, fl, fh: 20000, ofh: 24000,
    opl: 0, pl: 0, ph: 180, oph: 180
  });
  const regions = [band(200, 1600), band(100, 800), band(200, 800)];
  const weights = regions.map(region => Plugin.regionWeight(region, 400, 40));
  for (const [index, expected] of [[0, 0.25], [1, 0.75], [2, 0.5]]) {
    assert.ok(Math.abs(weights[index] - expected) < 1e-12, `weight ${index}`);
  }
  assert.ok(Math.abs(Plugin.compositeGain(regions, 400, 40) - 0.75) < 1e-12);
});

test('five fixed bands retain settings independently from their enabled state', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  assert.equal(plugin.selectRegion(4), true);
  plugin._setSelectedRegionValue('gn', 175);
  plugin._setSelectedRegionValue('en', true);
  plugin._setSelectedRegionValue('en', false);
  const saved = plain(plugin.getParameters());

  const restored = new Plugin();
  restored.setParameters(saved);
  assert.equal(restored.regions.length, 5);
  assert.equal(restored.regions[4].en, false);
  assert.equal(restored.regions[4].gn, 175);
  assert.equal(restored.selectRegion(4), true);
});

test('UI exposes five enabled tabs, settings before the graph, and sliders for every number', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  const ui = plugin.createUI();
  const elements = flatten(ui);
  const labels = elements.filter(element => element.tagName === 'LABEL')
    .map(element => element.textContent);
  for (const expected of [
    'Gain (%)', 'Solo:', 'Core Low Frequency (Hz)', 'Core High Frequency (Hz)',
    'Core Low Phase (°)', 'Core High Phase (°)',
    'Low Frequency Transition (oct)', 'High Frequency Transition (oct)',
    'Low Phase Transition (°)', 'High Phase Transition (°)',
    'Core Low Balance (%)', 'Core High Balance (%)', 'Outer Low Balance (%)',
    'Outer High Balance (%)'
  ]) assert.ok(labels.includes(expected), expected);
  const balanceRows = plugin._editor.children[0].children.slice(-4);
  assert.deepEqual(balanceRows.map(row => row.children[0].textContent), [
    'Core Low Balance (%)', 'Core High Balance (%)',
    'Outer Low Balance (%)', 'Outer High Balance (%)'
  ]);
  assert.deepEqual(balanceRows.flatMap(row => row.children.slice(1).map(control => control.type)),
    ['range', 'number', 'range', 'number', 'range', 'number', 'range', 'number']);
  assert.equal(plugin._regionTabs.length, 5);
  assert.equal(plugin._bandEnableInputs.length, 5);
  assert.equal(plugin._regionTabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(plugin._bandEnableInputs[0].checked, true);
  assert.ok(plugin._bandEnableInputs.slice(1).every(input => input.checked === false));
  assert.equal(plugin._soloInput.checked, false);
  assert.equal(plugin._soloInput.getAttribute('aria-label'), 'Solo Band 1');
  assert.equal(elements.filter(element =>
    element.tagName === 'INPUT' && element.type === 'checkbox').length, 6);
  assert.equal(elements.filter(element =>
    element.tagName === 'LABEL' && element.textContent === 'Solo:').length, 1);
  assert.equal(elements.filter(element => element.tagName === 'STRONG').length, 0);
  assert.equal(elements.filter(element => element.tagName === 'INPUT' && element.type === 'range').length, 13);
  assert.equal(elements.filter(element => element.tagName === 'INPUT' && element.type === 'number').length, 13);
  assert.equal(ui.children[0].className, 'phase-select-eq-region-tabs');
  assert.equal(ui.children[1].className, 'phase-select-eq-editor');
  assert.equal(ui.children[2].className,
    'parameter-row radio-group phase-select-eq-axis-controls');
  assert.equal(elements.filter(element =>
    element.tagName === 'INPUT' && element.type === 'radio').length, 2);
  assert.equal(ui.children[3].children[0], plugin.canvas);
});

test('the solo checkbox edits the selected band and follows the tab selection', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  plugin._soloInput.checked = true;
  plugin._soloInput.listeners.get('change')();
  assert.equal(plugin.regions[0].so, true);
  assert.ok(plugin.regions.slice(1).every(region => region.so === false));
  assert.equal(plugin.selectRegion(2), true);
  assert.equal(plugin._soloInput.checked, false);
  assert.equal(plugin._soloInput.getAttribute('aria-label'), 'Solo Band 3');
  assert.equal(plugin.selectRegion(0), true);
  assert.equal(plugin._soloInput.checked, true);
});

test('map axis switches explicitly and follows Phase or Balance field edits', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  const axisInputs = Object.fromEntries(
    plugin._axisControls.querySelectorAll('input[type="radio"]')
      .map(input => [input.value, input]));
  assert.equal(plugin.xAxisMode, 'phase');
  assert.equal(plugin._axisControls.className,
    'parameter-row radio-group phase-select-eq-axis-controls');
  assert.equal(plugin._axisControls.getAttribute('role'), null);
  assert.equal(axisInputs.phase.checked, true);
  assert.equal(axisInputs.balance.checked, false);
  assert.match(plugin.canvas.getAttribute('aria-label'), /phase difference/);

  axisInputs.balance.checked = true;
  axisInputs.balance.listeners.get('change')({ target: axisInputs.balance });
  assert.equal(plugin.xAxisMode, 'balance');
  assert.equal(axisInputs.phase.checked, false);
  assert.equal(axisInputs.balance.checked, true);
  assert.match(plugin.canvas.getAttribute('aria-label'), /balance map/);

  const phase = plugin._formInputs.get('ph').input;
  phase.value = '80';
  phase.listeners.get('input')();
  assert.equal(plugin.xAxisMode, 'phase');
  const balance = plugin._formInputs.get('bl').input;
  balance.value = '-40';
  balance.listeners.get('input')();
  assert.equal(plugin.xAxisMode, 'balance');
});

test('Balance boundaries use ordinary ranges and keep pointer and keyboard input values', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  const ui = plugin.createUI();
  for (const key of ['obl', 'bl', 'bh', 'obh']) {
    const { input, slider } = plugin._formInputs.get(key);
    for (const control of [input, slider]) {
      assert.equal(control.min, '-100', `${key} min`);
      assert.equal(control.max, '100', `${key} max`);
      assert.equal(control.step, '0.1', `${key} step`);
    }
  }
  assert.equal(flatten(ui).some(element =>
    element.className === 'phase-select-eq-value-helper'), false);

  plugin.regions[0] = Plugin.normalizeRegion({
    ...plugin.regions[0], obl: -80, bl: -40, bh: 40, obh: 80
  });
  plugin._refreshUi();
  plugin._setXAxisMode('phase');
  const coreLow = plugin._formInputs.get('bl').slider;
  coreLow.value = '-35';
  coreLow.listeners.get('input')({ pointerType: 'mouse' });
  assert.equal(plugin.xAxisMode, 'balance');
  assert.equal(plugin.regions[0].bl, -35);
  assert.equal(plugin.regions[0].obl, -75);

  plugin._setXAxisMode('phase');
  const coreHigh = plugin._formInputs.get('bh').slider;
  coreHigh.value = '45';
  coreHigh.listeners.get('input')({ key: 'ArrowRight' });
  assert.equal(plugin.xAxisMode, 'balance');
  assert.equal(plugin.regions[0].bh, 45);
  assert.equal(plugin.regions[0].obh, 85);
});

test('Balance mode uses one non-mirrored rectangle and preserves ordered boundaries', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  plugin.regions[0] = Plugin.normalizeRegion({
    en: true, ofl: 100, fl: 200, fh: 2000, ofh: 4000,
    opl: 20, pl: 30, ph: 90, oph: 100,
    obl: -80, bl: -60, bh: 20, obh: 50
  });
  assert.equal(plugin._regionGeometry(plugin.regions[0]).core.length, 2);
  plugin._setXAxisMode('balance');
  const geometry = plugin._regionGeometry(plugin.regions[0]);
  assert.equal(geometry.core.length, 1);
  assert.equal(geometry.core[0].left, plugin._balanceToX(-60));
  assert.equal(geometry.core[0].right, plugin._balanceToX(20));

  const lowHandle = plugin._selectedHandles().find(handle =>
    !handle.outer && handle.phaseEdge === 'low' && !handle.frequencyEdge);
  plugin._handlePointerDown({
    clientX: lowHandle.x, clientY: lowHandle.y, pointerId: 41, isPrimary: true,
    pointerType: 'touch', preventDefault() {}
  });
  plugin._applyPointerMove({ x: plugin._balanceToX(80), y: lowHandle.y });
  assert.ok(plugin.regions[0].obl <= plugin.regions[0].bl);
  assert.ok(plugin.regions[0].bl < plugin.regions[0].bh);
  assert.ok(plugin.regions[0].bh <= plugin.regions[0].obh);
  plugin._finishPointer({ pointerId: 41, preventDefault() {} }, false);
});

test('hidden-axis dimming and badges share four-boundary enabled constraints', async () => {
  const { Plugin } = await loadPlugin();
  const region = Plugin.normalizeRegion({
    en: true, ofl: 100, fl: 200, fh: 2000, ofh: 4000,
    opl: 20, pl: 40, ph: 80, oph: 100,
    obl: -100, bl: -60, bh: -40, obh: 100, gn: 200
  });
  assert.equal(Plugin.regionWeight(region, 500, 60, -50), 1);
  assert.equal(Plugin.regionWeight(region, 500, 0, -50), 0);
  assert.equal(Plugin.regionWeight(region, 500, 60, 100), 0);
  assert.equal(Plugin.compositeGain([region], 500, 60, -50), 2);

  const plugin = new Plugin();
  plugin.createUI();
  plugin.regions[0] = region;
  plugin._setXAxisMode('phase');
  assert.equal(plugin._hiddenAxisWeight({ phase: 60, balance: -50 }), 1);
  assert.equal(plugin._hiddenAxisWeight({ phase: 60, balance: 100 }), 0);
  assert.equal(plugin._hiddenAxisBadge.textContent,
    'Balance core -60–-40%; transition -100–+100%');
  assert.ok(plugin._hiddenAxisBadge.className.split(/\s+/).includes('limited'));

  plugin._setXAxisMode('balance');
  assert.equal(plugin._hiddenAxisWeight({ phase: 60, balance: -50 }), 1);
  assert.equal(plugin._hiddenAxisWeight({ phase: 0, balance: -50 }), 0);
  assert.equal(plugin._hiddenAxisBadge.textContent,
    'Phase core 40–80°; transition 20–100°');

  plugin.regions[0] = { ...region, en: false };
  plugin._setXAxisMode('phase');
  assert.equal(plugin._hiddenAxisWeight({ phase: 60, balance: 100 }), 1);
  assert.equal(plugin._hiddenAxisBadge.textContent, 'Balance full range');
  assert.equal(plugin._hiddenAxisBadge.className.split(/\s+/).includes('limited'), false);
});

test('every enabled Core shows its four-boundary hidden-axis constraint', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  plugin.regions[0] = Plugin.normalizeRegion({
    en: true, ofl: 100, fl: 200, fh: 2000, ofh: 4000,
    opl: 20, pl: 40, ph: 80, oph: 100,
    obl: -100, bl: -60, bh: -40, obh: 100
  });
  plugin.regions[1] = Plugin.normalizeRegion({
    en: true, ofl: 300, fl: 400, fh: 3000, ofh: 5000,
    opl: 0, pl: 0, ph: 180, oph: 180,
    obl: -100, bl: -100, bh: 100, obh: 100
  });
  plugin.regions[2] = Plugin.normalizeRegion({
    en: false, ofl: 300, fl: 400, fh: 3000, ofh: 5000,
    opl: 10, pl: 20, ph: 30, oph: 40,
    obl: -80, bl: -60, bh: 60, obh: 80
  });

  plugin.canvas.contextEvents.length = 0;
  plugin._setXAxisMode('phase');
  let labels = plugin.canvas.contextEvents.filter(event =>
    event.type === 'call' && event.key === 'fillText').map(event => event.args[0]);
  assert.ok(labels.includes('B 100:0›80:20–70:30›0:100'));
  assert.ok(labels.includes('B full'));
  assert.equal(labels.some(label => String(label).includes('90:10›80:20')), false);

  plugin.canvas.contextEvents.length = 0;
  plugin._setXAxisMode('balance');
  labels = plugin.canvas.contextEvents.filter(event =>
    event.type === 'call' && event.key === 'fillText').map(event => event.args[0]);
  assert.ok(labels.includes('P 20°›40°–80°›100°'));
  assert.ok(labels.includes('P full'));
  assert.equal(labels.some(label => String(label).includes('P 10°›20°–30°›40°')), false);
});

test('fractional hidden-axis boundaries stay compact in both badge styles', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  plugin.regions[0] = Plugin.normalizeRegion({
    en: true, ofl: 100, fl: 200, fh: 2000, ofh: 4000,
    opl: 12.345678, pl: 34.567891, ph: 123.456789, oph: 167.891234,
    obl: -91.234567, bl: -60.123456, bh: 40.987654, obh: 87.654321
  });

  plugin.canvas.contextEvents.length = 0;
  plugin._setXAxisMode('phase');
  assert.equal(plugin._hiddenAxisBadge.textContent,
    'Balance core -60.12–+40.99%; transition -91.23–+87.65%');
  let labels = plugin.canvas.contextEvents.filter(event =>
    event.type === 'call' && event.key === 'fillText').map(event => event.args[0]);
  assert.ok(labels.includes('B 95.6:4.4›80.1:19.9–29.5:70.5›6.2:93.8'));

  plugin.canvas.contextEvents.length = 0;
  plugin._setXAxisMode('balance');
  assert.equal(plugin._hiddenAxisBadge.textContent,
    'Phase core 34.57–123.46°; transition 12.35–167.89°');
  labels = plugin.canvas.contextEvents.filter(event =>
    event.type === 'call' && event.key === 'fillText').map(event => event.args[0]);
  assert.ok(labels.includes('P 12.35°›34.57°–123.46°›167.89°'));
});

test('Balance ratio badges keep rounded sides complementary and sign-symmetric', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  const region = Plugin.normalizeRegion({
    en: true, ofl: 100, fl: 200, fh: 2000, ofh: 4000,
    opl: 0, pl: 0, ph: 180, oph: 180,
    obl: -100, bl: -0.1, bh: 0.1, obh: 100
  });
  plugin.regions[0] = region;
  plugin.regions[1] = { ...region, bl: -0, bh: 0 };
  plugin.regions[2] = { ...region, bl: -0.3, bh: 0.3 };

  plugin.canvas.contextEvents.length = 0;
  plugin._setXAxisMode('phase');
  const labels = plugin.canvas.contextEvents.filter(event =>
    event.type === 'call' && event.key === 'fillText').map(event => String(event.args[0]));
  assert.ok(labels.includes('B 100:0›50:50–50:50›0:100'));
  assert.ok(labels.includes('B 100:0›50.1:49.9–49.9:50.1›0:100'));
  assert.equal(labels.some(label => label.startsWith('B ') && /(?:^|[^\d])-0(?:\D|$)|\.0\D/.test(label)), false);

  for (const label of labels.filter(value => value.startsWith('B '))) {
    for (const ratio of label.matchAll(/(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)/g)) {
      assert.equal(Number(ratio[1]) + Number(ratio[2]), 100);
    }
  }
});

test('band tabs mark soloed bands even while a different band is selected', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  const marked = () => Array.from(plugin._regionTabs)
    .map((tab, index) => (tab.className.split(/\s+/).includes('soloed') ? index : -1))
    .filter(index => index >= 0);
  assert.deepEqual(marked(), []);

  assert.equal(plugin.selectRegion(2), true);
  plugin._setSelectedRegionValue('en', true);
  plugin._soloInput.checked = true;
  plugin._soloInput.listeners.get('change')();
  assert.deepEqual(marked(), [2]);
  assert.equal(plugin._regionTabs[2].getAttribute('aria-label'), 'Band 3 (Solo)');

  assert.equal(plugin.selectRegion(0), true);
  assert.equal(plugin._soloInput.checked, false);
  assert.deepEqual(marked(), [2]);
  assert.equal(plugin._regionTabs[0].getAttribute('aria-label'), 'Band 1');

  assert.equal(plugin.selectRegion(2), true);
  plugin._soloInput.checked = false;
  plugin._soloInput.listeners.get('change')();
  assert.deepEqual(marked(), []);
});

test('rebuilding the UI replaces tab and field references instead of appending them', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  const firstTabs = [...plugin._regionTabs];
  plugin.createUI();

  assert.equal(plugin._regionTabs.length, 5);
  assert.equal(plugin._bandEnableInputs.length, 5);
  assert.equal(plugin._formInputs.size, 13);
  assert.ok(plugin._regionTabs.every(tab => !firstTabs.includes(tab)));
});

test('UI reuses standard control rows and the existing five-band tab surface', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  const ui = plugin.createUI();
  const elements = flatten(ui);
  assert.ok(plugin._regionTabs.every(tab =>
    tab.className.split(/\s+/).includes('phase-select-eq-region-tab')));
  assert.equal(elements.filter(element =>
    element.className === 'parameter-row phase-select-eq-field').length, 13);
  const fieldRows = elements.filter(element =>
    element.className === 'parameter-row phase-select-eq-field');
  assert.ok(fieldRows.every(row => row.children.length === 3));
  const soloRow = elements.find(element =>
    element.className === 'parameter-row checkbox-row phase-select-eq-solo-field');
  assert.ok(soloRow);
  assert.equal(soloRow.children.length, 2);
  assert.ok(soloRow.children.includes(plugin._soloInput));
  assert.equal(soloRow.children[0].tagName, 'LABEL');
  assert.equal(soloRow.children[1], plugin._soloInput);
  assert.ok(fieldRows.every(row => row.children[1].type === 'range'));
  assert.equal(plugin._axisControls.className,
    'parameter-row radio-group phase-select-eq-axis-controls');
  assert.equal(plugin._axisControls.querySelectorAll('input[type="radio"]').length, 2);

  const css = await fs.readFile(
    path.join(repoRoot, 'plugins', 'spatial', 'phase_select_eq.css'), 'utf8');
  const globalCss = await fs.readFile(path.join(repoRoot, 'effetune.css'), 'utf8');
  const mobileCss = await fs.readFile(path.join(repoRoot, 'effetune-mobile.css'), 'utf8');
  assert.match(css, /\.phase-select-eq-map\s*\{[^}]*background-color:\s*#1a1a1a/s);
  assert.match(css, /\.phase-select-eq-editor\s*\{[^}]*background:\s*#2d2d2d/s);
  assert.match(css,
    /\.phase-select-eq-region-tab\[aria-selected="true"\]\s*\{[^}]*background:\s*#444/s);
  assert.match(css, /\.phase-select-eq-region-tab\.disabled\s*\{[^}]*opacity:\s*0\.5/s);
  const scopedSelector = '.phase-select-eq-plugin-ui .parameter-row.phase-select-eq-field';
  const globalSelector = '.plugin-parameter-ui .parameter-row';
  const specificity = selector =>
    (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  assert.match(globalCss,
    /\.plugin-parameter-ui \.parameter-row\s*\{[^}]*display:\s*flex/s);
  const pluginUiRule = css.match(/\.phase-select-eq-plugin-ui\s*\{([^}]*)\}/)?.[1] || '';
  const editorRule = css.match(/\.phase-select-eq-editor\s*\{([^}]*)\}/)?.[1] || '';
  const standardRowRule = globalCss.match(
    /\.plugin-parameter-ui \.parameter-row\s*\{([^}]*)\}/)?.[1] || '';
  const standardMargin = standardRowRule.match(/\bmargin:\s*([^;]+);/)?.[1];
  assert.equal(standardMargin, '2px 0');
  assert.doesNotMatch(pluginUiRule, /\bgap\s*:/);
  assert.doesNotMatch(editorRule, /\bmargin-(?:top|bottom)\s*:/);
  const axisSpacingRule = css.match(
    /\.phase-select-eq-plugin-ui \.parameter-row\.phase-select-eq-axis-controls\s*\{([^}]*)\}/)?.[1] || '';
  const mapSpacingRule = css.match(
    /\.phase-select-eq-plugin-ui \.phase-select-eq-axis-controls \+ \.phase-select-eq-map\s*\{([^}]*)\}/)?.[1] || '';
  const controlsToGraphRow = Number(
    axisSpacingRule.match(/\bmargin-top:\s*([\d.]+)px/)?.[1]);
  const graphRowBottomMargin = Number(
    axisSpacingRule.match(/\bmargin-bottom:\s*([\d.]+)(?:px)?/)?.[1]);
  const graphRowToCanvas = graphRowBottomMargin + Number(
    mapSpacingRule.match(/\bmargin-top:\s*([\d.]+)px/)?.[1]);
  assert.equal(controlsToGraphRow, 14);
  assert.equal(graphRowToCanvas, 2);
  assert.ok(graphRowToCanvas < controlsToGraphRow);
  assert.doesNotMatch(css,
    /body\.layout-mobile[^{}]*phase-select-eq-axis-controls\s*\{[^}]*(?:margin|padding)\s*:/s);
  assert.match(css,
    /\.phase-select-eq-plugin-ui \.parameter-row\.phase-select-eq-field\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:/s);
  assert.ok(specificity(scopedSelector) > specificity(globalSelector));
  const computedDisplay = specificity(scopedSelector) > specificity(globalSelector)
    ? 'grid' : 'flex';
  assert.equal(computedDisplay, 'grid');
  const soloSelector =
    '.phase-select-eq-plugin-ui .parameter-row.phase-select-eq-solo-field';
  assert.match(css,
    /\.phase-select-eq-plugin-ui \.parameter-row\.phase-select-eq-solo-field\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*var\(--phase-select-eq-field-columns\)/s);
  assert.match(css,
    /\.phase-select-eq-plugin-ui \.parameter-row\.phase-select-eq-field\s*\{[^}]*grid-template-columns:\s*var\(--phase-select-eq-field-columns\)/s);
  assert.match(css,
    /\.phase-select-eq-plugin-ui \.phase-select-eq-solo-checkbox\s*\{[^}]*grid-column:\s*2[^}]*justify-self:\s*start[^}]*margin:\s*0/s);
  assert.match(css,
    /body\.layout-mobile \.phase-select-eq-plugin-ui \.parameter-row\.phase-select-eq-solo-field\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(css,
    /body\.layout-mobile \.phase-select-eq-plugin-ui \.parameter-row\.phase-select-eq-solo-field > label\s*\{[^}]*grid-row:\s*1[^}]*grid-column:\s*1 \/ -1/s);
  assert.match(css,
    /body\.layout-mobile \.phase-select-eq-plugin-ui \.phase-select-eq-solo-checkbox\s*\{[^}]*grid-row:\s*2[^}]*grid-column:\s*1[^}]*justify-self:\s*start/s);
  assert.ok(specificity(soloSelector) > specificity(globalSelector));
  assert.doesNotMatch(css, /phase-select-eq-axis-button|phase-select-eq-value-helper/);
  assert.match(css,
    /body\.layout-mobile \.phase-select-eq-plugin-ui \.parameter-row\.phase-select-eq-field\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
  assert.match(css,
    /body\.layout-mobile \.phase-select-eq-plugin-ui \.parameter-row\.phase-select-eq-field > label\s*\{[^}]*grid-row:\s*1[^}]*grid-column:\s*1 \/ -1/s);
  assert.match(css,
    /body\.layout-mobile \.phase-select-eq-plugin-ui \.parameter-row\.phase-select-eq-field input\[type="range"\]\s*\{[^}]*grid-row:\s*2[^}]*grid-column:\s*1 \/ -1[^}]*min-width:\s*0/s);
  assert.match(css,
    /body\.layout-mobile \.phase-select-eq-hidden-axis-badge\s*\{[^}]*flex:\s*1 0 100%[^}]*min-width:\s*0/s);

  const mobileRangeSelector =
    'body.layout-mobile .phase-select-eq-plugin-ui .parameter-row.phase-select-eq-field input[type="range"]';
  const globalMobileInputSelector =
    'body.layout-mobile input:not([type="radio"]):not([type="checkbox"]):not(.vertical-slider)';
  const cssSpecificity = selector => specificity(selector.replaceAll(':not(', '('));
  assert.match(mobileCss,
    /body\.layout-mobile input:not\(\[type="radio"\]\):not\(\[type="checkbox"\]\):not\(\.vertical-slider\)\s*\{[^}]*min-width:\s*var\(--et-mobile-field-min-width\)/s);
  assert.ok(cssSpecificity(mobileRangeSelector) > cssSpecificity(globalMobileInputSelector));
  for (const viewportWidth of [240, 320, 375]) {
    const editorWidth = viewportWidth - 20;
    assert.ok(80 <= editorWidth, `${viewportWidth}px numeric row fits`);
  }
});

test('Phase Select EQ guidance stays technically complete in every language', async () => {
  const sources = [
    ['en', path.join(repoRoot, 'docs', 'plugins', 'spatial.md')],
    ...['ar', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'].map(language => [
      language, path.join(repoRoot, 'docs', 'i18n', language, 'plugins', 'spatial.md')
    ])
  ];
  for (const [language, sourcePath] of sources) {
    const source = await fs.readFile(sourcePath, 'utf8');
    const start = source.indexOf('## Phase Select EQ');
    const end = source.indexOf('## Stereo Blend', start);
    assert.ok(start >= 0 && end > start, `${language} Phase Select EQ section`);
    const section = source.slice(start, end);
    const normalizedRanges = section.replace(/[~～–—]/g, '-');
    assert.match(section, /× 100%/, `${language} Balance formula`);
    assert.ok(section.includes('-180°') && section.includes('+180°'),
      `${language} one-sided endpoints`);
    assert.ok(section.includes('P 20°›40°–80°›100°') &&
      section.includes('B 100:0›80:20–70:30›0:100'), `${language} per-Band badges`);
    assert.match(normalizedRanges, /150-180°/, `${language} hard-pan Phase Core`);
    assert.match(normalizedRanges, /0-180°/, `${language} full-Phase alternative`);
    assert.ok(section.includes('Core Low Phase') && section.includes('Low Phase Transition'),
      `${language} handle limits`);
    if (language !== 'en' && language !== 'ja') {
      assert.ok(section.includes('59:41') && section.includes('dB'),
        `${language} ratio-to-dB guide`);
    }
  }
});

test('canvas follows the existing analyzer background, grid, label, and DPR contract', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  plugin.regions[1].en = true;
  plugin.phaseMapFrames = [{
    time: 1000,
    points: [
      { frequency: 1000, phase: -60, balance: -25, relativeLevelDb: -72 },
      { frequency: 2000, phase: 60, balance: 25, relativeLevelDb: 0 }
    ]
  }];
  plugin.drawGraph();
  const events = plugin.canvas.contextEvents;
  const hasSet = (key, value) => events.some(event =>
    event.type === 'set' && event.key === key && event.value === value);

  assert.ok(hasSet('fillStyle', '#1a1a1a'));
  assert.ok(hasSet('strokeStyle', 'rgba(255, 255, 255, 0.18)'));
  assert.equal(hasSet('strokeStyle', 'rgba(255, 255, 255, 0.45)'), false);
  assert.ok(hasSet('fillStyle', '#888'));
  assert.ok(hasSet('strokeStyle', '#00ff00'));
  assert.ok(hasSet('lineWidth', 1));
  assert.ok(hasSet('lineWidth', 1.5));
  assert.equal(hasSet('lineWidth', 0.5), false);
  assert.ok(hasSet('font', '12px Arial'));
  const zeroPhaseLabel = events.find(event => event.type === 'call' &&
    event.key === 'fillText' && event.args[0] === '0°');
  const negativePhaseEnd = events.find(event => event.type === 'call' &&
    event.key === 'fillText' && event.args[0] === '-180°');
  const positivePhaseEnd = events.find(event => event.type === 'call' &&
    event.key === 'fillText' && event.args[0] === '+180°');
  const oneKilohertzLabel = events.find(event => event.type === 'call' &&
    event.key === 'fillText' && event.args[0] === '1k');
  assert.equal(zeroPhaseLabel.args[2], plugin._plotRect().bottom - 25);
  assert.equal(negativePhaseEnd.args[1], plugin._plotRect().left);
  assert.equal(positivePhaseEnd.args[1], plugin._plotRect().right);
  assert.equal(negativePhaseEnd.textAlign, 'left');
  assert.equal(positivePhaseEnd.textAlign, 'right');
  assert.equal(oneKilohertzLabel.args[1], plugin._plotRect().left + 40);
  const pointRadii = events.filter(event => event.type === 'call' && event.key === 'arc')
    .map(event => event.args[2]);
  assert.ok(pointRadii.some(radius => Math.abs(radius - 0.6) < 1e-12));
  assert.ok(pointRadii.some(radius => Math.abs(radius - 1.7) < 1e-12));
  assert.ok(events.some(event => event.type === 'call' && event.key === 'setTransform' &&
    JSON.stringify(event.args) === JSON.stringify([1, 0, 0, 1, 0, 0])));

  plugin._setXAxisMode('balance');
  const leftBalanceEnd = events.find(event => event.type === 'call' &&
    event.key === 'fillText' && event.args[0] === '100:0');
  const rightBalanceEnd = events.find(event => event.type === 'call' &&
    event.key === 'fillText' && event.args[0] === '0:100');
  assert.equal(leftBalanceEnd.args[1], plugin._plotRect().left);
  assert.equal(rightBalanceEnd.args[1], plugin._plotRect().right);
  assert.equal(leftBalanceEnd.textAlign, 'left');
  assert.equal(rightBalanceEnd.textAlign, 'right');
});

test('axis ticks thin at narrow widths and keep endpoint labels inside the canvas', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  const cases = [
    { width: 240, phase: ['-180°', '0°', '+180°'], balance: ['100:0', '50:50', '0:100'] },
    {
      width: 320,
      phase: ['-180°', '-90°', '0°', '+90°', '+180°'],
      balance: ['100:0', '80:20', '50:50', '20:80', '0:100']
    },
    {
      width: 375,
      phase: ['-180°', '-90°', '0°', '+90°', '+180°'],
      balance: ['100:0', '80:20', '50:50', '20:80', '0:100']
    },
    {
      width: 720,
      phase: ['-180°', '-135°', '-90°', '-45°', '0°', '+45°', '+90°', '+135°', '+180°'],
      balance: ['100:0', '91:9', '80:20', '67:33', '50:50', '33:67', '20:80', '9:91', '0:100']
    }
  ];

  for (const testCase of cases) {
    const { width } = testCase;
    plugin._graphCssWidth = width;
    plugin._graphCssHeight = width <= 640 ? width * 3 / 4 : width * 9 / 16;
    for (const mode of ['phase', 'balance']) {
      plugin.canvas.contextEvents.length = 0;
      plugin._setXAxisMode(mode);
      const y = plugin._plotRect().bottom - 25;
      const ticks = plugin.canvas.contextEvents.filter(event =>
        event.type === 'call' && event.key === 'fillText' && event.args[2] === y &&
        (mode === 'phase' ? String(event.args[0]).endsWith('°')
          : /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(String(event.args[0]))));
      assert.deepEqual(ticks.map(event => event.args[0]), testCase[mode], `${width}px ${mode}`);
      assert.equal(ticks[0].textAlign, 'left');
      assert.equal(ticks.at(-1).textAlign, 'right');
    }
  }
});

test('telemetry parser validates payloads and resets history across sequence gaps', async () => {
  const { Plugin, subscriptions } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  assert.equal(subscriptions.length, 1);
  assert.deepEqual([subscriptions[0].tapId, subscriptions[0].frameType], [17, 20]);
  const parsed = plugin.parseDspTelemetryFrame(telemetryFrame());
  assert.equal(parsed.pointCount, 1);
  assert.deepEqual(plain(parsed.points[0]), {
    frequency: 1000, phase: -60, balance: -25, relativeLevelDb: -12
  });

  plugin.handleDspTelemetry(telemetryFrame({ sequence: 4 }));
  plugin.handleDspTelemetry(telemetryFrame({ sequence: 5, phase: 30 }));
  assert.equal(plugin.phaseMapFrames.length, 2);
  plugin.handleDspTelemetry(telemetryFrame({ sequence: 8, phase: 45 }));
  assert.equal(plugin.phaseMapFrames.length, 1);
  assert.equal(plugin.phaseMapFrames[0].points[0].phase, 45);

  const invalid = telemetryFrame({ level: 0.1 });
  assert.equal(plugin.parseDspTelemetryFrame(invalid), null);
  const truncated = telemetryFrame();
  truncated.payload = new DataView(truncated.payload.buffer, 0, 28);
  assert.equal(plugin.parseDspTelemetryFrame(truncated), null);
  plugin.cleanup();
  assert.equal(subscriptions[0].disposed, true);
});

test('pointer capture and Escape restore the selected band', async () => {
  const { Plugin, documentListeners } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  const original = plain(plugin.regions[0]);
  const point = {
    clientX: plugin._phaseToX(15),
    clientY: plugin._frequencyToY(3000),
    pointerId: 9,
    isPrimary: true,
    preventDefault() {}
  };
  plugin.canvas.listeners.get('pointerdown')(point);
  assert.equal(plugin.canvas.capturedPointer, 9);
  assert.ok(plugin._pointerState);
  plugin.regions[0].gn = 175;
  documentListeners.get('keydown')({
    key: 'Escape', target: plugin.canvas, preventDefault() {}
  });
  assert.equal(plugin.canvas.capturedPointer, null);
  assert.deepEqual(plain(plugin.regions[0]), original);
});

test('dragging inside the selected outer rectangle moves the whole band', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  plugin.regions[0] = Plugin.normalizeRegion({
    en: true, ofl: 100, fl: 500, fh: 2000, ofh: 8000,
    opl: 20, pl: 40, ph: 100, oph: 140, gn: 100
  });
  const start = { x: plugin._phaseToX(60), y: plugin._frequencyToY(200) };
  assert.deepEqual(plain(plugin._hitTest(start.x, start.y)), { index: 0, mode: 'move' });

  plugin._handlePointerDown({
    clientX: start.x, clientY: start.y, pointerId: 18, isPrimary: true,
    preventDefault() {}
  });
  plugin._applyPointerMove({
    x: plugin._phaseToX(80),
    y: plugin._frequencyToY(400)
  });
  for (const [key, expected] of Object.entries({
    ofl: 200, fl: 1000, fh: 4000, ofh: 16000,
    opl: 40, pl: 60, ph: 120, oph: 160
  })) {
    assert.ok(Math.abs(plugin.regions[0][key] - expected) < 1e-9, key);
  }
  assert.equal(plugin.regions[0].gn, 100);
  plugin._finishPointer({ pointerId: 18, preventDefault() {} }, false);
});

test('canvas cursors preview handle resizing and rectangle dragging', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  plugin.regions[0] = Plugin.normalizeRegion({
    en: true, ofl: 100, fl: 500, fh: 2000, ofh: 8000,
    opl: 20, pl: 40, ph: 100, oph: 140, gn: 100
  });
  const handles = plugin._selectedHandles();
  const hover = point => plugin.canvas.listeners.get('pointermove')({
    clientX: point.x, clientY: point.y, pointerId: 30, isPrimary: true,
    preventDefault() {}
  });

  const horizontal = handles.find(handle => handle.phaseEdge && !handle.frequencyEdge);
  hover(horizontal);
  assert.equal(plugin.canvas.style.cursor, 'ew-resize');

  const vertical = handles.find(handle => handle.frequencyEdge && !handle.phaseEdge);
  hover(vertical);
  assert.equal(plugin.canvas.style.cursor, 'ns-resize');

  const topLeft = handles.find(handle =>
    handle.x < plugin._phaseToX(0) && handle.phaseEdge === 'high' &&
    handle.frequencyEdge === 'high');
  hover(topLeft);
  assert.equal(plugin.canvas.style.cursor, 'nwse-resize');

  const topRight = handles.find(handle =>
    handle.x < plugin._phaseToX(0) && handle.phaseEdge === 'low' &&
    handle.frequencyEdge === 'high');
  hover(topRight);
  assert.equal(plugin.canvas.style.cursor, 'nesw-resize');

  const rectangle = { x: plugin._phaseToX(60), y: plugin._frequencyToY(200) };
  hover(rectangle);
  assert.equal(plugin.canvas.style.cursor, 'grab');
  plugin.canvas.listeners.get('pointerdown')({
    clientX: rectangle.x, clientY: rectangle.y, pointerId: 30, isPrimary: true,
    preventDefault() {}
  });
  assert.equal(plugin.canvas.style.cursor, 'grabbing');
  plugin.canvas.listeners.get('pointerup')({
    clientX: rectangle.x, clientY: rectangle.y, pointerId: 30,
    preventDefault() {}
  });
  assert.equal(plugin.canvas.style.cursor, 'grab');
  plugin.canvas.listeners.get('pointerleave')();
  assert.equal(plugin.canvas.style.cursor, '');
});

test('a center low-phase drag chooses either side once and then locks there', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  const base = Plugin.normalizeRegion({
    en: true, ofl: 100, fl: 200, fh: 2000, ofh: 4000,
    opl: 0, pl: 0, ph: 90, oph: 100, gn: 100
  });

  for (const [pointerId, firstPhase, crossedPhase, expectedSide] of [
    [19, 30, -30, 1],
    [20, -30, 30, -1]
  ]) {
    plugin.regions[0] = plain(base);
    const split = plugin._selectedHandles().find(handle => handle.split);
    plugin._handlePointerDown({
      clientX: split.x, clientY: split.y, pointerId, isPrimary: true,
      preventDefault() {}
    });
    plugin._applyPointerMove({ x: plugin._phaseToX(firstPhase), y: split.y });
    assert.equal(plugin._pointerState.side, expectedSide);
    assert.equal(plugin.regions[0].pl, 30);
    plugin._applyPointerMove({ x: plugin._phaseToX(crossedPhase), y: split.y });
    assert.equal(plugin._pointerState.side, expectedSide);
    assert.equal(plugin.regions[0].pl, 0);
    plugin._finishPointer({ pointerId, preventDefault() {} }, false);
  }
});

test('low phase handles stop at the center instead of crossing it', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  const base = Plugin.normalizeRegion({
    en: true, ofl: 100, fl: 200, fh: 2000, ofh: 4000,
    opl: 20, pl: 30, ph: 90, oph: 100, gn: 100
  });
  const center = plugin._phaseToX(0);

  plugin.regions[0] = plain(base);
  const coreLow = plugin._selectedHandles().find(handle =>
    !handle.outer && handle.phaseEdge === 'low' && !handle.frequencyEdge && handle.x > center);
  plugin._handlePointerDown({
    clientX: coreLow.x, clientY: coreLow.y, pointerId: 21, isPrimary: true,
    preventDefault() {}
  });
  plugin._applyPointerMove({ x: plugin._phaseToX(-45), y: coreLow.y });
  assert.equal(plugin.regions[0].pl, 0);
  plugin._finishPointer({ pointerId: 21, preventDefault() {} }, false);

  plugin.regions[0] = plain(base);
  const outerLow = plugin._selectedHandles().find(handle =>
    handle.outer && handle.phaseEdge === 'low' && handle.x > center);
  plugin._handlePointerDown({
    clientX: outerLow.x, clientY: outerLow.y, pointerId: 22, isPrimary: true,
    preventDefault() {}
  });
  plugin._applyPointerMove({ x: plugin._phaseToX(-45), y: outerLow.y });
  assert.equal(plugin.regions[0].opl, 0);
  assert.equal(plugin.regions[0].pl - plugin.regions[0].opl, base.pl);
  plugin._finishPointer({ pointerId: 22, preventDefault() {} }, false);
});

test('numeric change and blur reflect canonical gain, boundary, and transition values', async () => {
  const { Plugin, document } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  plugin.regions[0] = Plugin.normalizeRegion({
    en: true,
    ofl: 80,
    fl: 100,
    fh: 1000,
    ofh: 1200,
    opl: 20,
    pl: 30,
    ph: 90,
    oph: 100,
    gn: 0
  });
  plugin._refreshUi();

  const gain = plugin._formInputs.get('gn').input;
  document.activeElement = gain;
  gain.value = '99';
  gain.listeners.get('input')();
  assert.equal(plugin.regions[0].gn, 99);
  assert.equal(gain.value, '99');
  gain.listeners.get('change')();
  assert.equal(gain.value, '99');

  const lowFrequency = plugin._formInputs.get('fl').input;
  document.activeElement = lowFrequency;
  lowFrequency.value = '5000';
  lowFrequency.listeners.get('blur')();
  assert.equal(plugin.regions[0].fh, 1000);
  assert.equal(Number(lowFrequency.value),
    Math.round(plugin.regions[0].fl * 100) / 100);

  const lowPhaseTransition = plugin._formInputs.get('lowPhaseTransition').input;
  document.activeElement = lowPhaseTransition;
  lowPhaseTransition.value = '-5';
  lowPhaseTransition.listeners.get('change')();
  assert.equal(plugin.regions[0].opl, plugin.regions[0].pl);
  assert.equal(lowPhaseTransition.value, '0');
});

test('interactive core edits clamp the moved edge and preserve its transition width', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  plugin.regions[0] = Plugin.normalizeRegion({
    used: true,
    en: true,
    ofl: 800,
    fl: 1000,
    fh: 5000,
    ofh: 6000,
    opl: 20,
    pl: 30,
    ph: 90,
    oph: 100,
    gn: 0
  });

  const highFrequency = plugin.regions[0].fh;
  plugin._setSelectedRegionValue('fl', 10000);
  assert.equal(plugin.regions[0].fh, highFrequency);
  assert.ok(plugin.regions[0].fl < highFrequency);
  assert.ok(Math.abs(plugin.regions[0].fl / plugin.regions[0].ofl - 1.25) < 1e-12);

  const lowFrequency = plugin.regions[0].fl;
  plugin._setSelectedRegionValue('fh', 20);
  assert.equal(plugin.regions[0].fl, lowFrequency);
  assert.ok(plugin.regions[0].fh > lowFrequency);
  assert.ok(Math.abs(plugin.regions[0].ofh / plugin.regions[0].fh - 1.2) < 1e-12);

  const highPhase = plugin.regions[0].ph;
  plugin._setSelectedRegionValue('pl', 180);
  assert.equal(plugin.regions[0].ph, highPhase);
  assert.ok(plugin.regions[0].pl < highPhase);
  assert.ok(Math.abs(plugin.regions[0].pl - plugin.regions[0].opl - 10) < 1e-12);

  const lowPhase = plugin.regions[0].pl;
  plugin._setSelectedRegionValue('ph', 0);
  assert.equal(plugin.regions[0].pl, lowPhase);
  assert.ok(plugin.regions[0].ph > lowPhase);
  assert.ok(Math.abs(plugin.regions[0].oph - plugin.regions[0].ph - 10) < 1e-12);
});

test('zero-transition outer handles remain distinct and hittable on every edge', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  plugin.regions[0] = Plugin.normalizeRegion({
    used: true,
    en: true,
    ofl: 100,
    fl: 100,
    fh: 1000,
    ofh: 1000,
    opl: 30,
    pl: 30,
    ph: 90,
    oph: 90,
    gn: 0
  });

  const handles = plugin._selectedHandles();
  const center = plugin._phaseToX(0);
  const pairs = [
    {
      outer: handles.find(handle => handle.outer && handle.frequencyEdge === 'low'),
      core: handles.find(handle => !handle.outer && handle.frequencyEdge === 'low' &&
        !handle.phaseEdge),
      outside: (outer, core) => outer.y > core.y
    },
    {
      outer: handles.find(handle => handle.outer && handle.frequencyEdge === 'high'),
      core: handles.find(handle => !handle.outer && handle.frequencyEdge === 'high' &&
        !handle.phaseEdge),
      outside: (outer, core) => outer.y < core.y
    },
    {
      outer: handles.find(handle => handle.outer && handle.phaseEdge === 'low' &&
        handle.x > center),
      core: handles.find(handle => !handle.outer && handle.phaseEdge === 'low' &&
        !handle.frequencyEdge && handle.x > center),
      outside: (outer, core) => outer.x < core.x
    },
    {
      outer: handles.find(handle => handle.outer && handle.phaseEdge === 'high' &&
        handle.x > center),
      core: handles.find(handle => !handle.outer && handle.phaseEdge === 'high' &&
        !handle.frequencyEdge && handle.x > center),
      outside: (outer, core) => outer.x > core.x
    }
  ];

  for (const { outer, core, outside } of pairs) {
    assert.ok(outer);
    assert.ok(core);
    assert.equal(outside(outer, core), true);
    assert.equal(plugin._hitTest(outer.x, outer.y).outer, true);
  }
});

test('collapsed outer handles preserve their logical grab point for one-pixel drags', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  const baseRegion = {
    used: true,
    en: true,
    ofl: 100,
    fl: 100,
    fh: 1000,
    ofh: 1000,
    opl: 30,
    pl: 30,
    ph: 90,
    oph: 90,
    gn: 0
  };
  const center = plugin._phaseToX(0);
  const cases = [
    {
      outerKey: 'ofl', dx: 0, dy: 1, axis: 'y',
      find: handle => handle.outer && handle.frequencyEdge === 'low'
    },
    {
      outerKey: 'ofh', dx: 0, dy: -1, axis: 'y',
      find: handle => handle.outer && handle.frequencyEdge === 'high'
    },
    {
      outerKey: 'opl', dx: -1, dy: 0, axis: 'x',
      find: handle => handle.outer && handle.phaseEdge === 'low' && handle.x > center
    },
    {
      outerKey: 'oph', dx: 1, dy: 0, axis: 'x',
      find: handle => handle.outer && handle.phaseEdge === 'high' && handle.x > center
    }
  ];

  for (let index = 0; index < cases.length; index++) {
    const testCase = cases[index];
    plugin.regions[0] = Plugin.normalizeRegion(baseRegion);
    const handle = plugin._selectedHandles().find(testCase.find);
    const logicalPoint = plugin._logicalHandlePoint(handle, plugin.regions[0]);
    const before = plain(plugin.regions[0]);
    const pointerId = index + 1;
    plugin._handlePointerDown({
      clientX: handle.x,
      clientY: handle.y,
      pointerId,
      isPrimary: true,
      preventDefault() {}
    });
    plugin._applyPointerMove({ x: handle.x + testCase.dx, y: handle.y + testCase.dy });

    const afterCoordinate = testCase.axis === 'x'
      ? plugin._phaseToX(plugin.regions[0][testCase.outerKey])
      : plugin._frequencyToY(plugin.regions[0][testCase.outerKey]);
    const expectedCoordinate = logicalPoint[testCase.axis] +
      (testCase.axis === 'x' ? testCase.dx : testCase.dy);
    assert.ok(Math.abs(afterCoordinate - expectedCoordinate) < 1e-9);
    for (const key of Object.keys(before)) {
      if (key !== testCase.outerKey) assert.equal(plugin.regions[0][key], before[key]);
    }
    plugin._finishPointer({ pointerId, preventDefault() {} }, false);
  }
});

test('numeric and drag edits keep core spans usable on a narrow high-DPI canvas', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  plugin.canvas.clientWidth = 240;
  plugin.canvas.clientHeight = 180;
  plugin.canvas.width = 720;
  plugin.canvas.height = 540;
  plugin._graphCssWidth = 240;
  plugin._graphCssHeight = 180;
  plugin._graphDpr = 3;
  plugin.handleDspTelemetry(telemetryFrame({ sequence: 1, fftSize: 1024 }));

  plugin.regions[0] = Plugin.normalizeRegion({
    en: true,
    ofl: 900,
    fl: 1000,
    fh: 5000,
    ofh: 6000,
    opl: 0,
    pl: 0,
    ph: 60,
    oph: 70,
    gn: 0
  });
  plugin._setSelectedRegionValue('fh', 1001);
  plugin._setSelectedRegionValue('ph', 0.1);

  const plot = plugin._plotRect();
  const numericRegion = plugin.regions[0];
  assert.ok((numericRegion.ph - numericRegion.pl) / 360 * (plot.right - plot.left) >= 12 - 1e-9);
  assert.ok(plugin._frequencyToY(numericRegion.fl) - plugin._frequencyToY(numericRegion.fh) >= 12 - 1e-9);
  assert.ok(numericRegion.ph - numericRegion.pl >= 1);
  assert.ok(numericRegion.fh - numericRegion.fl >= 48000 / 1024);
  assert.ok(Math.abs(numericRegion.ofh / numericRegion.fh - 1.2) < 1e-12);
  assert.ok(Math.abs(numericRegion.oph - numericRegion.ph - 10) < 1e-12);
  assert.equal(numericRegion.pl, 0);
  assert.equal(Plugin.displaySegments(numericRegion.pl, numericRegion.ph)[0].joinedAtCenter, true);

  const originalRegion = Plugin.normalizeRegion({
    ...numericRegion,
    ofl: 800,
    fl: 1000,
    fh: 5000,
    ofh: 6000,
    opl: 20,
    pl: 30,
    ph: 90,
    oph: 100
  });
  plugin.regions[0] = originalRegion;
  plugin._pointerState = {
    hit: { index: 0, mode: 'handle', phaseEdge: 'high', frequencyEdge: 'high' },
    originalRegion: plain(originalRegion)
  };
  plugin._applyPointerMove({
    x: plugin._phaseToX(30.1),
    y: plugin._frequencyToY(1001)
  });

  const draggedRegion = plugin.regions[0];
  assert.ok((draggedRegion.ph - draggedRegion.pl) / 360 * (plot.right - plot.left) >= 12 - 1e-9);
  assert.ok(plugin._frequencyToY(draggedRegion.fl) - plugin._frequencyToY(draggedRegion.fh) >= 12 - 1e-9);
  assert.ok(draggedRegion.ph - draggedRegion.pl >= 1);
  assert.ok(draggedRegion.fh - draggedRegion.fl >= 48000 / 1024);
  assert.equal(draggedRegion.fl, originalRegion.fl);
  assert.equal(draggedRegion.pl, originalRegion.pl);
  assert.ok(Math.abs(draggedRegion.ofh / draggedRegion.fh - 1.2) < 1e-12);
  assert.ok(Math.abs(draggedRegion.oph - draggedRegion.ph - 10) < 1e-12);

  const fixedHighPhase = draggedRegion.ph;
  plugin._setSelectedRegionValue('pl', 179.9);
  assert.equal(plugin.regions[0].ph, fixedHighPhase);
  assert.ok(plugin.regions[0].pl < fixedHighPhase);
});
