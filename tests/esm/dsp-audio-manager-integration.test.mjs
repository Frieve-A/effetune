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
  manager._wasmAssetStatesByNode = new Map();
  manager._wasmAssetExpectedRevisionsByNode = new Map();
  manager._wasmAssetMembershipByNode = new Map();
  manager._wasmAssetResolverPlugins = new WeakSet();
  manager._pendingWasmAssetReadyRequests = new Map();
  manager._pendingWasmAssetDescriptorRequests = new Set();
  manager._wasmAssetPrimaryWorklet = null;
  manager._dspReadyTransitionPromise = null;
  manager._dspTransitionGeneration = -1;
  manager._dspExecutionGenerationsByNode = new Map();
  manager._audioGraphGeneration = 1;
  manager._primaryWorkletEpoch = 1;
  manager._outputFadeToken = 0;
  manager._parallelDspBarrier = null;
  manager._parallelBranchSnapshot = null;
  manager._parallelPreparing = false;
  manager._parallelTeardownPromise = null;
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

class WasmOnlyTestPlugin {
  constructor(id) {
    this.id = id;
    this.messages = [];
  }
  onMessage(message) {
    this.messages.push(message);
  }
}

class RoomEqPlugin extends WasmOnlyTestPlugin {}

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

class AssetVolumePlugin extends VolumePlugin {
  constructor(id, branch, options = {}) {
    super(id, branch);
    this.assetId = options.assetId || 'asset-id';
    this.activeAssetId = this.assetId;
    this.assetSignature = typeof options.assetSignature === 'string'
      ? options.assetSignature
      : null;
    const descriptorSignature = typeof options.descriptorSignature === 'string'
      ? options.descriptorSignature
      : this.assetSignature;
    this.assetDescriptor = {
      formatTag: 7,
      headBlock: 256,
      rateDivider: 2,
      pathCount: 4,
      inputCount: 2,
      processingChannels: 2,
      footprintBytes: 512,
      ...(descriptorSignature !== null && { externalAssetSignature: descriptorSignature }),
      payload: Uint8Array.of(1, 2, 3, 4).buffer
    };
    this.assets = options.ready === false
      ? new Map()
      : new Map([[0, this.assetDescriptor]]);
    this.assetRevision = this.assets.size;
    this.assetDescriptor.operationRevision = this.assetRevision || 1;
    this.configured = options.configured === true;
    this.missing = options.missing === true;
    this.pending = options.pending === true;
    this.pendingIds = Array.isArray(options.pendingIds) ? options.pendingIds.map(String) : [];
    this.assetListeners = new Set();
    this.assetSnapshotListeners = new Set();
    this.assetTargetResolver = null;
    this.assetOperationObserver = null;
    this.assetTargetResolverAssignments = 0;
    this.replays = [];
    this.transportAcknowledgements = [];
    this.droppedAssetTargets = [];
    this.useReplayEpoch = options.useReplayEpoch === true;
    this.includeAssetIdentityInParameters = options.includeAssetIdentityInParameters === true;
    this.replayEpochs = new WeakMap();
  }
  getParameters() {
    const parameters = super.getParameters();
    return this.includeAssetIdentityInParameters
      ? { ...parameters, assetId: this.activeAssetId }
      : parameters;
  }
  get externalAssetInfo() {
    if (!this.configured && !this.missing && !this.pending) return null;
    return {
      ids: this.pending ? [...this.pendingIds] : [this.assetId],
      kind: 'IR',
      missing: this.missing,
      pending: this.pending,
      ...(this.assetSignature !== null && { assetSignature: this.assetSignature })
    };
  }
  getWasmAssets() {
    return new Map(this.assets);
  }
  getWasmAssetRevision() {
    return this.assetRevision;
  }
  addWasmAssetChangeListener(listener) {
    this.assetListeners.add(listener);
    return () => this.assetListeners.delete(listener);
  }
  addWasmAssetSnapshotChangeListener(listener) {
    this.assetSnapshotListeners.add(listener);
    return () => this.assetSnapshotListeners.delete(listener);
  }
  setWasmAssetTargetResolver(resolver) {
    this.assetTargetResolver = resolver;
    this.assetTargetResolverAssignments++;
  }
  setWasmAssetOperationObserver(observer) {
    this.assetOperationObserver = observer;
  }
  acknowledgeWasmAssetOperation(workletNode, slot, operationRevision, replayEpoch) {
    this.transportAcknowledgements.push({
      workletNode,
      slot,
      operationRevision,
      ...(replayEpoch !== undefined && replayEpoch !== null && { replayEpoch })
    });
  }
  dropWasmAssetTarget(workletNode) {
    this.droppedAssetTargets.push(workletNode);
  }
  requestAsset(assetSignature, assetId = this.assetId) {
    this.configured = true;
    this.missing = false;
    this.assetId = assetId;
    this.assetSignature = assetSignature;
    for (const listener of [...this.assetSnapshotListeners]) listener();
  }
  completeAsset(assetSignature = this.assetSignature) {
    this.pending = false;
    this.assetRevision++;
    this.assetDescriptor = {
      ...this.assetDescriptor,
      ...(typeof assetSignature === 'string'
        ? { externalAssetSignature: assetSignature }
        : {}),
      operationRevision: this.assetRevision
    };
    this.assets.set(0, this.assetDescriptor);
    this.activeAssetId = this.assetId;
    for (const listener of [...this.assetListeners]) listener(this.assetRevision);
    for (const listener of [...this.assetSnapshotListeners]) listener();
    const targets = this.assetTargetResolver
      ? this.assetTargetResolver(this)
      : [globalThis.window?.workletNode].filter(workletNode => workletNode?.port);
    for (const workletNode of targets) {
      this._postAsset(workletNode, this.assetDescriptor);
    }
  }
  failAsset() {
    this.pending = false;
    this.missing = true;
    this.assets.clear();
    this.assetRevision++;
    for (const listener of [...this.assetListeners]) listener(this.assetRevision);
    for (const listener of [...this.assetSnapshotListeners]) listener();
  }
  _postAsset(workletNode, descriptor, replayEpoch = null) {
    const payload = descriptor.payload.slice(0);
    this.assetOperationObserver?.(
      workletNode,
      0,
      descriptor.operationRevision,
      1,
      replayEpoch
    );
    workletNode.port.postMessage({
      type: 'setPluginAsset',
      pluginId: this.id,
      slot: 0,
      ...descriptor,
      ...(replayEpoch !== null && { replayEpoch }),
      payload
    }, [payload]);
  }
  replayWasmAssetsTo(workletNode, options = {}) {
    this.replays.push({ workletNode, options });
    let replayEpoch = null;
    if (this.useReplayEpoch) {
      replayEpoch = (this.replayEpochs.get(workletNode) || 0) + 1;
      this.replayEpochs.set(workletNode, replayEpoch);
    }
    for (const descriptor of (options.assets || this.assets).values()) {
      this._postAsset(workletNode, descriptor, replayEpoch);
    }
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

test('initializeAudioWorklet returns while optional DSP loading continues', async () => {
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
    let resolveDsp;
    manager.loadDspForWorklet = () => new Promise(resolve => { resolveDsp = resolve; });

    assert.equal(await manager.initializeAudioWorklet(), '');
    const pendingLoad = manager._dspModuleLoadPromise;
    assert.equal(manager.dspModuleInfo, null);
    resolveDsp(null);
    assert.equal(await pendingLoad, false);

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

test('AudioManager validates Room EQ execution state and rejects stale or auxiliary messages', () => {
  const manager = createManager();
  const main = createNode('main');
  const auxiliary = createNode('auxiliary');
  const roomEq = new RoomEqPlugin(42);
  manager.workletNode = main;
  manager.contextManager = { workletNode: main };
  manager.pipelineA = [roomEq];
  manager.pipeline = manager.pipelineA;
  manager._parallelActive = true;
  manager._parallelWorkletB = auxiliary;
  const dispatched = [];
  manager.dispatchEvent = (type, data) => dispatched.push({ type, data });
  const state = (generation, overrides = {}) => ({
    type: 'dspExecutionState', pluginId: 42, pluginType: 'RoomEqPlugin',
    state: 'active', reason: null, generation, ...overrides
  });

  manager.handleWorkletMessage({ data: state(7) }, main);
  manager.handleWorkletMessage({ data: state(6, {
    state: 'bypassed', reason: 'runtimeFallback'
  }) }, main);
  manager.handleWorkletMessage({ data: state(8, {
    state: 'bypassed', reason: 'wasmUnavailable'
  }) }, auxiliary);
  manager.handleWorkletMessage({ data: state(99, { pluginId: 999 }) }, main);
  manager.handleWorkletMessage({ data: state(8, { pluginType: 'VolumePlugin' }) }, main);
  manager.handleWorkletMessage({ data: state(8, {
    state: 'bypassed', reason: 'wasmUnavailable'
  }) }, main);

  assert.equal(roomEq.messages.length, 2);
  assert.equal(roomEq.messages[0].state, 'active');
  assert.equal(roomEq.messages[0].validated, true);
  assert.equal(roomEq.messages[1].reason, 'wasmUnavailable');
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[0].data.pluginType, 'RoomEqPlugin');
  assert.equal(dispatched[0].data.generation, 7);
  assert.equal(dispatched[1].data.generation, 8);
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
      manager._reinitializeDspWorklet = async (node, types, options) => {
        starts.push({ node, types, options });
        return true;
      };

      assert.equal(await manager.initializeAudioWorklet(), '');
      const load = manager._dspModuleLoadPromise;
      if (replaceBeforeResolve) {
        const replacement = createNode('replacement');
        manager.workletNode = replacement;
        manager.contextManager.workletNode = replacement;
      }
      resolveDsp(info);
      assert.equal(await load, !replaceBeforeResolve);

      assert.deepEqual(starts, replaceBeforeResolve ? [] : [{
        node: requestedNode,
        types: [],
        options: { muteOutput: false }
      }]);
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
    manager._reinitializeDspWorklet = async (node, types, options) => {
      starts.push({ node, info: manager.dspModuleInfo, types, options });
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
    assert.deepEqual(starts, [{
      node: newNode,
      info: newInfo,
      types: [],
      options: { muteOutput: false }
    }]);

    resolvers[0](oldInfo);
    assert.equal(await oldLoad, false);
    assert.equal(manager.dspModuleInfo, newInfo);
    assert.deepEqual(starts, [{
      node: newNode,
      info: newInfo,
      types: [],
      options: { muteOutput: false }
    }]);
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
    const load = manager._dspModuleLoadPromise;
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
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(manager.dspModuleInfo, info);
    assert.ok(messageOf(main.port, 'dspModule'));
    assert.ok(messageOf(auxiliary.port, 'dspModule'));
    assert.equal(manager._dspReadyFallbacks.has(main), true);
    assert.equal(manager._dspReadyFallbacks.has(auxiliary), true);
    const ready = { type: 'dspReady', abiVersion: 1, kernels: [], simd: false };
    manager.handleWorkletMessage({ data: ready }, main);
    manager.handleWorkletMessage({ data: ready }, auxiliary);
    await load;
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

test('AudioManager replays retained assets once after configuring a recreated primary worklet', async () => {
  await withGlobals({ window: {} }, async () => {
    const manager = createManager();
    const previous = createNode('previous');
    const recreated = createNode('recreated');
    const plugin = new AssetVolumePlugin(11, 'A');
    manager.pipelineA = [plugin];
    manager.pipeline = manager.pipelineA;
    manager.workletNode = recreated;
    manager.contextManager = { workletNode: recreated };
    manager._wasmAssetPrimaryWorklet = previous;
    manager.registerPipelineProcessors = () => {};
    manager.updateExposedProperties = () => {};
    manager.pipelineProcessor = {
      setPipeline() {},
      setMasterBypass() {},
      async rebuildPipeline() {
        recreated.port.postMessage({ type: 'updatePlugins', plugins: [] });
        return '';
      }
    };

    assert.equal(await manager.rebuildPipeline(true), '');
    assert.equal(plugin.replays.length, 1);
    assert.equal(plugin.replays[0].workletNode, recreated);
    assert.equal(plugin.replays[0].options.trackState, true);
    assert.equal(plugin.replays[0].options.assets.size, 1);
    assert.deepEqual(
      recreated.port.messages.map(entry => entry.message.type),
      ['updatePlugins', 'setPluginAsset']
    );

    assert.equal(await manager.rebuildPipeline(false), '');
    assert.equal(plugin.replays.length, 1);
  });
});

test('AudioManager suppresses an old asset when a recreated node changes output format', async () => {
  await withGlobals({ window: {} }, async () => {
    const manager = createManager();
    const oldNode = createNode('old');
    const replacement = createNode('replacement');
    const plugin = new AssetVolumePlugin(11, 'A');
    const baseGetParameters = plugin.getParameters.bind(plugin);
    plugin.outputFormat = { sampleRate: 48000, outputChannelCount: 2 };
    plugin.getParameters = (options = {}) => {
      if (options.commitSampleRate &&
          (options.sampleRate !== plugin.outputFormat.sampleRate ||
            options.outputChannelCount !== plugin.outputFormat.outputChannelCount)) {
        plugin.outputFormat = {
          sampleRate: options.sampleRate,
          outputChannelCount: options.outputChannelCount
        };
        plugin.assets.clear();
        plugin.assetRevision++;
        for (const listener of [...plugin.assetListeners]) listener(plugin.assetRevision);
      }
      return baseGetParameters();
    };
    manager.pipelineA = [plugin];
    manager.pipeline = manager.pipelineA;
    manager.workletNode = oldNode;
    manager.contextManager = {
      workletNode: oldNode,
      audioContext: { sampleRate: 48000, destination: { channelCount: 2 } }
    };
    manager._syncWasmAssetMembership(oldNode, manager.pipeline, { trackState: true });
    assert.equal(oldNode.port.messages.filter(entry => entry.message.type === 'setPluginAsset').length, 1);

    manager.workletNode = replacement;
    manager.contextManager = {
      workletNode: replacement,
      audioContext: { sampleRate: 96000, destination: { channelCount: 4 } }
    };
    manager._advanceAudioGraphGeneration();
    manager._pruneInactiveDspWorklets();
    manager.registerPipelineProcessors = () => {};
    manager.updateExposedProperties = () => {};
    manager.pipelineProcessor = {
      setPipeline() {},
      setMasterBypass() {},
      async rebuildPipeline() {
        manager._buildBlindPluginData(manager.pipeline);
        replacement.port.postMessage({ type: 'updatePlugins', plugins: [] });
        return '';
      }
    };

    assert.equal(await manager.rebuildPipeline(), '');
    assert.equal(plugin.outputFormat.sampleRate, 96000);
    assert.equal(plugin.outputFormat.outputChannelCount, 4);
    assert.equal(replacement.port.messages.some(entry => entry.message.type === 'setPluginAsset'), false);

    plugin.assetDescriptor = {
      ...plugin.assetDescriptor,
      rateDivider: 2,
      processingChannels: 4
    };
    plugin.completeAsset();
    const replacementAsset = replacement.port.messages.find(entry =>
      entry.message.type === 'setPluginAsset'
    )?.message;
    assert.equal(replacementAsset.rateDivider, 2);
    assert.equal(replacementAsset.processingChannels, 4);
    assert.equal(oldNode.port.messages.filter(entry => entry.message.type === 'setPluginAsset').length, 1);
  });
});

test('AudioManager replays same-node A to B to A membership without restaging unchanged rebuilds', async () => {
  await withGlobals({ window: {} }, async () => {
    const manager = createManager();
    const main = createNode('main');
    const pluginA = new AssetVolumePlugin(11, 'A');
    const pluginB = new AssetVolumePlugin(12, 'B', { configured: true, ready: false });
    globalThis.window.workletNode = main;
    manager.pipelineA = [pluginA];
    manager.pipelineB = [pluginB];
    manager.pipeline = manager.pipelineA;
    manager.workletNode = main;
    manager.contextManager = { workletNode: main };
    manager.registerPipelineProcessors = () => {};
    manager.updateExposedProperties = () => {};
    manager.pipelineProcessor = {
      setPipeline() {},
      setMasterBypass() {},
      async rebuildPipeline() {
        main.port.postMessage({ type: 'updatePlugins', plugins: [] });
        return '';
      }
    };

    manager._configureOwnedPipelineWasmAssetResolvers();
    manager._configureOwnedPipelineWasmAssetResolvers();
    assert.equal(pluginA.assetTargetResolverAssignments, 1);
    assert.equal(pluginB.assetTargetResolverAssignments, 1);
    pluginB.completeAsset();
    assert.equal(main.port.messages.some(entry =>
      entry.message.type === 'setPluginAsset' && entry.message.pluginId === pluginB.id
    ), false);

    await manager.rebuildPipeline();
    manager.handleWorkletMessage({
      data: {
        type: 'assetState', pluginId: pluginA.id, slot: 0, state: 3,
        operationRevision: pluginA.assetDescriptor.operationRevision
      }
    }, main);
    assert.equal(pluginA.replays.length, 1);
    assert.equal(manager._wasmAssetStatesByNode.get(main).get(`${pluginA.id}:0`), 3);

    await manager.rebuildPipeline();
    assert.equal(pluginA.replays.length, 1);

    manager.pipeline = manager.pipelineB;
    await manager.rebuildPipeline();
    assert.equal(pluginB.replays.length, 1);
    assert.equal(manager._wasmAssetStatesByNode.get(main).has(`${pluginA.id}:0`), false);

    manager.pipeline = manager.pipelineA;
    await manager.rebuildPipeline();
    assert.equal(pluginA.replays.length, 2);
    assert.equal(manager._wasmAssetStatesByNode.get(main).get(`${pluginA.id}:0`), 1);
    manager.handleWorkletMessage({
      data: {
        type: 'assetState', pluginId: pluginA.id, slot: 0, state: 3,
        operationRevision: pluginA.assetDescriptor.operationRevision
      }
    }, main);
    assert.equal(manager._wasmAssetStatesByNode.get(main).get(`${pluginA.id}:0`), 3);
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
    manager.dspModuleInfo = { meta: { kernels: [] }, paramPackers: new Map() };
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

test('AudioManager publishes startup DSP readiness while the output is still private', async () => {
  await withGlobals({ window: {}, document: { hidden: false } }, async () => {
    const manager = createManager();
    const node = createNode('main');
    manager.workletNode = node;
    manager.contextManager = { workletNode: node, audioContext: { currentTime: 1 } };
    manager.ioManager = { outputGainNode: { gain: { value: 0 } } };
    manager.dspModuleInfo = {
      module: { compiled: true },
      bytes: null,
      simd: false,
      meta: { kernels: [{ name: 'DelayPlugin', hash: 0x1234 }] },
      paramPackers: new Map([['DelayPlugin', { hash: 0x1234, pack() { return Float32Array.of(1); } }]])
    };
    manager.pipelineProcessor = { prepareSectionAwarePluginData: () => [] };
    manager.fadeOutOutput = () => {
      throw new Error('startup DSP publication must use the existing private output');
    };
    manager.fadeInOutputForToken = () => {
      throw new Error('startup DSP publication must not publish the master output');
    };

    const activation = manager._reinitializeDspWorklet(
      node,
      ['DelayPlugin'],
      { muteOutput: false }
    );
    manager.handleWorkletMessage({
      data: { type: 'dspReady', abiVersion: 1, kernels: [{ name: 'DelayPlugin' }], simd: false }
    }, node);

    assert.equal(await activation, true);
    assert.deepEqual(messageOf(node.port, 'dspEnableTypes').message.types, []);
    assert.deepEqual(
      node.port.messages.filter(entry => entry.message.type === 'dspEnableTypes').at(-1).message.types,
      ['DelayPlugin']
    );
  });
});

test('AudioManager ignores DSP readiness that arrives after the startup fallback', async () => {
  await withGlobals({ window: {}, document: { hidden: false } }, async () => {
    const manager = createManager();
    const node = createNode('main');
    manager.workletNode = node;
    manager.contextManager = { workletNode: node, audioContext: { currentTime: 1 } };
    manager.ioManager = { outputGainNode: { gain: { value: 1 } } };
    manager.dspModuleInfo = {
      module: { compiled: true },
      bytes: null,
      simd: false,
      meta: { kernels: [] },
      paramPackers: new Map()
    };
    manager.pipelineProcessor = { prepareSectionAwarePluginData: () => [] };
    manager.fadeOutOutput = () => {
      throw new Error('late startup readiness must not mute published output');
    };

    const activation = manager._reinitializeDspWorklet(node, [], { muteOutput: false });
    manager._handleDspReadyTimeout(node);
    assert.equal(await activation, false);
    const enableCount = node.port.messages.filter(entry => entry.message.type === 'dspEnableTypes').length;

    manager.handleWorkletMessage({
      data: { type: 'dspReady', abiVersion: 1, kernels: [], simd: false }
    }, node);

    assert.equal(manager._dspReadyTransitionPromise, null);
    assert.equal(messageOf(node.port, 'updatePlugins'), undefined);
    assert.equal(
      node.port.messages.filter(entry => entry.message.type === 'dspEnableTypes').length,
      enableCount
    );
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
    manager.dspModuleInfo = { meta: { kernels: [] }, paramPackers: new Map() };
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
    assert.ok(messageOf(main.port, 'dspModule'));
    assert.ok(messageOf(auxiliary.port, 'dspModule'));

    const ready = { type: 'dspReady', abiVersion: 1, kernels: [{ name: 'VolumePlugin' }], simd: false };
    main.port.onmessage({ data: ready });
    auxiliary.port.onmessage({ data: ready });
    assert.equal(await runtimeLoad, true);
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

test('AudioManager keeps DBT teardown muted until the saved primary exact asset replay is active', async () => {
  await withGlobals({ window: {} }, async () => {
    const manager = createManager();
    const main = createNode('main');
    const auxiliary = createNode('auxiliary');
    configureParallelManager(manager, main);
    const primary = new AssetVolumePlugin(1, 'A', { useReplayEpoch: true });
    manager.pipelineA = [primary];
    manager.pipeline = manager.pipelineA;
    manager._parallelActive = true;
    manager._parallelWorkletB = auxiliary;
    manager._parallelSelA = createNode('sel-a');
    manager._parallelSelB = createNode('sel-b');
    manager._parallelInputTap = createNode('tap');
    manager._wasmAssetMembershipByNode.set(main, new Map([[primary.id, primary]]));
    const snapshot = manager._createParallelBranchSnapshot();
    assert.equal(manager._captureBlindBranchAssets(snapshot.pipelineA), true);
    manager._dspCapabilitiesByNode.set(main, { type: 'dspReady' });
    const fades = [];
    manager.fadeInOutput = () => fades.push('in');

    let settled = false;
    const restoring = manager.disableParallelPipelines().then(result => {
      settled = true;
      return result;
    });
    for (let index = 0; index < 6; index++) await Promise.resolve();
    const replay = main.port.messages.filter(entry =>
      entry.message.type === 'setPluginAsset').at(-1).message;
    assert.equal(replay.operationRevision, primary.assetDescriptor.operationRevision);
    assert.equal(replay.replayEpoch, 1);
    assert.equal(settled, false);
    assert.deepEqual(fades, []);

    manager.handleWorkletMessage({
      data: {
        type: 'assetState', pluginId: primary.id, slot: 0, state: 3,
        operationRevision: replay.operationRevision, replayEpoch: replay.replayEpoch + 1
      }
    }, main);
    await Promise.resolve();
    assert.equal(settled, false);
    assert.deepEqual(fades, []);

    manager.handleWorkletMessage({
      data: {
        type: 'assetState', pluginId: primary.id, slot: 0, state: 3,
        operationRevision: replay.operationRevision, replayEpoch: replay.replayEpoch
      }
    }, main);
    assert.equal(await restoring, true);
    assert.deepEqual(fades, ['in']);
  });
});

test('AudioManager lets only the owning teardown restore output after deferred primary DSP failure', async () => {
  await withGlobals({ window: {} }, async () => {
    const cases = [
      { name: 'current owner', invalidate() {}, expectedFades: [] },
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

test('AudioManager keeps owned output muted when primary DSP teardown throws or rejects', async () => {
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

      await assert.rejects(manager.disableParallelPipelines(), error => error === failure);
      assert.deepEqual(fades, []);
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
    manager.dspModuleInfo = { meta: { kernels: [] }, paramPackers: new Map() };
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

test('AudioManager keeps the current DSP backend until Electron reloads after settings changes', async () => {
  await withGlobals({
    window: {
      electronAPI: {},
      location: { pathname: '/app/index.html', search: '' },
      audioPreferences: { useWasmDsp: true }
    },
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
    manager.fadeOutOutput = () => {
      throw new Error('Electron settings must not switch the live DSP backend');
    };

    assert.equal(await manager.updateAudioConfig({ outputChannels: 4, useWasmDsp: false }), true);
    assert.equal(messageOf(main.port, 'updateAudioConfig'), undefined);
    assert.equal(messageOf(main.port, 'dspEnableTypes'), undefined);
    assert.equal(messageOf(main.port, 'updatePlugins'), undefined);
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
    manager.dspModuleInfo = { meta: { kernels: [] }, paramPackers: new Map() };
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

test('AudioManager replays pipeline B assets after its DBT config and waits for ACTIVE', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const pluginB = new AssetVolumePlugin(2, 'B');
    manager.pipelineB = [pluginB];

    const enabling = manager.enableParallelPipelines('A');
    const auxiliary = createdWorklets[0];
    for (let index = 0; index < 4; index++) await Promise.resolve();

    const messageTypes = auxiliary.port.messages.map(entry => entry.message.type);
    const assetIndex = messageTypes.lastIndexOf('setPluginAsset');
    assert.ok(assetIndex > messageTypes.lastIndexOf('updatePlugins'));
    assert.equal(pluginB.replays.length, 1);
    assert.equal(pluginB.replays[0].options.trackState, false);
    assert.equal(pluginB.replays[0].options.assets.size, 1);
    assert.equal(manager._parallelActive, false);

    auxiliary.port.onmessage({
      data: {
        type: 'assetState', pluginId: pluginB.id, slot: 0, state: 3,
        operationRevision: pluginB.assetDescriptor.operationRevision
      }
    });
    assert.equal(await enabling, true);
    assert.equal(manager._parallelActive, true);
    await manager.disableParallelPipelines({ restorePrimaryDsp: false });
  });
});

test('AudioManager waits for a late pipeline A descriptor and its ACTIVE state', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const pluginA = new AssetVolumePlugin(1, 'A', { configured: true, ready: false });
    manager.pipelineA = [pluginA];

    const enabling = manager.enableParallelPipelines('A');
    for (let index = 0; index < 4; index++) await Promise.resolve();
    assert.equal(pluginA.replays.length, 0);
    assert.equal(manager._parallelActive, false);

    pluginA.completeAsset();
    for (let index = 0; index < 4; index++) await Promise.resolve();
    assert.equal(pluginA.replays.length, 1);
    assert.equal(main.port.messages.filter(entry =>
      entry.message.type === 'setPluginAsset' && entry.message.pluginId === pluginA.id
    ).length, 1);
    assert.equal(createdWorklets[0].port.messages.some(entry =>
      entry.message.type === 'setPluginAsset' && entry.message.pluginId === pluginA.id
    ), false);
    assert.equal(manager._parallelActive, false);

    manager.handleWorkletMessage({
      data: {
        type: 'assetState', pluginId: pluginA.id, slot: 0, state: 3,
        operationRevision: pluginA.assetDescriptor.operationRevision
      }
    }, main);
    assert.equal(await enabling, true);
    await manager.disableParallelPipelines({ restorePrimaryDsp: false });
  });
});

test('AudioManager routes a late pipeline B descriptor only to B and replays its snapshot', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const pluginB = new AssetVolumePlugin(2, 'B', { configured: true, ready: false });
    manager.pipelineB = [pluginB];

    const enabling = manager.enableParallelPipelines('A');
    const auxiliary = createdWorklets[0];
    for (let index = 0; index < 4; index++) await Promise.resolve();
    pluginB.completeAsset();
    for (let index = 0; index < 4; index++) await Promise.resolve();

    assert.equal(main.port.messages.some(entry =>
      entry.message.type === 'setPluginAsset' && entry.message.pluginId === pluginB.id
    ), false);
    assert.equal(auxiliary.port.messages.filter(entry =>
      entry.message.type === 'setPluginAsset' && entry.message.pluginId === pluginB.id
    ).length, 2);
    assert.equal(pluginB.replays.length, 1);
    assert.equal(manager._parallelActive, false);

    auxiliary.port.onmessage({
      data: {
        type: 'assetState', pluginId: pluginB.id, slot: 0, state: 3,
        operationRevision: pluginB.assetDescriptor.operationRevision
      }
    });
    assert.equal(await enabling, true);
    await manager.disableParallelPipelines({ restorePrimaryDsp: false });
  });
});

test('AudioManager waits for signed replacement descriptors in both DBT pipelines and their ACTIVE states', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const pluginA = new AssetVolumePlugin(1, 'A', {
      configured: true,
      assetId: 'ir-a',
      assetSignature: 'ir-a|lt128|48000|2'
    });
    const pluginB = new AssetVolumePlugin(2, 'B', {
      configured: true,
      assetId: 'ir-x',
      assetSignature: 'ir-x|lt128|48000|2'
    });
    manager.pipelineA = [pluginA];
    manager.pipelineB = [pluginB];
    manager.pipeline = manager.pipelineA;
    manager._wasmAssetMembershipByNode.set(main, new Map([[pluginA.id, pluginA]]));
    pluginA.requestAsset('ir-b|lt128|48000|2', 'ir-b');
    pluginB.requestAsset('ir-y|lt128|48000|2', 'ir-y');

    const enabling = manager.enableParallelPipelines('A');
    for (let index = 0; index < 4; index++) await Promise.resolve();
    assert.equal(createdWorklets.length, 0);
    assert.equal(pluginA.replays.length, 0);
    assert.equal(pluginB.replays.length, 0);
    assert.equal(manager._parallelActive, false);

    pluginA.completeAsset();
    manager.handleWorkletMessage({
      data: {
        type: 'assetState', pluginId: pluginA.id, slot: 0, state: 3,
        operationRevision: pluginA.assetDescriptor.operationRevision
      }
    }, main);
    for (let index = 0; index < 2; index++) await Promise.resolve();
    const auxiliary = createdWorklets[0];
    assert.ok(auxiliary);
    assert.equal(pluginA.replays.length, 0);
    assert.equal(pluginB.replays.length, 0);

    pluginB.completeAsset();
    for (let index = 0; index < 4; index++) await Promise.resolve();
    assert.equal(pluginA.replays.length, 1);
    assert.equal(pluginB.replays.length, 1);
    assert.equal(manager._parallelActive, false);

    manager.handleWorkletMessage({
      data: {
        type: 'assetState', pluginId: pluginA.id, slot: 0, state: 3,
        operationRevision: pluginA.assetDescriptor.operationRevision
      }
    }, main);
    for (let index = 0; index < 2; index++) await Promise.resolve();
    assert.equal(manager._parallelActive, false);
    auxiliary.port.onmessage({
      data: {
        type: 'assetState', pluginId: pluginB.id, slot: 0, state: 3,
        operationRevision: pluginB.assetDescriptor.operationRevision
      }
    });
    assert.equal(await enabling, true);
    assert.equal(manager._parallelActive, true);
    await manager.disableParallelPipelines({ restorePrimaryDsp: false });
  });
});

test('AudioManager matches signed descriptors for same-identity restages and output-format changes', () => {
  const manager = createManager();
  const plugin = new AssetVolumePlugin(1, 'A', {
    configured: true,
    assetId: 'ir-a',
    assetSignature: 'ir-a|lt128|48000|2'
  });

  let branch = manager._createBlindBranchSnapshot([plugin]);
  assert.equal(manager._captureBlindBranchAssets(branch), true);

  plugin.requestAsset('ir-a|lt256|48000|2');
  branch = manager._createBlindBranchSnapshot([plugin]);
  assert.equal(manager._captureBlindBranchAssets(branch), null);
  plugin.completeAsset();
  assert.equal(manager._captureBlindBranchAssets(branch), true);

  plugin.requestAsset('ir-a|lt256|96000|8');
  branch = manager._createBlindBranchSnapshot([plugin]);
  assert.equal(manager._captureBlindBranchAssets(branch), null);
  plugin.completeAsset();
  assert.equal(manager._captureBlindBranchAssets(branch), true);

  const legacy = new AssetVolumePlugin(2, 'B', { configured: true });
  const legacyBranch = manager._createBlindBranchSnapshot([legacy]);
  assert.equal(manager._captureBlindBranchAssets(legacyBranch), true);
});

test('AudioManager fails a signed DBT replacement closed when the requested asset fails', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const plugin = new AssetVolumePlugin(1, 'A', {
      configured: true,
      assetId: 'ir-a',
      assetSignature: 'ir-a|lt128|48000|2'
    });
    manager.pipelineA = [plugin];
    plugin.requestAsset('ir-b|lt128|48000|2', 'ir-b');

    const enabling = manager.enableParallelPipelines('A');
    for (let index = 0; index < 4; index++) await Promise.resolve();
    assert.equal(manager._parallelActive, false);
    plugin.failAsset();
    assert.equal(await enabling, false);
    assert.equal(manager._parallelActive, false);
  });
});

test('AudioManager settles a signed replacement on the primary before freezing DBT configuration', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const plugin = new AssetVolumePlugin(1, 'A', {
      configured: true,
      assetId: 'ir-a',
      assetSignature: 'ir-a|lt128|48000|2',
      useReplayEpoch: true,
      includeAssetIdentityInParameters: true
    });
    manager.pipelineA = [plugin];
    manager.pipeline = manager.pipelineA;
    manager._wasmAssetMembershipByNode.set(main, new Map([[plugin.id, plugin]]));
    plugin.requestAsset('ir-b|lt128|48000|2', 'ir-b');

    const enabling = manager.enableParallelPipelines('A');
    for (let index = 0; index < 4; index++) await Promise.resolve();
    assert.equal(createdWorklets.length, 0);
    assert.equal(plugin.getParameters().assetId, 'ir-a');

    plugin.completeAsset();
    const replacement = main.port.messages.find(entry =>
      entry.message.type === 'setPluginAsset' &&
      entry.message.operationRevision === plugin.assetDescriptor.operationRevision &&
      entry.message.replayEpoch === undefined);
    assert.ok(replacement);
    manager.handleWorkletMessage({
      data: {
        type: 'assetState', pluginId: plugin.id, slot: 0, state: 3,
        operationRevision: plugin.assetDescriptor.operationRevision
      }
    }, main);
    for (let index = 0; index < 4; index++) await Promise.resolve();
    assert.equal(createdWorklets.length, 1);
    const replay = main.port.messages.filter(entry =>
      entry.message.type === 'setPluginAsset' && entry.message.replayEpoch !== undefined).at(-1).message;
    manager.handleWorkletMessage({
      data: {
        type: 'assetState', pluginId: plugin.id, slot: 0, state: 3,
        operationRevision: replay.operationRevision, replayEpoch: replay.replayEpoch
      }
    }, main);

    assert.equal(await enabling, true);
    const frozen = JSON.parse(
      manager._parallelBranchSnapshot.pipelineA.records[0].configurationSignature
    );
    assert.equal(frozen.parameters.assetId, 'ir-b');
    assert.equal(manager._parallelActive, true);
    await manager.disableParallelPipelines({ restorePrimaryDsp: false });
  });
});

test('AudioManager starts DBT from pipeline B without waiting for pipeline A assets on the B primary', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const pluginA = new AssetVolumePlugin(1, 'A', {
      configured: true,
      assetId: 'ir-a',
      assetSignature: 'ir-a|lt128|48000|2'
    });
    const pluginB = new VolumePlugin(2, 'B');
    manager.pipelineA = [pluginA];
    manager.pipelineB = [pluginB];
    manager.currentPipeline = 'B';
    manager.pipeline = manager.pipelineB;
    manager._wasmAssetMembershipByNode.set(main, new Map([[pluginB.id, pluginB]]));

    const enabling = manager.enableParallelPipelines('A');
    assert.equal(createdWorklets.length, 1);
    const auxiliary = createdWorklets[0];
    for (let index = 0; index < 4; index++) await Promise.resolve();
    const replayA = main.port.messages.filter(entry =>
      entry.message.type === 'setPluginAsset').at(-1)?.message;
    assert.ok(replayA);

    manager.handleWorkletMessage({
      data: {
        type: 'assetState', pluginId: pluginA.id, slot: 0, state: 3,
        operationRevision: replayA.operationRevision
      }
    }, main);

    assert.equal(await enabling, true);
    assert.equal(manager._parallelActive, true);
    assert.equal(
      main.port.messages.filter(entry => entry.message.type === 'setPluginAsset').length,
      1
    );
    assert.ok(messageOf(auxiliary.port, 'updatePlugins'));
    await manager.disableParallelPipelines({ restorePrimaryDsp: false });
  });
});

test('AudioManager commits an inactive DBT pipeline format before freezing its asset signature', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const pluginB = new AssetVolumePlugin(2, 'B', {
      configured: true,
      assetId: 'ir-b',
      assetSignature: 'ir-b|48000|2'
    });
    const baseGetParameters = pluginB.getParameters.bind(pluginB);
    pluginB.outputFormat = { sampleRate: 48000, outputChannelCount: 2 };
    pluginB.getParameters = (options = {}) => {
      if (options.commitSampleRate &&
          (options.sampleRate !== pluginB.outputFormat.sampleRate ||
            options.outputChannelCount !== pluginB.outputFormat.outputChannelCount)) {
        pluginB.outputFormat = {
          sampleRate: options.sampleRate,
          outputChannelCount: options.outputChannelCount
        };
        pluginB.requestAsset(
          `ir-b|${options.sampleRate}|${options.outputChannelCount}`,
          'ir-b'
        );
        pluginB.assets.clear();
        pluginB.assetRevision++;
      }
      return {
        ...baseGetParameters(),
        outputSampleRate: pluginB.outputFormat.sampleRate,
        outputChannelCount: pluginB.outputFormat.outputChannelCount
      };
    };
    manager.contextManager.audioContext.sampleRate = 96000;
    manager.contextManager.audioContext.destination.channelCount = 4;
    manager.pipelineB = [pluginB];
    const invalidations = [];
    manager.dispatchEvent = (type, data) => invalidations.push({ type, data });

    const enabling = manager.enableParallelPipelines('A');
    const auxiliary = createdWorklets[0];
    assert.ok(auxiliary);
    assert.deepEqual(pluginB.outputFormat, { sampleRate: 96000, outputChannelCount: 4 });
    assert.equal(
      manager._parallelBranchSnapshot.pipelineB.records[0].externalSignature,
      JSON.stringify({
        pending: false,
        missing: false,
        ids: ['ir-b'],
        kind: 'IR',
        assetSignature: 'ir-b|96000|4'
      })
    );
    const configuredB = auxiliary.port.messages.find(entry =>
      entry.message.type === 'updatePlugins'
    ).message.plugins[0].parameters;
    assert.equal(configuredB.outputSampleRate, 96000);
    assert.equal(configuredB.outputChannelCount, 4);
    assert.equal(manager._parallelActive, false);

    pluginB.completeAsset();
    for (let index = 0; index < 4; index++) await Promise.resolve();
    auxiliary.port.onmessage({
      data: {
        type: 'assetState', pluginId: pluginB.id, slot: 0, state: 3,
        operationRevision: pluginB.assetDescriptor.operationRevision
      }
    });

    assert.equal(await enabling, true);
    assert.equal(manager._parallelActive, true);
    assert.deepEqual(invalidations, []);
    await manager.disableParallelPipelines({ restorePrimaryDsp: false });
  });
});

test('AudioManager rejects late pre-replay ACTIVE and binds replay failure to the exact epoch', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const pluginA = new AssetVolumePlugin(1, 'A', { useReplayEpoch: true });
    const pluginB = new AssetVolumePlugin(2, 'B', { useReplayEpoch: true });
    manager.pipelineA = [pluginA];
    manager.pipelineB = [pluginB];
    manager.pipeline = manager.pipelineA;

    const enabling = manager.enableParallelPipelines('A');
    const auxiliary = createdWorklets[0];
    for (let index = 0; index < 4; index++) await Promise.resolve();
    const replayA = main.port.messages.filter(entry =>
      entry.message.type === 'setPluginAsset').at(-1).message;
    const replayB = auxiliary.port.messages.filter(entry =>
      entry.message.type === 'setPluginAsset').at(-1).message;
    assert.equal(replayA.replayEpoch, 1);
    assert.equal(replayB.replayEpoch, 1);

    manager.handleWorkletMessage({
      data: {
        type: 'assetState', pluginId: pluginA.id, slot: 0, state: 3,
        operationRevision: replayA.operationRevision
      }
    }, main);
    assert.equal(manager._parallelActive, false);
    manager.handleWorkletMessage({
      data: {
        type: 'assetState', pluginId: pluginA.id, slot: 0, state: 3,
        operationRevision: replayA.operationRevision, replayEpoch: replayA.replayEpoch
      }
    }, main);
    auxiliary.port.onmessage({
      data: {
        type: 'assetLoadRejected', pluginId: pluginB.id, slot: 0, reason: 'late',
        operationRevision: replayB.operationRevision
      }
    });
    assert.equal(manager._parallelActive, false);
    auxiliary.port.onmessage({
      data: {
        type: 'assetLoadRejected', pluginId: pluginB.id, slot: 0, reason: 'capacity',
        operationRevision: replayB.operationRevision, replayEpoch: replayB.replayEpoch,
        replayFailure: true
      }
    });

    assert.equal(await enabling, false);
    assert.equal(manager._parallelActive, false);
  });
});

test('AudioManager publishes DBT only after both comparison assets are ACTIVE', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const pluginA = new AssetVolumePlugin(1, 'A');
    const pluginB = new AssetVolumePlugin(2, 'B');
    manager.pipelineA = [pluginA];
    manager.pipelineB = [pluginB];

    const enabling = manager.enableParallelPipelines('A');
    const auxiliary = createdWorklets[0];
    for (let index = 0; index < 4; index++) await Promise.resolve();
    manager.handleWorkletMessage({
      data: {
        type: 'assetState', pluginId: pluginA.id, slot: 0, state: 3,
        operationRevision: pluginA.assetDescriptor.operationRevision
      }
    }, main);
    for (let index = 0; index < 2; index++) await Promise.resolve();
    assert.equal(manager._parallelActive, false);

    auxiliary.port.onmessage({
      data: {
        type: 'assetState', pluginId: pluginB.id, slot: 0, state: 3,
        operationRevision: pluginB.assetDescriptor.operationRevision
      }
    });
    assert.equal(await enabling, true);
    assert.equal(manager._parallelActive, true);
    await manager.disableParallelPipelines({ restorePrimaryDsp: false });
  });
});

test('AudioManager invalidates a settled DBT once before changed comparison data is sent', async () => {
  for (const change of ['asset', 'configuration']) {
    const createdWorklets = [];
    await withGlobals({
      AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
      window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
      document: { hidden: false }
    }, async () => {
      const manager = createManager();
      const main = createNode(`main-${change}`);
      configureParallelManager(manager, main);
      const pluginA = new AssetVolumePlugin(1, 'A');
      manager.pipelineA = [pluginA];
      const invalidations = [];
      manager.dispatchEvent = (type, data) => invalidations.push({ type, data });

      const enabling = manager.enableParallelPipelines('A');
      for (let index = 0; index < 4; index++) await Promise.resolve();
      manager.handleWorkletMessage({
        data: {
          type: 'assetState', pluginId: pluginA.id, slot: 0, state: 3,
          operationRevision: pluginA.assetDescriptor.operationRevision
        }
      }, main);
      assert.equal(await enabling, true);

      const auxiliary = createdWorklets[0];
      const snapshot = manager._parallelBranchSnapshot;
      const primaryAssetsBefore = main.port.messages.filter(entry =>
        entry.message.type === 'setPluginAsset').length;
      const auxiliaryAssetsBefore = auxiliary.port.messages.filter(entry =>
        entry.message.type === 'setPluginAsset').length;
      const auxiliaryUpdatesBefore = auxiliary.port.messages.filter(entry =>
        entry.message.type === 'updatePlugin').length;

      if (change === 'asset') {
        pluginA.completeAsset();
      } else {
        pluginA.branch = 'changed';
        for (const listener of [...pluginA.assetSnapshotListeners]) listener();
        assert.equal(invalidations.length, 1);
        main.port.postMessage({ type: 'updatePlugin', plugin: pluginA.getParameters() });
      }

      assert.deepEqual(invalidations, [{
        type: 'parallelInvalidated',
        data: { reason: 'branch-snapshot-changed', restorePrimaryDsp: true }
      }]);
      assert.equal(manager._parallelActive, false);
      assert.equal(manager._parallelPreparing, false);
      assert.equal(snapshot.disposed, true);
      assert.equal(pluginA.assetSnapshotListeners.size, 0);
      assert.equal(auxiliary.port.onmessage, null);
      if (change === 'asset') {
        assert.equal(main.port.messages.filter(entry =>
          entry.message.type === 'setPluginAsset').length, primaryAssetsBefore + 1);
        assert.equal(auxiliary.port.messages.filter(entry =>
          entry.message.type === 'setPluginAsset').length, auxiliaryAssetsBefore);
      } else {
        assert.equal(main.port.messages.at(-1).message.type, 'updatePlugin');
        assert.equal(auxiliary.port.messages.filter(entry =>
          entry.message.type === 'updatePlugin').length, auxiliaryUpdatesBefore);
      }
    });
  }
});

test('AudioManager invalidates and tears down active DBT before a normal rebuild', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    assert.equal(await manager.enableParallelPipelines('A'), true);
    const auxiliary = createdWorklets[0];
    const invalidations = [];
    let listenerTeardownResult;
    let rebuilds = 0;
    manager.dispatchEvent = (type, data) => {
      invalidations.push({ type, data });
      listenerTeardownResult = manager.disableParallelPipelines();
    };
    manager.registerPipelineProcessors = () => {};
    manager.updateExposedProperties = () => {};
    manager.pipelineProcessor = {
      setPipeline() {},
      setMasterBypass() {},
      prepareSectionAwarePluginData() { return []; },
      async rebuildPipeline() {
        rebuilds++;
        return '';
      }
    };

    assert.equal(await manager.rebuildPipeline(), '');
    assert.equal(rebuilds, 1);
    assert.deepEqual(invalidations, [{
      type: 'parallelInvalidated',
      data: { reason: 'pipelineChanged', restorePrimaryDsp: true }
    }]);
    assert.equal(manager._parallelActive, false);
    assert.equal(manager._parallelPreparing, false);
    assert.equal(manager._parallelWorkletB, null);
    assert.equal(auxiliary.port.onmessage, null);
    assert.ok(listenerTeardownResult instanceof Promise);
    assert.equal(await listenerTeardownResult, true);
  });
});

test('AudioManager shares snapshot invalidation teardown with the activating call and an immediate retry', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const pluginA = new AssetVolumePlugin(1, 'A');
    manager.pipelineA = [pluginA];
    manager.pipeline = manager.pipelineA;
    manager.getEnabledDspTypes = () => ['VolumePlugin'];
    manager._dspCapabilitiesByNode.set(main, { type: 'dspReady' });
    let releaseRestoration;
    let restorationCalls = 0;
    manager._transitionDspConfiguration = () => {
      restorationCalls++;
      return new Promise(resolve => { releaseRestoration = resolve; });
    };

    let activatingSettled = false;
    const activating = manager.enableParallelPipelines('A').then(result => {
      activatingSettled = true;
      return result;
    });
    assert.equal(createdWorklets.length, 1);
    pluginA.branch = 'changed';
    for (const listener of [...pluginA.assetSnapshotListeners]) listener();

    const teardown = manager._parallelTeardownPromise;
    assert.ok(teardown instanceof Promise);
    assert.equal(manager.disableParallelPipelines(), teardown);
    let retrySettled = false;
    const retry = manager.enableParallelPipelines('A').then(result => {
      retrySettled = true;
      return result;
    });
    for (let index = 0; index < 4; index++) await Promise.resolve();
    assert.equal(restorationCalls, 1);
    assert.equal(createdWorklets.length, 1);
    assert.equal(activatingSettled, false);
    assert.equal(retrySettled, false);

    releaseRestoration(true);
    assert.equal(await activating, false);
    for (let index = 0; index < 6; index++) await Promise.resolve();
    assert.equal(createdWorklets.length, 2);
    const auxiliary = createdWorklets[1];
    const replayA = main.port.messages.filter(entry =>
      entry.message.type === 'setPluginAsset').at(-1).message;
    const replayB = auxiliary.port.messages.filter(entry =>
      entry.message.type === 'setPluginAsset').at(-1);
    assert.equal(replayB, undefined);
    manager.handleWorkletMessage({
      data: {
        type: 'assetState', pluginId: pluginA.id, slot: 0, state: 3,
        operationRevision: replayA.operationRevision
      }
    }, main);

    assert.equal(await retry, true);
    assert.equal(retrySettled, true);
    assert.equal(restorationCalls, 1);
    await manager.disableParallelPipelines({ restorePrimaryDsp: false });
  });
});

test('AudioManager aborts DBT when a configured external asset is missing', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const missingPlugin = new AssetVolumePlugin(1, 'A', {
      configured: true,
      ready: false,
      missing: true
    });
    manager.pipelineA = [missingPlugin];
    const invalidations = [];
    manager.dispatchEvent = (type, data) => invalidations.push({ type, data });

    assert.equal(await manager.enableParallelPipelines('A'), false);
    assert.equal(manager._parallelActive, false);
    assert.deepEqual(invalidations[0], {
      type: 'parallelInvalidated',
      data: { reason: 'asset-not-ready', restorePrimaryDsp: true }
    });
    assert.equal(missingPlugin.assetSnapshotListeners.size, 0);
    assert.equal(manager._parallelBranchSnapshot, null);
  });
});

test('AudioManager fails DBT closed when an initial protected library load resolves without an asset', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const pendingPlugin = new AssetVolumePlugin(1, 'A', {
      pending: true,
      pendingIds: ['library-ir'],
      ready: false
    });
    manager.pipelineA = [pendingPlugin];

    const enabling = manager.enableParallelPipelines('A');
    for (let index = 0; index < 4; index++) await Promise.resolve();
    assert.equal(createdWorklets.length, 0);

    pendingPlugin.pending = false;
    pendingPlugin.pendingIds = [];
    for (const listener of [...pendingPlugin.assetSnapshotListeners]) listener();

    assert.equal(await enabling, false);
    assert.equal(manager._parallelActive, false);
    assert.equal(createdWorklets.length, 0);
    assert.equal(pendingPlugin.assetListeners.size, 0);
    assert.equal(pendingPlugin.assetSnapshotListeners.size, 0);
  });
});

test('AudioManager waits for a pre-ID direct pipeline load before freezing and activating DBT', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const pendingPlugin = new AssetVolumePlugin(2, 'B', { pending: true, ready: false });
    manager.pipelineB = [pendingPlugin];

    const enabling = manager.enableParallelPipelines('A');
    for (let index = 0; index < 4; index++) await Promise.resolve();
    assert.equal(createdWorklets.length, 0);
    assert.equal(manager._parallelActive, false);

    pendingPlugin.configured = true;
    pendingPlugin.assetId = 'direct-ir';
    pendingPlugin.assetSignature = 'direct-ir|lt128|48000|2';
    pendingPlugin.completeAsset();
    for (let index = 0; index < 4; index++) await Promise.resolve();

    const auxiliary = createdWorklets[0];
    assert.ok(auxiliary);
    assert.equal(manager._parallelActive, false);
    auxiliary.port.onmessage({
      data: {
        type: 'assetState', pluginId: pendingPlugin.id, slot: 0, state: 3,
        operationRevision: pendingPlugin.assetDescriptor.operationRevision
      }
    });

    assert.equal(await enabling, true);
    assert.equal(manager._parallelActive, true);
    assert.equal(
      manager._parallelBranchSnapshot.pipelineB.records[0].externalSignature,
      JSON.stringify({
        pending: false,
        missing: false,
        ids: ['direct-ir'],
        kind: 'IR',
        assetSignature: 'direct-ir|lt128|48000|2'
      })
    );
    await manager.disableParallelPipelines({ restorePrimaryDsp: false });
  });
});

test('AudioManager bounds DBT descriptor readiness to the shared asset deadline', async () => {
  const createdWorklets = [];
  const timers = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false },
    setTimeout(callback, milliseconds) {
      const timer = { callback, milliseconds, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    manager.pipelineA = [new AssetVolumePlugin(1, 'A', { configured: true, ready: false })];
    const invalidations = [];
    manager.dispatchEvent = (type, data) => invalidations.push({ type, data });

    const enabling = manager.enableParallelPipelines('A');
    for (let index = 0; index < 4; index++) await Promise.resolve();
    const descriptorTimer = timers.find(timer => !timer.cleared);
    assert.ok(descriptorTimer.milliseconds > 0 && descriptorTimer.milliseconds <= 3000);
    descriptorTimer.callback();

    assert.equal(await enabling, false);
    assert.equal(manager._parallelActive, false);
    assert.equal(invalidations[0].type, 'parallelInvalidated');
    assert.equal(invalidations[0].data.reason, 'asset-not-ready');
  });
});

test('AudioManager aborts descriptor waits after snapshot mutation or graph replacement', async () => {
  const timers = [];
  await withGlobals({
    window: {},
    setTimeout(callback, milliseconds) {
      const timer = { callback, milliseconds };
      timers.push(timer);
      return timer;
    },
    clearTimeout() {}
  }, async () => {
    const mutatedManager = createManager();
    const mutatedMain = createNode('mutated-main');
    configureParallelManager(mutatedManager, mutatedMain);
    const mutatedPlugin = new AssetVolumePlugin(1, 'A', { configured: true, ready: false });
    mutatedManager.pipelineA = [mutatedPlugin];
    mutatedManager.pipelineB = [];
    const mutatedSnapshot = mutatedManager._createParallelBranchSnapshot();
    const mutatedWait = mutatedManager._waitForParallelBranchAssets(
      mutatedSnapshot,
      Date.now() + 3000
    );

    mutatedPlugin.branch = 'changed';
    mutatedPlugin.completeAsset();
    assert.equal(await mutatedWait, false);

    const replacedManager = createManager();
    const replacedMain = createNode('replaced-main');
    configureParallelManager(replacedManager, replacedMain);
    const replacedPlugin = new AssetVolumePlugin(1, 'A', { configured: true, ready: false });
    replacedManager.pipelineA = [replacedPlugin];
    replacedManager.pipelineB = [];
    const replacedSnapshot = replacedManager._createParallelBranchSnapshot();
    const replacedWait = replacedManager._waitForParallelBranchAssets(
      replacedSnapshot,
      Date.now() + 3000
    );

    replacedManager._advanceAudioGraphGeneration();
    assert.equal(await replacedWait, false);
    assert.equal(replacedManager._pendingWasmAssetDescriptorRequests.size, 0);
    assert.equal(replacedPlugin.assetListeners.size, 0);
    assert.equal(replacedPlugin.assetSnapshotListeners.size, 0);
  });
});

test('AudioManager aborts DBT preparation when pipeline B rejects an asset', async () => {
  const createdWorklets = [];
  await withGlobals({
    AudioWorkletNode: createFakeAudioWorkletClass(createdWorklets),
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const pluginB = new AssetVolumePlugin(2, 'B');
    manager.pipelineB = [pluginB];
    const invalidations = [];
    manager.dispatchEvent = (type, data) => invalidations.push({ type, data });

    const enabling = manager.enableParallelPipelines('A');
    const auxiliary = createdWorklets[0];
    for (let index = 0; index < 4; index++) await Promise.resolve();
    auxiliary.port.onmessage({
      data: {
        type: 'assetLoadRejected', pluginId: pluginB.id, slot: 0, reason: 'capacity',
        operationRevision: pluginB.assetDescriptor.operationRevision
      }
    });

    assert.equal(await enabling, false);
    assert.deepEqual(pluginB.transportAcknowledgements, [{
      workletNode: auxiliary,
      slot: 0,
      operationRevision: pluginB.assetDescriptor.operationRevision
    }]);
    assert.deepEqual(pluginB.droppedAssetTargets, [auxiliary]);
    assert.equal(manager._parallelActive, false);
    assert.equal(invalidations[0].type, 'parallelInvalidated');
    assert.equal(invalidations[0].data.reason, 'asset-not-ready');
    assert.equal(invalidations[0].data.restorePrimaryDsp, true);
  });
});

test('AudioManager ignores stale asset state, rejection, and clear acknowledgements', () => {
  const manager = createManager();
  const node = createNode('main');
  manager.workletNode = node;
  manager.contextManager = { workletNode: node };
  const key = manager._wasmAssetKey(7, 0);

  manager._expectWasmAssetOperation(node, 7, 0, 3, 1);
  manager.handleWorkletMessage({
    data: { type: 'assetState', pluginId: 7, slot: 0, state: 3, operationRevision: 1 }
  }, node);
  manager.handleWorkletMessage({
    data: { type: 'assetLoadRejected', pluginId: 7, slot: 0, reason: 'stale', operationRevision: 2 }
  }, node);
  manager.handleWorkletMessage({
    data: { type: 'assetState', pluginId: 7, slot: 0, state: 0, operationRevision: 2 }
  }, node);
  manager.handleWorkletMessage({
    data: { type: 'assetState', pluginId: 7, slot: 0, state: 3 }
  }, node);
  assert.equal(manager._wasmAssetStatesByNode.get(node).get(key), 1);

  manager.handleWorkletMessage({
    data: { type: 'assetState', pluginId: 7, slot: 0, state: 3, operationRevision: 3 }
  }, node);
  assert.equal(manager._wasmAssetStatesByNode.get(node).get(key), 3);

  manager._expectWasmAssetOperation(node, 7, 0, 4, 0);
  manager.handleWorkletMessage({
    data: { type: 'assetState', pluginId: 7, slot: 0, state: 3, operationRevision: 3 }
  }, node);
  assert.equal(manager._wasmAssetStatesByNode.get(node).get(key), 0);
  manager.handleWorkletMessage({
    data: { type: 'assetState', pluginId: 7, slot: 0, state: 0, operationRevision: 4 }
  }, node);
  assert.equal(manager._wasmAssetStatesByNode.get(node).get(key), 0);

  manager._expectWasmAssetOperation(node, 7, 0, 5, 1);
  manager.handleWorkletMessage({
    data: { type: 'assetLoadRejected', pluginId: 7, slot: 0, reason: 'current', operationRevision: 5 }
  }, node);
  assert.equal(manager._wasmAssetStatesByNode.get(node).get(key), 4);

  manager._expectWasmAssetOperation(node, 7, 0, 6, 1);
  manager.handleWorkletMessage({
    data: {
      type: 'assetLoadRejected', pluginId: 7, slot: 0, reason: 'replacement',
      operationRevision: 6, residentRetained: true, retainedOperationRevision: 3,
      retainedAssetState: 2
    }
  }, node);
  assert.equal(manager._wasmAssetStatesByNode.get(node).get(key), 2);
  assert.equal(manager._wasmAssetExpectedRevisionsByNode.get(node).get(key), 3);
  manager.handleWorkletMessage({
    data: {
      type: 'assetLoadRejected', pluginId: 7, slot: 0, reason: 'duplicate',
      operationRevision: 6, residentRetained: true, retainedOperationRevision: 3,
      retainedAssetState: 3
    }
  }, node);
  assert.equal(manager._wasmAssetStatesByNode.get(node).get(key), 2);
  manager.handleWorkletMessage({
    data: { type: 'assetState', pluginId: 7, slot: 0, state: 3, operationRevision: 3 }
  }, node);
  assert.equal(manager._wasmAssetStatesByNode.get(node).get(key), 3);

  const legacyKey = manager._wasmAssetKey(8, 0);
  manager._expectWasmAssetOperation(node, 8, 0, undefined, 1);
  manager.handleWorkletMessage({
    data: { type: 'assetState', pluginId: 8, slot: 0, state: 3 }
  }, node);
  assert.equal(manager._wasmAssetStatesByNode.get(node).get(legacyKey), 3);
});

test('AudioManager fails readiness when reconcile replay invalidates a committed asset', async () => {
  const manager = createManager();
  const node = createNode('main');
  manager.workletNode = node;
  manager.contextManager = { workletNode: node };
  const key = manager._wasmAssetKey(7, 0);

  manager._expectWasmAssetOperation(node, 7, 0, 3, 1);
  const readiness = manager._waitForWasmAssetsActive(node, new Set([key]));
  manager.handleWorkletMessage({
    data: {
      type: 'assetLoadRejected',
      pluginId: 7,
      slot: 0,
      reason: 'capacity',
      operationRevision: 3,
      residentRetained: true,
      retainedOperationRevision: 2,
      retainedAssetState: 3,
      replayFailure: true
    }
  }, node);

  assert.equal(await readiness, false);
  assert.equal(manager._wasmAssetStatesByNode.get(node).get(key), 4);
  assert.equal(manager._wasmAssetExpectedRevisionsByNode.get(node).get(key), 3);
});

test('AudioManager bounds asset readiness and rejects stale worklet generations', async () => {
  const timers = [];
  await withGlobals({
    window: {},
    setTimeout(callback, milliseconds) {
      timers.push({ callback, milliseconds });
      return callback;
    },
    clearTimeout() {}
  }, async () => {
    const timedManager = createManager();
    const timedNode = createNode('timed');
    timedManager.workletNode = timedNode;
    timedManager.contextManager = { workletNode: timedNode };
    const timedKey = timedManager._wasmAssetKey(2, 0);
    timedManager._wasmAssetStatesByNode.set(timedNode, new Map([[timedKey, 1]]));
    const timed = timedManager._waitForWasmAssetsActive(timedNode, new Set([timedKey]));
    assert.equal(timers[0].milliseconds, 3000);
    timers[0].callback();
    assert.equal(await timed, false);

    const staleManager = createManager();
    const staleNode = createNode('stale');
    const replacement = createNode('replacement');
    staleManager.workletNode = staleNode;
    staleManager.contextManager = { workletNode: staleNode };
    const staleKey = staleManager._wasmAssetKey(2, 0);
    const staleStates = new Map([[staleKey, 1]]);
    staleManager._wasmAssetStatesByNode.set(staleNode, staleStates);
    const stale = staleManager._waitForWasmAssetsActive(staleNode, new Set([staleKey]));

    staleManager.workletNode = replacement;
    staleManager.contextManager.workletNode = replacement;
    staleManager._advanceAudioGraphGeneration();
    staleManager.handleWorkletMessage({
      data: { type: 'assetState', pluginId: 2, slot: 0, state: 3 }
    }, staleNode);
    const stalePlugin = new AssetVolumePlugin(2, 'B');
    assert.equal(staleManager._replayPipelineWasmAssets(
      staleNode,
      [stalePlugin],
      { generation: staleManager._audioGraphGeneration }
    ), null);

    assert.equal(await stale, false);
    assert.equal(staleStates.get(staleKey), 1);
    assert.equal(stalePlugin.replays.length, 0);
  });
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
    assert.equal(manager._parallelActive, false);
    assert.equal(manager._parallelPreparing, false);
    assert.equal(manager._parallelWorkletB, null);
    assert.equal(manager._parallelSelA, null);
    assert.equal(manager._parallelSelB, null);
    assert.equal(manager._parallelInputTap, null);

    let retrySettled = false;
    const retry = manager.enableParallelPipelines('A').then(result => {
      retrySettled = true;
      return result;
    });
    for (let index = 0; index < 4; index++) await Promise.resolve();
    assert.equal(retrySettled, false);
    releaseFade();
    assert.equal(await restoring, true);
    assert.equal(await retry, false);
    assert.equal(manager.ioManager.outputGainNode.gain.value, 1);
  });
});

test('AudioManager does not finish a failed parallel retry before deferred teardown settles', async () => {
  class ThrowingAudioWorkletNode {
    constructor() {
      throw new Error('parallel constructor failed');
    }
  }

  await withGlobals({
    AudioWorkletNode: ThrowingAudioWorkletNode,
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false },
    console: { error() {}, warn() {}, log() {}, info() {} }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    let releaseTeardown;
    const teardown = new Promise(resolve => { releaseTeardown = resolve; });
    let teardownCalls = 0;
    let fallbackCalls = 0;
    manager.disableParallelPipelines = () => {
      teardownCalls++;
      return teardown;
    };
    manager._fadeInOutputIfOwned = () => {
      fallbackCalls++;
      return true;
    };

    let settled = false;
    const enabling = manager.enableParallelPipelines('A').then(result => {
      settled = true;
      return result;
    });
    for (let index = 0; index < 4; index++) await Promise.resolve();
    assert.equal(teardownCalls, 1);
    assert.equal(settled, false);
    assert.equal(fallbackCalls, 0);

    releaseTeardown(false);
    assert.equal(await enabling, false);
    assert.equal(fallbackCalls, 1);
  });
});

test('AudioManager contains rejected failed-retry teardown and restores the output fallback', async () => {
  class ThrowingAudioWorkletNode {
    constructor() {
      throw new Error('parallel constructor failed');
    }
  }

  await withGlobals({
    AudioWorkletNode: ThrowingAudioWorkletNode,
    window: { location: { pathname: '/app/index.html', search: '' }, audioPreferences: { useWasmDsp: false } },
    document: { hidden: false },
    console: { error() {}, warn() {}, log() {}, info() {} }
  }, async () => {
    const manager = createManager();
    const main = createNode('main');
    configureParallelManager(manager, main);
    const teardownFailure = new Error('primary restore rejected');
    let fallbackCalls = 0;
    manager.disableParallelPipelines = () => Promise.reject(teardownFailure);
    manager._fadeInOutputIfOwned = () => {
      fallbackCalls++;
      return true;
    };

    assert.equal(await manager.enableParallelPipelines('A'), false);
    assert.equal(fallbackCalls, 1);
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
