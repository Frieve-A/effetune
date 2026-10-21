import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

// This function also runs in the installed application's renderer via Playwright.
export async function probeAppState({ mode, state }) {
  const api = window.electronAPI;
  const requireSuccess = (result, label) => {
    if (result?.success !== true) throw new Error(`${label} failed.`);
    return result;
  };
  const requireOk = (result, label) => {
    if (result?.ok !== true) throw new Error(`${label} failed.`);
    return result;
  };
  const library = await api.libraryRecoveryV1.initialize();
  if (library?.available !== true) throw new Error('Library initialization failed.');
  const userData = await api.getPath('userData');
  if (!userData.replaceAll('\\', '/').endsWith('/EffeTune Store')) throw new Error('Store userData path was not selected.');
  const presetPath = await api.joinPaths(userData, 'effetune_presets.json');
  if (mode === 'seed') {
    requireSuccess(await api.saveConfig({ msixInstalledTestMarker: state.marker, startMinimized: false }), 'Config save');
    requireSuccess(await api.saveFile(presetPath, JSON.stringify({ [state.marker]: { pipeline: [] } })), 'Preset save');
    const created = await api.libraryCatalogV1.createPlaylist({ playlistId: state.marker, name: state.marker, createdAt: Date.now() });
    if (created.kind !== 'created') throw new Error('Library playlist save failed.');
    requireOk(await api.browser.saveSettings({ bookmarks: [{ name: state.marker, url: 'https://example.com/' }] }), 'Browser settings save');
  }
  const config = requireSuccess(await api.loadConfig(), 'Config load').config;
  if (config.msixInstalledTestMarker !== state.marker) throw new Error('Configuration was not preserved.');
  const presets = requireSuccess(await api.getUserPresetsForTray(), 'Preset load').presets;
  if (!presets.includes(state.marker)) throw new Error('Presets were not preserved.');
  const playlist = await api.libraryCatalogV1.queryPlaylistItems({ playlistId: state.marker, limit: 1 });
  if (playlist.playlist.name !== state.marker) throw new Error('Library data was not preserved.');
  const browserState = requireOk(await api.browser.getState(), 'Browser settings load');
  if (!browserState.settings.bookmarks.some(bookmark => bookmark.name === state.marker)) throw new Error('Browser data was not preserved.');
  const openHome = await api.openHomeV1.getStatus();
  if (!openHome.available) throw new Error('OpenHome sidecar is unavailable.');
  return { isMsix: api.isMsix, userData, config: true, presets: true, library: true, browser: true, openHomeAvailable: true };
}

export function fileActivationApplied(volume) {
  const pipeline = window.app?.audioManager?.pipeline;
  if (pipeline?.length !== 1) return false;
  const parameters = pipeline[0].getParameters();
  return parameters.type === 'VolumePlugin' && parameters.enabled === true && parameters.vl === volume;
}

export function installedAppReady() {
  return window.electronAPI?.isMsix === true && window.app?.initialized === true &&
    !document.documentElement.classList.contains('app-starting') && document.body?.getBoundingClientRect().height > 0;
}

export async function configureOpenHomeForTrial(enabled) {
  const status = await window.electronAPI.openHomeV1.setEnabled(enabled);
  if (status?.enabled !== enabled) throw new Error('OpenHome setting was not applied.');
  await window.uiManager.setOpenHomeRemoteControlEnabled(enabled);
}

async function runProbe() {
  const { values } = parseArgs({ options: {
    port: { type: 'string' }, mode: { type: 'string' },
    state: { type: 'string' }, report: { type: 'string' },
  } });
  assert.ok(['seed', 'check', 'file-prepare', 'file-check'].includes(values.mode), 'Use --mode seed, check, file-prepare or file-check.');
  assert.match(values.port || '', /^\d{1,5}$/);
  assert.ok(Number(values.port) > 0 && Number(values.port) <= 65535);
  const state = JSON.parse((await readFile(values.state, 'utf8')).replace(/^\uFEFF/, ''));
  let browser;
  const deadline = Date.now() + 45_000;
  while (!browser) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${values.port}`, { timeout: 2000 });
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  try {
    let page;
    while (!page) {
      page = browser.contexts().flatMap(context => context.pages()).find(candidate => {
        try { return new URL(candidate.url()).pathname.endsWith('/effetune.html'); } catch { return false; }
      });
      if (page) break;
      assert.ok(Date.now() < deadline, 'The registered package did not show the main application page.');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    page.setDefaultTimeout(15_000);
    await page.waitForFunction(installedAppReady);
    const probe = await page.evaluate(probeAppState, { mode: values.mode, state });
    if (values.mode === 'file-prepare') {
      assert.notEqual(state.baselineVolume, state.activationVolume, 'Activation needs a distinct baseline.');
      await page.waitForFunction(() => window.app?.audioManager?.workletNode && window.uiManager?.loadPreset);
      await page.evaluate(volume => window.uiManager.loadPreset({
        pipeline: [{ name: 'Volume', enabled: true, parameters: { vl: volume } }],
      }), state.baselineVolume);
      await page.waitForFunction(fileActivationApplied, state.baselineVolume);
      probe.fileActivationBaseline = state.baselineVolume;
    }
    if (values.mode === 'file-check') {
      // Successful Shell dispatch is insufficient: wait for the distinct file contents to be applied.
      await page.waitForFunction(fileActivationApplied, state.activationVolume);
      probe.fileActivationVolume = state.activationVolume;
    }
    if (values.mode === 'seed') {
      await page.waitForFunction(() => window.uiManager?.openHomeRemoteRuntimeReady === true);
      try {
        await page.evaluate(configureOpenHomeForTrial, true);
        await page.waitForFunction(async () => (await window.electronAPI.openHomeV1.getStatus()).state === 'ready');
        probe.openHomeStarted = true;
      } finally {
        await page.evaluate(configureOpenHomeForTrial, false);
      }
      await page.waitForFunction(async () => (await window.electronAPI.openHomeV1.getStatus()).state === 'stopped');
      probe.openHomeStopped = true;
    }
    await page.screenshot({ path: values.report.replace(/\.json$/, '.png') });
    await writeFile(values.report, `${JSON.stringify({ passed: true, ...probe }, null, 2)}\n`);
  } finally {
    // For a CDP connection this disconnects Playwright; the PowerShell runner owns the app lifetime.
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runProbe();
}
