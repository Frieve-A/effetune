import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { Worker } from 'node:worker_threads';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { designFIRCrossover } from '../../js/fir-crossover/design-core.js';
import {
  buildIrAssetPayload,
  IR_ASSET_TOPOLOGY
} from '../../js/ir-library/ir-asset-payload.js';
import { estimateIrKernelCommitFootprint } from '../../js/ir-library/ir-plugin-contract.js';
import {
  createPluginProcessorHost,
  installAnalysisWorker,
  recommendPeriodicSequenceLength,
  recommendMlsSequenceLength,
  runAnalysisRequest
} from '../../js/pipeline-analyzer/analysis-worker.js';
import { getPipelineAnalysisRequirements } from '../../js/pipeline-analyzer/analysis-requirements.js';
import {
  buildPipelineAnalyzerSnapshot,
  collectPipelineAnalyzerTransferables
} from '../../js/pipeline-analyzer/pipeline-snapshot.js';
import { PipelineWorkletSync } from '../../js/ui/pipeline/pipeline-worklet-sync.js';

const SAMPLE_RATE = 48000;
const CHANNEL_COUNT = 8;
const IMPULSE_SETTINGS = Object.freeze({
  signalType: 'impulse',
  levelDb: -12,
  sequenceLength: 65536,
  stabilizationPeriods: 12,
  averagingPeriods: 2
});

function pluginConfig(overrides = {}) {
  return {
    id: 1,
    type: 'StatefulAnalyzerTestPlugin',
    enabled: true,
    parameters: {},
    inputBus: 0,
    outputBus: 0,
    channel: null,
    ...overrides
  };
}

function processConstant(host, value, channelCount = 2) {
  const input = Array.from({ length: channelCount }, () => new Float32Array(128).fill(value));
  return host.processBlock(input);
}

function jsAnalysisRequest(processor, options = {}) {
  const type = options.type || 'AnalyzerBehaviorTestPlugin';
  return {
    type: 'analyze',
    activationEpoch: 1,
    runGeneration: 1,
    snapshot: {
      sampleRate: options.sampleRate || 8000,
      channelCount: 1,
      inputChannel: 0,
      outputChannels: [0],
      plugins: [pluginConfig({ type })],
      masterBypass: false,
      processors: [{ pluginType: type, processor }],
      measurementSettings: IMPULSE_SETTINGS,
      warmupSamples: 0
    },
    speakerResponses: [null]
  };
}

test('configured processing-state reset keeps the graph and registry but restores JS state and clock', async () => {
  const host = await createPluginProcessorHost(SAMPLE_RATE, 2);
  host.send({
    type: 'registerProcessor',
    pluginType: 'StatefulAnalyzerTestPlugin',
    processor: `
      context.calls = (context.calls || 0) + 1;
      data.fill(context.calls);
      return data;
    `
  });
  host.send({ type: 'dspEnableTypes', types: [] });
  host.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });

  assert.equal(processConstant(host, 0.25)[0][0], 1);
  assert.equal(processConstant(host, 0.25)[0][0], 2);
  assert.equal(host.processor.currentFrame, 256);
  const registry = host.processor.pluginProcessors;
  const plugins = host.processor.plugins;

  host.send({ type: 'resetProcessingState', requestId: 77 });
  const reset = host.messages.find(message =>
    message.type === 'processingStateReset' && message.requestId === 77
  );
  assert.deepEqual(reset, { type: 'processingStateReset', requestId: 77, ok: true });
  assert.equal(host.processor.currentFrame, 0);
  assert.equal(host.processor.pluginProcessors, registry);
  assert.equal(host.processor.plugins, plugins);
  assert.equal(processConstant(host, 0.25)[0][0], 1);
});

test('analysis worker measures a selected input/output through the shared JS processor', async () => {
  const progress = [];
  const result = await runAnalysisRequest({
    type: 'analyze',
    activationEpoch: 3,
    runGeneration: 9,
    snapshot: {
      sampleRate: SAMPLE_RATE,
      channelCount: 2,
      inputChannel: 1,
      outputChannels: [0, 1],
      plugins: [pluginConfig({
        type: 'GainAnalyzerTestPlugin',
        parameters: { gain: 2 }
      })],
      masterBypass: false,
      processors: [{
        pluginType: 'GainAnalyzerTestPlugin',
        processor: 'for (let i = 0; i < data.length; i++) data[i] *= parameters.gain; return data;'
      }],
      measurementSettings: IMPULSE_SETTINGS,
      warmupSamples: 0
    },
    speakerResponses: [null, null]
  }, message => progress.push(message));

  assert.equal(result.truncated, false);
  assert.equal(result.before.impulse[0], 1);
  assert.equal(result.before.impulse.subarray(1).every(value => value === 0), true);
  assert.equal(result.after.impulse[0], 2);
  assert.equal(result.after.impulse.subarray(1).every(value => value === 0), true);
  assert.ok(progress.some(message => message.phase === 'preparing'));
  assert.ok(progress.some(message => message.phase === 'measuring'));
});

test('MLS worker conditions continuously and recovers normalized gain at the selected level', async () => {
  const progress = [];
  const settings = {
    signalType: 'mls',
    levelDb: -12,
    sequenceLength: 32767,
    stabilizationPeriods: 1,
    averagingPeriods: 2
  };
  const result = await runAnalysisRequest({
    type: 'analyze',
    activationEpoch: 4,
    runGeneration: 10,
    snapshot: {
      sampleRate: 8000,
      channelCount: 1,
      inputChannel: 0,
      outputChannels: [0],
      plugins: [pluginConfig({ type: 'MlsGainAnalyzerTestPlugin' })],
      masterBypass: false,
      processors: [{
        pluginType: 'MlsGainAnalyzerTestPlugin',
        processor: 'for (let i = 0; i < data.length; i++) data[i] *= -2; return data;'
      }],
      assetSupportSamples: 1,
      measurementSettings: settings,
      warmupSamples: 0
    },
    speakerResponses: [null]
  }, message => progress.push(message));

  assert.equal(result.truncated, false);
  assert.ok(Math.abs(result.after.impulse[0] + 2) < 2e-5);
  assert.equal(result.measurement.signalType, 'mls');
  assert.equal(result.measurement.periodResidualDb, -Infinity);
  assert.equal(result.measurement.routeDiagnostics[0].baselineTrusted, true);
  assert.equal(result.measurement.recommendedSequenceLength, null);
  assert.deepEqual(result.warnings, []);
  assert.equal(progress.at(-1).processedSamples, 3 * 32767);
  assert.equal(progress.at(-1).totalSamples, 3 * 32767);
});

test('TSP worker conditions continuously and recovers normalized gain and polarity', async () => {
  const progress = [];
  const settings = {
    signalType: 'tsp',
    levelDb: -12,
    sequenceLength: 32768,
    stabilizationPeriods: 1,
    averagingPeriods: 2
  };
  const result = await runAnalysisRequest({
    type: 'analyze',
    activationEpoch: 4,
    runGeneration: 20,
    snapshot: {
      sampleRate: 8000,
      channelCount: 1,
      inputChannel: 0,
      outputChannels: [0],
      plugins: [pluginConfig({ type: 'TspGainAnalyzerTestPlugin' })],
      masterBypass: false,
      processors: [{
        pluginType: 'TspGainAnalyzerTestPlugin',
        processor: 'for (let i = 0; i < data.length; i++) data[i] *= -2; return data;'
      }],
      assetSupportSamples: 1,
      measurementSettings: settings,
      warmupSamples: 0
    },
    speakerResponses: [null]
  }, message => progress.push(message));

  assert.ok(Math.abs(result.after.impulse[0] + 2) < 2e-4);
  assert.equal(result.measurement.signalType, 'tsp');
  assert.equal(result.measurement.periodResidualDb, -Infinity);
  assert.equal(result.measurement.recommendedSequenceLength, null);
  assert.equal(progress.at(-1).processedSamples, 3 * 32768);
  assert.equal(progress.at(-1).totalSamples, 3 * 32768);
});

test('TSP accepts nonlinear changing processors and reports capture residual', async () => {
  const result = await runAnalysisRequest({
    type: 'analyze',
    activationEpoch: 4,
    runGeneration: 21,
    snapshot: {
      sampleRate: 8000,
      channelCount: 1,
      inputChannel: 0,
      outputChannels: [0],
      plugins: [pluginConfig({ type: 'TspNonlinearAnalyzerTestPlugin' })],
      masterBypass: false,
      processors: [{
        pluginType: 'TspNonlinearAnalyzerTestPlugin',
        processor: `context.block = (context.block || 0) + 1;
          for (let i = 0; i < data.length; i++) data[i] = data[i] * data[i] * (1 + context.block * 0.001);
          return data;`
      }],
      assetSupportSamples: 1,
      measurementSettings: {
        signalType: 'tsp', levelDb: -12, sequenceLength: 32768,
        stabilizationPeriods: 1, averagingPeriods: 2
      },
      warmupSamples: 0
    },
    speakerResponses: [null]
  });
  assert.equal(result.after.impulse.every(Number.isFinite), true);
  assert.equal(result.warnings.some(item => item.code === 'period-residual'), true);
});

test('MLS worker warns when declared response support overlaps the baseline window', async () => {
  const result = await runAnalysisRequest({
    type: 'analyze',
    activationEpoch: 4,
    runGeneration: 11,
    snapshot: {
      sampleRate: 8000,
      channelCount: 1,
      inputChannel: 0,
      outputChannels: [0],
      plugins: [],
      masterBypass: false,
      processors: [],
      assetSupportSamples: 20000,
      measurementSettings: {
        signalType: 'mls',
        levelDb: -12,
        sequenceLength: 32767,
        stabilizationPeriods: 1,
        averagingPeriods: 1
      },
      warmupSamples: 0
    },
    speakerResponses: [null]
  });

  assert.equal(result.measurement.routeDiagnostics[0].supportOverlapsWindow, true);
  assert.equal(result.measurement.routeDiagnostics[0].baselineTrusted, false);
  assert.deepEqual(result.warnings, [{
    code: 'sequence-too-short',
    details: {
      route: 0,
      knownSpanSamples: 20000,
      currentSupportSamples: 32767,
      recommendedSequenceLength: 65535
    }
  }]);
});

test('MLS recommendations are the smallest longer length with a trusted baseline window', () => {
  assert.equal(recommendMlsSequenceLength(49151, 32767), 65535);
  assert.equal(recommendMlsSequenceLength(49152, 32767), 131071);
  assert.equal(recommendMlsSequenceLength(114687, 65535), 131071);
  assert.equal(recommendMlsSequenceLength(114688, 65535), 262143);
  assert.equal(recommendMlsSequenceLength(510000, 262143), null);
  assert.equal(recommendMlsSequenceLength(1, 524287), null);
});

test('TSP recommendations use the matching power-of-two family and trusted baseline window', () => {
  assert.equal(recommendPeriodicSequenceLength('tsp', 49152, 32768), 65536);
  assert.equal(recommendPeriodicSequenceLength('tsp', 49153, 32768), 131072);
  assert.equal(recommendPeriodicSequenceLength('tsp', 507904, 262144), 524288);
  assert.equal(recommendPeriodicSequenceLength('tsp', 507905, 262144), null);
  assert.equal(recommendPeriodicSequenceLength('tsp', 1, 524288), null);
});

test('unsettled MLS boundary shares its strictly longer recommendation with metadata', async () => {
  const result = await runAnalysisRequest({
    type: 'analyze',
    activationEpoch: 4,
    runGeneration: 12,
    snapshot: {
      sampleRate: 8000,
      channelCount: 1,
      inputChannel: 0,
      outputChannels: [0],
      plugins: [pluginConfig({ type: 'LongTailAnalyzerTestPlugin' })],
      masterBypass: false,
      processors: [{
        pluginType: 'LongTailAnalyzerTestPlugin',
        processor: 'for (let i = 0; i < data.length; i++) { context.y = (context.y || 0) * 0.9999 + data[i]; data[i] = context.y; } return data;'
      }],
      assetSupportSamples: 1,
      measurementSettings: {
        signalType: 'mls',
        levelDb: -12,
        sequenceLength: 32767,
        stabilizationPeriods: 1,
        averagingPeriods: 1
      },
      warmupSamples: 0
    },
    speakerResponses: [null]
  });

  assert.equal(result.measurement.routeDiagnostics[0].supportOverlapsWindow, false);
  assert.equal(result.measurement.routeDiagnostics[0].boundarySettled, false);
  assert.equal(result.measurement.recommendedSequenceLength, 65535);
  assert.deepEqual(result.warnings, [{
    code: 'possible-circular-alias',
    details: { route: 0, recommendedSequenceLength: 65535 }
  }]);
});

test('generic Worklet telemetry reports rollout-disabled optional DSP without changing JS processing', async () => {
  const host = await createPluginProcessorHost(SAMPLE_RATE, 1);
  host.send({
    type: 'registerProcessor',
    pluginType: 'OptionalTelemetryTestPlugin',
    processor: 'return data;'
  });
  host.send({ type: 'dspEnableTypes', types: [] });
  host.send({
    type: 'updatePlugins',
    plugins: [pluginConfig({
      type: 'OptionalTelemetryTestPlugin',
      wasmParams: new Float32Array([1])
    })],
    masterBypass: false
  });
  const state = host.messages.find(message =>
    message.type === 'dspExecutionState' && message.pluginId === 1
  );
  assert.equal(state?.state, 'bypassed');
  assert.equal(state?.reason, 'rolloutDisabled');
  assert.equal(processConstant(host, 0.25, 1)[0][0], 0.25);
});

test('proven-active optional WASM degrades to measured JS with a warning when module copy is unavailable', async () => {
  const result = await runAnalysisRequest({
    type: 'analyze',
    activationEpoch: 5,
    runGeneration: 11,
    snapshot: {
      sampleRate: 8000,
      channelCount: 1,
      inputChannel: 0,
      outputChannels: [0],
      plugins: [pluginConfig({
        type: 'OptionalFallbackAnalyzerTestPlugin',
        wasmParams: new Float32Array([1])
      })],
      masterBypass: false,
      processors: [{
        pluginType: 'OptionalFallbackAnalyzerTestPlugin',
        processor: 'for (let i = 0; i < data.length; i++) data[i] *= 2; return data;'
      }],
      dsp: null,
      requiredWasmPluginIds: [],
      preferredWasmPluginIds: [1],
      preferredWasmTypes: ['OptionalFallbackAnalyzerTestPlugin'],
      measurementSettings: IMPULSE_SETTINGS,
      warmupSamples: 0
    },
    speakerResponses: [null]
  });
  assert.equal(result.after.impulse[0], 2);
  assert.deepEqual(result.warnings, [{
    code: 'optional-wasm-fallback',
    details: { pluginId: 1, reason: 'wasmUnavailable' }
  }]);
});

test('nonlinear, time-varying, and random processors use the shared measurement path', async () => {
  const processors = [
    'for (let i = 0; i < data.length; i++) data[i] *= data[i]; return data;',
    `context.block = (context.block || 0) + 1;
     for (let i = 0; i < data.length; i++) data[i] *= context.block;
     return data;`,
    'for (let i = 0; i < data.length; i++) data[i] *= Math.random(); return data;'
  ];
  for (let index = 0; index < processors.length; index += 1) {
    const result = await runAnalysisRequest(jsAnalysisRequest(processors[index], {
      type: `AnalyzerBehaviorTestPlugin${index}`
    }));
    assert.equal(result.truncated, false);
    assert.equal(Number.isFinite(result.after.impulse[0]), true);
  }
});

test('finite sound-generating output reaches the bounded truncated-success path', async () => {
  const result = await runAnalysisRequest(jsAnalysisRequest(
    'data.fill(0.25); return data;',
    { type: 'AnalyzerSourceTestPlugin' }
  ));
  assert.equal(result.truncated, true);
  assert.equal(result.captureLength, IMPULSE_SETTINGS.sequenceLength);
  assert.equal(result.after.impulse.every(Number.isFinite), true);
});

test('non-finite selected output fails in its first quantum before response derivation', async () => {
  for (const value of ['NaN', 'Number.POSITIVE_INFINITY', 'Number.NEGATIVE_INFINITY']) {
    const progress = [];
    await assert.rejects(
      runAnalysisRequest(jsAnalysisRequest(
        `data[0] = ${value}; return data;`,
        { type: `AnalyzerNonFiniteTestPlugin${progress.length}` }
      ), message => progress.push(message)),
      error => error?.code === 'non-finite-output'
    );
    const measuring = progress.filter(message => message.phase === 'measuring');
    assert.deepEqual(measuring.map(message => message.processedSamples), [0]);
  }
});

test('worker protocol preserves activation and run tokens on validation errors', async () => {
  const messages = [];
  const scope = {
    onmessage: null,
    postMessage(message) { messages.push(message); }
  };
  installAnalysisWorker(scope);
  await scope.onmessage({
    data: {
      type: 'analyze',
      activationEpoch: 12,
      runGeneration: 34,
      snapshot: null
    }
  });
  assert.deepEqual(messages, [{
    type: 'error',
    activationEpoch: 12,
    runGeneration: 34,
    code: 'invalid-snapshot',
    message: 'Analyzer snapshot is missing'
  }]);
});

function createFirCrossoverAsset() {
  const config = {
    sampleRate: SAMPLE_RATE,
    taps: 8192,
    phase: 'min',
    bandCount: 4,
    frequencies: [500, 2000, 7000],
    slopes: [-48, -48, -48]
  };
  const design = designFIRCrossover(config);
  const paths = design.channels.flatMap((_, band) => [
    { inputSlot: 0, outputSlot: band * 2, irChannel: band },
    { inputSlot: 1, outputSlot: band * 2 + 1, irChannel: band }
  ]);
  const payload = buildIrAssetPayload({
    channels: design.channels,
    sampleRate: SAMPLE_RATE,
    topology: IR_ASSET_TOPOLOGY.matrix,
    paths
  });
  return {
    design,
    descriptor: {
      payload,
      formatTag: 1,
      headBlock: 128,
      rateDivider: 1,
      pathCount: paths.length,
      inputCount: 2,
      processingChannels: CHANNEL_COUNT,
      footprintBytes: estimateIrKernelCommitFootprint({
        frames: config.taps,
        assetChannels: config.bandCount,
        topology: IR_ASSET_TOPOLOGY.matrix,
        processingChannels: CHANNEL_COUNT,
        headBlock: 128,
        pathCount: paths.length,
        inputCount: 2
      })
    }
  };
}

function prepareRealFirPlugin() {
  const pluginBaseSource = fs.readFileSync(
    new URL('../../plugins/plugin-base.js', import.meta.url),
    'utf8'
  );
  const firSource = fs.readFileSync(
    new URL('../../plugins/basics/fir_crossover.js', import.meta.url),
    'utf8'
  );
  const window = {
    dspParamPackers: DSP_PARAM_PACKERS,
    audioManager: {
      outputChannelCount: CHANNEL_COUNT,
      audioContext: { sampleRate: SAMPLE_RATE }
    }
  };
  const context = vm.createContext({
    window,
    document: {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    console,
    setTimeout,
    clearTimeout,
    performance,
    ArrayBuffer,
    DataView,
    Float32Array,
    Uint8Array,
    Map,
    Set,
    WebAssembly,
    globalThis: null
  });
  context.globalThis = context;
  vm.runInContext(
    `${pluginBaseSource}\n;globalThis.PluginBase = PluginBase;`,
    context,
    { filename: 'plugin-base.js' }
  );
  vm.runInContext(firSource, context, { filename: 'fir_crossover.js' });
  const plugin = new window.FIRCrossoverPlugin();
  const pluginId = 401;
  plugin.id = pluginId;
  plugin.bc = 4;
  plugin.lt = '128';
  plugin.pm = 'min';
  plugin.channel = 'A';
  const audioManager = {
    pipeline: [plugin],
    contextManager: {
      audioContext: {
        sampleRate: SAMPLE_RATE,
        destination: { channelCount: CHANNEL_COUNT }
      }
    }
  };
  const sync = new PipelineWorkletSync({ audioManager });
  const prepared = sync.preparePluginData(plugin);
  assert.equal(prepared.type, 'FIRCrossoverPlugin');
  assert.equal(prepared.executionCapabilities.requiresWasm, true);
  assert.ok(prepared.wasmParams instanceof Float32Array);
  return { plugin, prepared };
}

function prepareRealIrReverbPlugin() {
  const pluginBaseSource = fs.readFileSync(
    new URL('../../plugins/plugin-base.js', import.meta.url),
    'utf8'
  );
  const reverbSource = fs.readFileSync(
    new URL('../../plugins/reverb/ir_reverb.js', import.meta.url),
    'utf8'
  );
  const window = {
    dspParamPackers: DSP_PARAM_PACKERS,
    audioManager: {
      outputChannelCount: 1,
      audioContext: { sampleRate: SAMPLE_RATE }
    }
  };
  const context = vm.createContext({
    window,
    document: {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    console,
    setTimeout,
    clearTimeout,
    performance,
    ArrayBuffer,
    DataView,
    Float32Array,
    Uint8Array,
    Map,
    Set,
    WebAssembly,
    globalThis: null
  });
  context.globalThis = context;
  vm.runInContext(
    `${pluginBaseSource}\n;globalThis.PluginBase = PluginBase;`,
    context,
    { filename: 'plugin-base.js' }
  );
  vm.runInContext(reverbSource, context, { filename: 'ir_reverb.js' });
  const plugin = new window.IRReverbPlugin();
  plugin.id = 402;
  plugin.ir = '1234567890abcdef12345678';
  plugin.cm = 'mono';
  plugin.lt = '128';
  plugin.cr = 'full';
  plugin.dw = 0;
  plugin.dl = -96;
  plugin.pd = 0;
  plugin.dc = false;
  plugin.channel = 'A';

  const audioManager = {
    pipeline: [plugin],
    contextManager: {
      audioContext: {
        sampleRate: SAMPLE_RATE,
        destination: { channelCount: 1 }
      }
    }
  };
  const sync = new PipelineWorkletSync({ audioManager });
  const prepared = sync.preparePluginData(plugin);
  assert.equal(prepared.type, 'IRReverbPlugin');
  assert.notEqual(prepared.executionCapabilities?.requiresWasm, true);
  assert.ok(prepared.wasmParams instanceof Float32Array);
  return { plugin, prepared };
}

function prepareRealMultibandExpanderPlugin() {
  const pluginBaseSource = fs.readFileSync(
    new URL('../../plugins/plugin-base.js', import.meta.url),
    'utf8'
  );
  const pluginSource = fs.readFileSync(
    new URL('../../plugins/dynamics/multiband_expander.js', import.meta.url),
    'utf8'
  );
  const window = {
    dspParamPackers: DSP_PARAM_PACKERS,
    audioManager: {
      outputChannelCount: 1,
      audioContext: { sampleRate: SAMPLE_RATE }
    }
  };
  const context = vm.createContext({
    window,
    document: {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    console,
    setTimeout,
    clearTimeout,
    performance,
    ArrayBuffer,
    DataView,
    Float32Array,
    Float64Array,
    Uint8Array,
    Map,
    Set,
    Math,
    WebAssembly,
    globalThis: null
  });
  context.globalThis = context;
  vm.runInContext(
    `${pluginBaseSource}\n;globalThis.PluginBase = PluginBase;`,
    context,
    { filename: 'plugin-base.js' }
  );
  vm.runInContext(pluginSource, context, { filename: 'multiband_expander.js' });
  const plugin = new window.MultibandExpanderPlugin();
  plugin.id = 403;
  plugin.channel = null;
  const audioManager = {
    pipeline: [plugin],
    contextManager: {
      audioContext: {
        sampleRate: SAMPLE_RATE,
        destination: { channelCount: 1 }
      }
    }
  };
  const sync = new PipelineWorkletSync({ audioManager });
  const prepared = sync.preparePluginData(plugin);
  assert.equal(prepared.type, 'MultibandExpanderPlugin');
  assert.notEqual(prepared.executionCapabilities?.requiresWasm, true);
  assert.ok(prepared.wasmParams instanceof Float32Array);
  return { plugin, prepared };
}

test('IR Reverb Dry switch mutes the fallback dry path without changing Dry Level', () => {
  const { plugin } = prepareRealIrReverbPlugin();
  plugin.setParameters({ de: false, dl: 0 });

  const parameters = plugin.getParameters();
  assert.equal(parameters.de, false);
  assert.equal(parameters.dl, 0);
  const muted = new Float32Array([0.25, -0.5, 1]);
  plugin.process({}, muted, parameters, 0);
  assert.deepEqual(Array.from(muted), [0, 0, 0]);

  plugin.setParameters({ de: true });
  const enabled = new Float32Array([0.25, -0.5, 1]);
  plugin.process({}, enabled, plugin.getParameters(), 0);
  assert.deepEqual(Array.from(enabled), [0.25, -0.5, 1]);
});

test('IR Reverb UI declares Wet Level, Dry, and Dry Level in order', () => {
  const source = fs.readFileSync(
    new URL('../../plugins/reverb/ir_reverb.js', import.meta.url),
    'utf8'
  );
  const wetLevel = source.indexOf("'Wet Level'");
  const drySwitch = source.indexOf("'irReverb.parameter.dryEnabled', 'Dry'");
  const dryLevel = source.indexOf("'Dry Level'");
  assert.ok(wetLevel >= 0);
  assert.ok(drySwitch > wetLevel);
  assert.ok(dryLevel > drySwitch);
});

function createIrReverbAsset() {
  const samples = new Float32Array([0.75, -0.25, 0.125]);
  const payload = buildIrAssetPayload({
    channels: [samples],
    sampleRate: SAMPLE_RATE,
    topology: IR_ASSET_TOPOLOGY.mono
  });
  return {
    samples,
    descriptor: {
      payload,
      formatTag: 1,
      headBlock: 128,
      rateDivider: 1,
      pathCount: 0,
      inputCount: 0,
      processingChannels: 1,
      footprintBytes: estimateIrKernelCommitFootprint({
        frames: samples.length,
        assetChannels: 1,
        topology: IR_ASSET_TOPOLOGY.mono,
        processingChannels: 1,
        headBlock: 128,
        pathCount: 0,
        inputCount: 0
      })
    }
  };
}

function buildFirWorkerRequest(activationEpoch, runGeneration) {
  const { plugin, prepared } = prepareRealFirPlugin();
  const wasmFile = fs.readFileSync(new URL('../../plugins/dsp/effetune-dsp.wasm', import.meta.url));
  const wasmBytes = Uint8Array.from(wasmFile).buffer;
  const { design, descriptor } = createFirCrossoverAsset();
  const outputChannels = [0, 2, 4, 6];
  const gains = [1, -0.5, 0.75, -0.25];
  const speakerResponses = [
    { samples: new Float32Array([1]), sampleRate: SAMPLE_RATE, onsetIndex: 0, refScale: 1 },
    { samples: new Float32Array([0, -0.5]), sampleRate: SAMPLE_RATE, onsetIndex: 1, refScale: 1 },
    { samples: new Float32Array([0, 0, 0.75]), sampleRate: SAMPLE_RATE, onsetIndex: 2, refScale: 1 },
    { samples: new Float32Array([0, -0.25, 0]), sampleRate: SAMPLE_RATE, onsetIndex: 1, refScale: 1 }
  ];
  const request = {
    type: 'analyze',
    activationEpoch,
    runGeneration,
    snapshot: {
      sampleRate: SAMPLE_RATE,
      channelCount: CHANNEL_COUNT,
      inputChannel: 0,
      outputChannels,
      plugins: [prepared],
      masterBypass: false,
      processors: [{
        pluginType: 'FIRCrossoverPlugin',
        processor: plugin.processorString,
        process: plugin.process.toString()
      }],
      dsp: {
        bytes: wasmBytes,
        simd: false,
        enabledTypes: ['FIRCrossoverPlugin']
      },
      requiredWasmPluginIds: [plugin.id],
      assets: [{ pluginId: plugin.id, slot: 0, operationRevision: 1, ...descriptor }],
      measurementSettings: IMPULSE_SETTINGS,
      warmupSamples: 128
    },
    speakerResponses
  };
  return { request, design, gains, descriptor, wasmBytes, prepared, speakerResponses };
}

function runInRealWorker(worker, request, transferList) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Pipeline Analyzer Worker gate timed out'));
    }, 30000);
    const messages = [];
    const onMessage = message => {
      messages.push(message);
      if (message.type === 'error') {
        cleanup();
        reject(new Error(`${message.code}: ${message.message}`));
      } else if (message.type === 'result') {
        cleanup();
        resolve({ message, messages });
      }
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      worker.off('message', onMessage);
      worker.off('error', onError);
    };
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.postMessage(request, transferList);
  });
}

function strongestCoefficientIndices(coefficients, count = 3) {
  return Array.from(coefficients, (value, index) => ({
    index,
    magnitude: value < 0 ? -value : value
  })).sort((left, right) => right.magnitude - left.magnitude)
    .slice(0, count)
    .map(entry => entry.index);
}

function hashFloatArray(values) {
  const view = new DataView(values.buffer, values.byteOffset, values.byteLength);
  let hash = 2166136261;
  for (let offset = 0; offset < values.byteLength; offset += 4) {
    hash ^= view.getUint32(offset, true);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

test('required real Worker gate measures prepared FIR Crossover on outputs 1/3/5/7', async () => {
  const worker = new Worker(
    new URL('../helpers/pipeline-analyzer-node-worker.mjs', import.meta.url),
    { type: 'module' }
  );
  try {
    const first = buildFirWorkerRequest(7, 11);
    const firstTransfers = collectPipelineAnalyzerTransferables(first.request);
    const requiredTransfers = [
      first.wasmBytes,
      first.descriptor.payload,
      first.prepared.wasmParams.buffer,
      ...first.speakerResponses.map(response => response.samples.buffer)
    ];
    if (first.prepared.wasmParamBytes) {
      requiredTransfers.push(first.prepared.wasmParamBytes.buffer);
    }
    for (const buffer of requiredTransfers) {
      assert.ok(firstTransfers.includes(buffer), 'every prepared DSP, asset, and speaker buffer must transfer');
    }
    const firstRunPromise = runInRealWorker(worker, first.request, firstTransfers);
    assert.equal(firstTransfers.every(buffer => buffer.byteLength === 0), true);
    const firstRun = await firstRunPromise;
    const result = firstRun.message.result;

    assert.equal(firstRun.message.activationEpoch, 7);
    assert.equal(firstRun.message.runGeneration, 11);
    assert.ok(firstRun.messages.some(message => message.phase === 'preparing'));
    assert.ok(firstRun.messages.some(message => message.phase === 'measuring'));
    assert.equal(result.reportedLatency, 128);
    assert.equal(result.captureLength, IMPULSE_SETTINGS.sequenceLength);
    assert.equal(result.before.timeOriginSamples, -2);
    assert.equal(result.after.timeOriginSamples, -130);
    assert.equal('routes' in result, false);
    assert.equal('total' in result, false);

    const expectedTotalCoefficients = new Float32Array(first.design.channels[0].length);
    for (let index = 0; index < expectedTotalCoefficients.length; index += 1) {
      for (let band = 0; band < first.design.channels.length; band += 1) {
        expectedTotalCoefficients[index] += first.design.channels[band][index] * first.gains[band];
      }
    }
    for (const index of strongestCoefficientIndices(expectedTotalCoefficients, 5)) {
      const actual = result.after.impulse[result.reportedLatency + 2 + index];
      assert.ok(
        Math.abs(actual - expectedTotalCoefficients[index]) < 5e-5,
        `signed After sample ${index}`
      );
    }

    const second = buildFirWorkerRequest(8, 12);
    const secondRun = await runInRealWorker(
      worker,
      second.request,
      collectPipelineAnalyzerTransferables(second.request)
    );
    assert.equal(secondRun.message.activationEpoch, 8);
    assert.equal(secondRun.message.runGeneration, 12);
    assert.equal(
      hashFloatArray(secondRun.message.result.before.impulse),
      hashFloatArray(result.before.impulse)
    );
    assert.equal(
      hashFloatArray(secondRun.message.result.after.impulse),
      hashFloatArray(result.after.impulse)
    );
  } finally {
    await worker.terminate();
  }
});

test('real Multiband Expander MLS response preserves optional JS/WASM parity after stabilization', async () => {
  const { plugin, prepared } = prepareRealMultibandExpanderPlugin();
  const wasmFile = fs.readFileSync(new URL('../../plugins/dsp/effetune-dsp.wasm', import.meta.url));
  const wasmBytes = Uint8Array.from(wasmFile).buffer;
  const settings = {
    signalType: 'mls',
    levelDb: -12,
    sequenceLength: 32767,
    stabilizationPeriods: 1,
    averagingPeriods: 2
  };
  const commonSnapshot = {
    sampleRate: SAMPLE_RATE,
    channelCount: 1,
    inputChannel: 0,
    outputChannels: [0],
    plugins: [prepared],
    masterBypass: false,
    processors: [{
      pluginType: prepared.type,
      processor: plugin.processorString,
      process: plugin.process.toString()
    }],
    assets: [],
    requiredWasmPluginIds: [],
    assetSupportSamples: 1,
    measurementSettings: settings,
    warmupSamples: 0
  };
  const request = snapshot => ({
    type: 'analyze',
    activationEpoch: 21,
    runGeneration: 22,
    snapshot,
    speakerResponses: [null]
  });
  const jsResult = await runAnalysisRequest(request({
    ...commonSnapshot,
    dsp: null,
    preferredWasmPluginIds: []
  }));
  const wasmResult = await runAnalysisRequest(request({
    ...commonSnapshot,
    dsp: {
      bytes: wasmBytes,
      simd: false,
      enabledTypes: ['MultibandExpanderPlugin']
    },
    preferredWasmPluginIds: [prepared.id]
  }));

  assert.equal(wasmResult.warnings.some(entry => entry.code === 'optional-wasm-fallback'), false);
  assert.equal(jsResult.reportedLatency, wasmResult.reportedLatency);
  const jsMagnitude = jsResult.after.spectrum.magnitudeDb;
  const wasmMagnitude = wasmResult.after.spectrum.magnitudeDb;
  let maximumDifference = 0;
  for (let index = 0; index < jsMagnitude.length; index += 8) {
    if (!Number.isFinite(jsMagnitude[index]) || !Number.isFinite(wasmMagnitude[index])) continue;
    maximumDifference = Math.max(
      maximumDifference,
      Math.abs(jsMagnitude[index] - wasmMagnitude[index])
    );
  }
  assert.ok(maximumDifference < 0.15, `maximum JS/WASM difference was ${maximumDifference} dB`);
});

test('offline-required IR Reverb snapshot activates its real WASM asset in a Worker', async () => {
  const worker = new Worker(
    new URL('../helpers/pipeline-analyzer-node-worker.mjs', import.meta.url),
    { type: 'module' }
  );
  try {
    const { plugin, prepared } = prepareRealIrReverbPlugin();
    const { descriptor } = createIrReverbAsset();
    const wasmFile = fs.readFileSync(new URL('../../plugins/dsp/effetune-dsp.wasm', import.meta.url));
    const sourceBytes = Uint8Array.from(wasmFile).buffer;
    const audioManager = {
      currentPipeline: 'A',
      masterBypass: false,
      contextManager: {
        audioContext: {
          sampleRate: SAMPLE_RATE,
          destination: { channelCount: 1 }
        }
      },
      getCurrentPipeline: () => [plugin],
      getEnabledDspTypes: () => ['IRReverbPlugin'],
      dspModuleInfo: {
        bytes: sourceBytes,
        simd: false
      },
      async waitForEffectiveActiveWasmAssets(entry, slots) {
        assert.equal(entry, plugin);
        assert.deepEqual(slots, [0]);
        return {
          ready: true,
          assets: new Map([[0, descriptor]]),
          revisions: new Map([[0, { operationRevision: 1 }]]),
          rejectedCandidates: new Map()
        };
      }
    };
    const built = await buildPipelineAnalyzerSnapshot({
      audioManager,
      workletSync: { preparePluginData: () => prepared },
      configuration: {
        inputChannel: 0,
        slots: [{ enabled: true, channel: 0, measurementId: null, pointId: null }],
        measurementSettings: IMPULSE_SETTINGS
      },
      resolveRequirements: getPipelineAnalysisRequirements,
      isCurrent: () => true
    });

    assert.notEqual(prepared.executionCapabilities?.requiresWasm, true);
    assert.notEqual(built.snapshot.plugins[0], prepared);
    assert.equal(Object.isFrozen(built.snapshot.plugins[0]), true);
    assert.equal(Object.isFrozen(built.snapshot.plugins[0].executionCapabilities), true);
    assert.equal(built.snapshot.plugins[0].executionCapabilities.requiresWasm, true);
    assert.deepEqual(built.snapshot.requiredWasmPluginIds, [plugin.id]);
    assert.deepEqual(built.snapshot.dsp.enabledTypes, ['IRReverbPlugin']);
    assert.deepEqual(built.snapshot.assets.map(asset => [asset.pluginId, asset.slot]), [[plugin.id, 0]]);

    const request = {
      type: 'analyze',
      activationEpoch: 19,
      runGeneration: 23,
      snapshot: built.snapshot,
      speakerResponses: built.speakerResponses
    };
    const run = await runInRealWorker(
      worker,
      request,
      collectPipelineAnalyzerTransferables(request)
    );
    const result = run.message.result;
    const impulse = result.after.impulse;
    assert.equal(run.message.activationEpoch, 19);
    assert.equal(run.message.runGeneration, 23);
    assert.equal(result.reportedLatency, 128);
    assert.ok(impulse.some(value => Math.abs(value) > 1e-5));
    assert.equal(impulse[0], 0, 'the muted dry path must not masquerade as an active IR asset');
  } finally {
    await worker.terminate();
  }
});

test('non-cloneable compiled DSP module uses the bytes fallback through a real Worker', async () => {
  const worker = new Worker(
    new URL('../helpers/pipeline-analyzer-node-worker.mjs', import.meta.url),
    { type: 'module' }
  );
  try {
    const { plugin, prepared } = prepareRealFirPlugin();
    const wasmFile = fs.readFileSync(new URL('../../plugins/dsp/effetune-dsp.wasm', import.meta.url));
    const sourceBytes = Uint8Array.from(wasmFile).buffer;
    const module = await WebAssembly.compile(sourceBytes.slice(0));
    const { descriptor } = createFirCrossoverAsset();
    const audioManager = {
      currentPipeline: 'A',
      masterBypass: false,
      contextManager: {
        audioContext: {
          sampleRate: SAMPLE_RATE,
          destination: { channelCount: CHANNEL_COUNT }
        }
      },
      getCurrentPipeline: () => [plugin],
      getEnabledDspTypes: () => ['FIRCrossoverPlugin'],
      dspModuleInfo: {
        module,
        moduleCloneable: false,
        bytes: sourceBytes,
        simd: false
      },
      async waitForEffectiveActiveWasmAssets() {
        return {
          ready: true,
          assets: new Map([[0, descriptor]]),
          revisions: new Map([[0, { operationRevision: 1 }]]),
          rejectedCandidates: new Map()
        };
      }
    };
    const built = await buildPipelineAnalyzerSnapshot({
      audioManager,
      workletSync: { preparePluginData: () => prepared },
      configuration: {
        inputChannel: 0,
        slots: [{ enabled: true, channel: 0, measurementId: null, pointId: null }]
      },
      resolveRequirements: () => ({
        requiresWasm: true,
        requiredAssetSlots: [0],
        warmupSamples: 128
      }),
      isCurrent: () => true
    });
    assert.equal(built.snapshot.dsp.module, null);
    assert.ok(built.snapshot.dsp.bytes instanceof ArrayBuffer);
    assert.notEqual(built.snapshot.dsp.bytes, sourceBytes);

    const request = {
      type: 'analyze',
      activationEpoch: 13,
      runGeneration: 17,
      snapshot: built.snapshot,
      speakerResponses: built.speakerResponses
    };
    const transferList = collectPipelineAnalyzerTransferables(request);
    const transferredBytes = built.snapshot.dsp.bytes;
    assert.ok(transferList.includes(transferredBytes));
    const resultPromise = runInRealWorker(worker, request, transferList);
    assert.equal(transferredBytes.byteLength, 0);
    const run = await resultPromise;
    assert.equal(run.message.activationEpoch, 13);
    assert.equal(run.message.runGeneration, 17);
    assert.equal('routes' in run.message.result, false);
    assert.ok(run.message.result.after.impulse.some(value => value !== 0));
  } finally {
    await worker.terminate();
  }
});
