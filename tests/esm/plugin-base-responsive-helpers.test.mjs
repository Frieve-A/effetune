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
    this.style = {};
    this.className = '';
    this.id = '';
    this.name = '';
    this.type = '';
    this.value = '';
    this.textContent = '';
    this.checked = false;
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

function loadPluginBase() {
  const source = fs.readFileSync(new URL('../../plugins/plugin-base.js', import.meta.url), 'utf8');
  const documentRef = {
    createElement(tagName) {
      return new FakeElement(tagName);
    }
  };
  const context = {
    window: {},
    document: documentRef,
    console,
    performance: { now: () => 0 },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(`${source}\nthis.PluginBaseRef = PluginBase;`, context);
  return { PluginBase: context.PluginBaseRef, documentRef };
}

function createPlugin() {
  const { PluginBase } = loadPluginBase();
  const plugin = new PluginBase('Responsive Test', 'Test helpers');
  plugin.id = 'plugin-1';
  return plugin;
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
