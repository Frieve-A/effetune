const assert = require('node:assert/strict');
const test = require('node:test');
const { registerAirPlayIpc } = require('../../electron/airplay-ipc.cjs');

function createHarness({ saveSucceeds = true, postFails = false } = {}) {
  const handlers = new Map();
  const calls = [];
  const mainFrame = {};
  const window = { webContents: {
    mainFrame,
    postMessage(...args) {
      calls.push(['post', ...args]);
      if (postFails) throw new Error('renderer navigated');
    }
  } };
  const ports = [];
  class MessageChannelMain {
    constructor() {
      this.port1 = { close() { calls.push(['close1']); } };
      this.port2 = { close() { calls.push(['close2']); } };
      ports.push(this);
    }
  }
  const dispose = registerAirPlayIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
    MessageChannelMain,
    host: {
      getStatus: () => ({ enabled: true, state: 'ready' }),
      setConfiguration: config => calls.push(['configure', config]),
      attachRendererPort: port => calls.push(['attach', port]),
      setRendererUnavailable: () => calls.push(['unavailable']),
      stopSession: () => calls.push(['stop'])
    },
    getMainWindow: () => window,
    config: { loadConfig: () => ({ language: 'ja' }), saveConfig: config => { calls.push(['save', config]); return saveSucceeds; } },
    constants: { setAppConfig: config => calls.push(['publish', config]) },
    getFriendlyName: () => 'Living Room'
  });
  const invoke = (name, payload, event = { sender: window.webContents, senderFrame: mainFrame }) =>
    handlers.get(`airplay-v1:${name}`)(event, payload);
  return { calls, handlers, ports, dispose, invoke, window };
}

test('AirPlay IPC persists only valid main-frame settings before applying them', async () => {
  const harness = createHarness();
  assert.throws(() => harness.invoke('set-enabled', { enabled: true }, { sender: {}, senderFrame: {} }));
  assert.throws(() => harness.invoke('set-enabled', { enabled: true }, { sender: harness.window.webContents, senderFrame: {} }));
  await assert.rejects(harness.invoke('set-enabled', { enabled: 'true' }), TypeError);
  assert.deepEqual(harness.calls, []);
  assert.deepEqual(await harness.invoke('set-enabled', { enabled: true }), { enabled: true, state: 'ready' });
  assert.deepEqual(harness.calls, [
    ['save', { language: 'ja', airPlayReceiver: true }],
    ['publish', { language: 'ja', airPlayReceiver: true }],
    ['configure', { enabled: true, friendlyName: 'Living Room' }]
  ]);
  const failed = createHarness({ saveSucceeds: false });
  await assert.rejects(failed.invoke('set-enabled', { enabled: true }));
  assert.equal(failed.calls.length, 1);
});

test('AirPlay IPC transfers a fresh renderer port and releases both ends on transfer failure', async () => {
  const harness = createHarness();
  await harness.invoke('renderer-ready');
  assert.deepEqual(harness.calls, [
    ['attach', harness.ports[0].port1],
    ['post', 'airplay-v1:port', null, [harness.ports[0].port2]]
  ]);
  harness.invoke('renderer-unavailable');
  harness.invoke('stop-session');
  assert.deepEqual(harness.calls.slice(-2), [['unavailable'], ['stop']]);
  harness.dispose();
  assert.equal(harness.handlers.size, 0);

  const failed = createHarness({ postFails: true });
  await assert.rejects(failed.invoke('renderer-ready'), /renderer navigated/);
  assert.deepEqual(failed.calls.slice(-3), [['close1'], ['close2'], ['unavailable']]);
});
