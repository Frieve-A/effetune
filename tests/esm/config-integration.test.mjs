import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadConfig, saveConfig, showConfigDialog } from '../../js/electron/configIntegration.js';
import {
  loadWebAppConfig,
  resetWebAppConfigRuntimeForTests,
  saveWebAppConfig,
  saveWebPowerSavingSettings,
  setWebAppConfigRuntimeForTests,
  WebAppConfigRuntime
} from '../../js/electron/webSettingsStorage.js';
import {
  PowerConfigStore,
  SerializedMemoryPowerConfigBackend
} from '../../js/electron/power-config-store.js';
import { DEFAULT_OFFLINE_OUTPUT_SETTINGS } from '../../js/audio/offline-output-settings.js';
import { createFakeDocument } from '../helpers/fake-dom.mjs';
import {
  createConsoleHarness,
  withGlobals
} from '../helpers/global-test-utils.mjs';

async function withMutedConsole(method, callback) {
  const original = console[method];
  console[method] = () => {};
  try {
    return await callback();
  } finally {
    console[method] = original;
  }
}

function createConfigHarness(options = {}) {
  const calls = [];
  const openHomeCalls = [];
  const airPlayCalls = [];
  const airPlayStatusListeners = new Set();
  const receptionStates = [];
  let airPlayStatus = { enabled: false, available: true, state: 'off', ...(options.airPlayStatus || {}) };
  const openHomeRendererStates = [];
  const openHomeStatusListeners = new Set();
  const remoteControlCalls = [];
  const remoteControlStatusListeners = new Set();
  let remoteControlStatus = { enabled: false, running: false, error: null };
  const sharingCalls = [];
  const sharingLoadRequests = [];
  let sharing = options.sharing || {
    enabled: false,
    folderIds: [],
    folders: [{ id: 'music-a', name: 'Music A' }, { id: 'music-b', name: 'Music B' }]
  };
  let openHomeStatus = {
    apiVersion: 1,
    enabled: false,
    upnpAvEnabled: false,
    rendererReady: true,
    available: true,
    state: 'stopped',
    friendlyName: 'Test PC',
    ...(options.openHomeStatus || {})
  };
  const document = createFakeDocument(options.documentOptions);
  const electronAPI = {
    remoteV1: { settings: {
      async getStatus() {
        remoteControlCalls.push(['getStatus']);
        return { ...remoteControlStatus };
      },
      async setEnabled(enabled) {
        remoteControlCalls.push(['setEnabled', enabled]);
        if (options.remoteControlSetEnabledError) throw options.remoteControlSetEnabledError;
        remoteControlStatus = { ...remoteControlStatus, enabled, running: enabled };
        for (const listener of remoteControlStatusListeners) listener({ ...remoteControlStatus });
        return { ...remoteControlStatus };
      },
      onStatus(listener) {
        remoteControlStatusListeners.add(listener);
        return () => remoteControlStatusListeners.delete(listener);
      }
    } },
    async networkMusicGetState(request) {
      sharingLoadRequests.push(request);
      if (request?.loadSharingFolders && options.sharingLoadError) throw options.sharingLoadError;
      return { sharing: { ...structuredClone(sharing), folders: request?.loadSharingFolders ? structuredClone(sharing.folders) : [] } };
    },
    async networkMusicSetSharing(request) {
      sharingCalls.push(request);
      if (options.sharingSaveError) throw options.sharingSaveError;
      sharing = { ...sharing, ...request };
      return { sharing: structuredClone(sharing) };
    },
    async loadConfig() {
      calls.push(['loadConfig']);
      if (options.loadConfigError) {
        throw options.loadConfigError;
      }
      return options.loadConfigResult ?? { success: true, config: options.config ?? {} };
    },
    async saveConfig(config) {
      calls.push(['saveConfig', { ...config }]);
      if (options.saveConfigError) {
        throw options.saveConfigError;
      }
      return options.saveConfigResult ?? { success: true };
    },
    openHomeV1: {
      async getStatus() {
        openHomeCalls.push(['getStatus']);
        if (options.openHomeGetStatusError) throw options.openHomeGetStatusError;
        return { ...openHomeStatus };
      },
      async setEnabled(enabled) {
        openHomeCalls.push(['setEnabled', enabled]);
        if (options.openHomeSetEnabledError) throw options.openHomeSetEnabledError;
        openHomeStatus = {
          ...openHomeStatus,
          enabled,
          state: enabled ? 'ready' : 'stopped'
        };
        return { ...openHomeStatus };
      },
      async setFriendlyName(friendlyName) {
        openHomeCalls.push(['setFriendlyName', friendlyName]);
        if (options.openHomeSetFriendlyNameError) throw options.openHomeSetFriendlyNameError;
        openHomeStatus = { ...openHomeStatus, friendlyName: friendlyName.trim() || 'Test PC' };
        return { ...openHomeStatus };
      },
      async setUpnpAvEnabled(enabled) {
        openHomeCalls.push(['setUpnpAvEnabled', enabled]);
        if (options.upnpAvSetEnabledError) throw options.upnpAvSetEnabledError;
        openHomeStatus = { ...openHomeStatus, upnpAvEnabled: enabled, state: enabled || openHomeStatus.enabled ? 'ready' : 'stopped' };
        return { ...openHomeStatus };
      },
      onStatus(listener) {
        openHomeCalls.push(['onStatus']);
        openHomeStatusListeners.add(listener);
        return () => {
          openHomeCalls.push(['removeStatusListener']);
          openHomeStatusListeners.delete(listener);
        };
      }
    },
    airPlayV1: {
      async getStatus() {
        airPlayCalls.push(['getStatus']);
        return { ...airPlayStatus };
      },
      async setEnabled(enabled) {
        airPlayCalls.push(['setEnabled', enabled]);
        if (options.airPlaySetEnabledError) throw options.airPlaySetEnabledError;
        airPlayStatus = { ...airPlayStatus, enabled, state: enabled ? 'ready' : 'off' };
        return { ...airPlayStatus };
      },
      onStatus(listener) {
        airPlayStatusListeners.add(listener);
        return () => airPlayStatusListeners.delete(listener);
      }
    }
  };
  const uiManager = {
    t: key => `label:${key}`,
    setOpenHomeRemoteControlEnabled(enabled) {
      openHomeRendererStates.push(enabled);
    },
    setUpnpAvRemoteControlEnabled: enabled => receptionStates.push(['upnpAv', enabled]),
    setAirPlayReceiverEnabled: enabled => receptionStates.push(['airPlay', enabled]),
    ...options.uiManager
  };
  const windowObject = {
    electronAPI,
    uiManager,
    appConfig: null,
    ...options.window
  };
  if (options.includeElectronIntegration !== false) {
    windowObject.electronIntegration = { config: null };
  }
  if (options.presets) {
    windowObject.pipelineManager = {
      presetManager: {
        async getPresets() {
          calls.push(['getPresets']);
          return options.presets;
        }
      }
    };
  }

  return {
    calls,
    document,
    openHomeCalls,
    airPlayCalls,
    airPlayStatusListeners,
    receptionStates,
    openHomeRendererStates,
    remoteControlCalls,
    remoteControlStatusListeners,
    sharingCalls,
    sharingLoadRequests,
    window: windowObject,
    emitOpenHomeStatus(status) {
      openHomeStatus = { ...openHomeStatus, ...status };
      for (const listener of openHomeStatusListeners) listener({ ...openHomeStatus });
    },
    emitRemoteControlStatus(status) {
      remoteControlStatus = { ...remoteControlStatus, ...status };
      for (const listener of remoteControlStatusListeners) listener({ ...remoteControlStatus });
    },
    emitAirPlayStatus(status) {
      airPlayStatus = { ...airPlayStatus, ...status };
      for (const listener of airPlayStatusListeners) listener({ ...airPlayStatus });
    }
  };
}

test('Browser Config saves only the User-Agent patch, restores failed edits and reopens the saved value', async () => {
  const errors = [];
  const harness = createConfigHarness({ uiManager: { setError: message => errors.push(message) } });
  const calls = [];
  let rejectSave = false;
  const defaultUserAgent = 'Chrome/152.0.0.0 EffeTune/2.15.0';
  let settings = { bookmarks: [{ name: 'Music', url: 'https://example.com/' }], startPage: '', userAgent: '', openTabsExternally: true };
  harness.window.electronAPI.browser = {
    async getState() { return { ok: true, settings, defaultUserAgent }; },
    async saveSettings(patch) {
      calls.push(patch);
      if (rejectSave) return { ok: false, error: 'saveFailed' };
      if (patch.startPage === 'javascript:alert(1)') return { ok: false, error: 'invalidURL' };
      settings = { ...settings, ...patch };
      if ('userAgent' in patch) settings.userAgent = patch.userAgent.trim();
      harness.window.electronAPI.loadConfig = async () => ({ success: true, config: { browser: settings } });
      return { ok: true, settings };
    }
  };
  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    await harness.document.getElementById('config-category-browser').dispatchEvent('click');
    const input = harness.document.getElementById('browser-user-agent');
    const tabs = harness.document.getElementById('browser-open-tabs-externally');
    const startPage = harness.document.getElementById('browser-start-page');
    assert.equal(input.value, defaultUserAgent);
    assert.equal(tabs.checked, true);
    assert.equal(startPage.value, '');
    assert.equal(harness.document.getElementById('browser-user-agent-label').textContent, 'label:dialog.config.browser.userAgent');
    input.value = 'Custom Browser/1.0';
    await input.dispatchEvent('change');
    assert.deepEqual(calls, [{ userAgent: 'Custom Browser/1.0' }]);
    assert.equal(harness.window.appConfig.browser.userAgent, 'Custom Browser/1.0');
    assert.equal(harness.window.appConfig.browser.bookmarks.length, 1);
    tabs.checked = false;
    await tabs.dispatchEvent('change');
    assert.deepEqual(calls.at(-1), { openTabsExternally: false });
    assert.equal(harness.window.appConfig.browser.openTabsExternally, false);
    assert.equal(input.value, 'Custom Browser/1.0');
    startPage.value = 'https://example.com/start';
    await startPage.dispatchEvent('change');
    assert.deepEqual(calls.at(-1), { startPage: 'https://example.com/start' });
    startPage.value = 'javascript:alert(1)';
    await startPage.dispatchEvent('change');
    assert.equal(startPage.value, 'https://example.com/start');
    assert.equal(errors.pop(), 'label:dialog.config.browser.invalidStartPage');
    await harness.document.getElementById('browser-reset-start-page').dispatchEvent('click');
    assert.deepEqual(calls.at(-1), { startPage: '' });
    assert.equal(startPage.value, '');
    assert.equal(harness.window.appConfig.browser.startPage, '');
    rejectSave = true;
    input.value = 'Rejected Browser';
    await withMutedConsole('error', () => input.dispatchEvent('change'));
    assert.equal(input.value, 'Custom Browser/1.0');
    assert.equal(input.disabled, false);
    assert.deepEqual(errors, ['label:dialog.config.browser.saveFailed']);
    await harness.document.getElementById('close-btn').dispatchEvent('click');
    await showConfigDialog(true, {});
    assert.equal(harness.document.getElementById('browser-user-agent').value, 'Custom Browser/1.0');
    rejectSave = false;
    harness.document.getElementById('browser-user-agent').value = '';
    await harness.document.getElementById('browser-user-agent').dispatchEvent('change');
    assert.equal(harness.document.getElementById('browser-user-agent').value, defaultUserAgent);
    assert.equal(settings.userAgent, '');
    const restoredInput = harness.document.getElementById('browser-user-agent');
    restoredInput.value = 'Another custom browser';
    await restoredInput.dispatchEvent('change');
    await harness.document.getElementById('browser-reset-user-agent').dispatchEvent('click');
    assert.equal(restoredInput.value, defaultUserAgent);
    assert.deepEqual(calls.at(-1), { userAgent: '' });
    assert.equal(settings.openTabsExternally, false);
    await harness.document.getElementById('close-btn').dispatchEvent('click');
  });
});

function createLocalStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    snapshot() {
      return Object.fromEntries(values);
    }
  };
}

function createPowerSettingsAudioManager(initialSettings, calls, options = {}) {
  let settings = { ...initialSettings };
  return {
    async updatePowerSettings(partialPowerSaving) {
      calls.push(['updatePowerSettings', { ...partialPowerSaving }]);
      if (options.error) throw options.error;
      settings = { ...settings, ...partialPowerSaving };
      return { ...settings };
    }
  };
}

async function withWebConfigRuntime({
  windowObject,
  document = null,
  localStorage,
  writerInstanceId = 'config-test-writer'
}, callback) {
  windowObject.localStorage = localStorage;
  const store = new PowerConfigStore({
    indexedDB: null,
    backend: new SerializedMemoryPowerConfigBackend(),
    writerInstanceId
  });
  const runtime = new WebAppConfigRuntime({
    store,
    storage: localStorage,
    windowRef: windowObject
  });
  setWebAppConfigRuntimeForTests(runtime);
  try {
    return await withGlobals(
      document ? { window: windowObject, document } : { window: windowObject },
      () => callback(runtime)
    );
  } finally {
    resetWebAppConfigRuntimeForTests();
    await runtime.close();
  }
}

test('loadConfig returns web settings outside Electron and empty objects on failed reads', async () => {
  assert.deepEqual(await loadConfig(false), {
    offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS,
    powerSaving: {
      mode: 'balanced',
      silenceThresholdDb: -80,
      fullSuspendDelaySeconds: 300,
      skipDisplayDspWhenHidden: true
    }
  });

  const localStorage = createLocalStorage({
    effetune_app_config: JSON.stringify({ language: 'ja', pipelineStartup: 'last' })
  });
  await withWebConfigRuntime({ windowObject: {}, localStorage }, async () => {
    assert.deepEqual(await loadConfig(false), {
      language: 'ja',
      pipelineStartup: 'last',
      offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS,
      powerSaving: {
        mode: 'balanced',
        silenceThresholdDb: -80,
        fullSuspendDelaySeconds: 300,
        skipDisplayDspWhenHidden: true
      }
    });
  });

  const missingConfig = createConfigHarness({ loadConfigResult: { success: true } });
  await withGlobals({ window: missingConfig.window }, async () => {
    assert.deepEqual(await loadConfig(true), {
      offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS
    });
  });

  const failed = createConfigHarness({ loadConfigResult: { success: false, config: { ignored: true } } });
  await withGlobals({ window: failed.window }, async () => {
    assert.deepEqual(await loadConfig(true), {});
  });

  const thrown = createConfigHarness({ loadConfigError: new Error('read failed') });
  await withGlobals({ window: thrown.window }, async () => {
    await withMutedConsole('error', async () => {
      assert.deepEqual(await loadConfig(true), {});
    });
  });
});

test('loadConfig returns loaded config and saveConfig persists in Electron or localStorage', async () => {
  const harness = createConfigHarness({ config: { language: 'ja' } });
  const localStorage = createLocalStorage({
    effetune_app_config: JSON.stringify({ language: 'en', pipelineStartup: 'last' })
  });

  await withGlobals({ window: harness.window }, async () => {
    assert.deepEqual(await loadConfig(true), {
      language: 'ja',
      offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS
    });
    await saveConfig(true, { autoLaunch: true });
  });
  await withWebConfigRuntime({ windowObject: {}, localStorage }, async () => {
    assert.equal(await saveConfig(false, { pipelineStartup: 'default' }), true);
  });

  assert.deepEqual(harness.calls, [
    ['loadConfig'],
    ['saveConfig', {
      language: 'ja',
      offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS,
      autoLaunch: true
    }]
  ]);
  assert.deepEqual(JSON.parse(localStorage.snapshot().effetune_app_config), {
    language: 'en',
    pipelineStartup: 'default',
    offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS,
    powerSaving: {
      mode: 'balanced',
      silenceThresholdDb: -80,
      fullSuspendDelaySeconds: 300,
      skipDisplayDspWhenHidden: true
    }
  });
});

test('web power-saving storage preserves a complete nested object while generic saves stay shallow', async () => {
  const localStorage = createLocalStorage({
    effetune_app_config: JSON.stringify({
      language: 'ja',
      powerSaving: {
        mode: 'balanced',
        silenceThresholdDb: -90,
        fullSuspendDelaySeconds: 900,
        skipDisplayDspWhenHidden: true
      }
    })
  });

  await withWebConfigRuntime({ windowObject: {}, localStorage }, async () => {
    assert.deepEqual(await saveWebPowerSavingSettings({ mode: 'maximum' }), {
      mode: 'maximum',
      silenceThresholdDb: -90,
      fullSuspendDelaySeconds: 900,
      skipDisplayDspWhenHidden: true
    });
    assert.deepEqual(await loadWebAppConfig(), {
      language: 'ja',
      offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS,
      powerSaving: {
        mode: 'maximum',
        silenceThresholdDb: -90,
        fullSuspendDelaySeconds: 900,
        skipDisplayDspWhenHidden: true
      }
    });

    assert.deepEqual(await saveWebPowerSavingSettings({ fullSuspendDelaySeconds: 'never' }), {
      mode: 'maximum',
      silenceThresholdDb: -90,
      fullSuspendDelaySeconds: 'never',
      skipDisplayDspWhenHidden: true
    });
    assert.deepEqual((await loadWebAppConfig()).powerSaving, {
      mode: 'maximum',
      silenceThresholdDb: -90,
      fullSuspendDelaySeconds: 'never',
      skipDisplayDspWhenHidden: true
    });

    const beforeInvalidUpdate = localStorage.snapshot().effetune_app_config;
    assert.equal(await saveWebPowerSavingSettings(null), false);
    assert.equal(await saveWebPowerSavingSettings([]), false);
    assert.equal(localStorage.snapshot().effetune_app_config, beforeInvalidUpdate);

    assert.equal(await saveWebAppConfig({ powerSaving: { mode: 'continuous' } }), true);
    assert.deepEqual(await loadWebAppConfig(), {
      language: 'ja',
      offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS,
      powerSaving: {
        mode: 'continuous',
        silenceThresholdDb: -80,
        fullSuspendDelaySeconds: 300,
        skipDisplayDspWhenHidden: true
      }
    });
  });
});

test('saveConfig logs and recovers from Electron save failures', async () => {
  const harness = createConfigHarness({ saveConfigError: new Error('write failed') });

  await withGlobals({ window: harness.window }, async () => {
    await withMutedConsole('error', async () => {
      await saveConfig(true, { startMinimized: true });
    });
  });

  assert.deepEqual(harness.calls, [
    ['saveConfig', { startMinimized: true }]
  ]);
});

test('saveConfig treats an Electron success false result as a failure', async () => {
  const harness = createConfigHarness({
    saveConfigResult: { success: false, error: 'disk full' }
  });

  await withGlobals({ window: harness.window }, async () => {
    await withMutedConsole('error', async () => {
      assert.equal(await saveConfig(true, { startMinimized: true }), false);
    });
  });
});

test('saveConfig publishes a durable Electron save that reports a non-fatal side-effect warning', async () => {
  const harness = createConfigHarness({
    config: { autoLaunch: false },
    saveConfigResult: {
      success: true,
      warning: 'Failed to update the auto-launch setting: denied'
    }
  });
  const warnings = [];
  await withGlobals({
    window: harness.window,
    console: createConsoleHarness({
      warn: (...args) => warnings.push(args)
    })
  }, async () => {
      await loadConfig(true);
      assert.equal(await saveConfig(true, { autoLaunch: true }), true);
  });

  assert.deepEqual(harness.window.appConfig, {
    autoLaunch: true,
    offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS
  });
  assert.deepEqual(harness.window.electronIntegration.config, harness.window.appConfig);
  assert.deepEqual(warnings, [[
    'Config was saved with a non-fatal side-effect failure:',
    'Failed to update the auto-launch setting: denied'
  ]]);
});

test('concurrent Electron config patches serialize and merge with the latest committed config', async () => {
  const harness = createConfigHarness({
    config: { language: 'en', autoLaunch: true }
  });
  harness.window.appConfig = { language: 'en', autoLaunch: true };
  harness.window.electronIntegration.config = { language: 'en', autoLaunch: true };
  let releaseFirstSave;
  let markFirstSaveStarted;
  const firstSaveStarted = new Promise(resolve => { markFirstSaveStarted = resolve; });
  const firstSaveGate = new Promise(resolve => { releaseFirstSave = resolve; });
  let saveCount = 0;
  harness.window.electronAPI.saveConfig = async config => {
    harness.calls.push(['saveConfig', { ...config }]);
    saveCount++;
    if (saveCount === 1) {
      markFirstSaveStarted();
      await firstSaveGate;
    }
    return { success: true };
  };

  await withGlobals({ window: harness.window }, async () => {
    await loadConfig(true);
    const first = saveConfig(true, { autoLaunch: false });
    await firstSaveStarted;
    const second = saveConfig(true, { language: 'ja' });
    await Promise.resolve();
    assert.equal(harness.calls.filter(call => call[0] === 'saveConfig').length, 1);

    releaseFirstSave();
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
  });

  assert.deepEqual(harness.calls.filter(call => call[0] === 'saveConfig'), [
    ['saveConfig', {
      language: 'en',
      autoLaunch: false,
      offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS
    }],
    ['saveConfig', {
      language: 'ja',
      autoLaunch: false,
      offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS
    }]
  ]);
  assert.deepEqual(harness.window.appConfig, {
    language: 'ja',
    autoLaunch: false,
    offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS
  });
  assert.deepEqual(harness.window.electronIntegration.config, harness.window.appConfig);
});

test('a failed queued Electron config patch is not published or merged into its successor', async () => {
  const harness = createConfigHarness({
    config: { language: 'en', autoLaunch: true }
  });
  harness.window.appConfig = { language: 'en', autoLaunch: true };
  harness.window.electronIntegration.config = { language: 'en', autoLaunch: true };
  let saveCount = 0;
  harness.window.electronAPI.saveConfig = async config => {
    harness.calls.push(['saveConfig', { ...config }]);
    saveCount++;
    return saveCount === 1
      ? { success: false, error: 'disk full' }
      : { success: true };
  };

  await withGlobals({ window: harness.window }, async () => {
    await loadConfig(true);
    await withMutedConsole('error', async () => {
      assert.deepEqual(await Promise.all([
        saveConfig(true, { autoLaunch: false }),
        saveConfig(true, { language: 'ja' })
      ]), [false, true]);
    });
  });

  assert.deepEqual(harness.calls.filter(call => call[0] === 'saveConfig'), [
    ['saveConfig', {
      language: 'en',
      autoLaunch: false,
      offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS
    }],
    ['saveConfig', {
      language: 'ja',
      autoLaunch: true,
      offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS
    }]
  ]);
  assert.deepEqual(harness.window.appConfig, {
    language: 'ja',
    autoLaunch: true,
    offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS
  });
  assert.deepEqual(harness.window.electronIntegration.config, harness.window.appConfig);
});

test('Electron power saving rolls back and reports a failed config save', async () => {
  const initialPowerSaving = {
    mode: 'balanced',
    silenceThresholdDb: -80,
    fullSuspendDelaySeconds: 300,
    skipDisplayDspWhenHidden: true
  };
  const powerCalls = [];
  const errors = [];
  const harness = createConfigHarness({
    config: { powerSaving: initialPowerSaving },
    saveConfigResult: { success: false, error: 'disk full' },
    uiManager: {
      setError(message, isError) {
        errors.push([message, isError]);
      }
    },
    window: {
      audioManager: createPowerSettingsAudioManager(initialPowerSaving, powerCalls)
    }
  });
  harness.window.appConfig = { powerSaving: { ...initialPowerSaving } };
  harness.window.electronIntegration.config = { powerSaving: { ...initialPowerSaving } };
  let currentPowerSaving = { ...initialPowerSaving };
  harness.window.audioManager = {
    async updatePowerSettings(partialPowerSaving) {
      powerCalls.push(['updatePowerSettings', { ...partialPowerSaving }]);
      currentPowerSaving = { ...currentPowerSaving, ...partialPowerSaving };
      harness.window.appConfig = {
        ...(harness.window.appConfig || {}),
        powerSaving: { ...currentPowerSaving }
      };
      if (partialPowerSaving.mode === 'maximum') {
        harness.window.electronIntegration.config = {
          ...(harness.window.electronIntegration.config || {}),
          powerSaving: { ...currentPowerSaving }
        };
      }
      return { ...currentPowerSaving };
    }
  };

  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const maximum = harness.document.getElementById('power-mode-maximum');
    maximum.checked = true;
    await withMutedConsole('error', () => maximum.dispatchEvent('change'));

    assert.deepEqual(powerCalls, [
      ['updatePowerSettings', { mode: 'maximum' }],
      ['updatePowerSettings', initialPowerSaving]
    ]);
    assert.equal(harness.document.getElementById('power-mode-balanced').checked, true);
    assert.equal(maximum.checked, false);
    assert.deepEqual(harness.window.appConfig.powerSaving, initialPowerSaving);
    assert.deepEqual(harness.window.electronIntegration.config.powerSaving, initialPowerSaving);
    assert.deepEqual(errors, [['Failed to save settings.', true]]);
  });
});

test('Electron power rollback preserves previous settings when readback fails', async () => {
  const initialPowerSaving = {
    mode: 'maximum',
    silenceThresholdDb: -90,
    fullSuspendDelaySeconds: 'never',
    skipDisplayDspWhenHidden: true
  };
  const powerCalls = [];
  const harness = createConfigHarness({
    config: { language: 'en', powerSaving: initialPowerSaving },
    saveConfigResult: { success: false, error: 'disk full' }
  });
  let loadCount = 0;
  harness.window.electronAPI.loadConfig = async () => {
    harness.calls.push(['loadConfig']);
    loadCount++;
    return loadCount === 1
      ? { success: true, config: { language: 'en', powerSaving: initialPowerSaving } }
      : { success: false, error: 'read failed' };
  };
  harness.window.appConfig = { language: 'en', powerSaving: { ...initialPowerSaving } };
  harness.window.electronIntegration.config = {
    language: 'en',
    powerSaving: { ...initialPowerSaving }
  };
  let currentPowerSaving = { ...initialPowerSaving };
  harness.window.audioManager = {
    async updatePowerSettings(partialPowerSaving) {
      powerCalls.push(['updatePowerSettings', { ...partialPowerSaving }]);
      currentPowerSaving = { ...currentPowerSaving, ...partialPowerSaving };
      harness.window.appConfig = {
        ...(harness.window.appConfig || {}),
        powerSaving: { ...currentPowerSaving }
      };
      return { ...currentPowerSaving };
    }
  };

  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const continuous = harness.document.getElementById('power-mode-continuous');
    continuous.checked = true;
    await withMutedConsole('error', () => continuous.dispatchEvent('change'));
  });

  assert.deepEqual(powerCalls, [
    ['updatePowerSettings', { mode: 'continuous' }],
    ['updatePowerSettings', initialPowerSaving]
  ]);
  assert.deepEqual(harness.window.appConfig, {
    language: 'en',
    powerSaving: initialPowerSaving,
    offlineOutput: {
      format: 'wav',
      sampleRate: 96000,
      wavSampleFormat: 'pcm24',
      flacSampleFormat: 'pcm24'
    }
  });
  assert.deepEqual(harness.window.electronIntegration.config, harness.window.appConfig);
});

test('ordinary Electron settings publish only after persistence and restore failed controls', async () => {
  const errors = [];
  const languageCalls = [];
  const harness = createConfigHarness({
    config: {
      language: 'en',
      autoLaunch: true,
      startupView: 'effects',
      pipelineStartup: 'last'
    },
    saveConfigResult: { success: false, error: 'disk full' },
    uiManager: {
      setError(message, isError) {
        errors.push([message, isError]);
      },
      async setLanguagePreference(language, options) {
        languageCalls.push([language, options]);
      }
    }
  });
  harness.window.appConfig = { language: 'en', autoLaunch: true };
  harness.window.electronIntegration.config = { language: 'en', autoLaunch: true };

  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});

    const autoLaunch = harness.document.getElementById('auto-launch');
    autoLaunch.checked = false;
    await withMutedConsole('error', () => autoLaunch.dispatchEvent('change'));
    assert.equal(autoLaunch.checked, true);

    const language = harness.document.getElementById('language-select');
    language.value = 'ja';
    await withMutedConsole('error', () => language.dispatchEvent('change'));
    assert.equal(language.value, 'en');
  });

  const saves = harness.calls.filter(call => call[0] === 'saveConfig');
  assert.equal(saves.length, 2);
  assert.equal(saves[1][1].autoLaunch, true);
  assert.equal(saves[1][1].language, 'ja');
  assert.deepEqual(languageCalls, []);
  assert.deepEqual(harness.window.appConfig, { language: 'en', autoLaunch: true });
  assert.deepEqual(harness.window.electronIntegration.config, {
    language: 'en',
    autoLaunch: true
  });
  assert.deepEqual(errors, [
    ['Failed to save settings.', true],
    ['Failed to save settings.', true]
  ]);
});

test('a later Electron save resynchronizes controls after an earlier queued save fails', async () => {
  const harness = createConfigHarness({
    config: {
      language: 'en',
      autoLaunch: true,
      startMinimized: false,
      pipelineStartup: 'last'
    }
  });
  let releaseFirstSave;
  let markFirstSaveStarted;
  const firstSaveStarted = new Promise(resolve => { markFirstSaveStarted = resolve; });
  const firstSaveGate = new Promise(resolve => { releaseFirstSave = resolve; });
  let saveCount = 0;
  harness.window.electronAPI.saveConfig = async nextConfig => {
    harness.calls.push(['saveConfig', { ...nextConfig }]);
    saveCount++;
    if (saveCount === 1) {
      markFirstSaveStarted();
      await firstSaveGate;
      return { success: false, error: 'temporary write failure' };
    }
    return { success: true };
  };

  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const autoLaunch = harness.document.getElementById('auto-launch');
    const startMinimized = harness.document.getElementById('start-min');
    autoLaunch.checked = false;
    const first = autoLaunch.dispatchEvent('change');
    await firstSaveStarted;
    startMinimized.checked = true;
    const second = startMinimized.dispatchEvent('change');
    releaseFirstSave();
    await withMutedConsole('error', () => Promise.all([first, second]));

    assert.equal(autoLaunch.checked, true);
    assert.equal(startMinimized.checked, true);
  });
  assert.deepEqual(harness.window.appConfig, {
    language: 'en',
    autoLaunch: true,
    startMinimized: true,
    pipelineStartup: 'last',
    offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS
  });
});

test('a later Web save resynchronizes controls after a temporary localStorage failure', async () => {
  const values = new Map([[
    'effetune_app_config',
    JSON.stringify({
      language: 'en',
      startupView: 'effects',
      pipelineStartup: 'last'
    })
  ]]);
  let writeCount = 0;
  const storage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (key === 'effetune_app_config') writeCount++;
      if (key === 'effetune_app_config' && writeCount === 2) throw new Error('temporary quota failure');
      values.set(key, String(value));
    }
  };
  const harness = createConfigHarness();
  const runtime = new WebAppConfigRuntime({
    store: {
      async readCurrentConfig() {
        throw new Error('IndexedDB unavailable');
      },
      async updateConfig() {
        throw new Error('IndexedDB unavailable');
      },
      async close() {}
    },
    storage,
    windowRef: harness.window
  });
  harness.window.localStorage = storage;
  setWebAppConfigRuntimeForTests(runtime);
  try {
    await withGlobals({ window: harness.window, document: harness.document }, async () => {
      await withMutedConsole('warn', async () => {
        await showConfigDialog(false, {});
        const pipelineDefault = harness.document.getElementById('pl-default');
        const pipelineLast = harness.document.getElementById('pl-last');
        const startupLibrary = harness.document.getElementById('startup-view-library');
        pipelineDefault.checked = true;
        const first = pipelineDefault.dispatchEvent('change');
        startupLibrary.checked = true;
        const second = startupLibrary.dispatchEvent('change');
        await withMutedConsole('error', () => Promise.all([first, second]));

        assert.equal(pipelineDefault.checked, false);
        assert.equal(pipelineLast.checked, true);
        assert.equal(startupLibrary.checked, true);
      });
    });
  } finally {
    resetWebAppConfigRuntimeForTests();
    await runtime.close();
  }
  assert.equal(JSON.parse(values.get('effetune_app_config')).pipelineStartup, 'last');
  assert.equal(JSON.parse(values.get('effetune_app_config')).startupView, 'library');
});

test('Web config controls report a localStorage fallback write failure', async () => {
  const errors = [];
  const harness = createConfigHarness({
    uiManager: {
      setError(message, isError) {
        errors.push([message, isError]);
      }
    }
  });
  harness.window.localStorage = {
    getItem() {
      throw new Error('read denied');
    },
    setItem() {
      throw new Error('quota exceeded');
    }
  };
  setWebAppConfigRuntimeForTests(null);
  try {
    await withGlobals({ window: harness.window, document: harness.document }, async () => {
      await withMutedConsole('warn', async () => {
        await showConfigDialog(false, {});
        await harness.document.getElementById('pl-default').dispatchEvent('change');
      });
    });
  } finally {
    resetWebAppConfigRuntimeForTests();
  }

  assert.deepEqual(errors, [['Failed to save settings.', true]]);
});

test('showConfigDialog opens in Web and hides Electron-only settings', async () => {
  const visualSyncCalls = [];
  const harness = createConfigHarness({
    config: { language: 'en', pipelineStartup: 'last' },
    presets: { WebPreset: {} },
    window: {
      audioManager: {
        async setVisualSyncEnabled(enabled) {
          visualSyncCalls.push(enabled);
          return true;
        }
      }
    }
  });
  const localStorage = createLocalStorage({
    effetune_app_config: JSON.stringify({
      language: 'ja',
      startupView: 'library',
      libraryStartupView: 'artists',
      pipelineStartup: 'preset',
      startupPreset: 'WebPreset',
      visualSync: true
    })
  });

  await withWebConfigRuntime({
    windowObject: harness.window,
    document: harness.document,
    localStorage
  }, async () => {
    await showConfigDialog(false, { autoLaunch: true });
    assert.equal(harness.document.body.children.length, 1);
    assert.equal(harness.document.getElementById('auto-launch'), null);
    assert.equal(harness.document.getElementById('start-min'), null);
    assert.equal(harness.document.getElementById('tray'), null);
    assert.equal(harness.document.getElementById('check-updates'), null);
    assert.equal(harness.document.getElementById('hardware-acceleration'), null);
    assert.notEqual(harness.document.getElementById('power-saving-section'), null);
    assert.equal(harness.document.getElementById('power-mode-balanced').checked, true);
    assert.equal(harness.document.getElementById('power-silence-threshold').value, '-80');
    assert.equal(harness.document.getElementById('power-full-suspend-delay').value, '300');
    assert.equal(harness.document.getElementById('language-select').value, 'ja');
    const libraryIncludeVideo = harness.document.getElementById('library-include-video');
    assert.equal(libraryIncludeVideo.checked, false);
    libraryIncludeVideo.checked = true;
    await libraryIncludeVideo.dispatchEvent('change');
    assert.equal(JSON.parse(localStorage.snapshot().effetune_app_config).libraryIncludeVideo, true);
    const visualSync = harness.document.getElementById('visual-sync');
    assert.equal(visualSync.checked, true);
    visualSync.checked = false;
    await visualSync.dispatchEvent('change');
    assert.equal(JSON.parse(localStorage.snapshot().effetune_app_config).visualSync, false);
    assert.deepEqual(visualSyncCalls, [false]);
    const themeSelect = harness.document.getElementById('theme-select');
    assert.equal(themeSelect.value, 'graphite');
    themeSelect.value = 'paper';
    await themeSelect.dispatchEvent('change');
    assert.equal(JSON.parse(localStorage.snapshot().effetune_app_config).theme, 'paper');
    assert.equal(localStorage.getItem('effetune_theme'), 'paper');
    assert.equal(harness.document.getElementById('startup-view-library').checked, true);
    const initialLibraryStartupViewSelect = harness.document.getElementById('library-startup-view-select');
    assert.equal(initialLibraryStartupViewSelect.value, 'artists');
    assert.equal(initialLibraryStartupViewSelect.disabled, false);
    assert.deepEqual(initialLibraryStartupViewSelect.children.map(option => option.value), [
      'tracks', 'albums', 'artists', 'genres', 'subfolders', 'files', 'folders', 'playlists'
    ]);
    assert.equal(harness.document.getElementById('preset-select').value, 'WebPreset');

    const pipelineDefault = harness.document.getElementById('pl-default');
    await pipelineDefault.dispatchEvent('change');
    assert.equal(JSON.parse(localStorage.snapshot().effetune_app_config).pipelineStartup, 'default');

    const startupViewEffects = harness.document.getElementById('startup-view-effects');
    await startupViewEffects.dispatchEvent('change');
    assert.equal(JSON.parse(localStorage.snapshot().effetune_app_config).startupView, 'effects');
    assert.equal(harness.document.getElementById('library-startup-view-select').disabled, true);

    await harness.document.getElementById('startup-view-visualizer').dispatchEvent('change');
    assert.equal(JSON.parse(localStorage.snapshot().effetune_app_config).startupView, 'visualizer');
    assert.equal(harness.document.getElementById('startup-view-visualizer').checked, true);
    assert.equal(harness.document.getElementById('startup-view-effects').checked, false);
    assert.equal(harness.document.getElementById('library-startup-view-select').disabled, true);
    const expanded = harness.document.getElementById('visualizer-startup-expanded');
    assert.equal(expanded.disabled, false);
    assert.equal(expanded.checked, false);
    expanded.checked = true;
    await expanded.dispatchEvent('change');
    assert.equal(JSON.parse(localStorage.snapshot().effetune_app_config).visualizerStartupExpanded, true);

    await harness.document.getElementById('startup-view-library').dispatchEvent('change');
    assert.equal(expanded.disabled, true);
    assert.equal(expanded.checked, true);
    const libraryStartupViewSelect = harness.document.getElementById('library-startup-view-select');
    assert.equal(libraryStartupViewSelect.disabled, false);
    libraryStartupViewSelect.value = 'files';
    await libraryStartupViewSelect.dispatchEvent('change');
    assert.equal(JSON.parse(localStorage.snapshot().effetune_app_config).libraryStartupView, 'files');
  });
});

test('Web power-saving controls use the AudioManager facade and preserve hidden values', async () => {
  const initialPowerSaving = {
    mode: 'maximum',
    silenceThresholdDb: -90,
    fullSuspendDelaySeconds: 900,
    skipDisplayDspWhenHidden: true
  };
  const powerCalls = [];
  const localStorage = createLocalStorage({
    effetune_app_config: JSON.stringify({
      language: 'en',
      powerSaving: initialPowerSaving,
      offlineOutput: DEFAULT_OFFLINE_OUTPUT_SETTINGS
    })
  });
  const initialStoredConfig = localStorage.snapshot().effetune_app_config;
  const harness = createConfigHarness({
    window: {
      audioManager: createPowerSettingsAudioManager(initialPowerSaving, powerCalls)
    }
  });

  const windowObject = { ...harness.window };
  await withWebConfigRuntime({
    windowObject,
    document: harness.document,
    localStorage
  }, async () => {
    await showConfigDialog(false, {});

    const modeGroup = harness.document.getElementById('power-mode-group');
    const continuous = harness.document.getElementById('power-mode-continuous');
    const balanced = harness.document.getElementById('power-mode-balanced');
    const maximum = harness.document.getElementById('power-mode-maximum');
    const warning = harness.document.getElementById('power-saving-maximum-warning');
    const thresholdRow = harness.document.getElementById('power-silence-threshold-row');
    const threshold = harness.document.getElementById('power-silence-threshold');
    const delayRow = harness.document.getElementById('power-full-suspend-delay-row');
    const delay = harness.document.getElementById('power-full-suspend-delay');
    const skipDisplayDsp = harness.document.getElementById(
      'power-skip-display-dsp-when-hidden'
    );

    assert.equal(modeGroup.getAttribute('role'), 'radiogroup');
    assert.equal(modeGroup.getAttribute('aria-labelledby'), 'power-saving-title');
    assert.equal(maximum.getAttribute('aria-describedby'),
      'power-mode-maximum-help power-saving-maximum-warning');
    assert.equal(warning.getAttribute('role'), 'note');
    assert.equal(maximum.checked, true);
    assert.equal(warning.hidden, false);
    assert.equal(warning.getAttribute('aria-hidden'), 'false');
    assert.deepEqual(
      threshold.children.map(option => option.value),
      ['-90', '-80', '-70', '-60', '-50', '-40', '-30', '-20']
    );
    assert.equal(threshold.value, '-90');
    assert.equal(threshold.disabled, false);
    assert.equal(thresholdRow.hidden, false);
    assert.deepEqual(delay.children.map(option => option.value), ['60', '300', '900', 'never']);
    assert.equal(delay.value, '900');
    assert.equal(delay.disabled, false);
    assert.equal(delayRow.hidden, false);
    assert.equal(skipDisplayDsp.checked, true);
    assert.equal(
      skipDisplayDsp.getAttribute('aria-describedby'),
      'power-skip-display-dsp-when-hidden-help'
    );

    skipDisplayDsp.checked = false;
    await skipDisplayDsp.dispatchEvent('change');
    assert.deepEqual(powerCalls.at(-1), [
      'updatePowerSettings',
      { skipDisplayDspWhenHidden: false }
    ]);
    assert.equal(skipDisplayDsp.checked, false);

    continuous.checked = true;
    await continuous.dispatchEvent('change');
    assert.deepEqual(powerCalls.at(-1), ['updatePowerSettings', { mode: 'continuous' }]);
    assert.equal(continuous.checked, true);
    assert.equal(threshold.value, '-90');
    assert.equal(threshold.disabled, true);
    assert.equal(thresholdRow.hidden, true);
    assert.equal(delay.value, '900');
    assert.equal(delay.disabled, true);
    assert.equal(delayRow.hidden, true);
    assert.equal(warning.hidden, true);
    assert.equal(warning.getAttribute('aria-hidden'), 'true');

    balanced.checked = true;
    await balanced.dispatchEvent('change');
    assert.deepEqual(powerCalls.at(-1), ['updatePowerSettings', { mode: 'balanced' }]);
    assert.equal(balanced.checked, true);
    assert.equal(threshold.value, '-90');
    assert.equal(threshold.disabled, false);
    assert.equal(thresholdRow.hidden, false);
    assert.equal(delay.value, '900');
    assert.equal(delay.disabled, true);
    assert.equal(delayRow.hidden, true);
    assert.equal(warning.hidden, true);

    maximum.checked = true;
    await maximum.dispatchEvent('change');
    assert.deepEqual(powerCalls.at(-1), ['updatePowerSettings', { mode: 'maximum' }]);
    assert.equal(maximum.checked, true);
    assert.equal(threshold.value, '-90');
    assert.equal(threshold.disabled, false);
    assert.equal(delay.value, '900');
    assert.equal(delay.disabled, false);
    assert.equal(warning.hidden, false);

    threshold.value = '-70';
    await threshold.dispatchEvent('change');
    assert.deepEqual(powerCalls.at(-1), ['updatePowerSettings', { silenceThresholdDb: -70 }]);
    assert.equal(threshold.value, '-70');

    delay.value = 'never';
    await delay.dispatchEvent('change');
    assert.deepEqual(powerCalls.at(-1), [
      'updatePowerSettings',
      { fullSuspendDelaySeconds: 'never' }
    ]);
    assert.equal(delay.value, 'never');

    assert.equal(localStorage.snapshot().effetune_app_config, initialStoredConfig);
  });
});

test('Web power-saving controls normalize defaults and roll back a failed facade update', async () => {
  const powerCalls = [];
  const localStorage = createLocalStorage({
    effetune_app_config: JSON.stringify({
      powerSaving: {
        mode: 'invalid',
        silenceThresholdDb: -75,
        fullSuspendDelaySeconds: 30
      }
    })
  });
  const harness = createConfigHarness({
    window: {
      audioManager: createPowerSettingsAudioManager({
        mode: 'balanced',
        silenceThresholdDb: -80,
        fullSuspendDelaySeconds: 300
      }, powerCalls, { error: new Error('persist failed') })
    }
  });

  const windowObject = { ...harness.window };
  await withWebConfigRuntime({
    windowObject,
    document: harness.document,
    localStorage
  }, async () => {
    await showConfigDialog(false, {});
    const continuous = harness.document.getElementById('power-mode-continuous');
    const balanced = harness.document.getElementById('power-mode-balanced');
    const threshold = harness.document.getElementById('power-silence-threshold');
    const delay = harness.document.getElementById('power-full-suspend-delay');
    const skipDisplayDsp = harness.document.getElementById(
      'power-skip-display-dsp-when-hidden'
    );

    assert.equal(balanced.checked, true);
    assert.equal(threshold.value, '-80');
    assert.equal(delay.value, '300');
    assert.equal(skipDisplayDsp.checked, true);

    skipDisplayDsp.checked = false;
    await withMutedConsole('error', async () => {
      await skipDisplayDsp.dispatchEvent('change');
    });
    assert.equal(skipDisplayDsp.checked, true);

    continuous.checked = true;
    await withMutedConsole('error', async () => {
      await continuous.dispatchEvent('change');
    });

    assert.deepEqual(powerCalls, [
      ['updatePowerSettings', { skipDisplayDspWhenHidden: false }],
      ['updatePowerSettings', { mode: 'continuous' }]
    ]);
    assert.equal(balanced.checked, true);
    assert.equal(continuous.checked, false);
    assert.equal(threshold.disabled, false);
    assert.equal(delay.disabled, true);
  });
});

test('Electron power-saving controls render, apply, and persist the full nested settings', async () => {
  const initialPowerSaving = {
    mode: 'maximum',
    silenceThresholdDb: -90,
    fullSuspendDelaySeconds: 900,
    skipDisplayDspWhenHidden: true
  };
  const powerCalls = [];
  const harness = createConfigHarness({
    config: { language: 'en', powerSaving: initialPowerSaving },
    window: {
      audioManager: createPowerSettingsAudioManager(initialPowerSaving, powerCalls)
    }
  });

  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});

    assert.notEqual(harness.document.getElementById('power-saving-section'), null);
    const balanced = harness.document.getElementById('power-mode-balanced');
    const maximum = harness.document.getElementById('power-mode-maximum');
    assert.equal(maximum.checked, true);
    assert.equal(harness.document.getElementById('power-silence-threshold').value, '-90');
    assert.equal(harness.document.getElementById('power-full-suspend-delay').value, '900');
    assert.equal(
      harness.document.getElementById('power-skip-display-dsp-when-hidden').checked,
      true
    );

    balanced.checked = true;
    await balanced.dispatchEvent('change');

    assert.deepEqual(powerCalls.at(-1), ['updatePowerSettings', { mode: 'balanced' }]);
    const savedConfigs = harness.calls.filter(call => call[0] === 'saveConfig');
    assert.equal(savedConfigs.length, 1);
    // A mode-only change must persist the complete nested object so the
    // main-process shallow merge cannot drop silenceThresholdDb or
    // fullSuspendDelaySeconds.
    assert.deepEqual(savedConfigs.at(-1)[1].powerSaving, {
      mode: 'balanced',
      silenceThresholdDb: -90,
      fullSuspendDelaySeconds: 900,
      skipDisplayDspWhenHidden: true
    });
    assert.deepEqual(harness.window.appConfig.powerSaving, {
      mode: 'balanced',
      silenceThresholdDb: -90,
      fullSuspendDelaySeconds: 900,
      skipDisplayDspWhenHidden: true
    });
    assert.deepEqual(harness.window.electronIntegration.config.powerSaving, {
      mode: 'balanced',
      silenceThresholdDb: -90,
      fullSuspendDelaySeconds: 900,
      skipDisplayDspWhenHidden: true
    });
  });
});

test('offline output controls normalize dependent choices and persist one nested setting', async () => {
  const harness = createConfigHarness({
    config: {
      language: 'en',
      offlineOutput: {
        format: 'wav',
        sampleRate: 96000,
        wavSampleFormat: 'pcm16',
        flacSampleFormat: 'pcm24'
      }
    }
  });

  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const format = harness.document.getElementById('offline-output-format');
    const sampleRate = harness.document.getElementById('offline-output-sample-rate');
    const quality = harness.document.getElementById('offline-output-quality');
    const qualityRow = harness.document.getElementById('offline-output-quality-row');

    assert.equal(format.value, 'wav');
    assert.equal(sampleRate.value, '96000');
    assert.equal(quality.value, 'pcm16');

    format.value = 'flac';
    await format.dispatchEvent('change');
    assert.equal(sampleRate.value, '96000');
    assert.equal(quality.disabled, false);
    assert.equal(qualityRow.hidden, false);
    assert.equal(quality.value, 'pcm24');

    quality.value = 'pcm16';
    await quality.dispatchEvent('change');
    format.value = 'wav';
    await format.dispatchEvent('change');
    assert.equal(quality.value, 'pcm16');
    format.value = 'flac';
    await format.dispatchEvent('change');
    assert.equal(quality.value, 'pcm16');

    const saves = harness.calls.filter(call => call[0] === 'saveConfig');
    assert.deepEqual(saves.at(-1)[1].offlineOutput, {
      format: 'flac',
      sampleRate: 96000,
      wavSampleFormat: 'pcm16',
      flacSampleFormat: 'pcm16'
    });
  });
});

test('MSIX Config opens Store and startup settings without changing legacy preferences', async () => {
  const errors = [];
  const harness = createConfigHarness({
    config: { autoLaunch: true, checkForUpdatesOnStartup: false, startMinimized: true },
    uiManager: { setError: message => errors.push(message) }
  });
  const opened = [];
  harness.window.electronAPI.isMsix = true;
  harness.window.electronAPI.openExternalUrl = async uri => {
    opened.push(uri);
    return { success: opened.length <= 2 };
  };
  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    assert.equal(harness.document.getElementById('auto-launch'), null);
    assert.equal(harness.document.getElementById('check-updates'), null);
    assert.equal(harness.document.getElementById('start-min').checked, true);
    assert.equal(harness.document.getElementById('store-updates-help').textContent, 'label:dialog.store.updatesHelp');
    await harness.document.getElementById('store-startup').dispatchEvent('click');
    await harness.document.getElementById('store-updates').dispatchEvent('click');
    assert.deepEqual(opened, ['ms-settings:startupapps', 'ms-windows-store://downloadsandupdates']);
    await withMutedConsole('error', () => harness.document.getElementById('store-updates').dispatchEvent('click'));
    assert.deepEqual(errors, ['label:dialog.store.openFailed']);
    const startMin = harness.document.getElementById('start-min');
    startMin.checked = false;
    await startMin.dispatchEvent('change');
    const saved = harness.calls.filter(call => call[0] === 'saveConfig').at(-1)[1];
    assert.equal(saved.autoLaunch, true);
    assert.equal(saved.checkForUpdatesOnStartup, false);
    assert.equal(saved.startMinimized, false);
  });
});

test('showConfigDialog renders settings, saves changes, and closes from the button', async () => {
  const languageCalls = [];
  const harness = createConfigHarness({
    config: {
      autoLaunch: true,
      startMinimized: true,
      minimizeToTray: false,
      checkForUpdatesOnStartup: false,
      hardwareAcceleration: false,
      language: 'ja',
      startupView: 'library',
      libraryStartupView: 'albums',
      pipelineStartup: 'preset',
      startupPreset: ''
    },
    presets: { Zeta: {}, Alpha: {} },
    uiManager: {
      setLanguagePreference: async (language, options) => {
        languageCalls.push([language, options]);
      }
    }
  });

  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, { autoLaunch: false, language: 'en' });

    assert.equal(harness.document.body.children.length, 1);
    assert.equal(harness.document.head.children.length, 1);
    const dialogMarkup = harness.document.body.children[0].innerHTML;
    const categories = [
      'general', 'startup', 'display', 'powerSaving', 'offlineOutput', 'controllers', 'network'
    ];
    const panelOf = id => {
      const index = dialogMarkup.indexOf(`id="${id}"`);
      return categories.findLast(category => dialogMarkup.indexOf(`id="config-panel-${category}"`) < index);
    };
    assert.deepEqual(
      ['language-select', 'hardware-acceleration', 'auto-launch', 'preset-select', 'visual-sync', 'video-auto-rotate', 'visualizer-hdr',
        'power-saving-section', 'offline-output-section', 'controller-mapping-btn', 'network-device-name-section',
        'network-remote-control-section', 'openhome-section', 'library-sharing-section']
        .map(panelOf),
      ['general', 'general', 'startup', 'startup', 'display', 'display', 'display',
        'powerSaving', 'offlineOutput', 'controllers', 'network', 'network', 'network', 'network']
    );
    const displayControls = ['pipeline-column-mode', 'visual-sync', 'spectrum-overlay-quality',
      'spectrum-overlay-display', 'video-auto-rotate', 'visualizer-hdr'];
    assert.ok(displayControls.every((id, index) => index === 0 ||
      dialogMarkup.indexOf(`id="${displayControls[index - 1]}"`) < dialogMarkup.indexOf(`id="${id}"`)));
    assert.equal(
      harness.document.getElementById('config-category-controllers').textContent,
      'label:dialog.config.physicalControl'
    );
    assert.equal(harness.document.getElementById('config-category-general').getAttribute('aria-current'), 'true');
    assert.equal(harness.document.getElementById('config-panel-general').hidden, false);
    assert.equal(harness.document.getElementById('config-panel-powerSaving').hidden, true);
    await harness.document.getElementById('config-category-powerSaving').dispatchEvent('click');
    assert.equal(harness.document.getElementById('config-category-general').getAttribute('aria-current'), 'false');
    assert.equal(harness.document.getElementById('config-panel-general').hidden, true);
    assert.equal(harness.document.getElementById('config-panel-powerSaving').hidden, false);
    assert.match(harness.document.head.children[0].textContent, /body\.layout-mobile \.config-dialog-content/);
    assert.match(harness.document.head.children[0].textContent, /@media \(max-width: 700px\)/);
    assert.equal(harness.document.getElementById('config-title').textContent, 'label:dialog.config.title');
    assert.equal(harness.document.getElementById('auto-launch').checked, true);
    assert.equal(harness.document.getElementById('start-min').checked, true);
    assert.equal(harness.document.getElementById('check-updates').checked, false);
    assert.equal(harness.document.getElementById('hardware-acceleration').checked, false);
    assert.equal(harness.document.getElementById('startup-view-library').checked, true);
    assert.equal(harness.document.getElementById('library-startup-view-select').value, 'albums');
    assert.equal(harness.document.getElementById('library-startup-view-select').disabled, false);
    assert.equal(harness.document.getElementById('preset-select').value, 'Alpha');
    assert.equal(harness.document.getElementById('language-select').value, 'ja');
    assert.notEqual(harness.document.getElementById('power-saving-section'), null);
    assert.equal(
      harness.document.getElementById('physical-control-title').textContent,
      'label:dialog.config.physicalControl'
    );
    assert.equal(harness.document.getElementById('power-mode-balanced').checked, true);

    const autoLaunch = harness.document.getElementById('auto-launch');
    autoLaunch.checked = false;
    await autoLaunch.dispatchEvent('change');

    const startMinimized = harness.document.getElementById('start-min');
    startMinimized.checked = false;
    await startMinimized.dispatchEvent('change');

    const checkUpdates = harness.document.getElementById('check-updates');
    checkUpdates.checked = true;
    await checkUpdates.dispatchEvent('change');

    const hardwareAcceleration = harness.document.getElementById('hardware-acceleration');
    hardwareAcceleration.checked = true;
    await hardwareAcceleration.dispatchEvent('change');
    assert.equal(harness.window.appConfig.hardwareAcceleration, true);
    const libraryIncludeVideo = harness.document.getElementById('library-include-video');
    assert.equal(libraryIncludeVideo.checked, false);
    libraryIncludeVideo.checked = true;
    await libraryIncludeVideo.dispatchEvent('change');
    assert.equal(harness.window.appConfig.libraryIncludeVideo, true);

    const pipelineDefault = harness.document.getElementById('pl-default');
    await pipelineDefault.dispatchEvent('change');
    assert.equal(harness.document.getElementById('preset-select').disabled, true);

    const pipelinePreset = harness.document.getElementById('pl-preset');
    await pipelinePreset.dispatchEvent('change');
    assert.equal(harness.document.getElementById('preset-select').disabled, false);

    const startupViewEffects = harness.document.getElementById('startup-view-effects');
    await startupViewEffects.dispatchEvent('change');
    assert.equal(harness.document.getElementById('library-startup-view-select').disabled, true);

    const startupViewLibrary = harness.document.getElementById('startup-view-library');
    await startupViewLibrary.dispatchEvent('change');
    const libraryStartupViewSelect = harness.document.getElementById('library-startup-view-select');
    libraryStartupViewSelect.value = 'artists';
    await libraryStartupViewSelect.dispatchEvent('change');

    const presetSelect = harness.document.getElementById('preset-select');
    presetSelect.value = 'Zeta';
    await presetSelect.dispatchEvent('change');

    const languageSelect = harness.document.getElementById('language-select');
    languageSelect.value = 'xx';
    await languageSelect.dispatchEvent('change');

    assert.deepEqual(languageCalls, [['auto', { persist: false }]]);
    assert.equal(harness.window.appConfig.startupView, 'library');
    assert.equal(harness.window.appConfig.libraryStartupView, 'artists');
    assert.equal(harness.window.appConfig.startupPreset, 'Zeta');
    assert.equal(harness.window.electronIntegration.config.language, 'auto');

    harness.document.getElementById('close-btn').dispatchEvent('click');
    assert.equal(harness.document.body.children.length, 0);
    assert.equal(harness.document.head.children.length, 0);
    assert.equal(harness.document.listenerCount('keydown'), 0);
  });
});

test('showConfigDialog supports last/default startup states and Escape close', async () => {
  const lastStartup = createConfigHarness({
    config: {
      autoLaunch: false,
      startMinimized: false,
      minimizeToTray: true,
      checkForUpdatesOnStartup: true,
      pipelineStartup: 'last',
      startupPreset: 'Existing',
      language: 'en'
    },
    includeElectronIntegration: false
  });

  await withGlobals({ window: lastStartup.window, document: lastStartup.document }, async () => {
    await showConfigDialog(true, null);
    assert.equal(lastStartup.document.getElementById('pl-last').checked, true);
    assert.equal(lastStartup.document.getElementById('tray').checked, true);
    const tray = lastStartup.document.getElementById('tray');
    tray.checked = false;
    await tray.dispatchEvent('change');
    assert.equal(lastStartup.window.appConfig.minimizeToTray, false);
    lastStartup.document.dispatchEvent('keydown', {
      key: 'Enter',
      preventDefault() {
        throw new Error('Enter should not be consumed');
      }
    });
    lastStartup.document.dispatchEvent('keydown', {
      key: 'Escape',
      preventDefault() {}
    });
    assert.equal(lastStartup.document.body.children.length, 0);
  });

  const defaultStartup = createConfigHarness({
    config: {
      pipelineStartup: 'default',
      language: 'en'
    }
  });
  await withGlobals({ window: defaultStartup.window, document: defaultStartup.document }, async () => {
    await showConfigDialog(true, {});
    assert.equal(defaultStartup.document.getElementById('pl-default').checked, true);
  });

  const implicitDefaults = createConfigHarness({ config: {} });
  await withGlobals({ window: implicitDefaults.window, document: implicitDefaults.document }, async () => {
    await showConfigDialog(true, null);
    assert.equal(implicitDefaults.document.getElementById('pl-last').checked, true);
    assert.equal(implicitDefaults.document.getElementById('startup-view-effects').checked, true);
    assert.equal(implicitDefaults.document.getElementById('library-startup-view-select').value, 'tracks');
    assert.equal(implicitDefaults.document.getElementById('library-startup-view-select').disabled, true);
    assert.equal(implicitDefaults.document.getElementById('language-select').value, 'auto');
  });

  const invalidLibraryStartupView = createConfigHarness({
    config: {
      startupView: 'library',
      libraryStartupView: 'recent'
    }
  });
  await withGlobals({ window: invalidLibraryStartupView.window, document: invalidLibraryStartupView.document }, async () => {
    await showConfigDialog(true, {});
    assert.equal(invalidLibraryStartupView.document.getElementById('library-startup-view-select').value, 'tracks');
  });

  const folderLibraryStartupView = createConfigHarness({
    config: {
      startupView: 'library',
      libraryStartupView: 'folders'
    }
  });
  await withGlobals({ window: folderLibraryStartupView.window, document: folderLibraryStartupView.document }, async () => {
    await showConfigDialog(true, {});
    assert.equal(folderLibraryStartupView.document.getElementById('library-startup-view-select').value, 'folders');
  });

  const presetWithoutNames = createConfigHarness({
    config: {
      pipelineStartup: 'preset',
      startupPreset: '',
      language: 'en'
    },
    presets: {}
  });
  await withGlobals({ window: presetWithoutNames.window, document: presetWithoutNames.document }, async () => {
    await showConfigDialog(true, {});
    assert.equal(presetWithoutNames.document.getElementById('preset-select').value, '');
  });

  const presetWithExistingName = createConfigHarness({
    config: {
      pipelineStartup: 'preset',
      startupPreset: 'Named',
      language: 'en'
    },
    presets: { Named: {} }
  });
  await withGlobals({ window: presetWithExistingName.window, document: presetWithExistingName.document }, async () => {
    await showConfigDialog(true, {});
    assert.equal(presetWithExistingName.document.getElementById('preset-select').value, 'Named');
  });
});

test('showConfigDialog tolerates missing optional selects and language preference handlers', async () => {
  const harness = createConfigHarness({
    config: {
      pipelineStartup: 'default',
      language: 'fr'
    },
    documentOptions: {
      omitIds: ['language-select', 'library-startup-view-select', 'preset-select']
    }
  });

  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    assert.equal(harness.document.getElementById('language-select'), null);
    assert.equal(harness.document.getElementById('library-startup-view-select'), null);
    assert.equal(harness.document.getElementById('preset-select'), null);
  });

  const noLanguageHandler = createConfigHarness({
    config: {
      language: 'en'
    }
  });
  delete noLanguageHandler.window.uiManager.setLanguagePreference;

  await withGlobals({ window: noLanguageHandler.window, document: noLanguageHandler.document }, async () => {
    await showConfigDialog(true, {});
    const languageSelect = noLanguageHandler.document.getElementById('language-select');
    languageSelect.value = 'ja';
    await languageSelect.dispatchEvent('change');
    assert.equal(noLanguageHandler.window.appConfig.language, 'ja');
  });
});

test('OpenHome settings follow authoritative status events and remove their listener on close', async () => {
  const harness = createConfigHarness({
    config: { openHomeRemoteControl: false }
  });

  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const input = harness.document.getElementById('openhome-enabled');
    const nameInput = harness.document.getElementById('network-device-name');
    const status = harness.document.getElementById('openhome-status');
    assert.equal(input.checked, false);
    assert.equal(input.disabled, false);
    assert.equal(status.textContent, 'label:dialog.config.openHome.status.stopped');
    assert.equal(status.getAttribute('data-state'), 'stopped');
    assert.equal(nameInput.value, 'Test PC');
    assert.equal(
      harness.document.getElementById('network-device-name-label').textContent,
      'label:dialog.config.network.deviceName'
    );
    assert.equal(nameInput.title, 'label:dialog.config.network.deviceNameHelp');
    const markup = harness.document.body.children[0].innerHTML;
    assert.ok(markup.indexOf('id="network-device-name"') < markup.indexOf('id="openhome-section"'));
    assert.equal(
      harness.document.getElementById('openhome-risk').textContent,
      'label:dialog.config.openHome.risk'
    );
    assert.equal(input.getAttribute('aria-describedby'), 'openhome-risk');
    assert.equal(harness.document.getElementById('openhome-firewall'), null);

    harness.emitOpenHomeStatus({ enabled: true, state: 'ready' });
    assert.equal(input.checked, true);
    assert.equal(status.textContent, 'label:dialog.config.openHome.status.published');
    assert.equal(status.getAttribute('data-state'), 'published');
    assert.equal(harness.window.appConfig.openHomeRemoteControl, true);

    harness.emitOpenHomeStatus({ enabled: false, available: true, state: 'stopping' });
    assert.equal(input.checked, false);
    assert.equal(status.textContent, 'label:dialog.config.openHome.status.stopping');

    harness.emitOpenHomeStatus({ enabled: false, available: false, state: 'unavailable' });
    assert.equal(input.checked, false);
    assert.equal(input.disabled, true);
    assert.equal(nameInput.disabled, false);
    assert.equal(status.textContent, 'label:dialog.config.openHome.status.unavailable');
    assert.equal(status.getAttribute('data-state'), 'unavailable');

    harness.document.getElementById('close-btn').dispatchEvent('click');
  });

  assert.deepEqual(harness.openHomeCalls, [
    ['onStatus'],
    ['getStatus'],
    ['removeStatusListener']
  ]);
});

test('OpenHome setting changes use setEnabled without generic config saves', async () => {
  const harness = createConfigHarness({
    config: { language: 'en', openHomeRemoteControl: false }
  });

  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const input = harness.document.getElementById('openhome-enabled');
    input.checked = true;
    await input.dispatchEvent('change');

    assert.equal(input.checked, true);
    assert.equal(input.disabled, false);
    assert.equal(
      harness.document.getElementById('openhome-status').textContent,
      'label:dialog.config.openHome.status.published'
    );
    assert.equal(harness.window.appConfig.openHomeRemoteControl, true);
    assert.equal(harness.calls.some(call => call[0] === 'saveConfig'), false);
  });

  assert.deepEqual(harness.openHomeCalls.slice(0, 3), [
    ['onStatus'],
    ['getStatus'],
    ['setEnabled', true]
  ]);
  assert.deepEqual(harness.openHomeRendererStates, [false, true]);
});

test('UPnP AV permission is independent of OpenHome and uses its host-owned API', async () => {
  const harness = createConfigHarness();
  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const input = harness.document.getElementById('upnp-av-enabled');
    assert.equal(input.checked, false);
    input.checked = true;
    await input.dispatchEvent('change');
    assert.equal(harness.window.appConfig.upnpAvRemoteControl, true);
    assert.equal(harness.window.appConfig.openHomeRemoteControl, false);
    assert.equal(harness.document.getElementById('upnp-av-status').textContent, 'label:dialog.config.upnpAv.status.published');
    assert.equal(harness.document.getElementById('openhome-status').textContent, 'label:dialog.config.openHome.status.stopped');
    assert.ok(harness.receptionStates.some(state => state[0] === 'upnpAv' && state[1]));
    assert.equal(harness.calls.some(call => call[0] === 'saveConfig'), false);
    assert.deepEqual(harness.openHomeCalls.at(-1), ['setUpnpAvEnabled', true]);
  });
});

test('AirPlay settings show actual reception state and unsubscribe when the dialog closes', async () => {
  const harness = createConfigHarness();
  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const input = harness.document.getElementById('airplay-enabled');
    input.checked = true;
    await input.dispatchEvent('change');
    assert.equal(harness.window.appConfig.airPlayReceiver, true);
    assert.ok(harness.receptionStates.some(state => state[0] === 'airPlay' && state[1]));
    harness.emitAirPlayStatus({ enabled: true, state: 'receiving' });
    assert.equal(harness.document.getElementById('airplay-status').textContent, 'label:dialog.config.airPlay.status.receiving');
    harness.emitAirPlayStatus({ available: false, state: 'unavailable' });
    assert.equal(input.disabled, false);
    assert.equal(input.checked, true);
    harness.emitAirPlayStatus({ enabled: false, state: 'off' });
    assert.equal(input.disabled, true);
    assert.equal(harness.document.getElementById('airplay-status').textContent, 'label:dialog.config.airPlay.status.unavailable');
    assert.equal(harness.calls.some(call => call[0] === 'saveConfig'), false);
    harness.document.getElementById('close-btn').dispatchEvent('click');
    assert.equal(harness.airPlayStatusListeners.size, 0);
  });
  assert.deepEqual(harness.airPlayCalls, [['getStatus'], ['setEnabled', true]]);
});

test('receiver setting failures restore the confirmed permission and show translated feedback', async () => {
  const harness = createConfigHarness({ upnpAvSetEnabledError: new Error('private native diagnostic'),
    airPlaySetEnabledError: new Error('private helper path') });
  await withMutedConsole('error', async () => withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    for (const prefix of ['upnp-av', 'airplay']) {
      const input = harness.document.getElementById(`${prefix}-enabled`);
      input.checked = true;
      await input.dispatchEvent('change');
      assert.equal(input.checked, false);
      assert.equal(input.disabled, false);
    }
    assert.equal(harness.document.getElementById('upnp-av-status').textContent, 'label:dialog.config.openHome.status.updateFailed');
    assert.equal(harness.document.getElementById('airplay-status').textContent, 'label:dialog.config.airPlay.status.updateFailed');
  }));
});

test('Network device name saves while only library sharing is enabled and blank uses the host name', async () => {
  const harness = createConfigHarness({
    config: { language: 'en', openHomeRemoteControl: false },
    openHomeStatus: { available: false, state: 'unavailable', friendlyName: 'Existing custom name' },
    sharing: { enabled: true, folderIds: ['music'], folders: [{ id: 'music', name: 'Music' }] }
  });

  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const input = harness.document.getElementById('network-device-name');
    assert.equal(input.value, 'Existing custom name');
    assert.equal(input.disabled, false);
    assert.equal(harness.document.getElementById('openhome-enabled').checked, false);
    assert.equal(harness.document.getElementById('library-sharing-enabled').checked, true);
    harness.document.activeElement = input;
    input.value = '  Living Room  ';
    await input.dispatchEvent('change');

    assert.equal(input.value, 'Living Room');
    assert.equal(harness.window.appConfig.openHomeFriendlyName, 'Living Room');
    harness.emitOpenHomeStatus({ enabled: true, available: true, state: 'ready' });
    harness.emitOpenHomeStatus({ enabled: false, state: 'stopped' });
    assert.equal(input.value, 'Living Room');
    input.value = '';
    await input.dispatchEvent('change');
    assert.equal(input.value, 'Test PC');
    assert.equal(harness.window.appConfig.openHomeFriendlyName, 'Test PC');
    assert.equal(harness.calls.some(call => call[0] === 'saveConfig'), false);
    assert.deepEqual(harness.sharingCalls, []);
  });

  assert.deepEqual(harness.openHomeCalls.slice(0, 4), [
    ['onStatus'],
    ['getStatus'],
    ['setFriendlyName', '  Living Room  '],
    ['setFriendlyName', '']
  ]);
});

test('Network device name failure restores the saved name and reports a separate settings error', async () => {
  const errors = [];
  const harness = createConfigHarness({
    config: { openHomeRemoteControl: false },
    openHomeSetFriendlyNameError: new Error('internal network detail'),
    uiManager: { setError: (...args) => errors.push(args) }
  });
  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const input = harness.document.getElementById('network-device-name');
    harness.document.activeElement = input;
    input.value = 'Unsaved name';
    await withMutedConsole('error', () => input.dispatchEvent('change'));
    assert.equal(input.value, 'Test PC');
    assert.equal(input.disabled, false);
    assert.deepEqual(errors, [['label:dialog.config.network.deviceNameSaveFailed', true]]);
    assert.equal(harness.document.getElementById('openhome-status').textContent,
      'label:dialog.config.openHome.status.stopped');
    assert.equal(harness.calls.some(call => call[0] === 'saveConfig'), false);
  });
  assert.deepEqual(harness.openHomeCalls.slice(0, 4), [
    ['onStatus'], ['getStatus'], ['setFriendlyName', 'Unsaved name'], ['getStatus']
  ]);
});

test('OpenHome setting failures roll back from getStatus and show a general-user error', async () => {
  const harness = createConfigHarness({
    config: { openHomeRemoteControl: false },
    openHomeSetEnabledError: new Error('internal sidecar detail')
  });

  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const input = harness.document.getElementById('openhome-enabled');
    input.checked = true;
    await withMutedConsole('error', () => input.dispatchEvent('change'));

    assert.equal(input.checked, false);
    assert.equal(input.disabled, false);
    assert.equal(
      harness.document.getElementById('openhome-status').textContent,
      'label:dialog.config.openHome.status.updateFailed'
    );
    assert.equal(
      harness.document.getElementById('openhome-status').textContent.includes('sidecar'),
      false
    );
    assert.equal(harness.window.appConfig, null);
  });

  assert.deepEqual(harness.openHomeCalls.slice(0, 4), [
    ['onStatus'],
    ['getStatus'],
    ['setEnabled', true],
    ['getStatus']
  ]);
});

test('all locales label Store updates and Windows startup actions', () => {
  for (const locale of ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh']) {
    const source = readFileSync(new URL(`../../js/locales/${locale}.json5`, import.meta.url), 'utf8');
    for (const key of ['startupHelp', 'openStartup', 'updatesHelp', 'openUpdates', 'openFailed']) {
      assert.ok(source.includes(`"dialog.store.${key}":`), `${locale}: ${key}`);
    }
  }
});

test('all locales include the Web power-saving settings copy', () => {
  const locales = ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh'];
  const keys = [
    'dialog.config.powerSaving.title',
    'dialog.config.powerSaving.mode.continuous',
    'dialog.config.powerSaving.mode.continuousHelp',
    'dialog.config.powerSaving.mode.balanced',
    'dialog.config.powerSaving.mode.balancedHelp',
    'dialog.config.powerSaving.mode.maximum',
    'dialog.config.powerSaving.mode.maximumHelp',
    'dialog.config.powerSaving.maximumWarning',
    'dialog.config.powerSaving.resume',
    'dialog.config.powerSaving.resumeInput',
    'dialog.config.powerSaving.advanced',
    'dialog.config.powerSaving.silenceThreshold',
    'dialog.config.powerSaving.fullSuspendDelay',
    'dialog.config.powerSaving.skipDisplayDspWhenHidden',
    'dialog.config.powerSaving.skipDisplayDspWhenHiddenHelp',
    'dialog.config.powerSaving.delay.1m',
    'dialog.config.powerSaving.delay.5m',
    'dialog.config.powerSaving.delay.15m',
    'dialog.config.powerSaving.delay.never'
  ];

  for (const locale of locales) {
    const source = readFileSync(new URL(`../../js/locales/${locale}.json5`, import.meta.url), 'utf8');
    for (const key of keys) {
      assert.equal(source.includes(`"${key}":`), true, `${locale} is missing ${key}`);
    }
  }

  const english = readFileSync(new URL('../../js/locales/en.json5', import.meta.url), 'utf8');
  assert.equal(english.includes(
    'With Maximum, EffeTune stops audio input after it remains silent in the background or unused in Player mode for the selected delay. Player playback may continue. The input will not restart when an external signal returns. Open the app and choose Resume audio processing.'
  ), true);
  const japanese = readFileSync(new URL('../../js/locales/ja.json5', import.meta.url), 'utf8');
  assert.equal(japanese.includes(
    '最大省電力では、バックグラウンドの無音またはPlayerモードで音声入力が未使用の状態が設定時間続くと、EffeTuneは音声入力を停止します。Playerの再生は継続する場合があります。外部入力の信号が戻っても入力は自動再開されません。アプリを開いて「音声処理を再開」を選んでください。'
  ), true);
});

test('frequency preview sound defaults to sine and persists across dialog openings', async () => {
  const harness = createConfigHarness();
  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const select = harness.document.getElementById('frequency-preview-sound');
    assert.equal(select.value, 'sine');
    assert.deepEqual(select.children.map(option => option.value), ['sine', 'bandpassNoise']);
    assert.equal(harness.document.getElementById('frequency-preview-sound-label').textContent,
      'label:dialog.config.frequencyPreview.sound');
    select.value = 'bandpassNoise';
    await select.dispatchEvent('change');
    assert.equal(harness.window.appConfig.frequencyPreviewSound, 'bandpassNoise');
    assert.equal(harness.calls.filter(call => call[0] === 'saveConfig').at(-1)[1].frequencyPreviewSound,
      'bandpassNoise');
    await harness.document.getElementById('close-btn').dispatchEvent('click');
    const saved = harness.window.appConfig;
    harness.window.electronAPI.loadConfig = async () => ({ success: true, config: saved });
    await showConfigDialog(true, saved);
    assert.equal(harness.document.getElementById('frequency-preview-sound').value, 'bandpassNoise');
  });
});

test('frequency preview sound rolls back when saving fails', async () => {
  const errors = [];
  const harness = createConfigHarness({
    config: { frequencyPreviewSound: 'bandpassNoise' },
    saveConfigResult: { success: false },
    uiManager: { setError: message => errors.push(message) }
  });
  await withGlobals({ window: harness.window, document: harness.document,
    console: createConsoleHarness({ error() {} }) }, async () => {
    await showConfigDialog(true, {});
    const select = harness.document.getElementById('frequency-preview-sound');
    select.value = 'sine';
    await select.dispatchEvent('change');
    assert.equal(select.value, 'bandpassNoise');
    assert.equal(errors.length, 1);
  });
});

test('SFZ size limit uses the standard Config control and persists for the next load', async () => {
  const harness = createConfigHarness();
  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const select = harness.document.getElementById('sfz-size-limit');
    assert.equal(select.value, '256');
    assert.deepEqual(select.children.map(option => option.value), ['64', '128', '256', '512', '1024']);
    assert.equal(harness.document.getElementById('sfz-size-limit-label').textContent,
      'label:dialog.config.sfzSizeLimit');
    select.value = '64';
    await select.dispatchEvent('change');
    assert.equal(harness.window.appConfig.sfzMaxSizeMiB, 64);
    const saved = harness.window.appConfig;
    await harness.document.getElementById('close-btn').dispatchEvent('click');
    harness.window.electronAPI.loadConfig = async () => ({ success: true, config: saved });
    await showConfigDialog(true, saved);
    assert.equal(harness.document.getElementById('sfz-size-limit').value, '64');
  });
});

test('SFZ size limit restores the saved value after a failed save', async () => {
  const harness = createConfigHarness({ config: { sfzMaxSizeMiB: 128 }, saveConfigResult: { success: false } });
  await withGlobals({ window: harness.window, document: harness.document,
    console: createConsoleHarness({ error() {} }) }, async () => {
    await showConfigDialog(true, {});
    const select = harness.document.getElementById('sfz-size-limit');
    select.value = '1024';
    await select.dispatchEvent('change');
    assert.equal(select.value, '128');
  });
});

test('Web Config preserves the SFZ size limit in the shared app settings', async () => {
  const harness = createConfigHarness();
  await withWebConfigRuntime({ windowObject: harness.window, document: harness.document,
    localStorage: createLocalStorage() }, async () => {
    await showConfigDialog(false, {});
    const select = harness.document.getElementById('sfz-size-limit');
    select.value = '512';
    await select.dispatchEvent('change');
    assert.equal((await loadConfig(false)).sfzMaxSizeMiB, 512);
    assert.equal(harness.window.appConfig.sfzMaxSizeMiB, 512);
  });
});

test('overlay spectrum settings persist and apply to the running display', async () => {
  const applied = [];
  const harness = createConfigHarness({
    window: { SpectrumOverlay: { setSettings: settings => applied.push(settings) } }
  });

  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const quality = harness.document.getElementById('spectrum-overlay-quality');
    const display = harness.document.getElementById('spectrum-overlay-display');
    assert.equal(harness.document.getElementById('spectrum-overlay-title').textContent,
      'label:dialog.config.spectrumOverlay.title');
    assert.equal(harness.document.getElementById('spectrum-overlay-quality-label').textContent,
      'label:dialog.config.spectrumOverlay.quality');
    assert.equal(harness.document.getElementById('spectrum-overlay-display-label').textContent,
      'label:dialog.config.spectrumOverlay.display');
    assert.equal(quality.value, 'normal');
    assert.equal(display.value, 'instant');

    quality.value = 'hq';
    await quality.dispatchEvent('change');
    display.value = 'peakHold';
    await display.dispatchEvent('change');

    assert.equal(harness.window.appConfig.spectrumOverlayQuality, 'hq');
    assert.equal(harness.window.appConfig.spectrumOverlayPeakHold, true);
    assert.deepEqual(applied, [
      { quality: 'hq', peakHold: false },
      { quality: 'hq', peakHold: true }
    ]);
  });
});

test('all locales include grouped overlay spectrum labels', () => {
  for (const locale of ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh']) {
    const source = readFileSync(new URL(`../../js/locales/${locale}.json5`, import.meta.url), 'utf8');
    for (const key of ['title', 'quality', 'display']) {
      assert.equal(source.includes(`"dialog.config.spectrumOverlay.${key}":`), true,
        `${locale} is missing overlay spectrum ${key}`);
    }
  }
});

test('all locales include the Visual Sync setting copy', () => {
  const locales = ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh'];
  const keys = [
    'dialog.config.visualSync.label',
    'dialog.config.visualSync.help'
  ];

  for (const locale of locales) {
    const source = readFileSync(new URL(`../../js/locales/${locale}.json5`, import.meta.url), 'utf8');
    for (const key of keys) {
      assert.equal(source.includes(`"${key}":`), true, `${locale} is missing ${key}`);
    }
  }

  const english = readFileSync(new URL('../../js/locales/en.json5', import.meta.url), 'utf8');
  assert.equal(english.includes('"dialog.config.visualSync.label": "Sync Visuals to Audio"'), true);
  assert.equal(english.includes('Audio may be delayed to keep them synchronized.'), true);
  const japanese = readFileSync(new URL('../../js/locales/ja.json5', import.meta.url), 'utf8');
  assert.equal(japanese.includes('同期のために音声が遅れる場合があります。'), true);
});

test('all locales include the preset dialog copy', () => {
  const locales = ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh'];
  const keys = [
    'ui.title.effectPresets',
    'ui.title.pipelinePresets',
    'ui.pluginPresets.namePlaceholder',
    'ui.pluginPresets.save',
    'ui.pluginPresets.rename',
    'ui.pluginPresets.deleteSelected',
    'ui.pluginPresets.noUserPresets',
    'ui.pluginPresets.confirmDeleteSelected',
    'error.failedToSavePluginPreset',
    'error.failedToDeletePluginPreset',
    'error.failedToSavePreset',
    'error.failedToDeletePreset'
  ];

  for (const locale of locales) {
    const source = readFileSync(new URL(`../../js/locales/${locale}.json5`, import.meta.url), 'utf8');
    for (const key of keys) {
      assert.equal(source.includes(`"${key}":`), true, `${locale} is missing ${key}`);
    }
    for (const removedKey of ['ui.title.presetSelect', 'ui.title.savePreset', 'ui.title.deletePreset']) {
      assert.equal(source.includes(`"${removedKey}":`), false, `${locale} still contains ${removedKey}`);
    }
  }
});

test('Network Remote Control uses the host-owned permission and follows authoritative status', async () => {
  const harness = createConfigHarness();
  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const input = harness.document.getElementById('network-remote-control-enabled');
    assert.equal(input.checked, false);
    assert.equal(input.disabled, false);
    assert.equal(harness.document.getElementById('network-remote-control-enabled-label').textContent,
      'label:dialog.remoteControl.enabled');
    input.checked = true;
    await input.dispatchEvent('change');
    assert.equal(input.checked, true);
    harness.emitRemoteControlStatus({ enabled: false, running: false });
    assert.equal(input.checked, false);
    assert.equal(harness.calls.some(call => call[0] === 'saveConfig'), false);
    await harness.document.getElementById('close-btn').dispatchEvent('click');
    assert.equal(harness.remoteControlStatusListeners.size, 0);
  });
  assert.deepEqual(harness.remoteControlCalls, [['getStatus'], ['setEnabled', true]]);
});

test('Network Remote Control restores the saved permission and shows a useful failed-toggle message', async () => {
  const harness = createConfigHarness({ remoteControlSetEnabledError: new Error('internal save failure') });
  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const input = harness.document.getElementById('network-remote-control-enabled');
    input.checked = true;
    await withMutedConsole('error', () => input.dispatchEvent('change'));
    assert.equal(input.checked, false);
    assert.equal(input.disabled, false);
    assert.equal(harness.document.getElementById('network-remote-control-status').textContent,
      'label:dialog.remoteControl.updateFailed');
    await harness.document.getElementById('close-btn').dispatchEvent('click');
  });
});

test('Network settings save the selected shared folders only on request', async () => {
  const harness = createConfigHarness();
  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    assert.equal(harness.document.getElementById('config-category-network').textContent,
      'label:dialog.config.category.network');
    const enabled = harness.document.getElementById('library-sharing-enabled');
    const folders = harness.document.getElementById('library-sharing-folders').children.map(row => row.children[0]);
    assert.equal(enabled.checked, false);
    assert.equal(enabled.disabled, false);
    assert.equal(folders.length, 2);
    enabled.checked = true;
    folders[1].checked = true;
    await enabled.dispatchEvent('change');
    await folders[1].dispatchEvent('change');
    assert.deepEqual(harness.sharingCalls, []);
    assert.equal(harness.document.getElementById('library-sharing-status').textContent,
      'label:dialog.config.librarySharing.unsaved');
    await harness.document.getElementById('library-sharing-save').dispatchEvent('click');
    assert.deepEqual(harness.sharingCalls, [{ enabled: true, folderIds: ['music-b'] }]);
    assert.equal(harness.document.getElementById('library-sharing-status').textContent,
      'label:dialog.config.librarySharing.saved');
    assert.equal(harness.document.getElementById('openhome-enabled').checked, false);
    await harness.document.getElementById('close-btn').dispatchEvent('click');
  });
});

test('Network settings restore authoritative sharing settings after a save failure', async () => {
  const harness = createConfigHarness({ sharingSaveError: new Error('internal network failure') });
  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    harness.document.getElementById('library-sharing-enabled').checked = true;
    const folders = harness.document.getElementById('library-sharing-folders').children.map(row => row.children[0]);
    folders[0].checked = true;
    await withMutedConsole('error', () => harness.document.getElementById('library-sharing-save').dispatchEvent('click'));
    assert.equal(harness.document.getElementById('library-sharing-enabled').checked, false);
    assert.equal(harness.document.getElementById('library-sharing-save').disabled, false);
    assert.equal(harness.document.getElementById('library-sharing-status').textContent,
      'label:dialog.config.librarySharing.saveFailed');
    assert.deepEqual(harness.sharingLoadRequests,
      [{ loadSharingFolders: true }, { loadSharingFolders: true }]);
    await harness.document.getElementById('close-btn').dispatchEvent('click');
  });
});

test('Network settings load all sharing folders before an unchanged Save', async () => {
  const harness = createConfigHarness({ sharing: {
    enabled: true,
    folderIds: ['music-b'],
    folders: [{ id: 'music-a', name: 'Music A' }, { id: 'music-b', name: 'Music B' }]
  } });
  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    assert.deepEqual(harness.sharingLoadRequests, [{ loadSharingFolders: true }]);
    const folders = harness.document.getElementById('library-sharing-folders').children.map(row => row.children[0]);
    assert.deepEqual(folders.map(input => [input.value, input.checked]),
      [['music-a', false], ['music-b', true]]);
    await harness.document.getElementById('library-sharing-save').dispatchEvent('click');
    assert.deepEqual(harness.sharingCalls, [{ enabled: true, folderIds: ['music-b'] }]);
    await harness.document.getElementById('close-btn').dispatchEvent('click');
  });
});

test('Network settings cannot publish sharing when loading fails', async () => {
  const harness = createConfigHarness({ sharingLoadError: new Error('internal catalog failure') });
  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await withMutedConsole('error', () => showConfigDialog(true, {}));
    assert.equal(harness.document.getElementById('library-sharing-enabled').disabled, true);
    assert.equal(harness.document.getElementById('library-sharing-save').disabled, true);
    assert.equal(harness.document.getElementById('library-sharing-status').textContent,
      'label:dialog.config.librarySharing.loadFailed');
    await harness.document.getElementById('library-sharing-save').dispatchEvent('click');
    assert.deepEqual(harness.sharingCalls, []);
    await harness.document.getElementById('close-btn').dispatchEvent('click');
  });
});

test('all locales include the Network settings copy', () => {
  const locales = ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh'];
  const keys = [
    'dialog.config.category.network',
    'dialog.config.librarySharing.empty',
    'dialog.config.librarySharing.loading',
    'dialog.config.librarySharing.saving',
    'dialog.config.librarySharing.unsaved',
    'dialog.config.librarySharing.saved',
    'dialog.config.librarySharing.loadFailed',
    'dialog.config.librarySharing.saveFailed',
    'dialog.config.openHome.title',
    'dialog.config.network.deviceName',
    'dialog.config.network.deviceNameHelp',
    'dialog.config.network.deviceNameSaveFailed',
    'dialog.config.openHome.enable',
    'dialog.config.openHome.risk',
    'dialog.config.openHome.status.loading',
    'dialog.config.openHome.status.enabling',
    'dialog.config.openHome.status.disabling',
    'dialog.config.openHome.status.starting',
    'dialog.config.openHome.status.stopping',
    'dialog.config.openHome.status.waiting',
    'dialog.config.openHome.status.published',
    'dialog.config.openHome.status.stopped',
    'dialog.config.openHome.status.unavailable',
    'dialog.config.openHome.status.error',
    'dialog.config.openHome.status.updateFailed',
    'dialog.config.upnpAv.title', 'dialog.config.upnpAv.enable', 'dialog.config.upnpAv.risk',
    'dialog.config.upnpAv.status.published', 'dialog.config.upnpAv.status.error',
    'dialog.config.airPlay.title', 'dialog.config.airPlay.enable', 'dialog.config.airPlay.help',
    'dialog.config.airPlay.status.loading', 'dialog.config.airPlay.status.off', 'dialog.config.airPlay.status.starting',
    'dialog.config.airPlay.status.ready', 'dialog.config.airPlay.status.receiving', 'dialog.config.airPlay.status.unavailable',
    'dialog.config.airPlay.status.failed', 'dialog.config.airPlay.status.updateFailed', 'airPlay.playbackFailed'
  ];

  for (const locale of locales) {
    const source = readFileSync(new URL(`../../js/locales/${locale}.json5`, import.meta.url), 'utf8');
    for (const key of keys) {
      assert.equal(source.includes(`"${key}":`), true, `${locale} is missing ${key}`);
    }
  }

  const english = readFileSync(new URL('../../js/locales/en.json5', import.meta.url), 'utf8');
  assert.equal(english.includes(
    'devices on your local network can view playback metadata, change the Player queue, and control playback. No sign-in is required.'
  ), true);
  const japanese = readFileSync(new URL('../../js/locales/ja.json5', import.meta.url), 'utf8');
  assert.equal(japanese.includes(
    '同じLAN上の端末はログインなしで再生中の曲情報を閲覧し、Playerのキューを変更して再生を操作できます。'
  ), true);
});

test('all locales include matching IR Reverb, IR library, and external asset keys', () => {
  const locales = ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh'];
  const readIrEntries = locale => {
    const source = readFileSync(new URL(`../../js/locales/${locale}.json5`, import.meta.url), 'utf8');
    return new Map([...source.matchAll(
      /^\s*"((?:irReverb|irLibrary|externalAsset)\.[^"]+)":\s*"([^"]*)"/gm
    )].map(([, key, value]) => [key, value]));
  };
  const placeholderNames = value => [...value.matchAll(/\{([^}]+)\}/g)]
    .map(match => match[1])
    .sort();
  const english = readIrEntries('en');
  assert.ok(english.size > 0);
  for (const locale of locales) {
    const entries = readIrEntries(locale);
    assert.deepEqual([...entries.keys()].sort(), [...english.keys()].sort(), `${locale} IR key parity`);
    for (const [key, value] of entries) {
      assert.deepEqual(placeholderNames(value), placeholderNames(english.get(key)), `${locale} ${key} placeholders`);
    }
  }
});

test('all locales include matching offline output setting and error keys', () => {
  const locales = ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh'];
  const readEntries = locale => {
    const source = readFileSync(new URL(`../../js/locales/${locale}.json5`, import.meta.url), 'utf8');
    return new Map([...source.matchAll(
      /^\s*"((?:dialog\.config\.offlineOutput|error\.offlineOutput)\.[^"]+)":\s*"([^"]*)"/gm
    )].map(([, key, value]) => [key, value]));
  };
  const placeholderNames = value => [...value.matchAll(/\{([^}]+)\}/g)]
    .map(match => match[1])
    .sort();
  const english = readEntries('en');
  assert.equal(english.size, 17);
  for (const locale of locales) {
    const entries = readEntries(locale);
    assert.deepEqual([...entries.keys()].sort(), [...english.keys()].sort(), `${locale} offline output key parity`);
    for (const [key, value] of entries) {
      assert.deepEqual(
        placeholderNames(value),
        placeholderNames(english.get(key)),
        `${locale} ${key} placeholders`
      );
    }
  }
});


test('pipeline column mode defaults to automatic, persists, and applies only after a successful save', async () => {
  for (const success of [true, false]) {
    const applied = [];
    const harness = createConfigHarness({
      saveConfigResult: { success },
      uiManager: { pipelineManager: { core: { columnManager: {
        getCurrentColumns: () => 4,
        updatePipelineColumns: count => applied.push([count, harness.window.appConfig.pipelineColumnMode])
      } } } }
    });
    await withGlobals({ window: harness.window, document: harness.document }, async () => {
      await showConfigDialog(true, {});
      const select = harness.document.getElementById('pipeline-column-mode');
      assert.equal(select.value, 'auto');
      assert.deepEqual(select.children.map(option => option.value), ['manual', 'auto']);
      select.value = 'manual';
      await withMutedConsole('error', () => select.dispatchEvent('change'));
      assert.equal(harness.calls.filter(call => call[0] === 'saveConfig').at(-1)[1].pipelineColumnMode, 'manual');
      assert.deepEqual(applied, success ? [[4, 'manual']] : []);
      assert.equal(select.value, success ? 'manual' : 'auto');
    });
  }
});

test('Web pipeline column mode restores from saved configuration', async () => {
  const localStorage = createLocalStorage();
  const harness = createConfigHarness({ window: { localStorage } });
  setWebAppConfigRuntimeForTests(new WebAppConfigRuntime({
    store: new PowerConfigStore({ backend: new SerializedMemoryPowerConfigBackend() }),
    storage: localStorage,
    windowRef: harness.window
  }));
  try {
    await withGlobals({ window: harness.window, document: harness.document, localStorage }, async () => {
      await saveConfig(false, { pipelineColumnMode: 'auto' });
      await showConfigDialog(false, {});
      const select = harness.document.getElementById('pipeline-column-mode');
      assert.equal(select.value, 'auto');
      select.value = 'manual';
      await select.dispatchEvent('change');
      assert.equal((await loadConfig(false)).pipelineColumnMode, 'manual');
    });
  } finally {
    resetWebAppConfigRuntimeForTests();
  }
});

test('theme settings use registry order, apply after persistence and restore failed saves', async () => {
  for (const success of [true, false]) {
    const applied = [];
    const harness = createConfigHarness({ config: { theme: 'midnight' }, saveConfigResult: { success },
      uiManager: { setThemePreference: (...args) => applied.push(args) } });
    await withGlobals({ window: harness.window, document: harness.document }, async () => {
      await showConfigDialog(true, {});
      const select = harness.document.getElementById('theme-select');
      assert.equal(select.value, 'midnight');
      assert.deepEqual(select.children.map(option => [option.value, option.textContent]), [
        ['graphite', 'Graphite'], ['paper', 'Paper'], ['midnight', 'Midnight'], ['ember', 'Ember'], ['mint', 'Mint']
      ]);
      select.value = 'paper';
      await withMutedConsole('error', () => select.dispatchEvent('change'));
      assert.equal(harness.calls.filter(call => call[0] === 'saveConfig').at(-1)[1].theme, 'paper');
      assert.deepEqual(applied, success ? [['paper']] : []);
      assert.equal(select.value, success ? 'paper' : 'midnight');
    });
  }
});

test('Visualizer HDR defaults off and persists locally before applying in Web and Electron Config', async () => {
  for (const isElectron of [false, true]) {
    const localStorage = createLocalStorage();
    const applied = [];
    const harness = createConfigHarness({ window: { localStorage } });
    const exercise = async () => {
      await showConfigDialog(isElectron, {});
      let input = harness.document.getElementById('visualizer-hdr');
      assert.equal(input.checked, false);
      assert.equal(input.getAttribute('aria-describedby'), 'visualizer-hdr-help');
      assert.equal(harness.document.getElementById('visualizer-hdr-label').textContent,
        'label:dialog.config.visualizerHdr');
      assert.equal(harness.document.getElementById('visualizer-hdr-help').textContent,
        'label:dialog.config.visualizerHdrHelp');
      input.checked = true;
      await input.dispatchEvent('change');
      assert.equal(localStorage.getItem('effetune_visualizer_hdr'), 'true');
      await harness.document.getElementById('close-btn').dispatchEvent('click');

      harness.window.uiManager.visualizerView = { setHdrEnabled(enabled) {
        assert.equal(localStorage.getItem('effetune_visualizer_hdr'), String(enabled));
        applied.push(enabled);
      } };
      await showConfigDialog(isElectron, {});
      input = harness.document.getElementById('visualizer-hdr');
      assert.equal(input.checked, true);
      input.checked = false;
      await input.dispatchEvent('change');
      assert.deepEqual(applied, [false]);
      assert.equal(localStorage.getItem('effetune_visualizer_hdr'), 'false');
      await harness.document.getElementById('close-btn').dispatchEvent('click');
      await showConfigDialog(isElectron, {});
      assert.equal(harness.document.getElementById('visualizer-hdr').checked, false);
      await harness.document.getElementById('close-btn').dispatchEvent('click');
    };
    if (isElectron) await withGlobals({ window: harness.window, document: harness.document }, exercise);
    else await withWebConfigRuntime({ windowObject: harness.window, document: harness.document, localStorage }, exercise);
  }
});

test('Visualizer HDR restores its checkbox and leaves the output unchanged when local saving fails', async () => {
  const localStorage = createLocalStorage({ effetune_visualizer_hdr: 'true' });
  localStorage.setItem = () => { throw new Error('Storage unavailable'); };
  const applied = [], errors = [];
  const harness = createConfigHarness({ window: { localStorage }, uiManager: {
    visualizerView: { setHdrEnabled: enabled => applied.push(enabled) },
    setError: (...args) => errors.push(args)
  } });
  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const input = harness.document.getElementById('visualizer-hdr');
    assert.equal(input.checked, true);
    input.checked = false;
    await withMutedConsole('error', () => input.dispatchEvent('change'));
    assert.equal(input.checked, true);
    assert.equal(localStorage.getItem('effetune_visualizer_hdr'), 'true');
    assert.deepEqual(applied, []);
    assert.deepEqual(errors, [['Failed to save settings.', true]]);
    await harness.document.getElementById('close-btn').dispatchEvent('click');
  });
});

test('mobile video rotation defaults on and applies only after a successful Electron save', async () => {
  for (const success of [true, false]) {
    const applied = [];
    const harness = createConfigHarness({
      saveConfigResult: { success },
      uiManager: { audioPlayer: { ui: {
        refreshVideoRotation() { applied.push(harness.window.appConfig.videoAutoRotate); }
      } } }
    });
    await withGlobals({ window: harness.window, document: harness.document }, async () => {
      await showConfigDialog(true, {});
      const input = harness.document.getElementById('video-auto-rotate');
      assert.equal(input.checked, true);
      assert.equal(harness.document.getElementById('video-auto-rotate-label').textContent,
        'label:dialog.config.videoAutoRotate');
      assert.equal(harness.document.getElementById('video-auto-rotate-help').textContent,
        'label:dialog.config.videoAutoRotateHelp');
      input.checked = false;
      await withMutedConsole('error', () => input.dispatchEvent('change'));
      assert.equal(harness.calls.filter(call => call[0] === 'saveConfig').at(-1)[1].videoAutoRotate, false);
      assert.equal(input.checked, !success);
      assert.deepEqual(applied, success ? [false] : []);
      await harness.document.getElementById('close-btn').dispatchEvent('click');
      if (success) {
        harness.window.electronAPI.loadConfig = async () => ({ success: true, config: harness.window.appConfig });
        await showConfigDialog(true, {});
        assert.equal(harness.document.getElementById('video-auto-rotate').checked, false);
        await harness.document.getElementById('close-btn').dispatchEvent('click');
      }
    });
  }
});

test('Web mobile video rotation preserves an explicit false and can be enabled again', async () => {
  const localStorage = createLocalStorage();
  const applied = [];
  const harness = createConfigHarness({ uiManager: { audioPlayer: { ui: {
    refreshVideoRotation() { applied.push(harness.window.appConfig.videoAutoRotate); }
  } } } });
  await withWebConfigRuntime({ windowObject: harness.window, document: harness.document, localStorage }, async () => {
    await showConfigDialog(false, {});
    const input = harness.document.getElementById('video-auto-rotate');
    assert.equal(input.checked, true);
    input.checked = false;
    await input.dispatchEvent('change');
    assert.equal((await loadConfig(false)).videoAutoRotate, false);
    assert.equal(JSON.parse(localStorage.snapshot().effetune_app_config).videoAutoRotate, false);
    await harness.document.getElementById('close-btn').dispatchEvent('click');
    await showConfigDialog(false, {});
    const restored = harness.document.getElementById('video-auto-rotate');
    assert.equal(restored.checked, false);
    restored.checked = true;
    await restored.dispatchEvent('change');
    assert.equal((await loadConfig(false)).videoAutoRotate, true);
    assert.deepEqual(applied, [false, true]);
    await harness.document.getElementById('close-btn').dispatchEvent('click');
  });
});

test('Visual Sync renders, applies after persistence, and restores failed saves', async () => {
  for (const success of [true, false]) {
    const applied = [];
    const harness = createConfigHarness({
      config: { visualSync: false },
      saveConfigResult: { success },
      window: {
        audioManager: {
          async setVisualSyncEnabled(enabled) {
            assert.equal(harness.window.appConfig?.visualSync, true);
            applied.push(enabled);
            return true;
          }
        }
      }
    });

    await withGlobals({ window: harness.window, document: harness.document }, async () => {
      await showConfigDialog(true, {});
      const input = harness.document.getElementById('visual-sync');
      assert.equal(input.checked, false);
      assert.equal(
        harness.document.getElementById('visual-sync-label').textContent,
        'label:dialog.config.visualSync.label'
      );
      assert.equal(
        harness.document.getElementById('visual-sync-help').textContent,
        'label:dialog.config.visualSync.help'
      );

      input.checked = true;
      await withMutedConsole('error', () => input.dispatchEvent('change'));

      assert.equal(
        harness.calls.filter(call => call[0] === 'saveConfig').at(-1)[1].visualSync,
        true
      );
      assert.deepEqual(applied, success ? [true] : []);
      assert.equal(input.checked, success);
    });
  }
});

test('Visual Sync applies only the latest change when an older save is delayed', async () => {
  let releaseFirstSave;
  let markFirstSaveStarted;
  const firstSaveGate = new Promise(resolve => { releaseFirstSave = resolve; });
  const firstSaveStarted = new Promise(resolve => { markFirstSaveStarted = resolve; });
  const applied = [];
  const harness = createConfigHarness({
    config: { visualSync: false },
    window: {
      audioManager: {
        async setVisualSyncEnabled(enabled) {
          applied.push(enabled);
          return true;
        }
      }
    }
  });
  let saveCount = 0;
  harness.window.electronAPI.saveConfig = async nextConfig => {
    harness.calls.push(['saveConfig', { ...nextConfig }]);
    saveCount++;
    if (saveCount === 1) {
      markFirstSaveStarted();
      await firstSaveGate;
    }
    return { success: true };
  };

  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    const input = harness.document.getElementById('visual-sync');
    input.checked = true;
    const enable = input.dispatchEvent('change');
    await firstSaveStarted;

    input.checked = false;
    const disable = input.dispatchEvent('change');
    releaseFirstSave();
    await Promise.all([enable, disable]);

    assert.deepEqual(applied, [false]);
    assert.equal(harness.window.appConfig.visualSync, false);
    assert.equal(input.checked, false);
  });
});

test('theme normalization preserves missing config keys and all locales label the selector', async () => {
  for (const config of [{}, { theme: 'invalid' }]) {
    const harness = createConfigHarness({ config });
    await withGlobals({ window: harness.window, document: harness.document }, async () => {
      await showConfigDialog(true, {});
      assert.equal(harness.document.getElementById('theme-select').value, 'graphite');
      assert.equal(harness.calls.some(call => call[0] === 'saveConfig'), false);
      if (!('theme' in config)) {
        const language = harness.document.getElementById('language-select');
        language.value = 'ja';
        await language.dispatchEvent('change');
        assert.equal('theme' in harness.window.appConfig, false);
      }
    });
  }
  for (const locale of ['ar', 'en', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh']) {
    const source = readFileSync(new URL(`../../js/locales/${locale}.json5`, import.meta.url), 'utf8');
    assert.match(source, /"dialog\.config\.theme": "[^"\n]+"/);
  }
});

test('theme mirrors follow full loads and explicit theme saves in Web and Electron', async () => {
  for (const isElectron of [false, true]) {
    for (const config of [{}, { theme: 'mint' }]) {
      const localStorage = createLocalStorage({ effetune_app_config: JSON.stringify(config), effetune_theme: 'ember' });
      const harness = createConfigHarness({ config });
      const run = async () => {
        await loadConfig(isElectron);
        assert.equal(localStorage.getItem('effetune_theme'), config.theme || 'graphite');
        assert.equal(await saveConfig(isElectron, { theme: 'paper' }), true);
        assert.equal(localStorage.getItem('effetune_theme'), 'paper');
        assert.equal(await saveConfig(isElectron, { language: 'ja' }), true);
        assert.equal(localStorage.getItem('effetune_theme'), 'paper');
      };
      harness.window.localStorage = localStorage;
      if (isElectron) await withGlobals({ window: harness.window }, run);
      else await withWebConfigRuntime({ windowObject: harness.window, localStorage }, run);
    }
  }
});

test('optional mirror failures do not prevent loading or saving config', async () => {
  const localStorage = createLocalStorage();
  const harness = createConfigHarness({ config: { theme: 'paper' } });
  await withWebConfigRuntime({ windowObject: harness.window, localStorage }, async () => {
    Object.defineProperty(harness.window, 'localStorage', { get() { throw new Error('unavailable'); } });
    for (const isElectron of [false, true]) {
      assert.ok(await loadConfig(isElectron));
      assert.equal(await saveConfig(isElectron, { theme: 'mint' }), true);
    }
  });
});

test('Browser startup is saved and restored in desktop Config and unavailable on the Web', async () => {
  const desktop = createConfigHarness({ config: { startupView: 'browser' } });
  await withGlobals({ window: desktop.window, document: desktop.document }, async () => {
    await showConfigDialog(true, {});
    const browser = desktop.document.getElementById('startup-view-browser');
    assert.equal(browser.checked, true);
    assert.equal(desktop.document.getElementById('library-startup-view-select').disabled, true);
    await desktop.document.getElementById('startup-view-effects').dispatchEvent('change');
    assert.equal(browser.checked, false);
    await browser.dispatchEvent('change');
    assert.equal(browser.checked, true);
    assert.equal(desktop.window.appConfig.startupView, 'browser');
    assert.equal(desktop.calls.filter(call => call[0] === 'saveConfig').at(-1)[1].startupView, 'browser');
  });
  const web = createConfigHarness();
  web.window.localStorage = createLocalStorage();
  await withGlobals({ window: web.window, document: web.document }, async () => {
    await showConfigDialog(false, {});
    assert.equal(web.document.getElementById('startup-view-browser'), null);
  });
});

test('Browser URL rule editor keeps drafts until Save, supports priority and enable edits, and preserves failed edits', async () => {
  const errors = [];
  const harness = createConfigHarness({ presets: { Music: { plugins: [] }, Speech: { plugins: [] } },
    uiManager: { setError: message => errors.push(message) } });
  let settings = { startPage: 'https://example.com/', urlRules: [] };
  let fail = false;
  const patches = [];
  harness.window.electronAPI.browser = {
    async getState() { return { settings, defaultUserAgent: 'Browser' }; },
    async saveSettings(patch) {
      patches.push(patch);
      if (fail) return { ok: false, error: 'saveFailed' };
      settings = { ...settings, ...patch };
      return { ok: true, settings };
    }
  };
  const click = id => harness.document.getElementById(id).dispatchEvent('click');
  const rows = () => harness.document.allElements.filter(element => element.className === 'browser-rule-row');
  const latest = () => rows().at(-1);
  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    await click('browser-rules-add');
    await click('browser-rules-save');
    assert.equal(patches.length, 0, 'an invalid draft is not sent to the main process');
    assert.equal(errors.at(-1), 'label:dialog.config.browser.rules.invalid');
    latest().children[1].value = 'example.com/*';
    await latest().children[1].dispatchEvent('input');
    await click('browser-rules-save');
    assert.deepEqual(settings.urlRules, [{ pattern: 'example.com/*', preset: 'Music', enabled: true }]);
    assert.equal(settings.startPage, 'https://example.com/');
    await click('browser-rules-add');
    let row = latest();
    row.children[1].value = 'example.com/speech/*';
    await row.children[1].dispatchEvent('input');
    row.children[2].value = 'Speech';
    await row.children[2].dispatchEvent('change');
    await row.children[3].dispatchEvent('click');
    const first = rows().at(-2);
    first.children[0].children[0].checked = false;
    await first.children[0].children[0].dispatchEvent('change');
    fail = true;
    await click('browser-rules-save');
    assert.equal(settings.urlRules.length, 1);
    fail = false;
    await click('browser-rules-save');
    assert.deepEqual(settings.urlRules, [
      { pattern: 'example.com/speech/*', preset: 'Speech', enabled: false },
      { pattern: 'example.com/*', preset: 'Music', enabled: true }
    ]);
    await latest().children[5].dispatchEvent('click');
    await click('browser-rules-cancel');
    await click('browser-rules-save');
    assert.equal(settings.urlRules.length, 2, 'Cancel restores saved rules after deletion');
    assert.ok(patches.every(patch => Object.keys(patch).join() === 'urlRules'));
  });
});

test('all locales include Browser URL rule controls and clear validation messages', () => {
  const languages = ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh'];
  for (const language of languages) {
    const text = readFileSync(new URL(`../../js/locales/${language}.json5`, import.meta.url), 'utf8');
    for (const key of ['title', 'help', 'add', 'save', 'cancel', 'enabled', 'pattern', 'preset', 'choosePreset', 'up', 'down', 'delete', 'invalid']) {
      assert.ok(text.includes(`"dialog.config.browser.rules.${key}":`), `${language}: ${key}`);
    }
    assert.ok(text.includes('"browser.ruleError":'), language);
  }
});
