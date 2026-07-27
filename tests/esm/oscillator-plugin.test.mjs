import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.disabled = false;
    this.checked = false;
    this.value = '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type) {
    this.listeners.get(type)?.({ target: this });
  }
}

function findById(element, id) {
  if (element.id === id) return element;
  for (const child of element.children ?? []) {
    const match = findById(child, id);
    if (match) return match;
  }
  return null;
}

async function loadOscillator() {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'others', 'oscillator.js'),
    'utf8'
  );

  class PluginBase {
    constructor(name) {
      this.id = 'osc-test';
      this.name = name;
      this.enabled = true;
      this.updateCount = 0;
    }

    registerProcessor(processor) {
      this.processor = processor;
    }

    updateParameters() {
      this.updateCount += 1;
    }

    parseFiniteNumber(value, minimum, maximum, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      if (number < minimum) return minimum;
      return number > maximum ? maximum : number;
    }

    isAllowedEnum(value, allowed, fallback) {
      return allowed.includes(value) ? value : fallback;
    }

    createParameterControl() {
      return new FakeElement('div');
    }
  }

  const document = {
    createElement: tagName => new FakeElement(tagName),
    createTextNode: textContent => ({ textContent })
  };
  const context = vm.createContext({ PluginBase, document, window: {} });
  vm.runInContext(`${source}\nthis.OscillatorPluginRef = OscillatorPlugin;`, context, {
    filename: 'oscillator.js'
  });
  return context.OscillatorPluginRef;
}

test('Oscillator keeps Impulse in pulsed mode', async () => {
  const OscillatorPlugin = await loadOscillator();
  const plugin = new OscillatorPlugin();

  plugin.setWaveform('impulse');
  assert.equal(plugin.wf, 'impulse');
  assert.equal(plugin.md, 'pulsed');

  plugin.setMode('continuous');
  assert.equal(plugin.md, 'pulsed');

  plugin.setWaveform('sine');
  plugin.setMode('continuous');
  assert.equal(plugin.md, 'continuous');
});

test('Oscillator disables controls that do not apply to Impulse', async () => {
  const OscillatorPlugin = await loadOscillator();
  const plugin = new OscillatorPlugin();
  const ui = plugin.createUI();
  const control = suffix => findById(ui, `osc-test-Oscillator-${suffix}`);

  const waveform = control('waveform');
  waveform.value = 'impulse';
  waveform.dispatch('change');

  assert.equal(control('frequency-slider').disabled, true);
  assert.equal(control('frequency-value').disabled, true);
  assert.equal(control('mode-continuous').disabled, true);
  assert.equal(control('mode-continuous').checked, false);
  assert.equal(control('mode-pulsed').checked, true);
  assert.equal(control('interval-slider').disabled, false);
  assert.equal(control('interval-value').disabled, false);
  assert.equal(control('width-slider').disabled, true);
  assert.equal(control('width-value').disabled, true);
});
