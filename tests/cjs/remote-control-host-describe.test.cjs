'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { WebSocket } = require('ws');
const { RemoteControlHost, CHANNELS } = require('../../electron/remote-control-host.cjs');

const PORT = 47393;
const TOKEN = 'tok-describe';
const EFFECTS = [{ nm: 'Volume', category: 'Basics', params: [{ key: 'vl', type: 'number', default: 0, min: -60, max: 24 }] }];

function makeHost() {
  const app = { getAppPath: () => path.resolve(__dirname, '..', '..'), getVersion: () => '9.9.9', isPackaged: true };
  const requests = [];
  let host = null;
  const window = {
    isDestroyed: () => false,
    webContents: {
      send(channel, { requestId, message }) {
        if (channel !== CHANNELS.request) return;
        requests.push(message);
        setImmediate(() => host.handleRendererResponse({
          requestId, ok: true, ...(message.op === 'describeEffects' ? { effects: EFFECTS } : {})
        }));
      }
    }
  };
  host = new RemoteControlHost({
    app,
    getMainWindow: () => window,
    env: { EFFETUNE_REMOTE: '1', EFFETUNE_REMOTE_PORT: String(PORT), EFFETUNE_REMOTE_TOKEN: TOKEN },
    argv: [],
    log: () => {}
  });
  return { host, requests };
}

function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?t=${TOKEN}`);
    const messages = [];
    ws.on('message', data => messages.push(JSON.parse(data.toString())));
    ws.on('open', () => resolve({
      ws,
      send: message => ws.send(JSON.stringify(message)),
      next: (predicate, ms = 3000) => new Promise((ok, fail) => {
        const started = Date.now();
        const poll = () => {
          const found = messages.find(predicate);
          if (found) ok(found);
          else if (Date.now() - started > ms) fail(new Error('timeout waiting for message'));
          else setTimeout(poll, 5);
        };
        poll();
      })
    }));
    ws.on('error', reject);
  });
}

test('hello advertises describe1 and describeEffects replies with the renderer descriptions', async () => {
  const { host, requests } = makeHost();
  try {
    assert.equal(await host.start(), true);
    host.setRendererReady();
    const client = await open();
    client.send({ op: 'hello', v: 1, seq: 1 });
    const state = await client.next(m => m.op === 'state' && m.seq === 1);
    assert.ok(state.features.includes('describe1'));

    client.send({ op: 'describeEffects', seq: 2 });
    const ack = await client.next(m => m.op === 'ack' && m.seq === 2);
    assert.equal(ack.ok, true);
    assert.equal(ack.rev, undefined);
    const reply = await client.next(m => m.op === 'effects' && m.seq === 2);
    assert.deepEqual(reply.effects, EFFECTS);
    assert.ok(requests.some(r => r.op === 'describeEffects'));
    client.ws.close();
  } finally {
    await host.dispose();
  }
});
