'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { CHANNELS, PANEL_CHANNELS, RemoteControlHost, registerRemoteControlIpc } = require('../../electron/remote-control-host.cjs');

function createHost(t) {
  const sent = [];
  let destroyed = false;
  const window = {
    isDestroyed: () => destroyed,
    webContents: { send: (...args) => sent.push(args) }
  };
  const copied = [];
  const host = new RemoteControlHost({
    app: { getVersion: () => 'test' },
    getMainWindow: () => window,
    clipboard: { writeText: text => copied.push(text) },
    env: { EFFETUNE_REMOTE_TOKEN: 'pairing-code' },
    argv: [],
    log: () => {}
  });
  host.lan = { offered: [{ address: '192.168.0.5', name: 'Ethernet' }] };
  t.after(() => host.dispose());
  return { host, window, sent, copied, destroy: () => { destroyed = true; } };
}

test('opening remote settings sends the dialog request to the main renderer', t => {
  const { host, sent, destroy } = createHost(t);
  assert.equal(host.openPanel(), true);
  assert.deepEqual(sent, [[CHANNELS.openPanel]]);
  host.emitStatus();
  assert.equal(sent[1][0], CHANNELS.status);
  assert.equal(sent[2][0], PANEL_CHANNELS.status);
  assert.match(sent[2][1].addresses[0].webQr, /^data:image\/svg\+xml/);
  destroy();
  assert.equal(host.openPanel(), false);
});

test('remote settings IPC accepts only the main renderer and retains the settings actions', async t => {
  const { host, window, copied, destroy } = createHost(t);
  const handlers = new Map();
  const dispose = registerRemoteControlIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: channel => handlers.delete(channel)
    },
    getHost: () => host,
    getMainWindow: () => window
  });
  t.after(dispose);
  const event = { sender: window.webContents };
  const invoke = (channel, ...args) => handlers.get(channel)(event, ...args);
  const status = invoke(PANEL_CHANNELS.getStatus);
  assert.match(status.addresses[0].webQr, /^data:image\/svg\+xml/);
  assert.equal(invoke(PANEL_CHANNELS.copyLink, 0), true);
  assert.deepEqual(copied, ['http://192.168.0.5:47300/?t=pairing-code']);
  host.setEnabled = async enabled => { host.enabled = enabled; };
  assert.equal((await invoke(PANEL_CHANNELS.setEnabled, true)).enabled, true);
  const previousToken = host.token;
  assert.notEqual((await invoke(PANEL_CHANNELS.regenerateToken)).token, previousToken);
  let joined;
  host.joinRemote = input => { joined = input; return { ok: true }; };
  assert.deepEqual(invoke(PANEL_CHANNELS.join, 'http://192.168.0.6:47300/?t=abcd'), { ok: true });
  assert.equal(joined, 'http://192.168.0.6:47300/?t=abcd');
  for (const channel of handlers.keys()) {
    assert.throws(() => handlers.get(channel)({ sender: {} }), /invalid-sender/);
  }
  destroy();
  assert.throws(() => invoke(PANEL_CHANNELS.getStatus), /invalid-sender/);
  dispose();
  assert.equal(handlers.size, 0);
});
