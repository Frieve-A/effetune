import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const {
  buildPrecacheSource,
  generatePrecache
} = require('../../scripts/generate-sw-precache.js');

function createResponse(name, ok = true) {
  return {
    name,
    ok,
    clone() {
      return createResponse(`${name}:clone`, ok);
    }
  };
}

class StubRequest {
  constructor(url, init = {}) {
    this.url = url;
    this.cache = init.cache;
  }
}

function loadServiceWorker(options = {}) {
  const source = fs.readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  const listeners = new Map();
  const addAllCalls = [];
  const putCalls = [];
  const matchCalls = [];
  const fetchCalls = [];

  const cache = {
    async addAll(requests) {
      addAllCalls.push(requests);
    },
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
    EFFECTUNE_PRECACHE_URLS: options.precacheUrls ?? [],
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
    Request: StubRequest,
    importScripts() {},
    fetch: async request => {
      fetchCalls.push(request);
      if (options.fetchReject) throw new Error('network failed');
      return options.fetchResponse ?? createResponse(request.url);
    }
  };
  vm.runInNewContext(source, context);
  return { addAllCalls, fetchCalls, listeners, matchCalls, putCalls };
}

function loadPrecacheUrls() {
  const source = fs.readFileSync(new URL('../../sw-precache.js', import.meta.url), 'utf8');
  const selfRef = {};
  vm.runInNewContext(source, { self: selfRef });
  return new Set(selfRef.EFFECTUNE_PRECACHE_URLS);
}

function writeFixtureFile(root, relativePath, contents = `${relativePath}\n`) {
  const filePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function createPrecacheFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-precache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const directory of ['js', 'plugins', 'images', 'presets']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }

  for (const relativePath of [
    'effetune.html',
    'effetune.css',
    'effetune-mobile.css',
    'effetune-library.css',
    'manifest.json',
    'sw.js'
  ]) {
    writeFixtureFile(root, relativePath);
  }

  writeFixtureFile(root, 'package.json', JSON.stringify({ version: '9.9.9' }));
  writeFixtureFile(root, 'features/effetune-benchmark.js', 'export const benchmark = true;\n');
  writeFixtureFile(root, 'js/app.js', 'console.log("first");\n');
  writeFixtureFile(root, 'plugins/plugins.txt', 'plugins/test.js\n');
  writeFixtureFile(root, 'plugins/test.js', 'class TestPlugin {}\n');
  writeFixtureFile(root, 'plugins/dsp/effetune-dsp.wasm', Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  writeFixtureFile(root, 'plugins/dsp/effetune-dsp.debug.wasm', Buffer.from([0, 97, 115, 109]));
  writeFixtureFile(root, 'images/icon.png', Buffer.from([0, 1, 2, 3]));
  writeFixtureFile(root, 'presets/test.effetune_preset', 'preset=first\n');

  return root;
}

function collectPresetUrls(directoryUrl = new URL('../../presets/', import.meta.url), prefix = 'presets') {
  const urls = [];
  for (const entry of fs.readdirSync(directoryUrl, { withFileTypes: true })) {
    const relativePath = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      urls.push(...collectPresetUrls(new URL(`${entry.name}/`, directoryUrl), relativePath));
    } else if (entry.name === 'presets.txt' || entry.name.endsWith('.effetune_preset')) {
      urls.push(`./${relativePath}`);
    }
  }
  return urls.sort();
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

test('precache contains system preset metadata and preset files', () => {
  const precacheUrls = loadPrecacheUrls();
  const presetUrls = collectPresetUrls();

  assert.ok(presetUrls.some(url => url.endsWith('.effetune_preset')));
  for (const presetUrl of presetUrls) {
    assert.ok(precacheUrls.has(presetUrl), `${presetUrl} should be precached`);
  }
});

test('committed precache source matches the current precached assets', () => {
  const committedSource = fs.readFileSync(
    new URL('../../sw-precache.js', import.meta.url),
    'utf8'
  );

  assert.equal(committedSource, buildPrecacheSource().body);
});

test('precache contains committed baseline and SIMD DSP modules', () => {
  const precacheUrls = loadPrecacheUrls();

  assert.ok(precacheUrls.has('./plugins/dsp/effetune-dsp.wasm'));
  assert.ok(precacheUrls.has('./plugins/dsp/effetune-dsp.simd.wasm'));
  assert.ok(precacheUrls.has('./plugins/dsp/effetune-dsp.meta.json'));
});

test('precache contains the performance benchmark runtime', () => {
  const precacheUrls = loadPrecacheUrls();

  assert.ok(precacheUrls.has('./features/effetune-benchmark.js'));
});

test('precache includes release WebAssembly DSP artifacts and omits debug builds', t => {
  const root = createPrecacheFixture(t);
  const { urls } = buildPrecacheSource({ root });

  assert.ok(urls.includes('plugins/dsp/effetune-dsp.wasm'));
  assert.equal(urls.includes('plugins/dsp/effetune-dsp.debug.wasm'), false);
});

test('precache cache version changes when precached asset content changes', t => {
  const root = createPrecacheFixture(t);
  const first = buildPrecacheSource({ root });

  writeFixtureFile(root, 'js/app.js', 'console.log("second");\n');
  const second = buildPrecacheSource({ root });

  assert.deepEqual(second.urls, first.urls);
  assert.match(first.cacheVersion, /^effetune-v9\.9\.9-[a-f0-9]{16}$/);
  assert.match(second.cacheVersion, /^effetune-v9\.9\.9-[a-f0-9]{16}$/);
  assert.notEqual(second.cacheVersion, first.cacheVersion);
  assert.notEqual(second.body, first.body);
});

test('precache cache version ignores text line-ending differences', t => {
  const root = createPrecacheFixture(t);
  writeFixtureFile(root, 'js/app.js', 'const first = true;\nconst second = true;\n');
  const lf = buildPrecacheSource({ root });

  writeFixtureFile(root, 'js/app.js', 'const first = true;\r\nconst second = true;\r\n');
  const crlf = buildPrecacheSource({ root });

  assert.equal(crlf.digest, lf.digest);
  assert.equal(crlf.cacheVersion, lf.cacheVersion);
  assert.equal(crlf.body, lf.body);
});

test('precache cache version preserves binary byte differences', t => {
  const root = createPrecacheFixture(t);
  writeFixtureFile(root, 'images/icon.png', Buffer.from([0x0d, 0x0a]));
  const crlf = buildPrecacheSource({ root });

  writeFixtureFile(root, 'images/icon.png', Buffer.from([0x0a]));
  const lf = buildPrecacheSource({ root });

  assert.notEqual(lf.digest, crlf.digest);
  assert.notEqual(lf.cacheVersion, crlf.cacheVersion);
});

test('precache check succeeds for fresh output and rejects stale output without rewriting it', t => {
  const root = createPrecacheFixture(t);
  const fixtureScript = path.join(root, 'scripts', 'generate-sw-precache.js');
  fs.mkdirSync(path.dirname(fixtureScript), { recursive: true });
  fs.copyFileSync(
    new URL('../../scripts/generate-sw-precache.js', import.meta.url),
    fixtureScript
  );
  generatePrecache({ root });

  const fresh = spawnSync(process.execPath, [fixtureScript, '--check'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(fresh.status, 0, fresh.stderr);

  const generatedSource = fs.readFileSync(path.join(root, 'sw-precache.js'), 'utf8');
  writeFixtureFile(root, 'js/app.js', 'console.log("stale");\n');
  const stale = spawnSync(process.execPath, [fixtureScript, '--check'], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /sw-precache\.js is stale/);
  assert.equal(fs.readFileSync(path.join(root, 'sw-precache.js'), 'utf8'), generatedSource);
});

test('service worker precaches with HTTP-cache-bypassing reload requests', async () => {
  const worker = loadServiceWorker({ precacheUrls: ['./a.js', './b.css'] });
  let waited = null;

  worker.listeners.get('install')({
    waitUntil(promise) {
      waited = promise;
    }
  });

  await waited;

  assert.equal(worker.addAllCalls.length, 1);
  const requests = worker.addAllCalls[0];
  assert.deepEqual(requests.map(request => request.url), ['./a.js', './b.css']);
  for (const request of requests) {
    assert.equal(request.cache, 'reload');
  }
});

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
