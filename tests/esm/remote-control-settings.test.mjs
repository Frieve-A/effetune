import assert from 'node:assert/strict';
import test from 'node:test';
import { createAndroidRemoteApi, getAndroidRemoteSettings } from '../../js/android/remote.js';
import { NetworkMusicSettings } from '../../js/network-music/settings-view.js';
import { getRemoteControlSettings } from '../../js/remote/remote-control-settings.js';
import { createConsoleHarness, flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const reads = [];
  const writes = [];
  const listeners = new Set();
  const api = {
    onStatus(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getStatus() { const pending = deferred(); reads.push(pending); return pending.promise; },
    setEnabled(enabled) { const pending = deferred(); writes.push({ enabled, ...pending }); return pending.promise; }
  };
  return { api, reads, writes, listeners, settings: getRemoteControlSettings(api) };
}

test('remote settings share one status subscription per API and release it after the last subscriber', async () => {
  const { api, settings, reads, listeners } = harness();
  assert.equal(getRemoteControlSettings(api), settings);
  assert.notEqual(harness().settings, settings);
  let firstUpdates = 0, secondUpdates = 0;
  const first = settings.subscribe(() => { firstUpdates += 1; });
  const second = settings.subscribe(() => { secondUpdates += 1; });
  assert.equal(reads.length, 1);
  assert.equal(listeners.size, 1);
  assert.equal(settings.busy, true);
  reads[0].resolve({ enabled: false });
  await flushMicrotasks();
  assert.equal(settings.busy, false);
  assert.deepEqual(settings.status, { enabled: false });
  assert.equal(firstUpdates, 2);
  assert.equal(secondUpdates, 2);
  first();
  listeners.values().next().value({ enabled: true });
  assert.equal(firstUpdates, 2);
  assert.equal(secondUpdates, 3);
  second();
  assert.equal(listeners.size, 0);
  assert.equal(settings.status, null);
  assert.equal(settings.busy, false);
  assert.equal(settings.errorKey, null);
});

test('remote enable requests are single-flight and expose the acknowledged status', async () => {
  const { settings, reads, writes } = harness();
  const unsubscribe = settings.subscribe(() => {});
  try {
    await settings.setEnabled(true);
    assert.equal(writes.length, 0);
    reads[0].resolve({ enabled: false });
    await flushMicrotasks();
    const enabling = settings.setEnabled(true);
    await settings.setEnabled(false);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].enabled, true);
    assert.equal(settings.busy, true);
    assert.deepEqual(settings.status, { enabled: false });
    writes[0].resolve({ enabled: true });
    await enabling;
    assert.deepEqual(settings.status, { enabled: true });
    assert.equal(settings.busy, false);
  } finally { unsubscribe(); }
});

test('failed remote changes preserve confirmed status, notify the UI, and allow retry', async () => {
  const diagnostics = [];
  await withGlobals({ console: createConsoleHarness({ error: (...args) => diagnostics.push(args) }) }, async () => {
    const { settings, reads, writes } = harness();
    const unsubscribe = settings.subscribe(() => {});
    try {
      reads[0].resolve({ enabled: false });
      await flushMicrotasks();
      const failed = settings.setEnabled(true);
      writes[0].reject(new Error('Connection refused'));
      await failed;
      assert.deepEqual(settings.status, { enabled: false });
      assert.equal(settings.errorKey, 'updateFailed');
      assert.equal(settings.busy, false);
      assert.equal(diagnostics.length, 1);
      const retried = settings.setEnabled(true);
      assert.equal(settings.errorKey, null);
      writes[1].resolve({ enabled: true });
      await retried;
      assert.deepEqual(settings.status, { enabled: true });
    } finally { unsubscribe(); }
  });
});

test('responses from an unsubscribed generation cannot overwrite a new settings session', async () => {
  const { settings, reads } = harness();
  const unsubscribe = settings.subscribe(() => {});
  unsubscribe();
  const current = settings.subscribe(() => {});
  try {
    reads[0].resolve({ enabled: true });
    await flushMicrotasks();
    assert.equal(settings.status, null);
    assert.equal(settings.busy, true);
    reads[1].resolve({ enabled: false });
    await flushMicrotasks();
    assert.deepEqual(settings.status, { enabled: false });
    assert.equal(settings.busy, false);
  } finally { current(); }
});

test('late remote errors do not restore an error or busy state after unsubscribe', async () => {
  await withGlobals({ console: createConsoleHarness({ error() {} }) }, async () => {
    const { settings, reads } = harness();
    const unsubscribe = settings.subscribe(() => {});
    unsubscribe();
    reads[0].reject(new Error('Expired request'));
    await flushMicrotasks();
    assert.equal(settings.errorKey, null);
    assert.equal(settings.busy, false);
    assert.equal(settings.status, null);
  });
});

test('Network settings use the supplied Remote capability and explain an unsupported HTTPS port', async t => {
  const diagnostics = [];
  await withGlobals({ console: createConsoleHarness({ error: (...args) => diagnostics.push(args) }) }, async () => {
    const calls = [];
    const bridge = {
      on: () => () => {},
      async request(command, payload) {
        calls.push([command, payload]);
        if (command === 'remote.getStatus') return { connection: { endpoint: '' } };
        if (command === 'remote.selectConnectionFile') return { selectionId: 'selection', fileName: 'certificate.pem' };
        if (command === 'remote.setConnection') throw Object.assign(new Error('internal detail'), { code: 'invalid-port' });
      }
    };
    const api = getAndroidRemoteSettings(bridge);
    const remoteSettings = getRemoteControlSettings(api);
    const document = {
      createElement(tag) {
        return { tag, children: [], appendChild(child) { this.children.push(child); }, setAttribute() {},
          addEventListener(type, action) { this[type] = action; } };
      }
    };
    const root = document.createElement('div');
    const view = new NetworkMusicSettings({ root, api: {}, remoteSettings, translate: key => key, documentRef: document });
    t.after(() => view.dispose());
    await view.mount();
    await flushMicrotasks();
    assert.equal(view.endpoint.disabled, false);
    await view.connectionControls[1].click();
    assert.equal(view.fileNames.certificate.textContent, 'certificate.pem');
    view.endpoint.value = 'https://music.example';
    await view.connectionControls[3].click();
    assert.deepEqual(calls, [
      ['remote.getStatus', undefined],
      ['remote.selectConnectionFile', { kind: 'certificate' }],
      ['remote.setConnection', { endpoint: 'https://music.example', certificateSelection: 'selection', keySelection: undefined }]
    ]);
    assert.equal(view.status.textContent, 'networkMusic.settings.unprivilegedPort');
    assert.equal(diagnostics.length, 1);
  });
});

test('Android approval focuses Deny and dismisses only the matching request', async () => {
  const calls = [];
  const events = new Map();
  const bridge = {
    on: (event, listener) => { events.set(event, listener); return () => events.delete(event); },
    async request(command, payload) { calls.push([command, payload]); return { accepted: true }; }
  };
  let focused;
  const make = tag => ({
    tag, children: [],
    append(child) { this.children.push(child); },
    setAttribute() {},
    addEventListener(event, listener) { this[event] = listener; },
    showModal() { this.open = true; },
    close() { this.open = false; },
    remove() { this.removed = true; },
    focus() { focused = this; }
  });
  const document = { createElement: make, body: make('body') };
  const window = { document, uiManager: { t: key => key }, addEventListener() {}, removeEventListener() {} };
  await withGlobals({ window }, async () => {
    createAndroidRemoteApi(bridge);
    events.get('pairing-request')({ requestId: 'pending', clientName: 'Living room', address: '192.168.1.2' });
    const dialog = document.body.children[0];
    assert.equal(focused.textContent, 'dialog.remoteControl.pairingRequestDeny');
    assert.equal(dialog.open, true);
    events.get('pairing-ended')({ requestId: 'older', status: 'expired' });
    assert.equal(dialog.open, true);
    let prevented = false;
    dialog.cancel({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(calls, [['remote.pairDecision', { requestId: 'pending', allow: false }]]);
    events.get('pairing-ended')({ requestId: 'pending', status: 'denied' });
    assert.equal(dialog.open, false);
    assert.equal(dialog.removed, true);
  });
});

test('a denied Android local network permission is kept as its own Remote and Network settings error', async () => {
  const window = { location: { origin: 'https://appassets.androidplatform.net' }, effetuneAndroid: { postMessage() {} } };
  await withGlobals({ window, console: createConsoleHarness({ error() {} }) }, async () => {
    const { settings, reads, writes } = harness();
    const unsubscribe = settings.subscribe(() => {});
    reads[0].resolve({ enabled: false });
    await flushMicrotasks();
    const pending = settings.setEnabled(true);
    writes[0].reject(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await pending;
    assert.equal(settings.errorKey, 'localNetworkPermission');
    unsubscribe();

    const view = new NetworkMusicSettings({ root: null, api: {}, translate: key => `label:${key}` });
    view.status = {};
    await view.run(async () => { throw Object.assign(new Error('required'), { code: 'permission-required' }); });
    assert.equal(view.status.textContent, 'label:dialog.config.localNetworkPermission');
  });
});
