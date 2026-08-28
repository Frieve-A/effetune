import assert from 'node:assert/strict';
import test from 'node:test';

import { PresetManager } from '../../js/ui/pipeline/preset-manager.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

function createDeferred() {
  let resolve;
  const promise = new Promise(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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
    this.attributes = new Map();
    this.scrollHeight = options.scrollHeight ?? 0;
    this.rect = options.rect;
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

  contains(element) {
    for (let current = element; current; current = current.parentNode) {
      if (current === this) return true;
    }
    return false;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  getBoundingClientRect() {
    return this.rect ?? {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      width: 0,
      height: 0
    };
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  async dispatchEvent(type, event = {}) {
    const eventObject = {
      target: this,
      type,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...event
    };
    await Promise.all((this.listeners.get(type) || []).map(listener => listener(eventObject)));
    return eventObject;
  }

  focus() {
    this.focused = true;
  }

  scrollIntoView() {
    this.scrolledIntoView = true;
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

  make('pipelinePresetButton', 'button');
  const masterToggle = new FakeElement('button', { className: 'toggle-button master-toggle off' });
  const body = new FakeElement('body');
  body.style.zoom = options.bodyZoom ?? '';

  return {
    elements,
    masterToggle,
    documentRef: {
      body,
      documentElement: {
        clientHeight: options.viewportHeight ?? 0,
        clientWidth: options.viewportWidth ?? 0
      },
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
    historySuppressionDepth: 0,
    get isHistorySuppressed() { return this.historySuppressionDepth > 0; },
    withHistorySuppressed(callback) {
      calls.push(['withHistorySuppressed']);
      this.historySuppressionDepth++;
      try {
        return callback();
      } finally {
        this.historySuppressionDepth--;
      }
    },
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
      pluginPresetDialog: options.pluginPresetDialog ?? {
        show(...args) {
          calls.push(['showPresetDialog', ...args]);
        }
      },
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
    uiManager: options.uiManager,
    innerHeight: options.viewportHeight ?? options.documentOptions?.viewportHeight ?? 0,
    innerWidth: options.viewportWidth ?? options.documentOptions?.viewportWidth ?? 0,
    getComputedStyle: options.getComputedStyle
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
  const messageState = options.messageState;
  return {
    pluginListManager: options.pluginListManager ?? {
      async refreshPresetsIfVisible() {
        calls.push(['refreshPresetsIfVisible']);
      }
    },
    setError(key, isError, params) {
      calls.push(['setError', key, isError, params]);
      if (messageState) {
        messageState.revision += 1;
        messageState.current = { key, isError, params };
      }
    },
    clearError() {
      calls.push(['clearError']);
      if (messageState) {
        messageState.revision += 1;
        messageState.current = null;
      }
    },
    showTransientMessage(key, isError, params = {}, duration = 3000) {
      calls.push(['showTransientMessage', key, isError, params, duration]);
      if (messageState) {
        const revision = ++messageState.revision;
        messageState.current = { key, isError, params };
        messageState.timers.push(() => {
          if (revision !== messageState.revision) return;
          messageState.current = null;
        });
      }
    },
    t(key) {
      return key;
    }
  };
}

test('constructor opens the shared dialog with the pipeline provider', async () => {
  await withPresetGlobals({
    storage: {
      effetune_presets: JSON.stringify({
        Zebra: { plugins: [] },
        Alpha: { plugins: [] }
      })
    }
  }, async ({ calls, dom, windowRef }) => {
    windowRef.uiManager = createUiManager(calls);
    const pipelineManager = createPipelineManager();
    const manager = await createInitializedManager(pipelineManager);
    manager.currentPresetName = 'Alpha';
    await dom.elements.get('pipelinePresetButton').dispatchEvent('click');
    const showCall = pipelineManager.calls.find(call => call[0] === 'showPresetDialog');
    const provider = showCall[1];
    assert.equal(showCall[2], dom.elements.get('pipelinePresetButton'));
    assert.deepEqual(showCall[3], { focusSaveName: false });
    assert.equal(provider.getTitleKey(), 'ui.title.pipelinePresets');
    assert.equal(provider.getSystemPresetGroups(), null);
    assert.equal(provider.getActiveSystemPresetId(), '');
    assert.equal(provider.getActiveUserPresetName(), 'Alpha');
    assert.equal(provider.getPresetContext(), manager);
    assert.equal(provider.getDefaultSaveName(), 'Alpha');
    assert.deepEqual((await provider.listUserPresetNames()).sort(), ['Alpha', 'Zebra']);
    assert.equal(provider.handlesErrors, true);

    assert.equal(await provider.saveUserPreset('Dialog Save'), true);
    assert.equal(
      calls.some(call => call[0] === 'showTransientMessage' && call[1] === 'success.presetSaved'),
      true
    );

    manager.openPresetDialog({ focusSaveName: true });
    assert.deepEqual(pipelineManager.calls.at(-1)[3], { focusSaveName: true });
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

test('loadable preset filtering excludes malformed presets and unavailable plugins', async () => {
  await withPresetGlobals({
    storage: {
      effetune_presets: JSON.stringify({
        Empty: { plugins: [] },
        LoadableNew: { pipeline: [{ name: 'Plain', enabled: true, parameters: {} }] },
        LoadableOld: { plugins: [{ nm: 'Cleanup', en: true }] },
        MissingName: { plugins: [{ en: true }] },
        Unavailable: { plugins: [{ nm: 'UnavailablePlugin', en: true }] },
        InvalidFormat: { name: 'Bad' }
      })
    }
  }, async ({ calls, windowRef }) => {
    windowRef.uiManager = createUiManager(calls);
    const pipelineManager = createPipelineManager();
    pipelineManager.pluginManager.isPluginAvailable = name => name !== 'UnavailablePlugin';
    const manager = await createInitializedManager(pipelineManager);

    assert.deepEqual(Object.keys(await manager.getLoadablePresets()).sort(), ['Empty', 'LoadableNew', 'LoadableOld']);

    await manager.loadPreset('Unavailable');
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'error.invalidPresetData'));
    assert.deepEqual(pipelineManager.audioManager.pipeline.map(plugin => plugin.name), ['Cleanup', 'Plain']);
  });
});

test('savePreset and deletePreset persist web and Electron presets with UI feedback', async () => {
  await withPresetGlobals({
    storage: { effetune_presets: '{"Old":{"plugins":[]}}' }
  }, async ({ calls, storage, windowRef }) => {
    windowRef.uiManager = createUiManager(calls);
    const pipelineManager = createPipelineManager();
    pipelineManager.audioManager.pipeline[0].externalAssetInfo = {
      missing: false,
      kind: 'IR',
      ids: ['aaaaaaaaaaaaaaaaaaaaaaaa'],
      names: ['Measured Hall']
    };
    const manager = await createInitializedManager(pipelineManager);
    await manager.savePreset('Saved');
    assert.equal(manager.currentPresetName, 'Saved');
    const saved = JSON.parse(storage.get('effetune_presets'));
    assert.deepEqual(Object.keys(saved).sort(), ['Old', 'Saved']);
    assert.equal(saved.Saved.plugins[0].nm, 'Cleanup');
    assert.ok(calls.some(call => call[0] === 'refreshPresetsIfVisible'));
    assert.ok(calls.some(call => call[0] === 'showTransientMessage' && call[1] === 'success.presetSaved'));

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
    assert.ok(calls.some(call => call[0] === 'showTransientMessage' && call[1] === 'success.presetDeleted'));
  });

  await withPresetGlobals({
    storageSetError: true
  }, async ({ calls, windowRef }) => {
    windowRef.uiManager = createUiManager(calls);
    const manager = await createInitializedManager(createPipelineManager());
    await manager.savePreset('Broken');
    assert.ok(calls.some(call => call[0] === 'showTransientMessage' && call[1] === 'error.failedToSavePreset'));
    manager.getPresets = async () => ({ Broken: { plugins: [] } });
    await manager.deletePreset('Broken');
    assert.ok(calls.some(call => call[0] === 'showTransientMessage' && call[1] === 'error.failedToDeletePreset'));
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

test('renamePreset and deletePresets mutate once and maintain currentPresetName', async () => {
  await withPresetGlobals({
    storage: { effetune_presets: '{"First":{"plugins":[]},"Second":{"plugins":[]}}' }
  }, async ({ calls, storage, windowRef }) => {
    windowRef.uiManager = createUiManager(calls);
    const manager = await createInitializedManager(createPipelineManager());
    manager.currentPresetName = 'First';
    let persistCount = 0;
    let enqueueCount = 0;
    const persistPresets = manager.persistPresets.bind(manager);
    const enqueuePresetMutation = manager.enqueuePresetMutation.bind(manager);
    manager.persistPresets = async presets => {
      persistCount += 1;
      return persistPresets(presets);
    };
    manager.enqueuePresetMutation = mutation => {
      enqueueCount += 1;
      return enqueuePresetMutation(mutation);
    };

    assert.equal(await manager.renamePreset('First', 'Renamed'), true);
    assert.equal(manager.currentPresetName, 'Renamed');
    assert.equal(persistCount, 1);
    assert.equal(enqueueCount, 1);
    assert.deepEqual(Object.keys(JSON.parse(storage.get('effetune_presets'))).sort(), ['Renamed', 'Second']);

    assert.equal(await manager.deletePresets(['Renamed', 'Second']), true);
    assert.equal(manager.currentPresetName, '');
    assert.equal(persistCount, 2);
    assert.equal(enqueueCount, 2);
    assert.deepEqual(JSON.parse(storage.get('effetune_presets')), {});
    const deletedMessages = calls.filter(call => call[0] === 'showTransientMessage' && call[1] === 'success.presetDeleted');
    assert.equal(deletedMessages.length, 1);
    assert.equal(deletedMessages[0][3].name, 'Renamed, Second');

    assert.equal(await manager.renamePreset('Missing', 'Nope'), false);
    assert.ok(calls.some(call => call[0] === 'showTransientMessage' && call[1] === 'error.failedToSavePreset'));
  });

  let trayUpdateCount = 0;
  await withPresetGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async getPath() { return 'user'; },
      async joinPaths(...parts) { return parts.join('/'); },
      async fileExists() { return true; },
      async readFile() { return { success: true, content: '{"First":{"plugins":[]},"Second":{"plugins":[]}}' }; },
      async saveFile() { return { success: true }; },
      async getUserPresetsForTray() { return { success: true, presets: [] }; },
      async updateTrayMenu() { trayUpdateCount += 1; return { success: true }; }
    }
  }, async ({ windowRef }) => {
    windowRef.uiManager = createUiManager([]);
    const manager = await createInitializedManager(createPipelineManager());
    let enqueueCount = 0;
    let persistCount = 0;
    const enqueuePresetMutation = manager.enqueuePresetMutation.bind(manager);
    const persistPresets = manager.persistPresets.bind(manager);
    manager.enqueuePresetMutation = mutation => {
      enqueueCount += 1;
      return enqueuePresetMutation(mutation);
    };
    manager.persistPresets = presets => {
      persistCount += 1;
      return persistPresets(presets);
    };

    assert.equal(await manager.renamePreset('First', 'Renamed'), true);
    assert.equal(enqueueCount, 1);
    assert.equal(persistCount, 1);
    assert.equal(trayUpdateCount, 1);
  });
});

test('successful stale save and rename commits still apply currentPresetName transitions', async () => {
  const scenarios = [
    {
      initialName: 'Original',
      start(manager) { return manager.savePreset('Saved'); },
      expectedName: 'Saved'
    },
    {
      initialName: 'Original',
      start(manager) { return manager.renamePreset('Original', 'Renamed'); },
      expectedName: 'Renamed'
    }
  ];

  for (const scenario of scenarios) {
    await withPresetGlobals({
      storage: { effetune_presets: '{"Original":{"plugins":[]}}' }
    }, async ({ windowRef }) => {
      windowRef.uiManager = createUiManager([]);
      const manager = await createInitializedManager(createPipelineManager());
      manager.currentPresetName = scenario.initialName;
      const persistStarted = createDeferred();
      const releasePersist = createDeferred();
      const persistPresets = manager.persistPresets.bind(manager);
      let persistCount = 0;
      manager.persistPresets = async presets => {
        persistCount += 1;
        if (persistCount === 1) {
          persistStarted.resolve();
          await releasePersist.promise;
        }
        return persistPresets(presets);
      };

      const staleSuccess = scenario.start(manager);
      await persistStarted.promise;
      const latestFailure = manager.renamePreset('Missing', 'Unused');
      releasePersist.resolve();

      assert.equal(await staleSuccess, true);
      assert.equal(await latestFailure, false);
      assert.equal(manager.currentPresetName, scenario.expectedName);
    });
  }
});

test('save writes the pipeline captured before file completion', async () => {
  let releaseSave;
  let saveStarted;
  let writtenPreset;
  const saveReady = new Promise(resolve => {
    saveStarted = resolve;
  });
  const savePending = new Promise(resolve => {
    releaseSave = resolve;
  });

  await withPresetGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async getPath() { return 'user'; },
      async joinPaths(...parts) { return parts.join('/'); },
      async fileExists() { return true; },
      async readFile() { return { success: true, content: '{}' }; },
      saveFile(path, content) {
        writtenPreset = JSON.parse(content);
        saveStarted();
        return savePending.then(() => ({ success: true }));
      },
      async getUserPresetsForTray() { return { success: true, presets: [] }; },
      async updateTrayMenu() { return { success: true }; }
    }
  }, async ({ calls, windowRef }) => {
    windowRef.uiManager = createUiManager(calls);
    const pipelineManager = createPipelineManager();
    pipelineManager.audioManager.pipeline[0].externalAssetInfo = {
      missing: false,
      kind: 'IR',
      ids: ['aaaaaaaaaaaaaaaaaaaaaaaa'],
      names: ['Saved Hall']
    };
    const manager = await createInitializedManager(pipelineManager);

    const save = manager.savePreset('Snapshot');
    await saveReady;
    pipelineManager.audioManager.pipeline[0].externalAssetInfo.names = ['Later Hall'];
    pipelineManager.audioManager.pipeline = [];
    releaseSave();
    await save;

    assert.equal(writtenPreset.Snapshot.plugins[0].nm, 'Cleanup');
    const success = calls.find(call => call[0] === 'showTransientMessage' && String(call[1]).includes('success.presetSaved'));
    assert.equal(success[1], 'success.presetSaved');
  });
});

test('only the latest preset save attempt can publish completion feedback', async () => {
  const scenarios = [
    {
      latestResult: { success: true },
      staleResult: { success: false, error: 'stale save failure' },
      expectedMessage: 'success.presetSaved',
      unexpectedMessage: 'error.failedToSavePreset',
      expectsRefresh: true
    },
    {
      latestResult: { success: false, error: 'latest save failure' },
      staleResult: { success: true },
      expectedMessage: 'error.failedToSavePreset',
      unexpectedMessage: 'success.presetSaved',
      expectsRefresh: false
    }
  ];

  for (const scenario of scenarios) {
    const saveAttempts = [createDeferred(), createDeferred()];
    const saveStarts = [createDeferred(), createDeferred()];
    let saveIndex = 0;
    await withPresetGlobals({
      electronIntegration: { isElectron: true },
      electronAPI: {
        async getPath() { return 'user'; },
        async joinPaths(...parts) { return parts.join('/'); },
        async fileExists() { return true; },
        async readFile() { return { success: true, content: '{}' }; },
        saveFile() {
          const index = saveIndex++;
          saveStarts[index].resolve();
          return saveAttempts[index].promise;
        },
        async getUserPresetsForTray() { return { success: true, presets: [] }; },
        async updateTrayMenu() { return { success: true }; }
      }
    }, async ({ calls, windowRef }) => {
      windowRef.uiManager = createUiManager(calls);
      const manager = await createInitializedManager(createPipelineManager(), { waitMore: true });

      const staleSave = manager.savePreset('Stale');
      await saveStarts[0].promise;
      const latestSave = manager.savePreset('Latest');
      await flushMicrotasks();
      assert.equal(saveIndex, 1);

      saveAttempts[0].resolve(scenario.staleResult);
      await saveStarts[1].promise;
      assert.equal(saveIndex, 2);

      saveAttempts[1].resolve(scenario.latestResult);
      await latestSave;
      await staleSave;

      const messages = calls.filter(call => call[0] === 'showTransientMessage');
      assert.equal(messages.filter(call => String(call[1]).includes(scenario.expectedMessage)).length, 1);
      assert.equal(messages.some(call => String(call[1]).includes(scenario.unexpectedMessage)), false);
      assert.equal(calls.some(call => call[0] === 'refreshPresetsIfVisible'), scenario.expectsRefresh);
    });
  }
});

test('concurrent preset saves serialize read-modify-write and preserve invocation snapshots', async () => {
  const firstWrite = createDeferred();
  const firstWriteStarted = createDeferred();
  let persisted = { Existing: { plugins: [] } };
  const writes = [];

  await withPresetGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async getPath() { return 'user'; },
      async joinPaths(...parts) { return parts.join('/'); },
      async fileExists() { return true; },
      async readFile() { return { success: true, content: JSON.stringify(persisted) }; },
      async saveFile(path, content) {
        const snapshot = JSON.parse(content);
        writes.push(snapshot);
        if (writes.length === 1) {
          firstWriteStarted.resolve();
          await firstWrite.promise;
        }
        persisted = snapshot;
        return { success: true };
      },
      async getUserPresetsForTray() { return { success: true, presets: [] }; },
      async updateTrayMenu() { return { success: true }; }
    }
  }, async ({ calls, windowRef }) => {
    windowRef.uiManager = createUiManager(calls);
    const pipelineManager = createPipelineManager();
    pipelineManager.audioManager.pipeline[0].externalAssetInfo = {
      missing: false,
      kind: 'IR',
      ids: ['aaaaaaaaaaaaaaaaaaaaaaaa'],
      names: ['First Hall']
    };
    const manager = await createInitializedManager(pipelineManager, { waitMore: true });

    const firstSave = manager.savePreset('First');
    await firstWriteStarted.promise;
    pipelineManager.audioManager.pipeline = [createPlugin('Latest')];
    pipelineManager.audioManager.pipeline[0].externalAssetInfo = {
      missing: false,
      kind: 'IR',
      ids: ['bbbbbbbbbbbbbbbbbbbbbbbb'],
      names: ['Latest Hall']
    };
    const latestSave = manager.savePreset('Latest');
    await flushMicrotasks();

    assert.equal(writes.length, 1);
    assert.equal(writes[0].First.plugins[0].nm, 'Cleanup');
    firstWrite.resolve();
    await Promise.all([firstSave, latestSave]);

    assert.deepEqual(Object.keys(persisted).sort(), ['Existing', 'First', 'Latest']);
    assert.equal(persisted.First.plugins[0].nm, 'Cleanup');
    assert.equal(persisted.Latest.plugins[0].nm, 'Latest');
    const messages = calls.filter(call => call[0] === 'showTransientMessage');
    assert.equal(messages.filter(call => String(call[1]).includes('success.presetSaved')).length, 1);
    assert.equal(messages[0][1], 'success.presetSaved');
  });
});

test('concurrent preset saves and deletes commit in invocation order', async () => {
  const scenarios = [
    {
      first(manager) { return manager.savePreset('Target'); },
      latest(manager) { return manager.deletePreset('Target'); },
      expectedTarget: undefined,
      expectedMessage: 'success.presetDeleted'
    },
    {
      first(manager) { return manager.deletePreset('Target'); },
      latest(manager) { return manager.savePreset('Target'); },
      expectedTarget: 'Cleanup',
      expectedMessage: 'success.presetSaved'
    }
  ];

  for (const scenario of scenarios) {
    const firstWrite = createDeferred();
    const firstWriteStarted = createDeferred();
    let persisted = { Target: { plugins: [] }, Other: { plugins: [] } };
    let writeCount = 0;
    await withPresetGlobals({
      electronIntegration: { isElectron: true },
      electronAPI: {
        async getPath() { return 'user'; },
        async joinPaths(...parts) { return parts.join('/'); },
        async fileExists() { return true; },
        async readFile() { return { success: true, content: JSON.stringify(persisted) }; },
        async saveFile(path, content) {
          writeCount += 1;
          if (writeCount === 1) {
            firstWriteStarted.resolve();
            await firstWrite.promise;
          }
          persisted = JSON.parse(content);
          return { success: true };
        },
        async getUserPresetsForTray() { return { success: true, presets: [] }; },
        async updateTrayMenu() { return { success: true }; }
      }
    }, async ({ calls, windowRef }) => {
      windowRef.uiManager = createUiManager(calls);
      const manager = await createInitializedManager(createPipelineManager(), { waitMore: true });

      const first = scenario.first(manager);
      await firstWriteStarted.promise;
      const latest = scenario.latest(manager);
      await flushMicrotasks();
      assert.equal(writeCount, 1);

      firstWrite.resolve();
      await Promise.all([first, latest]);

      assert.equal(persisted.Other.plugins.length, 0);
      assert.equal(persisted.Target?.plugins?.[0]?.nm, scenario.expectedTarget);
      const messages = calls.filter(call => call[0] === 'showTransientMessage');
      assert.equal(messages.filter(call => String(call[1]).includes(scenario.expectedMessage)).length, 1);
      assert.equal(messages.filter(call => String(call[1]).includes('success.')).length, 1);
    });
  }
});

test('a preset success timeout cannot clear a newer missing-asset error', async () => {
  await withPresetGlobals({}, async ({ calls, windowRef }) => {
    const messageState = { revision: 0, current: null, timers: [] };
    const uiManager = createUiManager(calls, { messageState });
    windowRef.uiManager = uiManager;
    const manager = await createInitializedManager(createPipelineManager());

    await manager.savePreset('Safe Message');
    const successCall = calls.find(call => call[0] === 'showTransientMessage' &&
      String(call[1]).includes('success.presetSaved'));
    assert.equal(successCall?.[4], 3000);
    assert.equal(messageState.timers.length, 1);

    uiManager.setError('error.irMissing', true);
    messageState.timers[0]();

    assert.deepEqual(messageState.current, {
      key: 'error.irMissing',
      isError: true,
      params: undefined
    });
  });
});

test('Electron save and delete failures do not report success or refresh preset UI', async () => {
  await withPresetGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async getPath() { return 'user'; },
      async joinPaths(...parts) { return parts.join('/'); },
      async fileExists() { return true; },
      async readFile() { return { success: true, content: '{"Existing":{"plugins":[]}}' }; },
      async saveFile() { return { success: false, error: 'private disk detail' }; }
    }
  }, async ({ calls, windowRef }) => {
    windowRef.uiManager = createUiManager(calls);
    const manager = await createInitializedManager(createPipelineManager());

    await manager.savePreset('NotSaved');
    await manager.deletePreset('Existing');

    const messages = calls.filter(call => call[0] === 'showTransientMessage');
    assert.ok(messages.some(call => call[1] === 'error.failedToSavePreset'));
    assert.ok(messages.some(call => call[1] === 'error.failedToDeletePreset'));
    assert.equal(messages.some(call => String(call[1]).includes('success.')), false);
    assert.equal(messages.some(call => String(call[1]).includes('private disk detail')), false);
    assert.equal(calls.some(call => call[0] === 'refreshPresetsIfVisible'), false);
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
    const pipelineManager = createPipelineManager();
    const manager = await createInitializedManager(pipelineManager);
    await manager.loadPreset('MissingPreset');
    await manager.loadPreset(null);
    await manager.loadPreset('NewFormat');
    assert.equal(manager.currentPresetName, 'NewFormat');

    assert.deepEqual(pipelineManager.audioManager.pipeline.map(plugin => plugin.name), ['Alpha', 'Gamma']);
    assert.equal(pipelineManager.createdPlugins[0].enabled, false);
    assert.equal(pipelineManager.createdPlugins[0].inputBus, 1);
    assert.equal(pipelineManager.createdPlugins[0].outputBus, 2);
    assert.equal(pipelineManager.createdPlugins[0].channel, 'L');
    assert.equal(pipelineManager.expandedPlugins.has(pipelineManager.retainedPlugin), true);
    assert.equal(pipelineManager.core.enabled, true);
    assert.equal(dom.masterToggle.classList.contains('off'), false);
    assert.ok(pipelineManager.cleanupPlugin.calls.some(call => call[0] === 'cleanup'));
    assert.ok(pipelineManager.calls.some(call => call[0] === 'withHistorySuppressed'));
    assert.ok(calls.some(call => call[0] === 'showTransientMessage' && call[1] === 'success.presetLoaded'));
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
    assert.equal(manager.currentPresetName, '');
    assert.equal(pipelineManager.createdPlugins[0].channel, 'R');
  });

  await withPresetGlobals({}, async ({ calls, windowRef }) => {
    windowRef.uiManager = createUiManager(calls);
    const manager = await createInitializedManager(createPipelineManager());
    await manager.loadPreset({ name: 'Bad' });
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'error.invalidPresetData'));
  });
});

test('loadPreset suppresses reconstruction history before allowing one explicit save and restores on failure', async () => {
  const serialized = JSON.stringify({ Named: { plugins: [{ nm: 'Alpha', en: true }] } });
  await withPresetGlobals({ storage: { effetune_presets: serialized } }, async () => {
    const pipelineManager = createPipelineManager();
    const manager = await createInitializedManager(pipelineManager);
    const observations = [];
    pipelineManager.core.updatePipelineUI = () => {
      observations.push(['ui', pipelineManager.historyManager.isHistorySuppressed]);
    };
    pipelineManager.historyManager.saveState = () => {
      observations.push(['save', pipelineManager.historyManager.isHistorySuppressed]);
    };

    assert.equal(await manager.loadPreset('Named'), true);
    assert.deepEqual(observations, [
      ['ui', true],
      ['save', false]
    ]);
    assert.equal(pipelineManager.historyManager.isHistorySuppressed, false);
  });

  await withPresetGlobals({ storage: { effetune_presets: serialized } }, async () => {
    const pipelineManager = createPipelineManager();
    const manager = await createInitializedManager(pipelineManager);
    pipelineManager.core.updatePipelineUI = () => {
      throw new Error('rebuild failed');
    };
    assert.equal(await manager.loadPreset('Named'), false);
    assert.equal(pipelineManager.historyManager.isHistorySuppressed, false);
    assert.equal(pipelineManager.calls.filter(call => call[0] === 'saveState').length, 0);
  });
});

test('getCurrentPresetData uses currentPresetName and an export fallback', async () => {
  await withPresetGlobals({}, async () => {
    const pipelineManager = createPipelineManager();
    const manager = await createInitializedManager(pipelineManager);
    assert.deepEqual(manager.getCurrentPresetData(), {
      name: 'My Preset',
      pipeline: [
        { name: 'Cleanup', enabled: true, parameters: { exported: true } },
        { name: 'Plain', enabled: true, parameters: { exported: true } }
      ],
      timestamp: 123456
    });
    manager.currentPresetName = 'Named';
    assert.equal(manager.getCurrentPresetData().name, 'Named');
  });
});
