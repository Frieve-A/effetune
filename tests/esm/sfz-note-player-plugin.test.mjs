import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createFakeDocument } from '../helpers/fake-dom.mjs';
import { PluginManager } from '../../js/plugin-manager.js';
import { SFZ_DEFAULT_MAX_BYTES } from '../../js/sfz/limits.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';

const source = fs.readFileSync(new URL('../../plugins/others/sfz_note_player.js', import.meta.url), 'utf8');
const axisSource = fs.readFileSync(new URL('../../plugins/frequency-axis.js', import.meta.url), 'utf8');
const noteSource = fs.readFileSync(new URL('../../plugins/analyzer/note_spectrogram.js', import.meta.url), 'utf8');

function createPlugin(service = {}, document, windowOptions = {}) {
  document ??= createDocument();
  class PluginBase {
    constructor(name) { this.name = name; this.enabled = true; this.assets = new Map(); }
    registerProcessor(source) { this.processorSource = source; }
    _setValidatedParameters(params) { if (params.enabled !== undefined) this.enabled = params.enabled; }
    parseFiniteNumber(value, min, max, fallback) {
      return Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
    }
    getParameters() { return { type: this.constructor.name, enabled: this.enabled }; }
    getWorkletPluginData(parameters = this.getParameters()) {
      const packer = DSP_PARAM_PACKERS.get(this.constructor.name);
      return { parameters, wasmParams: packer.pack(parameters), wasmParamsHash: packer.hash };
    }
    updateParameters() {}
    onMessage() {}
    canRunAnimation() { return this.enabled && this._sectionEnabled !== false && this._powerUiEnabled !== false; }
    requestPowerAnimationFrame(callback) { return this.canRunAnimation() ? windowOptions.requestAnimationFrame?.(callback) ?? null : null; }
    renderPowerUiOnce(callback) { if (!this.canRunAnimation()) callback(); }
    createResponsiveGraph(options) {
      const canvas = document.createElement('canvas');
      canvas.width = 880;
      canvas.height = 176;
      canvas.resize = dpr => options.onResize({ canvas, dpr });
      const container = document.createElement('div');
      container.appendChild(canvas);
      return { canvas, container, dispose: () => { canvas.disposed = true; } };
    }
    _registerUIControl() {}
    createParameterControl(label, min, max, step, value, setter, unit, key) {
      const row = document.createElement('div');
      row.controlKey = key;
      row.control = { label, min, max, step, value, setter, unit };
      return row;
    }
    createCheckboxControl(label, checked, setter, key) {
      const row = document.createElement('div');
      row.controlKey = key;
      row.control = { label, checked, setter };
      return row;
    }
    createRadioGroup(label, options, value, setter, key) {
      const row = document.createElement('div');
      row.controlKey = key;
      row.control = { label, options, value, setter };
      return row;
    }
    clearWasmAsset(slot) { this.assets.delete(slot); }
    setWasmAsset(slot, descriptor) { this.assets.set(slot, descriptor); }
    getWasmAssets() { return this.assets; }
    cleanup() {}
  }
  const window = { sfzLibraryService: service, addEventListener() {}, removeEventListener() {}, ...windowOptions };
  const sandbox = vm.createContext({ PluginBase, window, document, console: { error() {} },
    performance: windowOptions.performance || performance,
    cancelAnimationFrame: windowOptions.cancelAnimationFrame,
    IntersectionObserver: windowOptions.IntersectionObserver });
  vm.runInContext(axisSource, sandbox);
  vm.runInContext(noteSource, sandbox);
  vm.runInContext(source, sandbox, {
    filename: fileURLToPath(new URL('../../plugins/others/sfz_note_player.js', import.meta.url)),
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER
  });
  return new window.SFZNotePlayerPlugin();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const prepared = { descriptor: { payload: new ArrayBuffer(32), footprintBytes: 32 },
  name: 'Piano.sfz', regionCount: 1 };
const folderFiles = [{ name: 'Piano.sfz' }];

test('SFZ registration requests its stylesheet through the production plugin loader contract', () => {
  const registrations = fs.readFileSync(new URL('../../plugins/plugins.txt', import.meta.url), 'utf8');
  const { pluginDefinitions } = new PluginManager().parsePluginsDefinition(registrations);
  const definition = pluginDefinitions.get('SFZ Note Player');
  assert.equal(definition.className, 'SFZNotePlayerPlugin');
  assert.equal(definition.hasCSS, true);
  assert.equal(definition.path, 'plugins/others/sfz_note_player');
});

test('initial SFZ imports remain pending offline through bank preparation', async () => {
  const imported = deferred();
  const loaded = deferred();
  const plugin = createPlugin({ importFolderFiles: () => imported.promise, prepare: () => loaded.promise });
  plugin._refreshBanks = async () => {};
  const operation = plugin._selectBank(service => service.importFolderFiles(folderFiles, 'Piano.sfz'));
  assert.equal(plugin.externalAssetInfo.pending, true);
  assert.equal(plugin.offlineDspAssetRequired, true);
  let resolved = false;
  const resolution = plugin.resolveOfflineDspAssetRequirement().then(result => { resolved = true; return result; });
  imported.resolve({ id: 'a'.repeat(24) });
  await Promise.resolve();
  assert.equal(resolved, false);
  assert.equal(plugin.externalAssetInfo.pending, true);
  loaded.resolve(prepared);
  await operation;
  assert.equal((await resolution).required, true);
  assert.equal(plugin.externalAssetInfo.pending, false);
  assert.equal(plugin.getWasmAssets().get(0).externalAssetSignature, 'a'.repeat(24));
});

test('a later bank selection or import keeps ownership when an older import completes', async () => {
  for (const selection of ['', 'b'.repeat(24), 'a'.repeat(24), 'import']) {
    const older = deferred();
    const newer = deferred();
    let imports = 0;
    const started = deferred();
    const plugin = createPlugin({ importFolderFiles: () => {
      started.resolve();
      return (++imports === 1 ? older : newer).promise;
    },
      prepare: async () => prepared });
      plugin._refreshBanks = async () => {};
    if (selection === 'a'.repeat(24)) {
      plugin.setParameters({ sf: selection });
      await plugin.resolveOfflineDspAssetRequirement();
    }
    const operation = plugin._selectBank(service => service.importFolderFiles(folderFiles, 'Older.sfz'));
    await started.promise;
    if (selection === 'import') {
      const replacement = plugin._selectBank(service => service.importFolderFiles(folderFiles, 'Newer.sfz'));
      newer.resolve({ id: 'b'.repeat(24) });
      await replacement;
    } else plugin.setParameters({ sf: selection });
    await plugin.resolveOfflineDspAssetRequirement();
    older.resolve({ id: 'c'.repeat(24) });
    await operation;
    assert.equal(plugin.sf, selection === 'import' ? 'b'.repeat(24) : selection);
    assert.equal(plugin.externalAssetInfo?.pending ?? false, false);
    assert.equal(plugin._error, '');
  }
});

test('stale import failures and cleanup cannot change a newer pending operation', async () => {
  const older = deferred();
  const newer = deferred();
  let imports = 0;
  const started = [deferred(), deferred()];
  const plugin = createPlugin({ importFolderFiles: () => {
    started[imports].resolve();
    return (++imports === 1 ? older : newer).promise;
  } });
  const first = plugin._selectBank(service => service.importFolderFiles(folderFiles, 'Older.sfz'));
  await started[0].promise;
  const second = plugin._selectBank(service => service.importFolderFiles(folderFiles, 'Newer.sfz'));
  await started[1].promise;
  older.reject({ code: 'too-large' });
  await first;
  assert.equal(plugin.externalAssetInfo.pending, true);
  assert.equal(plugin._error, '');
  plugin.cleanup();
  newer.reject({ code: 'storage' });
  await second;
  assert.equal(plugin.externalAssetInfo, null);
  assert.equal(plugin.offlineDspAssetRequired, false);
  assert.equal(plugin._error, '');
  const failed = createPlugin({ importFolderFiles: async () => { throw { code: 'storage' }; } });
  failed._status = { dataset: {} };
  await failed._selectBank(service => service.importFolderFiles(folderFiles, 'Failure.sfz'));
  assert.equal(failed.externalAssetInfo, null);
  assert.equal(failed.offlineDspAssetRequired, false);
  assert.match(failed._status.textContent, /file permissions and available storage space/);
});

test('SFZ parameter bounds and WASM-only temporal behavior', () => {
  const plugin = createPlugin();
  assert.equal(plugin.temporalCapability, 'reset-on-resume');
  assert.equal(plugin.constructor.executionCapabilities.requiresWasm, true);
  assert.equal(plugin.processorSource, 'return data;');
  assert.equal(plugin.th, 0.75);
  assert.equal(plugin.vf, -60);
  assert.equal(plugin.vc, -10);
  assert.equal(plugin.dm, 20);
  assert.equal(plugin.wm, 100);
  assert.equal(plugin.os, 0);
  assert.equal(plugin.ss, 0);
  assert.equal(plugin.tm, 0);
  assert.equal(plugin.rd, 40);
  assert.equal(plugin.nh, 50);
  for (const key of ['lo', 'md', 'hi']) assert.equal(plugin[key], true);
  for (const [input, expected] of [[-3, -2], [-1.6, -2], [1.6, 2], [3, 2], [0, 0]]) {
    plugin.setParameters({ os: input });
    assert.equal(plugin.getParameters().os, expected);
  }
  const restored = createPlugin();
  for (const [input, expected] of [[-9, -6], [-1.6, -2], [1.6, 2], [9, 6], [NaN, 6], [0, 0]]) {
    plugin.setParameters({ ss: input });
    assert.equal(plugin.getParameters().ss, expected);
  }
  plugin.setParameters({ os: -1, ss: 1 });
  plugin.setParameters({ lo: false, md: false, hi: true, tm: -25, rd: 96, nh: 100 });
  restored.setParameters(plugin.getParameters());
  assert.equal(restored.os, -1);
  assert.equal(restored.ss, 1);
  assert.deepEqual([restored.lo, restored.md, restored.hi, restored.tm], [false, false, true, -25]);
  assert.equal(restored.rd, 96);
  assert.equal(restored.nh, 100);
  for (const [value, expected] of [[-1, 1], [200, 96], [18, 18], [NaN, 18]]) {
    plugin.setParameters({ rd: value });
    assert.equal(plugin.getParameters().rd, expected);
  }
  for (const [value, expected] of [[-1, 0], [200, 100], [37, 37], [NaN, 37]]) {
    plugin.setParameters({ nh: value });
    assert.equal(plugin.getParameters().nh, expected);
  }
  const legacy = createPlugin();
  legacy.setParameters({ th: 0.7 });
  assert.equal(legacy.getParameters().ss, 0);
  assert.equal(legacy.getParameters().rd, 40);
  assert.equal(legacy.getParameters().nh, 50);
  for (const [value, expected] of [[-200, -100], [200, 100], [12.5, 12.5]]) {
    plugin.setParameters({ tm: value });
    assert.equal(plugin.tm, expected);
  }
  plugin.setParameters({ th: 0, mn: 110, mx: 2, pl: 1000, dm: -10, wm: 200, vf: 0, vc: -60 });
  assert.equal(plugin.th, 0.01);
  assert.equal(plugin.mn, 108);
  assert.equal(plugin.mx, 108);
  assert.equal(plugin.pl, 128);
  assert.equal(plugin.dm, 0);
  assert.equal(plugin.wm, 100);
  plugin.setParameters({ dm: 75, wm: 60 });
  assert.equal(plugin.getParameters().dm, 75);
  assert.equal(plugin.getParameters().wm, 60);
  assert.equal(Object.hasOwn(plugin.getParameters(), 'mi'), false);
  assert.equal(plugin.vc, 1);
});

test('SFZ exposes retrigger drop and note hold sliders with their units', async () => {
  const plugin = createPlugin({ list: async () => [] });
  const ui = plugin.createUI();
  const row = ui.children[0].children.find(child => child.controlKey === 'rd');
  const { setter, ...control } = row.control;
  assert.deepEqual(control, { label: 'Retrigger Drop', min: 1, max: 96, step: 1, value: 40, unit: 'dB' });
  setter(96);
  assert.equal(plugin.getParameters().rd, 96);
  const hold = ui.children[0].children.find(child => child.controlKey === 'nh').control;
  assert.deepEqual({ ...hold, setter: undefined },
    { label: 'Note Hold', min: 0, max: 100, step: 1, value: 50, unit: 'ms', setter: undefined });
  hold.setter(100);
  assert.equal(plugin.getParameters().nh, 100);
  await plugin._refreshBanks();
});

test('SFZ assets carry the bank signature and pending loads remain required offline', async () => {
  let finish;
  const plugin = createPlugin({ prepare: () => new Promise(resolve => { finish = resolve; }) });
  const id = 'a'.repeat(24);
  plugin.setParameters({ sf: id });
  await Promise.resolve();
  assert.equal(plugin.externalAssetInfo.kind, 'SFZ');
  assert.equal(plugin.externalAssetInfo.pending, true);
  assert.equal(plugin.offlineDspAssetRequired, true);
  assert.equal(plugin.offlineDspAssetErrorMessageKey, 'sfzNotePlayer.error.prepare');
  const resolution = plugin.resolveOfflineDspAssetRequirement();
  finish({ descriptor: { payload: new ArrayBuffer(32), footprintBytes: 32 }, name: 'Piano.sfz', regionCount: 1 });
  await resolution;
  assert.equal(plugin.externalAssetInfo.pending, false);
  assert.equal(plugin.externalAssetInfo.assetSignature,
    plugin.getWasmAssets().get(0).externalAssetSignature);
  plugin.setParameters({ sf: '' });
  assert.equal(plugin.offlineDspAssetRequired, false);
  assert.equal(plugin.getWasmAssets().size, 0);
});

test('SFZ missing and capacity failures use plain SFZ messages', async () => {
  const missing = createPlugin({ list: async () => [], prepare: async () => null });
  missing.createUI();
  await missing._selectBank(async () => ({ id: 'a'.repeat(24) }));
  await missing.resolveOfflineDspAssetRequirement();
  assert.equal(missing.externalAssetInfo.missing, true);
  assert.match(missing._status.textContent, /selected SFZ could not be found/);
  assert.equal(missing._status.hidden, false);
  assert.equal(missing._status.dataset.state, 'error');
  const large = createPlugin({ list: async () => [], prepare: async () => { throw { code: 'too-large' }; } });
  large.createUI();
  await large._selectBank(async () => ({ id: 'b'.repeat(24) }));
  await large.resolveOfflineDspAssetRequirement();
  assert.match(large._status.textContent, /exceeds the size limit/);
  large.onWasmAssetRejected(0, 'module-budget');
  assert.equal(large._status.hidden, true, 'A later automatic rejection does not repeat the manual failure');
  assert.equal(large._error, 'tooLarge');
});

test('SFZ automatic loads stay quiet and manual selection failures show their status', async () => {
  const pending = deferred();
  const plugin = createPlugin({ list: async () => [], prepare: () => pending.promise }, createDocument());
  plugin.createUI();
  const assertQuiet = () => {
    assert.equal(plugin._status.textContent, '');
    assert.equal(plugin._status.hidden, true);
  };
  assertQuiet();
  plugin.setParameters({ sf: 'c'.repeat(24) });
  assertQuiet();
  pending.resolve({ descriptor: { payload: new ArrayBuffer(32), footprintBytes: 32 },
    name: 'Piano.sfz', regionCount: 7 });
  await plugin.resolveOfflineDspAssetRequirement();
  assertQuiet();
  plugin._isCurrentWasmAssetOperation = () => true;
  plugin.onWasmAssetState(0, 2);
  assertQuiet();
  plugin.onWasmAssetState(0, 3);
  assertQuiet();
  plugin._showError({ code: 'storage' });
  assert.equal(plugin._status.hidden, false);
  assert.equal(plugin._status.dataset.state, 'error');
  plugin.setParameters({ sf: '' });
  assertQuiet();
  const selecting = deferred();
  const search = plugin._selectBank(() => selecting.promise);
  assert.equal(plugin.externalAssetInfo.pending, true);
  assertQuiet();
  selecting.resolve(null);
  await search;
  assertQuiet();
});

test('SFZ size errors use each language’s actual settings and General labels', () => {
  for (const language of ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh']) {
    const lines = fs.readFileSync(new URL(`../../js/locales/${language}.json5`, import.meta.url), 'utf8')
      .split(/\r?\n/).map(line => line.trim());
    const strings = Object.fromEntries(['dialog.config.title', 'dialog.config.category.general',
      'dialog.config.sfzSizeLimit', 'sfzNotePlayer.error.tooLarge',
      ...['loop-points-ignored', 'invalid-regions', 'missing-samples', 'envelope-times-adjusted', 'reduced-bank']
        .map(code => `sfzNotePlayer.warning.${code}`)].map(key => {
      const line = lines.find(line => line.startsWith(`"${key}":`));
      return [key, JSON.parse(line.slice(line.indexOf(':') + 1).trim().replace(/,$/, ''))];
    }));
    const plugin = createPlugin({}, createDocument(), { uiManager: { t: key => strings[key] || key } });
    plugin._status = { dataset: {} };
    plugin._renderStatus();
    plugin._showError({ code: 'too-large' });
    const message = plugin._status.textContent;
    assert.ok(message.includes(strings['dialog.config.title']), language);
    assert.ok(message.includes(strings['dialog.config.category.general']), language);
    assert.ok(message.includes(strings['dialog.config.sfzSizeLimit']), language);
    assert.ok(plugin._warningMessage([{ code: 'reduced-bank' }])
      .includes(strings['dialog.config.sfzSizeLimit']), language);
    if (language === 'ja') assert.equal(message.includes('Config'), false);
  }
});

test('SFZ controls open the library and clear the selection without deleting an instrument', async () => {
  const entries = [{ id: 'a'.repeat(24), name: 'Piano.sfz' }];
  const plugin = createPlugin({ list: async () => entries, prepare: async () => prepared,
    remove() { assert.fail('Clearing the selection must retain the instrument'); }
  }, createDocument(), { uiManager: { t: key => `翻訳:${key}` } });
  const ui = plugin.createUI();
  let opened = false;
  plugin._openLibraryBrowser = () => { opened = true; };
  await plugin._libraryButton.dispatchEvent('click');
  assert.equal(opened, true);
  assert.equal(plugin._libraryButton.textContent, 'SFZ Library…');
  assert.equal(plugin._selectedBankName.textContent, 'None');
  assert.equal(ui.querySelectorAll('select').length, 0);
  await plugin._selectBank(async () => entries[0]);
  assert.equal(plugin._selectedBankName.textContent, 'Piano.sfz');
  await plugin._clearButton.dispatchEvent('click');
  assert.equal(plugin.sf, '');
  assert.equal(plugin._selectedBankName.textContent, 'None');
  assert.equal(plugin.getWasmAssets().size, 0);
  let disposed = false;
  plugin._libraryBrowser = { dispose() { disposed = true; } };
  plugin.cleanup();
  assert.equal(disposed, true);
});

function createDocument(canvasContext = null) {
  const document = createFakeDocument();
  const createElement = document.createElement.bind(document);
  document.createElement = tag => {
    const element = createElement(tag);
    element.dataset = {};
    element.classList = { add: name => { element.className += ` ${name}`; } };
    element.append = (...children) => children.forEach(child => element.appendChild(child));
    element.replaceChildren = (...children) => {
      element.children = [];
      element.append(...children);
    };
    element.removeEventListener = (type, listener) => {
      element.eventListeners.set(type, (element.eventListeners.get(type) || []).filter(entry => entry !== listener));
    };
    if (tag === 'canvas') {
      const pointers = new Set();
      element.getContext = () => canvasContext;
      element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 880, height: 176 });
      element.setPointerCapture = id => pointers.add(id);
      element.hasPointerCapture = id => pointers.has(id);
      element.releasePointerCapture = id => pointers.delete(id);
    }
    return element;
  };
  return document;
}

test('SFZ pointer preview holds a key, switches notes only on key changes, and uses the entry velocity', async () => {
  const messages = [];
  const leases = [];
  let released = 0;
  const plugin = createPlugin({ list: async () => [] }, createDocument(), {
    workletNode: { port: { postMessage() { assert.fail('Use the power-aware update path'); } } },
    audioManager: {
      commitPowerTopologyMutation(message, options) { messages.push(message); assert.equal(options.reason, 'sfz-note-preview'); },
      powerPolicyController: { started: true, acquireLease(reason, options) {
        leases.push([reason, options.mode]);
        return () => released++;
      } }
    }
  });
  plugin.mn = 60;
  plugin.mx = 71;
  plugin.setWasmAsset(0, prepared.descriptor);
  plugin.createUI();
  const canvas = plugin.canvas;
  const rect = { left: 50, top: 20, width: 440, height: 88 };
  canvas.getBoundingClientRect = () => rect;
  const { keys, edge, gutter, blackDepth } = plugin._graphLayout();
  const xAt = midi => {
    const key = keys.find(key => key.midi === midi);
    return (key.start + key.end) / 2;
  };
  const eventAt = (x, y, extras = {}) => ({ pointerId: 1, pointerType: 'touch', button: 0,
    clientX: rect.left + x * rect.width / canvas.width,
    clientY: rect.top + y * rect.height / canvas.height, preventDefault() {}, ...extras });
  const play = (type, midi, y, extras) => canvas.dispatchEvent(type, eventAt(xAt(midi), y, extras));
  await play('pointerdown', 60, edge + gutter * .9, { button: 2 });
  assert.equal(messages.length, 0);
  await play('pointerdown', 60, edge + gutter * .9);
  assert.equal(canvas.hasPointerCapture(1), true);
  assert.equal(messages.at(-1).plugin.parameters.pm, 60);
  assert.equal(messages.at(-1).plugin.parameters.pv, 100);
  await play('pointerdown', 64, edge / 2, { pointerId: 2 });
  await play('pointermove', 60, edge / 2);
  assert.equal(messages.length, 1, 'Moving vertically within one note retains its attack and velocity');
  await play('pointermove', 61, edge + blackDepth / 2);
  assert.equal(messages.at(-1).plugin.parameters.pm, 61, 'The black-key shape must match its drawing');
  assert.equal(messages.at(-1).plugin.parameters.pv, 100);
  await play('pointermove', 61, edge * .3);
  assert.equal(messages.length, 2, 'Crossing into the graph on the same note must not retrigger');
  await play('pointermove', 62, edge * (1 - 64 / 127));
  assert.equal(messages.at(-1).plugin.parameters.pm, 62);
  assert.equal(messages.at(-1).plugin.parameters.pv, 64);
  await play('pointermove', 62, edge * .1);
  assert.equal(messages.length, 3);
  await canvas.dispatchEvent('pointermove', eventAt(canvas.width, 0));
  assert.equal(messages.at(-1).plugin.parameters.pm, 71);
  assert.equal(messages.at(-1).plugin.parameters.pv, 127);
  assert.equal('pm' in plugin.getParameters(), false, 'Preview state must not be saved in presets');
  assert.deepEqual(Array.from(messages.at(-1).plugin.wasmParams.slice(17, 19)), [71, 127]);
  await canvas.dispatchEvent('pointerup', eventAt(-100, -100));
  assert.equal(messages.at(-1).plugin.parameters.pm, -1);
  assert.equal(canvas.hasPointerCapture(1), false);
  assert.deepEqual(leases, [['sfz-note-preview', 'force-active']]);
  assert.equal(released, 1);
  const white = keys.find(key => key.midi === 60);
  await canvas.dispatchEvent('pointerdown', eventAt(white.whiteEnd - 1, edge + gutter * .9));
  assert.equal(messages.at(-1).plugin.parameters.pm, 60, 'The white key continues beneath its neighboring black key');
  assert.equal(messages.at(-1).plugin.parameters.pv, 100);
  await canvas.dispatchEvent('pointercancel', { pointerId: 1 });
  assert.equal(messages.at(-1).plugin.parameters.pm, -1);
  plugin.cleanup();
});

test('SFZ preview releases on capture loss, blur, bank changes, disable, UI replacement and cleanup', async () => {
  for (const end of ['capture', 'blur', 'bank', 'disable', 'replace', 'cleanup']) {
    const messages = [];
    const listeners = new Map();
    const plugin = createPlugin({ list: async () => [] }, createDocument(), {
      workletNode: { port: { postMessage: message => messages.push(message) } },
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: type => listeners.delete(type)
    });
    plugin.createUI();
    const canvas = plugin.canvas;
    plugin.sf = 'a'.repeat(24);
    plugin.setWasmAsset(0, prepared.descriptor);
    const { edge } = plugin._graphLayout();
    await canvas.dispatchEvent('pointerdown', { pointerId: 5, button: 0, clientX: 200,
      clientY: edge - .01, preventDefault() {} });
    assert.equal(messages.at(-1).plugin.parameters.pv, 1);
    if (end === 'capture') await canvas.dispatchEvent('lostpointercapture', { pointerId: 5 });
    if (end === 'blur') listeners.get('blur')();
    if (end === 'bank') plugin.setParameters({ sf: '' });
    if (end === 'disable') plugin.setParameters({ enabled: false });
    if (end === 'replace') plugin.createUI();
    if (end === 'cleanup') plugin.cleanup();
    assert.equal(messages.at(-1).plugin.parameters.pm, -1, end);
    assert.equal(canvas.hasPointerCapture(5), false, end);
    if (end === 'replace' || end === 'cleanup') {
      const count = messages.length;
      await canvas.dispatchEvent('pointerdown', { pointerId: 6, button: 0, clientX: 200,
        clientY: 40, preventDefault() {} });
      assert.equal(messages.length, count, 'Disposed canvases must not start new previews');
    }
    plugin.cleanup();
  }
});

function voiceFrame(notes = [], limit = 32) {
  const payload = new DataView(new ArrayBuffer(1028));
  payload.setUint16(0, notes.reduce((sum, note) => sum + note.count, 0), true);
  payload.setUint16(2, limit, true);
  for (const { midi, count, velocity } of notes) {
    payload.setUint16(4 + midi * 8, count, true);
    payload.setFloat32(8 + midi * 8, velocity, true);
  }
  return { frameType: 30, formatVersion: 1, payload };
}

test('SFZ Color uses the Note Spectrogram palette for sounding keys and decaying bars without resetting them', () => {
  const fills = [];
  const context = {
    fillRect(x, y, width, height) { fills.push({ color: this.fillStyle, x, y, width, height }); },
    measureText: text => ({ width: text.length * 6 }),
    createLinearGradient: () => ({ addColorStop() {} })
  };
  for (const method of ['strokeRect', 'strokeText', 'fillText', 'save', 'restore', 'translate',
    'rotate', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'rect', 'clip', 'fill']) context[method] = () => {};
  const palette = { 'graph-bg-deep': 'rgb(16,16,16)', 'graph-trace': 'rgb(30,180,120)',
    'graph-label': 'rgb(200,200,200)', 'graph-grid-subtle': 'rgb(40,40,40)', 'text-primary': 'rgb(240,240,240)' };
  const plugin = createPlugin({ list: async () => [] }, createDocument(context), {
    performance: { now: () => 0 }, ThemePalette: { get: key => palette[key] }
  });
  const ui = plugin.createUI();
  const controls = ui.children[0];
  const color = controls.children.find(row => row.controlKey === 'cl').control;
  assert.equal(color.label, 'Color');
  assert.equal(color.value, 'Normal');
  assert.deepEqual(Array.from(color.options, option => [option.value, option.label]),
    [['Normal', 'Normal'], ['Rainbow', 'Note Colors']]);
  plugin.handleTelemetry(voiceFrame([{ midi: 60, count: 1, velocity: .75 },
    { midi: 61, count: 1, velocity: .5 }, { midi: 72, count: 1, velocity: .25 }]));
  const { keys, edge } = plugin._graphLayout();
  const bar = midi => {
    const start = keys.find(key => key.midi === midi).start;
    return fills.find(fill => fill.y < edge && fill.x === start + .5 && fill.width < plugin.canvas.width);
  };
  fills.length = 0;
  plugin.drawGraph(0);
  const initialHeight = bar(60).height;
  assert.equal(bar(60).color, palette['graph-trace']);
  fills.length = 0;
  color.setter('Rainbow');
  assert.equal(plugin.getParameters().cl, 'Rainbow');
  assert.equal(bar(60).color, 'rgb(170,98,86)');
  assert.equal(bar(61).color, 'rgb(161,105,57)');
  assert.equal(bar(72).color, bar(60).color, 'The same note color repeats across octaves');
  assert.equal(bar(60).height, initialHeight, 'Changing Color must preserve the velocity decay');
  assert.ok(fills.some(fill => fill.y === edge && fill.color === 'rgb(170,98,86)'), 'The sounding white key uses its note color');
  assert.ok(fills.some(fill => fill.y === edge && fill.color === 'rgb(161,105,57)'), 'The sounding black key uses its note color');
  const restored = createPlugin();
  restored.setParameters(plugin.getParameters());
  assert.equal(restored.cl, 'Rainbow');
  restored.setParameters({ cl: 'invalid' });
  assert.equal(restored.cl, 'Rainbow');
  assert.equal(createPlugin().getParameters().cl, 'Normal');
  plugin.handleTelemetry(voiceFrame());
  fills.length = 0;
  plugin.drawGraph(1000);
  assert.equal(bar(60).color, 'rgb(170,98,86)');
  assert.ok(Math.abs(bar(60).height / initialHeight - Math.exp(-1)) < 1e-8);
  fills.length = 0;
  color.setter('Normal');
  assert.equal(bar(60).color, palette['graph-trace']);
  assert.equal(plugin._activeVoices, 0);
  plugin.cleanup();
});

test('SFZ keyboard highlights sounding keys and its velocity bars decay independently of voice counts', () => {
  const fills = [];
  const lines = [];
  const rotations = [];
  const context = {
    fillRect(x, y, width, height) { fills.push({ color: this.fillStyle, x, y, width, height }); },
    strokeRect() {}, strokeText() {}, fillText(text, x, y) {
      this.labels ??= [];
      this.labels.push({ text, x, y, color: this.fillStyle, font: this.font,
        align: this.textAlign, rotation: this.rotation || 0 });
    },
    measureText(text) {
      return { width: Array.from(text, character => character === ' ' ? 3 : character === '1' ? 4 : 7)
        .reduce((sum, width) => sum + width, 0) * parseFloat(this.font) / 12 };
    },
    save() { rotations.push(this.rotation || 0); }, restore() { this.rotation = rotations.pop(); },
    translate() {}, rotate(angle) { this.rotation = (this.rotation || 0) + angle; },
    beginPath() { this.path = []; }, moveTo(x, y) { this.path.push([x, y]); },
    lineTo(x, y) { this.path.push([x, y]); },
    stroke() { lines.push({ points: this.path, color: this.strokeStyle, width: this.lineWidth }); },
    rect() {}, clip() {}, fill() {},
    createLinearGradient: () => ({ addColorStop() {} })
  };
  let now = 0;
  const colors = { 'graph-bg-deep': 'rgb(16,16,16)', 'graph-trace': 'rgb(30,180,120)',
    'graph-label': 'rgb(200,200,200)', 'graph-grid-subtle': 'rgb(40,40,40)', 'text-primary': 'rgb(240,240,240)' };
  const plugin = createPlugin({ list: async () => [] }, createDocument(context), {
    performance: { now: () => now }, ThemePalette: { get: key => colors[key] }
  });
  plugin.createUI();
  assert.match(plugin.canvas.getAttribute('aria-label'), /Sounding SFZ notes/);
  const edge = () => plugin.canvas.height - Math.min(12 * plugin.canvas.width / (plugin.mx - plugin.mn + 1) * (150 / (7 * 23.5) / 2), plugin.canvas.height / 2);
  const draw = () => {
    fills.length = 0;
    lines.length = 0;
    context.labels = [];
    plugin.drawGraph(now);
    return fills.filter(fill => fill.color === colors['graph-trace'] && fill.y < edge() - 1e-8 && fill.width < plugin.canvas.width);
  };
  plugin.handleTelemetry(voiceFrame([{ midi: 60, count: 2, velocity: 1 }, { midi: 61, count: 1, velocity: .5 }]));
  const bars = draw();
  assert.equal(bars[0].y, 0, 'Velocity 127 reaches the canvas top without reserving space for Voices');
  assert.equal(bars[0].height, edge());
  assert.match(plugin.canvas.getAttribute('aria-label'), /Voices: 3 \/ 32/);
  assert.ok(context.labels.some(label => label.text === 'Voices:' && label.x < 876 && label.y === 16));
  assert.ok(context.labels.some(label => label.text === '3 / 32' && label.x === 876 && label.y === 16));
  const title = context.labels.find(label => label.text === 'Velocity');
  assert.equal(title.rotation, -Math.PI / 2);
  assert.equal(title.font, '14px Arial');
  assert.equal(title.color, colors['text-primary']);
  for (const [index, velocity] of [32, 64, 96].entries()) {
    const line = lines[index];
    assert.equal(line.color, colors['graph-grid-subtle']);
    assert.equal(line.width, 1);
    assert.deepEqual(line.points.map(point => point[0]), [0, plugin.canvas.width]);
    assert.ok(Math.abs(line.points[0][1] - (edge() - bars[0].height * velocity / 127)) < 1e-8);
    assert.equal(line.points[0][1], line.points[1][1]);
    const label = context.labels.find(label => label.text === `${velocity}`);
    assert.equal(label.color, colors['graph-label']);
    assert.equal(label.font, '12px Arial');
    assert.equal(label.rotation, 0);
    assert.ok(Math.abs(label.y - line.points[0][1] - 6) < 1e-8);
  }
  assert.equal(bars.length, 2);
  assert.equal(bars[0].x, 440.5);
  assert.equal(bars[1].x, 454.25);
  assert.equal(bars[1].height, bars[0].height / 2);
  assert.ok(fills.some(fill => fill.color === colors['graph-trace'] && Math.abs(fill.y - edge()) < 1e-8 && Math.abs(fill.height - (plugin.canvas.height - edge())) < 1e-8));
  assert.ok(fills.some(fill => fill.color === colors['graph-trace'] && Math.abs(fill.y - edge()) < 1e-8 && fill.height < plugin.canvas.height - edge()));
  now = 1000;
  const decayed = draw();
  assert.ok(Math.abs(decayed[0].height / bars[0].height - Math.exp(-1)) < 1e-8);
  assert.equal(plugin._voiceCounts[60], 2, 'Sustaining and release voices stay lit while velocity decays');
  plugin.handleTelemetry(voiceFrame([{ midi: 60, count: 1, velocity: .75 }]));
  assert.ok(Math.abs(draw()[0].height - bars[0].height * .75) < 1e-8, 'A new attack refreshes the velocity bar');
  assert.match(plugin.canvas.getAttribute('aria-label'), /Voices: 1 \/ 32/);
  colors['graph-bg-deep'] = 'rgb(255,255,255)';
  draw();
  assert.ok(fills.some(fill => fill.color === 'rgb(255,255,255)' && Math.abs(fill.y - edge()) < 1e-8));
  plugin.setParameters({ mn: 60, mx: 72 });
  plugin._clearVoiceDisplay();
  plugin.handleTelemetry(voiceFrame([{ midi: 59, count: 1, velocity: .75 }, { midi: 73, count: 1, velocity: .5 }]));
  assert.equal(draw().length, 0, 'Lowest Note and Highest Note limit the visible range');
  plugin.handleTelemetry(voiceFrame([{ midi: 60, count: 1, velocity: .75 }, { midi: 72, count: 1, velocity: .5 }]));
  const ranged = draw();
  assert.equal(ranged.length, 2);
  assert.equal(ranged[0].x, .5);
  assert.ok(Math.abs(ranged[1].x - (880 * 12 / 13 + .5)) < 1e-8);
  assert.equal(edge(), plugin.canvas.height / 2, 'The keyboard depth uses the same cross-axis limit as Note Spectrogram');
  now += 250;
  plugin.handleTelemetry(voiceFrame());
  const tails = draw();
  assert.equal(tails.length, 2, 'Velocity bars remain when the last sample voices finish');
  assert.ok(Math.abs(tails[0].height - ranged[0].height * Math.exp(-.25)) < 1e-5);
  assert.equal(plugin._voiceCounts[60], 0);
  assert.equal(plugin._activeVoices, 0);
  assert.ok(!fills.some(fill => fill.color === colors['graph-trace'] && fill.y >= edge()), 'Released keys are no longer lit');
  now += 250;
  plugin.handleTelemetry(voiceFrame());
  assert.ok(Math.abs(draw()[0].height - ranged[0].height * Math.exp(-.5)) < 1e-5, 'Silent snapshots keep the same time decay');
  now += 10000;
  assert.equal(draw().length, 0);
  assert.match(plugin.canvas.getAttribute('aria-label'), /Voices: 0 \/ 32/);
  plugin.handleTelemetry(voiceFrame([{ midi: 60, count: 1, velocity: .4 }]));
  assert.ok(Math.abs(draw()[0].height - edge() * .4) < 1e-5, 'A new note starts at its own velocity');
  plugin.setParameters({ mn: 61 });
  assert.equal(draw().length, 0, 'A partially visible white key outside the note range cannot add a velocity bar');
  plugin.handleTelemetry(voiceFrame());
  plugin.setParameters({ pl: 64 });
  assert.match(plugin.canvas.getAttribute('aria-label'), /Voices: 0 \/ 64/);
  plugin.canvas.width = 780;
  plugin.canvas.height = 260;
  plugin.canvas.resize(2);
  draw();
  assert.equal(context.labels.find(label => label.text === 'Velocity').font, '26px Arial');
  assert.equal(context.labels.find(label => label.text === '64').font, '22px Arial');
  assert.equal(lines[0].width, 2);
  for (const dpr of [1, 2]) {
    plugin.canvas.width = 390 * dpr;
    plugin.canvas.height = 130 * dpr;
    plugin.canvas.resize(dpr);
    for (const [limit, counts] of [[9, [0, 1, 8, 9]], [32, [0, 1, 9, 10, 32]], [128, [0, 9, 10, 99, 100, 128]]]) {
      plugin.setParameters({ pl: limit });
      let labelX;
      for (const count of counts) {
        plugin.handleTelemetry(voiceFrame(count ? [{ midi: 60, count, velocity: .4 }] : [], limit));
        draw();
        const label = context.labels.find(label => label.text === 'Voices:');
        const value = context.labels.find(label => label.text === `${count} / ${limit}`);
        labelX ??= label.x;
        assert.equal(label.x, labelX, `Voices label must stay fixed at ${count} / ${limit}`);
        assert.equal(value.x, plugin.canvas.width - 4 * dpr);
        assert.equal(label.y, 16 * dpr);
        assert.equal(value.y, label.y);
        assert.equal(label.align, 'right');
        assert.equal(value.align, 'right');
        assert.equal(label.font, `${11 * dpr}px Arial`);
        assert.equal(value.font, label.font);
        assert.equal(label.color, colors['graph-label']);
        assert.equal(value.color, label.color);
        assert.ok(label.x <= value.x - context.measureText(` ${value.text}`).width,
          'The reserved space must fit the full count and keep a gap after the label');
        assert.match(plugin.canvas.getAttribute('aria-label'), new RegExp(`Voices: ${count} / ${limit}`));
      }
    }
  }
  plugin.cleanup();
});

test('SFZ voice display rejects malformed snapshots and clears when the instrument or effect is disabled', () => {
  const plugin = createPlugin({ list: async () => [] });
  plugin.createUI();
  const valid = voiceFrame([{ midi: 72, count: 1, velocity: .6 }]);
  plugin.handleTelemetry(valid);
  const invalid = [
    { ...valid, frameType: 24 }, { ...valid, formatVersion: 2 },
    { ...valid, payload: new DataView(new ArrayBuffer(4)) },
    voiceFrame([{ midi: 60, count: 1, velocity: NaN }]),
    voiceFrame([{ midi: 60, count: 1, velocity: 1.1 }]),
    voiceFrame([{ midi: 60, count: 1, velocity: .5 }], 0)
  ];
  const inconsistent = voiceFrame([{ midi: 60, count: 1, velocity: .5 }]);
  inconsistent.payload.setUint16(0, 2, true);
  invalid.push(inconsistent);
  for (const frame of invalid) {
    plugin.handleTelemetry(frame);
    assert.equal(plugin._voiceCounts[72], 1);
    assert.equal(plugin._voiceCounts[60], 0);
  }
  plugin.sf = 'a'.repeat(24);
  plugin.setParameters({ sf: '' });
  assert.equal(plugin._activeVoices, 0);
  plugin.handleTelemetry(valid);
  plugin.setParameters({ enabled: false });
  plugin.handleTelemetry(valid);
  assert.equal(plugin._activeVoices, 0);
  assert.match(plugin.canvas.getAttribute('aria-label'), /Voices: 0 \/ 32/);
  plugin.cleanup();
});

test('SFZ display redraw and telemetry subscriptions follow visibility, power state, UI replacement and cleanup', () => {
  const subscriptions = [];
  const observers = [];
  const callbacks = new Map();
  let nextFrame = 0;
  const plugin = createPlugin({ list: async () => [] }, createDocument(), {
    dspTelemetryHub: { subscribe: (id, type, callback) => {
      const entry = { id, type, callback, disposed: false };
      subscriptions.push(entry);
      return () => { entry.disposed = true; };
    } },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    requestAnimationFrame: callback => { callbacks.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => callbacks.delete(id)
  });
  plugin.id = 17;
  plugin.createUI();
  assert.equal(callbacks.size, 0);
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].type, 30);
  observers[0].callback([{ isIntersecting: true }]);
  assert.equal(callbacks.size, 1);
  observers[0].callback([{ isIntersecting: false }]);
  assert.equal(callbacks.size, 0);
  plugin._powerUiEnabled = false;
  observers[0].callback([{ isIntersecting: true }]);
  assert.equal(callbacks.size, 0);
  plugin._powerUiEnabled = true;
  const oldCanvas = plugin.canvas;
  plugin.createUI();
  assert.equal(oldCanvas.disposed, true);
  assert.equal(observers[0].disconnected, true);
  assert.equal(subscriptions.length, 1);
  plugin.id = 18;
  plugin.onMessage({});
  assert.equal(subscriptions[0].disposed, true);
  assert.equal(subscriptions[1].id, 18);
  observers[1].callback([{ isIntersecting: true }]);
  const canvas = plugin.canvas;
  plugin.cleanup();
  assert.equal(callbacks.size, 0);
  assert.equal(observers[1].disconnected, true);
  assert.equal(canvas.disposed, true);
  assert.equal(subscriptions[1].disposed, true);
});

test('SFZ UI uses independent Dry/Wet controls and standard-width readable note names', async () => {
  const document = createDocument();
  const plugin = createPlugin({ list: async () => [] }, document);
  const ui = plugin.createUI();
  assert.match(ui.className, /plugin-parameter-ui/);
  assert.equal(plugin._status.getAttribute('role'), 'status');
  const controls = ui.children.find(child => child.className === 'sfz-controls analyzer-parameters');
  assert.equal(controls.className, 'sfz-controls analyzer-parameters');
  assert.equal(controls.children.length, 21);
  assert.equal(controls.children[0].className, 'parameter-row sfz-bank-row local-audio-only');
  assert.deepEqual(controls.children.filter(row => row.controlKey).map(row => row.controlKey),
    ['dt', 'cl', 'hi', 'md', 'lo', 'th', 'rd', 'nh', 'vf', 'vc', 'pl', 'dm', 'wm', 'os', 'ss', 'og', 'tm']);
  const detection = controls.children.find(row => row.controlKey === 'dt').control;
  assert.equal(detection.value, 'Classic');
  assert.equal(detection.options[0].label, 'Classic (Low Latency)');
  const retriggerInputs = [document.createElement('input'), document.createElement('input')];
  const thresholdInputs = [document.createElement('input'), document.createElement('input')];
  plugin._retriggerControl.querySelectorAll = () => retriggerInputs;
  plugin._thresholdControl.querySelectorAll = () => thresholdInputs;
  plugin.setParameters({ rd: 42 });
  assert.ok(retriggerInputs.every(input => input.disabled === false));
  assert.ok(thresholdInputs.every(input => input.disabled === false));
  detection.setter('Event');
  assert.ok(retriggerInputs.every(input => input.disabled === true));
  assert.ok(thresholdInputs.every(input => input.disabled === true));
  assert.equal(plugin.getParameters().dt, 'Event');
  const restored = createPlugin();
  restored.setParameters(plugin.getParameters());
  assert.equal(restored.getParameters().dt, 'Event');
  restored.setParameters({ dt: 'invalid' });
  assert.equal(restored.getParameters().dt, 'Event');
  detection.setter('Classic');
  assert.equal(plugin.getParameters().dt, 'Classic');
  assert.ok(retriggerInputs.every(input => input.disabled === false));
  assert.ok(thresholdInputs.every(input => input.disabled === false));
  assert.equal(plugin.getParameters().rd, 42);
  for (const [index, key, label] of [[0, 'hi', 'Highest'], [1, 'md', 'Middle'], [2, 'lo', 'Lowest']]) {
    const control = controls.children[index + 4].control;
    assert.equal(control.label, label);
    assert.equal(control.checked, true);
    control.setter(false);
    assert.equal(plugin.getParameters()[key], false);
  }
  for (const [key, label, value] of [['dm', 'Dry', 20], ['wm', 'Wet', 100]]) {
    const control = controls.children.find(row => row.controlKey === key).control;
    assert.deepEqual({ ...control, setter: undefined },
      { label, min: 0, max: 100, step: 1, value, setter: undefined, unit: '%' });
    control.setter(40);
    assert.equal(plugin[key], 40);
  }
  const octave = controls.children.find(row => row.controlKey === 'os');
  assert.equal(octave.controlKey, 'os');
  assert.deepEqual({ ...octave.control, setter: undefined },
    { label: 'Octave', min: -2, max: 2, step: 1, value: 0, setter: undefined, unit: '' });
  octave.control.setter(-2);
  assert.equal(plugin.getParameters().os, -2);
  const sampleShift = controls.children.find(row => row.controlKey === 'ss').control;
  assert.deepEqual({ ...sampleShift, setter: undefined },
    { label: 'Sample Shift', min: -6, max: 6, step: 1, value: 0, setter: undefined, unit: '' });
  sampleShift.setter(1);
  assert.equal(plugin.getParameters().ss, 1);
  assert.equal(controls.children.at(-4).controlKey, 'og');
  const timing = controls.children.at(-3);
  assert.equal(timing.controlKey, 'tm');
  assert.deepEqual({ ...timing.control, setter: undefined },
    { label: 'Timing', min: -100, max: 100, step: 1, value: 0, setter: undefined, unit: 'ms' });
  timing.control.setter(-40);
  assert.equal(plugin.getParameters().tm, -40);
  assert.equal(controls.children.at(-2).children.at(-1).className, 'sfz-note-value');
  assert.equal(controls.children.at(-2).children.at(-1).readOnly, true);
  assert.equal(controls.children.at(-2).children.at(-1).value, 'E1');
  const noteSlider = controls.children.at(-2).children[1];
  await noteSlider.dispatchEvent('input', { target: { value: '60' } });
  assert.equal(plugin.mn, 60);
  assert.equal(controls.children.at(-2).children.at(-1).value, 'C4');
  await Promise.resolve();
  assert.equal(plugin._clearButton.disabled, true);
});

test('SFZ load problems show once per selection, with Close, Escape and cleanup', async () => {
  const document = createDocument();
  const problem = { ...prepared, warnings: [{ code: 'loop-points-ignored', count: 1 }] };
  const plugin = createPlugin({ list: async () => [], prepare: async () => problem }, document);
  plugin._isCurrentWasmAssetOperation = () => true;
  plugin.createUI();
  const notices = () => document.body.children.filter(x => x.className.includes('sfz-load-notice-overlay'));
  await plugin._selectBank(async () => ({ id: 'a'.repeat(24) }));
  await plugin._pending;
  assert.equal(notices().length, 0, 'A recovered warning waits for actual asset readiness');
  plugin.onWasmAssetState(0, 3, 1);
  assert.equal(notices().length, 1);
  assert.match(notices()[0].children[0].children[1].textContent, /loop settings/);
  assert.equal(plugin._status.hidden, true, 'Recovered warnings are dialog-only');
  await notices()[0].children[0].children[2].children[0].dispatchEvent('click');
  plugin.createUI();
  plugin._renderStatus();
  await plugin.resolveOfflineDspAssetRequirement();
  plugin.setParameters({ th: .4, sf: 'a'.repeat(24) });
  assert.equal(notices().length, 0, 'Redraw, parameter updates and offline waits do not repeat a notice');
  await plugin._selectBank(async () => ({ id: 'b'.repeat(24) }));
  await plugin._pending;
  plugin.onWasmAssetState(0, 3, 2);
  assert.equal(notices().length, 1);
  await document.dispatchEvent('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(notices().length, 0);
  assert.equal(document.listenerCount('keydown'), 0);
  await plugin._selectBank(async () => ({ id: 'c'.repeat(24) }));
  await plugin._pending;
  plugin.onWasmAssetState(0, 3, 3);
  plugin.cleanup();
  assert.equal(notices().length, 0);
  assert.equal(document.listenerCount('keydown'), 0);
});

test('first WASM admission and preparation failures take priority over recovered warnings', async () => {
  for (const failure of ['admission', 'preparation']) {
    const document = createDocument();
    const plugin = createPlugin({ list: async () => [], prepare: async () => ({ ...prepared,
      warnings: [{ code: 'loop-points-ignored', count: 1 }] }) }, document);
    plugin._isCurrentWasmAssetOperation = (slot, revision) => revision === 2;
    plugin.createUI();
    await plugin._selectBank(async () => ({ id: 'a'.repeat(24) }));
    await plugin._pending;
    const notices = () => document.body.children.filter(x => x.className.includes('sfz-load-notice-overlay'));
    plugin.onWasmAssetRejected(0, 'capacity', 1);
    plugin.onWasmAssetState(0, 4, 1);
    assert.equal(notices().length, 0);
    plugin.setParameters({ tm: 20, lo: false });
    const fail = () => failure === 'admission'
      ? plugin.onWasmAssetRejected(0, 'module-budget', 2) : plugin.onWasmAssetState(0, 4, 2);
    fail();
    assert.equal(notices().length, 1);
    assert.equal(notices()[0].children[0].children[1].textContent, plugin._status.textContent);
    assert.doesNotMatch(plugin._status.textContent, /adjusted|loaded\.$/);
    await notices()[0].children[0].children[2].children[0].dispatchEvent('click');
    fail();
    plugin.onWasmAssetState(0, 3, 2);
    assert.equal(notices().length, 0, 'Repeated DSP and replay events do not reopen a load notice');
    plugin.cleanup();
  }
});

test('SFZ load dialogs exclude normal, cancelled and stale loads but explain the current failure', async () => {
  const document = createDocument();
  const older = deferred();
  let result = prepared;
  const plugin = createPlugin({ list: async () => [], prepare: id =>
    id === 'a'.repeat(24) ? older.promise : Promise.resolve(result) }, document);
  plugin.createUI();
  const notices = () => document.body.children.filter(x => x.className.includes('sfz-load-notice-overlay'));
  plugin._selectBank(async () => ({ id: 'a'.repeat(24) }));
  await Promise.resolve();
  await Promise.resolve();
  const oldLoad = plugin._pending;
  await plugin._selectBank(async () => ({ id: 'b'.repeat(24) }));
  await plugin._pending;
  older.resolve({ ...prepared, warnings: [{ code: 'missing-samples', count: 1 }] });
  await oldLoad;
  assert.equal(notices().length, 0);
  await plugin._selectBank(async () => { throw { name: 'AbortError' }; });
  assert.equal(notices().length, 0);
  await plugin._selectBank(async () => { throw { code: 'prepare', message: 'private raw detail' }; });
  assert.equal(notices().length, 1);
  assert.equal(notices()[0].children[0].children[1].textContent, plugin._status.textContent);
  assert.doesNotMatch(plugin._status.textContent, /private raw detail/);
  assert.equal(plugin._status.hidden, false);
  plugin.cleanup();
  result = null;
  plugin.setParameters({ sf: 'c'.repeat(24) });
  await plugin._pending;
  assert.equal(notices().length, 0, 'Loads without a UI do not create dialogs');
  plugin.createUI();
  assert.equal(notices().length, 0, 'Automatic preset restoration stays silent when its UI opens');
  assert.equal(plugin._status.hidden, true);
  assert.equal(plugin.externalAssetInfo.missing, true);
  plugin.cleanup();
});

test('only explicit SFZ loading owns a notice, not preset restoration or later DSP failures', async () => {
  const document = createDocument();
  let result = prepared;
  let error = null;
  const plugin = createPlugin({ list: async () => [], prepare: async () => {
    if (error) throw error;
    return result;
  } }, document);
  plugin._isCurrentWasmAssetOperation = () => true;
  plugin.createUI();
  const notices = () => document.body.children.filter(x => x.className.includes('sfz-load-notice-overlay'));
  const quiet = () => { assert.equal(notices().length, 0); assert.equal(plugin._status.hidden, true); };
  error = { code: 'prepare' };
  plugin.setParameters({ sf: 'a'.repeat(24) });
  await plugin._pending;
  quiet();
  assert.equal(plugin._error, 'prepare', 'Automatic failures still retain their state');
  error = null;
  result = { ...prepared, warnings: [{ code: 'loop-points-ignored', count: 1 }] };
  plugin.setParameters({ sf: 'b'.repeat(24) });
  await plugin._pending;
  plugin.onWasmAssetState(0, 3, 1);
  plugin.onWasmAssetState(0, 4, 1);
  quiet();

  result = prepared;
  await plugin._selectBank(async () => ({ id: 'c'.repeat(24) }));
  plugin.onWasmAssetState(0, 3, 2);
  quiet();
  plugin.setParameters({ th: .7 });
  plugin.onWasmAssetRejected(0, 'module-budget', 2);
  plugin.onWasmAssetState(0, 4, 2);
  quiet();
  assert.equal(plugin._error, 'prepare');

  await plugin._selectBank(async () => ({ id: 'd'.repeat(24) }));
  plugin.onWasmAssetState(0, 4, 3);
  assert.equal(notices().length, 1);
  assert.equal(plugin._status.hidden, false);
  plugin.setParameters(plugin.getParameters());
  quiet();
  plugin.createUI();
  quiet();
  plugin.onWasmAssetState(0, 4, 3);
  quiet();

  // Restoring the same ID before ACTIVE also cancels the previous manual token.
  await plugin._selectBank(async () => ({ id: 'e'.repeat(24) }));
  plugin.setParameters(plugin.getParameters());
  plugin.onWasmAssetRejected(0, 'capacity', 4);
  quiet();
  plugin.cleanup();
});

test('automatic UI list refresh failures retain diagnostic state without load guidance', async () => {
  const document = createDocument();
  const plugin = createPlugin({ list: async () => { throw { code: 'storage' }; } }, document);
  for (let redraw = 0; redraw < 2; redraw++) {
    plugin.createUI();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(plugin._error, 'storage');
    assert.equal(plugin._status.hidden, true);
    assert.equal(document.body.children.length, 0);
  }
  plugin.cleanup();
});

test('post-selection list failures respect the current unconsumed manual attempt', async () => {
  for (const state of ['initial', 'active', 'stale']) {
    const document = createDocument();
    const refresh = deferred();
    const entered = deferred();
    let refreshing = false;
    const plugin = createPlugin({ prepare: async () => prepared, list: async () => {
      if (!refreshing) return [];
      entered.resolve();
      return refresh.promise;
    } }, document);
    plugin._isCurrentWasmAssetOperation = () => true;
    plugin.createUI();
    await new Promise(resolve => setImmediate(resolve));
    refreshing = true;
    const selection = plugin._selectBank(async () => ({ id: 'a'.repeat(24) }));
    await entered.promise;
    if (state === 'active') plugin.onWasmAssetState(0, 3, 1);
    if (state === 'stale') {
      plugin.setParameters({ sf: 'b'.repeat(24) });
      await plugin._pending;
    }
    refresh.reject({ code: 'storage' });
    await selection;
    assert.equal(plugin._status.hidden, state !== 'initial');
    assert.equal(document.body.children.length, state === 'initial' ? 1 : 0);
    assert.equal(plugin._error, state === 'stale' ? '' : 'storage');
    plugin.cleanup();
  }
});
