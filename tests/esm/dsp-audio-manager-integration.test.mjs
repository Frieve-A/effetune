import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioManager } from '../../js/audio-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function createPort() {
  return {
    messages: [],
    onmessage: null,
    postMessage(message, transfer = []) {
      this.messages.push({ message, transfer });
    }
  };
}

function createNode(name) {
  return {
    name,
    port: createPort(),
    connections: [],
    connect(target) {
      this.connections.push(target);
      return target;
    },
    disconnect(target) {
      this.connections = target === undefined
        ? []
        : this.connections.filter(connection => connection !== target);
    }
  };
}

function createManager() {
  const manager = Object.create(AudioManager.prototype);
  manager.dspModuleInfo = null;
  manager.dspCapabilities = null;
  manager._dspReadyFallbacks = new Map();
  manager._dspCapabilitiesByNode = new Map();
  manager._dspReadyTokens = new Map();
  manager._pendingDspActivationRequests = new Map();
  manager._dspReadyTransitionPromise = null;
  manager._dspTransitionGeneration = -1;
  manager._audioGraphGeneration = 1;
  manager._primaryWorkletEpoch = 1;
  manager._outputFadeToken = 0;
  manager._parallelDspBarrier = null;
  manager._parallelPreparing = false;
  manager._connectedPipelineSources = new Set();
  manager._dspModuleLoadPromise = null;
  manager._dspModuleLoadRequest = null;
  manager._dspModuleLoadRequestSequence = 0;
  manager.masterBypass = false;
  manager.pipelineA = [];
  manager.pipelineB = [];
  manager.pipeline = manager.pipelineA;
  manager.currentPipeline = 'A';
  manager.telemetryHub = { handleMessage() {}, setPort() {} };
  manager.dispatchEvent = () => {};
  return manager;
}

class VolumePlugin {
  constructor(id, branch) {
    this.id = id;
    this.branch = branch;
    this.enabled = true;
    this.inputBus = 0;
    this.outputBus = 0;
    this.channel = null;
    this.processorString = 'return data;';
  }
  getParameters() {
    return { branch: this.branch };
  }
}

function configureParallelManager(manager, mainWorklet) {
  let gainIndex = 0;
  const output = createNode('output');
  output.gain = { value: 1 };
  const context = {
    currentTime: 1,
    destination: { channelCount: 2 },
    createGain() {
      const node = createNode(`gain-${++gainIndex}`);
      node.gain = { value: 1 };
      return node;
    }
  };
  manager.workletNode = mainWorklet;
  manager.contextManager = { audioContext: context, workletNode: mainWorklet, lowLatencyMode: false };
  manager.ioManager = { outputGainNode: output, sourceNode: null };
  manager.pipelineA = [new VolumePlugin(1, 'A')];
  manager.pipelineB = [new VolumePlugin(2, 'B')];
  manager.pipeline = manager.pipelineA;
  manager.pipelineProcessor = {
    prepareSectionAwarePluginData() {
      return [{ id: 1, type: 'VolumePlugin', parameters: { branch: 'A' } }];
    }
  };
  manager.fadeOutOutput = () => ++manager._outputFadeToken;
  manager.fadeInOutput = () => {};
  manager._waitForDspTransition = async () => {};
  return { context, output };
}

function createFakeAudioWorkletClass(createdWorklets) {
  return class FakeAudioWorkletNode {
    constructor(context, name, options) {
      this.context = context;
      this.name = name;
      this.options = options;
      this.port = createPort();
      this.connections = [];
      createdWorklets.push(this);
    }
    connect(target) {
      this.connections.push(target);
      return target;
    }
    disconnect() {
      this.connections = [];
    }
  };
}

function messageOf(port, type) {
  return port.messages.find(entry => entry.message.type === type);
}

test('AudioManager worklet startup does not wait for optional DSP loading', async () => {
  const warnings = [];
  await withGlobals({
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: {} },
    document: { hidden: false },
    console: { warn(message) { warnings.push(message); } }
  }, async () => {
    const manager = createManager();
    const node = createNode('main');
    manager.workletNode = node;
    manager.contextManager = {
      workletNode: node,
      async loadAudioWorklet() { return ''; }
    };
    manager.updateExposedProperties = () => {};
    manager.registerPipelineProcessors = () => {};
    manager.loadDspForWorklet = () => new Promise(() => {});

    assert.equal(await manager.initializeAudioWorklet(), '');
    assert.equal(manager.dspModuleInfo, null);

    const rejectedManager = createManager();
    const rejectedNode = createNode('rejected');
    rejectedManager.workletNode = rejectedNode;
    rejectedManager.contextManager = {
      workletNode: rejectedNode,
      async loadAudioWorklet() { return ''; }
    };
    rejectedManager.updateExposedProperties = () => {};
    rejectedManager.registerPipelineProcessors = () => {};
    rejectedManager.loadDspForWorklet = async () => { throw new Error('load rejected'); };

    assert.equal(await rejectedManager.initializeAudioWorklet(), '');
    for (let index = 0; index < 6; index++) await Promise.resolve();
    assert.equal(rejectedManager.dspModuleInfo, null);
    assert.ok(warnings.some(message => message.includes('load rejected')));
  });
});

test('AudioManager starts a delayed DSP module only on the worklet that requested it', async () => {
  await withGlobals({
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: {} },
    document: { hidden: false }
  }, async () => {
    const info = {
      module: { compiled: true },
      bytes: null,
      simd: false,
      meta: { kernels: [] },
      paramPackers: new Map()
    };

    for (const replaceBeforeResolve of [false, true]) {
      const manager = createManager();
      const requestedNode = createNode('requested');
      let resolveDsp;
      manager.workletNode = requestedNode;
      manager.contextManager = {
        workletNode: requestedNode,
        async loadAudioWorklet() { return ''; }
      };
      manager.updateExposedProperties = () => {};
      manager.registerPipelineProcessors = () => {};
      manager.loadDspForWorklet = () => new Promise(resolve => { resolveDsp = resolve; });
      const starts = [];
      manager.startDspOnWorklet = node => starts.push(node);

      assert.equal(await manager.initializeAudioWorklet(), '');
      if (replaceBeforeResolve) {
        const replacement = createNode('replacement');
        manager.workletNode = replacement;
        manager.contextManager.workletNode = replacement;
      }
      resolveDsp(info);
      for (let index = 0; index < 6; index++) await Promise.resolve();

      assert.deepEqual(starts, replaceBeforeResolve ? [] : [requestedNode]);
      assert.equal(manager.dspModuleInfo, replaceBeforeResolve ? null : info);
    }
  });
});

test('AudioManager applies only the newest primary DSP load when requests resolve in reverse', async () => {
  await withGlobals({
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: {} },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const oldNode = createNode('old');
    const newNode = createNode('new');
    const resolvers = [];
    const starts = [];
    manager.workletNode = oldNode;
    manager.contextManager = {
      workletNode: oldNode,
      async loadAudioWorklet() { return ''; }
    };
    manager.updateExposedProperties = () => {};
    manager.registerPipelineProcessors = () => {};
    manager.loadDspForWorklet = () => new Promise(resolve => resolvers.push(resolve));
    manager.startDspOnWorklet = node => {
      starts.push({ node, info: manager.dspModuleInfo });
      return true;
    };

    assert.equal(await manager.initializeAudioWorklet(), '');
    const oldLoad = manager._dspModuleLoadPromise;
    manager.workletNode = newNode;
    manager.contextManager.workletNode = newNode;
    assert.equal(await manager.initializeAudioWorklet(), '');
    const newLoad = manager._dspModuleLoadPromise;
    assert.notEqual(newLoad, oldLoad);
    assert.equal(resolvers.length, 2);

    const oldInfo = { module: { version: 'old' }, bytes: null, meta: {}, paramPackers: new Map() };
    const newInfo = { module: { version: 'new' }, bytes: null, meta: {}, paramPackers: new Map() };
    resolvers[1](newInfo);
    assert.equal(await newLoad, true);
    assert.equal(manager.dspModuleInfo, newInfo);
    assert.deepEqual(starts, [{ node: newNode, info: newInfo }]);

    resolvers[0](oldInfo);
    assert.equal(await oldLoad, false);
    assert.equal(manager.dspModuleInfo, newInfo);
    assert.deepEqual(starts, [{ node: newNode, info: newInfo }]);
  });
});

test('AudioManager prunes ready tokens retained by an inactive primary worklet', async () => {
  await withGlobals({ window: {} }, async () => {
    const manager = createManager();
    const oldNode = createNode('old');
    const currentNode = createNode('current');
    manager.workletNode = currentNode;
    manager.contextManager = { workletNode: currentNode };
    manager._dspReadyTokens.set(oldNode, 3);
    manager._dspReadyTokens.set(currentNode, 5);

    manager._pruneInactiveDspWorklets();

    assert.equal(manager._dspReadyTokens.has(oldNode), false);
    assert.equal(manager._dspReadyTokens.get(currentNode), 5);
  });
});

test('AudioManager starts delayed DSP on every active parallel worklet', async () => {
  await withGlobals({
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: {} },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    const auxiliary = createNode('auxiliary');
    let resolveDsp;
    manager.workletNode = main;
    manager.contextManager = {
      workletNode: main,
      async loadAudioWorklet() { return ''; }
    };
    manager.updateExposedProperties = () => {};
    manager.registerPipelineProcessors = () => {};
    manager.loadDspForWorklet = () => new Promise(resolve => { resolveDsp = resolve; });

    assert.equal(await manager.initializeAudioWorklet(), '');
    manager._parallelActive = true;
    manager._parallelWorkletB = auxiliary;
    const info = {
      module: null,
      bytes: Uint8Array.of(0, 97, 115, 109).buffer,
      simd: false,
      meta: { kernels: [] },
      paramPackers: new Map()
    };
    resolveDsp(info);
    for (let index = 0; index < 6; index++) await Promise.resolve();

    assert.equal(manager.dspModuleInfo, info);
    assert.ok(messageOf(main.port, 'dspModule'));
    assert.ok(messageOf(auxiliary.port, 'dspModule'));
    assert.equal(manager._dspReadyFallbacks.has(main), true);
    assert.equal(manager._dspReadyFallbacks.has(auxiliary), true);
    manager.clearDspReadyFallback();
  });
});

test('AudioManager ignores delayed messages from a replaced primary worklet', async () => {
  await withGlobals({
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: {} },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const oldNode = createNode('old');
    const replacement = createNode('replacement');
    manager.workletNode = oldNode;
    manager.contextManager = {
      workletNode: oldNode,
      async loadAudioWorklet() { return ''; }
    };
    manager.updateExposedProperties = () => {};
    manager.registerPipelineProcessors = () => {};
    manager.loadDspForWorklet = () => new Promise(() => {});
    manager.pipelineProcessor = { prepareSectionAwarePluginData: () => [] };

    assert.equal(await manager.initializeAudioWorklet(), '');
    const delayedHandler = oldNode.port.onmessage;
    manager.workletNode = replacement;
    manager.contextManager.workletNode = replacement;
    delayedHandler({ data: { type: 'dspReady', abiVersion: 1, kernels: [], simd: false } });

    assert.equal(manager.dspCapabilities, null);
    assert.equal(messageOf(replacement.port, 'updatePlugins'), undefined);
    assert.equal(messageOf(oldNode.port, 'updatePlugins'), undefined);
  });
});

test('AudioManager delivers compiled modules or cloned bytes with rollout and telemetry controls', async () => {
  await withGlobals({
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: {} },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const module = { compiled: true };
    manager.dspModuleInfo = {
      module,
      bytes: null,
      simd: true,
      meta: { kernels: [{ name: 'VolumePlugin', hash: 0x1234 }] },
      paramPackers: new Map([['VolumePlugin', { hash: 0x1234, pack() { return Float32Array.of(1); } }]])
    };
    const moduleNode = createNode('module');
    assert.equal(manager.postDspModuleToWorklet(moduleNode), true);
    assert.equal(moduleNode.port.messages.length, 3);
    assert.deepEqual(
      moduleNode.port.messages.map(entry => entry.message.type),
      ['dspModule', 'dspEnableTypes', 'dspSetTelemetryRate']
    );
    assert.equal(messageOf(moduleNode.port, 'dspModule').message.module, module);
    assert.equal(messageOf(moduleNode.port, 'dspModule').message.simd, true);
    assert.deepEqual(messageOf(moduleNode.port, 'dspEnableTypes').message.types, []);
    assert.equal(messageOf(moduleNode.port, 'dspSetTelemetryRate').message.hz, 60);

    const bytes = Uint8Array.of(0, 97, 115, 109).buffer;
    manager.dspModuleInfo = { ...manager.dspModuleInfo, module: null, bytes, simd: false };
    globalThis.document.hidden = true;
    const bytesNode = createNode('bytes');
    assert.equal(manager.postDspModuleToWorklet(bytesNode), true);
    const delivered = messageOf(bytesNode.port, 'dspModule').message.bytes;
    assert.notEqual(delivered, bytes);
    assert.deepEqual([...new Uint8Array(delivered)], [...new Uint8Array(bytes)]);
    assert.equal(messageOf(bytesNode.port, 'dspSetTelemetryRate').message.hz, 15);
    assert.equal(manager.postDspModuleToWorklet(null), false);
  });
});

test('AudioManager retries module DataCloneError with retained bytes and rethrows other post failures', async () => {
  await withGlobals({
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: {} },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const bytes = Uint8Array.of(0, 97, 115, 109).buffer;
    manager.dspModuleInfo = {
      module: { compiled: true },
      bytes,
      moduleCloneable: true,
      simd: true,
      meta: { kernels: [{ name: 'VolumePlugin', hash: 0x1234 }] },
      paramPackers: new Map([['VolumePlugin', { hash: 0x1234, pack() { return Float32Array.of(1); } }]])
    };

    const fallbackNode = createNode('fallback');
    const recordMessage = fallbackNode.port.postMessage.bind(fallbackNode.port);
    let moduleAttempts = 0;
    fallbackNode.port.postMessage = (message, transfer = []) => {
      if (message.type === 'dspModule' && message.module) {
        moduleAttempts++;
        const error = new Error('worklet cannot clone modules');
        error.name = 'DataCloneError';
        throw error;
      }
      recordMessage(message, transfer);
    };

    assert.equal(manager.postDspModuleToWorklet(fallbackNode), true);
    assert.equal(moduleAttempts, 1);
    const delivered = messageOf(fallbackNode.port, 'dspModule').message.bytes;
    assert.notEqual(delivered, bytes);
    assert.deepEqual([...new Uint8Array(delivered)], [...new Uint8Array(bytes)]);
    assert.ok(messageOf(fallbackNode.port, 'dspEnableTypes'));
    assert.ok(messageOf(fallbackNode.port, 'dspSetTelemetryRate'));

    const failedNode = createNode('failed');
    const postError = new Error('port closed');
    failedNode.port.postMessage = () => { throw postError; };
    assert.throws(() => manager.postDspModuleToWorklet(failedNode), error => error === postError);
    assert.equal(failedNode.port.messages.length, 0);
  });
});

test('AudioManager retries an unacknowledged compiled module with retained bytes', async () => {
  await withGlobals({
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: {} },
    document: { hidden: false }
  }, async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timers = new Map();
    let nextTimer = 1;
    globalThis.setTimeout = callback => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    };
    globalThis.clearTimeout = id => timers.delete(id);
    try {
      const manager = createManager();
      const bytes = Uint8Array.of(0, 97, 115, 109).buffer;
      manager.dspModuleInfo = {
        module: { compiled: true },
        bytes,
        moduleCloneable: true,
        simd: true,
        meta: { kernels: [] },
        paramPackers: new Map()
      };
      const node = createNode('main');
      manager.workletNode = node;
      manager.contextManager = { workletNode: node };

      manager.postDspModuleToWorklet(node);
      manager.armDspReadyFallback(node);
      assert.equal(node.port.messages.filter(entry => entry.message.type === 'dspModule').length, 1);

      const moduleTimer = manager._dspReadyFallbacks.get(node).moduleTimer;
      const runModuleTimer = timers.get(moduleTimer);
      timers.delete(moduleTimer);
      runModuleTimer();
      const moduleMessages = node.port.messages.filter(entry => entry.message.type === 'dspModule');
      assert.equal(moduleMessages.length, 2);
      assert.ok(moduleMessages[1].message.bytes instanceof ArrayBuffer);
      assert.notEqual(moduleMessages[1].message.bytes, bytes);
      assert.equal(manager.dspModuleInfo.moduleCloneable, false);

      const ready = { type: 'dspReady', abiVersion: 1, kernels: [], simd: true };
      manager.pipelineProcessor = { prepareSectionAwarePluginData: () => [] };
      manager.handleWorkletMessage({ data: ready }, node);
      assert.equal(manager._dspReadyFallbacks.has(node), false);
      assert.equal(timers.size, 0);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});

test('AudioManager ready fallback does not trust capabilities from a replaced worklet', async () => {
  await withGlobals({
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: {} },
    document: { hidden: false }
  }, async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let readyFallback = null;
    globalThis.setTimeout = callback => {
      readyFallback = callback;
      return 1;
    };
    globalThis.clearTimeout = () => {};
    try {
      const manager = createManager();
      const oldReady = { type: 'dspReady', abiVersion: 1, kernels: [], simd: true };
      manager.dspCapabilities = oldReady;
      const bytes = Uint8Array.of(0, 97, 115, 109).buffer;
      manager.dspModuleInfo = {
        module: { compiled: true },
        bytes,
        moduleCloneable: true,
        simd: true,
        meta: { kernels: [] },
        paramPackers: new Map()
      };
      const replacement = createNode('replacement');
      manager.workletNode = replacement;
      manager.contextManager = { workletNode: replacement };

      manager.startDspOnWorklet(replacement);
      assert.equal(manager.dspCapabilities, null);
      assert.equal(globalThis.window.dspCapabilities, undefined);
      readyFallback();

      assert.equal(
        replacement.port.messages.filter(entry => entry.message.type === 'dspModule').length,
        2
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});

test('AudioManager reuses bytes immediately after module delivery was unacknowledged', async () => {
  await withGlobals({
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: {} },
    document: { hidden: false }
  }, async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let timeoutDelay = null;
    globalThis.setTimeout = (_callback, delay) => {
      timeoutDelay = delay;
      return 1;
    };
    globalThis.clearTimeout = () => {};
    try {
      const manager = createManager();
      manager.dspModuleInfo = {
        module: { compiled: true },
        bytes: Uint8Array.of(0, 97, 115, 109).buffer,
        moduleCloneable: false,
        simd: true,
        meta: { kernels: [] },
        paramPackers: new Map()
      };
      const replacement = createNode('replacement');

      manager.startDspOnWorklet(replacement);

      const moduleMessages = replacement.port.messages.filter(entry => entry.message.type === 'dspModule');
      assert.equal(moduleMessages.length, 1);
      assert.ok(moduleMessages[0].message.bytes instanceof ArrayBuffer);
      assert.equal(moduleMessages[0].message.module, undefined);
      assert.equal(timeoutDelay, 3000);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});

test('AudioManager rollout kill switches avoid loading a DSP artifact', async () => {
  await withGlobals({
    window: {
      location: { pathname: '/app/index.html', search: '?dsp=off' },
      audioPreferences: { useWasmDsp: true }
    }
  }, async () => {
    const manager = createManager();
    assert.equal(await manager.loadDspForWorklet(), null);
    globalThis.window.location.search = '';
    globalThis.window.audioPreferences.useWasmDsp = false;
    assert.equal(await manager.loadDspForWorklet(), null);
  });
});

test('AudioManager loads DSP when an explicit preference enables it at runtime', async () => {
  await withGlobals({
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: true } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const node = createNode('main');
    manager.workletNode = node;
    manager.contextManager = { workletNode: node };
    manager.audioContext = { sampleRate: 48000 };
    const info = {
      module: { compiled: true },
      bytes: null,
      simd: false,
      meta: { kernels: [] },
      paramPackers: new Map()
    };
    manager.loadDspForWorklet = async () => info;

    manager.updateAudioConfig({ outputChannels: 2, useWasmDsp: true });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(manager.dspModuleInfo, info);
    assert.ok(messageOf(node.port, 'dspModule'));
  });
});

test('AudioManager performs a full plugin resync on dspReady and routes telemetry to the hub', async () => {
  await withGlobals({ window: {} }, async () => {
    const manager = createManager();
    const preparedPlugins = [{ id: 4, type: 'VolumePlugin', wasmParams: Float32Array.of(1) }];
    let prepareCalls = 0;
    manager.pipelineProcessor = {
      prepareSectionAwarePluginData() {
        prepareCalls++;
        return preparedPlugins;
      }
    };
    manager.masterBypass = true;
    const events = [];
    manager.dispatchEvent = (type, data) => events.push({ type, data });
    const telemetry = [];
    manager.telemetryHub = { handleMessage(data) { telemetry.push(data); } };
    const node = createNode('main');
    manager.workletNode = node;
    manager.contextManager = { workletNode: node };
    const ready = { type: 'dspReady', abiVersion: 1, kernels: [{ name: 'VolumePlugin', hash: 0x1234 }] };
    manager.handleWorkletMessage({ data: ready }, node);
    await manager._dspReadyTransitionPromise;
    assert.equal(manager.dspCapabilities, ready);
    assert.equal(globalThis.window.dspCapabilities, ready);
    assert.equal(prepareCalls, 1);
    const update = messageOf(node.port, 'updatePlugins').message;
    assert.equal(update.plugins, preparedPlugins);
    assert.equal(update.masterBypass, true);
    assert.deepEqual(events, [{ type: 'dspReady', data: ready }]);

    const telemetryMessage = { type: 'dspTelemetry', packet: new ArrayBuffer(8), bytes: 0 };
    manager.handleWorkletMessage({ data: telemetryMessage }, node);
    assert.deepEqual(telemetry, [telemetryMessage]);

    const latencyMessage = {
      type: 'dspLatency',
      samples: 96,
      sampleRate: 48000,
      compensated: false
    };
    manager.handleWorkletMessage({ data: latencyMessage }, node);
    assert.equal(manager.dspPipelineLatencySamples, 96);
    assert.deepEqual(events.at(-1), {
      type: 'dspLatency',
      data: latencyMessage
    });

    manager.handleWorkletMessage({ data: { type: 'dspFailed', stage: 'runtime', error: 'trap' } }, node);
    assert.ok(messageOf(node.port, 'dspCleanupFailed'));
  });
});

test('AudioManager hides a delayed stateful DSP switch behind a bounded output transition', async () => {
  await withGlobals({ window: {} }, async () => {
    const manager = createManager();
    const node = createNode('main');
    const preparedPlugins = [{ id: 9, type: 'DelayPlugin', parameters: { feedback: 0.8 } }];
    const waits = [];
    const transitions = [];
    const events = [];
    manager.workletNode = node;
    manager.contextManager = { workletNode: node, audioContext: { currentTime: 1 } };
    manager.ioManager = { outputGainNode: { gain: {} } };
    manager.dspModuleInfo = {
      meta: { kernels: [{ name: 'DelayPlugin', hash: 0x1234 }] },
      paramPackers: new Map([['DelayPlugin', { hash: 0x1234, pack() { return Float32Array.of(1); } }]])
    };
    manager.pipelineProcessor = { prepareSectionAwarePluginData: () => preparedPlugins };
    manager.fadeOutOutput = duration => {
      transitions.push(['fadeOut', duration]);
      return ++manager._outputFadeToken;
    };
    manager.fadeInOutput = duration => transitions.push(['fadeIn', duration]);
    manager._waitForDspTransition = seconds => new Promise(resolve => {
      waits.push({ seconds, resolve });
    });
    manager.dispatchEvent = (type, data) => events.push({ type, data });
    const ready = { type: 'dspReady', abiVersion: 1, kernels: [{ name: 'DelayPlugin' }], simd: false };

    manager.handleWorkletMessage({ data: ready }, node);
    const transitionPromise = manager._dspReadyTransitionPromise;
    assert.deepEqual(transitions, [['fadeOut', 0.04]]);
    assert.equal(messageOf(node.port, 'updatePlugins'), undefined);
    assert.equal(waits[0].seconds, 0.04);

    waits.shift().resolve();
    for (let index = 0; index < 4; index++) await Promise.resolve();
    const update = messageOf(node.port, 'updatePlugins').message;
    const enableIndex = node.port.messages.findIndex(entry => entry.message.type === 'dspEnableTypes');
    const updateIndex = node.port.messages.findIndex(entry => entry.message.type === 'updatePlugins');
    assert.deepEqual(node.port.messages[enableIndex].message.types, ['DelayPlugin']);
    assert.ok(enableIndex < updateIndex);
    assert.equal(update.plugins, preparedPlugins);
    assert.deepEqual(events, [{ type: 'dspReady', data: ready }]);
    assert.equal(waits[0].seconds, 0.05);
    assert.deepEqual(transitions, [['fadeOut', 0.04]]);

    waits.shift().resolve();
    await transitionPromise;
    assert.deepEqual(transitions, [['fadeOut', 0.04], ['fadeIn', 0.04]]);
  });
});

test('AudioManager keeps physical A and B pipelines distinct when each worklet becomes DSP-ready', async () => {
  class PipelineAPlugin {
    constructor() {
      this.id = 1;
      this.enabled = true;
    }
    getParameters() { return { branch: 'A' }; }
  }
  class PipelineBPlugin {
    constructor() {
      this.id = 2;
      this.enabled = true;
    }
    getParameters() { return { branch: 'B' }; }
  }

  await withGlobals({ window: {} }, async () => {
    const manager = createManager();
    const main = createNode('main');
    const auxiliary = createNode('auxiliary');
    manager.workletNode = main;
    manager.contextManager = { workletNode: main };
    manager._parallelActive = true;
    manager._parallelWorkletB = auxiliary;
    manager.pipelineA = [new PipelineAPlugin()];
    manager.pipelineB = [new PipelineBPlugin()];
    manager.currentPipeline = 'B';
    manager.pipeline = manager.pipelineB;
    manager.pipelineProcessor = {
      prepareSectionAwarePluginData() {
        throw new Error('parallel dspReady must not use the current pipeline');
      }
    };

    const readyA = { type: 'dspReady', abiVersion: 1, kernels: [], simd: false };
    const readyB = { type: 'dspReady', abiVersion: 1, kernels: [], simd: false };
    manager.handleWorkletMessage({ data: readyA }, main);
    manager.handleWorkletMessage({ data: readyB }, auxiliary);
    await manager._parallelDspBarrier.promise;

    const updateA = messageOf(main.port, 'updatePlugins').message;
    const updateB = messageOf(auxiliary.port, 'updatePlugins').message;
    assert.equal(updateA.plugins[0].type, 'PipelineAPlugin');
    assert.equal(updateA.plugins[0].parameters.branch, 'A');
    assert.equal(updateB.plugins[0].type, 'PipelineBPlugin');
    assert.equal(updateB.plugins[0].parameters.branch, 'B');
    assert.equal(updateA.masterBypass, false);
    assert.equal(updateB.masterBypass, false);
  });
});

test('AudioManager pending primary load survives parallel preparation and starts both worklets', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: true } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    manager.contextManager.loadAudioWorklet = async () => '';
    manager.updateExposedProperties = () => {};
    let resolveDsp;
    let loadCalls = 0;
    manager.loadDspForWorklet = () => {
      loadCalls++;
      return new Promise(resolve => { resolveDsp = resolve; });
    };

    assert.equal(await manager.initializeAudioWorklet(), '');
    const initialLoad = manager._dspModuleLoadPromise;
    const runtimeLoad = manager.updateAudioConfig({ outputChannels: 2, useWasmDsp: true });
    assert.equal(runtimeLoad, initialLoad);
    assert.equal(loadCalls, 1);
    const primaryEpoch = manager._primaryWorkletEpoch;
    const enabling = manager.enableParallelPipelines('A');
    const auxiliary = createdWorklets[0];
    assert.equal(manager._primaryWorkletEpoch, primaryEpoch);
    assert.equal(messageOf(auxiliary.port, 'dspModule'), undefined);

    const info = {
      module: null,
      bytes: Uint8Array.of(0, 97, 115, 109).buffer,
      simd: false,
      meta: { kernels: [{ name: 'VolumePlugin', hash: 0x1234 }] },
      paramPackers: new Map([['VolumePlugin', { hash: 0x1234, pack() { return Float32Array.of(1); } }]])
    };
    resolveDsp(info);
    for (let index = 0; index < 8; index++) await Promise.resolve();
    assert.equal(await runtimeLoad, true);
    assert.ok(messageOf(main.port, 'dspModule'));
    assert.ok(messageOf(auxiliary.port, 'dspModule'));

    const ready = { type: 'dspReady', abiVersion: 1, kernels: [{ name: 'VolumePlugin' }], simd: false };
    main.port.onmessage({ data: ready });
    auxiliary.port.onmessage({ data: ready });
    assert.equal(await enabling, true);
    assert.equal(manager._parallelDspBarrier.mode, 'wasm');
    assert.deepEqual(
      main.port.messages.filter(entry => entry.message.type === 'dspEnableTypes').at(-1).message.types,
      ['VolumePlugin']
    );
    manager.disableParallelPipelines({ restorePrimaryDsp: false });
  });
});

test('AudioManager no-op parallel teardown preserves primary DSP retry and transition state', async () => {
  await withGlobals({ window: {} }, async () => {
    const manager = createManager();
    const main = createNode('main');
    manager.workletNode = main;
    manager.contextManager = { workletNode: main };
    const fallbackState = { moduleTimer: 101, failureTimer: 102 };
    manager._dspReadyFallbacks.set(main, fallbackState);
    const transition = Promise.resolve(true);
    manager._dspReadyTransitionPromise = transition;
    manager._dspTransitionGeneration = manager._audioGraphGeneration;
    const generation = manager._audioGraphGeneration;

    assert.equal(manager.disableParallelPipelines(), false);
    assert.equal(manager._dspReadyFallbacks.get(main), fallbackState);
    assert.equal(manager._dspReadyTransitionPromise, transition);
    assert.equal(manager._audioGraphGeneration, generation);
  });
});

test('AudioManager active parallel reset synchronously invalidates and tears down the test graph', async () => {
  await withGlobals({
    window: {},
    console: { error() {}, warn() {}, log() {}, info() {} }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    const auxiliary = createNode('auxiliary');
    const events = [];
    manager.workletNode = main;
    manager.contextManager = {
      workletNode: main,
      audioContext: { currentTime: 1 },
      async closeAudioContext() {},
      getSkipAudioInitDuringSampleRateChange() { return false; }
    };
    manager.ioManager = {
      outputGainNode: createNode('output'),
      sourceNode: null,
      cleanupAudio() {}
    };
    manager._parallelActive = true;
    manager._parallelWorkletB = auxiliary;
    manager._parallelSelA = createNode('sel-a');
    manager._parallelSelB = createNode('sel-b');
    manager._parallelInputTap = createNode('tap');
    manager.dispatchEvent = (type, data) => events.push({ type, data });
    manager.initAudio = async () => 'Audio Error: stop';
    const epoch = manager._primaryWorkletEpoch;

    const resetting = manager._doReset();
    assert.equal(events[0].type, 'parallelInvalidated');
    assert.equal(events[0].data.reason, 'audioReset');
    assert.equal(events[0].data.restorePrimaryDsp, false);
    assert.equal(manager._parallelActive, false);
    assert.equal(manager._parallelWorkletB, null);
    assert.equal(manager._primaryWorkletEpoch, epoch + 1);
    await resetting;
  });
});

test('AudioManager normal teardown restores preferred primary DSP with or without cached capability', async () => {
  await withGlobals({
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: true } },
    document: { hidden: false }
  }, async () => {
    const setup = withCapability => {
      const manager = createManager();
      const main = createNode(withCapability ? 'cached-main' : 'cold-main');
      const auxiliary = createNode('auxiliary');
      configureParallelManager(manager, main);
      manager.dspModuleInfo = {
        module: null,
        bytes: Uint8Array.of(0, 97, 115, 109).buffer,
        simd: false,
        meta: { kernels: [{ name: 'VolumePlugin', hash: 0x1234 }] },
        paramPackers: new Map([['VolumePlugin', { hash: 0x1234, pack() { return Float32Array.of(1); } }]])
      };
      manager._parallelActive = true;
      manager._parallelWorkletB = auxiliary;
      manager._parallelSelA = createNode('sel-a');
      manager._parallelSelB = createNode('sel-b');
      manager._parallelInputTap = createNode('tap');
      const barrier = manager._createParallelDspBarrier([main, auxiliary]);
      manager._settleParallelDspBarrier(barrier, 'js');
      if (withCapability) manager._dspCapabilitiesByNode.set(main, { type: 'dspReady' });
      return { manager, main };
    };

    const cached = setup(true);
    assert.equal(await cached.manager.disableParallelPipelines(), true);
    assert.deepEqual(
      cached.main.port.messages.filter(entry => entry.message.type === 'dspEnableTypes').at(-1).message.types,
      ['VolumePlugin']
    );

    const cold = setup(false);
    const restoring = cold.manager.disableParallelPipelines();
    assert.ok(messageOf(cold.main.port, 'dspModule'));
    assert.deepEqual(messageOf(cold.main.port, 'dspEnableTypes').message.types, []);
    cold.manager.handleWorkletMessage({
      data: { type: 'dspReady', abiVersion: 1, kernels: [{ name: 'VolumePlugin' }], simd: false }
    }, cold.main);
    assert.equal(await restoring, true);
    assert.deepEqual(
      cold.main.port.messages.filter(entry => entry.message.type === 'dspEnableTypes').at(-1).message.types,
      ['VolumePlugin']
    );
  });
});

test('AudioManager lets only the owning teardown restore output after deferred primary DSP failure', async () => {
  await withGlobals({ window: {} }, async () => {
    const cases = [
      { name: 'current owner', invalidate() {}, expectedFades: ['output'] },
      {
        name: 'new parallel switch',
        invalidate(manager) { manager._advanceAudioGraphGeneration(); },
        expectedFades: []
      },
      {
        name: 'new same-graph fade-out',
        invalidate(manager) { manager.fadeOutOutput(0.01); },
        expectedFades: []
      },
      {
        name: 'replacement output',
        invalidate(manager) { manager.ioManager.outputGainNode = { name: 'replacement-output' }; },
        expectedFades: []
      }
    ];

    for (const entry of cases) {
      const manager = createManager();
      const main = createNode(`main-${entry.name}`);
      const auxiliary = createNode(`auxiliary-${entry.name}`);
      configureParallelManager(manager, main);
      manager.ioManager.outputGainNode.name = 'output';
      manager._parallelActive = true;
      manager._parallelWorkletB = auxiliary;
      manager._parallelSelA = createNode('sel-a');
      manager._parallelSelB = createNode('sel-b');
      manager._parallelInputTap = createNode('tap');
      manager.getEnabledDspTypes = () => ['VolumePlugin'];
      const fades = [];
      manager.fadeInOutput = () => fades.push(manager.ioManager.outputGainNode.name);
      let resolveRestoration;
      manager._reinitializeDspWorklet = () => new Promise(resolve => {
        resolveRestoration = resolve;
      });

      const restoring = manager.disableParallelPipelines();
      entry.invalidate(manager);
      resolveRestoration(false);
      assert.equal(await restoring, false, entry.name);
      assert.deepEqual(fades, entry.expectedFades, entry.name);
    }
  });
});

test('AudioManager restores owned output when primary DSP teardown throws or rejects', async () => {
  await withGlobals({ window: {} }, async () => {
    for (const failureMode of ['throw', 'reject']) {
      const manager = createManager();
      const main = createNode(`main-${failureMode}`);
      configureParallelManager(manager, main);
      manager.ioManager.outputGainNode.name = 'output';
      manager._parallelActive = true;
      manager._parallelWorkletB = createNode(`auxiliary-${failureMode}`);
      manager._parallelSelA = createNode('sel-a');
      manager._parallelSelB = createNode('sel-b');
      manager._parallelInputTap = createNode('tap');
      manager.getEnabledDspTypes = () => ['VolumePlugin'];
      const fades = [];
      manager.fadeInOutput = () => fades.push(manager.ioManager.outputGainNode.name);
      const failure = new Error(`${failureMode} failed`);
      manager._reinitializeDspWorklet = () => {
        if (failureMode === 'throw') throw failure;
        return Promise.reject(failure);
      };

      if (failureMode === 'throw') {
        assert.throws(() => manager.disableParallelPipelines(), error => error === failure);
      } else {
        await assert.rejects(manager.disableParallelPipelines(), error => error === failure);
      }
      assert.deepEqual(fades, ['output']);
    }
  });
});

test('AudioManager invalidates ready transition tokens when a fatal failure wins before fade', async () => {
  await withGlobals({ window: {} }, async () => {
    const manager = createManager();
    const main = createNode('main');
    const waits = [];
    const events = [];
    const fades = [];
    manager.workletNode = main;
    manager.contextManager = { workletNode: main, audioContext: { currentTime: 1 } };
    manager.ioManager = { outputGainNode: { name: 'gain' } };
    manager.pipelineProcessor = { prepareSectionAwarePluginData: () => [] };
    manager.fadeOutOutput = () => {
      fades.push('out');
      return ++manager._outputFadeToken;
    };
    manager.fadeInOutput = () => fades.push('in');
    manager._waitForDspTransition = () => new Promise(resolve => waits.push(resolve));
    manager.dispatchEvent = (type, data) => events.push({ type, data });

    manager.handleWorkletMessage({
      data: { type: 'dspReady', abiVersion: 1, kernels: [], simd: false }
    }, main);
    const transition = manager._dspReadyTransitionPromise;
    manager.handleWorkletMessage({
      data: { type: 'dspFailed', stage: 'runtime', error: 'fatal' }
    }, main);
    waits[0]();
    assert.equal(await transition, false);

    assert.equal(messageOf(main.port, 'updatePlugins'), undefined);
    assert.equal(events.some(event => event.type === 'dspReady'), false);
    assert.equal(events.some(event => event.type === 'dspFailed'), true);
    assert.equal(manager.dspCapabilities, null);
    assert.deepEqual(fades, ['out', 'in']);
  });
});

test('AudioManager fatal primary failure reinitializes retained DSP before enabling it again', async () => {
  await withGlobals({
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: true } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    manager.dspModuleInfo = {
      module: null,
      bytes: Uint8Array.of(0, 97, 115, 109).buffer,
      simd: false,
      meta: { kernels: [{ name: 'VolumePlugin', hash: 0x1234 }] },
      paramPackers: new Map([['VolumePlugin', { hash: 0x1234, pack() { return Float32Array.of(1); } }]])
    };
    const capabilities = { type: 'dspReady', kernels: [{ name: 'VolumePlugin' }], simd: false };
    manager.dspCapabilities = capabilities;
    manager._dspCapabilitiesByNode.set(main, capabilities);
    manager.handleWorkletMessage({
      data: { type: 'dspFailed', stage: 'runtime', error: 'engine stopped' }
    }, main);
    main.port.messages.length = 0;

    const enabling = manager.updateAudioConfig({ outputChannels: 2, useWasmDsp: true });
    assert.ok(messageOf(main.port, 'dspModule'));
    assert.deepEqual(messageOf(main.port, 'dspEnableTypes').message.types, []);
    manager.handleWorkletMessage({ data: capabilities }, main);
    assert.equal(await enabling, true);
    assert.deepEqual(
      main.port.messages.filter(entry => entry.message.type === 'dspEnableTypes').at(-1).message.types,
      ['VolumePlugin']
    );
  });
});

test('AudioManager transitions existing DSP enable changes on every active worklet', async () => {
  await withGlobals({
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: true } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    manager.dspModuleInfo = {
      meta: { kernels: [{ name: 'VolumePlugin', hash: 0x1234 }] },
      paramPackers: new Map([['VolumePlugin', { hash: 0x1234, pack() { return Float32Array.of(1); } }]])
    };
    manager._dspCapabilitiesByNode.set(main, { type: 'dspReady' });

    await manager.updateAudioConfig({ outputChannels: 2, useWasmDsp: false });
    assert.deepEqual(messageOf(main.port, 'dspEnableTypes').message.types, []);
    assert.ok(messageOf(main.port, 'updatePlugins'));

    main.port.messages.length = 0;
    await manager.updateAudioConfig({ outputChannels: 2, useWasmDsp: true });
    assert.deepEqual(messageOf(main.port, 'dspEnableTypes').message.types, ['VolumePlugin']);

    const auxiliary = createNode('auxiliary');
    manager._parallelWorkletB = auxiliary;
    manager._parallelActive = true;
    const barrier = manager._createParallelDspBarrier([main, auxiliary]);
    manager._settleParallelDspBarrier(barrier, 'wasm');
    manager._dspCapabilitiesByNode.set(main, { type: 'dspReady' });
    manager._dspCapabilitiesByNode.set(auxiliary, { type: 'dspReady' });
    main.port.messages.length = 0;
    auxiliary.port.messages.length = 0;

    await manager.updateAudioConfig({ outputChannels: 4, useWasmDsp: false });
    assert.ok(messageOf(main.port, 'updateAudioConfig'));
    assert.ok(messageOf(auxiliary.port, 'updateAudioConfig'));
    assert.deepEqual(
      main.port.messages.filter(entry => entry.message.type === 'dspEnableTypes').at(-1).message.types,
      []
    );
    assert.deepEqual(
      auxiliary.port.messages.filter(entry => entry.message.type === 'dspEnableTypes').at(-1).message.types,
      []
    );

    main.port.messages.length = 0;
    auxiliary.port.messages.length = 0;
    await manager.updateAudioConfig({ outputChannels: 4, useWasmDsp: true });
    for (const node of [main, auxiliary]) {
      const enableMessages = node.port.messages.filter(entry => entry.message.type === 'dspEnableTypes');
      assert.deepEqual(enableMessages[0].message.types, []);
      assert.deepEqual(enableMessages.at(-1).message.types, ['VolumePlugin']);
    }
  });
});

test('AudioManager graph generations isolate deferred DSP transitions', async () => {
  await withGlobals({ window: {} }, async () => {
    const manager = createManager();
    const oldNode = createNode('old');
    const newNode = createNode('new');
    const oldContext = { currentTime: 1 };
    const newContext = { currentTime: 2 };
    const oldGain = { name: 'old-gain' };
    const newGain = { name: 'new-gain' };
    const waits = [];
    const fades = [];
    manager.workletNode = oldNode;
    manager.contextManager = { workletNode: oldNode, audioContext: oldContext };
    manager.ioManager = { outputGainNode: oldGain };
    manager.pipelineProcessor = { prepareSectionAwarePluginData: () => [] };
    manager.fadeOutOutput = () => {
      fades.push(['out', manager.ioManager.outputGainNode.name]);
      return ++manager._outputFadeToken;
    };
    manager.fadeInOutput = () => fades.push(['in', manager.ioManager.outputGainNode.name]);
    manager._waitForDspTransition = () => new Promise(resolve => waits.push(resolve));

    manager.handleWorkletMessage({ data: { type: 'dspReady', kernels: [], simd: false } }, oldNode);
    const oldTransition = manager._dspReadyTransitionPromise;
    assert.deepEqual(fades, [['out', 'old-gain']]);

    manager.workletNode = newNode;
    manager.contextManager = { workletNode: newNode, audioContext: newContext };
    manager.ioManager = { outputGainNode: newGain };
    manager._advanceAudioGraphGeneration();
    manager.handleWorkletMessage({ data: { type: 'dspReady', kernels: [], simd: false } }, newNode);
    const newTransition = manager._dspReadyTransitionPromise;
    assert.notEqual(newTransition, oldTransition);
    assert.deepEqual(fades, [['out', 'old-gain'], ['out', 'new-gain']]);

    waits[0]();
    await oldTransition;
    assert.equal(manager._dspReadyTransitionPromise, newTransition);
    assert.equal(messageOf(oldNode.port, 'updatePlugins'), undefined);
    assert.deepEqual(fades, [['out', 'old-gain'], ['out', 'new-gain']]);

    waits[1]();
    for (let index = 0; index < 4; index++) await Promise.resolve();
    waits[2]();
    await newTransition;
    assert.ok(messageOf(newNode.port, 'updatePlugins'));
    assert.deepEqual(fades.at(-1), ['in', 'new-gain']);
  });
});

test('AudioManager waits for parallel B readiness before symmetric routing and falls back together', async () => {
  const runCase = async (mode, createdWorklets) => {
    const manager = createManager();
    const main = createNode(`main-${mode}`);
    configureParallelManager(manager, main);
    manager.dspModuleInfo = {
      module: null,
      bytes: Uint8Array.of(0, 97, 115, 109).buffer,
      simd: false,
      meta: { kernels: [{ name: 'VolumePlugin', hash: 0x1234 }] },
      paramPackers: new Map([['VolumePlugin', { hash: 0x1234, pack() { return Float32Array.of(1); } }]])
    };
    const readyA = { type: 'dspReady', abiVersion: 1, kernels: [{ name: 'VolumePlugin' }], simd: false };
    manager._dspCapabilitiesByNode.set(main, readyA);
    manager.dspCapabilities = readyA;
    const enabling = manager.enableParallelPipelines('A');
    const auxiliary = createdWorklets[0];
    assert.equal(manager._parallelPreparing, true);
    assert.equal(manager._parallelActive, false);
    assert.deepEqual(manager.getActivePowerWorklets(), [main]);
    const preparingPowerGeneration = manager.getPowerWorkletGraphGeneration();
    assert.equal(messageOf(main.port, 'dspEnableTypes'), undefined);

    if (mode === 'success') {
      auxiliary.port.onmessage({ data: { type: 'dspReady', abiVersion: 1, kernels: [], simd: false } });
    } else if (mode === 'failure') {
      auxiliary.port.onmessage({ data: { type: 'dspFailed', stage: 'instance:2', error: 'create failed' } });
    } else {
      manager._handleDspReadyTimeout(auxiliary);
    }
    assert.equal(await enabling, true);
    assert.equal(manager._parallelActive, true);
    assert.deepEqual(manager.getActivePowerWorklets(), [main, auxiliary]);
    assert.ok(manager.getPowerWorkletGraphGeneration() > preparingPowerGeneration);
    const mainTypes = main.port.messages.filter(entry => entry.message.type === 'dspEnableTypes');
    const auxiliaryTypes = auxiliary.port.messages.filter(entry => entry.message.type === 'dspEnableTypes');
    assert.deepEqual(mainTypes[0].message.types, []);
    if (mode === 'success') {
      assert.deepEqual(mainTypes.at(-1).message.types, ['VolumePlugin']);
      assert.deepEqual(auxiliaryTypes.at(-1).message.types, ['VolumePlugin']);
      assert.equal(manager._parallelDspBarrier.mode, 'wasm');

      main.port.messages.length = 0;
      auxiliary.port.messages.length = 0;
      const invalidations = [];
      manager.dispatchEvent = (type, data) => invalidations.push({ type, data });
      auxiliary.port.onmessage({ data: { type: 'dspFailed', stage: 'runtime', error: 'trap' } });
      await manager._dspReadyTransitionPromise;
      assert.equal(manager._parallelActive, false);
      assert.equal(manager._parallelDspBarrier, null);
      assert.equal(invalidations[0].type, 'parallelInvalidated');
      assert.equal(invalidations[0].data.reason, 'dspFailed');
      assert.deepEqual(messageOf(main.port, 'dspEnableTypes').message.types, ['VolumePlugin']);
    } else {
      assert.deepEqual(mainTypes.at(-1).message.types, []);
      assert.deepEqual(auxiliaryTypes.at(-1).message.types, []);
      assert.equal(manager._parallelDspBarrier.mode, 'js');
    }
    manager.disableParallelPipelines();
  };

  for (const mode of ['success', 'failure', 'timeout']) {
    const createdWorklets = [];
    await withGlobals({
      AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
      window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: true } },
      document: { hidden: false }
    }, async () => {
      await runCase(mode, createdWorklets);
    });
  }
});

test('AudioManager parallel no-DSP path resolves in symmetric JavaScript mode', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    manager.dspModuleInfo = {
      module: null,
      bytes: Uint8Array.of(0, 97, 115, 109).buffer,
      simd: false,
      meta: { kernels: [{ name: 'VolumePlugin', hash: 0x1234 }] },
      paramPackers: new Map([['VolumePlugin', { hash: 0x1234, pack() { return Float32Array.of(1); } }]])
    };
    assert.equal(await manager.enableParallelPipelines('B'), true);
    assert.equal(manager._parallelDspBarrier.mode, 'js');
    assert.equal(manager._parallelActive, true);
    assert.ok(messageOf(main.port, 'updatePlugins'));
    assert.ok(messageOf(createdWorklets[0].port, 'updatePlugins'));
    assert.equal(messageOf(createdWorklets[0].port, 'dspModule'), undefined);
    manager.disableParallelPipelines({ restorePrimaryDsp: false });
  });
});

test('AudioManager routes an already-connected player source through both parallel pipelines', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const playerSource = createNode('player-source');

    manager.connectSourceToPipeline(playerSource);
    assert.deepEqual(playerSource.connections, [main]);

    assert.equal(await manager.enableParallelPipelines('B'), true);
    const tap = manager._parallelInputTap;
    assert.equal(playerSource.connections.filter(node => node === main).length, 1);
    assert.equal(playerSource.connections.filter(node => node === tap).length, 1);

    manager.disconnectSourceFromPipeline(playerSource);
    assert.deepEqual(playerSource.connections, []);
    await manager.disableParallelPipelines({ restorePrimaryDsp: false });
  });
});

test('AudioManager restores the current output owner when parallel construction fails', async () => {
  class ThrowingAudioWorkletNode {
    constructor() {
      throw new Error('parallel constructor failed');
    }
  }

  await withGlobals({
    AudioWorkletNode: ThrowingAudioWorkletNode,
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: true } },
    document: { hidden: false },
    console: { error() {}, warn() {}, log() {}, info() {} }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    manager._parallelActive = true;
    manager._parallelWorkletB = createNode('auxiliary');
    manager._parallelSelA = createNode('sel-a');
    manager._parallelSelB = createNode('sel-b');
    manager._parallelInputTap = createNode('tap');
    manager.getEnabledDspTypes = () => ['VolumePlugin'];
    manager._dspCapabilitiesByNode.set(main, { type: 'dspReady' });

    let releaseFade;
    let waitCount = 0;
    manager._waitForDspTransition = () => {
      waitCount++;
      if (waitCount !== 1) return Promise.resolve();
      return new Promise(resolve => { releaseFade = resolve; });
    };
    manager.fadeOutOutput = () => {
      manager.ioManager.outputGainNode.gain.value = 0;
      return ++manager._outputFadeToken;
    };
    manager.fadeInOutputForToken = token => {
      if (token !== manager._outputFadeToken) return false;
      manager.ioManager.outputGainNode.gain.value = 1;
      return true;
    };

    const restoring = manager.disableParallelPipelines();
    await Promise.resolve();
    assert.equal(manager.ioManager.outputGainNode.gain.value, 0);

    assert.equal(await manager.enableParallelPipelines('A'), false);
    assert.equal(manager.ioManager.outputGainNode.gain.value, 1);

    releaseFade();
    assert.equal(await restoring, false);
    assert.equal(manager.ioManager.outputGainNode.gain.value, 1);
  });
});

test('AudioManager clears static capabilities only for fatal primary DSP failures', async () => {
  await withGlobals({ window: {} }, async () => {
    const manager = createManager();
    const main = createNode('main');
    const capabilities = { type: 'dspReady', kernels: [], simd: false };
    manager.workletNode = main;
    manager.contextManager = { workletNode: main };
    manager.dspCapabilities = capabilities;
    manager._dspCapabilitiesByNode.set(main, capabilities);
    globalThis.window.dspCapabilities = capabilities;

    manager.handleWorkletMessage({
      data: { type: 'dspFailed', stage: 'instance:7', error: 'unsupported params' }
    }, main);
    assert.equal(manager.dspCapabilities, capabilities);
    assert.equal(globalThis.window.dspCapabilities, capabilities);
    assert.equal(manager._dspCapabilitiesByNode.get(main), capabilities);

    manager.handleWorkletMessage({
      data: { type: 'dspFailed', stage: 'runtime', error: 'memory invalid' }
    }, main);
    assert.equal(manager.dspCapabilities, null);
    assert.equal(globalThis.window.dspCapabilities, undefined);
    assert.equal(manager._dspCapabilitiesByNode.has(main), false);
  });
});

test('AudioManager auxiliary worklet receives DSP bytes and returns telemetry packets to its pool', async () => {
  const createdWorklets = [];
  class FakeAudioWorkletNode {
    constructor(context, name, options) {
      this.context = context;
      this.name = name;
      this.options = options;
      this.port = createPort();
      this.connections = [];
      createdWorklets.push(this);
    }
    connect(target) {
      this.connections.push(target);
      return target;
    }
    disconnect() {
      this.connections = [];
    }
  }
  await withGlobals({
    AudioWorkletNode: FakeAudioWorkletNode,
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: {} },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const mainWorklet = createNode('main');
    const output = createNode('output');
    let gainIndex = 0;
    const context = {
      destination: { channelCount: 2 },
      createGain() {
        const node = createNode(`gain-${++gainIndex}`);
        node.gain = { value: 1 };
        return node;
      }
    };
    manager.contextManager = { audioContext: context, workletNode: mainWorklet, lowLatencyMode: false };
    manager.ioManager = { outputGainNode: output, sourceNode: null };
    manager.dspModuleInfo = {
      module: null,
      bytes: Uint8Array.of(0, 97, 115, 109).buffer,
      simd: false,
      meta: { kernels: [{ name: 'VolumePlugin', hash: 0x1234 }] },
      paramPackers: new Map([['VolumePlugin', { hash: 0x1234, pack() { return Float32Array.of(1); } }]])
    };
    manager.fadeOutOutput = () => ++manager._outputFadeToken;
    manager.fadeInOutput = () => {};
    manager._waitForDspTransition = async () => {};
    const enabling = manager.enableParallelPipelines('A');
    assert.equal(createdWorklets.length, 1);
    const auxiliary = createdWorklets[0];
    assert.ok(messageOf(auxiliary.port, 'dspModule'));
    assert.ok(messageOf(auxiliary.port, 'dspEnableTypes'));
    assert.ok(messageOf(auxiliary.port, 'dspSetTelemetryRate'));

    const ready = { type: 'dspReady', abiVersion: 1, kernels: [], simd: false };
    manager.handleWorkletMessage({ data: ready }, mainWorklet);
    auxiliary.port.onmessage({ data: ready });
    assert.equal(await enabling, true);

    const packet = new ArrayBuffer(32);
    auxiliary.port.onmessage({ data: { type: 'dspTelemetry', packet, bytes: 16 } });
    const returned = messageOf(auxiliary.port, 'dspTelemetryReturn');
    assert.equal(returned.message.packet, packet);
    assert.equal(returned.transfer.length, 1);
    assert.equal(returned.transfer[0], packet);
    manager.disableParallelPipelines({ restorePrimaryDsp: false });
  });
});
