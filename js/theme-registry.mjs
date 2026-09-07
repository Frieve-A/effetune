export const DEFAULT_THEME_ID = 'graphite';
export const THEME_MIRROR_KEY = 'effetune_theme';
export const THEME_PRESETS = Object.freeze([
  { id: 'graphite', label: 'Graphite', colorScheme: 'dark', windowBackground: '#171717', windowForeground: '#f6f8fb' }, // theme-allow: Native window colors match the CSS theme keys.
  { id: 'paper', label: 'Paper', colorScheme: 'light', windowBackground: '#f4f4f4', windowForeground: '#1a1a1a' }, // theme-allow: Native window colors match the CSS theme keys.
  { id: 'midnight', label: 'Midnight', colorScheme: 'dark', windowBackground: '#0f1728', windowForeground: '#e6edf7' }, // theme-allow: Native window colors match the CSS theme keys.
  { id: 'ember', label: 'Ember', colorScheme: 'dark', windowBackground: '#1c1613', windowForeground: '#f5ede4' }, // theme-allow: Native window colors match the CSS theme keys.
  { id: 'mint', label: 'Mint', colorScheme: 'light', windowBackground: '#eef6f1', windowForeground: '#14261c' } // theme-allow: Native window colors match the CSS theme keys.
]);

export function normalizeThemeId(value) {
  return THEME_PRESETS.some(preset => preset.id === value) ? value : DEFAULT_THEME_ID;
}

export function getThemePreset(id) {
  return THEME_PRESETS.find(preset => preset.id === normalizeThemeId(id));
}
