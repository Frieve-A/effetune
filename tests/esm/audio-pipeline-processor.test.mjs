import assert from 'node:assert/strict';
import test from 'node:test';

import { PipelineProcessor } from '../../js/audio/pipeline-processor.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

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

async function withProcessorGlobals(options, callback) {
  const calls = [];
  return withGlobals({
    window: options.window ?? {},
    console: createConsole(calls),
    ...(options.AudioWorkletNode ? { AudioWorkletNode: options.AudioWorkletNode } : {})
  }, async () => callback({ calls }));
}

function createWorklet(calls, options = {}) {
  return {
    port: {
      postMessage(message) {
        calls.push(['postMessage', message]);
      }
    },
    disconnect() {
      calls.push(['workletDisconnect']);
      if (options.disconnectError) throw options.disconnectError;
    }
  };
}

function createSourceNode(calls, options = {}) {
  return {
    disconnect() {
      calls.push(['sourceDisconnect']);
      if (options.onDisconnect) options.onDisconnect();
      if (options.disconnectError) throw options.disconnectError;
    }
  };
}

function createIoManager(calls, options = {}) {
  return {
    sourceNode: options.sourceNode,
    createFallbackSilentSource() {
      calls.push(['createFallbackSilentSource']);
      return options.fallbackSource ?? createSourceNode(calls);
    },
    async connectAudioNodes(connectionOptions) {
      calls.push(['connectAudioNodes', connectionOptions]);
      return options.connectionResult ?? '';
    }
  };
}

function createPlugin(calls, options = {}) {
  class TestPlugin {}
  const plugin = new TestPlugin();
  plugin.id = options.id ?? 'plugin-1';
  plugin.enabled = options.enabled ?? true;
  plugin.inputBus = options.inputBus;
  plugin.outputBus = options.outputBus;
  plugin.channel = options.channel;
  plugin.getParameters = callOptions => {
    calls.push(['getParameters', callOptions]);
    return options.parameters ?? {};
  };
  return plugin;
}

test('state helpers and rebuild guards handle invalid pipeline state', async () => {
  const processor = new PipelineProcessor({ audioContext: null }, { sourceNode: {} });
  assert.equal(processor.getMasterBypass(), false);
  assert.deepEqual(processor.getPipeline(), []);

  processor.setPipeline('not an array');
  assert.deepEqual(processor.getPipeline(), []);

  const pipeline = [{ id: 'one' }];
  processor.setPipeline(pipeline);
  assert.equal(processor.getPipeline(), pipeline);

  processor.setMasterBypass(true);
  assert.equal(processor.getMasterBypass(), true);

  await withProcessorGlobals({}, async () => {
    assert.equal(await processor.rebuildPipeline(), undefined);
  });
});

test('rebuildPipeline creates a fallback source when input is deferred', async () => {
  await withProcessorGlobals({ window: { pipeline: 'external value ignored' } }, async ({ calls }) => {
    const contextManager = {
      audioContext: { sampleRate: 48000 },
      workletNode: createWorklet(calls)
    };
    const ioManager = createIoManager(calls, { sourceNode: null });
    const connectSource = () => true;
    const processor = new PipelineProcessor(contextManager, ioManager, null, connectSource);

    assert.equal(await processor.rebuildPipeline(), '');
    assert.ok(calls.some(call => call[0] === 'createFallbackSilentSource'));
    assert.ok(calls.some(call => call[0] === 'connectAudioNodes'));
    assert.equal(calls.find(call => call[0] === 'connectAudioNodes')[1].connectSource, connectSource);
    assert.deepEqual(calls.find(call => call[0] === 'postMessage')?.[1], {
      type: 'updatePlugins',
      plugins: [],
      masterBypass: true
    });
  });
});

test('empty pipelines post bypass state and continue after disconnect warnings', async () => {
  await withProcessorGlobals({ window: { pipeline: 'external value ignored' } }, async ({ calls }) => {
    const contextManager = {
      audioContext: { sampleRate: 48000 },
      workletNode: createWorklet(calls)
    };
    const ioManager = createIoManager(calls, {
      sourceNode: createSourceNode(calls, { disconnectError: new Error('source stuck') })
    });
    const processor = new PipelineProcessor(contextManager, ioManager);

    assert.equal(await processor.rebuildPipeline(), '');
    assert.ok(calls.some(call => call[0] === 'consoleWarn'));
    assert.deepEqual(calls.find(call => call[0] === 'postMessage')?.[1], {
      type: 'updatePlugins',
      plugins: [],
      masterBypass: true
    });
  });
});

test('rebuildPipeline recreates missing nodes and returns connection errors', async () => {
  await withProcessorGlobals({
    AudioWorkletNode: class FakeAudioWorkletNode {
      constructor(audioContext, name) {
        globalThis.window.createdWorkletArgs = [audioContext, name];
        return createWorklet(globalThis.window.calls);
      }
    },
    window: { calls: [] }
  }, async ({ calls }) => {
    globalThis.window.calls = calls;
    const contextManager = {
      audioContext: { sampleRate: 44100 },
      workletNode: null
    };
    let ioManager;
    const sourceNode = createSourceNode(calls, {
      onDisconnect() {
        ioManager.sourceNode = null;
      }
    });
    ioManager = createIoManager(calls, {
      sourceNode,
      connectionResult: 'connect failed'
    });
    let registerCount = 0;
    const processor = new PipelineProcessor(contextManager, ioManager, () => {
      registerCount++;
      calls.push(['registerProcessors']);
    });

    assert.equal(await processor.rebuildPipeline(), 'connect failed');
    assert.deepEqual(globalThis.window.createdWorkletArgs, [
      contextManager.audioContext,
      'plugin-processor'
    ]);
    assert.equal(globalThis.window.workletNode, contextManager.workletNode);
    assert.equal(registerCount, 1);
    assert.ok(calls.some(call => call[0] === 'createFallbackSilentSource'));
  });
});

test('rebuildPipeline reports worklet recreation failures', async () => {
  await withProcessorGlobals({
    AudioWorkletNode: class ThrowingAudioWorkletNode {
      constructor() {
        throw new Error('constructor failed');
      }
    }
  }, async ({ calls }) => {
    const contextManager = {
      audioContext: {},
      workletNode: null
    };
    const ioManager = createIoManager(calls, {
      sourceNode: createSourceNode(calls)
    });
    const processor = new PipelineProcessor(contextManager, ioManager);

    assert.equal(
      await processor.rebuildPipeline(),
      'Audio Error: Failed to create audio processor: constructor failed'
    );
    assert.ok(calls.some(call => call[0] === 'consoleError'));
    assert.equal(calls.some(call => call[0] === 'connectAudioNodes'), false);
  });
});

test('rebuildPipeline sends section-aware plugin data from the global pipeline', async () => {
  await withProcessorGlobals({ window: {} }, async ({ calls }) => {
    const worklet = createWorklet(calls);
    const contextManager = {
      audioContext: { sampleRate: 96000, destination: { channelCount: 6 } },
      workletNode: worklet
    };
    const ioManager = createIoManager(calls, {
      sourceNode: createSourceNode(calls)
    });
    const plugin = createPlugin(calls, {
      id: 'eq-1',
      inputBus: 1,
      outputBus: 2,
      channel: 'L',
      parameters: { gain: 3 }
    });
    globalThis.window.pipeline = [plugin];
    let registerCount = 0;
    const processor = new PipelineProcessor(contextManager, ioManager, () => {
      registerCount++;
    });

    assert.equal(await processor.rebuildPipeline(), '');

    assert.equal(registerCount, 1);
    assert.deepEqual(calls.find(call => call[0] === 'getParameters')?.[1], {
      sampleRate: 96000,
      outputChannelCount: 6,
      commitSampleRate: true
    });
    assert.deepEqual(calls.find(call => call[0] === 'postMessage')?.[1], {
      type: 'updatePlugins',
      plugins: [{
        id: 'eq-1',
        type: 'TestPlugin',
        enabled: true,
        parameters: { gain: 3 },
        inputBus: 1,
        outputBus: 2,
        channel: 'L'
      }],
      masterBypass: false
    });
  });
});

test('master bypass sends empty plugin data for non-empty pipelines', async () => {
  await withProcessorGlobals({ window: {} }, async ({ calls }) => {
    const contextManager = {
      audioContext: { sampleRate: 48000 },
      workletNode: createWorklet(calls)
    };
    const processor = new PipelineProcessor(contextManager, createIoManager(calls, {
      sourceNode: createSourceNode(calls)
    }));
    processor.setPipeline([createPlugin(calls, { id: 'gain-1' })]);
    processor.setMasterBypass(true);

    assert.equal(await processor.rebuildPipeline(), '');
    assert.deepEqual(calls.find(call => call[0] === 'postMessage')?.[1], {
      type: 'updatePlugins',
      plugins: [],
      masterBypass: true
    });
  });
});

test('prepareSectionAwarePluginData tolerates a missing audio context sample rate', () => {
  const calls = [];
  const processor = new PipelineProcessor(null, null);
  const plugin = createPlugin(calls, {
    id: 'plain-1',
    enabled: false,
    parameters: { mix: 0.5 }
  });
  processor.setPipeline([plugin]);

  assert.deepEqual(processor.prepareSectionAwarePluginData(), [{
    id: 'plain-1',
    type: 'TestPlugin',
    enabled: false,
    parameters: { mix: 0.5 },
    inputBus: undefined,
    outputBus: undefined,
    channel: undefined
  }]);
  assert.deepEqual(calls[0], ['getParameters', {
    sampleRate: null,
    outputChannelCount: 2,
    commitSampleRate: true
  }]);
});
