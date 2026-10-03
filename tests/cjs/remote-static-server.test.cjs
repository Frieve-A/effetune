'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WebSocket } = require('ws');
const {
  createStaticHandler, isAllowedHost, isAllowedOrigin
} = require('../../electron/remote-static-server.cjs');
const { RemoteControlHost } = require('../../electron/remote-control-host.cjs');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-static-'));
  const files = {
    'remote.html': '<!doctype html><title>remote</title>',
    'effetune.html': '<!doctype html><title>app</title>',
    'sw.js': '// service worker',
    'manifest.json': '{}',
    'config.json': '{"secret":true}',
    'js/remote/a.mjs': 'export const a = 1;',
    'js/b.js': 'export const b = 2;',
    'js/locales/en.json5': '{}',
    'plugins/dsp/x.wasm': 'wasm',
    'electron/main.js': '// main',
    'package.json': '{"name":"x"}'
  };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  const urls = ['remote.html', 'effetune.html', 'sw.js', 'manifest.json', 'package.json',
    'js/remote/a.mjs', 'js/b.js', 'js/locales/en.json5', 'plugins/dsp/x.wasm'];
  fs.writeFileSync(path.join(root, 'sw-precache.js'),
    `self.EFFECTUNE_CACHE_VERSION = "x";\nself.EFFECTUNE_PRECACHE_URLS = ${JSON.stringify(urls.map(u => `./${u}`))};\n`);
  return root;
}

function listen(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function request(port, { method = 'GET', url = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers, setHost: !('Host' in headers) },
      res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      });
    req.on('error', reject);
    req.end();
  });
}

test('static server answers the entry page with a connect-src for its own host', async () => {
  const root = makeRoot();
  const { server, port } = await listen(createStaticHandler({ root }));
  try {
    const res = await request(port);
    assert.equal(res.status, 200);
    assert.match(res.body, /<title>remote<\/title>/);
    assert.equal(res.headers['content-security-policy'], `connect-src 'self' ws://127.0.0.1:${port}`);
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    const query = await request(port, { url: '/?t=abcd' });
    assert.equal(query.status, 200);
  } finally {
    server.close();
  }
});

test('static server serves modules, locales and wasm with the right types', async () => {
  const root = makeRoot();
  const { server, port } = await listen(createStaticHandler({ root }));
  try {
    const mjs = await request(port, { url: '/js/remote/a.mjs' });
    assert.equal(mjs.status, 200);
    assert.match(mjs.headers['content-type'], /^text\/javascript/);
    assert.equal(mjs.headers['content-security-policy'], undefined);
    assert.match((await request(port, { url: '/js/locales/en.json5' })).headers['content-type'], /json/);
    assert.equal((await request(port, { url: '/plugins/dsp/x.wasm' })).headers['content-type'], 'application/wasm');
    const head = await request(port, { method: 'HEAD', url: '/js/b.js' });
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.equal(head.headers['content-length'], String('export const b = 2;'.length));
  } finally {
    server.close();
  }
});

test('static server refuses other methods and foreign Host headers', async () => {
  const root = makeRoot();
  const { server, port } = await listen(createStaticHandler({ root }));
  try {
    const post = await request(port, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, 'GET, HEAD');
    assert.equal((await request(port, { headers: { Host: 'evil.example' } })).status, 403);
    assert.equal((await request(port, { headers: { Host: `evil.example:${port}` } })).status, 403);
    assert.equal((await request(port, { headers: { Host: `localhost:${port}` } })).status, 200);
    assert.equal((await request(port, { headers: { Host: 'my-pc.local' } })).status, 200);
  } finally {
    server.close();
  }
});

test('static server hides everything outside the precache list and rejects traversal', async () => {
  const root = makeRoot();
  const { server, port } = await listen(createStaticHandler({ root }));
  try {
    for (const url of [
      '/effetune.html', '/sw.js', '/manifest.json', '/sw-precache.js', '/config.json', '/electron/main.js',
      '/%2e%2e/package.json', '/..%2fpackage.json', '/js/../electron/main.js', '/%5c..', '/%00',
      '/node_modules/ws/package.json', '/js/', '/js/missing.js'
    ]) {
      const res = await request(port, { url });
      assert.equal(res.status, 404, url);
    }
    assert.equal((await request(port, { url: '/%E0%A4%A' })).status, 400);
    assert.equal((await request(port, { url: '/package.json' })).status, 200);
  } finally {
    server.close();
  }
});

test('static server serves nothing when the precache list is unreadable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-static-empty-'));
  fs.writeFileSync(path.join(root, 'remote.html'), 'x');
  const logs = [];
  const { server, port } = await listen(createStaticHandler({ root, log: message => logs.push(message) }));
  try {
    assert.equal((await request(port)).status, 404);
    assert.equal(logs.length, 1);
  } finally {
    server.close();
  }
});

test('origin check accepts only a same-origin page or a client without Origin', () => {
  assert.equal(isAllowedOrigin(undefined, '127.0.0.1:47300'), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:47300', '127.0.0.1:47300'), true);
  assert.equal(isAllowedOrigin('http://192.168.1.5:47300', '192.168.1.5:47300'), true);
  assert.equal(isAllowedOrigin('http://evil.example', '127.0.0.1:47300'), false);
  assert.equal(isAllowedOrigin('https://127.0.0.1:47300', '127.0.0.1:47300'), false);
  assert.equal(isAllowedOrigin('http://127.0.0.1:1', '127.0.0.1:47300'), false);
  assert.equal(isAllowedOrigin('null', '127.0.0.1:47300'), false);
  assert.equal(isAllowedOrigin('chrome-extension://abc', '127.0.0.1:47300'), false);
  assert.equal(isAllowedOrigin('http://127.0.0.1:47300', 'evil.example'), false);
  assert.equal(isAllowedOrigin(5, '127.0.0.1:47300'), false);
});

test('host check accepts literal addresses and local names only', () => {
  for (const host of ['127.0.0.1', '192.168.0.2:47300', 'localhost', 'localhost:8080', '[::1]:47300',
    '[fe80::1]', 'Pixel.local', 'a.b.local:1']) {
    assert.equal(isAllowedHost(host), true, host);
  }
  for (const host of ['', undefined, 'evil.example', 'evil.example:47300', '999.1.1.1', '1.2.3.4:99999',
    '1.2.3.4:', 'foo.local.evil.com', 'x y', '127.0.0.1:47300;', '[::1', 'a'.repeat(300)]) {
    assert.equal(isAllowedHost(host), false, String(host));
  }
});

function makeHost(port, token) {
  const logs = [];
  const app = {
    getAppPath: () => path.resolve(__dirname, '..', '..'),
    getVersion: () => '0.0.0-test',
    isPackaged: true
  };
  const host = new RemoteControlHost({
    app,
    getMainWindow: () => null,
    env: { EFFETUNE_REMOTE: '1', EFFETUNE_REMOTE_PORT: String(port), EFFETUNE_REMOTE_TOKEN: token },
    argv: [],
    log: message => logs.push(message)
  });
  return { host, logs };
}

function connect(port, { origin, hostHeader, token = 'tok-static' } = {}) {
  return new Promise(resolve => {
    const options = {};
    if (origin !== undefined) options.origin = origin;
    if (hostHeader !== undefined) options.headers = { Host: hostHeader };
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?t=${token}`, options);
    const closed = new Promise(done => ws.on('close', code => done(code)));
    ws.on('open', () => resolve({ ws, opened: true, closed }));
    ws.on('unexpected-response', (_req, res) => { resolve({ status: res.statusCode }); res.resume(); });
    ws.on('error', () => {});
  });
}

test('upgrade refuses foreign origins, accepts clients without Origin, closes bad tokens with 4401', async () => {
  const port = 47390;
  const { host } = makeHost(port, 'tok-static');
  try {
    assert.equal(await host.start(), true);
    const evil = await connect(port, { origin: 'http://evil.example' });
    assert.equal(evil.status, 403);
    const nullOrigin = await connect(port, { origin: 'null' });
    assert.equal(nullOrigin.status, 403);
    const same = await connect(port, { origin: `http://127.0.0.1:${port}` });
    assert.equal(same.opened, true);
    same.ws.close();
    const none = await connect(port);
    assert.equal(none.opened, true);
    none.ws.close();
    const bad = await connect(port, { token: 'wrong-token' });
    assert.equal(await bad.closed, 4401);
  } finally {
    await host.dispose();
  }
});

test('a client that cannot keep up misses pushes and receives the latest state once drained', () => {
  const { host } = makeHost(47391, 'tok-static');
  const sent = [];
  const slow = { authenticated: true, readyState: 1, bufferedAmount: 5 * 1024 * 1024, send: m => sent.push(['slow', m]) };
  const fast = { authenticated: true, readyState: 1, bufferedAmount: 0, send: m => sent.push(['fast', m]) };
  host.wss = { clients: new Set([slow, fast]) };
  host.snapshot = { masterBypass: false, pipeline: [{ nm: 'Volume' }] };
  host.rev = 3;
  host.broadcastState();
  host.snapshot = { masterBypass: false, pipeline: [{ nm: 'Volume', vl: -2 }] };
  host.rev = 4;
  host.broadcastState();
  assert.equal(sent.filter(([who]) => who === 'slow').length, 0);
  assert.equal(sent.filter(([who]) => who === 'fast').length, 2);
  assert.equal(slow.stateDirty, true);
  host.flushDirtyClients();
  assert.equal(sent.filter(([who]) => who === 'slow').length, 0, 'still backed up');
  slow.bufferedAmount = 0;
  host.flushDirtyClients();
  host.flushDirtyClients();
  const received = sent.filter(([who]) => who === 'slow').map(([, m]) => JSON.parse(m));
  assert.equal(received.length, 1);
  assert.equal(received[0].rev, 4);
  assert.equal(received[0].origin, 'remote');
  assert.equal('seq' in received[0], false);
  assert.equal(slow.stateDirty, false);
  host.wss = null;
});

test('upgrade applies the Host rule only to browser requests (those with an Origin)', async () => {
  const port = 47391;
  const { host } = makeHost(port, 'tok-static');
  try {
    assert.equal(await host.start(), true);
    const hostHeader = `mypc:${port}`;
    // Native-client style: any host name the user typed, no Origin.
    const native = await connect(port, { hostHeader });
    assert.equal(native.opened, true);
    native.ws.close();
    // Browser-style: same Host name, but with an Origin -> DNS-rebinding defence applies.
    const browser = await connect(port, { hostHeader, origin: `http://mypc:${port}` });
    assert.equal(browser.status, 403);
  } finally {
    await host.dispose();
  }
});
