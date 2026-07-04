import assert from 'node:assert/strict';
import test from 'node:test';

import { StateManager } from '../../js/ui/state-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function createElement(id, calls) {
  return {
    id,
    textContent: '',
    hidden: false,
    title: '',
    attributes: new Map(),
    listeners: new Map(),
    classList: {
      classes: new Set(),
      toggles: [],
      toggle(className, enabled) {
        calls.push(['toggleClass', id, className, enabled]);
        this.toggles.push([className, enabled]);
        if (enabled === undefined) {
          if (this.classes.has(className)) {
            this.classes.delete(className);
          } else {
            this.classes.add(className);
          }
          return;
        }
        if (enabled) {
          this.classes.add(className);
        } else {
          this.classes.delete(className);
        }
      },
      add(className) {
        calls.push(['addClass', id, className]);
        this.classes.add(className);
      },
      remove(className) {
        calls.push(['removeClass', id, className]);
        this.classes.delete(className);
      },
      contains(className) {
        return this.classes.has(className);
      }
    },
    addEventListener(type, listener) {
      calls.push(['addEventListener', id, type]);
      this.listeners.set(type, listener);
    },
    setAttribute(name, value) {
      calls.push(['setAttribute', id, name, value]);
      this.attributes.set(name, value);
    },
    getAttribute(name) {
      return this.attributes.get(name);
    },
    click() {
      return this.listeners.get('click')?.();
    }
  };
}

function createDocument(calls) {
  const elements = new Map();
  for (const id of [
    'errorDisplay',
    'resetButton',
    'shareButton',
    'sampleRate',
    'settingsMenuButton',
    'settingsMenu',
    'configSettingsButton',
    'audioConfigSettingsButton',
    'benchmarkSettingsButton',
    'measurementSettingsButton',
    'resetAudioSettingsButton'
  ]) {
    elements.set(id, createElement(id, calls));
  }
  return {
    elements,
    getElementById(id) {
      calls.push(['getElementById', id]);
      return elements.get(id) ?? null;
    },
    addEventListener(type, listener) {
      calls.push(['document.addEventListener', type, typeof listener]);
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

test('constructor exposes the settings gear as Config Audio in Electron environments detected by preload API', async () => {
  await withStateGlobals({ electronAPI: {} }, async ({ calls, documentRef }) => {
    const manager = new StateManager({ audioContext: { sampleRate: 48000 } });

    assert.equal(manager.resetButton.hidden, true);
    assert.equal(manager.settingsMenuButton.title, 'Config Audio');
    assert.equal(manager.settingsMenuButton.getAttribute('aria-label'), 'Config Audio');
    assert.equal(manager.settingsMenu.hidden, true);
    assert.equal(documentRef.elements.get('settingsMenuButton').listeners.has('click'), true);
    assert.ok(calls.some(call => call[0] === 'addEventListener' && call[1] === 'settingsMenuButton'));
  });
});

test('constructor recognizes Electron integration and user agent detection paths', async () => {
  await withStateGlobals({
    electronIntegration: { isElectronEnvironment: () => true }
  }, async ({ documentRef }) => {
    new StateManager({});
    assert.equal(documentRef.elements.get('settingsMenuButton').title, 'Config Audio');
    assert.equal(documentRef.elements.get('settingsMenu').hidden, true);
  });

  await withStateGlobals({
    userAgent: 'Mozilla/5.0 electron/30.0'
  }, async ({ documentRef }) => {
    new StateManager({});
    assert.equal(documentRef.elements.get('settingsMenuButton').title, 'Config Audio');
    assert.equal(documentRef.elements.get('settingsMenu').hidden, true);
  });
});

test('settings gear opens Electron audio config dialog with translated and fallback status text', async () => {
  await withStateGlobals({
    electronIntegration: {
      isElectronEnvironment: () => true,
      showAudioConfigDialog() {}
    }
  }, async ({ calls, windowRef }) => {
    windowRef.electronIntegration.showAudioConfigDialog = () => calls.push(['showAudioConfigDialog']);
    const manager = new StateManager({});
    manager.settingsMenuButton.click();

    assert.deepEqual(calls.filter(call => call[0] === 'showAudioConfigDialog'), [['showAudioConfigDialog']]);
  });

  await withStateGlobals({
    electronAPI: {},
    electronIntegration: {
      showAudioConfigDialog() {}
    },
    uiManager: {
      t(key) {
        return key === 'status.configuringAudio' ? 'Translated configuring' : key;
      }
    }
  }, async ({ calls, documentRef, windowRef }) => {
    windowRef.electronIntegration.showAudioConfigDialog = () => calls.push(['showAudioConfigDialog']);
    const manager = new StateManager({});
    manager.settingsMenuButton.click();

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
    manager.settingsMenuButton.click();

    assert.equal(documentRef.elements.get('errorDisplay').textContent, 'Configuring audio devices...');
    assert.deepEqual(calls.filter(call => call[0] === 'showAudioConfigDialog'), [['showAudioConfigDialog']]);
  });
});

test('settings menu reset item reloads the web page with translated and fallback status text', async () => {
  await withStateGlobals({
    uiManager: {
      t(key) {
        return key === 'status.reloading' ? 'Translated reload' : key;
      }
    }
  }, async ({ calls, documentRef }) => {
    const manager = new StateManager({});
    await manager.resetAudioSettingsButton.click();

    assert.equal(documentRef.elements.get('errorDisplay').textContent, 'Translated reload');
    assert.deepEqual(calls.filter(call => call[0] === 'reload'), [['reload']]);
  });

  await withStateGlobals({}, async ({ calls, documentRef }) => {
    const manager = new StateManager({});
    await manager.resetAudioSettingsButton.click();

    assert.equal(documentRef.elements.get('errorDisplay').textContent, 'Reloading...');
    assert.deepEqual(calls.filter(call => call[0] === 'reload'), [['reload']]);
  });
});

test('settings menu reset item reports audioManager reset outcomes without reloading', async () => {
  await withStateGlobals({
    uiManager: {
      t(key) {
        return key === 'status.resettingAudio' ? 'Translated reset' : key;
      }
    }
  }, async ({ calls, documentRef }) => {
    const manager = new StateManager({
      reset: async value => {
        calls.push(['audio.reset', value]);
        return '';
      }
    });
    await manager.resetAudioSettingsButton.click();

    assert.deepEqual(calls.filter(call => call[0] === 'audio.reset'), [['audio.reset', null]]);
    assert.equal(documentRef.elements.get('errorDisplay').textContent, '');
    assert.deepEqual(calls.filter(call => call[0] === 'reload'), []);
  });

  await withStateGlobals({}, async ({ calls, documentRef }) => {
    const manager = new StateManager({
      reset: async () => 'Audio Error: reset failed'
    });
    await manager.resetAudioSettingsButton.click();

    assert.equal(documentRef.elements.get('errorDisplay').textContent, 'Audio Error: reset failed');
    assert.deepEqual(calls.filter(call => call[0] === 'reload'), []);
  });
});

test('settings menu opens Web audio config when integration is available', async () => {
  await withStateGlobals({
    electronIntegration: {
      isElectronEnvironment: () => false,
      showAudioConfigDialog() {}
    },
    uiManager: {
      t(key) {
        return key === 'status.configuringAudio' ? 'Translated configuring' : key;
      }
    }
  }, async ({ calls, documentRef, windowRef }) => {
    windowRef.electronIntegration.showAudioConfigDialog = () => calls.push(['showAudioConfigDialog']);
    const manager = new StateManager({});
    manager.settingsMenuButton.click();
    assert.deepEqual(calls.filter(call => call[0] === 'showAudioConfigDialog'), []);
    manager.audioConfigSettingsButton.click();

    assert.equal(documentRef.elements.get('errorDisplay').textContent, 'Translated configuring');
    assert.deepEqual(calls.filter(call => call[0] === 'showAudioConfigDialog'), [['showAudioConfigDialog']]);
    assert.deepEqual(calls.filter(call => call[0] === 'reload'), []);
  });
});

test('settings menu dispatches config, audio, feature links, and explicit audio reset', async () => {
  await withStateGlobals({
    electronIntegration: {
      isElectronEnvironment: () => false,
      showAudioConfigDialog() {},
      showConfigDialog() {}
    },
    uiManager: {
      t(key) {
        return key;
      }
    }
  }, async ({ calls, documentRef, windowRef }) => {
    windowRef.electronIntegration.showAudioConfigDialog = () => calls.push(['showAudioConfigDialog']);
    windowRef.electronIntegration.showConfigDialog = () => calls.push(['showConfigDialog']);
    windowRef.location.href = '';
    const audioManager = {
      reset: async value => calls.push(['audio.reset', value])
    };
    const manager = new StateManager(audioManager);

    manager.settingsMenuButton.click();
    assert.equal(documentRef.elements.get('settingsMenu').classList.contains('show'), true);

    manager.configSettingsButton.click();
    manager.audioConfigSettingsButton.click();
    manager.benchmarkSettingsButton.click();
    assert.equal(windowRef.location.href, 'features/effetune_bench.html');
    manager.measurementSettingsButton.click();
    assert.equal(windowRef.location.href, 'features/measurement/measurement.html');
    await manager.resetAudioSettingsButton.click();

    assert.deepEqual(calls.filter(call => call[0] === 'showConfigDialog'), [['showConfigDialog']]);
    assert.deepEqual(calls.filter(call => call[0] === 'showAudioConfigDialog'), [['showAudioConfigDialog']]);
    assert.deepEqual(calls.filter(call => call[0] === 'audio.reset'), [['audio.reset', null]]);
  });
});

test('settings labels update from localization keys with fallbacks', async () => {
  await withStateGlobals({
    uiManager: {
      t(key) {
        return ({
          'ui.configAudioButton': 'Translated Config Audio',
          'menu.settings': 'Translated Settings',
          'dialog.config.title': 'Translated Config',
          'dialog.audioConfig.title': 'Translated Audio',
          'menu.settings.performanceBenchmark': 'Translated Benchmark',
          'menu.settings.frequencyResponseMeasurement': 'Translated Measurement',
          'ui.resetButton': 'Translated Reset'
        })[key] ?? key;
      }
    }
  }, async ({ documentRef }) => {
    const manager = new StateManager({});
    assert.equal(manager.resetButton.hidden, true);
    assert.equal(manager.settingsMenuButton.title, 'Translated Settings');
    assert.equal(manager.settingsMenuButton.getAttribute('aria-label'), 'Translated Settings');
    assert.equal(manager.configSettingsButton.textContent, 'Translated Config');
    assert.equal(manager.audioConfigSettingsButton.textContent, 'Translated Audio');
    assert.equal(manager.benchmarkSettingsButton.textContent, 'Translated Benchmark');
    assert.equal(manager.measurementSettingsButton.textContent, 'Translated Measurement');
    assert.equal(manager.resetAudioSettingsButton.textContent, 'Translated Reset');

    window.uiManager.t = key => key;
    manager.updateLabels();
    assert.equal(documentRef.elements.get('settingsMenuButton').title, 'Settings');
    assert.equal(documentRef.elements.get('resetAudioSettingsButton').textContent, 'Reset Audio');
  });

  await withStateGlobals({
    electronAPI: {},
    uiManager: {
      t(key) {
        return key === 'ui.configAudioButton' ? 'Translated Config Audio' : key;
      }
    }
  }, async ({ documentRef }) => {
    const manager = new StateManager({});
    assert.equal(manager.settingsMenuButton.title, 'Translated Config Audio');
    assert.equal(manager.settingsMenuButton.getAttribute('aria-label'), 'Translated Config Audio');
    assert.equal(documentRef.elements.get('settingsMenu').hidden, true);
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
