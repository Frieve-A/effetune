import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadPlugin() {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'g726_adpcm_simulator.js'), 'utf8');
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = 'g726-test';
    }
    registerProcessor(processor) { this.processor = processor; }
    isAllowedEnum(value, values, fallback) { return values.includes(value) ? value : fallback; }
    parseFiniteNumber(value, minimum, maximum, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return number < minimum ? minimum : (number > maximum ? maximum : number);
    }
    updateParameters() { this.updateCount = (this.updateCount || 0) + 1; }
  }
  const context = { PluginBase, window: {} };
  vm.runInNewContext(source, context, { filename: 'g726_adpcm_simulator.js' });
  return context.window.G726ADPCMSimulatorPlugin;
}

test('G.726 Simulator exposes a WASM-only reset-on-resume contract', async () => {
  const Plugin = await loadPlugin();
  assert.equal(Plugin.executionCapabilities.requiresWasm, true);
  assert.deepEqual(Array.from(Plugin.executionCapabilities.supportedSampleRates), [
    44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000
  ]);
  assert.deepEqual(Array.from(Plugin.executionCapabilities.supportedChannelModes), [
    'mono', 'stereo-pair'
  ]);
  assert.equal(Object.isFrozen(Plugin.executionCapabilities), true);

  const plugin = new Plugin();
  assert.equal(plugin.processor, 'return data;');
  assert.equal(plugin.getTemporalCapability(), 'reset-on-resume');
});

test('G.726 Simulator keeps its compact parameter ABI and validates values', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())), {
    type: 'G726ADPCMSimulatorPlugin', br: '32', og: 0, mx: 100, re: -6, enabled: true
  });

  plugin.setParameters({ br: 16, og: -99, mx: 140, re: -3.44, enabled: false });
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())), {
    type: 'G726ADPCMSimulatorPlugin', br: '16', og: -24, mx: 100, re: -3.4, enabled: false
  });
  plugin.setParameters({ br: 'not-a-rate', og: Number.NaN, mx: -1, re: -9 });
  assert.equal(plugin.br, '16');
  assert.equal(plugin.og, -24);
  assert.equal(plugin.mx, 0);
  assert.equal(plugin.re, -6);
  plugin.setParameters({ re: Number.NaN });
  assert.equal(plugin.re, -6);
  plugin.setParameters({ re: 0 });
  assert.equal(plugin.re, -2);
});

test('G.726 Simulator JS fallback is sample-exact pass-through', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const run = new Function('data', 'parameters', plugin.processor);
  const audio = new Float32Array([0.25, -0.5, Number.NaN, 0.75]);
  const result = run(audio, { enabled: true });
  assert.equal(result, audio);
  assert.equal(Number.isNaN(result[2]), true);
});

test('G.726 Simulator ignores unvalidated execution messages', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin.onMessage({
    type: 'dspExecutionState', pluginId: plugin.id,
    pluginType: 'G726ADPCMSimulatorPlugin', state: 'active'
  });
  assert.equal(plugin.executionState.state, 'pending');
  plugin.onMessage({
    type: 'dspExecutionState', pluginId: plugin.id,
    pluginType: 'G726ADPCMSimulatorPlugin', state: 'bypassed',
    reason: 'wasmUnavailable', validated: true
  });
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.executionState)), {
    state: 'bypassed', reason: 'wasmUnavailable'
  });
});
