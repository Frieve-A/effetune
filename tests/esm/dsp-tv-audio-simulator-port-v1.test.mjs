import assert from 'node:assert/strict';
import { drawHudReadings, hudTextContext } from '../helpers/hud-readings.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginPath = path.join(repoRoot, 'plugins', 'lofi', 'tv_audio_simulator.js');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.className = '';
    this.textContent = '';
    this.style = { setProperty() {} };
    this.width = 800;
    this.height = 160;
    this.clientWidth = 800;
    this.hidden = false;
    this.listeners = new Map();
    this.classList = {
      toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        const present = force === undefined ? !names.has(name) : force;
        if (present) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
        return present;
      }
    };
  }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  click() { this.listeners.get('click')?.({ target: this }); }
  querySelectorAll(selector) {
    if (!selector.startsWith('.')) return [];
    const className = selector.slice(1);
    return descendants(this).filter(element =>
      element !== this && element.className.split(/\s+/).includes(className));
  }
  getBoundingClientRect() { return { width: this.clientWidth }; }
  getContext() { return null; }
}

function descendants(element) {
  return [element, ...element.children.flatMap(descendants)];
}

async function loadPlugin({ telemetryHub = null } = {}) {
  const source = await fs.readFile(pluginPath, 'utf8');
  const cancelledFrames = [];
  let nextFrameId = 0;
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = 17;
      this.baseMessages = [];
    }
    registerProcessor(processor) { this.processor = processor; }
    parseFiniteNumber(value, minimum, maximum, fallback) {
      const number = typeof value === 'number' ? value : Number.NaN;
      if (!Number.isFinite(number)) return fallback;
      return number < minimum ? minimum : (number > maximum ? maximum : number);
    }
    updateParameters() {}
    getSerializableParameters() { return this.getParameters(); }
    getWorkletPluginData(parameters) { return parameters; }
    createCheckboxControl(label) {
      const element = new FakeElement('label'); element.textContent = label; return element;
    }
    createRadioGroup(label) {
      const element = new FakeElement('fieldset'); element.textContent = label; return element;
    }
    createParameterControl(label) {
      const element = new FakeElement('label'); element.textContent = label; return element;
    }
    createLogarithmicParameterControl(label) {
      const element = new FakeElement('label'); element.textContent = label; return element;
    }
    createResponsiveGraph() {
      const container = new FakeElement('div');
      const canvas = new FakeElement('canvas');
      container.appendChild(canvas);
      return { container, canvas, resize() {}, dispose() {} };
    }
    onMessage(message) { this.baseMessages.push(message); }
    setEnabled(enabled) {
      if (this.enabled === enabled) return;
      this.enabled = enabled;
      this._refreshAnimationState();
    }
    _setSectionEnabled(enabled) {
      const next = enabled !== false;
      if (this._sectionEnabled === next) return;
      this._sectionEnabled = next;
      this._refreshAnimationState();
    }
    setPowerUiEnabled(enabled) {
      const next = enabled !== false;
      if (this._powerUiEnabled === next) return;
      this._powerUiEnabled = next;
      this._refreshAnimationState();
    }
    _refreshAnimationState() {
      if (this.canRunAnimation()) this.startAnimation?.();
      else this.stopAnimation?.();
    }
    requestPowerAnimationFrame() {
      return this.canRunAnimation() ? ++nextFrameId : null;
    }
    canRunAnimation() {
      return this.enabled !== false && this._sectionEnabled !== false &&
        this._powerUiEnabled !== false;
    }
    cleanup() {}
    _setupMessageHandler() {}
  }
  const document = { createElement: tagName => new FakeElement(tagName) };
  const context = {
    PluginBase, drawHudReadings,
    document,
    performance: { now: () => 1000 },
    cancelAnimationFrame(id) { cancelledFrames.push(id); },
    window: {
      dspTelemetryHub: telemetryHub,
      ThemePalette: { get: token => token }
    }
  };
  vm.runInNewContext(source, context, { filename: pluginPath });
  return { Plugin: context.window.TVAudioSimulatorPlugin, source, cancelledFrames };
}

test('TV Audio Simulator exposes the production WASM contract and clean JS bypass', async () => {
  const { Plugin } = await loadPlugin();
  assert.equal(Plugin.executionCapabilities.requiresWasm, true);
  assert.deepEqual(Array.from(Plugin.executionCapabilities.supportedSampleRates), [
    44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000
  ]);
  assert.deepEqual(Array.from(Plugin.executionCapabilities.supportedChannelModes), [
    'mono', 'stereo-pair'
  ]);
  const plugin = new Plugin();
  const process = new Function('data', 'parameters', 'context', plugin.processor);
  const audio = new Float32Array([0.25, -0.5]);
  const result = process(audio, { fr: false }, {});
  assert.equal(result, audio);
  assert.deepEqual(Array.from(audio), [0.25, -0.5]);
  assert.deepEqual(audio.measurements, { bypass: true });
});

test('TV JavaScript reference processor returns finite output for each supported transmission standard',
  async () => {
    const { Plugin } = await loadPlugin();
    const process = new Function('data', 'parameters', 'context', new Plugin().processor);
    const standards = [
      'M/EIA-J', 'M/BTSC', 'M/A2', 'B/G A2',
      'B/G NICAM', 'I NICAM', 'D/K Mono', 'L AM'
    ];
    for (const standard of standards) {
      const audio = new Float32Array(64);
      for (let frame = 0; frame < 32; frame++) {
        audio[frame] = Math.sin(frame * 0.1) * 0.25;
        audio[32 + frame] = Math.cos(frame * 0.13) * 0.2;
      }
      let random = 0;
      const context = { __seededRandom: () => ((random += 0.271828) % 1) };
      const result = process(audio, {
        fr: true, enabled: true, channelCount: 2, blockSize: 32, sampleRate: 48000,
        rd: true, ss: standard, tx: standard === 'L AM' ? 'Mono' : 'Stereo',
        pr: 0, st: 35, tn: 0, bw: 230, mp: 0, dl: 5, fd: 0,
        sm: standard === 'L AM' ? 'Main' : 'Auto', bz: -80, og: 0, mx: 100
      }, context);
      assert.equal(result, audio);
      assert.equal(Array.from(audio).every(Number.isFinite), true, standard);
      assert.equal(context.tvAudioSimulator.standard, standards.indexOf(standard));
    }
  });

test('TV Audio Simulator keeps the exact 14-field public ABI and sanitizes values', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  assert.deepEqual(Object.keys(plugin.getParameters()), [
    'type', 'rd', 'ss', 'tx', 'pr', 'st', 'tn', 'bw', 'mp', 'dl', 'fd', 'sm',
    'bz', 'og', 'mx', 'fr', 'enabled'
  ]);
  plugin.setParameters({
    rd: false, ss: 'I NICAM', tx: 'Dual', pr: 99, st: -1, tn: 300, bw: 40,
    mp: 101, dl: 0, fd: 99, sm: 'Sub', bz: -10, og: -99, mx: 101
  });
  assert.deepEqual([
    plugin.rd, plugin.ss, plugin.tx, plugin.pr, plugin.st, plugin.tn, plugin.bw,
    plugin.mp, plugin.dl, plugin.fd, plugin.sm, plugin.bz, plugin.og, plugin.mx
  ], [false, 'I NICAM', 'Dual', 18, 0, 200, 80, 100, 0.5, 20, 'Sub', -20, -24, 100]);
  plugin.setParameters({ ss: 'PAL', tx: 'SAP', sm: 'Left', pr: '12' });
  assert.equal(plugin.ss, 'I NICAM');
  assert.equal(plugin.tx, 'Dual');
  assert.equal(plugin.sm, 'Sub');
  assert.equal(plugin.pr, 18);
  assert.equal(plugin.getTemporalCapability(), 'must-process');
  plugin.setParameters({ mx: 0 });
  assert.equal(plugin.getTemporalCapability(), 'reset-on-resume');

  const serialized = plugin.getSerializableParameters();
  assert.equal(Object.hasOwn(serialized, 'fr'), false);
  const worklet = plugin.getWorkletPluginData({ ...plugin.getParameters(), fr: true });
  assert.equal(Object.hasOwn(worklet, 'fr'), false);
});

test('TV Audio Simulator provides nine complete system presets', async () => {
  const { Plugin } = await loadPlugin();
  const presets = Plugin.getSystemPresetGroups()[0].presets;
  assert.deepEqual(Array.from(presets, preset => preset.id), [
    'tv-japan-eiaj', 'tv-north-america-btsc', 'tv-korea-a2', 'tv-europe-a2',
    'tv-australia-a2', 'tv-uk-nicam', 'tv-nordic-nicam',
    'tv-eastern-europe-mono', 'tv-france-l'
  ]);
  const keys = ['rd', 'ss', 'tx', 'pr', 'st', 'tn', 'bw', 'mp', 'dl', 'fd',
    'sm', 'bz', 'og', 'mx'];
  for (const preset of presets) assert.deepEqual(Array.from(Object.keys(preset.params)), keys);
  const australia = presets.find(preset => preset.id === 'tv-australia-a2');
  assert.deepEqual({ label: australia.label, ss: australia.params.ss }, {
    label: 'Australia TV (B/G / A2)', ss: 'B/G A2'
  });
});

test('TV Audio Simulator resolves programme modes consistently across standards', async () => {
  const { Plugin } = await loadPlugin();
  assert.equal(Plugin.resolveEffectiveMode('M/EIA-J', 'Stereo', 'Auto'), 'STEREO');
  assert.equal(Plugin.resolveEffectiveMode('M/EIA-J', 'Dual', 'Sub'), 'SUB');
  assert.equal(Plugin.resolveEffectiveMode('M/EIA-J', 'Dual', 'Stereo'), 'MAIN');
  assert.equal(Plugin.resolveEffectiveMode('M/BTSC', 'Dual', 'Sub'), 'MAIN');
  assert.equal(Plugin.resolveEffectiveMode('B/G NICAM', 'Dual', 'Sub'), 'SUB');
  assert.equal(Plugin.resolveEffectiveMode('D/K Mono', 'Stereo', 'Stereo'), 'MAIN');
  assert.equal(Plugin.resolveEffectiveMode('L AM', 'Stereo', 'Stereo'), 'MAIN');
  assert.equal(Plugin.resolveEffectiveMode('I NICAM', 'Stereo', 'Auto', true), 'MAIN');
});

test('TV reference ignores Receive Mode changes that do not alter its effective path', async () => {
  const { Plugin } = await loadPlugin();
  const process = new Function('data', 'parameters', 'context', new Plugin().processor);
  const changes = [
    { ss: 'M/EIA-J', tx: 'Mono', from: 'Auto', to: 'Sub' },
    { ss: 'M/BTSC', tx: 'Mono', from: 'Auto', to: 'Sub' },
    { ss: 'M/A2', tx: 'Mono', from: 'Auto', to: 'Sub' },
    { ss: 'B/G A2', tx: 'Mono', from: 'Auto', to: 'Sub' },
    { ss: 'B/G NICAM', tx: 'Mono', from: 'Auto', to: 'Sub' },
    { ss: 'I NICAM', tx: 'Mono', from: 'Auto', to: 'Sub' },
    { ss: 'D/K Mono', tx: 'Stereo', from: 'Auto', to: 'Sub' },
    { ss: 'L AM', tx: 'Stereo', from: 'Auto', to: 'Sub' },
    { ss: 'M/BTSC', tx: 'Dual', from: 'Auto', to: 'Sub' },
    { ss: 'M/EIA-J', tx: 'Dual', from: 'Auto', to: 'Main' },
    { ss: 'M/EIA-J', tx: 'Stereo', from: 'Main', to: 'Sub' },
    { ss: 'B/G NICAM', tx: 'Stereo', from: 'Auto', to: 'Stereo' }
  ];
  const makeContext = () => {
    let random = 0;
    return { __seededRandom: () => ((random += 0.271828) % 1) };
  };
  const makeAudio = phase => {
    const audio = new Float32Array(128);
    for (let frame = 0; frame < 64; frame++) {
      audio[frame] = Math.sin(phase + frame * 0.17) * 0.31;
      audio[64 + frame] = Math.cos(phase + frame * 0.11) * 0.23;
    }
    return audio;
  };
  const base = {
    fr: true, enabled: true, channelCount: 2, blockSize: 64, sampleRate: 48000,
    rd: true, pr: 0, st: 45, tn: 0, bw: 230, mp: 0, dl: 5, fd: 0,
    bz: -80, og: 0, mx: 100
  };

  for (const change of changes) {
    const controlContext = makeContext();
    const changedContext = makeContext();
    for (let block = 0; block < 3; block++) {
      const input = makeAudio(block * 0.3);
      const control = input.slice();
      const changed = input.slice();
      process(control, {
        ...base, ss: change.ss, tx: change.tx, sm: change.from
      }, controlContext);
      process(changed, {
        ...base, ss: change.ss, tx: change.tx, sm: change.from
      }, changedContext);
      assert.deepEqual(Array.from(changed), Array.from(control));
    }
    const input = makeAudio(0.9);
    const control = input.slice();
    const changed = input.slice();
    process(control, {
      ...base, ss: change.ss, tx: change.tx, sm: change.from
    }, controlContext);
    process(changed, {
      ...base, ss: change.ss, tx: change.tx, sm: change.to
    }, changedContext);
    assert.deepEqual(Array.from(changed), Array.from(control),
      `${change.ss} ${change.tx}: ${change.from} -> ${change.to}`);
    assert.equal(changedContext.tvAudioSimulator.transitionRemaining,
      controlContext.tvAudioSimulator.transitionRemaining);
  }
});

test('TV HUD follows validated execution state without waiting for processBuffer', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.lastTelemetryAt = 1000;

  plugin.onMessage({
    type: 'dspExecutionState', pluginId: 17,
    state: 'bypassed', reason: 'wasmUnavailable'
  });
  assert.equal(plugin.executionStateReceived, false);
  plugin.onMessage({
    type: 'dspExecutionState', pluginId: 18, validated: true,
    state: 'bypassed', reason: 'wasmUnavailable'
  });
  assert.equal(plugin.executionStateReceived, false);

  plugin.onMessage({
    type: 'dspExecutionState', pluginId: 17, validated: true,
    state: 'active', reason: null
  });
  assert.equal(plugin._hudMode(1000), 'active');
  plugin.onMessage({
    type: 'dspExecutionState', pluginId: 17, validated: true,
    state: 'pending', reason: null
  });
  assert.equal(plugin._hudMode(1000), 'loading');
  plugin.onMessage({
    type: 'dspExecutionState', pluginId: 17, validated: true,
    state: 'bypassed', reason: 'unsupportedSampleRate'
  });
  assert.deepEqual({ ...plugin.executionState }, {
    state: 'bypassed', reason: 'unsupportedSampleRate'
  });
  assert.equal(plugin._hudMode(1000), 'bypass');
  assert.equal(plugin.baseMessages.length, 5, 'every message also reaches PluginBase');
});

test('TV HUD draws each disabled gate once after the base loop stops', async () => {
  const { Plugin, cancelledFrames } = await loadPlugin();
  const plugin = new Plugin();
  const drawn = [];
  const drawingContext = {
    clearRect() {}, fillRect() {},
    fillText(text) { drawn.push(String(text)); }
  };
  plugin.hudCanvas = {
    width: 600, height: 120, clientWidth: 600,
    getContext: () => drawingContext
  };

  plugin.animationFrameId = 40;
  plugin.setEnabled(false);
  assert.equal(plugin.animationFrameId, null);
  assert.equal(cancelledFrames.at(-1), 40);
  assert.equal(drawn.at(-1), 'Effect is off');

  plugin.setEnabled(true);
  drawn.length = 0;
  const sectionFrame = plugin.animationFrameId;
  plugin._setSectionEnabled(false);
  assert.equal(plugin.animationFrameId, null);
  assert.equal(cancelledFrames.at(-1), sectionFrame);
  assert.equal(drawn.at(-1), 'Receiver display paused');

  plugin._setSectionEnabled(true);
  drawn.length = 0;
  const powerFrame = plugin.animationFrameId;
  plugin.setPowerUiEnabled(false);
  assert.equal(plugin.animationFrameId, null);
  assert.equal(cancelledFrames.at(-1), powerFrame);
  assert.equal(drawn.at(-1), 'Receiver display paused');
});

test('TV HUD fills and strokes the active spectrum like the FM receiver graph', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  const operations = [];
  const drawingContext = {
    ...hudTextContext,
    fillStyle: '',
    clearRect() {},
    fillRect() {},
    fillText(text) { operations.push({ type: 'text', text: String(text) }); },
    save() {}, restore() {}, translate() {}, rotate() {}, rect() {}, clip() {},
    beginPath() { operations.push({ type: 'begin' }); },
    moveTo(x, y) { operations.push({ type: 'move', x, y }); },
    lineTo(x, y) { operations.push({ type: 'line', x, y }); },
    fill() { operations.push({ type: 'fill', style: this.fillStyle }); },
    stroke() { operations.push({ type: 'stroke' }); }
  };
  plugin.hudCanvas = {
    width: 600, height: 160, clientWidth: 600,
    getContext: () => drawingContext
  };
  plugin.executionState = { state: 'active', reason: null };
  plugin.executionStateReceived = true;
  plugin.lastTelemetryAt = 1000;

  plugin.drawHud();

  const fillIndex = operations.findIndex(operation => operation.type === 'fill');
  assert.notEqual(fillIndex, -1);
  assert.equal(operations[fillIndex].style, 'graph-trace-soft');
  assert.equal(operations[fillIndex - 1].type, 'line');
  assert.equal(operations[fillIndex - 1].x, 600);
  assert.ok(operations.slice(fillIndex + 1).some(operation => operation.type === 'stroke'));
  const texts = operations.filter(operation => operation.type === 'text').map(operation => operation.text);
  assert.ok(texts.includes('Frequency (Hz)'));
  assert.ok(texts.includes('Level (dB)'));
  // The 0 dB bound sits on the top edge, so it has no tick value.
  assert.equal(operations.slice(0, fillIndex).some(operation => operation.type === 'text' && operation.text === '0'), false);
});

test('TV telemetry v1 validates its independent 216-byte payload', async () => {
  let subscription;
  const telemetryHub = {
    subscribe(tapId, frameType, handler) {
      subscription = { tapId, frameType, handler };
      return () => {};
    }
  };
  const { Plugin } = await loadPlugin({ telemetryHub });
  const plugin = new Plugin();
  assert.equal(plugin.ensureDspTelemetrySubscription(), true);
  assert.deepEqual({ tapId: subscription.tapId, frameType: subscription.frameType }, {
    tapId: 17, frameType: 25
  });
  const payload = new DataView(new ArrayBuffer(216));
  [42, 35, 0.75, 0.8, -12].forEach((value, index) =>
    payload.setFloat32(index * 4, value, true));
  payload.setUint32(20, 19, true);
  for (let bin = 0; bin < 48; bin++) payload.setFloat32(24 + 4 * bin, -80 + bin, true);
  const parsed = plugin.parseDspTelemetryFrame({ frameType: 25, formatVersion: 1, payload });
  assert.equal(parsed.carrierLevelDb, 42);
  assert.equal(parsed.cnrDb, 35);
  assert.equal(parsed.schemeHealth, 0.75);
  assert.equal(parsed.selectedBlend, Math.fround(0.8));
  assert.equal(parsed.errorCount, 19);
  assert.equal(parsed.spectrumDb.length, 48);
  assert.equal(plugin.parseDspTelemetryFrame({ frameType: 16, formatVersion: 1, payload }), null);
  assert.equal(plugin.parseDspTelemetryFrame({
    frameType: 25, formatVersion: 1, payload: new DataView(new ArrayBuffer(212))
  }), null);
  payload.setFloat32(8, Number.NaN, true);
  assert.equal(plugin.parseDspTelemetryFrame({ frameType: 25, formatVersion: 1, payload }), null);
});

test('TV UI groups controls into accessible tabs and keeps the selected tab', async () => {
  const { Plugin } = await loadPlugin();
  const plugin = new Plugin();
  plugin.setParameters({ ss: 'B/G NICAM' });
  const ui = plugin.createUI();
  const elements = descendants(ui);
  const tabs = elements.filter(element =>
    element.className.split(/\s+/).includes('tv-audio-simulator-tab'));
  assert.deepEqual(tabs
    .map(element => element.textContent), [
    'Standard', 'Programme', 'Reception', 'Video Buzz', 'Output'
  ]);
  assert.ok(tabs.every(tab => tab.getAttribute('role') === 'tab'));
  const panels = elements.filter(element =>
    element.className.split(/\s+/).includes('tv-audio-simulator-tab-content'));
  assert.equal(panels.length, 5);
  assert.ok(panels.every(panel => panel.getAttribute('role') === 'tabpanel'));
  assert.deepEqual(panels.map(panel => panel.hidden), [false, true, true, true, true]);
  assert.equal(elements.some(element =>
    element.textContent === 'Digital audio / analogue B/G FM mono fallback'), true);
  assert.equal(plugin._hudSignalLabel(), 'FALLBACK');
  plugin.hudValues.selectedBlend = 1;
  assert.equal(plugin._hudSignalLabel(), 'NICAM');
  plugin.setParameters({ ss: 'L AM' });
  assert.equal(plugin._hudSignalLabel(), 'AM');
  tabs[2].click();
  assert.equal(plugin.selectedTab, 'reception');
  assert.deepEqual(tabs.map(tab => tab.getAttribute('aria-selected')),
    ['false', 'false', 'true', 'false', 'false']);
  assert.deepEqual(panels.map(panel => panel.hidden), [true, true, false, true, true]);
  const rebuilt = plugin.createUI();
  const rebuiltTabs = descendants(rebuilt).filter(element =>
    element.className.split(/\s+/).includes('tv-audio-simulator-tab'));
  assert.equal(rebuiltTabs[2].getAttribute('aria-selected'), 'true');
});

test('TV stylesheet keeps tabbed controls and HUD responsive', async () => {
  const css = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'tv_audio_simulator.css'), 'utf8');
  assert.match(css, /\.tv-audio-simulator-tab\s*\{[\s\S]*flex:\s*1 1 100px/);
  assert.match(css, /\.tv-audio-simulator-hud\s*\{[\s\S]*min-height:\s*120px/);
  assert.match(css, /body\.layout-mobile[\s\S]*max-width:\s*100%/);
});
