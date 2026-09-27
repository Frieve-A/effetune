import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { renderPopup } from '../../extension/popup.js';
import {
  createUiManager,
  ExtensionAudioManager,
  ExtensionEditor,
  getExtensionDocumentationUrl,
  selectEditorSnapshot
} from '../../extension/editor.js';
import { ExtensionClient } from '../../extension/protocol.js';
import { TelemetryFrameType, TelemetryHub } from '../../js/audio/telemetry-hub.js';
import { PresetManager } from '../../js/ui/pipeline/preset-manager.js';
import { ClipboardManager } from '../../js/ui/pipeline/clipboard-manager.js';
import { createDefaultLayout, encodeLayoutShare, snapshotLayout } from '../../js/visualizer/visualizer-model.js';
import { VisualizerView } from '../../js/visualizer/visualizer-view.js';
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
    sessionCount: button(), empty: button(), start: button(), startHint: button(),
    preset, applyPreset: button(), edit: button(), message: button(),
    getSelectedSessionId: () => null,
    setSelectedSessionId(sessionId) { this.selectedSessionId = sessionId; },
    renderSessions(sessions, selectedSessionId) { this.sessions = sessions; this.renderedSelection = selectedSessionId; }
  };

  try {
    renderPopup(elements, {
      revision: 1,
      sessions: [{ sessionId: 'session-7', status: 'processing', tabId: 7, title: 'Listening tab', masterBypass: true }],
      presets: { Warm: { plugins: [] } }
    });
  } finally {
    globalThis.Option = OriginalOption;
  }

  assert.equal(elements.sessionCount.textContent, '1 / 4');
  assert.equal(elements.sessions[0].title, 'Listening tab');
  assert.equal(elements.renderedSelection, 'session-7');
  assert.equal(elements.start.disabled, false);
  assert.equal(elements.applyPreset.disabled, false);
  assert.deepEqual(preset.options.map(option => option.value), ['Warm']);
});

test('popup counts only live sessions, keeps terminal status visible, and disables Start at the four-tab limit', () => {
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
    sessionCount: button(), empty: button(), start: button(), startHint: button(), preset,
    applyPreset: button(), edit: button(), message: button(),
    getSelectedSessionId: () => 'second', setSelectedSessionId(sessionId) { this.selection = sessionId; },
    renderSessions(sessions) { this.sessions = sessions; }
  };
  try {
    renderPopup(elements, {
      sessions: [
        { sessionId: 'first', status: 'processing' },
        { sessionId: 'second', status: 'processing' },
        { sessionId: 'third', status: 'starting' },
        { sessionId: 'fourth', status: 'processing' },
        { sessionId: 'old', status: 'stopped' }
      ],
      presets: {}
    });
  } finally {
    globalThis.Option = OriginalOption;
  }
  assert.equal(elements.sessions.length, 5);
  assert.equal(elements.selection, 'second');
  assert.equal(elements.start.disabled, true);
  assert.equal(elements.startHint.hidden, false);
});

test('editor projects a selected live session and falls back to the offline pipeline', () => {
  const root = {
    revision: 7,
    sampleRate: 96000,
    masterBypass: false,
    plugins: [{ id: 1, nm: 'Volume' }],
    sessions: [{
      sessionId: 'live', status: 'processing', title: 'Listening tab', sampleRate: 48000,
      masterBypass: true, plugins: [{ id: 2, nm: 'Gain' }], preparationStatuses: [{ pluginId: 2 }]
    }]
  };
  const selected = selectEditorSnapshot(root, 'live');
  assert.equal(selected.title, 'Listening tab');
  assert.equal(selected.sampleRate, 48000);
  assert.equal(selected.masterBypass, true);
  assert.deepEqual(selected.plugins, [{ id: 2, nm: 'Gain' }]);

  const offline = selectEditorSnapshot(root, 'missing');
  assert.equal(offline.status, 'stopped');
  assert.equal(offline.sampleRate, 96000);
  assert.deepEqual(offline.plugins, [{ id: 1, nm: 'Volume' }]);
});

test('editor does not redirect queued edits when their session stops', () => {
  const client = { sessionId: 'stopped' };
  const editor = new ExtensionEditor({ client, documentRef: {} });
  editor.audioManager = { pendingMutations: 1 };
  editor.updateTelemetrySubscription = () => Promise.resolve();
  const snapshot = { sessions: [{ sessionId: 'other', status: 'processing' }] };
  editor.reconcileSession(snapshot);
  assert.equal(client.sessionId, 'stopped');
  editor.audioManager.pendingMutations = 0;
  editor.reconcileSession(snapshot);
  assert.equal(client.sessionId, 'other');
});

test('editor offers the offline pipeline only when no live session exists', () => {
  const OriginalOption = globalThis.Option;
  globalThis.Option = class Option {
    constructor(text, value) { this.text = text; this.value = value; }
  };
  const select = {
    options: [], value: '',
    replaceChildren() { this.options = []; },
    add(option) { this.options.push(option); }
  };
  const editor = new ExtensionEditor({ client: { sessionId: 'live' }, documentRef: {} });
  editor.elements.sessionSelect = select;
  try {
    editor.renderSessionOptions({ sessions: [{ sessionId: 'live', status: 'processing', title: 'Listening tab' }] });
    assert.deepEqual(select.options.map(option => option.value), ['live']);
    editor.client.sessionId = null;
    editor.renderSessionOptions({ sessions: [{ sessionId: 'old', status: 'stopped' }] });
    assert.deepEqual(select.options.map(option => option.value), ['']);
  } finally {
    globalThis.Option = OriginalOption;
  }
});

test('explicit session changes mark the restored pipeline as a history boundary', async () => {
  const calls = [];
  const client = { sessionId: 'first', async request(command) {
    calls.push([command, this.sessionId]);
    return command === 'getState' ? { revision: 2, sessions: [{ sessionId: 'second', status: 'processing' }] } : {};
  } };
  const editor = new ExtensionEditor({ client, documentRef: {} });
  editor.audioManager = { mutationQueue: Promise.resolve() };
  editor.updateTelemetrySubscription = async () => {};
  let restored;
  editor.restoreSnapshot = (...args) => { restored = args; };
  await editor.changeSession('second');
  assert.deepEqual(calls, [['setTelemetry', 'first'], ['getState', 'first']]);
  assert.equal(restored[1], true);
  assert.equal(restored[2], true);
});

test('frequency preview uses the volatile extension channel without queuing state requests', () => {
  const messages = [];
  const client = Object.assign(Object.create(ExtensionClient.prototype), {
    id: 'editor', sessionId: 'selected', channel: { postMessage: message => messages.push(message) }
  });
  const adapter = new ExtensionAudioManager(client, assert.fail);
  adapter.setFrequencyPreview(440);
  adapter.setFrequencyPreview(null);
  assert.deepEqual(messages, [
    { kind: 'frequencyPreview', clientId: 'editor', sessionId: 'selected', frequency: 440 },
    { kind: 'frequencyPreview', clientId: 'editor', sessionId: 'selected', frequency: null }
  ]);
  assert.equal(adapter.pendingMutations, 0);
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

test('extension Help links target the public plugin documentation', () => {
  assert.equal(
    getExtensionDocumentationUrl('/plugins/dynamics#tone-control'),
    'https://effetune.frieve.com/docs/plugins/dynamics.html#tone-control'
  );
  assert.equal(getExtensionDocumentationUrl('/unrelated'), '/unrelated');
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
  assert.match(editorHtml, /href="css\/effetune-mobile\.css"/);
  assert.match(editorHtml, /href="css\/user-data-backup\.css"/);
  assert.match(editorHtml, /id="editorBackupRestore"/);
  assert.match(editorJs, /openUserDataBackupDialog/);
  assert.match(editorJs, /import \{ PipelineManager \}/);
  assert.match(editorJs, /new PluginListManager/);
  assert.match(editorJs, /new TelemetryHub/);
  assert.match(editorJs, /window\.dspParamPackers\?\.has/);
  assert.match(editorJs, /setWasmAssetTargetResolver\?\.\(\(\) => \[\]\)/);
  assert.match(editorHtml, /<div class="plugin-list-shell">[\s\S]*id="pluginList"[\s\S]*id="pluginListPullTab"/);
  assert.match(editorHtml, /<div class="plugin-list-pull-tab" id="pluginListPullTab">◀<\/div>/);
  assert.doesNotMatch(editorHtml, /editorBypass|editorPresetSelect|editorApplyPreset|editorSavePreset|editorDeletePreset/);
  assert.doesNotMatch(editorHtml, /class="extension-toolbar"/);
  for (const id of ['editorSettingsMenu', 'editorSampleRateSelect', 'editorUrlRules',
    'editorImportMeasurement', 'editorImportPreset', 'editorExportPreset']) {
    assert.match(editorHtml, new RegExp(`id="${id}"`));
  }
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
  assert.doesNotMatch(editorCss, /(?:routing|ai|help)-button[^{}]*\{[^}]*display:\s*none/s);
  assert.match(editorJs, /enableFileProcessing:\s*false/);
  assert.doesNotMatch(editorJs, /shrinkSingleColumn/);
  assert.doesNotMatch(editorCss, /\.extension-editor \.pipeline\s*\{/);
  assert.match(editorJs, /\.room-eq-measurement-row/);
  assert.match(editorJs, /extension-measurement-delete/);
  assert.doesNotMatch(editorJs, /collapseEffectListAtNarrowWidth/);
  assert.match(editorJs, /initPluginList\(\);[\s\S]{0,400}collapseManager\.markReady\(\)/);
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

test('extension UI shows translated Visualizer sentences and extension-only guidance', () => {
  const messages = [];
  const uiManager = createUiManager(
    { 'visualizer.unavailable': 'Visualizer is unavailable. Reload the app to try again.' },
    (...args) => messages.push(args), () => {});
  uiManager.showTransientMessage('Loaded the Visualizer layout from the link.', false, {}, 3000);
  uiManager.showTransientMessage('unknown.key', true);
  assert.deepEqual(messages, [
    ['Loaded the Visualizer layout from the link.', true, 3000],
    ['Something went wrong. Try again.', false, 3000]
  ]);
  assert.equal(uiManager.t('visualizer.unavailable'), 'Start EffeTune on a tab to show Visualizer.');
  assert.equal(uiManager.t('visualizer.disabled'), 'Start EffeTune on a tab to show Visualizer.');
});

test('extension clipboard opens an initialized Visualizer and imports shared layouts without changing the pipeline', async () => {
  const messages = [];
  const calls = [];
  let initialize;
  const documentRef = { body: { classList: { toggle() {} } } };
  const editor = new ExtensionEditor({ client: {}, documentRef });
  const uiManager = createUiManager({}, (...args) => messages.push(args), () => {},
    encoded => editor.openSharedVisualizer(encoded));
  editor.uiManager = uiManager;
  const originalLayout = createDefaultLayout();
  const view = editor.visualizerView = {
    initialized: new Promise(resolve => { initialize = resolve; }),
    uiManager,
    layout: originalLayout,
    currentPresetName: 'Saved',
    show() { calls.push('show'); },
    updateVisibility() {},
    t(_key, fallback) { return fallback; },
    notice(_key, fallback) { messages.push([fallback, false]); },
    setLayout(layout) { calls.push('import'); this.layout = layout; },
    importShared: VisualizerView.prototype.importShared
  };
  const plugin = editorPlugin(4, -6);
  const pipeline = [plugin];
  const selectedPlugins = new Set([plugin]);
  const manager = new ClipboardManager({
    core: { selectedPlugins }, audioManager: { pipeline }, pluginManager: {}
  });
  const layout = createDefaultLayout();
  layout.aspect = '4:3';
  const url = new URL('https://effetune.frieve.com/effetune.html');
  url.searchParams.set('v', encodeLayoutShare(layout));

  await withGlobals({ window: { uiManager } }, async () => {
    const pasted = manager.handlePaste(url.href);
    await Promise.resolve();
    assert.deepEqual(calls, []);
    assert.equal(view.layout, originalLayout);
    initialize();
    await pasted;
    assert.deepEqual(calls, ['show', 'import']);
    assert.deepEqual(view.layout, snapshotLayout(layout));
    assert.equal(view.currentPresetName, '');
    assert.deepEqual(messages, [['Loaded the Visualizer layout from the link.', true, 3000]]);

    const importedLayout = view.layout;
    url.searchParams.set('v', 'invalid');
    await manager.handlePaste(url.href);
    assert.equal(view.layout, importedLayout);
    assert.match(messages.at(-1)[0], /This Visualizer link could not be read/);
    assert.deepEqual(pipeline, [plugin]);
    assert.deepEqual([...selectedPlugins], [plugin]);
  });
});

test('extension Visualizer sources bypass the edit queue and republish after telemetry subscribes', async () => {
  const requests = [];
  const client = { sessionId: null, request: async (command, args) => { requests.push([command, args]); return {}; } };
  const audioManager = new ExtensionAudioManager(client, error => assert.fail(error));
  const sources = [{ tapId: 0xf0000000 }];
  audioManager.setVisualizerSources(sources);
  assert.deepEqual(requests, []);
  client.sessionId = 'selected';
  audioManager.setVisualizerSources(sources);
  audioManager.setVisualizerSources([{ tapId: 0xf0000000 }]);
  assert.deepEqual(requests, [['setVisualizerSources', { sources }]]);
  assert.equal(audioManager.pendingMutations, 0);

  let ready = 0;
  audioManager.addEventListener('dspReady', () => { ready += 1; });
  const documentRef = { hidden: false };
  const editor = new ExtensionEditor({ client, documentRef });
  editor.audioManager = audioManager;
  await editor.updateTelemetrySubscription();
  assert.equal(ready, 1);
  documentRef.hidden = true;
  await editor.updateTelemetrySubscription();
  assert.equal(ready, 1);

  audioManager.setDspReady(true);
  audioManager.setDspReady(true);
  assert.equal(ready, 2);
  assert.equal(audioManager.isDspReady(), true);
});

test('extension UI layout mode follows the shared mobile-width breakpoint', async () => {
  const listeners = new Map();
  const widthMedia = {
    matches: true,
    addEventListener(_type, listener) { listeners.set('width', listener); },
    removeEventListener() {}
  };
  const installedMedia = {
    matches: false,
    addEventListener(_type, listener) { listeners.set('installed', listener); },
    removeEventListener() {}
  };
  const bodyClasses = new Set();
  const rootClasses = new Set();
  const classList = classes => ({
    toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }
  });

  await withGlobals({
    window: {
      matchMedia: query => query === '(max-width: 1158px)' ? widthMedia : installedMedia,
      addEventListener() {},
      removeEventListener() {}
    },
    document: {
      body: { classList: classList(bodyClasses) },
      documentElement: { classList: classList(rootClasses) }
    }
  }, () => {
    const uiManager = createUiManager({}, () => {}, () => {});
    assert.equal(uiManager.layoutMode.isMobile, true);
    assert.equal(bodyClasses.has('layout-mobile'), true);
    assert.equal(rootClasses.has('layout-mobile'), true);

    widthMedia.matches = false;
    listeners.get('width')();
    assert.equal(uiManager.layoutMode.isMobile, false);
    assert.equal(bodyClasses.has('layout-desktop'), true);
    assert.equal(rootClasses.has('layout-desktop'), true);
    uiManager.layoutMode.dispose();
  });
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
  const documentListeners = new Map();
  const menuChild = {};
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
    client.sessionId = 'selected';
    const editor = new ExtensionEditor({ client, documentRef: {
      addEventListener(type, listener) { documentListeners.set(type, listener); }
    } });
    editor.audioManager = new ExtensionAudioManager(client, error => assert.fail(error));
    editor.audioManager.telemetryHub = new TelemetryHub({ port: { postMessage() {} } });
    editor.pipelineManager = { undo() {}, redo() {} };
    editor.elements = {
      settingsMenuButton: eventTarget,
      settingsMenu: { contains: target => target === menuChild, classList: { toggle() { return true; }, remove() {} } },
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
      sessionId: 'selected',
      message: { type: 'dspTelemetry', packet, bytes: packet.byteLength }
    } });

    assert.deepEqual(frames, [{ tapId: 41, frameType: TelemetryFrameType.TAP_LEVEL, value: 0.75 }]);
    assert.equal(editor.audioManager.telemetryHub.getStats().packets, 1);
    let closes = 0;
    editor.closeSettingsMenu = () => { closes += 1; };
    documentListeners.get('click')({ target: menuChild });
    assert.equal(closes, 0);
    documentListeners.get('click')({ target: {} });
    assert.equal(closes, 1);
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

test('queued mutations keep their session through deferred payloads and the real client transport', async () => {
  const sent = [];
  const prepared = Promise.withResolvers();
  const client = Object.assign(Object.create(ExtensionClient.prototype), {
    id: 'editor', sessionId: 'first', sequence: 0, pending: new Map(),
    acceptState() {},
    channel: { postMessage(message) {
      sent.push(message);
      const pending = client.pending.get(message.requestId);
      clearTimeout(pending.timer);
      client.pending.delete(message.requestId);
      pending.resolve({});
    } }
  });
  const adapter = new ExtensionAudioManager(client, assert.fail);
  const importing = adapter.request('importPreset', () => prepared.promise);
  const saving = adapter.request('savePreset', { name: 'First' });
  await Promise.resolve();
  client.sessionId = 'second';
  prepared.resolve({ preset: { plugins: [] } });
  await Promise.all([importing, saving]);
  assert.deepEqual(sent.map(message => [message.command, message.args.sessionId]),
    [['importPreset', 'first'], ['savePreset', 'first']]);
  assert.equal(client.pending.size, 0);
});

async function bindSessionTestEditor(editor) {
  const capture = new EventTarget();
  const bubble = new EventTarget();
  editor.document = {
    body: { inert: false }, hidden: false,
    addEventListener(type, listener, capturing) {
      (capturing ? capture : bubble).addEventListener(type, listener);
    },
    removeEventListener(type, listener, capturing) {
      (capturing ? capture : bubble).removeEventListener(type, listener);
    },
    dispatchEvent(event) {
      if (capture.dispatchEvent(event)) return bubble.dispatchEvent(event);
      return false;
    }
  };
  for (const name of ['settingsMenuButton', 'importMeasurement', 'measurementFile',
    'importPreset', 'presetFile', 'exportPreset', 'undo', 'redo']) {
    editor.elements[name] = new EventTarget();
  }
  await withGlobals({ window: { addEventListener() {} } }, () => editor.bindEvents());
}

test('session switching blocks edits until queued A edits finish and B is restored', async () => {
  const firstEdit = Promise.withResolvers();
  const stopping = Promise.withResolvers();
  const stopped = Promise.withResolvers();
  const fetching = Promise.withResolvers();
  const fetched = Promise.withResolvers();
  const requests = [];
  const snapshot = { revision: 1, presets: {}, sessions: [
    { sessionId: 'first', status: 'processing', plugins: [{ nm: 'Volume', en: true, id: 1, vl: 0 }] },
    { sessionId: 'second', status: 'processing', plugins: [{ nm: 'Volume', en: true, id: 2, vl: -2 }] },
    { sessionId: 'third', status: 'processing', plugins: [] }
  ] };
  let editor;
  const client = Object.assign(new EventTarget(), { sessionId: 'first', async request(command, args, sessionId = this.sessionId) {
    requests.push({ command, args, sessionId });
    if (command === 'workletMessage') {
      if (requests.length === 1) await firstEdit.promise;
      snapshot.sessions.find(session => session.sessionId === sessionId).plugins[0].vl = args.message.plugin.parameters.vl;
      snapshot.revision += 1;
      editor.restoreSnapshot(structuredClone(snapshot));
    } else if (command === 'savePreset') {
      snapshot.presets[args.name] = structuredClone(snapshot.sessions.find(session => session.sessionId === sessionId).plugins);
    } else if (command === 'setTelemetry' && !args.enabled) {
      stopping.resolve();
      await stopped.promise;
    } else if (command === 'getState') {
      fetching.resolve();
      await fetched.promise;
    }
    return structuredClone(snapshot);
  } });
  const adapter = new ExtensionAudioManager(client, assert.fail);
  editor = editorForAdapter(adapter);
  await bindSessionTestEditor(editor);
  editor.restoreSnapshot(snapshot, true);
  let undos = 0;
  editor.pipelineManager.undo = () => { undos += 1; };
  editor.document.addEventListener('keydown', () => editor.pipelineManager.undo());
  editor.document.addEventListener('input', event => {
    adapter.pipeline[0].vl = event.value;
    adapter.forwardPluginMessage({ type: 'updatePlugin', plugin: {
      id: adapter.pipeline[0].id, parameters: { vl: event.value }
    } });
  });
  const edit = value => editor.document.dispatchEvent(Object.assign(new Event('input', { cancelable: true }), { value }));
  edit(-3);
  edit(-9);
  const saved = adapter.request('savePreset', { name: 'First' });
  const switching = editor.changeSession('second');
  assert.equal(editor.document.body.inert, true);
  edit(-15);
  editor.document.dispatchEvent(new Event('keydown', { cancelable: true }));
  assert.equal(adapter.pendingMutations, 3);
  assert.equal(undos, 0);
  firstEdit.resolve();
  await stopping.promise;
  await saved;
  edit(-20);
  await editor.changeSession('third');
  editor.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(client.sessionId, 'first');
  assert.equal(requests.filter(request => request.command === 'setTelemetry').length, 1);
  stopped.resolve();
  await fetching.promise;
  edit(-25);
  editor.restoreSnapshot({ ...structuredClone(snapshot), revision: 4, sessions: snapshot.sessions.slice(1) });
  assert.equal(client.sessionId, 'first');
  assert.equal(adapter.pipeline[0].id, 1);
  assert.equal(editor.document.body.inert, true);
  fetched.resolve();
  await switching;
  assert.equal(client.sessionId, 'second');
  assert.equal(editor.document.body.inert, false);
  assert.deepEqual(adapter.pipeline.map(plugin => [plugin.id, plugin.vl]), [[2, -2]]);
  assert.equal(snapshot.sessions[0].plugins[0].vl, -9);
  assert.equal(snapshot.presets.First[0].vl, -9);
  assert.deepEqual(requests.filter(request => ['workletMessage', 'savePreset'].includes(request.command))
    .map(request => request.sessionId), ['first', 'first', 'first']);
  assert.deepEqual(requests.filter(request => request.command === 'setTelemetry')
    .map(request => [request.sessionId, request.args.enabled]), [['first', false], ['second', true]]);
  edit(-11);
  await adapter.mutationQueue;
  editor.document.dispatchEvent(new Event('keydown'));
  assert.equal(undos, 1);
  assert.equal(snapshot.sessions[1].plugins[0].vl, -11);
});

test('failed session switches restore editing and telemetry on the original session', async () => {
  for (const failure of ['setTelemetry', 'getState']) {
    const requests = [];
    const client = { sessionId: 'first', async request(command, args) {
      requests.push([command, this.sessionId, args?.enabled]);
      if (command === failure && args?.enabled !== true) throw new Error('Expected switch failure');
    } };
    const adapter = new ExtensionAudioManager(client, assert.fail);
    const editor = editorForAdapter(adapter);
    editor.document = { body: { inert: false }, hidden: false };
    editor.restoreSnapshot({ revision: 1, sessions: [{ sessionId: 'first', status: 'processing',
      plugins: [{ id: 1, nm: 'Volume', en: true, vl: -1 }] }] }, true);
    const errors = [];
    editor.reportError = error => errors.push(error.message);
    const history = editor.pipelineManager.historyManager;
    history.history = ['original undo state'];
    await editor.changeSession('second');
    assert.equal(errors.length, 1);
    assert.equal(client.sessionId, 'first');
    assert.equal(editor.document.body.inert, false);
    assert.equal(editor.changingSession, false);
    assert.deepEqual(adapter.pipeline.map(plugin => [plugin.id, plugin.vl]), [[1, -1]]);
    assert.deepEqual(history.history, ['original undo state']);
    assert.deepEqual(requests.at(-1), ['setTelemetry', 'first', true]);
    await adapter.setMasterBypass(true);
    assert.deepEqual(requests.at(-1), ['setBypass', 'first', true]);
  }
});

test('automatic session fallback clears Undo history and seeds it from the new pipeline', () => {
  const client = { sessionId: 'first', request() {} };
  const adapter = new ExtensionAudioManager(client, error => assert.fail(error));
  const editor = editorForAdapter(adapter);
  editor.updateTelemetrySubscription = () => Promise.resolve();
  adapter.pipelineA = [editorPlugin(1, -1)];
  editor.snapshot = {
    revision: 1,
    sessions: [{ sessionId: 'first', status: 'processing', plugins: editor.serializeVisiblePipeline() }]
  };
  const history = editor.pipelineManager.historyManager;
  history.history = ['old session state'];
  history.historyIndex = 0;
  history.endOperation = () => {};
  history.saveState = () => {
    history.history.push(editor.serializeVisiblePipeline());
    history.historyIndex = history.history.length - 1;
  };

  editor.restoreSnapshot({
    revision: 2,
    sessions: [{ sessionId: 'second', status: 'processing', sampleRate: 48000, masterBypass: false,
      plugins: [{ id: 2, nm: 'Volume', en: true, vl: -2 }] }]
  });

  assert.equal(client.sessionId, 'second');
  assert.deepEqual(adapter.pipelineA.map(plugin => [plugin.id, plugin.vl]), [[2, -2]]);
  assert.deepEqual(history.history, [[{ nm: 'Volume', en: true, vl: -2, id: 2 }]]);
  assert.equal(history.historyIndex, 0);
});

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
