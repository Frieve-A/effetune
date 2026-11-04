import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { _electron as electron } from 'playwright';

async function launchInitializedApp(profile, applications, name) {
  const application = await electron.launch({
    args: [fileURLToPath(new URL('../helpers/startup-app-electron-main.cjs', import.meta.url)),
      ...(name === undefined ? [] : [`--settings-name=${name}`])],
    env: { ...process.env, EFFETUNE_STARTUP_TEST_PROFILE: profile, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 30_000
  });
  applications.push(application);
  const deadline = Date.now() + 30_000;
  let page;
  while (!(page = application.windows().find(window => window.url().includes('/effetune.html')))) {
    if (Date.now() > deadline) throw new Error('The application document did not load');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await page.waitForFunction(() => window.app?.initialized, null, { timeout: 30_000 });
  return page;
}

test('named settings persist separately while measurements and presets remain shared', { timeout: 120_000 }, async () => {
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-named-settings-')));
  const applications = [];
  try {
    const headphones = await launchInitializedApp(profile, applications, 'Headphones');
    const speakers = await launchInitializedApp(profile, applications, 'Speakers');
    for (const [page, name, theme] of [[headphones, 'Headphones', 'paper'], [speakers, 'Speakers', 'midnight']]) {
      const result = await page.evaluate(async ({ name, theme }) => {
        const api = window.electronAPI;
        const config = await api.saveConfig({ theme, checkForUpdatesOnStartup: false });
        const { getSettingsStorage } = await import('./js/settings-storage.js');
        getSettingsStorage().setItem('effetune_visualizer_hdr', theme);
        const pipeline = [{ name: 'Volume', enabled: true, parameters: { vl: theme === 'paper' ? -12 : -24 } }];
        if (!await window.uiManager.pipelineManager.presetManager.loadPreset({ pipeline })) throw new Error('Could not load the test pipeline');
        const saved = await api.savePipelineStateToFile(pipeline);
        if (!saved.success) throw new Error('Could not save the test pipeline');
        return { name: api.settingsName, config, shared: await api.getPath('userData'), settings: await api.getPath('settings') };
      }, { name, theme });
      assert.equal(result.name, name);
      assert.equal(result.config.success, true);
      assert.equal(result.shared, profile);
      assert.notEqual(result.settings, profile);
      assert.equal(JSON.parse(await readFile(path.join(result.settings, 'config.json'), 'utf8')).theme, theme);
    }
    await headphones.evaluate(async () => {
      const { DataStorage } = await import('./features/measurement/dataStorage.js');
      const store = new DataStorage({ backupBridge: null });
      await store.initialize();
      if (!store.db) throw new Error('The measurement database is unavailable in the first app');
      await store.addMeasurement({ id: 'shared-profile-measurement', name: 'Shared measurement', points: [] });
      store.db?.close();
      const root = await window.electronAPI.getPath('userData');
      await window.electronAPI.saveFile(await window.electronAPI.joinPaths(root, 'effetune_presets.json'),
        JSON.stringify({ Shared: { pipeline: [] } }));
    });
    // Chromium resource databases are opened by one application at a time.
    await applications.shift().close();
    const shared = await speakers.evaluate(async () => {
      const { DataStorage } = await import('./features/measurement/dataStorage.js');
      const store = new DataStorage({ backupBridge: null });
      await store.initialize();
      if (!store.db) throw new Error('The measurement database is unavailable in the second app');
      const ids = store.measurements.map(measurement => measurement.id);
      store.db?.close();
      const presets = await window.electronAPI.getUserPresetsForTray();
      return { ids, presets };
    });
    assert.ok(shared.ids.includes('shared-profile-measurement'));
    assert.deepEqual(shared.presets.presets, ['Shared']);
    for (const application of applications.splice(0).reverse()) await application.close();
    for (const [name, theme] of [['Headphones', 'paper'], ['Speakers', 'midnight']]) {
      const page = await launchInitializedApp(profile, applications, name);
      assert.deepEqual(await page.evaluate(async () => {
        const { getSettingsStorage } = await import('./js/settings-storage.js');
        return [(await window.electronAPI.loadConfig()).config.theme,
          getSettingsStorage().getItem('effetune_visualizer_hdr'),
          window.audioManager.pipeline[0]?.getParameters().vl];
      }), [theme, theme, theme === 'paper' ? -12 : -24]);
      await applications.pop().close();
    }
  } finally {
    for (const application of applications.reverse()) await application.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('omitting the settings name restores existing desktop configuration and browser preferences', { timeout: 90_000 }, async () => {
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-existing-settings-')));
  const applications = [];
  try {
    await writeFile(path.join(profile, 'config.json'), JSON.stringify({
      theme: 'mint', pipelineStartup: 'last', checkForUpdatesOnStartup: false
    }));
    await writeFile(path.join(profile, 'audio-preferences.json'), JSON.stringify({
      inputDeviceId: '__effetune_no_audio_input__', outputDeviceId: 'default', sampleRate: 48000, outputChannels: 2
    }));
    await writeFile(path.join(profile, 'pipeline-state.json'), JSON.stringify([
      { name: 'Volume', enabled: true, parameters: { vl: -9 } }
    ]));
    let page = await launchInitializedApp(profile, applications);
    assert.deepEqual(await page.evaluate(async () => ({
      name: window.electronAPI.settingsName,
      nativeSettings: window.electronAPI.settingsStorage,
      theme: (await window.electronAPI.loadConfig()).config.theme,
      sampleRate: (await window.electronAPI.loadAudioPreferences()).preferences.sampleRate,
      volume: window.audioManager.pipeline[0]?.getParameters().vl,
      sameDirectory: await window.electronAPI.getPath('settings') === await window.electronAPI.getPath('userData')
    })), { name: '', nativeSettings: null, theme: 'mint', sampleRate: 48000, volume: -9, sameDirectory: true });
    await page.evaluate(() => localStorage.setItem('effetune_visualizer_hdr', 'true'));
    await applications.pop().close();
    page = await launchInitializedApp(profile, applications);
    assert.equal(await page.evaluate(async () => {
      const { getSettingsStorage } = await import('./js/settings-storage.js');
      return getSettingsStorage() === localStorage && getSettingsStorage().getItem('effetune_visualizer_hdr') === 'true';
    }), true);
    await assert.rejects(access(path.join(profile, 'settings')), { code: 'ENOENT' });
  } finally {
    for (const application of applications.reverse()) await application.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
