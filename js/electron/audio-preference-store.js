import {
  loadWebAudioPreferences,
  mergeWebAudioPreferences,
  normalizeWebAudioPreferences,
  saveWebAudioPreferences
} from './webSettingsStorage.js';

export { mergeWebAudioPreferences };

export async function loadAudioPreferences(isElectron) {
  if (!isElectron) return loadWebAudioPreferences();

  try {
    const result = await window.electronAPI.loadAudioPreferences();
    if (result.success && result.preferences) {
      return normalizeWebAudioPreferences(result.preferences);
    }
    return null;
  } catch (error) {
    console.error('Failed to load audio preferences:', error);
    return null;
  }
}

export async function saveAudioPreferences(isElectron, preferences, options = {}) {
  if (!isElectron) return saveWebAudioPreferences(preferences);

  try {
    const result = await window.electronAPI.saveAudioPreferences(preferences, options);
    return result.success;
  } catch (error) {
    console.error('Failed to save audio preferences:', error);
    return false;
  }
}

// Device labels are display-only and vary with locale, permission state, and
// reconnection; they are ignored while the matching device ID is unchanged.
const DEVICE_LABEL_ID_KEYS = Object.freeze({
  inputDeviceLabel: 'inputDeviceId',
  outputDeviceLabel: 'outputDeviceId'
});

export function isGaplessPlaybackOnlyChange(previousPreferences, nextPreferences) {
  const previous = normalizeWebAudioPreferences(previousPreferences || {});
  const next = mergeWebAudioPreferences(previousPreferences || {}, nextPreferences);
  if (!previous || !next) return false;
  if (previous.gaplessPlayback === next.gaplessPlayback) return false;
  const keys = new Set([
    ...Object.keys(previous),
    ...Object.keys(next)
  ]);
  return [...keys].every(key => key === 'gaplessPlayback' ||
    Object.is(previous[key], next[key]) ||
    (key in DEVICE_LABEL_ID_KEYS &&
      Object.is(previous[DEVICE_LABEL_ID_KEYS[key]], next[DEVICE_LABEL_ID_KEYS[key]])));
}
