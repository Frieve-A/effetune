import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPowerSnapshot } from '../../js/audio/power-snapshot.js';
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

function createPowerStateProvider({ enabled = true, effectiveState = 'MONITORING' } = {}) {
  const listeners = new Set();
  const getSnapshot = () => buildPowerSnapshot({
    effectiveState,
    desiredState: effectiveState,
    topologyRevision: 1
  });
  return {
    isControllerEnabled() {
      return enabled;
    },
    getPowerSnapshot() {
      return getSnapshot();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setEnabled(nextEnabled) {
      enabled = nextEnabled;
      const snapshot = getSnapshot();
      for (const listener of listeners) listener({ detail: snapshot });
    },
    setEffectiveState(nextState) {
      effectiveState = nextState;
      const snapshot = getSnapshot();
      for (const listener of listeners) listener({ detail: snapshot });
    },
    listenerCount() {
      return listeners.size;
    }
  };
}

function createEventPowerStateProvider() {
  const listeners = new Set();
  let snapshot = buildPowerSnapshot({
    effectiveState: 'MONITORING',
    desiredState: 'MONITORING',
    topologyRevision: 1
  });
  return {
    isControllerEnabled() { return true; },
    getPowerSnapshot() { return snapshot; },
    addEventListener(name, listener) {
      if (name === 'powerStateChanged') listeners.add(listener);
    },
    removeEventListener(name, listener) {
      if (name === 'powerStateChanged') listeners.delete(listener);
    },
    emit(payload) {
      if (typeof payload === 'string') {
        snapshot = buildPowerSnapshot({
          effectiveState: payload,
          desiredState: payload,
          topologyRevision: 1
        });
        payload = { detail: snapshot };
      }
      for (const listener of listeners) listener(payload);
    },
    listenerCount() {
      return listeners.size;
    }
  };
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

  await manager.dispose();
  assert.equal(stateManager.listenerCount(), 0);
  assert.equal(layoutMode.listenerCount(), 0);
  assert.equal(documentListeners.size, 0);
});

test('WakeLockManager releases a pending request when playback stops before it resolves', async () => {
  const releases = [];
  let resolveRequest;
  const documentRef = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {}
  };
  const navigatorRef = {
    wakeLock: {
      request() {
        return new Promise(resolve => {
          resolveRequest = () => resolve({
            addEventListener() {},
            async release() {
              releases.push('screen');
            }
          });
        });
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

  stateManager.setPlaying(true);
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    if (resolveRequest) break;
  }
  assert.equal(typeof resolveRequest, 'function');
  stateManager.setPlaying(false);
  const pendingSync = manager.syncPromise;
  resolveRequest();
  await pendingSync;

  assert.deepEqual(releases, ['screen']);
  assert.equal(manager.lock, null);
  await manager.dispose();
});

test('WakeLockManager permits locks only in effective Active while its power provider is enabled', async () => {
  const requests = [];
  const releases = [];
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
  const documentRef = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {}
  };
  const stateManager = createStateManager(true);
  const layoutMode = createLayoutMode(true);
  const powerStateProvider = createPowerStateProvider({ effectiveState: 'MONITORING' });
  const manager = new WakeLockManager({
    layoutMode,
    stateManager,
    powerStateProvider,
    navigatorRef,
    documentRef
  });

  await manager.syncPromise;
  assert.deepEqual(requests, []);

  powerStateProvider.setEffectiveState('ACTIVE');
  await manager.syncPromise;
  assert.deepEqual(requests, ['screen']);

  powerStateProvider.setEffectiveState('SUSPENDED');
  await manager.syncPromise;
  assert.deepEqual(releases, ['screen']);

  await manager.dispose();
  assert.equal(powerStateProvider.listenerCount(), 0);
});

test('WakeLockManager preserves legacy eligibility when the optional power provider is disabled', async () => {
  const requests = [];
  const releases = [];
  const powerStateProvider = createPowerStateProvider({
    enabled: false,
    effectiveState: 'SUSPENDED'
  });
  const manager = new WakeLockManager({
    layoutMode: createLayoutMode(true),
    stateManager: createStateManager(true),
    powerStateProvider,
    navigatorRef: {
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
    },
    documentRef: {
      hidden: false,
      addEventListener() {},
      removeEventListener() {}
    }
  });

  await manager.syncPromise;
  assert.deepEqual(requests, ['screen']);

  powerStateProvider.setEnabled(true);
  await manager.syncPromise;
  assert.deepEqual(releases, ['screen']);

  powerStateProvider.setEnabled(false);
  await manager.syncPromise;
  assert.deepEqual(requests, ['screen', 'screen']);

  await manager.dispose();
  assert.deepEqual(releases, ['screen', 'screen']);
  assert.equal(powerStateProvider.listenerCount(), 0);
});

test('WakeLockManager dispose unsubscribes and releases a request that resolves late', async () => {
  const releases = [];
  let resolveRequest;
  const powerStateProvider = createPowerStateProvider({ effectiveState: 'ACTIVE' });
  const manager = new WakeLockManager({
    layoutMode: createLayoutMode(true),
    stateManager: createStateManager(true),
    powerStateProvider,
    navigatorRef: {
      wakeLock: {
        request() {
          return new Promise(resolve => {
            resolveRequest = () => resolve({
              addEventListener() {},
              async release() {
                releases.push('screen');
              }
            });
          });
        }
      }
    },
    documentRef: {
      hidden: false,
      addEventListener() {},
      removeEventListener() {}
    }
  });

  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    if (resolveRequest) break;
  }
  assert.equal(typeof resolveRequest, 'function');
  const disposePromise = manager.dispose();
  assert.equal(powerStateProvider.listenerCount(), 0);

  resolveRequest();
  await disposePromise;
  assert.deepEqual(releases, ['screen']);
  assert.equal(manager.lock, null);
});

test('WakeLockManager validates event snapshots and clears browser-released sentinels', async () => {
  const requests = [];
  const releases = [];
  let notifyReleased;
  const powerStateProvider = createEventPowerStateProvider();
  const manager = new WakeLockManager({
    layoutMode: createLayoutMode(true),
    stateManager: createStateManager(true),
    powerStateProvider,
    navigatorRef: {
      wakeLock: {
        async request(type) {
          requests.push(type);
          return {
            addEventListener(name, listener) {
              if (name === 'release') notifyReleased = listener;
            },
            async release() { releases.push(type); }
          };
        }
      }
    },
    documentRef: {
      hidden: false,
      addEventListener() {},
      removeEventListener() {}
    }
  });

  await manager.syncPromise;
  assert.deepEqual(requests, []);
  powerStateProvider.emit('ACTIVE');
  await manager.syncPromise;
  assert.deepEqual(requests, ['screen']);
  assert.equal(typeof notifyReleased, 'function');

  powerStateProvider.emit({
    detail: { schemaVersion: 999, effectiveState: 'ACTIVE' }
  });
  await manager.syncPromise;
  assert.deepEqual(releases, ['screen']);

  powerStateProvider.emit('ACTIVE');
  await manager.syncPromise;
  assert.deepEqual(requests, ['screen', 'screen']);

  notifyReleased();
  assert.equal(manager.lock, null);
  await manager.dispose();
  assert.equal(powerStateProvider.listenerCount(), 0);
});

test('WakeLockManager treats wake lock request and release failures as recoverable races', async () => {
  const requestFailureManager = new WakeLockManager({
    layoutMode: createLayoutMode(true),
    stateManager: createStateManager(true),
    navigatorRef: {
      wakeLock: {
        async request() {
          throw new Error('request failed');
        }
      }
    },
    documentRef: {
      hidden: false,
      addEventListener() {},
      removeEventListener() {}
    }
  });
  await requestFailureManager.syncPromise;
  assert.equal(requestFailureManager.lock, null);
  await requestFailureManager.dispose();

  const stateManager = createStateManager(true);
  const releaseFailureManager = new WakeLockManager({
    layoutMode: createLayoutMode(true),
    stateManager,
    navigatorRef: {
      wakeLock: {
        async request() {
          return {
            addEventListener() {},
            async release() {
              throw new Error('already released');
            }
          };
        }
      }
    },
    documentRef: {
      hidden: false,
      addEventListener() {},
      removeEventListener() {}
    }
  });
  await releaseFailureManager.syncPromise;
  stateManager.setPlaying(false);
  await releaseFailureManager.syncPromise;
  assert.equal(releaseFailureManager.lock, null);
  await releaseFailureManager.dispose();
});

test('WakeLockManager default environment adapters and repeated disposal are safe', async () => {
  const manager = new WakeLockManager();
  await manager.syncPromise;
  await manager.dispose();
  await manager.dispose();
  assert.equal(manager.lock, null);
});
