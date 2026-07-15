import assert from 'node:assert/strict';
import test from 'node:test';

import {
  observeAudioWorkletFailures
} from '../../tools/library-scale/reference-browser-harness.mjs';

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

function createWorklet() {
  const worklet = new FakeEventTarget();
  worklet.port = new FakeEventTarget();
  worklet.port.start = () => {};
  return worklet;
}

test('reference harness counts production dspFailed messages', () => {
  const worklet = createWorklet();
  const observer = observeAudioWorkletFailures(worklet);
  worklet.port.dispatch('message', { data: { type: 'dspFailed' } });
  assert.deepEqual(observer.failures, ['dspFailed']);
  observer.dispose();
});

test('reference harness counts AudioWorkletNode processorerror events', () => {
  const worklet = createWorklet();
  const observer = observeAudioWorkletFailures(worklet);
  worklet.dispatch('processorerror');
  assert.deepEqual(observer.failures, ['processorerror']);
  observer.dispose();
});
