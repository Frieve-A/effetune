export const AUTO_LANGUAGE_PREFERENCE = 'auto';

export const TRANSLATED_LANGUAGE_CODES = ['ar', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'];
export const SELECTABLE_LANGUAGE_CODES = ['en', ...TRANSLATED_LANGUAGE_CODES];

export const LANGUAGE_OPTIONS = [
  { value: AUTO_LANGUAGE_PREFERENCE, label: 'Auto (Browser)' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
  { value: 'zh', label: '中文' }
];

export function normalizeLanguagePreference(value) {
  if (value === AUTO_LANGUAGE_PREFERENCE) {
    return AUTO_LANGUAGE_PREFERENCE;
  }

  return SELECTABLE_LANGUAGE_CODES.includes(value) ? value : AUTO_LANGUAGE_PREFERENCE;
}

export function resolveLanguagePreference(languagePreference, browserLanguage) {
  const normalizedPreference = normalizeLanguagePreference(languagePreference);
  if (normalizedPreference !== AUTO_LANGUAGE_PREFERENCE) {
    return normalizedPreference;
  }

  const fallbackBrowserLanguage =
    browserLanguage || globalThis.navigator?.language || globalThis.navigator?.languages?.[0] || 'en';
  const browserLang = String(fallbackBrowserLanguage).split('-')[0].toLowerCase();

  return SELECTABLE_LANGUAGE_CODES.includes(browserLang) ? browserLang : 'en';
}

export function getLanguageOptionLabel(value, translate) {
  if (value === AUTO_LANGUAGE_PREFERENCE) {
    return translate ? translate('dialog.config.language.auto') : 'Auto (Browser)';
  }

  return LANGUAGE_OPTIONS.find(option => option.value === value)?.label || value;
}
