'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_LOCALES = Object.freeze(['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh']);
const localeCache = new Map();

function createLibraryDialogTranslator({
  getLanguagePreference = () => 'en',
  getSystemLocale = () => 'en'
} = {}) {
  return key => {
    const locale = resolveLibraryDialogLocale(
      safelyReadLocale(getLanguagePreference),
      safelyReadLocale(getSystemLocale)
    );
    const translations = loadLocale(locale);
    const english = locale === 'en' ? translations : loadLocale('en');
    return translations[key] || english[key] || key;
  };
}

function createFolderConsolidationDialogOptions(translate = createLibraryDialogTranslator()) {
  return {
    type: 'question',
    title: translate('library.title'),
    message: translate('library.confirm.mergeFolders'),
    buttons: [
      translate('library.action.replaceFolders'),
      translate('library.action.cancel')
    ],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  };
}

function resolveLibraryDialogLocale(languagePreference, systemLocale) {
  const preference = normalizeLocale(languagePreference);
  if (preference && preference !== 'auto') {
    return SUPPORTED_LOCALES.includes(preference) ? preference : 'en';
  }
  const automaticLocale = normalizeLocale(systemLocale);
  return SUPPORTED_LOCALES.includes(automaticLocale) ? automaticLocale : 'en';
}

function normalizeLocale(value) {
  return String(value || '').trim().toLowerCase().split(/[-_]/, 1)[0];
}

function safelyReadLocale(getLocale) {
  try {
    return getLocale();
  } catch {
    return '';
  }
}

function loadLocale(locale) {
  if (localeCache.has(locale)) return localeCache.get(locale);
  const localePath = path.join(__dirname, `../js/locales/${locale}.json5`);
  const source = fs.readFileSync(localePath, 'utf8');
  const translations = JSON.parse(source
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, ''));
  localeCache.set(locale, translations);
  return translations;
}

module.exports = {
  SUPPORTED_LOCALES,
  createFolderConsolidationDialogOptions,
  createLibraryDialogTranslator,
  resolveLibraryDialogLocale
};
