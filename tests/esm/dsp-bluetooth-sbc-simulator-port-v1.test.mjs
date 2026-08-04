import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadPlugin() {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'bluetooth_sbc_simulator.js'), 'utf8');
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = 'sbc-test';
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
  vm.runInNewContext(source, context, { filename: 'bluetooth_sbc_simulator.js' });
  return context.window.BluetoothSBCSimulatorPlugin;
}

test('SBC Codec Simulator exposes the production-WASM execution contract', async () => {
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

test('SBC Codec Simulator derives exact frame bitrate from the current settings', async () => {
  const Plugin = await loadPlugin();
  assert.equal(Plugin.bitrateForSettings({
    hostSampleRate: 48000,
    bitpool: 35,
    channelMode: 'Joint Stereo',
    blocks: 16
  }), 249000);
  assert.equal(Plugin.bitrateForSettings({
    hostSampleRate: 48000,
    bitpool: 35,
    channelMode: 'Stereo',
    blocks: 16
  }), 246000);
  assert.equal(Plugin.bitrateForSettings({
    hostSampleRate: 48000,
    bitpool: 35,
    channelMode: 'Joint Stereo',
    blocks: 4
  }), 372000);
  assert.equal(Plugin.bitrateForSettings({
    hostSampleRate: 88200,
    bitpool: 35,
    channelMode: 'Joint Stereo',
    blocks: 16
  }), 228768.75);
  assert.equal(Plugin.bitrateForSettings({
    hostSampleRate: 48000,
    bitpool: 35,
    channelMode: 'Joint Stereo',
    blocks: 16,
    codecChannels: 1
  }), 234000);
  // SBC XQ and XQ+ are Dual Channel at bitpool 38 and 47 on the 44.1 kHz codec clock.
  assert.equal(Plugin.bitrateForSettings({
    hostSampleRate: 44100,
    bitpool: 38,
    channelMode: 'Dual Channel',
    blocks: 16
  }), 452025);
  assert.equal(Plugin.bitrateForSettings({
    hostSampleRate: 44100,
    bitpool: 47,
    channelMode: 'Dual Channel',
    blocks: 16
  }), 551250);
  assert.equal(Plugin.bitrateForSettings({
    hostSampleRate: 44100,
    bitpool: 53,
    channelMode: 'Dual Channel',
    blocks: 16
  }), 617400);
  // A mono stream has no second channel to allocate, so Dual Channel costs the same as mono.
  assert.equal(Plugin.bitrateForSettings({
    hostSampleRate: 48000,
    bitpool: 35,
    channelMode: 'Dual Channel',
    blocks: 16,
    codecChannels: 1
  }), 234000);

  const plugin = new Plugin();
  assert.equal(plugin._bitrateText(), '249.0 kbit/s');
  plugin.onMessage({ pluginId: plugin.id, sampleRate: 88200 });
  assert.equal(plugin._bitrateText(), '228.8 kbit/s');
  plugin.getParameters({
    sampleRate: 96000,
    outputChannelCount: 1,
    commitSampleRate: true
  });
  assert.equal(plugin.hostSampleRate, 96000);
  assert.equal(plugin.activeCodecChannels, 1);
  assert.equal(plugin._bitrateText(), '234.0 kbit/s');
  plugin.getParameters({ sampleRate: 88200, outputChannelCount: 2 });
  assert.equal(plugin._bitrateText(), '234.0 kbit/s');
  plugin.getParameters({
    sampleRate: 88200,
    outputChannelCount: 2,
    commitSampleRate: true
  });
  assert.equal(plugin._bitrateText(), '228.8 kbit/s');
});

test('SBC Codec Simulator sanitizes public values without changing its ABI keys', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin.setParameters({ bp: 99, cm: 'invalid', bl: 4, og: -99, mx: 200, pl: 99 });
  assert.deepEqual(Object.keys(plugin.getParameters()), [
    'type', 'bp', 'cm', 'bl', 'og', 'mx', 'pl', 'enabled'
  ]);
  assert.equal(plugin.bp, 53);
  assert.equal(plugin.cm, 'Joint Stereo');
  plugin.setParameters({ cm: 'Dual Channel' });
  assert.equal(plugin.cm, 'Dual Channel');
  assert.equal(plugin._bitrateText(), '780.0 kbit/s');
  plugin.setParameters({ cm: 'invalid' });
  assert.equal(plugin.cm, 'Dual Channel');
  assert.equal(plugin.bl, '4');
  assert.equal(plugin.og, -24);
  assert.equal(plugin.mx, 100);
  assert.equal(plugin.pl, 20);
});

test('SBC Codec Simulator defaults to a loss-free link and rounds packet loss to a tenth',
  async () => {
    const Plugin = await loadPlugin();
    const plugin = new Plugin();
    assert.equal(plugin.pl, 0);
    plugin.setParameters({ pl: 2.34 });
    assert.equal(plugin.pl, 2.3);
    plugin.setParameters({ pl: -1 });
    assert.equal(plugin.pl, 0);
    plugin.setParameters({ pl: 'not a number' });
    assert.equal(plugin.pl, 0);
  });
