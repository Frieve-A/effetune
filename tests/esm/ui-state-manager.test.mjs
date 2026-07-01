import assert from 'node:assert/strict';
import test from 'node:test';

import { StateManager } from '../../js/ui/state-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function createElement(id, calls) {
  return {
    id,
    textContent: '',
    listeners: new Map(),
    classList: {
      toggles: [],
      toggle(className, enabled) {
        calls.push(['toggleClass', id, className, enabled]);
        this.toggles.push([className, enabled]);
      }
    },
    addEventListener(type, listener) {
      calls.push(['addEventListener', id, type]);
      this.listeners.set(type, listener);
    },
    click() {
      this.listeners.get('click')?.();
    }
  };
}

function createDocument(calls) {
  const elements = new Map();
  for (const id of ['errorDisplay', 'resetButton', 'shareButton', 'sampleRate']) {
    elements.set(id, createElement(id, calls));
  }
  return {
    elements,
    getElementById(id) {
      calls.push(['getElementById', id]);
      return elements.get(id) ?? null;
    }
  };
}

async function withStateGlobals(options, callback) {
  const calls = [];
  const documentRef = createDocument(calls);
  const windowRef = {
    electronAPI: options.electronAPI,
    electronIntegration: options.electronIntegration,
    uiManager: options.uiManager,
    location: {
      reload() {
        calls.push(['reload']);
      }
    }
  };
  await withGlobals({
    document: documentRef,
    window: windowRef,
    navigator: { userAgent: options.userAgent ?? 'Mozilla/5.0' }
  }, async () => callback({ calls, documentRef, windowRef }));
}

test('constructor updates reset button text in Electron environments detected by preload API', async () => {
  await withStateGlobals({ electronAPI: {} }, async ({ calls, documentRef }) => {
    const manager = new StateManager({ audioContext: { sampleRate: 48000 } });

    assert.equal(manager.resetButton.textContent, 'Config Audio');
    assert.equal(documentRef.elements.get('resetButton').listeners.has('click'), true);
    assert.ok(calls.some(call => call[0] === 'addEventListener' && call[1] === 'resetButton'));
  });
});

test('constructor recognizes Electron integration and user agent detection paths', async () => {
  await withStateGlobals({
    electronIntegration: { isElectronEnvironment: () => true }
  }, async ({ documentRef }) => {
    new StateManager({});
    assert.equal(documentRef.elements.get('resetButton').textContent, 'Config Audio');
  });

  await withStateGlobals({
    userAgent: 'Mozilla/5.0 electron/30.0'
  }, async ({ documentRef }) => {
    new StateManager({});
    assert.equal(documentRef.elements.get('resetButton').textContent, 'Config Audio');
  });
});

test('reset button opens Electron audio config dialog with translated and fallback status text', async () => {
  await withStateGlobals({
    electronIntegration: {
      isElectronEnvironment: () => true,
      showAudioConfigDialog() {}
    }
  }, async ({ calls, windowRef }) => {
    windowRef.electronIntegration.showAudioConfigDialog = () => calls.push(['showAudioConfigDialog']);
    const manager = new StateManager({});
    manager.resetButton.click();

    assert.deepEqual(calls.filter(call => call[0] === 'showAudioConfigDialog'), [['showAudioConfigDialog']]);
  });

  await withStateGlobals({
    electronAPI: {},
    electronIntegration: {
      showAudioConfigDialog() {}
    },
    uiManager: {
      t(key) {
        assert.equal(key, 'status.configuringAudio');
        return 'Translated configuring';
      }
    }
  }, async ({ calls, documentRef, windowRef }) => {
    windowRef.electronIntegration.showAudioConfigDialog = () => calls.push(['showAudioConfigDialog']);
    const manager = new StateManager({});
    manager.resetButton.click();

    assert.equal(documentRef.elements.get('errorDisplay').textContent, 'Translated configuring');
    assert.deepEqual(calls.filter(call => call[0] === 'showAudioConfigDialog'), [['showAudioConfigDialog']]);
  });

  await withStateGlobals({
    electronAPI: {},
    electronIntegration: {
      showAudioConfigDialog() {}
    }
  }, async ({ documentRef, windowRef, calls }) => {
    windowRef.electronIntegration.showAudioConfigDialog = () => calls.push(['showAudioConfigDialog']);
    const manager = new StateManager({});
    manager.resetButton.click();

    assert.equal(documentRef.elements.get('errorDisplay').textContent, 'Configuring audio devices...');
    assert.deepEqual(calls.filter(call => call[0] === 'showAudioConfigDialog'), [['showAudioConfigDialog']]);
  });
});

test('reset button reloads the web page with translated and fallback status text', async () => {
  await withStateGlobals({
    uiManager: {
      t(key) {
        assert.equal(key, 'status.reloading');
        return 'Translated reload';
      }
    }
  }, async ({ calls, documentRef }) => {
    const manager = new StateManager({});
    manager.resetButton.click();

    assert.equal(documentRef.elements.get('errorDisplay').textContent, 'Translated reload');
    assert.deepEqual(calls.filter(call => call[0] === 'reload'), [['reload']]);
  });

  await withStateGlobals({}, async ({ calls, documentRef }) => {
    const manager = new StateManager({});
    manager.resetButton.click();

    assert.equal(documentRef.elements.get('errorDisplay').textContent, 'Reloading...');
    assert.deepEqual(calls.filter(call => call[0] === 'reload'), [['reload']]);
  });
});

test('setError, clearError, and initAudio update visible UI state', async () => {
  await withStateGlobals({}, async ({ calls, documentRef }) => {
    const manager = new StateManager({ audioContext: { sampleRate: 96000 } });

    manager.setError('Failure', true);
    assert.equal(documentRef.elements.get('errorDisplay').textContent, 'Failure');
    assert.deepEqual(calls.filter(call => call[0] === 'toggleClass').at(-1), [
      'toggleClass',
      'errorDisplay',
      'error-message',
      true
    ]);

    manager.setError('Info', false);
    assert.equal(documentRef.elements.get('errorDisplay').textContent, 'Info');
    assert.deepEqual(calls.filter(call => call[0] === 'toggleClass').at(-1), [
      'toggleClass',
      'errorDisplay',
      'error-message',
      false
    ]);

    manager.clearError();
    assert.equal(documentRef.elements.get('errorDisplay').textContent, '');

    manager.initAudio();
    assert.equal(documentRef.elements.get('sampleRate').textContent, '96000 Hz');
  });
});

test('initAudio tolerates missing audio contexts', async () => {
  await withStateGlobals({}, async ({ documentRef }) => {
    const manager = new StateManager({});
    manager.initAudio();
    assert.equal(documentRef.elements.get('sampleRate').textContent, '');
  });
});
