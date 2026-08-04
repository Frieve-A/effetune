import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadPlugin() {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'mp3_codec_simulator.js'), 'utf8');
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = 'mp3-test';
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
  vm.runInNewContext(source, context, { filename: 'mp3_codec_simulator.js' });
  return context.window.MP3CodecSimulatorPlugin;
}

test('MP3 Codec Simulator exposes the production-WASM execution contract', async () => {
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

test('MP3 Codec Simulator keeps MPEG profile bitrate limits and supports 320 kbit/s', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin.setParameters({ br: '192' });
  assert.equal(plugin.br, '192');
  plugin.setParameters({ br: '320' });
  assert.equal(plugin.br, '320');
  plugin.setParameters({ cr: '22.05 kHz (MPEG-2)' });
  assert.equal(plugin.br, '160');
  plugin.setParameters({ br: '320' });
  assert.equal(plugin.br, '160');
  plugin.setParameters({ cr: '44.1 kHz (MPEG-1)', br: '256' });
  assert.equal(plugin.br, '256');
  plugin.setParameters({ cr: '44.1 kHz (MPEG-1)', br: '320' });
  assert.equal(plugin.br, '320');
});

test('MP3 Codec Simulator sanitizes public values without changing its ABI keys', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin.setParameters({ og: 99, mx: -12, sm: 'invalid', rv: false });
  assert.deepEqual(Object.keys(plugin.getParameters()), [
    'type', 'cr', 'br', 'sm', 'rv', 'og', 'mx', 'enabled'
  ]);
  assert.equal(plugin.og, 12);
  assert.equal(plugin.mx, 0);
  assert.equal(plugin.sm, 'Joint Stereo');
  assert.equal(plugin.rv, false);
});
