export const WEB_APP_CONFIG_KEY = 'effetune_app_config';
export const WEB_AUDIO_PREFERENCES_KEY = 'effetune_audio_preferences';

function getLocalStorage() {
  try {
    const windowStorage = typeof window !== 'undefined' ? window.localStorage : null;
    return windowStorage || globalThis.localStorage || null;
  } catch (error) {
    console.warn('Failed to access localStorage:', error);
    return null;
  }
}

function readObject(key, fallback) {
  const storage = getLocalStorage();
  if (!storage) return fallback;

  try {
    const rawValue = storage.getItem(key);
    if (!rawValue) return fallback;
    const parsed = JSON.parse(rawValue);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    console.warn(`Ignoring invalid ${key} value in localStorage`);
  } catch (error) {
    console.warn(`Failed to read ${key} from localStorage:`, error);
  }
  return fallback;
}

function writeObject(key, value) {
  const storage = getLocalStorage();
  if (!storage) return false;

  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Failed to save ${key} to localStorage:`, error);
    return false;
  }
}

export function loadWebAppConfig() {
  return readObject(WEB_APP_CONFIG_KEY, {});
}

export function saveWebAppConfig(config) {
  const currentConfig = loadWebAppConfig();
  return writeObject(WEB_APP_CONFIG_KEY, {
    ...currentConfig,
    ...(config || {})
  });
}

export function loadWebAudioPreferences() {
  return readObject(WEB_AUDIO_PREFERENCES_KEY, null);
}

export function saveWebAudioPreferences(preferences) {
  if (!preferences || typeof preferences !== 'object') {
    return false;
  }
  return writeObject(WEB_AUDIO_PREFERENCES_KEY, { ...preferences });
}
