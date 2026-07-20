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
  const document = createFakeDocument(options.documentOptions);
  const electronAPI = {
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
    }
  };
  const uiManager = {
    t: key => `label:${key}`,
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

  return { calls, document, window: windowObject };
}

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
    powerSaving: {
      mode: 'balanced',
      silenceThresholdDb: -80,
      fullSuspendDelaySeconds: 300
    }
  });

  const localStorage = createLocalStorage({
    effetune_app_config: JSON.stringify({ language: 'ja', pipelineStartup: 'last' })
  });
  await withWebConfigRuntime({ windowObject: {}, localStorage }, async () => {
    assert.deepEqual(await loadConfig(false), {
      language: 'ja',
      pipelineStartup: 'last',
      powerSaving: {
        mode: 'balanced',
        silenceThresholdDb: -80,
        fullSuspendDelaySeconds: 300
      }
    });
  });

  const missingConfig = createConfigHarness({ loadConfigResult: { success: true } });
  await withGlobals({ window: missingConfig.window }, async () => {
    assert.deepEqual(await loadConfig(true), {});
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
    assert.deepEqual(await loadConfig(true), { language: 'ja' });
    await saveConfig(true, { autoLaunch: true });
  });
  await withWebConfigRuntime({ windowObject: {}, localStorage }, async () => {
    assert.equal(await saveConfig(false, { pipelineStartup: 'default' }), true);
  });

  assert.deepEqual(harness.calls, [
    ['loadConfig'],
    ['saveConfig', { language: 'ja', autoLaunch: true }]
  ]);
  assert.deepEqual(JSON.parse(localStorage.snapshot().effetune_app_config), {
    language: 'en',
    pipelineStartup: 'default',
    powerSaving: {
      mode: 'balanced',
      silenceThresholdDb: -80,
      fullSuspendDelaySeconds: 300
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
        fullSuspendDelaySeconds: 900
      }
    })
  });

  await withWebConfigRuntime({ windowObject: {}, localStorage }, async () => {
    assert.deepEqual(await saveWebPowerSavingSettings({ mode: 'maximum' }), {
      mode: 'maximum',
      silenceThresholdDb: -90,
      fullSuspendDelaySeconds: 900
    });
    assert.deepEqual(await loadWebAppConfig(), {
      language: 'ja',
      powerSaving: {
        mode: 'maximum',
        silenceThresholdDb: -90,
        fullSuspendDelaySeconds: 900
      }
    });

    assert.deepEqual(await saveWebPowerSavingSettings({ fullSuspendDelaySeconds: 'never' }), {
      mode: 'maximum',
      silenceThresholdDb: -90,
      fullSuspendDelaySeconds: 'never'
    });
    assert.deepEqual((await loadWebAppConfig()).powerSaving, {
      mode: 'maximum',
      silenceThresholdDb: -90,
      fullSuspendDelaySeconds: 'never'
    });

    const beforeInvalidUpdate = localStorage.snapshot().effetune_app_config;
    assert.equal(await saveWebPowerSavingSettings(null), false);
    assert.equal(await saveWebPowerSavingSettings([]), false);
    assert.equal(localStorage.snapshot().effetune_app_config, beforeInvalidUpdate);

    assert.equal(await saveWebAppConfig({ powerSaving: { mode: 'continuous' } }), true);
    assert.deepEqual(await loadWebAppConfig(), {
      language: 'ja',
      powerSaving: {
        mode: 'continuous',
        silenceThresholdDb: -80,
        fullSuspendDelaySeconds: 300
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

  assert.deepEqual(harness.window.appConfig, { autoLaunch: true });
  assert.deepEqual(harness.window.electronIntegration.config, { autoLaunch: true });
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
    ['saveConfig', { language: 'en', autoLaunch: false }],
    ['saveConfig', { language: 'ja', autoLaunch: false }]
  ]);
  assert.deepEqual(harness.window.appConfig, { language: 'ja', autoLaunch: false });
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
    ['saveConfig', { language: 'en', autoLaunch: false }],
    ['saveConfig', { language: 'ja', autoLaunch: true }]
  ]);
  assert.deepEqual(harness.window.appConfig, { language: 'ja', autoLaunch: true });
  assert.deepEqual(harness.window.electronIntegration.config, harness.window.appConfig);
});

test('Electron power saving rolls back and reports a failed config save', async () => {
  const initialPowerSaving = {
    mode: 'balanced',
    silenceThresholdDb: -80,
    fullSuspendDelaySeconds: 300
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
    fullSuspendDelaySeconds: 'never'
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
    powerSaving: initialPowerSaving
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
    pipelineStartup: 'last'
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
      writeCount++;
      if (writeCount === 2) throw new Error('temporary quota failure');
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
  const harness = createConfigHarness({
    config: { language: 'en', pipelineStartup: 'last' },
    presets: { WebPreset: {} }
  });
  const localStorage = createLocalStorage({
    effetune_app_config: JSON.stringify({
      language: 'ja',
      startupView: 'library',
      libraryStartupView: 'artists',
      pipelineStartup: 'preset',
      startupPreset: 'WebPreset'
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
    assert.notEqual(harness.document.getElementById('power-saving-section'), null);
    assert.equal(harness.document.getElementById('power-mode-balanced').checked, true);
    assert.equal(harness.document.getElementById('power-silence-threshold').value, '-80');
    assert.equal(harness.document.getElementById('power-full-suspend-delay').value, '300');
    assert.equal(harness.document.getElementById('language-select').value, 'ja');
    assert.equal(harness.document.getElementById('startup-view-library').checked, true);
    assert.equal(harness.document.getElementById('library-startup-view-select').value, 'artists');
    assert.equal(harness.document.getElementById('library-startup-view-select').disabled, false);
    assert.equal(harness.document.getElementById('preset-select').value, 'WebPreset');

    const pipelineDefault = harness.document.getElementById('pl-default');
    await pipelineDefault.dispatchEvent('change');
    assert.equal(JSON.parse(localStorage.snapshot().effetune_app_config).pipelineStartup, 'default');

    const startupViewEffects = harness.document.getElementById('startup-view-effects');
    await startupViewEffects.dispatchEvent('change');
    assert.equal(JSON.parse(localStorage.snapshot().effetune_app_config).startupView, 'effects');
    assert.equal(harness.document.getElementById('library-startup-view-select').disabled, true);

    await harness.document.getElementById('startup-view-library').dispatchEvent('change');
    const libraryStartupViewSelect = harness.document.getElementById('library-startup-view-select');
    assert.equal(libraryStartupViewSelect.disabled, false);
    libraryStartupViewSelect.value = 'subfolders';
    await libraryStartupViewSelect.dispatchEvent('change');
    assert.equal(JSON.parse(localStorage.snapshot().effetune_app_config).libraryStartupView, 'subfolders');
  });
});

test('Web power-saving controls use the AudioManager facade and preserve hidden values', async () => {
  const initialPowerSaving = {
    mode: 'maximum',
    silenceThresholdDb: -90,
    fullSuspendDelaySeconds: 900
  };
  const powerCalls = [];
  const localStorage = createLocalStorage({
    effetune_app_config: JSON.stringify({
      language: 'en',
      powerSaving: initialPowerSaving
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

    assert.equal(balanced.checked, true);
    assert.equal(threshold.value, '-80');
    assert.equal(delay.value, '300');

    continuous.checked = true;
    await withMutedConsole('error', async () => {
      await continuous.dispatchEvent('change');
    });

    assert.deepEqual(powerCalls, [['updatePowerSettings', { mode: 'continuous' }]]);
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
    fullSuspendDelaySeconds: 900
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
      fullSuspendDelaySeconds: 900
    });
    assert.deepEqual(harness.window.appConfig.powerSaving, {
      mode: 'balanced',
      silenceThresholdDb: -90,
      fullSuspendDelaySeconds: 900
    });
    assert.deepEqual(harness.window.electronIntegration.config.powerSaving, {
      mode: 'balanced',
      silenceThresholdDb: -90,
      fullSuspendDelaySeconds: 900
    });
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
    assert.match(harness.document.body.children[0].innerHTML, /class="config-dialog-content"/);
    assert.match(harness.document.body.children[0].innerHTML, /class="config-dialog-column config-dialog-power-column"/);
    assert.match(harness.document.head.children[0].textContent, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
    assert.match(harness.document.head.children[0].textContent, /body\.layout-mobile \.config-dialog-content/);
    assert.match(harness.document.head.children[0].textContent, /@media \(max-width: 700px\)/);
    assert.equal(harness.document.getElementById('config-title').textContent, 'label:dialog.config.title');
    assert.equal(harness.document.getElementById('auto-launch').checked, true);
    assert.equal(harness.document.getElementById('start-min').checked, true);
    assert.equal(harness.document.getElementById('check-updates').checked, false);
    assert.equal(harness.document.getElementById('startup-view-library').checked, true);
    assert.equal(harness.document.getElementById('library-startup-view-select').value, 'albums');
    assert.equal(harness.document.getElementById('library-startup-view-select').disabled, false);
    assert.equal(harness.document.getElementById('preset-select').value, 'Alpha');
    assert.equal(harness.document.getElementById('language-select').value, 'ja');
    assert.notEqual(harness.document.getElementById('power-saving-section'), null);
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
      libraryStartupView: 'folders'
    }
  });
  await withGlobals({ window: invalidLibraryStartupView.window, document: invalidLibraryStartupView.document }, async () => {
    await showConfigDialog(true, {});
    assert.equal(invalidLibraryStartupView.document.getElementById('library-startup-view-select').value, 'tracks');
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
  assert.equal(english.size, 102);
  for (const locale of locales) {
    const entries = readIrEntries(locale);
    assert.deepEqual([...entries.keys()].sort(), [...english.keys()].sort(), `${locale} IR key parity`);
    for (const [key, value] of entries) {
      assert.deepEqual(placeholderNames(value), placeholderNames(english.get(key)), `${locale} ${key} placeholders`);
    }
  }
});
