import assert from 'node:assert/strict';
import test from 'node:test';

import { EventManager } from '../../js/audio/event-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function createDocumentHarness() {
  const listeners = [];
  return {
    listeners,
    document: {
      addEventListener(type, listener, options) {
        listeners.push({ type, listener, options });
      }
    }
  };
}

test('EventManager registers passive user activity listeners and posts worklet activity', async () => {
  const harness = createDocumentHarness();
  const messages = [];
  const audioManager = {
    workletNode: {
      port: {
        postMessage: message => messages.push(message)
      }
    }
  };

  await withGlobals({ document: harness.document }, async () => {
    const manager = new EventManager(audioManager);
    assert.equal(manager.eventListeners.sleepModeChanged.length, 0);
    assert.equal(harness.listeners.length, 11);
    assert.deepEqual(harness.listeners[0], {
      type: 'mousedown',
      listener: harness.listeners[0].listener,
      options: { passive: true }
    });

    harness.listeners[0].listener();
  });

  assert.deepEqual(messages, [{ type: 'userActivity' }]);
});

test('EventManager ignores user activity when the worklet is unavailable', async () => {
  const harness = createDocumentHarness();

  await withGlobals({ document: harness.document }, async () => {
    const manager = new EventManager({});
    assert.doesNotThrow(() => manager.handleUserActivity());
  });
});

test('EventManager adds, removes, and dispatches named listeners', async () => {
  const harness = createDocumentHarness();
  const calls = [];

  await withGlobals({ document: harness.document }, async () => {
    const manager = new EventManager({});
    const first = data => calls.push(['first', data]);
    const second = data => calls.push(['second', data]);

    manager.addEventListener('custom', first);
    manager.addEventListener('custom', second);
    manager.dispatchEvent('custom', { active: true });
    manager.removeEventListener('custom', first);
    manager.dispatchEvent('custom', { active: false });
    manager.removeEventListener('missing', first);
    manager.dispatchEvent('missing', {});
  });

  assert.deepEqual(calls, [
    ['first', { active: true }],
    ['second', { active: true }],
    ['second', { active: false }]
  ]);
});
