import assert from 'node:assert/strict';
import test from 'node:test';

import {
  registerPipelineStateCloseHandler,
  registerServiceWorker,
  startApplication
} from '../../js/app-bootstrap.js';
import { flushMicrotasks } from '../helpers/global-test-utils.mjs';

test('pipeline close handler sends state only after the output fade completes', async () => {
  const calls = [];
  let closeCallback;
  let finishFade;
  const electronAPI = {
    onRequestPipelineStateForClose(callback) { closeCallback = callback; },
    sendPipelineStateForClose(state) { calls.push(['send', state]); }
  };
  registerPipelineStateCloseHandler(() => ['state'], () => {
    calls.push(['fade']);
    return new Promise(resolve => { finishFade = resolve; });
  }, electronAPI);

  const closing = closeCallback();
  await flushMicrotasks();
  assert.deepEqual(calls, [['fade']]);
  finishFade();
  await closing;
  assert.deepEqual(calls, [['fade'], ['send', ['state']]]);
});

function createServiceWorkerWindow({ register = () => Promise.resolve(), idle = true } = {}) {
  const registrations = [];
  const idleCallbacks = [];
  const windowRef = {
    navigator: {
      serviceWorker: {
        register(url, options) {
          registrations.push([url, options]);
          return register();
        }
      }
    }
  };
  if (idle) {
    windowRef.requestIdleCallback = (callback, options) => idleCallbacks.push([callback, options]);
  }
  return { idleCallbacks, registrations, windowRef };
}

test('registerServiceWorker registers only after app initialization and an idle period', async () => {
  const { idleCallbacks, registrations, windowRef } = createServiceWorkerWindow();
  const warnings = [];
  let finishInitialization;

  registerServiceWorker(
    windowRef,
    { warn: (...args) => warnings.push(args) },
    new Promise(resolve => { finishInitialization = resolve; })
  );
  assert.ok(windowRef.webUpdateManager, 'the manager exists before application initialization');
  await flushMicrotasks();
  assert.equal(idleCallbacks.length, 0);

  finishInitialization();
  await flushMicrotasks();
  assert.equal(idleCallbacks.length, 1);
  assert.deepEqual(idleCallbacks[0][1], { timeout: 5000 });
  assert.deepEqual(registrations, []);

  idleCallbacks[0][0]();
  await flushMicrotasks();
  assert.deepEqual(registrations, [['./sw.js', { updateViaCache: 'none' }]]);
  assert.deepEqual(warnings, []);
});

test('registerServiceWorker still registers after failed initialization and without idle callbacks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { registrations, windowRef } = createServiceWorkerWindow({ idle: false });

  registerServiceWorker(windowRef, console, Promise.reject(new Error('init failed')));
  await flushMicrotasks();
  assert.deepEqual(registrations, []);

  t.mock.timers.tick(1000);
  assert.deepEqual(registrations, [['./sw.js', { updateViaCache: 'none' }]]);
});

test('registerServiceWorker reports registration failures', async () => {
  const { idleCallbacks, windowRef } = createServiceWorkerWindow({
    register: () => Promise.reject(new Error('register failed'))
  });
  const warnings = [];

  registerServiceWorker(windowRef, { warn: (...args) => warnings.push(args) });
  await flushMicrotasks();
  idleCallbacks[0][0]();
  await flushMicrotasks();

  assert.equal(warnings.length, 1);
});

test('startApplication registers the service worker once the app has initialized', async () => {
  const { idleCallbacks, windowRef } = createServiceWorkerWindow();
  let finishInitialization;
  class SlowApp {
    initialize() {
      return new Promise(resolve => { finishInitialization = resolve; });
    }
  }

  await startApplication({
    AppClass: SlowApp,
    firstLaunchPromise: Promise.resolve(false),
    startHeartbeat() {},
    windowRef
  });
  await flushMicrotasks();
  assert.ok(windowRef.webUpdateManager);
  assert.equal(idleCallbacks.length, 0);

  finishInitialization();
  await flushMicrotasks();
  assert.equal(idleCallbacks.length, 1);
});

test('registerServiceWorker skips Electron and missing service worker support', () => {
  const electronWindow = {
    electronIntegration: { isElectronEnvironment: () => true },
    navigator: {
      serviceWorker: {
        register() {
          throw new Error('should not register');
        }
      }
    },
    addEventListener() {
      throw new Error('should not add listener');
    }
  };
  const unsupportedWindow = {
    navigator: {},
    addEventListener() {
      throw new Error('should not add listener');
    }
  };

  registerServiceWorker(electronWindow);
  registerServiceWorker(unsupportedWindow);
  assert.ok(true);
});

test('registerServiceWorker cleans up registrations on the development server', async () => {
  const calls = [];
  const windowRef = {
    EFFECTUNE_DEV_SERVER: true,
    navigator: {
      serviceWorker: {
        register() {
          throw new Error('should not register');
        },
        getRegistrations() {
          calls.push('getRegistrations');
          return Promise.resolve([
            {
              unregister() {
                calls.push('unregister');
                return Promise.resolve(true);
              }
            }
          ]);
        }
      }
    },
    addEventListener() {
      throw new Error('should not add listener');
    }
  };

  registerServiceWorker(windowRef);
  await flushMicrotasks();

  assert.deepEqual(calls, ['getRegistrations', 'unregister']);
});

test('application startup never enumerates, opens, or deletes a legacy Web database', async () => {
  const legacyAccesses = [];
  const indexedDB = new Proxy({}, {
    get(_target, property) {
      legacyAccesses.push(String(property));
      throw new Error(`Unexpected legacy storage access: ${String(property)}`);
    }
  });
  const windowRef = {
    indexedDB,
    navigator: {}
  };
  class FakeApp {
    async initialize() {}
  }

  await startApplication({
    AppClass: FakeApp,
    firstLaunchPromise: Promise.resolve(false),
    startHeartbeat() {},
    windowRef
  });

  assert.deepEqual(legacyAccesses, []);
});
