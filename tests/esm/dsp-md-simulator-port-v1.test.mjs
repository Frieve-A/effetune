import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadPlugin() {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'md_simulator.js'), 'utf8');
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = 'md-test';
    }
    registerProcessor(processor) { this.processor = processor; }
    isAllowedEnum(value, values, fallback) { return values.includes(value) ? value : fallback; }
    parseFiniteNumber(value, minimum, maximum, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return number < minimum ? minimum : (number > maximum ? maximum : number);
    }
    updateParameters() {}
  }
  const context = { PluginBase, window: {} };
  vm.runInNewContext(source, context, { filename: 'md_simulator.js' });
  return context.window.MDSimulatorPlugin;
}

test('MD Simulator exposes the production-WASM execution contract', async () => {
  const Plugin = await loadPlugin();
  assert.equal(Plugin.executionCapabilities.requiresWasm, true);
  assert.deepEqual(Array.from(Plugin.executionCapabilities.supportedSampleRates), [
    44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000
  ]);
  assert.deepEqual(Array.from(Plugin.executionCapabilities.supportedChannelModes), [
    'mono', 'stereo-pair'
  ]);
  const plugin = new Plugin();
  assert.equal(plugin.processor, 'return data;');
  assert.equal(plugin.getTemporalCapability(), 'reset-on-resume');
});

test('MD Simulator offers exactly the three MiniDisc recording modes', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  assert.equal(plugin.md, 'SP (292 kbps)');
  plugin.setParameters({ md: 'LP2 (132 kbps)' });
  assert.equal(plugin.md, 'LP2 (132 kbps)');
  plugin.setParameters({ md: 'LP4 (66 kbps)' });
  assert.equal(plugin.md, 'LP4 (66 kbps)');
  plugin.setParameters({ md: 'LP8 (33 kbps)' });
  assert.equal(plugin.md, 'LP4 (66 kbps)');
});

test('MD Simulator sanitizes public values without changing its ABI keys', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin.setParameters({ og: 99, mx: -12 });
  assert.deepEqual(Object.keys(plugin.getParameters()), [
    'type', 'md', 'og', 'mx', 'enabled'
  ]);
  assert.equal(plugin.og, 12);
  assert.equal(plugin.mx, 0);
  plugin.setParameters({ og: 'not a number', mx: 55.4 });
  assert.equal(plugin.og, 12);
  assert.equal(plugin.mx, 55);
});

test('MD Simulator parameter keys match the packed DSP schema', async () => {
  const schema = JSON.parse(await fs.readFile(
    path.join(repoRoot, 'dsp', 'plugins', 'lofi', 'md_simulator', 'params.json'), 'utf8'));
  assert.equal(schema.type, 'MDSimulatorPlugin');
  assert.deepEqual(schema.fields.map(field => field.key), ['md', 'og', 'mx']);
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const published = Object.keys(plugin.getParameters())
    .filter(key => key !== 'type' && key !== 'enabled');
  assert.deepEqual(published, schema.fields.map(field => field.key));
  const mode = schema.fields.find(field => field.key === 'md');
  assert.deepEqual(mode.values, ['SP (292 kbps)', 'LP2 (132 kbps)', 'LP4 (66 kbps)']);
  assert.equal(plugin.md, mode.default);
});
