const assert = require('node:assert/strict');
const test = require('node:test');
const { registerNetworkOutputIpc } = require('../../electron/network-output-ipc.cjs');

const STATUS = { enabled: true, localTrimMs: 0, localDelayMs: 2000, targets: [] };

function createHarness({ saveSucceeds = true, postFails = false, attachFails = false, stored, status = STATUS } = {}) {
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
  class MessageChannelMain {
    constructor() {
      this.port1 = { close() { calls.push(['close1']); } };
      this.port2 = { close() { calls.push(['close2']); } };
    }
  }
  let loaded = { language: 'ja', ...(stored ? { networkOutput: stored } : {}) };
  const dispose = registerNetworkOutputIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
    MessageChannelMain,
    host: {
      getStatus: () => status,
      onDiagnostic: (code, detail) => calls.push(['diagnostic', code, detail instanceof Error]),
      setConfiguration: async config => { calls.push(['configure', config]); return STATUS; },
      setPickerOpen: async open => { calls.push(['picker', open]); return status; },
      attachRendererPort: async port => { calls.push(['attach', port]); if (attachFails) throw new Error('attach failed'); },
      setRendererUnavailable: async () => { calls.push(['unavailable']); return STATUS; },
      resync: async () => { calls.push(['resync']); return STATUS; }
    },
    getMainWindow: () => window,
    config: { loadConfig: () => loaded, saveConfig: config => {
      calls.push(['save', config]);
      if (saveSucceeds) loaded = config;
      return saveSucceeds;
    } },
    constants: { setAppConfig: config => calls.push(['publish', config]) }
  });
  const event = { sender: window.webContents, senderFrame: mainFrame };
  const invoke = (name, payload, sender = event) => handlers.get(`network-output-v1:${name}`)(sender, payload);
  const setTarget = (id, enabled) => handlers.get('network-output-v1:set-target-enabled')(event, id, enabled);
  return { calls, handlers, dispose, invoke, setTarget, window };
}

test('Network Output IPC validates the merged configuration before saving and applying it', async () => {
  const harness = createHarness({ stored: { enabled: false, localTrimMs: -300, targets: [{ id: 'a', type: 'upnp', name: 'A', enabled: true, trimMs: 10 }] } });
  assert.throws(() => harness.invoke('set-configuration', { enabled: true }, { sender: {}, senderFrame: {} }));
  assert.throws(() => harness.invoke('set-configuration', { enabled: true }, { sender: harness.window.webContents, senderFrame: {} }));
  await assert.rejects(harness.invoke('set-configuration', null), TypeError);
  await assert.rejects(harness.invoke('set-configuration', { enabled: 'true' }), TypeError);
  await assert.rejects(harness.invoke('set-configuration', { localTrimMs: 2001 }), TypeError);
  await assert.rejects(harness.invoke('set-configuration', { targets: [{ id: 'a', type: 'upnp', name: 'A', enabled: true, trimMs: -1 }] }), TypeError);
  assert.deepEqual(harness.calls, []);

  assert.deepEqual(await harness.invoke('set-configuration', { enabled: true }), STATUS);
  const expected = { enabled: true, localEnabled: true, localTrimMs: -300, targets: [{ id: 'a', type: 'upnp', name: 'A', enabled: true, trimMs: 10 }] };
  assert.deepEqual(harness.calls, [
    ['save', { language: 'ja', networkOutput: expected }],
    ['publish', { language: 'ja', networkOutput: expected }],
    ['configure', expected]
  ]);

  const fresh = createHarness();
  await fresh.invoke('set-configuration', { targets: [] });
  assert.deepEqual(fresh.calls.at(-1), ['configure', { enabled: false, localEnabled: true, localTrimMs: 0, targets: [] }]);

  const failed = createHarness({ saveSucceeds: false });
  await assert.rejects(failed.invoke('set-configuration', { enabled: true }), /save/);
  assert.deepEqual(failed.calls.map(call => call[0]), ['save']);
});

test('Network Output IPC patches a damaged saved configuration on top of the default', async () => {
  const harness = createHarness({ stored: { enabled: false, localTrimMs: 5000, targets: [{ id: 'a', type: 'upnp', name: 'A', enabled: true, trimMs: -1 }] } });
  assert.deepEqual(await harness.invoke('set-configuration', { enabled: true }), STATUS);
  const expected = { enabled: true, localEnabled: true, localTrimMs: 0, targets: [] };
  assert.deepEqual(harness.calls, [
    ['diagnostic', 'network-output-config-invalid', true],
    ['save', { language: 'ja', networkOutput: expected }],
    ['publish', { language: 'ja', networkOutput: expected }],
    ['configure', expected]
  ]);

  const malformed = createHarness({ stored: 'broken' });
  await malformed.invoke('set-configuration', { localTrimMs: -250 });
  assert.deepEqual(malformed.calls[0], ['diagnostic', 'network-output-config-invalid', true]);
  assert.deepEqual(malformed.calls.at(-1), ['configure', { enabled: false, localEnabled: true, localTrimMs: -250, targets: [] }]);
  await assert.rejects(malformed.invoke('set-configuration', { localTrimMs: 2001 }), TypeError, 'the patch itself is still validated');
});

test('picker starts only the selected receiver and preserves local output and saved delay trims', async () => {
  const saved = { id: 'a', type: 'upnp', name: 'A', enabled: true, trimMs: 45 };
  const discovered = { id: 'b', type: 'cast', name: 'B', enabled: false, trimMs: 0 };
  const harness = createHarness({
    status: { ...STATUS, enabled: false, targets: [saved, discovered] },
    stored: { enabled: false, localTrimMs: -100, targets: [saved] }
  });
  await harness.invoke('set-picker-open', true);
  await Promise.all([harness.invoke('set-configuration', { localEnabled: false }), harness.setTarget('b', true)]);
  assert.deepEqual(harness.calls.at(-1), ['configure', {
    enabled: true, localEnabled: false, localTrimMs: -100,
    targets: [{ ...saved, enabled: false }, { ...discovered, enabled: true }]
  }]);
  await assert.rejects(harness.setTarget('missing', true), /unavailable/);
  await harness.invoke('set-picker-open', false);
  assert.deepEqual(harness.calls.filter(call => call[0] === 'picker'), [['picker', true], ['picker', false]]);
});

test('Network Output IPC hands one port to the host and the other to the main frame', async () => {
  const harness = createHarness();
  assert.deepEqual(await harness.invoke('renderer-ready', {}), STATUS);
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[0][0], 'attach');
  assert.deepEqual(harness.calls[1].slice(0, 3), ['post', 'network-output-v1:port', null]);
  assert.equal(harness.calls[1][3].length, 1);
  assert.notEqual(harness.calls[0][1], harness.calls[1][3][0]);

  const posting = createHarness({ postFails: true });
  await assert.rejects(posting.invoke('renderer-ready', {}), /navigated/);
  assert.deepEqual(posting.calls.map(call => call[0]), ['attach', 'post', 'close1', 'close2', 'unavailable']);

  const attaching = createHarness({ attachFails: true });
  await assert.rejects(attaching.invoke('renderer-ready', {}), /attach/);
  assert.deepEqual(attaching.calls.map(call => call[0]), ['attach', 'close1', 'close2', 'unavailable']);

  assert.deepEqual(await harness.invoke('get-status', {}), STATUS);
  await harness.invoke('renderer-unavailable', {});
  await harness.invoke('resync', {});
  assert.deepEqual(harness.calls.slice(2).map(call => call[0]), ['unavailable', 'resync']);
  assert.deepEqual([...harness.handlers.keys()].sort(), [
    'network-output-v1:get-clock', 'network-output-v1:get-status', 'network-output-v1:renderer-ready', 'network-output-v1:renderer-unavailable',
    'network-output-v1:resync', 'network-output-v1:set-configuration', 'network-output-v1:set-picker-open',
    'network-output-v1:set-target-enabled', 'network-output-v1:update-route'
  ]);
  harness.dispose();
  assert.equal(harness.handlers.size, 0);
});
