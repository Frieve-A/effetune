import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.eventListeners = new Map();
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.id = '';
    this.name = '';
    this.type = '';
    this.value = '';
    this.textContent = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.width = 0;
    this.height = 0;
    this.autocomplete = '';
    this.pointerCapture = null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, []);
    this.eventListeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    this.eventListeners.set(
      type,
      (this.eventListeners.get(type) || []).filter(candidate => candidate !== listener)
    );
  }

  dispatch(type, event = {}) {
    const eventObject = {
      target: this,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      preventDefault() {},
      ...event
    };
    for (const listener of this.eventListeners.get(type) || []) {
      listener(eventObject);
    }
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = element => {
      if (selector === 'select') return element.tagName === 'SELECT';
      const inputType = /^input\[type="([^"]+)"\]$/.exec(selector)?.[1];
      return inputType !== undefined && element.tagName === 'INPUT' && element.type === inputType;
    };
    const found = [];
    const visit = element => {
      for (const child of element.children) {
        if (matches(child)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  setPointerCapture(pointerId) {
    this.pointerCapture = pointerId;
  }

  releasePointerCapture(pointerId) {
    if (this.pointerCapture === pointerId) {
      this.pointerCapture = null;
    }
  }

  getBoundingClientRect() {
    return { left: 10, top: 20, width: 200, height: 100 };
  }
}

function loadPluginBase(overrides = {}) {
  const source = fs.readFileSync(new URL('../../plugins/plugin-base.js', import.meta.url), 'utf8');
  const documentRef = {
    createElement(tagName) {
      return new FakeElement(tagName);
    }
  };
  const context = {
    window: overrides.window || {},
    document: documentRef,
    console,
    performance: { now: () => 0 },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout,
    clearTimeout,
    ...overrides.globals
  };
  vm.runInNewContext(`${source}\nthis.PluginBaseRef = PluginBase;`, context);
  return { PluginBase: context.PluginBaseRef, documentRef, context };
}

function createPlugin() {
  const { PluginBase } = loadPluginBase();
  const plugin = new PluginBase('Responsive Test', 'Test helpers');
  plugin.id = 'plugin-1';
  return plugin;
}

function loadModulationPlugin(sourcePath, exportName) {
  const { context } = loadPluginBase();
  const source = fs.readFileSync(new URL(sourcePath, import.meta.url), 'utf8');
  vm.runInContext(`${source}\nthis.PluginRef = ${exportName};`, context);
  return context.PluginRef;
}

test('PluginBase creates mobile-friendly select, checkbox, and radio controls', () => {
  const plugin = createPlugin();
  const calls = [];

  const selectRow = plugin.createSelectControl(
    'Mode',
    [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    'b',
    value => calls.push(['select', value])
  );
  const select = selectRow.children[1];
  assert.equal(selectRow.className, 'parameter-row');
  assert.equal(select.value, 'b');
  select.value = 'a';
  select.dispatch('change');

  const checkboxRow = plugin.createCheckboxControl('Enabled', true, value => calls.push(['checkbox', value]));
  const checkbox = checkboxRow.children[1];
  assert.equal(checkboxRow.className, 'parameter-row checkbox-row');
  checkbox.checked = false;
  checkbox.dispatch('change');

  const radioRow = plugin.createRadioGroup('Channel', ['Left', 'Right'], 'Right', value => calls.push(['radio', value]));
  const leftRadio = radioRow.children[1];
  const rightRadio = radioRow.children[3];
  assert.equal(radioRow.className, 'parameter-row radio-group');
  assert.equal(leftRadio.name, rightRadio.name);
  assert.notEqual(leftRadio.id, rightRadio.id);
  leftRadio.checked = true;
  leftRadio.dispatch('change');

  assert.deepEqual(calls, [
    ['select', 'a'],
    ['checkbox', false],
    ['radio', 'Left']
  ]);
});

test('PluginBase parameter controls preserve the last finite value while editing', () => {
  const plugin = createPlugin();
  const calls = [];
  const row = plugin.createParameterControl(
    'Relative Volume',
    -30,
    0,
    0.1,
    -30,
    value => calls.push(value),
    'dB'
  );
  const slider = row.children[1];
  const valueInput = row.children[2];

  valueInput.value = '';
  valueInput.dispatch('input');
  assert.deepEqual(calls, []);
  assert.equal(Number(slider.value), -30);

  valueInput.dispatch('blur');
  assert.deepEqual(calls, []);
  assert.equal(Number(valueInput.value), -30);
  assert.equal(Number(slider.value), -30);

  valueInput.value = '-';
  valueInput.dispatch('input');
  assert.deepEqual(calls, []);
  assert.equal(Number(slider.value), -30);

  let enterPrevented = false;
  valueInput.dispatch('keydown', {
    key: 'Enter',
    preventDefault() {
      enterPrevented = true;
    }
  });
  assert.deepEqual(calls, []);
  assert.equal(Number(valueInput.value), -30);
  assert.equal(Number(slider.value), -30);
  assert.equal(enterPrevented, true);

  valueInput.value = '0';
  valueInput.dispatch('input');
  assert.deepEqual(calls, [0]);
  assert.equal(Number(slider.value), 0);

  valueInput.dispatch('blur');
  assert.deepEqual(calls, [0]);
  assert.equal(Number(valueInput.value), 0);
  assert.equal(Number(slider.value), 0);

  valueInput.value = '10';
  valueInput.dispatch('input');
  assert.deepEqual(calls, [0, 10]);
  assert.equal(valueInput.value, '10');
  assert.equal(Number(slider.value), 0);

  valueInput.dispatch('blur');
  assert.deepEqual(calls, [0, 10, 0]);
  assert.equal(Number(valueInput.value), 0);
  assert.equal(Number(slider.value), 0);
});

test('PluginBase linear controls retain Chorus canonical Delay and Depth values', () => {
  const ChorusPlugin = loadModulationPlugin('../../plugins/modulation/chorus.js', 'ChorusPlugin');
  const plugin = new ChorusPlugin();
  plugin.createUI();
  const assertControl = (row, expected) => {
    assert.equal(Number(row.children[1].value), expected);
    assert.equal(Number(row.children[2].value), expected);
  };

  const delayRow = plugin._uiControls.dl;
  const depthRow = plugin._uiControls.dp;
  depthRow.children[2].value = '20';
  depthRow.children[2].dispatch('input');
  assert.deepEqual({ delay: plugin.dl, depth: plugin.dp }, { delay: 12, depth: 12 });
  assertControl(delayRow, 12);
  assertControl(depthRow, 12);

  delayRow.children[2].value = '2';
  delayRow.children[2].dispatch('input');
  assert.deepEqual({ delay: plugin.dl, depth: plugin.dp }, { delay: 2, depth: 2 });
  assertControl(delayRow, 2);
  assertControl(depthRow, 2);

  plugin.cleanup();
});

test('PluginBase linear controls retain Frequency Shifter canonical minimum and maximum values', () => {
  const FrequencyShifterPlugin = loadModulationPlugin(
    '../../plugins/modulation/frequency_shifter.js',
    'FrequencyShifterPlugin'
  );
  const plugin = new FrequencyShifterPlugin();
  plugin.createUI();
  const assertControl = (row, expected) => {
    assert.equal(Number(row.children[1].value), expected);
    assert.equal(Number(row.children[2].value), expected);
  };

  const minimumRow = plugin._uiControls.mn;
  const maximumRow = plugin._uiControls.mx;
  minimumRow.children[2].value = '900';
  minimumRow.children[2].dispatch('input');
  assert.deepEqual({ minimum: plugin.mn, maximum: plugin.mx }, { minimum: 800, maximum: 900 });
  assertControl(minimumRow, 800);
  assertControl(maximumRow, 900);

  maximumRow.children[2].value = '100';
  maximumRow.children[2].dispatch('input');
  assert.deepEqual({ minimum: plugin.mn, maximum: plugin.mx }, { minimum: 100, maximum: 800 });
  assertControl(minimumRow, 100);
  assertControl(maximumRow, 800);

  plugin.cleanup();
});

test('PluginBase creates responsive graph containers and maps pointer coordinates', () => {
  const plugin = createPlugin();
  const { container, canvas } = plugin.createGraphContainer({
    maxWidth: 640,
    canvasWidth: 1000,
    canvasHeight: 500,
    className: 'custom-graph'
  });

  assert.equal(container.className, 'graph-container custom-graph');
  assert.equal(container.style.width, '100%');
  assert.equal(container.style.maxWidth, '640px');
  assert.equal(canvas.width, 1000);
  assert.equal(canvas.height, 500);
  assert.equal(canvas.style.aspectRatio, '1000 / 500');

  const coords = plugin.getGraphCoords(canvas, { clientX: 110, clientY: 70 });
  assert.equal(coords.x, 500);
  assert.equal(coords.y, 250);

  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 0, height: 0 });
  const zeroRectCoords = plugin.getGraphCoords(canvas, { clientX: 110, clientY: 70 });
  assert.equal(Number.isFinite(zeroRectCoords.x), true);
  assert.equal(Number.isFinite(zeroRectCoords.y), true);
});

test('PluginBase creates DPR-synced responsive graph containers', () => {
  const plugin = createPlugin();
  const resizeCalls = [];
  const { container, canvas, resize, dispose } = plugin.createResponsiveGraph({
    maxWidth: 500,
    aspectRatio: '4 / 1',
    mobileAspectRatio: '2 / 1',
    className: 'meter-graph',
    onResize: info => resizeCalls.push([info.canvas, info.cssWidth, info.cssHeight, info.dpr])
  });

  assert.equal(container.className, 'graph-container responsive-graph-container meter-graph');
  assert.equal(container.style.width, '100%');
  assert.equal(container.style.maxWidth, '500px');
  assert.equal(container.style.aspectRatio, '4 / 1');
  assert.equal(container.style['--mobile-aspect-ratio'], '2 / 1');
  assert.equal(canvas.style.width, '100%');
  assert.equal(canvas.style.height, '100%');

  resize();
  assert.equal(canvas.width, 200);
  assert.equal(canvas.height, 100);
  assert.deepEqual(resizeCalls.at(-1), [canvas, 200, 100, 1]);

  canvas.width = 17;
  canvas.height = 19;
  dispose();
  resize();
  assert.equal(canvas.width, 17);
  assert.equal(canvas.height, 19);
});

test('PluginBase cleanup disposes responsive graph observers', () => {
  const plugin = createPlugin();
  const { canvas, resize } = plugin.createResponsiveGraph();

  resize();
  assert.equal(canvas.width, 200);
  assert.equal(canvas.height, 100);
  assert.equal(plugin._responsiveGraphDisposers.size, 1);

  canvas.width = 17;
  canvas.height = 19;
  plugin.cleanup();
  assert.equal(plugin._responsiveGraphDisposers.size, 0);

  resize();
  assert.equal(canvas.width, 17);
  assert.equal(canvas.height, 19);
});

test('PluginBase bindGraphPointer handles tap, drag, and cleanup', () => {
  const plugin = createPlugin();
  const element = new FakeElement('div');
  const calls = [];
  const cleanup = plugin.bindGraphPointer(element, {
    onDragStart: event => calls.push(['start', event.clientX, event.clientY]),
    onDragMove: event => calls.push(['move', event.clientX, event.clientY]),
    onDragEnd: event => calls.push(['end', event.clientX, event.clientY]),
    onTap: event => calls.push(['tap', event.clientX, event.clientY])
  });

  element.dispatch('pointerdown', { pointerId: 7, clientX: 10, clientY: 10 });
  element.dispatch('pointerup', { pointerId: 7, clientX: 12, clientY: 12 });
  element.dispatch('pointerdown', { pointerId: 8, clientX: 20, clientY: 20 });
  element.dispatch('pointermove', { pointerId: 8, clientX: 40, clientY: 20 });
  element.dispatch('pointerup', { pointerId: 8, clientX: 50, clientY: 20 });

  assert.deepEqual(calls, [
    ['tap', 12, 12],
    ['start', 20, 20],
    ['move', 40, 20],
    ['end', 50, 20]
  ]);

  calls.length = 0;
  element.dispatch('pointerdown', { pointerId: 10, clientX: 5, clientY: 5 });
  element.dispatch('pointerdown', { pointerId: 11, clientX: 20, clientY: 20 });
  element.dispatch('pointerup', { pointerId: 11, clientX: 20, clientY: 20 });
  element.dispatch('pointerup', { pointerId: 10, clientX: 5, clientY: 5 });
  element.dispatch('pointerdown', { pointerId: 12, isPrimary: false, clientX: 30, clientY: 30 });
  element.dispatch('pointerup', { pointerId: 12, isPrimary: false, clientX: 30, clientY: 30 });
  assert.deepEqual(calls, [['tap', 5, 5]]);

  calls.length = 0;
  element.dispatch('pointerdown', { pointerId: 13, clientX: 10, clientY: 10 });
  element.dispatch('pointercancel', { pointerId: 13, clientX: 10, clientY: 10 });
  assert.deepEqual(calls, []);

  element.dispatch('pointerdown', { pointerId: 14, clientX: 10, clientY: 10 });
  element.dispatch('pointermove', { pointerId: 14, clientX: 30, clientY: 10 });
  element.dispatch('pointercancel', { pointerId: 14, clientX: 30, clientY: 10 });
  assert.deepEqual(calls, [
    ['start', 10, 10],
    ['move', 30, 10],
    ['end', 30, 10]
  ]);

  cleanup();
  assert.equal(element.eventListeners.get('pointerdown').length, 0);
  assert.equal(element.eventListeners.get('pointermove').length, 0);
  assert.equal(element.eventListeners.get('pointerup').length, 0);
  assert.equal(element.eventListeners.get('pointercancel').length, 0);
});

test('PluginBase gates every visual RAF callback and records exact diagnostics', () => {
  const frames = [];
  const counters = new Map();
  const windowRef = {
    audioManager: {
      incrementPowerDiagnostic(key) {
        counters.set(key, (counters.get(key) || 0) + 1);
      }
    }
  };
  const { PluginBase } = loadPluginBase({
    window: windowRef,
    globals: {
      requestAnimationFrame(callback) {
        frames.push(callback);
        return frames.length;
      }
    }
  });
  const plugin = new PluginBase('Visual Test', 'Power RAF gate');
  const callbacks = [];

  plugin.animationFrameId = plugin.requestPowerAnimationFrame(
    timestamp => callbacks.push(timestamp),
    'analyzer'
  );
  frames.shift()(123);
  assert.deepEqual(callbacks, [123]);
  assert.equal(counters.get('pluginVisualRafCallbacks'), 1);
  assert.equal(counters.get('analyzerRafCallbacks'), 1);

  plugin.animationFrameId = plugin.requestPowerAnimationFrame(
    timestamp => callbacks.push(timestamp)
  );
  plugin.setPowerUiEnabled(false);
  frames.shift()(456);
  assert.deepEqual(callbacks, [123]);
  assert.equal(counters.get('pluginVisualRafCallbacks'), 1);
  assert.equal(plugin.animationFrameId, null);
  assert.equal(plugin.requestPowerAnimationFrame(() => {}), null);
  let staticRenders = 0;
  assert.equal(plugin.renderPowerUiOnce(() => { staticRenders++; }), true);
  assert.equal(staticRenders, 1);
  plugin.enabled = false;
  assert.equal(plugin.renderPowerUiOnce(() => { staticRenders++; }), false);
  assert.equal(staticRenders, 1);
});
