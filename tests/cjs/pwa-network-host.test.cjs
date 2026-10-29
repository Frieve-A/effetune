'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { once, EventEmitter } = require('node:events');
const { Readable, Writable } = require('node:stream');
const { WebSocket } = require('ws');
const test = require('node:test');
const { createPwaNetworkFixture } = require('../helpers/pwa-network-fixture.cjs');
const { LocalOpenHomePlayer, PwaNetworkHost } = require('../../electron/pwa-network-host.cjs');
const { supportsProtocol } = require('../../electron/network-music-host.cjs');
const { parseDidl } = require('../../electron/network-music-upnp.cjs');

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

test('host-local OpenHome volume and mute use the existing player owner and preserve an independent volume', async () => {
  const state = { volume: 70, volumeLimit: 100, mute: false };
  const player = new LocalOpenHomePlayer({ ensureDeviceId: () => ({ openHomeDeviceId: 'volume-fixture' }), requestLocalAction: async (service, action, args) => {
    assert.equal(service, 'Volume');
    if (action === 'SetVolume') state.volume = args.volume;
    else if (action === 'SetMute') state.mute = args.mute;
    return state;
  } });
  await player.invoke('Volume', 'SetVolume', { Value: 25 });
  await player.invoke('Volume', 'SetMute', { Value: 1 });
  assert.equal((await player.invoke('Volume', 'Mute')).Value, '1');
  assert.equal((await player.invoke('Volume', 'Volume')).Value, 25);
  await player.invoke('Volume', 'SetMute', { Value: 0 });
  assert.equal((await player.invoke('Volume', 'Mute')).Value, '0');
  assert.equal(state.volume, 25);
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

test('development origins support preflight, authenticated API, media and effects without allowing other websites', { timeout: 15000 }, async t => {
  const fixture = await createPwaNetworkFixture(); t.after(fixture.close);
  for (const origin of ['http://127.0.0.1:8000', 'http://localhost:8000', 'http://127.0.0.1:8080']) {
    const headers = { Origin: origin };
    const preflight = await request(fixture, '/pwa/v1/info', { method: 'OPTIONS', token: '', headers: {
      ...headers, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization'
    } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], origin);
    const info = await request(fixture, '/pwa/v1/info', { headers });
    assert.equal(info.status, 200);
    assert.equal(info.headers['access-control-allow-origin'], origin);
    assert.equal(info.headers.vary, 'Origin');
    assert.equal((await request(fixture, '/pwa/v1/info', { headers, token: 'bad' })).status, 401);
    assert.equal((await request(fixture, '/pwa/v1/info', { headers: { ...headers, Host: 'evil.example' } })).status, 403);
    const page = await request(fixture, '/pwa/v1/browse', { method: 'POST', headers, body: { objectId: 'view:tracks', count: 1 } });
    assert.equal(page.status, 200);
    const media = await request(fixture, page.data.items[0].uri, { headers, token: '' });
    assert.equal(media.status, 200);
    assert.equal(media.headers['access-control-allow-origin'], origin);
    const socket = await openSocket(fixture, '/pwa/v1/effects', origin); t.after(() => socket.terminate());
    const message = once(socket, 'message'); socket.send(JSON.stringify({ op: 'hello', v: 1, seq: 1 }));
    assert.equal(JSON.parse((await message)[0]).ok, true);
    assert.equal(await openSocket(fixture, '/', origin), 403);
  }
  for (const origin of ['null', 'http://192.168.10.40:8000', 'http://localhost.evil.example:8000', 'http://127.0.0.1:8000/path', 'http://user@localhost:8000', 'https://evil.example']) {
    const response = await request(fixture, '/pwa/v1/info', { headers: { Origin: origin } });
    assert.equal(response.status, 403);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.equal(await openSocket(fixture, '/pwa/v1/effects', origin), 403);
  }
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
  assert.equal((await post(fixture, 'player', { action: 'replace', tracks, play: true, playerId: 'unrelated-remote-player' })).status, 403);
  const response = await post(fixture, 'player', { action: 'replace', tracks: [tracks[0], tracks[1], tracks[0]], play: true, startIndex: 2, playerId: fixture.player.id });
  assert.equal(response.status, 200); assert.equal(response.data.queue.length, 3);
  assert.equal(response.data.currentId, response.data.queue[2].id);
  assert.equal(fixture.queue[0].uri, fixture.queue[2].uri);
  assert.equal(Object.hasOwn(response.data.queue[0], 'uri'), false);
  assert.equal(Object.hasOwn(response.data.queue[0], 'metadata'), false);
  assert.ok(page.items[0].mediaKeys.length > 0);
  assert.ok(response.data.queue[0].mediaKeys.some(key => page.items[0].mediaKeys.includes(key)));
  assert.ok(response.data.queue[2].mediaKeys.some(key => page.items[0].mediaKeys.includes(key)));
  assert.notDeepEqual(response.data.queue[1].mediaKeys, page.items[0].mediaKeys);
  assert.ok(page.items[0].mediaKeys.every(key => /^[a-f0-9]{64}$/.test(key)));
  const albums = (await post(fixture, 'browse', { objectId: 'view:albums', count: 100 })).data;
  const albumId = albums.items.find(item => item.title === page.items[0].album).id;
  const album = (await post(fixture, 'browse', { objectId: albumId, count: 100 })).data;
  for (const item of album.items) {
    const listed = page.items.find(track => track.trackId === (item.refId || item.trackId));
    if (listed) assert.deepEqual(item.mediaKeys, listed.mediaKeys, 'album and track lists identify the same recording');
  }
  assert.ok(album.items.some(item => page.items.some(track => track.trackId === (item.refId || item.trackId))));
  assert.match(response.data.queue[0].artwork, /\/pwa\/v1\/artwork\//);
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
  assert.equal(destination.queue[0].uri, tracks[0].uri, 'B reads A public shared URI without A control credentials');
  const destinationState = (await request(destination, '/pwa/v1/player')).data;
  assert.ok(destinationState.queue[0].mediaKeys.some(key => page.items[0].mediaKeys.includes(key)));
  assert.equal(destination.sidecar.starts, 0);
  assert.equal(fixture.queue.length, 3, 'B commands do not mutate A playback');
  const sourceRead = await request(fixture, tracks[0].uri);
  assert.equal(sourceRead.status, 200, 'A shared music remains available after its PWA control listener stops');
  await destination.remote.stop();
  assert.equal(destination.queue.length, 2);
});

test('same-host PWA catalog selection uses one batch and exposes matching private-safe track keys', { timeout: 30000 }, async t => {
  const fixture = await createPwaNetworkFixture(); t.after(fixture.close);
  const page = (await post(fixture, 'browse', { objectId: 'view:tracks', count: 2 })).data;
  const uid = fixture.serverHost.server.tokens.get(page.items[0].trackId.split(':')[1]);
  const batches = [];
  fixture.player.playCatalogItems = async args => {
    batches.push(args);
    fixture.queue.push({ id: 1, uri: '', metadata: '', libraryTrackId: uid });
  };
  const items = Array.from({ length: 4096 }, () => ({ trackId: page.items[0].trackId }));
  const result = await post(fixture, 'player', { action: 'replace', playerId: fixture.player.id, items, startIndex: 2048, play: true });
  assert.equal(result.status, 200, result.text);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].items.length, 4096);
  assert.equal(batches[0].startIndex, 2048);
  assert.equal(batches[0].operationKind, 'play');
  assert.deepEqual(batches[0].items[0], { serverId: 'local', trackId: uid });
  assert.equal(fixture.actions.some(action => ['Insert', 'DeleteAll'].includes(action.action)), false);
  assert.ok(result.data.queue[0].mediaKeys.some(key => page.items[0].mediaKeys.includes(key)));
  assert.equal(Object.hasOwn(result.data.queue[0], 'libraryTrackId'), false);
  const artworkUrl = result.data.queue[0].artwork;
  assert.equal(artworkUrl, page.items[0].artwork);
  assert.equal((await request(fixture, '/pwa/v1/player')).data.queue[0].artwork, artworkUrl);
  const catalog = await fixture.serverHost.getCatalog();
  catalog.runtime.requestArtwork = async ({ trackUid }) => {
    assert.equal(trackUid, uid);
    return { bytes: Buffer.from('catalog artwork'), mimeType: 'image/png' };
  };
  const artwork = await request(fixture, artworkUrl, { token: '' });
  assert.equal(artwork.status, 200);
  assert.equal(artwork.text, 'catalog artwork');
  assert.equal(artwork.headers['access-control-allow-origin'], fixture.origin);
  fixture.queue.push({ id: 2, uri: '', metadata: '', libraryTrackId: 'private-a' });
  assert.equal((await request(fixture, '/pwa/v1/player')).data.queue[1].artwork, '');
  assert.equal((await post(fixture, 'player', { action: 'replace', items: [{ trackId: 'track:unknown' }] })).status, 400);
  await fixture.serverHost.setSharing({ enabled: false, folderIds: [] });
  assert.equal((await request(fixture, artworkUrl, { token: '' })).status, 404);
  assert.equal((await request(fixture, '/pwa/v1/player')).data.queue[0].artwork, '');
  const denied = await post(fixture, 'player', { action: 'replace', items: [items[0]] });
  assert.notEqual(denied.status, 200);
  assert.equal(batches.length, 1);
});

test('third-party source grants distinguish browser and player audiences across two registered gateways', { timeout: 15000 }, async t => {
  const source = await createPwaNetworkFixture(); const destination = await createPwaNetworkFixture();
  t.after(source.close); t.after(destination.close);
  const page = (await post(source, 'browse', { objectId: 'view:tracks', count: 1 })).data;
  const track = (await post(source, 'resolve', { trackId: page.items[0].trackId, audience: 'player' })).data;
  const sourceId = 'uuid:third-party-library';
  source.serverHost.discovery.devices.set(sourceId, { id: sourceId, name: 'Third-party music', available: true,
    services: new Map([['urn:schemas-upnp-org:service:ContentDirectory', { type: 'urn:schemas-upnp-org:service:ContentDirectory:1' }]]) });
  const browse = source.serverHost.browse.bind(source.serverHost);
  const resolve = source.serverHost.resolveTrack.bind(source.serverHost);
  source.serverHost.browse = request => request.serverId === sourceId ? Promise.resolve({ items: [{ ...track, id: 'remote-track', trackId: 'remote-track' }], total: 1, start: 0 }) : browse(request);
  source.serverHost.resolveTrack = request => request.serverId === sourceId ? Promise.resolve({ ...track, id: 'remote-track', trackId: 'remote-track' }) : resolve(request);
  assert.deepEqual((await request(source, '/pwa/v1/info')).data.libraries, []);
  assert.equal((await post(source, 'browse', { serverId: sourceId })).status, 403);
  await source.serverHost.configure({ gatewayPermissions: { libraries: true, players: false } });
  assert.equal((await request(source, '/pwa/v1/info')).data.libraries[0].id, sourceId);
  const listed = (await post(source, 'browse', { serverId: sourceId })).data.items[0];
  assert.equal(new URL(listed.uri).origin, source.base);
  const browser = (await post(source, 'resolve', { serverId: sourceId, trackId: 'remote-track', audience: 'browser' })).data;
  assert.equal((await request(source, browser.uri, { headers: { Range: 'bytes=0-3' } })).text, 'fLaC');
  assert.equal((await request(source, browser.uri, { method: 'HEAD' })).headers['content-length'], '11');
  assert.equal((await request(source, browser.uri, { headers: { Origin: '' } })).status, 403);
  assert.equal((await post(destination, 'player', { action: 'replace', tracks: [browser], play: true, playerId: destination.player.id })).status, 403);
  const intent = { origin: destination.base, hostId: destination.serverHost.id, playerId: destination.player.id };
  const player = (await post(source, 'resolve', { serverId: sourceId, trackId: 'remote-track', audience: 'player', target: intent })).data;
  const later = (await post(source, 'resolve', { serverId: sourceId, trackId: 'later-track', audience: 'player', target: intent })).data;
  assert.equal((await post(destination, 'player', { action: 'replace', tracks: [player, later], play: true, playerId: destination.player.id })).status, 200);
  assert.equal(destination.queue.length, 2);
  const laterTime = Date.now() + 2 * 3600000;
  t.mock.method(Date, 'now', () => laterTime);
  const laterResponse = await fetch(later.uri, { headers: { Range: 'bytes=0-3' } });
  assert.equal(laterResponse.status, 206, 'A later queued resource remains usable after the browser has gone away for over an hour');
  assert.equal(await laterResponse.text(), 'fLaC');
  assert.equal((await post(destination, 'player', { action: 'replace', tracks: [{ ...player, resources: [{ uri: 'https://other.example/unrelated', protocolInfo: 'http-get:*:audio/flac:*' }] }], play: true })).status, 400);
  assert.equal((await post(source, 'resolve', { serverId: 'http://arbitrary.example', trackId: 'x', audience: 'browser' })).status, 403);
  await source.serverHost.configure({ gatewayPermissions: { libraries: false, players: false } });
  assert.equal((await request(source, browser.uri)).status, 404);
  assert.equal((await request(source, later.uri)).status, 404);
  assert.equal((await post(destination, 'player', { action: 'replace', tracks: [player], play: true })).status, 403);
});

test('PWA refreshes a partially applied command and reports its unknown outcome without repeating it', { timeout: 15000 }, async t => {
  const fixture = await createPwaNetworkFixture(); t.after(fixture.close);
  let calls = 0; let reads = 0;
  fixture.serverHost.playerCommand = async command => { calls++; command.mutationStarted = true; throw Object.assign(new Error('private diagnostic'), { code: 'unavailable' }); };
  fixture.serverHost.getPlayerState = async () => { reads++; return { playerId: fixture.player.controlId, queue: [{ id: 1, title: 'Current', uri: 'https://server.example/?password=secret' }], capabilities: {} }; };
  const reply = await post(fixture, 'player', { action: 'play', playerId: fixture.player.id });
  assert.equal(reply.status, 409); assert.equal(reply.data.outcome, 'unknown'); assert.equal(calls, 1); assert.equal(reads, 1);
  assert.equal(reply.data.playback.queue[0].title, 'Current');
  assert.equal(JSON.stringify(reply.data).includes('secret'), false); assert.equal(JSON.stringify(reply.data).includes('private diagnostic'), false);
});

test('DLNA gateway grants select a real compatible resource before projecting media and DIDL', async t => {
  const resources = [
    { uri: 'http://source.example/original.flac', protocolInfo: 'http-get:*:audio/flac:*' },
    { uri: 'http://source.example/compatible.mp3', protocolInfo: 'http-get:*:audio/mpeg:*' }
  ];
  const track = { id: 'song', trackId: 'song', title: 'Song', uri: resources[0].uri, resources, isContainer: false };
  const music = Object.assign(new EventEmitter(), { id: 'gateway', sharing: {}, gatewayPermissions: { libraries: true, players: true },
    sources: new Map(), discovery: { devices: new Map([['source', { available: true }]]) },
    resolveTrack: async () => track, supportsProtocol });
  const remote = { token: 'fixture', listening: true, endpointOrigin: () => 'https://gateway.example' };
  const pwa = new PwaNetworkHost({ music, remote, player: {} }); t.after(() => pwa.dispose());
  const target = { hostId: 'target-gateway', playerId: 'mp3-player', protocolInfo: 'http-get:*:audio/mpeg:*' };
  const resolved = await pwa.gatewayTrack({ serverId: 'source', trackId: 'song', audience: 'player', target }, {});
  const token = resolved.uri.split('/').at(-1); const grant = pwa.readGatewayGrant(token); grant.key = token;
  grant.track = await pwa.resolveGatewayTrack(grant);
  assert.equal(grant.track.uri, resources[1].uri);
  assert.deepEqual(resolved.resources, [{ ...resources[1], uri: resolved.uri }]);
  assert.equal(parseDidl(resolved.metadata)[0].resources[0].protocolInfo, resources[1].protocolInfo);
  const browsed = pwa.browserGatewayTrack('source', track, {});
  assert.deepEqual(browsed.resources.map(resource => resource.protocolInfo), resources.map(resource => resource.protocolInfo));
  assert.notEqual(browsed.resources[0].uri, browsed.resources[1].uri);
  assert.deepEqual(browsed.resources.map(resource => pwa.grants.get(resource.uri.split('/').at(-1)).track.uri), resources.map(resource => resource.uri));
  await assert.rejects(pwa.gatewayTrack({ serverId: 'source', trackId: 'song', audience: 'player', target: { ...target, protocolInfo: 'http-get:*:audio/aac:*' } }, {}), { code: 'unsupportedFormat' });
  let upstream;
  t.mock.method(http, 'request', (url, _options, callback) => {
    upstream = url.href;
    const request = new EventEmitter(); request.end = () => queueMicrotask(() => {
      const response = Readable.from(['MP3']); response.statusCode = 200; response.headers = { 'content-type': 'audio/mpeg' }; callback(response);
    }); request.destroy = () => request.emit('close'); return request;
  });
  const chunks = []; const response = new Writable({ write(chunk, _encoding, done) { chunks.push(chunk); done(); } }); response.writeHead = () => {};
  await pwa.serveGatewayResource({ method: 'GET', headers: {} }, response, grant, 'media');
  assert.equal(upstream, resources[1].uri); assert.equal(Buffer.concat(chunks).toString(), 'MP3');
  music.sources.set('subsonic', { resolve: async () => ({ ...track, uri: '', resources: [{ uri: '', protocolInfo: resources[1].protocolInfo }] }) });
  const privateSource = await pwa.gatewayTrack({ serverId: 'subsonic', trackId: 'song', audience: 'player', target }, {});
  assert.equal(privateSource.resources[0].uri, privateSource.uri);
  assert.equal(privateSource.resources[0].protocolInfo, resources[1].protocolInfo);
});

test('persistent player references retain no grant entries and revoke with their authorization and source owner', async t => {
  const track = { id: 'song', resources: [{ uri: 'http://source.example/private?password=secret', protocolInfo: 'http-get:*:audio/mpeg:*' }] };
  const music = Object.assign(new EventEmitter(), { id: 'gateway', sharing: {}, sourceGeneration: 1,
    gatewayPermissions: { libraries: true }, sources: new Map(), discovery: { devices: new Map([['source', { available: true }]]) },
    resolveTrack: async () => track, supportsProtocol });
  const remote = { token: 'pairing-token', listening: true, endpointOrigin: () => 'https://gateway.example' };
  const pwa = new PwaNetworkHost({ music, remote, player: {} }); t.after(() => pwa.dispose());
  const intent = { serverId: 'source', trackId: 'song', audience: 'player', target: { hostId: 'destination', playerId: 'player' } };
  let token;
  for (let index = 0; index < 100; index++) {
    const result = await pwa.gatewayTrack({ ...intent, trackId: `song-${index}` }, {});
    token = result.uri.split('/').at(-1);
  }
  assert.equal(pwa.grants.size, 0);
  const reference = JSON.parse(Buffer.from(token.slice(0, -43), 'base64url').toString());
  assert.deepEqual(reference, ['source', 'song-99', 'destination', 'player', 'http-get:*:audio/mpeg:*']);
  assert.equal(pwa.readGatewayGrant(`${token[0] === 'A' ? 'B' : 'A'}${token.slice(1)}`), null);
  assert.equal(pwa.readGatewayGrant('x'.repeat(8193)), null);
  assert.equal(pwa.readGatewayGrant('x'.repeat(44)), null);
  const future = Date.now() + 30 * 24 * 3600000;
  t.mock.method(Date, 'now', () => future);
  assert.equal(pwa.grantCurrent(pwa.readGatewayGrant(token)), true);
  for (const revoke of [
    () => { remote.token += '-new'; },
    () => { music.gatewayPermissions = { libraries: true }; music.emit('state'); },
    () => { music.sourceGeneration++; music.emit('state'); },
    () => pwa.revoke()
  ]) {
    const before = pwa.readGatewayGrant(token);
    revoke();
    assert.equal(pwa.grantCurrent(before), false);
    assert.equal(pwa.readGatewayGrant(token), null);
    token = (await pwa.gatewayTrack(intent, {})).uri.split('/').at(-1);
  }
  music.discovery.devices.delete('source');
  assert.equal(pwa.grantCurrent(pwa.readGatewayGrant(token)), false);
});

test('PWA queue continuation keeps authorization independent of the request lifetime and detects permission or token revocation', { timeout: 15000 }, async t => {
  const fixture = await createPwaNetworkFixture(); t.after(fixture.close);
  const playerId = 'uuid:third-party-player';
  fixture.serverHost.discovery.devices.set(playerId, { id: playerId, name: 'Renderer', available: true, services: new Map() });
  await fixture.serverHost.configure({ gatewayPermissions: { libraries: false, players: true } });
  let command;
  fixture.serverHost.playerCommand = async request => { command = request; return { playerId, queue: [], capabilities: {} }; };
  assert.equal((await post(fixture, 'player', { playerId, action: 'play' })).status, 200);
  assert.equal(command.isAuthorized(), true);
  await fixture.serverHost.configure({ gatewayPermissions: { libraries: false, players: false } });
  assert.equal(command.isAuthorized(), false);
  await fixture.serverHost.configure({ gatewayPermissions: { libraries: false, players: true } });
  assert.equal((await post(fixture, 'player', { playerId, action: 'play' })).status, 200);
  assert.equal(command.isAuthorized(), true);
  fixture.remote.token = 'rotated-token';
  assert.equal(command.isAuthorized(), false);
});
