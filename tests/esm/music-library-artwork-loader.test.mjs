import assert from 'node:assert/strict';
import test from 'node:test';

import { PagedArtworkLoader } from '../../js/ui/library/artwork-loader.js';

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createElement() {
  const classes = new Set();
  return {
    dataset: {},
    children: [],
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name)
    },
    ownerDocument: {
      createElement: () => ({
        listeners: {},
        addEventListener(type, listener) { this.listeners[type] = listener; },
        className: '',
        alt: '',
        src: ''
      })
    },
    replaceChildren(...children) { this.children = children; }
  };
}

test('intersection artwork loading enforces concurrency and releases cached object URLs', async () => {
  const pending = [deferred(), deferred(), deferred()];
  const calls = [];
  const revoked = [];
  const loader = new PagedArtworkLoader({
    maxConcurrency: 2,
    maxCacheEntries: 1,
    observerClass: null,
    urlApi: {
      createObjectURL(blob) { return `blob:${blob.size}:${calls.length}`; },
      revokeObjectURL(url) { revoked.push(url); }
    },
    loadArtwork: artworkId => {
      calls.push(artworkId);
      return pending[calls.length - 1].promise;
    }
  });
  const elements = [createElement(), createElement(), createElement()];
  elements.forEach((element, index) => loader.observe(element, `art-${index}`));
  assert.equal(calls.length, 2);

  pending[0].resolve(new Blob(['a']));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 3);
  pending[1].resolve(new Blob(['b']));
  pending[2].resolve(new Blob(['c']));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(loader.cache.size <= 1);
  loader.destroy();
  assert.equal(loader.cache.size, 0);
  assert.ok(revoked.length >= 2);
});

test('unsupported byte rows fail to a placeholder instead of entering the cache', async () => {
  const element = createElement();
  const loader = new PagedArtworkLoader({
    observerClass: null,
    loadArtwork: async () => new Uint8Array([1, 2, 3])
  });
  loader.observe(element, 'bad');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(element.classList.contains('library-artwork-error'), true);
  assert.equal(loader.cache.size, 0);
  loader.destroy();
});

test('observer lifecycle loads URL artwork and replaces a failed image with its placeholder', async () => {
  let intersectionCallback;
  const observed = [];
  const unobserved = [];
  let disconnected = false;
  class Observer {
    constructor(callback) { intersectionCallback = callback; }
    observe(element) { observed.push(element); }
    unobserve(element) { unobserved.push(element); }
    disconnect() { disconnected = true; }
  }

  const loader = new PagedArtworkLoader({
    observerClass: Observer,
    loadArtwork: async () => 'data:image/png;base64,AA=='
  });
  const element = createElement();
  const removed = createElement();
  loader.observe(element, 'url-art');
  loader.observe(removed, 'removed-art');
  loader.unobserve(removed);
  intersectionCallback([{ isIntersecting: false, target: removed }, { isIntersecting: true, target: element }]);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(observed, [element, removed]);
  assert.deepEqual(unobserved, [removed, element]);
  assert.equal(element.children[0].src, 'data:image/png;base64,AA==');
  element.children[0].listeners.error();
  assert.equal(element.classList.contains('library-artwork-error'), true);
  loader.destroy();
  assert.equal(disconnected, true);
});
