import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioContextManager } from '../../js/audio/audio-context-manager.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

function createConsole(calls) {
  return {
    ...console,
    log(...args) {
      calls.push(['consoleLog', ...args]);
    },
    warn(...args) {
      calls.push(['consoleWarn', ...args]);
    },
    error(...args) {
      calls.push(['consoleError', ...args]);
    }
  };
}

function createAudioNodeClass(calls) {
  return class FakeAudioNode {
    constructor(label = 'node') {
      this.label = label;
      this.gain = undefined;
      this.disconnectError = null;
    }

    connect(...args) {
      calls.push(['audioNodeConnect', this.label, args]);
      return { connected: true, args };
    }

    disconnect() {
      calls.push(['audioNodeDisconnect', this.label]);
      if (this.disconnectError) throw this.disconnectError;
    }
  };
}

function createAudioContextClass(calls, AudioNodeClass, options = {}) {
  return class FakeAudioContext {
    constructor(audioContextOptions = {}) {
      calls.push(['newAudioContext', { ...audioContextOptions }]);
      if (options.throwWhenOptions?.(audioContextOptions)) {
        throw new Error('AudioContext option rejected');
      }
      this.options = audioContextOptions;
      this.destination = {
        maxChannelCount: options.maxChannelCount,
        channelCount: options.channelCount ?? 2,
        channelInterpretation: '',
        channelCountMode: ''
      };
      this.audioWorklet = options.audioWorklet;
      this.state = options.state ?? 'running';
      this.onstatechange = null;
    }

    createGain() {
      calls.push(['createGain']);
      const gain = new AudioNodeClass('gain');
      gain.gain = { value: 1 };
      if (options.gainDisconnectError) gain.disconnectError = options.gainDisconnectError;
      return gain;
    }

    close() {
      calls.push(['audioContextClose']);
      if (options.closeError) return Promise.reject(options.closeError);
      return Promise.resolve();
    }

    resume() {
      calls.push(['audioContextResume']);
      if (options.resumeError) return Promise.reject(options.resumeError);
      if (options.resumeToRunning !== false) this.state = 'running';
      return Promise.resolve();
    }
  };
}

function createAudioWorkletNodeClass(calls) {
  return class FakeAudioWorkletNode {
    constructor(audioContext, name, options) {
      calls.push(['newAudioWorkletNode', audioContext, name, options]);
      this.port = {
        postMessage(message) {
          calls.push(['workletPostMessage', message]);
        }
      };
    }
  };
}

function createDocumentTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter(candidate => candidate !== listener));
    },
    dispatchEvent(type, event = {}) {
      for (const listener of [...(listeners.get(type) || [])]) {
        listener({ type, ...event });
      }
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    }
  };
}

async function withAudioGlobals(options, callback) {
  const calls = [];
  const AudioNodeClass = options.AudioNodeClass ?? createAudioNodeClass(calls);
  const globals = {
    window: {
      location: { pathname: '/app/index.html' },
      ...options.window
    },
    console: createConsole(calls),
    AudioNode: AudioNodeClass,
    setTimeout(fn, delay) {
      calls.push(['setTimeout', delay]);
      if (options.runTimers) fn();
      return calls.length;
    },
    clearTimeout(id) {
      calls.push(['clearTimeout', id]);
    }
  };
  if ('document' in options) {
    globals.document = options.document;
  }

  for (const name of [
    'AudioContext',
    'webkitAudioContext',
    'mozAudioContext',
    'msAudioContext',
    'OfflineAudioContext',
    'webkitOfflineAudioContext',
    'mozOfflineAudioContext',
    'AudioWorkletNode',
    'fetch',
    'Blob',
    'URL'
  ]) {
    if (name in options) {
      globals[name] = options[name];
    }
  }

  return withGlobals(globals, async () => callback({ calls, AudioNodeClass }));
}

test('constructor initializes the original connect slot and exposes the skip flag', async () => {
  await withAudioGlobals({ window: {} }, async () => {
    const manager = new AudioContextManager();
    assert.equal(globalThis.window.originalConnectMethod, null);
    assert.equal(manager.getSkipAudioInitDuringSampleRateChange(), false);
    manager.setSkipAudioInitDuringSampleRateChange(true);
    assert.equal(manager.getSkipAudioInitDuringSampleRateChange(), true);
  });

  const existingConnect = () => 'existing';
  await withAudioGlobals({ window: { originalConnectMethod: existingConnect } }, async () => {
    new AudioContextManager();
    assert.equal(globalThis.window.originalConnectMethod, existingConnect);
  });
});

test('initAudioContext applies Electron preferences, first-launch silence, and macOS relaunch handling', async () => {
  await withAudioGlobals({
    window: {
      electronAPI: {
        platform: 'darwin',
        isFirstLaunch: () => Promise.resolve(true)
      },
      electronIntegration: {
        async loadAudioPreferences() {
          globalThis.window.preferenceCalls += 1;
          return { sampleRate: 48000, latencyHint: 'balanced', outputDeviceId: 'hdmi', outputChannels: 8 };
        }
      },
      preferenceCalls: 0,
      app: {
        async _doMacosRelaunch() {
          throw new Error('relaunch failed');
        }
      }
    }
  }, async ({ calls, AudioNodeClass }) => {
    globalThis.window.AudioContext = createAudioContextClass(calls, AudioNodeClass, {
      maxChannelCount: 6,
      resumeError: new Error('suspended resume failed')
    });

    const manager = new AudioContextManager();
    assert.equal(await manager.initAudioContext(), '');

    assert.equal(manager.isFirstLaunch, true);
    assert.deepEqual(calls.find(call => call[0] === 'newAudioContext')?.[1], {
      sampleRate: 48000,
      latencyHint: 'balanced',
      sinkId: 'hdmi'
    });
    assert.equal(manager.audioContext.destination.channelCount, 6);
    assert.equal(manager.audioContext.destination.channelInterpretation, 'discrete');
    assert.equal(manager.audioContext.destination.channelCountMode, 'explicit');
    assert.deepEqual(manager._pendingAudioConfig, { outputChannels: 6 });
    assert.equal(globalThis.window.audioPreferences.outputChannels, 6);
    assert.equal(manager.silenceGain.gain.value, 0);

    const node = new AudioNodeClass('ordinary');
    node.connect('speaker');
    node.connect('speaker', 1);
    node.connect('speaker', 1, 2);
    const connectCalls = calls.filter(call => call[0] === 'audioNodeConnect' && call[1] === 'ordinary');
    assert.equal(connectCalls.length, 3);
    assert.equal(connectCalls.every(call => call[2][0] === manager.silenceGain), true);

    manager.audioContext.state = 'suspended';
    manager.audioContext.onstatechange();
    await Promise.resolve();
    assert.ok(calls.some(call => call[0] === 'consoleWarn' && String(call[1]).includes('resume after suspended failed')));

    manager.audioContext.state = 'closed';
    manager.audioContext.onstatechange();
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('_doMacosRelaunch')));
  });
});

test('initAudioContext applies Web audioPreferences without Electron APIs', async () => {
  await withAudioGlobals({
    window: {
      audioPreferences: {
        sampleRate: 44100,
        latencyHint: 'playback',
        outputChannels: 4,
        lowLatencyOutput: true
      }
    }
  }, async ({ calls, AudioNodeClass }) => {
    globalThis.window.AudioContext = createAudioContextClass(calls, AudioNodeClass, {
      maxChannelCount: 8
    });
    const manager = new AudioContextManager();
    assert.equal(await manager.initAudioContext(), '');
    assert.deepEqual(calls.find(call => call[0] === 'newAudioContext')?.[1], {
      sampleRate: 44100,
      latencyHint: 'playback'
    });
    assert.equal(manager.audioContext.destination.channelCount, 4);
    assert.equal(globalThis.window.audioPreferences.outputChannels, 4);
  });
});

test('initAudioContext falls back for Web option rejection but not Electron', async () => {
  await withAudioGlobals({
    window: {
      audioPreferences: {
        sampleRate: 96000,
        latencyHint: 'balanced',
        outputDeviceId: 'speaker',
        outputDeviceLabel: 'Speaker'
      }
    }
  }, async ({ calls, AudioNodeClass }) => {
    globalThis.window.AudioContext = createAudioContextClass(calls, AudioNodeClass, {
      throwWhenOptions: options => Object.prototype.hasOwnProperty.call(options, 'sinkId')
    });
    const manager = new AudioContextManager();
    assert.equal(await manager.initAudioContext(), '');
    assert.deepEqual(calls.filter(call => call[0] === 'newAudioContext').map(call => call[1]), [
      { sampleRate: 96000, latencyHint: 'balanced', sinkId: 'speaker' },
      { latencyHint: 'balanced', sinkId: 'speaker' },
      { sampleRate: 96000, sinkId: 'speaker' },
      { sampleRate: 96000, latencyHint: 'balanced' }
    ]);
    assert.equal(globalThis.window.audioPreferences.outputDeviceId, 'default');
    assert.equal(globalThis.window.audioPreferences.outputDeviceLabel, '');
  });

  await withAudioGlobals({
    window: {
      audioPreferences: {
        sampleRate: 96000,
        latencyHint: 'balanced',
        outputDeviceId: 'speaker',
        outputDeviceLabel: 'Speaker'
      }
    }
  }, async ({ calls, AudioNodeClass }) => {
    globalThis.window.AudioContext = createAudioContextClass(calls, AudioNodeClass, {
      throwWhenOptions: options => Object.prototype.hasOwnProperty.call(options, 'sampleRate')
    });
    const manager = new AudioContextManager();
    assert.equal(await manager.initAudioContext(), '');
    assert.deepEqual(calls.filter(call => call[0] === 'newAudioContext').map(call => call[1]), [
      { sampleRate: 96000, latencyHint: 'balanced', sinkId: 'speaker' },
      { latencyHint: 'balanced', sinkId: 'speaker' }
    ]);
    assert.equal(globalThis.window.audioPreferences.outputDeviceId, 'speaker');
    assert.equal(globalThis.window.audioPreferences.outputDeviceLabel, 'Speaker');
  });

  await withAudioGlobals({
    window: {
      electronAPI: {},
      electronIntegration: {
        isElectron: true,
        async loadAudioPreferences() {
          return {
            sampleRate: 96000,
            latencyHint: 'balanced',
            outputDeviceId: 'speaker'
          };
        }
      }
    }
  }, async ({ calls, AudioNodeClass }) => {
    globalThis.window.AudioContext = createAudioContextClass(calls, AudioNodeClass, {
      throwWhenOptions: options => Object.prototype.hasOwnProperty.call(options, 'sinkId')
    });
    const manager = new AudioContextManager();
    assert.equal(await manager.initAudioContext(), 'Audio Error: AudioContext option rejected');
    assert.equal(calls.filter(call => call[0] === 'newAudioContext').length, 1);
  });
});

test('initAudioContext handles launch detection and AudioContext compatibility fallbacks', async () => {
  for (const contextName of ['AudioContext', 'webkitAudioContext', 'mozAudioContext', 'msAudioContext']) {
    await withAudioGlobals({ window: {} }, async ({ calls, AudioNodeClass }) => {
      globalThis.window[contextName] = createAudioContextClass(calls, AudioNodeClass);
      const manager = new AudioContextManager();
      assert.equal(await manager.initAudioContext(), '');
      assert.equal(calls.some(call => call[0] === 'newAudioContext'), true);
    });
  }

  await withAudioGlobals({
    window: {
      electronAPI: { isFirstLaunch: () => false },
      electronIntegration: { loadAudioPreferences: async () => null }
    }
  }, async ({ calls, AudioNodeClass }) => {
    globalThis.window.AudioContext = createAudioContextClass(calls, AudioNodeClass);
    const manager = new AudioContextManager();
    assert.equal(await manager.initAudioContext(), '');
    assert.equal(manager.isFirstLaunch, false);
    assert.deepEqual(calls.find(call => call[0] === 'newAudioContext')?.[1], {
      latencyHint: 'interactive'
    });
    assert.equal(manager.audioContext.destination.channelCount, 2);
  });

  await withAudioGlobals({
    window: {
      electronAPI: {
        isFirstLaunch() {
          throw new Error('first launch failed');
        }
      },
      electronIntegration: { loadAudioPreferences: async () => ({}) }
    }
  }, async ({ calls, AudioNodeClass }) => {
    globalThis.window.AudioContext = createAudioContextClass(calls, AudioNodeClass);
    const manager = new AudioContextManager();
    assert.equal(await manager.initAudioContext(), '');
    assert.equal(manager.isFirstLaunch, false);
  });

  await withAudioGlobals({
    window: {
      electronAPI: {},
      electronIntegration: {
        async loadAudioPreferences() {
          const preferences = [
            {},
            { outputChannels: 4 }
          ];
          return preferences[globalThis.window.preferenceCalls++ || 0];
        }
      },
      preferenceCalls: 0
    }
  }, async ({ calls, AudioNodeClass }) => {
    globalThis.window.AudioContext = createAudioContextClass(calls, AudioNodeClass);
    const manager = new AudioContextManager();
    assert.equal(await manager.initAudioContext(), '');
    assert.equal(manager.audioContext.destination.channelCount, 2);
    assert.deepEqual(manager._pendingAudioConfig, { outputChannels: 2 });
  });

  await withAudioGlobals({
    window: {
      isFirstLaunchConfirmed: true
    }
  }, async ({ calls, AudioNodeClass }) => {
    globalThis.window.AudioContext = createAudioContextClass(calls, AudioNodeClass);
    const manager = new AudioContextManager();
    assert.equal(await manager.initAudioContext(), '');
    assert.equal(manager.isFirstLaunch, true);
  });

  await withAudioGlobals({ window: {} }, async () => {
    const manager = new AudioContextManager();
    assert.equal(
      await manager.initAudioContext(),
      'Audio Error: Web Audio API is not supported in this browser'
    );
  });

  await withAudioGlobals({ window: { isFirstLaunchConfirmed: true } }, async () => {
    const manager = new AudioContextManager();
    manager.audioContext = { existing: true };
    assert.equal(await manager.initAudioContext(), '');
    assert.equal(manager.audioContext.existing, true);
  });
});

test('audio context state changes reset non-darwin managers or no-op without a reset target', async () => {
  await withAudioGlobals({
    window: {
      audioManager: {
        async reset(value) {
          globalThis.window.resetValue = value;
          throw new Error('reset failed');
        }
      }
    }
  }, async ({ calls, AudioNodeClass }) => {
    globalThis.window.AudioContext = createAudioContextClass(calls, AudioNodeClass);
    const manager = new AudioContextManager();
    await manager.initAudioContext();
    manager.audioContext.state = 'closed';
    manager.audioContext.onstatechange();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(globalThis.window.resetValue, null);
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('reset after closed-state')));
  });

  await withAudioGlobals({ window: {} }, async ({ calls, AudioNodeClass }) => {
    globalThis.window.AudioContext = createAudioContextClass(calls, AudioNodeClass);
    const manager = new AudioContextManager();
    await manager.initAudioContext();
    manager.audioContext.state = 'closed';
    manager.audioContext.onstatechange();
    assert.ok(calls.some(call => call[0] === 'consoleWarn' && String(call[1]).includes('closed unexpectedly')));
  });
});

test('loadAudioWorklet creates a configured worklet and applies pending audio config', async () => {
  await withAudioGlobals({
    AudioWorkletNode: null,
    window: {
      location: { pathname: '/nested/player/index.html' },
      electronAPI: {},
      electronIntegration: {
        async loadAudioPreferences() {
          return { lowLatencyOutput: true };
        }
      }
    }
  }, async ({ calls }) => {
    globalThis.AudioWorkletNode = createAudioWorkletNodeClass(calls);
    const manager = new AudioContextManager();
    manager.audioContext = {
      destination: { channelCount: 4 },
      audioWorklet: {
        async addModule(path) {
          calls.push(['addModule', path]);
        }
      }
    };
    manager._pendingAudioConfig = { outputChannels: 4 };

    assert.equal(await manager.loadAudioWorklet(), '');
    assert.equal(manager.lowLatencyMode, true);
    assert.equal(globalThis.window.workletNode, manager.workletNode);
    assert.equal(manager._pendingAudioConfig, null);
    assert.equal(calls.some(call => call[0] === 'addModule' && call[1] === '/nested/player/plugins/audio-processor.js'), true);
    assert.deepEqual(calls.filter(call => call[0] === 'workletPostMessage').map(call => call[1]), [
      { type: 'updateAudioConfig', outputChannels: 4 },
      { type: 'setLowLatencyMode', enabled: true }
    ]);
  });

  const blobFallbackCalls = [];
  await withAudioGlobals({
    AudioWorkletNode: null,
    window: {
      location: { pathname: '/offline/index.html' },
      audioPreferences: { lowLatencyOutput: false }
    },
    fetch: async url => {
      return {
        ok: true,
        status: 200,
        text: async () => {
          return `registerProcessor('plugin-processor', class {}); // ${url}`;
        }
      };
    },
    Blob: class FakeBlob {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
      }
    },
    URL: {
      createObjectURL(blob) {
        blobFallbackCalls.push(['createObjectURL', blob.options.type]);
        return 'blob://processor';
      },
      revokeObjectURL(url) {
        blobFallbackCalls.push(['revokeObjectURL', url]);
      }
    }
  }, async ({ calls }) => {
    globalThis.AudioWorkletNode = createAudioWorkletNodeClass(calls);
    const manager = new AudioContextManager();
    manager.audioContext = {
      destination: { channelCount: 2 },
      audioWorklet: {
        async addModule(path) {
          calls.push(['addModule', path]);
          if (!String(path).startsWith('blob:')) {
            throw new Error('offline module load failed');
          }
        }
      }
    };

    assert.equal(await manager.loadAudioWorklet(), '');
    assert.deepEqual(calls.filter(call => call[0] === 'addModule').map(call => call[1]), [
      '/offline/plugins/audio-processor.js',
      'blob://processor'
    ]);
    assert.deepEqual(blobFallbackCalls, [
      ['createObjectURL', 'text/javascript'],
      ['revokeObjectURL', 'blob://processor']
    ]);
  });
});

test('loadAudioWorklet ignores already-registered modules and reports unsupported or failed loads', async () => {
  await withAudioGlobals({
    AudioWorkletNode: null,
    window: {
      audioPreferences: { lowLatencyOutput: false }
    }
  }, async ({ calls }) => {
    globalThis.AudioWorkletNode = createAudioWorkletNodeClass(calls);
    const manager = new AudioContextManager();
    manager.audioContext = {
      destination: { channelCount: 2 },
      audioWorklet: {
        async addModule() {
          throw new Error('processor already registered');
        }
      }
    };

    assert.equal(await manager.loadAudioWorklet(), '');
    assert.equal(manager.lowLatencyMode, false);
    assert.deepEqual(calls.find(call => call[0] === 'workletPostMessage')?.[1], {
      type: 'setLowLatencyMode',
      enabled: false
    });
  });

  await withAudioGlobals({ window: {} }, async () => {
    const manager = new AudioContextManager();
    assert.equal(await manager.loadAudioWorklet(), 'Audio Error: Audio context not initialized');
  });

  await withAudioGlobals({ window: {} }, async () => {
    const manager = new AudioContextManager();
    manager.audioContext = { destination: { channelCount: 2 } };
    assert.equal(
      await manager.loadAudioWorklet(),
      'Audio Error: AudioWorklet is not supported in this browser. Please use a modern browser.'
    );
  });

  await withAudioGlobals({ window: {} }, async ({ calls }) => {
    const manager = new AudioContextManager();
    manager.audioContext = {
      destination: { channelCount: 2 },
      audioWorklet: {
        async addModule() {
          throw {};
        }
      }
    };
    assert.equal(await manager.loadAudioWorklet(), 'Audio Error: AudioWorklet failed to load: undefined');
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Failed to load audio worklet')));
  });

  await withAudioGlobals({ window: {}, runTimers: true }, async ({ calls }) => {
    const manager = new AudioContextManager();
    manager.audioContext = {
      destination: { channelCount: 2 },
      audioWorklet: {
        addModule() {
          calls.push(['addModuleNeverSettles']);
          return new Promise(() => {});
        }
      }
    };
    assert.equal(
      await manager.loadAudioWorklet(),
      'Audio Error: AudioWorklet failed to load: audioWorklet.addModule timed out after 5000ms'
    );
  });
});

test('createOfflineContext supports modern, legacy, fallback, and error constructors', async () => {
  await withAudioGlobals({}, async () => {
    const manager = new AudioContextManager();
    class ModernOfflineAudioContext {
      constructor(options) {
        this.options = options;
      }
    }
    globalThis.window.OfflineAudioContext = ModernOfflineAudioContext;
    const context = manager.createOfflineContext(2, 128, 48000);
    assert.deepEqual(context.options, { numberOfChannels: 2, length: 128, sampleRate: 48000 });
  });

  for (const fallbackName of ['webkitOfflineAudioContext', 'mozOfflineAudioContext']) {
    await withAudioGlobals({}, async () => {
      const manager = new AudioContextManager();
      class FallbackOfflineAudioContext {
        constructor(options) {
          this.options = options;
        }
      }
      globalThis.window[fallbackName] = FallbackOfflineAudioContext;
      assert.deepEqual(manager.createOfflineContext(1, 64, 44100).options, {
        numberOfChannels: 1,
        length: 64,
        sampleRate: 44100
      });
    });
  }

  await withAudioGlobals({}, async () => {
    const manager = new AudioContextManager();
    class LegacyOfflineAudioContext {
      constructor(first, length, sampleRate) {
        if (typeof first === 'object') throw new Error('modern constructor failed');
        this.args = [first, length, sampleRate];
      }
    }
    globalThis.window.OfflineAudioContext = LegacyOfflineAudioContext;
    assert.deepEqual(manager.createOfflineContext(6, 256, 96000).args, [6, 256, 96000]);
  });

  await withAudioGlobals({}, async () => {
    const manager = new AudioContextManager();
    assert.throws(
      () => manager.createOfflineContext(2, 128, 48000),
      /OfflineAudioContext is not supported/
    );
  });

  await withAudioGlobals({}, async () => {
    const manager = new AudioContextManager();
    class ThrowingOfflineAudioContext {
      constructor() {
        throw new Error('all constructors failed');
      }
    }
    globalThis.window.OfflineAudioContext = ThrowingOfflineAudioContext;
    assert.throws(
      () => manager.createOfflineContext(2, 128, 48000),
      /Failed to create OfflineAudioContext: all constructors failed/
    );
  });
});

test('closeAudioContext restores globals, clears matching worklets, and logs cleanup warnings', async () => {
  await withAudioGlobals({}, async ({ calls, AudioNodeClass }) => {
    const originalConnect = AudioNodeClass.prototype.connect;
    const manager = new AudioContextManager();
    globalThis.window.originalConnectMethod = originalConnect;
    AudioNodeClass.prototype.connect = function replacedConnect() {};
    manager.silenceGain = new AudioNodeClass('silence');
    manager.audioContext = {
      onstatechange: () => {},
      close() {
        calls.push(['closeSuccess']);
        return Promise.resolve();
      }
    };
    manager.workletNode = { id: 'worklet' };
    globalThis.window.workletNode = manager.workletNode;
    globalThis.window.audioContext = manager.audioContext;

    await manager.closeAudioContext();

    assert.equal(AudioNodeClass.prototype.connect, originalConnect);
    assert.equal(globalThis.window.originalConnectMethod, null);
    assert.equal(manager.silenceGain, null);
    assert.equal(manager.audioContext, null);
    assert.equal(globalThis.window.audioContext, null);
    assert.equal(globalThis.window.workletNode, null);
  });

  await withAudioGlobals({}, async ({ calls, AudioNodeClass }) => {
    const manager = new AudioContextManager();
    manager.silenceGain = new AudioNodeClass('silence');
    manager.silenceGain.disconnectError = new Error('disconnect failed');
    manager.audioContext = {
      onstatechange: () => {},
      close() {
        return Promise.reject(new Error('close failed'));
      }
    };
    globalThis.window.workletNode = { id: 'global' };
    manager.workletNode = { id: 'different' };

    await manager.closeAudioContext();

    assert.ok(calls.some(call => call[0] === 'consoleWarn' && String(call[1]).includes('disconnecting silence gain')));
    assert.ok(calls.some(call => call[0] === 'consoleWarn' && String(call[1]).includes('close() failed')));
    assert.deepEqual(globalThis.window.workletNode, { id: 'global' });
  });

  await withAudioGlobals({ runTimers: true }, async ({ calls }) => {
    const manager = new AudioContextManager();
    manager.audioContext = {
      onstatechange: () => {},
      close() {
        calls.push(['closeNeverSettles']);
        return new Promise(() => {});
      }
    };
    await manager.closeAudioContext();
    assert.ok(calls.some(call => call[0] === 'consoleWarn' && String(call[1]).includes('timed out')));
  });

  await withAudioGlobals({}, async ({ AudioNodeClass }) => {
    const manager = new AudioContextManager();
    globalThis.window.workletNode = { id: 'global' };
    manager.workletNode = null;
    await manager.closeAudioContext();
    assert.equal(globalThis.window.workletNode, null);

    globalThis.window.originalConnectMethod = () => {};
    Object.defineProperty(AudioNodeClass.prototype, 'connect', {
      value() {},
      writable: false,
      configurable: true
    });
    await manager.closeAudioContext();
  });
});

test('resumeAudioContext resumes suspended contexts and warns when they stay suspended', async () => {
  await withAudioGlobals({}, async ({ calls }) => {
    const manager = new AudioContextManager();
    manager.audioContext = null;
    await manager.resumeAudioContext();

    manager.audioContext = {
      state: 'running',
      resume() {
        calls.push(['unexpectedResume']);
        return Promise.resolve();
      }
    };
    await manager.resumeAudioContext();
    assert.equal(calls.some(call => call[0] === 'unexpectedResume'), false);
  });

  await withAudioGlobals({}, async ({ calls }) => {
    const manager = new AudioContextManager();
    manager.audioContext = {
      state: 'suspended',
      resume() {
        calls.push(['resume']);
        this.state = 'running';
        return Promise.resolve();
      }
    };
    await manager.resumeAudioContext();
    assert.equal(calls.some(call => call[0] === 'consoleWarn'), false);
  });

  await withAudioGlobals({}, async ({ calls }) => {
    const manager = new AudioContextManager();
    manager.audioContext = {
      state: 'suspended',
      resume() {
        calls.push(['resume']);
        return Promise.reject(new Error('resume failed'));
      }
    };
    await manager.resumeAudioContext();
    assert.ok(calls.some(call => call[0] === 'consoleWarn' && String(call[1]).includes('not running')));
  });

  await withAudioGlobals({ runTimers: true }, async ({ calls }) => {
    const manager = new AudioContextManager();
    manager.audioContext = {
      state: 'suspended',
      resume() {
        calls.push(['resumeNeverSettles']);
        return new Promise(() => {});
      }
    };
    await manager.resumeAudioContext();
    assert.ok(calls.some(call => call[0] === 'consoleWarn' && String(call[1]).includes('not running')));
  });
});

test('initAudioContext resumes suspended web contexts from the first user gesture', async () => {
  const documentRef = createDocumentTarget();
  await withAudioGlobals({ document: documentRef }, async ({ calls, AudioNodeClass }) => {
    globalThis.window.AudioContext = createAudioContextClass(calls, AudioNodeClass, {
      state: 'suspended'
    });
    const manager = new AudioContextManager();
    assert.equal(await manager.initAudioContext(), '');
    // Touch grants user activation at pointerup/touchend, not pointerdown.
    assert.equal(documentRef.listenerCount('pointerdown'), 0);
    assert.equal(documentRef.listenerCount('pointerup'), 1);
    assert.equal(documentRef.listenerCount('touchend'), 1);
    assert.equal(documentRef.listenerCount('keydown'), 1);

    documentRef.dispatchEvent('pointerup');
    // The resume chain spans several microtask ticks.
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    assert.ok(calls.some(call => call[0] === 'audioContextResume'));
    assert.equal(documentRef.listenerCount('pointerup'), 0);
    assert.equal(documentRef.listenerCount('touchend'), 0);
    assert.equal(documentRef.listenerCount('keydown'), 0);
  });

  // A gesture whose resume is still blocked must keep the hook armed so a
  // later (activation-granting) gesture can retry.
  const blockedDocument = createDocumentTarget();
  await withAudioGlobals({ document: blockedDocument }, async ({ calls, AudioNodeClass }) => {
    globalThis.window.AudioContext = createAudioContextClass(calls, AudioNodeClass, {
      state: 'suspended',
      resumeToRunning: false
    });
    const manager = new AudioContextManager();
    assert.equal(await manager.initAudioContext(), '');
    blockedDocument.dispatchEvent('touchend');
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();
    assert.ok(calls.some(call => call[0] === 'audioContextResume'));
    assert.equal(blockedDocument.listenerCount('pointerup'), 1);
    assert.equal(blockedDocument.listenerCount('touchend'), 1);
    assert.equal(blockedDocument.listenerCount('keydown'), 1);
  });

  const electronDocument = createDocumentTarget();
  await withAudioGlobals({
    document: electronDocument,
    window: { electronAPI: {} }
  }, async ({ calls, AudioNodeClass }) => {
    globalThis.window.AudioContext = createAudioContextClass(calls, AudioNodeClass, {
      state: 'suspended'
    });
    const manager = new AudioContextManager();
    assert.equal(await manager.initAudioContext(), '');
    assert.equal(electronDocument.listenerCount('pointerup'), 0);
    assert.equal(electronDocument.listenerCount('touchend'), 0);
    assert.equal(electronDocument.listenerCount('keydown'), 0);
  });

  const cleanupDocument = createDocumentTarget();
  await withAudioGlobals({ document: cleanupDocument }, async ({ calls, AudioNodeClass }) => {
    globalThis.window.AudioContext = createAudioContextClass(calls, AudioNodeClass, {
      state: 'suspended'
    });
    const manager = new AudioContextManager();
    assert.equal(await manager.initAudioContext(), '');
    assert.equal(cleanupDocument.listenerCount('pointerup'), 1);
    await manager.closeAudioContext();
    assert.equal(cleanupDocument.listenerCount('pointerup'), 0);
    assert.equal(cleanupDocument.listenerCount('touchend'), 0);
    assert.equal(cleanupDocument.listenerCount('keydown'), 0);
  });
});
