import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createFakeDocument } from '../helpers/fake-dom.mjs';
import { updateRangeFill } from '../../js/ui/range-fill.js';
import { AudioManager } from '../../js/audio-manager.js';
import { TelemetryHub } from '../../js/audio/telemetry-hub.js';
import { midiPlaybackMethods } from '../../js/ui/audio-player/midi-playback.js';
import { PluginManager } from '../../js/plugin-manager.js';
import { PipelineItemBuilder } from '../../js/ui/pipeline/pipeline-item-builder.js';
import { packSoundFontPlayerPluginParams } from '../../js/audio/dsp-params.generated.js';

const instrumentSource = fs.readFileSync(new URL('../../plugins/sfz-instrument.js', import.meta.url), 'utf8');
const playerSource = fs.readFileSync(new URL('../../plugins/others/soundfont_player.js', import.meta.url), 'utf8');
const axisSource = fs.readFileSync(new URL('../../plugins/frequency-axis.js', import.meta.url), 'utf8');
const playerCss = fs.readFileSync(new URL('../../plugins/others/soundfont_player.css', import.meta.url), 'utf8');

function player(options = {}) {
  const document = createFakeDocument(), window = options.window || {};
  const createElement = document.createElement.bind(document);
  document.createElement = tag => {
    const element = createElement(tag);
    element.dataset = {};
    element.append = (...children) => children.forEach(child => element.appendChild(child));
    element.replaceChildren = (...children) => { element.children.length = 0; element.append(...children); };
    element.removeAttribute = name => { delete element.attributes[name]; };
    element.matches = selector => selector === 'input[type="range"]' && element.tagName === 'INPUT' && element.type === 'range';
    element.style.setProperty = (name, value) => { element.style[name] = value; };
    element.querySelector = selector => element.children.find(child => child.tagName.toLowerCase() === selector) || null;
    return element;
  };
  class PluginBase {
    constructor(name) { this.name = name; this.hasLocalAudio = options.hasLocalAudio ?? false; this.enabled = true; this._wasmAssetStates = new Map(); }
    registerProcessor() {}
    updateParameters() { this.parameterUpdates = (this.parameterUpdates || 0) + 1; }
    cleanup() {}
    _setValidatedParameters(params) { if (typeof params.enabled === 'boolean') this.enabled = params.enabled; }
    getWasmAssetOperationRevision() { return this.revision ?? 1; }
    _isCurrentWasmAssetOperation(_slot, revision) { return revision === this.getWasmAssetOperationRevision(); }
    onMessage() {}
    getParameters() { return { type: this.constructor.name, enabled: this.enabled }; }
    getWorkletPluginData(parameters = this.getParameters()) { return { parameters }; }
    parseFiniteNumber(value, min, max, fallback) { return Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback; }
    createParameterControl(...args) {
      const row = document.createElement('div'); row.controlArgs = args; return row;
    }
    createCheckboxControl(label, checked, setter) {
      const row = document.createElement('div'), checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.checked = !!checked; checkbox.setAttribute('aria-label', label);
      checkbox.addEventListener('change', event => setter(event.target.checked));
      row.appendChild(checkbox); return row;
    }
    createRadioGroup(label, options, value, setter) {
      const row = document.createElement('div');
      row.setAttribute('aria-label', label);
      for (const option of options) {
        const radio = document.createElement('input'); radio.type = 'radio'; radio.value = option.value;
        radio.checked = option.value === value;
        radio.addEventListener('change', () => setter(option.value)); row.appendChild(radio);
      }
      return row;
    }
    createSelectControl(label, options, value, setter) {
      const row = document.createElement('div'), select = document.createElement('select');
      select.setAttribute('aria-label', label);
      for (const choice of options) {
        const option = document.createElement('option'); option.value = choice.value; option.textContent = choice.label;
        select.appendChild(option);
      }
      select.value = String(value); select.addEventListener('change', event => setter(event.target.value));
      row.appendChild(select); return row;
    }
  }
  vm.runInNewContext(`${instrumentSource}\n${playerSource}`, { PluginBase, window, document, console, performance, setTimeout, clearTimeout });
  return new window.SoundFontPlayerPlugin();
}
const bank = presets => ({ format: 'sf2', descriptor: { footprintBytes: 8 * 1048576 }, presets, sampleCount: 2 });

test('SoundFont Player defaults and resets to FIR32 while preserving saved interpolation choices', () => {
  const manager = new PluginManager();
  manager.pluginClasses['SoundFont Player'] = player().constructor;
  const plugin = manager.createPlugin('SoundFont Player');
  assert.equal(plugin.getParameters().sq, 1);
  assert.equal(plugin.defaultParameters.sq, 1);
  assert.equal(packSoundFontPlayerPluginParams(plugin.getWorkletPluginData().parameters)[3], 1);
  plugin.setParameters({ mc: 2 });
  assert.equal(plugin.getParameters().sq, 1, 'a saved state without interpolation uses the app default');
  for (const sq of [0, 1, 2]) {
    plugin.setParameters({ sq });
    const restored = manager.createPlugin('SoundFont Player');
    restored.setParameters(JSON.parse(JSON.stringify(plugin.getParameters())));
    restored.setParameters({ og: -3 });
    assert.equal(restored.getParameters().sq, sq);
    assert.equal(packSoundFontPlayerPluginParams(restored.getWorkletPluginData().parameters)[3], sq);
  }
  PipelineItemBuilder.prototype.resetPluginToDefaults.call({
    pipelineCore: { updateWorkletPlugin() {}, updatePipelineUI() {} }
  }, plugin);
  assert.equal(plugin.getParameters().sq, 1);
  assert.equal(packSoundFontPlayerPluginParams(plugin.getWorkletPluginData().parameters)[3], 1);
});

test('SoundFont Player enables automatic fallback by default and saves the choice', () => {
  const manager = new PluginManager();
  manager.pluginClasses['SoundFont Player'] = player().constructor;
  const plugin = manager.createPlugin('SoundFont Player');
  assert.equal(plugin.getParameters().af, true);
  assert.equal(packSoundFontPlayerPluginParams(plugin.getWorkletPluginData().parameters)[4], 1);
  plugin.setParameters({ af: false });
  const restored = manager.createPlugin('SoundFont Player');
  restored.setParameters(JSON.parse(JSON.stringify(plugin.getParameters())));
  assert.equal(restored.getParameters().af, false);
  assert.equal(packSoundFontPlayerPluginParams(restored.getWorkletPluginData().parameters)[4], 0);
});

function telemetry({ voices = 2, limit = 64, bank = 0, program = 0, note = 60, flags = 0, peak = 0,
  stolenReleased = 0, stolenHeld = 0 } = {}) {
  const payload = new DataView(new ArrayBuffer(584));
  payload.setUint16(0, voices, true); payload.setUint16(2, limit, true);
  payload.setUint16(4, stolenReleased, true); payload.setUint16(6, stolenHeld, true);
  for (let channel = 0; channel < 16; channel++) {
    const row = 8 + channel * 32;
    payload.setUint16(row, bank, true); payload.setUint8(row + 2, program);
    payload.setUint8(row + 3, 100); payload.setUint8(row + 4, 64); payload.setUint8(row + 5, 127);
    payload.setUint8(row + 6, 40); payload.setUint8(row + 8, flags);
    payload.setUint8(row + 9, program);
    payload.setUint16(row + 12, channel === 0 ? voices : 0, true);
    if (channel === 0 && note >= 0) payload.setUint8(row + 16 + (note >> 3), 1 << (note & 7));
    payload.setFloat32(520 + channel * 4, channel === 0 ? peak : 0, true);
  }
  return { frameType: 35, formatVersion: 2, payload };
}

test('SoundFont patch menus follow the effective percussion bank on any channel and return to melodic choices', () => {
  const plugin = player(); plugin.createUI();
  plugin.validatePreparedSfzBank(bank([{ bank: 0, program: 0, name: 'Piano' }, { bank: 128, program: 1, name: 'Kit' }]));
  plugin.handleMixerTelemetry(telemetry({ bank: 128, program: 1 }));
  assert.deepEqual(Array.from(plugin._mixerRows[0].presets, preset => preset.bank), [128]);
  assert.equal(plugin._mixerRows[0].patch.value, String(128 * 128 + 1));
  plugin.handleMixerTelemetry(telemetry({ bank: 0, program: 0 }));
  assert.deepEqual(Array.from(plugin._mixerRows[9].presets, preset => preset.bank), [0]);
  assert.equal(plugin._mixerRows[9].patch.value, '0');
});

test('SoundFont Player colors the Voices readout for three seconds after voice stealing', () => {
  const plugin = player();
  plugin.createUI();
  plugin.handleMixerTelemetry(telemetry());
  assert.equal(plugin._voiceMeter.attributes['data-shortage'], undefined);
  plugin.handleMixerTelemetry(telemetry({ stolenReleased: 1 }));
  assert.equal(plugin._voiceMeter.getAttribute('data-shortage'), 'released', 'cutting a release tail shows the warning color');
  plugin.handleMixerTelemetry(telemetry());
  assert.equal(plugin._voiceMeter.getAttribute('data-shortage'), 'released', 'the color holds past the frame that reported it');
  plugin.handleMixerTelemetry(telemetry({ stolenHeld: 1, stolenReleased: 1 }));
  assert.equal(plugin._voiceMeter.getAttribute('data-shortage'), 'held', 'stopping a held voice outranks release tails');
  plugin.handleMixerTelemetry(telemetry({ stolenReleased: 1 }));
  assert.equal(plugin._voiceMeter.getAttribute('data-shortage'), 'held');
  plugin._voiceShortage.held = performance.now() - 1;
  plugin._applyVoiceShortage();
  assert.equal(plugin._voiceMeter.getAttribute('data-shortage'), 'released', 'an expired held steal falls back to the newer release steal');
  plugin._resetMixerFlashes();
  assert.equal(plugin._voiceMeter.attributes['data-shortage'], undefined, 'a new song clears the warning');
  assert.equal(plugin._voiceShortageTimer, null);
  assert.match(playerCss, /\.soundfont-voice-meter\[data-shortage\] \{ --soundfont-shortage: var\(--et-warning\); \}/);
  assert.match(playerCss, /\.soundfont-voice-meter\[data-shortage="held"\] \{ --soundfont-shortage: var\(--et-danger\); \}/);
});

test('SoundFont Player stores configuration but never mixer performance state', async () => {
  const plugin = player(), first = 'a'.repeat(24), second = 'b'.repeat(24);
  const overrides = Object.fromEntries(Array.from({ length: 16 }, (_, channel) => [`sp${channel}`, channel * 128 + 3]));
  plugin.setParameters({ sf: first, mc: 4, pl: 96, og: -2, sq: 1, ...overrides });
  assert.equal(plugin.getParameters().sf, first);
  assert.equal(plugin.getParameters().mc, 4);
  assert.equal(plugin.getParameters().pl, 96);
  assert.equal(plugin.getParameters().og, -2);
  assert.equal(plugin.getParameters().sq, 1);
  assert.equal(plugin.getWorkletPluginData().parameters.sq, 1);
  plugin.getWasmAssets = () => new Map([[0, { externalAssetSignature: first }]]);
  const offline = await plugin.createOfflineDspState();
  assert.equal(offline.parameters.sq, 1);
  assert.equal(offline.assets.get(0).externalAssetSignature, first);
  for (const invalid of [-1, 3, 1.5, '2', null]) {
    plugin.setParameters({ sq: invalid });
    assert.equal(plugin.getParameters().sq, 1);
  }
  const restored = player();
  restored.setParameters(plugin.getParameters());
  assert.equal(restored.getParameters().sq, 1);
  for (let channel = 0; channel < 16; channel++) assert.equal(Object.hasOwn(plugin.getParameters(), `sp${channel}`), false);
  plugin.setParameters({ pl: 2048 });
  assert.equal(plugin.getParameters().pl, 1024);
  plugin.handleMixerTelemetry(telemetry({ bank: 128, flags: 3 }));
  assert.equal(Object.hasOwn(plugin.getParameters(), 'channels'), false);
  plugin.setParameters({ sf: second });
  assert.equal(plugin._mixerState, null);
});

test('SoundFont Player presents sixteen channel patch menus and separates configuration', () => {
  const plugin = player();
  const ui = plugin.createUI();
  assert.equal(plugin.name, 'SoundFont Player');
  assert.equal(plugin._mixerRows.length, 16);
  assert.equal(plugin._mixerRows.every(row => row.patch.disabled), true);
  plugin.validatePreparedSfzBank(bank([
    { index: 0, bank: 0, program: 0, name: 'Piano' }, { index: 1, bank: 128, program: 0, name: 'Drums' },
    { index: 2, bank: 0, program: 0, name: 'Duplicate' }, { index: 3, bank: 129, program: 0, name: 'Unplayable' }
  ]));
  assert.equal(plugin._mixerRows[0].patch.children.length, 2);
  assert.equal(plugin._mixerRows[0].patch.children[0].textContent, '1. Piano');
  assert.equal(plugin._mixerRows[9].patch.children.length, 2);
  assert.equal(plugin._mixerRows[9].patch.children[0].textContent, '1. Drums · Bank 128');
  assert.equal(plugin._mixerRows[0].presets.every(preset => preset.bank < 128), true);
  assert.equal(plugin._mixerRows[9].presets.every(preset => preset.bank === 128), true);
  plugin.handleMixerTelemetry(telemetry({ bank: 128, flags: 3 }));
  assert.equal(plugin._mixerRows[9].patch.value, '16384');
  assert.equal(plugin._mixerRows[0].mute.getAttribute('aria-pressed'), 'true');
  assert.equal(plugin._voiceValue.textContent, '2 / 64');
  plugin.handleMixerTelemetry(telemetry({ voices: 0, note: 60 }));
  assert.equal(plugin._voiceValue.textContent, '0 / 64');
  assert.equal(plugin._mixerState.channels[0].notes[7], 16, 'A held MIDI key survives voice stealing');
  plugin.handleMixerTelemetry(telemetry({ voices: 2, note: -1 }));
  assert.equal(plugin._voiceValue.textContent, '2 / 64');
  assert.equal(plugin._mixerState.channels[0].notes[7], 0, 'NoteOff removes the key while release voices can remain');
  plugin._selectMixerTab('settings');
  assert.equal(plugin._tabs[0].panel.hidden, true);
  assert.equal(plugin._tabs[1].panel.hidden, false);
  assert.equal(plugin._tabs[1].tab.className, 'room-eq-tab active');
  assert.equal(plugin._tabs[1].panel.className, 'room-eq-tab-content plugin-parameter-ui active');
  assert.equal(plugin._status.className, 'room-eq-status');
  assert.equal(plugin._status.parentNode, ui.children.at(-1), 'playback status stays below both tabs');
  assert.equal(plugin._preparationProgress.parentNode, ui.children.at(-1));
  assert.equal(ui.children.at(-2).className, 'room-eq-panel');
  assert.equal(plugin._bankSummary.parentNode, plugin._tabs[1].panel);
  assert.equal(plugin._tabs[1].panel.children[1].children[0].getAttribute('aria-label'), 'MIDI Channel');
  const maxVoices = plugin._tabs[1].panel.children.find(child => child.controlArgs?.[0] === 'Max Voices');
  assert.deepEqual(maxVoices.controlArgs.slice(1, 5), [1, 1024, 1, 256]);
  assert.equal(maxVoices.controlArgs[9], true, 'voice limit uses the shared logarithmic slider mapping');
  const quality = plugin._tabs[1].panel.children.find(child => child.getAttribute('aria-label') === 'Interpolation');
  assert.deepEqual(quality.children.map(child => child.value), [0, 1, 2]);
  assert.equal(quality.children[1].checked, true);
  quality.children[2].checked = true;
  quality.children[2].dispatchEvent('change');
  assert.equal(plugin.getParameters().sq, 2);
  const compatibility = plugin._tabs[1].panel.children.find(child => child.getAttribute('aria-label') === 'SF2 Compatibility');
  assert.deepEqual(compatibility.children.map(child => child.value), [0, 1]);
  assert.equal(compatibility.children[0].checked, true, 'Standard is the default interpretation');
  compatibility.children[1].checked = true;
  compatibility.children[1].dispatchEvent('change');
  assert.equal(plugin.getParameters().sc, 1);
});

test('MIDI channel volume knob reflects CC7 telemetry without controller feedback', () => {
  const actions = [], plugin = player({ window: { audioManager: {
    sendSoundFontMixerAction: async (_plugin, action) => actions.push(action) } } });
  plugin.createUI();
  const frame = telemetry(), knob = plugin._mixerRows[0].knobs[0];
  assert.equal(knob.getAttribute('aria-label'), 'Channel 1 Volume');
  assert.equal(knob.getAttribute('aria-valuenow'), '100');
  frame.payload.setUint8(11, 31);
  plugin.handleMixerTelemetry(frame);
  assert.equal(knob.getAttribute('aria-valuenow'), '31');
  assert.deepEqual(actions, [], 'Native CC7 observations update only the presentation');
});

test('mixer uses narrow knobs and clears the channel level display with the source', () => {
  const plugin = player();
  plugin.createUI();
  const row = plugin._mixerRows[0];
  assert.equal(row.row.children.length, 11);
  assert.equal(row.knobs.length, 5);
  const table = row.row.parentNode.parentNode;
  assert.deepEqual(table.children[0].children.map(column => column.style.width),
    ['3%', '22%', '33%', '14%', '4%', '4%', '4%', '4%', '4%', '4%', '4%']);
  assert.deepEqual(table.children[1].children[0].children.map(cell => cell.textContent),
    ['Ch', 'Patch', 'Notes', 'Level', 'Vol.', 'Mute', 'Solo', 'Pan', 'EXP', 'Rev.', 'Cho.']);
  assert.equal(row.row.children[3].children[0], row.level, 'Level follows sounding notes');
  assert.equal(row.level.getAttribute('aria-label'), 'Channel 1 level');
  plugin.handleMixerTelemetry(telemetry({ peak: 1 }));
  assert.equal(row.level.children[0].style.clipPath, 'inset(0 0% 0 0)');
  assert.equal(row.level.children[1].style.opacity, '1');
  plugin._clearVoiceDisplay();
  assert.equal(row.level.children[0].style.clipPath, 'inset(0 100% 0 0)');
  assert.equal(row.level.children[1].style.opacity, '0');
});

test('channel level maps -48 to 0 dB onto a fixed gradient and seven full-width grid lines', () => {
  const plugin = player();
  plugin.createUI();
  const row = plugin._mixerRows[0];
  assert.match(playerCss, /#008000 0% 75%, #808000 75% 87\.5%, #800000 87\.5% 100%/);
  assert.match(playerCss, /\.soundfont-channel-level-fill \{[^}]*clip-path: inset\(0 100% 0 0\)/);
  assert.doesNotMatch(playerCss, /\.soundfont-channel-level-fill \{[^}]*transform:/);
  assert.match(playerCss, /\.soundfont-channel-level::after \{[^}]*repeating-linear-gradient\(to right, transparent 0 calc\(12\.5% - 1px\), var\(--et-graph-grid-soft\) calc\(12\.5% - 1px\) 12\.5%\)/);
  assert.match(playerCss, /\.soundfont-channel-level::after \{[^}]*clip-path: inset\(0 1px 0 0\)/);
  for (const [db, visiblePercent] of [[-96, 0], [-48, 0], [-24, 50], [-12, 75], [-6, 87.5], [0, 100], [6, 100]]) {
    row.levelState = null;
    plugin._drawMixerLevel(row, 10 ** (db / 20), {});
    const hiddenPercent = Number(row.level.children[0].style.clipPath.match(/inset\(0 ([\d.]+)%/)[1]);
    assert.ok(Math.abs(hiddenPercent - (100 - visiblePercent)) < 0.00001, `${db} dB clips at ${visiblePercent}%`);
    assert.ok(Math.abs(Number(row.level.children[1].style.left.slice(0, -1)) - visiblePercent) < 0.00001,
      `${db} dB positions the peak at ${visiblePercent}%`);
  }
  assert.equal(row.level.children[1].style.opacity, '1');
});

test('mixer flashes only changed Patch and controller values after its first telemetry state', () => {
  const window = { uiManager: { audioPlayer: { contextManager: { midiGeneration: 1 } } } };
  const plugin = player({ window });
  plugin.createUI();
  const row = plugin._mixerRows[0], started = [];
  for (const control of [row.patch, ...row.knobs]) {
    control.animate = (_frames, options) => {
      const animation = { cancelled: 0, replayed: 0,
        cancel() { this.cancelled++; }, play() { this.replayed++; } };
      started.push({ control, animation, options });
      return animation;
    };
  }
  plugin.handleMixerTelemetry(telemetry());
  plugin.handleMixerTelemetry(telemetry());
  assert.equal(started.length, 0, 'initial state and unchanged state do not flash');
  const changed = telemetry({ program: 1 });
  changed.payload.setUint8(11, 72);
  plugin.handleMixerTelemetry(changed);
  assert.deepEqual(started.map(item => item.control), [row.patch, row.knobs[0]]);
  assert.equal(started[0].options.duration, 650);
  plugin.handleMixerTelemetry(changed);
  assert.equal(started.length, 2, 'the same displayed values do not flash again');
  const changedAgain = telemetry({ program: 2 });
  changedAgain.payload.setUint8(11, 73);
  plugin.handleMixerTelemetry(changedAgain);
  assert.equal(started.length, 2, 'the animations are reused');
  assert.equal(started[0].animation.replayed, 1);
  assert.equal(started[1].animation.replayed, 1);
  window.uiManager.audioPlayer.contextManager.midiGeneration = 2;
  const resetBaseline = telemetry({ program: 3 });
  resetBaseline.payload.setUint8(11, 74);
  plugin.handleMixerTelemetry(resetBaseline);
  assert.equal(started.length, 2, 'transport generation starts a new baseline');
  assert.equal(started[0].animation.replayed, 1);
  assert.equal(started[1].animation.replayed, 1);
  const sameSongChange = telemetry({ program: 4 });
  sameSongChange.payload.setUint8(11, 75);
  plugin.handleMixerTelemetry(sameSongChange);
  assert.deepEqual(started.slice(2).map(item => item.control), [row.patch, row.knobs[0]],
    'a changed MIDI value within the new song flashes');
  plugin._clearVoiceDisplay();
  plugin.handleMixerTelemetry(sameSongChange);
  assert.equal(started.length, 4, 'the first state after clear is a new baseline');
});

test('MIDI metering desire follows the visible active Mixer and clears on cleanup', () => {
  const calls = [], manager = { setSoundFontMidiMetering(_plugin, enabled) { calls.push(enabled); } };
  const plugin = player({ hasLocalAudio: true, window: { audioManager: manager } });
  plugin.sf = 'a'.repeat(24);
  plugin._refreshBanks = async () => {};
  assert.deepEqual(calls, [], 'no UI means no metering work');
  plugin.createUI();
  assert.deepEqual(calls, [true]);
  plugin._renderStatus();
  assert.deepEqual(calls, [true], 'unchanged visibility does not resend');
  plugin._selectMixerTab('settings');
  plugin._selectMixerTab('mixer');
  assert.deepEqual(calls, [true, false, true]);
  plugin.enabled = false;
  plugin.stopAnimation();
  assert.deepEqual(calls, [true, false, true, false]);
  plugin.cleanup();
  assert.equal(calls.at(-1), false);
});

test('Visualizer leases meter actual MIDI and reads a frozen synced snapshot without opening the mixer UI', () => {
  const calls = [], subscriptions = [];
  const hub = { visualSyncEpoch: 1, subscribe(_tap, _type, callback) {
    const entry = { callback, removed: false }; subscriptions.push(entry);
    return () => { entry.removed = true; };
  } };
  const plugin = player({ hasLocalAudio: true, window: { dspTelemetryHub: hub,
    audioManager: { setSoundFontMidiMetering(_plugin, value) { calls.push(value); } } } });
  plugin.id = 7; plugin.sf = 'a'.repeat(24);
  assert.equal(plugin.getVisualizerMidiMixerSnapshot(), null);
  const releaseA = plugin.acquireVisualizerMidiMetering();
  const releaseB = plugin.acquireVisualizerMidiMetering();
  assert.deepEqual(calls, [true], 'a second consumer does not restart metering');
  assert.equal(plugin._mixerRows.length, 0, 'no plugin UI was created');
  plugin.validatePreparedSfzBank(bank([{ bank: 0, program: 0, name: 'Piano' }]));
  subscriptions[0].callback(telemetry({ peak: .25 }));
  const first = plugin.getVisualizerMidiMixerSnapshot();
  assert.equal(first.state.channels[0].levelPeak, .25);
  assert.equal(first.state.channels[0].notes[7], 16);
  assert.equal(first.presets[0].name, 'Piano');
  assert.equal(first.channelFilter, 0);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.state.channels[0].notes), true);
  assert.equal(Object.isFrozen(first.presets[0]), true);
  assert.equal(plugin.getVisualizerMidiMixerSnapshot().state, first.state, 'one telemetry frame keeps its identity');
  plugin.mc = 4;
  assert.equal(plugin.getVisualizerMidiMixerSnapshot().channelFilter, 4);
  hub.visualSyncEpoch = 2;
  assert.equal(plugin.getVisualizerMidiMixerSnapshot(), null, 'sync epoch change clears the old frame');
  assert.equal(subscriptions[0].removed, true);
  subscriptions[0].callback(telemetry({ peak: 1 }));
  assert.equal(plugin.getVisualizerMidiMixerSnapshot(), null, 'old source callback cannot revive a frame');
  subscriptions[1].callback(telemetry({ peak: .5 }));
  assert.notEqual(plugin.getVisualizerMidiMixerSnapshot().state, first.state);
  plugin._sectionEnabled = false;
  assert.equal(plugin.getVisualizerMidiMixerSnapshot(), null);
  plugin._updateMidiMetering();
  plugin._sectionEnabled = true;
  plugin._updateMidiMetering();
  assert.deepEqual(calls, [true, false, true], 'section suspension stops and resumes actual metering');
  releaseA();
  assert.deepEqual(calls, [true, false, true], 'remaining consumer retains metering');
  plugin._loadBank = () => {};
  plugin.setParameters({ sf: '' });
  assert.equal(plugin.getVisualizerMidiMixerSnapshot(), null, 'a removed font cannot expose old audio');
  assert.deepEqual(calls, [true, false, true, false], 'clearing a font disables metering without own UI');
  releaseB(); releaseB();
  assert.deepEqual(calls, [true, false, true, false], 'the final release disables metering once');
  plugin.cleanup();
});

test('Visualizer and own Mixer visibility share metering demand without a stale release', () => {
  const calls = [], manager = { setSoundFontMidiMetering(_plugin, enabled) { calls.push(enabled); } };
  const plugin = player({ hasLocalAudio: true, window: { audioManager: manager } });
  plugin.sf = 'a'.repeat(24);
  plugin._refreshBanks = async () => {};
  plugin.createUI();
  const release = plugin.acquireVisualizerMidiMetering();
  plugin._selectMixerTab('settings');
  assert.deepEqual(calls, [true], 'hidden own Mixer does not disable an open Visualizer');
  plugin._selectMixerTab('mixer');
  release();
  assert.deepEqual(calls, [true], 'the own Mixer still needs metering');
  const stale = plugin.acquireVisualizerMidiMetering();
  plugin.cleanup();
  assert.deepEqual(calls, [true, false]);
  stale();
  assert.deepEqual(calls, [true, false], 'late release of a retired plugin is inert');
});

test('MIDI key colors reuse the common graph and note palettes with an unsaved channel color option', () => {
  let trace = 'rgb(0, 255, 0)';
  const fills = [], labels = new Map();
  const context = { clearRect() {}, strokeRect() {}, fillText() {}, measureText: () => ({ width: 8 }),
    fillRect() { fills.push(this.fillStyle); } };
  const noteCalls = [];
  const plugin = player({ window: { ThemePalette: { get: name => name === 'graph-trace' ? trace : 'rgb(100, 100, 100)' },
    NoteSpectrogramPlugin: { noteColor: midi => { noteCalls.push(midi); return [10, 20, 30]; } },
    FrequencyAxis: { noteAxisKeys: () => [{ midi: 60, black: false, whiteStart: 0, whiteEnd: 100 }] } } });
  const canvas = { width: 384, height: 24, dataset: { channel: '1' }, getContext: () => context,
    setAttribute: (name, value) => labels.set(name, value) };
  const notes = new Uint8Array(16); notes[7] = 16;
  plugin._drawMixerKeyboard(canvas, notes);
  assert.equal(fills[0], trace);
  const count = fills.length;
  plugin._drawMixerKeyboard(canvas, notes);
  assert.equal(fills.length, count, 'Unchanged observations do not repaint the keyboard');
  trace = 'rgb(0, 128, 0)'; plugin._drawMixerKeyboard(canvas, notes);
  assert.equal(fills.at(-1), trace);
  assert.equal(labels.get('aria-label'), 'Channel 1 sounding notes: C4');
  const saved = JSON.stringify(plugin.getParameters());
  plugin._mixerColorMode = 'Rainbow'; plugin._drawMixerKeyboard(canvas, notes);
  assert.equal(fills.at(-1), 'rgb(10,20,30)');
  assert.deepEqual(noteCalls, [60]);
  plugin._mixerColorMode = 'Channel'; plugin._drawMixerKeyboard(canvas, notes);
  const channel1 = fills.at(-1);
  const channel2 = { ...canvas, dataset: { channel: '2' }, _mixerKeyboard: null };
  plugin._drawMixerKeyboard(channel2, notes);
  assert.notEqual(fills.at(-1), channel1);
  assert.equal(JSON.stringify(plugin.getParameters()), saved, 'Display colors never become DSP or preset parameters');
});

test('SoundFont presentation follows shared output deadlines and discards queued old-source or reset frames', () => {
  let now = 1000;
  const node = { port: {} };
  const hub = new TelemetryHub({ port: node.port, now: () => now, schedule: () => 1, cancel() {} });
  const plugin = player({ window: { dspTelemetryHub: hub } }); plugin.id = 7;
  const manager = Object.assign(Object.create(AudioManager.prototype), { pipeline: [plugin], visualSyncEnabled: true,
    contextManager: { audioContext: { sampleRate: 48000 } }, visualSyncDelayFrames: 2400,
    dspLatencyTaps: { 7: { input: 0, output: 960, execution: 'wasm', instanceId: 101 } },
    _appliedOutputDelayFrames: new Map([[node, 2400]]), _getPrimaryWorkletNode: () => node });
  hub.setSources(manager.dspLatencyTaps);
  hub.setVisualSyncResolver((...args) => manager._resolveVisualSyncDue(...args));
  plugin.createUI();
  const send = (values, endFrame) => {
    const frame = telemetry(values), packet = new ArrayBuffer(600), header = new DataView(packet);
    header.setUint16(0, 35, true); header.setUint16(2, 2, true); header.setUint32(4, 7, true);
    header.setUint16(12, 584, true); new Uint8Array(packet, 16).set(new Uint8Array(frame.payload.buffer));
    hub.handleMessage({ type: 'dspTelemetry', packet, bytes: 600, endFrame, recycle: false });
  };
  send({ voices: 2 }, 48000);
  assert.equal(plugin._mixerState, null);
  now = 1069; hub._dispatchDueVisualSync(now);
  assert.equal(plugin._mixerState, null, 'State must wait for the output tap and applied output delay');
  now = 1070; hub._dispatchDueVisualSync(now);
  assert.equal(plugin._voiceValue.textContent, '2 / 64');
  send({ voices: 3 }, 52800);
  plugin.revision = 2; plugin._ensureMixerTelemetrySubscription();
  now = 1170; hub._dispatchDueVisualSync(now);
  assert.equal(plugin._mixerState, null, 'An old asset subscription cannot update a replacement');
  send({ voices: 4 }, 57600);
  const transport = { audioPlayer: { audioContext: { currentTime: 1, sampleRate: 48000 } },
    audioManager: { visualSyncEnabled: true, telemetryHub: hub }, getCurrentState: () => ({ playbackSpeed: 1 }),
    getMidiWorklets: () => [], midiTimeline: { events: [] } };
  midiPlaybackMethods.postMidiTransport.call(transport, false, 0, { mode: 'reset' });
  assert.equal(hub.visualSyncQueue.length, 0, 'A new song discards the previous presentation queue');
  plugin._ensureMixerTelemetrySubscription();
  now = 1300; hub._dispatchDueVisualSync(now);
  assert.equal(plugin._mixerState, null);
  manager.visualSyncEnabled = false; hub.setVisualSyncResolver(null); plugin._ensureMixerTelemetrySubscription();
  send({ voices: 5, note: 64 }, 96000);
  assert.equal(plugin._voiceValue.textContent, '5 / 64', 'Sync OFF displays the incoming state immediately');
  assert.equal(hub.visualSyncQueue.length, 0);
  plugin.cleanup(); hub.clearSubscriptions();
});

test('SoundFont Player mixer controls send transient actions and accept subsequent MIDI telemetry', async () => {
  const actions = [];
  let preparation = null;
  const plugin = player({ hasLocalAudio: true, window: { dspTelemetryHub: { subscribe: () => () => {} }, audioManager: {
    sendSoundFontMixerAction: (_plugin, action) => { actions.push({ ...action }); },
    getSfzSamplePreparation: () => preparation
  } } });
  plugin._refreshBanks = async () => {};
  plugin.id = 7;
  plugin.sf = 'a'.repeat(24);
  plugin._wasmAssetStates.set(0, 3);
  plugin.createUI();
  plugin.validatePreparedSfzBank(bank([{ bank: 0, program: 0, name: 'Piano' }, { bank: 1, program: 2, name: 'Keys' }]));
  plugin.handleMixerTelemetry(telemetry());
  const updates = plugin.parameterUpdates;
  const row = plugin._mixerRows[0];
  assert.equal(row.knobs[0].getAttribute('aria-disabled'), 'false');
  preparation = Promise.resolve(); plugin._renderStatus();
  assert.equal(row.knobs[0].getAttribute('aria-disabled'), 'true', 'native metadata readiness alone does not enable mixer controls');
  preparation = null; plugin._renderStatus();
  assert.equal(row.knobs[0].getAttribute('aria-disabled'), 'false');
  row.patch.value = '130'; await row.patch.dispatchEvent('change');
  plugin._setMixerKnobValue(row.knobs[0], 71, 7);
  await row.knobs[0].dispatchEvent('keydown', { key: 'ArrowUp', preventDefault() {} });
  await row.knobs[1].dispatchEvent('keydown', { key: 'ArrowRight', preventDefault() {} });
  await row.mute.dispatchEvent('click'); await row.solo.dispatchEvent('click');
  assert.deepEqual(actions, [
    { type: 'program', channel: 0, bank: 1, program: 2 },
    { type: 'control', channel: 0, controller: 7, value: 72 },
    { type: 'control', channel: 0, controller: 10, value: 65 },
    { type: 'mute', channel: 0, value: true }, { type: 'solo', channel: 0, value: true }
  ]);
  assert.equal(plugin.parameterUpdates, updates);
  plugin.handleMixerTelemetry(telemetry({ program: 0, voices: 0, note: -1 }));
  assert.equal(row.patch.value, '0');
  assert.equal(row.knobs[0].getAttribute('aria-valuenow'), '100');
  assert.equal(row.knobs[1].getAttribute('aria-valuenow'), '64');
  assert.equal(row.mute.getAttribute('aria-pressed'), 'false');
  assert.equal(plugin._voiceValue.textContent, '0 / 64');
  plugin.mc = 1; plugin._renderMixer();
  assert.equal(plugin._mixerRows[1].knobs[0].getAttribute('aria-disabled'), 'true');
  plugin.sf = ''; plugin._renderMixer();
  assert.equal(row.knobs[0].getAttribute('aria-disabled'), 'true');
});

test('SoundFont volume follows the drag until telemetry reaches its last applied command', async () => {
  const actions = [], port = {};
  let now = 100;
  const hub = new TelemetryHub({ port, now: () => now, schedule: () => 1, cancel() {} });
  hub.setVisualSyncResolver((_tap, endFrame) => endFrame);
  const plugin = player({ hasLocalAudio: true, window: { dspTelemetryHub: hub, audioManager: {
    sendSoundFontMixerAction(_plugin, action, reportAppliedFrame) {
      assert.equal(reportAppliedFrame, true);
      const reply = Promise.withResolvers();
      actions.push({ ...action, reply });
      return reply.promise;
    }
  } } });
  plugin._refreshBanks = async () => {};
  plugin.id = 7;
  plugin.sf = 'a'.repeat(24);
  plugin._wasmAssetStates.set(0, 3);
  plugin.createUI();
  plugin.validatePreparedSfzBank(bank([{ bank: 0, program: 0, name: 'Piano' }]));
  const [volume, pan] = plugin._mixerRows[0].knobs;
  Object.assign(volume, { focus() {}, setPointerCapture(id) { this.captured = id; },
    hasPointerCapture(id) { return this.captured === id; }, releasePointerCapture() { this.captured = null; } });
  const pointer = (type, clientY = 50) => volume.dispatchEvent(type, { pointerId: 1, button: 0, clientY, preventDefault() {} });
  const value = knob => knob.getAttribute('aria-valuenow');
  const send = (endFrame, volume, pan, mixerEndFrame = endFrame) => {
    const { payload } = telemetry(), packet = new ArrayBuffer(600), header = new DataView(packet);
    payload.setUint8(11, volume); payload.setUint8(12, pan);
    header.setUint16(0, 35, true); header.setUint16(2, 2, true); header.setUint32(4, 7, true);
    header.setUint16(12, 584, true); new Uint8Array(packet, 16).set(new Uint8Array(payload.buffer));
    hub.handleMessage({ type: 'dspTelemetry', packet, bytes: 600, endFrame, mixerEndFrame, recycle: false });
    now = endFrame;
    hub._dispatchDueVisualSync(now);
  };

  send(100, 100, 64);
  await pointer('pointerdown');
  const first = pointer('pointermove', 35);
  send(200, 100, 65);
  assert.deepEqual([value(volume), value(pan)], ['115', '65'], 'only the dragged knob ignores old telemetry');
  const last = pointer('pointermove', 30);
  await pointer('pointerup');
  await pointer('lostpointercapture');
  assert.deepEqual(actions.map(action => action.value), [115, 120]);
  send(250, 115, 66);
  assert.deepEqual([value(volume), value(pan)], ['120', '66']);
  actions[1].reply.resolve(300);
  actions[0].reply.resolve(200);
  await Promise.all([first, last]);
  send(400, 115, 67, 300);
  assert.deepEqual([value(volume), value(pan)], ['120', '67'], 'a deferred snapshot is older than the final command');
  send(410, 78, 67);
  assert.equal(value(volume), '78', 'a fresh external update need not echo the command value');

  await pointer('pointerdown');
  const cancelled = pointer('pointermove', 35);
  await pointer('pointercancel');
  assert.equal(value(volume), '78');
  actions[2].reply.resolve(420);
  await cancelled;
  send(430, 90, 67);
  assert.equal(value(volume), '90');
  plugin.cleanup();
});

test('SoundFont Player mixer keyboards preview the dragged key on the row channel', async () => {
  const sent = [], leases = [], listeners = new Map(), overlays = [];
  const window = { dspTelemetryHub: { subscribe: () => () => {} }, workletNode: { port: { postMessage() {} } },
    ThemePalette: { get: name => name === 'graph-trace' ? 'trace' : 'gray' },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type),
    audioManager: { sendSoundFontMixerAction() {}, getSfzSamplePreparation: () => null, hasNativePluginAsset: () => true,
      commitPowerTopologyMutation: message => sent.push([message.plugin.parameters.pm, message.plugin.parameters.pc]),
      powerPolicyController: { started: true, acquireLease: (reason, { mode }) => {
        leases.push([reason, mode]); return () => leases.push('released');
      } } } };
  vm.runInNewContext(axisSource, { window });
  const plugin = player({ hasLocalAudio: true, window });
  plugin._refreshBanks = async () => {};
  plugin.id = 7;
  plugin.sf = 'a'.repeat(24);
  plugin._wasmAssetStates.set(0, 3);
  plugin.createUI();
  plugin.validatePreparedSfzBank(bank([{ bank: 0, program: 0, name: 'Piano' }]));
  for (const { keyboard } of plugin._mixerRows) {
    const context = { clearRect() {}, strokeRect() {}, fillText() {}, measureText: () => ({ width: 8 }), globalAlpha: 1,
      fillRect(x) { if (this.globalAlpha !== 1) overlays.push([keyboard.dataset.channel, this.fillStyle, x]); } };
    Object.assign(keyboard, { getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0, width: 384, height: 24 }),
      setPointerCapture(id) { this.captured = id; }, hasPointerCapture(id) { return this.captured === id; },
      releasePointerCapture() { this.captured = null; } });
  }
  plugin.handleMixerTelemetry(telemetry({ note: -1 }));
  assert.equal(plugin._mixerRows[2].keyboard.style.touchAction, 'pan-y');
  const keys = window.FrequencyAxis.noteAxisKeys(0, 127, 384);
  const at = (midi, extra = {}) => {
    const key = keys.find(candidate => candidate.midi === midi);
    return { pointerId: 1, button: 0, clientX: (key.whiteStart + key.whiteEnd) / 2, clientY: 20, preventDefault() {}, ...extra };
  };
  const keyboard = plugin._mixerRows[2].keyboard;
  await keyboard.dispatchEvent('pointerdown', at(60));
  assert.deepEqual(sent, [[60, 2]]);
  assert.deepEqual(leases, [['sfz-note-preview', 'force-active']]);
  assert.equal(plugin.getWorkletPluginData().parameters.pm, 60);
  assert.deepEqual(overlays.at(-1).slice(0, 2), ['3', 'trace'], 'the pressed key is highlighted on its own row');
  await keyboard.dispatchEvent('pointermove', at(60, { clientX: at(60).clientX + 1 }));
  await keyboard.dispatchEvent('pointermove', at(62));
  await keyboard.dispatchEvent('pointermove', at(62, { pointerId: 2 }));
  assert.deepEqual(sent, [[60, 2], [62, 2]], 'only key changes from the captured pointer resend the preview');
  await keyboard.dispatchEvent('pointerup', at(62));
  assert.deepEqual(sent.at(-1), [-1, 2]);
  assert.deepEqual(leases, [['sfz-note-preview', 'force-active'], 'released']);
  assert.equal(listeners.size, 0, 'window listeners only live while a preview is held');
  assert.equal('pm' in plugin.getParameters(), false, 'preview state is never saved');

  await plugin._mixerRows[4].keyboard.dispatchEvent('pointerdown', at(64));
  assert.deepEqual(sent.at(-1), [64, 4]);
  await plugin._mixerRows[4].keyboard.dispatchEvent('pointercancel', at(64));
  assert.deepEqual(sent.at(-1), [-1, 4]);
  await keyboard.dispatchEvent('pointerdown', at(60));
  listeners.get('blur')();
  assert.deepEqual(sent.slice(-2), [[60, 2], [-1, 2]]);
  await keyboard.dispatchEvent('pointerdown', at(60));
  plugin.setParameters({ mc: 3 });
  assert.deepEqual(sent.slice(-2), [[60, 2], [-1, 2]], 'changing the channel filter stops the preview');

  const count = sent.length;
  await plugin._mixerRows[0].keyboard.dispatchEvent('pointerdown', at(60));
  assert.equal(sent.length, count, 'filtered rows do not start a preview');
  plugin.setParameters({ mc: 0, enabled: false });
  await keyboard.dispatchEvent('pointerdown', at(60));
  assert.equal(sent.length, count, 'a disabled plugin does not start a preview');
  plugin.setParameters({ enabled: true });
  await keyboard.dispatchEvent('pointerdown', at(60, { button: 2 }));
  assert.equal(sent.length, count);
  const old = keyboard;
  plugin.createUI();
  await old.dispatchEvent('pointerdown', at(60));
  assert.equal(sent.length, count, 'replaced keyboards are unbound');
});

test('SoundFont Player shows sounding voices only from valid current telemetry', () => {
  const subscriptions = [];
  const hub = { subscribe: (tap, type, callback) => {
    const entry = { tap, type, callback, removed: false }; subscriptions.push(entry);
    return () => { entry.removed = true; };
  } };
  const plugin = player({ window: { dspTelemetryHub: hub } }); plugin.id = 3;
  plugin.createUI();
  subscriptions[0].callback(telemetry());
  assert.equal(plugin._mixerState.voices, 2);
  assert.equal(plugin._mixerState.channels[0].notes[7], 16);
  const state = plugin._mixerState;
  plugin.handleMixerTelemetry(telemetry({ voices: 65 }));
  plugin.handleMixerTelemetry({ ...telemetry(), formatVersion: 1 });
  const invalidPeak = telemetry(); invalidPeak.payload.setFloat32(520, Number.NaN, true);
  plugin.handleMixerTelemetry(invalidPeak);
  const negativePeak = telemetry(); negativePeak.payload.setFloat32(520, -1, true);
  plugin.handleMixerTelemetry(negativePeak);
  assert.equal(plugin._mixerState, state);
  const unresolved = telemetry();
  unresolved.payload.setUint16(8, 0xffff, true);
  unresolved.payload.setUint8(10, 0xff);
  unresolved.payload.setUint16(18, 0xffff, true);
  plugin.handleMixerTelemetry(unresolved);
  assert.equal(plugin._mixerRows[0].patch.value, '-1', 'unresolved native patches show no guessed instrument');
  plugin.revision = 2; plugin._ensureMixerTelemetrySubscription();
  assert.equal(subscriptions[0].removed, true);
  subscriptions[0].callback(telemetry({ voices: 5 }));
  assert.equal(plugin._mixerState, null);
  subscriptions[1].callback(telemetry({ voices: 0, note: -1 }));
  assert.equal(plugin._mixerState.voices, 0);
  subscriptions[1].callback(telemetry({ voices: 1024, limit: 1024, note: -1 }));
  assert.equal(plugin._mixerState.limit, 1024);
  subscriptions[1].callback(telemetry({ voices: 0, note: -1 }));
  plugin._mixerVisible = false;
  subscriptions[1].callback(telemetry({ voices: 4 }));
  assert.equal(plugin._voiceValue.textContent, '0 / 64', 'hidden mixer does no visual work');
  plugin._mixerVisible = true; plugin.startAnimation();
  assert.equal(plugin._voiceValue.textContent, '4 / 64');
  plugin.cleanup();
  assert.equal(subscriptions[1].removed, true);
});

test('SoundFont Player summarizes sample, preset, source and playback memory separately', () => {
  const plugin = player(); plugin.sf = 'a'.repeat(24); plugin.createUI();
  plugin.validatePreparedSfzBank(bank([{ bank: 0, program: 0, name: 'Piano' }, { bank: 0, program: 0, name: 'Duplicate' }]));
  plugin._bankSourceBytes = 4194304; plugin._renderBankSummary();
  assert.equal(plugin._bankSummary.textContent, '2 samples · 1 preset · 4 MiB source · 8 MiB playback memory');
  assert.equal(plugin._bankSummary.hidden, false);
});

test('SoundFont Player remains Preparing until native bank and sample preparation are ready', async () => {
  let complete;
  let preparation = new Promise(resolve => { complete = resolve; });
  const plugin = player({ window: { audioManager: { getSfzSamplePreparation: () => preparation,
    getEffectiveActiveWasmAssetSnapshot: () => ({ ready: true }) } } });
  plugin.sf = 'a'.repeat(24); plugin.createUI();
  assert.equal(plugin._status.dataset.state, 'preparing');
  plugin._wasmAssetStates.set(0, 3); plugin._renderStatus();
  assert.equal(plugin._status.dataset.state, 'preparing');
  plugin.onSfzPreparationProgress({ phase: 'metadata', completedCount: 3, totalCount: 12, operationRevision: 1 });
  assert.equal(plugin._status.textContent, 'Reading SoundFont information… 3 / 12');
  assert.equal(plugin._preparationProgress.value, 3);
  assert.equal(plugin._preparationProgress.max, 12);
  plugin.onSfzPreparationProgress({ phase: 'native', operationRevision: 1 });
  assert.equal(plugin._status.textContent, 'Preparing instrument…');
  assert.equal(plugin._preparationProgress.hasAttribute('value'), false);
  plugin.onSfzPreparationProgress({ phase: 'prebuffer', completedBytes: 1048576, totalBytes: 2097152, operationRevision: 1 });
  assert.equal(plugin._status.textContent, 'Preparing sample cache… 1 MiB / 2 MiB');
  plugin.onSfzPreparationProgress({ phase: 'metadata', completedCount: 1, totalCount: 2, operationRevision: 2 });
  assert.equal(plugin._status.textContent, 'Preparing sample cache… 1 MiB / 2 MiB', 'stale revision progress is ignored');
  preparation = null; complete(true); await Promise.resolve();
  assert.equal(plugin._status.dataset.state, 'ready');
  assert.equal(plugin._preparationProgress.hidden, true);
  assert.equal(plugin._status.textContent, 'Ready to play.');
  plugin._error = 'sampleRead'; plugin._renderStatus();
  assert.equal(plugin._status.dataset.state, 'error');
  assert.match(plugin._status.textContent, /source files are available/);
  plugin._error = ''; plugin._missing = true; plugin._renderStatus();
  assert.equal(plugin._status.dataset.state, 'error');
  assert.match(plugin._status.textContent, /Choose it again/);
});

test('SoundFont Player uses current native readiness and explains actual sample gaps without disabling the ready mixer', () => {
  const metadata = { ready: true, preparing: false, sampleAvailable: null, sampleCount: 512,
    sourceBytes: 4194304, memoryBytes: 8388608 };
  const routinePreparation = Promise.resolve();
  const plugin = player({ hasLocalAudio: true, window: { dspTelemetryHub: { subscribe: () => () => {} }, audioManager: {
    getNativeMixerMetadata: () => metadata, getSfzSamplePreparation: () => routinePreparation,
    sendSoundFontMixerAction: async () => true
  } } });
  plugin.id = 7; plugin.sf = 'a'.repeat(24); plugin._refreshBanks = async () => {};
  plugin.createUI(); plugin.handleMixerTelemetry(telemetry());
  assert.equal(plugin._status.textContent, 'Ready to play.');
  assert.equal(plugin._mixerRows[0].knobs[0].getAttribute('aria-disabled'), 'false');
  assert.match(plugin._bankSummary.textContent, /512 samples/);
  plugin.onSfzSampleAvailability({ available: false, headroomFrames: 0 });
  assert.equal(plugin._status.textContent, 'Waiting for sample data…');
  assert.equal(plugin._status.dataset.state, 'warning');
  assert.equal(plugin._preparationProgress.hidden, true);
  assert.equal(plugin._mixerRows[0].knobs[0].getAttribute('aria-disabled'), 'false');
  metadata.sampleAvailable = true;
  plugin.onSfzSampleAvailability({ available: true, headroomFrames: null });
  assert.equal(plugin._status.textContent, 'Ready to play.');
});

test('SoundFont Player explains limited initial preloading while keeping a usable instrument editable', () => {
  const readiness = { generation: 1, scope: 2, admittedFrames: 0, readyAheadFrames: 0, plannedPages: 12, pendingPages: 8 };
  const metadata = { metadataReady: true, nativeReady: true, ready: false, preparing: true,
    cacheReady: false, limited: false, sampleAvailable: null, headroomFrames: null, streamReadiness: readiness };
  const uiManager = { t: key => key };
  const plugin = player({ hasLocalAudio: true, window: { uiManager,
    dspTelemetryHub: { subscribe: () => () => {} }, audioManager: {
      getNativeMixerMetadata: () => metadata, getSfzSamplePreparation: () => null,
      sendSoundFontMixerAction: async () => true
    } } });
  plugin.id = 7; plugin.sf = 'a'.repeat(24); plugin._refreshBanks = async () => {};
  plugin.createUI(); plugin.handleMixerTelemetry(telemetry());
  const report = phase => plugin.onSfzPreparationProgress({ phase, operationRevision: 1,
    completedCount: readiness.plannedPages - readiness.pendingPages, totalCount: readiness.plannedPages });
  report('prebuffer');
  assert.equal(plugin._status.textContent, 'Preparing sample cache… 4 / 12');
  assert.equal(plugin._preparationProgress.value, 4);
  assert.equal(plugin._preparationProgress.max, 12);
  assert.equal(plugin._mixerRows[0].knobs[0].getAttribute('aria-disabled'), 'true');
  report('ready');
  assert.equal(plugin._status.dataset.state, 'preparing', 'Native ACTIVE alone cannot finish initial sample preparation');
  assert.equal(plugin._mixerRows[0].knobs[0].getAttribute('aria-disabled'), 'true');
  metadata.ready = true; metadata.preparing = false; metadata.limited = true;
  report('limited');
  assert.equal(plugin._status.textContent, 'Limited preloading. Some notes may start late.');
  assert.equal(plugin._status.dataset.state, 'warning');
  assert.equal(plugin._status.className, 'room-eq-status');
  assert.equal(plugin._preparationProgress.hidden, true);
  assert.equal(plugin._mixerRows[0].knobs[0].getAttribute('aria-disabled'), 'false');
  uiManager.t = key => key === 'soundFontPlayer.status.limitedPreloading' ? '先読みを制限しています。一部の音の出だしが遅れる場合があります。' : key;
  plugin._renderStatus();
  assert.equal(plugin._status.textContent, '先読みを制限しています。一部の音の出だしが遅れる場合があります。');
  uiManager.t = key => key;
  metadata.sampleAvailable = false;
  plugin.onSfzSampleAvailability({ available: false, headroomFrames: 0 });
  assert.equal(plugin._status.textContent, 'Waiting for sample data…');
  assert.equal(plugin._mixerRows[0].knobs[0].getAttribute('aria-disabled'), 'false');
  metadata.sampleAvailable = true;
  plugin.onSfzSampleAvailability({ available: true, headroomFrames: null });
  assert.equal(plugin._status.textContent, 'Limited preloading. Some notes may start late.');
  readiness.pendingPages = 0; metadata.cacheReady = true; metadata.limited = false;
  report('ready');
  assert.equal(plugin._status.textContent, 'Ready to play.');
  assert.equal(metadata.headroomFrames, null, 'A ready preset prefix does not promise unknown future notes');
  readiness.scope = 1; readiness.pendingPages = 3; metadata.cacheReady = false;
  report('prebuffer');
  assert.equal(plugin._status.textContent, 'Ready to play.', 'Routine refill does not restart initial preparation');
  assert.equal(plugin._preparationProgress.hidden, true);
  assert.equal(plugin._mixerRows[0].knobs[0].getAttribute('aria-disabled'), 'false');
});
