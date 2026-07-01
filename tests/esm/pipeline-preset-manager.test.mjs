import assert from 'node:assert/strict';
import test from 'node:test';

import { PresetManager } from '../../js/ui/pipeline/preset-manager.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

class FakeElement {
  constructor(tagName = 'div', options = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = options.id ?? '';
    this.value = options.value ?? '';
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.listeners = new Map();
    this.textContent = options.textContent ?? '';
    this._innerHTML = '';
    this._className = '';
    this.classes = new Set();
    this.classList = {
      add: className => {
        this.classes.add(className);
        this._className = [...this.classes].join(' ');
      },
      remove: className => {
        this.classes.delete(className);
        this._className = [...this.classes].join(' ');
      },
      contains: className => this.classes.has(className),
      toggle: (className, force) => {
        const shouldAdd = force === undefined ? !this.classes.has(className) : Boolean(force);
        if (shouldAdd) {
          this.classes.add(className);
        } else {
          this.classes.delete(className);
        }
        this._className = [...this.classes].join(' ');
        return shouldAdd;
      }
    };
    this.className = options.className ?? '';
  }

  set className(value) {
    this._className = value;
    this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get className() {
    return this._className;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (value === '') {
      this.children = [];
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  async dispatchEvent(type, event = {}) {
    const eventObject = { target: this, type, ...event };
    await Promise.all((this.listeners.get(type) || []).map(listener => listener(eventObject)));
  }

  focus() {
    this.focused = true;
  }
}

function createDocument(options = {}) {
  const elements = new Map();
  const make = (id, tagName = 'div', elementOptions = {}) => {
    if (options.omitIds?.includes(id)) return null;
    const element = new FakeElement(tagName, { id, ...elementOptions });
    elements.set(id, element);
    return element;
  };

  const presetSelect = make('presetSelect', 'input', { value: options.presetValue ?? '' });
  make('presetClearButton', 'button');
  make('savePresetButton', 'button');
  make('deletePresetButton', 'button');
  make('presetList', 'datalist');
  const masterToggle = new FakeElement('button', { className: 'toggle-button master-toggle off' });

  return {
    elements,
    presetSelect,
    masterToggle,
    documentRef: {
      createElement(tagName) {
        return new FakeElement(tagName);
      },
      getElementById(id) {
        return elements.get(id) ?? null;
      },
      querySelector(selector) {
        if (selector === '.toggle-button.master-toggle') {
          return options.omitMasterToggle ? null : masterToggle;
        }
        return null;
      }
    }
  };
}

function createPlugin(name, options = {}) {
  const calls = [];
  return {
    name,
    enabled: options.enabled ?? true,
    inputBus: options.inputBus ?? null,
    outputBus: options.outputBus ?? null,
    channel: options.channel ?? null,
    parameters: options.parameters ?? { gain: 1 },
    audioManager: options.audioManager,
    calls,
    setEnabled(value) {
      calls.push(['setEnabled', value]);
      this.enabled = value;
    },
    setSerializedParameters(state) {
      calls.push(['setSerializedParameters', { ...state }]);
      this.parameters = { ...state };
    },
    updateParameters() {
      calls.push(['updateParameters']);
    },
    getSerializableParameters() {
      return options.serializable ?? { gain: 2, id: 'internal', enabled: false };
    },
    cleanup: options.cleanup
      ? () => calls.push(['cleanup'])
      : undefined
  };
}

function createPipelineManager(options = {}) {
  const calls = [];
  const retainedPlugin = createPlugin('Retained');
  const cleanupPlugin = createPlugin('Cleanup', { cleanup: true });
  const plainPlugin = createPlugin('Plain');
  const audioManager = {
    pipeline: options.pipeline ?? [cleanupPlugin, plainPlugin],
    pipelineA: options.pipelineA ?? [retainedPlugin],
    pipelineB: options.pipelineB ?? [retainedPlugin],
    currentPipeline: options.currentPipeline ?? 'A',
    updateCurrentPipeline(plugins) {
      calls.push(['updateCurrentPipeline', plugins.map(plugin => plugin.name)]);
      this.pipeline = plugins;
    },
    setMasterBypass(value) {
      calls.push(['setMasterBypass', value]);
    }
  };
  const historyManager = {
    undoRedoTimeoutId: options.undoRedoTimeoutId ?? null,
    isUndoRedoOperation: false,
    specialSaveOverride: false,
    saveState() {
      calls.push(['saveState']);
    }
  };
  const createdPlugins = [];
  const pipelineManager = {
    calls,
    audioManager,
    historyManager,
    expandedPlugins: new Set(options.expandedPlugins ?? [retainedPlugin]),
    pluginManager: {
      createPlugin(name) {
        calls.push(['createPlugin', name]);
        if (name === 'Missing') return null;
        const plugin = createPlugin(name, { audioManager });
        createdPlugins.push(plugin);
        return plugin;
      }
    },
    core: {
      enabled: false,
      updatePipelineUI(force) {
        calls.push(['updatePipelineUI', force]);
      },
      updateWorkletPlugins() {
        calls.push(['updateWorkletPlugins']);
      },
      getSerializablePluginState(plugin, short, includeParams, includeMeta) {
        calls.push(['getSerializablePluginState', plugin.name, short, includeParams, includeMeta]);
        return { name: plugin.name, enabled: plugin.enabled, parameters: { exported: true } };
      }
    },
    createdPlugins,
    retainedPlugin,
    cleanupPlugin
  };
  audioManager.pipelineManager = pipelineManager;
  return pipelineManager;
}

async function withPresetGlobals(options, callback) {
  const dom = options.dom ?? createDocument(options.documentOptions);
  const calls = [];
  const storage = new Map(Object.entries(options.storage ?? {}));
  const windowRef = {
    electronAPI: options.electronAPI,
    electronIntegration: options.electronIntegration,
    uiManager: options.uiManager
  };
  const localStorageRef = {
    getItem(key) {
      calls.push(['getItem', key]);
      if (options.storageGetError) throw new Error('get failed');
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      calls.push(['setItem', key, value]);
      if (options.storageSetError) throw new Error('set failed');
      storage.set(key, value);
    }
  };
  const consoleRef = {
    error(...args) {
      calls.push(['console.error', ...args]);
    },
    warn(...args) {
      calls.push(['console.warn', ...args]);
    },
    log(...args) {
      calls.push(['console.log', ...args]);
    }
  };

  await withGlobals({
    document: dom.documentRef,
    window: windowRef,
    localStorage: localStorageRef,
    console: consoleRef,
    confirm: options.confirm ?? (() => true),
    Date: { now: () => 123456 },
    setTimeout(callbackRef, delay) {
      calls.push(['setTimeout', delay]);
      callbackRef();
      return 1;
    },
    clearTimeout(id) {
      calls.push(['clearTimeout', id]);
    }
  }, async () => {
    await callback({ dom, calls, storage, windowRef });
  });
}

async function createInitializedManager(pipelineManager, options = {}) {
  const manager = new PresetManager(pipelineManager);
  await flushMicrotasks();
  await flushMicrotasks();
  if (options.waitMore) {
    await flushMicrotasks();
  }
  return manager;
}

function createUiManager(calls, options = {}) {
  return {
    pluginListManager: options.pluginListManager ?? {
      async refreshPresetsIfVisible() {
        calls.push(['refreshPresetsIfVisible']);
      }
    },
    setError(key, isError, params) {
      calls.push(['setError', key, isError, params]);
    },
    clearError() {
      calls.push(['clearError']);
    },
    t(key) {
      return key;
    }
  };
}

test('constructor initializes controls and handles listener combinations', async () => {
  await withPresetGlobals({
    storage: {
      effetune_presets: JSON.stringify({
        Zebra: { plugins: [] },
        Alpha: { plugins: [] }
      })
    }
  }, async ({ dom }) => {
    const manager = await createInitializedManager(createPipelineManager());
    const datalist = dom.elements.get('presetList');
    assert.deepEqual(datalist.children.map(option => option.value), ['Alpha', 'Zebra']);
    assert.equal(manager.presetClearButton.classList.contains('visible'), false);

    const listenerCalls = [];
    manager.savePreset = async name => listenerCalls.push(['savePreset', name]);
    manager.deletePreset = async name => listenerCalls.push(['deletePreset', name]);
    manager.getPresets = async () => ({ Old: { plugins: [] }, LoadMe: { plugins: [] } });
    manager.loadPreset = async name => listenerCalls.push(['loadPreset', name]);

    manager.presetSelect.value = '  Saved Name  ';
    await manager.savePresetButton.dispatchEvent('click');
    manager.presetSelect.value = '   ';
    await manager.savePresetButton.dispatchEvent('click');
    manager.presetSelect.value = 'Old';
    await manager.deletePresetButton.dispatchEvent('click');
    globalThis.confirm = () => false;
    manager.presetSelect.value = 'Old';
    await manager.deletePresetButton.dispatchEvent('click');
    globalThis.confirm = () => true;
    manager.presetSelect.value = '   ';
    await manager.deletePresetButton.dispatchEvent('click');
    manager.presetSelect.value = 'Missing';
    await manager.deletePresetButton.dispatchEvent('click');
    manager.presetSelect.value = 'LoadMe';
    await manager.presetSelect.dispatchEvent('change', { target: manager.presetSelect });
    manager.presetSelect.value = 'Absent';
    await manager.presetSelect.dispatchEvent('change', { target: manager.presetSelect });
    manager.presetSelect.value = 'x';
    await manager.presetSelect.dispatchEvent('input');
    assert.equal(manager.presetClearButton.classList.contains('visible'), true);
    await manager.presetClearButton.dispatchEvent('click');
    assert.equal(manager.presetSelect.value, '');
    assert.equal(manager.presetSelect.focused, true);

    assert.deepEqual(listenerCalls, [
      ['savePreset', 'Saved Name'],
      ['deletePreset', 'Old'],
      ['loadPreset', 'LoadMe']
    ]);
  });

  await withPresetGlobals({
    documentOptions: { omitIds: ['presetClearButton'] }
  }, async () => {
    const manager = await createInitializedManager(createPipelineManager());
    manager.updatePresetClearButton();
  });

  await withPresetGlobals({
    documentOptions: { omitIds: ['savePresetButton'] }
  }, async ({ calls }) => {
    new PresetManager(createPipelineManager());
    await flushMicrotasks();
    await flushMicrotasks();
    assert.ok(calls.some(call => call[0] === 'console.error' && call[1] === 'Failed to initialize preset management:'));
  });
});

test('getPresets reads web and Electron storage while recovering from missing or failed storage', async () => {
  await withPresetGlobals({}, async () => {
    const manager = await createInitializedManager(createPipelineManager());
    assert.deepEqual(await manager.getPresets(), {});
  });

  await withPresetGlobals({
    storage: { effetune_presets: '{"Web":{"plugins":[]}}' }
  }, async () => {
    const manager = await createInitializedManager(createPipelineManager());
    assert.deepEqual(await manager.getPresets(), { Web: { plugins: [] } });
  });

  await withPresetGlobals({
    storage: { effetune_presets: 'not-json' }
  }, async ({ calls }) => {
    const manager = await createInitializedManager(createPipelineManager());
    assert.deepEqual(await manager.getPresets(), {});
    assert.ok(calls.some(call => call[0] === 'console.error' && call[1] === 'Failed to load presets:'));
  });

  await withPresetGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async getPath() { return 'user'; },
      async joinPaths(...parts) { return parts.join('/'); },
      async fileExists() { return false; }
    }
  }, async () => {
    const manager = await createInitializedManager(createPipelineManager());
    assert.deepEqual(await manager.getPresets(), {});
  });

  await withPresetGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async getPath() { return 'user'; },
      async joinPaths(...parts) { return parts.join('/'); },
      async fileExists() { return true; },
      async readFile() { return { success: false, error: 'read failed' }; }
    }
  }, async () => {
    const manager = await createInitializedManager(createPipelineManager());
    assert.deepEqual(await manager.getPresets(), {});
  });

  await withPresetGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async getPath() { return 'user'; },
      async joinPaths(...parts) { return parts.join('/'); },
      async fileExists() { return true; },
      async readFile() { return { success: true, content: '{"Electron":{"plugins":[]}}' }; }
    }
  }, async () => {
    const manager = await createInitializedManager(createPipelineManager());
    assert.deepEqual(await manager.getPresets(), { Electron: { plugins: [] } });
  });
});

test('savePreset and deletePreset persist web and Electron presets with UI feedback', async () => {
  await withPresetGlobals({
    storage: { effetune_presets: '{"Old":{"plugins":[]}}' }
  }, async ({ calls, storage, windowRef }) => {
    windowRef.uiManager = createUiManager(calls);
    const manager = await createInitializedManager(createPipelineManager());
    await manager.savePreset('Saved');
    const saved = JSON.parse(storage.get('effetune_presets'));
    assert.deepEqual(Object.keys(saved).sort(), ['Old', 'Saved']);
    assert.equal(saved.Saved.plugins[0].nm, 'Cleanup');
    assert.ok(calls.some(call => call[0] === 'refreshPresetsIfVisible'));
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'success.presetSaved'));

    windowRef.uiManager = createUiManager(calls, { pluginListManager: null });
    await manager.savePreset('SavedNoRefresh');
    windowRef.uiManager = null;
    await manager.savePreset('SavedNoUi');
    windowRef.uiManager = createUiManager(calls, { pluginListManager: null });
    await manager.deletePreset('Saved');
    await manager.deletePreset('SavedNoRefresh');
    windowRef.uiManager = null;
    await manager.deletePreset('SavedNoUi');
    assert.equal(JSON.parse(storage.get('effetune_presets')).Saved, undefined);
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'success.presetDeleted'));
  });

  await withPresetGlobals({
    storageSetError: true
  }, async ({ calls, windowRef }) => {
    windowRef.uiManager = createUiManager(calls);
    const manager = await createInitializedManager(createPipelineManager());
    await manager.savePreset('Broken');
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'error.failedToSavePreset'));
    manager.getPresets = async () => ({ Broken: { plugins: [] } });
    await manager.deletePreset('Broken');
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'error.failedToDeletePreset'));
  });

  await withPresetGlobals({}, async ({ calls, windowRef }) => {
    windowRef.uiManager = createUiManager(calls);
    const manager = await createInitializedManager(createPipelineManager());
    await manager.deletePreset('Missing');
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'error.noPresetSelected'));
  });

  const savedFiles = [];
  await withPresetGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async getPath() { return 'user'; },
      async joinPaths(...parts) { return parts.join('/'); },
      async fileExists() { return true; },
      async readFile() { return { success: true, content: '{"ElectronOld":{"plugins":[]}}' }; },
      async saveFile(path, content) {
        savedFiles.push([path, JSON.parse(content)]);
        return { success: true };
      },
      async getUserPresetsForTray() { return { success: true, presets: ['Saved'] }; },
      updateTrayMenu(template) {
        savedFiles.push(['tray', template]);
        return Promise.resolve({ success: true });
      }
    }
  }, async ({ calls, windowRef }) => {
    windowRef.uiManager = createUiManager(calls);
    const manager = await createInitializedManager(createPipelineManager(), { waitMore: true });
    await manager.savePreset('ElectronSaved');
    await flushMicrotasks();
    await manager.deletePreset('ElectronOld');
    await flushMicrotasks();
    assert.ok(savedFiles.some(entry => entry[0] === 'user/effetune_presets.json'));
    assert.ok(savedFiles.some(entry => entry[0] === 'tray'));
  });
});

test('loadPreset applies preset formats, restores state, and reports invalid data', async () => {
  await withPresetGlobals({
    storage: {
      effetune_presets: JSON.stringify({
        NewFormat: {
          pipeline: [
            {
              name: 'Alpha',
              enabled: false,
              inputBus: 1,
              outputBus: 2,
              channel: 'Left',
              parameters: { mix: 0.5 }
            },
            { name: 'Missing', enabled: true, parameters: {} },
            { name: 'Gamma', enabled: true, parameters: { depth: 3 } }
          ]
        }
      })
    }
  }, async ({ calls, dom, windowRef }) => {
    windowRef.uiManager = createUiManager(calls, { pluginListManager: null });
    const pipelineManager = createPipelineManager({ undoRedoTimeoutId: 77 });
    const manager = await createInitializedManager(pipelineManager);
    await manager.loadPreset('MissingPreset');
    await manager.loadPreset(null);
    await manager.loadPreset('NewFormat');

    assert.deepEqual(pipelineManager.audioManager.pipeline.map(plugin => plugin.name), ['Alpha', 'Gamma']);
    assert.equal(pipelineManager.createdPlugins[0].enabled, false);
    assert.equal(pipelineManager.createdPlugins[0].inputBus, 1);
    assert.equal(pipelineManager.createdPlugins[0].outputBus, 2);
    assert.equal(pipelineManager.createdPlugins[0].channel, 'L');
    assert.equal(pipelineManager.expandedPlugins.has(pipelineManager.retainedPlugin), true);
    assert.equal(pipelineManager.core.enabled, true);
    assert.equal(dom.masterToggle.classList.contains('off'), false);
    assert.ok(pipelineManager.cleanupPlugin.calls.some(call => call[0] === 'cleanup'));
    assert.ok(calls.some(call => call[0] === 'clearTimeout' && call[1] === 77));
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'success.presetLoaded'));
  });

  await withPresetGlobals({
    documentOptions: { omitMasterToggle: true }
  }, async ({ calls, windowRef }) => {
    windowRef.uiManager = createUiManager(calls, { pluginListManager: null });
    const pipelineManager = createPipelineManager({ currentPipeline: 'B' });
    const manager = await createInitializedManager(pipelineManager);
    await manager.loadPreset({
      name: 'Old Object',
      plugins: [
        { nm: 'Beta', en: true, ib: 0, ob: 1, ch: 'R', q: 10 },
        { nm: 'Missing', en: true }
      ]
    });
    await manager.loadPreset({
      plugins: [
        { nm: 'Beta', en: true }
      ]
    });
    assert.deepEqual(pipelineManager.audioManager.pipeline.map(plugin => plugin.name), ['Beta']);
    assert.equal(pipelineManager.createdPlugins[0].channel, 'R');
  });

  await withPresetGlobals({}, async ({ calls, windowRef }) => {
    windowRef.uiManager = createUiManager(calls);
    const manager = await createInitializedManager(createPipelineManager());
    await manager.loadPreset({ name: 'Bad' });
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'error.failedToLoadPreset'));
  });
});

test('loadPresetList and getCurrentPresetData handle empty DOM and export defaults', async () => {
  await withPresetGlobals({
    documentOptions: { omitIds: ['presetList'], presetValue: '  ' }
  }, async () => {
    const pipelineManager = createPipelineManager();
    const manager = await createInitializedManager(pipelineManager);
    await manager.loadPresetList('Ignored');
    assert.deepEqual(manager.getCurrentPresetData(), {
      name: 'My Preset',
      pipeline: [
        { name: 'Cleanup', enabled: true, parameters: { exported: true } },
        { name: 'Plain', enabled: true, parameters: { exported: true } }
      ],
      timestamp: 123456
    });
    manager.presetSelect.value = 'Named';
    assert.equal(manager.getCurrentPresetData().name, 'Named');
  });
});
