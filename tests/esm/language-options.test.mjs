import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTO_LANGUAGE_PREFERENCE,
  LANGUAGE_OPTIONS,
  SELECTABLE_LANGUAGE_CODES,
  TRANSLATED_LANGUAGE_CODES,
  getLanguageOptionLabel,
  normalizeLanguagePreference,
  resolveLanguagePreference
} from '../../js/language-options.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

test('language option constants expose auto, English, and translated language codes', () => {
  assert.equal(AUTO_LANGUAGE_PREFERENCE, 'auto');
  assert.deepEqual(TRANSLATED_LANGUAGE_CODES, ['ar', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh']);
  assert.deepEqual(SELECTABLE_LANGUAGE_CODES, ['en', ...TRANSLATED_LANGUAGE_CODES]);
  assert.deepEqual(LANGUAGE_OPTIONS.map(option => option.value), ['auto', ...SELECTABLE_LANGUAGE_CODES]);
});

test('normalizeLanguagePreference keeps supported values and falls back to auto', () => {
  assert.equal(normalizeLanguagePreference('auto'), 'auto');
  assert.equal(normalizeLanguagePreference('ja'), 'ja');
  assert.equal(normalizeLanguagePreference('en'), 'en');
  assert.equal(normalizeLanguagePreference('de'), 'auto');
  assert.equal(normalizeLanguagePreference(undefined), 'auto');
});

test('resolveLanguagePreference returns explicit supported preferences before browser language', async () => {
  await withGlobals({
    navigator: { language: 'ja-JP', languages: ['ko-KR'] }
  }, async () => {
    assert.equal(resolveLanguagePreference('fr', 'ja-JP'), 'fr');
  });
});

test('resolveLanguagePreference resolves supported browser language arguments', () => {
  assert.equal(resolveLanguagePreference('auto', 'ES-MX'), 'es');
  assert.equal(resolveLanguagePreference('unsupported', 'pt-BR'), 'pt');
});

test('resolveLanguagePreference uses navigator language, navigator language list, and English fallback', async () => {
  await withGlobals({
    navigator: { language: 'RU-ru', languages: ['ja-JP'] }
  }, async () => {
    assert.equal(resolveLanguagePreference('auto'), 'ru');
  });

  await withGlobals({
    navigator: { language: '', languages: ['ZH-Hans'] }
  }, async () => {
    assert.equal(resolveLanguagePreference('auto'), 'zh');
  });

  await withGlobals({
    navigator: { language: '', languages: [] }
  }, async () => {
    assert.equal(resolveLanguagePreference('auto'), 'en');
  });

  await withGlobals({
    navigator: { language: 'de-DE', languages: ['fr-FR'] }
  }, async () => {
    assert.equal(resolveLanguagePreference('auto'), 'en');
  });
});

test('resolveLanguagePreference works when navigator is unavailable', async () => {
  await withGlobals({
    navigator: undefined
  }, async () => {
    assert.equal(resolveLanguagePreference('auto'), 'en');
  });
});

test('getLanguageOptionLabel translates auto, returns known labels, and falls back to raw values', () => {
  assert.equal(getLanguageOptionLabel('auto', key => `translated:${key}`), 'translated:dialog.config.language.auto');
  assert.equal(getLanguageOptionLabel('auto'), 'Auto (Browser)');
  assert.equal(getLanguageOptionLabel('ja'), '日本語');
  assert.equal(getLanguageOptionLabel('custom'), 'custom');
});
