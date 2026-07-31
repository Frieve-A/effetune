import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const siteSource = fs.readFileSync(path.join(repoRoot, 'assets', 'js', 'site.js'), 'utf8');
const languageCodes = ['en', 'zh', 'es', 'hi', 'ar', 'pt', 'ru', 'ja', 'ko', 'fr'];

function createSiteHarness({
  pathname,
  search = '',
  hash = '',
  storedLanguage = 'en',
  basePath = ''
}) {
  const origin = 'https://example.test';
  const normalizedBase = basePath.replace(/\/+$/, '');
  const assigned = [];
  const replaced = [];
  const storage = new Map();
  if (storedLanguage) {
    storage.set('effetune.site.language', storedLanguage);
  }

  let changeListener = null;
  const select = {
    value: '',
    addEventListener(type, listener) {
      if (type === 'change') changeListener = listener;
    }
  };
  const languages = languageCodes.map(code => ({
    code,
    label: code,
    url: code === 'en'
      ? `${normalizedBase}/`
      : `${normalizedBase}/docs/i18n/${code}/`
  }));
  const location = {
    origin,
    pathname,
    search,
    hash,
    href: `${origin}${pathname}${search}${hash}`,
    assign(url) {
      assigned.push(url);
    },
    replace(url) {
      replaced.push(url);
    }
  };
  const windowRef = {
    location,
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, value);
      }
    },
    addEventListener() {},
    setTimeout(callback) {
      callback();
    }
  };
  const documentRef = {
    getElementById(id) {
      if (id === 'site-language-data') {
        return { textContent: JSON.stringify(languages) };
      }
      if (id === 'site-ui-text') {
        return { textContent: '{}' };
      }
      return null;
    },
    querySelector(selector) {
      return selector === '[data-language-select]' ? select : null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {}
  };

  vm.runInNewContext(siteSource, {
    console,
    document: documentRef,
    navigator: { language: 'en', languages: ['en'] },
    URL,
    window: windowRef
  }, { filename: 'assets/js/site.js' });

  return {
    assigned,
    replaced,
    select,
    storage,
    changeLanguage(language) {
      assert.ok(changeListener, 'language change listener');
      select.value = language;
      changeListener();
    }
  };
}

test('DSP overview language routing preserves base URL, query, hash, and path ending', () => {
  for (const pathname of ['/base/dsp', '/base/dsp/', '/base/dsp/index.html']) {
    const harness = createSiteHarness({
      pathname,
      search: '?mode=compact',
      hash: '#start',
      basePath: '/base'
    });

    harness.changeLanguage('ar');

    assert.deepEqual(
      harness.assigned,
      ['https://example.test/base/dsp/ar/?mode=compact#start'],
      pathname
    );
    assert.deepEqual(harness.replaced, [], pathname);
  }
});

test('direct localized DSP overview follows its URL before stored preference', () => {
  const harness = createSiteHarness({
    pathname: '/dsp/ar/index.html',
    storedLanguage: 'ja'
  });

  assert.equal(harness.select.value, 'ar');
  assert.equal(harness.storage.get('effetune.site.language'), 'ar');
  assert.deepEqual(harness.replaced, []);

  harness.changeLanguage('ja');
  harness.changeLanguage('en');

  assert.deepEqual(harness.assigned, [
    'https://example.test/dsp/ja/',
    'https://example.test/dsp/'
  ]);
});

test('DSP subroutes without localized pages do not invent locale routes', () => {
  const harness = createSiteHarness({
    pathname: '/dsp/effects/bit-crusher/',
    search: '?view=reference',
    hash: '#parameters'
  });

  harness.changeLanguage('ar');

  assert.deepEqual(harness.assigned, []);
  assert.deepEqual(harness.replaced, []);
});

test('root and translated docs language routing retains its existing targets', () => {
  const rootHarness = createSiteHarness({ pathname: '/' });
  rootHarness.changeLanguage('ja');
  assert.deepEqual(rootHarness.assigned, ['https://example.test/docs/i18n/ja/']);

  const docsHarness = createSiteHarness({
    pathname: '/docs/i18n/ar/faq.html',
    storedLanguage: 'ar'
  });
  docsHarness.changeLanguage('ja');
  docsHarness.changeLanguage('en');
  assert.deepEqual(docsHarness.assigned, [
    'https://example.test/docs/i18n/ja/faq.html',
    'https://example.test/docs/faq.html'
  ]);
});
