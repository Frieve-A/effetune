import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig, saveConfig, showConfigDialog } from '../../js/electron/configIntegration.js';
import { createFakeDocument } from '../helpers/fake-dom.mjs';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

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
      return { success: true };
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

test('loadConfig returns web settings outside Electron and empty objects on failed reads', async () => {
  assert.deepEqual(await loadConfig(false), {});

  const localStorage = createLocalStorage({
    effetune_app_config: JSON.stringify({ language: 'ja', pipelineStartup: 'last' })
  });
  await withGlobals({ window: { localStorage } }, async () => {
    assert.deepEqual(await loadConfig(false), { language: 'ja', pipelineStartup: 'last' });
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
  await withGlobals({ window: { localStorage } }, async () => {
    assert.equal(await saveConfig(false, { pipelineStartup: 'default' }), true);
  });

  assert.deepEqual(harness.calls, [
    ['loadConfig'],
    ['saveConfig', { autoLaunch: true }]
  ]);
  assert.deepEqual(JSON.parse(localStorage.snapshot().effetune_app_config), {
    language: 'en',
    pipelineStartup: 'default'
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

  await withGlobals({ window: { ...harness.window, localStorage }, document: harness.document }, async () => {
    await showConfigDialog(false, { autoLaunch: true });
    assert.equal(harness.document.body.children.length, 1);
    assert.equal(harness.document.getElementById('auto-launch'), null);
    assert.equal(harness.document.getElementById('start-min'), null);
    assert.equal(harness.document.getElementById('tray'), null);
    assert.equal(harness.document.getElementById('check-updates'), null);
    assert.equal(harness.document.getElementById('language-select').value, 'ja');
    assert.equal(harness.document.getElementById('startup-view-library').checked, true);
    assert.equal(harness.document.getElementById('library-startup-view-select').value, 'artists');
    assert.equal(harness.document.getElementById('library-startup-view-select').disabled, false);
    assert.equal(harness.document.getElementById('preset-select').value, 'WebPreset');

    const pipelineDefault = harness.document.getElementById('pl-default');
    pipelineDefault.dispatchEvent('change');
    assert.equal(JSON.parse(localStorage.snapshot().effetune_app_config).pipelineStartup, 'default');

    const startupViewEffects = harness.document.getElementById('startup-view-effects');
    startupViewEffects.dispatchEvent('change');
    assert.equal(JSON.parse(localStorage.snapshot().effetune_app_config).startupView, 'effects');
    assert.equal(harness.document.getElementById('library-startup-view-select').disabled, true);

    harness.document.getElementById('startup-view-library').dispatchEvent('change');
    const libraryStartupViewSelect = harness.document.getElementById('library-startup-view-select');
    assert.equal(libraryStartupViewSelect.disabled, false);
    libraryStartupViewSelect.value = 'subfolders';
    libraryStartupViewSelect.dispatchEvent('change');
    assert.equal(JSON.parse(localStorage.snapshot().effetune_app_config).libraryStartupView, 'subfolders');
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
    assert.equal(harness.document.getElementById('config-title').textContent, 'label:dialog.config.title');
    assert.equal(harness.document.getElementById('auto-launch').checked, true);
    assert.equal(harness.document.getElementById('start-min').checked, true);
    assert.equal(harness.document.getElementById('check-updates').checked, false);
    assert.equal(harness.document.getElementById('startup-view-library').checked, true);
    assert.equal(harness.document.getElementById('library-startup-view-select').value, 'albums');
    assert.equal(harness.document.getElementById('library-startup-view-select').disabled, false);
    assert.equal(harness.document.getElementById('preset-select').value, 'Alpha');
    assert.equal(harness.document.getElementById('language-select').value, 'ja');

    const autoLaunch = harness.document.getElementById('auto-launch');
    autoLaunch.checked = false;
    autoLaunch.dispatchEvent('change');

    const startMinimized = harness.document.getElementById('start-min');
    startMinimized.checked = false;
    startMinimized.dispatchEvent('change');

    const checkUpdates = harness.document.getElementById('check-updates');
    checkUpdates.checked = true;
    checkUpdates.dispatchEvent('change');

    const pipelineDefault = harness.document.getElementById('pl-default');
    pipelineDefault.dispatchEvent('change');
    assert.equal(harness.document.getElementById('preset-select').disabled, true);

    const pipelinePreset = harness.document.getElementById('pl-preset');
    pipelinePreset.dispatchEvent('change');
    assert.equal(harness.document.getElementById('preset-select').disabled, false);

    const startupViewEffects = harness.document.getElementById('startup-view-effects');
    startupViewEffects.dispatchEvent('change');
    assert.equal(harness.document.getElementById('library-startup-view-select').disabled, true);

    const startupViewLibrary = harness.document.getElementById('startup-view-library');
    startupViewLibrary.dispatchEvent('change');
    const libraryStartupViewSelect = harness.document.getElementById('library-startup-view-select');
    libraryStartupViewSelect.value = 'artists';
    libraryStartupViewSelect.dispatchEvent('change');

    const presetSelect = harness.document.getElementById('preset-select');
    presetSelect.value = 'Zeta';
    presetSelect.dispatchEvent('change');

    const languageSelect = harness.document.getElementById('language-select');
    languageSelect.value = 'xx';
    languageSelect.dispatchEvent('change');
    await flushMicrotasks();

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
    tray.dispatchEvent('change');
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
    languageSelect.dispatchEvent('change');
    await flushMicrotasks();
    assert.equal(noLanguageHandler.window.appConfig.language, 'ja');
  });
});
