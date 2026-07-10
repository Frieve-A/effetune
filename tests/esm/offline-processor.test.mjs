import assert from 'node:assert/strict';
import test from 'node:test';

import { OfflineProcessor } from '../../js/audio/offline-processor.js';
import { decodeDspPipelineDescriptor } from '../../js/audio/dsp-pipeline-descriptor.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class SectionPlugin {
  constructor(enabled = true) {
    this.id = `section-${enabled}`;
    this.enabled = enabled;
  }
}

function createConsole(calls) {
  return {
    ...console,
    warn(...args) {
      calls.push(['consoleWarn', ...args]);
    },
    error(...args) {
      calls.push(['consoleError', ...args]);
    }
  };
}

async function withOfflineGlobals(options, callback) {
  const calls = [];
  const performanceValues = [...(options.performanceValues ?? [20, 40, 60, 80, 100])];

  return withGlobals({
    window: options.window,
    console: createConsole(calls),
    performance: {
      now() {
        const value = performanceValues.length > 0 ? performanceValues.shift() : 1000;
        calls.push(['performanceNow', value]);
        return value;
      }
    },
    requestAnimationFrame(callbackFn) {
      calls.push(['requestAnimationFrame']);
      callbackFn();
      return calls.length;
    },
    setTimeout(callbackFn, delay) {
      calls.push(['setTimeout', delay]);
      callbackFn();
      return calls.length;
    }
  }, async () => callback({ calls }));
}

function createAudioBuffer(channelValues, sampleRate = 48000) {
  const channels = channelValues.map(values => Float32Array.from(values));
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    sampleRate,
    getChannelData(index) {
      return channels[index];
    }
  };
}

function createGeneratedAudioBuffer(numberOfChannels, length, sampleRate = 48000) {
  const channels = Array.from({ length: numberOfChannels }, (_, channelIndex) =>
    Array.from({ length }, (_, sampleIndex) => channelIndex + sampleIndex / 100)
  );
  return createAudioBuffer(channels, sampleRate);
}

function createMutableAudioBuffer(numberOfChannels, length, sampleRate) {
  return createAudioBuffer(
    Array.from({ length: numberOfChannels }, () => Array.from({ length }, () => 0)),
    sampleRate
  );
}

function createOfflineContext(calls, options = {}) {
  const context = {
    destination: { id: 'destination' },
    createdBuffers: [],
    sourceNode: null,
    createBuffer(numberOfChannels, length, sampleRate) {
      calls.push(['createBuffer', numberOfChannels, length, sampleRate]);
      const buffer = createMutableAudioBuffer(numberOfChannels, length, sampleRate);
      context.createdBuffers.push(buffer);
      return buffer;
    },
    createBufferSource() {
      calls.push(['createBufferSource']);
      context.sourceNode = {
        buffer: null,
        connect(destination) {
          calls.push(['sourceConnect', destination]);
        },
        start() {
          calls.push(['sourceStart']);
          if (options.startError) throw options.startError;
        },
        disconnect() {
          calls.push(['sourceDisconnect']);
          if (options.sourceDisconnectError) throw options.sourceDisconnectError;
        }
      };
      return context.sourceNode;
    },
    async startRendering() {
      calls.push(['startRendering']);
      if (options.renderError) throw options.renderError;
      if ('renderedBuffer' in options) return options.renderedBuffer;
      return context.sourceNode?.buffer;
    }
  };
  return context;
}

function createHarness(calls, options = {}) {
  const offlineContexts = [];
  const audioBuffer = options.audioBuffer ?? createGeneratedAudioBuffer(2, 4);
  const encoded = [];
  const contextManager = {
    audioContext: {
      async decodeAudioData(arrayBuffer) {
        calls.push(['decodeAudioData', arrayBuffer.byteLength]);
        if (options.decodeError) throw options.decodeError;
        return audioBuffer;
      }
    },
    createOfflineContext(numberOfChannels, length, sampleRate) {
      calls.push(['createOfflineContext', numberOfChannels, length, sampleRate]);
      if (options.createOfflineContextError) throw options.createOfflineContextError;
      const context = createOfflineContext(calls, options.offlineContextOptions);
      offlineContexts.push(context);
      return context;
    }
  };
  const audioEncoder = {
    encodeWAV(buffer) {
      calls.push(['encodeWAV', buffer.length, buffer.numberOfChannels]);
      const result = { encodedBuffer: buffer, index: encoded.length };
      encoded.push(result);
      return result;
    }
  };
  const file = {
    async arrayBuffer() {
      calls.push(['arrayBuffer']);
      if (options.arrayBufferError) throw options.arrayBufferError;
      assert.equal(processorRef?.isProcessing(), true);
      return new ArrayBuffer(options.arrayBufferLength ?? 8);
    }
  };

  let processorRef = null;
  const processor = new OfflineProcessor(
    contextManager,
    audioEncoder,
    options.offlineProcessorOptions
  );
  processorRef = processor;
  return { processor, file, encoded, offlineContexts };
}

function createPlugin(calls, options = {}) {
  class OfflineTestPlugin {}
  const plugin = new OfflineTestPlugin();
  plugin.id = options.id ?? 'plugin';
  plugin.enabled = options.enabled ?? true;
  plugin.inputBus = options.inputBus;
  plugin.outputBus = options.outputBus;
  plugin.channel = options.channel;

  if (!options.noGetParameters) {
    let callIndex = 0;
    plugin.getParameters = ({ sampleRate }) => {
      const parameters = typeof options.parameters === 'function'
        ? options.parameters(callIndex, sampleRate)
        : (options.parameters ?? {});
      calls.push(['getParameters', plugin.id, callIndex, sampleRate, parameters]);
      callIndex++;
      return parameters;
    };
  }

  plugin.executeProcessor = (context, buffer, parameters, currentTime) => {
    calls.push([
      'executeProcessor',
      plugin.id,
      buffer.length,
      parameters.channelCount,
      parameters.blockSize,
      parameters.initialized,
      currentTime
    ]);
    if (options.throwOnExecute) throw options.throwOnExecute;
    if (options.execute) {
      return options.execute(context, buffer, parameters, currentTime);
    }
    return buffer;
  };

  return plugin;
}

function createFakeDspBinding(calls, options = {}) {
  const floatCapacity = 8 * 128;
  const combined = new Float32Array(floatCapacity);
  const buses = new Map([
    [0, combined],
    [1, new Float32Array(floatCapacity)],
    [2, new Float32Array(floatCapacity)],
    [3, new Float32Array(floatCapacity)],
    [4, new Float32Array(floatCapacity)]
  ]);
  const scratch = {
    allChannels: new Float32Array(floatCapacity),
    mixing: new Float32Array(floatCapacity),
    stereo: new Float32Array(2 * 128),
    mono: new Float32Array(128)
  };
  const pointerViews = new Map();
  const parameters = new Map();
  const instances = new Map();
  let descriptorNodes = [];
  let nextInstanceId = 1;
  let nextPointer = 4096;
  let parameterCallCount = 0;

  const binding = {
    live: true,
    createEngine() {
      calls.push(['dspCreateEngine']);
      return options.createEngineResult ?? 1;
    },
    prepare(sampleRate, channels, frames, ringBytes) {
      calls.push(['dspPrepare', sampleRate, channels, frames, ringBytes]);
      return options.prepareStatus ?? 0;
    },
    getArenaViews() {
      calls.push(['dspGetArenaViews']);
      if (typeof options.getArenaViews === 'function') {
        return options.getArenaViews({ combined, buses, scratch });
      }
      return { combined, buses, scratch };
    },
    createInstance(typeName) {
      calls.push(['dspCreateInstance', typeName]);
      const createResult = typeof options.createInstanceResult === 'function'
        ? options.createInstanceResult(typeName)
        : options.createInstanceResult;
      if (createResult === 0) return 0;
      const instanceId = nextInstanceId++;
      instances.set(instanceId, typeName);
      return instanceId;
    },
    destroyInstance(instanceId) {
      calls.push(['dspDestroyInstance', instanceId]);
      instances.delete(instanceId);
    },
    instanceSetParams(instanceId, packed, hash) {
      parameterCallCount++;
      calls.push(['dspSetParams', instanceId, [...packed], hash]);
      const status = typeof options.parameterStatus === 'function'
        ? options.parameterStatus(parameterCallCount, instanceId, packed)
        : (options.parameterStatus ?? 0);
      if (status === 0) parameters.set(instanceId, new Float32Array(packed));
      return status;
    },
    instanceSetParamBytes(instanceId, packed, hash) {
      calls.push(['dspSetParamBytes', instanceId, [...packed], hash]);
      return options.paramBytesStatus ?? 0;
    },
    pointerForArenaView(view) {
      const pointer = nextPointer;
      nextPointer += view.byteLength + 16;
      pointerViews.set(pointer, view);
      calls.push(['dspPointerForArenaView', view.length, pointer]);
      return options.pointerUnavailable ? null : pointer;
    },
    instanceProcess(instanceId, pointer, channels, frames, time) {
      calls.push(['dspInstanceProcess', instanceId, channels, frames, time]);
      const view = pointerViews.get(pointer);
      const status = typeof options.instanceProcessStatus === 'function'
        ? options.instanceProcessStatus(view, instanceId)
        : (options.instanceProcessStatus ?? 0);
      if (status !== 0) return status;
      const gain = parameters.get(instanceId)?.[0] ?? 1;
      for (let index = 0; index < channels * frames; index++) view[index] *= gain;
      return 0;
    },
    pipelineConfigure(descriptor) {
      calls.push(['dspPipelineConfigure', [...descriptor]]);
      const status = options.pipelineConfigureStatus ?? 0;
      if (status === 0) descriptorNodes = decodeDspPipelineDescriptor(descriptor).nodes;
      return status;
    },
    pipelineProcess(channels, frames, time, masterBypass) {
      calls.push(['dspPipelineProcess', channels, frames, time, masterBypass]);
      const status = typeof options.pipelineProcessStatus === 'function'
        ? options.pipelineProcessStatus(combined, channels, frames)
        : (options.pipelineProcessStatus ?? 0);
      if (status !== 0 || masterBypass) return status;

      const totalSize = channels * frames;
      for (let bus = 1; bus <= 4; bus++) buses.get(bus).fill(0, 0, totalSize);
      for (const node of descriptorNodes) {
        if (!node.enabled || !node.sectionGate) continue;
        const input = buses.get(node.inputBus);
        const output = buses.get(node.outputBus);
        const gain = parameters.get(node.instanceId)?.[0] ?? 1;
        let firstChannel = 0;
        let routedChannels = 1;
        if (node.channelSpec === -2) {
          routedChannels = channels;
        } else if (node.channelSpec === -1) {
          routedChannels = 2;
        } else if (node.channelSpec >= 16) {
          firstChannel = (node.channelSpec - 16) * 2;
          routedChannels = 2;
        } else {
          firstChannel = node.channelSpec;
        }
        if (firstChannel + routedChannels > channels) continue;

        for (let channel = firstChannel; channel < firstChannel + routedChannels; channel++) {
          const channelOffset = channel * frames;
          for (let frame = 0; frame < frames; frame++) {
            const index = channelOffset + frame;
            const value = input[index] * gain;
            if (node.inputBus === node.outputBus) output[index] = value;
            else output[index] += value;
          }
        }
      }
      return 0;
    },
    close() {
      calls.push(['dspClose']);
    }
  };
  return binding;
}

function createFakeDspRuntime(calls, options = {}) {
  const hash = options.hash ?? 0x12345678;
  const packerHash = options.packerHash ?? hash;
  const moduleInfo = {
    module: { name: 'cached-test-module' },
    meta: {
      abiVersion: 1,
      kernels: [{
        name: 'OfflineTestPlugin',
        hash,
        byteCapacity: options.byteCapacity ?? 0
      }]
    },
    paramPackers: new Map([[
      'OfflineTestPlugin',
      {
        hash: packerHash,
        pack(parameters) {
          calls.push(['dspPackParams', parameters.gain ?? 1]);
          return Float32Array.of(parameters.gain ?? 1);
        },
        ...(options.structuredBytes ? {
          byteCapacity: options.byteCapacity ?? 3076,
          packBytes(parameters) {
            const packed = typeof options.structuredBytes === 'function'
              ? options.structuredBytes(parameters)
              : options.structuredBytes;
            calls.push(['dspPackParamBytes', [...packed]]);
            return Uint8Array.from(packed);
          }
        } : {})
      }
    ]])
  };
  const bindings = [];
  const dependencies = {
    async getModuleInfo() {
      calls.push(['dspGetModuleInfo']);
      if (options.moduleInfoError) throw options.moduleInfoError;
      return options.moduleInfo === null ? null : moduleInfo;
    },
    async loadDspModule(loadOptions) {
      calls.push(['dspLoadModule', loadOptions]);
      return options.loadResult === undefined ? moduleInfo : options.loadResult;
    },
    getDspRolloutConfig(rolloutOptions) {
      calls.push(['dspRollout', Boolean(rolloutOptions.meta)]);
      if (options.forceOff) return { forceOff: true, debug: false, enabledTypes: [] };
      return {
        forceOff: false,
        debug: Boolean(options.debug),
        enabledTypes: rolloutOptions.meta ? ['OfflineTestPlugin'] : []
      };
    },
    async instantiateDsp(modulePayload) {
      calls.push(['dspInstantiate', modulePayload]);
      if (options.instantiateError) throw options.instantiateError;
      const binding = createFakeDspBinding(calls, options.bindingOptions);
      bindings.push(binding);
      return binding;
    },
    warning(message) {
      calls.push(['dspWarning', message]);
    }
  };
  return { dependencies, bindings, moduleInfo };
}

function createGainPlugin(calls, options = {}) {
  return createPlugin(calls, {
    ...options,
    parameters: {
      ...(options.parameters || {}),
      gain: options.gain ?? 1
    },
    execute(context, buffer, parameters) {
      return Float32Array.from(buffer, value => value * parameters.gain);
    }
  });
}

test('helper methods resolve routing, bus, parameter, cancellation, and section logic', async () => {
  await withOfflineGlobals({ window: undefined }, async ({ calls }) => {
    const { processor } = createHarness(calls);

    assert.equal(processor.getOfflineOutputChannelCount(1), 2);
    assert.equal(processor.getOfflineOutputChannelCount(4), 4);

    await withGlobals({ window: { audioPreferences: { outputChannels: '6' } } }, async () => {
      assert.equal(processor.getOfflineOutputChannelCount(2), 6);
    });
    await withGlobals({ window: { electronIntegration: { audioPreferences: { outputChannels: 'bad' } } } }, async () => {
      assert.equal(processor.getOfflineOutputChannelCount(2), 2);
    });
    await withGlobals({ window: { audioPreferences: { outputChannels: 1 } } }, async () => {
      assert.equal(processor.getOfflineOutputChannelCount(4), 4);
    });

    const parameterPlugin = {
      inputBus: 3,
      getParameters(options) {
        calls.push(['directGetParameters', options]);
        return { outputBus: 4 };
      }
    };
    assert.deepEqual(processor.getPluginParameters(parameterPlugin, 96000), { outputBus: 4 });
    assert.deepEqual(processor.getPluginParameters({}), {});
    assert.equal(processor.getOfflineBusIndex({ inputBus: 1 }, parameterPlugin, 'inputBus'), 1);
    assert.equal(processor.getOfflineBusIndex({}, parameterPlugin, 'inputBus'), 3);
    assert.equal(processor.getOfflineBusIndex({}, {}, 'inputBus'), 0);

    assert.deepEqual(processor.getOfflineChannelRouting('A', 4), {
      processMode: 'all',
      numProcessingChannels: 4,
      pairStartChannel: -1,
      singleChannelIndex: -1,
      invalid: false
    });
    assert.deepEqual(processor.getOfflineChannelRouting('L', 2).singleChannelIndex, 0);
    assert.deepEqual(processor.getOfflineChannelRouting('R', 2).singleChannelIndex, 1);
    assert.deepEqual(processor.getOfflineChannelRouting(null, 2).pairStartChannel, 0);
    assert.deepEqual(processor.getOfflineChannelRouting(undefined, 2).pairStartChannel, 0);
    assert.deepEqual(processor.getOfflineChannelRouting('34', 4).pairStartChannel, 2);
    assert.deepEqual(processor.getOfflineChannelRouting('56', 6).pairStartChannel, 4);
    assert.deepEqual(processor.getOfflineChannelRouting('78', 8).pairStartChannel, 6);
    assert.deepEqual(processor.getOfflineChannelRouting('3', 4).singleChannelIndex, 2);

    for (const [channel, count] of [['A', 0], ['L', 0], ['R', 1], [null, 1], ['34', 2], ['56', 4], ['78', 6]]) {
      assert.equal(processor.getOfflineChannelRouting(channel, count).processMode, 'skip');
    }
    assert.equal(processor.getOfflineChannelRouting('bad', 2).invalid, true);
    assert.equal(processor.getOfflineChannelRouting('0', 2).invalid, true);
    assert.equal(processor.getOfflineChannelRouting('9', 2).invalid, true);

    processor.cancelProcessing();
    assert.equal(processor.isCancelled, true);
    assert.equal(processor.isProcessing(), false);

    const enabledSection = new SectionPlugin(true);
    const disabledSection = new SectionPlugin(false);
    const before = createPlugin(calls, { id: 'before' });
    const insideDisabled = createPlugin(calls, { id: 'inside-disabled' });
    const insideEnabled = createPlugin(calls, { id: 'inside-enabled' });
    const disabledPlain = createPlugin(calls, { id: 'disabled', enabled: false });
    assert.deepEqual(
      processor.getSectionAwareActivePlugins([
        before,
        disabledPlain,
        disabledSection,
        insideDisabled,
        enabledSection,
        insideEnabled
      ]),
      [before, enabledSection, insideEnabled]
    );
  });
});

test('applyOfflineRoutingResult applies additive and in-place routing modes', async () => {
  await withOfflineGlobals({ window: {} }, async ({ calls }) => {
    const { processor } = createHarness(calls);
    const blockSize = 2;
    const totalSize = 8;

    let output = new Float32Array(totalSize);
    processor.applyOfflineRoutingResult(
      output,
      Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
      { processMode: 'all' },
      0,
      1,
      blockSize,
      totalSize
    );
    assert.deepEqual([...output], [1, 2, 3, 4, 5, 6, 7, 8]);

    output = new Float32Array(totalSize);
    processor.applyOfflineRoutingResult(
      output,
      Float32Array.from([10, 11, 12, 13]),
      { processMode: 'pair', pairStartChannel: 1 },
      0,
      1,
      blockSize,
      totalSize
    );
    assert.deepEqual([...output], [0, 0, 10, 11, 12, 13, 0, 0]);

    output = new Float32Array(totalSize);
    processor.applyOfflineRoutingResult(
      output,
      Float32Array.from([20, 21]),
      { processMode: 'single', singleChannelIndex: 3 },
      0,
      1,
      blockSize,
      totalSize
    );
    assert.deepEqual([...output], [0, 0, 0, 0, 0, 0, 20, 21]);

    output = Float32Array.from([1, 1, 1, 1]);
    processor.applyOfflineRoutingResult(output, output, { processMode: 'all' }, 0, 0, 2, 4);
    assert.deepEqual([...output], [1, 1, 1, 1]);

    output = new Float32Array(4);
    processor.applyOfflineRoutingResult(output, Float32Array.from([2, 3, 4, 5]), { processMode: 'all' }, 0, 0, 2, 4);
    assert.deepEqual([...output], [2, 3, 4, 5]);

    output = new Float32Array(6);
    processor.applyOfflineRoutingResult(output, Float32Array.from([6, 7, 8, 9]), { processMode: 'pair', pairStartChannel: 1 }, 0, 0, 2, 6);
    assert.deepEqual([...output], [0, 0, 6, 7, 8, 9]);

    output = new Float32Array(6);
    processor.applyOfflineRoutingResult(output, Float32Array.from([30, 31]), { processMode: 'single', singleChannelIndex: 2 }, 0, 0, 2, 6);
    assert.deepEqual([...output], [0, 0, 0, 0, 30, 31]);
  });
});

test('processAudioFile encodes directly when no enabled processing plugins exist', async () => {
  await withOfflineGlobals({ window: {} }, async ({ calls }) => {
    const audioBuffer = createGeneratedAudioBuffer(2, 4);
    const { processor, file, encoded } = createHarness(calls, { audioBuffer });

    const result = await processor.processAudioFile(file, [
      new SectionPlugin(true),
      createPlugin(calls, { id: 'disabled', enabled: false })
    ]);

    assert.equal(result, encoded[0]);
    assert.equal(result.encodedBuffer, audioBuffer);
    assert.equal(processor.isProcessing(), false);
    assert.equal(calls.some(call => call[0] === 'createOfflineContext'), false);
  });
});

test('processAudioFile writes expected samples for in-place and side-bus routing', async () => {
  await withOfflineGlobals({
    window: { audioPreferences: { outputChannels: 4 } }
  }, async ({ calls }) => {
    const audioBuffer = createAudioBuffer([
      [1, 2, 3],
      [10, 20, 30],
      [100, 200, 300],
      [1000, 2000, 3000]
    ]);
    const { processor, file } = createHarness(calls, { audioBuffer });

    const doubleLeft = createPlugin(calls, {
      id: 'double-left',
      parameters: { channel: 'L' },
      execute(context, buffer) {
        return Float32Array.from(buffer, value => value * 2);
      }
    });
    const copyPairToSideBus = createPlugin(calls, {
      id: 'copy-pair-to-side-bus',
      parameters: { inputBus: 0, outputBus: 1, channel: '34' },
      execute(context, buffer) {
        return Float32Array.from(buffer, value => value + 5);
      }
    });
    const mergePairBackToMain = createPlugin(calls, {
      id: 'merge-pair-back-to-main',
      parameters: { inputBus: 1, outputBus: 0, channel: '34' }
    });

    const result = await processor.processAudioFile(file, [
      doubleLeft,
      copyPairToSideBus,
      mergePairBackToMain
    ]);
    const rendered = result.encodedBuffer;

    assert.deepEqual([...rendered.getChannelData(0)], [2, 4, 6]);
    assert.deepEqual([...rendered.getChannelData(1)], [10, 20, 30]);
    assert.deepEqual([...rendered.getChannelData(2)], [205, 405, 605]);
    assert.deepEqual([...rendered.getChannelData(3)], [2005, 4005, 6005]);
  });
});

test('processAudioFile renders enabled plugins through buses, sections, progress, and cleanup', async () => {
  await withOfflineGlobals({
    window: { audioPreferences: { outputChannels: 4 } },
    performanceValues: [20, 40]
  }, async ({ calls }) => {
    const audioBuffer = createGeneratedAudioBuffer(2, 130);
    const { processor, file, offlineContexts } = createHarness(calls, { audioBuffer });
    processor.offlineWorkletNode = {
      disconnect() {
        calls.push(['offlineWorkletDisconnect']);
      }
    };
    const progress = [];

    const allPlugin = createPlugin(calls, {
      id: 'all',
      parameters: { inputBus: 0, outputBus: 1, channel: 'A' },
      execute(context, buffer, parameters) {
        const result = new Float32Array(buffer.length);
        result.set(buffer);
        result[0] += parameters.initialized ? 2 : 1;
        return result;
      }
    });
    const pairPlugin = createPlugin(calls, {
      id: 'pair',
      parameters: { inputBus: 1, outputBus: 0, channel: '34' }
    });
    const singlePlugin = createPlugin(calls, {
      id: 'single',
      parameters: { inputBus: 0, outputBus: 0, channel: 'L' },
      execute() {
        return undefined;
      }
    });
    const badChannelPlugin = createPlugin(calls, {
      id: 'bad-channel',
      parameters: { channel: 'bad' }
    });
    const unsupportedPairPlugin = createPlugin(calls, {
      id: 'unsupported-pair',
      parameters: { channel: '78' }
    });
    const skippedInDisabledSection = createPlugin(calls, {
      id: 'skipped-section',
      parameters: { inputBus: 5, outputBus: 6 }
    });

    const result = await processor.processAudioFile(file, [
      createPlugin(calls, { id: 'disabled', enabled: false }),
      new SectionPlugin(false),
      skippedInDisabledSection,
      new SectionPlugin(true),
      allPlugin,
      pairPlugin,
      singlePlugin,
      badChannelPlugin,
      unsupportedPairPlugin
    ], value => progress.push(value));

    assert.equal(result.encodedBuffer, offlineContexts[0].sourceNode.buffer);
    assert.equal(processor.offlineContext, null);
    assert.equal(processor.offlineWorkletNode, null);
    assert.equal(processor.isProcessing(), false);
    assert.ok(progress.some(value => value > 0 && value < 100));
    assert.equal(progress.at(-1), 100);
    assert.ok(progress.every(value => Number.isFinite(value) && value >= 0 && value <= 100));
    assert.ok(calls.some(call => call[0] === 'consoleWarn' && String(call[1]).includes('bad')));
    assert.ok(calls.some(call => call[0] === 'offlineWorkletDisconnect'));
    assert.ok(calls.some(call => call[0] === 'executeProcessor' && call[1] === 'all' && call[5] === false));
    assert.ok(calls.some(call => call[0] === 'executeProcessor' && call[1] === 'all' && call[5] === true));
    assert.equal(calls.some(call => call[0] === 'executeProcessor' && call[1] === 'skipped-section'), false);
  });
});

test('processAudioFile keeps rendering after dynamic bus and plugin processing failures', async () => {
  await withOfflineGlobals({
    window: {},
    performanceValues: [20]
  }, async ({ calls }) => {
    const changingInputPlugin = createPlugin(calls, {
      id: 'missing-input',
      parameters(index) {
        return index === 0 ? { inputBus: 3, outputBus: 0 } : { inputBus: 4, outputBus: 0 };
      }
    });
    const changingOutputPlugin = createPlugin(calls, {
      id: 'missing-output',
      parameters(index) {
        return index === 0 ? { inputBus: 0, outputBus: 5, channel: 'R' } : { inputBus: 0, outputBus: 6, channel: 'R' };
      },
      execute(context, buffer) {
        return new Float32Array(buffer);
      }
    });
    const nullOutputPlugin = createPlugin(calls, {
      id: 'null-output',
      parameters: { outputBus: 0 },
      execute() {
        return null;
      }
    });
    const wrongLengthPlugin = createPlugin(calls, {
      id: 'wrong-length',
      parameters: { outputBus: 0 },
      execute() {
        return new Float32Array(1);
      }
    });
    const throwingMainPlugin = createPlugin(calls, {
      id: 'throw-main',
      parameters: { outputBus: 0 },
      throwOnExecute: new Error('main failed')
    });
    const throwingSidePlugin = createPlugin(calls, {
      id: 'throw-side',
      parameters: { outputBus: 1 },
      throwOnExecute: new Error('side failed')
    });
    const { processor, file } = createHarness(calls, {
      audioBuffer: createGeneratedAudioBuffer(4, 4)
    });
    const progress = [];

    const result = await processor.processAudioFile(file, [
      changingInputPlugin,
      changingOutputPlugin,
      nullOutputPlugin,
      wrongLengthPlugin,
      throwingMainPlugin,
      throwingSidePlugin
    ], value => progress.push(value));

    assert.equal(result.index, 0);
    assert.deepEqual(progress, [100, 100]);
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('input bus 4')));
    assert.ok(calls.filter(call => call[0] === 'consoleError' && call[1] === 'Plugin processing error:').length >= 3);
  });
});

test('processAudioFile cleans up after file, context, and render failures', async () => {
  const failureCases = [
    {
      name: 'array buffer read',
      options: { arrayBufferError: new Error('read failed') },
      pattern: /File processing error: read failed/
    },
    {
      name: 'decode',
      options: { decodeError: new Error('decode failed') },
      pattern: /File processing error: decode failed/
    },
    {
      name: 'offline context',
      options: { createOfflineContextError: new Error('context failed') },
      pattern: /File processing error: context failed/
    },
    {
      name: 'render empty',
      options: { offlineContextOptions: { renderedBuffer: createGeneratedAudioBuffer(2, 0) } },
      pattern: /File processing error: Processing failed: Rendering produced empty buffer/
    },
    {
      name: 'render null',
      options: { offlineContextOptions: { renderedBuffer: null } },
      pattern: /File processing error: Processing failed: Rendering produced empty buffer/
    },
    {
      name: 'render throws',
      options: { offlineContextOptions: { renderError: new Error('render failed') } },
      pattern: /File processing error: Processing failed: render failed/
    },
    {
      name: 'start throws',
      options: { offlineContextOptions: { startError: new Error('start failed') } },
      pattern: /File processing error: Processing failed: start failed/
    }
  ];

  for (const failureCase of failureCases) {
    await withOfflineGlobals({ window: {} }, async ({ calls }) => {
      const { processor, file } = createHarness(calls, {
        audioBuffer: createGeneratedAudioBuffer(2, 4),
        ...failureCase.options
      });
      await assert.rejects(
        () => processor.processAudioFile(file, [
          createPlugin(calls, { id: failureCase.name, parameters: { channel: 'A' } })
        ]),
        failureCase.pattern
      );
      assert.equal(processor.isProcessing(), false);
      assert.equal(processor.offlineContext, null);
      assert.equal(processor.offlineWorkletNode, null);
    });
  }
});

test('processAudioFile cancels without rendering and releases offline resources', async () => {
  await withOfflineGlobals({
    window: {},
    performanceValues: [20]
  }, async ({ calls }) => {
    const { processor, file } = createHarness(calls, {
      audioBuffer: createGeneratedAudioBuffer(2, 4)
    });
    processor.offlineWorkletNode = {
      disconnect() {
        calls.push(['offlineWorkletDisconnect']);
      }
    };

    const result = await processor.processAudioFile(file, [
      createPlugin(calls, {
        id: 'cancel-after-progress',
        parameters: { channel: 'A' }
      })
    ], () => processor.cancelProcessing());

    assert.equal(result, null);
    assert.equal(processor.isProcessing(), false);
    assert.equal(processor.offlineContext, null);
    assert.equal(processor.offlineWorkletNode, null);
    assert.equal(calls.some(call => call[0] === 'startRendering'), false);
    assert.equal(calls.some(call => call[0] === 'encodeWAV'), false);
    assert.equal(calls.some(call => call[0] === 'offlineWorkletDisconnect'), true);
  });
});

test('offline descriptor execution matches JavaScript routing across buses, channels, and sections', async () => {
  await withOfflineGlobals({
    window: { audioPreferences: { outputChannels: 4 } }
  }, async ({ calls }) => {
    const audioBuffer = createAudioBuffer([
      [1, 2, 3],
      [10, 20, 30],
      [100, 200, 300],
      [1000, 2000, 3000]
    ]);
    const createPipeline = () => [
      createGainPlugin(calls, { id: 'left', gain: 2, parameters: { channel: 'L' } }),
      createGainPlugin(calls, { id: 'right', gain: 3, parameters: { channel: 'R' } }),
      createGainPlugin(calls, {
        id: 'send-34',
        gain: 0.5,
        parameters: { inputBus: 0, outputBus: 1, channel: '34' }
      }),
      createGainPlugin(calls, {
        id: 'return-34',
        gain: 2,
        parameters: { inputBus: 1, outputBus: 0, channel: '34' }
      }),
      new SectionPlugin(false),
      createGainPlugin(calls, { id: 'section-skipped', gain: 99, parameters: { channel: 'A' } }),
      new SectionPlugin(true),
      createGainPlugin(calls, { id: 'after-section', gain: 0.5, parameters: { channel: 'A' } })
    ];

    const jsRuntime = createFakeDspRuntime(calls, { forceOff: true });
    const jsHarness = createHarness(calls, {
      audioBuffer,
      offlineProcessorOptions: jsRuntime.dependencies
    });
    const jsResult = await jsHarness.processor.processAudioFile(jsHarness.file, createPipeline());

    const wasmRuntime = createFakeDspRuntime(calls);
    const wasmHarness = createHarness(calls, {
      audioBuffer,
      offlineProcessorOptions: wasmRuntime.dependencies
    });
    const wasmResult = await wasmHarness.processor.processAudioFile(wasmHarness.file, createPipeline());

    for (let channel = 0; channel < 4; channel++) {
      assert.deepEqual(
        [...wasmResult.encodedBuffer.getChannelData(channel)],
        [...jsResult.encodedBuffer.getChannelData(channel)]
      );
    }
    assert.ok(calls.some(call => call[0] === 'dspPipelineConfigure'));
    assert.ok(calls.some(call => call[0] === 'dspPipelineProcess'));
    assert.equal(
      calls.some(call => call[0] === 'executeProcessor' && call[1] === 'section-skipped'),
      false
    );
  });
});

test('offline hybrid dispatch runs ready instances in WASM and JavaScript islands in place', async () => {
  await withOfflineGlobals({ window: {} }, async ({ calls }) => {
    const runtime = createFakeDspRuntime(calls);
    const { processor, file } = createHarness(calls, {
      audioBuffer: createAudioBuffer([[1, 2], [10, 20]]),
      offlineProcessorOptions: runtime.dependencies
    });
    const wasmPlugin = createGainPlugin(calls, { id: 'wasm', gain: 2 });
    const jsPlugin = createGainPlugin(calls, { id: 'island', gain: 3 });
    class OfflineJsIslandPlugin {}
    Object.defineProperty(jsPlugin, 'constructor', { value: OfflineJsIslandPlugin });

    const result = await processor.processAudioFile(file, [wasmPlugin, jsPlugin]);

    assert.deepEqual([...result.encodedBuffer.getChannelData(0)], [6, 12]);
    assert.deepEqual([...result.encodedBuffer.getChannelData(1)], [60, 120]);
    assert.ok(calls.some(call => call[0] === 'dspInstanceProcess'));
    assert.equal(calls.some(call => call[0] === 'dspPipelineProcess'), false);
    assert.equal(calls.some(call => call[0] === 'executeProcessor' && call[1] === 'wasm'), false);
    assert.ok(calls.some(call => call[0] === 'executeProcessor' && call[1] === 'island'));
  });
});

test('failed instance creation refreshes grown-memory arena and preserves earlier WASM entries',
  async () => {
    await withOfflineGlobals({ window: {} }, async ({ calls }) => {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
      let createCount = 0;
      const runtime = createFakeDspRuntime(calls, {
        bindingOptions: {
          createInstanceResult() {
            createCount++;
            if (createCount !== 2) return undefined;
            const previousBuffer = memory.buffer;
            memory.grow(1);
            assert.equal(previousBuffer.byteLength, 0);
            calls.push(['dspMemoryGrow']);
            return 0;
          },
          getArenaViews({ combined, buses }) {
            return {
              combined,
              buses,
              scratch: {
                allChannels: new Float32Array(memory.buffer, 0, 8 * 128),
                mixing: new Float32Array(memory.buffer, 4096, 8 * 128),
                stereo: new Float32Array(memory.buffer, 8192, 2 * 128),
                mono: new Float32Array(memory.buffer, 9216, 128)
              }
            };
          }
        }
      });
      const { processor, file } = createHarness(calls, {
        audioBuffer: createAudioBuffer([[1, 2], [10, 20]]),
        offlineProcessorOptions: runtime.dependencies
      });
      const first = createGainPlugin(calls, { id: 'wasm-before-grow', gain: 2 });
      const failed = createGainPlugin(calls, { id: 'failed-after-grow', gain: 3 });

      const result = await processor.processAudioFile(file, [first, failed]);

      assert.deepEqual([...result.encodedBuffer.getChannelData(0)], [6, 12]);
      assert.deepEqual([...result.encodedBuffer.getChannelData(1)], [60, 120]);
      assert.equal(calls.filter(call => call[0] === 'dspGetArenaViews').length, 3);
      assert.ok(calls.some(call => call[0] === 'dspMemoryGrow'));
      assert.ok(calls.some(call => call[0] === 'dspInstanceProcess'));
      assert.equal(calls.some(call =>
        call[0] === 'executeProcessor' && call[1] === 'wasm-before-grow'), false);
      assert.ok(calls.some(call =>
        call[0] === 'executeProcessor' && call[1] === 'failed-after-grow'));
      assert.ok(calls.some(call => call[0] === 'dspWarning' &&
        call[1].includes('instance creation failed')));
    });
  });

test('offline WASM staging sends structured parameter bytes after numeric parameters', async () => {
  await withOfflineGlobals({ window: {} }, async ({ calls }) => {
    const runtime = createFakeDspRuntime(calls, {
      byteCapacity: 3076,
      structuredBytes: Uint8Array.of(1, 0, 2, 0, 0, 0, 0, 1, 1, 0)
    });
    const { processor, file } = createHarness(calls, {
      audioBuffer: createAudioBuffer([[1, 2], [10, 20]]),
      offlineProcessorOptions: runtime.dependencies
    });
    const result = await processor.processAudioFile(file, [
      createGainPlugin(calls, { id: 'structured', gain: 2 })
    ]);

    assert.deepEqual([...result.encodedBuffer.getChannelData(0)], [2, 4]);
    assert.ok(calls.some(call => call[0] === 'dspSetParams'));
    assert.ok(calls.some(call => call[0] === 'dspSetParamBytes' &&
      String(call[2]) === '1,0,2,0,0,0,0,1,1,0'));
  });
});

test('offline structured parameter failures disable the instance and use JavaScript', async () => {
  await withOfflineGlobals({ window: {} }, async ({ calls }) => {
    const runtime = createFakeDspRuntime(calls, {
      byteCapacity: 3076,
      structuredBytes: Uint8Array.of(1, 0, 0, 0),
      bindingOptions: { paramBytesStatus: -2 }
    });
    const { processor, file } = createHarness(calls, {
      audioBuffer: createAudioBuffer([[1, 2], [10, 20]]),
      offlineProcessorOptions: runtime.dependencies
    });
    const result = await processor.processAudioFile(file, [
      createGainPlugin(calls, { id: 'structured-fallback', gain: 3 })
    ]);

    assert.deepEqual([...result.encodedBuffer.getChannelData(0)], [3, 6]);
    assert.ok(calls.some(call => call[0] === 'dspDestroyInstance'));
    assert.ok(calls.some(call => call[0] === 'dspWarning' &&
      call[1].includes('structured parameter update failed')));
  });
});

test('pipeline configuration failure falls back to per-instance WASM processing', async () => {
  await withOfflineGlobals({ window: {} }, async ({ calls }) => {
    const runtime = createFakeDspRuntime(calls, {
      bindingOptions: { pipelineConfigureStatus: -6 }
    });
    const { processor, file } = createHarness(calls, {
      audioBuffer: createAudioBuffer([[1, 2], [10, 20]]),
      offlineProcessorOptions: runtime.dependencies
    });

    const result = await processor.processAudioFile(file, [
      createGainPlugin(calls, { id: 'gain', gain: 2 })
    ]);

    assert.deepEqual([...result.encodedBuffer.getChannelData(0)], [2, 4]);
    assert.deepEqual([...result.encodedBuffer.getChannelData(1)], [20, 40]);
    assert.ok(calls.some(call => call[0] === 'dspPipelineConfigure'));
    assert.ok(calls.some(call => call[0] === 'dspInstanceProcess'));
    assert.equal(calls.some(call => call[0] === 'executeProcessor'), false);
  });
});

test('pipeline processing failure discards mutated arena audio and falls back to JavaScript', async () => {
  await withOfflineGlobals({ window: {} }, async ({ calls }) => {
    const runtime = createFakeDspRuntime(calls, {
      bindingOptions: {
        pipelineProcessStatus(combined) {
          combined.fill(999);
          return -2;
        }
      }
    });
    const { processor, file } = createHarness(calls, {
      audioBuffer: createAudioBuffer([[1, 2], [10, 20]]),
      offlineProcessorOptions: runtime.dependencies
    });

    const result = await processor.processAudioFile(file, [
      createGainPlugin(calls, { id: 'gain', gain: 2 })
    ]);

    assert.deepEqual([...result.encodedBuffer.getChannelData(0)], [2, 4]);
    assert.deepEqual([...result.encodedBuffer.getChannelData(1)], [20, 40]);
    assert.ok(calls.some(call => call[0] === 'executeProcessor' && call[1] === 'gain'));
    assert.equal(calls.filter(call => call[0] === 'dspDestroyInstance').length, 1);
    assert.equal(calls.filter(call => call[0] === 'dspClose').length, 1);
  });
});

test('hybrid instance failure preserves the JavaScript input block and disables only that instance', async () => {
  await withOfflineGlobals({ window: {} }, async ({ calls }) => {
    const runtime = createFakeDspRuntime(calls, {
      bindingOptions: {
        instanceProcessStatus(view) {
          view.fill(999);
          return -1;
        }
      }
    });
    const { processor, file } = createHarness(calls, {
      audioBuffer: createAudioBuffer([[1, 2], [10, 20]]),
      offlineProcessorOptions: runtime.dependencies
    });
    const wasmPlugin = createGainPlugin(calls, { id: 'wasm-fallback', gain: 2 });
    const jsPlugin = createGainPlugin(calls, { id: 'island', gain: 3 });
    class OfflineJsIslandPlugin {}
    Object.defineProperty(jsPlugin, 'constructor', { value: OfflineJsIslandPlugin });

    const result = await processor.processAudioFile(file, [wasmPlugin, jsPlugin]);

    assert.deepEqual([...result.encodedBuffer.getChannelData(0)], [6, 12]);
    assert.deepEqual([...result.encodedBuffer.getChannelData(1)], [60, 120]);
    assert.ok(calls.some(call => call[0] === 'executeProcessor' && call[1] === 'wasm-fallback'));
    assert.equal(calls.filter(call => call[0] === 'dspDestroyInstance').length, 1);
    assert.equal(calls.filter(call => call[0] === 'dspWarning').length, 1);
  });
});

test('offline rollout validates parameter hashes before creating an engine', async () => {
  await withOfflineGlobals({ window: {} }, async ({ calls }) => {
    const runtime = createFakeDspRuntime(calls, { packerHash: 0x87654321 });
    const { processor, file } = createHarness(calls, {
      audioBuffer: createAudioBuffer([[1, 2], [10, 20]]),
      offlineProcessorOptions: runtime.dependencies
    });

    const result = await processor.processAudioFile(file, [
      createGainPlugin(calls, { id: 'hash-mismatch', gain: 2 })
    ]);

    assert.deepEqual([...result.encodedBuffer.getChannelData(0)], [2, 4]);
    assert.equal(calls.some(call => call[0] === 'dspInstantiate'), false);
    assert.ok(calls.some(call => call[0] === 'executeProcessor'));
  });
});

test('offline preference and engine channel limits prevent WASM instantiation', async () => {
  const cases = [
    { window: { audioPreferences: { useWasmDsp: false } }, channels: 2 },
    { window: { audioPreferences: { outputChannels: 9 } }, channels: 2 }
  ];

  for (const testCase of cases) {
    await withOfflineGlobals({ window: testCase.window }, async ({ calls }) => {
      const runtime = createFakeDspRuntime(calls);
      const { processor, file } = createHarness(calls, {
        audioBuffer: createGeneratedAudioBuffer(testCase.channels, 2),
        offlineProcessorOptions: runtime.dependencies
      });

      await processor.processAudioFile(file, [
        createGainPlugin(calls, { id: 'javascript-only', gain: 2 })
      ]);

      assert.equal(calls.some(call => call[0] === 'dspInstantiate'), false);
      assert.ok(calls.some(call => call[0] === 'executeProcessor'));
    });
  }
});

test('offline setup failures remain JavaScript-only and release partially prepared engines', async () => {
  const cases = [
    { runtimeOptions: { moduleInfoError: new Error('module lookup failed') }, closes: 0 },
    { runtimeOptions: { instantiateError: new Error('instantiate failed') }, closes: 0 },
    { runtimeOptions: { bindingOptions: { prepareStatus: -1 } }, closes: 1 },
    { runtimeOptions: { bindingOptions: { parameterStatus: -5 } }, closes: 1 }
  ];

  for (const failureCase of cases) {
    await withOfflineGlobals({ window: {} }, async ({ calls }) => {
      const runtime = createFakeDspRuntime(calls, failureCase.runtimeOptions);
      const { processor, file } = createHarness(calls, {
        audioBuffer: createAudioBuffer([[1, 2], [10, 20]]),
        offlineProcessorOptions: runtime.dependencies
      });

      const result = await processor.processAudioFile(file, [
        createGainPlugin(calls, { id: 'setup-fallback', gain: 2 })
      ]);

      assert.deepEqual([...result.encodedBuffer.getChannelData(0)], [2, 4]);
      assert.ok(calls.some(call => call[0] === 'executeProcessor'));
      assert.ok(calls.some(call => call[0] === 'dspWarning'));
      assert.equal(calls.filter(call => call[0] === 'dspClose').length, failureCase.closes);
    });
  }
});

test('each offline export gets a fresh engine from the cached module and destroys it', async () => {
  await withOfflineGlobals({ window: {} }, async ({ calls }) => {
    const runtime = createFakeDspRuntime(calls);
    const { processor, file } = createHarness(calls, {
      audioBuffer: createAudioBuffer([[1, 2], [10, 20]]),
      offlineProcessorOptions: runtime.dependencies
    });
    const plugin = createGainPlugin(calls, { id: 'gain', gain: 2 });

    await processor.processAudioFile(file, [plugin]);
    await processor.processAudioFile(file, [plugin]);

    assert.equal(runtime.bindings.length, 2);
    assert.equal(calls.filter(call => call[0] === 'dspInstantiate').length, 2);
    assert.equal(calls.filter(call => call[0] === 'dspCreateEngine').length, 2);
    assert.equal(calls.filter(call => call[0] === 'dspClose').length, 2);
    assert.equal(calls.some(call => call[0] === 'dspLoadModule'), false);
  });
});

test('offline cancellation and render errors destroy active WASM instances and engines', async () => {
  await withOfflineGlobals({ window: {} }, async ({ calls }) => {
    const cancellationRuntime = createFakeDspRuntime(calls);
    const cancellationHarness = createHarness(calls, {
      audioBuffer: createAudioBuffer([[1, 2], [10, 20]]),
      offlineProcessorOptions: cancellationRuntime.dependencies
    });
    const cancelled = await cancellationHarness.processor.processAudioFile(
      cancellationHarness.file,
      [createGainPlugin(calls, { id: 'cancelled', gain: 2 })],
      () => cancellationHarness.processor.cancelProcessing()
    );
    assert.equal(cancelled, null);

    const errorRuntime = createFakeDspRuntime(calls);
    const errorHarness = createHarness(calls, {
      audioBuffer: createAudioBuffer([[1, 2], [10, 20]]),
      offlineProcessorOptions: errorRuntime.dependencies,
      offlineContextOptions: { renderError: new Error('render failed') }
    });
    await assert.rejects(
      () => errorHarness.processor.processAudioFile(errorHarness.file, [
        createGainPlugin(calls, { id: 'render-error', gain: 2 })
      ]),
      /File processing error: Processing failed: render failed/
    );

    assert.equal(calls.filter(call => call[0] === 'dspDestroyInstance').length, 2);
    assert.equal(calls.filter(call => call[0] === 'dspClose').length, 2);
  });
});
