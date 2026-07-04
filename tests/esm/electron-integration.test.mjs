import assert from 'node:assert/strict';
import test from 'node:test';

import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

function createConsole(calls) {
  return {
    log(...args) { calls.push(['console.log', ...args]); },
    warn(...args) { calls.push(['console.warn', ...args]); },
    error(...args) { calls.push(['console.error', ...args]); }
  };
}

function parseAttributes(source) {
  const attrs = {};
  const pattern = /([:\w-]+)(?:="([^"]*)")?/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    attrs[match[1]] = match[2] ?? true;
  }
  return attrs;
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.eventListeners = new Map();
    this.attributes = {};
    this.className = '';
    this.id = '';
    this.textContent = '';
    this.style = {};
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.ownerDocument.registerElementsFromHTML(value, this);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type).push(listener);
  }

  dispatchEvent(type, event = {}) {
    const listeners = this.eventListeners.get(type) || [];
    for (const listener of listeners) {
      listener({ target: this, ...event });
    }
  }
}

function createDocument(options = {}) {
  const elementsById = new Map();
  const allElements = [];
  const documentListeners = new Map();
  const document = {
    body: null,
    head: null,
    elementsById,
    allElements,
    createElement(tagName) {
      if (options.throwCreateElement) {
        throw new Error('createElement failed');
      }
      const element = new FakeElement(tagName, document);
      allElements.push(element);
      return element;
    },
    getElementById(id) {
      return elementsById.get(id) || null;
    },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) {
        documentListeners.set(type, []);
      }
      documentListeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      if (!documentListeners.has(type)) return;
      documentListeners.set(
        type,
        documentListeners.get(type).filter(candidate => candidate !== listener)
      );
    },
    registerElementsFromHTML(html, parent) {
      const pattern = /<([a-z][\w-]*)\b([^>]*)>/gi;
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const attrs = parseAttributes(match[2]);
        if (!attrs.id) continue;
        const element = new FakeElement(match[1], document);
        element.id = attrs.id;
        element.attributes = attrs;
        element.parentNode = parent;
        elementsById.set(element.id, element);
        allElements.push(element);
        parent.children.push(element);
      }
    }
  };
  document.body = document.createElement('body');
  document.head = document.createElement('head');
  return document;
}

function createTimers(calls) {
  const intervals = [];
  const timeouts = [];
  return {
    setInterval(callback, delay) {
      const id = intervals.length + 1;
      intervals.push({ id, callback, active: true });
      calls.push(['setInterval', delay]);
      return id;
    },
    clearInterval(id) {
      const entry = intervals.find(interval => interval.id === id);
      if (entry) entry.active = false;
      calls.push(['clearInterval', id]);
    },
    setTimeout(callback, delay) {
      const id = timeouts.length + 1;
      timeouts.push({ id, callback, delay });
      calls.push(['setTimeout', delay]);
      return id;
    },
    runIntervals() {
      for (const interval of [...intervals]) {
        if (interval.active) {
          interval.callback();
        }
      }
    },
    runTimeouts() {
      for (const timeout of [...timeouts]) {
        timeout.callback();
      }
    }
  };
}

function createWindow(calls, options = {}) {
  const listeners = new Map();
  return {
    electronAPI: options.electronAPI,
    electronIntegration: options.electronIntegration,
    uiManager: options.uiManager,
    app: options.app,
    pipelineManager: options.pipelineManager,
    isFirstLaunch: options.isFirstLaunch,
    audioManager: options.audioManager,
    workletNode: options.workletNode,
    addEventListener(type, listener) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      if (!listeners.has(type)) return;
      listeners.set(
        type,
        listeners.get(type).filter(candidate => candidate !== listener)
      );
    },
    open(...args) {
      calls.push(['window.open', ...args]);
    },
    dispatchWindowEvent(type, event = {}) {
      for (const listener of listeners.get(type) || []) {
        listener(event);
      }
    }
  };
}

function createUIManager(calls, options = {}) {
  return {
    userLanguage: options.userLanguage ?? 'en',
    pipelineManager: options.pipelineManager,
    getLocalizedDocPath(path) {
      calls.push(['originalDocPath', path]);
      return `web:${path}`;
    },
    t(key, params) {
      calls.push(['t', key, params ?? null]);
      return params?.version ? `${key}:${params.version}` : key;
    },
    async syncLanguageWithConfig(config) {
      calls.push(['syncLanguageWithConfig', { ...config }]);
    },
    createAudioPlayer(files, append) {
      calls.push(['createAudioPlayer', [...files], append]);
    },
    getDoubleBlindTest() {
      return {
        enterFresh() {
          calls.push(['enterFresh']);
        }
      };
    }
  };
}

function createElectronAPI(calls, options = {}) {
  const handlers = { ipc: {} };
  const register = key => callback => {
    handlers[key] = callback;
  };
  return {
    handlers,
    onExportPreset: register('exportPreset'),
    onImportPreset: register('importPreset'),
    onOpenPresetFile: register('openPresetFile'),
    onOpenMusicFile: register('openMusicFile'),
    onOpenMusicFiles: register('openMusicFiles'),
    onProcessAudioFiles: register('processAudioFiles'),
    onSavePreset: register('savePreset'),
    onSavePresetAs: register('savePresetAs'),
    onConfigAudio: register('configAudio'),
    onConfigApp: register('configApp'),
    onLoadUserPreset: register('loadUserPreset'),
    onShowAboutDialog: register('showAboutDialog'),
    onIPC(channel, callback) {
      handlers.ipc[channel] = callback;
    },
    async loadAudioPreferences() {
      calls.push(['loadAudioPreferences']);
      return options.audioPreferencesResult ?? {
        success: true,
        preferences: options.audioPreferences ?? { sampleRate: 48000, useInputWithPlayer: true }
      };
    },
    async saveAudioPreferences(preferences) {
      calls.push(['saveAudioPreferences', { ...preferences }]);
      return options.saveAudioPreferencesResult ?? { success: true };
    },
    async loadConfig() {
      calls.push(['loadConfig']);
      return options.configResult ?? { success: true, config: options.config ?? { language: 'ja' } };
    },
    async saveConfig(config) {
      calls.push(['saveConfig', { ...config }]);
      return options.saveConfigResult ?? { success: true };
    },
    async forceCheckForUpdates() {
      calls.push(['forceCheckForUpdates']);
      if (options.forceCheckReject) throw new Error('force failed');
    },
    async getUpdateInfo() {
      calls.push(['getUpdateInfo']);
      if (options.getUpdateReject) throw new Error('update failed');
      return options.updateInfo ?? { version: '2.0.0' };
    },
    openExternal(url) {
      calls.push(['openExternal', url]);
    },
    async getAppVersion() {
      calls.push(['getAppVersion']);
      if (options.appVersionReject) throw new Error('version failed');
      return options.appVersion ?? '1.2.3';
    },
    async updateApplicationMenu(template) {
      calls.push(['updateApplicationMenuApi', template]);
      return options.updateApplicationMenuResult ?? { success: true };
    },
    async updateTrayMenu(template) {
      calls.push(['updateTrayMenuApi', template]);
      return options.updateTrayMenuResult ?? { success: true };
    },
    async getUserPresetsForTray() {
      calls.push(['getUserPresetsForTray']);
      return options.userPresetsForTrayResult ?? { success: true, presets: ['Preset A'] };
    }
  };
}

async function importFreshIntegration() {
  return import('../../js/electron-integration.js');
}

async function withIntegrationGlobals(options, callback) {
  const calls = options.calls ?? [];
  const timers = createTimers(calls);
  const documentRef = options.document ?? createDocument();
  const navigatorRef = { userAgent: options.userAgent ?? 'Mozilla/5.0' };
  const windowRef = createWindow(calls, {
    electronAPI: options.electronAPI,
    uiManager: options.uiManager,
    app: options.app,
    pipelineManager: options.pipelineManager,
    isFirstLaunch: options.isFirstLaunch,
    audioManager: options.audioManager,
    workletNode: options.workletNode
  });

  await withGlobals({
    window: windowRef,
    document: documentRef,
    navigator: navigatorRef,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    setTimeout: timers.setTimeout,
    console: createConsole(calls)
  }, async () => {
    const module = await importFreshIntegration();
    const instance = new module.ElectronIntegration();
    await flushMicrotasks();
    await callback({
      instance,
      windowRef,
      documentRef,
      navigatorRef,
      timers,
      calls
    });
  });
}

test('web environment delegates safely and detects Electron changes', async () => {
  await withIntegrationGlobals({}, async ({ instance, windowRef, navigatorRef }) => {
    assert.equal(instance.isElectron, false);
    instance.addDragDropDebugHandler();

    await instance.updateApplicationMenu();
    await instance.updateTrayMenu();
    await assert.rejects(instance.openPresetFile('preset.eft'), /Electron integration or UI manager not available/);
    assert.equal(await instance.loadAudioPreferences(), null);
    assert.equal(await instance.saveAudioPreferences({ sampleRate: 96000 }), false);
    assert.equal(await instance.saveAudioPreferences(null), false);
    assert.deepEqual(await instance.getAudioDevices(), [
      { deviceId: 'default', label: 'Default Microphone', kind: 'audioinput' },
      { deviceId: 'default', label: 'Default Speaker', kind: 'audiooutput' }
    ]);
    assert.equal(await instance.showAudioConfigDialog(() => {}), undefined);
    assert.equal(await instance.exportPreset(), undefined);
    assert.equal(await instance.importPreset(), undefined);
    assert.equal(await instance.openMusicFile(), undefined);
    assert.equal(instance.processAudioFiles(), undefined);
    assert.equal(instance.getAudioMimeType('song.FLAC'), 'audio/flac');
    assert.equal(await instance.getAppVersion(), '');
    assert.deepEqual(await instance.loadConfig(), {});
    await instance.saveConfig({ language: 'en' });
    assert.deepEqual(windowRef.appConfig, { language: 'en' });
    assert.equal(await instance.showConfigDialog(), undefined);

    assert.equal(instance.isElectronEnvironment(), false);
    navigatorRef.userAgent = 'Effetune Electron/30.0';
    assert.equal(instance.isElectronEnvironment(), true);
    navigatorRef.userAgent = 'Mozilla/5.0';
    windowRef.electronAPI = {};
    assert.equal(instance.isElectronEnvironment(), true);

    instance.config = null;
    await instance.saveConfig({ restored: true });
    assert.deepEqual(windowRef.appConfig, { restored: true });
  });
});

test('Electron constructor loads preferences and config, then callbacks dispatch current methods', async () => {
  const calls = [];
  const uiManager = createUIManager(calls);
  const electronAPI = createElectronAPI(calls, {
    audioPreferences: { sampleRate: 44100, useInputWithPlayer: true },
    config: { language: 'fr', autoLaunch: true }
  });

  await withIntegrationGlobals({
    electronAPI,
    uiManager,
    calls,
    userAgent: 'Mozilla/5.0'
  }, async ({ instance, windowRef }) => {
    windowRef.electronIntegration = instance;
    assert.equal(instance.isElectron, true);
    assert.deepEqual(instance.audioPreferences, { sampleRate: 44100, useInputWithPlayer: true });
    assert.deepEqual(windowRef.audioPreferences, { sampleRate: 44100, useInputWithPlayer: true });
    assert.deepEqual(instance.config, { language: 'fr', autoLaunch: true });

    for (const method of [
      'exportPreset',
      'importPreset',
      'openPresetFile',
      'openMusicFile',
      'processAudioFiles',
      'showAudioConfigDialog',
      'showConfigDialog',
      'updateTrayMenu',
      'showAboutDialog'
    ]) {
      instance[method] = (...args) => {
        calls.push([method, ...args]);
        return method;
      };
    }

    electronAPI.handlers.exportPreset();
    electronAPI.handlers.importPreset();
    windowRef.app = { audioManager: { workletNode: {} } };
    electronAPI.handlers.openPresetFile('ready.eft');
    windowRef.app = null;
    electronAPI.handlers.openPresetFile('pending.eft');
    electronAPI.handlers.openMusicFile();
    electronAPI.handlers.openMusicFiles([]);
    windowRef.app = { audioManager: { workletNode: {} } };
    windowRef.isFirstLaunch = false;
    electronAPI.handlers.openMusicFiles(['song.wav']);
    windowRef.isFirstLaunch = true;
    electronAPI.handlers.openMusicFiles(['pending-song.wav']);
    instance.audioPreferences = null;
    electronAPI.handlers.openMusicFiles(['pending-song-2.wav']);
    electronAPI.handlers.processAudioFiles();
    electronAPI.handlers.savePreset();
    electronAPI.handlers.savePresetAs();
    electronAPI.handlers.configAudio();
    electronAPI.handlers.configApp();

    windowRef.pipelineManager = {
      presetManager: {
        loadPreset(name) {
          calls.push(['loadPreset', name]);
        }
      }
    };
    windowRef.app = { audioManager: { workletNode: {} } };
    electronAPI.handlers.loadUserPreset('Ready');
    windowRef.app = null;
    electronAPI.handlers.loadUserPreset('Deferred');
    windowRef.pipelineManager = null;
    electronAPI.handlers.loadUserPreset('Ignored');
    electronAPI.handlers.ipc['request-tray-menu-update']();
    electronAPI.handlers.showAboutDialog({ version: '3.0.0' });
    electronAPI.handlers.ipc['start-double-blind-test']();
    windowRef.uiManager = {};
    electronAPI.handlers.ipc['start-double-blind-test']();

    assert.equal(windowRef.pendingPresetFilePath, 'pending.eft');
    assert.deepEqual(windowRef._debugCommandLineMusicFiles, ['song.wav']);
    assert.deepEqual(windowRef.pendingMusicFiles, ['pending-song-2.wav']);
    assert.equal(windowRef._commandLineMusicFilesNoInput, true);
    assert.equal(windowRef.pendingPresetName, 'Deferred');
    assert.ok(calls.some(call => call[0] === 'createAudioPlayer' && call[2] === false));
    assert.ok(calls.some(call => call[0] === 'loadPreset' && call[1] === 'Ready'));
    assert.ok(calls.some(call => call[0] === 'enterFresh'));
  });
});

test('documentation link patching maps Electron paths and delegates web paths', async () => {
  const calls = [];
  const uiManager = createUIManager(calls, {
    userLanguage: 'ja',
    pipelineManager: {}
  });
  const electronAPI = createElectronAPI(calls);

  await withIntegrationGlobals({
    electronAPI,
    uiManager,
    calls
  }, async ({ instance, windowRef, timers }) => {
    windowRef.electronIntegration = instance;
    timers.runIntervals();
    assert.equal(windowRef.uiManager.getLocalizedDocPath('/README.md'), '/docs/i18n/ja/');
    assert.equal(windowRef.uiManager.getLocalizedDocPath('/'), '/docs/i18n/ja/');
    assert.equal(windowRef.uiManager.getLocalizedDocPath('/plugins/eq.html#gain'), 'docs/i18n/ja/plugins/eq.md#gain');
    assert.equal(windowRef.uiManager.getLocalizedDocPath('/index.html'), '/docs/i18n/ja/');
    assert.equal(windowRef.uiManager.getLocalizedDocPath('./'), '/docs/i18n/ja/');
    assert.equal(windowRef.uiManager.getLocalizedDocPath('/guide'), 'docs/i18n/ja/guide/README.md');
    assert.equal(windowRef.uiManager.getLocalizedDocPath('/guide.md'), 'docs/i18n/ja/guide.md');
    assert.equal(windowRef.uiManager.getLocalizedDocPath('/docs/i18n/ja/guide.md'), 'docs/docs/i18n/ja/guide.md');
    assert.equal(
      windowRef.uiManager.pipelineManager.getLocalizedDocPath('/plugins/eq.html'),
      'docs/i18n/ja/plugins/eq.md'
    );

    windowRef.uiManager.userLanguage = 'en';
    assert.equal(windowRef.uiManager.getLocalizedDocPath('/README.md'), '/');
    assert.equal(windowRef.uiManager.getLocalizedDocPath('/plugins/eq.html#gain'), 'docs/plugins/eq.md#gain');
    assert.equal(windowRef.uiManager.getLocalizedDocPath('/plugins/eq.html'), 'docs/plugins/eq.md');
    assert.equal(windowRef.uiManager.getLocalizedDocPath('/index.html'), '/');
    assert.equal(windowRef.uiManager.getLocalizedDocPath('/guide'), 'docs/guide/README.md');
    assert.equal(windowRef.uiManager.getLocalizedDocPath('/guide.md'), 'docs/guide.md');
  });

  const webCalls = [];
  const webUiManager = createUIManager(webCalls);
  await withIntegrationGlobals({ uiManager: webUiManager, calls: webCalls }, async ({ instance, timers, windowRef }) => {
    instance.patchDocumentationLinks();
    timers.runIntervals();
    assert.equal(windowRef.uiManager.getLocalizedDocPath('/guide'), 'web:/guide');
    assert.ok(webCalls.some(call => call[0] === 'originalDocPath' && call[1] === '/guide'));
  });

  await withIntegrationGlobals({}, async ({ instance, timers, windowRef }) => {
    instance.patchDocumentationLinks();
    timers.runIntervals();
    windowRef.uiManager = createUIManager([], { pipelineManager: null });
    timers.runIntervals();
    assert.equal(windowRef.uiManager.getLocalizedDocPath('/README.md'), 'web:/README.md');
  });
});

test('About dialog opens update links, falls back safely, and shows the app version', async () => {
  const calls = [];
  const uiManager = createUIManager(calls);
  const electronAPI = createElectronAPI(calls, { appVersion: '9.8.7' });

  await withIntegrationGlobals({
    electronAPI,
    uiManager,
    calls
  }, async ({ instance, windowRef, documentRef }) => {
    windowRef.electronIntegration = instance;
    await instance.showAboutDialog({ version: '1.0.0' });
    const updateLink = documentRef.getElementById('about-update-link');
    const closeButton = documentRef.getElementById('close-button');
    assert.ok(updateLink);
    assert.ok(closeButton);
    updateLink.dispatchEvent('click');
    assert.ok(calls.some(call => call[0] === 'openExternal'));
    closeButton.dispatchEvent('click');
    assert.equal(documentRef.body.children.length, 0);
    assert.equal(documentRef.head.children.length, 0);
    assert.equal(await instance.getAppVersion(), '9.8.7');
  });

  const fallbackCalls = [];
  const fallbackApi = createElectronAPI(fallbackCalls, { updateInfo: { version: '4.0.0' } });
  await withIntegrationGlobals({
    electronAPI: fallbackApi,
    calls: fallbackCalls
  }, async ({ instance, windowRef, documentRef }) => {
    delete fallbackApi.openExternal;
    await instance.showAboutDialog({ version: '2.0.0' });
    documentRef.getElementById('about-update-link').dispatchEvent('click');
    assert.ok(fallbackCalls.some(call => call[0] === 'window.open'));
    documentRef.getElementById('close-button').dispatchEvent('click');
  });

  const updateFailureCalls = [];
  const updateFailureApi = createElectronAPI(updateFailureCalls, { forceCheckReject: true });
  await withIntegrationGlobals({
    electronAPI: updateFailureApi,
    uiManager: createUIManager(updateFailureCalls),
    calls: updateFailureCalls
  }, async ({ instance, documentRef }) => {
    await instance.showAboutDialog({ version: '3.0.0' });
    assert.equal(documentRef.getElementById('about-update-link'), null);
    assert.ok(updateFailureCalls.some(call => call[0] === 'console.error'));
    documentRef.getElementById('close-button').dispatchEvent('click');
  });

  const versionFailureCalls = [];
  const versionFailureApi = createElectronAPI(versionFailureCalls, { appVersionReject: true });
  await withIntegrationGlobals({ electronAPI: versionFailureApi, calls: versionFailureCalls }, async ({ instance }) => {
    assert.equal(await instance.getAppVersion(), '');
    assert.ok(versionFailureCalls.some(call => call[0] === 'console.error'));
  });

  await withIntegrationGlobals({}, async ({ instance, documentRef }) => {
    await instance.showAboutDialog({ version: '0.0.0' });
    assert.equal(documentRef.body.children.length, 0);
  });

  const createFailureCalls = [];
  const createFailureApi = createElectronAPI(createFailureCalls);
  const throwingDocument = createDocument();
  throwingDocument.createElement = () => {
    throw new Error('create failed');
  };
  await withIntegrationGlobals({
    electronAPI: createFailureApi,
    document: throwingDocument,
    calls: createFailureCalls
  }, async ({ instance }) => {
    await instance.showAboutDialog({ version: '5.0.0' });
    assert.ok(createFailureCalls.some(call => call[0] === 'console.error'));
  });
});

test('explicit Electron user agent without preload API fails during listener setup', async () => {
  await withGlobals({
    window: {},
    document: createDocument(),
    navigator: { userAgent: 'Mozilla Electron/1.0' },
    setInterval: () => 1,
    clearInterval: () => {},
    console: createConsole([])
  }, async () => {
    const module = await importFreshIntegration();
    assert.throws(() => new module.ElectronIntegration(), /onExportPreset/);
  });
});
