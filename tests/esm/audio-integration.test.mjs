import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAudioDevices,
  loadAudioPreferences,
  saveAudioPreferences,
  showAudioConfigDialog
} from '../../js/electron/audioIntegration.js';
import { NO_AUDIO_INPUT_DEVICE_ID } from '../../js/audio/audio-device-constants.js';
import { createFakeDocument } from '../helpers/fake-dom.mjs';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

async function withMutedConsole(method, callback) {
  const original = console[method];
  console[method] = () => {};
  try {
    return await callback();
  } finally {
    console[method] = original;
  }
}

function createWindowEventTarget(base = {}) {
  const listeners = new Map();
  return {
    ...base,
    addEventListener(type, listener) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      if (!listeners.has(type)) return;
      listeners.set(type, listeners.get(type).filter(candidate => candidate !== listener));
    },
    dispatchEvent(type, event = {}) {
      const results = [];
      for (const listener of listeners.get(type) || []) {
        results.push(listener(event));
      }
      return Promise.all(results);
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    }
  };
}

function createAudioHarness(options = {}) {
  const calls = [];
  const electronAPI = {
    async loadAudioPreferences() {
      calls.push(['loadAudioPreferences']);
      if (options.loadError) throw options.loadError;
      return options.loadResult ?? { success: true, preferences: options.preferences ?? { sampleRate: 48000 } };
    },
    async saveAudioPreferences(preferences) {
      calls.push(['saveAudioPreferences', { ...preferences }]);
      if (options.saveError) throw options.saveError;
      return options.saveResult ?? { success: true };
    },
    async getAudioDevices() {
      calls.push(['getAudioDevices']);
      if (options.deviceError) throw options.deviceError;
      return options.deviceResult ?? {
        success: true,
        devices: [
          { deviceId: 'mic1', kind: 'audioinput', label: 'Mic One' },
          { deviceId: 'out1', kind: 'audiooutput', label: 'Out One' }
        ]
      };
    }
  };
  const uiCalls = [];
  const uiManager = options.uiManager === null ? null : {
    t: key => `label:${key}`,
    setError: (...args) => uiCalls.push(['setError', ...args]),
    clearError: () => uiCalls.push(['clearError']),
    ...options.uiManager
  };

  const window = createWindowEventTarget({
    electronAPI,
    uiManager,
    ...options.window
  });

  return { calls, uiCalls, window };
}

function createLocalStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    snapshot() {
      return Object.fromEntries(values);
    }
  };
}

test('audio preferences load and save honor Electron and Web storage availability', async () => {
  assert.equal(await loadAudioPreferences(false), null);
  assert.equal(await saveAudioPreferences(false, { sampleRate: 44100 }), false);

  const localStorage = createLocalStorage({
    effetune_audio_preferences: JSON.stringify({ sampleRate: 88200, outputChannels: 4 })
  });
  await withGlobals({ window: { localStorage } }, async () => {
    assert.deepEqual(await loadAudioPreferences(false), { sampleRate: 88200, outputChannels: 4 });
    assert.equal(await saveAudioPreferences(false, { latencyHint: 'balanced' }), true);
  });
  assert.deepEqual(JSON.parse(localStorage.snapshot().effetune_audio_preferences), {
    latencyHint: 'balanced'
  });

  const loaded = createAudioHarness({ preferences: { outputChannels: 4 } });
  await withGlobals({ window: loaded.window }, async () => {
    assert.deepEqual(await loadAudioPreferences(true), { outputChannels: 4 });
  });

  const emptyLoadResults = [
    { success: false, preferences: { ignored: true } },
    { success: true }
  ];
  for (const loadResult of emptyLoadResults) {
    const harness = createAudioHarness({ loadResult });
    await withGlobals({ window: harness.window }, async () => {
      assert.equal(await loadAudioPreferences(true), null);
    });
  }

  const loadFailure = createAudioHarness({ loadError: new Error('load failed') });
  await withGlobals({ window: loadFailure.window }, async () => {
    await withMutedConsole('error', async () => {
      assert.equal(await loadAudioPreferences(true), null);
    });
  });

  const saved = createAudioHarness();
  await withGlobals({ window: saved.window }, async () => {
    assert.equal(await saveAudioPreferences(true, { latencyHint: 'balanced' }), true);
  });

  const failedSave = createAudioHarness({ saveResult: { success: false } });
  await withGlobals({ window: failedSave.window }, async () => {
    assert.equal(await saveAudioPreferences(true, { latencyHint: 'playback' }), false);
  });

  const saveFailure = createAudioHarness({ saveError: new Error('save failed') });
  await withGlobals({ window: saveFailure.window }, async () => {
    await withMutedConsole('error', async () => {
      assert.equal(await saveAudioPreferences(true, { sampleRate: 96000 }), false);
    });
  });
});

test('getAudioDevices uses Electron devices when available', async () => {
  const devices = [
    { deviceId: 'mic', kind: 'audioinput', label: 'Mic' }
  ];
  const harness = createAudioHarness({ deviceResult: { success: true, devices } });

  await withGlobals({ window: harness.window }, async () => {
    assert.deepEqual(await getAudioDevices(true), devices);
  });
});

test('getAudioDevices falls back through browser and default devices', async () => {
  const navigatorWithDevices = {
    mediaDevices: {
      async enumerateDevices() {
        return [
          { deviceId: 'mic12345', kind: 'audioinput', label: '' },
          { deviceId: 'speaker98765', kind: 'audiooutput', label: '' },
          { deviceId: 'camera', kind: 'videoinput', label: '' },
          { deviceId: 'named', kind: 'audiooutput', label: 'Named Speaker' }
        ];
      }
    }
  };
  const browserFallback = createAudioHarness({ deviceResult: { success: true, devices: [] } });
  await withGlobals({ window: browserFallback.window, navigator: navigatorWithDevices }, async () => {
    await withMutedConsole('log', async () => {
      assert.deepEqual(await getAudioDevices(false), [
        { deviceId: 'mic12345', kind: 'audioinput', label: 'Microphone (no permission)' },
        { deviceId: 'speaker98765', kind: 'audiooutput', label: 'Speaker speak' },
        { deviceId: 'camera', kind: 'videoinput', label: 'Unknown device' },
        { deviceId: 'named', kind: 'audiooutput', label: 'Named Speaker' }
      ]);
      assert.deepEqual(await getAudioDevices(true), [
        { deviceId: 'mic12345', kind: 'audioinput', label: 'Microphone (no permission)' },
        { deviceId: 'speaker98765', kind: 'audiooutput', label: 'Speaker speak' },
        { deviceId: 'camera', kind: 'videoinput', label: 'Unknown device' },
        { deviceId: 'named', kind: 'audiooutput', label: 'Named Speaker' }
      ]);
    });
  });

  const electronFailure = createAudioHarness({ deviceError: new Error('main unavailable') });
  await withGlobals({ window: electronFailure.window, navigator: navigatorWithDevices }, async () => {
    await withMutedConsole('warn', async () => {
      await withMutedConsole('log', async () => {
        assert.equal((await getAudioDevices(true)).length, 4);
      });
    });
  });

  const browserFailure = createAudioHarness({ deviceResult: { success: false } });
  await withGlobals({
    window: browserFailure.window,
    navigator: {
      mediaDevices: {
        async enumerateDevices() {
          throw new Error('browser unavailable');
        }
      }
    }
  }, async () => {
    await withMutedConsole('warn', async () => {
      await withMutedConsole('log', async () => {
        assert.deepEqual(await getAudioDevices(true), [
          { deviceId: 'default', kind: 'audioinput', label: 'Default Microphone' },
          { deviceId: 'default', kind: 'audiooutput', label: 'Default Speaker' }
        ]);
      });
    });
  });

  const noBrowserApi = createAudioHarness({ deviceResult: { success: true } });
  await withGlobals({ window: noBrowserApi.window, navigator: {} }, async () => {
    assert.deepEqual(await getAudioDevices(true), [
      { deviceId: 'default', kind: 'audioinput', label: 'Default Microphone' },
      { deviceId: 'default', kind: 'audiooutput', label: 'Default Speaker' }
    ]);
  });

  const outerFailure = createAudioHarness({ deviceResult: { success: false } });
  const throwingNavigator = {};
  Object.defineProperty(throwingNavigator, 'mediaDevices', {
    get() {
      throw new Error('navigator failed');
    }
  });
  await withGlobals({ window: outerFailure.window, navigator: throwingNavigator }, async () => {
    await withMutedConsole('error', async () => {
      assert.deepEqual(await getAudioDevices(true), [
        { deviceId: 'default', kind: 'audioinput', label: 'Default Microphone' },
        { deviceId: 'default', kind: 'audiooutput', label: 'Default Speaker' }
      ]);
    });
  });
});

test('showAudioConfigDialog opens outside Electron and reports missing UI manager', async () => {
  const document = createFakeDocument();
  const nonElectron = createAudioHarness();
  await withGlobals({ window: nonElectron.window, document }, async () => {
    await withMutedConsole('log', async () => {
      await showAudioConfigDialog(false, {});
    });
  });
  assert.equal(document.body.children.length, 1);
  assert.equal(document.getElementById('output-device').disabled, true);

  const noUi = createAudioHarness({
    uiManager: null,
    deviceResult: { success: true, devices: [] }
  });
  await withGlobals({ window: noUi.window, document: createFakeDocument(), navigator: {} }, async () => {
    await withMutedConsole('log', async () => {
      await withMutedConsole('error', async () => {
        await showAudioConfigDialog(true, {});
      });
    });
  });
  assert.equal(noUi.window.listenerCount('beforeunload'), 1);
});

test('showAudioConfigDialog disables unsupported Web output selection and resets through audioManager', async () => {
  const resetCalls = [];
  const harness = createAudioHarness({
    deviceResult: { success: true, devices: [] },
    window: {
      isSecureContext: false,
      audioManager: {
        reset: async preferences => resetCalls.push(preferences)
      }
    }
  });
  const document = createFakeDocument();

  await withGlobals({
    window: harness.window,
    document,
    navigator: {}
  }, async () => {
    await withMutedConsole('log', async () => {
      await showAudioConfigDialog(false, { outputDeviceId: 'speaker', sampleRate: 44100 });
    });
    assert.equal(document.getElementById('output-device').disabled, true);
    assert.equal(
      document.getElementById('output-device-support-message').textContent,
      'label:dialog.audioConfig.outputDevice.secureContextRequired'
    );
    await document.getElementById('apply-button').dispatchEvent('click');
    await flushMicrotasks();
  });

  assert.equal(harness.calls.some(call => call[0] === 'saveAudioPreferences'), false);
  assert.equal(resetCalls.length, 1);
  assert.equal(resetCalls[0].outputDeviceId, 'default');
  assert.equal(document.body.children.length, 0);
});

test('showAudioConfigDialog closes the Web dialog before pending audio reset completes', async () => {
  let resolveReset;
  const resetPromise = new Promise(resolve => {
    resolveReset = resolve;
  });
  const resetCalls = [];
  const harness = createAudioHarness({
    window: {
      audioManager: {
        reset: async preferences => {
          resetCalls.push(preferences);
          return resetPromise;
        }
      }
    }
  });
  const document = createFakeDocument();

  await withGlobals({
    window: harness.window,
    document,
    navigator: {}
  }, async () => {
    await withMutedConsole('log', async () => {
      await showAudioConfigDialog(false, {});
    });
    const applyPromise = document.getElementById('apply-button').dispatchEvent('click');
    await flushMicrotasks();

    assert.equal(resetCalls.length, 1);
    assert.equal(document.body.children.length, 0);
    assert.equal(document.head.children.length, 0);
    assert.equal(harness.window.listenerCount('beforeunload'), 0);

    resolveReset('');
    await applyPromise;
  });
});

test('showAudioConfigDialog localizes Web output support and default option labels', async () => {
  const translations = {
    'dialog.audioConfig.outputDevice.permissionsPolicyBlocked': 'Permissions-Policy により出力デバイスの選択がブロックされています。',
    'dialog.audioConfig.outputChannels.stereoDefault': '2 - ステレオ (デフォルト)',
    'dialog.audioConfig.sampleRate.default': '{rate} kHz (デフォルト)'
  };
  const harness = createAudioHarness({
    window: {
      isSecureContext: true
    },
    uiManager: {
      t: (key, params = {}) => {
        let text = translations[key] || `label:${key}`;
        Object.entries(params).forEach(([name, value]) => {
          text = text.replace(new RegExp(`{${name}}`, 'g'), value);
        });
        return text;
      }
    }
  });
  const document = createFakeDocument();
  document.permissionsPolicy = {
    allowsFeature: feature => feature !== 'speaker-selection'
  };

  await withGlobals({
    window: harness.window,
    document,
    navigator: {}
  }, async () => {
    await withMutedConsole('log', async () => {
      await showAudioConfigDialog(false, {});
    });
  });

  assert.equal(
    document.getElementById('output-device-support-message').textContent,
    'Permissions-Policy により出力デバイスの選択がブロックされています。'
  );
  assert.equal(document.getElementById('output-channels').children[0].textContent, '2 - ステレオ (デフォルト)');
  assert.equal(document.getElementById('sample-rate').children[3].textContent, '96 kHz (デフォルト)');
});

test('showAudioConfigDialog keeps Web output preferences aligned with available sink paths', async () => {
  const selectOnlyHarness = createAudioHarness({
    window: {
      isSecureContext: true
    }
  });
  const selectOnlyDocument = createFakeDocument();
  await withGlobals({
    window: selectOnlyHarness.window,
    document: selectOnlyDocument,
    navigator: {
      mediaDevices: {
        enumerateDevices: async () => [
          { deviceId: 'mic1', kind: 'audioinput', label: 'Mic One' },
          { deviceId: 'out1', kind: 'audiooutput', label: 'Out One' }
        ],
        selectAudioOutput: async () => ({ deviceId: 'out1', kind: 'audiooutput', label: 'Out One' })
      }
    }
  }, async () => {
    await withMutedConsole('log', async () => {
      await showAudioConfigDialog(false, { outputDeviceId: 'out1' });
    });
    assert.equal(selectOnlyDocument.getElementById('output-device').disabled, true);
  });

  const resetCalls = [];
  let directUnsupportedSelectCalls = 0;
  const elementSinkHarness = createAudioHarness({
    window: {
      isSecureContext: true,
      HTMLMediaElement: function HTMLMediaElement() {},
      audioManager: {
        reset: async preferences => resetCalls.push(preferences)
      }
    }
  });
  elementSinkHarness.window.HTMLMediaElement.prototype.setSinkId = async () => {};
  const elementSinkDocument = createFakeDocument();
  await withGlobals({
    window: elementSinkHarness.window,
    document: elementSinkDocument,
    navigator: {
      mediaDevices: {
        enumerateDevices: async () => [
          { deviceId: 'mic1', kind: 'audioinput', label: 'Mic One' },
          { deviceId: 'out1', kind: 'audiooutput', label: 'Out One' }
        ],
        selectAudioOutput: async () => {
          directUnsupportedSelectCalls += 1;
          return { deviceId: 'out1', kind: 'audiooutput', label: 'Out One' };
        }
      }
    }
  }, async () => {
    await withMutedConsole('log', async () => {
      await showAudioConfigDialog(false, {
        outputDeviceId: 'out1',
        outputChannels: 4,
        lowLatencyOutput: true
      });
    });
    assert.equal(elementSinkDocument.getElementById('output-device').disabled, false);
    await withMutedConsole('warn', async () => {
      await elementSinkDocument.getElementById('apply-button').dispatchEvent('click');
      await flushMicrotasks();
    });
  });

  assert.equal(resetCalls.length, 1);
  assert.equal(resetCalls[0].outputDeviceId, 'default');
  assert.equal(resetCalls[0].outputChannels, 4);
  assert.equal(resetCalls[0].lowLatencyOutput, true);
  assert.equal(directUnsupportedSelectCalls, 0);
});

test('showAudioConfigDialog can be cancelled and closed with Escape', async () => {
  const cancelHarness = createAudioHarness();
  const cancelDocument = createFakeDocument();
  await withGlobals({ window: cancelHarness.window, document: cancelDocument }, async () => {
    await withMutedConsole('log', async () => {
      await showAudioConfigDialog(true, { sampleRate: 44100, latencyHint: 'interactive' });
    });
    assert.equal(cancelDocument.body.children.length, 1);
    assert.equal(cancelDocument.head.children.length, 1);
    await cancelDocument.getElementById('cancel-button').dispatchEvent('click');
    assert.equal(cancelDocument.body.children.length, 0);
    assert.equal(cancelDocument.head.children.length, 0);
    assert.equal(cancelDocument.listenerCount('keydown'), 0);
    assert.deepEqual(cancelHarness.uiCalls.at(-1), ['clearError']);
  });

  const escapeHarness = createAudioHarness();
  const escapeDocument = createFakeDocument();
  await withGlobals({ window: escapeHarness.window, document: escapeDocument }, async () => {
    await withMutedConsole('log', async () => {
      await showAudioConfigDialog(true, { sampleRate: 48000, outputChannels: 4, latencyHint: 'balanced' });
    });
    let prevented = false;
    await escapeDocument.dispatchEvent('keydown', {
      key: 'Escape',
      preventDefault() {
        prevented = true;
      }
    });
    assert.equal(prevented, true);
    assert.equal(escapeDocument.body.children.length, 0);
  });
});

test('showAudioConfigDialog applies preferences through audioManager and callback', async () => {
  const callbackCalls = [];
  const updateCalls = [];
  const harness = createAudioHarness({
    preferences: {},
    deviceResult: {
      success: true,
      devices: [
        { deviceId: 'mic1', kind: 'audioinput', label: 'Mic One' },
        { deviceId: 'out1', kind: 'audiooutput', label: 'Out One' }
      ]
    },
    window: {
      audioManager: {
        updateAudioConfig: preferences => updateCalls.push(preferences)
      }
    }
  });
  const document = createFakeDocument();

  await withGlobals({
    window: harness.window,
    document,
    navigator: {},
    setTimeout: callback => {
      callback();
      return 1;
    }
  }, async () => {
    await withMutedConsole('log', async () => {
      await showAudioConfigDialog(true, {
        inputDeviceId: 'mic1',
        outputDeviceId: 'out1',
        sampleRate: 192000,
        outputChannels: 8,
        latencyHint: 'playback',
        useInputWithPlayer: true,
        lowLatencyOutput: true,
        useWasmDsp: false
      }, preferences => callbackCalls.push(preferences));
    });

    assert.equal(document.getElementById('input-device').value, 'mic1');
    assert.equal(document.getElementById('output-device').value, 'out1');
    assert.equal(document.getElementById('sample-rate').value, '192000');
    assert.equal(document.getElementById('output-channels').value, '8');
    assert.equal(document.getElementById('latency').value, 'playback');
    assert.equal(document.getElementById('use-input-with-player').checked, true);
    assert.equal(document.getElementById('low-latency-output').checked, true);
    assert.equal(document.getElementById('use-wasm-dsp').checked, false);

    document.getElementById('sample-rate').value = '88200';
    document.getElementById('output-channels').value = '6';
    document.getElementById('latency').value = 'balanced';
    document.getElementById('use-input-with-player').checked = false;
    document.getElementById('low-latency-output').checked = false;
    document.getElementById('use-wasm-dsp').checked = true;
    await withMutedConsole('log', async () => {
      await document.getElementById('apply-button').dispatchEvent('click');
      await flushMicrotasks();
    });
  });

  const saved = harness.calls.find(call => call[0] === 'saveAudioPreferences')[1];
  assert.deepEqual(saved, {
    inputDeviceId: 'mic1',
    outputDeviceId: 'out1',
    inputDeviceLabel: 'Mic One',
    outputDeviceLabel: 'Out One',
    sampleRate: 88200,
    useInputWithPlayer: false,
    lowLatencyOutput: false,
    useWasmDsp: true,
    outputChannels: 6,
    latencyHint: 'balanced'
  });
  assert.deepEqual(updateCalls, [saved]);
  assert.deepEqual(callbackCalls, [saved]);
  assert.deepEqual(harness.window.audioPreferences, saved);
  assert.equal(document.body.children.length, 1);
  assert.equal(document.head.children.length, 0);
  assert.equal(harness.window.listenerCount('beforeunload'), 0);
});

test('showAudioConfigDialog includes and saves the no-input player option', async () => {
  const harness = createAudioHarness({
    preferences: {},
    deviceResult: {
      success: true,
      devices: [
        { deviceId: 'mic1', kind: 'audioinput', label: 'Mic One' },
        { deviceId: 'out1', kind: 'audiooutput', label: 'Out One' }
      ]
    }
  });
  const document = createFakeDocument();

  await withGlobals({
    window: harness.window,
    document,
    navigator: {},
    setTimeout: callback => {
      callback();
      return 1;
    }
  }, async () => {
    await withMutedConsole('log', async () => {
      await showAudioConfigDialog(true, { inputDeviceId: NO_AUDIO_INPUT_DEVICE_ID });
    });

    const inputSelect = document.getElementById('input-device');
    assert.equal(inputSelect.children[0].value, NO_AUDIO_INPUT_DEVICE_ID);
    assert.equal(inputSelect.children[0].textContent, 'label:dialog.audioConfig.inputDevice.none');
    assert.equal(inputSelect.value, NO_AUDIO_INPUT_DEVICE_ID);

    await withMutedConsole('log', async () => {
      await document.getElementById('apply-button').dispatchEvent('click');
      await flushMicrotasks();
    });
  });

  const saved = harness.calls.find(call => call[0] === 'saveAudioPreferences')[1];
  assert.equal(saved.inputDeviceId, NO_AUDIO_INPUT_DEVICE_ID);
  assert.equal(saved.inputDeviceLabel, 'label:dialog.audioConfig.inputDevice.none');
});

test('showAudioConfigDialog applies fallback labels and worklet updates without a callback', async () => {
  const messages = [];
  const harness = createAudioHarness({
    deviceResult: { success: true, devices: [] },
    window: {
      workletNode: {
        port: {
          postMessage: message => messages.push(message)
        }
      }
    }
  });
  const document = createFakeDocument();

  await withGlobals({
    window: harness.window,
    document,
    navigator: {},
    setTimeout: () => 1
  }, async () => {
    await withMutedConsole('log', async () => {
      await showAudioConfigDialog(true, {});
      document.getElementById('input-device').value = 'missing-input';
      document.getElementById('output-device').value = 'missing-output';
      await document.getElementById('apply-button').dispatchEvent('click');
      await flushMicrotasks();
    });
  });

  const saved = harness.calls.find(call => call[0] === 'saveAudioPreferences')[1];
  assert.equal(saved.inputDeviceLabel, '');
  assert.equal(saved.outputDeviceLabel, '');
  assert.deepEqual(messages, [{ type: 'updateAudioConfig', outputChannels: 2 }]);
});

test('showAudioConfigDialog selects every sample-rate and channel option correctly', async () => {
  const cases = [
    { sampleRate: 88200, outputChannels: 6 },
    { sampleRate: 176400, outputChannels: 2 },
    { sampleRate: 352800, outputChannels: 4 },
    { sampleRate: 384000, outputChannels: 8 }
  ];

  for (const preferences of cases) {
    const harness = createAudioHarness();
    const document = createFakeDocument();
    await withGlobals({ window: harness.window, document, navigator: {} }, async () => {
      await withMutedConsole('log', async () => {
        await showAudioConfigDialog(true, preferences);
      });
      assert.equal(document.getElementById('sample-rate').value, String(preferences.sampleRate));
      assert.equal(document.getElementById('output-channels').value, String(preferences.outputChannels));
      await document.getElementById('cancel-button').dispatchEvent('click');
    });
  }

  const uiLessCleanup = createAudioHarness();
  const document = createFakeDocument();
  await withGlobals({
    window: uiLessCleanup.window,
    document,
    navigator: {},
    setTimeout: () => 1
  }, async () => {
    await withMutedConsole('log', async () => {
      await showAudioConfigDialog(true, { sampleRate: 96000, outputChannels: 2 });
    });
    uiLessCleanup.window.uiManager = null;
    await document.getElementById('apply-button').dispatchEvent('click');
    await flushMicrotasks();
  });
  assert.equal(uiLessCleanup.window.listenerCount('beforeunload'), 0);
});

test('showAudioConfigDialog handles missing defaults and dialog creation failures', async () => {
  const noUpdateTarget = createAudioHarness({
    deviceResult: {
      success: true,
      devices: [
        { deviceId: 'mic-only', kind: 'audioinput', label: 'Mic Only' },
        { deviceId: 'out-only', kind: 'audiooutput', label: 'Out Only' }
      ]
    }
  });
  await withGlobals({
    window: noUpdateTarget.window,
    document: createFakeDocument(),
    navigator: {},
    setTimeout: () => 1
  }, async () => {
    await withMutedConsole('log', async () => {
      await showAudioConfigDialog(true, null);
      await document.getElementById('apply-button').dispatchEvent('click');
      await flushMicrotasks();
    });
  });
  assert.equal(noUpdateTarget.calls.some(call => call[0] === 'saveAudioPreferences'), true);

  const onlyOutputDevice = createAudioHarness({
    deviceResult: {
      success: true,
      devices: [
        { deviceId: 'out-only', kind: 'audiooutput', label: 'Out Only' }
      ]
    }
  });
  const onlyOutputDocument = createFakeDocument();
  await withGlobals({ window: onlyOutputDevice.window, document: onlyOutputDocument, navigator: {} }, async () => {
    await withMutedConsole('log', async () => {
      await showAudioConfigDialog(true, {});
    });
    assert.equal(onlyOutputDocument.getElementById('input-device').value, 'default');
    assert.equal(onlyOutputDocument.getElementById('output-device').value, 'out-only');
  });

  const onlyInputDevice = createAudioHarness({
    deviceResult: {
      success: true,
      devices: [
        { deviceId: 'mic-only', kind: 'audioinput', label: 'Mic Only' }
      ]
    }
  });
  const onlyInputDocument = createFakeDocument();
  await withGlobals({ window: onlyInputDevice.window, document: onlyInputDocument, navigator: {} }, async () => {
    await withMutedConsole('log', async () => {
      await showAudioConfigDialog(true, {});
    });
    assert.equal(onlyInputDocument.getElementById('input-device').value, 'mic-only');
    assert.equal(onlyInputDocument.getElementById('input-device').children[0].value, NO_AUDIO_INPUT_DEVICE_ID);
    assert.equal(onlyInputDocument.getElementById('output-device').value, 'default');
  });

  const failingDocument = createFakeDocument();
  failingDocument.body.appendChild = () => {
    throw new Error('append failed');
  };
  const failing = createAudioHarness();
  await withGlobals({ window: failing.window, document: failingDocument }, async () => {
    await withMutedConsole('log', async () => {
      await withMutedConsole('error', async () => {
        await showAudioConfigDialog(true, {});
      });
    });
  });
});
