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
  if (!isElectron) return loadWebAppConfig();
  try {
    const result = await window.electronAPI.loadConfig();
    if (result.success) {
      const config = result.config || {};
      config.offlineOutput = normalizeOfflineOutputSettings(config.offlineOutput);
      getElectronConfigState().snapshot = cloneElectronConfig(config);
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
      return await saveWebAppConfig(cfg);
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
