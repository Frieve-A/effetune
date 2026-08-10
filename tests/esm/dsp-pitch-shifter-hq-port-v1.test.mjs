import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { SHIPPED_ENABLED_TYPES } from '../../js/audio/dsp-rollout.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadPlugin() {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'modulation', 'pitch_shifter_hq.js'), 'utf8');
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = 'pitch-shifter-hq-test';
    }
    registerProcessor(processor) { this.processor = processor; }
    parseFiniteNumber(value, minimum, maximum, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return number < minimum ? minimum : (number > maximum ? maximum : number);
    }
    updateParameters() { this.updateCount = (this.updateCount || 0) + 1; }
    createParameterControl(label, minimum, maximum, step, value, onChange, unit) {
      return { label, minimum, maximum, step, value, onChange, unit };
    }
  }
  const document = {
    createElement(tagName) {
      return {
        tagName,
        children: [],
        hidden: false,
        textContent: '',
        attributes: {},
        appendChild(child) { this.children.push(child); },
        setAttribute(name, value) { this.attributes[name] = value; }
      };
    }
  };
  const context = { PluginBase, document, window: {} };
  vm.runInNewContext(source, context, { filename: 'pitch_shifter_hq.js' });
  return context.window.PitchShifterHQPlugin;
}

test('Pitch Shifter HQ exposes a WASM-only reset-on-resume contract', async () => {
  const Plugin = await loadPlugin();
  assert.equal(Plugin.executionCapabilities.requiresWasm, true);
  assert.deepEqual(Array.from(Plugin.executionCapabilities.supportedSampleRates), [
    44100, 48000, 88200, 96000, 176400, 192000
  ]);
  assert.equal(Object.isFrozen(Plugin.executionCapabilities.supportedSampleRates), true);
  assert.equal('supportedChannelModes' in Plugin.executionCapabilities, false);
  assert.equal(Object.isFrozen(Plugin.executionCapabilities), true);

  const plugin = new Plugin();
  assert.equal(plugin.processor, 'return data;');
  assert.equal(plugin.getTemporalCapability(), 'reset-on-resume');
});

test('Pitch Shifter HQ keeps a compact validated parameter ABI', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())), {
    type: 'PitchShifterHQPlugin', ps: 0, ft: 0, enabled: true
  });

  plugin.setParameters({ ps: -99, ft: 25.6, enabled: false });
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())), {
    type: 'PitchShifterHQPlugin', ps: -6, ft: 26, enabled: false
  });
  plugin.setParameters({ ps: 2.5, ft: Number.NaN, enabled: true });
  assert.equal(plugin.ps, 3);
  assert.equal(plugin.ft, 26);
  assert.equal(plugin.enabled, true);

  const restored = new Plugin();
  restored.setParameters(JSON.parse(JSON.stringify(plugin.getParameters())));
  assert.deepEqual(JSON.parse(JSON.stringify(restored.getParameters())),
    JSON.parse(JSON.stringify(plugin.getParameters())));
});

test('Pitch Shifter HQ JS fallback is sample-exact pass-through', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const run = new Function('data', 'parameters', plugin.processor);
  const audio = new Float32Array([0.25, -0.5, Number.NaN, 0.75]);
  const result = run(audio, { enabled: true });
  assert.equal(result, audio);
  assert.equal(Number.isNaN(result[2]), true);
});

test('Pitch Shifter HQ is shipped immediately after the standard shifter', () => {
  const standardIndex = SHIPPED_ENABLED_TYPES.indexOf('PitchShifterPlugin');
  assert.notEqual(standardIndex, -1);
  assert.equal(SHIPPED_ENABLED_TYPES[standardIndex + 1], 'PitchShifterHQPlugin');
});

test('Pitch Shifter HQ uses the standard two-control UI and validated status messages', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const ui = plugin.createUI();
  assert.equal(ui.className, 'pitch-shifter-hq-plugin-ui plugin-parameter-ui');
  assert.deepEqual(ui.children.slice(0, 2).map(control => ({
    label: control.label,
    minimum: control.minimum,
    maximum: control.maximum,
    step: control.step,
    value: control.value,
    unit: control.unit
  })), [
    { label: 'Pitch Shift', minimum: -6, maximum: 6, step: 1, value: 0, unit: 'semitones' },
    { label: 'Fine Tune', minimum: -50, maximum: 50, step: 1, value: 0, unit: 'cents' }
  ]);

  const status = ui.children[2];
  assert.equal(status.hidden, true);
  plugin.onMessage({
    type: 'dspExecutionState', pluginId: plugin.id,
    pluginType: 'PitchShifterHQPlugin', state: 'bypassed', reason: 'wasmUnavailable'
  });
  assert.equal(status.hidden, true);
  plugin.onMessage({
    type: 'dspExecutionState', pluginId: 'another-plugin',
    pluginType: 'PitchShifterHQPlugin', state: 'bypassed', reason: 'wasmUnavailable',
    validated: true
  });
  plugin.onMessage({
    type: 'dspExecutionState', pluginId: plugin.id,
    pluginType: 'PitchShifterPlugin', state: 'bypassed', reason: 'wasmUnavailable',
    validated: true
  });
  assert.equal(status.hidden, true);
  plugin.onMessage({
    type: 'dspExecutionState', pluginId: plugin.id,
    pluginType: 'PitchShifterHQPlugin', state: 'bypassed', reason: 'wasmUnavailable',
    validated: true
  });
  assert.equal(status.hidden, false);
  assert.equal(status.textContent,
    'High-quality audio processing is unavailable. Pitch Shifter HQ is bypassed. Audio remains unchanged.');
  plugin.onMessage({
    type: 'dspExecutionState', pluginId: plugin.id,
    pluginType: 'PitchShifterHQPlugin', state: 'active', validated: true
  });
  assert.equal(status.hidden, true);
  assert.equal(status.textContent, '');
});

test('Pitch Shifter HQ presents user-safe messages for known bypass reasons', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const status = plugin.createUI().children[2];
  const reasons = [
    ['unsupportedSampleRate', 'This sample rate is not supported.'],
    ['unsupportedChannelMode', 'This channel setting is not supported.'],
    ['wasmUnavailable', 'High-quality audio processing is unavailable.'],
    ['rolloutDisabled', 'High-quality audio processing is disabled.'],
    ['runtimeFallback', 'Audio processing was interrupted.'],
    ['engineStopped', 'Audio processing has stopped.']
  ];

  for (const [reason, explanation] of reasons) {
    plugin.onMessage({
      type: 'dspExecutionState', pluginId: plugin.id,
      pluginType: 'PitchShifterHQPlugin', state: 'bypassed', reason,
      validated: true
    });
    assert.equal(status.hidden, false);
    assert.equal(status.textContent,
      `${explanation} Pitch Shifter HQ is bypassed. Audio remains unchanged.`);
    assert.equal(status.textContent.includes(reason), false);
  }
});
