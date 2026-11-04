import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { TelemetryHub } from '../../js/audio/telemetry-hub.js';
import { createFakeDocument } from '../helpers/fake-dom.mjs';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';
import { createSf2RuntimeFixture } from '../helpers/sf2-runtime-fixture.mjs';

const sources = await Promise.all(['plugins/plugin-base.js', 'plugins/sfz-instrument.js', 'plugins/others/soundfont_player.js',
  'js/ui/range-fill.js'].map(file => fs.readFile(new URL(`../../${file}`, import.meta.url), 'utf8')));

function createPlayer(h, asset) {
  const document = createFakeDocument(), create = document.createElement.bind(document);
  document.createElement = tag => {
    const element = create(tag);
    element.dataset = {};
    element.append = (...children) => children.forEach(child => element.appendChild(child));
    element.replaceChildren = (...children) => { element.children.length = 0; element.append(...children); };
    element.removeAttribute = name => { delete element.attributes[name]; };
    return element;
  };
  const hub = new TelemetryHub({ port: h.node.port });
  const window = { audioManager: h.manager, dspTelemetryHub: hub };
  vm.runInNewContext(sources.slice(0, 3).join('\n') + '\n' + sources[3].replaceAll('export ', ''), {
    window, document, console, performance, setTimeout, clearTimeout, __EFFECTUNE_WASM_ONLY__: true,
    MutationObserver: class { observe() {} disconnect() {} }
  });
  const plugin = new window.SoundFontPlayerPlugin();
  plugin.id = 7; plugin.sf = 'a'.repeat(24); plugin.hasLocalAudio = false;
  plugin._wasmAssetOperationRevisions.set(0, 1);
  // The native harness installs the caller-owned descriptor directly, without a library import.
  plugin.getWasmAssetRevisionDescriptor = () => asset;
  plugin.createUI(); plugin.hasLocalAudio = true;
  const receive = ({ data }) => {
    if (data.type === 'dspTelemetry') hub.handleMessage({ ...data, recycle: false }, h.node.port);
  };
  h.node.port.addEventListener('message', receive);
  h.manager._wasmAssetMembershipByNode.get(h.node).set(7, plugin);
  return { plugin, close() { h.node.port.removeEventListener('message', receive); hub.clearSubscriptions(); plugin.cleanup(); } };
}

for (const variant of ['baseline', 'simd']) test(`${variant} SoundFont UI controls and real native telemetry share current channel state`,
  { timeout: 30000 }, async () => {
    const fixture = await createSf2RuntimeFixture({ resident: true });
    const h = await createNativeSamplerWorklet({ variant });
    const ui = createPlayer(h, fixture.descriptor), plugin = ui.plugin;
    try {
      fixture.descriptor.operationRevision = 1;
      await h.initialize('SoundFontPlayerPlugin', fixture.descriptor);
      const metadata = { format: 'sf2', sampleCount: fixture.source.samples.length, sourceBytes: fixture.source.sourceBytes,
        presets: fixture.source.compiled.presets, descriptor: fixture.descriptor };
      plugin._soundFontMetadata = { ...metadata, descriptor: undefined, presets: undefined };
      plugin.validatePreparedSfzBank(metadata);
      plugin._renderStatus();
      assert.match(plugin._status.textContent, /Preparing sample cache/,
        'Native ACTIVE still displays the real pending prefix count');
      await h.waitFor(() => {
        const entry = h.processor.wasmInstances.get(7), snapshot = h.binding.instanceStreamReadiness(entry.id);
        return snapshot && snapshot.generation === h.binding.instanceMidiClock(entry.id).generation &&
          snapshot.scope !== 0 && snapshot.pendingPages === 0 && h.manager.getNativeMixerMetadata(plugin, h.node).cacheReady;
      });
      plugin._renderStatus();
      assert.equal(plugin._status.textContent, 'Ready to play.');
      assert.match(plugin._bankSummary.textContent, /1 sample · 4 presets/);
      assert.ok(plugin._bankSummary.textContent.includes('source'));
      assert.ok(plugin._bankSummary.textContent.includes('playback memory'));
      await h.waitFor(() => plugin._mixerState?.channels.length === 16);
      const beforeInitialTelemetry = h.frame;
      await h.waitFor(() => h.frame >= beforeInitialTelemetry + 4096);
      assert.equal(plugin._mixerRows[0].patch.value, '0',
        'melodic channels show their initial bank 0/program 0 preset before Program Change');
      assert.equal(plugin._mixerState.channels[9].bank, 128,
        'channel 10 starts on the drum bank before Program Change');
      assert.equal(plugin._mixerRows[9].patch.value, '16384',
        'channel 10 shows its initial drum preset before Program Change');
      await h.send({ type: 'midiTransport', timeline: { duration: 3, events: [
        { seconds: .01, status: 144, data1: 60, data2: 127 },
        { seconds: .02, status: 153, data1: 67, data2: 100 },
        { seconds: 1.5, status: 0, data1: 0, data2: 0, systemReset: 1 }
      ] }, generation: 1, position: 0, playing: false, preparing: true, speed: 1, gain: 1, mode: 'reset' });
      await h.waitFor(() => h.messages.some(message => message.type === 'midiPrepared' && message.generation === 1));
      // Media preparation remains nonblocking. This already-ready audio fixture
      // waits for its new native generation's actual known-plan ACK before start.
      await h.waitFor(() => {
        const entry = h.processor.wasmInstances.get(7), snapshot = h.binding.instanceStreamReadiness(entry.id);
        return snapshot && snapshot.generation === 1 && h.binding.instanceMidiClock(entry.id).generation === 1 &&
          snapshot.scope === 1 && snapshot.pendingPages === 0 && snapshot.readyAheadFrames > 0;
      });
      await h.send({ type: 'midiStart', generation: 1, anchorFrame: h.frame + 128 });
      await h.waitFor(() => plugin._mixerState?.voices >= 2);
      assert.equal(plugin._mixerState.channels[0].notes[60 >> 3] & (1 << (60 & 7)), 16);
      assert.equal(plugin._mixerRows[0].patch.value, '0');
      assert.equal(plugin._mixerRows[9].patch.value, '16384');
      const saved = JSON.stringify(plugin.getParameters());
      const change = async (element, type, event, predicate) => {
        const delivery = element.dispatchEvent(type, event);
        await h.waitFor(predicate);
        await delivery;
      };
      const row = plugin._mixerRows[0];
      row.patch.value = '129';
      await change(row.patch, 'change', {}, () => row.patch.value === '129' && plugin._mixerState.channels[0].bank === 1);
      assert.equal(plugin._mixerState.channels[0].sourceBankMsb, 1);
      assert.equal(plugin._mixerState.channels[0].program, 1);
      await change(row.knobs[0], 'keydown', { key: 'Home', preventDefault() {} }, () => plugin._mixerState.channels[0].volume === 0);
      await change(row.knobs[1], 'keydown', { key: 'ArrowRight', preventDefault() {} }, () => plugin._mixerState.channels[0].pan === 65);
      await change(row.knobs[2], 'keydown', { key: 'Home', preventDefault() {} }, () => plugin._mixerState.channels[0].expression === 0);
      await change(row.knobs[3], 'keydown', { key: 'End', preventDefault() {} }, () => plugin._mixerState.channels[0].reverb === 127);
      await change(row.knobs[4], 'keydown', { key: 'End', preventDefault() {} }, () => plugin._mixerState.channels[0].chorus === 127);
      await change(row.mute, 'click', {}, () => row.mute.getAttribute('aria-pressed') === 'true');
      await change(plugin._mixerRows[9].solo, 'click', {}, () => plugin._mixerRows[9].solo.getAttribute('aria-pressed') === 'true');
      assert.equal(plugin._mixerState.channels[0].mute, true);
      assert.equal(plugin._mixerState.channels[9].solo, true);
      assert.equal(JSON.stringify(plugin.getParameters()), saved, 'Mixer gestures never alter the saved configuration');
      await h.waitFor(() => plugin._mixerState && !plugin._mixerState.channels[0].mute && !plugin._mixerState.channels[9].solo);
      assert.equal(plugin._mixerState.channels[0].bank, 0);
      assert.equal(plugin._mixerState.channels[0].program, 0);
      assert.equal(h.messages.some(message => message.type === 'midiTransportError'), false, h.errors.join('; '));
      assert.equal(h.errors.length, 0, h.errors.join('; '));
    } finally { ui.close(); await h.close(); await fixture.close(); }
  });
