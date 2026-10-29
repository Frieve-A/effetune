'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const os = require('node:os');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { RemoteControlHost } = require('../../electron/remote-control-host.cjs');
const { DESCRIPTION_PATH, REQUEST_PATH, requestRemotePairing } = require('../../electron/remote-pairing.cjs');
const { Discovery, REMOTE_CONTROL, PLAYLIST, parseXml } = require('../../electron/network-music-upnp.cjs');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function until(check) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Expected pairing event did not arrive');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
async function fixture(t) {
  const requests = [];
  const packets = [];
  let config = {};
  const discovery = new Discovery();
  discovery.start = async () => {};
  discovery.socket = { setMulticastInterface() {}, send: (data, _port, _address, callback) => { packets.push(data.toString()); callback?.(); } };
  t.mock.method(os, 'networkInterfaces', () => ({ test: [{ family: 'IPv4', internal: false, address: '127.0.0.1' }] }));
  const host = new RemoteControlHost({
    app: { getVersion: () => '1', getAppPath: () => __dirname }, getMainWindow: () => null,
    config: { loadConfig: () => config, saveConfig: next => { config = next; return true; } },
    env: { EFFETUNE_REMOTE: '1', EFFETUNE_REMOTE_PORT: '48881', EFFETUNE_REMOTE_TOKEN: 'private-pairing-token' }, argv: [],
    getPlayerId: () => 'uuid:player', discovery,
    approvePairing: request => { const pending = deferred(); requests.push({ ...request, ...pending }); return pending.promise; }, log: () => {}
  });
  // A managed loopback fixture supplies the OS-selected port, exercising the
  // same post-bind advertisement path as a custom or fallback production port.
  host.bindWithFallback = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  host.pairing.cooldownMs = 0;
  await host.start();
  await discovery.multicastSending;
  t.after(() => host.dispose());
  const origin = `http://127.0.0.1:${host.port}`;
  return { host, requests, packets, origin, request: (options = {}) => requestRemotePairing({ origin, playerId: 'uuid:player', clientName: 'Desk computer', ...options }) };
}
async function post(origin, body, extraHeaders = {}) {
  const bytes = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(REQUEST_PATH, origin), { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes), 'X-EffeTune-Pairing': '1', ...extraHeaders } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', reject); req.end(bytes);
  });
}

test('running Remote Control advertises its bound endpoint without credentials and approval returns the existing token', async t => {
  const f = await fixture(t);
  assert.ok(f.packets.length);
  assert.ok(f.packets.every(packet => packet.includes(`${f.origin}${DESCRIPTION_PATH}`)));
  assert.ok(f.packets.every(packet => !packet.includes(f.host.token)));
  const response = await fetch(`${f.origin}${DESCRIPTION_PATH}`);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.ok(text.includes('uuid:player'));
  assert.ok(text.includes(REMOTE_CONTROL));
  assert.ok(!text.includes(f.host.token));
  const pending = f.request();
  await until(() => f.requests.length === 1);
  assert.equal(f.requests[0].address, '127.0.0.1');
  assert.equal(f.requests[0].clientName, 'Desk computer');
  assert.deepEqual(await f.request(), { status: 'busy' });
  f.requests[0].resolve(true);
  assert.deepEqual(await pending, { status: 'approved', token: f.host.token });
  await f.host.setEnabled(false);
  assert.ok(f.packets.some(packet => packet.includes('NTS: ssdp:byebye')));
  assert.deepEqual(await f.request(), { status: 'unavailable' });
});

test('browser requests, wrong targets and oversized requests cannot open an approval prompt', async t => {
  const f = await fixture(t);
  for (const headers of [{ Origin: f.origin }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'same-origin' }, { 'X-EffeTune-Pairing': '' }]) {
    const response = await post(f.origin, { playerId: 'uuid:player' }, headers);
    assert.equal(response.status, 403);
  }
  assert.deepEqual(await f.request({ playerId: 'uuid:other' }), { status: 'unavailable' });
  assert.equal((await post(f.origin, { playerId: 'uuid:player', clientName: 'x'.repeat(3000) })).body.status, 'error');
  assert.equal(f.requests.length, 0);
});

test('denial, timeout, client cancellation, token rotation and shutdown never release a token', async t => {
  const f = await fixture(t);
  let result = f.request(); await until(() => f.requests.length === 1);
  f.requests[0].resolve(false); assert.deepEqual(await result, { status: 'denied' });
  f.host.pairing.timeoutMs = 25;
  result = f.request(); await until(() => f.requests.length === 2);
  assert.deepEqual(await result, { status: 'expired' });
  assert.equal(f.requests[1].signal.aborted, true);
  f.requests[1].resolve(true);
  f.host.pairing.timeoutMs = 60000;
  const controller = new AbortController();
  result = f.request({ signal: controller.signal }); await until(() => f.requests.length === 3);
  controller.abort(); assert.deepEqual(await result, { status: 'cancelled' });
  await until(() => f.requests[2].signal.aborted);
  f.requests[2].resolve(true);
  result = f.request(); await until(() => f.requests.length === 4);
  await f.host.regenerateToken(); f.requests[3].resolve(true);
  assert.deepEqual(await result, { status: 'unavailable' });
  result = f.request(); await until(() => f.requests.length === 5);
  await f.host.setEnabled(false);
  assert.equal(f.requests[4].signal.aborted, true);
  assert.deepEqual(await result, { status: 'unavailable' });
  f.requests[4].resolve(true);
});

test('discovery associates the endpoint with the exact player UUID and address without replacing Playlist state', async () => {
  const id = 'uuid:remote-service';
  let endpoint = 'https://192.168.1.5:48882/.well-known/effetune/pair';
  const discovery = new Discovery({ fetchXml: async () => parseXml(`<root><device><UDN>${id}</UDN><playerId>uuid:player</playerId><serviceList><service><serviceType>${REMOTE_CONTROL}</serviceType><controlURL>${endpoint}</controlURL></service></serviceList></device></root>`) });
  const player = { id: 'uuid:player', address: '192.168.1.5', available: true, services: new Map([['urn:av-openhome-org:service:Playlist', { type: PLAYLIST }]]) };
  discovery.devices.set(player.id, player);
  const packet = Buffer.from(`HTTP/1.1 200 OK\r\nUSN: ${id}::${REMOTE_CONTROL}\r\nLOCATION: https://192.168.1.5:48882${DESCRIPTION_PATH}\r\nCACHE-CONTROL: max-age=100\r\n\r\n`);
  await discovery.receive(packet, { address: '192.168.1.5' });
  assert.equal(discovery.remoteControlEndpoint('uuid:player'), 'https://192.168.1.5:48882');
  assert.equal(discovery.remoteControlEndpoint('uuid:same-name-other'), null);
  assert.equal(discovery.devices.get(player.id), player);
  player.address = '192.168.1.6'; assert.equal(discovery.remoteControlEndpoint(player.id), null);
  player.address = '192.168.1.5';
  await discovery.receive(Buffer.from(`NOTIFY * HTTP/1.1\r\nUSN: ${id}::${REMOTE_CONTROL}\r\nNTS: ssdp:byebye\r\n\r\n`), { address: '192.168.1.5' });
  assert.equal(discovery.remoteControlEndpoint(player.id), null);
  assert.equal(player.available, true);
  endpoint = 'http://192.168.1.5:48882/.well-known/effetune/pair';
  await discovery.receive(packet, { address: '192.168.1.5' });
  assert.equal(discovery.remoteControlEndpoint(player.id), null, 'a secure description cannot redirect credentials to plaintext');
  endpoint = 'https://192.168.1.9:48882/.well-known/effetune/pair';
  await discovery.receive(packet, { address: '192.168.1.5' });
  assert.equal(discovery.remoteControlEndpoint(player.id), null, 'the endpoint must remain on the advertised host');
});

test('HTTPS hostname discovery pins the descriptor connection to the SSDP sender and exposes its pairing endpoint', async t => {
  const origin = 'https://music.example:48882'; const address = '192.168.1.5';
  let resolvedAddress = address;
  let connectedAddress = address;
  let lookups = 0; let requests = 0;
  const descriptor = `<root><device><UDN>uuid:remote</UDN><playerId>uuid:player</playerId><serviceList><service><serviceType>${REMOTE_CONTROL}</serviceType><controlURL>${REQUEST_PATH}</controlURL></service></serviceList></device></root>`;
  t.mock.method(dns, 'lookup', (hostname, options, callback) => {
    assert.equal(hostname, 'music.example'); assert.deepEqual(options, { family: 4, all: true });
    lookups++; callback(null, [{ address: resolvedAddress, family: 4 }]);
  });
  t.mock.method(https, 'request', (url, options, callback) => {
    assert.equal(url.origin, origin);
    const request = new EventEmitter(); request.destroy = error => { if (error) request.emit('error', error); };
    request.end = () => queueMicrotask(() => {
      const respond = error => {
        if (error) { request.emit('error', error); return; }
        requests++;
        const response = Readable.from([Buffer.from(url.pathname === DESCRIPTION_PATH ? descriptor : JSON.stringify({ status: 'approved', playerId: 'uuid:player', token: 'paired-token' }))]);
        response.statusCode = 200; response.socket = { remoteAddress: connectedAddress }; callback(response);
      };
      if (options.lookup) {
        assert.equal(options.agent, false);
        options.lookup(url.hostname, { all: true }, (error, records) => {
          if (!error) assert.deepEqual(records, [{ address, family: 4 }]);
          respond(error);
        });
      } else respond();
    });
    return request;
  });
  const discovery = new Discovery(); t.after(() => discovery.close());
  discovery.devices.set('uuid:player', { id: 'uuid:player', address, available: true,
    services: new Map([['urn:av-openhome-org:service:Playlist', { type: PLAYLIST }]]) });
  const packet = Buffer.from(`HTTP/1.1 200 OK\r\nUSN: uuid:remote::${REMOTE_CONTROL}\r\nLOCATION: ${origin}${DESCRIPTION_PATH}\r\nCACHE-CONTROL: max-age=100\r\n\r\n`);
  await discovery.receive(packet, { address });
  assert.equal(lookups, 1);
  assert.equal(discovery.remoteControlEndpoint('uuid:player'), origin);
  assert.deepEqual(await requestRemotePairing({ origin: discovery.remoteControlEndpoint('uuid:player'), playerId: 'uuid:player' }), { status: 'approved', token: 'paired-token' });
  const endpoint = discovery.remoteControls.get('uuid:player'); endpoint.expires = 1;
  await discovery.receive(packet, { address: '192.168.1.6' });
  assert.equal(endpoint.expires, 1, 'A different sender cannot refresh a verified hostname endpoint');
  discovery.remoteControls.clear();
  resolvedAddress = '192.168.1.6';
  await assert.rejects(discovery.receive(packet, { address }), /address could not be verified/);
  assert.equal(requests, 2, 'Mismatched DNS is rejected before sending an HTTP request');
  resolvedAddress = address; connectedAddress = '192.168.1.6';
  await assert.rejects(discovery.receive(packet, { address }), /address could not be verified/);
  assert.equal(discovery.remoteControlEndpoint('uuid:player'), null);
});

test('pairing response validation settles malformed JSON values without exceptions and preserves valid replies', { timeout: 5000 }, async t => {
  let body;
  const server = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const request = () => requestRemotePairing({ origin: `http://127.0.0.1:${server.address().port}`, playerId: 'uuid:player', clientName: 'Desk computer', timeoutMs: 1000 });
  for (const malformed of ['null', '[]', 'true', '42', '"approved"', '{}', '{"status":null}', '{"status":{}}', '{"status":"approved"}', '{invalid']) {
    body = malformed;
    assert.deepEqual(await request(), { status: 'unavailable' }, malformed);
  }
  body = JSON.stringify({ status: 'denied' });
  assert.deepEqual(await request(), { status: 'denied' });
  body = JSON.stringify({ status: 'approved', playerId: 'uuid:player', token: 'approved-test-token' });
  assert.deepEqual(await request(), { status: 'approved', token: 'approved-test-token' });
});
