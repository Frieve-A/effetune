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
    // `:active` state for isHeldByUser(); flipped by tests, never by the code
    // under test.
    this.active = false;
    // Every event this element was asked to dispatch. The UI-follow apply path
    // must leave this empty, which is what makes the seam non-reentrant.
    this.dispatchedEvents = [];
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

  dispatchEvent(event) {
    this.dispatchedEvents.push(event?.type);
    this.dispatch(event?.type, event);
    return true;
  }

  matches(selector) {
    return selector === ':active' ? this.active : false;
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
    // isHeldByUser() reads document.activeElement; tests assign it directly.
    activeElement: null,
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

function layoutMarkerLabels(points, { width = 1024, height = 480, axis = 'horizontal' } = {}) {
  const items = points.map(({ cx, cy, w = 40, h = 26 }) => ({
    cx,
    cy,
    el: {
      offsetWidth: w,
      offsetHeight: h,
      offsetParent: { clientWidth: 24, clientHeight: 24 },
      style: {}
    }
  }));
  createPlugin().layoutMarkerLabels({ items, width, height, axis });
  return items.map(({ el, cx, cy }) => ({
    x: cx - 12 + parseFloat(el.style.left),
    y: cy - 12 + parseFloat(el.style.top),
    w: el.offsetWidth,
    h: el.offsetHeight
  }));
}

function assertLabelsFitWithoutOverlap(boxes, points, width, height) {
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x &&
    a.y < b.y + b.h && a.y + a.h > b.y;
  for (const [index, box] of boxes.entries()) {
    assert.ok(box.x >= 0 && box.x + box.w <= width);
    assert.ok(box.y >= 0 && box.y + box.h <= height);
    for (const { cx, cy } of points) {
      assert.equal(overlaps(box, { x: cx - 14, y: cy - 14, w: 28, h: 28 }), false);
    }
    for (const previous of boxes.slice(0, index)) {
      assert.equal(overlaps(box, previous), false);
    }
  }
}

test('graph labels stay above spaced markers regardless of text width or fallback axis', () => {
  for (const axis of ['horizontal', 'vertical']) {
    for (const cy of [100, 240, 380]) {
      const points = [32, 32, 36, 36, 40].map((w, index) => ({
        cx: 200 + index * 150, cy, w
      }));
      const boxes = layoutMarkerLabels(points, { axis });
      for (const [index, box] of boxes.entries()) {
        assert.equal(box.x + box.w / 2, points[index].cx);
        assert.ok(box.y + box.h < cy - 14);
      }
    }
  }
});

test('graph labels move away from neighboring labels and markers when needed', () => {
  for (const axis of ['horizontal', 'vertical']) {
    const points = [
      { cx: 200, cy: 240, w: 70 },
      { cx: 240, cy: 240, w: 70 },
      { cx: 400, cy: 200 },
      { cx: 400, cy: 240 }
    ];
    const boxes = layoutMarkerLabels(points, { axis });
    assertLabelsFitWithoutOverlap(boxes, points, 1024, 480);
  }
});

test('graph labels stay inside graph edges without overlapping their own markers', () => {
  const width = 375;
  const height = 176;
  const points = [
    { cx: 20, cy: 20 },
    { cx: 355, cy: 20 },
    { cx: 20, cy: 156 },
    { cx: 355, cy: 156 }
  ];
  for (const axis of ['horizontal', 'vertical']) {
    const boxes = layoutMarkerLabels(points, { width, height, axis });
    assertLabelsFitWithoutOverlap(boxes, points, width, height);
  }
});

test('channel selector exposes only available individual channels and stereo pairs through sixteen', () => {
  for (const channelCount of [2, 8, 9, 10, 16]) {
    const { PluginBase } = loadPluginBase({ window: {
      audioContext: { destination: { channelCount } }
    } });
    const plugin = new PluginBase('Channels', 'Channel selection');
    const select = plugin.createChannelSelectControl().children[1];
    const values = select.children.map(option => option.value);
    assert.equal(values.includes('16'), channelCount === 16);
    assert.equal(values.includes('910'), channelCount >= 10);
    assert.equal(values.includes('1516'), channelCount === 16);
    assert.equal(values.includes('9'), channelCount >= 9);
    assert.deepEqual(values.slice(0, 4), ['', 'A', 'L', 'R']);
  }
});

test('channel debug exposes sixteen UI choices on a stereo device without emulating audio', () => {
  const window = {
    audioContext: { destination: Object.freeze({ channelCount: 2 }) },
    uiManager: { debugChannelCount: 16 }
  };
  const { PluginBase } = loadPluginBase({ window });
  const plugin = new PluginBase('Channels', 'Channel selection');
  const values = () => plugin.createChannelSelectControl().children[1].children.map(option => option.value);
  // These options are for visual debugging; successful processing is not required.
  assert.ok(values().includes('16'));
  assert.ok(values().includes('1516'));
  assert.equal(window.audioContext.destination.channelCount, 2);
  window.uiManager.debugChannelCount = null;
  assert.deepEqual(values(), ['', 'A', 'L', 'R']);
});

function loadModulationPlugin(sourcePath, exportName) {
  const { context } = loadPluginBase();
  const source = fs.readFileSync(new URL(sourcePath, import.meta.url), 'utf8');
  vm.runInContext(`${source}\nthis.PluginRef = ${exportName};`, context);
  return context.PluginRef;
}

// Builds one plugin carrying a modelKey-wired control of each shape the
// UI-follow seam has to cover: a linear control, a logarithmic one whose widget
// unit differs from the model unit (seconds stored, milliseconds shown), and a
// select. `setterCalls` stays empty unless the sync path re-enters the forward
// path, which it must never do.
function createSyncPlugin() {
  const { PluginBase, documentRef } = loadPluginBase();
  const plugin = new PluginBase('Sync Test', 'UI follow');
  plugin.id = 'plugin-sync';
  plugin.gain = -6;
  plugin.rate = 0.2;
  plugin.mode = 'b';

  const setterCalls = [];
  const gainRow = plugin.createParameterControl(
    'Gain', -30, 0, 0.1, plugin.gain,
    value => {
      setterCalls.push(['gain', value]);
      plugin.gain = value;
    },
    'dB', 'gain'
  );
  const rateRow = plugin.createLogarithmicParameterControl(
    'Rate', 1, 10000, 0.1, plugin.rate * 1000,
    value => {
      setterCalls.push(['rate', value]);
      plugin.rate = value / 1000;
    },
    'ms', 'rate', modelValue => modelValue * 1000
  );
  const modeRow = plugin.createSelectControl(
    'Mode', [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], plugin.mode,
    value => {
      setterCalls.push(['mode', value]);
      plugin.mode = value;
    },
    'mode'
  );

  return {
    plugin,
    documentRef,
    setterCalls,
    gainSlider: gainRow.children[1],
    gainInput: gainRow.children[2],
    rateSlider: rateRow.children[1],
    rateInput: rateRow.children[2],
    modeSelect: modeRow.children[1]
  };
}

test('PluginBase syncUIControls pushes model changes into modelKey-wired controls', () => {
  const {
    plugin, setterCalls, gainSlider, gainInput, rateSlider, rateInput, modeSelect
  } = createSyncPlugin();

  assert.equal(rateInput.value, '200.0');

  plugin.gain = -12;
  plugin.rate = 2;
  plugin.mode = 'a';
  plugin.syncUIControls();

  assert.equal(Number(gainSlider.value), -12);
  assert.equal(gainInput.value, '-12.0');
  // toDisplay converts the stored seconds into the millisecond widget unit.
  assert.equal(rateInput.value, '2000.0');
  assert.equal(Number(rateSlider.value).toFixed(3), (Math.log10(2000) / 4 * 100).toFixed(3));
  assert.equal(modeSelect.value, 'a');
  assert.deepEqual(setterCalls, []);
});

test('PluginBase syncUIControls skips controls the user is holding', () => {
  const { plugin, documentRef, gainSlider, gainInput } = createSyncPlugin();

  // A focused number input is mid-edit, so the whole control is off limits.
  documentRef.activeElement = gainInput;
  plugin.gain = -20;
  plugin.syncUIControls();
  assert.equal(gainInput.value, -6);
  assert.equal(gainSlider.value, -6);

  documentRef.activeElement = null;
  plugin.syncUIControls();
  assert.equal(gainInput.value, '-20.0');
  assert.equal(Number(gainSlider.value), -20);
});

test('PluginBase syncUIControls dispatches no input or change events', () => {
  const {
    plugin, setterCalls, gainSlider, gainInput, rateSlider, rateInput, modeSelect
  } = createSyncPlugin();
  const elements = [gainSlider, gainInput, rateSlider, rateInput, modeSelect];
  const observed = [];
  for (const element of elements) {
    for (const type of ['input', 'change']) {
      element.addEventListener(type, () => observed.push([element.tagName, type]));
    }
  }

  plugin.gain = -12;
  plugin.rate = 2;
  plugin.mode = 'a';
  plugin.syncUIControls();

  // The sync really happened...
  assert.equal(gainInput.value, '-12.0');
  assert.equal(rateInput.value, '2000.0');
  assert.equal(modeSelect.value, 'a');
  // ...and it stayed one-way: no event was dispatched and no setter re-entered.
  assert.deepEqual(observed, []);
  assert.deepEqual(elements.flatMap(element => element.dispatchedEvents), []);
  assert.deepEqual(setterCalls, []);
});

test('PluginBase createUI clears the UI-follow registries on every rebuild', () => {
  const { PluginBase, documentRef } = loadPluginBase();
  class RebuildPlugin extends PluginBase {
    constructor() {
      super('Rebuild Test', 'UI follow');
      this.id = 'plugin-rebuild';
      this.gain = -6;
      this.refreshCount = 0;
    }

    createUI() {
      const row = this.createParameterControl(
        'Gain', -30, 0, 0.1, this.gain, value => { this.gain = value; }, 'dB', 'gain'
      );
      this.bindGraphPointer(documentRef.createElement('div'), {});
      this.registerUIRefresh(() => { this.refreshCount += 1; });
      return row;
    }
  }

  const plugin = new RebuildPlugin();
  const firstRow = plugin.createUI();
  assert.equal(plugin._syncedUIControls.length, 1);
  assert.equal(plugin._uiRefreshHooks.length, 1);
  assert.equal(plugin._graphPointerProbes.size, 1);

  const secondRow = plugin.createUI();
  assert.notEqual(firstRow, secondRow);
  assert.equal(plugin._syncedUIControls.length, 1);
  assert.equal(plugin._uiRefreshHooks.length, 1);
  assert.equal(plugin._graphPointerProbes.size, 1);

  plugin.gain = -12;
  plugin.syncUIControls();
  // Only the current build's hook ran, and only the current build's control moved.
  assert.equal(plugin.refreshCount, 1);
  assert.equal(firstRow.children[2].value, -6);
  assert.equal(secondRow.children[2].value, '-12.0');
});

test('PluginBase holds refresh hooks off while a graph pointer is down', () => {
  const { PluginBase } = loadPluginBase();
  const plugin = new PluginBase('Graph Sync Test', 'UI follow');
  plugin.id = 'plugin-graph-sync';
  plugin.gain = -6;

  const graph = new FakeElement('div');
  plugin.bindGraphPointer(graph, {});
  let hookRuns = 0;
  plugin.registerUIRefresh(() => { hookRuns += 1; });
  const row = plugin.createParameterControl(
    'Gain', -30, 0, 0.1, plugin.gain, value => { plugin.gain = value; }, 'dB', 'gain'
  );
  const gainInput = row.children[2];

  graph.dispatch('pointerdown', { pointerId: 3, clientX: 5, clientY: 5 });
  assert.equal(plugin.isGraphPointerActive(), true);

  plugin.gain = -12;
  plugin.syncUIControls();
  assert.equal(hookRuns, 0);
  // Helper-built controls keep following: only hand-built DOM is held off.
  assert.equal(gainInput.value, '-12.0');

  graph.dispatch('pointerup', { pointerId: 3, clientX: 5, clientY: 5 });
  assert.equal(plugin.isGraphPointerActive(), false);
  plugin.syncUIControls();
  assert.equal(hookRuns, 1);
});

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
  const radioOptions = radioRow.children[1];
  const leftOption = radioOptions.children[0];
  const rightOption = radioOptions.children[1];
  const leftRadio = leftOption.children[0];
  const rightRadio = rightOption.children[0];
  assert.equal(radioRow.className, 'parameter-row radio-group');
  assert.equal(radioOptions.className, 'radio-options');
  assert.equal(leftOption.className, 'radio-option');
  assert.equal(rightOption.className, 'radio-option');
  assert.equal(leftOption.children[1].htmlFor, leftRadio.id);
  assert.equal(rightOption.children[1].htmlFor, rightRadio.id);
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

test('Chorus logarithmic Delay and linear Depth retain canonical values', () => {
  const ChorusPlugin = loadModulationPlugin('../../plugins/modulation/chorus.js', 'ChorusPlugin');
  const plugin = new ChorusPlugin();
  plugin.createUI();
  const assertControl = (row, expected) => {
    const slider = row.children[1];
    const expectedPosition = slider.dataset.rangeFineMin
      ? 100 * Math.log(expected / 0.5) / Math.log(30 / 0.5)
      : expected;
    assert.ok(Math.abs(Number(slider.value) - expectedPosition) < 1e-10);
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

test('logarithmic parameter controls map a ratio fill origin into slider coordinates', () => {
  const plugin = createPlugin();
  for (const [minimum, expectedOrigin] of [[0.5, 18.7901824709], [0.05, 50]]) {
    const row = plugin.createLogarithmicParameterControl(
      'Ratio', minimum, 20, 0.01, 1, () => {}, '1:', 'rt', null, 1
    );
    const slider = row.children[1];
    assert.ok(Math.abs(Number(slider.dataset.rangeFillOrigin) - expectedOrigin) < 1e-10);
    assert.equal(Number(slider.dataset.rangeFillOrigin), Number(slider.value));
  }
  const frequency = plugin.createLogarithmicParameterControl(
    'Frequency', 20, 20000, 1, 1000, () => {}, 'Hz'
  );
  assert.equal(frequency.children[1].dataset.rangeFillOrigin, undefined);
});

test('logarithmic slider curves retain linear control display, steps and number entry', () => {
  for (const [min, max, step, initial, values] of [
    [0.1, 100, 0.1, 7.75, [0.1, 1, 7.8, 100]],
    [0.2, 10, 0.01, 1.2, [0.2, 1, 1.37, 10]],
    [50, 1000, 5, 100, [50, 105, 1000]],
    [4000, 96000, 100, 44100, [4000, 44100, 96000]],
    [1, 100, 1, '10', [1, 10, 100]]
  ]) {
    const plugin = createPlugin();
    const calls = [[], []];
    const rows = [false, true].map((logarithmic, index) => plugin.createParameterControl(
      'Value', min, max, step, initial, value => calls[index].push(value), '', null, null, logarithmic
    ));
    const [linear, logarithmic] = rows;
    assert.equal(logarithmic.children[2].value, linear.children[2].value);
    assert.deepEqual(
      [logarithmic.children[2].min, logarithmic.children[2].max, logarithmic.children[2].step],
      [linear.children[2].min, linear.children[2].max, linear.children[2].step]
    );
    for (const value of values) {
      linear.children[1].value = String(value);
      logarithmic.children[1].value = String(100 * Math.log(value / min) / Math.log(max / min));
      for (const row of rows) row.children[1].dispatch('input');
      assert.equal(logarithmic.children[2].value, String(value));
      assert.equal(logarithmic.children[2].value, linear.children[2].value);
      assert.equal(calls[1].at(-1), calls[0].at(-1));
    }
    for (const value of [String(initial), '', String(max + step)]) {
      for (const row of rows) {
        row.children[2].value = value;
        row.children[2].dispatch('input');
      }
      assert.equal(logarithmic.children[2].value, linear.children[2].value);
      assert.deepEqual(calls[1], calls[0]);
      for (const row of rows) row.children[2].dispatch('blur');
      assert.equal(logarithmic.children[2].value, linear.children[2].value);
      assert.deepEqual(calls[1], calls[0]);
    }
  }
});

for (const [name, className, ratioMin] of [
  ['compressor', 'MultibandCompressorPlugin', 0.5],
  ['expander', 'MultibandExpanderPlugin', 0.05]
]) {
  test(name + ' band sliders preserve parameter units through logarithmic input and model sync', () => {
    const { context, documentRef } = loadPluginBase({ globals: {
      IntersectionObserver: class { observe() {} disconnect() {} }
    } });
    const elements = [];
    documentRef.createElement = tag => {
      const element = new FakeElement(tag);
      element.setAttribute = () => {};
      elements.push(element);
      return element;
    };
    documentRef.getElementById = id => elements.find(element => element.id === id) || null;
    const source = fs.readFileSync(new URL('../../plugins/dynamics/multiband_' + name + '.js', import.meta.url), 'utf8');
    vm.runInContext(source, context);
    const plugin = new context.window[className]();
    plugin.id = 'multiband-test';
    plugin.updateTransferGraphs = () => {};
    plugin.startAnimation = () => {};
    const original = JSON.stringify(plugin.getParameters());
    plugin.createUI();
    assert.equal(JSON.stringify(plugin.getParameters()), original);
    for (let band = 0; band < 5; band++) {
      for (const [label, key, min, max, step] of [
        ['Ratio:', 'r', ratioMin, 20, 0.01],
        ['Attack (ms):', 'a', 0.1, 100, 0.1],
        ['Release (ms):', 'rl', 1, 1000, 1]
      ]) {
        const ids = plugin._bandControlIds(band, label);
        const slider = documentRef.getElementById(ids.slider);
        const input = documentRef.getElementById(ids.number);
        assert.equal(Number(input.value), plugin.bands[band][key]);
        assert.deepEqual([Number(input.min), Number(input.max), Number(input.step)], [min, max, step]);
        assert.equal(slider.dataset.rangeFineTarget, ids.number);
        assert.equal(slider.dataset.rangeFineStep, String(step));
        const position = value => 100 * Math.log(value / min) / Math.log(max / min);
        assert.ok(Math.abs(Number(slider.value) - position(plugin.bands[band][key])) < 1e-10);
        if (key === 'r') assert.ok(Math.abs(Number(slider.dataset.rangeFillOrigin) - position(1)) < 1e-10);

        plugin.selectedBand = band;
        const otherBands = JSON.stringify(plugin.bands.filter((_, i) => i !== band));
        slider.value = 50;
        slider.dispatch('input');
        const midpoint = min + Math.round((Math.sqrt(min * max) - min) / step) * step;
        assert.ok(Math.abs(plugin.bands[band][key] - midpoint) < 1e-10);
        assert.equal(Number(input.value), plugin.bands[band][key]);
        assert.equal(JSON.stringify(plugin.bands.filter((_, i) => i !== band)), otherBands);

        const exact = key === 'r' ? 1.37 : key === 'a' ? 7.75 : 87.5;
        input.value = String(exact);
        input.dispatch('input');
        assert.equal(plugin.bands[band][key], exact);
        assert.ok(Math.abs(Number(slider.value) - position(exact)) < 1e-10);

        plugin.bands[band][key] = max;
        slider.active = true;
        plugin.syncUIControls();
        assert.ok(Math.abs(Number(slider.value) - position(exact)) < 1e-10);
        slider.active = false;
        plugin.syncUIControls();
        assert.equal(Number(input.value), max);
        assert.ok(Math.abs(Number(slider.value) - 100) < 1e-10);
      }
      const thresholdIds = plugin._bandControlIds(band, 'Threshold (dB):');
      const threshold = documentRef.getElementById(thresholdIds.slider);
      assert.equal(Number(threshold.min), -60);
      assert.equal(Number(threshold.max), 0);
      assert.equal(Number(threshold.value), plugin.bands[band].t);
    }
  });
}
