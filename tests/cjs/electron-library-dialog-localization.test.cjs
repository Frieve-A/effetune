'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SUPPORTED_LOCALES,
  createFolderConsolidationDialogOptions,
  createLibraryDialogTranslator,
  resolveLibraryDialogLocale
} = require('../../electron/library-dialog-localization.cjs');

const REPLACE_FOLDER_LABELS = Object.freeze({
  en: 'Replace Folders',
  ja: 'フォルダを置き換える',
  ar: 'استبدال المجلدات',
  es: 'Sustituir carpetas',
  fr: 'Remplacer les dossiers',
  hi: 'फ़ोल्डर बदलें',
  ko: '폴더 바꾸기',
  pt: 'Substituir pastas',
  ru: 'Заменить папки',
  zh: '替换文件夹'
});

test('folder consolidation dialog is complete in every supported locale', () => {
  assert.deepEqual(SUPPORTED_LOCALES, Object.keys(REPLACE_FOLDER_LABELS));
  for (const locale of SUPPORTED_LOCALES) {
    const translate = createLibraryDialogTranslator({
      getLanguagePreference: () => locale,
      getSystemLocale: () => 'en-US'
    });
    const options = createFolderConsolidationDialogOptions(translate);
    assert.equal(options.buttons[0], REPLACE_FOLDER_LABELS[locale], locale);
    assert.notEqual(options.buttons[1], 'library.action.cancel', locale);
    assert.notEqual(options.message, 'library.confirm.mergeFolders', locale);
    assert.equal(options.cancelId, 1, locale);
  }
});

test('dialog locale resolution follows the saved preference and operating-system locale', () => {
  assert.equal(resolveLibraryDialogLocale('fr', 'ja-JP'), 'fr');
  assert.equal(resolveLibraryDialogLocale('auto', 'ja-JP'), 'ja');
  assert.equal(resolveLibraryDialogLocale('auto', 'de-DE'), 'en');
  assert.equal(resolveLibraryDialogLocale('unknown', 'ja-JP'), 'en');
});
