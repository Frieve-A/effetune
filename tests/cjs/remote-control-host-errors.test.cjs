'use strict';

const assert = require('node:assert/strict');
const { Duplex } = require('node:stream');
const test = require('node:test');
const { WebSocketServer } = require('ws');
const { RemoteControlHost } = require('../../electron/remote-control-host.cjs');

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
