import assert from 'node:assert/strict';
import test from 'node:test';
import { describeRemoteState, initRemoteControlButton } from '../../js/remote/remote-control-button.js';
import { flushMicrotasks } from '../helpers/global-test-utils.mjs';

function controls() {
  const button = Object.assign(new EventTarget(), {
    hidden: true, dataset: {}, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  });
  const badge = {};
  return { button, badge, document: { getElementById: id => id === 'remoteControlButton' ? button : badge } };
}

test('remote button descriptions distinguish disabled, unavailable, listening, and connected states', () => {
  for (const [status, expected] of [
    [null, { state: 'off', clients: 0, title: 'Remote Control' }],
    [{ enabled: false, clients: 5 }, { state: 'off', clients: 0, title: 'Remote Control' }],
    [{ error: 'Port unavailable' }, { state: 'error', clients: 0, title: 'Remote Control: unavailable' }],
    [{ enabled: true, clients: -1 }, { state: 'listening', clients: 0, title: 'Remote Control: listening' }],
    [{ enabled: true, clients: 1.5, port: 47300 }, { state: 'connected', clients: 1, title: 'Remote Control: 1 device connected (port 47300)' }],
    [{ enabled: true, clients: 2 }, { state: 'connected', clients: 2, title: 'Remote Control: 2 devices connected' }]
  ]) assert.deepEqual(describeRemoteState(status), expected);
});

test('remote button reflects status updates, opens the panel, and releases event subscriptions', async () => {
  const { button, badge, document } = controls();
  let listener, opened = 0, disposed = 0;
  const dispose = initRemoteControlButton({
    getStatus: async () => ({ enabled: true, clients: 1 }),
    onStatus(callback) { listener = callback; return () => { disposed += 1; }; },
    async openPanel() { opened += 1; }
  }, document);
  assert.equal(button.hidden, false);
  assert.equal(badge.hidden, true);
  await flushMicrotasks();
  assert.equal(button.dataset.state, 'connected');
  assert.equal(badge.textContent, '1');
  assert.equal(badge.hidden, false);
  assert.equal(button.attributes['aria-label'], button.title);
  listener({ enabled: true, clients: 100 });
  assert.equal(badge.textContent, '99+');
  listener({ enabled: false });
  assert.equal(button.dataset.state, 'off');
  assert.equal(badge.hidden, true);
  button.dispatchEvent(new Event('click'));
  assert.equal(opened, 1);
  dispose();
  button.dispatchEvent(new Event('click'));
  assert.equal(opened, 1);
  assert.equal(disposed, 1);
});

test('remote button bridge failures settle without leaving unhandled requests', async () => {
  const { button, document } = controls();
  let opened = 0;
  const dispose = initRemoteControlButton({
    async getStatus() { throw new Error('Bridge closed'); },
    async openPanel() { opened += 1; throw new Error('Panel unavailable'); }
  }, document);
  try {
    button.dispatchEvent(new Event('click'));
    await flushMicrotasks();
    assert.equal(opened, 1);
    assert.equal(button.dataset.state, 'off');
  } finally { dispose(); }
});

test('remote button stays hidden when the desktop bridge is unavailable', () => {
  for (const api of [null, {}]) {
    const { button, document } = controls();
    assert.equal(initRemoteControlButton(api, document), null);
    assert.equal(button.hidden, true);
  }
});
