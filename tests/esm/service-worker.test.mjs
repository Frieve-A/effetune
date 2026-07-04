import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function createResponse(name, ok = true) {
  return {
    name,
    ok,
    clone() {
      return createResponse(`${name}:clone`, ok);
    }
  };
}

function loadServiceWorker(options = {}) {
  const source = fs.readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  const listeners = new Map();
  const putCalls = [];
  const matchCalls = [];
  const fetchCalls = [];

  const cache = {
    async addAll() {},
    async put(request, response) {
      putCalls.push([request, response]);
    }
  };
  const caches = {
    async open() {
      return cache;
    },
    async keys() {
      return [];
    },
    async delete() {
      return true;
    },
    async match(request) {
      matchCalls.push(request);
      return options.matchResponse ?? null;
    }
  };
  const selfRef = {
    location: {
      href: 'https://example.test/sw.js',
      origin: 'https://example.test'
    },
    EFFECTUNE_CACHE_VERSION: 'test-cache',
    EFFECTUNE_PRECACHE_URLS: [],
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    skipWaiting() {},
    clients: {
      claim() {}
    }
  };
  const context = {
    self: selfRef,
    caches,
    URL,
    importScripts() {},
    fetch: async request => {
      fetchCalls.push(request);
      if (options.fetchReject) throw new Error('network failed');
      return options.fetchResponse ?? createResponse(request.url);
    }
  };
  vm.runInNewContext(source, context);
  return { fetchCalls, listeners, matchCalls, putCalls };
}

function createNavigateRequest(url) {
  return {
    method: 'GET',
    mode: 'navigate',
    url
  };
}

async function dispatchFetch(listener, request) {
  let responsePromise = null;
  listener({
    request,
    respondWith(promise) {
      responsePromise = Promise.resolve(promise);
    }
  });
  return responsePromise;
}

test('service worker stores only effetune.html navigations as the app shell', async () => {
  const worker = loadServiceWorker();
  const request = createNavigateRequest('https://example.test/effetune.html?p=shared');

  await dispatchFetch(worker.listeners.get('fetch'), request);

  assert.equal(worker.putCalls.length, 1);
  assert.equal(worker.putCalls[0][0], './effetune.html');
});

test('service worker does not overwrite app shell cache for docs navigations', async () => {
  const worker = loadServiceWorker();
  const request = createNavigateRequest('https://example.test/docs/index.html');

  await dispatchFetch(worker.listeners.get('fetch'), request);

  assert.equal(worker.putCalls.length, 1);
  assert.equal(worker.putCalls[0][0], request);
});

test('service worker falls back to same-request cache for non-app navigations', async () => {
  const cachedResponse = createResponse('cached-doc');
  const worker = loadServiceWorker({
    fetchReject: true,
    matchResponse: cachedResponse
  });
  const request = createNavigateRequest('https://example.test/docs/index.html');

  const response = await dispatchFetch(worker.listeners.get('fetch'), request);

  assert.equal(response, cachedResponse);
  assert.equal(worker.matchCalls[0], request);
});
