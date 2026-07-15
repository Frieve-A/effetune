import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioManager } from '../../js/audio-manager.js';
import { NO_AUDIO_INPUT_DEVICE_ID } from '../../js/audio/audio-device-constants.js';
import { MIC_DENIED_PREFIX } from '../../js/audio/audio-io-manager.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

function nodeName(node) {
  return node?.name ?? node?.constructor?.name ?? 'target';
}

class FakeAudioParam {
  constructor(name, calls, options = {}) {
    this.name = name;
    this.calls = calls;
    this.options = options;
    this._value = options.value ?? 1;
  }

  get value() {
    return this._value;
  }

  set value(nextValue) {
    this.calls.push(['param.value', this.name, nextValue]);
    if (this.options.throwValueSet) throw new Error(`${this.name} value failed`);
    this._value = nextValue;
  }

  cancelScheduledValues(time) {
    this.calls.push(['param.cancel', this.name, time]);
    if (this.options.throwSchedule) throw new Error(`${this.name} cancel failed`);
  }

  setValueAtTime(value, time) {
    this.calls.push(['param.set', this.name, value, time]);
    if (this.options.throwSchedule) throw new Error(`${this.name} set failed`);
    this._value = value;
  }

  linearRampToValueAtTime(value, time) {
    this.calls.push(['param.ramp', this.name, value, time]);
    if (this.options.throwSchedule) throw new Error(`${this.name} ramp failed`);
    this._value = value;
  }
}

class FakeNode {
  constructor(name, calls, options = {}) {
    this.name = name;
    this.calls = calls;
    this.options = options;
    this.connections = [];
    this.gain = options.gain ?? null;
  }

  connect(target) {
    this.calls.push(['connect', this.name, nodeName(target)]);
    if (this.options.throwConnect) throw new Error(`${this.name} connect failed`);
    this.connections.push(target);
    return target;
  }

  disconnect(target) {
    this.calls.push(['disconnect', this.name, target ? nodeName(target) : 'all']);
    if (this.options.throwDisconnect) throw new Error(`${this.name} disconnect failed`);
    this.connections = target
      ? this.connections.filter(connection => connection !== target)
      : [];
  }
}

function createPort(name, calls) {
  return {
    messages: [],
    onmessage: null,
    postMessage(message) {
      calls.push(['postMessage', name, message]);
      this.messages.push(message);
    }
  };
}

function createWorkletNode(name, calls, options = {}) {
  const node = new FakeNode(name, calls, options);
  node.port = createPort(name, calls);
  return node;
}

function createAudioContext(calls, options = {}) {
  let gainIndex = 0;
  return {
    currentTime: options.currentTime ?? 10,
    sampleRate: options.sampleRate ?? 48000,
    destination: {
      channelCount: options.channelCount ?? 2
    },
    createGain() {
      gainIndex++;
      const gain = new FakeNode(`gain${gainIndex}`, calls, options.gainNodeOptions);
      gain.gain = new FakeAudioParam(`gain${gainIndex}.gain`, calls, options.gainParamOptions);
      return gain;
    }
  };
}

function createAudioWorkletNodeClass(calls, options = {}) {
  return class FakeAudioWorkletNode extends FakeNode {
    constructor(ctx, name, workletOptions) {
      if (options.throwConstructor) throw new Error('AudioWorkletNode failed');
      super(`worklet:${name}`, calls, options.nodeOptions);
      this.ctx = ctx;
      this.workletName = name;
      this.workletOptions = workletOptions;
      this.port = createPort(`worklet:${name}`, calls);
      calls.push(['newAudioWorkletNode', name, workletOptions]);
    }
  };
}

class BasePlugin {
  constructor(options = {}) {
    this.id = options.id ?? `${this.constructor.name}-${Math.random()}`;
    this.name = options.name ?? this.constructor.name;
    this.enabled = options.enabled ?? true;
    this.inputBus = options.inputBus ?? null;
    this.outputBus = options.outputBus ?? null;
    this.channel = options.channel ?? null;
    this.processorString = options.processorString ?? 'class Processor { process() { return true; } }';
    this.parameters = options.parameters ?? { gain: 1 };
    this.calls = options.calls ?? [];
    this.throwSetParameters = Boolean(options.throwSetParameters);
  }

  process() {
    return true;
  }

  _setupMessageHandler() {
    this.calls.push(['plugin.setup', this.id]);
  }

  _setSectionEnabled(enabled) {
    this.sectionEnabled = enabled;
    this.calls.push(['plugin.section', this.id, enabled]);
  }

  getSerializableParameters() {
    return { ...this.parameters };
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  setParameters(parameters) {
    if (this.throwSetParameters) throw new Error(`${this.name} set parameters failed`);
    this.parameters = { ...parameters };
  }

  updateParameters() {
    this.calls.push(['plugin.update', this.id]);
  }

  getParameters(options) {
    this.calls.push(['plugin.getParameters', this.id, options]);
    return { ...this.parameters, sampleRate: options.sampleRate };
  }
}

class AlphaPlugin extends BasePlugin {}
class BetaPlugin extends BasePlugin {}
class GammaPlugin extends BasePlugin {}
class MissingProcessorPlugin extends BasePlugin {
  constructor(options = {}) {
    super({ ...options, processorString: '' });
  }
}
class DisabledMissingProcessorPlugin extends BasePlugin {
  constructor(options = {}) {
    super({ ...options, enabled: false, processorString: '' });
  }
}
class SectionPlugin extends BasePlugin {}

const pluginConstructors = {
  AlphaPlugin,
  BetaPlugin,
  GammaPlugin,
  MissingProcessorPlugin,
  DisabledMissingProcessorPlugin,
  SectionPlugin
};

function createPlugin(type = 'AlphaPlugin', options = {}) {
  const PluginClass = pluginConstructors[type] ?? AlphaPlugin;
  return new PluginClass({ ...options, name: options.name ?? type });
}

function createConsole(calls) {
  return {
    ...console,
    log(...args) {
      calls.push(['console.log', ...args]);
    },
    warn(...args) {
      calls.push(['console.warn', ...args]);
    },
    error(...args) {
      calls.push(['console.error', ...args]);
    }
  };
}

function createPipelineManager(calls, options = {}) {
  const expandedPlugins = options.expandedPlugins ?? new Set();
  return {
    expandedPlugins,
    historyManager: options.historyManager === false ? null : {
      saveState() {
        calls.push(['history.saveState']);
      }
    },
    pluginManager: options.pluginManager ?? {
      createPlugin(name) {
        calls.push(['pluginManager.createPlugin', name]);
        if (options.nullPluginNames?.has(name)) return null;
        if (options.throwPluginNames?.has(name)) throw new Error(`${name} create failed`);
        return createPlugin(options.copyType ?? 'GammaPlugin', { name, calls });
      }
    }
  };
}

function installFakes(manager, calls, options = {}) {
  const audioContext = options.audioContext === undefined
    ? createAudioContext(calls, options.audioContextOptions)
    : options.audioContext;
  const workletNode = options.workletNode === undefined
    ? createWorkletNode('workletA', calls, options.workletNodeOptions)
    : options.workletNode;
  const sourceNode = options.sourceNode === undefined
    ? new FakeNode('source', calls, options.sourceNodeOptions)
    : options.sourceNode;
  const outputGainNode = options.outputGainNode === undefined
    ? new FakeNode('outputGain', calls, {
      gain: new FakeAudioParam('outputGain.gain', calls, options.outputGainParamOptions),
      ...options.outputGainNodeOptions
    })
    : options.outputGainNode;

  let skipAudioInit = Boolean(options.skipAudioInit);
  manager.contextManager = {
    audioContext,
    workletNode,
    lowLatencyMode: Boolean(options.lowLatencyMode),
    isFirstLaunch: Boolean(options.isFirstLaunch),
    async initAudioContext(audioPreferences) {
      calls.push(['context.initAudioContext', audioPreferences]);
      if (options.throwInitAudioContext) throw new Error('init context failed');
      return options.contextInitResult ?? '';
    },
    async loadAudioWorklet() {
      calls.push(['context.loadAudioWorklet']);
      if (options.throwLoadAudioWorklet) throw new Error('load worklet failed');
      return options.workletLoadResult ?? '';
    },
    async resumeAudioContext() {
      calls.push(['context.resumeAudioContext']);
    },
    async closeAudioContext() {
      calls.push(['context.closeAudioContext']);
    },
    getSkipAudioInitDuringSampleRateChange() {
      return skipAudioInit;
    },
    setSkipAudioInitDuringSampleRateChange(value) {
      calls.push(['context.setSkipAudioInitDuringSampleRateChange', value]);
      skipAudioInit = value;
    }
  };

  manager.ioManager = {
    stream: options.stream ?? { id: 'stream' },
    sourceNode,
    outputGainNode,
    lastInputInitializationError: options.inputInitializationError ?? null,
    async initAudioInput(optionsArg) {
      calls.push(['io.initAudioInput', optionsArg]);
      if (options.throwInitAudioInput) throw new Error('input failed');
      return options.inputResult ?? '';
    },
    async initAudioOutput() {
      calls.push(['io.initAudioOutput']);
      if (options.throwInitAudioOutput) throw new Error('output failed');
      return options.outputResult ?? '';
    },
    cleanupAudio() {
      calls.push(['io.cleanupAudio']);
    },
    markInputNotConfigured() {
      calls.push(['io.markInputNotConfigured']);
      return true;
    }
  };

  manager.pipelineProcessor = {
    pipeline: null,
    masterBypass: false,
    setPipeline(pipeline) {
      calls.push(['pipelineProcessor.setPipeline', pipeline]);
      this.pipeline = pipeline;
    },
    setMasterBypass(masterBypass) {
      calls.push(['pipelineProcessor.setMasterBypass', masterBypass]);
      this.masterBypass = masterBypass;
    },
    async rebuildPipeline(isInitializing) {
      calls.push(['pipelineProcessor.rebuildPipeline', isInitializing]);
      if (options.throwPipelineRebuild) throw new Error('pipeline rebuild failed');
      return options.pipelineRebuildResult ?? '';
    }
  };

  manager.offlineProcessor = {
    offlineContext: options.offlineContext ?? { id: 'offlineContext' },
    offlineWorkletNode: options.offlineWorkletNode ?? { id: 'offlineWorkletNode' },
    isOfflineProcessing: Boolean(options.isOfflineProcessing),
    isCancelled: Boolean(options.isCancelled),
    async processAudioFile(file, pipeline, progressCallback) {
      calls.push(['offline.processAudioFile', file, pipeline, progressCallback]);
      if (options.throwOfflineProcess) throw new Error('offline failed');
      return options.offlineResult ?? { type: 'audio/wav' };
    },
    cancelProcessing() {
      calls.push(['offline.cancelProcessing']);
      this.isCancelled = true;
    }
  };

  manager.audioEncoder = {
    encodeWAV(audioBuffer) {
      calls.push(['encoder.encodeWAV', audioBuffer]);
      return options.encodedWav ?? { wav: true, audioBuffer };
    }
  };

  manager.updateExposedProperties();
  calls.length = 0;

  return { audioContext, workletNode, sourceNode, outputGainNode };
}

async function withAudioManager(options = {}, callback) {
  const calls = [];
  const timers = [];
  const storageValues = new Map();
  if (options.storedAudioPreferences) {
    storageValues.set(
      'effetune_audio_preferences',
      JSON.stringify(options.storedAudioPreferences)
    );
  }
  const windowObject = {
    pluginManager: options.windowPluginManager,
    workletNode: options.windowWorkletNode,
    electronAPI: options.electronAPI,
    electronIntegration: options.electronIntegration,
    uiManager: options.uiManager,
    originalConnectMethod: options.originalConnectMethod,
    localStorage: {
      getItem(key) { return storageValues.get(key) ?? null; },
      setItem(key, value) { storageValues.set(key, String(value)); },
      removeItem(key) { storageValues.delete(key); }
    }
  };
  const globals = {
    window: windowObject,
    document: {
      listeners: [],
      addEventListener(type, listener, listenerOptions) {
        calls.push(['document.addEventListener', type, listenerOptions]);
        this.listeners.push({ type, listener, listenerOptions });
      }
    },
    console: createConsole(calls),
    AudioWorkletNode: createAudioWorkletNodeClass(calls, options.audioWorkletNodeOptions),
    setTimeout(fn, delay) {
      calls.push(['setTimeout', delay]);
      if (options.autoRunTimers !== false) {
        fn();
      } else {
        timers.push(fn);
      }
      return calls.length;
    },
    clearTimeout(id) {
      calls.push(['clearTimeout', id]);
    }
  };

  return withGlobals(globals, async () => {
    const pipelineManager = options.pipelineManager ?? createPipelineManager(calls, options.pipelineManagerOptions);
    const manager = new AudioManager(pipelineManager);
    const originalPipelineProcessor = manager.pipelineProcessor;
    const fakes = installFakes(manager, calls, options);
    manager.pipelineA = options.pipelineA ?? [
      createPlugin('AlphaPlugin', { id: 'a1', calls }),
      createPlugin('BetaPlugin', { id: 'a2', calls })
    ];
    manager.pipelineB = options.pipelineB ?? [createPlugin('GammaPlugin', { id: 'b1', calls })];
    manager.currentPipeline = options.currentPipeline ?? 'A';
    manager.pipeline = manager.getCurrentPipeline();
    calls.length = 0;

    return callback({
      calls,
      fakes,
      manager,
      originalPipelineProcessor,
      pipelineManager,
      storageValues,
      timers,
      windowObject
    });
  });
}

function installSilentInputSelection(manager, calls, {
  requestResult = true,
  applyBeforeFailure = false,
  inputConfigRevision = 10,
  failureMessage = 'silent input selection failed',
  beforeRequest = null
} = {}) {
  const liveSource = manager.ioManager.sourceNode;
  const silentSource = new FakeNode('silent-input', calls);
  const requestedRevisions = [];
  manager.ioManager.inputSourceNode = liveSource;
  manager.ioManager.getInputSnapshot = () => ({
    state: manager.ioManager.inputSourceNode ? 'live' : 'not-configured'
  });
  manager.powerPolicyController = {
    started: false,
    transitionError: requestResult ? null : { message: failureMessage },
    getInputConfigRevision: () => inputConfigRevision,
    async requestSilentInputSelection(revision) {
      requestedRevisions.push(revision);
      beforeRequest?.();
      if (requestResult || applyBeforeFailure) {
        manager.ioManager.inputSourceNode = null;
        manager.ioManager.silentInputGainNode = silentSource;
        manager._connectedPipelineSources.add(silentSource);
      }
      return requestResult;
    },
    requestReconcile(reason) {
      calls.push(['power.requestReconcile', reason]);
      return Promise.resolve();
    }
  };
  return { liveSource, silentSource, requestedRevisions };
}

test('manages pipeline selection, copying, state, and history integration', async () => {
  await withAudioManager({}, async ({ calls, manager, originalPipelineProcessor, pipelineManager }) => {
    originalPipelineProcessor.registerProcessors();
    const changed = [];
    manager.addEventListener('pipelineChanged', data => changed.push(data.pipeline));

    assert.equal(manager.getCurrentPipeline(), manager.pipelineA);
    manager.currentPipeline = 'B';
    manager.pipelineB = null;
    assert.deepEqual(manager.getCurrentPipeline(), []);
    manager.pipelineB = [createPlugin('GammaPlugin', { id: 'b1', calls })];
    manager.currentPipeline = 'A';

    manager.setCurrentPipeline('B');
    assert.equal(manager.pipeline, manager.pipelineB);
    assert.deepEqual(changed, ['B']);
    assert.equal(calls.some(call => call[0] === 'history.saveState'), true);
    assert.equal(calls.some(call => call[0] === 'pipelineProcessor.rebuildPipeline'), true);

    calls.length = 0;
    manager.setCurrentPipeline('A', true);
    assert.equal(calls.some(call => call[0] === 'history.saveState'), false);
    assert.throws(() => manager.setCurrentPipeline('C'), /Pipeline must/);

    manager.pipelineB = null;
    manager.togglePipeline();
    assert.equal(manager.currentPipeline, 'B');
    assert.equal(manager.pipelineB.length, 2);
    assert.equal(pipelineManager.expandedPlugins.size, 0);
    manager.togglePipeline();
    assert.equal(manager.currentPipeline, 'A');

    pipelineManager.expandedPlugins.add(manager.pipelineA[0]);
    manager.copyAToB();
    assert.equal(manager.currentPipeline, 'B');
    assert.equal(pipelineManager.expandedPlugins.has(manager.pipelineB[0]), true);

    manager.copyBToA();
    assert.equal(manager.currentPipeline, 'A');
    manager.pipelineB = null;
    const beforeA = manager.pipelineA;
    manager.copyBToA();
    assert.equal(manager.pipelineA, beforeA);

    manager.updateCurrentPipeline(null);
    assert.deepEqual(manager.pipelineA, []);
    manager.currentPipeline = 'B';
    manager.updateCurrentPipeline([manager.pipelineB?.[0]]);
    assert.equal(manager.pipeline, manager.pipelineB);

    const state = manager.getPipelineState();
    assert.equal(state.currentPipeline, 'B');
    manager.setPipelineState({ pipelineA: [createPlugin('AlphaPlugin', { id: 'state-a', calls })] });
    assert.equal(manager.pipeline, manager.pipelineA);
    manager.setPipelineState({ pipelineB: [createPlugin('BetaPlugin', { id: 'state-b', calls })], currentPipeline: 'B' });
    assert.equal(manager.currentPipeline, 'B');
  });
});

test('pipeline copy fallbacks and plugin creation failures leave pipelines usable', async () => {
  await withAudioManager({
    pipelineManagerOptions: {
      nullPluginNames: new Set(['NullPlugin']),
      throwPluginNames: new Set(['ThrowPlugin'])
    },
    pipelineA: []
  }, async ({ manager }) => {
    assert.deepEqual(manager._copyPipeline(null), []);
    manager.pipelineManager = {};
    delete window.pluginManager;
    assert.deepEqual(manager._copyPipeline([createPlugin('AlphaPlugin')]), []);

    manager.pipelineManager = createPipelineManager([], {
      nullPluginNames: new Set(['NullPlugin']),
      throwPluginNames: new Set(['ThrowPlugin'])
    });
    const copied = manager._copyPipeline([
      createPlugin('AlphaPlugin', { name: 'NullPlugin' }),
      createPlugin('AlphaPlugin', { name: 'ThrowPlugin' }),
      createPlugin('AlphaPlugin', { name: 'BadState', throwSetParameters: true }),
      createPlugin('AlphaPlugin', { name: 'GoodPlugin' })
    ]);
    assert.equal(copied.length, 2);
    assert.deepEqual(copied.map(plugin => plugin.name), ['BadState', 'GoodPlugin']);

    manager.pipelineManager = { pluginManager: createPipelineManager([]).pluginManager };
    assert.equal(manager._copyPipeline([createPlugin('AlphaPlugin')]).length, 1);
  });
});

test('switches pipelines with fade transitions, cancellation, and fallback paths', async () => {
  await withAudioManager({ pipelineRebuildResult: 'switch warning' }, async ({ calls, manager }) => {
    await assert.rejects(() => manager.setCurrentPipelineWithTransition('C'), /Pipeline must/);
    assert.equal(await manager.setCurrentPipelineWithTransition('A'), true);

    const ok = await manager.setCurrentPipelineWithTransition('B', false, { fadeDuration: 0.01, silenceDuration: 0.02 });
    assert.equal(ok, true);
    assert.equal(manager.currentPipeline, 'B');
    assert.equal(calls.some(call => call[0] === 'param.ramp' && call[2] === 0), true);
    assert.equal(calls.some(call => call[0] === 'param.ramp' && call[2] === 1), true);
  });

  await withAudioManager({}, async ({ manager }) => {
    manager.pipelineB = null;
    assert.equal(await manager.togglePipelineWithTransition(), true);
    assert.equal(manager.currentPipeline, 'B');
    assert.equal(await manager.togglePipelineWithTransition(), true);
    assert.equal(manager.currentPipeline, 'A');
  });

  await withAudioManager({ outputGainNode: null }, async ({ manager }) => {
    assert.equal(await manager.setCurrentPipelineWithTransition('B'), true);
    assert.equal(manager.currentPipeline, 'B');
  });

  await withAudioManager({ autoRunTimers: false }, async ({ manager, timers }) => {
    const pending = manager.setCurrentPipelineWithTransition('B');
    assert.equal(timers.length, 1);
    manager._pipelineSwitchSeq++;
    timers.shift()();
    assert.equal(await pending, false);
    assert.equal(manager.currentPipeline, 'A');
  });

  await withAudioManager({ autoRunTimers: false }, async ({ manager, timers }) => {
    const pending = manager.setCurrentPipelineWithTransition('B');
    timers.shift()();
    await flushMicrotasks();
    assert.equal(manager.currentPipeline, 'B');
    manager._pipelineSwitchSeq++;
    timers.shift()();
    assert.equal(await pending, false);
  });

  await withAudioManager({ autoRunTimers: false }, async ({ manager, timers }) => {
    const fades = [];
    manager.fadeInOutput = () => fades.push(manager.ioManager.outputGainNode);
    const pending = manager.setCurrentPipelineWithTransition('B');
    const replacementOutput = { name: 'replacement-output' };
    manager.contextManager.audioContext = { currentTime: 2 };
    manager.ioManager.outputGainNode = replacementOutput;
    manager._advanceAudioGraphGeneration();
    timers.shift()();

    assert.equal(await pending, false);
    assert.equal(manager.currentPipeline, 'A');
    assert.deepEqual(fades, []);
  });

  await withAudioManager({ autoRunTimers: false }, async ({ manager, timers }) => {
    const fades = [];
    let rejectRebuild;
    manager.fadeInOutput = () => fades.push(manager.ioManager.outputGainNode);
    manager.rebuildPipeline = () => new Promise((resolve, reject) => {
      rejectRebuild = reject;
    });
    const pending = manager.setCurrentPipelineWithTransition('B');
    timers.shift()();
    await flushMicrotasks();
    assert.equal(manager.currentPipeline, 'B');

    manager.contextManager.audioContext = { currentTime: 2 };
    manager.ioManager.outputGainNode = { name: 'replacement-output' };
    manager._advanceAudioGraphGeneration();
    manager.currentPipeline = 'A';
    manager.pipeline = manager.pipelineA;
    rejectRebuild(new Error('stale rebuild failed'));

    assert.equal(await pending, false);
    assert.equal(manager.currentPipeline, 'A');
    assert.deepEqual(fades, []);
  });

  await withAudioManager({ autoRunTimers: false }, async ({ manager, timers }) => {
    const events = [];
    let resolveRebuild;
    manager.dispatchEvent = (...args) => events.push(args);
    manager.rebuildPipeline = () => new Promise(resolve => {
      resolveRebuild = resolve;
    });
    const pending = manager.setCurrentPipelineWithTransition('B');
    timers.shift()();
    await flushMicrotasks();

    manager.contextManager.audioContext = { currentTime: 2 };
    manager.ioManager.outputGainNode = { name: 'replacement-output' };
    manager._advanceAudioGraphGeneration();
    resolveRebuild('');

    assert.equal(await pending, false);
    assert.deepEqual(events, []);
  });

  await withAudioManager({}, async ({ manager }) => {
    manager.fadeOutOutput = () => {
      throw new Error('fade out exploded');
    };
    const ok = await manager.setCurrentPipelineWithTransition('B', true);
    assert.equal(ok, false);
    assert.equal(manager.currentPipeline, 'B');
  });
});

test('initializes audio and worklet phases with success, warnings, messages, and failures', async () => {
  await withAudioManager({}, async ({ calls, manager }) => {
    assert.equal(await manager.initAudio(), '');
    assert.equal(manager.audioContext, manager.contextManager.audioContext);
    assert.equal(calls.some(call => call[0] === 'context.resumeAudioContext'), true);
  });

  // Layout mode must not affect the audio input path: mobile initializes the
  // input exactly like desktop.
  await withAudioManager({
    uiManager: { layoutMode: { isMobile: true } }
  }, async ({ calls, manager }) => {
    assert.equal(await manager.initAudio(), '');
    assert.equal(calls.find(call => call[0] === 'io.initAudioInput')[1], undefined);
  });

  await withAudioManager({}, async ({ calls, manager }) => {
    const preferences = { inputDeviceId: 'saved-microphone', sampleRate: 48000 };
    assert.equal(await manager.initAudio(preferences), '');
    assert.equal(calls.find(call => call[0] === 'context.initAudioContext')[1], preferences);
    assert.equal(calls.find(call => call[0] === 'io.initAudioInput')[1], preferences);
  });

  await withAudioManager({ contextInitResult: 'context error' }, async ({ manager }) => {
    assert.equal(await manager.initAudio(), 'context error');
  });
  await withAudioManager({ outputResult: 'output error' }, async ({ manager }) => {
    assert.equal(await manager.initAudio(), 'output error');
  });
  await withAudioManager({ inputResult: 'mic warning' }, async ({ manager }) => {
    assert.equal(await manager.initAudio(), 'mic warning');
  });
  await withAudioManager({ throwInitAudioInput: true }, async ({ manager }) => {
    assert.equal(await manager.initAudio(), 'Audio Error: input failed');
  });

  await withAudioManager({}, async ({ calls, manager }) => {
    manager.rebuildPipeline = async () => {
      calls.push(['manager.rebuildPipeline']);
      throw new Error('rebuild after missing failed');
    };
    manager.registerPipelineProcessors = () => calls.push(['manager.registerPipelineProcessors']);
    assert.equal(await manager.initializeAudioWorklet(), '');
    manager.workletNode.port.onmessage({ data: { type: 'sleepModeChanged', isSleepMode: true } });
    manager.workletNode.port.onmessage({ data: { type: 'processorMissing', pluginType: 'AlphaPlugin' } });
    await Promise.resolve();
    assert.equal(calls.some(call => call[0] === 'manager.registerPipelineProcessors'), true);
  });

  await withAudioManager({ workletLoadResult: 'worklet error' }, async ({ manager }) => {
    assert.equal(await manager.initializeAudioWorklet(), 'worklet error');
  });
  await withAudioManager({ workletNode: null }, async ({ manager }) => {
    assert.equal(await manager.initializeAudioWorklet(), '');
  });
  await withAudioManager({ throwLoadAudioWorklet: true }, async ({ manager }) => {
    assert.equal(await manager.initializeAudioWorklet(), 'Audio Error: load worklet failed');
  });
});


test('registers processors, rebuilds pipelines, and posts audio configuration', async () => {
  await withAudioManager({}, async ({ calls, manager }) => {
    manager.pipelineA = [
      createPlugin('SectionPlugin', { id: 'section-off', enabled: false, calls }),
      createPlugin('AlphaPlugin', { id: 'alpha', calls }),
      createPlugin('MissingProcessorPlugin', { id: 'missing', calls }),
      createPlugin('DisabledMissingProcessorPlugin', { id: 'disabled-missing', calls }),
      Object.create(null)
    ];
    manager.pipelineB = [createPlugin('AlphaPlugin', { id: 'alpha-duplicate', calls })];
    manager.pipeline = manager.pipelineA;

    manager.registerPipelineProcessors();
    const registerMessages = calls.filter(call => call[0] === 'postMessage' && call[2].type === 'registerProcessor');
    assert.equal(registerMessages.length, 2);
    assert.equal(calls.some(call => call[0] === 'console.warn' && String(call[1]).includes('Processor string missing')), true);

    const noProcess = createPlugin('BetaPlugin', { id: 'no-process', calls });
    noProcess.process = null;
    manager.registerPipelineProcessors(noProcess);
    manager.registerPipelineProcessors([Object.create(null)]);
    manager.pipelineB = null;
    manager.registerPipelineProcessors();

    calls.length = 0;
    manager.pipeline = null;
    assert.equal(await manager.rebuildPipeline(false), '');
    assert.deepEqual(manager.pipeline, []);

    manager.pipeline = manager.pipelineA;
    assert.equal(await manager.rebuildPipeline(true), '');
    assert.equal(manager.pipelineA[1].sectionEnabled, false);
    assert.equal(calls.some(call => call[0] === 'pipelineProcessor.rebuildPipeline' && call[1] === true), true);

    manager.workletNode = manager.contextManager.workletNode;
    manager.updateAudioConfig({});
    manager.updateAudioConfig({ outputChannels: 6, lowLatencyOutput: true });
    assert.equal(calls.filter(call => call[0] === 'postMessage' && call[2].type === 'updateAudioConfig').length, 2);

    manager.workletNode = null;
    manager.updateAudioConfig({ outputChannels: 8 });
  });

  await withAudioManager({ workletNode: null }, async ({ manager }) => {
    manager.registerPipelineProcessors();
  });

  await withAudioManager({ pipelineRebuildResult: 'minor rebuild warning' }, async ({ manager }) => {
    assert.equal(await manager.rebuildPipeline(false), 'minor rebuild warning');
  });

  await withAudioManager({}, async ({ calls, manager }) => {
    manager._parallelActive = true;
    manager._applyParallelRouting = () => calls.push(['manager.applyParallelRouting']);
    await manager.rebuildPipeline(false);
    assert.equal(calls.some(call => call[0] === 'manager.applyParallelRouting'), true);
  });
});

test('staged audio config publishes only after resource acquisition and a current activation commit', async () => {
  await withAudioManager({}, async ({ calls, fakes, manager }) => {
    let published = null;
    let stagedIntent = null;
    manager.powerPolicyController = {
      enabled: true,
      started: true,
      sessionJournal: {
        getStatus: () => ({ sessionId: 'session-a', clientId: 'client-a' })
      }
    };
    manager.getActivePowerWorklets = () => [fakes.workletNode];
    manager.audioActivationCoordinator = {
      isSupported: () => true,
      async stageIntent(intent) {
        stagedIntent = intent;
        return { generation: 8 };
      },
      async activate(stage, callbacks) {
        assert.equal(published, null);
        const candidate = await callbacks.acquire(stage);
        assert.equal(published, null);
        assert.equal(callbacks.isCandidateCurrent(candidate, stage), true);
        return { activated: true, value: callbacks.commit(candidate, stage) };
      },
      getActiveDescriptor: () => null
    };
    manager.updateAudioConfig = async preferences => {
      calls.push(['staged.updateAudioConfig', { ...preferences }]);
      return true;
    };
    manager.fadeOutOutputWithOwner = () => {
      throw new Error('staged config must not mute the master output');
    };
    manager.fadeInOutputForOwner = () => {
      throw new Error('staged config must not change the master output');
    };

    const preferences = { outputChannels: 4, lowLatencyOutput: true };
    const result = await manager.applyStagedAudioConfig(preferences, {
      expectedConfigRevision: 0,
      publish(value, revision) {
        published = { value, revision };
        return 'published';
      }
    });

    assert.equal(result.activated, true);
    assert.equal(stagedIntent.intentKind, 'config');
    assert.deepEqual(stagedIntent.intentIdentity, {
      audioSessionId: 'session-a',
      clientId: 'client-a',
      configIntentSequence: 1,
      expectedAppConfigRevision: 0
    });
    assert.deepEqual(stagedIntent.activationAffectingConfig, preferences);
    assert.deepEqual(published, { value: preferences, revision: 1 });
    assert.equal(manager._activeAudioConfigRevision, 1);
    assert.equal(calls.some(call => call[0] === 'staged.updateAudioConfig'), true);

    calls.length = 0;
    const stale = await manager.applyStagedAudioConfig({ outputChannels: 8 }, {
      expectedConfigRevision: 0
    });
    assert.equal(stale.activated, false);
    assert.equal(stale.error.code, 'activation-config-revision-stale');
    assert.equal(calls.some(call => call[0] === 'staged.updateAudioConfig'), false);

    manager.audioActivationCoordinator.activate = async (stage, callbacks) => {
      await callbacks.acquire(stage);
      return { activated: false, error: new Error('candidate stale') };
    };
    const failed = await manager.applyStagedAudioConfig({ outputChannels: 6 }, {
      expectedConfigRevision: 1
    });
    assert.equal(failed.activated, false);
    assert.equal(manager.ioManager.outputGainNode.gain.value, 1);
  });
});

test('commits topology mutations once and posts pipeline content to the primary worklet only', async () => {
  await withAudioManager({}, async ({ calls, manager }) => {
    const primary = manager.contextManager.workletNode;
    const parallel = createWorkletNode('workletB', calls);
    manager._parallelWorkletB = parallel;
    manager._parallelActive = true;
    manager._structuralZeroOutputProof = Object.freeze({ proven: true });
    let topologyNotificationCount = 0;
    const topologyNotifications = [];
    const workletEvents = [];
    manager.powerPolicyController = {
      notifyTopologyChanged(reason, options) {
        topologyNotificationCount++;
        topologyNotifications.push({ reason, options });
        manager._topologyRevision++;
        return {
          receipt: {
            mutationKind: 'route-topology-commit',
            reason
          }
        };
      },
      handleWorkletPowerEvent(data) {
        workletEvents.push(data);
      }
    };

    manager.registerPipelineProcessors(createPlugin('AlphaPlugin', {
      id: 'parallel-alpha',
      calls
    }));
    assert.deepEqual(
      calls.filter(call => call[0] === 'postMessage' && call[2].type === 'registerProcessor')
        .map(call => call[1]),
      ['workletA', 'workletB']
    );
    calls.length = 0;

    const topologyBefore = manager.getPowerTopologyRevision();
    const graphBefore = manager.getPowerWorkletGraphGeneration();
    const result = manager.commitPowerTopologyMutation({
      type: 'updatePlugin',
      plugin: { id: 'alpha', enabled: true, parameters: { gain: 2 } }
    }, { reason: 'test-parameter-update' });

    // Pipeline-content mutations must reach the primary worklet only, even
    // while the parallel (blind test) worklet B is live.
    assert.equal(result.postedNodeCount, 1);
    assert.equal(result.mutation.receipt.mutationKind, 'route-topology-commit');
    assert.equal(topologyNotificationCount, 1);
    assert.deepEqual(topologyNotifications[0], {
      reason: 'test-parameter-update',
      options: { resetWorkletTemporalState: true }
    });
    assert.equal(manager.getPowerTopologyRevision(), topologyBefore + 1);
    assert.equal(manager.getPowerWorkletGraphGeneration(), graphBefore);
    assert.equal(manager.getStructuralZeroOutputProof(), null);
    assert.deepEqual(
      calls.filter(call => call[0] === 'postMessage' && call[2].type === 'updatePlugin')
        .map(call => call[1]),
      ['workletA']
    );

    // Non-pipeline (power/config) mutations still broadcast to every live worklet.
    const configResult = manager.commitPowerTopologyMutation({
      type: 'updateAudioConfig',
      outputChannels: 2
    }, { reason: 'test-config-update' });
    assert.equal(configResult.postedNodeCount, 2);
    assert.deepEqual(topologyNotifications[1], {
      reason: 'test-config-update',
      options: { resetWorkletTemporalState: true }
    });
    assert.deepEqual(
      calls.filter(call => call[0] === 'postMessage' && call[2].type === 'updateAudioConfig')
        .map(call => call[1]),
      ['workletA', 'workletB']
    );

    const committedRevision = manager.getPowerTopologyRevision();
    manager.handleWorkletMessage({
      data: {
        type: 'powerStateAck',
        commandId: 11,
        processingState: 'active',
        processingDirective: 'full-process',
        topologyRevision: committedRevision,
        workletGraphGeneration: graphBefore,
        renderSequence: 20
      }
    }, primary);
    manager.handleWorkletMessage({
      data: {
        type: 'powerFirstRender',
        commandId: 11,
        processingState: 'active',
        processingDirective: 'full-process',
        topologyRevision: committedRevision,
        workletGraphGeneration: graphBefore,
        renderSequence: 21
      }
    }, primary);
    assert.equal(manager.getPowerTopologyRevision(), committedRevision);
    assert.equal(workletEvents.length, 2);
  });
});

test('updatePlugins commits during a blind test never overwrite parallel worklet B', async () => {
  await withAudioManager({}, async ({ calls, manager }) => {
    const parallel = createWorkletNode('workletB', calls);
    manager._parallelWorkletB = parallel;
    manager._parallelActive = true;
    manager.powerPolicyController = {
      notifyTopologyChanged() {
        manager._topologyRevision++;
        return { receipt: { mutationKind: 'route-topology-commit' } };
      }
    };

    // Simulate the dedicated blind-test pipeline held by worklet B.
    manager._buildBlindPluginData = pipeline => pipeline;
    manager._postBlindPlugins(parallel, [{ id: 'blind-only', type: 'AlphaPlugin' }]);
    calls.length = 0;
    parallel.port.messages.length = 0;

    // UI-driven pipeline sync while the blind test runs (preparing or active).
    for (const preparing of [false, true]) {
      manager._parallelPreparing = preparing;
      manager.commitPowerTopologyMutation({
        type: 'updatePlugins',
        plugins: [{ id: 'visible', type: 'BetaPlugin' }],
        masterBypass: false
      }, { reason: 'pipeline-full-update' });
    }

    const postsToB = calls.filter(call =>
      call[0] === 'postMessage' && call[1] === 'workletB');
    assert.deepEqual(postsToB, []);
    assert.equal(parallel.port.messages.length, 0);
    assert.deepEqual(
      calls.filter(call => call[0] === 'postMessage' && call[2].type === 'updatePlugins')
        .map(call => call[1]),
      ['workletA', 'workletA']
    );
  });
});

test('parallel preparation excludes worklet B from power proof until activation', async () => {
  await withAudioManager({}, async ({ calls, manager }) => {
    const primary = manager.contextManager.workletNode;
    const parallel = createWorkletNode('workletB', calls);
    const powerEvents = [];
    manager._parallelWorkletB = parallel;
    manager._parallelPreparing = true;
    manager._parallelActive = false;
    manager.audioActivationCoordinator = {
      recordWorkletEvent(data, node) {
        powerEvents.push(['activation', data.type, node]);
      }
    };
    manager.powerPolicyController = {
      handleWorkletPowerEvent(data, node) {
        powerEvents.push(['policy', data.type, node]);
      }
    };

    assert.deepEqual(manager.getActivePowerWorklets(), [primary]);
    calls.length = 0;
    manager.broadcastToActiveWorklets({ type: 'power-test' });
    assert.deepEqual(
      calls.filter(call => call[0] === 'postMessage').map(call => call[1]),
      ['workletA']
    );
    manager.handleWorkletMessage({ data: { type: 'powerObservation' } }, parallel);
    assert.deepEqual(powerEvents, []);

    manager._parallelPreparing = false;
    manager._parallelActive = true;
    assert.deepEqual(manager.getActivePowerWorklets(), [primary, parallel]);
    manager.handleWorkletMessage({ data: { type: 'powerObservation' } }, parallel);
    assert.equal(powerEvents.length, 2);
  });
});

test('serializes resets, handles reset outcomes, and notifies graph rebuild listeners', async () => {
  await withAudioManager({}, async ({ calls, manager }) => {
    let releaseFirstReset;
    let releaseSecondReset;
    let markSecondStarted;
    const secondStarted = new Promise(resolve => {
      markSecondStarted = resolve;
    });
    manager._doReset = async prefs => {
      calls.push(['manager._doReset', prefs]);
      if (prefs?.name === 'first') {
        await new Promise(resolve => {
          releaseFirstReset = resolve;
        });
      } else if (prefs?.name === 'second') {
        markSecondStarted();
        await new Promise(resolve => {
          releaseSecondReset = resolve;
        });
      }
      return prefs?.result ?? '';
    };

    const first = manager.reset({ name: 'first' });
    const second = manager.reset({ name: 'second', result: 'queued result' });
    assert.equal(await second, '');
    releaseFirstReset();
    await secondStarted;
    const third = manager.reset({ name: 'third', result: 'latest result' });
    assert.equal(await third, '');
    releaseSecondReset();
    assert.equal(await first, 'latest result');
    assert.deepEqual(
      calls.filter(call => call[0] === 'manager._doReset').map(call => call[1].name),
      ['first', 'second', 'third']
    );
    assert.equal(manager._resetInProgress, false);
  });

  await withAudioManager({}, async ({ calls, manager }) => {
    let releaseActiveReset;
    manager._doReset = async prefs => {
      calls.push(['manager._doReset', prefs]);
      if (calls.filter(call => call[0] === 'manager._doReset').length === 1) {
        await new Promise(resolve => {
          releaseActiveReset = resolve;
        });
      }
      return '';
    };
    const activePreferences = { inputDeviceId: 'device-a' };
    const pendingPreferences = { inputDeviceId: 'device-b' };

    const active = manager.reset(activePreferences);
    assert.equal(await manager.reset(pendingPreferences), '');
    assert.equal(await manager.reset(activePreferences), '');
    releaseActiveReset();
    assert.equal(await active, '');
    assert.deepEqual(
      calls.filter(call => call[0] === 'manager._doReset').map(call => call[1]),
      [activePreferences, activePreferences]
    );
  });

  await withAudioManager({}, async ({ calls, manager }) => {
    let releaseActiveReset;
    manager._doReset = async prefs => {
      calls.push(['manager._doReset', prefs]);
      if (calls.filter(call => call[0] === 'manager._doReset').length === 1) {
        await new Promise(resolve => {
          releaseActiveReset = resolve;
        });
      }
      return '';
    };
    const preferences = { inputDeviceId: 'device-a' };

    const activeReset = manager.reset(preferences);
    assert.equal(await manager.reset(preferences), '');
    releaseActiveReset();
    assert.equal(await activeReset, '');
    assert.deepEqual(
      calls.filter(call => call[0] === 'manager._doReset').map(call => call[1]),
      [preferences]
    );
  });

  await withAudioManager({}, async ({ manager }) => {
    manager._doReset = async () => undefined;
    assert.equal(await manager.reset(), '');
  });

  await withAudioManager({ skipAudioInit: true }, async ({ calls, manager }) => {
    assert.equal(await manager._doReset(), '');
    assert.equal(calls.some(call => call[0] === 'context.setSkipAudioInitDuringSampleRateChange' && call[1] === false), true);
  });

  await withAudioManager({
    electronAPI: {},
    electronIntegration: {
      async saveAudioPreferences(prefs) {
        prefs.saved = true;
      }
    }
  }, async ({ manager }) => {
    manager.initAudio = async () => 'fatal init';
    assert.equal(await manager._doReset({ saved: false }), 'fatal init');
  });

  await withAudioManager({
    electronIntegration: {
      async saveAudioPreferences(prefs) {
        prefs.savedInWeb = true;
      }
    }
  }, async ({ manager }) => {
    manager.initAudio = async () => 'fatal init';
    const prefs = { savedInWeb: false };
    assert.equal(await manager._doReset(prefs), 'fatal init');
    assert.equal(prefs.savedInWeb, true);
  });

  await withAudioManager({}, async ({ manager }) => {
    manager.initAudio = async () => `${MIC_DENIED_PREFIX}: denied`;
    manager.initializeAudioWorklet = async () => 'worklet failed';
    assert.equal(await manager._doReset(), 'worklet failed');
  });

  // Mic denial during a reset is non-fatal: the reset succeeds and file
  // playback keeps working.
  await withAudioManager({}, async ({ manager }) => {
    manager.initAudio = async () => `${MIC_DENIED_PREFIX}: denied`;
    manager.initializeAudioWorklet = async () => '';
    manager.rebuildPipeline = async () => '';
    manager._notifyAudioGraphRebuilt = async () => {};
    manager.fadeInOutput = () => {};
    assert.equal(await manager._doReset(), '');
  });

  await withAudioManager({}, async ({ manager }) => {
    manager.initAudio = async () => '';
    manager.initializeAudioWorklet = async () => '';
    manager.rebuildPipeline = async () => 'pipeline failed';
    assert.equal(await manager._doReset(), 'pipeline failed');
  });

  const resetPublicationOrder = [];
  await withAudioManager({
    uiManager: {
      audioPlayer: {
        contextManager: {
          async handleAudioGraphRebuilt(payload) {
            resetPublicationOrder.push('player-source-rebound');
            payload.rebound = true;
          }
        }
      }
    }
  }, async ({ manager }) => {
    const events = [];
    manager.waitForDspActivationBeforeOutput = async () => {
      resetPublicationOrder.push('dsp-ready');
    };
    manager.fadeInOutput = () => resetPublicationOrder.push('output-unmuted');
    manager.addEventListener('audioGraphRebuilt', data => events.push(data));
    assert.equal(await manager._doReset(), '');
    assert.equal(events.length, 1);
    assert.deepEqual(resetPublicationOrder, [
      'dsp-ready',
      'player-source-rebound',
      'output-unmuted'
    ]);
  });

  await withAudioManager({
    uiManager: {
      audioPlayer: {
        contextManager: {
          async handleAudioGraphRebuilt() {
            throw new Error('rebind failed');
          }
        }
      }
    }
  }, async ({ manager }) => {
    await manager._notifyAudioGraphRebuilt();
  });
});


test('reset under intentional suspension notifies the controller when the new context starts running', async () => {
  await withAudioManager({}, async ({ calls, manager }) => {
    manager.initAudio = async () => '';
    manager.initializeAudioWorklet = async () => '';
    manager.rebuildPipeline = async () => '';
    manager._notifyAudioGraphRebuilt = async () => {};
    manager.fadeInOutput = () => {};
    const stateChanges = [];
    manager.powerPolicyController = {
      enabled: true,
      getEffectiveState: () => 'SUSPENDED',
      suspendCause: 'no-route',
      handleContextStateChange: payload => stateChanges.push(payload)
    };
    manager.contextManager.audioContext.state = 'running';
    manager.contextManager.resumeForPowerPolicy = async () => {
      calls.push(['context.resumeForPowerPolicy']);
    };
    assert.equal(await manager._doReset(), '');
    assert.deepEqual(stateChanges, [{ state: 'running' }]);
    assert.equal(calls.some(call => call[0] === 'context.resumeForPowerPolicy'), false);
    assert.equal(calls.some(call => call[0] === 'context.resumeAudioContext'), false);
  });

  await withAudioManager({}, async ({ manager }) => {
    manager.initAudio = async () => '';
    manager.initializeAudioWorklet = async () => '';
    manager.rebuildPipeline = async () => '';
    manager._notifyAudioGraphRebuilt = async () => {};
    manager.fadeInOutput = () => {};
    const stateChanges = [];
    manager.powerPolicyController = {
      enabled: true,
      getEffectiveState: () => 'SUSPENDED',
      suspendCause: 'no-route',
      handleContextStateChange: payload => stateChanges.push(payload)
    };
    manager.contextManager.audioContext.state = 'suspended';
    assert.equal(await manager._doReset(), '');
    assert.deepEqual(stateChanges, []);
  });
});

test('Web input None switches locally only while pipeline configuration is unchanged', async () => {
  const storedMicrophone = {
    inputDeviceId: 'microphone-a',
    inputDeviceLabel: 'Original microphone label',
    outputDeviceId: 'default',
    outputDeviceLabel: 'Original output label'
  };
  const silentWithEquivalentDefaults = {
    inputDeviceId: NO_AUDIO_INPUT_DEVICE_ID,
    inputDeviceLabel: '',
    outputDeviceLabel: 'Updated output label'
  };
  const integration = { audioPreferences: storedMicrophone };

  await withAudioManager({
    electronIntegration: integration,
    storedAudioPreferences: storedMicrophone
  }, async ({ calls, manager, storageValues, windowObject }) => {
    windowObject.audioPreferences = storedMicrophone;
    const audioContext = manager.contextManager.audioContext;
    const workletNode = manager.contextManager.workletNode;
    let preferencesAtRequest = null;
    const selection = installSilentInputSelection(manager, calls, {
      inputConfigRevision: 41,
      beforeRequest() {
        preferencesAtRequest = {
          stored: JSON.parse(storageValues.get('effetune_audio_preferences')),
          window: windowObject.audioPreferences,
          integration: windowObject.electronIntegration.audioPreferences
        };
      }
    });
    manager._doReset = async () => {
      calls.push(['manager._doReset']);
      return 'unexpected graph reset';
    };

    assert.equal(await manager.reset(silentWithEquivalentDefaults), '');
    assert.deepEqual(selection.requestedRevisions, [42]);
    assert.deepEqual(preferencesAtRequest, {
      stored: silentWithEquivalentDefaults,
      window: silentWithEquivalentDefaults,
      integration: silentWithEquivalentDefaults
    });
    assert.equal(calls.some(call => call[0] === 'manager._doReset'), false);
    assert.equal(manager.contextManager.audioContext, audioContext);
    assert.equal(manager.contextManager.workletNode, workletNode);
    assert.equal(manager.ioManager.inputSourceNode, null);
    assert.equal(manager.ioManager.silentInputGainNode, selection.silentSource);
    assert.deepEqual(
      JSON.parse(storageValues.get('effetune_audio_preferences')),
      silentWithEquivalentDefaults
    );
    assert.equal(windowObject.audioPreferences, silentWithEquivalentDefaults);
    assert.equal(windowObject.electronIntegration.audioPreferences, silentWithEquivalentDefaults);
  });

  await withAudioManager({}, async ({ calls, manager, storageValues }) => {
    const silentFromDefault = {
      inputDeviceId: NO_AUDIO_INPUT_DEVICE_ID,
      inputDeviceLabel: ''
    };
    const selection = installSilentInputSelection(manager, calls);
    manager._doReset = async () => {
      calls.push(['manager._doReset']);
      return 'unexpected graph reset';
    };

    assert.equal(await manager.reset(silentFromDefault), '');
    assert.deepEqual(selection.requestedRevisions, [11]);
    assert.equal(calls.some(call => call[0] === 'manager._doReset'), false);
    assert.deepEqual(
      JSON.parse(storageValues.get('effetune_audio_preferences')),
      silentFromDefault
    );
  });

  await withAudioManager({
    electronIntegration: { audioPreferences: storedMicrophone },
    storedAudioPreferences: storedMicrophone
  }, async ({ calls, manager, storageValues, windowObject }) => {
    windowObject.audioPreferences = storedMicrophone;
    const storedBefore = storageValues.get('effetune_audio_preferences');
    let storedAtRequest = null;
    const selection = installSilentInputSelection(manager, calls, {
      requestResult: false,
      failureMessage: 'injected silent selection failure',
      beforeRequest() {
        storedAtRequest = storageValues.get('effetune_audio_preferences');
      }
    });
    manager._doReset = async () => {
      calls.push(['manager._doReset']);
      return 'unexpected graph reset';
    };

    assert.match(
      await manager.reset(silentWithEquivalentDefaults),
      /injected silent selection failure/
    );
    assert.deepEqual(selection.requestedRevisions, [11]);
    assert.deepEqual(JSON.parse(storedAtRequest), silentWithEquivalentDefaults);
    assert.equal(calls.some(call => call[0] === 'manager._doReset'), false);
    assert.equal(storageValues.get('effetune_audio_preferences'), storedBefore);
    assert.deepEqual(windowObject.audioPreferences, storedMicrophone);
    assert.deepEqual(windowObject.electronIntegration.audioPreferences, storedMicrophone);
    assert.equal(manager.ioManager.inputSourceNode, selection.liveSource);
  });

  await withAudioManager({
    electronIntegration: { audioPreferences: storedMicrophone },
    storedAudioPreferences: storedMicrophone
  }, async ({ calls, manager, storageValues, windowObject }) => {
    windowObject.audioPreferences = storedMicrophone;
    const selection = installSilentInputSelection(manager, calls, {
      requestResult: false,
      applyBeforeFailure: true,
      failureMessage: 'bookkeeping failed after physical handoff'
    });
    manager._doReset = async () => 'unexpected graph reset';

    assert.equal(await manager.reset(silentWithEquivalentDefaults), '');
    assert.deepEqual(selection.requestedRevisions, [11]);
    assert.deepEqual(
      JSON.parse(storageValues.get('effetune_audio_preferences')),
      silentWithEquivalentDefaults
    );
    assert.equal(windowObject.audioPreferences, silentWithEquivalentDefaults);
    assert.equal(manager.ioManager.inputSourceNode, null);
    assert.equal(manager.ioManager.silentInputGainNode, selection.silentSource);
    assert.equal(calls.some(call => call[0] === 'power.requestReconcile'), true);
  });

  await withAudioManager({
    storedAudioPreferences: {
      ...storedMicrophone,
      sampleRate: 48000
    }
  }, async ({ calls, manager }) => {
    const selection = installSilentInputSelection(manager, calls);
    const graphChangingPreferences = {
      ...silentWithEquivalentDefaults,
      sampleRate: 96000
    };
    manager._doReset = async preferences => {
      calls.push(['manager._doReset', preferences]);
      return '';
    };

    assert.equal(await manager.reset(graphChangingPreferences), '');
    assert.deepEqual(selection.requestedRevisions, []);
    assert.deepEqual(
      calls.filter(call => call[0] === 'manager._doReset'),
      [['manager._doReset', graphChangingPreferences]]
    );
  });
});

test('fades output with scheduled ramps and immediate fallbacks', async () => {
  await withAudioManager({}, async ({ calls, manager }) => {
    manager.fadeInOutput(0.1);
    const firstToken = manager.fadeOutOutput(0.2);
    const secondToken = manager.fadeOutOutput(0.2);
    const fadeInRamps = () => calls.filter(call => call[0] === 'param.ramp' && call[2] === 1).length;
    const fadeInCount = fadeInRamps();
    assert.ok(secondToken > firstToken);
    assert.equal(manager.fadeInOutputForToken(firstToken, 0.1), false);
    assert.equal(fadeInRamps(), fadeInCount);
    assert.equal(manager.fadeInOutputForToken(secondToken, 0.1), true);
    assert.equal(fadeInRamps(), fadeInCount + 1);
    assert.equal(calls.some(call => call[0] === 'param.ramp' && call[2] === 1), true);
    assert.equal(calls.some(call => call[0] === 'param.ramp' && call[2] === 0), true);

    const owner = manager.fadeOutOutputWithOwner(0);
    assert.equal(manager.fadeInOutputForOwner(owner, 0), true);
    const staleOwner = manager.fadeOutOutputWithOwner(0);
    manager.ioManager.outputGainNode = new FakeNode('replacement-output', calls, {
      gain: new FakeAudioParam('replacement-output.gain', calls)
    });
    manager._advanceAudioGraphGeneration();
    assert.equal(manager.fadeInOutputForOwner(staleOwner, 0), false);
    assert.equal(manager.ioManager.outputGainNode.gain.value, 1);
  });

  await withAudioManager({ audioContext: null }, async ({ manager }) => {
    manager.fadeInOutput();
    manager.fadeOutOutput();
  });

  await withAudioManager({ outputGainParamOptions: { throwSchedule: true } }, async ({ manager }) => {
    manager.fadeInOutput();
    assert.equal(manager.ioManager.outputGainNode.gain.value, 1);
    manager.fadeOutOutput();
    assert.equal(manager.ioManager.outputGainNode.gain.value, 0);
  });

  await withAudioManager({ outputGainParamOptions: { throwSchedule: true, throwValueSet: true } }, async ({ manager }) => {
    manager.fadeInOutput();
    manager.fadeOutOutput();
  });
});

test('builds, routes, selects, and disables parallel blind-test pipelines', async () => {
  await withAudioManager({}, async ({ calls, manager }) => {
    assert.equal(manager.isParallelActive(), false);
    assert.deepEqual(manager._buildBlindPluginData(null), []);
    const blindData = manager._buildBlindPluginData([
      createPlugin('SectionPlugin', { enabled: false, calls }),
      createPlugin('AlphaPlugin', { id: 'blind-alpha', inputBus: 1, outputBus: 2, channel: 'L', calls })
    ]);
    assert.equal(blindData[1].sampleRate, undefined);
    assert.equal(blindData[1].parameters.sampleRate, 48000);

    manager._registerProcessorsOnWorklet(null, [manager.pipelineA]);
    const workletForDirectRegistration = createWorkletNode('extraWorklet', calls);
    const directNoProcess = createPlugin('BetaPlugin', { id: 'direct-no-process', calls });
    directNoProcess.process = null;
    manager._registerProcessorsOnWorklet(workletForDirectRegistration, [
      null,
      [null],
      [Object.create(null), createPlugin('MissingProcessorPlugin', { id: 'direct-missing', calls }), directNoProcess, directNoProcess]
    ]);
    manager._postBlindPlugins(null, manager.pipelineA);

    assert.equal(await manager.enableParallelPipelines('B'), true);
    assert.equal(manager.isParallelActive(), true);
    assert.equal(manager._parallelSelection, 'B');
    manager._parallelWorkletB.port.onmessage({ data: { ignored: true } });
    assert.equal(calls.some(call => call[0] === 'newAudioWorkletNode'), true);
    assert.equal(calls.some(call => call[0] === 'postMessage' && call[2].type === 'updatePlugins'), true);

    assert.equal(await manager.enableParallelPipelines('A'), true);
    assert.equal(manager._parallelSelection, 'A');

    const source = new FakeNode('playerSource', calls);
    assert.equal(manager.connectSourceToPipeline(source), true);
    const partialFailure = new FakeNode('partialFailure', calls);
    const originalConnect = partialFailure.connect.bind(partialFailure);
    partialFailure.connect = target => {
      if (target === manager._parallelInputTap) throw new Error('parallel input failed');
      return originalConnect(target);
    };
    assert.equal(manager.connectSourceToPipeline(partialFailure), false);
    assert.equal(manager.isSourceConnectedToPipeline(partialFailure), false);
    assert.deepEqual(partialFailure.connections, []);
    assert.ok(calls.filter(call => call[0] === 'disconnect' &&
      call[1] === 'partialFailure').length >= 2);
    manager.setBlindSelection('B', 0.04);
    assert.equal(manager._parallelSelection, 'B');
    manager.disableParallelPipelines();
    assert.equal(manager.isParallelActive(), false);
    assert.equal(manager.connectSourceToPipeline(null), false);
  });

  await withAudioManager({ audioContextOptions: { channelCount: 0, sampleRate: undefined } }, async ({ manager }) => {
    assert.equal(await manager.enableParallelPipelines('A'), true);
    manager.pipelineB = null;
    manager._applyParallelRouting();
    manager.contextManager.audioContext = null;
    assert.equal(manager._buildBlindPluginData([createPlugin('AlphaPlugin')])[0].parameters.sampleRate, null);
    manager.setBlindSelection('A');
  });

  await withAudioManager({ audioContext: null }, async ({ manager }) => {
    assert.equal(await manager.enableParallelPipelines(), false);
  });

  await withAudioManager({ audioWorkletNodeOptions: { throwConstructor: true } }, async ({ manager }) => {
    assert.equal(await manager.enableParallelPipelines(), false);
    assert.equal(manager.isParallelActive(), false);
  });

  await withAudioManager({}, async ({ manager }) => {
    manager._parallelActive = true;
    manager._parallelWorkletB = null;
    manager._applyParallelRouting();
    manager._parallelActive = false;
    manager._applyParallelRouting();
    manager.setBlindSelection('A');
  });
});

test('parallel routing rejects source connection failures and tolerates ramp assignment failures', async () => {
  await withAudioManager({
    sourceNodeOptions: { throwDisconnect: true, throwConnect: true },
    workletNodeOptions: { throwDisconnect: true },
    audioContextOptions: { gainNodeOptions: { throwDisconnect: true } },
    audioWorkletNodeOptions: { nodeOptions: { throwDisconnect: true } }
  }, async ({ manager }) => {
    assert.equal(await manager.enableParallelPipelines('A'), false);
    assert.equal(manager.isParallelActive(), false);
    assert.equal(manager.isParallelProcessing(), false);
    assert.equal(manager._hasParallelResources(), false);
    manager.contextManager.workletNode.options.throwConnect = true;
    const badNode = new FakeNode('badSource', [], { throwConnect: true });
    assert.equal(manager.connectSourceToPipeline(badNode), false);
  });

  await withAudioManager({ audioContextOptions: { gainParamOptions: { throwSchedule: true } } }, async ({ manager }) => {
    await manager.enableParallelPipelines('A');
    manager.setBlindSelection('B');
    assert.equal(manager._parallelSelA.gain.value, 0);
    assert.equal(manager._parallelSelB.gain.value, 1);
  });

  await withAudioManager({ audioContextOptions: { gainParamOptions: { throwSchedule: true } } }, async ({ manager }) => {
    await manager.enableParallelPipelines('A');
    manager._parallelSelA.gain.options.throwValueSet = true;
    manager._parallelSelB.gain.options.throwValueSet = true;
    manager.setBlindSelection('B');
  });

  await withAudioManager({}, async ({ manager }) => {
    manager.contextManager.workletNode = null;
    manager.workletNode = createWorkletNode('fallbackWorklet', []);
    const source = new FakeNode('fallbackSource', []);
    assert.equal(manager.connectSourceToPipeline(source), true);
  });

  await withAudioManager({
    isFirstLaunch: true,
    originalConnectMethod(target) {
      this.calls.push(['originalConnect', this.name, target.name]);
      this.connections.push(target);
    }
  }, async ({ calls, manager }) => {
    const source = new FakeNode('firstLaunchSource', calls);
    assert.equal(manager.connectSourceToPipeline(source), true);
    assert.equal(calls.some(call => call[0] === 'originalConnect' &&
      call[1] === 'firstLaunchSource' && call[2] === 'workletA'), true);
  });

  await withAudioManager({}, async ({ manager }) => {
    const source = manager.ioManager.sourceNode;
    const primary = manager.contextManager.workletNode;
    assert.equal(manager.connectSourceToPipeline(source), true);
    const connect = source.connect.bind(source);
    source.connect = target => {
      if (target === manager._parallelInputTap) {
        throw new Error('parallel tap unavailable');
      }
      return connect(target);
    };

    assert.equal(await manager.enableParallelPipelines('A'), false);
    assert.equal(source.connections.includes(primary), true);
    assert.equal(manager.isSourceConnectedToPipeline(source), true);
  });
});

test('sets pipeline, master bypass, offline processing, encoding, and event facade methods', async () => {
  await withAudioManager({}, async ({ calls, manager }) => {
    const nextPipeline = [createPlugin('AlphaPlugin', { id: 'new', calls })];
    const rebuildPromise = manager.setPipeline(nextPipeline);
    assert.equal(typeof rebuildPromise.then, 'function');
    await rebuildPromise;

    calls.length = 0;
    manager.workletNode = manager.contextManager.workletNode;
    await manager.setPipeline([createPlugin('AlphaPlugin', { id: 'new', enabled: true, calls })]);
    assert.equal(calls.some(call => call[0] === 'postMessage' && call[2].type === 'updatePlugins'), true);

    manager.workletNode = null;
    await manager.setPipeline(manager.pipeline);
    await manager.setPipeline('not a pipeline');
    await manager.setPipeline(undefined);

    manager.contextManager.audioContext = null;
    manager.workletNode = manager.contextManager.workletNode = createWorkletNode('workletNoSampleRate', calls);
    await manager.setPipeline(manager.pipeline);
    manager.pipeline = null;
    await manager.setPipeline([createPlugin('AlphaPlugin', { id: 'after-null-current', calls })]);

    await manager.setMasterBypass(true);
    assert.equal(manager.masterBypass, true);
    calls.length = 0;
    await manager.setMasterBypass(true);
    assert.equal(calls.length, 0);

    const processed = await manager.processAudioFile({ name: 'input.wav' }, progress => progress);
    assert.deepEqual(processed, { type: 'audio/wav' });
    manager.cancelProcessing();
    assert.equal(manager.isCancelled, true);
    assert.deepEqual(manager.encodeWAV({ duration: 1 }), { wav: true, audioBuffer: { duration: 1 } });

    const received = [];
    const listener = data => received.push(data);
    manager.addEventListener('custom', listener);
    manager.dispatchEvent('custom', { ok: true });
    manager.removeEventListener('custom', listener);
    manager.dispatchEvent('custom', { ok: false });
    assert.deepEqual(received, [{ ok: true }]);
  });

  await withAudioManager({ throwOfflineProcess: true }, async ({ manager }) => {
    await assert.rejects(() => manager.processAudioFile({ name: 'bad.wav' }), /offline failed/);
  });
});
