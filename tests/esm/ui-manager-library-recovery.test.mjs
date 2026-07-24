import assert from 'node:assert/strict';
import test from 'node:test';

import { UIManager } from '../../js/ui-manager.js';
import { createWebCatalogRecoveryController } from '../../js/library/repository/catalog-client-factory.js';
import { createConsoleHarness, withGlobals } from '../helpers/global-test-utils.mjs';

class FakeClassList {
  constructor(...tokens) {
    this.tokens = new Set(tokens);
  }

  add(...tokens) {
    tokens.forEach(token => this.tokens.add(token));
  }

  remove(...tokens) {
    tokens.forEach(token => this.tokens.delete(token));
  }

  contains(token) {
    return this.tokens.has(token);
  }
}

function createDocument(...bodyClasses) {
  return {
    body: { classList: new FakeClassList(...bodyClasses) }
  };
}

async function withBoundedTimeout(promise, label, timeoutMs = 1000) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
        timeoutId.ref?.();
      })
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

test('unavailable startup Library falls back to Effect Pipeline without hiding it', async () => {
  const calls = [];
  const documentRef = createDocument('view-library');
  const manager = Object.assign(Object.create(UIManager.prototype), {
    libraryView: null,
    async ensureLibraryManager() {
      calls.push(['ensure']);
      return null;
    },
    showEffectPipelineView(options) {
      calls.push(['effects', options]);
      documentRef.body.classList.remove('view-library');
      return true;
    },
    showLibraryRecoveryShell() {
      calls.push(['recovery']);
      return true;
    }
  });

  await withGlobals({ document: documentRef }, async () => {
    assert.equal(await manager.showLibraryView({ initialView: 'albums', focusSearch: false }), false);
  });

  assert.equal(documentRef.body.classList.contains('view-library'), false);
  assert.deepEqual(calls, [
    ['ensure'],
    ['effects', { restoreFocus: false }]
  ]);
  assert.equal(manager.libraryDeferredStartupOptions.initialView, 'albums');
});

test('an unavailable Library opened explicitly shows the recovery shell', async () => {
  const calls = [];
  const manager = Object.assign(Object.create(UIManager.prototype), {
    libraryView: null,
    async ensureLibraryManager() {
      calls.push(['ensure']);
      return null;
    },
    showLibraryRecoveryShell() {
      calls.push(['recovery']);
      return true;
    }
  });

  assert.equal(await manager.showLibraryView({ focusSearch: false }), true);
  assert.deepEqual(calls, [['ensure'], ['recovery']]);
});

test('startup selection reaches the first Library view created by recovery', async () => {
  const calls = [];
  const documentRef = createDocument('view-library');
  const manager = Object.assign(Object.create(UIManager.prototype), {
    miniPlayerMode: false,
    miniPlayerTargetMode: false,
    libraryRecoveryState: {
      apiVersion: 1,
      status: 'initializing',
      available: false,
      canReset: false
    },
    libraryDeferredStartupOptions: null,
    libraryManager: null,
    libraryView: null,
    layoutMode: { isMobile: false },
    mobileNav: { setView() {} },
    renderLibraryRecoveryShell() {},
    hideLibraryRecoveryShell() {},
    updateViewSwitchButtons() {},
    async ensureLibraryManager() {
      if (!this.libraryManager) {
        this.libraryManager = {};
        this.libraryView = {
          currentView: 'tracks',
          show(options) {
            calls.push(['show', options]);
            this.currentView = options.initialView ?? this.currentView;
          }
        };
      }
      return this.libraryManager;
    }
  });

  manager.deferLibraryStartupView('subfolders');
  await withGlobals({ document: documentRef }, async () => {
    await manager.applyLibraryRecoveryState({
      apiVersion: 1,
      status: 'available',
      available: true,
      canReset: false
    });
  });

  assert.equal(manager.libraryView.currentView, 'subfolders');
  assert.equal(manager.libraryDeferredStartupOptions, null);
  assert.deepEqual(calls, [[
    'show',
    { focusSearch: false, returnFocus: undefined, initialView: 'subfolders' }
  ]]);
});

test('recovery transition disposes the old Library and rebuilds it after reset', async () => {
  const calls = [];
  const documentRef = createDocument('view-library');
  const manager = Object.assign(Object.create(UIManager.prototype), {
    libraryRecoveryState: {
      apiVersion: 1,
      status: 'available',
      available: true,
      canReset: false
    },
    libraryManager: { id: 'old-manager' },
    libraryView: { id: 'old-view' },
    libraryDeferredStartupOptions: null,
    renderLibraryRecoveryShell() {
      calls.push(['render', this.libraryRecoveryState.status]);
    },
    async disposeLibraryManager(options) {
      calls.push(['dispose', options]);
      this.libraryManager = null;
      this.libraryView = null;
    },
    showLibraryRecoveryShell() {
      calls.push(['show-recovery']);
      return true;
    },
    hideLibraryRecoveryShell() {
      calls.push(['hide-recovery']);
    },
    async ensureLibraryManager(options) {
      calls.push(['ensure', options]);
      this.libraryManager = { id: 'new-manager' };
      this.libraryView = {
        show(optionsArg) {
          calls.push(['show-library', optionsArg]);
        }
      };
      return this.libraryManager;
    }
  });

  await withGlobals({ document: documentRef }, async () => {
    await manager.applyLibraryRecoveryState({
      apiVersion: 1,
      status: 'unavailable',
      available: false,
      canReset: true
    });
    await manager.applyLibraryRecoveryState({
      apiVersion: 1,
      status: 'available',
      available: true,
      canReset: false
    });
  });

  assert.deepEqual(calls, [
    ['render', 'unavailable'],
    ['dispose', { destroyView: true }],
    ['show-recovery'],
    ['render', 'available'],
    ['hide-recovery'],
    ['ensure', { skipRecoveryWait: true }],
    ['show-library', { focusSearch: false }]
  ]);
  assert.equal(manager.libraryManager.id, 'new-manager');
});

test('reset request uses localized renderer confirmation and applies the returned state', async () => {
  const calls = [];
  const japaneseConfirmation = '保存されたミュージックライブラリのカタログをリセットしますか？';
  const resetButton = { disabled: false };
  const manager = Object.assign(Object.create(UIManager.prototype), {
    libraryRecoveryState: {
      apiVersion: 1,
      status: 'unavailable',
      available: false,
      canReset: true
    },
    libraryRecoveryResetButton: resetButton,
    libraryRecoveryApi: {
      async resetCatalog(request) {
        calls.push(['reset', request]);
        return {
          reset: true,
          recovered: true,
          state: { apiVersion: 1, status: 'available', available: true, canReset: false }
        };
      }
    },
    async queueLibraryRecoveryState(state) {
      calls.push(['state', state.status]);
      this.libraryRecoveryState = state;
    },
    renderLibraryRecoveryShell() {
      calls.push(['render']);
    },
    t(key) {
      assert.equal(key, 'library.recovery.confirm.reset');
      return japaneseConfirmation;
    }
  });

  await withGlobals({
    window: {
      confirm(message) {
        calls.push(['confirm', message]);
        return true;
      }
    }
  }, async () => {
    assert.equal(await manager.resetLibraryCatalog(), true);
  });
  assert.deepEqual(calls, [
    ['confirm', japaneseConfirmation],
    ['reset', { confirmed: true }],
    ['state', 'available']
  ]);
  assert.equal(resetButton.disabled, true);
});

test('queued Web startup recovery preserves its deferred subview without waiting on itself', async () => {
  const calls = [];
  const documentRef = createDocument('view-library');
  let managerAttempts = 0;
  let recoveryClients = 0;
  const recoveryApi = createWebCatalogRecoveryController({
    webClientFactory() {
      recoveryClients += 1;
      return {
        async resetCatalog() { calls.push(['clear-fixed-opfs']); },
        async close() { calls.push(['close-recovery-worker']); }
      };
    }
  });
  const manager = Object.assign(Object.create(UIManager.prototype), {
    libraryRecoveryApi: recoveryApi,
    libraryRecoveryState: recoveryApi.getState(),
    libraryRecoveryReadyPromise: Promise.resolve(recoveryApi.getState()),
    libraryRecoveryStateQueue: Promise.resolve(),
    libraryRecoveryResetButton: { disabled: false },
    libraryDeferredStartupOptions: null,
    libraryManager: null,
    libraryView: null,
    libraryInitPromise: null,
    libraryPlaybackBridge: null,
    miniPlayerMode: false,
    miniPlayerTargetMode: false,
    layoutMode: { isMobile: false },
    mobileNav: {
      attachLibraryView() {},
      setView() {}
    },
    updateViewSwitchButtons() {},
    createLibraryManager() {
      managerAttempts += 1;
      const attempt = managerAttempts;
      return {
        async init() {
          calls.push(['open', attempt]);
          if (attempt === 1) throw new Error('corrupt Web catalog details');
        },
        async close() { calls.push(['close-manager', attempt]); }
      };
    },
    createLibraryView() {
      return {
        currentView: 'tracks',
        mount() { calls.push(['mount']); },
        show(options) {
          calls.push(['show-library', options]);
          this.currentView = options.initialView ?? this.currentView;
          documentRef.body.classList.add('view-library');
        }
      };
    },
    connectLibraryPlaybackBridge() {},
    registerLibraryLifecycleCleanup() {},
    renderLibraryRecoveryShell() {},
    showLibraryRecoveryShell() {
      calls.push(['show-recovery']);
      return true;
    },
    hideLibraryRecoveryShell() { calls.push(['hide-recovery']); },
    showEffectPipelineView(options) {
      calls.push(['show-effects', options]);
      documentRef.body.classList.remove('view-library');
      return true;
    },
    t() { return '日本語の確認'; }
  });
  const unsubscribe = recoveryApi.onStateChange(state => {
    void manager.queueLibraryRecoveryState(state);
  });
  manager.deferLibraryStartupView('subfolders');

  await withGlobals({
    console: createConsoleHarness({ error() {} }),
    document: documentRef,
    window: {
      libraryManager: null,
      confirm(message) {
        calls.push(['confirm', message]);
        return true;
      }
    }
  }, async () => {
    await withBoundedTimeout(
      manager.queueLibraryRecoveryState(recoveryApi.getState()),
      'initial recovery state'
    );
    await withBoundedTimeout(manager.libraryRecoveryStateQueue, 'open-failure recovery state');
    assert.equal(manager.libraryRecoveryState.status, 'unavailable');
    assert.equal(documentRef.body.classList.contains('view-library'), false);
    assert.equal(manager.libraryDeferredStartupOptions.initialView, 'subfolders');
    assert.ok(calls.some(call => call[0] === 'show-effects'));

    assert.equal(await withBoundedTimeout(
      manager.resetLibraryCatalog(),
      'catalog reset'
    ), true);
    await withBoundedTimeout(manager.libraryRecoveryStateQueue, 'post-reset recovery state');
  });
  unsubscribe();

  assert.equal(recoveryClients, 1);
  assert.equal(managerAttempts, 2);
  assert.equal(manager.libraryRecoveryState.status, 'available');
  assert.equal(manager.libraryView.currentView, 'subfolders');
  assert.equal(manager.libraryDeferredStartupOptions, null);
  assert.ok(calls.some(call => call[0] === 'clear-fixed-opfs'));
  assert.ok(calls.some(call => call[0] === 'mount'));
  assert.ok(calls.some(call =>
    call[0] === 'show-library' && call[1].initialView === 'subfolders'
  ));
});
