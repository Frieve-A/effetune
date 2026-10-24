'use strict';

const assert = require('node:assert/strict');
const { Duplex } = require('node:stream');
const test = require('node:test');
const { WebSocketServer } = require('ws');
const { CHANNELS, PANEL_CHANNELS, RemoteControlHost, registerRemoteControlIpc } = require('../../electron/remote-control-host.cjs');

test('remote permission IPC preserves saved and running state on failed enable or disable and permits retries', async t => {
  let stored = { remoteControlEnabled: false, unrelated: 'keep' };
  let saveAllowed = false;
  const lifecycle = [];
  const window = { webContents: { send() {} }, isDestroyed: () => false };
  const host = new RemoteControlHost({
    app: {}, getMainWindow: () => window,
    config: {
      loadConfig: () => ({ ...stored }),
      saveConfig: next => { if (!saveAllowed) return false; stored = next; return true; }
    },
    env: { EFFETUNE_REMOTE_TOKEN: 'fixture-token' }, argv: [], log() {}
  });
  host.start = async () => { lifecycle.push('start'); host.listening = true; };
  host.stop = async () => { lifecycle.push('stop'); host.listening = false; };
  const handlers = new Map();
  const dispose = registerRemoteControlIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: channel => handlers.delete(channel) },
    getHost: () => host, getMainWindow: () => window
  });
  t.after(async () => { dispose(); await host.dispose(); });
  const setEnabled = enabled => handlers.get(PANEL_CHANNELS.setEnabled)({ sender: window.webContents }, enabled);
  for (const enabled of [true, false]) {
    const previous = !enabled;
    const before = [...lifecycle];
    saveAllowed = false;
    await assert.rejects(setEnabled(enabled), { code: 'save-failed' });
    assert.equal(stored.remoteControlEnabled, previous);
    assert.equal(host.enabled, previous);
    assert.equal(host.listening, previous);
    assert.deepEqual(lifecycle, before);
    saveAllowed = true;
    const status = await setEnabled(enabled);
    assert.equal(status.enabled, enabled);
    assert.equal(status.running, enabled);
    assert.equal(stored.remoteControlEnabled, enabled);
    assert.equal(stored.unrelated, 'keep');
  }
  assert.deepEqual(lifecycle, ['start', 'stop']);
});

// Exercise real frame parsing without opening a listening socket.
class InMemorySocket extends Duplex {
  constructor() {
    super();
    this.remoteAddress = '192.168.1.99';
  }
  _read() {}
  _write(_chunk, _encoding, callback) { callback(); }
  setTimeout() { return this; }
  setNoDelay() { return this; }
}

for (const reason of ['bad token', 'client limit']) {
  test(`a connection rejected for ${reason} handles malformed frames during closing`, async () => {
    const socket = new InMemorySocket();
    const wss = new WebSocketServer({ noServer: true });
    let reportError;
    const handledError = new Promise(resolve => { reportError = resolve; });
    const host = new RemoteControlHost({
      app: { getVersion: () => 'test' },
      getMainWindow: () => null,
      env: { EFFETUNE_REMOTE_TOKEN: 'valid-pairing-code' },
      argv: [],
      log: (message, error) => { if (message === '[remote] WebSocket error:') reportError(error); }
    });
    host.wss = wss;
    if (reason === 'client limit') host.countClients = () => 16;
    const req = {
      method: 'GET',
      url: `/?t=${reason === 'bad token' ? 'wrong' : host.token}`,
      headers: {
        upgrade: 'websocket',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'sec-websocket-version': '13'
      },
      socket
    };
    let ws;
    wss.handleUpgrade(req, socket, Buffer.alloc(0), peer => {
      ws = peer;
      host.onConnection(peer, req);
    });
    let guard;
    const deadline = new Promise((_, reject) => {
      guard = setTimeout(() => reject(new Error('WebSocket error or cleanup timed out')), 3000);
    });
    const closed = new Promise(resolve => ws.once('close', resolve));
    try {
      assert.equal(ws.authenticated, undefined);
      assert.equal(ws.readyState, 2);
      socket.push(Buffer.from([0xc1, 0x80, 0, 0, 0, 0])); // Invalid RSV1, even on a closing peer.
      assert.match(await Promise.race([handledError, deadline]), /RSV1 must be clear/);
    } finally {
      ws.terminate();
      socket.destroy();
      try {
        await Promise.race([closed, deadline]);
        await Promise.race([new Promise(resolve => wss.close(resolve)), deadline]);
      } finally {
        clearTimeout(guard);
      }
    }
  });
}

test('PWA token revocation rejects queued effect edits and completed IR uploads before renderer dispatch', async () => {
  const socket = new InMemorySocket();
  const wss = new WebSocketServer({ noServer: true });
  const dispatched = [];
  const host = new RemoteControlHost({
    app: { getVersion: () => 'test' },
    getMainWindow: () => ({ webContents: { send: (channel, request) => {
      if (channel !== CHANNELS.request) return;
      dispatched.push(request.message.op);
      host.handleRendererResponse({ requestId: request.requestId, ok: true });
    } } }),
    env: { EFFETUNE_REMOTE_TOKEN: 'valid-pairing-code' },
    argv: [],
    log: () => {}
  });
  host.wss = wss;
  host.listening = true;
  host.setRendererReady();
  const req = {
    method: 'GET',
    url: `/pwa/v1/effects?t=${host.token}`,
    headers: {
      upgrade: 'websocket',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'sec-websocket-version': '13'
    },
    socket
  };
  let ws;
  wss.handleUpgrade(req, socket, Buffer.alloc(0), peer => {
    ws = peer;
    host.onConnection(peer, req);
  });
  let release;
  let guard;
  const deadline = new Promise((_, reject) => {
    guard = setTimeout(() => reject(new Error('Queued PWA dispatch or cleanup timed out')), 3000);
  });
  const closed = new Promise(resolve => ws.once('close', resolve));
  const edit = { op: 'params', seq: 1, index: 0, params: { vl: -12 } };
  const upload = {
    op: 'putIR', seq: 2, id: '1234567890abcdef12345678', name: 'Test IR', ext: 'wav',
    index: 0, total: 1, bytes: 4, data: Buffer.from('RIFF').toString('base64')
  };
  try {
    assert.equal(ws.authenticated, true);
    await Promise.race([host.onMessage(ws, JSON.stringify(edit)), deadline]);
    await Promise.race([host.onMessage(ws, JSON.stringify(upload)), deadline]);
    assert.deepEqual(dispatched, ['params', 'putIR']);

    host.dispatchChain = new Promise(resolve => { release = resolve; });
    const pending = [edit, upload].map(message => host.onMessage(ws, JSON.stringify(message)));
    assert.equal(ws.uploads.size, 0, 'the completed upload has entered the dispatch queue');
    await host.regenerateToken();
    assert.equal(ws.readyState, 2);
    release();
    await Promise.race([Promise.all(pending), deadline]);
    assert.deepEqual(dispatched, ['params', 'putIR'], 'revoked commands never reach the renderer');
  } finally {
    release?.();
    ws.terminate();
    socket.destroy();
    try {
      await Promise.race([closed, deadline]);
      await Promise.race([new Promise(resolve => wss.close(resolve)), deadline]);
    } finally {
      clearTimeout(guard);
    }
  }
});
