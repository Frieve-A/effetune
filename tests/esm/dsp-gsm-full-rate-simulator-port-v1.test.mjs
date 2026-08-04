import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  GSMFullRateSimulatorPlugin_PARAMS_HASH,
  packGSMFullRateSimulatorPluginParams
} from '../../js/audio/dsp-params.generated.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadPlugin() {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'gsm_full_rate_simulator.js'), 'utf8');
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = 'gsm-test';
    }
    registerProcessor(processor) { this.processor = processor; }
    parseFiniteNumber(value, minimum, maximum, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return number < minimum ? minimum : (number > maximum ? maximum : number);
    }
    updateParameters() { this.updateCount = (this.updateCount || 0) + 1; }
  }
  const context = { PluginBase, window: {} };
  vm.runInNewContext(source, context, { filename: 'gsm_full_rate_simulator.js' });
  return context.window.GSMFullRateSimulatorPlugin;
}

test('GSM-FR Simulator exposes a WASM-only reset-on-resume contract', async () => {
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

test('GSM-FR Simulator keeps its compact integer ABI and validates values', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())), {
    type: 'GSMFullRateSimulatorPlugin', tc: 1, og: 0, mx: 100, ci: 30, enabled: true
  });

  plugin.setParameters({ tc: 2.6, og: -99, mx: 140, ci: 41, enabled: false });
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())), {
    type: 'GSMFullRateSimulatorPlugin', tc: 3, og: -24, mx: 100, ci: 30, enabled: false
  });
  plugin.setParameters({ tc: Number.NaN, og: Number.NaN, mx: -1, ci: Number.NaN });
  assert.equal(plugin.tc, 3);
  assert.equal(plugin.og, -24);
  assert.equal(plugin.mx, 0);
  assert.equal(plugin.ci, 30);
  plugin.setParameters({ ci: 1 });
  assert.equal(plugin.ci, 4);
  plugin.setParameters({ ci: 12.34 });
  assert.equal(plugin.ci, 12.3);

  assert.equal(GSMFullRateSimulatorPlugin_PARAMS_HASH, 0xb9a2741c);
  assert.deepEqual(
    Array.from(packGSMFullRateSimulatorPluginParams(plugin.getParameters())),
    [3, -24, 0, 12.300000190734863]
  );
});

test('GSM-FR Simulator JS fallback is sample-exact pass-through', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const run = new Function('data', 'parameters', plugin.processor);
  const audio = new Float32Array([0.25, -0.5, Number.NaN, 0.75]);
  const result = run(audio, { enabled: true });
  assert.equal(result, audio);
  assert.equal(Number.isNaN(result[2]), true);
});

test('GSM-FR Simulator accepts only validated execution messages', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin.onMessage({
    type: 'dspExecutionState', pluginId: plugin.id,
    pluginType: 'GSMFullRateSimulatorPlugin', state: 'active'
  });
  assert.equal(plugin.executionState.state, 'pending');
  plugin.onMessage({
    type: 'dspExecutionState', pluginId: plugin.id,
    pluginType: 'GSMFullRateSimulatorPlugin', state: 'bypassed',
    reason: 'wasmUnavailable', validated: true
  });
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.executionState)), {
    state: 'bypassed', reason: 'wasmUnavailable'
  });
});
