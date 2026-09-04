import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginPath = path.join(repoRoot, 'plugins', 'restoration', 'noise_reduction.js');

async function loadPlugin() {
  const source = await fs.readFile(pluginPath, 'utf8');
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
    }
    registerProcessor(processor) { this.processor = processor; }
    parseFiniteNumber(value, minimum, maximum, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return number < minimum ? minimum : (number > maximum ? maximum : number);
    }
    updateParameters() { this.updateCount = (this.updateCount || 0) + 1; }
    createParameterControl(label, minimum, maximum, step, value, onChange, unit, key) {
      return { label, minimum, maximum, step, value, onChange, unit, key };
    }
    cleanup() { this.cleanedUp = true; }
  }
  const document = {
    createElement() {
      return {
        children: [], className: '',
        appendChild(child) { this.children.push(child); }
      };
    }
  };
  const context = { PluginBase, document, window: {} };
  vm.runInNewContext(source, context, { filename: pluginPath });
  return context.window.NoiseReductionPlugin;
}

test('Noise Reduction validates parameters and individual setters', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin.setParameters({ rd: 99, sn: -99, sm: 101, hf: -1, mix: Number.NaN });
  assert.deepEqual(
    { rd: plugin.rd, sn: plugin.sn, sm: plugin.sm, hf: plugin.hf, mix: plugin.mix },
    { rd: 24, sn: -12, sm: 100, hf: 0, mix: 100 }
  );
  plugin.setRd('invalid');
  plugin.setSn(3.5);
  plugin.setSm(42);
  plugin.setHf(76);
  plugin.setMix(25);
  assert.deepEqual(
    { rd: plugin.rd, sn: plugin.sn, sm: plugin.sm, hf: plugin.hf, mix: plugin.mix },
    { rd: 24, sn: 3.5, sm: 42, hf: 76, mix: 25 }
  );
});

test('Noise Reduction serializes the schema parameter keys', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())), {
    type: 'NoiseReductionPlugin', rd: 12, sn: 0, sm: 50, hf: 50, mix: 100, enabled: true
  });
  const schema = JSON.parse(await fs.readFile(path.join(
    repoRoot, 'dsp', 'plugins', 'restoration', 'noise_reduction', 'params.json'), 'utf8'));
  assert.deepEqual(schema.fields.map(field => field.key), ['rd', 'sn', 'sm', 'hf', 'mix']);
  assert.deepEqual(schema.fields.map(field => field.key),
    Object.keys(plugin.getParameters()).filter(key => !['type', 'enabled'].includes(key)));
  const ui = plugin.createUI();
  assert.deepEqual(ui.children.map(control => control.key), ['rd', 'sn', 'sm', 'hf', 'mix']);
});

test('Noise Reduction keeps JavaScript DSP as the exact pass-through', async () => {
  const Plugin = await loadPlugin();
  assert.equal(new Plugin().processor, 'return data;');
});

test('Noise Reduction requires the WASM implementation', async () => {
  const Plugin = await loadPlugin();
  assert.equal(Plugin.executionCapabilities.requiresWasm, true);
});

test('Noise Reduction is registered in the Restoration category', async () => {
  const source = await fs.readFile(path.join(repoRoot, 'plugins', 'plugins.txt'), 'utf8');
  const Plugin = await loadPlugin();
  assert.match(source, /^Restoration: Audio restoration effects$/m);
  assert.match(source,
    new RegExp(`^restoration/noise_reduction: Noise Reduction \\| Restoration \\| ${Plugin.name}$`, 'm'));
});

test('Noise Reduction is enabled in the shipped DSP rollout', async () => {
  const rollout = await import(`${pathToFileURL(path.join(repoRoot, 'js', 'audio', 'dsp-rollout.js'))}` +
    `?noise-reduction=${Date.now()}`);
  assert.ok(rollout.SHIPPED_ENABLED_TYPES.includes('NoiseReductionPlugin'));
});
