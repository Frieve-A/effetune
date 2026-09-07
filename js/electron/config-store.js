import { normalizeThemeId, THEME_MIRROR_KEY } from '../theme-registry.mjs';
import { normalizeOfflineOutputSettings } from '../audio/offline-output-settings.js';
import {
  loadWebAppConfig,
  saveWebAppConfig
} from './webSettingsStorage.js';

const electronConfigStates = new WeakMap();
const fallbackElectronConfigState = {
  snapshot: null,
  commitTail: Promise.resolve()
};

function writeThemeMirror(theme) {
  try { window.localStorage.setItem(THEME_MIRROR_KEY, normalizeThemeId(theme)); } catch { /* Storage is optional. */ }
}

function cloneElectronConfig(config) {
  const cloned = { ...config };
  if (config?.powerSaving && typeof config.powerSaving === 'object' &&
      !Array.isArray(config.powerSaving)) {
    cloned.powerSaving = { ...config.powerSaving };
  }
  if (config?.offlineOutput && typeof config.offlineOutput === 'object' &&
      !Array.isArray(config.offlineOutput)) {
    cloned.offlineOutput = { ...config.offlineOutput };
  }
  return cloned;
}

function getElectronConfigState() {
  const electronAPI = window.electronAPI;
  if (!electronAPI || (typeof electronAPI !== 'object' && typeof electronAPI !== 'function')) {
    return fallbackElectronConfigState;
  }
  let state = electronConfigStates.get(electronAPI);
  if (!state) {
    state = { snapshot: null, commitTail: Promise.resolve() };
    electronConfigStates.set(electronAPI, state);
  }
  return state;
}

export function publishElectronConfigSnapshot(config, state = getElectronConfigState()) {
  const published = cloneElectronConfig(config);
  state.snapshot = cloneElectronConfig(published);
  window.appConfig = published;
  if (window.electronIntegration) {
    window.electronIntegration.config = published;
  }
}

export async function loadConfig(isElectron) {
  if (!isElectron) {
    const config = await loadWebAppConfig();
    writeThemeMirror(config.theme);
    return config;
  }
  try {
    const result = await window.electronAPI.loadConfig();
    if (result.success) {
      const config = result.config || {};
      config.offlineOutput = normalizeOfflineOutputSettings(config.offlineOutput);
      getElectronConfigState().snapshot = cloneElectronConfig(config);
      writeThemeMirror(config.theme);
      return config;
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }
  return {};
}

export async function saveConfig(isElectron, cfg) {
  if (!isElectron) {
    try {
      const saved = await saveWebAppConfig(cfg);
      if (saved && 'theme' in cfg) writeThemeMirror(cfg.theme);
      return saved;
    } catch (error) {
      console.error('Failed to save Web App Config:', error);
      return false;
    }
  }
  const state = getElectronConfigState();
  const patch = { ...cfg };
  const result = state.commitTail.then(async () => {
    const current = state.snapshot || window.electronIntegration?.config || window.appConfig || {};
    const nextConfig = { ...current, ...patch };
    try {
      const saveResult = await window.electronAPI.saveConfig(nextConfig);
      if (saveResult?.success === true) {
        publishElectronConfigSnapshot(nextConfig, state);
        if ('theme' in patch) writeThemeMirror(patch.theme);
        if (saveResult.warning) {
          console.warn('Config was saved with a non-fatal side-effect failure:', saveResult.warning);
        }
        return true;
      }
      console.error(
        'Failed to save config:',
        saveResult?.error || 'Unknown Electron save failure'
      );
      return false;
    } catch (error) {
      console.error('Failed to save config:', error);
      return false;
    }
  });
  state.commitTail = result.catch(() => {});
  return result;
}
