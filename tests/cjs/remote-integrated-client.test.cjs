'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { registerIntegratedRemoteClientIpc } = require('../../electron/remote-client-window.cjs');

test('integrated connections bind explicit player identities and reject stale sockets and untrusted senders', t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-remote-client-')));
  const handlers = new Map();
  const messages = [];
  const sockets = [];
  class Socket extends EventEmitter {
    constructor(url, options) { super(); this.url = url; this.options = options; this.readyState = 1; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(data); }
    terminate() { this.terminated = true; }
  }
  const sender = { mainFrame: {}, send: (_channel, message) => messages.push(message) };
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) };
  const options = { ipcMain, getMainWindow: () => ({ webContents: sender }), app: { getPath: () => directory }, WebSocketImpl: Socket };
  let dispose = registerIntegratedRemoteClientIpc(options);
  t.after(() => { dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  const invoke = (name, ...args) => handlers.get(`remote-client:${name}`)({ sender, senderFrame: sender.mainFrame }, ...args);
  assert.equal(invoke('connect', 'uuid:B').ok, false);
  assert.equal(invoke('save-connection', 'uuid:B', 'https://192.168.1.8:47300/?t=token-B').ok, true);
  assert.equal(invoke('save-connection', 'uuid:C', 'http://192.168.1.9:47300/?t=token-C').ok, true);
  assert.deepEqual(invoke('get-connection', 'uuid:B'), { registered: true, requestAvailable: false });
  const b = invoke('connect', 'uuid:B');
  assert.equal(sockets[0].url, 'wss://192.168.1.8:47300/?t=token-B');
  assert.equal(sockets[0].options.rejectUnauthorized, undefined, 'TLS validation keeps the secure default');
  sockets[0].emit('open');
  assert.equal(messages.at(-1).connectionId, b.connectionId);
  const c = invoke('connect', 'uuid:C');
  assert.equal(sockets[0].terminated, true);
  const count = messages.length;
  sockets[0].emit('message', Buffer.from('stale'), false);
  assert.equal(messages.length, count);
  sockets[0].emit('close', 4401);
  assert.equal(invoke('get-connection', 'uuid:B').registered, true, 'an old socket cannot revoke a saved connection');
  assert.equal(invoke('send', b.connectionId, 'old edit'), false);
  assert.equal(invoke('send', c.connectionId, 'new edit'), true);
  invoke('disconnect', b.connectionId);
  assert.equal(sockets[1].terminated, undefined);
  assert.equal(invoke('save-connection', 'uuid:C', 'http://192.168.1.9:47300/?t=new-token-C').ok, true);
  sockets[1].emit('close', 4401);
  assert.equal(invoke('get-connection', 'uuid:C').registered, true, 'a rejection cannot remove newer credentials');
  assert.throws(() => handlers.get('remote-client:connect')({ sender, senderFrame: {} }, 'uuid:B'), /invalid-sender/);
  assert.throws(() => handlers.get('remote-client:connect')({ sender: {} }, 'uuid:B'), /invalid-sender/);
  dispose();
  dispose = registerIntegratedRemoteClientIpc(options);
  assert.deepEqual(invoke('get-connection', 'uuid:B'), { registered: true, requestAvailable: false }, 'pairing survives restart');
  assert.deepEqual(invoke('get-connection', 'uuid:other'), { registered: false, requestAvailable: false });
});

test('reconnecting reuses approval while an expired token is rejected and requires fresh approval', { timeout: 10000 }, async t => {
  const http = require('node:http');
  const { WebSocketServer } = require('ws');
  const { RemoteControlHost } = require('../../electron/remote-control-host.cjs');
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-remote-reconnect-')));
  const host = new RemoteControlHost({ app: {}, getMainWindow: () => null, env: { EFFETUNE_REMOTE_TOKEN: 'first-approved-token' }, argv: [], log() {} });
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  host.server = server; host.wss = wss;
  const peers = [];
  wss.on('connection', (socket, request) => { host.onConnection(socket, request); peers.push(socket); });
  const sender = Object.assign(new EventEmitter(), { mainFrame: {}, send: (_channel, message) => sender.emit('native-event', message) });
  const handlers = new Map();
  let approvals = 0;
  let dispose;
  t.after(async () => {
    dispose?.();
    await host.dispose();
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  dispose = registerIntegratedRemoteClientIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
    getMainWindow: () => ({ webContents: sender }), app: { getPath: () => directory },
    getPairingEndpoint: () => origin,
    requestPairing: async () => { approvals++; return { status: 'approved', token: host.token }; }
  });
  const invoke = (name, ...args) => handlers.get(`remote-client:${name}`)({ sender, senderFrame: sender.mainFrame }, ...args);
  const waitForEvent = (connectionId, type) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { sender.removeListener('native-event', receive); reject(new Error('Native connection event timed out')); }, 3000);
    const receive = message => {
      if (message.connectionId !== connectionId || message.type !== type) return;
      clearTimeout(timer); sender.removeListener('native-event', receive); resolve(message);
    };
    sender.on('native-event', receive);
  });
  const player = 'uuid:approved-player';
  assert.equal(invoke('get-connection', player).registered, false);
  assert.deepEqual(await invoke('request-connection', player, 'first'), { ok: true });
  assert.equal(approvals, 1);
  const first = invoke('connect', player);
  await waitForEvent(first.connectionId, 'open');
  assert.equal(peers.at(-1).authenticated, true);
  invoke('disconnect', first.connectionId);
  assert.equal(invoke('get-connection', player).registered, true);
  assert.deepEqual(await invoke('request-connection', player, 'reconnect'), { ok: true });
  assert.equal(approvals, 1);
  const reconnected = invoke('connect', player);
  await waitForEvent(reconnected.connectionId, 'open');
  assert.equal(peers.at(-1).authenticated, true);
  invoke('disconnect', reconnected.connectionId);

  assert.equal(invoke('save-connection', 'uuid:other', `${origin}/?t=other-approved-token`).ok, true);
  await host.regenerateToken();
  assert.deepEqual(await invoke('request-connection', player, 'expired'), { ok: true });
  const expired = invoke('connect', player);
  assert.equal((await waitForEvent(expired.connectionId, 'close')).code, 4401);
  assert.equal(peers.at(-1).authenticated, undefined, 'saved credentials never bypass the server token check');
  assert.equal(invoke('get-connection', player).registered, false);
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'remote-connections.json'), 'utf8'));
  assert.equal(Object.hasOwn(saved, player), false);
  assert.equal(invoke('get-connection', 'uuid:other').registered, true);
  assert.equal(approvals, 1, 'authentication failure cannot silently approve new credentials');
  assert.deepEqual(await invoke('request-connection', player, 'approve-again'), { ok: true });
  assert.equal(approvals, 2);
  const approvedAgain = invoke('connect', player);
  await waitForEvent(approvedAgain.connectionId, 'open');
  assert.equal(peers.at(-1).authenticated, true);
});

test('approval is stored only for the captured current target and cancelled requests cannot replace it', async t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-remote-approval-')));
  const handlers = new Map();
  const requests = [];
  const sender = Object.assign(new EventEmitter(), { mainFrame: {} });
  const endpoints = new Map([['uuid:A', 'https://192.168.1.8:48231'], ['uuid:B', 'http://192.168.1.9:48232']]);
  const options = {
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) },
    getMainWindow: () => ({ webContents: sender }), app: { getPath: () => directory },
    getPairingEndpoint: id => endpoints.get(id),
    requestPairing: request => new Promise(resolve => requests.push({ ...request, resolve }))
  };
  let dispose = registerIntegratedRemoteClientIpc(options);
  t.after(async () => { dispose(); await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const invoke = (name, ...args) => handlers.get(`remote-client:${name}`)({ sender, senderFrame: sender.mainFrame }, ...args);
  assert.deepEqual(invoke('get-connection', 'uuid:A'), { registered: false, requestAvailable: true });
  assert.deepEqual(await invoke('request-connection', 'unknown', 'missing'), { ok: false, status: 'unavailable' });
  const first = invoke('request-connection', 'uuid:A', 'request-a');
  assert.equal(requests[0].origin, endpoints.get('uuid:A'));
  assert.equal(requests[0].playerId, 'uuid:A');
  assert.equal(invoke('cancel-connection-request', 'wrong-id'), false);
  assert.equal(invoke('cancel-connection-request', 'request-a'), true);
  const second = invoke('request-connection', 'uuid:B', 'request-b');
  requests[0].resolve({ status: 'approved', token: 'late-token-A' });
  assert.deepEqual(await first, { ok: false, status: 'cancelled' });
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(invoke('cancel-connection-request', 'request-a'), false);
  requests[1].resolve({ status: 'approved', token: 'accepted-token-B' });
  assert.deepEqual(await second, { ok: true }, 'no credential is returned to the renderer');
  assert.equal(invoke('get-connection', 'uuid:A').registered, false);
  assert.equal(invoke('get-connection', 'uuid:B').registered, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'remote-connections.json'), 'utf8')), { 'uuid:B': 'http://192.168.1.9:48232/?t=accepted-token-B' });
  const moved = invoke('request-connection', 'uuid:A', 'request-moved');
  endpoints.set('uuid:A', 'https://192.168.1.8:48233');
  requests[2].resolve({ status: 'approved', token: 'old-endpoint-token' });
  assert.deepEqual(await moved, { ok: false, status: 'unavailable' });
  const navigation = invoke('request-connection', 'uuid:A', 'request-navigation');
  sender.emit('did-start-navigation', {}, 'file:///effetune.html', false, true);
  requests[3].resolve({ status: 'approved', token: 'discarded-document-token' });
  assert.deepEqual(await navigation, { ok: false, status: 'cancelled' });
  const pending = invoke('request-connection', 'uuid:A', 'request-shutdown');
  dispose();
  requests[4].resolve({ status: 'approved', token: 'shutdown-token' });
  assert.deepEqual(await pending, { ok: false, status: 'cancelled' });
  dispose = registerIntegratedRemoteClientIpc(options);
  assert.equal(invoke('get-connection', 'uuid:B').registered, true);
  assert.equal(invoke('get-connection', 'uuid:A').registered, false);
});
