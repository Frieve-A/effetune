import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as turn } from 'node:timers/promises';
import { NetworkOutputIntegration } from '../../js/electron/networkOutputIntegration.js';
import { createConsoleHarness, withGlobals } from '../helpers/global-test-utils.mjs';

function createFixture({ bridge = {}, status = { enabled: true, localDelayMs: 2300, syncDelayMs: 2000, syncRevision: 0, targets: [] } } = {}) {
  const calls = [];
  const listeners = new Map();
  const statusListeners = new Set();
  const windowRef = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); }
  };
  const audioManager = {
    setNetworkOutputPort(port) { calls.push(['port', port]); },
    setNetworkOutputLocalDelay(...args) { calls.push(['delay', ...args]); },
    setNetworkOutputPortRequester(requester) { calls.push(['requester', requester]); }
  };
  const fullBridge = {
    async getStatus() { calls.push(['getStatus']); return status; },
    async rendererReady() { calls.push(['rendererReady']); },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    ...bridge
  };
  const integration = new NetworkOutputIntegration(audioManager, { windowRef, bridge: fullBridge });
  return {
    integration, calls, listeners, statusListeners, windowRef,
    emitStatus(next) { for (const listener of statusListeners) listener(next); },
    postMessage(event) { listeners.get('message')?.(event); }
  };
}

test('clears the host route when Send is absent even without paths', async () => {
  const updates = [];
  const fixture = createFixture({ bridge: { getClock: async () => 0,
    updateRoute: async route => updates.push(route) } });
  fixture.integration.audioManager.networkRoute = { sendId: null, revision: 2 };
  await fixture.integration.reportRoute();
  assert.deepEqual(updates, [{ active: false, physicalOutputMs: null }]);
  fixture.integration.dispose();
});

test('startup status, pushed status, and port requests reach the audio manager', async () => {
  const fixture = createFixture();
  await turn();
  assert.equal(fixture.calls[0][0], 'requester');
  assert.equal(typeof fixture.calls[0][1], 'function');
  assert.deepEqual(fixture.calls.slice(1), [['getStatus'], ['delay', true, 2300, true, 2000, 0]]);
  fixture.calls.length = 0;
  fixture.emitStatus({ enabled: false, localEnabled: false, localDelayMs: 0, targets: [] });
  fixture.emitStatus({ enabled: true, localEnabled: false, localDelayMs: 2300, syncDelayMs: 2000, syncRevision: 1 });
  fixture.emitStatus({ enabled: true, localDelayMs: 'oops' });
  fixture.emitStatus(null);
  assert.deepEqual(fixture.calls, [
    ['delay', false, 0, false, undefined, undefined], ['delay', true, 2300, false, 2000, 1],
    ['delay', true, 0, true, undefined, undefined]
  ]);
});

test('a pending startup read cannot roll back a pushed resync status', async () => {
  let finishRead;
  const fixture = createFixture({ bridge: { getStatus: () => new Promise(resolve => { finishRead = resolve; }) } });
  await turn();
  fixture.emitStatus({ enabled: true, localDelayMs: 2000, syncDelayMs: 2000, syncRevision: 1 });
  finishRead({ enabled: true, localDelayMs: 2000, syncDelayMs: 2000, syncRevision: 0 });
  await turn();
  assert.deepEqual(fixture.calls.filter(call => call[0] === 'delay'), [['delay', true, 2000, true, 2000, 1]]);
});

test('the registered requester calls rendererReady and only warns when it fails', async () => {
  const warnings = [];
  const console = createConsoleHarness({ warn: (...args) => warnings.push(args) });
  await withGlobals({ console }, async () => {
    const fixture = createFixture({ bridge: { async rendererReady() { throw new Error('ipc closed'); } } });
    await turn();
    const requester = fixture.calls.find(call => call[0] === 'requester')[1];
    requester();
    await turn();
    await turn();
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /Renderer registration failed/);
  });
  const fixture = createFixture();
  await turn();
  const requester = fixture.calls.find(call => call[0] === 'requester')[1];
  fixture.calls.length = 0;
  requester();
  await turn();
  assert.deepEqual(fixture.calls, [['rendererReady']]);
});

test('window messages relay the port only when they come from the window with exactly one port', async () => {
  const fixture = createFixture();
  await turn();
  fixture.calls.length = 0;
  const port = { id: 'port' };
  fixture.postMessage({ source: {}, data: { type: 'effetune-network-output-v1-port' }, ports: [port] });
  fixture.postMessage({ source: fixture.windowRef, data: { type: 'other' }, ports: [port] });
  fixture.postMessage({ source: fixture.windowRef, data: { type: 'effetune-network-output-v1-port' }, ports: [] });
  fixture.postMessage({ source: fixture.windowRef, data: { type: 'effetune-network-output-v1-port' }, ports: [port, port] });
  assert.deepEqual(fixture.calls, []);
  fixture.postMessage({ source: fixture.windowRef, data: { type: 'effetune-network-output-v1-port' }, ports: [port] });
  assert.deepEqual(fixture.calls, [['port', port]]);
});

test('dispose removes the listener, the requester, and the status subscription', async () => {
  const fixture = createFixture();
  await turn();
  assert.equal(fixture.statusListeners.size, 1);
  fixture.calls.length = 0;
  fixture.integration.dispose();
  assert.equal(fixture.listeners.has('message'), false);
  assert.equal(fixture.statusListeners.size, 0);
  assert.deepEqual(fixture.calls, [['requester', null]]);
  fixture.postMessage({ source: fixture.windowRef, data: { type: 'effetune-network-output-v1-port' }, ports: [{}] });
  assert.deepEqual(fixture.calls, [['requester', null]]);
});

test('a failing getStatus warns and the integration stays harmless without a bridge', async () => {
  const warnings = [];
  const console = createConsoleHarness({ warn: (...args) => warnings.push(args) });
  await withGlobals({ console }, async () => {
    const fixture = createFixture({ bridge: { async getStatus() { throw new Error('ipc closed'); } } });
    await turn();
    await turn();
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /Status could not be read/);
    assert.equal(fixture.calls.some(call => call[0] === 'delay'), false);
  });
  const calls = [];
  const windowRef = { addEventListener() { calls.push('listen'); }, removeEventListener() { calls.push('unlisten'); } };
  const audioManager = { setNetworkOutputPortRequester(requester) { calls.push(['requester', requester]); } };
  const integration = new NetworkOutputIntegration(audioManager, { windowRef, bridge: undefined });
  await turn();
  integration.dispose();
  assert.deepEqual(calls, []);
  assert.doesNotThrow(() => new NetworkOutputIntegration({}, { windowRef: null, bridge: undefined }).dispose());
});
