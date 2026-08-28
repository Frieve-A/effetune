import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { loadConfiguredLanguage } from '../../features/measurement/i18n.js';

test('measurement locales have the same translation keys as English', () => {
  const localeDirectory = new URL('../../features/measurement/locales/', import.meta.url);
  const localeFiles = readdirSync(localeDirectory).filter(file => file.endsWith('.json5'));
  const parse = file => JSON.parse(
    readFileSync(new URL(file, localeDirectory), 'utf8').replace(/\/\/.*$/gm, '')
  );
  const expectedKeys = Object.keys(parse('en.json5')).sort();

  assert.equal(localeFiles.length, 10);
  for (const file of localeFiles) {
    assert.deepEqual(Object.keys(parse(file)).sort(), expectedKeys, file);
  }
});

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete globalThis[name];
    }
  };
}

test('measurement uses the saved Electron language preference', async () => {
  let webConfigLoads = 0;
  const language = await loadConfiguredLanguage({
    electronAPI: {
      async loadConfig() {
        return { success: true, config: { language: 'ja' } };
      }
    },
    loadWebConfig: async () => {
      webConfigLoads++;
      return { language: 'fr' };
    },
    browserLanguage: 'en-US'
  });

  assert.equal(language, 'ja');
  assert.equal(webConfigLoads, 0);
});

test('measurement uses the saved Web language preference and resolves Auto', async () => {
  assert.equal(await loadConfiguredLanguage({
    electronAPI: null,
    loadWebConfig: async () => ({ language: 'ko' }),
    browserLanguage: 'en-US'
  }), 'ko');

  assert.equal(await loadConfiguredLanguage({
    electronAPI: null,
    loadWebConfig: async () => ({ language: 'auto' }),
    browserLanguage: 'fr-CA'
  }), 'fr');
});

test('measurement falls back to English for an unsupported browser language', async () => {
  assert.equal(await loadConfiguredLanguage({
    electronAPI: null,
    loadWebConfig: async () => ({}),
    browserLanguage: 'de-DE'
  }), 'en');
});

test('measurement UI initializes from the main Electron language setting', async () => {
  class TestElement {
    constructor() {
      this.tagName = 'H1';
      this.textContent = 'English fallback';
    }

    getAttribute(name) {
      return name === 'data-i18n' ? 'title:main' : null;
    }

    hasAttribute() {
      return false;
    }
  }

  const heading = new TestElement();
  const documentRef = {
    documentElement: {},
    querySelectorAll(selector) {
      return selector === '[data-i18n]' ? [heading] : [];
    }
  };
  const fetchedLocales = [];
  const translations = {
    'locales/en.json5': { 'title:main': 'EffeTune Frequency Response Measurement' },
    'locales/ja.json5': { 'title:main': 'EffeTune 周波数応答測定' }
  };

  const restoreGlobals = [
    replaceGlobal('window', {
      electronAPI: {
        async loadConfig() {
          return { success: true, config: { language: 'ja' } };
        }
      }
    }),
    replaceGlobal('document', documentRef),
    replaceGlobal('HTMLElement', TestElement),
    replaceGlobal('navigator', { language: 'en-US' }),
    replaceGlobal('localStorage', {
      getItem() {
        return 'en';
      }
    }),
    replaceGlobal('fetch', async path => {
      fetchedLocales.push(path);
      return {
        ok: Boolean(translations[path]),
        async text() {
          return JSON.stringify(translations[path]);
        }
      };
    })
  ];

  try {
    const moduleUrl = new URL('../../features/measurement/i18n.js', import.meta.url);
    moduleUrl.searchParams.set('test', String(Date.now()));
    const i18n = await import(moduleUrl.href);

    await i18n.initI18n();

    assert.deepEqual(fetchedLocales, ['locales/en.json5', 'locales/ja.json5']);
    assert.equal(heading.textContent, 'EffeTune 周波数応答測定');
    assert.deepEqual(documentRef.documentElement, { lang: 'ja' });
  } finally {
    for (const restore of restoreGlobals.reverse()) restore();
  }
});
