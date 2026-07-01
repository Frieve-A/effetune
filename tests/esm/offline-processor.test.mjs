import assert from 'node:assert/strict';
import test from 'node:test';

import { OfflineProcessor } from '../../js/audio/offline-processor.js';
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
  const processor = new OfflineProcessor(contextManager, audioEncoder);
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
