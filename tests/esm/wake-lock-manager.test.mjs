import assert from 'node:assert/strict';
import test from 'node:test';

import { WakeLockManager } from '../../js/utils/wake-lock-manager.js';

async function flushAsyncWakeLock() {
  await Promise.resolve();
  await Promise.resolve();
}

function createStateManager(initialPlaying = false) {
  const listeners = new Set();
  const state = { isPlaying: initialPlaying };
  return {
    state,
    addListener(key, listener) {
      if (key === 'isPlaying') listeners.add(listener);
    },
    removeListener(key, listener) {
      if (key === 'isPlaying') listeners.delete(listener);
    },
    getStateSnapshot() {
      return { ...state };
    },
    setPlaying(isPlaying) {
      state.isPlaying = isPlaying;
      for (const listener of listeners) {
        listener(isPlaying);
      }
    },
    listenerCount() {
      return listeners.size;
    }
  };
}

function createLayoutMode(isMobile = true) {
  const listeners = new Set();
  const layoutMode = {
    isMobile,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setMobile(nextMobile) {
      this.isMobile = nextMobile;
      for (const listener of listeners) {
        listener(nextMobile ? 'mobile' : 'desktop');
      }
    },
    listenerCount() {
      return listeners.size;
    }
  };
  return layoutMode;
}

test('WakeLockManager holds a screen lock only while mobile playback is active and visible', async () => {
  const releases = [];
  const requests = [];
  const documentListeners = new Map();
  const documentRef = {
    hidden: false,
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (documentListeners.get(type) === listener) {
        documentListeners.delete(type);
      }
    }
  };
  const navigatorRef = {
    wakeLock: {
      async request(type) {
        requests.push(type);
        return {
          addEventListener() {},
          async release() {
            releases.push(type);
          }
        };
      }
    }
  };
  const stateManager = createStateManager(false);
  const layoutMode = createLayoutMode(true);

  const manager = new WakeLockManager({
    layoutMode,
    stateManager,
    navigatorRef,
    documentRef
  });

  assert.deepEqual(requests, []);

  stateManager.setPlaying(true);
  await flushAsyncWakeLock();
  assert.deepEqual(requests, ['screen']);

  documentRef.hidden = true;
  documentListeners.get('visibilitychange')();
  await flushAsyncWakeLock();
  assert.deepEqual(releases, ['screen']);

  documentRef.hidden = false;
  documentListeners.get('visibilitychange')();
  await flushAsyncWakeLock();
  assert.deepEqual(requests, ['screen', 'screen']);

  layoutMode.setMobile(false);
  await flushAsyncWakeLock();
  assert.deepEqual(releases, ['screen', 'screen']);

  manager.dispose();
  assert.equal(stateManager.listenerCount(), 0);
  assert.equal(layoutMode.listenerCount(), 0);
  assert.equal(documentListeners.size, 0);
});
