import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RESTORATION_PLUGINS = [
  {
    file: path.join('plugins', 'restoration', 'click_remover.js'),
    globalName: 'ClickRemoverPlugin',
    frameType: 21,
    parameters: { sn: 50, ml: 1 },
    invalidParameters: { sn: 200, ml: -1 },
    clampedParameters: { sn: 100, ml: 0.1 },
    telemetry(values) {
      values.setFloat32(0, 12.5, true);
    },
    telemetryAssertion(plugin) {
      assert.equal(plugin.repairsPerSecond, 12.5);
      assert.ok(plugin._telemetryHudCanvas.hudText.includes('REPAIRS/S'));
      assert.ok(plugin._telemetryHudCanvas.hudText.includes('12.5'));
    }
  },
  {
    file: path.join('plugins', 'restoration', 'clip_restorer.js'),
    globalName: 'ClipRestorerPlugin',
    frameType: 22,
    parameters: { th: -0.1, og: -3 },
    invalidParameters: { th: -19, og: 1 },
    clampedParameters: { th: -18, og: 0 },
    telemetry(values) {
      values.setFloat32(0, 3.25, true);
    },
    telemetryAssertion(plugin) {
      assert.equal(plugin.restoredPercent, 3.25);
      assert.ok(plugin._telemetryHudCanvas.hudText.includes('RESTORED'));
      assert.ok(plugin._telemetryHudCanvas.hudText.includes('3.25%'));
    }
  },
  {
    file: path.join('plugins', 'restoration', 'hum_remover.js'),
    globalName: 'HumRemoverPlugin',
    frameType: 23,
    parameters: { fm: 'Auto', hc: 8, sp: 50 },
    invalidParameters: { fm: 'invalid', hc: 80, sp: -1 },
    clampedParameters: { fm: 'Auto', hc: 64, sp: 0 },
    telemetry(values) {
      values.setFloat32(0, 59.875, true);
      values.setFloat32(4, -26.5, true);
    },
    telemetryAssertion(plugin) {
      assert.equal(plugin.fundamental, 59.875);
      assert.equal(plugin.removed, -26.5);
      assert.ok(plugin._telemetryHudCanvas.hudText.includes('FUNDAMENTAL'));
      assert.ok(plugin._telemetryHudCanvas.hudText.includes('59.88 Hz'));
      assert.ok(plugin._telemetryHudCanvas.hudText.includes('REMOVED'));
      assert.ok(plugin._telemetryHudCanvas.hudText.includes('-26.5 dBFS'));
    }
  }
];

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.attributes = new Map();
    this.dataset = {};
    this.eventListeners = new Map();
    this.id = '';
    this.name = '';
    this.type = '';
    this.value = '';
    this.min = '';
    this.max = '';
    this.step = '';
    this.autocomplete = '';
    this.htmlFor = '';
    this.style = { setProperty(name, value) { this[name] = value; } };
    if (this.tagName === 'CANVAS') {
      this.width = 400;
      this.height = 80;
      this.clientWidth = 400;
      this.hudText = [];
      this.getBoundingClientRect = () => ({ width: 400, height: 80 });
      this.getContext = () => ({
        clearRect() {},
        fillRect() {},
        strokeRect() {},
        fillText: text => this.hudText.push(String(text))
      });
    }
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, []);
    this.eventListeners.get(type).push(listener);
  }

  dispatch(type, event = {}) {
    const eventObject = {
      target: this,
      key: '',
      preventDefault() {},
      ...event
    };
    for (const listener of this.eventListeners.get(type) || []) listener(eventObject);
  }
}

function createPluginBase(documentRef) {
  return class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
    }

    _setupMessageHandler() {
      this.messageHandlerSetup = true;
    }

    registerProcessor(processor) {
      this.processor = processor;
    }

    parseFiniteNumber(value, minimum, maximum, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return number < minimum ? minimum : (number > maximum ? maximum : number);
    }

    isAllowedEnum(value, values, fallback) {
      return values.includes(value) ? value : fallback;
    }

    updateParameters() {
      this.updateCount = (this.updateCount || 0) + 1;
    }

    createParameterControl(label, minimum, maximum, step, value, onChange, unit, key) {
      return { label, minimum, maximum, step, value, onChange, unit, key };
    }

    createLogarithmicParameterControl(
      label, minimum, maximum, step, value, onChange, unit, key
    ) {
      const row = documentRef.createElement('div');
      const labelElement = documentRef.createElement('label');
      const slider = documentRef.createElement('input');
      const valueInput = documentRef.createElement('input');
      const logMinimum = Math.log10(minimum);
      const logRange = Math.log10(maximum) - logMinimum;
      const toPosition = linearValue =>
        (Math.log10(linearValue) - logMinimum) / logRange * 100;
      const toValue = position => 10 ** (logMinimum + position / 100 * logRange);
      const sliderId = `${this.id}-${this.name}-${label.toLowerCase()}-slider`;

      labelElement.textContent = `${label}:`;
      labelElement.htmlFor = sliderId;
      slider.type = 'range';
      slider.id = sliderId;
      slider.min = 0;
      slider.max = 100;
      slider.step = 0.1;
      slider.value = toPosition(value);
      slider.dataset.rangeFineTarget = `${sliderId}-value`;
      slider.dataset.rangeFineMin = String(minimum);
      slider.dataset.rangeFineMax = String(maximum);
      slider.dataset.rangeFineStep = String(step);
      valueInput.type = 'number';
      valueInput.id = slider.dataset.rangeFineTarget;
      valueInput.min = minimum;
      valueInput.max = maximum;
      valueInput.step = step;
      valueInput.value = value;
      slider.addEventListener('input', event => {
        const linearValue = toValue(Number(event.target.value));
        valueInput.value = linearValue.toFixed(0);
        onChange(linearValue);
      });
      const applyNumber = () => {
        const parsed = Number(valueInput.value);
        const clamped = Math.max(minimum, Math.min(maximum,
          Number.isFinite(parsed) ? parsed : minimum));
        valueInput.value = clamped.toFixed(0);
        slider.value = toPosition(clamped);
        onChange(clamped);
      };
      valueInput.addEventListener('input', applyNumber);
      valueInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          applyNumber();
          event.preventDefault();
        }
      });
      row.logarithmicControl = { label, minimum, maximum, step, unit, key, toPosition, toValue };
      row.appendChild(labelElement);
      row.appendChild(slider);
      row.appendChild(valueInput);
      return row;
    }

    createRadioGroup(label, values, value, onChange, key) {
      return { label, values, value, onChange, key };
    }

    createResponsiveGraph({ aspectRatio, mobileAspectRatio, className, onResize }) {
      const container = documentRef.createElement('div');
      container.className = `graph-container responsive-graph-container ${className}`;
      container.aspectRatio = aspectRatio;
      container.mobileAspectRatio = mobileAspectRatio;
      const canvas = documentRef.createElement('canvas');
      container.appendChild(canvas);
      return {
        container,
        canvas,
        resize: () => onResize?.(),
        dispose: () => { container.disposed = true; }
      };
    }

    cleanup() {
      this.cleanedUp = true;
    }
  };
}

async function loadPlugin(definition, telemetryHub = null) {
  const source = await fs.readFile(path.join(repoRoot, definition.file), 'utf8');
  const window = { dspTelemetryHub: telemetryHub };
  const document = { createElement: tagName => new FakeElement(tagName) };
  const context = vm.createContext({
    PluginBase: createPluginBase(document),
    document,
    window
  });
  vm.runInContext(source, context, { filename: definition.file });
  const Plugin = window[definition.globalName];
  assert.equal(typeof Plugin, 'function');
  return new Plugin();
}

test('Restoration telemetry HUD has the shared AM-style enclosure', async () => {
  const stylesheet = await fs.readFile(path.join(repoRoot, 'effetune.css'), 'utf8');
  const rule = stylesheet.match(/\.restoration-telemetry-hud\s*\{([\s\S]*?)\}/);
  assert.ok(rule, 'Restoration telemetry HUD rule must exist');
  for (const declaration of [
    'min-height: 64px',
    'margin-top: 8px',
    'overflow: hidden',
    'border: 1px solid #454545',
    'border-radius: 4px',
    'background: #171717'
  ]) {
    assert.match(rule[1], new RegExp(declaration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Restoration WASM plugins expose their parameter and execution contracts', async () => {
  for (const definition of RESTORATION_PLUGINS) {
    const plugin = await loadPlugin(definition);
    assert.equal(plugin.processor, 'return data;', definition.globalName);
    assert.equal(plugin.constructor.executionCapabilities.requiresWasm, true);
    assert.equal(
      Object.hasOwn(plugin.constructor.executionCapabilities, 'supportedChannelModes'), false
    );
    assert.equal(plugin.temporalCapability, 'reset-on-resume');
    assert.deepEqual(
      JSON.parse(JSON.stringify(plugin.getParameters())),
      { type: definition.globalName, ...definition.parameters, enabled: true }
    );

    plugin.setParameters(definition.invalidParameters);
    for (const [key, expected] of Object.entries(definition.clampedParameters)) {
      assert.equal(plugin.getParameters()[key], expected, `${definition.globalName} ${key}`);
    }
  }
});

test('Hum Remover Harmonics uses a logarithmic slider while storing integer values', async () => {
  const definition = RESTORATION_PLUGINS.find(item => item.globalName === 'HumRemoverPlugin');
  const plugin = await loadPlugin(definition);
  plugin.id = 23;
  const ui = plugin.createUI();
  const row = ui.children[1];
  const [label, slider, valueInput] = row.children;

  assert.deepEqual(
    {
      minimum: row.logarithmicControl.minimum,
      maximum: row.logarithmicControl.maximum,
      step: row.logarithmicControl.step,
      key: row.logarithmicControl.key
    },
    { minimum: 1, maximum: 64, step: 1, key: 'hc' }
  );
  assert.equal(slider.type, 'range');
  assert.equal(label.htmlFor, slider.id);
  assert.equal(slider.dataset.rangeFineMin, '1');
  assert.equal(slider.dataset.rangeFineMax, '64');
  assert.equal(slider.dataset.rangeFineStep, '1');

  const observed = [];
  for (const position of [0, 25, 50, 75, 100]) {
    slider.value = String(position);
    slider.dispatch('input');
    observed.push(plugin.getParameters().hc);
  }
  assert.deepEqual(observed, [1, 3, 8, 23, 64]);
  assert.ok(observed.every(Number.isInteger));
  assert.equal(row.logarithmicControl.toPosition(1), 0);
  assert.equal(row.logarithmicControl.toPosition(8), 50);
  assert.equal(row.logarithmicControl.toPosition(64), 100);

  valueInput.value = '16';
  valueInput.dispatch('keydown', { key: 'Enter' });
  assert.equal(plugin.getParameters().hc, 16);
  assert.ok(Math.abs(Number(slider.value) - 2 / 3 * 100) < 1e-9);
  assert.equal(plugin.getParameters().hc, Math.round(plugin.getParameters().hc));
});

test('Restoration WASM plugins subscribe to, render, and release DSP telemetry', async () => {
  for (const definition of RESTORATION_PLUGINS) {
    let subscription = null;
    let unsubscribeCount = 0;
    const hub = {
      subscribe(tapId, frameType, handler) {
        subscription = { tapId, frameType, handler };
        return () => { unsubscribeCount += 1; };
      }
    };
    const plugin = await loadPlugin(definition, hub);
    plugin.id = 17;
    const ui = plugin.createUI();
    const hud = ui.children.at(-1);
    assert.match(hud.className, /responsive-graph-container/);
    assert.match(hud.className, /restoration-telemetry-hud/);
    assert.equal(hud.aspectRatio, '16 / 1');
    assert.equal(hud.mobileAspectRatio, '3 / 1');
    plugin._setupMessageHandler();
    assert.deepEqual({ tapId: subscription.tapId, frameType: subscription.frameType }, {
      tapId: 17, frameType: definition.frameType
    });

    const bytes = definition.frameType === 23 ? 8 : 4;
    const payload = new DataView(new ArrayBuffer(bytes));
    definition.telemetry(payload);
    subscription.handler({ frameType: definition.frameType, formatVersion: 1, payload });
    definition.telemetryAssertion(plugin);

    plugin.onMessage({
      type: 'dspExecutionState',
      pluginId: 17,
      pluginType: definition.globalName,
      validated: true,
      state: 'bypassed',
      reason: 'wasmUnavailable'
    });
    assert.match(plugin._statusElement.textContent, /WASM audio processing is unavailable/);
    assert.equal(plugin._statusElement.hidden, false);
    assert.ok(ui.children.length >= 4);

    plugin.cleanup();
    assert.equal(unsubscribeCount, 1);
    assert.equal(hud.disposed, true);
    assert.equal(plugin.cleanedUp, true);
  }
});
