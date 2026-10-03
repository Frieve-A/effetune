'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { WebSocket } = require('ws');
const { RemoteControlHost, CHANNELS, webPairingUrl } = require('../../electron/remote-control-host.cjs');

const PORT = 47392;
const TOKEN = 'tok-sync';

// A stand-in for the renderer: answers forwarded requests from a tiny model.
function createFakeRenderer(host) {
  const model = { epoch: 'abcd0123', ids: ['h.1'], pipeline: [{ nm: 'Volume', en: true, vl: 0 }], slot: 'A', masterBypass: false };
  const requests = [];
  const snapshot = () => JSON.parse(JSON.stringify(model));
  const window = {
    isDestroyed: () => false,
    webContents: {
      send(channel, payload) {
        if (channel !== CHANNELS.request) return;
        const { requestId, message } = payload;
        requests.push(message);
        setImmediate(() => {
          let result = { ok: true };
          if (message.op === 'edit') {
            if (message.epoch !== model.epoch) result = { ok: false, error: 'stale-epoch' };
            else {
              model.pipeline[0].vl = message.ops[0].p.vl;
              result = { ok: true, skipped: message.ops.length > 1 ? [1] : undefined };
            }
          } else if (message.op === 'presets') {
            result = { ok: true, presets: { Demo: { plugins: [] } } };
          } else if (message.op === 'params') {
            model.pipeline[0].vl = message.params.vl;
          }
          host.handleRendererResponse({ requestId, ...result, snapshot: snapshot() });
        });
      }
    }
  };
  return { model, requests, window, snapshot };
}

function makeHost() {
  const app = { getAppPath: () => path.resolve(__dirname, '..', '..'), getVersion: () => '9.9.9', isPackaged: true };
  let renderer = null;
  const host = new RemoteControlHost({
    app,
    getMainWindow: () => renderer?.window || null,
    env: { EFFETUNE_REMOTE: '1', EFFETUNE_REMOTE_PORT: String(PORT), EFFETUNE_REMOTE_TOKEN: TOKEN },
    argv: [],
    log: () => {}
  });
  renderer = createFakeRenderer(host);
  return { host, renderer };
}

function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?t=${TOKEN}`);
    const messages = [];
    const waiters = [];
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      messages.push(message);
      for (const waiter of [...waiters]) waiter.check();
    });
    ws.on('open', () => resolve({
      ws,
      messages,
      send: message => ws.send(JSON.stringify(message)),
      next: (predicate, ms = 3000) => new Promise((ok, fail) => {
        const timer = setTimeout(() => fail(new Error('timeout waiting for message')), ms);
        const waiter = {
          check() {
            const found = messages.find(m => predicate(m) && !m.__seen);
            if (found) { found.__seen = true; clearTimeout(timer); waiters.splice(waiters.indexOf(waiter), 1); ok(found); }
          }
        };
        waiters.push(waiter);
        waiter.check();
      })
    }));
    ws.on('error', reject);
  });
}

test('hello reply carries sync fields, features and per-client flags', async () => {
  const { host } = makeHost();
  try {
    assert.equal(await host.start(), true);
    host.setRendererReady();
    const client = await open();
    client.send({ op: 'hello', v: 1, seq: 1, app: 'EffeTune', version: '2.11.0', build: 'browser', sync: 1 });
    const state = await client.next(m => m.op === 'state' && m.seq === 1);
    assert.equal(state.origin, 'remote');
    assert.equal(state.epoch, 'abcd0123');
    assert.deepEqual(state.ids, ['h.1']);
    assert.equal(state.slot, 'A');
    assert.equal(typeof state.host, 'string');
    for (const feature of ['origin', 'savePreset', 'irSync', 'sync1']) {
      assert.ok(state.features.includes(feature), feature);
    }
    const devices = host.getStatus().devices;
    assert.equal(devices[0].build, 'browser');
    client.ws.close();
  } finally {
    await host.dispose();
  }
});

test('edit acks carry the host revision and skipped ops; stale epochs fail', async () => {
  const { host, renderer } = makeHost();
  try {
    await host.start();
    host.setRendererReady();
    const client = await open();
    client.send({ op: 'hello', v: 1, seq: 1, sync: 1 });
    await client.next(m => m.op === 'state' && m.seq === 1);
    client.send({ op: 'edit', seq: 2, epoch: 'abcd0123', base: 1, ops: [{ t: 'set', id: 'h.1', p: { vl: -4 } }, { t: 'del', id: 'zz' }] });
    const ack = await client.next(m => m.op === 'ack' && m.seq === 2);
    assert.equal(ack.ok, true);
    assert.equal(ack.rev, host.rev);
    assert.deepEqual(ack.skipped, [1]);
    const push = await client.next(m => m.op === 'state' && m.rev >= ack.rev && m.seq === 2);
    assert.equal(push.pipeline[0].vl, -4);
    assert.equal(renderer.model.pipeline[0].vl, -4);
    client.send({ op: 'edit', seq: 3, epoch: 'deadbeef', base: 1, ops: [] });
    const failed = await client.next(m => m.op === 'ack' && m.seq === 3);
    assert.deepEqual([failed.ok, failed.error], [false, 'stale-epoch']);
    client.ws.close();
  } finally {
    await host.dispose();
  }
});

test('legacy params acks carry rev and a legacy client never sees presetsChanged', async () => {
  const { host } = makeHost();
  try {
    await host.start();
    host.setRendererReady();
    const legacy = await open();
    const sync = await open();
    legacy.send({ op: 'hello', v: 1, seq: 1, app: 'NativeClient' });
    sync.send({ op: 'hello', v: 1, seq: 1, sync: 1 });
    await legacy.next(m => m.op === 'state' && m.seq === 1);
    await sync.next(m => m.op === 'state' && m.seq === 1);
    legacy.send({ op: 'params', seq: 2, index: 0, params: { vl: -9 } });
    const ack = await legacy.next(m => m.op === 'ack' && m.seq === 2);
    assert.equal(typeof ack.rev, 'number');
    const push = await sync.next(m => m.op === 'state' && m.pipeline[0].vl === -9);
    assert.equal('seq' in push, false, 'unsolicited pushes carry no seq');
    assert.equal(push.origin, 'remote');
    host.handlePresetsChanged();
    await sync.next(m => m.op === 'presetsChanged');
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(legacy.messages.some(m => m.op === 'presetsChanged'), false);
    for (const message of legacy.messages) {
      assert.ok(['state', 'ack'].includes(message.op), message.op);
      if (message.op === 'state') assert.ok(['local', 'remote'].includes(message.origin));
    }
    legacy.ws.close();
    sync.ws.close();
  } finally {
    await host.dispose();
  }
});

test('presets op replies with the stored presets', async () => {
  const { host } = makeHost();
  try {
    await host.start();
    host.setRendererReady();
    const client = await open();
    client.send({ op: 'hello', v: 1, seq: 1, sync: 1 });
    await client.next(m => m.op === 'state' && m.seq === 1);
    client.send({ op: 'presets', seq: 2 });
    const reply = await client.next(m => m.op === 'presets' && m.seq === 2);
    assert.deepEqual(reply.presets, { Demo: { plugins: [] } });
    client.ws.close();
  } finally {
    await host.dispose();
  }
});

test('a command coalesced with the first snapshot of a session keeps its origin and seq', async () => {
  const { host, renderer } = makeHost();
  try {
    await host.start();
    host.setRendererReady();
    const sender = await open();
    const bystander = await open();
    const baseline = renderer.snapshot();
    const changed = renderer.snapshot();
    changed.pipeline[0].vl = -3;
    // Same tick: the first snapshot is still waiting for its broadcast when the command lands.
    host.handleRendererState(baseline);
    host.ingestSnapshot(changed, { ws: [...host.wss.clients][0], seq: 7 });
    const sent = await sender.next(m => m.op === 'state');
    const seen = await bystander.next(m => m.op === 'state');
    assert.equal(sent.origin, 'remote');
    assert.equal(sent.seq, 7);
    assert.equal(sent.pipeline[0].vl, -3);
    assert.equal(seen.origin, 'remote');
    assert.equal('seq' in seen, false);
    sender.ws.close();
    bystander.ws.close();
  } finally {
    await host.dispose();
  }
});

test('a client that was behind gets its own echo with its seq, but other changes without one', async () => {
  const { host } = makeHost();
  try {
    await host.start();
    host.setRendererReady();
    const client = await open();
    const other = await open();
    client.send({ op: 'hello', v: 1, seq: 1, sync: 1 });
    other.send({ op: 'hello', v: 1, seq: 1, sync: 1 });
    await client.next(m => m.op === 'state' && m.seq === 1);
    await other.next(m => m.op === 'state' && m.seq === 1);
    // The baseline snapshot is broadcast on its own timer; let it reach both clients before one stops draining.
    await client.next(m => m.op === 'state' && !('seq' in m));
    await other.next(m => m.op === 'state' && !('seq' in m));
    const sockets = [...host.wss.clients];
    assert.equal(sockets.length, 2);
    // Pretend the first socket is not draining.
    let buffered = 2 * 1024 * 1024;
    Object.defineProperty(sockets[0], 'bufferedAmount', { get: () => buffered });

    // 1. only the lagging client's own commands are coalesced
    client.send({ op: 'edit', seq: 2, epoch: 'abcd0123', base: 1, ops: [{ t: 'set', id: 'h.1', p: { vl: -4 } }] });
    await client.next(m => m.op === 'ack' && m.seq === 2);
    client.send({ op: 'edit', seq: 3, epoch: 'abcd0123', base: 1, ops: [{ t: 'set', id: 'h.1', p: { vl: -5 } }] });
    await client.next(m => m.op === 'ack' && m.seq === 3);
    await other.next(m => m.op === 'state' && m.pipeline[0].vl === -5);
    assert.equal(client.messages.some(m => m.op === 'state' && m.pipeline[0].vl <= -4), false, 'skipped while behind');
    buffered = 0;
    const echo = await client.next(m => m.op === 'state' && m.pipeline[0].vl === -5);
    assert.equal(echo.seq, 3, 'latest own command seq kept');
    assert.equal(echo.origin, 'remote');

    // 2. someone else's change in the coalesced window: external, no seq
    buffered = 2 * 1024 * 1024;
    client.send({ op: 'edit', seq: 4, epoch: 'abcd0123', base: 1, ops: [{ t: 'set', id: 'h.1', p: { vl: -6 } }] });
    await client.next(m => m.op === 'ack' && m.seq === 4);
    await new Promise(resolve => setTimeout(resolve, 150));
    other.send({ op: 'edit', seq: 2, epoch: 'abcd0123', base: 1, ops: [{ t: 'set', id: 'h.1', p: { vl: -7 } }] });
    await other.next(m => m.op === 'ack' && m.seq === 2);
    await client.next(() => false, 200).catch(() => {});
    buffered = 0;
    const mixed = await client.next(m => m.op === 'state' && m.pipeline[0].vl === -7);
    assert.equal('seq' in mixed, false);
    assert.equal(mixed.origin, 'remote');
    client.ws.close();
    other.ws.close();
  } finally {
    await host.dispose();
  }
});

test('the pairing link opens the browser client and can be copied', () => {
  assert.equal(webPairingUrl('192.168.1.5', 47300, 'ab cd'), 'http://192.168.1.5:47300/?t=ab%20cd');
  const host = new RemoteControlHost({
    app: { getAppPath: () => __dirname, getVersion: () => '1', isPackaged: true },
    getMainWindow: () => null,
    env: { EFFETUNE_REMOTE_TOKEN: 'abcd1234' },
    argv: [],
    log: () => {}
  });
  host.port = 47300;
  host.lan = { best: '192.168.1.5', candidates: [{ address: '192.168.1.5' }], offered: [{ address: '192.168.1.5', name: 'Wi-Fi' }] };
  const status = host.getStatus({ withQr: true });
  assert.equal(status.webUrl, 'http://192.168.1.5:47300/?t=abcd1234');
  assert.equal(status.url, 'ws://192.168.1.5:47300/?t=abcd1234');
  assert.match(status.addresses[0].webQr, /^data:image\/svg\+xml;base64,/);
  const copied = [];
  host.clipboard = { writeText: text => copied.push(text) };
  assert.equal(host.copyLink(0), true);
  assert.deepEqual(copied, ['http://192.168.1.5:47300/?t=abcd1234']);
  assert.equal(host.copyLink(5), false, 'an unknown address copies nothing');
  host.clipboard = { writeText: () => { throw new Error('denied'); } };
  assert.equal(host.copyLink(0), false);
});
