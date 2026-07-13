import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { decodeDspPipelineDescriptor } from '../../js/audio/dsp-pipeline-descriptor.js';

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
  assert.equal(messagesOf(harness.posts, 'powerStateAck').at(-1).message.automaticArmAccepted, false);
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

  const afterEmptyEdgeCount = posts.length;
  for (let index = 0; index < 100; index++) processEmptyBlock();
  assert.equal(powerPosts().length, afterEmptyEdgeCount);

  for (let index = 0; index < 300; index++) processEmptyBlock();
  posts = powerPosts();
  assert.equal(posts.length, afterEmptyEdgeCount + 1);
  assert.equal(posts.at(-1).message.type, 'powerHeartbeat');

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
    type: 'prepareTemporalState',
    origin: 'deliberate',
    ownerOperationId: 'resume-1',
    commandId: 7,
    ackCommandId: 8,
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
  const prepared = messagesOf(harness.posts, 'temporalStatePrepared').at(-1).message;
  assert.deepEqual({ ...prepared.appliedPolicyCounts }, {
    stateless: 1,
    resetOnResume: 1,
    agedBySkippedFrames: 0,
    mustProcess: 0
  });
  assert.equal(prepared.state, 'acknowledged');
  assert.equal(prepared.enabledPluginCount, 2);
  assert.equal(prepared.coveredPluginCount, 2);
  assert.equal(prepared.ackCommandId, 8);
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

  const beforeStale = messagesOf(harness.posts, 'temporalStatePrepared').length;
  await harness.send({
    type: 'prepareTemporalState',
    origin: 'deliberate',
    ownerOperationId: 'old-owner',
    commandId: 8,
    ackCommandId: 10,
    skipEpoch: 6,
    skippedFrameCount: 256,
    suspendedElapsedMs: 1000,
    elapsedContinuity: 'verified',
    resumeSampleRate: 48000,
    workletGraphGeneration: 4,
    topologyRevision: 5
  });
  assert.equal(messagesOf(harness.posts, 'temporalStatePrepared').length, beforeStale);

  await harness.send({
    type: 'prepareTemporalState',
    origin: 'deliberate',
    ownerOperationId: 'resume-owner',
    commandId: 9,
    ackCommandId: 11,
    skipEpoch: 6,
    skippedFrameCount: 256,
    suspendedElapsedMs: 1000,
    elapsedContinuity: 'verified',
    resumeSampleRate: 48000,
    workletGraphGeneration: 4,
    topologyRevision: 5
  });
  const prepared = messagesOf(harness.posts, 'temporalStatePrepared').at(-1).message;
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

test('power detector uses channel maxima, treats nonfinite input as active, and holds low-level wake', async () => {
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
  harness.processor.powerPolicy.ewmaAlpha = 1;
  harness.processor.powerPolicy.lowLevelWakeFramesRequired = 256;
  const lowLevel = 10 ** (-75 / 20);
  processBlock(harness.processor, lowLevel);
  assert.equal(harness.processor.powerPolicy.state, 'monitoring');
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
