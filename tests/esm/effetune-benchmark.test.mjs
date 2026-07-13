import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BENCHMARK_DSP_MAX_CHANNELS,
  BENCHMARK_DSP_MODES,
  BENCHMARK_DSP_TELEMETRY_BYTES,
  BENCHMARK_DSP_TELEMETRY_RATE,
  DspBenchmarkPluginUnavailableError,
  DspBenchmarkUnavailableError,
  createDspBenchmarkRuntime
} from '../../features/effetune-benchmark.js';
import { decodeDspPipelineDescriptor } from '../../js/audio/dsp-pipeline-descriptor.js';

class VolumePlugin {
  constructor(calls = []) {
    this.calls = calls;
    this.id = 42;
    this.name = 'Volume';
    this.enabled = false;
  }

  getParameters() {
    this.calls.push(['getParameters']);
    return {
      gain: 2,
      curve: [3, 4],
      inputBus: 0,
      outputBus: 0
    };
  }

  setEnabled(enabled) {
    this.calls.push(['setEnabled', enabled]);
    this.enabled = enabled;
  }

  executeProcessor(context, inputData, parameters, timeSeconds) {
    this.calls.push(['executeProcessor', context, inputData, parameters, timeSeconds]);
    return inputData;
  }
}

class UnknownPlugin extends VolumePlugin {}

function createWasmHarness({ simd = false } = {}) {
  const calls = [];
  const packedParameters = [];
  const structuredParameters = [];
  const combined = new Float32Array(BENCHMARK_DSP_MAX_CHANNELS * 128);
  const hash = 0x12345678;
  const modulePayload = { name: simd ? 'simd-module' : 'baseline-module' };
  const moduleInfo = {
    module: modulePayload,
    simd,
    meta: {
      abiVersion: 1,
      kernels: [{ name: 'VolumePlugin', hash, byteCapacity: 8 }]
    },
    paramPackers: new Map([[
      'VolumePlugin',
      {
        hash,
        byteCapacity: 8,
        pack(parameters) {
          packedParameters.push(parameters);
          calls.push(['pack', parameters]);
          return Float32Array.of(parameters.gain, parameters.channelCount);
        },
        packBytes(parameters) {
          structuredParameters.push(parameters);
          calls.push(['packBytes', parameters]);
          return Uint8Array.from(parameters.curve);
        }
      }
    ]])
  };

  const binding = {
    live: true,
    createEngine() {
      calls.push(['createEngine']);
      return 1;
    },
    prepare(sampleRate, channelCount, blockSize, telemetryBytes) {
      calls.push(['prepare', sampleRate, channelCount, blockSize, telemetryBytes]);
      return 0;
    },
    setTelemetryRate(rate) {
      calls.push(['setTelemetryRate', rate]);
      return 0;
    },
    createInstance(typeName) {
      calls.push(['createInstance', typeName]);
      return 17;
    },
    instanceSetTap(instanceId, tapId) {
      calls.push(['instanceSetTap', instanceId, tapId]);
      return 0;
    },
    instanceSetParams(instanceId, packed, packedHash) {
      calls.push(['instanceSetParams', instanceId, [...packed], packedHash]);
      return 0;
    },
    instanceSetParamBytes(instanceId, packed, packedHash) {
      calls.push(['instanceSetParamBytes', instanceId, [...packed], packedHash]);
      return 0;
    },
    getArenaViews() {
      calls.push(['getArenaViews']);
      return { combined };
    },
    pipelineConfigure(descriptor) {
      calls.push(['pipelineConfigure', Uint8Array.from(descriptor)]);
      return 0;
    },
    pipelineProcess(channelCount, blockSize, timeSeconds, masterBypass) {
      const sampleCount = channelCount * blockSize;
      calls.push([
        'pipelineProcess',
        channelCount,
        blockSize,
        timeSeconds,
        masterBypass,
        Array.from(combined.subarray(0, sampleCount))
      ]);
      combined[0] = 9;
      return 0;
    },
    destroyInstance(instanceId) {
      calls.push(['destroyInstance', instanceId]);
    },
    telemetryRead(packet) {
      calls.push(['telemetryRead', packet.byteLength]);
      return 0;
    },
    close() {
      calls.push(['close']);
    }
  };

  const dependencies = {
    getDspRolloutConfig(options) {
      calls.push(['getDspRolloutConfig', options]);
      return {
        forceOff: false,
        enabledTypes: options.meta ? ['VolumePlugin'] : []
      };
    },
    async loadDspModule(options) {
      calls.push(['loadDspModule', options]);
      return moduleInfo;
    },
    async instantiateDsp(payload, options) {
      calls.push(['instantiateDsp', payload, options]);
      return binding;
    },
    warning(message) {
      calls.push(['warning', message]);
    }
  };

  return {
    binding,
    calls,
    combined,
    dependencies,
    moduleInfo,
    modulePayload,
    packedParameters,
    structuredParameters
  };
}

async function createWasmRuntime(harness, options = {}) {
  return createDspBenchmarkRuntime({
    mode: BENCHMARK_DSP_MODES.WEBASSEMBLY,
    sampleRate: options.sampleRate ?? 96000,
    blockSize: 128,
    preference: { useWasmDsp: true },
    location: '',
    basePath: '/benchmark',
    dependencies: harness.dependencies
  });
}

test('JavaScript mode measures executeProcessor without initializing WebAssembly', async () => {
  const dependencyCalls = [];
  const dependencies = {
    getDspRolloutConfig() {
      dependencyCalls.push('rollout');
      throw new Error('WebAssembly rollout must not run');
    },
    async loadDspModule() {
      dependencyCalls.push('load');
      throw new Error('WebAssembly loader must not run');
    },
    async instantiateDsp() {
      dependencyCalls.push('instantiate');
      throw new Error('WebAssembly instantiation must not run');
    }
  };
  const calls = [];
  const plugin = new VolumePlugin(calls);
  const runtime = await createDspBenchmarkRuntime({
    mode: BENCHMARK_DSP_MODES.JAVASCRIPT,
    sampleRate: 48000,
    blockSize: 64,
    dependencies
  });

  assert.equal(runtime.label, 'JavaScript');
  assert.equal(runtime.variant, BENCHMARK_DSP_MODES.JAVASCRIPT);
  assert.equal(runtime.usesWasm, false);
  assert.equal(runtime.supportsPlugin(plugin), true);

  const session = runtime.createPluginSession(plugin, { channelCount: 2 });
  const input = Float32Array.of(0.25, -0.5);
  assert.equal(session.process(input, 1.5), input);
  const processCall = calls.find(call => call[0] === 'executeProcessor');
  assert.deepEqual(processCall.slice(1), [
    { sampleRate: 48000, initialized: false },
    input,
    {
      gain: 2,
      curve: [3, 4],
      inputBus: 0,
      outputBus: 0,
      channelCount: 2,
      blockSize: 64,
      sampleRate: 48000
    },
    1.5
  ]);
  assert.deepEqual(dependencyCalls, []);

  session.close();
  assert.throws(() => session.process(input, 2), /session is closed/);
  runtime.close();
});

test('WebAssembly mode honors the user setting and dsp=off before loading an artifact', async () => {
  let rolloutCalls = 0;
  let loadCalls = 0;
  const dependencies = {
    getDspRolloutConfig() {
      rolloutCalls++;
      return { forceOff: true, enabledTypes: [] };
    },
    async loadDspModule() {
      loadCalls++;
      return null;
    }
  };
  const common = {
    mode: BENCHMARK_DSP_MODES.WEBASSEMBLY,
    sampleRate: 48000,
    blockSize: 128,
    dependencies
  };

  await assert.rejects(
    createDspBenchmarkRuntime({
      ...common,
      preference: { useWasmDsp: false },
      location: ''
    }),
    error => error instanceof DspBenchmarkUnavailableError && /useWasmDsp/.test(error.message)
  );
  assert.equal(rolloutCalls, 0);
  assert.equal(loadCalls, 0);

  await assert.rejects(
    createDspBenchmarkRuntime({
      ...common,
      preference: { useWasmDsp: true },
      location: '?dsp=off'
    }),
    error => error instanceof DspBenchmarkUnavailableError && /dsp=off/.test(error.message)
  );
  assert.equal(rolloutCalls, 1);
  assert.equal(loadCalls, 0);
});

test('WebAssembly runtime labels baseline and SIMD artifacts distinctly', async () => {
  const baselineHarness = createWasmHarness({ simd: false });
  const simdHarness = createWasmHarness({ simd: true });
  const baseline = await createWasmRuntime(baselineHarness);
  const simd = await createWasmRuntime(simdHarness);

  assert.equal(baseline.label, 'WebAssembly (baseline)');
  assert.equal(baseline.variant, 'baseline');
  assert.equal(simd.label, 'WebAssembly (SIMD)');
  assert.equal(simd.variant, 'simd');
  assert.equal(baseline.usesWasm, true);
  assert.equal(simd.usesWasm, true);

  baseline.close();
  simd.close();
});

test('WebAssembly sessions use one pipeline call with packed and structured parameters', async () => {
  const harness = createWasmHarness();
  const pluginCalls = [];
  const plugin = new VolumePlugin(pluginCalls);
  const runtime = await createWasmRuntime(harness);

  assert.equal(runtime.supportsPlugin(plugin), true);
  assert.equal(runtime.supportsPlugin('VolumePlugin'), true);
  assert.deepEqual(
    harness.calls.find(call => call[0] === 'prepare'),
    ['prepare', 96000, BENCHMARK_DSP_MAX_CHANNELS, 128, BENCHMARK_DSP_TELEMETRY_BYTES]
  );
  assert.deepEqual(
    harness.calls.find(call => call[0] === 'setTelemetryRate'),
    ['setTelemetryRate', BENCHMARK_DSP_TELEMETRY_RATE]
  );

  const session = runtime.createPluginSession(plugin, { channelCount: 2 });
  const expectedParameters = {
    gain: 2,
    curve: [3, 4],
    inputBus: 0,
    outputBus: 0,
    channelCount: 2,
    blockSize: 128,
    sampleRate: 96000
  };
  assert.deepEqual(harness.packedParameters, [expectedParameters]);
  assert.deepEqual(harness.structuredParameters, [expectedParameters]);
  assert.deepEqual(
    harness.calls.find(call => call[0] === 'instanceSetTap'),
    ['instanceSetTap', 17, 42]
  );
  assert.deepEqual(
    harness.calls.find(call => call[0] === 'instanceSetParams'),
    ['instanceSetParams', 17, [2, 2], 0x12345678]
  );
  assert.deepEqual(
    harness.calls.find(call => call[0] === 'instanceSetParamBytes'),
    ['instanceSetParamBytes', 17, [3, 4], 0x12345678]
  );

  const configureCall = harness.calls.find(call => call[0] === 'pipelineConfigure');
  assert.deepEqual(decodeDspPipelineDescriptor(configureCall[1]).nodes, [{
    instanceId: 17,
    enabled: 1,
    inputBus: 0,
    outputBus: 0,
    channelSpec: -1,
    sectionGate: 1
  }]);

  const input = new Float32Array(2 * 128);
  input[0] = 0.5;
  input[255] = -0.25;
  const output = session.process(input, 0.25);
  assert.equal(output.length, input.length);
  assert.equal(output[0], 9);
  assert.deepEqual(
    harness.calls.filter(call => call[0] === 'pipelineProcess').map(call => call.slice(0, 5)),
    [['pipelineProcess', 2, 128, 0.25, false]]
  );
  const pipelineInput = harness.calls.find(call => call[0] === 'pipelineProcess')[5];
  assert.equal(pipelineInput[0], 0.5);
  assert.equal(pipelineInput[255], -0.25);
  assert.equal(harness.calls.some(call => call[0] === 'instanceProcess'), false);
  assert.equal(pluginCalls.some(call => call[0] === 'executeProcessor'), false);

  session.close();
  session.close();
  assert.equal(harness.calls.filter(call => call[0] === 'destroyInstance').length, 1);
  assert.equal(harness.calls.filter(call => call[0] === 'telemetryRead').length, 1);
  runtime.close();
  runtime.close();
  assert.equal(harness.calls.filter(call => call[0] === 'close').length, 1);
});

test('WebAssembly mode rejects noneligible plugins without measuring JavaScript', async () => {
  const harness = createWasmHarness();
  const pluginCalls = [];
  const plugin = new UnknownPlugin(pluginCalls);
  const runtime = await createWasmRuntime(harness);

  assert.equal(runtime.supportsPlugin(plugin), false);
  assert.throws(
    () => runtime.createPluginSession(plugin, { channelCount: 2 }),
    error => error instanceof DspBenchmarkPluginUnavailableError &&
      error.typeName === 'UnknownPlugin'
  );
  assert.equal(harness.calls.some(call => call[0] === 'createInstance'), false);
  assert.equal(pluginCalls.some(call => call[0] === 'executeProcessor'), false);

  runtime.close();
});

test('WebAssembly sessions route all eight channels through one 1024-sample pipeline call', async () => {
  const harness = createWasmHarness();
  const pluginCalls = [];
  const plugin = new VolumePlugin(pluginCalls);
  const runtime = await createWasmRuntime(harness);
  const session = runtime.createPluginSession(plugin, { channelCount: 8 });

  const configureCall = harness.calls.find(call => call[0] === 'pipelineConfigure');
  const descriptor = decodeDspPipelineDescriptor(configureCall[1]);
  assert.equal(descriptor.nodes.length, 1);
  assert.equal(descriptor.nodes[0].channelSpec, -2);

  const input = new Float32Array(8 * 128);
  input[0] = 0.125;
  input[1023] = -0.75;
  session.process(input, 0.5);

  const pipelineCall = harness.calls.find(call => call[0] === 'pipelineProcess');
  assert.deepEqual(pipelineCall.slice(0, 5), ['pipelineProcess', 8, 128, 0.5, false]);
  assert.equal(pipelineCall[5].length, 1024);
  assert.equal(pipelineCall[5][0], 0.125);
  assert.equal(pipelineCall[5][1023], -0.75);
  assert.equal(pluginCalls.some(call => call[0] === 'executeProcessor'), false);

  session.close();
  runtime.close();
});

test('WebAssembly loader failure reports unavailability without instantiating or measuring JavaScript', async () => {
  const dependencyCalls = [];
  const pluginCalls = [];
  const plugin = new VolumePlugin(pluginCalls);
  const dependencies = {
    getDspRolloutConfig() {
      dependencyCalls.push('rollout');
      return { forceOff: false, enabledTypes: [] };
    },
    async loadDspModule() {
      dependencyCalls.push('load');
      return null;
    },
    async instantiateDsp() {
      dependencyCalls.push('instantiate');
      throw new Error('instantiateDsp must not run');
    }
  };

  await assert.rejects(
    createDspBenchmarkRuntime({
      mode: BENCHMARK_DSP_MODES.WEBASSEMBLY,
      sampleRate: 48000,
      blockSize: 128,
      preference: { useWasmDsp: true },
      location: '',
      dependencies
    }),
    error => error instanceof DspBenchmarkUnavailableError &&
      /no JavaScript fallback was measured/.test(error.message)
  );
  assert.deepEqual(dependencyCalls, ['rollout', 'load']);
  assert.equal(pluginCalls.some(call => call[0] === 'executeProcessor'), false);
  assert.equal(plugin.enabled, false);
});

test('WebAssembly setup failure destroys the instance created for the failed session', async () => {
  const harness = createWasmHarness();
  harness.binding.instanceSetParams = (instanceId, packed, packedHash) => {
    harness.calls.push(['instanceSetParams', instanceId, [...packed], packedHash]);
    return -9;
  };
  const plugin = new VolumePlugin();
  const runtime = await createWasmRuntime(harness);

  assert.throws(
    () => runtime.createPluginSession(plugin, { channelCount: 2 }),
    /parameter update failed with status -9/
  );
  assert.deepEqual(
    harness.calls.filter(call => call[0] === 'destroyInstance'),
    [['destroyInstance', 17]]
  );
  assert.equal(harness.calls.some(call => call[0] === 'pipelineConfigure'), false);

  runtime.close();
  assert.equal(harness.calls.filter(call => call[0] === 'close').length, 1);
});

test('WebAssembly process failure leaves instance cleanup to the caller', async () => {
  const harness = createWasmHarness();
  harness.binding.pipelineProcess = (channelCount, blockSize, timeSeconds, masterBypass) => {
    harness.calls.push([
      'pipelineProcess',
      channelCount,
      blockSize,
      timeSeconds,
      masterBypass
    ]);
    return -7;
  };
  const plugin = new VolumePlugin();
  const runtime = await createWasmRuntime(harness);
  const session = runtime.createPluginSession(plugin, { channelCount: 2 });

  assert.throws(
    () => session.process(new Float32Array(2 * 128), 0.75),
    /et_pipeline_process failed with status -7/
  );
  assert.equal(harness.calls.some(call => call[0] === 'destroyInstance'), false);

  session.close();
  assert.deepEqual(
    harness.calls.filter(call => call[0] === 'destroyInstance'),
    [['destroyInstance', 17]]
  );
  runtime.close();
});
