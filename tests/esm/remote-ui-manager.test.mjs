import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteUiManager, loadTranslations, RemoteMobileShell } from '../../js/remote/remote-ui-manager.js';

function fakeFetch(files) {
    const requested = [];
    const fetchImpl = async url => {
        requested.push(url);
        const body = files[url];
        return { ok: body !== undefined, text: async () => body };
    };
    fetchImpl.requested = requested;
    return fetchImpl;
}

test('translations load English plus the browser language, with comments removed', async () => {
    const fetchImpl = fakeFetch({
        'js/locales/en.json5': '{ // greeting\n "a": "Hello", /* note */ "b": "Bye" }',
        'js/locales/ja.json5': '{ "a": "こんにちは" }'
    });
    const result = await loadTranslations({ fetchImpl, language: 'ja-JP' });
    assert.equal(result.locale, 'ja');
    assert.deepEqual(result.english, { a: 'Hello', b: 'Bye' });
    assert.deepEqual(result.translations, { a: 'こんにちは' });
    const english = await loadTranslations({ fetchImpl: fakeFetch({ 'js/locales/en.json5': '{"a":"x"}' }), language: 'en-US' });
    assert.equal(english.translations, english.english);
    const unknown = await loadTranslations({ fetchImpl: fakeFetch({ 'js/locales/en.json5': '{"a":"x"}' }), language: 'xx' });
    assert.equal(unknown.locale, 'en');
});

test('a locale file that cannot be read leaves an empty table instead of failing', async () => {
    const result = await loadTranslations({
        fetchImpl: async () => { throw new Error('offline'); },
        language: 'fr'
    });
    assert.deepEqual(result.translations, {});
    assert.deepEqual(result.english, {});
});

test('the stand-in UI manager translates with an English fallback and shows messages', () => {
    const shown = [];
    const manager = createRemoteUiManager({
        locale: 'ja',
        translations: { 'x.title': 'タイトル {n}' },
        english: { 'x.title': 'Title {n}', 'x.only': 'English only', 'error.failedToLoadPreset': 'Could not load' },
        showMessage: (...args) => shown.push(args),
        hideMessage: () => shown.push('hidden')
    });
    assert.equal(manager.t('x.title', { n: 3 }), 'タイトル 3');
    assert.equal(manager.t('x.only'), 'English only');
    assert.equal(manager.t('missing.key'), 'missing.key');
    manager.showTransientMessage('x.only', false, {}, 1000);
    manager.showTransientMessage('unknown.key', true);
    manager.showTransientMessage('A sentence that is its own text', false);
    manager.setError('error.failedToLoadPreset');
    manager.setError('error.unknown');
    manager.clearError();
    assert.deepEqual(shown[0], ['English only', true, 1000]);
    assert.deepEqual(shown[1], ['Something went wrong. Try again.', false, 3000]);
    assert.equal(shown[2][0], 'A sentence that is its own text');
    assert.deepEqual(shown[3], ['Could not load', false]);
    assert.match(shown[4][0], /Something went wrong/);
    assert.equal(shown[5], 'hidden');
    assert.equal(manager.isDoubleBlindActive(), false);
    assert.equal(manager.getLocalizedDocPath('/x'), '/x');
    assert.equal(manager.userLanguage, 'ja');
});

function fakeDocument() {
    const created = [];
    const pluginList = {
        classes: new Set(),
        classList: { add(name) { pluginList.classes.add(name); }, remove(name) { pluginList.classes.delete(name); } },
        prepend(node) { pluginList.first = node; }
    };
    const makeElement = () => ({
        listeners: {},
        attributes: {},
        removed: false,
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(type, fn) { this.listeners[type] = fn; },
        remove() { this.removed = true; }
    });
    return {
        created,
        pluginList,
        createElement() { const element = makeElement(); created.push(element); return element; },
        getElementById: id => (id === 'pluginList' ? pluginList : null),
        body: { appendChild(node) { created.push(['appended', node]); } }
    };
}

test('the mobile shell adds an open and a close button for the effect list only in mobile layout', () => {
    const documentRef = fakeDocument();
    const shell = new RemoteMobileShell({ documentRef });
    shell.applyMode('desktop');
    assert.equal(documentRef.created.length, 0);
    shell.applyMode('mobile');
    shell.applyMode('mobile');
    const [fab, close] = documentRef.created.filter(item => !Array.isArray(item));
    assert.equal(fab.className, 'mobile-plugin-fab');
    assert.equal(fab.attributes['aria-label'], 'Add effect');
    assert.equal(close.className, 'mobile-plugin-list-close');
    assert.equal(documentRef.pluginList.first, close);
    fab.listeners.click();
    assert.ok(documentRef.pluginList.classes.has('mobile-open'));
    close.listeners.click();
    assert.ok(!documentRef.pluginList.classes.has('mobile-open'));
    shell.applyMode('desktop');
    assert.equal(fab.removed, true);
    assert.equal(close.removed, true);
    shell.setView();
    shell.dispose();
});
