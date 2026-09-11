import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { POPUP_STATUS, renderPopup } from '../../extension/popup.js';
import { createUiManager, ExtensionAudioManager, ExtensionEditor } from '../../extension/editor.js';
import { ExtensionClient } from '../../extension/protocol.js';
import { TelemetryFrameType, TelemetryHub } from '../../js/audio/telemetry-hub.js';
import { PresetManager } from '../../js/ui/pipeline/preset-manager.js';
import { ClipboardManager } from '../../js/ui/pipeline/clipboard-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { refreshRangeFills, updateRangeFill } from '../../js/ui/range-fill.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function button() {
  return { textContent: '', disabled: false, className: '', checked: false, hidden: true, title: '' };
}

test('popup renders the authoritative processing snapshot', () => {
  const OriginalOption = globalThis.Option;
  globalThis.Option = class Option {
    constructor(text, value) { this.text = text; this.value = value; }
  };
  const preset = {
    value: '', disabled: false, options: [],
    replaceChildren() { this.options = []; this.value = ''; },
    add(option) { this.options.push(option); if (this.options.length === 1) this.value = option.value; }
  };
  const elements = {
    status: button(), indicator: button(), target: button(), startStop: button(),
    bypass: button(), preset, applyPreset: button(), edit: button(), message: button()
  };

  try {
    renderPopup(elements, {
      status: 'processing', target: { tabId: 7, title: 'Listening tab' },
      masterBypass: true, presets: { Warm: { plugins: [] } }, error: null
    });
  } finally {
    globalThis.Option = OriginalOption;
  }

  assert.equal(elements.status.textContent, POPUP_STATUS.processing);
  assert.equal(elements.target.textContent, 'Listening tab');
  assert.equal(elements.startStop.textContent, 'Stop processing');
  assert.equal(elements.startStop.disabled, false);
  assert.equal(elements.bypass.checked, true);
  assert.equal(elements.bypass.disabled, false);
  assert.deepEqual(preset.options.map(option => option.value), ['Warm']);
});

test('editor audio adapter keeps parameter and structural mutations on their intended transports', async () => {
  const requests = [];
  const client = {
    request(command, args) {
      requests.push({ command, args });
      return Promise.resolve({ revision: requests.length });
    }
  };
  const errors = [];
  const adapter = new ExtensionAudioManager(client, error => errors.push(error));
  adapter.suppressMutations = false;
  adapter.pipelineA = [{
    id: 11, name: 'Gain', enabled: true, inputBus: null, outputBus: null, channel: null,
    getSerializableParameters: () => ({ gn: 1 })
  }];

  const updatePlugin = { type: 'updatePlugin', plugin: { id: 11, type: 'GainPlugin' } };
  adapter.commitPowerTopologyMutation(updatePlugin);
  await adapter.mutationQueue;
  adapter.commitPowerTopologyMutation({ type: 'updatePlugins', plugins: [] });
  await adapter.mutationQueue;
  adapter.commitPowerTopologyMutation(
    { type: 'updatePlugins', plugins: [], masterBypass: true },
    { reason: 'pipeline-master-bypass' }
  );
  await adapter.mutationQueue;

  assert.equal(errors.length, 0);
  assert.deepEqual(requests[0], { command: 'workletMessage', args: { message: updatePlugin } });
  assert.equal(requests[1].command, 'setPipeline');
  assert.deepEqual(requests[1].args.plugins, [{ nm: 'Gain', en: true, gn: 1, id: 11 }]);
  assert.deepEqual(requests[2], { command: 'setBypass', args: { enabled: true } });
});

test('pipeline preset manager delegates extension persistence without touching local storage', async () => {
  const calls = [];
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = { getElementById: () => null };
  globalThis.window = { uiManager: null };
  const host = {
    getPresets: async () => ({ Clear: { plugins: [] } }),
    savePreset: async name => calls.push(['save', name]),
    loadPreset: async value => calls.push(['load', value]),
    deletePreset: async name => calls.push(['delete', name])
  };
  try {
    let dialogProvider;
    const manager = new PresetManager({
      audioManager: {},
      presetHost: host,
      core: { pluginPresetDialog: { show(provider) { dialogProvider = provider; } } }
    });
    assert.deepEqual(await manager.getPresets(), { Clear: { plugins: [] } });
    manager.openPresetDialog();
    assert.equal(dialogProvider.renameUserPreset, undefined);
    assert.equal(await manager.savePreset(' Clear '), true);
    assert.equal(await manager.loadPreset('Clear'), true);
    assert.equal(await manager.deletePreset('Clear'), true);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
  assert.deepEqual(calls, [['save', 'Clear'], ['load', 'Clear'], ['delete', 'Clear']]);
});

test('extension pages use external module scripts and the editor reuses pipeline modules', async () => {
  const [popupHtml, editorHtml, editorCss, editorJs] = await Promise.all([
    readFile(resolve(repoRoot, 'extension/popup.html'), 'utf8'),
    readFile(resolve(repoRoot, 'extension/editor.html'), 'utf8'),
    readFile(resolve(repoRoot, 'extension/editor.css'), 'utf8'),
    readFile(resolve(repoRoot, 'extension/editor.js'), 'utf8')
  ]);
  assert.match(popupHtml, /<base href="\.\.\/">/);
  assert.match(editorHtml, /src="extension\/editor\.js"/);
  assert.match(editorJs, /import \{ PipelineManager \}/);
  assert.match(editorJs, /new PluginListManager/);
  assert.match(editorJs, /new TelemetryHub/);
  assert.match(editorJs, /window\.dspParamPackers\?\.has/);
  assert.match(editorJs, /setWasmAssetTargetResolver\?\.\(\(\) => \[\]\)/);
  assert.match(editorHtml, /<div class="plugin-list-shell">[\s\S]*id="pluginList"[\s\S]*id="pluginListPullTab"/);
  assert.match(editorHtml, /<div class="plugin-list-pull-tab" id="pluginListPullTab">◀<\/div>/);
  assert.doesNotMatch(editorHtml, /editorBypass|editorPresetSelect|editorApplyPreset|editorSavePreset|editorDeletePreset/);
  assert.doesNotMatch(editorHtml, /class="extension-toolbar"/);
  const settingsMenu = editorHtml.match(/<div class="settings-menu" id="editorSettingsMenu"[\s\S]*?<\/div>/)[0];
  assert.deepEqual([...settingsMenu.matchAll(/id="([^"]+)"/g)].map(match => match[1]),
    ['editorSettingsMenu', 'editorImportMeasurement', 'editorImportPreset', 'editorExportPreset']);
  assert.match(editorHtml, /id="editorSettingsMenuButton"[^>]*aria-expanded="false"/);
  assert.match(editorHtml, /id="editorMeasurementFile"[^>]*hidden/);
  assert.match(editorHtml, /id="editorPresetFile"[^>]*hidden/);
  const presetIndex = editorHtml.indexOf('id="pipelinePresetButton"');
  const undoIndex = editorHtml.indexOf('id="undoButton"');
  const redoIndex = editorHtml.indexOf('id="redoButton"');
  const decreaseIndex = editorHtml.indexOf('id="decreaseColumnsButton"');
  assert.ok(presetIndex < undoIndex && undoIndex < redoIndex && redoIndex < decreaseIndex);
  assert.match(editorHtml, /class="header-button pipeline-preset-button"[^>]*>[\s\S]*?<svg width="16" height="16"/);
  assert.match(editorHtml, /class="header-button undo-button"[^>]*>↶<\/button>[\s\S]*class="header-button redo-button"[^>]*>↷<\/button>/);
  assert.doesNotMatch(editorCss, /\.pipeline-header\s*\{[^}]*position:\s*sticky/s);
  assert.doesNotMatch(editorCss, /\.pipeline-item\s*\{[^}]*max-width:\s*920px/s);
  assert.match(editorJs, /enableFileProcessing:\s*false/);
  assert.doesNotMatch(editorJs, /shrinkSingleColumn/);
  assert.doesNotMatch(editorCss, /\.extension-editor \.pipeline\s*\{/);
  assert.match(editorJs, /\.room-eq-measurement-row/);
  assert.match(editorJs, /extension-measurement-delete/);
});

test('Room EQ measurement list receives the VST-style selected-item Delete action', async () => {
  const listeners = {};
  const select = {
    id: 'room-eq-measurement-7',
    addEventListener(type, listener) { listeners[`select:${type}`] = listener; }
  };
  let deleteButton = null;
  const row = {
    querySelector(selector) {
      if (selector === '.extension-measurement-delete') return deleteButton;
      if (selector === 'select[id^="room-eq-measurement-"]') return select;
      return null;
    },
    appendChild(node) { deleteButton = node; }
  };
  const documentRef = {
    querySelectorAll: selector => selector === '.room-eq-measurement-row' ? [row] : [],
    createElement() {
      return {
        disabled: false,
        isConnected: true,
        addEventListener(type, listener) { listeners[`button:${type}`] = listener; }
      };
    }
  };
  const storage = {
    async initialize() {},
    getMeasurementById(id) { return id === 'measurement_imported' ? { imported: true } : null; }
  };
  const room = { id: 7, name: 'Room EQ', measurementId: 'measurement_imported' };
  const editor = new ExtensionEditor({ client: {}, documentRef, measurementStorage: storage });
  editor.audioManager = { pipeline: [room] };

  editor.enhanceRoomEqMeasurementRows(documentRef);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(deleteButton.className, 'room-eq-refresh extension-measurement-delete');
  assert.equal(deleteButton.textContent, 'Delete');
  assert.equal(deleteButton.disabled, false);
  assert.equal(typeof listeners['select:change'], 'function');
  assert.equal(typeof listeners['button:click'], 'function');
});

test('measurement import stores desktop exports and refreshes Room EQ and Crosstalk Cancellation', async () => {
  const calls = [];
  const storage = {
    async initialize() { calls.push('initialize'); },
    async importMeasurementFromJSON(text) {
      calls.push(['import', JSON.parse(text).name]);
      return 'measurement_imported';
    }
  };
  const editor = new ExtensionEditor({ client: {}, documentRef: {}, measurementStorage: storage });
  editor.elements.importMeasurement = { disabled: false };
  editor.showMessage = (text, success, duration) => calls.push(['message', text, success, duration]);
  editor.audioManager = { pipeline: [
    { name: 'Room EQ', async _refreshMeasurements(value) { calls.push(['room', value]); } },
    { name: 'Crosstalk Cancellation', async _refreshMeasurements(value) { calls.push(['crosstalk', value]); } },
    { name: 'Volume', async _refreshMeasurements() { assert.fail('unrelated plug-in refreshed'); } }
  ] };
  const event = {
    target: {
      files: [{ name: 'listening-room.json', size: 48, text: async () => '{"name":"Listening room"}' }],
      value: 'selected'
    }
  };

  assert.equal(await editor.importMeasurementFile(event), 'measurement_imported');
  assert.equal(event.target.value, '');
  assert.equal(editor.elements.importMeasurement.disabled, false);
  assert.deepEqual(calls, [
    'initialize', ['import', 'Listening room'], ['room', false], ['crosstalk', false],
    ['message', 'Imported measurement “listening-room.json”.', true, 3000]
  ]);
});

test('imported measurement deletion clears every Room EQ and Crosstalk Cancellation reference', async () => {
  const calls = [];
  const imported = { id: 'measurement_imported', name: 'Listening room', imported: true };
  const storage = {
    async initialize() { calls.push('initialize'); },
    getAllMeasurements() { return [imported, { id: 'native', name: 'Native', imported: false }]; },
    getMeasurementById(id) { return id === imported.id ? imported : null; },
    async deleteMeasurement(id) { calls.push(['delete', id]); return true; }
  };
  const room = {
    name: 'Room EQ',
    measurementId: 'measurement_imported',
    channelMeasurementIds: ['', 'measurement_imported::ch=right'],
    setParameters(parameters) { calls.push(['room-parameters', parameters]); },
    async _refreshMeasurements(value) { calls.push(['room-refresh', value]); }
  };
  const crosstalk = {
    name: 'Crosstalk Cancellation',
    ll: 'measurement_imported::ch=left', lr: '', rl: 'other::ch=right', rr: '',
    setParameters(parameters) { calls.push(['crosstalk-parameters', parameters]); },
    async _refreshMeasurements(value) { calls.push(['crosstalk-refresh', value]); }
  };
  const editor = new ExtensionEditor({ client: {}, documentRef: {
    body: { inert: false }, addEventListener() {}, removeEventListener() {}
  }, measurementStorage: storage });
  editor.audioManager = { pipeline: [room, crosstalk] };
  editor.confirmImportedMeasurementDeletion = async measurement => {
    assert.equal(measurement, imported);
    return true;
  };
  editor.showMessage = (text, success, duration) => calls.push(['message', text, success, duration]);

  assert.equal(await editor.deleteImportedMeasurement(room), true);
  assert.deepEqual(calls, [
    'initialize',
    ['room-parameters', { ms: '', mn: '', rp: 0, ms1: '', mn1: '' }],
    ['crosstalk-parameters', { ll: '' }],
    ['delete', 'measurement_imported'],
    ['room-refresh', false],
    ['crosstalk-refresh', false],
    ['message', 'Deleted imported measurement “Listening room”.', true, 3000]
  ]);
});

test('failed imported measurement deletion restores Room EQ and Crosstalk Cancellation references', async () => {
  const calls = [];
  const imported = { id: 'measurement_imported', name: 'Listening room', imported: true };
  const storage = {
    async initialize() {},
    getAllMeasurements() { return [imported]; },
    getMeasurementById(id) { return id === imported.id ? imported : null; },
    async deleteMeasurement(id) { calls.push(['delete', id]); return false; }
  };
  const room = {
    name: 'Room EQ',
    measurementId: 'measurement_imported',
    measurementName: 'Listening room',
    rp: 1,
    channelMeasurementIds: ['', 'measurement_imported::ch=right'],
    channelMeasurementNames: ['', 'Listening room — R'],
    setParameters(parameters) {
      calls.push(['room-parameters', parameters]);
      if (parameters.ms !== undefined) this.measurementId = parameters.ms;
      if (parameters.mn !== undefined) this.measurementName = parameters.mn;
      if (parameters.rp !== undefined) this.rp = parameters.rp;
      if (parameters.ms1 !== undefined) this.channelMeasurementIds[1] = parameters.ms1;
      if (parameters.mn1 !== undefined) this.channelMeasurementNames[1] = parameters.mn1;
    },
    async _refreshMeasurements() { assert.fail('failed deletion refreshed Room EQ'); }
  };
  const crosstalk = {
    name: 'Crosstalk Cancellation',
    ll: 'measurement_imported::ch=left', lr: '', rl: 'other::ch=right', rr: '',
    setParameters(parameters) {
      calls.push(['crosstalk-parameters', parameters]);
      Object.assign(this, parameters);
    },
    async _refreshMeasurements() { assert.fail('failed deletion refreshed Crosstalk Cancellation'); }
  };
  const editor = new ExtensionEditor({ client: {}, documentRef: {
    body: { inert: false }, addEventListener() {}, removeEventListener() {}
  }, measurementStorage: storage });
  editor.audioManager = { pipeline: [room, crosstalk] };
  editor.confirmImportedMeasurementDeletion = async () => true;
  editor.showMessage = (text, success) => calls.push(['message', text, success]);

  assert.equal(await editor.deleteImportedMeasurement(room), false);
  assert.deepEqual({
    measurementId: room.measurementId,
    measurementName: room.measurementName,
    rp: room.rp,
    channelMeasurementIds: room.channelMeasurementIds,
    channelMeasurementNames: room.channelMeasurementNames,
    ll: crosstalk.ll
  }, {
    measurementId: 'measurement_imported',
    measurementName: 'Listening room',
    rp: 1,
    channelMeasurementIds: ['', 'measurement_imported::ch=right'],
    channelMeasurementNames: ['', 'Listening room — R'],
    ll: 'measurement_imported::ch=left'
  });
  assert.deepEqual(calls, [
    ['room-parameters', { ms: '', mn: '', rp: 0, ms1: '', mn1: '' }],
    ['crosstalk-parameters', { ll: '' }],
    ['delete', 'measurement_imported'],
    ['room-parameters', {
      ms: 'measurement_imported', mn: 'Listening room', rp: 1,
      ms1: 'measurement_imported::ch=right', mn1: 'Listening room — R'
    }],
    ['crosstalk-parameters', { ll: 'measurement_imported::ch=left' }],
    ['message', 'The imported measurement could not be deleted. Try again.', false]
  ]);
});

test('measurement deletion locks editor input and uses assignments after pending edits settle', async () => {
  for (const deleted of [true, false]) {
    const pendingEdit = Promise.withResolvers();
    const startedDeletion = Promise.withResolvers();
    const finishDeletion = Promise.withResolvers();
    const startedRefresh = Promise.withResolvers();
    const finishRefresh = Promise.withResolvers();
    const listeners = new Map();
    const documentRef = {
      body: { inert: false },
      addEventListener(type, listener, capture) {
        assert.equal(capture, true);
        listeners.set(type, listener);
      },
      removeEventListener(type, listener, capture) {
        assert.equal(capture, true);
        assert.equal(listeners.get(type), listener);
        listeners.delete(type);
      }
    };
    const imported = { id: 'measurement_imported', imported: true };
    const storage = {
      async initialize() {},
      getMeasurementById: () => imported,
      async deleteMeasurement() {
        startedDeletion.resolve();
        await finishDeletion.promise;
        return deleted;
      }
    };
    const adapter = new ExtensionAudioManager({ request: async () => {} }, error => assert.fail(error));
    adapter.suppressMutations = false;
    const previousRoom = { name: 'Room EQ', measurementId: imported.id,
      setParameters() { assert.fail('deletion used the pipeline from before a pending edit'); } };
    const room = {
      id: 1, name: 'Room EQ', measurementId: imported.id, measurementName: 'Latest name', rp: 2,
      channelMeasurementIds: ['other'], channelMeasurementNames: ['Other measurement'],
      setParameters(parameters) {
        if (parameters.ms !== undefined) this.measurementId = parameters.ms;
        if (parameters.mn !== undefined) this.measurementName = parameters.mn;
        if (parameters.rp !== undefined) this.rp = parameters.rp;
        adapter.forwardPluginMessage({ type: 'updatePlugin', plugin: { id: 1, parameters } });
      },
      async _refreshMeasurements() {
        startedRefresh.resolve();
        await finishRefresh.promise;
      }
    };
    adapter.pipelineA = [previousRoom];
    const pending = adapter.enqueue(async () => {
      await pendingEdit.promise;
      adapter.pipelineA = [room];
    });
    const editor = new ExtensionEditor({ client: adapter.client, documentRef, measurementStorage: storage });
    editor.audioManager = adapter;
    editor.showMessage = () => {};
    editor.confirmImportedMeasurementDeletion = async () => true;
    const deletion = editor.deleteImportedMeasurement(previousRoom);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(documentRef.body.inert, true);
    const keyEvent = { prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; } };
    listeners.get('keydown')(keyEvent);
    assert.equal(keyEvent.prevented, true);
    assert.equal(keyEvent.stopped, true);

    pendingEdit.resolve();
    await pending;
    await startedDeletion.promise;
    assert.equal(documentRef.body.inert, true);
    assert.equal(room.measurementId, '');
    finishDeletion.resolve();
    if (deleted) {
      await startedRefresh.promise;
      assert.equal(documentRef.body.inert, true);
      finishRefresh.resolve();
    }
    assert.equal(await deletion, deleted);
    assert.equal(documentRef.body.inert, false);
    assert.equal(listeners.size, 0);
    assert.equal(room.measurementId, deleted ? '' : imported.id);
    assert.equal(room.measurementName, deleted ? '' : 'Latest name');
    assert.equal(room.rp, deleted ? 0 : 2);
    assert.deepEqual(room.channelMeasurementIds, ['other']);
    assert.deepEqual(room.channelMeasurementNames, ['Other measurement']);
  }
});

test('extension UI infers error severity for shared preset messages with an omitted flag', () => {
  const messages = [];
  const uiManager = createUiManager({}, (...args) => messages.push(args), () => {});
  uiManager.setError('error.invalidPresetData');
  uiManager.setError('error.failedToLoadPreset');
  uiManager.setError('error.noPresetSelected');
  uiManager.setError('Saved.');
  uiManager.setError('Please choose a preset.', true);
  assert.deepEqual(messages, [
    ['That preset could not be applied. Your current pipeline was kept.', false],
    ['That preset could not be applied. Your current pipeline was kept.', false],
    ['Something went wrong. Your current pipeline was kept. Try again.', false],
    ['Saved.', true],
    ['Something went wrong. Your current pipeline was kept. Try again.', false]
  ]);
});

test('measurement import rejects unsupported files before reading them', async () => {
  let reads = 0;
  const editor = new ExtensionEditor({ client: {}, documentRef: {}, measurementStorage: {
    initialize: async () => assert.fail('invalid file reached storage')
  } });
  editor.elements.importMeasurement = { disabled: false };
  const messages = [];
  editor.showMessage = (text, success) => messages.push([text, success]);

  assert.equal(await editor.importMeasurementFile({ target: {
    files: [{ name: 'measurement.txt', size: 1, text: async () => { reads += 1; return '{}'; } }],
    value: 'selected'
  } }), null);
  assert.equal(reads, 0);
  assert.deepEqual(messages, [['Choose a measurement JSON file exported by EffeTune.', false]]);
});

test('range fill styling updates direct values and dynamically discovered sliders', () => {
  const properties = new Map();
  const slider = {
    min: '-10', max: '30', value: '10',
    matches: selector => selector === 'input[type="range"]',
    style: { setProperty: (name, value) => properties.set(name, value) }
  };
  updateRangeFill(slider);
  assert.equal(properties.get('--et-range-fill'), '50%');
  slider.value = '30';
  refreshRangeFills({ matches: () => false, querySelectorAll: () => [slider] });
  assert.equal(properties.get('--et-range-fill'), '100%');
});

test('extension clipboard messages use one managed timer without clearing a newer error', async () => {
  const timers = [];
  const cancelled = new Set();
  let clipboardText = '';
  const message = {
    textContent: '', hidden: true,
    classList: {
      success: false,
      toggle(_name, enabled) { this.success = enabled; }
    }
  };
  const editor = new ExtensionEditor({ client: {}, documentRef: {} });
  editor.elements.message = message;
  const uiManager = createUiManager(
    { 'success.settingsCopied': 'Effect settings copied to clipboard!', 'error.failedToCopySettings': 'Copy failed.' },
    (text, success, duration) => editor.showMessage(text, success, duration),
    () => editor.hideMessage()
  );
  const plugin = editorPlugin(4, -6);
  const core = { selectedPlugins: new Set([plugin]) };
  const manager = new ClipboardManager({ core, audioManager: { pipeline: [plugin] }, pluginManager: {} });

  await withGlobals({
    window: { uiManager },
    navigator: { clipboard: { writeText: async text => { clipboardText = text; } } },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout: id => cancelled.add(id)
  }, async () => {
    assert.equal(await manager.copySelectedPluginsToClipboard(), true);
    assert.deepEqual(JSON.parse(clipboardText), [{ nm: 'Volume', en: true, vl: -6 }]);
    assert.equal(message.textContent, 'Effect settings copied to clipboard!');
    assert.equal(message.classList.success, true);
    assert.equal(message.hidden, false);
    assert.equal(timers.at(-1).delay, 3000);
    const staleTimer = timers.at(-1);
    uiManager.setError('error.failedToCopySettings', true);
    assert.ok(cancelled.size > 0);
    staleTimer.callback();
    assert.equal(message.hidden, false);
    assert.equal(message.textContent, 'Copy failed.');
    assert.equal(message.classList.success, false);

    uiManager.showTransientMessage('success.settingsCopied', false, {}, 10);
    const latestTimer = timers.at(-1);
    assert.equal(message.hidden, false);
    latestTimer.callback();
    assert.equal(message.hidden, true);
  });
});

test('extension client routes one worklet telemetry frame through the editor to hub subscribers', async () => {
  const channels = [];
  class FakeBroadcastChannel {
    constructor() { channels.push(this); }
    postMessage() {}
    close() {}
  }
  const eventTarget = { addEventListener() {}, click() {} };
  const packet = new ArrayBuffer(20);
  const view = new DataView(packet);
  view.setUint16(0, TelemetryFrameType.TAP_LEVEL, true);
  view.setUint16(2, 1, true);
  view.setUint32(4, 41, true);
  view.setUint32(8, 7, true);
  view.setUint16(12, 4, true);
  view.setFloat32(16, 0.75, true);

  await withGlobals({
    BroadcastChannel: FakeBroadcastChannel,
    window: { addEventListener() {} }
  }, async () => {
    const client = new ExtensionClient();
    const editor = new ExtensionEditor({ client, documentRef: { addEventListener() {} } });
    editor.audioManager = new ExtensionAudioManager(client, error => assert.fail(error));
    editor.audioManager.telemetryHub = new TelemetryHub({ port: { postMessage() {} } });
    editor.pipelineManager = { undo() {}, redo() {} };
    editor.elements = {
      settingsMenuButton: eventTarget,
      settingsMenu: { classList: { toggle() { return true; }, remove() {} } },
      importMeasurement: eventTarget,
      measurementFile: eventTarget,
      importPreset: eventTarget,
      presetFile: eventTarget,
      exportPreset: eventTarget,
      undo: eventTarget,
      redo: eventTarget
    };
    const frames = [];
    editor.audioManager.telemetryHub.subscribe(41, TelemetryFrameType.TAP_LEVEL, frame => {
      frames.push({ tapId: frame.tapId, frameType: frame.frameType, value: frame.payload.getFloat32(0, true) });
    });
    editor.bindEvents();

    channels[0].onmessage({ data: {
      kind: 'workletMessage',
      message: { type: 'dspTelemetry', packet, bytes: packet.byteLength }
    } });

    assert.deepEqual(frames, [{ tapId: 41, frameType: TelemetryFrameType.TAP_LEVEL, value: 0.75 }]);
    assert.equal(editor.audioManager.telemetryHub.getStats().packets, 1);
    client.close();
  });
});

function editorPlugin(id, vl = 0) {
  return { id, name: 'Volume', vl, enabled: true, inputBus: null, outputBus: null, channel: null,
    getSerializableParameters() { return { vl: this.vl }; },
    setEnabled(value) { this.enabled = value; },
    setParameters(value) { this.vl = value.vl; } };
}

function editorForAdapter(adapter) {
  const editor = new ExtensionEditor({ client: adapter.client, documentRef: {} });
  editor.audioManager = adapter;
  editor.renderSession = () => {};
  editor.renderPresets = () => {};
  editor.pluginManager = { createPlugin: () => editorPlugin(0), nextPluginId: 1 };
  editor.uiManager = { expandedPlugins: new Set() };
  editor.pipelineManager = { core: {}, updatePipelineUI() {}, historyManager: { saveState() {} } };
  adapter.onMutationsSettled = () => editor.restoreSnapshot(editor.snapshot);
  return editor;
}

test('same-topology snapshots still synchronize sample rate and master bypass', () => {
  const adapter = new ExtensionAudioManager({ request() {} }, error => assert.fail(error));
  const editor = editorForAdapter(adapter);
  adapter.pipelineA = [editorPlugin(1)];
  editor.snapshot = { revision: 1, plugins: editor.serializeVisiblePipeline(), sampleRate: 48000, masterBypass: false };

  editor.restoreSnapshot({
    revision: 2,
    plugins: editor.serializeVisiblePipeline(),
    sampleRate: 96000,
    masterBypass: true
  });

  assert.equal(adapter.workletNode.context.sampleRate, 96000);
  assert.equal(adapter.masterBypass, true);
  assert.equal(editor.pipelineManager.core.enabled, false);
});

test('editor preserves consecutive additions and parameter edits while earlier snapshots arrive', async () => {
  const requests = [];
  let completeFirst;
  let editor;
  let revision = 0;
  let applied = [];
  const client = { async request(command, args) {
    requests.push(structuredClone({ command, args }));
    if (requests.length === 1) await new Promise(resolve => { completeFirst = resolve; });
    if (command === 'setPipeline') applied = args.plugins;
    else applied = applied.map(plugin => plugin.id === args.message.plugin.id
      ? { ...plugin, vl: args.message.plugin.parameters.vl } : plugin);
    const state = { revision: ++revision, plugins: structuredClone(applied), presets: {} };
    editor.restoreSnapshot(state);
    return state;
  } };
  const adapter = new ExtensionAudioManager(client, error => assert.fail(error.message));
  adapter.suppressMutations = false;
  editor = editorForAdapter(adapter);
  const first = editorPlugin(1);
  adapter.pipelineA = [first];
  adapter.commitPowerTopologyMutation({ type: 'updatePlugins' });
  await Promise.resolve();
  adapter.pipelineA.push(editorPlugin(2));
  adapter.commitPowerTopologyMutation({ type: 'updatePlugins' });
  first.vl = -3;
  const message = { type: 'updatePlugin', plugin: { id: 1, type: 'VolumePlugin', parameters: { vl: -3 } } };
  adapter.forwardPluginMessage(message);
  first.vl = -9;
  message.plugin.parameters.vl = -9;
  adapter.forwardPluginMessage(message);
  editor.restoreSnapshot({ revision: 0, plugins: [{ nm: 'Volume', id: 1, en: true, vl: 0 }], presets: {} });
  assert.deepEqual(adapter.pipelineA.map(plugin => plugin.id), [1, 2]);
  assert.equal(first.vl, -9);
  completeFirst();
  await adapter.mutationQueue;
  assert.deepEqual(requests.filter(request => request.command === 'setPipeline').map(request => request.args.plugins.map(plugin => plugin.id)), [[1], [1, 2]]);
  assert.deepEqual(requests.filter(request => request.command === 'workletMessage').map(request => request.args.message.plugin.parameters.vl), [-3, -9]);
  assert.deepEqual(adapter.pipelineA.map(plugin => plugin.id), [1, 2]);
  assert.equal(adapter.pipelineA[0].vl, -9);
  assert.equal(adapter.pendingMutations, 0);
});

test('a failed editor mutation cancels its queued edits and restores the authoritative pipeline', async () => {
  let rejectFirst;
  let editor;
  let calls = 0;
  const authoritative = { revision: 3, plugins: [{ nm: 'Volume', id: 7, en: true, vl: -2 }], presets: {} };
  const client = { request() { calls += 1; return new Promise((resolve, reject) => { rejectFirst = reject; }); } };
  const adapter = new ExtensionAudioManager(client, () => editor.restoreSnapshot(authoritative, true));
  adapter.suppressMutations = false;
  editor = editorForAdapter(adapter);
  adapter.pipelineA = [editorPlugin(1)];
  adapter.commitPowerTopologyMutation({ type: 'updatePlugins' });
  await Promise.resolve();
  adapter.pipelineA.push(editorPlugin(2));
  adapter.commitPowerTopologyMutation({ type: 'updatePlugins' });
  rejectFirst(new Error('Expected rejected preset'));
  await adapter.mutationQueue;
  assert.equal(calls, 1);
  assert.deepEqual(adapter.pipelineA.map(plugin => plugin.id), [7]);
  assert.equal(adapter.pipelineA[0].vl, -2);
  assert.equal(adapter.pendingMutations, 0);
});

async function withEditorPresetManager(editor, run) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = { getElementById: () => null };
  globalThis.window = { uiManager: { showTransientMessage() {}, setError() {} } };
  try {
    const manager = new PresetManager({ audioManager: editor.audioManager, presetHost: editor.createPresetHost() });
    editor.pipelineManager.presetManager = manager;
    return await run(manager);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
}

test('Save, Apply and Import follow pending edits through the real editor preset host', async () => {
  for (const action of ['save', 'apply', 'import']) {
    const requests = [];
    const selected = [{ nm: 'Volume', id: 7, en: true, vl: -7 }];
    let release;
    let editor;
    let applied = [];
    let saved = null;
    const client = { async request(command, args) {
      requests.push(command);
      if (requests.length === 1) await new Promise(resolve => { release = resolve; });
      if (command === 'setPipeline') applied = args.plugins;
      if (command === 'savePreset') saved = structuredClone(applied);
      if (command === 'applyPreset') applied = selected;
      if (command === 'importPreset') applied = args.preset.plugins;
      const snapshot = { revision: requests.length, plugins: structuredClone(applied), presets: {} };
      editor.restoreSnapshot(snapshot);
      return snapshot;
    } };
    const adapter = new ExtensionAudioManager(client, error => assert.fail(error.message));
    editor = editorForAdapter(adapter);
    adapter.suppressMutations = false;
    await withEditorPresetManager(editor, async manager => {
      adapter.pipelineA = [editorPlugin(1)];
      adapter.commitPowerTopologyMutation({ type: 'updatePlugins' });
      await Promise.resolve();
      adapter.pipelineA.push(editorPlugin(2));
      adapter.commitPowerTopologyMutation({ type: 'updatePlugins' });
      const operation = action === 'save' ? manager.savePreset('Saved')
        : manager.loadPreset(action === 'apply' ? 'Selected' : { name: 'Imported', plugins: selected });
      assert.equal(adapter.pendingMutations, 3);
      assert.deepEqual(requests, ['setPipeline']);
      release();
      assert.equal(await operation, true);
      await adapter.mutationQueue;
      assert.deepEqual(requests, ['setPipeline', 'setPipeline', { save: 'savePreset', apply: 'applyPreset', import: 'importPreset' }[action]]);
      assert.equal(adapter.pendingMutations, 0);
      assert.deepEqual(adapter.pipelineA.map(plugin => plugin.id), action === 'save' ? [1, 2] : [7]);
      if (action === 'save') assert.deepEqual(saved.map(plugin => plugin.id), [1, 2]);
    });
  }
});

test('a cancelled preset action never reports success after an earlier edit fails', async () => {
  const requests = [];
  let reject;
  let editor;
  const authoritative = { revision: 4, plugins: [{ nm: 'Volume', id: 7, en: true, vl: -7 }], presets: {} };
  const client = { request(command) {
    requests.push(command);
    return new Promise((resolve, fail) => { reject = fail; });
  } };
  const adapter = new ExtensionAudioManager(client, () => editor.restoreSnapshot(authoritative, true));
  editor = editorForAdapter(adapter);
  adapter.suppressMutations = false;
  await withEditorPresetManager(editor, async manager => {
    adapter.pipelineA = [editorPlugin(1)];
    adapter.commitPowerTopologyMutation({ type: 'updatePlugins' });
    await Promise.resolve();
    adapter.pipelineA.push(editorPlugin(2));
    adapter.commitPowerTopologyMutation({ type: 'updatePlugins' });
    const saving = manager.savePreset('Cancelled');
    reject(new Error('Expected earlier edit failure'));
    assert.equal(await saving, false);
    await adapter.mutationQueue;
    assert.deepEqual(requests, ['setPipeline']);
    assert.equal(manager.currentPresetName, '');
    assert.deepEqual(adapter.pipelineA.map(plugin => plugin.id), [7]);
  });
});

test('file import reserves its queue position before reading the file and a later Save uses the imported state', async () => {
  let finishReading;
  let editor;
  let applied = [];
  let saved;
  const requests = [];
  const client = { async request(command, args) {
    requests.push(command);
    if (command === 'importPreset') applied = args.preset.plugins;
    if (command === 'savePreset') saved = structuredClone(applied);
    const snapshot = { revision: requests.length, plugins: applied, presets: {} };
    editor.restoreSnapshot(snapshot);
    return snapshot;
  } };
  const adapter = new ExtensionAudioManager(client, error => assert.fail(error.message));
  editor = editorForAdapter(adapter);
  editor.showMessage = () => {};
  editor.reportError = error => assert.fail(error.message);
  adapter.suppressMutations = false;
  await withEditorPresetManager(editor, async manager => {
    const file = { name: 'Imported.effetune_preset', text: () => new Promise(resolve => { finishReading = resolve; }) };
    const imported = editor.importPresetFile({ target: { files: [file], value: 'selected' } });
    const saving = manager.savePreset('After import');
    await Promise.resolve();
    assert.deepEqual(requests, []);
    finishReading(JSON.stringify({ plugins: [{ nm: 'Volume', id: 9, en: true, vl: -9 }] }));
    await imported;
    assert.equal(await saving, true);
    assert.deepEqual(requests, ['importPreset', 'savePreset']);
    assert.deepEqual(saved.map(plugin => plugin.id), [9]);
  });
});
