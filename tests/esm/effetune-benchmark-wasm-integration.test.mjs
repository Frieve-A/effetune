import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  BENCHMARK_DSP_MODES,
  BENCHMARK_IR_REVERB_FRAMES,
  createIrReverbBenchmarkAssets,
  createRoomEqBenchmarkAssets,
  createDspBenchmarkRuntime
} from '../../features/effetune-benchmark.js';
import {
  instantiateDsp,
  loadDspModule
} from '../../js/audio/dsp-wasm-loader.js';

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;
const CHANNEL_COUNT = 2;
const MATRIX_PARAMS_HASH = 0x07080f45;
const ROOM_EQ_DEFAULT_TAPS = 32768;

class MatrixPlugin {
  constructor() {
    this.id = 77;
    this.enabled = false;
    this.mx = '0110';
    this.javascriptCalls = 0;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  getParameters() {
    return {
      type: this.constructor.name,
      mx: this.mx,
      enabled: this.enabled
    };
  }

  executeProcessor() {
    this.javascriptCalls++;
    throw new Error('JavaScript processor must not run in a WebAssembly benchmark');
  }
}

class IRReverbPlugin {
  constructor() {
    this.id = 88;
    this.enabled = false;
    this.cm = 'true';
    this.lt = '128';
    this.cr = 'auto';
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  getParameters() {
    return {
      type: this.constructor.name,
      cm: this.cm,
      lt: this.lt,
      cr: this.cr,
      dw: 0,
      dl: -96,
      pd: 0,
      enabled: this.enabled
    };
  }
}

class RoomEqPlugin {
  constructor() {
    this.id = 89;
    this.enabled = false;
    this.lt = '128';
    this.tp = ROOM_EQ_DEFAULT_TAPS;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  getParameters() {
    return {
      type: this.constructor.name,
      lt: this.lt,
      fd: this.tp / 2,
      dy: 0,
      gn: 0,
      enabled: this.enabled
    };
  }
}

function createBaselineWebAssemblyFacade() {
  const webAssembly = globalThis.WebAssembly;
  return {
    compile: webAssembly.compile.bind(webAssembly),
    instantiate: webAssembly.instantiate.bind(webAssembly),
    validate() {
      return false;
    },
    Tag: webAssembly.Tag,
    Exception: webAssembly.Exception
  };
}

async function fetchRepositoryAsset(url) {
  const relativePath = String(url).replace(/^[/\\]+/, '');
  const bytes = fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url));
  return {
    ok: true,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    async json() {
      return JSON.parse(bytes.toString('utf8'));
    }
  };
}

function observeBinding(binding, calls) {
  const observedMethods = [
    'createEngine',
    'prepare',
    'setTelemetryRate',
    'createInstance',
    'instanceSetTap',
    'instanceSetParams',
    'instanceSetParamBytes',
    'instanceSetAsset',
    'instanceAssetState',
    'resetInstance',
    'pipelineConfigure',
    'pipelineProcess',
    'destroyInstance',
    'telemetryRead',
    'close'
  ];
  for (const name of observedMethods) {
    const original = binding[name].bind(binding);
    binding[name] = (...args) => {
      calls.push({ name, args });
      return original(...args);
    };
  }
  return binding;
}

function findCall(calls, name) {
  return calls.find(call => call.name === name);
}

const variants = [
  {
    variant: 'baseline',
    label: 'WebAssembly (baseline)',
    webAssembly: createBaselineWebAssemblyFacade()
  },
  {
    variant: 'simd',
    label: 'WebAssembly (SIMD)',
    webAssembly: globalThis.WebAssembly
  }
];

for (const variant of variants) {
  test(`WebAssembly benchmark ${variant.variant} artifact runs Matrix in one native pipeline call`, async () => {
    const calls = [];
    const warnings = [];
    const dependencies = {
      warning(message) {
        warnings.push(message);
      },
      loadDspModule(options) {
        return loadDspModule({
          ...options,
          basePath: '',
          fetchImpl: fetchRepositoryAsset,
          webAssembly: variant.webAssembly,
          publishTarget: null,
          cache: false
        });
      },
      async instantiateDsp(moduleOrBytes, options) {
        const binding = await instantiateDsp(moduleOrBytes, options);
        return observeBinding(binding, calls);
      }
    };
    const runtime = await createDspBenchmarkRuntime({
      mode: BENCHMARK_DSP_MODES.WEBASSEMBLY,
      sampleRate: SAMPLE_RATE,
      blockSize: BLOCK_SIZE,
      preference: { useWasmDsp: true },
      location: '',
      basePath: '',
      dependencies
    });
    const plugin = new MatrixPlugin();
    let session = null;

    try {
      assert.equal(runtime.variant, variant.variant);
      assert.equal(runtime.label, variant.label);
      assert.equal(runtime.supportsPlugin(plugin), true);

      session = runtime.createPluginSession(plugin, { channelCount: CHANNEL_COUNT });
      const input = new Float32Array(CHANNEL_COUNT * BLOCK_SIZE);
      input.fill(0.25, 0, BLOCK_SIZE);
      input.fill(-0.75, BLOCK_SIZE);
      const output = Float32Array.from(session.process(input, 0.125));

      assert.deepEqual(
        [output[0], output[BLOCK_SIZE - 1], output[BLOCK_SIZE], output[output.length - 1]],
        [-0.75, -0.75, 0.25, 0.25]
      );
      assert.equal(plugin.javascriptCalls, 0);

      const structuredParamsCall = findCall(calls, 'instanceSetParamBytes');
      assert.ok(structuredParamsCall);
      assert.deepEqual(
        [...structuredParamsCall.args[1]],
        [1, 0, 2, 0, 0, 1, 0, 1, 0, 0]
      );
      assert.equal(structuredParamsCall.args[2], MATRIX_PARAMS_HASH);

      assert.deepEqual(
        findCall(calls, 'pipelineProcess').args,
        [CHANNEL_COUNT, BLOCK_SIZE, 0.125, false]
      );

      session.close();
      session.close();
      runtime.close();
      runtime.close();

      assert.deepEqual(calls.map(call => call.name), [
        'createEngine',
        'prepare',
        'setTelemetryRate',
        'createInstance',
        'instanceSetTap',
        'instanceSetParams',
        'instanceSetParamBytes',
        'pipelineConfigure',
        'pipelineProcess',
        'destroyInstance',
        'telemetryRead',
        'close'
      ]);
      assert.deepEqual(warnings, []);
    } finally {
      session?.close();
      runtime.close();
    }
  });

  test(`WebAssembly benchmark ${variant.variant} artifact activates the 256K true-stereo IR`, async () => {
    const calls = [];
    const warnings = [];
    const dependencies = {
      warning(message) {
        warnings.push(message);
      },
      loadDspModule(options) {
        return loadDspModule({
          ...options,
          basePath: '',
          fetchImpl: fetchRepositoryAsset,
          webAssembly: variant.webAssembly,
          publishTarget: null,
          cache: false
        });
      },
      async instantiateDsp(moduleOrBytes, options) {
        const binding = await instantiateDsp(moduleOrBytes, options);
        return observeBinding(binding, calls);
      }
    };
    const runtime = await createDspBenchmarkRuntime({
      mode: BENCHMARK_DSP_MODES.WEBASSEMBLY,
      sampleRate: SAMPLE_RATE,
      blockSize: BLOCK_SIZE,
      preference: { useWasmDsp: true },
      location: '',
      basePath: '',
      dependencies
    });
    const plugin = new IRReverbPlugin();
    const assets = createIrReverbBenchmarkAssets({
      sampleRate: SAMPLE_RATE,
      channelCount: CHANNEL_COUNT,
      latency: plugin.lt,
      convolutionRate: plugin.cr
    });
    let session = null;

    try {
      assert.equal(runtime.supportsPlugin(plugin), true);
      session = runtime.createPluginSession(plugin, {
        channelCount: CHANNEL_COUNT,
        assets
      });
      const preparationBlocks = session.prepareAssets();
      assert.ok(preparationBlocks > 0);

      const assetCall = findCall(calls, 'instanceSetAsset');
      assert.ok(assetCall);
      const payloadView = new DataView(assetCall.args[2]);
      assert.equal(payloadView.getUint32(4, true), 4);
      assert.equal(payloadView.getUint32(8, true), BENCHMARK_IR_REVERB_FRAMES);
      assert.equal(payloadView.getUint32(16, true), 3);
      assert.equal(findCall(calls, 'resetInstance').args[0], assetCall.args[0]);

      const input = new Float32Array(CHANNEL_COUNT * BLOCK_SIZE);
      input[0] = 1;
      const output = session.process(input, 0);
      assert.equal(output.every(Number.isFinite), true);
      assert.equal(
        calls.filter(call => call.name === 'pipelineProcess').length,
        preparationBlocks + 1
      );
      assert.deepEqual(warnings, []);
    } finally {
      session?.close();
      runtime.close();
    }
  });

  test(`WebAssembly benchmark ${variant.variant} artifact activates the default Room EQ IR`, async () => {
    const calls = [];
    const warnings = [];
    const dependencies = {
      warning(message) {
        warnings.push(message);
      },
      loadDspModule(options) {
        return loadDspModule({
          ...options,
          basePath: '',
          fetchImpl: fetchRepositoryAsset,
          webAssembly: variant.webAssembly,
          publishTarget: null,
          cache: false
        });
      },
      async instantiateDsp(moduleOrBytes, options) {
        const binding = await instantiateDsp(moduleOrBytes, options);
        return observeBinding(binding, calls);
      }
    };
    const runtime = await createDspBenchmarkRuntime({
      mode: BENCHMARK_DSP_MODES.WEBASSEMBLY,
      sampleRate: SAMPLE_RATE,
      blockSize: BLOCK_SIZE,
      preference: { useWasmDsp: true },
      location: '',
      basePath: '',
      dependencies
    });
    const plugin = new RoomEqPlugin();
    const assets = createRoomEqBenchmarkAssets({
      sampleRate: SAMPLE_RATE,
      channelCount: CHANNEL_COUNT,
      taps: plugin.tp,
      latency: plugin.lt
    });
    let session = null;

    try {
      assert.equal(runtime.supportsPlugin(plugin), true);
      session = runtime.createPluginSession(plugin, {
        channelCount: CHANNEL_COUNT,
        assets
      });
      const preparationBlocks = session.prepareAssets();
      assert.ok(preparationBlocks > 0);

      const assetCall = findCall(calls, 'instanceSetAsset');
      assert.ok(assetCall);
      const payloadView = new DataView(assetCall.args[2]);
      assert.equal(payloadView.getUint32(4, true), 1);
      assert.equal(payloadView.getUint32(8, true), ROOM_EQ_DEFAULT_TAPS);
      assert.equal(payloadView.getUint32(16, true), 1);
      assert.equal(findCall(calls, 'resetInstance').args[0], assetCall.args[0]);

      const input = new Float32Array(CHANNEL_COUNT * BLOCK_SIZE);
      input[0] = 1;
      const output = session.process(input, 0);
      assert.equal(output.every(Number.isFinite), true);
      assert.equal(
        calls.filter(call => call.name === 'pipelineProcess').length,
        preparationBlocks + 1
      );
      assert.deepEqual(warnings, []);
    } finally {
      session?.close();
      runtime.close();
    }
  });
}
