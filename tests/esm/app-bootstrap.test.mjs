import assert from 'node:assert/strict';
import test from 'node:test';

import {
  registerServiceWorker,
  startApplication
} from '../../js/app-bootstrap.js';
import { flushMicrotasks } from '../helpers/global-test-utils.mjs';

test('registerServiceWorker registers the web service worker on load', async () => {
  const loadHandlers = [];
  const registrations = [];
  const warnings = [];
  const windowRef = {
    navigator: {
      serviceWorker: {
        register(url, options) {
          registrations.push([url, options]);
          return Promise.resolve();
        }
      }
    },
    addEventListener(type, handler) {
      if (type === 'load') {
        loadHandlers.push(handler);
      }
    }
  };

  registerServiceWorker(windowRef, { warn: (...args) => warnings.push(args) });

  assert.equal(loadHandlers.length, 1);
  loadHandlers[0]();
  await Promise.resolve();
  assert.deepEqual(registrations, [['./sw.js', { updateViaCache: 'none' }]]);
  assert.deepEqual(warnings, []);
});

test('registerServiceWorker registers immediately after load already completed', async () => {
  const registrations = [];
  const windowRef = {
    document: { readyState: 'complete' },
    navigator: {
      serviceWorker: {
        register(url, options) {
          registrations.push([url, options]);
          return Promise.resolve();
        }
      }
    },
    addEventListener() {
      throw new Error('should not wait for load');
    }
  };

  registerServiceWorker(windowRef);
  await Promise.resolve();

  assert.deepEqual(registrations, [['./sw.js', { updateViaCache: 'none' }]]);
});

test('registerServiceWorker reports registration failures', async () => {
  const loadHandlers = [];
  const warnings = [];
  const windowRef = {
    navigator: {
      serviceWorker: {
        register() {
          return Promise.reject(new Error('register failed'));
        }
      }
    },
    addEventListener(type, handler) {
      if (type === 'load') loadHandlers.push(handler);
    }
  };

  registerServiceWorker(windowRef, { warn: (...args) => warnings.push(args) });
  loadHandlers[0]();
  await flushMicrotasks();

  assert.equal(warnings.length, 1);
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
