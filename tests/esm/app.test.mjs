import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';
import * as appBootstrap from '../../js/app-bootstrap.js';
import { resetWebAppConfigRuntimeForTests } from '../../js/electron/webSettingsStorage.js';

let appModulePromise = null;

class FakeFile {
  constructor(parts, name, options = {}) {
    this.parts = parts;
    this.name = name;
    this.type = options.type || '';
  }
}

function createElement(document, tagName) {
  const element = {
    tagName: tagName.toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    parentNode: null,
    nextSibling: null,
    children: [],
    listeners: new Map(),
    style: {},
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      if (child.id) document.elementsById.set(child.id, child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter(candidate => candidate !== child);
      child.parentNode = null;
      return child;
    },
    insertBefore(child, before) {
      child.parentNode = this;
      const index = this.children.indexOf(before);
      if (index === -1) this.children.push(child);
      else this.children.splice(index, 0, child);
      if (child.id) document.elementsById.set(child.id, child);
      return child;
    },
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    },
    click() {
      for (const listener of this.listeners.get('click') || []) listener({ preventDefault() {} });
    }
  };
  return element;
}

function createDocument(options = {}) {
  const document = {
    elementsById: new Map(),
    listeners: new Map(),
    hidden: options.hidden ?? false,
    head: null,
    body: null,
    createElement(tagName) {
      return createElement(document, tagName);
    },
    getElementById(id) {
      return document.elementsById.get(id) || null;
    },
    querySelector(selector) {
      if (selector === '.whats-this') return document.whatsThis || null;
      if (selector === '.update-notification') return document.updateNotification || null;
      return null;
    },
    addEventListener(type, listener) {
      if (!document.listeners.has(type)) document.listeners.set(type, []);
      document.listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of document.listeners.get(type) || []) {
        listener(event);
      }
    }
  };
  document.head = createElement(document, 'head');
  document.body = createElement(document, 'body');
  const version = createElement(document, 'span');
  version.id = 'app-version';
  document.elementsById.set('app-version', version);
  const whatsThis = createElement(document, 'a');
  whatsThis.className = 'whats-this';
  whatsThis.parentNode = document.body;
  document.body.children.push(whatsThis);
  document.whatsThis = whatsThis;
  return document;
}

async function withAppModule(options = {}, callback) {
  const calls = [];
  const timers = [];
  const rafs = [];
  const document = createDocument(options.document ?? {});
  const mediaDevices = {
    async enumerateDevices() {
      calls.push(['enumerateDevices']);
      if (options.enumerateDevices) return options.enumerateDevices(calls);
      if (options.enumerateReject) throw new Error('enumerate failed');
      return options.devices ?? [];
    },
    addEventListener(type, listener) {
      calls.push(['mediaDevices.addEventListener', type]);
      mediaDevices.listener = listener;
    }
  };
  const electronAPI = {
    onIPC(channel, listener) {
      calls.push(['electronAPI.onIPC', channel]);
      electronAPI.listeners.set(channel, listener);
    },
    listeners: new Map(),
    ...(options.electronAPI ?? {})
  };
  const windowObject = {
    __EFFECTUNE_DISABLE_APP_AUTO_START__: true,
    electronAPI: options.electronApiDuringImport,
    location: {
      search: options.search ?? '',
      reload() {
        calls.push(['location.reload']);
      }
    },
    open(url, target) {
      calls.push(['window.open', url, target]);
    },
    require: options.require,
    pipelineStateLoaded: options.pipelineStateLoaded,
    ORIGINAL_PIPELINE_STATE_LOADED: options.originalPipelineStateLoaded,
    pendingPresetFilePath: options.pendingPresetFilePath,
    pendingPresetName: options.pendingPresetName,
    pendingTrayPresetName: options.pendingTrayPresetName,
    pendingMusicFiles: options.pendingMusicFiles,
    __FORCE_SKIP_PIPELINE_STATE_LOAD: options.forceSkip ?? false
  };

  return withGlobals({
    window: windowObject,
    document,
    navigator: { mediaDevices, userAgent: options.userAgent ?? 'Mozilla/5.0' },
    requestAnimationFrame(fn) {
      rafs.push(fn);
      fn();
      return rafs.length;
    },
    setTimeout(fn, delay) {
      timers.push({ fn, delay });
      return timers.length;
    },
    clearTimeout(id) {
      calls.push(['clearTimeout', id]);
    },
    fetch: async url => {
      calls.push(['fetch', url]);
      if (options.fetchReject) throw new Error('fetch failed');
      return options.fetchResponse ?? {
        ok: true,
        status: 200,
        async json() {
          return { version: '9.9.9' };
        }
      };
    },
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    Blob: class {
      constructor(parts, options = {}) {
        this.parts = parts;
        this.type = options.type || '';
      }
    },
    File: FakeFile,
    console: {
      ...console,
      log(...args) { calls.push(['console.log', ...args]); },
      warn(...args) { calls.push(['console.warn', ...args]); },
      error(...args) { calls.push(['console.error', ...args]); }
    }
  }, async () => {
    appModulePromise ??= import('../../js/app.js');
    const mod = await appModulePromise;
    windowObject.electronAPI = electronAPI;
    return callback({ calls, document, mediaDevices, mod, timers, window: windowObject });
  });
}

function runTimers(timers) {
  const pending = timers.splice(0);
  return Promise.all(pending.map(timer => timer.fn()));
}

async function flushAndRunTimers(timers, rounds = 6) {
  const delays = [];
  for (let i = 0; i < rounds; i++) {
    await flushMicrotasks();
    if (timers.length > 0) {
      delays.push(...timers.map(timer => timer.delay));
      await runTimers(timers);
    }
  }
  return delays;
}

function createPlugin(name) {
  return {
    name,
    enabled: true,
    updateParameters() {},
    setVl(value) {
      this.volume = value;
    }
  };
}

function createDependencies(calls, options = {}) {
  const plugins = new Map();
  const pluginManager = {
    async loadPlugins() {
      calls.push(['pluginManager.loadPlugins']);
      if (options.loadPluginsReject) throw new Error('load plugins failed');
    },
    createPlugin(name) {
      calls.push(['pluginManager.createPlugin', name]);
      if (options.throwPluginNames?.includes(name)) throw new Error(`no ${name}`);
      const plugin = createPlugin(name);
      plugins.set(name, plugin);
      return plugin;
    }
  };
  const presetManager = {
    async getPresets() {
      calls.push(['presetManager.getPresets']);
      return options.presets ?? { Startup: { name: 'Startup' } };
    },
    async loadPresetList() {
      calls.push(['presetManager.loadPresetList']);
      if (options.loadPresetListReject) throw new Error('preset list failed');
    },
    async loadPreset(name) {
      calls.push(['presetManager.loadPreset', name]);
      if (options.loadPresetReject) throw new Error('preset failed');
    }
  };
  const pipelineManager = {
    core: {
      getSerializablePluginState(plugin) {
        calls.push(['core.serialize', plugin?.name]);
        return { name: plugin?.name };
      }
    },
    presetManager
  };
  const uiManager = {
    pipelineManager,
    expandedPlugins: new Set(),
    audioPlayer: options.audioPlayer ?? null,
    showLoadingSpinner() { calls.push(['ui.showLoadingSpinner']); },
    hideLoadingSpinner() { calls.push(['ui.hideLoadingSpinner']); },
    initPluginList() { calls.push(['ui.initPluginList']); },
    initDragAndDrop() { calls.push(['ui.initDragAndDrop']); },
    initAudio() { calls.push(['ui.initAudio']); },
    updatePipelineUI(force) { calls.push(['ui.updatePipelineUI', force]); },
    updateURL() { calls.push(['ui.updateURL']); },
    updatePipelineToggleButton() { calls.push(['ui.updatePipelineToggleButton']); },
    setError(message, isError, params) { calls.push(['ui.setError', message, isError, params]); },
    clearError() { calls.push(['ui.clearError']); },
    parsePipelineState() {
      calls.push(['ui.parsePipelineState']);
      return options.urlState ?? null;
    },
    loadPipelineStateFromLocalStorage() {
      calls.push(['ui.loadPipelineStateFromLocalStorage']);
      return options.localState ?? null;
    },
    loadPreset(preset) { calls.push(['ui.loadPreset', preset]); },
    async showLibraryView(viewOptions) {
      calls.push(['ui.showLibraryView', viewOptions]);
      if (options.showLibraryReject) throw new Error('library failed');
    },
    getDoubleBlindTest() {
      return {
        restoreFromShare(value) {
          calls.push(['dbt.restoreFromShare', value]);
          if (options.dbtReject) throw new Error('dbt failed');
        }
      };
    },
    createAudioPlayer(files, replace) {
      calls.push(['ui.createAudioPlayer', files.map(file => file.name), replace]);
      uiManager.audioPlayer = {
        play() {
          calls.push(['audioPlayer.play']);
        }
      };
      return uiManager.audioPlayer;
    }
  };
  const ioManager = {
    audioContextSinkMode: options.audioContextSinkMode ?? false,
    audioElement: { sinkId: options.currentSink },
    async reapplyOutputDevice(deviceId) {
      calls.push(['io.reapplyOutputDevice', deviceId]);
      return options.reapplyResult ?? true;
    }
  };
  const audioManager = {
    pipelineA: options.pipelineA ?? [],
    pipelineB: options.pipelineB ?? null,
    currentPipeline: 'A',
    workletNode: {
      disconnect() {
        calls.push(['worklet.disconnect']);
        if (options.workletDisconnectReject) throw new Error('disconnect failed');
      }
    },
    ioManager,
    contextManager: { audioContext: { sinkId: options.contextSink, setSinkId() {} } },
    pipelineManager: null,
    isFirstLaunch: false,
    async initAudio() {
      calls.push(['audio.initAudio']);
      return options.initAudioResult;
    },
    async initializeAudioWorklet() {
      calls.push(['audio.initializeAudioWorklet']);
      return options.workletResult;
    },
    async rebuildPipeline(force) {
      calls.push(['audio.rebuildPipeline', force]);
      if (options.rebuildRejectOnce) {
        options.rebuildRejectOnce = false;
        throw new Error('rebuild failed');
      }
      if (options.rebuildReject) throw new Error('rebuild failed');
    },
    async waitForDspActivationBeforeOutput() {
      calls.push(['audio.waitForDspActivationBeforeOutput']);
    },
    fadeInOutput() { calls.push(['audio.fadeInOutput']); },
    setCurrentPipeline(pipeline) {
      calls.push(['audio.setCurrentPipeline', pipeline]);
      this.currentPipeline = pipeline;
    },
    getCurrentPipeline() {
      calls.push(['audio.getCurrentPipeline']);
      return options.currentPipeline ?? this.pipelineA;
    },
    async reset(deviceId) {
      calls.push(['audio.reset', deviceId]);
      if (options.resetReject) throw new Error('reset failed');
    }
  };
  return { audioManager, pipelineManager, pluginManager, uiManager };
}

function createImportElectronAPI(importCalls, overrides = {}) {
  const target = {
    async isFirstLaunch() {
      importCalls.push(['isFirstLaunch']);
      if (overrides.isFirstLaunchReject) throw new Error('first launch failed');
      return overrides.isFirstLaunch ?? false;
    },
    onRequestPipelineStateForClose(callback) {
      importCalls.push(['onRequestPipelineStateForClose', callback]);
    },
    ...overrides
  };
  return new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      if (String(property).startsWith('on')) {
        return callback => importCalls.push([property, callback]);
      }
      return async () => ({ success: false });
    }
  });
}

test('helper functions save, load, and display app state', async () => {
  await withAppModule({}, async ({ calls, document, mod, window }) => {
    assert.equal(mod.getPipelineStateForSave(), null);

    window.electronIntegration = { isElectron: true };
    window.electronAPI = {
      async savePipelineStateToFile(state) {
        calls.push(['savePipelineStateToFile', state]);
        return { success: true };
      },
      async getPath(name) {
        calls.push(['getPath', name]);
        return '/user';
      },
      async joinPaths(...parts) {
        calls.push(['joinPaths', ...parts]);
        return parts.join('/');
      },
      async fileExists(path) {
        calls.push(['fileExists', path]);
        return true;
      },
      async readFile(path) {
        calls.push(['readFile', path]);
        return { success: true, content: JSON.stringify([{ name: 'Volume' }]) };
      }
    };
    window.audioManager = {
      getCurrentPipeline() {
        return [{ name: 'Volume' }];
      }
    };
    window.pipelineManager = {
      core: {
        getSerializablePluginState(plugin) {
          return { name: plugin.name };
        }
      }
    };
    assert.deepEqual(mod.getPipelineStateForSave(), [{ name: 'Volume' }]);
    await mod.writePipelineStateToFile();
    assert.equal(calls.some(call => call[0] === 'savePipelineStateToFile'), true);

    window.pipelineStateLoaded = true;
    assert.deepEqual(await mod.loadPipelineState(), [{ name: 'Volume' }]);
    window.electronAPI.fileExists = async () => false;
    assert.equal(await mod.loadPipelineState(), null);
    window.electronAPI.fileExists = async () => true;
    window.electronAPI.readFile = async () => ({ success: false, error: 'bad read' });
    assert.equal(await mod.loadPipelineState(), null);
    window.__FORCE_SKIP_PIPELINE_STATE_LOAD = true;
    assert.equal(await mod.loadPipelineState(), null);

    window.__FORCE_SKIP_PIPELINE_STATE_LOAD = false;
    window.pipelineStateLoaded = false;
    assert.equal(await mod.loadPipelineState(), null);

    window.electronIntegration = {
      isElectron: true,
      async getAppVersion() {
        return '1.2.3';
      }
    };
    await mod.displayAppVersion();
    assert.equal(document.getElementById('app-version').textContent, '1.2.3');
  });

  await withAppModule({ fetchResponse: { ok: true, async json() { return { version: '4.5.6' }; } } }, async ({ document, mod, window }) => {
    window.electronIntegration = { isElectron: false };
    await mod.displayAppVersion();
    assert.equal(document.getElementById('app-version').textContent, '4.5.6');
  });

  await withAppModule({ fetchResponse: { ok: false, status: 500 } }, async ({ document, mod, window }) => {
    window.electronIntegration = { isElectron: false };
    await mod.displayAppVersion();
    assert.equal(document.getElementById('app-version').textContent, '');
  });
});

test('app module auto-start wires top-level bootstrap side effects', async () => {
  const childPath = fileURLToPath(new URL('../helpers/app-auto-start-smoke-child.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [childPath], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('bootstrap helpers manage first-launch status and errors', async () => {
  await withAppModule({}, async ({ calls, document, mod, window }) => {
    assert.equal(await appBootstrap.createFirstLaunchPromise({
      isFirstLaunch() {
        calls.push(['isFirstLaunch.true']);
        return true;
      }
    }), true);
    assert.equal(await appBootstrap.createFirstLaunchPromise({
      isFirstLaunch() {
        throw new Error('sync launch failure');
      }
    }), false);
    assert.equal(await appBootstrap.createFirstLaunchPromise({
      async isFirstLaunch() {
        throw new Error('async launch failure');
      }
    }), false);
    assert.equal(await appBootstrap.createFirstLaunchPromise(null), false);

    const hiddenStyle = document.createElement('style');
    document.head.appendChild(hiddenStyle);
    appBootstrap.applyFirstLaunchStatus(false, hiddenStyle, window);
    assert.equal(hiddenStyle.parentNode, null);

    const firstLaunchStyle = document.createElement('style');
    document.head.appendChild(firstLaunchStyle);
    appBootstrap.applyFirstLaunchStatus(true, firstLaunchStyle, window);
    assert.equal(firstLaunchStyle.id, 'first-launch-style');
    assert.equal(window.isFirstLaunch, true);

    const errorStyle = document.createElement('style');
    document.head.appendChild(errorStyle);
    appBootstrap.applyFirstLaunchError(new Error('first launch failed'), errorStyle, { windowRef: window });
    assert.equal(errorStyle.parentNode, null);
    assert.equal(window.isFirstLaunch, false);
    await appBootstrap.handleFirstLaunchPromise(Promise.resolve(true), firstLaunchStyle, { windowRef: window });
    assert.equal(window.isFirstLaunchConfirmed, true);
    await appBootstrap.handleFirstLaunchPromise(Promise.reject(new Error('promise failed')), firstLaunchStyle, { windowRef: window });
    assert.equal(window.isFirstLaunchConfirmed, false);
  });
});

test('bootstrap helpers wire close-state and tray preset listeners', async () => {
  await withAppModule({}, async ({ calls, mod, window }) => {
    let closeCallback;
    const closeApi = {
      onRequestPipelineStateForClose(callback) {
        closeCallback = callback;
      },
      sendPipelineStateForClose(state) {
        calls.push(['sendPipelineStateForClose', state]);
      }
    };
    window.electronAPI = closeApi;
    window.electronIntegration = { isElectron: true };
    window.audioManager = { getCurrentPipeline: () => [{ name: 'Limiter' }] };
    window.pipelineManager = {
      core: {
        getSerializablePluginState(plugin) {
          return { name: plugin.name };
        }
      }
    };
    appBootstrap.registerPipelineStateCloseHandler(mod.getPipelineStateForSave, closeApi);
    closeCallback();
    assert.deepEqual(calls.find(call => call[0] === 'sendPipelineStateForClose')[1], [{ name: 'Limiter' }]);

    const trayApi = {
      listeners: new Map(),
      onIPC(channel, listener) {
        calls.push(['tray.onIPC', channel]);
        this.listeners.set(channel, listener);
      }
    };
    appBootstrap.registerTrayPresetListener({
      electronAPI: trayApi,
      electronBridge: { isElectron: true },
      windowRef: window
    });
    const trayListener = trayApi.listeners.get('load-preset-from-tray');
    window.app = { initialized: false };
    window.pipelineManager = { presetManager: { loadPreset() { throw new Error('should not load yet'); } } };
    trayListener('Queued');
    assert.equal(window.pendingTrayPresetName, 'Queued');

    window.app = { initialized: true };
    window.pipelineManager = {
      presetManager: {
        loadPreset(name) {
          calls.push(['tray.loadPreset', name]);
          return Promise.reject(new Error('tray failed'));
        }
      }
    };
    trayListener('Ready');
    await flushMicrotasks();
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === 'Error loading preset from tray:'), true);
  });
});

test('bootstrap helpers start apps and recover from async startup failures', async () => {
  await withAppModule({}, async ({ calls, window }) => {
    class FakeApp {
      initialize() {
        calls.push(['FakeApp.initialize']);
        this.initialized = true;
        return Promise.resolve();
      }
    }
    const startApi = {
      onIPC(channel, listener) {
        calls.push(['start.onIPC', channel, typeof listener]);
      }
    };
    window.electronAPI = startApi;
    window.electronIntegration = { isElectron: true };
    const app = await appBootstrap.startApplication({
      AppClass: FakeApp,
      firstLaunchPromise: Promise.resolve(true),
      windowRef: window,
      startHeartbeat(page) {
        calls.push(['heartbeat', page]);
      }
    });
    assert.equal(window.app, app);
    assert.equal(window.isFirstLaunch, true);
    assert.equal(calls.some(call => call[0] === 'heartbeat' && call[1] === 'main-page'), true);
    assert.equal(calls.some(call => call[0] === 'FakeApp.initialize'), true);

    const isolatedWindow = {
      electronAPI: {
        listeners: new Map(),
        onIPC(channel, listener) {
          calls.push(['isolated.onIPC', channel]);
          this.listeners.set(channel, listener);
        }
      },
      electronIntegration: { isElectron: true }
    };
    await appBootstrap.startApplication({
      AppClass: FakeApp,
      firstLaunchPromise: Promise.resolve(false),
      windowRef: isolatedWindow,
      startHeartbeat(page) {
        calls.push(['isolatedHeartbeat', page]);
      }
    });
    assert.equal(isolatedWindow.electronAPI.listeners.has('load-preset-from-tray'), true);
    isolatedWindow.electronAPI.listeners.get('load-preset-from-tray')('Injected Window Preset');
    assert.equal(isolatedWindow.pendingTrayPresetName, 'Injected Window Preset');

    class RejectingApp {
      initialize() {
        calls.push(['RejectingApp.initialize']);
        return Promise.reject(new Error('init failed'));
      }
    }
    appBootstrap.createAndInitializeApp(RejectingApp, { windowRef: window });
    await flushMicrotasks();
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === 'Failed to initialize app:'), true);

    class CatchApp {
      initialize() {
        calls.push(['CatchApp.initialize']);
        return Promise.resolve();
      }
    }
    await appBootstrap.startApplication({
      AppClass: CatchApp,
      firstLaunchPromise: Promise.reject(new Error('launch failed')),
      windowRef: window,
      startHeartbeat(page) {
        calls.push(['catchHeartbeat', page]);
      }
    });
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === 'Failed to check first launch status:'), true);
  });
});

test('App constructor accepts injected default dependency classes', async () => {
  await withAppModule({}, async ({ calls, mod }) => {
    class DefaultPluginManager {
      constructor() {
        calls.push(['DefaultPluginManager']);
      }
    }
    class DefaultAudioManager {
      constructor() {
        calls.push(['DefaultAudioManager']);
      }
    }
    class DefaultUIManager {
      constructor(pluginManager, audioManager) {
        calls.push(['DefaultUIManager', pluginManager instanceof DefaultPluginManager, audioManager instanceof DefaultAudioManager]);
        this.pipelineManager = { presetManager: {} };
      }
    }
    new mod.App({
      PluginManagerClass: DefaultPluginManager,
      AudioManagerClass: DefaultAudioManager,
      UIManagerClass: DefaultUIManager
    });
    assert.equal(calls.some(call => call[0] === 'DefaultUIManager' && call[1] === true && call[2] === true), true);
  });
});

test('App initialize handles success, audio warnings, and initialization failure', async () => {
  await withAppModule({
    electronAPI: {
      async loadConfig() { return { success: true, config: { startMinimized: false } }; },
      signalReadyForMusicFiles() {},
      async signalReadyForUpdates() {}
    }
  }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true, isElectronEnvironment: () => true };
    mod.INITIALIZATION_CONFIG.AUDIOWORKLET_TO_PIPELINE_WAIT = 0;
    const deps = createDependencies(calls, {
      initAudioResult: 'Audio Error: no mic',
      workletResult: 'Audio Error: no worklet',
      urlState: [{ name: 'Volume', enabled: true, parameters: { volume: -3 } }]
    });
    deps.loadStartupConfig = async () => ({ startupView: 'library' });
    const app = new mod.App(deps);
    await app.initialize();
    assert.equal(app.initialized, true);
    assert.equal(app.hasAudioError, true);
    assert.equal(calls.some(call => call[0] === 'audio.fadeInOutput'), true);
    assert.ok(calls.findIndex(call => call[0] === 'audio.waitForDspActivationBeforeOutput') <
      calls.findIndex(call => call[0] === 'audio.fadeInOutput'));
    assert.equal(calls.some(call => call[0] === 'ui.setError' && call[1] === 'error.microphoneAccessDenied'), true);
    assert.ok(calls.findIndex(call => call[0] === 'pluginManager.loadPlugins') <
      calls.findIndex(call => call[0] === 'presetManager.loadPresetList'));
    assert.ok(calls.findIndex(call => call[0] === 'presetManager.loadPresetList') <
      calls.findIndex(call => call[0] === 'ui.initPluginList'));
    assert.equal(calls.some(call => call[0] === 'ui.showLibraryView' && call[1]?.focusSearch === false), true);
  });

  await withAppModule({}, async ({ calls, mod }) => {
    const deps = createDependencies(calls, { loadPluginsReject: true });
    const app = new mod.App(deps);
    await app.initialize();
    assert.equal(app.initialized, true);
    assert.equal(calls.some(call => call[0] === 'ui.setError' && call[1] === 'load plugins failed'), true);
  });

  await withAppModule({}, async ({ calls, mod }) => {
    const deps = createDependencies(calls, { loadPresetListReject: true });
    const app = new mod.App(deps);
    await app.refreshPresetListAfterPluginLoad();
    assert.equal(calls.some(call => call[0] === 'console.error' &&
      call[1] === 'Failed to refresh preset list after plugin load:'), true);
  });
});

test('initializeAudioWorklet honors first-launch and forced-skip guards', async () => {
  await withAppModule({}, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true };
    const deps = createDependencies(calls);
    const app = new mod.App(deps);
    window.isFirstLaunch = true;
    await app.initializeAudioWorklet();
    assert.equal(calls.some(call => call[0] === 'audio.initializeAudioWorklet'), false);
    window.isFirstLaunch = false;
    window.__FORCE_SKIP_PIPELINE_STATE_LOAD = true;
    await app.initializeAudioWorklet();
    window.__FORCE_SKIP_PIPELINE_STATE_LOAD = false;
    await app.initializeAudioWorklet();
    assert.equal(calls.some(call => call[0] === 'audio.initializeAudioWorklet'), true);
  });
});

test('startup view preference opens library unless URL or first-launch content takes priority', async () => {
  await withAppModule({}, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: false };
    const app = new mod.App({
      ...createDependencies(calls),
      loadStartupConfig: async () => ({ startupView: 'library', libraryStartupView: 'subfolders' })
    });

    await app.applyStartupViewPreference();
    assert.equal(calls.some(call => call[0] === 'ui.showLibraryView' &&
      call[1]?.focusSearch === false && call[1]?.initialView === 'subfolders'), true);
  });

  await withAppModule({}, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: false };
    const app = new mod.App({
      ...createDependencies(calls),
      loadStartupConfig: async () => ({ startupView: 'library', libraryStartupView: 'folders' })
    });

    await app.applyStartupViewPreference();
    assert.equal(calls.some(call => call[0] === 'ui.showLibraryView' && call[1]?.initialView === 'tracks'), true);
  });

  await withAppModule({ search: '?p=shared' }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: false };
    const app = new mod.App({
      ...createDependencies(calls),
      loadStartupConfig: async () => ({ startupView: 'library' })
    });

    await app.applyStartupViewPreference();
    assert.equal(calls.some(call => call[0] === 'ui.showLibraryView'), false);
  });

  await withAppModule({ search: '?dbt=shared' }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: false };
    const app = new mod.App({
      ...createDependencies(calls),
      loadStartupConfig: async () => ({ startupView: 'library' })
    });

    await app.applyStartupViewPreference();
    assert.equal(calls.some(call => call[0] === 'ui.showLibraryView'), false);
  });

  await withAppModule({ pendingMusicFiles: ['C:\\Music\\one.mp3'] }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true };
    const app = new mod.App({
      ...createDependencies(calls),
      loadStartupConfig: async () => ({ startupView: 'library' })
    });

    await app.applyStartupViewPreference();
    assert.equal(calls.some(call => call[0] === 'ui.showLibraryView' && call[1]?.focusSearch === false), true);
  });

  await withAppModule({ pendingPresetFilePath: 'C:\\Presets\\Startup.effetune_preset' }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true };
    const app = new mod.App({
      ...createDependencies(calls),
      loadStartupConfig: async () => ({ startupView: 'library' })
    });
    app._handledCommandLinePresetAtStartup = true;

    await app.applyStartupViewPreference();
    assert.equal(calls.some(call => call[0] === 'ui.showLibraryView' && call[1]?.focusSearch === false), true);
  });

  await withAppModule({}, async ({ calls, document, mod, window }) => {
    window.appConfig = { startupView: 'library' };
    window.electronIntegration = { isElectron: true, isElectronEnvironment: () => true };
    const app = new mod.App({
      ...createDependencies(calls),
      loadStartupConfig: async () => {
        throw new Error('cached startup config should be used');
      }
    });

    await app.applyStartupViewPreference();
    assert.equal(document.body.className.split(/\s+/).includes('view-library'), true);
    assert.equal(calls.some(call => call[0] === 'ui.showLibraryView' && call[1]?.focusSearch === false), true);
  });

  await withAppModule({}, async ({ calls, document, mod, window }) => {
    window.appConfig = { startupView: 'library' };
    window.electronIntegration = { isElectron: true, isElectronEnvironment: () => true };
    window.isFirstLaunch = true;
    const app = new mod.App(createDependencies(calls));

    await app.applyStartupViewPreference();
    assert.equal(document.body.className.split(/\s+/).includes('view-library'), false);
    assert.equal(calls.some(call => call[0] === 'ui.showLibraryView'), false);
  });
});

test('initializeAndBuildPipeline loads pending, URL, and saved pipeline state', async () => {
  await withAppModule({}, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true };
    window.__FORCE_SKIP_PIPELINE_STATE_LOAD = true;
    const app = new mod.App(createDependencies(calls));
    await app.initializeAndBuildPipeline();
    assert.equal(window.__FORCE_SKIP_PIPELINE_STATE_LOAD, false);
  });

  await withAppModule({
    pendingPresetFilePath: 'preset.effetune_preset',
    electronAPI: {
      async readFile() {
        return { success: true, content: JSON.stringify([{ name: 'Gain', enabled: true, parameters: { amount: 1 } }]) };
      }
    }
  }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true };
    const app = new mod.App(createDependencies(calls, { audioPlayer: { contextManager: { connectToAudioContext() { calls.push(['player.connect']); } } } }));
    await app.initializeAndBuildPipeline();
    assert.equal(calls.some(call => call[0] === 'ui.loadPreset'), true);
    assert.equal(window.pendingPresetFilePath, null);
  });

  await withAppModule({ originalPipelineStateLoaded: false, search: '?dbt=share' }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: false };
    const deps = createDependencies(calls, { throwPluginNames: ['Level Meter'] });
    const app = new mod.App(deps);
    await app.initializeAndBuildPipeline();
    assert.equal(calls.some(call => call[0] === 'pluginManager.createPlugin' && call[1] === 'Volume'), true);
    assert.equal(calls.some(call => call[0] === 'dbt.restoreFromShare' && call[1] === 'share'), true);
  });

  await withAppModule({
    originalPipelineStateLoaded: true,
    pipelineStateLoaded: true,
    electronAPI: {
      async getPath() { return '/user'; },
      async joinPaths(...parts) { return parts.join('/'); },
      async fileExists() { return true; },
      async readFile() {
        return {
          success: true,
          content: JSON.stringify({
            pipelineA: [{ name: 'A', enabled: true, parameters: {} }],
            pipelineB: [{ name: 'B', enabled: false, parameters: {} }],
            currentPipeline: 'B'
          })
        };
      }
    }
  }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true };
    const app = new mod.App(createDependencies(calls));
    await app.initializeAndBuildPipeline();
    assert.equal(app.audioManager.currentPipeline, 'A');
    assert.equal(calls.some(call => call[0] === 'audio.setCurrentPipeline' && call[1] === 'B'), true);
  });
});

test('event listeners, output-device changes, relaunch, and command-line music coordinate app state', async () => {
  await withAppModule({
    pendingMusicFiles: [
      { path: 'C:\\Music\\one.MP4', byteLength: 3, name: 'one.MP4' },
      { path: 'C:\\Music\\two.wav', byteLength: 4, name: 'two.wav' }
    ],
    electronAPI: {
      platform: 'win32',
      async savePipelineStateToFile(state) {
        calls.push(['saveRiskState', state]);
      }
    },
    devices: [{ kind: 'audiooutput', deviceId: 'hdmi-new', label: 'HDMI' }]
  }, async ({ calls, document, mediaDevices, mod, timers, window }) => {
    window.electronIntegration = {
      isElectron: true,
      isElectronEnvironment: () => true,
      async loadAudioPreferences() {
        return { outputDeviceId: 'hdmi-old', outputDeviceLabel: 'HDMI' };
      },
      audioPreferences: {}
    };
    window.electronAPI = {
      onIPC(channel, listener) {
        calls.push(['electronAPI.onIPC', channel]);
        this.listener = listener;
      },
      platform: 'win32',
      async savePipelineStateToFile(state) {
        calls.push(['saveRiskState', state]);
      },
      async relaunchApp() {
        calls.push(['relaunchApp']);
      }
    };
    const deps = createDependencies(calls, {
      currentSink: 'hdmi-old',
      pipelineA: [{ name: 'A' }],
      pipelineB: null,
      reapplyResult: false
    });
    let openedFiles = [];
    const createAudioPlayer = deps.uiManager.createAudioPlayer.bind(deps.uiManager);
    deps.uiManager.createAudioPlayer = (files, replace) => {
      openedFiles = files;
      return createAudioPlayer(files, replace);
    };
    window.pipelineManager = deps.pipelineManager;
    const app = new mod.App(deps);
    app.setupEventListeners();
    document.dispatch('keydown', { key: 'F1', preventDefault() { calls.push(['preventDefault']); } });
    assert.equal(calls.some(call => call[0] === 'preventDefault'), true);
    document.hidden = false;
    app.audioManager.audioContext = { state: 'suspended', resume() { calls.push(['audioContext.resume']); } };
    document.dispatch('visibilitychange');
    assert.equal(calls.some(call => call[0] === 'audioContext.resume'), true);
    assert.equal(mediaDevices.listener instanceof Function, true);

    app._preferredDeviceWasAbsent = true;
    await app.handleOutputDeviceChange();
    assert.equal(calls.some(call => call[0] === 'io.reapplyOutputDevice'), true);
    assert.equal(calls.some(call => call[0] === 'audio.reset'), true);

    app._appStartTime = Date.now() - 20000;
    window.electronAPI.platform = 'darwin';
    app._preferredDeviceWasAbsent = true;
    await app.handleOutputDeviceChange();
    assert.equal(calls.some(call => call[0] === 'relaunchApp'), true);

    app._lastHdmiReconnectResetTime = Date.now();
    await app._doMacosRelaunch();

    app.processCommandLineArguments();
    await flushMicrotasks();
    await flushMicrotasks();
    await runTimers(timers);
    assert.equal(calls.some(call => call[0] === 'ui.createAudioPlayer'), true);
    assert.equal(openedFiles[0].name, 'one.MP4');
    assert.equal(openedFiles[0].byteLength, 3);
    assert.deepEqual(window.pendingMusicFiles, []);
  });
});

test('app helpers handle startup guards and UI/event fallbacks', async () => {
  await withAppModule({}, async ({ calls, document, mod, timers, window }) => {
    window.electronIntegration = { isElectron: true };
    window.electronAPI = {
      async savePipelineStateToFile() {
        return { success: false, error: 'save failed' };
      }
    };
    window.audioManager = null;
    window.pipelineManager = null;
    assert.equal(mod.getPipelineStateForSave(), null);
    window.audioManager = { getCurrentPipeline: () => [] };
    window.pipelineManager = { core: { getSerializablePluginState: plugin => plugin } };
    assert.equal(mod.getPipelineStateForSave(), null);
    await mod.writePipelineStateToFile();
    window.audioManager = { getCurrentPipeline: () => [{ name: 'A' }] };
    await mod.writePipelineStateToFile();
    window.electronAPI.savePipelineStateToFile = async () => { throw new Error('write failed'); };
    await mod.writePipelineStateToFile();

    window.electronAPI = null;
    assert.equal(await mod.loadPipelineState(), null);
    document.elementsById.delete('app-version');
    await mod.displayAppVersion();
    document.elementsById.set('app-version', createElement(document, 'span'));
    window.electronIntegration = { isElectron: false };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('fetch failed'); };
    await mod.displayAppVersion();
    globalThis.fetch = originalFetch;

    const deps = createDependencies(calls);
    const app = new mod.App(deps);
    app.showUpdateNotification({ version: '2.0.0', url: 'https://example.test/release' });
    assert.equal(document.body.children.some(child => child.className === 'update-notification'), true);
    document.updateNotification = { className: 'update-notification' };
    app.showUpdateNotification({ version: '2.0.1', url: 'https://example.test/release2' });
    document.updateNotification = null;
    document.whatsThis = null;
    app.showUpdateNotification({ version: '2.0.2', url: 'https://example.test/release3' });

    deps.audioManager.audioContext = { sampleRate: 44100 };
    app.hasAudioError = true;
    window.uiManager = deps.uiManager;
    app.handleErrors();
    await runTimers(timers);
    assert.equal(calls.some(call => call[0] === 'ui.setError' && call[1] === 'error.lowSampleRate'), true);
  });
});

test('timeout initialization and output-device fallback paths keep startup recoverable', async () => {
  await withAppModule({
    document: { hidden: true },
    devices: []
  }, async ({ calls, mod, timers, window }) => {
    window.electronIntegration = {
      isElectron: true,
      isElectronEnvironment: () => true,
      async loadAudioPreferences() {
        return { outputDeviceId: 'gone', outputDeviceLabel: 'Gone' };
      }
    };
    mod.INITIALIZATION_CONFIG.AUDIOWORKLET_TO_PIPELINE_WAIT = 1;
    const deps = createDependencies(calls, { currentSink: 'gone' });
    const app = new mod.App(deps);
    const initializePromise = app.initialize();
    await flushAndRunTimers(timers);
    await initializePromise;
    assert.equal(app.initialized, true);

    await app.handleOutputDeviceChange();
    assert.equal(timers.some(timer => timer.delay === 3000), true);
    await runTimers(timers);
    assert.equal(calls.some(call => call[0] === 'audio.reset'), true);

    window.electronAPI = {
      async savePipelineStateToFile(state) {
        calls.push(['risk.savePipelineStateToFile', state]);
      }
    };
    await app._savePipelineStateBeforeRisk();
    assert.equal(calls.some(call => call[0] === 'core.serialize'), true);

    window.electronIntegration.loadAudioPreferences = async () => { throw new Error('prefs failed'); };
    await app._handleOutputDeviceChangeImpl();
    window.electronIntegration.loadAudioPreferences = async () => ({});
    await app._handleOutputDeviceChangeImpl();
  });

  await withAppModule({
    enumerateReject: true
  }, async ({ calls, mod, window }) => {
    window.electronIntegration = {
      isElectronEnvironment: () => true,
      async loadAudioPreferences() {
        return { outputDeviceId: 'id' };
      }
    };
    const app = new mod.App(createDependencies(calls));
    await app.handleOutputDeviceChange();
    assert.equal(calls.some(call => call[0] === 'console.warn'), true);
  });
});

test('initialization recovers from startup readiness and config failures', async () => {
  await withAppModule({
    document: { hidden: false },
    electronAPI: {
      async loadConfig() {
        return { success: true, config: { startMinimized: true } };
      },
      signalReadyForMusicFiles() {},
      async signalReadyForUpdates() {
        throw new Error('updates failed');
      }
    }
  }, async ({ calls, mod, timers, window }) => {
    window.electronIntegration = { isElectron: true, isElectronEnvironment: () => false };
    mod.INITIALIZATION_CONFIG.AUDIOWORKLET_TO_PIPELINE_WAIT = 0;
    const app = new mod.App(createDependencies(calls));
    const initializePromise = app.initialize();
    const delays = await flushAndRunTimers(timers);
    await initializePromise;
    await flushMicrotasks();
    assert.equal(delays.includes(50), true);
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === 'Error signaling ready for updates:'), true);
  });

  await withAppModule({
    electronAPI: {
      async loadConfig() {
        throw new Error('config unavailable');
      }
    }
  }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true, isElectronEnvironment: () => false };
    mod.INITIALIZATION_CONFIG.AUDIOWORKLET_TO_PIPELINE_WAIT = 0;
    const app = new mod.App(createDependencies(calls));
    await app.initialize();
    assert.equal(app.initialized, true);
  });
});

test('initializeAndBuildPipeline restores first-launch and URL state payloads', async () => {
  await withAppModule({}, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true };
    window.isFirstLaunch = true;
    const app = new mod.App(createDependencies(calls));
    await app.initializeAndBuildPipeline();
    assert.equal(calls.some(call => call[0] === 'audio.setCurrentPipeline'), false);
  });

  await withAppModule({
    originalPipelineStateLoaded: false
  }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: false };
    const app = new mod.App(createDependencies(calls, {
      urlState: {
        pipelineA: [{ name: 'RouteA', enabled: true, inputBus: 0, outputBus: 1, channel: 'L', parameters: { gain: 1 } }],
        pipelineB: [{ name: 'RouteB', enabled: false, inputBus: 1, outputBus: 0, channel: 'R', parameters: { gain: 2 } }]
      }
    }));
    await app.initializeAndBuildPipeline();
    assert.equal(calls.some(call => call[0] === 'audio.setCurrentPipeline' && call[1] === 'A'), true);
  });

  await withAppModule({}, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: false };
    const app = new mod.App(createDependencies(calls, {
      urlState: [{ name: 'SingleRoute', enabled: true, inputBus: 0, outputBus: 1, channel: 'M', parameters: { gain: 3 } }]
    }));
    await app.initializeAndBuildPipeline();
    assert.equal(calls.some(call => call[0] === 'pluginManager.createPlugin' && call[1] === 'SingleRoute'), true);
  });
});

test('initializeAndBuildPipeline applies Web startup config after shared URL priority', async () => {
  await withAppModule({}, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: false };
    const app = new mod.App({
      ...createDependencies(calls, {
        localState: [{ name: 'SavedLocal', enabled: true, parameters: {} }]
      }),
      loadStartupConfig: async () => ({ pipelineStartup: 'default' })
    });
    await app.initializeAndBuildPipeline();
    assert.equal(calls.some(call => call[0] === 'ui.loadPipelineStateFromLocalStorage'), false);
    assert.equal(calls.some(call => call[0] === 'pluginManager.createPlugin' && call[1] === 'Volume'), true);
  });

  await withAppModule({}, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: false };
    const app = new mod.App({
      ...createDependencies(calls, {
        localState: [{ name: 'SavedLocal', enabled: true, parameters: {} }]
      }),
      loadStartupConfig: async () => ({ pipelineStartup: 'last' })
    });
    await app.initializeAndBuildPipeline();
    assert.equal(calls.some(call => call[0] === 'ui.loadPipelineStateFromLocalStorage'), true);
    assert.equal(calls.some(call => call[0] === 'pluginManager.createPlugin' && call[1] === 'SavedLocal'), true);
  });

  await withAppModule({ search: '?dbt=share' }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: false };
    const app = new mod.App({
      ...createDependencies(calls, {
        presets: { WebStartup: { name: 'WebStartup' } }
      }),
      loadStartupConfig: async () => ({ pipelineStartup: 'preset', startupPreset: 'WebStartup' })
    });
    await app.initializeAndBuildPipeline();
    assert.equal(calls.some(call => call[0] === 'presetManager.loadPreset' && call[1] === 'WebStartup'), true);
    assert.equal(calls.some(call => call[0] === 'ui.parsePipelineState'), true);
    assert.equal(calls.some(call => call[0] === 'dbt.restoreFromShare' && call[1] === 'share'), true);
  });

  await withAppModule({}, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: false };
    const app = new mod.App({
      ...createDependencies(calls, {
        urlState: [{ name: 'SharedUrl', enabled: true, parameters: {} }],
        localState: [{ name: 'SavedLocal', enabled: true, parameters: {} }],
        presets: { WebStartup: { name: 'WebStartup' } }
      }),
      loadStartupConfig: async () => ({ pipelineStartup: 'preset', startupPreset: 'WebStartup' })
    });
    await app.initializeAndBuildPipeline();
    assert.equal(calls.some(call => call[0] === 'presetManager.loadPreset'), false);
    assert.equal(calls.some(call => call[0] === 'ui.loadPipelineStateFromLocalStorage'), false);
    assert.equal(calls.some(call => call[0] === 'pluginManager.createPlugin' && call[1] === 'SharedUrl'), true);
  });

  await withAppModule({}, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: false };
    const app = new mod.App({
      ...createDependencies(calls, { presets: {} }),
      loadStartupConfig: async () => ({ pipelineStartup: 'preset', startupPreset: 'Missing' })
    });
    await app.initializeAndBuildPipeline();
    assert.equal(calls.some(call => call[0] === 'console.warn'), true);
    assert.equal(calls.some(call => call[0] === 'ui.setError' && call[1] === "Startup preset 'Missing' not found"), true);
    assert.equal(calls.some(call => call[0] === 'ui.loadPipelineStateFromLocalStorage'), false);
    assert.equal(calls.some(call => call[0] === 'pluginManager.createPlugin' && call[1] === 'Volume'), true);
  });
});

test('initializeAndBuildPipeline handles command-line preset success and malformed files', async () => {
  await withAppModule({
    originalPipelineStateLoaded: true
  }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true };
    window.electronAPI = {
      async getCommandLinePresetFile() {
        throw new Error('preset path failed');
      }
    };
    const app = new mod.App({
      ...createDependencies(calls),
      loadStartupConfig: async () => ({ pipelineStartup: 'default' })
    });
    await app.initializeAndBuildPipeline();
    assert.equal(window.ORIGINAL_PIPELINE_STATE_LOADED, false);
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === 'Error getting command line preset file:'), true);
  });

  await withAppModule({}, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true };
    const app = new mod.App({
      ...createDependencies(calls),
      loadStartupConfig: async () => {
        throw new Error('startup config failed');
      }
    });
    await app.initializeAndBuildPipeline();
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === 'Error loading config for startup preset:'), true);
  });

  await withAppModule({
    originalPipelineStateLoaded: true
  }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true };
    window.electronAPI = {
      async getCommandLinePresetFile() {
        calls.push(['getCommandLinePresetFile']);
        return 'C:\\Presets\\Object.effetune_preset';
      },
      async readFile() {
        return {
          success: true,
          content: JSON.stringify({ pipeline: [{ name: 'Object', enabled: true, parameters: {} }] })
        };
      }
    };
    window.require = () => {
      return {
        basename() {
          return 'Object';
        }
      };
    };
    const deps = createDependencies(calls, {
      audioPlayer: {
        contextManager: {
          connectToAudioContext() {
            throw new Error('reconnect failed');
          }
        }
      },
      workletDisconnectReject: true
    });
    const app = new mod.App(deps);
    await app.initializeAndBuildPipeline();
    const loadedPreset = calls.find(call => call[0] === 'ui.loadPreset')?.[1];
    assert.equal(window.ORIGINAL_PIPELINE_STATE_LOADED, false);
    assert.equal(loadedPreset.name, 'Object');
    assert.deepEqual(loadedPreset.pipeline, [{ name: 'Object', enabled: true, parameters: {} }]);
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === 'Error reconnecting audio player:'), true);
  });

  const presetFailureCases = [
    {
      name: 'read failure',
      content: null,
      result: { success: false, error: 'read failed' }
    },
    {
      name: 'parse failure',
      content: '{not-json',
      result: null
    },
    {
      name: 'unknown format',
      content: JSON.stringify({ plugins: [] }),
      result: null
    }
  ];
  for (const presetCase of presetFailureCases) {
    await withAppModule({
      pendingPresetFilePath: `${presetCase.name}.effetune_preset`,
      electronAPI: {
        async readFile() {
          return presetCase.result ?? { success: true, content: presetCase.content };
        }
      }
    }, async ({ calls, mod, window }) => {
      window.electronIntegration = { isElectron: true };
      const app = new mod.App({
        ...createDependencies(calls),
        loadStartupConfig: async () => ({ pipelineStartup: 'default' })
      });
      await app.initializeAndBuildPipeline();
      assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === 'Error loading preset file:'), true);
    });
  }
});

test('initializeAndBuildPipeline handles configured startup presets and pending preset recovery', async () => {
  await withAppModule({
    originalPipelineStateLoaded: false
  }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true };
    const app = new mod.App({
      ...createDependencies(calls, {
        presets: { Startup: { name: 'Startup' } },
        workletDisconnectReject: true
      }),
      loadStartupConfig: async () => ({ pipelineStartup: 'preset', startupPreset: 'Startup' })
    });
    await app.initializeAndBuildPipeline();
    assert.equal(window.ORIGINAL_PIPELINE_STATE_LOADED, false);
    assert.equal(calls.some(call => call[0] === 'presetManager.loadPreset' && call[1] === 'Startup'), true);
  });

  await withAppModule({}, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true };
    const app = new mod.App({
      ...createDependencies(calls, { presets: {} }),
      loadStartupConfig: async () => ({ pipelineStartup: 'preset', startupPreset: 'Missing' })
    });
    await app.initializeAndBuildPipeline();
    assert.equal(calls.some(call => call[0] === 'console.warn'), true);
  });

  await withAppModule({}, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true };
    const app = new mod.App({
      ...createDependencies(calls, { presets: { Broken: { name: 'Broken' } }, loadPresetReject: true }),
      loadStartupConfig: async () => ({ pipelineStartup: 'preset', startupPreset: 'Broken' })
    });
    await app.initializeAndBuildPipeline();
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === 'Error loading startup preset:'), true);
  });

  await withAppModule({
    originalPipelineStateLoaded: true,
    search: '?dbt=broken'
  }, async ({ calls, mod, timers, window }) => {
    window.electronIntegration = { isElectron: true };
    window.pendingPresetName = 'Pending';
    window.pendingTrayPresetName = 'Tray';
    const deps = createDependencies(calls, {
      urlState: [{ name: 'Fail', enabled: true, parameters: {}, inputBus: 0, outputBus: 1, channel: 'L' }],
      throwPluginNames: ['Fail', 'Volume', 'Level Meter'],
      workletDisconnectReject: true,
      rebuildRejectOnce: true,
      dbtReject: true
    });
    window.pipelineManager = deps.pipelineManager;
    const app = new mod.App({
      ...deps,
      loadStartupConfig: async () => ({}),
      loadPipelineState: async () => {
        throw new Error('state load failed');
      }
    });
    const pipelinePromise = app.initializeAndBuildPipeline();
    await flushAndRunTimers(timers);
    await pipelinePromise;
    const rebuildAttempts = calls.filter(call => call[0] === 'audio.rebuildPipeline' && call[1] === true);
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === 'Error loading pipeline state:'), true);
    assert.equal(rebuildAttempts.length >= 2, true);
    assert.equal(calls.some(call => call[0] === 'presetManager.loadPreset' && call[1] === 'Pending'), true);
    assert.equal(calls.some(call => call[0] === 'presetManager.loadPreset' && call[1] === 'Tray'), true);
    assert.equal(window.pendingPresetName, null);
    assert.equal(window.pendingTrayPresetName, null);
  });
});

test('event listeners and update notifications stay recoverable', async () => {
  await withAppModule({}, async ({ calls, document, mediaDevices, mod, window }) => {
    const deps = createDependencies(calls);
    const app = new mod.App(deps);
    app.setupEventListeners();
    window.electronAPI.listeners.get('update-available')({ version: 'Version 2.1.0', url: 'https://example.test/update' });
    const notice = document.body.children.find(child => child.className === 'update-notification');
    assert.equal(notice.children[0].textContent, 'New Version 2.1.0 available.');
    window.electronAPI.openExternal = url => calls.push(['openExternal', url]);
    notice.children[0].click();
    assert.equal(calls.some(call => call[0] === 'openExternal'), true);
    document.updateNotification = null;
    window.uiManager = {
      t(key, params) {
        calls.push(['translate', key, params.version]);
        return `Translated ${params.version}`;
      }
    };
    app.showUpdateNotification({ version: '3.0.2', url: 'https://example.test/translated' });
    const translatedNotice = document.body.children.filter(child => child.className === 'update-notification').at(-1);
    assert.equal(translatedNotice.children[0].textContent, 'Translated 3.0.2');
    window.electronAPI = null;
    document.updateNotification = null;
    app.showUpdateNotification({ version: '3.0.1', url: 'https://example.test/web' });
    document.body.children.filter(child => child.className === 'update-notification').at(-1).children[0].click();
    assert.equal(calls.some(call => call[0] === 'window.open' && call[1] === 'https://example.test/web'), true);

    window.electronIntegration = {
      isElectronEnvironment: () => true,
      async loadAudioPreferences() {
        return { outputDeviceId: 'device' };
      }
    };
    mediaDevices.listener();
    await flushMicrotasks();
    await flushMicrotasks();
    assert.equal(calls.some(call => call[0] === 'enumerateDevices'), true);

    window.electronIntegration = null;
    await app.handleOutputDeviceChange();
    window.electronIntegration = { isElectronEnvironment: () => true, async loadAudioPreferences() { return { outputDeviceId: 'id' }; } };
    app._deviceChangeInProgress = true;
    await app.handleOutputDeviceChange();
    app._deviceChangeInProgress = false;
  });
});

test('output-device fallbacks handle reset, retry, and no-op paths', async () => {
  await withAppModule({
    devices: [{ kind: 'audiooutput', deviceId: 'found', label: 'Found' }]
  }, async ({ calls, mod, window }) => {
    window.electronIntegration = {
      isElectronEnvironment: () => true,
      async loadAudioPreferences() {
        return { outputDeviceId: 'found', outputDeviceLabel: 'Found' };
      }
    };
    const app = new mod.App(createDependencies(calls, { currentSink: undefined }));
    await app._handleOutputDeviceChangeImpl();
    assert.equal(calls.some(call => call[0] === 'audio.reset'), true);
  });

  const reconnectDevices = [];
  await withAppModule({
    devices: reconnectDevices
  }, async ({ calls, mod, timers, window }) => {
    window.electronIntegration = {
      isElectronEnvironment: () => true,
      async loadAudioPreferences() {
        return { outputDeviceId: 'hdmi', outputDeviceLabel: 'HDMI' };
      }
    };
    const app = new mod.App(createDependencies(calls, { currentSink: 'hdmi' }));
    await app._handleOutputDeviceChangeImpl();
    reconnectDevices.push({ kind: 'audiooutput', deviceId: 'new-hdmi', label: 'HDMI' });
    await runTimers(timers);
    assert.equal(calls.some(call => call[0] === 'audio.reset'), false);
  });

  await withAppModule({
    enumerateDevices: (() => {
      let count = 0;
      return async () => {
        count += 1;
        if (count === 1) return [];
        throw new Error('second enumerate failed');
      };
    })()
  }, async ({ calls, mod, timers, window }) => {
    window.electronIntegration = {
      isElectronEnvironment: () => true,
      async loadAudioPreferences() {
        return { outputDeviceId: 'hdmi', outputDeviceLabel: 'HDMI' };
      }
    };
    const app = new mod.App(createDependencies(calls, { currentSink: 'hdmi' }));
    await app._handleOutputDeviceChangeImpl();
    await flushAndRunTimers(timers);
    assert.equal(calls.filter(call => call[0] === 'enumerateDevices').length, 2);
  });

  await withAppModule({
    devices: []
  }, async ({ calls, mod, window }) => {
    window.electronIntegration = {
      isElectronEnvironment: () => true,
      async loadAudioPreferences() {
        return { outputDeviceId: 'hdmi', outputDeviceLabel: 'HDMI' };
      }
    };
    const app = new mod.App(createDependencies(calls, { currentSink: 'other' }));
    await app._handleOutputDeviceChangeImpl();
    assert.equal(calls.some(call => call[0] === 'audio.reset'), false);
  });
});

test('output-device fallbacks handle debounce, context sink, and reset failures', async () => {
  await withAppModule({
    devices: []
  }, async ({ calls, mod, window }) => {
    window.electronIntegration = {
      isElectronEnvironment: () => true,
      async loadAudioPreferences() {
        return { outputDeviceId: 'hdmi', outputDeviceLabel: 'HDMI' };
      }
    };
    const app = new mod.App(createDependencies(calls, { currentSink: 'hdmi' }));
    app._disconnectDebounceTimer = 77;
    await app._handleOutputDeviceChangeImpl();
    assert.equal(calls.some(call => call[0] === 'clearTimeout' && call[1] === 77), true);
  });

  await withAppModule({
    devices: [{ kind: 'audiooutput', deviceId: 'ctx-new', label: 'Context' }]
  }, async ({ calls, mod, window }) => {
    window.electronAPI = { platform: 'win32' };
    window.electronIntegration = {
      isElectronEnvironment: () => true,
      async loadAudioPreferences() {
        return { outputDeviceId: 'ctx-new', outputDeviceLabel: 'Context' };
      }
    };
    const app = new mod.App(createDependencies(calls, {
      audioContextSinkMode: true,
      contextSink: 'ctx-old'
    }));
    await app._handleOutputDeviceChangeImpl();
    assert.equal(calls.some(call => call[0] === 'io.reapplyOutputDevice' && call[1] === 'ctx-new'), true);
  });

  await withAppModule({
    devices: []
  }, async ({ calls, mod, timers, window }) => {
    window.electronIntegration = {
      isElectronEnvironment: () => true,
      async loadAudioPreferences() {
        return { outputDeviceId: 'hdmi', outputDeviceLabel: 'HDMI' };
      }
    };
    const app = new mod.App(createDependencies(calls, {
      currentSink: 'hdmi',
      resetReject: true
    }));
    await app._handleOutputDeviceChangeImpl();
    await flushAndRunTimers(timers);
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === '[disconnectDebounce] reset failed:'), true);
  });
});

test('device reconnect paths choose platform-specific reset or relaunch behavior', async () => {
  await withAppModule({
    devices: [{ kind: 'audiooutput', deviceId: 'hdmi', label: 'HDMI' }]
  }, async ({ calls, mod, window }) => {
    window.electronAPI = { platform: 'darwin' };
    window.electronIntegration = {
      isElectronEnvironment: () => true,
      async loadAudioPreferences() {
        return { outputDeviceId: 'hdmi', outputDeviceLabel: 'HDMI' };
      }
    };
    const app = new mod.App(createDependencies(calls, { currentSink: 'old' }));
    app._disconnectDebounceTimer = 99;
    app._preferredDeviceWasAbsent = true;
    app._appStartTime = Date.now() - 20000;
    await app._handleOutputDeviceChangeImpl();
    assert.equal(calls.some(call => call[0] === 'clearTimeout' && call[1] === 99), true);
  });

  await withAppModule({
    devices: [{ kind: 'audiooutput', deviceId: 'hdmi', label: 'HDMI' }]
  }, async ({ calls, mod, window }) => {
    window.electronAPI = { platform: 'win32' };
    window.electronIntegration = {
      isElectronEnvironment: () => true,
      async loadAudioPreferences() {
        return { outputDeviceId: 'hdmi', outputDeviceLabel: 'HDMI' };
      }
    };
    const app = new mod.App(createDependencies(calls, {
      currentSink: 'old',
      reapplyResult: false,
      resetReject: true
    }));
    app._preferredDeviceWasAbsent = true;
    await app._handleOutputDeviceChangeImpl();
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === '[handleOutputDeviceChange] reset(null) after reapply failure threw:'), true);
  });

  await withAppModule({
    devices: [{ kind: 'audiooutput', deviceId: 'new', label: 'New' }]
  }, async ({ calls, mod, window }) => {
    window.electronAPI = { platform: 'darwin', async relaunchApp() { calls.push(['relaunchApp.mismatch']); } };
    window.electronIntegration = {
      isElectronEnvironment: () => true,
      async loadAudioPreferences() {
        return { outputDeviceId: 'new', outputDeviceLabel: 'New' };
      }
    };
    const app = new mod.App(createDependencies(calls, { currentSink: 'old', reapplyResult: false }));
    app._appStartTime = Date.now() - 20000;
    await app._handleOutputDeviceChangeImpl();
    assert.equal(calls.some(call => call[0] === 'relaunchApp.mismatch'), true);
  });

  await withAppModule({
    devices: [{ kind: 'audiooutput', deviceId: 'new', label: 'New' }]
  }, async ({ calls, mod, window }) => {
    window.electronAPI = { platform: 'win32' };
    window.electronIntegration = {
      isElectronEnvironment: () => true,
      async loadAudioPreferences() {
        return { outputDeviceId: 'new', outputDeviceLabel: 'New' };
      }
    };
    const app = new mod.App(createDependencies(calls, {
      currentSink: 'old',
      reapplyResult: false,
      resetReject: true
    }));
    await app._handleOutputDeviceChangeImpl();
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === '[handleOutputDeviceChange] reset(null) after reapply failure threw:'), true);
  });

  await withAppModule({
    devices: [{ kind: 'audiooutput', deviceId: 'new', label: 'New' }]
  }, async ({ calls, mod, window }) => {
    window.electronAPI = { platform: 'win32' };
    window.electronIntegration = {
      isElectronEnvironment: () => true,
      async loadAudioPreferences() {
        return { outputDeviceId: 'new', outputDeviceLabel: 'New' };
      }
    };
    const app = new mod.App(createDependencies(calls, {
      currentSink: 'old',
      reapplyResult: false
    }));
    await app._handleOutputDeviceChangeImpl();
    assert.equal(calls.some(call => call[0] === 'audio.reset'), true);
  });
});

test('macOS relaunch save paths recover from missing or failing APIs', async () => {
  await withAppModule({}, async ({ calls, mod, window }) => {
    window.electronAPI = {
      async savePipelineStateToFile() {
        throw new Error('risk save failed');
      }
    };
    const deps = createDependencies(calls, { pipelineA: [{ name: 'A' }] });
    window.pipelineManager = deps.pipelineManager;
    const app = new mod.App(deps);
    await app._savePipelineStateBeforeRisk();
    assert.equal(calls.some(call => call[0] === 'console.warn' && call[1] === '[savePipelineStateBeforeRisk] state save failed (continuing):'), true);
  });

  await withAppModule({}, async ({ calls, mod, window }) => {
    window.electronAPI = {};
    const app = new mod.App(createDependencies(calls));
    window.pipelineManager = null;
    app._appStartTime = Date.now();
    await app._doMacosRelaunch();
    app._appStartTime = Date.now() - 20000;
    app._lastHdmiReconnectResetTime = 0;
    await app._doMacosRelaunch();
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === '[_doMacosRelaunch] pipelineManager.core unavailable — skipping pipeline save before relaunch'), true);
    assert.equal(calls.some(call => call[0] === 'location.reload'), true);
  });

  await withAppModule({}, async ({ calls, mod, window }) => {
    window.electronAPI = {
      async savePipelineStateToFile() {
        throw new Error('save failed');
      },
      async relaunchApp() {
        throw new Error('relaunch failed');
      }
    };
    const deps = createDependencies(calls, { pipelineA: [{ name: 'A' }] });
    window.pipelineManager = deps.pipelineManager;
    const app = new mod.App(deps);
    app._appStartTime = Date.now() - 20000;
    await app._doMacosRelaunch();
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === '[_doMacosRelaunch] Failed to save pipeline state before relaunch — user work may be lost:'), true);
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === '[_doMacosRelaunch] relaunchApp failed, falling back to reload:'), true);
  });
});

test('command-line music and version fallbacks stay recoverable', async () => {
  await withAppModule({}, async ({ mod, window }) => {
    const app = new mod.App(createDependencies([]));
    window.electronIntegration = { isElectron: false };
    app.processCommandLineArguments();
  });

  await withAppModule({
    pendingMusicFiles: ['bad.wav'],
  }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true, audioPreferences: {} };
    const app = new mod.App(createDependencies(calls));
    app.processCommandLineArguments();
    await flushMicrotasks();
    await flushMicrotasks();
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === 'Initial music file admission returned no playable files'), true);
  });

  await withAppModule({
    pendingMusicFiles: [{ path: 'song.wav', byteLength: 3, name: 'song.wav' }]
  }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true, audioPreferences: {} };
    const deps = createDependencies(calls);
    deps.uiManager.createAudioPlayer = () => {
      throw new Error('player failed');
    };
    const app = new mod.App(deps);
    app.processCommandLineArguments();
    await flushMicrotasks();
    await flushMicrotasks();
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === 'Initial music playback setup diagnostic:'), true);
  });

  await withAppModule({
    pendingMusicFiles: ['throw.mp3'],
  }, async ({ calls, mod, window }) => {
    window.electronIntegration = { isElectron: true, audioPreferences: {} };
    const app = new mod.App(createDependencies(calls));
    app.processCommandLineArguments();
    await flushMicrotasks();
    await flushMicrotasks();
    assert.equal(calls.some(call => call[0] === 'console.error' && call[1] === 'Initial music file admission returned no playable files'), true);
  });

  await withAppModule({}, async ({ document, mod, window }) => {
    const versionElement = document.getElementById('app-version');
    let shouldThrow = true;
    document.getElementById = id => {
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error('dom failed');
      }
      return id === 'app-version' ? versionElement : null;
    };
    window.electronIntegration = { isElectron: false };
    await mod.displayAppVersion();
    assert.equal(versionElement.textContent, '');
  });
});

test('autoStartApplication starts bootstrap only when auto-start is enabled', async () => {
  await withAppModule({}, async ({ calls, document, mod, window }) => {
    const disabledResult = mod.autoStartApplication({
      windowRef: { __EFFECTUNE_DISABLE_APP_AUTO_START__: true },
      startApplicationFn() {
        throw new Error('disabled auto-start should not call bootstrap');
      }
    });
    assert.equal(disabledResult, null);

    class FakeApp {}
    const firstLaunchPromise = Promise.resolve(false);
    const enabledWindow = { __EFFECTUNE_DISABLE_APP_AUTO_START__: false };
    const enabledResult = mod.autoStartApplication({
      windowRef: enabledWindow,
      AppClass: FakeApp,
      firstLaunchPromise,
      startHeartbeat: page => calls.push(['testHeartbeat', page]),
      startApplicationFn(options) {
        calls.push([
          'startApplication',
          options.AppClass,
          options.firstLaunchPromise,
          options.windowRef
        ]);
        options.startHeartbeat('main-page');
        return 'started';
      }
    });

    assert.equal(enabledResult, 'started');
    assert.deepEqual(calls.find(call => call[0] === 'startApplication'), [
      'startApplication',
      FakeApp,
      firstLaunchPromise,
      enabledWindow
    ]);
    assert.equal(calls.some(call => call[0] === 'testHeartbeat' && call[1] === 'main-page'), true);

    window.__EFFECTUNE_DISABLE_APP_AUTO_START__ = false;
    window.electronIntegration = { isElectron: true, isElectronEnvironment: () => true };
    window.electronAPI.loadConfig = async () => ({ success: true, config: { startupView: 'library' } });

    const configuredResult = await mod.autoStartApplication({
      windowRef: window,
      AppClass: FakeApp,
      firstLaunchPromise: Promise.resolve(false),
      startHeartbeat: page => calls.push(['configuredHeartbeat', page]),
      async startApplicationFn(options) {
        options.windowRef.isFirstLaunch = false;
        await options.loadInitialConfigFn({ windowRef: options.windowRef, logger: console });
        return 'configured';
      }
    });

    assert.equal(configuredResult, 'configured');
    assert.equal(window.appConfig.startupView, 'library');
    assert.equal(window.electronIntegration.config.startupView, 'library');
    assert.equal(document.body.className.split(/\s+/).includes('view-library'), true);

    resetWebAppConfigRuntimeForTests();
    try {
      document.body.className = '';
      window.appConfig = null;
      window.electronIntegration = { isElectron: false, isElectronEnvironment: () => false };
      window.localStorage = {
        getItem(key) {
          return key === 'effetune_app_config' ? JSON.stringify({ startupView: 'library' }) : null;
        },
        setItem() {}
      };

      const webConfiguredResult = await mod.autoStartApplication({
        windowRef: window,
        AppClass: FakeApp,
        firstLaunchPromise: Promise.resolve(false),
        startHeartbeat: page => calls.push(['webConfiguredHeartbeat', page]),
        async startApplicationFn(options) {
          options.windowRef.isFirstLaunch = false;
          await options.loadInitialConfigFn({ windowRef: options.windowRef, logger: console });
          return 'web-configured';
        }
      });

      assert.equal(webConfiguredResult, 'web-configured');
      assert.equal(window.appConfig.startupView, 'library');
      assert.equal(window.electronIntegration.config.startupView, 'library');
      assert.equal(document.body.className.split(/\s+/).includes('view-library'), true);
    } finally {
      resetWebAppConfigRuntimeForTests();
    }
  });
});
