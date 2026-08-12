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
            element.contextEvents.push({ type: 'call', key: String(key), args });
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
  level = -12,
  frequency = 1000,
  sampleRate = 48000,
  fftSize = 4096
} = {}) {
  const buffer = new ArrayBuffer(28);
  const view = new DataView(buffer);
  view.setFloat32(0, sampleRate, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, fftSize, true);
  view.setFloat32(12, -3, true);
  view.setFloat32(16, frequency, true);
  view.setFloat32(20, phase, true);
  view.setFloat32(24, level, true);
  return {
    frameType: 20,
    formatVersion: 1,
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

  plugin.setParameters({ regions: [{
    en: true, ofl: 900, fl: 800, fh: 700, ofh: 600,
    opl: 80, pl: 70, ph: 60, oph: 50, gn: 99
  }] });
  const region = plugin.regions[0];
  assert.ok(20 <= region.ofl && region.ofl <= region.fl);
  assert.ok(region.fl < region.fh && region.fh <= region.ofh && region.ofh <= 40000);
  assert.ok(0 <= region.opl && region.opl <= region.pl);
  assert.ok(region.pl < region.ph && region.ph <= region.oph && region.oph <= 180);
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
  assert.equal(Plugin.regionWeight(first, 500, 40), 1);
  assert.ok(Math.abs(Plugin.regionWeight(first, Math.sqrt(50 * 100), 15) - 0.25) < 1e-12);
  assert.equal(Plugin.compositeGain([first, second], 500, -40), 1);
  assert.ok(Math.abs(Plugin.compositeGain([first], Math.sqrt(50 * 100), 15) - 1.25) < 1e-12);
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
    'Gain (%)', 'Core Low Frequency (Hz)', 'Core High Frequency (Hz)',
    'Core Low Phase (°)', 'Core High Phase (°)',
    'Low Frequency Transition (oct)', 'High Frequency Transition (oct)',
    'Low Phase Transition (°)', 'High Phase Transition (°)'
  ]) assert.ok(labels.includes(expected), expected);
  assert.equal(plugin._regionTabs.length, 5);
  assert.equal(plugin._bandEnableInputs.length, 5);
  assert.equal(plugin._regionTabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(plugin._bandEnableInputs[0].checked, true);
  assert.ok(plugin._bandEnableInputs.slice(1).every(input => input.checked === false));
  assert.equal(elements.filter(element => element.tagName === 'STRONG').length, 0);
  assert.equal(elements.filter(element => element.tagName === 'INPUT' && element.type === 'range').length, 9);
  assert.equal(elements.filter(element => element.tagName === 'INPUT' && element.type === 'number').length, 9);
  assert.equal(ui.children[0].className, 'phase-select-eq-region-tabs');
  assert.equal(ui.children[1].className, 'phase-select-eq-editor');
  assert.equal(ui.children[2].children[0], plugin.canvas);
});

test('rebuilding the UI replaces tab and field references instead of appending them', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  const firstTabs = [...plugin._regionTabs];
  plugin.createUI();

  assert.equal(plugin._regionTabs.length, 5);
  assert.equal(plugin._bandEnableInputs.length, 5);
  assert.equal(plugin._formInputs.size, 9);
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
    element.className === 'parameter-row phase-select-eq-field').length, 9);

  const css = await fs.readFile(
    path.join(repoRoot, 'plugins', 'spatial', 'phase_select_eq.css'), 'utf8');
  assert.match(css, /\.phase-select-eq-map\s*\{[^}]*background-color:\s*#1a1a1a/s);
  assert.match(css, /\.phase-select-eq-editor\s*\{[^}]*background:\s*#2d2d2d/s);
  assert.match(css,
    /\.phase-select-eq-region-tab\[aria-selected="true"\]\s*\{[^}]*background:\s*#444/s);
  assert.match(css, /\.phase-select-eq-region-tab\.disabled\s*\{[^}]*opacity:\s*0\.5/s);
  assert.match(css, /\.phase-select-eq-field\s*\{[^}]*grid-template-columns:/s);
});

test('canvas follows the existing analyzer background, grid, label, and DPR contract', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  plugin.regions[1].en = true;
  plugin.phaseMapFrames = [{
    time: 1000,
    points: [
      { frequency: 1000, phase: -60, relativeLevelDb: -72 },
      { frequency: 2000, phase: 60, relativeLevelDb: 0 }
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
  const oneKilohertzLabel = events.find(event => event.type === 'call' &&
    event.key === 'fillText' && event.args[0] === '1k');
  assert.equal(zeroPhaseLabel.args[2], plugin._plotRect().bottom - 25);
  assert.equal(oneKilohertzLabel.args[1], plugin._plotRect().left + 40);
  const pointRadii = events.filter(event => event.type === 'call' && event.key === 'arc')
    .map(event => event.args[2]);
  assert.ok(pointRadii.some(radius => Math.abs(radius - 0.6) < 1e-12));
  assert.ok(pointRadii.some(radius => Math.abs(radius - 1.7) < 1e-12));
  assert.ok(events.some(event => event.type === 'call' && event.key === 'setTransform' &&
    JSON.stringify(event.args) === JSON.stringify([1, 0, 0, 1, 0, 0])));
});

test('12px canvas tick coordinates remain separated from 240 through 720 CSS pixels', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.createUI();
  const minimumHorizontalSeparation = 12;
  // Arial's painted digit height is below 11 CSS px at a 12px font size.
  const minimumVerticalSeparation = 11;
  const phases = [-180, -135, -90, -45, 0, 45, 90, 135, 180];
  const frequencies = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

  for (const width of [240, 640, 641, 720]) {
    plugin._graphCssWidth = width;
    plugin._graphCssHeight = width <= 640 ? width * 3 / 4 : width * 9 / 16;
    const xCoordinates = phases.map(phase => plugin._phaseToX(phase));
    const yCoordinates = frequencies.map(frequency => plugin._frequencyToY(frequency))
      .sort((left, right) => left - right);
    for (const [coordinates, minimumSeparation] of [
      [xCoordinates, minimumHorizontalSeparation],
      [yCoordinates, minimumVerticalSeparation]
    ]) {
      for (let index = 1; index < coordinates.length; index++) {
        assert.ok(coordinates[index] - coordinates[index - 1] >= minimumSeparation,
          `${width}px tick spacing ${coordinates[index] - coordinates[index - 1]}`);
      }
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
    frequency: 1000, phase: -60, relativeLevelDb: -12
  });

  plugin.handleDspTelemetry(telemetryFrame({ sequence: 4 }));
  plugin.handleDspTelemetry(telemetryFrame({ sequence: 5, phase: 30 }));
  assert.equal(plugin.phaseMapFrames.length, 2);
  plugin.handleDspTelemetry(telemetryFrame({ sequence: 8, phase: 45 }));
  assert.equal(plugin.phaseMapFrames.length, 1);
  assert.equal(plugin.phaseMapFrames[0].points[0].phase, 45);

  const invalid = telemetryFrame({ level: 0.1 });
  assert.equal(plugin.parseDspTelemetryFrame(invalid), null);
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
