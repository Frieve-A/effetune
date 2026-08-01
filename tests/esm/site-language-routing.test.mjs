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
  basePath = '',
  browserLanguages = ['en']
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
    navigator: { language: browserLanguages[0] || 'en', languages: browserLanguages },
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

test('full English DSP guide is not automatically redirected by language preference', () => {
  for (const pathname of ['/dsp', '/dsp/', '/dsp/index.html']) {
    const browserHarness = createSiteHarness({
      pathname,
      storedLanguage: null,
      browserLanguages: ['ja-JP', 'en']
    });
    const storedHarness = createSiteHarness({
      pathname,
      storedLanguage: 'ja'
    });

    assert.deepEqual(browserHarness.replaced, [], `browser language: ${pathname}`);
    assert.deepEqual(storedHarness.replaced, [], `stored language: ${pathname}`);

    if (pathname === '/dsp/') {
      for (const harness of [browserHarness, storedHarness]) {
        assert.equal(harness.select.value, 'en');
        harness.changeLanguage('ja');
        assert.deepEqual(harness.assigned, ['https://example.test/dsp/ja/']);
      }
    }
  }
});

test('localized homepage DSP links open and retain the full English guide', () => {
  const expectedLink =
    '<a class="button button-secondary" href="/dsp/">DSP Library</a>';

  for (const language of languageCodes.filter(code => code !== 'en')) {
    const source = fs.readFileSync(
      path.join(repoRoot, 'docs', 'i18n', language, 'README.md'),
      'utf8'
    );
    const harness = createSiteHarness({
      pathname: '/dsp/',
      storedLanguage: language
    });

    assert.equal(source.split(expectedLink).length - 1, 1, language);
    assert.deepEqual(harness.replaced, [], language);
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

test('English-only pages are not automatically redirected for a non-English browser', () => {
  for (const pathname of [
    '/dsp/effects/bit-crusher/',
    '/docs/plugin-development.html',
    '/docs/version-history.html'
  ]) {
    const harness = createSiteHarness({
      pathname,
      storedLanguage: null,
      browserLanguages: ['ja-JP', 'en']
    });

    assert.deepEqual(harness.replaced, [], pathname);
  }
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
