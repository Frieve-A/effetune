import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioIOManager, MIC_DENIED_PREFIX } from '../../js/audio/audio-io-manager.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

class FakeNode {
  constructor(name, calls, options = {}) {
    this.name = name;
    this.calls = calls;
    this.options = options;
    this.connections = [];
    this.gain = { value: 1 };
    this.channelCount = options.channelCount ?? 2;
    this.channelCountMode = 'max';
    this.channelInterpretation = 'speakers';
  }

  connect(target) {
    this.calls.push(['connect', this.name, target?.name ?? target?.constructor?.name ?? 'target']);
    this._connectCount = (this._connectCount || 0) + 1;
    if (this.options.failConnectAfter && this._connectCount >= this.options.failConnectAfter) {
      throw new Error(`${this.name} connect failed`);
    }
    if (this.options.failConnect) {
      throw new Error(`${this.name} connect failed`);
    }
    this.connections.push(target);
    return { from: this, to: target };
  }

  disconnect(target) {
    this.calls.push(['disconnect', this.name, target?.name ?? 'all']);
    if (this.options.failDisconnect) {
      throw new Error(`${this.name} disconnect failed`);
    }
    this.connections = [];
  }

  start() {
    this.calls.push(['start', this.name]);
    if (this.options.failStart) {
      throw new Error(`${this.name} start failed`);
    }
  }

  stop() {
    this.calls.push(['stop', this.name]);
  }
}

function createAudioContext(calls, options = {}) {
  const destination = new FakeNode('destination', calls, { channelCount: options.channelCount ?? 2 });
  const audioContext = {
    sampleRate: options.sampleRate ?? 48000,
    destination,
    state: options.state ?? 'running',
    sinkId: options.sinkId ?? 'default',
    createGain() {
      if (options.failCreateGain) throw new Error('createGain failed');
      return new FakeNode('gain', calls, options.gainOptions);
    },
    createBuffer(channels, length, rate) {
      calls.push(['createBuffer', channels, length, rate]);
      if (options.failCreateBuffer) throw new Error('createBuffer failed');
      return { channels, length, rate };
    },
    createBufferSource() {
      return new FakeNode('bufferSource', calls, options.bufferSourceOptions);
    },
    createMediaStreamSource(stream) {
      calls.push(['createMediaStreamSource', stream?.id]);
      if (options.failCreateMediaStreamSource) throw new Error('media source failed');
      return new FakeNode('mediaStreamSource', calls);
    },
    resume: async () => {
      calls.push(['resume']);
      if (options.resumeReject) throw new Error('resume failed');
      if (options.resumeToRunning !== false) audioContext.state = 'running';
    }
  };
  if (options.mediaDestination !== false) {
    audioContext.createMediaStreamDestination = () => {
      calls.push(['createMediaStreamDestination']);
      if (options.failMediaDestination) throw new Error('destination failed');
      return {
        name: 'mediaDestination',
        stream: Object.prototype.hasOwnProperty.call(options, 'destinationStream') ? options.destinationStream : { id: 'stream' }
      };
    };
  }
  if (options.scriptProcessor !== false) {
    audioContext.createScriptProcessor = (...args) => {
      calls.push(['createScriptProcessor', ...args]);
      return new FakeNode('scriptProcessor', calls, options.scriptProcessorOptions);
    };
  }
  if (options.javaScriptNode) {
    delete audioContext.createScriptProcessor;
    audioContext.createJavaScriptNode = (...args) => {
      calls.push(['createJavaScriptNode', ...args]);
      return new FakeNode('javaScriptNode', calls, options.scriptProcessorOptions);
    };
  }
  if (options.contextSetSinkId) {
    audioContext.setSinkId = async sinkId => {
      calls.push(['ctx.setSinkId', sinkId]);
      if (options.contextSetSinkIdReject) throw new Error('ctx sink failed');
      audioContext.sinkId = sinkId;
    };
  }
  return audioContext;
}

function createAudioClass(calls, options = {}) {
  return class FakeAudio {
    constructor() {
      if (options.constructorThrows) throw new Error('Audio constructor failed');
      this.name = 'audioElement';
      this.autoplay = false;
      this.volume = 0;
      this.muted = true;
      this.paused = options.paused ?? true;
      this.readyState = options.readyState ?? 4;
      this.sinkId = options.initialSinkId ?? '';
      this.srcObject = null;
      this.listeners = new Map();
      if (!options.noSinkId) {
        this.setSinkId = async sinkId => {
          calls.push(['audio.setSinkId', sinkId]);
          const rejection = options.rejectSinkIds?.get?.(sinkId) ?? options.rejectSinkId;
          if (rejection) throw new Error(`sink ${sinkId} failed`);
          this.sinkId = sinkId;
        };
      }
    }

    async play() {
      calls.push(['audio.play']);
      if (options.playReject) throw new Error('play failed');
      this.paused = false;
    }

    pause() {
      calls.push(['audio.pause']);
      this.paused = true;
    }

    addEventListener(type, listener) {
      calls.push(['audio.addEventListener', type]);
      this.listeners.set(type, listener);
    }

    dispatch(type, event = {}) {
      this.listeners.get(type)?.({ target: this, ...event });
    }
  };
}

function createContextManager(calls, options = {}) {
  const audioContext = createAudioContext(calls, options.audioContext);
  return {
    audioContext,
    workletNode: Object.prototype.hasOwnProperty.call(options, 'workletNode')
      ? options.workletNode
      : new FakeNode('worklet', calls, options.workletOptions),
    isFirstLaunch: Boolean(options.isFirstLaunch)
  };
}

function createStream(id = 'mic') {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  return { id, tracks, getTracks: () => tracks };
}

function createWindow(calls, options = {}) {
  const preferences = options.preferences ?? null;
  return {
    electronAPI: options.electronAPI ?? null,
    electronIntegration: options.electronIntegration ?? (options.electron ? {
      isElectron: true,
      isElectronEnvironment: () => true,
      loadAudioPreferences: async () => {
        calls.push(['loadAudioPreferences']);
        if (options.loadPrefsReject) throw new Error('prefs failed');
        return preferences;
      }
    } : null),
    audioPreferences: options.audioPreferences,
    audioManager: Object.prototype.hasOwnProperty.call(options, 'audioManager')
      ? options.audioManager
      : {
          reset: async prefs => calls.push(['audioManager.reset', prefs]),
          rebuildPipeline: async force => calls.push(['audioManager.rebuildPipeline', force])
        },
    app: options.app ?? null,
    originalConnectMethod: options.originalConnectMethod
  };
}

function createNavigator(calls, options = {}) {
  return {
    mediaDevices: {
      getUserMedia: async constraints => {
        calls.push(['getUserMedia', JSON.parse(JSON.stringify(constraints))]);
        const next = options.getUserMediaQueue?.shift?.();
        if (next instanceof Error) throw next;
        if (next) return next;
        if (options.getUserMediaReject) throw options.getUserMediaReject;
        return createStream();
      },
      enumerateDevices: async () => {
        calls.push(['enumerateDevices']);
        if (options.enumerateReject) throw new Error('enumerate failed');
        return options.devices ?? [];
      }
    }
  };
}

async function withAudioIO(options, callback) {
  const calls = [];
  const intervals = new Map();
  let nextTimerId = 1;
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const contextManager = createContextManager(calls, options.context ?? {});
  const windowRef = createWindow(calls, options.window ?? {});
  const navigatorRef = createNavigator(calls, options.navigator ?? {});
  const AudioClass = createAudioClass(calls, options.audio ?? {});
  let consoleErrorCalls = 0;
  await withGlobals({
    window: windowRef,
    navigator: navigatorRef,
    Audio: AudioClass,
    setInterval: (callbackFn, ms) => {
      const id = nextTimerId++;
      intervals.set(id, { callbackFn, ms });
      calls.push(['setInterval', ms]);
      return id;
    },
    clearInterval: id => {
      calls.push(['clearInterval', id]);
      intervals.delete(id);
    },
    setTimeout: (callbackFn, ms, ...args) => {
      if (options.immediateTimeouts) {
        const id = nextTimerId++;
        Promise.resolve().then(() => callbackFn(...args));
        return id;
      }
      return realSetTimeout(callbackFn, ms, ...args);
    },
    clearTimeout: id => {
      if (!options.immediateTimeouts) realClearTimeout(id);
    },
    console: {
      log: (...args) => calls.push(['console.log', ...args]),
      warn: (...args) => calls.push(['console.warn', ...args]),
      error: (...args) => {
        calls.push(['console.error', ...args]);
        consoleErrorCalls += 1;
        const injectedError = options.consoleErrorFailure?.(consoleErrorCalls, args);
        if (injectedError) throw injectedError;
      }
    }
  }, async () => {
    const manager = new AudioIOManager(contextManager);
    await callback({ manager, contextManager, calls, intervals, windowRef, navigatorRef });
  });
}

function permissionError(name = 'NotAllowedError') {
  const error = new Error(name);
  error.name = name;
  return error;
}

test('constructor and audio input handle success, fallbacks, permission recovery, and fatal setup errors', async () => {
  await withAudioIO({}, async ({ manager, calls }) => {
    assert.equal(manager.stream, null);
    const result = await manager.initAudioInput();
    assert.equal(result, '');
    assert.ok(calls.some(call => call[0] === 'createMediaStreamSource'));
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {
        requestMicrophoneAccess: async () => {}
      },
      preferences: { inputDeviceId: 'saved' }
    },
    navigator: {
      getUserMediaQueue: [permissionError(), createStream('default')]
    }
  }, async ({ manager, calls }) => {
    assert.equal(await manager.initAudioInput(), '');
    assert.deepEqual(calls.filter(call => call[0] === 'getUserMedia').map(call => call[1].audio.deviceId), [
      { exact: 'saved' },
      undefined
    ]);
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {
        clearMicrophonePermission: async () => {}
      },
      preferences: { inputDeviceId: 'saved' }
    },
    navigator: {
      getUserMediaQueue: [permissionError(), permissionError(), createStream('recovered')]
    }
  }, async ({ manager }) => {
    assert.equal(await manager.initAudioInput(), '');
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {
        clearMicrophonePermission: async () => { throw new Error('clear failed'); }
      }
    },
    navigator: {
      getUserMediaReject: permissionError('PermissionDeniedError')
    }
  }, async ({ manager }) => {
    const result = await manager.initAudioInput();
    assert.ok(result.startsWith(MIC_DENIED_PREFIX));
  });

  await withAudioIO({
    navigator: {
      getUserMediaReject: new Error('offline')
    }
  }, async ({ manager }) => {
    const result = await manager.initAudioInput();
    assert.ok(result.startsWith(MIC_DENIED_PREFIX));
    assert.equal(manager.sourceNode.name, 'gain');
  });

  await withAudioIO({
    context: { audioContext: { failCreateBuffer: true } },
    navigator: {
      getUserMediaReject: new Error('offline')
    }
  }, async ({ manager }) => {
    assert.match(await manager.initAudioInput(), /^Audio Error: createBuffer failed/);
  });
});

test('audio input handles saved-device permission failures and non-permission fallbacks', async () => {
  await withAudioIO({
    window: {
      audioPreferences: { inputDeviceId: 'web-mic' }
    }
  }, async ({ manager, calls }) => {
    assert.equal(await manager.initAudioInput(), '');
    assert.deepEqual(calls.find(call => call[0] === 'getUserMedia')[1].audio.deviceId, { exact: 'web-mic' });
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {
        clearMicrophonePermission: async () => { throw new Error('clear failed'); }
      },
      preferences: { inputDeviceId: 'saved' }
    },
    navigator: {
      getUserMediaQueue: [permissionError(), permissionError()]
    }
  }, async ({ manager }) => {
    assert.ok((await manager.initAudioInput()).startsWith(MIC_DENIED_PREFIX));
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {},
      preferences: { inputDeviceId: 'saved' }
    },
    navigator: {
      getUserMediaQueue: [permissionError(), permissionError('PermissionDeniedError')]
    }
  }, async ({ manager }) => {
    assert.ok((await manager.initAudioInput()).startsWith(MIC_DENIED_PREFIX));
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {},
      preferences: { inputDeviceId: 'saved' }
    },
    navigator: {
      getUserMediaQueue: [permissionError(), new Error('device gone')]
    }
  }, async ({ manager }) => {
    assert.ok((await manager.initAudioInput()).startsWith(MIC_DENIED_PREFIX));
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {
        clearMicrophonePermission: async () => {}
      }
    },
    navigator: {
      getUserMediaQueue: [permissionError(), createStream('after-clear')]
    }
  }, async ({ manager }) => {
    assert.equal(await manager.initAudioInput(), '');
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {}
    },
    navigator: {
      getUserMediaReject: permissionError()
    }
  }, async ({ manager }) => {
    assert.ok((await manager.initAudioInput()).startsWith(MIC_DENIED_PREFIX));
  });
});

test('audio output initialization handles direct context sink and media destination paths', async () => {
  await withAudioIO({
    context: { audioContext: { contextSetSinkId: true } },
    window: {
      electron: true,
      electronAPI: { platform: 'darwin' },
      app: { _doMacosRelaunch: async () => {} },
      preferences: { outputDeviceId: 'hdmi', outputChannels: 6 }
    }
  }, async ({ manager, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.directOutputMode, true);
    assert.equal(manager.audioContextSinkMode, false);
    assert.equal(calls.some(call => call[0] === 'ctx.setSinkId'), false);
  });

  await withAudioIO({
    context: { audioContext: { contextSetSinkId: true } },
    window: {
      electron: true,
      electronAPI: { platform: 'linux' },
      preferences: { outputDeviceId: 'ctx-device', outputChannels: 2 }
    }
  }, async ({ manager, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.audioContextSinkMode, true);
    assert.equal(manager.currentOutputDeviceId, 'ctx-device');
    assert.ok(calls.some(call => call[0] === 'ctx.setSinkId' && call[1] === 'ctx-device'));
    assert.ok(calls.some(call => call[0] === 'setInterval'));
  });

  await withAudioIO({
    context: { audioContext: { contextSetSinkId: true } },
    window: {
      electron: true,
      electronAPI: { platform: 'linux' },
      preferences: { outputDeviceId: 'default', outputChannels: 2 }
    }
  }, async ({ manager, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.audioContextSinkMode, true);
    assert.equal(manager.currentOutputDeviceId, 'default');
    assert.ok(calls.some(call => call[0] === 'ctx.setSinkId' && call[1] === 'default'));
    assert.ok(calls.some(call => call[0] === 'setInterval'));
  });

  await withAudioIO({
    context: { audioContext: { contextSetSinkId: true, contextSetSinkIdReject: true } },
    window: {
      electron: true,
      electronAPI: {},
      preferences: { outputDeviceId: 'ctx-device', outputChannels: 2 }
    },
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'ctx-device', label: 'Ctx Device' }]
    }
  }, async ({ manager, calls, intervals, windowRef }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.ok(calls.some(call => call[0] === 'console.warn' && String(call[1]).includes('[audioCtxSink]')));
    assert.equal(manager.audioContextSinkMode, true);
    assert.ok(calls.some(call => call[0] === 'setInterval'));
    assert.equal(windowRef.audioPreferences.outputDeviceId, 'default');
    assert.equal(windowRef.electronIntegration.audioPreferences.outputDeviceId, 'ctx-device');
    await intervals.values().next().value.callbackFn();
    assert.ok(calls.some(call => call[0] === 'audioManager.reset'));
  });

  await withAudioIO({
    context: { audioContext: { failMediaDestination: true } },
    window: { electron: true, preferences: null }
  }, async ({ manager }) => {
    assert.match(await manager.initAudioOutput(), /Failed to create audio destination/);
  });

  await withAudioIO({
    context: { audioContext: { mediaDestination: false } },
    window: { electron: true, preferences: null }
  }, async ({ manager, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.destinationNode, null);
    assert.ok(calls.some(call => call[0] === 'console.warn'));
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {},
      preferences: { outputDeviceId: 'low', outputChannels: 2, lowLatencyOutput: true }
    }
  }, async ({ manager, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.directOutputMode, true);
    assert.ok(calls.some(call => call[0] === 'console.log' && String(call[1]).includes('low latency')));
  });

  await withAudioIO({
    window: {
      audioPreferences: { outputDeviceId: 'web-speaker', outputChannels: 2 }
    },
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'web-speaker', label: 'Web Speaker' }]
    }
  }, async ({ manager, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.audioElement.srcObject.id, 'stream');
    assert.equal(manager.currentOutputDeviceId, 'web-speaker');
    assert.equal(calls.some(call => call[0] === 'setInterval'), false);
  });

  await withAudioIO({
    context: { audioContext: { contextSetSinkId: true } },
    window: {
      audioPreferences: { outputDeviceId: 'web-direct', outputChannels: 2, lowLatencyOutput: true }
    }
  }, async ({ manager, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.directOutputMode, true);
    assert.equal(manager.audioContextSinkMode, true);
    assert.ok(calls.some(call => call[0] === 'ctx.setSinkId' && call[1] === 'web-direct'));
  });

  await withAudioIO({
    window: {
      audioPreferences: { outputDeviceId: 'default', outputChannels: 2 },
      electronIntegration: {
        audioPreferences: { outputDeviceId: 'default', outputChannels: 8 },
        async loadAudioPreferences() {
          throw new Error('saved preferences should not replace effective preferences');
        }
      }
    }
  }, async ({ manager }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.directOutputMode, false);
    assert.equal(manager.audioElement, null);
    assert.equal(globalThis.window.audioPreferences.outputChannels, 2);
  });

  await withAudioIO({
    context: { audioContext: { contextSetSinkId: true, contextSetSinkIdReject: true } },
    window: {
      audioPreferences: {
        outputDeviceId: 'web-speaker',
        outputDeviceLabel: 'Web Speaker',
        outputChannels: 2
      }
    }
  }, async ({ manager, windowRef }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.currentOutputDeviceId, 'default');
    assert.equal(windowRef.audioPreferences.outputDeviceId, 'default');
    assert.equal(windowRef.audioPreferences.outputDeviceLabel, '');
  });

  await withAudioIO({
    context: { audioContext: { failCreateGain: true } }
  }, async ({ manager }) => {
    assert.match(await manager.initAudioOutput(), /^Audio Error: createGain failed/);
  });
});

test('audio output initialization handles saved and default audio-element paths', async () => {
  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {},
      preferences: { outputDeviceId: 'speaker', outputChannels: 2 }
    },
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    }
  }, async ({ manager, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.audioElement.srcObject.id, 'stream');
    assert.equal(manager.currentOutputDeviceId, 'speaker');
    assert.ok(calls.some(call => call[0] === 'audio.play'));
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {},
      preferences: { outputDeviceId: 'missing', outputChannels: 2 }
    },
    audio: {
      rejectSinkIds: new Map([['missing', true]])
    },
    navigator: {
      enumerateReject: true
    }
  }, async ({ manager }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.currentOutputDeviceId, 'default');
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {},
      preferences: { outputDeviceId: 'speaker', outputChannels: 2 }
    },
    audio: {
      noSinkId: true
    }
  }, async ({ manager, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.ok(calls.some(call => call[0] === 'console.warn' && String(call[1]).includes('not supported')));
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {},
      preferences: null
    },
    audio: {
      playReject: true
    },
    context: {
      audioContext: { channelCount: 4 }
    }
  }, async ({ manager, contextManager }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.currentOutputDeviceId, 'default');
    assert.equal(contextManager.audioContext.destination.channelCountMode, 'explicit');
    manager.audioElement.dispatch('error');
    assert.equal(manager.destinationNode, null);
    assert.notEqual(manager.defaultDestinationConnection, null);
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {},
      preferences: null
    },
    audio: {
      constructorThrows: true
    }
  }, async ({ manager }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.notEqual(manager.defaultDestinationConnection, null);
    assert.equal(manager.destinationNode, null);
  });
});

test('audio output initialization handles audio-element fallback failures and event listeners', async () => {
  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {},
      preferences: { outputDeviceId: 'missing', outputChannels: 2 }
    },
    navigator: {
      devices: []
    }
  }, async ({ manager }) => {
    manager.audioElement = new (createAudioClass([], {}))();
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.currentOutputDeviceId, 'missing');
  });

  await withAudioIO({
    context: { audioContext: { destinationStream: null } },
    window: {
      electron: true,
      electronAPI: {},
      preferences: { outputDeviceId: 'speaker', outputChannels: 2 }
    },
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker' }]
    }
  }, async ({ manager, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.ok(calls.some(call => call[0] === 'console.warn' && String(call[1]).includes('No destination')));
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {},
      preferences: { outputDeviceId: 'speaker', outputChannels: 2 }
    },
    audio: { playReject: true },
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker' }]
    }
  }, async ({ manager, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.ok(calls.some(call => call[0] === 'console.warn' && String(call[1]).includes('Failed to play audio')));
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {},
      preferences: { outputDeviceId: 'speaker', outputChannels: 2 }
    },
    audio: { rejectSinkId: true }
  }, async ({ manager, calls, windowRef }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.ok(calls.some(call => call[0] === 'console.warn' && String(call[1]).includes('Failed to set audio output device')));
    assert.equal(manager.destinationNode, null);
    assert.notEqual(manager.defaultDestinationConnection, null);
    assert.equal(windowRef.audioPreferences.outputDeviceId, 'default');
    assert.equal(windowRef.electronIntegration.audioPreferences.outputDeviceId, 'speaker');
  });

  await withAudioIO({
    window: {
      audioPreferences: {
        outputDeviceId: 'speaker',
        outputDeviceLabel: 'Speaker',
        outputChannels: 2
      }
    },
    audio: { rejectSinkId: true },
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    }
  }, async ({ manager, windowRef }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.currentOutputDeviceId, 'default');
    assert.equal(windowRef.audioPreferences.outputDeviceId, 'default');
    assert.equal(windowRef.audioPreferences.outputDeviceLabel, '');
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {},
      preferences: { outputDeviceId: 'speaker', outputChannels: 2 }
    },
    audio: { constructorThrows: true }
  }, async ({ manager, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.ok(calls.some(call => call[0] === 'console.warn' && String(call[1]).includes('with preferences')));
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {},
      preferences: null
    },
    audio: {
      rejectSinkIds: new Map([['default', true]])
    }
  }, async ({ manager, calls }) => {
    manager.audioElement = new (createAudioClass([], {}))();
    assert.equal(await manager.initAudioOutput(), '');
    assert.ok(calls.some(call => call[0] === 'console.warn' && String(call[1]).includes('default device')));
  });

  await withAudioIO({
    context: { audioContext: { destinationStream: null } },
    window: {
      electron: true,
      electronAPI: {},
      preferences: null
    }
  }, async ({ manager }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.notEqual(manager.defaultDestinationConnection, null);
    assert.equal(manager.destinationNode, null);
  });

  await withAudioIO({
    context: {
      workletNode: null
    },
    audio: {
      playReject: true
    }
  }, async ({ manager, windowRef }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.defaultDestinationConnection, null);
    assert.equal(manager.destinationNode, null);
    assert.equal(windowRef.audioPreferences.outputDeviceId, 'default');
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: {},
      preferences: null
    }
  }, async ({ manager }) => {
    assert.equal(await manager.initAudioOutput(), '');
    manager.defaultDestinationConnection = null;
    manager.audioElement.dispatch('error');
    assert.equal(manager.destinationNode, null);
    assert.notEqual(manager.defaultDestinationConnection, null);
  });
});

test('first-launch silence node handles processor variants and connection fallback', async () => {
  await withAudioIO({
    context: {
      isFirstLaunch: true
    },
    window: {
      electron: true,
      preferences: null,
      electronIntegration: {
        isElectron: true,
        isElectronEnvironment: () => false,
        loadAudioPreferences: async () => null
      }
    }
  }, async ({ manager }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.silenceNode.name, 'scriptProcessor');
    const left = new Float32Array([1, 1]);
    const right = new Float32Array([1, 1]);
    manager.silenceNode.onaudioprocess({
      outputBuffer: {
        getChannelData: index => index === 0 ? left : right
      }
    });
    assert.deepEqual([...left, ...right], [0, 0, 0, 0]);
  });

  await withAudioIO({
    context: {
      isFirstLaunch: true,
      audioContext: { javaScriptNode: true },
      workletOptions: { failDisconnect: true }
    },
    window: {
      electron: true,
      preferences: null,
      electronIntegration: {
        isElectron: true,
        isElectronEnvironment: () => false,
        loadAudioPreferences: async () => null
      }
    }
  }, async ({ manager, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.silenceNode.name, 'javaScriptNode');
    assert.ok(calls.some(call => call[0] === 'console.warn' && String(call[1]).includes('Error connecting silence')));
  });

  await withAudioIO({
    context: {
      isFirstLaunch: true,
      audioContext: { scriptProcessor: false }
    },
    window: {
      electron: true,
      preferences: null,
      electronIntegration: {
        isElectron: true,
        isElectronEnvironment: () => false,
        loadAudioPreferences: async () => null
      }
    }
  }, async ({ manager }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.silenceNode, null);
  });
});

test('connectAudioNodes handles sink modes, web fallback, and error returns', async () => {
  await withAudioIO({
    window: {
      audioPreferences: { outputDeviceId: 'default', outputChannels: 2 }
    }
  }, async ({ manager, contextManager, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    assert.equal(manager.audioElement, null);
    manager.sourceNode = new FakeNode('source', calls);
    assert.equal(await manager.connectAudioNodes(), '');
    assert.ok(calls.some(call => call[0] === 'connect' && call[1] === 'gain' && call[2] === 'destination'));
  });

  await withAudioIO({}, async ({ manager, contextManager }) => {
    manager.sourceNode = new FakeNode('source', []);
    manager.outputGainNode = contextManager.audioContext.createGain();
    contextManager.audioContext.destination.channelCount = 4;
    assert.equal(await manager.connectAudioNodes(), '');
    assert.equal(contextManager.audioContext.destination.channelCountMode, 'explicit');
  });

  await withAudioIO({
    window: { electron: true, preferences: null }
  }, async ({ manager, contextManager }) => {
    manager.sourceNode = new FakeNode('source', []);
    manager.outputGainNode = contextManager.audioContext.createGain();
    manager.directOutputMode = true;
    assert.equal(await manager.connectAudioNodes(), '');
    assert.equal(contextManager.audioContext.destination.channelInterpretation, 'discrete');
  });

  await withAudioIO({
    window: { electron: true, preferences: null }
  }, async ({ manager, contextManager }) => {
    manager.sourceNode = new FakeNode('source', []);
    manager.outputGainNode = contextManager.audioContext.createGain();
    manager.destinationNode = new FakeNode('destinationNode', []);
    assert.equal(await manager.connectAudioNodes(), '');
  });

  await withAudioIO({}, async ({ manager }) => {
    assert.match(await manager.connectAudioNodes(), /missing audio nodes/);
  });

  await withAudioIO({}, async ({ manager, contextManager }) => {
    manager.sourceNode = new FakeNode('source', [], { failConnect: true });
    manager.outputGainNode = contextManager.audioContext.createGain();
    assert.match(await manager.connectAudioNodes(), /Failed to connect audio nodes/);
  });

  await withAudioIO({
    context: { workletOptions: { failConnect: true } }
  }, async ({ manager, contextManager }) => {
    manager.sourceNode = new FakeNode('source', []);
    manager.outputGainNode = contextManager.audioContext.createGain();
    assert.match(await manager.connectAudioNodes(), /Failed to connect output gain/);
  });

  await withAudioIO({}, async ({ manager, contextManager }) => {
    manager.sourceNode = new FakeNode('source', []);
    manager.outputGainNode = new FakeNode('gain', [], { failConnect: true });
    assert.match(await manager.connectAudioNodes(), /Failed to connect to default audio destination/);
  });
});

test('connectAudioNodes handles original connect, sink-specific failures, and web reroute failures', async () => {
  await withAudioIO({
    context: { isFirstLaunch: true },
    window: {
      originalConnectMethod: function originalConnect(target) {
        this.calls?.push?.(['unused', target]);
      }
    }
  }, async ({ manager, contextManager, calls, windowRef }) => {
    windowRef.originalConnectMethod = function originalConnect(target) {
      calls.push(['originalConnect', this.name, target.name]);
    };
    manager.sourceNode = new FakeNode('source', calls);
    manager.outputGainNode = contextManager.audioContext.createGain();
    assert.equal(await manager.connectAudioNodes(), '');
    assert.ok(calls.some(call => call[0] === 'originalConnect'));
  });

  await withAudioIO({
    window: { electron: true, electronAPI: {}, preferences: null }
  }, async ({ manager, contextManager }) => {
    manager.sourceNode = new FakeNode('source', []);
    manager.outputGainNode = new FakeNode('gain', [], { failConnect: true });
    manager.directOutputMode = true;
    assert.match(await manager.connectAudioNodes(), /Failed to connect direct output/);
  });

  await withAudioIO({
    window: { electron: true, electronAPI: {}, preferences: null }
  }, async ({ manager, contextManager }) => {
    manager.sourceNode = new FakeNode('source', []);
    manager.outputGainNode = new FakeNode('gain', [], { failConnect: true });
    manager.destinationNode = new FakeNode('destinationNode', []);
    assert.match(await manager.connectAudioNodes(), /Failed to connect to audio destination/);
  });

  await withAudioIO({
    window: {
      electronAPI: {}
    }
  }, async ({ manager, contextManager }) => {
    manager.sourceNode = new FakeNode('source', []);
    manager.outputGainNode = contextManager.audioContext.createGain();
    assert.equal(await manager.connectAudioNodes(), '');
  });

  await withAudioIO({
    context: { audioContext: { gainOptions: { failDisconnect: true } } }
  }, async ({ manager, contextManager }) => {
    manager.sourceNode = new FakeNode('source', []);
    manager.outputGainNode = contextManager.audioContext.createGain();
    assert.equal(await manager.connectAudioNodes(), '');
  });

  await withAudioIO({}, async ({ manager, contextManager }) => {
    manager.sourceNode = new FakeNode('source', []);
    manager.outputGainNode = new FakeNode('gain', [], { failConnectAfter: 2 });
    assert.equal(await manager.connectAudioNodes(), '');
  });

  await withAudioIO({}, async ({ manager, contextManager }) => {
    manager.sourceNode = new FakeNode('source', [], { failConnect: true });
    manager.outputGainNode = contextManager.audioContext.createGain();
    assert.match(await manager.connectAudioNodes(), /Failed to connect audio nodes/);
  });

  await withAudioIO({
    consoleErrorFailure: callNumber => callNumber === 1 ? new Error('logger failed') : null
  }, async ({ manager, contextManager }) => {
    manager.sourceNode = new FakeNode('source', [], { failConnect: true });
    manager.outputGainNode = contextManager.audioContext.createGain();
    assert.match(await manager.connectAudioNodes(), /^Audio Error: logger failed/);
  });
});

test('fallback source, output reapply, timeout wrappers, polling, and cleanup maintain lifecycle state', async () => {
  await withAudioIO({}, async ({ manager, calls }) => {
    const node = manager.createFallbackSilentSource();
    assert.equal(node.name, 'gain');
    assert.equal(calls.some(call => call[0] === 'console.warn' && String(call[1]).includes('Source node missing')), true);
  });

  await withAudioIO({
    context: { audioContext: { contextSetSinkId: true } }
  }, async ({ manager, contextManager }) => {
    manager.audioContextSinkMode = true;
    assert.equal(await manager.reapplyOutputDevice('ctx'), true);
    contextManager.audioContext.setSinkId = async () => { throw new Error('ctx failed'); };
    assert.equal(await manager.reapplyOutputDevice('ctx'), false);
  });

  await withAudioIO({}, async ({ manager }) => {
    assert.equal(await manager.reapplyOutputDevice('speaker'), false);
    manager.audioElement = new (createAudioClass([], {}))();
    manager.destinationNode = { stream: { id: 'stream' } };
    assert.equal(await manager.reapplyOutputDevice('speaker'), true);
    manager.audioElement.setSinkId = async () => { throw new Error('el failed'); };
    assert.equal(await manager.reapplyOutputDevice('speaker'), false);
  });

  await withAudioIO({}, async ({ manager }) => {
    assert.equal(await manager._setSinkIdWithTimeout({ setSinkId: async () => {} }, 'ok', 20), undefined);
    await assert.rejects(
      manager._setSinkIdWithTimeout({ setSinkId: () => new Promise(() => {}) }, 'hang', 1),
      /timed out/
    );
  });

  await withAudioIO({}, async ({ manager }) => {
    const stream = await manager._getUserMediaWithTimeout({ audio: true }, 20);
    assert.equal(stream.id, 'mic');
  });

  await withAudioIO({
    navigator: {
      getUserMediaQueue: [new Promise(() => {})]
    }
  }, async ({ manager }) => {
    await assert.rejects(manager._getUserMediaWithTimeout({ audio: true }, 1), /timed out/);
  });

  await withAudioIO({}, async ({ manager, intervals, windowRef }) => {
    manager.startDevicePoll(async () => ({ outputDeviceId: 'speaker' }), async prefs => {
      windowRef.lastResetPrefs = prefs;
    }, true);
    assert.equal(intervals.size, 1);
    manager.stopDevicePoll();
    assert.equal(intervals.size, 0);
  });

  await withAudioIO({}, async ({ manager }) => {
    const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
    manager.audioContextSinkMode = true;
    manager.audioElement = new (createAudioClass([], {}))();
    manager.outputGainNode = new FakeNode('gain', []);
    manager.silenceNode = new FakeNode('silence', []);
    manager.stream = { getTracks: () => tracks };
    manager.sourceNode = new FakeNode('source', []);
    manager.destinationNode = {};
    manager.defaultDestinationConnection = {};
    manager.cleanupAudio();
    assert.equal(manager.audioContextSinkMode, false);
    assert.equal(manager.directOutputMode, false);
    assert.equal(tracks[0].stopped, true);
    assert.equal(manager.sourceNode, null);
  });

  await withAudioIO({}, async ({ manager }) => {
    manager.outputGainNode = new FakeNode('gain', [], { failDisconnect: true });
    manager.silenceNode = new FakeNode('silence', [], { failDisconnect: true });
    manager.cleanupAudio();
    assert.equal(manager.outputGainNode, null);
  });
});

test('poll tick handles preference, enumeration, mismatch, reconnect, and play recovery', async () => {
  await withAudioIO({
    window: {
      electronAPI: { platform: 'darwin' },
      app: { _appStartTime: Date.now() }
    }
  }, async ({ manager }) => {
    let called = false;
    await manager._pollTick(async () => { called = true; }, async () => {});
    assert.equal(called, false);
  });

  await withAudioIO({}, async ({ manager, calls }) => {
    await manager._pollTick(async () => { throw new Error('prefs'); }, async () => {});
    await manager._pollTick(async () => null, async () => {});
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async () => {});
    assert.ok(calls.some(call => call[0] === 'console.warn'));
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'new-id', label: 'HDMI' }]
    },
    immediateTimeouts: true
  }, async ({ manager, windowRef }) => {
    manager.audioElement = new (createAudioClass([], { initialSinkId: 'old-id' }))();
    await manager._pollTick(async () => ({ outputDeviceId: 'missing-id', outputDeviceLabel: 'HDMI' }), async prefs => {
      windowRef.lastResetPrefs = prefs;
    });
    await flushMicrotasks();
    assert.equal(windowRef.lastResetPrefs.outputDeviceId, 'new-id');
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    },
    immediateTimeouts: true
  }, async ({ manager, contextManager, windowRef }) => {
    manager.audioContextSinkMode = true;
    contextManager.audioContext.state = 'suspended';
    contextManager.audioContext.sinkId = 'speaker';
    contextManager.audioContext.resume = async () => {
      contextManager.audioContext.state = 'suspended';
    };
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async prefs => {
      windowRef.lastResetPrefs = prefs;
    });
    assert.equal(windowRef.lastResetPrefs.outputDeviceId, 'speaker');
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    },
    immediateTimeouts: true
  }, async ({ manager }) => {
    manager.audioElement = new (createAudioClass([], { initialSinkId: 'speaker', paused: true, readyState: 1 }))();
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async () => {});
    assert.equal(manager.audioElement.paused, false);
  });
});

test('polling callbacks handle interval guards and device recovery fallbacks', async () => {
  await withAudioIO({
    window: {
      electronIntegration: { isElectronEnvironment: () => false }
    }
  }, async ({ manager, intervals }) => {
    manager.startDevicePoll(async () => ({ outputDeviceId: 'speaker' }), async () => {});
    await intervals.values().next().value.callbackFn();
    manager._pollRunning = true;
    await intervals.values().next().value.callbackFn();
    assert.equal(manager._pollRunning, true);
  });

  await withAudioIO({
    navigator: { enumerateReject: true }
  }, async ({ manager }) => {
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async () => {});
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    }
  }, async ({ manager }) => {
    manager.audioContextSinkMode = true;
    manager.contextManager.audioContext = null;
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async () => {});
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    }
  }, async ({ manager }) => {
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async () => {});
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    },
    immediateTimeouts: true
  }, async ({ manager, contextManager }) => {
    manager.audioContextSinkMode = true;
    manager._pollDeviceWasAbsent = true;
    contextManager.audioContext.sinkId = 'speaker';
    contextManager.audioContext.state = 'running';
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async () => {
      throw new Error('unused');
    });
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    },
    immediateTimeouts: true
  }, async ({ manager, contextManager, calls }) => {
    manager.audioContextSinkMode = true;
    manager._pollDeviceWasAbsent = true;
    contextManager.audioContext.sinkId = 'speaker';
    contextManager.audioContext.state = 'closed';
    manager._setSinkIdWithTimeout = async (target, sinkId) => {
      calls.push(['toggleSink', sinkId]);
      target.sinkId = sinkId;
    };
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async () => {});
    assert.ok(calls.some(call => call[0] === 'audioManager.rebuildPipeline'));
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    },
    immediateTimeouts: true
  }, async ({ manager, calls }) => {
    manager._pollDeviceWasAbsent = true;
    manager.destinationNode = { stream: { id: 'stream' } };
    manager.audioElement = new (createAudioClass(calls, { initialSinkId: 'speaker' }))();
    manager._setSinkIdWithTimeout = async (target, sinkId) => {
      calls.push(['toggleSink', sinkId]);
      target.sinkId = sinkId;
    };
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async () => {});
    assert.equal(manager.audioElement.srcObject.id, 'stream');
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    },
    immediateTimeouts: true
  }, async ({ manager, windowRef }) => {
    manager._pollDeviceWasAbsent = true;
    manager.audioElement = new (createAudioClass([], { initialSinkId: 'speaker' }))();
    manager._setSinkIdWithTimeout = async () => { throw new Error('toggle failed'); };
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async prefs => {
      windowRef.lastResetPrefs = prefs;
    });
    assert.equal(windowRef.lastResetPrefs.outputDeviceId, 'speaker');
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    }
  }, async ({ manager, windowRef }) => {
    manager.audioElement = new (createAudioClass([], {
      initialSinkId: 'speaker',
      paused: true,
      readyState: 4,
      playReject: true
    }))();
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async prefs => {
      windowRef.lastResetPrefs = prefs;
    });
    assert.equal(windowRef.lastResetPrefs.outputDeviceId, 'speaker');
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'other', label: 'Other' }]
    },
    immediateTimeouts: true
  }, async ({ manager, windowRef }) => {
    manager.audioElement = new (createAudioClass([], { initialSinkId: 'old' }))();
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async () => {
      throw new Error('reset failed');
    });
    assert.equal(windowRef.lastResetPrefs, undefined);
  });
});

test('init-registered poll callbacks ignore non-critical recovery errors', async () => {
  await withAudioIO({
    context: { audioContext: { contextSetSinkId: true } },
    window: {
      electron: true,
      electronAPI: { platform: 'darwin' },
      app: { _doMacosRelaunch: async () => {} },
      preferences: { outputDeviceId: 'ctx-device', outputDeviceLabel: 'Ctx', outputChannels: 2 }
    },
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'ctx-device', label: 'Ctx' }]
    }
  }, async ({ manager, contextManager, intervals, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    contextManager.audioContext.sinkId = 'old';
    await intervals.values().next().value.callbackFn();
    assert.ok(calls.some(call => call[0] === 'loadAudioPreferences'));
  });

  await withAudioIO({
    context: { audioContext: { contextSetSinkId: true } },
    window: {
      electron: true,
      electronAPI: { platform: 'linux' },
      audioManager: null,
      preferences: { outputDeviceId: 'ctx-device', outputDeviceLabel: 'Ctx', outputChannels: 2 }
    },
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'ctx-device', label: 'Ctx' }]
    }
  }, async ({ manager, contextManager, intervals }) => {
    assert.equal(await manager.initAudioOutput(), '');
    contextManager.audioContext.sinkId = 'old';
    await intervals.values().next().value.callbackFn();
  });

  await withAudioIO({
    context: { audioContext: { contextSetSinkId: true } },
    window: {
      electron: true,
      electronAPI: { platform: 'linux' },
      preferences: { outputDeviceId: 'ctx-device', outputDeviceLabel: 'Ctx', outputChannels: 2 }
    },
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'ctx-device', label: 'Ctx' }]
    }
  }, async ({ manager, contextManager, intervals, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    contextManager.audioContext.sinkId = 'old';
    await intervals.values().next().value.callbackFn();
    assert.ok(calls.some(call => call[0] === 'audioManager.reset'));
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: { platform: 'linux' },
      preferences: { outputDeviceId: 'speaker', outputDeviceLabel: 'Speaker', outputChannels: 2 }
    },
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    },
    immediateTimeouts: true
  }, async ({ manager, intervals, calls }) => {
    assert.equal(await manager.initAudioOutput(), '');
    manager.audioElement.sinkId = 'old';
    await intervals.values().next().value.callbackFn();
    manager.audioElement.dispatch('error');
    assert.ok(calls.some(call => call[0] === 'audioManager.reset'));
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: { platform: 'darwin' },
      app: { _doMacosRelaunch: async () => {} },
      preferences: { outputDeviceId: 'speaker', outputDeviceLabel: 'Speaker', outputChannels: 2 }
    },
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    },
    immediateTimeouts: true
  }, async ({ manager, intervals }) => {
    assert.equal(await manager.initAudioOutput(), '');
    manager.audioElement.sinkId = 'old';
    await intervals.values().next().value.callbackFn();
  });

  await withAudioIO({
    window: {
      electron: true,
      electronAPI: { platform: 'linux' },
      audioManager: null,
      preferences: { outputDeviceId: 'speaker', outputDeviceLabel: 'Speaker', outputChannels: 2 }
    },
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    },
    immediateTimeouts: true
  }, async ({ manager, intervals }) => {
    assert.equal(await manager.initAudioOutput(), '');
    manager.audioElement.sinkId = 'old';
    await intervals.values().next().value.callbackFn();
  });

  await withAudioIO({}, async ({ manager }) => {
    manager.audioElement = new (createAudioClass([], { playReject: true }))();
    manager.destinationNode = { stream: { id: 'stream' } };
    assert.equal(await manager.reapplyOutputDevice('speaker'), true);
  });

  await withAudioIO({
    window: {
      electronIntegration: { isElectronEnvironment: () => true }
    },
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    }
  }, async ({ manager, intervals }) => {
    manager.audioElement = new (createAudioClass([], { initialSinkId: 'speaker' }))();
    manager.startDevicePoll(async () => ({ outputDeviceId: 'speaker' }), async () => {});
    await intervals.values().next().value.callbackFn();
    manager._pollRunning = true;
    await intervals.values().next().value.callbackFn();
    assert.equal(manager._pollRunning, true);
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    },
    immediateTimeouts: true
  }, async ({ manager, contextManager }) => {
    manager.audioContextSinkMode = true;
    contextManager.audioContext.sinkId = 'speaker';
    contextManager.audioContext.state = 'suspended';
    contextManager.audioContext.resume = async () => { throw new Error('resume failed'); };
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async () => {
      throw new Error('reset failed');
    });
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    },
    immediateTimeouts: true
  }, async ({ manager, contextManager, windowRef }) => {
    manager.audioContextSinkMode = true;
    contextManager.audioContext.sinkId = 'speaker';
    contextManager.audioContext.state = 'suspended';
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async prefs => {
      windowRef.lastResetPrefs = prefs;
    });
    assert.equal(windowRef.lastResetPrefs, undefined);
    assert.equal(contextManager.audioContext.state, 'running');
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    },
    immediateTimeouts: true
  }, async ({ manager }) => {
    manager.audioElement = new (createAudioClass([], { initialSinkId: 'old' }))();
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async () => {
      throw 'reset string';
    });
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    },
    immediateTimeouts: true
  }, async ({ manager }) => {
    manager.audioContextSinkMode = true;
    manager._pollDeviceWasAbsent = true;
    manager.contextManager.audioContext.sinkId = 'speaker';
    manager.contextManager.audioContext.state = 'closed';
    manager._setSinkIdWithTimeout = async () => { throw 'toggle string'; };
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async () => {});
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    },
    immediateTimeouts: true
  }, async ({ manager, contextManager }) => {
    manager.audioContextSinkMode = true;
    manager._pollDeviceWasAbsent = true;
    contextManager.audioContext.sinkId = 'speaker';
    contextManager.audioContext.state = 'closed';
    contextManager.audioContext.resume = async () => { throw new Error('resume failed'); };
    manager._setSinkIdWithTimeout = async (target, sinkId) => {
      target.sinkId = sinkId;
    };
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async () => {});
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    },
    window: {
      audioManager: {
        reset: async () => {},
        rebuildPipeline: async () => { throw new Error('rebuild failed'); }
      }
    },
    immediateTimeouts: true
  }, async ({ manager, contextManager }) => {
    manager.audioContextSinkMode = true;
    manager._pollDeviceWasAbsent = true;
    contextManager.audioContext.sinkId = 'speaker';
    contextManager.audioContext.state = 'closed';
    manager._setSinkIdWithTimeout = async (target, sinkId) => {
      target.sinkId = sinkId;
    };
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async () => {});
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    },
    immediateTimeouts: true
  }, async ({ manager, calls }) => {
    manager._pollDeviceWasAbsent = true;
    manager.audioElement = new (createAudioClass(calls, {
      initialSinkId: 'speaker',
      playReject: true
    }))();
    manager._setSinkIdWithTimeout = async (target, sinkId) => {
      target.sinkId = sinkId;
    };
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async () => {});
  });

  await withAudioIO({
    navigator: {
      devices: [{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }]
    }
  }, async ({ manager, windowRef }) => {
    manager.audioElement = new (createAudioClass([], {
      initialSinkId: 'speaker',
      paused: false,
      readyState: 1
    }))();
    manager.audioElement.play = async () => { throw 'play string'; };
    await manager._pollTick(async () => ({ outputDeviceId: 'speaker' }), async prefs => {
      windowRef.lastResetPrefs = prefs;
    });
    assert.equal(windowRef.lastResetPrefs.outputDeviceId, 'speaker');
  });
});
