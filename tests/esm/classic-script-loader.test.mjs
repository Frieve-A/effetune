import assert from 'node:assert/strict';
import test from 'node:test';
import { loadClassicScript, loadStylesheet, waitForStylesheets } from '../../js/utils/classic-script-loader.js';
import { flushMicrotasks } from '../helpers/global-test-utils.mjs';

function createDocument(existing = null) {
  const appended = [];
  return {
    appended,
    head: { appendChild: element => appended.push(element) },
    querySelector: () => existing,
    createElement(tagName) {
      return Object.assign(new EventTarget(), {
        tagName, removed: false,
        remove() { this.removed = true; }
      });
    }
  };
}

test('concurrent classic script requests share one load and return the published API', async () => {
  const documentRef = createDocument();
  const globalRef = {};
  const options = { documentRef, globalRef, globalName: 'Library' };
  const first = loadClassicScript('concurrent-library.js', options);
  assert.equal(loadClassicScript('concurrent-library.js', options), first);
  assert.equal(documentRef.appended.length, 1);
  const script = documentRef.appended[0];
  assert.equal(script.src, 'concurrent-library.js');
  assert.equal(script.async, true);
  globalRef.Library = { ready: true };
  script.dispatchEvent(new Event('load'));
  assert.equal(await first, globalRef.Library);
  assert.equal(await loadClassicScript('concurrent-library.js', options), globalRef.Library);
  assert.equal(documentRef.appended.length, 1);
});

test('failed classic scripts can be retried and successful unnamed scripts return the element', async () => {
  const documentRef = createDocument();
  const failed = assert.rejects(loadClassicScript('retry-library.js', { documentRef }), /Failed to load retry-library\.js/);
  documentRef.appended[0].dispatchEvent(new Event('error'));
  await failed;
  const retry = loadClassicScript('retry-library.js', { documentRef });
  assert.equal(documentRef.appended.length, 2);
  documentRef.appended[1].dispatchEvent(new Event('load'));
  assert.equal(await retry, documentRef.appended[1]);
});

test('an existing global API needs no document and missing documents fail without caching the failure', async () => {
  const api = {};
  assert.equal(await loadClassicScript('already-loaded.js', {
    documentRef: null, globalRef: { API: api }, globalName: 'API'
  }), api);
  await assert.rejects(loadClassicScript('later-document.js', { documentRef: null }), /without a document/);
  const documentRef = createDocument();
  const ready = loadClassicScript('later-document.js', { documentRef });
  documentRef.appended[0].dispatchEvent(new Event('load'));
  await ready;
  assert.equal(loadStylesheet('no-document.css', { documentRef: null }), null);
});

test('stylesheet readiness waits for every pending sheet and settles failed loads too', async () => {
  const documentRef = createDocument();
  const first = loadStylesheet('first-pending.css', { documentRef });
  const second = loadStylesheet('second-pending.css', { documentRef });
  assert.equal(loadStylesheet('first-pending.css', { documentRef }), first);
  assert.equal(documentRef.appended.length, 2);
  assert.equal(first.rel, 'stylesheet');
  assert.equal(first.href, 'first-pending.css');
  let ready = false;
  const waiting = waitForStylesheets().then(() => { ready = true; });
  first.dispatchEvent(new Event('load'));
  await flushMicrotasks();
  assert.equal(ready, false);
  second.dispatchEvent(new Event('error'));
  await waiting;
  assert.equal(ready, true);
  assert.equal(second.removed, true);
  const retry = loadStylesheet('second-pending.css', { documentRef });
  assert.notEqual(retry, second);
  retry.dispatchEvent(new Event('load'));
  await waitForStylesheets();
});

test('declared stylesheets are adopted without duplicate insertion and wait only while loading', async () => {
  for (const loaded of [false, true]) {
    const existing = Object.assign(new EventTarget(), { sheet: loaded ? {} : null });
    const documentRef = createDocument(existing);
    assert.equal(loadStylesheet(`declared-${loaded}.css`, { documentRef }), existing);
    assert.equal(documentRef.appended.length, 0);
    let ready = false;
    const waiting = waitForStylesheets().then(() => { ready = true; });
    await flushMicrotasks();
    assert.equal(ready, loaded);
    if (!loaded) existing.dispatchEvent(new Event('load'));
    await waiting;
  }
});
