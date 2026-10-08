import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createFakeDocument } from '../helpers/fake-dom.mjs';
import { SfzLibraryService } from '../../js/sfz/service.js';
import { PluginManager } from '../../js/plugin-manager.js';
import { SFZ_DEFAULT_MAX_BYTES } from '../../js/sfz/limits.js';

const source = fs.readFileSync(new URL('../../plugins/others/sfz_note_player.js', import.meta.url), 'utf8');

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
    updateParameters() {}
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
    clearWasmAsset(slot) { this.assets.delete(slot); }
    setWasmAsset(slot, descriptor) { this.assets.set(slot, descriptor); }
    getWasmAssets() { return this.assets; }
    cleanup() {}
  }
  const window = { sfzLibraryService: service, ...windowOptions };
  vm.runInNewContext(source, { PluginBase, window, document, console: { error() {} } }, {
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
  plugin._importRow = {};
  plugin._refreshBanks = async () => {};
  const operation = plugin._importFolder(folderFiles, 'Piano.sfz');
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
    plugin._importRow = {};
    plugin._refreshBanks = async () => {};
    if (selection === 'a'.repeat(24)) {
      plugin.setParameters({ sf: selection });
      await plugin.resolveOfflineDspAssetRequirement();
    }
    const operation = plugin._importFolder(folderFiles, 'Older.sfz');
    await started.promise;
    if (selection === 'import') {
      const replacement = plugin._importFolder(folderFiles, 'Newer.sfz');
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
  plugin._importRow = {};
  const first = plugin._importFolder(folderFiles, 'Older.sfz');
  await started[0].promise;
  const second = plugin._importFolder(folderFiles, 'Newer.sfz');
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
  await failed._importFolder(folderFiles, 'Failure.sfz');
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
  assert.equal(plugin.tm, 0);
  assert.equal(plugin.rd, 40);
  assert.equal(plugin.nh, 50);
  for (const key of ['lo', 'md', 'hi']) assert.equal(plugin[key], true);
  for (const [input, expected] of [[-3, -2], [-1.6, -2], [1.6, 2], [3, 2], [0, 0]]) {
    plugin.setParameters({ os: input });
    assert.equal(plugin.getParameters().os, expected);
  }
  const restored = createPlugin();
  plugin.setParameters({ os: -1 });
  plugin.setParameters({ lo: false, md: false, hi: true, tm: -25, rd: 96, nh: 100 });
  restored.setParameters(plugin.getParameters());
  assert.equal(restored.os, -1);
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
  await missing._bankSelect.dispatchEvent('change', { target: { value: 'a'.repeat(24) } });
  await missing.resolveOfflineDspAssetRequirement();
  assert.equal(missing.externalAssetInfo.missing, true);
  assert.match(missing._status.textContent, /selected SFZ could not be found/);
  assert.equal(missing._status.hidden, false);
  assert.equal(missing._status.dataset.state, 'error');
  const large = createPlugin({ list: async () => [], prepare: async () => { throw { code: 'too-large' }; } });
  large.createUI();
  await large._bankSelect.dispatchEvent('change', { target: { value: 'b'.repeat(24) } });
  await large.resolveOfflineDspAssetRequirement();
  assert.match(large._status.textContent, /exceeds the size limit/);
  large.onWasmAssetRejected(0, 'module-budget');
  assert.equal(large._status.hidden, true, 'A later automatic rejection does not repeat the manual failure');
  assert.equal(large._error, 'tooLarge');
});

test('SFZ shows only errors, without initial, loading, or success messages', async () => {
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
});

test('SFZ size errors use each language’s actual settings and General labels', () => {
  for (const language of ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh']) {
    const lines = fs.readFileSync(new URL(`../../js/locales/${language}.json5`, import.meta.url), 'utf8')
      .split(/\r?\n/).map(line => line.trim());
    const strings = Object.fromEntries(['dialog.config.title', 'dialog.config.category.general',
      'dialog.config.sfzSizeLimit', 'sfzNotePlayer.error.tooLarge',
      ...['loop-points-ignored', 'invalid-regions', 'missing-samples', 'unsupported-regions', 'reduced-bank']
        .map(code => `sfzNotePlayer.warning.${code}`)].map(key => {
      const line = lines.find(line => line.startsWith(`"${key}":`));
      return [key, JSON.parse(line.slice(line.indexOf(':') + 1).trim().replace(/,$/, ''))];
    }));
    const plugin = createPlugin({}, createDocument(), { uiManager: { t: key => strings[key] || key } });
    plugin._status = { dataset: {} };
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

test('SFZ controls remain English with a non-English app translator', async () => {
  for (const native of [false, true]) {
    const plugin = createPlugin({ list: async () => [] }, createDocument(), {
      ...(native ? { electronAPI: {} } : {}),
      uiManager: { t: key => `翻訳:${key}` }
    });
    const ui = plugin.createUI();
    await plugin._refreshBanks();
    const bankRow = ui.children[0].children[0];
    assert.equal(plugin._bankSelect.children[0].textContent, 'None');
    assert.deepEqual([
      bankRow.children[2].textContent,
      bankRow.children[3].textContent,
      plugin._importRow.children[1].textContent
    ], [native ? 'Select SFZ Folder…' : 'Import Folder…', 'Remove', native ? 'Select' : 'Import']);
  }
});

function createDocument() {
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
    return element;
  };
  return document;
}

async function createLibrary() {
  const stored = new Map();
  return new SfzLibraryService({
    read: async name => stored.get(name),
    writeAtomic: async (name, bytes) => stored.set(name, bytes.slice())
  }, { onDiagnostic: null }).open();
}

function folderFile(name, text, size) {
  const bytes = new TextEncoder().encode(text);
  return { name, webkitRelativePath: `Instrument/${name}`, size: size ?? bytes.length,
    arrayBuffer: async () => bytes.slice().buffer };
}

test('Electron selects an external SFZ directly and keeps preparation pending', async () => {
  const selection = deferred();
  const loading = deferred();
  const entered = deferred();
  const entry = { id: 'd'.repeat(24), name: 'External.sfz' };
  let selected = false;
  const plugin = createPlugin({
    list: async () => selected ? [entry] : [],
    selectFolder: ({ isCurrent }) => { assert.equal(isCurrent(), true); entered.resolve(); return selection.promise; },
    prepare: async id => { assert.equal(id, entry.id); return loading.promise; },
    importFolderFiles() { assert.fail('Electron must not copy a folder into a bank'); }
  }, createDocument(), { electronAPI: {}, showDirectoryPicker() { assert.fail('No browser picker'); } });
  const ui = plugin.createUI();
  plugin._folderInput.click = () => assert.fail('No folder picker');
  const button = ui.children[0].children[0].children[2];
  assert.equal(button.textContent, 'Select SFZ Folder…');
  const operation = button.dispatchEvent('click');
  await entered.promise;
  assert.equal(plugin.externalAssetInfo.pending, true);
  selected = true;
  selection.resolve([entry]);
  await Promise.resolve();
  loading.resolve(prepared);
  await operation;
  assert.equal(plugin.sf, entry.id);
  assert.equal(plugin.getWasmAssets().get(0).externalAssetSignature, entry.id);
  assert.equal(plugin._bankSelect.value, entry.id);
  assert.equal(plugin.externalAssetInfo.pending, false);
  assert.equal(plugin._status.hidden, true);
});

test('Electron file selection respects cancellation, later selection, cleanup and current errors', async () => {
  for (const outcome of ['cancel', 'later', 'cleanup', 'error']) {
    const selection = deferred();
    const entered = deferred();
    const plugin = createPlugin({ list: async () => [], prepare: async () => prepared,
      selectFolder: () => { entered.resolve(); return selection.promise; }
    }, createDocument(), { electronAPI: {} });
    plugin.createUI();
    const operation = plugin._selectNativeFolder();
    await entered.promise;
    if (outcome === 'later') {
      plugin.setParameters({ sf: 'b'.repeat(24) });
      await plugin.resolveOfflineDspAssetRequirement();
    } else if (outcome === 'cleanup') plugin.cleanup();
    if (outcome === 'error') selection.reject({ code: 'too-large' });
    else selection.resolve(outcome === 'cancel' ? null : [{ id: 'a'.repeat(24), name: 'Old.sfz' }]);
    await operation;
    assert.equal(plugin.sf, outcome === 'later' ? 'b'.repeat(24) : '');
    assert.equal(plugin.externalAssetInfo?.pending ?? false, false);
    assert.equal(plugin._error, outcome === 'error' ? 'tooLarge' : '');
  }
});

test('Electron folder candidates share the existing chooser and stale choices never load', async () => {
  for (const outcome of ['select', 'cleanup', 'later']) {
    const entries = [{ id: 'a'.repeat(24), name: 'Keys/Piano.sfz' },
      { id: 'b'.repeat(24), name: 'Brass/Trumpet.sfz' }];
    const preparing = [];
    const plugin = createPlugin({ selectFolder: async () => entries, list: async () => entries,
      prepare: async id => { preparing.push(id); return prepared; }
    }, createDocument(), { electronAPI: {} });
    plugin.createUI();
    const choosing = deferred();
    const wait = plugin._waitImportSelection.bind(plugin);
    plugin._waitImportSelection = () => { const pending = wait(); choosing.resolve(); return pending; };
    const operation = plugin._selectNativeFolder();
    await choosing.promise;
    assert.equal(plugin.externalAssetInfo.pending, true);
    assert.equal(plugin._importRow.hidden, false);
    assert.deepEqual(plugin._importChoices.children.map(option => option.textContent), entries.map(entry => entry.name));
    assert.equal(plugin._importRow.children[1].textContent, 'Select');
    if (outcome === 'select') {
      plugin._importChoices.value = entries[1].id;
      await plugin._importRow.children[1].dispatchEvent('click');
    } else if (outcome === 'cleanup') plugin.cleanup();
    else plugin.setParameters({ sf: 'c'.repeat(24) });
    await operation;
    await plugin.resolveOfflineDspAssetRequirement();
    assert.deepEqual(preparing, outcome === 'select' ? [entries[1].id] : outcome === 'later' ? ['c'.repeat(24)] : []);
    assert.equal(plugin._importRow.hidden, true);
    assert.equal(plugin.externalAssetInfo?.pending ?? false, false);
  }
});

test('Web imports and selects FileList banks when the native directory API is unavailable', async () => {
  const service = await createLibrary();
  const clicked = deferred();
  const plugin = createPlugin(service, createDocument());
  plugin._decodeAudioData = async () => ({ sampleRate: 48000, channels: [new Float32Array([.1, .2, .3])] });
  plugin.createUI();
  plugin._folderInput.click = () => clicked.resolve();
  const operation = plugin._chooseFolder();
  await clicked.promise;
  plugin._folderInput.files = [folderFile('Piano.sfz', '<region> sample=tone.wav key=60'),
    folderFile('tone.wav', 'synthetic PCM decoded by the test')];
  await plugin._folderInput.dispatchEvent('change');
  await operation;
  const [entry] = await service.list();
  assert.equal(entry.name, 'Piano.sfz');
  assert.equal(plugin.sf, entry.id);
  assert.equal(plugin._bankSelect.value, entry.id);
  assert.ok(plugin._bankSelect.children.some(option => option.value === entry.id));
  assert.equal(plugin.getWasmAssets().get(0).externalAssetSignature, entry.id);
  assert.equal(plugin.externalAssetInfo.pending, false);
});

test('Web folder imports report unsupported event regions and oversized sample banks', async () => {
  for (const definition of [
    '<group> on_locc64=0 <region> sample=tone.wav',
    '<group> locc64=64 <region> sample=tone.wav',
    '<region> sample=tone.wav loop_mode=one_shot',
    '<region> sample=tone.wav loop_mode=loop_continuous'
  ]) {
    const service = await createLibrary();
    const clicked = deferred();
    const plugin = createPlugin(service, createDocument());
    plugin.createUI();
    plugin._folderInput.click = () => clicked.resolve();
    const operation = plugin._chooseFolder();
    await clicked.promise;
    plugin._folderInput.files = [folderFile('Instrument.sfz', definition),
      folderFile('tone.wav', '', SFZ_DEFAULT_MAX_BYTES + 1)];
    await plugin._folderInput.dispatchEvent('change');
    await operation;
    const pedal = definition.includes('cc64');
    assert.equal(plugin._error, pedal ? 'noRegions' : 'tooLarge');
    assert.match(plugin._status.textContent, pedal ? /No playable samples/ : /choose a smaller SFZ/);
    assert.equal(plugin.externalAssetInfo, null);
    assert.deepEqual(await service.list(), []);
  }
});

test('folder enumeration is pending from the UI entry and cannot override a later selection or cleanup', async () => {
  for (const action of ['select', 'cleanup']) {
    const entered = deferred();
    const enumerated = deferred();
    let imports = 0;
    const handle = { async *entries() {
      entered.resolve();
      await enumerated.promise;
      yield ['Piano.sfz', { kind: 'file', getFile: async () => folderFiles[0] }];
    } };
    const plugin = createPlugin({ list: async () => [], prepare: async () => prepared,
      importFolderFiles: async () => { imports++; return { id: 'a'.repeat(24) }; }
    }, createDocument(), { showDirectoryPicker: async () => handle });
    plugin.createUI();
    const operation = plugin._chooseFolder();
    assert.equal(plugin.externalAssetInfo.pending, true);
    assert.equal(plugin.offlineDspAssetRequired, true);
    await entered.promise;
    let finished = false;
    const offline = plugin.resolveOfflineDspAssetRequirement().then(value => { finished = true; return value; });
    await Promise.resolve();
    assert.equal(finished, false);
    if (action === 'select') {
      plugin.setParameters({ sf: 'b'.repeat(24) });
      await plugin.resolveOfflineDspAssetRequirement();
    } else plugin.cleanup();
    enumerated.resolve();
    await operation;
    assert.equal((await offline).required, action === 'select');
    assert.equal(imports, 0, 'Stale enumeration must not start saving a bank');
    assert.equal(plugin.sf, action === 'select' ? 'b'.repeat(24) : '');
    assert.equal(plugin.externalAssetInfo?.pending ?? false, false);
    assert.equal(plugin._error, '');
  }
});

test('fallback folder and multiple-SFZ choices share pending ownership through preparation', async () => {
  const clicked = deferred();
  const choosing = deferred();
  const preparing = deferred();
  const loaded = deferred();
  let importedPath;
  const plugin = createPlugin({ list: async () => [],
    importFolderFiles: async (files, path) => { importedPath = path; return { id: 'a'.repeat(24) }; },
    prepare: () => { preparing.resolve(); return loaded.promise; }
  }, createDocument());
  plugin.createUI();
  plugin._folderInput.click = () => clicked.resolve();
  const accept = plugin._acceptFolder.bind(plugin);
  plugin._acceptFolder = (...args) => { const result = accept(...args); choosing.resolve(); return result; };
  const operation = plugin._chooseFolder();
  const offline = plugin.resolveOfflineDspAssetRequirement();
  assert.equal(plugin.externalAssetInfo.pending, true);
  await clicked.promise;
  plugin._folderInput.files = [{ name: 'First.sfz' }, { name: 'Second.sfz' }];
  await plugin._folderInput.dispatchEvent('change');
  await choosing.promise;
  assert.equal(plugin._importRow.hidden, false);
  assert.equal(plugin.externalAssetInfo.pending, true);
  plugin._importChoices.value = 'Second.sfz';
  await plugin._importRow.children[1].dispatchEvent('click');
  await preparing.promise;
  assert.equal(importedPath, 'Second.sfz');
  assert.equal(plugin.externalAssetInfo.pending, true);
  loaded.resolve(prepared);
  await operation;
  assert.equal((await offline).required, true);
  assert.equal(plugin.externalAssetInfo.pending, false);
  assert.equal(plugin.getWasmAssets().get(0).externalAssetSignature, 'a'.repeat(24));
});

test('folder picker cancellation, latest failure and abandoned fallback choices finish pending', async () => {
  for (const error of [{ name: 'AbortError' }, { code: 'storage' }]) {
    const plugin = createPlugin({}, undefined, { showDirectoryPicker() { throw error; } });
    await plugin._chooseFolder();
    assert.equal(plugin.externalAssetInfo, null);
    assert.equal(plugin.offlineDspAssetRequired, false);
    assert.equal(plugin._error, error.code === 'storage' ? 'storage' : '');
  }
  for (const action of ['cancel', 'cleanup', 'select']) {
    const clicked = deferred();
    const plugin = createPlugin({ list: async () => [] }, createDocument());
    plugin.createUI();
    plugin._folderInput.click = () => clicked.resolve();
    const operation = plugin._chooseFolder();
    await clicked.promise;
    if (action === 'cancel') await plugin._folderInput.dispatchEvent('cancel');
    else if (action === 'cleanup') plugin.cleanup();
    else plugin.setParameters({ sf: '' });
    await operation;
    assert.equal(plugin.externalAssetInfo, null);
    assert.equal(plugin._finishImportSelection, null);
    assert.equal(plugin._importRow.hidden, true);
  }
});

test('SFZ UI uses independent Dry/Wet controls and standard-width readable note names', async () => {
  const document = createDocument();
  const plugin = createPlugin({ list: async () => [] }, document);
  const ui = plugin.createUI();
  assert.match(ui.className, /plugin-parameter-ui/);
  assert.equal(plugin._folderInput.hasAttribute('webkitdirectory'), true);
  assert.equal(plugin._folderInput.hasAttribute('accept'), false, 'Folder imports must retain sample files');
  assert.equal(plugin._status.getAttribute('role'), 'status');
  const controls = ui.children.at(-1);
  assert.equal(controls.className, 'sfz-controls analyzer-parameters');
  assert.equal(controls.children.length, 20);
  assert.equal(controls.children[0].className, 'parameter-row sfz-bank-row');
  assert.deepEqual(controls.children.filter(row => row.controlKey).map(row => row.controlKey),
    ['hi', 'md', 'lo', 'th', 'rd', 'nh', 'vf', 'vc', 'pl', 'dm', 'wm', 'os', 'og', 'tm']);
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
  assert.equal(plugin._removeButton.disabled, true);
});

test('SFZ load problems show once per selection, with Close, Escape and cleanup', async () => {
  const document = createDocument();
  const problem = { ...prepared, warnings: [{ code: 'loop-points-ignored', count: 1 }] };
  const plugin = createPlugin({ list: async () => [], prepare: async () => problem }, document);
  plugin._isCurrentWasmAssetOperation = () => true;
  plugin.createUI();
  const notices = () => document.body.children.filter(x => x.className.includes('sfz-load-notice-overlay'));
  plugin._bankSelect.value = 'a'.repeat(24);
  await plugin._bankSelect.dispatchEvent('change', { target: plugin._bankSelect });
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
  await plugin._bankSelect.dispatchEvent('change', { target: { value: 'b'.repeat(24) } });
  await plugin._pending;
  plugin.onWasmAssetState(0, 3, 2);
  assert.equal(notices().length, 1);
  await document.dispatchEvent('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(notices().length, 0);
  assert.equal(document.listenerCount('keydown'), 0);
  await plugin._bankSelect.dispatchEvent('change', { target: { value: 'c'.repeat(24) } });
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
    await plugin._bankSelect.dispatchEvent('change', { target: { value: 'a'.repeat(24) } });
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
  plugin._bankSelect.dispatchEvent('change', { target: { value: 'a'.repeat(24) } });
  await Promise.resolve();
  await Promise.resolve();
  const oldLoad = plugin._pending;
  await plugin._bankSelect.dispatchEvent('change', { target: { value: 'b'.repeat(24) } });
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
  await plugin._bankSelect.dispatchEvent('change', { target: { value: 'c'.repeat(24) } });
  plugin.onWasmAssetState(0, 3, 2);
  quiet();
  plugin.setParameters({ th: .7 });
  plugin.onWasmAssetRejected(0, 'module-budget', 2);
  plugin.onWasmAssetState(0, 4, 2);
  quiet();
  assert.equal(plugin._error, 'prepare');

  await plugin._bankSelect.dispatchEvent('change', { target: { value: 'd'.repeat(24) } });
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
  await plugin._bankSelect.dispatchEvent('change', { target: { value: 'e'.repeat(24) } });
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
    const selection = plugin._bankSelect.dispatchEvent('change', { target: { value: 'a'.repeat(24) } });
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
