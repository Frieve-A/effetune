import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadPluginBase({ packer } = {}) {
  const source = fs.readFileSync(new URL('../../plugins/plugin-base.js', import.meta.url), 'utf8');
  const warnings = [];
  const messages = [];
  const windowRef = {
    dspParamPackers: packer ? new Map([['PluginBase', packer]]) : new Map(),
    workletNode: {
      port: {
        addEventListener() {},
        removeEventListener() {},
        postMessage(message) {
          messages.push(message);
        }
      }
    }
  };
  const context = {
    window: windowRef,
    document: {},
    Float32Array,
    Uint8Array,
    ArrayBuffer,
    console: {
      error() {},
      log() {},
      warn(...args) {
        warnings.push(args);
      }
    },
    performance: { now: () => 0 },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(`${source}\nthis.PluginBaseRef = PluginBase;`, context);
  return { PluginBase: context.PluginBaseRef, messages, warnings, windowRef };
}

function createPlugin(runtime) {
  const plugin = new runtime.PluginBase('DSP Test', 'Packed parameter test');
  plugin.id = 'plugin-7';
  plugin.inputBus = 1;
  plugin.outputBus = 2;
  plugin.channel = '34';
  plugin.getParameters = () => ({ gain: 0.25, enabled: true });
  return plugin;
}

test('PluginBase adds packed parameters to direct worklet updates', () => {
  const runtime = loadPluginBase({
    packer: {
      hash: 0xf1234567,
      pack(parameters) {
        return new Float32Array([parameters.gain]);
      }
    }
  });
  const plugin = createPlugin(runtime);

  plugin.updateParameters();

  assert.equal(runtime.messages.length, 1);
  const payload = runtime.messages[0].plugin;
  assert.equal(payload.type, 'PluginBase');
  assert.equal(payload.wasmParamsHash, 0xf1234567);
  assert.deepEqual(Array.from(payload.wasmParams), [0.25]);
  assert.deepEqual(payload.parameters, { gain: 0.25, enabled: true });
});

test('PluginBase keeps JS payloads usable and reports a broken packer once', () => {
  const runtime = loadPluginBase({
    packer: {
      hash: 1,
      pack() {
        throw new Error('bad layout');
      }
    }
  });
  const plugin = createPlugin(runtime);

  const first = plugin.getWorkletPluginData();
  const second = plugin.getWorkletPluginData();

  assert.equal(Object.hasOwn(first, 'wasmParams'), false);
  assert.equal(Object.hasOwn(second, 'wasmParamsHash'), false);
  assert.equal(runtime.warnings.length, 1);
  assert.match(runtime.warnings[0][0], /^\[dsp-wasm] Parameter packing failed/);
});

test('PluginBase includes bounded structured parameter bytes atomically', () => {
  const runtime = loadPluginBase({
    packer: {
      hash: 0x07080f45,
      byteCapacity: 3076,
      pack() {
        return new Float32Array(0);
      },
      packBytes() {
        return Uint8Array.of(1, 0, 2, 0, 0, 0, 0, 1, 1, 0);
      }
    }
  });
  const payload = createPlugin(runtime).getWorkletPluginData();

  assert.equal(payload.wasmParamsHash, 0x07080f45);
  assert.deepEqual(Array.from(payload.wasmParams), []);
  assert.deepEqual(Array.from(payload.wasmParamBytes), [1, 0, 2, 0, 0, 0, 0, 1, 1, 0]);
});

test('PluginBase drops both numeric and structured data when byte packing is invalid', () => {
  const runtime = loadPluginBase({
    packer: {
      hash: 0x07080f45,
      byteCapacity: 4,
      pack() {
        return new Float32Array(0);
      },
      packBytes() {
        return new Uint8Array(5);
      }
    }
  });
  const plugin = createPlugin(runtime);
  const first = plugin.getWorkletPluginData();
  const second = plugin.getWorkletPluginData();

  assert.equal(Object.hasOwn(first, 'wasmParams'), false);
  assert.equal(Object.hasOwn(first, 'wasmParamBytes'), false);
  assert.equal(Object.hasOwn(second, 'wasmParamsHash'), false);
  assert.equal(runtime.warnings.length, 1);
});

test('PluginBase requires an exact host-computed asset footprint', () => {
  const runtime = loadPluginBase();
  const plugin = createPlugin(runtime);
  plugin.id = 7;
  const payload = new ArrayBuffer(36);

  assert.throws(
    () => plugin.setWasmAsset(0, { payload }),
    /footprint must cover the payload/
  );
  assert.throws(
    () => plugin.setWasmAsset(0, { payload, footprintBytes: 35 }),
    /footprint must cover the payload/
  );
  plugin.setWasmAsset(0, {
    payload,
    footprintBytes: 1024,
    headBlock: 256,
    rateDivider: 2,
    processingChannels: 2,
    externalAssetSignature: '[1,"asset-a"]'
  });
  assert.equal(runtime.messages.length, 1);
  assert.equal(runtime.messages[0].footprintBytes, 1024);
  assert.equal(runtime.messages[0].headBlock, 256);
  assert.equal(runtime.messages[0].rateDivider, 2);
  assert.equal(runtime.messages[0].processingChannels, 2);
  assert.equal(runtime.messages[0].operationRevision, 1);
  assert.equal(plugin.getWasmAssets().get(0).footprintBytes, 1024);
  assert.equal(plugin.getWasmAssets().get(0).operationRevision, 1);
  assert.equal(plugin.getWasmAssets().get(0).externalAssetSignature, '[1,"asset-a"]');
});

test('PluginBase replays every retained WASM asset to a recreated worklet in insertion order', () => {
  const runtime = loadPluginBase();
  const plugin = createPlugin(runtime);
  plugin.id = 7;
  const states = [];
  plugin.onWasmAssetState = (slot, state) => states.push([slot, state]);
  plugin.setWasmAsset(3, {
    payload: Uint8Array.of(3, 4).buffer,
    footprintBytes: 300,
    formatTag: 9,
    headBlock: 256,
    rateDivider: 2,
    pathCount: 4,
    inputCount: 2,
    processingChannels: 6
  });
  plugin.setWasmAsset(1, {
    payload: Uint8Array.of(1).buffer,
    footprintBytes: 100,
    formatTag: 5,
    headBlock: 64,
    rateDivider: 4,
    pathCount: 2,
    inputCount: 1,
    processingChannels: 2
  });

  const messages = [];
  const recreatedWorklet = {
    port: {
      addEventListener() {},
      removeEventListener() {},
      postMessage(message, transfer) {
        messages.push({ message, transfer });
      }
    }
  };
  runtime.windowRef.workletNode = recreatedWorklet;
  const slots = plugin.replayWasmAssetsTo(recreatedWorklet, { trackState: true });

  assert.deepEqual(Array.from(slots), [3, 1]);
  assert.deepEqual(states, [[3, 1], [1, 1]]);
  assert.deepEqual(messages.map(entry => entry.message.slot), [3, 1]);
  assert.deepEqual(messages.map(entry => entry.message.operationRevision), [1, 1]);
  assert.deepEqual([
    messages[0].message.type,
    messages[0].message.pluginId,
    messages[0].message.slot,
    messages[0].message.formatTag,
    messages[0].message.headBlock,
    messages[0].message.rateDivider,
    messages[0].message.pathCount,
    messages[0].message.inputCount,
    messages[0].message.processingChannels,
    messages[0].message.footprintBytes
  ], ['setPluginAsset', 7, 3, 9, 256, 2, 4, 2, 6, 300]);
  assert.deepEqual([...new Uint8Array(messages[0].message.payload)], [3, 4]);
  assert.equal(messages[0].transfer.length, 1);
  assert.equal(messages[0].transfer[0], messages[0].message.payload);
  assert.equal(messages[1].transfer.length, 1);
  assert.equal(messages[1].transfer[0], messages[1].message.payload);
  assert.notEqual(messages[0].message.payload, plugin.getWasmAssets().get(3).payload);
});

test('PluginBase routes descriptor changes only to instance-scoped asset targets', () => {
  const runtime = loadPluginBase();
  const plugin = createPlugin(runtime);
  plugin.id = 7;
  const targetMessages = [];
  const target = {
    port: {
      postMessage(message) {
        targetMessages.push(message);
      }
    }
  };
  const revisions = [];
  plugin.addWasmAssetChangeListener(revision => revisions.push(revision));
  plugin.setWasmAssetTargetResolver(() => []);

  plugin.setWasmAsset(0, {
    payload: new ArrayBuffer(32),
    footprintBytes: 64
  });
  assert.equal(runtime.messages.length, 0);
  assert.deepEqual(revisions, [1]);

  plugin.setWasmAssetTargetResolver(() => [target]);
  const targetRevision = plugin.setWasmAsset(1, {
    payload: new ArrayBuffer(32),
    footprintBytes: 96
  });
  plugin.clearWasmAsset(1);
  plugin.clearWasmAsset(9);
  plugin.acknowledgeWasmAssetOperation(target, 1, targetRevision);

  assert.deepEqual(targetMessages.map(message => message.type), [
    'setPluginAsset',
    'clearPluginAsset',
    'clearPluginAsset'
  ]);
  assert.deepEqual(revisions, [1, 2, 3]);
  assert.equal(plugin.getWasmAssetRevision(), 3);
});

test('PluginBase accepts asset acknowledgements only for the current worklet operation', () => {
  const runtime = loadPluginBase();
  const plugin = createPlugin(runtime);
  plugin.id = 7;
  const accepted = [];
  plugin.onWasmAssetState = (slot, state, revision) => accepted.push(['state', slot, state, revision]);
  plugin.onWasmAssetRejected = (slot, reason, revision) => accepted.push(['reject', slot, reason, revision]);

  plugin.setWasmAsset(0, { payload: new ArrayBuffer(32), footprintBytes: 32 });
  const firstRevision = plugin.getWasmAssetOperationRevision(0);
  plugin.clearWasmAsset(0);
  const clearRevision = plugin.getWasmAssetOperationRevision(0);
  plugin.setWasmAsset(0, { payload: new ArrayBuffer(32), footprintBytes: 32 });
  const currentRevision = plugin.getWasmAssetOperationRevision(0);

  const deliver = data => plugin._handleMessage({
    currentTarget: runtime.windowRef.workletNode.port,
    data: { pluginId: 7, slot: 0, ...data }
  });
  deliver({ type: 'assetState', state: 3, operationRevision: firstRevision });
  deliver({ type: 'assetLoadRejected', reason: 'stale', operationRevision: firstRevision });
  deliver({ type: 'assetState', state: 0, operationRevision: clearRevision });
  deliver({ type: 'assetState', state: 3 });
  deliver({ type: 'assetState', state: 3, operationRevision: currentRevision });
  deliver({ type: 'assetLoadRejected', reason: 'current', operationRevision: currentRevision });
  plugin.clearWasmAsset(0);
  const currentClearRevision = plugin.getWasmAssetOperationRevision(0);
  deliver({ type: 'assetState', state: 3, operationRevision: currentRevision });
  deliver({ type: 'assetState', state: 0, operationRevision: currentClearRevision });

  assert.deepEqual(accepted, [
    ['state', 0, 3, currentRevision],
    ['state', 0, 0, currentClearRevision]
  ]);
  plugin.cleanup();
});

test('PluginBase rolls back retained replacements locally and prunes destructive or stale rejects', () => {
  const runtime = loadPluginBase();
  const plugin = createPlugin(runtime);
  plugin.id = 7;
  const rejected = [];
  const snapshots = [];
  plugin.onWasmAssetRejected = (slot, reason, revision, retention) => {
    rejected.push({ slot, reason, revision, retention });
  };
  plugin.addWasmAssetChangeListener(revision => snapshots.push(revision));
  const deliver = data => plugin._handleMessage({
    currentTarget: runtime.windowRef.workletNode.port,
    data: { pluginId: 7, slot: 0, ...data }
  });

  const oldRevision = plugin.setWasmAsset(0, {
    payload: Uint8Array.of(1).buffer,
    footprintBytes: 1
  });
  deliver({ type: 'assetState', state: 3, operationRevision: oldRevision });
  const oldDescriptor = plugin.getWasmAssets().get(0);
  const candidateRevision = plugin.setWasmAsset(0, {
    payload: Uint8Array.of(2).buffer,
    footprintBytes: 1
  });
  const postsAfterCandidate = runtime.messages.length;

  deliver({
    type: 'assetLoadRejected', reason: 'stale', operationRevision: oldRevision,
    residentRetained: true, retainedOperationRevision: oldRevision
  });
  deliver({
    type: 'assetLoadRejected', reason: 'capacity', operationRevision: candidateRevision,
    residentRetained: true, retainedOperationRevision: oldRevision, retainedAssetState: 3
  });

  assert.equal(plugin.getWasmAssets().get(0), oldDescriptor);
  assert.equal(plugin.getWasmAssetOperationRevision(0), oldRevision);
  assert.equal(plugin._wasmAssetOperationCounters.get(0), candidateRevision);
  assert.equal(plugin._wasmAssetStates.get(0), 3);
  assert.equal(runtime.messages.length, postsAfterCandidate);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].slot, 0);
  assert.equal(rejected[0].reason, 'capacity');
  assert.equal(rejected[0].revision, candidateRevision);
  assert.equal(rejected[0].retention.residentRetained, true);
  assert.equal(rejected[0].retention.retainedOperationRevision, oldRevision);
  assert.equal(rejected[0].retention.retainedAssetState, 3);
  assert.deepEqual(snapshots, [1, 2, 3]);

  const successfulRevision = plugin.setWasmAsset(0, {
    payload: Uint8Array.of(3).buffer,
    footprintBytes: 1
  });
  assert.equal(successfulRevision, candidateRevision + 1);
  deliver({ type: 'assetState', state: 3, operationRevision: successfulRevision });
  deliver({
    type: 'assetLoadRejected', reason: 'late', operationRevision: successfulRevision,
    residentRetained: true, retainedOperationRevision: oldRevision
  });
  assert.equal(rejected.length, 1);

  const destructiveRevision = plugin.setWasmAsset(0, {
    payload: Uint8Array.of(4).buffer,
    footprintBytes: 1
  });
  const postsBeforeDestructive = runtime.messages.length;
  deliver({
    type: 'assetLoadRejected', reason: 'capacity', operationRevision: destructiveRevision,
    residentRetained: false
  });
  assert.equal(plugin.getWasmAssets().size, 0);
  assert.equal(plugin._wasmAssetStates.has(0), false);
  assert.equal(runtime.messages.length, postsBeforeDestructive);
  assert.equal(rejected.at(-1).retention.residentRetained, false);
  assert.equal(Object.hasOwn(rejected.at(-1).retention, 'retainedOperationRevision'), false);
  plugin.cleanup();
});

test('PluginBase restores the exact rapid predecessor in PREPARING or ACTIVE state', () => {
  for (const retainedAssetState of [2, 3]) {
    const runtime = loadPluginBase();
    const plugin = createPlugin(runtime);
    plugin.id = 7;
    const deliver = data => plugin._handleMessage({
      currentTarget: runtime.windowRef.workletNode.port,
      data: { pluginId: 7, slot: 0, ...data }
    });
    const setAsset = (sample, headBlock) => plugin.setWasmAsset(0, {
      payload: Uint8Array.of(sample).buffer,
      footprintBytes: 1,
      headBlock,
      rateDivider: sample,
      pathCount: sample + 1,
      inputCount: sample + 2
    });

    const revisionA = setAsset(1, 128);
    deliver({ type: 'assetState', state: 3, operationRevision: revisionA });
    const revisionB = setAsset(2, 256);
    deliver({ type: 'assetState', state: 2, operationRevision: revisionB });
    const descriptorB = plugin.getWasmAssets().get(0);
    const revisionC = setAsset(3, 512);

    if (retainedAssetState === 3) {
      deliver({ type: 'assetState', state: 3, operationRevision: revisionB });
      assert.equal(plugin.getWasmAssetOperationRevision(0), revisionC);
    }
    deliver({
      type: 'assetLoadRejected',
      reason: 'capacity',
      operationRevision: revisionC,
      residentRetained: true,
      retainedOperationRevision: revisionB,
      retainedAssetState
    });

    assert.equal(plugin.getWasmAssets().get(0), descriptorB);
    assert.equal(plugin.getWasmAssetOperationRevision(0), revisionB);
    assert.equal(plugin._wasmAssetStates.get(0), retainedAssetState);
    assert.equal(plugin._wasmAssetRevisionDescriptors.get(0).size, 1);
    assert.equal(plugin._wasmAssetRevisionDescriptors.get(0).get(revisionB), descriptorB);
    if (retainedAssetState === 2) {
      assert.equal(plugin._wasmAssetPendingPredecessors.get(0).candidateRevision, revisionB);
      deliver({ type: 'assetState', state: 3, operationRevision: revisionB });
      assert.equal(plugin._wasmAssetStates.get(0), 3);
      assert.equal(plugin._wasmAssetPendingPredecessors.has(0), false);
    } else {
      assert.equal(plugin._wasmAssetPendingPredecessors.has(0), false);
    }
    plugin.cleanup();
  }
});

test('PluginBase bounds candidate descriptors while pinning a long-lived resident revision', () => {
  const runtime = loadPluginBase();
  const plugin = createPlugin(runtime);
  plugin.id = 7;
  const deliver = data => plugin._handleMessage({
    currentTarget: runtime.windowRef.workletNode.port,
    data: { pluginId: 7, slot: 0, ...data }
  });
  const residentRevision = plugin.setWasmAsset(0, {
    payload: Uint8Array.of(1).buffer,
    footprintBytes: 1
  });
  deliver({ type: 'assetState', state: 3, operationRevision: residentRevision });
  const residentDescriptor = plugin.getWasmAssets().get(0);

  let latestRevision = residentRevision;
  for (let sample = 2; sample <= 12; sample++) {
    latestRevision = plugin.setWasmAsset(0, {
      payload: Uint8Array.of(sample).buffer,
      footprintBytes: 1
    });
  }
  assert.equal(plugin._wasmAssetRevisionDescriptors.get(0).size, 2);
  assert.equal(
    plugin._wasmAssetResidentDescriptors.get(0).descriptor,
    residentDescriptor
  );

  deliver({
    type: 'assetLoadRejected',
    reason: 'module-budget',
    operationRevision: latestRevision,
    residentRetained: true,
    retainedOperationRevision: residentRevision,
    retainedAssetState: 3
  });

  assert.equal(plugin.getWasmAssets().get(0), residentDescriptor);
  assert.equal(plugin.getWasmAssetOperationRevision(0), residentRevision);
  assert.equal(plugin._wasmAssetResidentDescriptors.get(0).descriptor, residentDescriptor);

  const destructiveRevision = plugin.setWasmAsset(0, {
    payload: Uint8Array.of(13).buffer,
    footprintBytes: 1
  });
  deliver({
    type: 'assetLoadRejected',
    reason: 'capacity',
    operationRevision: destructiveRevision,
    residentRetained: false
  });
  assert.equal(plugin._wasmAssetRevisionDescriptors.has(0), false);
  assert.equal(plugin._wasmAssetResidentDescriptors.has(0), false);
  plugin.cleanup();
});

test('PluginBase coalesces rapid asset delivery independently for each worklet target', () => {
  const runtime = loadPluginBase();
  const plugin = createPlugin(runtime);
  plugin.id = 7;
  const primary = runtime.windowRef.workletNode;
  const auxiliaryMessages = [];
  const auxiliary = {
    port: {
      postMessage(message) {
        auxiliaryMessages.push(message);
      }
    }
  };
  plugin.setWasmAssetTargetResolver(() => [primary, auxiliary]);
  const deliver = data => plugin._handleMessage({
    currentTarget: primary.port,
    data: { pluginId: 7, slot: 0, ...data }
  });
  const setAsset = sample => plugin.setWasmAsset(0, {
    payload: Uint8Array.of(sample).buffer,
    footprintBytes: 1,
    headBlock: sample * 128
  });

  const revisionA = setAsset(1);
  plugin.acknowledgeWasmAssetOperation(auxiliary, 0, revisionA);
  deliver({ type: 'assetState', state: 3, operationRevision: revisionA });
  const revisionB = setAsset(2);
  const descriptorB = plugin.getWasmAssets().get(0);
  const revisionC = setAsset(3);
  const revisionD = setAsset(4);

  assert.deepEqual(runtime.messages.filter(message => message.type === 'setPluginAsset')
    .map(message => message.operationRevision), [revisionA, revisionB]);
  assert.deepEqual(auxiliaryMessages.filter(message => message.type === 'setPluginAsset')
    .map(message => message.operationRevision), [revisionA, revisionB]);
  assert.equal(plugin._wasmAssetRevisionDescriptors.get(0).has(revisionB), true);
  assert.equal(plugin._wasmAssetRevisionDescriptors.get(0).has(revisionC), false);
  assert.equal(plugin._wasmAssetRevisionDescriptors.get(0).has(revisionD), true);

  deliver({ type: 'assetState', state: 3, operationRevision: revisionB });
  assert.deepEqual(runtime.messages.filter(message => message.type === 'setPluginAsset')
    .map(message => message.operationRevision), [revisionA, revisionB, revisionD]);
  assert.deepEqual(auxiliaryMessages.filter(message => message.type === 'setPluginAsset')
    .map(message => message.operationRevision), [revisionA, revisionB]);
  assert.equal(plugin._wasmAssetResidentDescriptors.get(0).descriptor, descriptorB);

  const logicalDescriptorBeforeReplay = plugin.getWasmAssets().get(0);
  const logicalOperationBeforeReplay = plugin.getWasmAssetOperationRevision(0);
  const logicalStateBeforeReplay = plugin._wasmAssetStates.get(0);
  const logicalStateRevisionBeforeReplay = plugin._wasmAssetStateRevisions.get(0);
  const replayAssets = new plugin._wasmAssets.constructor([[0, descriptorB]]);
  assert.deepEqual(Array.from(plugin.replayWasmAssetsTo(auxiliary, {
    assets: replayAssets
  })), [0]);
  assert.deepEqual(auxiliaryMessages.filter(message => message.type === 'setPluginAsset')
    .map(message => message.operationRevision), [revisionA, revisionB]);

  assert.equal(plugin.acknowledgeWasmAssetOperation(auxiliary, 0, revisionB), true);
  assert.equal(plugin.acknowledgeWasmAssetOperation(auxiliary, 0, revisionB), false);
  assert.deepEqual(auxiliaryMessages.filter(message => message.type === 'setPluginAsset')
    .map(message => message.operationRevision), [revisionA, revisionB, revisionD]);
  const queuedReplayEpoch = plugin._wasmAssetDeliveries.get(auxiliary).get(0)
    .queued.replayEpoch;
  assert.equal(plugin.acknowledgeWasmAssetOperation(auxiliary, 0, revisionD), true);
  assert.deepEqual(auxiliaryMessages.filter(message => message.type === 'setPluginAsset')
    .map(message => [message.operationRevision, message.replayEpoch ?? null]), [
    [revisionA, null],
    [revisionB, null],
    [revisionD, null],
    [revisionB, queuedReplayEpoch]
  ]);
  assert.equal(plugin.getWasmAssets().get(0), logicalDescriptorBeforeReplay);
  assert.equal(plugin.getWasmAssetOperationRevision(0), logicalOperationBeforeReplay);
  assert.equal(plugin._wasmAssetStates.get(0), logicalStateBeforeReplay);
  assert.equal(plugin._wasmAssetStateRevisions.get(0), logicalStateRevisionBeforeReplay);
  assert.equal(plugin.acknowledgeWasmAssetOperation(
    auxiliary,
    0,
    revisionB,
    queuedReplayEpoch
  ), true);
  assert.equal(plugin._wasmAssetDeliveries.has(auxiliary), false);
  deliver({
    type: 'assetLoadRejected',
    reason: 'capacity',
    operationRevision: revisionD,
    residentRetained: true,
    retainedOperationRevision: revisionB,
    retainedAssetState: 3
  });

  assert.equal(plugin.getWasmAssets().get(0), descriptorB);
  assert.equal(plugin.getWasmAssetOperationRevision(0), revisionB);
  assert.equal(plugin._wasmAssetOperationCounters.get(0), revisionD);
  const replayMessages = [];
  const replayTarget = {
    port: {
      postMessage(message) {
        replayMessages.push(message);
      }
    }
  };
  assert.deepEqual(Array.from(plugin.replayWasmAssetsTo(replayTarget)), [0]);
  assert.equal(replayMessages[0].operationRevision, revisionB);
  assert.equal(Number.isSafeInteger(replayMessages[0].replayEpoch), true);
  assert.equal(plugin._wasmAssetDeliveries.has(replayTarget), true);
  assert.equal(plugin.acknowledgeWasmAssetOperation(
    replayTarget,
    0,
    revisionB,
    replayMessages[0].replayEpoch
  ), true);
  assert.equal(plugin._wasmAssetDeliveries.has(replayTarget), false);

  const clearRevision = revisionD + 1;
  assert.equal(plugin.clearWasmAsset(0), 2);
  const revisionE = setAsset(5);
  assert.equal(revisionE, clearRevision + 1);
  assert.equal(runtime.messages.some(message =>
    message.type === 'setPluginAsset' && message.operationRevision === revisionE), false);
  deliver({ type: 'assetState', state: 0, operationRevision: clearRevision });
  assert.equal(runtime.messages.some(message =>
    message.type === 'setPluginAsset' && message.operationRevision === revisionE), true);
  assert.equal(auxiliaryMessages.some(message =>
    message.type === 'setPluginAsset' && message.operationRevision === revisionE), false);
  plugin.acknowledgeWasmAssetOperation(auxiliary, 0, clearRevision);
  assert.equal(auxiliaryMessages.some(message =>
    message.type === 'setPluginAsset' && message.operationRevision === revisionE), true);
  assert.equal(plugin.dropWasmAssetTarget(auxiliary), true);
  assert.equal(plugin.dropWasmAssetTarget(auxiliary), false);
  assert.equal(plugin.acknowledgeWasmAssetOperation(auxiliary, 0, revisionE), false);
  plugin.cleanup();
});

test('PluginBase discards a committed descriptor when reconcile replay fails', () => {
  const runtime = loadPluginBase();
  const plugin = createPlugin(runtime);
  plugin.id = 7;
  const rejected = [];
  const snapshots = [];
  plugin.onWasmAssetRejected = (slot, reason, revision, retention) => {
    rejected.push({ slot, reason, revision, retention });
  };
  plugin.addWasmAssetChangeListener(revision => snapshots.push(revision));
  const deliver = data => plugin._handleMessage({
    currentTarget: runtime.windowRef.workletNode.port,
    data: { pluginId: 7, slot: 0, ...data }
  });

  const revision = plugin.setWasmAsset(0, {
    payload: Uint8Array.of(1).buffer,
    footprintBytes: 1
  });
  deliver({ type: 'assetState', state: 3, operationRevision: revision });
  const postsBeforeRejection = runtime.messages.length;
  deliver({
    type: 'assetLoadRejected',
    reason: 'capacity',
    operationRevision: revision,
    residentRetained: false,
    replayFailure: true
  });

  assert.equal(plugin.getWasmAssets().size, 0);
  assert.equal(plugin._wasmAssetStates.has(0), false);
  assert.equal(plugin._wasmAssetPendingPredecessors.has(0), false);
  assert.equal(plugin._wasmAssetRevisionDescriptors.has(0), false);
  assert.equal(runtime.messages.length, postsBeforeRejection);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].slot, 0);
  assert.equal(rejected[0].reason, 'capacity');
  assert.equal(rejected[0].revision, revision);
  assert.equal(rejected[0].retention.residentRetained, false);
  assert.equal(rejected[0].retention.replayFailure, true);
  assert.deepEqual(snapshots, [1, 2]);
  plugin.cleanup();
});

test('PluginBase requires the exact target replay epoch before accepting reused revisions', () => {
  const runtime = loadPluginBase();
  const plugin = createPlugin(runtime);
  plugin.id = 7;
  const primary = runtime.windowRef.workletNode;
  const deliver = data => plugin._handleMessage({
    currentTarget: primary.port,
    data: { pluginId: 7, slot: 0, ...data }
  });
  const revision = plugin.setWasmAsset(0, {
    payload: Uint8Array.of(1).buffer,
    footprintBytes: 1
  });
  deliver({ type: 'assetState', state: 3, operationRevision: revision });

  plugin.replayWasmAssetsTo(primary, { trackState: true });
  const firstReplay = runtime.messages.at(-1);
  assert.equal(firstReplay.operationRevision, revision);
  assert.equal(firstReplay.replayEpoch, 1);
  assert.equal(plugin._wasmAssetStates.get(0), 1);

  deliver({ type: 'assetState', state: 3, operationRevision: revision });
  assert.equal(plugin._wasmAssetStates.get(0), 1);
  assert.equal(plugin.acknowledgeWasmAssetOperation(primary, 0, revision), false);
  deliver({
    type: 'assetState', state: 3, operationRevision: revision,
    replayEpoch: firstReplay.replayEpoch
  });
  assert.equal(plugin._wasmAssetStates.get(0), 3);

  plugin.replayWasmAssetsTo(primary, { trackState: true });
  const secondReplay = runtime.messages.at(-1);
  assert.equal(secondReplay.operationRevision, revision);
  assert.equal(secondReplay.replayEpoch, 2);
  deliver({
    type: 'assetLoadRejected', reason: 'late', operationRevision: revision,
    replayEpoch: firstReplay.replayEpoch, replayFailure: true
  });
  assert.equal(plugin.getWasmAssets().has(0), true);
  deliver({
    type: 'assetLoadRejected', reason: 'capacity', operationRevision: revision,
    replayEpoch: secondReplay.replayEpoch, replayFailure: true
  });
  assert.equal(plugin.getWasmAssets().has(0), false);
  plugin.cleanup();
});

test('PluginBase registers clear expectations before posting and isolates snapshot listener failures', () => {
  const runtime = loadPluginBase();
  const plugin = createPlugin(runtime);
  plugin.id = 7;
  const order = [];
  const target = {
    port: {
      postMessage(message) {
        order.push(['post', message.type, message.operationRevision]);
      }
    }
  };
  plugin.setWasmAssetTargetResolver(() => [target]);
  plugin.setWasmAssetOperationObserver((_node, slot, revision, state) => {
    order.push(['expect', slot, revision, state]);
  });
  plugin.addWasmAssetSnapshotChangeListener(() => {
    order.push(['snapshot']);
    throw new Error('listener failed');
  });
  plugin.addWasmAssetSnapshotChangeListener(() => order.push(['snapshot-ok']));

  plugin.setWasmAsset(0, { payload: new ArrayBuffer(32), footprintBytes: 32 });
  plugin.acknowledgeWasmAssetOperation(target, 0, 1);
  plugin.clearWasmAsset(0);
  plugin.updateParameters();

  assert.deepEqual(order, [
    ['snapshot'],
    ['snapshot-ok'],
    ['expect', 0, 1, 1],
    ['post', 'setPluginAsset', 1],
    ['snapshot'],
    ['snapshot-ok'],
    ['expect', 0, 2, 0],
    ['post', 'clearPluginAsset', 2],
    ['snapshot'],
    ['snapshot-ok']
  ]);
  assert.equal(runtime.messages.at(-1).type, 'updatePlugin');
  assert.equal(runtime.warnings.length, 3);
});

test('PluginBase invokes the optional channel hook exactly once per effective change', () => {
  const runtime = loadPluginBase();
  const plugin = new runtime.PluginBase('Channel Hook', 'Channel change test');
  plugin.id = 'channel-hook';
  plugin.getParameters = () => ({ enabled: true });
  const changes = [];
  plugin.onChannelSelectionChanged = (previous, current) => changes.push([previous, current]);

  plugin.updateParameters();
  assert.deepEqual(changes, []);
  plugin.channel = '34';
  plugin.updateParameters();
  plugin.updateParameters();
  assert.deepEqual(changes, [[null, '34']]);
  assert.equal(runtime.messages.length, 3);

  delete plugin.onChannelSelectionChanged;
  plugin.channel = 'A';
  plugin.updateParameters();
  assert.equal(runtime.messages.length, 4);
});
