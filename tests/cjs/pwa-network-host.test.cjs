'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const test = require('node:test');
const { createPwaNetworkFixture } = require('../helpers/pwa-network-fixture.cjs');

async function request(fixture, route, { method = 'GET', body, headers = {}, token = fixture.remote.token, ca } = {}) {
  const bytes = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const target = new URL(route, fixture.base);
    const req = (target.protocol === 'https:' ? https : http).request(target, {
      method, ca, headers: { Origin: fixture.origin, Authorization: `Bearer ${token}`, ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {}), ...headers }
    }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, text, data: res.headers['content-type']?.includes('json') && text ? JSON.parse(text) : null });
      });
    });
    req.on('error', reject); req.end(bytes);
  });
}
const post = (fixture, route, body) => request(fixture, `/pwa/v1/${route}`, { method: 'POST', body });
const openSocket = (fixture, route, origin, ca) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`${fixture.base.replace(/^http/, 'ws')}${route}?t=${fixture.remote.token}`, { ...(origin === undefined ? {} : { origin }), ca });
  ws.on('open', () => resolve(ws));
  ws.on('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode); });
  ws.on('error', reject);
});

test('PWA routes require exact Origin, Host and per-request bearer token while legacy websocket rules remain intact', { timeout: 15000 }, async t => {
  const fixture = await createPwaNetworkFixture(); t.after(fixture.close);
  fixture.serverHost.discovery.devices.set(fixture.player.id, fixture.player);
  assert.deepEqual((await fixture.serverHost.getState()).players, []);
  const info = await request(fixture, '/pwa/v1/info');
  assert.equal(info.status, 200); assert.equal(info.data.capabilities.playback, true);
  assert.equal(info.data.playerId, fixture.player.id);
  assert.equal(info.data.capabilities.browseViews.length, 9);
  assert.notEqual(info.data.playerId, info.data.libraryId);
  assert.equal(fixture.sidecar.starts, 0);
  for (const options of [{ headers: { Origin: 'https://evil.example' } }, { headers: { Origin: 'null' } }, { headers: { Host: 'evil.example' } }]) {
    assert.equal((await request(fixture, '/pwa/v1/info', options)).status, 403);
  }
  assert.equal((await request(fixture, '/pwa/v1/info', { token: 'bad' })).status, 401);
  assert.equal((await request(fixture, '/pwa/v1/info', { method: 'OPTIONS', token: '', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } })).status, 204);
  assert.equal((await request(fixture, '/pwa/v1/info', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'DELETE' } })).status, 403);
  const pwa = await openSocket(fixture, '/pwa/v1/effects', fixture.origin); t.after(() => pwa.terminate());
  const message = once(pwa, 'message'); pwa.send(JSON.stringify({ op: 'hello', v: 1, seq: 1 }));
  assert.equal(JSON.parse((await message)[0]).ok, true);
  assert.equal(await openSocket(fixture, '/pwa/v1/effects', 'https://evil.example'), 403);
  assert.equal(await openSocket(fixture, '/', fixture.origin), 403);
  const native = await openSocket(fixture, '/'); t.after(() => native.terminate());
  const nativeResponse = once(native, 'message'); native.send(JSON.stringify({ op: 'params', index: 0, params: { vl: -8 }, seq: 2 }));
  await nativeResponse;
  assert.equal(fixture.effects.pipeline[0].vl, -8, 'Legacy native client still edits this host');
  const pwaResponse = once(pwa, 'message'); pwa.send(JSON.stringify({ op: 'params', index: 0, params: { vl: -4 }, seq: 3 }));
  await pwaResponse;
  assert.equal(fixture.effects.pipeline[0].vl, -4, 'The PWA effects socket edits the same host owner');
});

test('browser grants share existing Range and revocation checks without exposing a control token or private library', { timeout: 15000 }, async t => {
  const fixture = await createPwaNetworkFixture(); t.after(fixture.close);
  const page = await post(fixture, 'browse', { objectId: 'view:tracks', count: 2 });
  assert.equal(page.status, 200); assert.equal(page.data.total, 4); assert.equal(page.data.numberReturned, 2);
  assert.equal((await post(fixture, 'browse', { objectId: 'view:tracks', query: 'Private' })).data.total, 0);
  const trackId = page.data.items[0].trackId;
  const browser = (await post(fixture, 'resolve', { trackId, audience: 'browser' })).data;
  const player = (await post(fixture, 'resolve', { trackId, audience: 'player' })).data;
  (await fixture.serverHost.getCatalog()).runtime.requestArtwork = async () => ({ bytes: Buffer.from('art'), mimeType: 'image/png' });
  const artwork = await request(fixture, browser.artwork, { token: '' });
  assert.equal(artwork.text, 'art'); assert.equal(artwork.headers['access-control-allow-origin'], fixture.origin);
  assert.equal(new URL(browser.uri).origin, fixture.base);
  assert.match(new URL(browser.uri).pathname, /^\/pwa\/v1\/media\/[A-Za-z0-9_-]{32}$/);
  assert.ok(!JSON.stringify(browser).includes(fixture.remote.token));
  assert.match(player.uri, /\/media\/[A-Za-z0-9_-]{32}$/); assert.ok(!player.uri.includes('/pwa/'));
  const read = options => request(fixture, browser.uri, { token: '', ...options });
  assert.equal((await read()).text, 'fLaCfixture');
  assert.equal((await read({ method: 'HEAD' })).headers['content-length'], '11');
  const part = await read({ headers: { Range: 'bytes=1-3' } });
  assert.equal(part.status, 206); assert.equal(part.text, 'LaC'); assert.equal(part.headers['access-control-allow-origin'], fixture.origin);
  assert.equal((await read({ headers: { Range: 'bytes=99-' } })).status, 416);
  assert.equal((await read({ headers: { Origin: 'https://evil.example' } })).status, 403);
  const token = fixture.remote.token; await fixture.remote.regenerateToken();
  assert.equal((await read()).status, 404);
  assert.equal((await request(fixture, '/pwa/v1/info', { token })).status, 401);
  const fresh = (await post(fixture, 'resolve', { trackId, audience: 'browser' })).data;
  await fixture.serverHost.setSharing({ enabled: true, folderIds: [] });
  assert.equal((await request(fixture, fresh.uri)).status, 404);
  assert.equal((await post(fixture, 'browse', { objectId: 'view:tracks' })).data.total, 0);
});

test('token renewal cancels pending local media registration without committing a stale renderer action', { timeout: 15000 }, async t => {
  const fixture = await createPwaNetworkFixture(); t.after(fixture.close);
  const page = (await post(fixture, 'browse', { objectId: 'view:tracks', count: 1 })).data;
  const track = (await post(fixture, 'resolve', { trackId: page.items[0].trackId, audience: 'player' })).data;
  const register = fixture.gateway.register.bind(fixture.gateway);
  let finish; let entered;
  const gate = new Promise(resolve => { finish = resolve; });
  const registered = new Promise(resolve => { entered = resolve; });
  fixture.gateway.register = async uri => { const result = await register(uri); entered(); await gate; return result; };
  const pending = post(fixture, 'player', { action: 'replace', tracks: [track], play: true });
  await registered; await fixture.remote.regenerateToken(); finish();
  assert.notEqual((await pending).status, 200);
  assert.equal(fixture.actions.filter(action => action.action === 'Insert').length, 0);
  assert.equal(fixture.gateway.registrations.size, 0);
  assert.equal(fixture.playerHost.pendingActions.size, 0);
  await fixture.playerHost.dispose();
  assert.equal(fixture.gateway.server, null, 'Local-only gateway is closed when its owner is disposed');
});

test('PWA TLS API and read grants stay on the trusted listener and reject mismatched certificates', { timeout: 15000 }, async t => {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore', windowsHide: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; t.skip('OpenSSL unavailable'); return; }
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-pwa-tls-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const cert = path.join(directory, 'cert.pem'); const key = path.join(directory, 'key.pem'); const config = path.join(directory, 'openssl.cnf');
  fs.writeFileSync(config, '[req]\ndistinguished_name=dn\n[dn]\n');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', config, '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'ignore', windowsHide: true });
  const fixture = await createPwaNetworkFixture({ env: { EFFETUNE_REMOTE_TLS_CERT: cert, EFFETUNE_REMOTE_TLS_KEY: key } }); t.after(fixture.close);
  const ca = fs.readFileSync(cert);
  assert.equal((await request(fixture, '/pwa/v1/info', { ca })).status, 200);
  const page = (await request(fixture, '/pwa/v1/browse', { method: 'POST', body: { objectId: 'view:tracks', count: 1 }, ca })).data;
  const resolved = (await request(fixture, '/pwa/v1/resolve', { method: 'POST', body: { trackId: page.items[0].trackId, audience: 'browser' }, ca })).data;
  assert.equal(new URL(resolved.uri).origin, fixture.base);
  assert.equal((await request(fixture, resolved.uri, { ca })).status, 200);
  await assert.rejects(request(fixture, '/pwa/v1/info'), /self-signed certificate/);
  await assert.rejects(request(fixture, fixture.base.replace('127.0.0.1', 'localhost') + '/pwa/v1/info', { ca }), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  const ws = await openSocket(fixture, '/pwa/v1/effects', fixture.origin, ca); ws.terminate();
});

test('PWA commands address the local queue with advertisement off, preserving order, duplicate starts and queue lifetime', { timeout: 15000 }, async t => {
  const fixture = await createPwaNetworkFixture(); t.after(fixture.close);
  const page = (await post(fixture, 'browse', { objectId: 'view:tracks', count: 2 })).data;
  const tracks = [];
  for (const item of page.items) tracks.push((await post(fixture, 'resolve', { trackId: item.trackId, audience: 'player' })).data);
  const response = await post(fixture, 'player', { action: 'replace', tracks: [tracks[0], tracks[1], tracks[0]], play: true, startIndex: 2, playerId: 'unrelated-remote-player' });
  assert.equal(response.status, 200); assert.equal(response.data.queue.length, 3);
  assert.equal(response.data.currentId, response.data.queue[2].id);
  assert.equal(response.data.queue[0].uri, response.data.queue[2].uri);
  assert.equal(response.data.transportState, 'Playing'); assert.equal(fixture.sidecar.starts, 0);
  assert.equal(fixture.playerHost.tokensByTrackId.size, 3);
  assert.ok(fixture.actions.filter(action => action.action === 'Insert').every(action => action.args.playbackUrl.startsWith('http://127.0.0.1:')));
  const before = fixture.queue.map(track => track.id);
  assert.equal((await post(fixture, 'player', { action: 'replace', tracks, startIndex: 2 })).status, 400);
  assert.deepEqual(fixture.queue.map(track => track.id), before);
  assert.equal((await post(fixture, 'player', { action: 'seek', seconds: 4 })).data.position, 4);
  await fixture.playerHost.setEnabled(true);
  assert.equal(fixture.sidecar.starts, 1);
  assert.equal((await request(fixture, '/pwa/v1/player')).data.queue.length, 3);
  await fixture.remote.stop();
  assert.equal(fixture.queue.length, 3, 'Closing control access must not clear the playback queue');
  assert.equal(fixture.playerHost.tokensByTrackId.size, 3);
  const destination = await createPwaNetworkFixture(); t.after(destination.close);
  assert.notEqual(destination.player.id, fixture.player.id);
  const remotePlayback = await post(destination, 'player', { action: 'replace', tracks, play: true });
  assert.equal(remotePlayback.status, 200);
  assert.equal(remotePlayback.data.queue[0].uri, tracks[0].uri, 'B reads A public shared URI without A control credentials');
  assert.equal(destination.sidecar.starts, 0);
  assert.equal(fixture.queue.length, 3, 'B commands do not mutate A playback');
  const sourceRead = await request(fixture, tracks[0].uri);
  assert.equal(sourceRead.status, 200, 'A shared music remains available after its PWA control listener stops');
  await destination.remote.stop();
  assert.equal(destination.queue.length, 2);
});
