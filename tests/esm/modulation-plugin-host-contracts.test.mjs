import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { UIManager } from '../../js/ui-manager.js';

const pluginFiles = [
  ['auto_pan.js', 'AutoPanPlugin', { rt: 4 }],
  ['auto_filter.js', 'AutoFilterPlugin', { lf: 120, hf: 12000 }],
  ['chorus.js', 'ChorusPlugin', { rt: 2.5 }],
  ['frequency_shifter.js', 'FrequencyShifterPlugin', { sh: -125 }],
  ['phaser.js', 'PhaserPlugin', { cf: 2400 }],
  ['rotary_speaker.js', 'RotarySpeakerPlugin', { xo: 1200 }]
];

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.eventListeners = new Map();
    this.dataset = {};
    this.style = {
      setProperty(name, value) {
        this[name] = value;
      }
    };
    this.className = '';
    this.id = '';
    this.name = '';
    this.type = '';
    this.value = '';
    this.textContent = '';
    this.checked = false;
    this.disabled = false;
    this.autocomplete = '';
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

  dispatch(type, event = {}) {
    const eventObject = { target: this, preventDefault() {}, ...event };
    for (const listener of this.eventListeners.get(type) || []) listener(eventObject);
    this.ownerDocument?.dispatch(type, eventObject);
  }

  matches(selector) {
    if (selector === 'input[type="range"]') {
      return this.tagName === 'INPUT' && this.type === 'range';
    }
    return false;
  }

  closest(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    for (let element = this; element; element = element.parentNode) {
      if (className && element.className.split(/\s+/).includes(className)) return element;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = element => {
      if (selector === 'select') return element.tagName === 'SELECT';
      if (selector === 'input[type="range"]') {
        return element.tagName === 'INPUT' && element.type === 'range';
      }
      if (selector === 'input[type="number"]') {
        return element.tagName === 'INPUT' && element.type === 'number';
      }
      if (selector === 'input[type="radio"]') {
        return element.tagName === 'INPUT' && element.type === 'radio';
      }
      return false;
    };
    const results = [];
    const pending = [...this.children];
    while (pending.length > 0) {
      const element = pending.shift();
      if (matches(element)) results.push(element);
      pending.push(...element.children);
    }
    return results;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function createFakeDocument() {
  const listeners = new Map();
  const documentRef = {
    body: null,
    createElement(tagName) {
      return new FakeElement(tagName, documentRef);
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter(candidate => candidate !== listener));
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) || []) listener(event);
    },
    querySelectorAll(selector) {
      return documentRef.body?.querySelectorAll(selector) ?? [];
    }
  };
  documentRef.body = documentRef.createElement('body');
  return documentRef;
}

function loadRuntime() {
  const documentRef = createFakeDocument();
  const context = vm.createContext({
    window: {},
    document: documentRef,
    console,
    performance: { now: () => 0 },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout,
    clearTimeout,
    Float32Array,
    Float64Array,
    Uint8Array,
    ArrayBuffer
  });
  const baseSource = fs.readFileSync(new URL('../../plugins/plugin-base.js', import.meta.url), 'utf8');
  vm.runInContext(baseSource, context, { filename: 'plugin-base.js' });
  for (const [fileName] of pluginFiles) {
    const source = fs.readFileSync(new URL(`../../plugins/modulation/${fileName}`, import.meta.url), 'utf8');
    vm.runInContext(source, context, { filename: fileName });
  }
  context.documentRef = documentRef;
  return context;
}

function logarithmicPosition(value, minimum, maximum) {
  return (Math.log10(value) - Math.log10(minimum)) /
    (Math.log10(maximum) - Math.log10(minimum)) * 100;
}

function expectedFill(range) {
  return `${((Number(range.value) - Number(range.min)) /
    (Number(range.max) - Number(range.min))) * 100}%`;
}

test('Style changes refresh linear and logarithmic slider fills across modulation plugins', () => {
  const runtime = loadRuntime();
  const originalDocument = globalThis.document;
  globalThis.document = runtime.documentRef;
  const uiManager = Object.create(UIManager.prototype);
  uiManager.initRangeFillStyling();

  try {
    const scenarios = [
      ['AutoPanPlugin', 'Fast Auto Pan', 'dp', 'rt'],
      ['AutoFilterPlugin', 'Reverse Auto Wah', 'rs', 'lf'],
      ['ChorusPlugin', 'Vibrato', 'mx', 'rt'],
      ['FrequencyShifterPlugin', 'Barber-pole Down', 'mix', 'rt'],
      ['PhaserPlugin', 'Deep Phaser', 'mx', 'cf'],
      ['RotarySpeakerPlugin', 'Leslie Fast', 'mx', 'xo', { mx: 50, xo: 1200 }]
    ];

    for (const [className, styleName, linearKey, logarithmicKey, initialParameters] of scenarios) {
      const plugin = new runtime.window[className]();
      const container = plugin.createUI();
      runtime.documentRef.body.appendChild(container);
      if (initialParameters) plugin.setParameters(initialParameters);
      uiManager.refreshRangeFillStyling(container);
      const before = new Map([linearKey, logarithmicKey].map(key => {
        const range = plugin._uiControls[key].querySelector('input[type="range"]');
        return [key, range.style['--et-range-fill']];
      }));
      const styleSelect = plugin._uiControls.style.querySelector('select');
      styleSelect.value = styleName;
      styleSelect.dispatch('change');

      for (const key of [linearKey, logarithmicKey]) {
        const range = plugin._uiControls[key].querySelector('input[type="range"]');
        assert.notEqual(range.style['--et-range-fill'], before.get(key), `${className} ${key} changes`);
        assert.equal(range.style['--et-range-fill'], expectedFill(range), `${className} ${key}`);
      }
    }
  } finally {
    uiManager._disposeRangePrecisionControl?.();
    globalThis.document = originalDocument;
  }
});

test('Auto Filter logarithmic inputs retain canonical DOM values when bounds cross', () => {
  const runtime = loadRuntime();
  const originalDocument = globalThis.document;
  globalThis.document = runtime.documentRef;
  const uiManager = Object.create(UIManager.prototype);
  uiManager.initRangeFillStyling();
  const plugin = new runtime.window.AutoFilterPlugin();
  plugin.id = 'auto-filter-host-contract';
  runtime.documentRef.body.appendChild(plugin.createUI());

  try {
    const initialUpper = plugin.hf;
    const minimumRow = plugin._uiControls.lf;
    const minimumSlider = minimumRow.querySelector('input[type="range"]');
    const minimumNumber = minimumRow.querySelector('input[type="number"]');
    minimumSlider.value = String(logarithmicPosition(16000, 20, 20000));
    minimumSlider.dispatch('input');

    assert.equal(plugin.lf, initialUpper);
    assert.ok(Math.abs(plugin.hf - 16000) < 1e-8);
    assert.equal(Number(minimumNumber.value), plugin.lf);
    assert.ok(Math.abs(Number(minimumSlider.value) - logarithmicPosition(plugin.lf, 20, 20000)) < 1e-8);
    assert.equal(minimumSlider.style['--et-range-fill'], expectedFill(minimumSlider));
    const maximumRow = plugin._uiControls.hf;
    const maximumSlider = maximumRow.querySelector('input[type="range"]');
    assert.equal(maximumSlider.style['--et-range-fill'], expectedFill(maximumSlider));

    plugin.setParameters({ lf: 1200, hf: 8000 });
    const maximumNumber = maximumRow.querySelector('input[type="number"]');
    maximumNumber.value = '100';
    maximumNumber.dispatch('input');

    assert.equal(plugin.lf, 100);
    assert.equal(plugin.hf, 1200);
    assert.equal(Number(maximumNumber.value), plugin.hf);
    assert.ok(Math.abs(Number(maximumSlider.value) - logarithmicPosition(plugin.hf, 20, 20000)) < 1e-8);
    assert.equal(minimumSlider.style['--et-range-fill'], expectedFill(minimumSlider));
    assert.equal(maximumSlider.style['--et-range-fill'], expectedFill(maximumSlider));
  } finally {
    uiManager._disposeRangePrecisionControl?.();
    globalThis.document = originalDocument;
  }
});

test('modulation plugins restore host routing and effect parameters through serialized state', () => {
  const runtime = loadRuntime();

  for (const [, className, effectParameters] of pluginFiles) {
    const Plugin = runtime.window[className];
    const source = new Plugin();
    const hostId = `${className}-host-id`;
    source.id = hostId;
    source.setParameters({
      ...effectParameters,
      enabled: false,
      inputBus: 2,
      outputBus: 1,
      channel: '34'
    });
    const { enabled, ...serialized } = source.getSerializableParameters();

    const restored = new Plugin();
    restored.id = hostId;
    const channelChanges = [];
    const originalChannelHook = restored.onChannelSelectionChanged?.bind(restored);
    restored.onChannelSelectionChanged = (previous, current) => {
      channelChanges.push([previous, current]);
      originalChannelHook?.(previous, current);
    };
    restored.setSerializedParameters({ ...serialized, id: hostId, en: enabled });

    assert.equal(restored.id, hostId, `${className} preserves its host identity`);
    assert.equal(restored.enabled, false, `${className} restores enabled`);
    assert.equal(restored.inputBus, 2, `${className} restores inputBus`);
    assert.equal(restored.outputBus, 1, `${className} restores outputBus`);
    assert.equal(restored.channel, '34', `${className} restores channel`);
    assert.deepEqual(channelChanges, [[null, '34']], `${className} calls the channel hook once`);
    restored.updateParameters();
    assert.deepEqual(channelChanges, [[null, '34']], `${className} does not repeat the channel hook`);
    for (const [key, value] of Object.entries(effectParameters)) {
      assert.equal(restored[key], value, `${className} restores ${key}`);
    }
  }
});

test('costly modulation plugins declare the shared JavaScript fallback capacity', () => {
  const runtime = loadRuntime();
  const limitedPluginTypes = [
    'AutoFilterPlugin',
    'ChorusPlugin',
    'FrequencyShifterPlugin',
    'PhaserPlugin',
    'RotarySpeakerPlugin'
  ];

  for (const className of limitedPluginTypes) {
    assert.equal(
      runtime.window[className].executionCapabilities.jsFallbackCapacity
        .maxJsFallbackSampleChannels,
      96000,
      className
    );
  }
  assert.equal(runtime.window.AutoPanPlugin.executionCapabilities, undefined);
});
