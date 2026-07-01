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

test('loadConfig returns empty objects outside Electron and on failed reads', async () => {
  assert.deepEqual(await loadConfig(false), {});

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

test('loadConfig returns loaded config and saveConfig persists only in Electron', async () => {
  const harness = createConfigHarness({ config: { language: 'ja' } });

  await withGlobals({ window: harness.window }, async () => {
    assert.deepEqual(await loadConfig(true), { language: 'ja' });
    await saveConfig(false, { ignored: true });
    await saveConfig(true, { autoLaunch: true });
  });

  assert.deepEqual(harness.calls, [
    ['loadConfig'],
    ['saveConfig', { autoLaunch: true }]
  ]);
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

test('showConfigDialog exits outside Electron', async () => {
  const harness = createConfigHarness();

  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(false, { autoLaunch: true });
  });

  assert.deepEqual(harness.calls, []);
  assert.equal(harness.document.body.children.length, 0);
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

    const presetSelect = harness.document.getElementById('preset-select');
    presetSelect.value = 'Zeta';
    presetSelect.dispatchEvent('change');

    const languageSelect = harness.document.getElementById('language-select');
    languageSelect.value = 'xx';
    languageSelect.dispatchEvent('change');
    await flushMicrotasks();

    assert.deepEqual(languageCalls, [['auto', { persist: false }]]);
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
    assert.equal(implicitDefaults.document.getElementById('language-select').value, 'auto');
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
      omitIds: ['language-select', 'preset-select']
    }
  });

  await withGlobals({ window: harness.window, document: harness.document }, async () => {
    await showConfigDialog(true, {});
    assert.equal(harness.document.getElementById('language-select'), null);
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
