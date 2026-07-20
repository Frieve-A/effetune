import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { decodeDspPipelineDescriptor } from '../../js/audio/dsp-pipeline-descriptor.js';
import { PowerPolicyController } from '../../js/audio/power-policy-controller.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const processorPath = path.join(repoRoot, 'plugins', 'audio-processor.js');

async function flushAsyncWork() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}

function createArena() {
  const combined = new Float32Array(8 * 128);
  const buses = new Map([[0, combined]]);
  for (let bus = 1; bus <= 4; bus++) buses.set(bus, new Float32Array(8 * 128));
  return {
    combined,
    buses,
    scratch: {
      allChannels: new Float32Array(8 * 128),
      mixing: new Float32Array(8 * 128),
      stereo: new Float32Array(2 * 128),
      mono: new Float32Array(128)
    }
  };
}

function createWasmArena(memory) {
  let floatOffset = 0;
  const allocate = length => {
    const view = new Float32Array(memory.buffer, floatOffset * Float32Array.BYTES_PER_ELEMENT, length);
    floatOffset += length;
    return view;
  };
  const combined = allocate(8 * 128);
  const buses = new Map([[0, combined]]);
  for (let bus = 1; bus <= 4; bus++) buses.set(bus, allocate(8 * 128));
  return {
    combined,
    buses,
    scratch: {
      allChannels: allocate(8 * 128),
      mixing: allocate(8 * 128),
      stereo: allocate(2 * 128),
      mono: allocate(128)
    }
  };
}

function createBinding(options = {}) {
  const calls = [];
  const arena = options.arena ?? createArena();
  const pointerViews = new Map();
  let pointer = 4096;
  for (const view of [
    arena.combined,
    ...arena.buses.values(),
    arena.scratch.allChannels,
    arena.scratch.mixing,
    arena.scratch.stereo,
    arena.scratch.mono
  ]) {
    if (!pointerViews.has(view)) {
      pointerViews.set(view, pointer);
      pointer += view.byteLength + 64;
    }
  }
  const viewsByPointer = new Map([...pointerViews].map(([view, ptr]) => [ptr, view]));
  const processStatuses = [...(options.processStatuses ?? [])];
  const pipelineProcessStatuses = [...(options.pipelineProcessStatuses ?? [])];
  const telemetryBytes = [...(options.telemetryBytes ?? [])];
  let nextInstance = 100;
  let unexpectedMemoryGrowth = false;
  const binding = {
    calls,
    arena,
    memory: options.memory,
    factoryOptions: null,
    lastTelemetryDroppedFrames: options.telemetryDroppedFrames ?? 0,
    createEngine() {
      calls.push(['createEngine']);
      return 1;
    },
    prepare(...args) {
      calls.push(['prepare', ...args]);
      return options.prepareStatus ?? 0;
    },
    getCapabilities() {
      calls.push(['getCapabilities']);
      return options.capabilities ?? {
        abiVersion: 1,
        simd: false,
        kernels: [{ name: 'VolumePlugin', hash: 0x1234, byteCapacity: 0, kernelIndex: 0 }]
      };
    },
    getArenaViews() {
      calls.push(['getArenaViews']);
      return arena;
    },
    createInstance(type) {
      calls.push(['createInstance', type]);
      return options.createInstanceResult ?? nextInstance++;
    },
    destroyInstance(id) {
      calls.push(['destroyInstance', id]);
    },
    instanceSetTap(id, tapId) {
      calls.push(['instanceSetTap', id, tapId]);
      return options.tapStatus ?? 0;
    },
    instanceLatency(id) {
      calls.push(['instanceLatency', id]);
      return options.instanceLatency ?? 0;
    },
    instanceSetParams(id, params, hash) {
      calls.push(['instanceSetParams', id, [...params], hash]);
      return options.paramsStatus ?? 0;
    },
    instanceSetParamBytes(id, params, hash) {
      calls.push(['instanceSetParamBytes', id, [...params], hash]);
      return options.paramBytesStatus ?? 0;
    },
    instanceSetAsset(id, slot, payload, beginInfo, formatTag) {
      calls.push(['instanceSetAsset', id, slot, [...new Uint8Array(payload)], { ...beginInfo }, formatTag]);
      return typeof options.assetCommitStatus === 'function'
        ? options.assetCommitStatus(id, slot, payload, beginInfo, formatTag)
        : (options.assetCommitStatus ?? 0);
    },
    instanceAssetState(id, slot) {
      calls.push(['instanceAssetState', id, slot]);
      return typeof options.assetState === 'function'
        ? options.assetState(id, slot)
        : (options.assetState ?? 3);
    },
    instanceAssetAbort(id, slot) {
      calls.push(['instanceAssetAbort', id, slot]);
    },
    pointerForArenaView(view) {
      calls.push(['pointerForArenaView', view]);
      return pointerViews.get(view) ?? null;
    },
    instanceProcess(id, audioPtr, channels, frames, time) {
      calls.push(['instanceProcess', id, audioPtr, channels, frames, time]);
      const status = processStatuses.length > 0 ? processStatuses.shift() : 0;
      if (status === 0 || options.instanceMutateOnFailure) {
        const view = viewsByPointer.get(audioPtr);
        for (let index = 0; index < channels * frames; index++) view[index] *= options.wasmGain ?? 2;
      }
      if (options.growMemoryOnInstanceProcess) {
        binding.memory.grow(1);
        binding.factoryOptions?.onUnexpectedMemoryGrowth?.();
      }
      if (options.instanceProcessError) throw options.instanceProcessError;
      return status;
    },
    pipelineConfigure(descriptor) {
      const copy = Uint8Array.from(descriptor);
      calls.push(['pipelineConfigure', copy]);
      return options.pipelineConfigureStatus ?? -6;
    },
    pipelineProcess(channels, frames, time, masterBypass) {
      calls.push(['pipelineProcess', channels, frames, time, masterBypass]);
      const status = pipelineProcessStatuses.length > 0 ? pipelineProcessStatuses.shift() : 0;
      if (status === 0 || options.pipelineMutateOnFailure) {
        for (let index = 0; index < channels * frames; index++) {
          arena.combined[index] *= options.pipelineGain ?? 2;
        }
      }
      if (options.growMemoryOnPipelineProcess) {
        binding.memory.grow(1);
        binding.factoryOptions?.onUnexpectedMemoryGrowth?.();
      }
      if (options.pipelineProcessError) throw options.pipelineProcessError;
      options.onPipelineProcess?.(channels, frames, time, masterBypass);
      return status;
    },
    telemetryRead(packet) {
      calls.push(['telemetryRead', packet]);
      return telemetryBytes.length > 0 ? telemetryBytes.shift() : 0;
    },
    setTelemetryRate(hz) {
      calls.push(['setTelemetryRate', hz]);
      return options.telemetryRateStatus ?? 0;
    },
    checkMemoryBuffer() {
      calls.push(['checkMemoryBuffer']);
      const result = unexpectedMemoryGrowth;
      unexpectedMemoryGrowth = false;
      return result;
    },
    makeMemoryUnexpected() {
      unexpectedMemoryGrowth = true;
    },
    reset() {
      calls.push(['reset']);
      return 0;
    },
    close() {
      calls.push(['close']);
    }
  };
  return binding;
}

async function createWorkletHarness(options = {}) {
  const source = await fs.readFile(processorPath, 'utf8');
  const injected = source.replace(
    /\/\/ __ETDSP_BINDING_INJECT_START__[\s\S]*?\/\/ __ETDSP_BINDING_INJECT_END__/,
    `// __ETDSP_BINDING_INJECT_START__
async function instantiateDspBinding(payload, options) {
  return globalThis.__instantiateDspBinding(payload, options);
}
// __ETDSP_BINDING_INJECT_END__`
  );
  const posts = [];
  const warnings = [];
  const factories = [];
  let ProcessorClass = null;
  const binding = options.binding ?? createBinding(options.bindingOptions);
  class FakePort {
    constructor() {
      this.onmessage = null;
    }
    postMessage(message, transfer = []) {
      posts.push({ message, transfer });
    }
  }
  class FakeAudioWorkletProcessor {
    constructor() {
      this.port = new FakePort();
    }
  }
  const sandbox = {
    ArrayBuffer,
    DataView,
    Float32Array,
    Map,
    Set,
    Uint8Array,
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    console: {
      log() {},
      error() {},
      warn(...args) { warnings.push(args.join(' ')); }
    },
    currentTime: 0,
    sampleRate: 48000,
    __instantiateDspBinding: async (payload, factoryOptions) => {
      factories.push({ payload, factoryOptions });
      if (options.instantiateError) throw options.instantiateError;
      binding.factoryOptions = factoryOptions;
      return binding;
    },
    registerProcessor(name, constructor) {
      assert.equal(name, 'plugin-processor');
      ProcessorClass = constructor;
    }
  };
  vm.runInNewContext(injected, sandbox, { filename: processorPath });
  assert.ok(ProcessorClass);
  const processor = new ProcessorClass({
    processorOptions: {
      initialOutputChannelCount: options.outputChannels ?? 2,
      lowLatencyMode: false
    }
  });
  const send = async data => {
    processor.port.onmessage({ data });
    await flushAsyncWork();
  };
  return { binding, factories, posts, processor, send, warnings };
}

function pluginConfig(overrides = {}) {
  return {
    id: 7,
    type: 'VolumePlugin',
    enabled: true,
    parameters: { enabled: true },
    inputBus: 0,
    outputBus: 0,
    channel: 'A',
    wasmParams: Float32Array.of(1),
    wasmParamsHash: 0x1234,
    ...overrides
  };
}

function assetPayload(sample = 1) {
  const payload = new ArrayBuffer(36);
  const header = new DataView(payload);
  header.setUint32(0, 0x31415445, true);
  header.setUint32(4, 1, true);
  header.setUint32(8, 1, true);
  header.setUint32(12, 48000, true);
  header.setUint32(16, 1, true);
  new Float32Array(payload, 32)[0] = sample;
  return payload;
}

async function registerFallback(harness) {
  await harness.send({
    type: 'registerProcessor',
    pluginType: 'VolumePlugin',
    processor: 'for (let i = 0; i < data.length; i++) data[i] += 10; return data;'
  });
}

function processBlock(processor, value = 1) {
  const input = [Float32Array.from({ length: 128 }, () => value), Float32Array.from({ length: 128 }, () => value)];
  const output = [new Float32Array(128), new Float32Array(128)];
  assert.equal(processor.process([input], [output], {}), true);
  return output;
}

function messagesOf(posts, type) {
  return posts.filter(entry => entry.message.type === type);
}

test('worklet reconciles pre-module plugins, adopts every arena bus, and manages instance lifecycle', async () => {
  const harness = await createWorkletHarness();
  await registerFallback(harness);
  const first = pluginConfig();
  await harness.send({ type: 'updatePlugins', plugins: [first], masterBypass: false });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  assert.equal(harness.binding.calls.some(call => call[0] === 'createInstance'), false);

  const modulePayload = { compiled: true };
  await harness.send({ type: 'dspModule', module: modulePayload, simd: true });
  assert.equal(harness.factories.length, 1);
  assert.equal(harness.factories[0].payload, modulePayload);
  assert.deepEqual(harness.binding.calls.find(call => call[0] === 'prepare').slice(1), [48000, 8, 128, 256 * 1024]);
  assert.equal(harness.processor.dspLive, true);
  assert.equal(harness.processor.dspSimd, true);
  assert.equal(harness.processor.bufferPool.combined, harness.binding.arena.combined);
  for (let bus = 1; bus <= 4; bus++) {
    assert.equal(harness.processor.bufferPool.buses.get(bus), harness.binding.arena.buses.get(bus));
  }
  assert.deepEqual(harness.binding.calls.find(call => call[0] === 'instanceSetTap').slice(2), [7]);
  assert.deepEqual(harness.binding.calls.find(call => call[0] === 'instanceSetParams').slice(2), [[1], 0x1234]);
  assert.equal(messagesOf(harness.posts, 'dspReady').length, 1);

  const wasmOutput = processBlock(harness.processor);
  assert.equal(wasmOutput[0][0], 2);
  assert.equal(wasmOutput[1][0], 2);

  await harness.send({ type: 'updatePlugin', plugin: pluginConfig({ wasmParams: Float32Array.of(3) }) });
  assert.ok(harness.binding.calls.some(call => call[0] === 'instanceSetParams' && call[2][0] === 3));
  await harness.send({ type: 'addPlugin', plugin: pluginConfig({ id: 8 }), index: 0 });
  assert.equal(harness.processor.plugins[0].id, 8);
  assert.equal(harness.processor.wasmInstances.size, 2);
  await harness.send({ type: 'removePlugin', pluginId: 7 });
  assert.equal(harness.processor.wasmInstances.has(7), false);
  assert.ok(harness.binding.calls.some(call => call[0] === 'destroyInstance'));
  await harness.send({ type: 'reset' });
  assert.equal(harness.processor.plugins.length, 0);
  assert.equal(harness.processor.wasmInstances.size, 0);
  assert.ok(harness.binding.calls.some(call => call[0] === 'reset'));
});

test('worklet stages structured parameter bytes and rejects missing payloads', async () => {
  const binding = createBinding({
    capabilities: {
      abiVersion: 1,
      simd: false,
      kernels: [{ name: 'MatrixPlugin', hash: 0x07080f45, byteCapacity: 3076, kernelIndex: 0 }]
    }
  });
  const harness = await createWorkletHarness({ binding });
  await harness.send({
    type: 'registerProcessor',
    pluginType: 'MatrixPlugin',
    processor: 'return data;'
  });
  const matrix = pluginConfig({
    type: 'MatrixPlugin',
    wasmParams: new Float32Array(0),
    wasmParamsHash: 0x07080f45,
    wasmParamBytes: Uint8Array.of(1, 0, 2, 0, 0, 0, 0, 1, 1, 0)
  });
  await harness.send({ type: 'updatePlugins', plugins: [matrix], masterBypass: false });
  await harness.send({ type: 'dspEnableTypes', types: ['MatrixPlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });

  assert.deepEqual(
    binding.calls.find(call => call[0] === 'instanceSetParamBytes').slice(2),
    [[1, 0, 2, 0, 0, 0, 0, 1, 1, 0], 0x07080f45]
  );
  assert.equal(harness.processor.wasmInstances.get(7).ready, true);

  await harness.send({
    type: 'updatePlugin',
    plugin: { ...matrix, wasmParamBytes: undefined }
  });
  assert.equal(harness.processor.wasmInstances.get(7).ready, false);
  assert.ok(messagesOf(harness.posts, 'dspFailed').some(
    entry => entry.message.stage === 'instance:7' &&
      entry.message.error.includes('set_param_bytes')
  ));
});

test('worklet re-stages cached assets after a forced instance reconcile', async () => {
  const binding = createBinding({
    capabilities: {
      abiVersion: 1,
      simd: false,
      kernels: [{
        name: 'VolumePlugin', hash: 0x1234, byteCapacity: 0,
        assetCapacity: 4096, kernelIndex: 0
      }]
    }
  });
  const harness = await createWorkletHarness({ binding });
  await registerFallback(harness);
  await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });

  const payload = new ArrayBuffer(40);
  const header = new DataView(payload);
  header.setUint32(0, 0x31415445, true);
  header.setUint32(4, 1, true);
  header.setUint32(8, 2, true);
  header.setUint32(12, 48000, true);
  header.setUint32(16, 1, true);
  new Float32Array(payload, 32).set([1, 0.25]);
  await harness.send({
    type: 'setPluginAsset', pluginId: 7, slot: 0, formatTag: 1,
    headBlock: 128, rateDivider: 1, pathCount: 0, inputCount: 0, processingChannels: 2,
    footprintBytes: payload.byteLength, payload
  });
  let stagingCalls = binding.calls.filter(call => call[0] === 'instanceSetAsset');
  assert.equal(stagingCalls.length, 1);
  assert.equal(stagingCalls[0][1], 100);

  await harness.send({ type: 'dspEnableTypes', types: [] });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  stagingCalls = binding.calls.filter(call => call[0] === 'instanceSetAsset');
  assert.equal(stagingCalls.length, 2);
  assert.equal(stagingCalls[1][1], 101);
  assert.deepEqual(stagingCalls[1].slice(2), stagingCalls[0].slice(2));
  assert.ok(binding.calls.some(call => call[0] === 'destroyInstance' && call[1] === 100));
});

test('worklet marks failed reconcile replay as destructive and drops stale asset bookkeeping', async () => {
  let stagingAttempt = 0;
  const binding = createBinding({
    assetCommitStatus() {
      stagingAttempt++;
      return stagingAttempt === 2 ? -2 : 0;
    },
    assetState: 3,
    capabilities: {
      abiVersion: 1,
      simd: false,
      kernels: [{
        name: 'VolumePlugin', hash: 0x1234, byteCapacity: 0,
        assetCapacity: 4096, kernelIndex: 0
      }]
    }
  });
  const harness = await createWorkletHarness({ binding });
  await registerFallback(harness);
  await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });
  await harness.send({
    type: 'setPluginAsset', pluginId: 7, slot: 0, formatTag: 1,
    headBlock: 128, rateDivider: 1, pathCount: 0, inputCount: 0, processingChannels: 2,
    footprintBytes: 1024, operationRevision: 1, payload: assetPayload(0.25)
  });

  await harness.send({ type: 'dspEnableTypes', types: [] });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });

  const rejection = messagesOf(harness.posts, 'assetLoadRejected').at(-1).message;
  assert.equal(rejection.operationRevision, 1);
  assert.equal(rejection.residentRetained, false);
  assert.equal(rejection.replayFailure, true);
  assert.equal(Object.hasOwn(rejection, 'retainedOperationRevision'), false);
  assert.equal(Object.hasOwn(rejection, 'retainedAssetState'), false);
  assert.equal(harness.processor.dspAssetCache.has(7), false);
  assert.equal(harness.processor.dspAssetStates.has(7), false);
  assert.equal(harness.processor.dspAssetStateRevisions.has(7), false);
});

test('worklet echoes asset operation revisions across set, clear, rejection, and replay', async () => {
  const binding = createBinding({
    assetState: 3,
    capabilities: {
      abiVersion: 1,
      simd: false,
      kernels: [{
        name: 'VolumePlugin', hash: 0x1234, byteCapacity: 0,
        assetCapacity: 4096, kernelIndex: 0
      }]
    }
  });
  const harness = await createWorkletHarness({ binding });
  await registerFallback(harness);
  await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });

  const sendAsset = (operationRevision, footprintBytes = 1024) => harness.send({
    type: 'setPluginAsset', pluginId: 7, slot: 0, formatTag: 1,
    headBlock: 128, rateDivider: 1, pathCount: 0, inputCount: 0, processingChannels: 2,
    footprintBytes, operationRevision, payload: assetPayload(operationRevision)
  });
  await sendAsset(1);
  await harness.send({
    type: 'clearPluginAsset', pluginId: 7, slot: 0, operationRevision: 2
  });
  await sendAsset(3);
  await sendAsset(3);
  await sendAsset(4, -1);

  const states = messagesOf(harness.posts, 'assetState').map(entry => entry.message);
  assert.deepEqual(states.slice(-4).map(message => [message.state, message.operationRevision]), [
    [3, 1],
    [0, 2],
    [3, 3],
    [3, 3]
  ]);
  const rejection = messagesOf(harness.posts, 'assetLoadRejected').at(-1).message;
  assert.equal(rejection.reason, 'invalid-asset');
  assert.equal(rejection.operationRevision, 4);
  assert.equal(harness.processor.dspAssetCache.get(7).get(0).operationRevision, 3);
});

test('worklet echoes replay epochs through ACTIVE and forced replay rejection', async () => {
  let stagingAttempt = 0;
  const binding = createBinding({
    assetCommitStatus() {
      stagingAttempt++;
      return stagingAttempt === 2 ? -2 : 0;
    },
    assetState: 3,
    capabilities: {
      abiVersion: 1,
      simd: false,
      kernels: [{
        name: 'VolumePlugin', hash: 0x1234, byteCapacity: 0,
        assetCapacity: 4096, kernelIndex: 0
      }]
    }
  });
  const harness = await createWorkletHarness({ binding });
  await registerFallback(harness);
  await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });
  const send = replayEpoch => harness.send({
    type: 'setPluginAsset', pluginId: 7, slot: 0, formatTag: 1,
    headBlock: 128, rateDivider: 1, pathCount: 0, inputCount: 0, processingChannels: 2,
    footprintBytes: 1024, operationRevision: 1, replayEpoch,
    payload: assetPayload(0.25)
  });

  await send(11);
  const active = messagesOf(harness.posts, 'assetState').at(-1).message;
  assert.equal(active.operationRevision, 1);
  assert.equal(active.replayEpoch, 11);
  assert.equal(harness.processor.dspAssetCache.get(7).get(0).replayEpoch, 11);

  await send(12);
  const rejection = messagesOf(harness.posts, 'assetLoadRejected').at(-1).message;
  assert.equal(rejection.operationRevision, 1);
  assert.equal(rejection.replayEpoch, 12);
  assert.equal(rejection.replayFailure, true);
  assert.equal(rejection.residentRetained, false);
  assert.equal(harness.processor.dspAssetCache.has(7), false);
  assert.equal(harness.processor.dspAssetStateReplayEpochs.has(7), false);
});

test('worklet preserves a resident asset when a replacement is rejected', async () => {
  let stagingAttempt = 0;
  const binding = createBinding({
    assetCommitStatus() {
      stagingAttempt++;
      return stagingAttempt === 2 ? -2 : 0;
    },
    assetState: 3,
    capabilities: {
      abiVersion: 1,
      simd: false,
      kernels: [{
        name: 'VolumePlugin', hash: 0x1234, byteCapacity: 0,
        assetCapacity: 4096, kernelIndex: 0
      }]
    }
  });
  const harness = await createWorkletHarness({ binding });
  await registerFallback(harness);
  await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });

  const sendAsset = (sample, footprintBytes, operationRevision) => harness.send({
    type: 'setPluginAsset', pluginId: 7, slot: 0, formatTag: 1,
    headBlock: 128, rateDivider: 1, pathCount: 0, inputCount: 0, processingChannels: 2,
    footprintBytes, operationRevision, payload: assetPayload(sample)
  });
  await sendAsset(0.25, 1024, 1);
  await sendAsset(0.75, 2048, 2);

  const resident = harness.processor.dspAssetCache.get(7).get(0);
  assert.equal(resident.footprintBytes, 1024);
  assert.equal(resident.operationRevision, 1);
  assert.equal(new Float32Array(
    resident.payload.buffer,
    resident.payload.byteOffset + 32,
    1
  )[0], 0.25);
  assert.equal(harness.processor.dspAssetFootprintBytes(), 1024);
  assert.equal(harness.processor.dspAssetStates.get(7).get(0), 3);
  assert.equal(harness.processor.dspAssetStateRevisions.get(7).get(0), 1);
  assert.equal(messagesOf(harness.posts, 'assetState').some(entry =>
    entry.message.state === 3 && entry.message.operationRevision === 2
  ), false);
  const rejection = messagesOf(harness.posts, 'assetLoadRejected').at(-1).message;
  assert.equal(rejection.reason, 'capacity');
  assert.equal(rejection.operationRevision, 2);
  assert.equal(rejection.residentRetained, true);
  assert.equal(rejection.replayFailure, false);
  assert.equal(rejection.retainedOperationRevision, 1);
  assert.equal(rejection.retainedAssetState, 3);

  await harness.send({ type: 'dspEnableTypes', types: [] });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  const stagingCalls = binding.calls.filter(call => call[0] === 'instanceSetAsset');
  assert.equal(stagingCalls.length, 3);
  assert.equal(new Float32Array(Uint8Array.from(stagingCalls.at(-1)[3]).buffer, 32, 1)[0], 0.25);
  assert.equal(messagesOf(harness.posts, 'assetState').at(-1).message.operationRevision, 1);
});

test('worklet retains the immediate rapid predecessor in PREPARING or ACTIVE state', async () => {
  for (const retainedAssetState of [2, 3]) {
    let stagingAttempt = 0;
    let nativeState = 3;
    const binding = createBinding({
      assetCommitStatus() {
        stagingAttempt++;
        return stagingAttempt === 3 ? -2 : 0;
      },
      assetState: () => nativeState,
      capabilities: {
        abiVersion: 1,
        simd: false,
        kernels: [{
          name: 'VolumePlugin', hash: 0x1234, byteCapacity: 0,
          assetCapacity: 4096, kernelIndex: 0
        }]
      }
    });
    const harness = await createWorkletHarness({ binding });
    await registerFallback(harness);
    await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
    await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
    await harness.send({ type: 'dspModule', module: { compiled: true } });
    const sendAsset = (sample, operationRevision, headBlock) => harness.send({
      type: 'setPluginAsset', pluginId: 7, slot: 0, formatTag: 1,
      headBlock, rateDivider: operationRevision, pathCount: 0, inputCount: 0,
      processingChannels: 2, footprintBytes: 1024, operationRevision,
      payload: assetPayload(sample)
    });

    await sendAsset(0.25, 1, 128);
    nativeState = 2;
    await sendAsset(0.5, 2, 256);
    nativeState = retainedAssetState;
    await sendAsset(0.75, 3, 512);

    const rejection = messagesOf(harness.posts, 'assetLoadRejected').at(-1).message;
    assert.equal(rejection.operationRevision, 3);
    assert.equal(rejection.residentRetained, true);
    assert.equal(rejection.retainedOperationRevision, 2);
    assert.equal(rejection.retainedAssetState, retainedAssetState);
    const resident = harness.processor.dspAssetCache.get(7).get(0);
    assert.equal(resident.operationRevision, 2);
    assert.equal(resident.beginInfo.headBlock, 256);
    assert.equal(resident.beginInfo.rateDivider, 2);
    assert.equal(harness.processor.dspAssetStates.get(7).get(0), retainedAssetState);
    assert.equal(harness.processor.dspAssetStateRevisions.get(7).get(0), 2);

    if (retainedAssetState === 2) {
      nativeState = 3;
      harness.processor.pollDspAssetStates();
      const active = messagesOf(harness.posts, 'assetState').at(-1).message;
      assert.equal(active.operationRevision, 2);
      assert.equal(active.state, 3);
      assert.equal(harness.processor.dspAssetStates.get(7).get(0), 3);
    }
  }
});

test('worklet retains a cached STAGED predecessor on no-instance preflight rejection', async () => {
  const harness = await createWorkletHarness();
  const sendAsset = (operationRevision, footprintBytes) => harness.send({
    type: 'setPluginAsset', pluginId: 7, slot: 0, formatTag: 1,
    headBlock: operationRevision === 1 ? 128 : 256,
    rateDivider: 1, pathCount: 0, inputCount: 0, processingChannels: 2,
    footprintBytes, operationRevision, payload: assetPayload(operationRevision)
  });

  await sendAsset(1, 1024);
  await sendAsset(2, 129 * 1024 * 1024);

  const rejection = messagesOf(harness.posts, 'assetLoadRejected').at(-1).message;
  assert.equal(rejection.reason, 'module-budget');
  assert.equal(rejection.residentRetained, true);
  assert.equal(rejection.retainedOperationRevision, 1);
  assert.equal(rejection.retainedAssetState, 1);
  assert.equal(harness.processor.dspAssetCache.get(7).get(0).operationRevision, 1);
  assert.equal(harness.processor.dspAssetStates.get(7).get(0), 1);
  assert.equal(harness.processor.dspAssetStateRevisions.get(7).get(0), 1);
});

test('worklet prunes stale asset bookkeeping after destructive and initial staging failures', async () => {
  for (const initialFailure of [false, true]) {
    let stagingAttempt = 0;
    let nativeState = initialFailure ? 0 : 3;
    const binding = createBinding({
      assetCommitStatus() {
        stagingAttempt++;
        if (initialFailure || stagingAttempt === 2) {
          nativeState = initialFailure ? 0 : 4;
          return -2;
        }
        return 0;
      },
      assetState: () => nativeState,
      capabilities: {
        abiVersion: 1,
        simd: false,
        kernels: [{
          name: 'VolumePlugin', hash: 0x1234, byteCapacity: 0,
          assetCapacity: 4096, kernelIndex: 0
        }]
      }
    });
    const harness = await createWorkletHarness({ binding });
    await registerFallback(harness);
    await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
    await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
    await harness.send({ type: 'dspModule', module: { compiled: true } });
    const sendAsset = operationRevision => harness.send({
      type: 'setPluginAsset', pluginId: 7, slot: 0, formatTag: 1,
      headBlock: 128, rateDivider: 1, pathCount: 0, inputCount: 0, processingChannels: 2,
      footprintBytes: 1024, operationRevision, payload: assetPayload(operationRevision)
    });
    await sendAsset(1);
    if (!initialFailure) await sendAsset(2);

    const rejection = messagesOf(harness.posts, 'assetLoadRejected').at(-1).message;
    assert.equal(rejection.residentRetained, false);
    assert.equal(Object.hasOwn(rejection, 'retainedOperationRevision'), false);
    assert.equal(Object.hasOwn(rejection, 'retainedAssetState'), false);
    assert.equal(harness.processor.dspAssetCache.has(7), false);
    assert.equal(harness.processor.dspAssetStates.has(7), false);
    assert.equal(harness.processor.dspAssetStateRevisions.has(7), false);
  }
});

test('worklet defers preparation outside the executable pipeline and resumes without re-staging', async () => {
  for (const deferredBy of ['plugin', 'section', 'master-bypass']) {
    let assetState = 2;
    let preparationEnabled = false;
    const binding = createBinding({
      assetState: () => assetState,
      pipelineConfigureStatus: 0,
      onPipelineProcess() {
        if (preparationEnabled) assetState = 3;
      },
      capabilities: {
        abiVersion: 1,
        simd: false,
        kernels: [{
          name: 'VolumePlugin', hash: 0x1234, byteCapacity: 0,
          assetCapacity: 4096, kernelIndex: 0
        }]
      }
    });
    const harness = await createWorkletHarness({ binding });
    await registerFallback(harness);
    const enabledPlugin = pluginConfig();
    const disabledPlugin = pluginConfig({ enabled: false, parameters: { enabled: false } });
    const section = {
      id: 70,
      type: 'SectionPlugin',
      enabled: false,
      parameters: { enabled: false },
      inputBus: 0,
      outputBus: 0,
      channel: 'A'
    };
    const initialPlugins = deferredBy === 'plugin'
      ? [disabledPlugin]
      : deferredBy === 'section' ? [section, enabledPlugin] : [enabledPlugin];
    await harness.send({
      type: 'updatePlugins',
      plugins: initialPlugins,
      masterBypass: deferredBy === 'master-bypass'
    });
    await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
    await harness.send({ type: 'dspModule', module: { compiled: true } });
    await harness.send({
      type: 'setPluginAsset', pluginId: 7, slot: 0, formatTag: 1,
      headBlock: 128, rateDivider: 1, pathCount: 0, inputCount: 0, processingChannels: 2,
      footprintBytes: 1024, payload: assetPayload(0.25)
    });

    harness.processor.powerPolicy.pendingConfigWake = false;
    harness.processor.audioLevelMonitoring.isSleepMode = true;
    processBlock(harness.processor);
    assert.equal(assetState, 2, `${deferredBy} must leave preparation deferred`);
    assert.equal(harness.processor.powerPolicy.pendingConfigWake, false,
      `${deferredBy} must not keep requesting wake`);
    assert.equal(harness.processor.audioLevelMonitoring.isSleepMode, true,
      `${deferredBy} must not force legacy sleep off`);

    preparationEnabled = true;
    const resumedPlugins = deferredBy === 'section'
      ? [{ ...section, enabled: true, parameters: { enabled: true } }, enabledPlugin]
      : [enabledPlugin];
    await harness.send({
      type: 'updatePlugins',
      plugins: resumedPlugins,
      masterBypass: false
    });
    processBlock(harness.processor);
    processBlock(harness.processor);
    assert.equal(assetState, 3, `${deferredBy} must resume the staged preparation`);
    assert.equal(binding.calls.filter(call => call[0] === 'instanceSetAsset').length, 1,
      `${deferredBy} must not re-stage the asset`);
  }
});

test('worklet admits aggregate asset footprints across replace, clear, and reconcile', async () => {
  const binding = createBinding({
    capabilities: {
      abiVersion: 1,
      simd: false,
      kernels: [{
        name: 'VolumePlugin', hash: 0x1234, byteCapacity: 0,
        assetCapacity: 4096, kernelIndex: 0
      }]
    }
  });
  const harness = await createWorkletHarness({ binding });
  await registerFallback(harness);
  await harness.send({
    type: 'updatePlugins',
    plugins: [pluginConfig(), pluginConfig({ id: 8 })],
    masterBypass: false
  });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });

  const operationRevisions = new Map();
  const sendAsset = (pluginId, footprintBytes, sample) => {
    const operationRevision = (operationRevisions.get(pluginId) || 0) + 1;
    operationRevisions.set(pluginId, operationRevision);
    return harness.send({
    type: 'setPluginAsset', pluginId, slot: 0, formatTag: 1,
    headBlock: 128, rateDivider: 1, pathCount: 0, inputCount: 0, processingChannels: 2,
    footprintBytes, operationRevision, payload: assetPayload(sample)
    });
  };
  const mib = 1024 * 1024;
  await sendAsset(7, 80 * mib, 0.25);
  await harness.send({
    type: 'setPluginAsset', pluginId: 8, slot: 0, formatTag: 1,
    headBlock: 128, rateDivider: 1, pathCount: 0, inputCount: 0, processingChannels: 2,
    operationRevision: 1, payload: assetPayload(0.5)
  });
  operationRevisions.set(8, 1);
  await sendAsset(8, 35, 0.5);
  assert.equal(messagesOf(harness.posts, 'assetLoadRejected').at(-1).message.reason,
    'invalid-asset');
  await sendAsset(8, 49 * mib, 0.5);
  let stagingCalls = binding.calls.filter(call => call[0] === 'instanceSetAsset');
  assert.equal(stagingCalls.length, 1);
  assert.equal(stagingCalls[0][1], 100);
  assert.equal(messagesOf(harness.posts, 'assetLoadRejected').at(-1).message.reason,
    'module-budget');
  assert.equal(harness.processor.dspAssetCache.has(8), false);

  await sendAsset(7, 127 * mib, 0.75);
  assert.equal(harness.processor.dspAssetCache.get(7).get(0).footprintBytes, 127 * mib);
  await sendAsset(8, 2 * mib, 1);
  stagingCalls = binding.calls.filter(call => call[0] === 'instanceSetAsset');
  assert.equal(stagingCalls.length, 2);
  assert.equal(harness.processor.dspAssetCache.has(8), false);

  await harness.send({ type: 'clearPluginAsset', pluginId: 7, slot: 0 });
  assert.ok(binding.calls.some(call => call[0] === 'instanceAssetAbort' && call[1] === 100));
  await sendAsset(8, 128 * mib, 0.5);
  assert.equal(harness.processor.dspAssetCache.get(8).get(0).footprintBytes, 128 * mib);
  const acceptedPayload = harness.processor.dspAssetCache.get(8).get(0).payload;
  assert.equal(new Float32Array(acceptedPayload.buffer, acceptedPayload.byteOffset + 32, 1)[0], 0.5);

  await sendAsset(8, 129 * mib, 1);
  await sendAsset(8, -1, 1);
  assert.equal(harness.processor.dspAssetCache.get(8).get(0).footprintBytes, 128 * mib);
  assert.equal(new Float32Array(acceptedPayload.buffer, acceptedPayload.byteOffset + 32, 1)[0], 0.5);
  assert.equal(messagesOf(harness.posts, 'assetLoadRejected').at(-1).message.reason,
    'invalid-asset');

  await harness.send({ type: 'dspEnableTypes', types: [] });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  stagingCalls = binding.calls.filter(call => call[0] === 'instanceSetAsset');
  assert.equal(stagingCalls.length, 4);
  assert.equal(stagingCalls.at(-1)[1], 103);
  assert.equal(new Float32Array(Uint8Array.from(stagingCalls.at(-1)[3]).buffer, 32, 1)[0], 0.5);
});

test('worklet applies a telemetry rate received before DSP initialization', async () => {
  const binding = createBinding();
  const harness = await createWorkletHarness({ binding });

  await harness.send({ type: 'dspSetTelemetryRate', hz: 15 });
  assert.equal(binding.calls.some(call => call[0] === 'setTelemetryRate'), false);

  await harness.send({ type: 'dspModule', module: { compiled: true } });
  assert.deepEqual(
    binding.calls.filter(call => call[0] === 'setTelemetryRate'),
    [['setTelemetryRate', 15]]
  );
});

test('worklet uses one native pipeline call when every active node is WASM-ready', async () => {
  const binding = createBinding({
    pipelineConfigureStatus: 0,
    pipelineGain: 3
  });
  const harness = await createWorkletHarness({ binding });
  await registerFallback(harness);
  await harness.send({
    type: 'updatePlugins',
    plugins: [
      pluginConfig(),
      { id: 40, type: 'UnsupportedPlugin', enabled: false, parameters: {}, inputBus: 0, outputBus: 0 }
    ],
    masterBypass: false
  });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });

  const configureCall = binding.calls.find(call => call[0] === 'pipelineConfigure');
  assert.ok(configureCall);
  assert.deepEqual(decodeDspPipelineDescriptor(configureCall[1]), {
    version: 1,
    nodes: [{
      instanceId: 100,
      enabled: 1,
      inputBus: 0,
      outputBus: 0,
      channelSpec: -2,
      sectionGate: 1
    }]
  });

  const output = processBlock(harness.processor);
  assert.equal(output[0][0], 3);
  assert.equal(output[1][0], 3);
  assert.equal(binding.calls.filter(call => call[0] === 'pipelineProcess').length, 1);
  assert.equal(binding.calls.filter(call => call[0] === 'instanceProcess').length, 0);
});

test('worklet invalidates a native descriptor before mutation and falls back when reconciliation throws', async () => {
  const binding = createBinding({
    pipelineConfigureStatus: 0,
    pipelineGain: 3,
    wasmGain: 2
  });
  const harness = await createWorkletHarness({ binding });
  await registerFallback(harness);
  await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });

  assert.equal(processBlock(harness.processor)[0][0], 3);
  assert.equal(binding.calls.filter(call => call[0] === 'pipelineProcess').length, 1);

  binding.createInstance = type => {
    binding.calls.push(['createInstance', type]);
    throw new Error('instance allocation failed');
  };
  await harness.send({ type: 'addPlugin', plugin: pluginConfig({ id: 8 }) });

  assert.deepEqual(harness.processor.plugins.map(plugin => plugin.id), [7, 8]);
  assert.equal(harness.processor.dspPipelineReady, false);
  assert.equal(harness.processor.wasmInstances.has(8), false);
  assert.ok(messagesOf(harness.posts, 'dspFailed').some(
    entry => entry.message.stage === 'reconcile:8' &&
      entry.message.error.includes('instance allocation failed')
  ));

  const output = processBlock(harness.processor);
  assert.equal(output[0][0], 12);
  assert.equal(output[1][0], 12);
  assert.equal(binding.calls.filter(call => call[0] === 'pipelineProcess').length, 1);
  assert.equal(binding.calls.filter(call => call[0] === 'instanceProcess').length, 1);
});

test('worklet adopts grown WASM memory when instance creation returns zero', async () => {
  const binding = createBinding();
  const initialArena = binding.arena;
  let currentArena = initialArena;
  binding.memory = { buffer: initialArena.combined.buffer };
  binding.getArenaViews = () => {
    binding.calls.push(['getArenaViews']);
    return currentArena;
  };
  binding.createInstance = type => {
    binding.calls.push(['createInstance', type]);
    const previousBuffer = currentArena.combined.buffer;
    currentArena = createArena();
    binding.memory = { buffer: currentArena.combined.buffer };
    structuredClone(previousBuffer, { transfer: [previousBuffer] });
    return 0;
  };

  const harness = await createWorkletHarness({ binding });
  await registerFallback(harness);
  await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });

  assert.equal(initialArena.combined.byteLength, 0);
  assert.equal(harness.processor.bufferPool.combined, currentArena.combined);
  assert.equal(harness.processor.wasmInstances.size, 0);
  const output = processBlock(harness.processor);
  assert.equal(output[0][0], 11);
  assert.equal(output[1][0], 11);
});

test('worklet reports the active main-bus latency only when the routed value changes', async () => {
  const binding = createBinding({
    instanceLatency: 96,
    pipelineConfigureStatus: 0
  });
  const harness = await createWorkletHarness({ binding });
  await harness.send({
    type: 'updatePlugins',
    plugins: [
      pluginConfig({ id: 7, inputBus: 0, outputBus: 1 }),
      pluginConfig({ id: 8, inputBus: 1, outputBus: 0 }),
      pluginConfig({ id: 9, inputBus: 0, outputBus: 2 })
    ],
    masterBypass: false
  });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });

  let latencyMessages = messagesOf(harness.posts, 'dspLatency');
  assert.equal(latencyMessages.length, 1);
  assert.equal(latencyMessages[0].message.samples, 192);
  assert.equal(latencyMessages[0].message.sampleRate, 48000);
  assert.equal(latencyMessages[0].message.compensated, false);

  await harness.send({
    type: 'updatePlugin',
    plugin: pluginConfig({ inputBus: 0, outputBus: 1, wasmParams: Float32Array.of(2) })
  });
  assert.equal(messagesOf(harness.posts, 'dspLatency').length, 1);
  await harness.send({ type: 'updatePlugins', plugins: [], masterBypass: false });
  latencyMessages = messagesOf(harness.posts, 'dspLatency');
  assert.equal(latencyMessages.length, 2);
  assert.equal(latencyMessages[1].message.samples, 0);
});

test('worklet restores the input block and falls back to hybrid after pipeline failure', async () => {
  const binding = createBinding({
    pipelineConfigureStatus: 0,
    pipelineProcessStatuses: [-7],
    pipelineMutateOnFailure: true,
    pipelineGain: 9,
    wasmGain: 2
  });
  const harness = await createWorkletHarness({ binding });
  await registerFallback(harness);
  await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });

  const first = processBlock(harness.processor);
  assert.equal(first[0][0], 2);
  assert.equal(first[1][0], 2);
  assert.equal(harness.processor.dspPipelineReady, false);
  assert.equal(messagesOf(harness.posts, 'dspFailed').filter(
    entry => entry.message.stage === 'pipeline-process'
  ).length, 1);

  const second = processBlock(harness.processor);
  assert.equal(second[0][0], 2);
  assert.equal(second[1][0], 2);
  assert.equal(binding.calls.filter(call => call[0] === 'pipelineProcess').length, 1);
  assert.equal(binding.calls.filter(call => call[0] === 'instanceProcess').length, 2);
});

test('worklet bypasses a pipeline block when WASM memory grows during processing', async () => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
  const arena = createWasmArena(memory);
  const binding = createBinding({
    arena,
    memory,
    pipelineConfigureStatus: 0,
    pipelineGain: 9,
    growMemoryOnPipelineProcess: true,
    pipelineProcessError: new Error('pipeline memory growth trap')
  });
  const harness = await createWorkletHarness({ binding });
  await registerFallback(harness);
  await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });

  const first = processBlock(harness.processor, 0.25);
  assert.equal(arena.combined.byteLength, 0);
  assert.equal(first[0][0], 0.25);
  assert.equal(first[1][0], 0.25);
  assert.equal(harness.processor.dspLive, false);
  assert.equal(messagesOf(harness.posts, 'dspCleanupNeeded').length, 1);

  await harness.send({ type: 'dspCleanupFailed' });
  const second = processBlock(harness.processor, 0.5);
  assert.equal(second[0][0], 10.5);
  assert.equal(second[1][0], 10.5);
  assert.equal(harness.processor.dspBinding, null);
});

test('worklet restores hybrid input before JavaScript fallback after a partial WASM trap', async () => {
  const binding = createBinding({
    processStatuses: [-7],
    instanceMutateOnFailure: true,
    instanceProcessError: new Error('partial process trap'),
    wasmGain: 9
  });
  const harness = await createWorkletHarness({ binding });
  await registerFallback(harness);
  await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });

  const output = processBlock(harness.processor);
  assert.equal(output[0][0], 11);
  assert.equal(output[1][0], 11);
  assert.ok(messagesOf(harness.posts, 'dspFailed').some(
    entry => entry.message.stage === 'runtime:7' && entry.message.error === 'partial process trap'
  ));
});

test('worklet bypasses a pair block when WASM memory grows during instance processing', async () => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
  const arena = createWasmArena(memory);
  const binding = createBinding({
    arena,
    memory,
    processStatuses: [-7],
    instanceMutateOnFailure: true,
    wasmGain: 9,
    growMemoryOnInstanceProcess: true,
    instanceProcessError: new Error('instance memory growth trap')
  });
  const harness = await createWorkletHarness({ binding });
  await registerFallback(harness);
  await harness.send({
    type: 'updatePlugins',
    plugins: [pluginConfig({ channel: null })],
    masterBypass: false
  });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 1,
    silenceThresholdDb: -80,
    silenceDurationSeconds: 0,
    wakeGainMarginDb: 24,
    enabledPluginCount: 1,
    monitoringPreparationCapabilities: [{ pluginId: 7, capability: 'stateless' }],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true,
    monitoringFastWakeBlockerReason: null
  });
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'full-process',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 2,
    skipEpoch: 1
  });
  const beforeFrame = harness.processor.currentFrame;
  const beforeRenderSequence = harness.processor.powerPolicy.renderSequence;
  const beforeRenderQuanta = harness.processor.powerPolicy.counters.renderQuanta;

  const first = processBlock(harness.processor, 0.25);
  assert.equal(arena.scratch.stereo.byteLength, 0);
  assert.equal(first[0][0], 0.25);
  assert.equal(first[1][0], 0.25);
  assert.equal(harness.processor.dspLive, false);
  assert.equal(messagesOf(harness.posts, 'dspCleanupNeeded').length, 1);
  assert.equal(harness.processor.currentFrame, beforeFrame + 128);
  assert.equal(harness.processor.powerPolicy.renderSequence, beforeRenderSequence + 1);
  assert.equal(harness.processor.powerPolicy.counters.renderQuanta, beforeRenderQuanta + 1);
  assert.equal(harness.processor.powerPolicy.counters.fullProcessQuanta, 1);
  assert.ok(harness.processor.powerPolicy.outputPowerEwma > 0);
  assert.equal(messagesOf(harness.posts, 'powerFirstRender').at(-1).message.commandId, 2);

  await harness.send({ type: 'dspCleanupFailed' });
  const second = processBlock(harness.processor, 0.5);
  assert.equal(second[0][0], 10.5);
  assert.equal(second[1][0], 10.5);
  assert.equal(harness.processor.dspBinding, null);
});

test('worklet selects JS fallback for rollout, packing, and process failures then disables a failing type', async () => {
  const binding = createBinding({
    processStatuses: [0, -7, -7, -7],
    instanceMutateOnFailure: true
  });
  const harness = await createWorkletHarness({ binding });
  await registerFallback(harness);
  await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()] });
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });

  assert.equal(processBlock(harness.processor)[0][0], 2);

  await harness.send({ type: 'dspEnableTypes', types: [] });
  assert.equal(processBlock(harness.processor)[0][0], 11);

  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({
    type: 'updatePlugin',
    plugin: pluginConfig({ wasmParams: undefined, wasmParamsHash: undefined })
  });
  assert.equal(harness.processor.wasmInstances.get(7).ready, false);
  assert.equal(processBlock(harness.processor)[0][0], 11);

  for (let failure = 0; failure < 3; failure++) {
    await harness.send({ type: 'updatePlugin', plugin: pluginConfig() });
    assert.equal(processBlock(harness.processor)[0][0], 11);
  }
  assert.equal(harness.processor.dspRuntimeFailures.get('VolumePlugin'), 3);
  assert.equal(harness.processor.dspEnabledTypes.has('VolumePlugin'), false);
  assert.equal(harness.processor.wasmInstances.size, 0);
  assert.equal(messagesOf(harness.posts, 'dspFailed').filter(entry => entry.message.stage === 'runtime:7').length, 1);
  assert.ok(harness.processor.dspPendingInstanceDestroy.length > 0);
  await harness.send({ type: 'dspCleanupFailed' });
  assert.equal(harness.processor.dspPendingInstanceDestroy.length, 0);
  assert.ok(binding.calls.some(call => call[0] === 'destroyInstance'));
});

test('worklet transfers telemetry packets, accepts pool returns, and falls back after memory growth', async () => {
  const binding = createBinding({ telemetryBytes: [32], telemetryDroppedFrames: 4 });
  const harness = await createWorkletHarness({ binding });
  await harness.send({ type: 'dspModule', bytes: new ArrayBuffer(16) });
  assert.equal(harness.factories[0].payload.byteLength, 16);
  assert.equal(harness.processor.dspPacketPool.length, 3);
  assert.ok(harness.processor.dspPacketPool.every(packet => packet instanceof Uint8Array));
  const firstPacketView = harness.processor.dspPacketPool.at(-1);

  processBlock(harness.processor);
  const firstTelemetryRead = binding.calls.find(call => call[0] === 'telemetryRead');
  assert.equal(firstTelemetryRead[1], firstPacketView);
  const telemetry = messagesOf(harness.posts, 'dspTelemetry');
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].message.bytes, 32);
  assert.equal(telemetry[0].message.droppedFrames, 4);
  assert.equal(telemetry[0].transfer.length, 1);
  assert.equal(telemetry[0].transfer[0], telemetry[0].message.packet);
  assert.equal(harness.processor.dspPacketPool.length, 2);
  await harness.send({ type: 'dspTelemetryReturn', packet: telemetry[0].message.packet });
  assert.equal(harness.processor.dspPacketPool.length, 3);
  assert.ok(harness.processor.dspPacketPool.at(-1) instanceof Uint8Array);

  const readCount = binding.calls.filter(call => call[0] === 'telemetryRead').length;
  processBlock(harness.processor);
  processBlock(harness.processor);
  const emptyReads = binding.calls.filter(call => call[0] === 'telemetryRead').slice(readCount);
  assert.equal(emptyReads.length, 2);
  assert.equal(emptyReads[0][1], emptyReads[1][1]);

  binding.makeMemoryUnexpected();
  const output = processBlock(harness.processor, 0.25);
  assert.equal(output[0][0], 0.25);
  assert.equal(harness.processor.dspLive, false);
  assert.equal(messagesOf(harness.posts, 'dspFailed').filter(entry => entry.message.stage === 'runtime').length, 1);
  processBlock(harness.processor, 0.5);
  assert.equal(messagesOf(harness.posts, 'dspFailed').filter(entry => entry.message.stage === 'runtime').length, 1);
  await harness.send({ type: 'dspCleanupFailed' });
  assert.equal(harness.processor.dspBinding, null);
  assert.ok(binding.calls.some(call => call[0] === 'close'));
});

test('worklet requests engine cleanup again when an identical failure repeats after reinitialization', async () => {
  const binding = createBinding();
  const harness = await createWorkletHarness({ binding });

  for (let attempt = 0; attempt < 2; attempt++) {
    await harness.send({ type: 'dspModule', module: { compiled: true } });
    binding.makeMemoryUnexpected();
    processBlock(harness.processor);
    assert.equal(harness.processor.dspEngineNeedsCleanup, true);
    await harness.send({ type: 'dspCleanupFailed' });
    assert.equal(harness.processor.dspBinding, null);
  }

  assert.equal(messagesOf(harness.posts, 'dspFailed').filter(
    entry => entry.message.stage === 'runtime' && entry.message.error === 'memory.buffer identity changed'
  ).length, 1);
  assert.equal(messagesOf(harness.posts, 'dspCleanupNeeded').length, 2);
  assert.equal(binding.calls.filter(call => call[0] === 'close').length, 2);
});

test('worklet reports a repeated instantiation failure once and accepts module or byte payloads', async () => {
  const harness = await createWorkletHarness({ instantiateError: new Error('bad artifact') });
  await harness.send({ type: 'dspModule', module: { compiled: true } });
  await harness.send({ type: 'dspModule', bytes: new ArrayBuffer(4) });
  assert.equal(harness.factories.length, 2);
  assert.equal(messagesOf(harness.posts, 'dspReady').length, 0);
  const failures = messagesOf(harness.posts, 'dspFailed');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].message.type, 'dspFailed');
  assert.equal(failures[0].message.stage, 'instantiate');
  assert.equal(failures[0].message.error, 'bad artifact');
});

test('explicit power protocol arms once, monitors, and processes the wake block in the same quantum', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 1,
    silenceThresholdDb: -80,
    silenceDurationSeconds: 0,
    wakeGainMarginDb: 24,
    enabledPluginCount: 0,
    monitoringPreparationCapabilities: [],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true,
    monitoringFastWakeBlockerReason: null
  });
  processBlock(harness.processor, 0);
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'allow-automatic',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 11,
    skipEpoch: 101,
    armAfterRenderSequence: harness.processor.powerPolicy.renderSequence
  });

  processBlock(harness.processor, 0);
  assert.equal(harness.processor.powerPolicy.state, 'monitoring');
  assert.equal(harness.processor.powerPolicy.arm.state, 'consumed');
  assert.equal(harness.processor.powerPolicy.skippedFrameCount, 0);

  const amplitude = 10 ** (-85 / 20);
  const input = [
    Float32Array.from({ length: 128 }, (_, index) => index % 2 ? amplitude : -amplitude),
    new Float32Array(128)
  ];
  const output = [new Float32Array(128), new Float32Array(128)];
  harness.processor.process([input], [output], {});
  assert.equal(harness.processor.powerPolicy.state, 'active');
  assert.equal(harness.processor.powerPolicy.arm.state, 'disarmed');
  assert.notEqual(output[0][0], 0);
  assert.equal(harness.processor.powerPolicy.counters.fullProcessQuanta, 3);

  await harness.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'allow-automatic',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 12,
    skipEpoch: 102,
    armAfterRenderSequence: harness.processor.powerPolicy.renderSequence
  });
  assert.equal(harness.processor.powerPolicy.arm.state, 'armed');
  assert.equal(harness.processor.powerPolicy.arm.commandId, 12);
  assert.equal(harness.processor.powerPolicy.inputSilentFrames, 0);
  assert.equal(harness.processor.powerPolicy.outputSilentFrames, 0);

  processBlock(harness.processor, 0);
  assert.equal(harness.processor.powerPolicy.state, 'monitoring');
  const secondWakeOutput = processBlock(harness.processor, amplitude);
  assert.equal(harness.processor.powerPolicy.state, 'active');
  assert.equal(harness.processor.powerPolicy.arm.state, 'disarmed');
  assert.notEqual(secondWakeOutput[0][0], 0);

  await harness.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'allow-automatic',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 12,
    skipEpoch: 102,
    armAfterRenderSequence: harness.processor.powerPolicy.renderSequence
  });
  assert.equal(harness.processor.powerPolicy.arm.state, 'disarmed');
  const replayAck = messagesOf(harness.posts, 'powerStateAck').at(-1).message;
  assert.equal(replayAck.automaticArmAccepted, false);
  assert.equal(replayAck.commandAccepted, false);
  assert.equal(replayAck.commandRejectedReason, 'stale-power-command');
});

test('finite gain wakes and processes a sub-threshold input in its first quantum', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'registerProcessor',
    pluginType: 'VolumePlugin',
    processor: 'for (let i = 0; i < data.length; i++) data[i] *= 16; return data;'
  });
  await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 1,
    silenceThresholdDb: -80,
    silenceDurationSeconds: 0,
    wakeGainMarginDb: 24,
    enabledPluginCount: 1,
    monitoringPreparationCapabilities: [{ pluginId: 7, capability: 'stateless' }],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true
  });
  processBlock(harness.processor, 0);
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'allow-automatic',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 2,
    skipEpoch: 1,
    armAfterRenderSequence: harness.processor.powerPolicy.renderSequence
  });
  processBlock(harness.processor, 0);
  assert.equal(harness.processor.powerPolicy.state, 'monitoring');

  const amplitude = 10 ** (-100 / 20);
  const input = [
    Float32Array.from({ length: 128 }, (_, index) => index % 2 ? amplitude : -amplitude),
    new Float32Array(128)
  ];
  const output = [new Float32Array(128), new Float32Array(128)];
  harness.processor.process([input], [output], {});
  assert.equal(harness.processor.powerPolicy.state, 'active');
  assert.ok(Math.abs(output[0][0] + amplitude * 16) < 1e-10);
});

for (const scenario of [
  {
    name: 'finite input',
    wakeOnAnyInput: false,
    process(processor) { return processBlock(processor, 0.25); },
    verify(output) { assert.equal(output[0][0], 0.25); }
  },
  {
    name: 'wake-on-any input',
    wakeOnAnyInput: true,
    process(processor) { return processBlock(processor, 1e-8); },
    verify(output) { assert.ok(Math.abs(output[0][0] - 1e-8) < 1e-14); }
  },
  {
    name: 'nonfinite input',
    wakeOnAnyInput: false,
    process(processor) {
      const input = [
        Float32Array.of(NaN, ...new Array(127).fill(0)),
        new Float32Array(128)
      ];
      const output = [new Float32Array(128), new Float32Array(128)];
      processor.process([input], [output], {});
      return output;
    },
    verify(output) { assert.ok(Number.isNaN(output[0][0])); }
  }
]) {
  test(`force-monitoring keeps ${scenario.name} dry for host resume`, async () => {
    const harness = await createWorkletHarness();
    await harness.send({
      type: 'registerProcessor',
      pluginType: 'VolumePlugin',
      processor: 'for (let i = 0; i < data.length; i++) data[i] *= 5; return data;'
    });
    await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
    await harness.send({
      type: 'configurePowerPolicy',
      enabled: true,
      workletGraphGeneration: 3,
      topologyRevision: 7,
      commandId: 1,
      silenceThresholdDb: -80,
      silenceDurationSeconds: 60,
      wakeOnAnyInput: scenario.wakeOnAnyInput,
      enabledPluginCount: 1,
      monitoringPreparationCapabilities: [{ pluginId: 7, capability: 'stateless' }],
      temporalSkipEligible: true,
      monitoringFastWakeEligible: false
    });
    processBlock(harness.processor, 0);
    await harness.send({
      type: 'setPowerProcessingState',
      state: 'monitoring',
      processingDirective: 'force-monitoring',
      workletGraphGeneration: 3,
      topologyRevision: 7,
      commandId: 2,
      skipEpoch: 1
    });
    const fullProcessBeforeWake = harness.processor.powerPolicy.counters.fullProcessQuanta;

    const output = scenario.process(harness.processor);
    scenario.verify(output);
    assert.equal(harness.processor.powerPolicy.state, 'monitoring');
    assert.equal(harness.processor.powerPolicy.processingDirective, 'force-monitoring');
    assert.equal(harness.processor.powerPolicy.skipEpoch, 1);
    assert.equal(
      harness.processor.powerPolicy.counters.fullProcessQuanta,
      fullProcessBeforeWake
    );
    assert.equal(harness.processor.powerPolicy.counters.monitoringRuntimeFailures, 0);
    const observation = messagesOf(harness.posts, 'powerObservation').at(-1).message;
    assert.equal(observation.reason, 'host-temporal-resume-required');
    assert.notEqual(
      observation.monitoringFastWakeBlockerReason,
      'temporal-preparation-runtime-failed'
    );
  });
}

test('force-monitoring never resets state locally on signal', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'registerProcessor',
    pluginType: 'ResetWakePlugin',
    processor: `
      this.calls = (this.calls || 0) + 1;
      for (let index = 0; index < data.length; index++) data[index] *= this.calls;
      return data;
    `
  });
  await harness.send({
    type: 'updatePlugins',
    plugins: [{ id: 31, type: 'ResetWakePlugin', enabled: true, parameters: {} }],
    masterBypass: false
  });
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 1,
    silenceThresholdDb: -80,
    enabledPluginCount: 1,
    monitoringPreparationCapabilities: [{
      pluginId: 31,
      capability: 'reset-on-resume',
      descriptor: { primitive: 'canonical-reset', fixedOperations: 1 }
    }],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: false
  });
  processBlock(harness.processor, 0);
  harness.processor.pluginContexts.get(31).calls = 9;
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 2,
    skipEpoch: 1
  });
  processBlock(harness.processor, 0);
  processBlock(harness.processor, 0);
  assert.equal(harness.processor.powerPolicy.skippedFrameCount, 256);

  const output = processBlock(harness.processor, 0.25);
  assert.equal(output[0][0], 0.25);
  assert.equal(harness.processor.pluginContexts.get(31).calls, 9);
  assert.equal(harness.processor.powerPolicy.skippedFrameCount, 384);
  assert.equal(harness.processor.powerPolicy.skipEpoch, 1);
});

test('force-monitoring never ages state locally on signal', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'registerProcessor',
    pluginType: 'AgeWakePlugin',
    processor: 'data.fill(this.phase ?? -1); return data;'
  });
  await harness.send({
    type: 'updatePlugins',
    plugins: [{ id: 32, type: 'AgeWakePlugin', enabled: true, parameters: {} }],
    masterBypass: false
  });
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 1,
    silenceThresholdDb: -80,
    enabledPluginCount: 1,
    monitoringPreparationCapabilities: [{
      pluginId: 32,
      capability: 'age-by-skipped-frames',
      descriptor: {
        primitive: 'analytic-age',
        allocationFree: true,
        fixedOperations: 1,
        parameterTimeline: 'topology-invalidates-skip',
        resetFallback: 'canonical-reset',
        stateFields: [{ key: 'phase', incrementPerFrame: 1 / 48000, modulo: 1 }]
      }
    }],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: false
  });
  processBlock(harness.processor, 0);
  harness.processor.pluginContexts.set(32, { phase: 0.25 });
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 2,
    skipEpoch: 1
  });
  processBlock(harness.processor, 0);
  processBlock(harness.processor, 0);
  processBlock(harness.processor, 0);
  assert.equal(harness.processor.powerPolicy.skippedFrameCount, 384);

  const output = processBlock(harness.processor, 0.25);
  assert.equal(output[0][0], 0.25);
  assert.equal(harness.processor.pluginContexts.get(32).phase, 0.25);
  assert.equal(harness.processor.powerPolicy.skippedFrameCount, 512);
  assert.equal(harness.processor.powerPolicy.skipEpoch, 1);
});

test('atomic host resume resets state and consumes force ownership', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'registerProcessor',
    pluginType: 'HostResetPlugin',
    processor: `
      this.calls = (this.calls || 0) + 1;
      for (let index = 0; index < data.length; index++) data[index] *= this.calls;
      return data;
    `
  });
  await harness.send({
    type: 'updatePlugins',
    plugins: [{ id: 34, type: 'HostResetPlugin', enabled: true, parameters: {} }],
    masterBypass: false
  });
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 1,
    silenceThresholdDb: -80,
    enabledPluginCount: 1,
    monitoringPreparationCapabilities: [{
      pluginId: 34,
      capability: 'reset-on-resume',
      descriptor: { primitive: 'canonical-reset', fixedOperations: 1 }
    }],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: false
  });
  processBlock(harness.processor, 0);
  harness.processor.pluginContexts.get(34).calls = 9;
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 2,
    skipEpoch: 1
  });

  assert.equal(processBlock(harness.processor, 0.25)[0][0], 0.25);
  assert.equal(processBlock(harness.processor, 0.25)[0][0], 0.25);
  assert.equal(harness.processor.pluginContexts.get(34).calls, 9);
  assert.equal(harness.processor.powerPolicy.skippedFrameCount, 256);
  const activity = messagesOf(harness.posts, 'powerObservation').at(-1).message;
  assert.equal(activity.reason, 'host-temporal-resume-required');
  assert.equal(activity.inputActive, true);

  await harness.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'full-process',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 3,
    skipEpoch: 1
  });
  let acknowledgement = messagesOf(harness.posts, 'powerStateAck').at(-1).message;
  assert.equal(acknowledgement.commandAccepted, false);
  assert.equal(acknowledgement.commandRejectedReason, 'atomic-temporal-resume-required');
  assert.equal(harness.processor.powerPolicy.processingDirective, 'force-monitoring');
  assert.equal(harness.processor.powerPolicy.commandId, 2);

  await harness.send({
    type: 'prepareTemporalStateAndResume',
    origin: 'deliberate',
    ownerOperationId: 'host-reset-resume',
    commandId: 2,
    resumeCommandId: 5,
    ackCommandId: 4,
    skipEpoch: 1,
    skippedFrameCount: 256,
    suspendedElapsedMs: 1000,
    elapsedContinuity: 'verified',
    resumeSampleRate: 48000,
    workletGraphGeneration: 3,
    topologyRevision: 7
  });
  const preparation = messagesOf(harness.posts, 'temporalStateResumed').at(-1).message;
  assert.equal(preparation.state, 'acknowledged');
  assert.equal(preparation.skippedFrameCount, 48256);
  assert.equal(harness.processor.pluginContexts.has(34), false);
  assert.equal(harness.processor.powerPolicy.state, 'active');
  assert.equal(harness.processor.powerPolicy.processingDirective, 'full-process');
  assert.equal(harness.processor.powerPolicy.commandId, null);
  assert.equal(harness.processor.powerPolicy.skipEpoch, null);
  assert.equal(processBlock(harness.processor, 0.25)[0][0], 0.25);
  assert.equal(harness.processor.pluginContexts.get(34).calls, 1);
});

test('atomic host resume ages the complete skipped interval before full processing', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'registerProcessor',
    pluginType: 'HostAgePlugin',
    processor: 'data.fill(this.phase ?? -1); return data;'
  });
  await harness.send({
    type: 'updatePlugins',
    plugins: [{ id: 35, type: 'HostAgePlugin', enabled: true, parameters: {} }],
    masterBypass: false
  });
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 1,
    silenceThresholdDb: -80,
    enabledPluginCount: 1,
    monitoringPreparationCapabilities: [{
      pluginId: 35,
      capability: 'age-by-skipped-frames',
      descriptor: {
        primitive: 'analytic-age',
        allocationFree: true,
        fixedOperations: 1,
        parameterTimeline: 'topology-invalidates-skip',
        resetFallback: 'canonical-reset',
        stateFields: [{ key: 'phase', incrementPerFrame: 1 / 48000, modulo: 1 }]
      }
    }],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: false
  });
  processBlock(harness.processor, 0);
  harness.processor.pluginContexts.set(35, { phase: 0.25 });
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 2,
    skipEpoch: 1
  });

  assert.equal(processBlock(harness.processor, 0.5)[0][0], 0.5);
  assert.equal(processBlock(harness.processor, 0.5)[0][0], 0.5);
  assert.equal(harness.processor.pluginContexts.get(35).phase, 0.25);
  await harness.send({
    type: 'prepareTemporalStateAndResume',
    origin: 'deliberate',
    ownerOperationId: 'host-age-resume',
    commandId: 2,
    resumeCommandId: 3,
    ackCommandId: 4,
    skipEpoch: 1,
    skippedFrameCount: 256,
    suspendedElapsedMs: 1000,
    elapsedContinuity: 'verified',
    resumeSampleRate: 48000,
    workletGraphGeneration: 3,
    topologyRevision: 7
  });
  const expectedPhase = (0.25 + 48256 / 48000) % 1;
  assert.ok(Math.abs(harness.processor.pluginContexts.get(35).phase - expectedPhase) < 1e-12);
  assert.equal(harness.processor.powerPolicy.state, 'active');
  assert.equal(harness.processor.powerPolicy.processingDirective, 'full-process');
  const output = processBlock(harness.processor, 0.5);
  assert.ok(Math.abs(output[0][0] - expectedPhase) < 1e-7);
  assert.ok(Math.abs(harness.processor.pluginContexts.get(35).phase - expectedPhase) < 1e-12);
});

test('maximum external-input bridge keeps fresh guards through release and reacquire', async () => {
  const harness = await createWorkletHarness();
  const ageDescriptor = {
    primitive: 'analytic-age',
    allocationFree: true,
    fixedOperations: 1,
    parameterTimeline: 'topology-invalidates-skip',
    resetFallback: 'canonical-reset',
    stateFields: [{ key: 'phase', incrementPerFrame: 1 / 48000, modulo: 1 }]
  };
  await harness.send({
    type: 'registerProcessor',
    pluginType: 'BridgeResetPlugin',
    processor: 'this.calls = (this.calls || 0) + 1; return data;'
  });
  await harness.send({
    type: 'registerProcessor',
    pluginType: 'BridgeAgePlugin',
    processor: 'data.fill(this.phase ?? -1); return data;'
  });
  await harness.send({
    type: 'updatePlugins',
    plugins: [
      { id: 41, type: 'BridgeResetPlugin', enabled: true, parameters: {} },
      { id: 42, type: 'BridgeAgePlugin', enabled: true, parameters: {} }
    ],
    masterBypass: false
  });

  const pipeline = [
    {
      id: 41,
      enabled: true,
      temporalCapability: 'reset-on-resume',
      monitoringPreparationDescriptor: {
        primitive: 'canonical-reset',
        allocationFree: true,
        fixedOperations: 1
      }
    },
    {
      id: 42,
      enabled: true,
      temporalCapability: 'age-by-skipped-frames',
      monitoringPreparationDescriptor: ageDescriptor
    }
  ];
  const context = { state: 'running', sampleRate: 48000, destination: { channelCount: 2 } };
  const controllerMessages = [];
  const workletMessages = [];
  const timeline = [];
  let monotonicNow = 0;
  let holdAtomicResume = false;
  let pendingAtomicResume = null;
  let inputSourceNode = { id: 'bridge-input-1' };
  let controller;
  const workletNode = {
    port: {
      postMessage(message) {
        controllerMessages.push(message);
        timeline.push(`host:${message.type}`);
        if (holdAtomicResume && message.type === 'prepareTemporalStateAndResume') {
          pendingAtomicResume = message;
          return;
        }
        harness.processor.port.onmessage({ data: message });
      }
    }
  };
  const inputSnapshot = {
    state: 'live',
    inputAvailability: 'available',
    inputAvailabilityRevision: 1,
    inputGeneration: 1,
    inputResourceId: 'bridge-input-1',
    inputConfigured: true,
    inputSourcePresent: true,
    trackState: 'live'
  };
  const audioManager = {
    pipeline,
    pipelineA: pipeline,
    pipelineB: null,
    masterBypass: false,
    workletNode,
    contextManager: {
      audioContext: context,
      async suspendForPowerPolicy() { context.state = 'suspended'; return true; },
      async resumeForPowerPolicy() { context.state = 'running'; return true; }
    },
    ioManager: {
      inputGeneration: 1,
      audioElement: null,
      inputSourceNode,
      sourceNode: inputSourceNode,
      getInputSnapshot() { return inputSnapshot; },
      async beginReacquireAudioInput() {
        inputSourceNode = { id: 'bridge-input-2' };
        this.inputSourceNode = inputSourceNode;
        this.sourceNode = inputSourceNode;
        this.inputGeneration = 2;
        Object.assign(inputSnapshot, {
          state: 'live',
          inputAvailability: 'available',
          inputAvailabilityRevision: 2,
          inputGeneration: 2,
          inputResourceId: 'bridge-input-2',
          inputSourcePresent: true,
          trackState: 'live'
        });
        return inputSnapshot;
      },
      async playOutputBridgeForGesture() { return true; },
      pauseOutputBridge() {}
    },
    ensureSourceConnectedToPipeline() { return true; },
    isSourceConnectedToPipeline(source) { return source === inputSourceNode; },
    getCurrentPipeline() { return pipeline; },
    getActivePowerWorklets() { return [workletNode]; },
    getPowerWorkletGraphGeneration() { return 0; },
    getPowerTopologyRevision() { return 0; },
    broadcastToActiveWorklets(message) { workletNode.port.postMessage(message); },
    powerDiagnostics: { recordEffectiveCommit() {}, mergeWorkletCounters() {} },
    setPlayerPowerUiEnabled() {},
    dispatchEvent() {}
  };
  controller = new PowerPolicyController(audioManager, {
    enabled: true,
    settings: { mode: 'maximum', silenceThresholdDb: -80, fullSuspendDelaySeconds: 300 },
    windowRef: {
      location: { search: '' },
      localStorage: { getItem() { return null; } },
      sessionStorage: { getItem() { return null; }, setItem() {} },
      crypto: { randomUUID: () => 'bridge-test' },
      audioPreferences: { inputDeviceId: 'bridge-device' }
    },
    documentRef: { hidden: false },
    now: () => monotonicNow,
    monotonicNow: () => monotonicNow
  });
  controller._emitSnapshot = () => {};
  controller.requestReconcile = () => Promise.resolve();
  controller.started = true;
  harness.processor.port.postMessage = message => {
    workletMessages.push(message);
    timeline.push(`worklet:${message.type}`);
    controller.handleWorkletPowerEvent(message, workletNode);
  };
  const sendToWorklet = async message => {
    workletNode.port.postMessage(message);
    await flushAsyncWork();
  };
  await sendToWorklet({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 0,
    topologyRevision: 0,
    commandId: 100,
    silenceThresholdDb: -80,
    enabledPluginCount: 2,
    monitoringPreparationCapabilities: [
      {
        pluginId: 41,
        capability: 'reset-on-resume',
        descriptor: { primitive: 'canonical-reset', fixedOperations: 1 }
      },
      { pluginId: 42, capability: 'age-by-skipped-frames', descriptor: ageDescriptor }
    ],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: false
  });
  processBlock(harness.processor, 0);
  harness.processor.pluginContexts.get(41).calls = 9;
  harness.processor.pluginContexts.set(42, { phase: 0.25 });

  const enterMonitoring = controller._applyWorkletState('MONITORING', 'force-monitoring');
  await flushAsyncWork();
  processBlock(harness.processor, 0);
  await flushAsyncWork();
  assert.equal(await enterMonitoring, true);
  assert.equal(harness.processor.powerPolicy.skippedFrameCount, 128);

  await audioManager.contextManager.suspendForPowerPolicy();
  controller.effectiveState = 'SUSPENDED';
  controller.processingDirective = 'suspended';
  controller.suspendedTemporalTiming = {
    completedElapsedMs: 0,
    startedAtMonotonicMs: 0,
    endedAtMonotonicMs: null,
    sampleRate: 48000,
    skipEpoch: controller.skipEpoch,
    topologyRevision: 0,
    workletGraphGeneration: 0
  };
  controller.suspendedTemporalContinuity = true;
  const oldOwnerCommandId = controller.lastSkipCommandId;
  const oldOwnerSkipEpoch = controller.skipEpoch;
  Object.assign(inputSnapshot, {
    state: 'released',
    inputAvailability: 'unknown',
    inputGeneration: 1,
    inputResourceId: null,
    inputSourcePresent: false,
    trackState: 'ended'
  });
  inputSourceNode = null;
  audioManager.ioManager.inputSourceNode = null;
  audioManager.ioManager.sourceNode = null;
  controller.notifyTopologyChanged('deferred-input-release');
  await flushAsyncWork();
  const releaseGuard = controllerMessages.findLast(message =>
    message.type === 'configurePowerPolicy' && message.hostGuardDirective);
  assert.ok(releaseGuard);
  assert.equal(releaseGuard.hostGuardDirective, 'force-monitoring');
  assert.notEqual(releaseGuard.commandId, oldOwnerCommandId);
  assert.ok(releaseGuard.hostGuardSkipEpoch > oldOwnerSkipEpoch);
  const acknowledgementsBeforeOldOwner = workletMessages.filter(message =>
    message.type === 'powerStateAck').length;
  await sendToWorklet({
    type: 'setPowerProcessingState',
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    commandId: oldOwnerCommandId,
    skipEpoch: oldOwnerSkipEpoch,
    workletGraphGeneration: 0,
    topologyRevision: 0
  });
  assert.equal(workletMessages.filter(message =>
    message.type === 'powerStateAck').length, acknowledgementsBeforeOldOwner);
  assert.equal(harness.processor.powerPolicy.commandId, releaseGuard.commandId);

  monotonicNow = 1000;
  const gestureStartIndex = timeline.length;
  holdAtomicResume = true;
  const resume = controller.beginUserGestureResume('dedicated-input');
  await flushAsyncWork();
  assert.equal(context.state, 'running');
  assert.equal(controller.suspendedTemporalTiming.endedAtMonotonicMs, 1000);
  assert.equal(controller.suspendedTemporalTiming.completedElapsedMs, 1000);
  const reacquireGuard = controllerMessages.findLast(message =>
    message.type === 'configurePowerPolicy' && message.hostGuardDirective);
  assert.ok(reacquireGuard);
  assert.ok(reacquireGuard.topologyRevision > releaseGuard.topologyRevision);
  assert.equal(pendingAtomicResume, null);

  const resumeSignal = processBlock(harness.processor, 0.5);
  assert.equal(resumeSignal[0][0], 0.5);
  await flushAsyncWork();
  assert.ok(pendingAtomicResume);
  monotonicNow = 1250;
  const extraDryQuantum = processBlock(harness.processor, 0.25);
  assert.equal(extraDryQuantum[0][0], 0.25);
  assert.equal(harness.processor.powerPolicy.processingDirective, 'force-monitoring');
  assert.equal(harness.processor.powerPolicy.commandId, controller.lastSkipCommandId);
  assert.equal(harness.processor.powerPolicy.skippedFrameCount, 384);

  const atomicCommand = pendingAtomicResume;
  pendingAtomicResume = null;
  holdAtomicResume = false;
  harness.processor.port.onmessage({ data: atomicCommand });
  await flushAsyncWork();
  assert.equal(Object.hasOwn(atomicCommand, 'skippedFrameCount'), false);
  assert.equal(atomicCommand.suspendedElapsedMs, 1000);
  const atomicResult = workletMessages.filter(message =>
    message.type === 'temporalStateResumed').at(-1);
  assert.equal(atomicResult.skippedFrameCount, 48384);
  const expectedPhase = (0.25 + (384 + 48000) / 48000) % 1;
  assert.equal(harness.processor.pluginContexts.has(41), false);
  assert.ok(Math.abs(harness.processor.pluginContexts.get(42).phase - expectedPhase) < 1e-12);
  assert.equal(harness.processor.powerPolicy.state, 'active');
  assert.equal(harness.processor.powerPolicy.processingDirective, 'full-process');
  assert.equal(harness.processor.powerPolicy.commandId, null);
  assert.notEqual(controller.getEffectiveState(), 'ACTIVE');
  assert.equal(controller.processingDirective, 'force-monitoring');

  const emptyOutput = [new Float32Array(128), new Float32Array(128)];
  assert.equal(harness.processor.process([[]], [emptyOutput], {}), true);
  await flushAsyncWork();
  assert.notEqual(controller.getEffectiveState(), 'ACTIVE');
  assert.equal(harness.processor.powerPolicy.pendingFirstRenderCommandId,
    atomicCommand.resumeCommandId);

  const duplicate = {
    ...atomicCommand,
    ownerOperationId: 'duplicate-resume',
    ackCommandId: 'duplicate-ack'
  };
  await sendToWorklet(duplicate);
  assert.equal(harness.processor.pluginContexts.has(41), false);
  assert.ok(Math.abs(harness.processor.pluginContexts.get(42).phase - expectedPhase) < 1e-12);
  const duplicateResult = workletMessages.filter(message =>
    message.type === 'temporalStateResumed').at(-1);
  assert.equal(duplicateResult.state, 'acknowledged');
  assert.equal(duplicateResult.ackCommandId, 'duplicate-ack');

  const fullOutput = processBlock(harness.processor, 0.5);
  await flushAsyncWork();
  assert.ok(Math.abs(fullOutput[0][0] - expectedPhase) < 1e-7);
  assert.equal(harness.processor.pluginContexts.get(41).calls, 1);
  assert.equal(await resume, true);
  assert.equal(controller.getEffectiveState(), 'ACTIVE');
  assert.equal(controller.processingDirective, 'full-process');
  assert.equal(controller.lastSkipCommandId, null);
  assert.equal(harness.processor.powerPolicy.lastPowerCommandId, atomicCommand.resumeCommandId);
  assert.equal(harness.processor.powerPolicy.lastAcceptedSkipEpoch, atomicCommand.skipEpoch);
  const gestureTimeline = timeline.slice(gestureStartIndex);
  const firstRenderIndex = gestureTimeline.lastIndexOf('worklet:powerFirstRender');
  const configureIndex = gestureTimeline.lastIndexOf('host:configurePowerPolicy');
  assert.ok(firstRenderIndex >= 0);
  assert.ok(configureIndex > firstRenderIndex);
});

test('public player resume preserves a bypass guard and ages its complete live skip', async () => {
  const harness = await createWorkletHarness();
  const ageDescriptor = {
    primitive: 'analytic-age',
    allocationFree: true,
    fixedOperations: 1,
    parameterTimeline: 'topology-invalidates-skip',
    resetFallback: 'canonical-reset',
    stateFields: [{ key: 'phase', incrementPerFrame: 1 / 48000, modulo: 1 }]
  };
  await harness.send({
    type: 'registerProcessor',
    pluginType: 'BypassAgePlugin',
    processor: 'data.fill(this.phase ?? -1); return data;'
  });
  await harness.send({
    type: 'updatePlugins',
    plugins: [{ id: 61, type: 'BypassAgePlugin', enabled: true, parameters: {} }],
    masterBypass: false
  });

  const pipeline = [{
    id: 61,
    enabled: true,
    temporalCapability: 'age-by-skipped-frames',
    monitoringPreparationDescriptor: ageDescriptor
  }];
  const context = { state: 'running', sampleRate: 48000, destination: { channelCount: 2 } };
  const controllerMessages = [];
  const workletMessages = [];
  let controller;
  const workletNode = {
    port: {
      postMessage(message) {
        controllerMessages.push(message);
        harness.processor.port.onmessage({ data: message });
      }
    }
  };
  const audioManager = {
    pipeline,
    pipelineA: pipeline,
    pipelineB: null,
    masterBypass: false,
    workletNode,
    contextManager: {
      audioContext: context,
      async resumeForPowerPolicy() { return true; }
    },
    ioManager: {
      audioElement: null,
      async playOutputBridgeForGesture() { return true; },
      pauseOutputBridge() {},
      getInputSnapshot() {
        return {
          state: 'not-configured',
          inputAvailability: 'unknown',
          inputAvailabilityRevision: 0,
          inputGeneration: 0,
          inputResourceId: null,
          inputConfigured: false,
          inputSourcePresent: false,
          trackState: 'absent'
        };
      }
    },
    getCurrentPipeline() { return pipeline; },
    getActivePowerWorklets() { return [workletNode]; },
    getPowerWorkletGraphGeneration() { return 0; },
    getPowerTopologyRevision() { return 0; },
    broadcastToActiveWorklets(message) { workletNode.port.postMessage(message); },
    powerDiagnostics: { recordEffectiveCommit() {}, mergeWorkletCounters() {} },
    setPlayerPowerUiEnabled() {},
    dispatchEvent() {}
  };
  controller = new PowerPolicyController(audioManager, {
    enabled: true,
    windowRef: {
      location: { search: '' },
      localStorage: { getItem() { return null; } },
      sessionStorage: { getItem() { return null; }, setItem() {} },
      crypto: { randomUUID: () => 'bypass-resume-test' },
      audioPreferences: { inputDeviceId: 'none' }
    },
    documentRef: { hidden: false }
  });
  controller._emitSnapshot = () => {};
  controller.requestReconcile = () => Promise.resolve();
  controller.started = true;
  harness.processor.port.postMessage = message => {
    workletMessages.push(message);
    controller.handleWorkletPowerEvent(message, workletNode);
  };

  controller._configureWorklets();
  await flushAsyncWork();
  processBlock(harness.processor, 0);
  harness.processor.pluginContexts.set(61, { phase: 0.25 });

  const enterBypass = controller._applyWorkletState('ACTIVE', 'bypass-transport');
  await flushAsyncWork();
  assert.equal(processBlock(harness.processor, 0.5)[0][0], 0.5);
  await flushAsyncWork();
  assert.equal(await enterBypass, true);
  processBlock(harness.processor, 0.5);
  processBlock(harness.processor, 0.5);
  assert.equal(harness.processor.powerPolicy.skippedFrameCount, 384);
  harness.processor.powerPolicy.skippedFrameRemainder = 0.5;

  controller.workletObservation = null;
  controller.workletObservations.clear();
  const gestureMessageStart = controllerMessages.length;
  const resume = controller.beginUserGestureResume('player-only-play');
  await flushAsyncWork();
  const guard = controllerMessages.slice(gestureMessageStart).find(message =>
    message.type === 'setPowerProcessingState' &&
    message.preserveHostSkipState === true);
  assert.ok(guard);
  assert.equal(guard.processingDirective, 'bypass-transport');

  assert.equal(processBlock(harness.processor, 0.5)[0][0], 0.5);
  assert.equal(harness.processor.powerPolicy.processingDirective, 'bypass-transport');
  assert.equal(harness.processor.powerPolicy.skippedFrameCount, 512);
  assert.equal(harness.processor.powerPolicy.skippedFrameRemainder, 0.5);
  await flushAsyncWork();

  const atomic = controllerMessages.findLast(message =>
    message.type === 'prepareTemporalStateAndResume');
  assert.ok(atomic);
  const result = workletMessages.filter(message =>
    message.type === 'temporalStateResumed').at(-1);
  assert.equal(result.skippedFrameCount, 512);
  assert.equal(result.appliedPolicyCounts.agedBySkippedFrames, 1);
  const expectedPhase = (0.25 + 512 / 48000) % 1;
  assert.ok(Math.abs(harness.processor.pluginContexts.get(61).phase - expectedPhase) < 1e-12);

  processBlock(harness.processor, 0.5);
  await flushAsyncWork();
  assert.equal(await resume, true);
});

for (const failure of [
  {
    name: 'coverage mismatch',
    errorCode: 'temporal-prevalidated-coverage-mismatch',
    inject(processor) { processor.powerPolicy.enabledPluginCount = 2; }
  },
  {
    name: 'runtime reset failure',
    errorCode: 'temporal-preparation-runtime-failed',
    inject(processor) { processor._resetTemporalPlugin = () => false; }
  }
]) {
  test(`atomic host resume keeps ownership dry after ${failure.name}`, async () => {
    const harness = await createWorkletHarness();
    await harness.send({
      type: 'registerProcessor',
      pluginType: 'FailWakePlugin',
      processor: 'for (let i = 0; i < data.length; i++) data[i] *= 5; return data;'
    });
    await harness.send({
      type: 'updatePlugins',
      plugins: [{ id: 33, type: 'FailWakePlugin', enabled: true, parameters: {} }],
      masterBypass: false
    });
    await harness.send({
      type: 'configurePowerPolicy',
      enabled: true,
      workletGraphGeneration: 3,
      topologyRevision: 7,
      commandId: 1,
      silenceThresholdDb: -80,
      enabledPluginCount: 1,
      monitoringPreparationCapabilities: [{
        pluginId: 33,
        capability: 'reset-on-resume',
        descriptor: { primitive: 'canonical-reset', fixedOperations: 1 }
      }],
      temporalSkipEligible: true,
      monitoringFastWakeEligible: false
    });
    processBlock(harness.processor, 0);
    await harness.send({
      type: 'setPowerProcessingState',
      state: 'monitoring',
      processingDirective: 'force-monitoring',
      workletGraphGeneration: 3,
      topologyRevision: 7,
      commandId: 2,
      skipEpoch: 1
    });
    processBlock(harness.processor, 0);
    assert.equal(harness.processor.powerPolicy.skippedFrameCount, 128);
    failure.inject(harness.processor);

    const fullProcessBeforeWake = harness.processor.powerPolicy.counters.fullProcessQuanta;
    await harness.send({
      type: 'prepareTemporalStateAndResume',
      origin: 'deliberate',
      ownerOperationId: 'failed-resume',
      commandId: 2,
      resumeCommandId: 3,
      ackCommandId: 4,
      skipEpoch: 1,
      skippedFrameCount: 128,
      suspendedElapsedMs: 0,
      elapsedContinuity: 'verified',
      resumeSampleRate: 48000,
      workletGraphGeneration: 3,
      topologyRevision: 7
    });
    const failureResult = messagesOf(harness.posts, 'temporalStateResumed').at(-1).message;
    assert.equal(failureResult.state, 'error');
    assert.equal(failureResult.errorCode, failure.errorCode);
    assert.equal(failureResult.monitoringFastWakeEligible, false);
    assert.equal(
      failureResult.monitoringFastWakeBlockerReason,
      'temporal-preparation-runtime-failed'
    );
    assert.equal(
      harness.processor.powerPolicy.counters.fullProcessQuanta,
      fullProcessBeforeWake
    );
    assert.equal(harness.processor.powerPolicy.counters.monitoringRuntimeFailures, 1);
    assert.equal(harness.processor.powerPolicy.monitoringFastWakeEligible, false);
    assert.equal(
      harness.processor.powerPolicy.monitoringFastWakeBlockerReason,
      'temporal-preparation-runtime-failed'
    );
    assert.equal(harness.processor.powerPolicy.state, 'monitoring');
    assert.equal(harness.processor.powerPolicy.processingDirective, 'force-monitoring');
    assert.equal(harness.processor.powerPolicy.skipEpoch, 1);

    const nextOutput = processBlock(harness.processor, 0.25);
    assert.equal(nextOutput[0][0], 0.25);
    assert.equal(
      harness.processor.powerPolicy.counters.fullProcessQuanta,
      fullProcessBeforeWake
    );
    assert.equal(harness.processor.powerPolicy.counters.monitoringRuntimeFailures, 1);
    assert.equal(harness.processor.powerPolicy.skippedFrameCount, 256);
    const heldObservation = messagesOf(harness.posts, 'powerObservation').at(-1).message;
    assert.equal(heldObservation.reason, 'host-temporal-resume-required');
    assert.equal(heldObservation.inputActive, true);

    await harness.send({
      type: 'prepareTemporalStateAndResume',
      origin: 'deliberate',
      ownerOperationId: 'failed-resume-retry',
      commandId: 2,
      resumeCommandId: 4,
      ackCommandId: 5,
      skipEpoch: 1,
      suspendedElapsedMs: 0,
      elapsedContinuity: 'verified',
      resumeSampleRate: 48000,
      workletGraphGeneration: 3,
      topologyRevision: 7
    });
    const duplicateResult = messagesOf(harness.posts, 'temporalStateResumed').at(-1).message;
    assert.equal(duplicateResult.state, 'error');
    assert.equal(duplicateResult.ackCommandId, 5);
    assert.equal(duplicateResult.monitoringFastWakeEligible, false);
    assert.equal(
      duplicateResult.monitoringFastWakeBlockerReason,
      'temporal-preparation-runtime-failed'
    );
    assert.equal(harness.processor.powerPolicy.counters.monitoringRuntimeFailures, 1);
  });
}

test('partial temporal failure is cached without applying analytic age twice', async () => {
  const harness = await createWorkletHarness();
  const ageDescriptor = {
    primitive: 'analytic-age',
    allocationFree: true,
    fixedOperations: 1,
    parameterTimeline: 'topology-invalidates-skip',
    resetFallback: 'canonical-reset',
    stateFields: [{ key: 'phase', incrementPerFrame: 1 / 48000, modulo: 1 }]
  };
  await harness.send({
    type: 'registerProcessor',
    pluginType: 'PartialAgePlugin',
    processor: 'return data;'
  });
  await harness.send({
    type: 'registerProcessor',
    pluginType: 'PartialFailPlugin',
    processor: 'return data;'
  });
  await harness.send({
    type: 'updatePlugins',
    plugins: [
      { id: 51, type: 'PartialAgePlugin', enabled: true, parameters: {} },
      { id: 52, type: 'PartialFailPlugin', enabled: true, parameters: {} }
    ],
    masterBypass: false
  });
  const configure = (topologyRevision, commandId, guard = null) => harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision,
    commandId,
    silenceThresholdDb: -80,
    enabledPluginCount: 2,
    monitoringPreparationCapabilities: [
      { pluginId: 51, capability: 'age-by-skipped-frames', descriptor: ageDescriptor },
      {
        pluginId: 52,
        capability: 'reset-on-resume',
        descriptor: { primitive: 'canonical-reset', fixedOperations: 1 }
      }
    ],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: false,
    ...(guard && {
      hostGuardDirective: 'force-monitoring',
      hostGuardSkipEpoch: guard.skipEpoch
    })
  });
  await configure(7, 1);
  processBlock(harness.processor, 0);
  harness.processor.pluginContexts.set(51, { phase: 0.25 });
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 2,
    skipEpoch: 1
  });
  processBlock(harness.processor, 0.5);
  const originalReset = harness.processor._resetTemporalPlugin.bind(harness.processor);
  harness.processor._resetTemporalPlugin = pluginId =>
    pluginId === 52 ? false : originalReset(pluginId);
  const sendAtomic = (resumeCommandId, ackCommandId) => harness.send({
    type: 'prepareTemporalStateAndResume',
    origin: 'deliberate',
    ownerOperationId: `partial-${ackCommandId}`,
    commandId: 2,
    resumeCommandId,
    ackCommandId,
    skipEpoch: 1,
    suspendedElapsedMs: 0,
    elapsedContinuity: 'verified',
    resumeSampleRate: 48000,
    workletGraphGeneration: 3,
    topologyRevision: 7
  });

  await sendAtomic(3, 4);
  const phaseAfterFailure = (0.25 + 128 / 48000) % 1;
  assert.ok(Math.abs(harness.processor.pluginContexts.get(51).phase - phaseAfterFailure) < 1e-12);
  assert.equal(harness.processor.powerPolicy.counters.monitoringRuntimeFailures, 1);
  const cachedTerminal = harness.processor.powerPolicy.hostResumeTerminal;
  assert.equal(cachedTerminal.state, 'error');

  await sendAtomic(5, 6);
  assert.ok(Math.abs(harness.processor.pluginContexts.get(51).phase - phaseAfterFailure) < 1e-12);
  assert.equal(harness.processor.powerPolicy.counters.monitoringRuntimeFailures, 1);
  assert.equal(harness.processor.powerPolicy.hostResumeTerminal, cachedTerminal);

  await configure(7, 7);
  await sendAtomic(8, 9);
  assert.ok(Math.abs(harness.processor.pluginContexts.get(51).phase - phaseAfterFailure) < 1e-12);
  assert.equal(harness.processor.powerPolicy.counters.monitoringRuntimeFailures, 1);

  await configure(8, 10, { skipEpoch: 2 });
  assert.equal(harness.processor.powerPolicy.hostResumeTerminal, null);
  assert.equal(harness.processor.powerPolicy.commandId, 10);
  assert.equal(harness.processor.powerPolicy.skipEpoch, 2);
});

test('configuration clears automatic ownership and preserves a same-identity host guard', async () => {
  const harness = await createWorkletHarness();
  const configure = commandId => harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId,
    silenceThresholdDb: -80,
    silenceDurationSeconds: 0,
    enabledPluginCount: 0,
    monitoringPreparationCapabilities: [],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true
  });
  await configure(1);
  processBlock(harness.processor, 0);
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'allow-automatic',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 2,
    skipEpoch: 1,
    armAfterRenderSequence: harness.processor.powerPolicy.renderSequence
  });
  processBlock(harness.processor, 0);
  assert.equal(harness.processor.powerPolicy.state, 'monitoring');

  await configure(3);
  let acknowledgement = messagesOf(harness.posts, 'powerStateAck').at(-1).message;
  assert.equal(acknowledgement.state, 'active');
  assert.equal(acknowledgement.processingDirective, 'full-process');
  assert.equal(harness.processor.powerPolicy.arm.state, 'disarmed');
  processBlock(harness.processor, 0);
  const configObservation = messagesOf(harness.posts, 'powerObservation').at(-1).message;
  assert.equal(configObservation.reason, 'config-wake');
  assert.equal(configObservation.state, 'active');
  assert.equal(configObservation.processingDirective, 'full-process');

  await harness.send({
    type: 'setPowerProcessingState',
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 4,
    skipEpoch: 2
  });
  await configure(5);
  acknowledgement = messagesOf(harness.posts, 'powerStateAck').at(-1).message;
  assert.equal(acknowledgement.state, 'monitoring');
  assert.equal(acknowledgement.processingDirective, 'force-monitoring');
  assert.equal(harness.processor.powerPolicy.commandId, 4);
  assert.equal(harness.processor.powerPolicy.skipEpoch, 2);
  assert.equal(harness.processor.powerPolicy.hostResumeTerminal, null);
  assert.equal(harness.processor.powerPolicy.temporalSkipEligible, true);
});

test('new power identities adopt the configured UI telemetry gate directly', async () => {
  const harness = await createWorkletHarness();
  const configure = (workletGraphGeneration, topologyRevision, uiTelemetryEnabled) =>
    harness.send({
      type: 'configurePowerPolicy',
      enabled: true,
      workletGraphGeneration,
      topologyRevision,
      commandId: workletGraphGeneration,
      uiTelemetryEnabled,
      silenceThresholdDb: -80,
      enabledPluginCount: 0,
      monitoringPreparationCapabilities: [],
      temporalSkipEligible: true,
      monitoringFastWakeEligible: true
    });

  await configure(3, 7, false);
  assert.equal(harness.processor.powerPolicy.uiTelemetryEnabled, false);
  await harness.send({
    type: 'setUiTelemetryEnabled',
    enabled: true,
    commandId: 4,
    workletGraphGeneration: 2,
    topologyRevision: 7
  });
  assert.equal(harness.processor.powerPolicy.uiTelemetryEnabled, false);

  await configure(4, 8, true);
  assert.equal(harness.processor.powerPolicy.uiTelemetryEnabled, true);
});

test('guarded configuration preserves deliberate transport counters without a zero-output leak', async () => {
  for (const directive of ['zero-output-transport', 'bypass-transport']) {
    const harness = await createWorkletHarness();
    await harness.send({
      type: 'configurePowerPolicy',
      enabled: true,
      workletGraphGeneration: 3,
      topologyRevision: 7,
      commandId: 1,
      uiTelemetryEnabled: true,
      silenceThresholdDb: -80,
      enabledPluginCount: 0,
      monitoringPreparationCapabilities: [],
      temporalSkipEligible: true,
      monitoringFastWakeEligible: true
    });
    await harness.send({
      type: 'setPowerProcessingState',
      state: 'active',
      processingDirective: directive,
      workletGraphGeneration: 3,
      topologyRevision: 7,
      commandId: 2,
      skipEpoch: 1
    });
    const firstOutput = processBlock(harness.processor, 0.5);
    assert.equal(firstOutput[0][0], directive === 'zero-output-transport' ? 0 : 0.5);
    assert.equal(harness.processor.powerPolicy.skippedFrameCount, 128);
    harness.processor.powerPolicy.skippedFrameRemainder = 0.75;

    await harness.send({
      type: 'configurePowerPolicy',
      enabled: true,
      workletGraphGeneration: 3,
      topologyRevision: 7,
      commandId: 3,
      uiTelemetryEnabled: true,
      hostGuardDirective: directive,
      hostGuardSkipEpoch: 2,
      preserveHostSkipState: true,
      silenceThresholdDb: -80,
      enabledPluginCount: 0,
      monitoringPreparationCapabilities: [],
      temporalSkipEligible: true,
      monitoringFastWakeEligible: true
    });
    assert.equal(harness.processor.powerPolicy.processingDirective, directive);
    assert.equal(harness.processor.powerPolicy.skippedFrameCount, 128);
    assert.equal(harness.processor.powerPolicy.skippedFrameRemainder, 0.75);

    const secondOutput = processBlock(harness.processor, 0.5);
    assert.equal(secondOutput[0][0], directive === 'zero-output-transport' ? 0 : 0.5);
    assert.equal(harness.processor.powerPolicy.skippedFrameCount, 256);
    assert.equal(harness.processor.powerPolicy.skippedFrameRemainder, 0.75);
  }
});

test('disabling power policy clears skip ownership without reopening replay', async () => {
  const harness = await createWorkletHarness();
  const configure = enabled => harness.send({
    type: 'configurePowerPolicy',
    enabled,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 1,
    silenceThresholdDb: -80,
    enabledPluginCount: 0,
    monitoringPreparationCapabilities: [],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true
  });
  await configure(true);
  processBlock(harness.processor, 0);
  const forceCommand = {
    type: 'setPowerProcessingState',
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 2,
    skipEpoch: 4
  };
  await harness.send(forceCommand);
  assert.equal(harness.processor.powerPolicy.commandId, 2);
  assert.equal(harness.processor.powerPolicy.skipEpoch, 4);

  await configure(false);
  assert.equal(harness.processor.powerPolicy.commandId, null);
  assert.equal(harness.processor.powerPolicy.skipEpoch, null);
  assert.equal(harness.processor.powerPolicy.processingDirective, 'full-process');

  await configure(true);
  await harness.send(forceCommand);
  const acknowledgement = messagesOf(harness.posts, 'powerStateAck').at(-1).message;
  assert.equal(acknowledgement.commandAccepted, false);
  assert.equal(acknowledgement.commandRejectedReason, 'stale-power-command');
  assert.equal(harness.processor.powerPolicy.commandId, null);
  assert.equal(harness.processor.powerPolicy.processingDirective, 'full-process');
});

test('configuration exits force-monitoring when the power identity changes', async () => {
  const harness = await createWorkletHarness();
  const configure = (topologyRevision, commandId) => harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision,
    commandId,
    silenceThresholdDb: -80,
    enabledPluginCount: 0,
    monitoringPreparationCapabilities: [],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true
  });
  await configure(7, 1);
  processBlock(harness.processor, 0);
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 2,
    skipEpoch: 4
  });

  await configure(8, 3);
  const acknowledgement = messagesOf(harness.posts, 'powerStateAck').at(-1).message;
  assert.equal(acknowledgement.state, 'active');
  assert.equal(acknowledgement.processingDirective, 'full-process');
  assert.equal(harness.processor.powerPolicy.skipEpoch, null);
  assert.equal(harness.processor.powerPolicy.arm.state, 'disarmed');
});

test('configuration keeps an established host guard when temporal skipping becomes unsafe', async () => {
  const harness = await createWorkletHarness();
  const configure = (temporalSkipEligible, commandId) => harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId,
    silenceThresholdDb: -80,
    enabledPluginCount: 0,
    monitoringPreparationCapabilities: [],
    temporalSkipEligible,
    monitoringFastWakeEligible: true
  });
  await configure(true, 1);
  processBlock(harness.processor, 0);
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 2,
    skipEpoch: 4
  });

  await configure(false, 3);
  const acknowledgement = messagesOf(harness.posts, 'powerStateAck').at(-1).message;
  assert.equal(acknowledgement.state, 'monitoring');
  assert.equal(acknowledgement.processingDirective, 'force-monitoring');
  assert.equal(harness.processor.powerPolicy.skipEpoch, 4);
  assert.equal(harness.processor.powerPolicy.temporalSkipEligible, false);
});

test('a worklet mutation rejects stale temporal skip commands until fresh configuration', async () => {
  const harness = await createWorkletHarness();
  const configure = commandId => harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId,
    silenceThresholdDb: -80,
    enabledPluginCount: 0,
    monitoringPreparationCapabilities: [],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true
  });
  await configure(1);
  processBlock(harness.processor, 0);
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 2,
    skipEpoch: 4
  });

  await harness.send({ type: 'updateAudioConfig', outputChannels: 2 });
  assert.equal(harness.processor.powerPolicy.state, 'active');
  assert.equal(harness.processor.powerPolicy.processingDirective, 'full-process');
  assert.equal(harness.processor.powerPolicy.temporalSkipEligible, false);
  assert.equal(harness.processor.powerPolicy.temporalCapabilities.length, 0);
  assert.equal(harness.processor.powerPolicy.skipEpoch, null);

  for (const [index, processingDirective] of [
    'force-monitoring',
    'zero-output-transport',
    'bypass-transport'
  ].entries()) {
    await harness.send({
      type: 'setPowerProcessingState',
      state: processingDirective === 'force-monitoring' ? 'monitoring' : 'active',
      processingDirective,
      workletGraphGeneration: 3,
      topologyRevision: 7,
      commandId: 3 + index,
      skipEpoch: 5 + index
    });
    assert.equal(harness.processor.powerPolicy.state, 'active');
    assert.equal(harness.processor.powerPolicy.processingDirective, 'full-process');
    assert.equal(harness.processor.powerPolicy.skipEpoch, null);
  }

  await configure(6);
  processBlock(harness.processor, 0);
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 7,
    skipEpoch: 8
  });
  assert.equal(harness.processor.powerPolicy.state, 'monitoring');
  assert.equal(harness.processor.powerPolicy.processingDirective, 'force-monitoring');
});

for (const directive of [
  'force-monitoring',
  'zero-output-transport',
  'bypass-transport'
]) {
  test(`${directive} rejects an exact command and epoch replay`, async () => {
    const harness = await createWorkletHarness();
    await harness.send({
      type: 'configurePowerPolicy',
      enabled: true,
      workletGraphGeneration: 3,
      topologyRevision: 7,
      commandId: 1,
      silenceThresholdDb: -80,
      enabledPluginCount: 0,
      monitoringPreparationCapabilities: [],
      temporalSkipEligible: true,
      monitoringFastWakeEligible: true
    });
    processBlock(harness.processor, 0);
    const command = {
      type: 'setPowerProcessingState',
      state: directive === 'force-monitoring' ? 'monitoring' : 'active',
      processingDirective: directive,
      workletGraphGeneration: 3,
      topologyRevision: 7,
      commandId: 2,
      skipEpoch: 1
    };
    await harness.send(command);
    let acknowledgement = messagesOf(harness.posts, 'powerStateAck').at(-1).message;
    assert.equal(acknowledgement.commandAccepted, true);

    await harness.send(command);
    acknowledgement = messagesOf(harness.posts, 'powerStateAck').at(-1).message;
    assert.equal(acknowledgement.commandAccepted, false);
    assert.equal(acknowledgement.commandRejectedReason, 'stale-power-command');
    assert.equal(harness.processor.powerPolicy.processingDirective, directive);
    assert.equal(harness.processor.powerPolicy.skipEpoch, 1);
  });
}

test('a rollback command needs a fresh skip epoch as well as a fresh command id', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 1,
    silenceThresholdDb: -80,
    enabledPluginCount: 0,
    monitoringPreparationCapabilities: [],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true
  });
  processBlock(harness.processor, 0);
  const sendState = (processingDirective, commandId, skipEpoch) => harness.send({
    type: 'setPowerProcessingState',
    state: processingDirective === 'force-monitoring' ? 'monitoring' : 'active',
    processingDirective,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId,
    skipEpoch
  });
  await sendState('force-monitoring', 2, 5);
  await harness.send({
    type: 'prepareTemporalStateAndResume',
    origin: 'deliberate',
    ownerOperationId: 'resume-before-rollback',
    commandId: 2,
    resumeCommandId: 3,
    ackCommandId: 4,
    skipEpoch: 5,
    skippedFrameCount: 0,
    suspendedElapsedMs: 0,
    elapsedContinuity: 'verified',
    resumeSampleRate: 48000,
    workletGraphGeneration: 3,
    topologyRevision: 7
  });
  assert.equal(harness.processor.powerPolicy.processingDirective, 'full-process');

  await sendState('force-monitoring', 4, 5);
  let acknowledgement = messagesOf(harness.posts, 'powerStateAck').at(-1).message;
  assert.equal(acknowledgement.commandAccepted, false);
  assert.equal(acknowledgement.commandRejectedReason, 'stale-power-command');
  assert.equal(harness.processor.powerPolicy.processingDirective, 'full-process');
  assert.equal(harness.processor.powerPolicy.skipEpoch, null);

  await sendState('force-monitoring', 5, 6);
  acknowledgement = messagesOf(harness.posts, 'powerStateAck').at(-1).message;
  assert.equal(acknowledgement.commandAccepted, true);
  assert.equal(harness.processor.powerPolicy.processingDirective, 'force-monitoring');
  assert.equal(harness.processor.powerPolicy.skipEpoch, 6);
  assert.equal(harness.processor.powerPolicy.skippedFrameCount, 0);
});

test('a pre-preparation rollback preserves the worklet live skipped-frame count', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 1,
    silenceThresholdDb: -80,
    enabledPluginCount: 0,
    monitoringPreparationCapabilities: [],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true
  });
  processBlock(harness.processor, 0);
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    preserveHostSkipState: false,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 2,
    skipEpoch: 1
  });
  processBlock(harness.processor, 0.5);
  processBlock(harness.processor, 0.5);
  assert.equal(harness.processor.powerPolicy.skippedFrameCount, 256);

  await harness.send({
    type: 'setPowerProcessingState',
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    preserveHostSkipState: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 3,
    skipEpoch: 2
  });
  assert.equal(harness.processor.powerPolicy.skippedFrameCount, 256);
  processBlock(harness.processor, 0.5);
  assert.equal(harness.processor.powerPolicy.skippedFrameCount, 384);
});

test('deliberate skips reject non-integer command and epoch identities', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 1,
    silenceThresholdDb: -80,
    enabledPluginCount: 0,
    monitoringPreparationCapabilities: [],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true
  });
  processBlock(harness.processor, 0);
  for (const [commandId, skipEpoch] of [[1.5, 1], [2, 1.5]]) {
    await harness.send({
      type: 'setPowerProcessingState',
      state: 'monitoring',
      processingDirective: 'force-monitoring',
      workletGraphGeneration: 3,
      topologyRevision: 7,
      commandId,
      skipEpoch
    });
    const acknowledgement = messagesOf(harness.posts, 'powerStateAck').at(-1).message;
    assert.equal(acknowledgement.commandAccepted, false);
    assert.equal(harness.processor.powerPolicy.processingDirective, 'full-process');
    assert.equal(harness.processor.powerPolicy.skipEpoch, null);
  }
});

test('a monitoring wake identity failure processes the current block and reports the latch', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'registerProcessor',
    pluginType: 'VolumePlugin',
    processor: 'for (let i = 0; i < data.length; i++) data[i] *= 5; return data;'
  });
  await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 1,
    silenceThresholdDb: -80,
    silenceDurationSeconds: 0,
    enabledPluginCount: 1,
    monitoringPreparationCapabilities: [{ pluginId: 7, capability: 'stateless' }],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true
  });
  processBlock(harness.processor, 0);
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'allow-automatic',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 2,
    skipEpoch: 1,
    armAfterRenderSequence: harness.processor.powerPolicy.renderSequence
  });
  processBlock(harness.processor, 0);
  harness.processor.powerPolicy.skipEpoch = 2;

  const output = processBlock(harness.processor, 0.25);
  assert.equal(output[0][0], 1.25);
  assert.equal(harness.processor.powerPolicy.state, 'active');
  assert.equal(harness.processor.powerPolicy.processingDirective, 'full-process');
  const observation = messagesOf(harness.posts, 'powerObservation').at(-1).message;
  assert.equal(observation.reason, 'temporal-preparation-runtime-failed');
  assert.equal(observation.monitoringFastWakeEligible, false);
  assert.equal(
    observation.monitoringFastWakeBlockerReason,
    'temporal-preparation-runtime-failed'
  );
});

test('automatic monitoring resets and warms stateful plugins before same-quantum wake', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'registerProcessor',
    pluginType: 'StatefulPlugin',
    processor: `
      this.calls = (this.calls || 0) + 1;
      for (let index = 0; index < data.length; index++) data[index] *= this.calls;
      return data;
    `
  });
  await harness.send({
    type: 'updatePlugins',
    plugins: [{
      id: 21,
      type: 'StatefulPlugin',
      enabled: true,
      parameters: {},
      inputBus: 0,
      outputBus: 0,
      channel: 'A'
    }],
    masterBypass: false
  });
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 12,
    topologyRevision: 15,
    commandId: 1,
    silenceThresholdDb: -80,
    silenceDurationSeconds: 0,
    wakeGainMarginDb: 0,
    wakeOnAnyInput: true,
    enabledPluginCount: 1,
    monitoringPreparationCapabilities: [{
      pluginId: 21,
      capability: 'reset-on-resume',
      descriptor: {
        primitive: 'canonical-reset',
        allocationFree: false,
        fixedOperations: 1
      }
    }],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true,
    monitoringFastWakeBlockerReason: null
  });
  assert.equal(harness.processor.powerPolicy.monitoringStaticCoverageValid, true);
  processBlock(harness.processor, 0);
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'allow-automatic',
    workletGraphGeneration: 12,
    topologyRevision: 15,
    commandId: 2,
    skipEpoch: 1,
    armAfterRenderSequence: harness.processor.powerPolicy.renderSequence
  });

  const processEmptyBlock = () => {
    const emptyOutput = [new Float32Array(128), new Float32Array(128)];
    assert.equal(harness.processor.process([[]], [emptyOutput], {}), true);
  };
  const firstRenderCount = messagesOf(harness.posts, 'powerFirstRender').length;
  processEmptyBlock();
  assert.equal(messagesOf(harness.posts, 'powerFirstRender').length, firstRenderCount);
  assert.equal(harness.processor.powerPolicy.pendingFirstRenderCommandId, 2);

  processBlock(harness.processor, 0);
  assert.equal(harness.processor.powerPolicy.state, 'active');
  assert.equal(harness.processor.powerPolicy.monitoringPreparationPending, true);
  assert.equal(harness.processor.pluginContexts.has(21), false);

  processEmptyBlock();
  assert.equal(harness.processor.powerPolicy.state, 'active');
  assert.equal(harness.processor.powerPolicy.monitoringPreparationPending, true);
  assert.equal(harness.processor.pluginContexts.has(21), false);

  processBlock(harness.processor, 0);
  assert.equal(harness.processor.powerPolicy.state, 'monitoring');
  assert.equal(harness.processor.powerPolicy.monitoringPreparationPending, false);
  assert.equal(harness.processor.pluginContexts.get(21).calls, 1);

  const output = processBlock(harness.processor, 1e-8);
  assert.equal(harness.processor.powerPolicy.state, 'active');
  assert.equal(harness.processor.powerPolicy.arm.state, 'disarmed');
  assert.equal(harness.processor.pluginContexts.get(21).calls, 2);
  assert.ok(Math.abs(output[0][0] - 2e-8) < 1e-12);
  assert.ok(Math.abs(output[1][0] - 2e-8) < 1e-12);
});

test('power policy publishes empty-input once per episode and rides the heartbeat afterwards', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 1,
    silenceThresholdDb: -80,
    silenceDurationSeconds: 0,
    wakeGainMarginDb: 24,
    enabledPluginCount: 0,
    monitoringPreparationCapabilities: [],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true,
    monitoringFastWakeBlockerReason: null
  });
  processBlock(harness.processor, 0);

  const processEmptyBlock = () => {
    const output = [new Float32Array(128), new Float32Array(128)];
    assert.equal(harness.processor.process([[]], [output], {}), true);
  };
  const powerPosts = () => harness.posts.filter(entry =>
    entry.message.type === 'powerObservation' || entry.message.type === 'powerHeartbeat');

  const baselineCount = powerPosts().length;
  processEmptyBlock();
  let posts = powerPosts();
  assert.equal(posts.length, baselineCount + 1);
  assert.equal(posts.at(-1).message.type, 'powerObservation');
  assert.equal(posts.at(-1).message.reason, 'empty-input');
  assert.equal(posts.at(-1).message.monitoringFastWakeEligible, true);
  assert.equal(posts.at(-1).message.monitoringFastWakeBlockerReason, null);

  const afterEmptyEdgeCount = posts.length;
  for (let index = 0; index < 100; index++) processEmptyBlock();
  assert.equal(powerPosts().length, afterEmptyEdgeCount);

  for (let index = 0; index < 300; index++) processEmptyBlock();
  posts = powerPosts();
  assert.equal(posts.length, afterEmptyEdgeCount + 1);
  assert.equal(posts.at(-1).message.type, 'powerHeartbeat');
  assert.equal(posts.at(-1).message.monitoringFastWakeEligible, true);
  assert.equal(posts.at(-1).message.monitoringFastWakeBlockerReason, null);

  processBlock(harness.processor, 0.5);
  processEmptyBlock();
  assert.equal(powerPosts().filter(entry => entry.message.reason === 'empty-input').length, 2);
});

test('master bypass keeps the monitoring wake block dry under power policy', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'registerProcessor',
    pluginType: 'VolumePlugin',
    processor: 'for (let i = 0; i < data.length; i++) data[i] *= 5; return data;'
  });
  await harness.send({
    type: 'updatePlugins',
    plugins: [pluginConfig()],
    masterBypass: true
  });
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 1,
    silenceThresholdDb: -80,
    silenceDurationSeconds: 0,
    wakeGainMarginDb: 24,
    enabledPluginCount: 1,
    monitoringPreparationCapabilities: [{ pluginId: 7, capability: 'stateless' }],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true,
    monitoringFastWakeBlockerReason: null
  });
  processBlock(harness.processor, 0);
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'allow-automatic',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 11,
    skipEpoch: 101,
    armAfterRenderSequence: harness.processor.powerPolicy.renderSequence
  });

  processBlock(harness.processor, 0);
  assert.equal(harness.processor.powerPolicy.state, 'monitoring');

  const wakeOutput = processBlock(harness.processor, 0.25);
  assert.equal(harness.processor.powerPolicy.state, 'active');
  assert.equal(harness.processor.powerPolicy.processingDirective, 'full-process');
  assert.equal(wakeOutput[0][0], 0.25);
  assert.ok(harness.processor.powerPolicy.counters.fullProcessQuanta > 0);
});

test('master bypass measures final dry output instead of an internal generator', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'registerProcessor',
    pluginType: 'GeneratorPlugin',
    processor: 'data.fill(0.5); return data;'
  });
  await harness.send({
    type: 'updatePlugins',
    plugins: [pluginConfig({ type: 'GeneratorPlugin' })],
    masterBypass: true
  });
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 1,
    silenceThresholdDb: -80,
    silenceDurationSeconds: 0,
    wakeGainMarginDb: 24,
    enabledPluginCount: 1,
    monitoringPreparationCapabilities: [{ pluginId: 7, capability: 'stateless' }],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true,
    monitoringFastWakeBlockerReason: null
  });
  processBlock(harness.processor, 0);
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'allow-automatic',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 11,
    skipEpoch: 101,
    armAfterRenderSequence: harness.processor.powerPolicy.renderSequence
  });

  const output = processBlock(harness.processor, 0);
  assert.equal(output[0][0], 0);
  assert.equal(harness.processor.powerPolicy.outputPowerEwma, 0);
  assert.equal(harness.processor.powerPolicy.state, 'monitoring');
});

test('explicit power protocol rejects stale identities and skips DSP for bypass and structural zero', async () => {
  const harness = await createWorkletHarness();
  await registerFallback(harness);
  await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 2,
    topologyRevision: 4,
    commandId: 1,
    silenceThresholdDb: -80,
    enabledPluginCount: 1,
    monitoringPreparationCapabilities: [{ pluginId: 7, capability: 'stateless' }],
    monitoringFastWakeEligible: true,
    temporalSkipEligible: true
  });
  await harness.send({
    type: 'setPowerProcessingState',
    processingDirective: 'zero-output-transport',
    workletGraphGeneration: 1,
    topologyRevision: 4,
    commandId: 2
  });
  assert.equal(harness.processor.powerPolicy.processingDirective, 'full-process');

  await harness.send({
    type: 'setPowerProcessingState',
    processingDirective: 'zero-output-transport',
    workletGraphGeneration: 2,
    topologyRevision: 4,
    commandId: 3,
    skipEpoch: 9
  });
  const zeroOutput = processBlock(harness.processor, 1);
  assert.equal(zeroOutput[0][0], 0);
  assert.equal(harness.processor.powerPolicy.counters.fullProcessQuanta, 0);

  await harness.send({
    type: 'setPowerProcessingState',
    processingDirective: 'bypass-transport',
    workletGraphGeneration: 2,
    topologyRevision: 4,
    commandId: 4,
    skipEpoch: 10
  });
  const dryOutput = processBlock(harness.processor, 0.25);
  assert.equal(dryOutput[0][0], 0.25);
  assert.equal(harness.processor.powerPolicy.counters.fullProcessQuanta, 0);
  assert.ok(messagesOf(harness.posts, 'powerFirstRender').length >= 2);
});

test('deliberate temporal preparation resets every enabled instance before full processing', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'updatePlugins',
    plugins: [
      { id: 1, type: 'StatelessPlugin', enabled: true, parameters: {} },
      { id: 2, type: 'StatefulPlugin', enabled: true, parameters: {} }
    ],
    masterBypass: false
  });
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 9,
    topologyRevision: 12,
    commandId: 1,
    silenceThresholdDb: -80,
    enabledPluginCount: 2,
    monitoringPreparationCapabilities: [
      { pluginId: 1, capability: 'stateless' },
      { pluginId: 2, capability: 'reset-on-resume' }
    ],
    monitoringFastWakeEligible: false,
    temporalSkipEligible: true
  });
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'zero-output-transport',
    commandId: 7,
    skipEpoch: 4,
    workletGraphGeneration: 9,
    topologyRevision: 12
  });
  harness.processor.pluginContexts.set(1, { value: 10 });
  harness.processor.pluginContexts.set(2, { value: 1 });
  await harness.send({
    type: 'prepareTemporalStateAndResume',
    origin: 'deliberate',
    ownerOperationId: 'resume-1',
    commandId: 7,
    resumeCommandId: 8,
    ackCommandId: 9,
    skipEpoch: 4,
    skippedFrameCount: 0,
    suspendedElapsedMs: 0,
    elapsedContinuity: 'verified',
    resumeSampleRate: 48000,
    workletGraphGeneration: 9,
    topologyRevision: 12
  });

  assert.deepEqual(harness.processor.pluginContexts.get(1), { value: 10 });
  assert.equal(harness.processor.pluginContexts.has(2), false);
  const prepared = messagesOf(harness.posts, 'temporalStateResumed').at(-1).message;
  assert.deepEqual({ ...prepared.appliedPolicyCounts }, {
    stateless: 1,
    resetOnResume: 1,
    agedBySkippedFrames: 0,
    mustProcess: 0
  });
  assert.equal(prepared.state, 'acknowledged');
  assert.equal(prepared.enabledPluginCount, 2);
  assert.equal(prepared.coveredPluginCount, 2);
  assert.equal(prepared.ackCommandId, 9);
});

test('mixed temporal preparation ages only explicit bounded state and rejects stale owners', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'updatePlugins',
    plugins: [
      { id: 1, type: 'StatelessPlugin', enabled: true, parameters: {} },
      { id: 2, type: 'ResetPlugin', enabled: true, parameters: {} },
      { id: 3, type: 'PhasePlugin', enabled: true, parameters: {} }
    ],
    masterBypass: false
  });
  const ageDescriptor = {
    primitive: 'analytic-age',
    allocationFree: true,
    fixedOperations: 1,
    parameterTimeline: 'topology-invalidates-skip',
    resetFallback: 'canonical-reset',
    stateFields: [{ key: 'phase', incrementPerFrame: 1 / 48000, modulo: 1 }]
  };
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 4,
    topologyRevision: 5,
    commandId: 1,
    silenceThresholdDb: -80,
    enabledPluginCount: 3,
    monitoringPreparationCapabilities: [
      { pluginId: 1, capability: 'stateless', descriptor: null },
      { pluginId: 2, capability: 'reset-on-resume', descriptor: null },
      { pluginId: 3, capability: 'age-by-skipped-frames', descriptor: ageDescriptor }
    ],
    monitoringFastWakeEligible: false,
    temporalSkipEligible: true
  });
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'zero-output-transport',
    commandId: 9,
    skipEpoch: 6,
    workletGraphGeneration: 4,
    topologyRevision: 5
  });
  processBlock(harness.processor, 0.5);
  processBlock(harness.processor, 0.5);
  harness.processor.pluginContexts.set(2, { tail: 1 });
  harness.processor.pluginContexts.set(3, { phase: 0.25 });

  const beforeStale = messagesOf(harness.posts, 'temporalStateResumed').length;
  await harness.send({
    type: 'prepareTemporalStateAndResume',
    origin: 'deliberate',
    ownerOperationId: 'old-owner',
    commandId: 8,
    resumeCommandId: 10,
    ackCommandId: 10,
    skipEpoch: 6,
    skippedFrameCount: 256,
    suspendedElapsedMs: 1000,
    elapsedContinuity: 'verified',
    resumeSampleRate: 48000,
    workletGraphGeneration: 4,
    topologyRevision: 5
  });
  assert.equal(messagesOf(harness.posts, 'temporalStateResumed').length, beforeStale);

  await harness.send({
    type: 'prepareTemporalStateAndResume',
    origin: 'deliberate',
    ownerOperationId: 'resume-owner',
    commandId: 9,
    resumeCommandId: 10,
    ackCommandId: 11,
    skipEpoch: 6,
    skippedFrameCount: 256,
    suspendedElapsedMs: 1000,
    elapsedContinuity: 'verified',
    resumeSampleRate: 48000,
    workletGraphGeneration: 4,
    topologyRevision: 5
  });
  const prepared = messagesOf(harness.posts, 'temporalStateResumed').at(-1).message;
  assert.equal(prepared.state, 'acknowledged');
  assert.deepEqual({ ...prepared.appliedPolicyCounts }, {
    stateless: 1,
    resetOnResume: 1,
    agedBySkippedFrames: 1,
    mustProcess: 0
  });
  assert.equal(prepared.skippedFrameCount, 48256);
  assert.equal(harness.processor.pluginContexts.has(2), false);
  assert.ok(Math.abs(harness.processor.pluginContexts.get(3).phase -
    (0.25 + 48256 / 48000) % 1) < 1e-12);
});

test('temporal preparation retries acknowledge once-applied state without aging twice', async () => {
  const primary = await createWorkletHarness();
  const secondary = await createWorkletHarness();
  const descriptor = {
    primitive: 'analytic-age',
    allocationFree: true,
    fixedOperations: 1,
    parameterTimeline: 'topology-invalidates-skip',
    resetFallback: 'canonical-reset',
    stateFields: [{ key: 'phase', incrementPerFrame: 1 / 48000, modulo: 1 }]
  };
  const configure = async harness => {
    await harness.send({
      type: 'updatePlugins',
      plugins: [{ id: 3, type: 'PhasePlugin', enabled: true, parameters: {} }],
      masterBypass: false
    });
    await harness.send({
      type: 'configurePowerPolicy',
      enabled: true,
      workletGraphGeneration: 4,
      topologyRevision: 5,
      commandId: 1,
      silenceThresholdDb: -80,
      enabledPluginCount: 1,
      monitoringPreparationCapabilities: [{
        pluginId: 3,
        capability: 'age-by-skipped-frames',
        descriptor
      }],
      monitoringFastWakeEligible: false,
      temporalSkipEligible: true
    });
    await harness.send({
      type: 'setPowerProcessingState',
      state: 'active',
      processingDirective: 'zero-output-transport',
      commandId: 9,
      skipEpoch: 6,
      workletGraphGeneration: 4,
      topologyRevision: 5
    });
    processBlock(harness.processor, 0.5);
    processBlock(harness.processor, 0.5);
    harness.processor.pluginContexts.set(3, { phase: 0.25 });
  };
  await configure(primary);
  await configure(secondary);
  const prepare = (harness, ownerOperationId, ackCommandId) => harness.send({
    type: 'prepareTemporalStateAndResume',
    origin: 'deliberate',
    ownerOperationId,
    commandId: 9,
    resumeCommandId: 10,
    ackCommandId,
    skipEpoch: 6,
    skippedFrameCount: 256,
    suspendedElapsedMs: 1000,
    elapsedContinuity: 'verified',
    resumeSampleRate: 48000,
    workletGraphGeneration: 4,
    topologyRevision: 5
  });

  await prepare(primary, 'resume-attempt-1', 10);
  const expectedPhase = (0.25 + 48256 / 48000) % 1;
  assert.ok(Math.abs(primary.processor.pluginContexts.get(3).phase - expectedPhase) < 1e-12);
  assert.equal(secondary.processor.pluginContexts.get(3).phase, 0.25);

  await prepare(primary, 'resume-attempt-2', 11);
  await prepare(secondary, 'resume-attempt-2', 11);
  assert.ok(Math.abs(primary.processor.pluginContexts.get(3).phase - expectedPhase) < 1e-12);
  assert.ok(Math.abs(secondary.processor.pluginContexts.get(3).phase - expectedPhase) < 1e-12);
  for (const harness of [primary, secondary]) {
    const acknowledgement = messagesOf(harness.posts, 'temporalStateResumed').at(-1).message;
    assert.equal(acknowledgement.state, 'acknowledged');
    assert.equal(acknowledgement.ownerOperationId, 'resume-attempt-2');
    assert.equal(acknowledgement.ackCommandId, 11);
    assert.equal(acknowledgement.skippedFrameCount, 48256);
  }

  await primary.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'zero-output-transport',
    commandId: 11,
    skipEpoch: 7,
    workletGraphGeneration: 4,
    topologyRevision: 5
  });
  processBlock(primary.processor, 0.5);
  await primary.send({
    type: 'prepareTemporalStateAndResume',
    origin: 'deliberate',
    ownerOperationId: 'new-epoch',
    commandId: 11,
    resumeCommandId: 12,
    ackCommandId: 13,
    skipEpoch: 7,
    skippedFrameCount: 128,
    suspendedElapsedMs: 0,
    elapsedContinuity: 'verified',
    resumeSampleRate: 48000,
    workletGraphGeneration: 4,
    topologyRevision: 5
  });
  const nextPhase = (expectedPhase + 128 / 48000) % 1;
  assert.ok(Math.abs(primary.processor.pluginContexts.get(3).phase - nextPhase) < 1e-12);
});

test('power detector uses channel maxima and wakes immediately for nonfinite or finite input', async () => {
  const harness = await createWorkletHarness();
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 5,
    topologyRevision: 8,
    commandId: 1,
    silenceThresholdDb: -80,
    silenceDurationSeconds: 0,
    wakeGainMarginDb: 0,
    enabledPluginCount: 0,
    monitoringPreparationCapabilities: [],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true
  });

  const detector = harness.processor.powerPolicy.inputDetectorResult;
  const loud = 10 ** (-79 / 20);
  harness.processor._measurePowerWithDcBlock(
    [Float32Array.from([loud, -loud]), new Float32Array(2)],
    new Float64Array(harness.processor.powerPolicy.inputDcX.length),
    new Float64Array(harness.processor.powerPolicy.inputDcY.length),
    2,
    detector
  );
  assert.ok(detector[0] > 10 ** (-80 / 10));

  processBlock(harness.processor, 0);

  await harness.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'allow-automatic',
    workletGraphGeneration: 5,
    topologyRevision: 8,
    commandId: 2,
    skipEpoch: 1,
    armAfterRenderSequence: harness.processor.powerPolicy.renderSequence
  });
  processBlock(harness.processor, 0);
  assert.equal(harness.processor.powerPolicy.state, 'monitoring');

  const nonfiniteInput = [Float32Array.of(NaN, ...new Array(127).fill(0)), new Float32Array(128)];
  const nonfiniteOutput = [new Float32Array(128), new Float32Array(128)];
  harness.processor.process([nonfiniteInput], [nonfiniteOutput], {});
  assert.equal(harness.processor.powerPolicy.state, 'active');

  await harness.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'allow-automatic',
    workletGraphGeneration: 5,
    topologyRevision: 8,
    commandId: 3,
    skipEpoch: 2,
    armAfterRenderSequence: harness.processor.powerPolicy.renderSequence
  });
  processBlock(harness.processor, 0);
  const lowLevel = 10 ** (-75 / 20);
  processBlock(harness.processor, lowLevel);
  assert.equal(harness.processor.powerPolicy.state, 'active');
});

test('power protocol refuses zero and bypass skip when temporal processing is unsafe', async () => {
  const harness = await createWorkletHarness();
  await registerFallback(harness);
  await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 6,
    topologyRevision: 9,
    commandId: 1,
    silenceThresholdDb: -80,
    enabledPluginCount: 1,
    monitoringPreparationCapabilities: [{ pluginId: 7, capability: 'must-process' }],
    monitoringFastWakeEligible: false,
    temporalSkipEligible: false
  });
  for (const directive of ['zero-output-transport', 'bypass-transport']) {
    await harness.send({
      type: 'setPowerProcessingState',
      state: 'active',
      processingDirective: directive,
      workletGraphGeneration: 6,
      topologyRevision: 9,
      commandId: directive === 'zero-output-transport' ? 2 : 3,
      skipEpoch: directive === 'zero-output-transport' ? 1 : 2
    });
    assert.equal(harness.processor.powerPolicy.processingDirective, 'full-process');
    processBlock(harness.processor, 0.25);
  }
  assert.ok(harness.processor.powerPolicy.counters.fullJsProcessQuanta > 0);
  assert.equal(harness.processor.powerPolicy.counters.zeroOutputQuanta, 0);
  assert.equal(harness.processor.powerPolicy.counters.bypassQuanta, 0);
});
