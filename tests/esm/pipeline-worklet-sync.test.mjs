import assert from 'node:assert/strict';
import test from 'node:test';

import { PipelineWorkletSync } from '../../js/ui/pipeline/pipeline-worklet-sync.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class TestPlugin {
  constructor(id, calls, options = {}) {
    this.id = id;
    this.enabled = options.enabled ?? true;
    this.inputBus = options.inputBus ?? null;
    this.outputBus = options.outputBus ?? null;
    this.channel = options.channel ?? null;
    this.calls = calls;
    if (options.parameters) {
      this.getParameters = request => {
        calls.push(['getParameters', id, request]);
        return options.parameters;
      };
    }
  }
}

function createRuntime(options = {}) {
  const calls = [];
  const audioManager = {
    pipeline: options.pipeline ?? [],
    masterBypass: options.masterBypass ?? false,
    contextManager: options.contextManager,
    audioContext: options.audioContext,
    pipelineProcessor: options.pipelineProcessor
  };
  if (options.register !== false) {
    audioManager.registerPipelineProcessors = plugins => calls.push(['registerPipelineProcessors', plugins]);
  }
  const pipelineCore = { audioManager };
  return { calls, audioManager, pipelineCore, sync: new PipelineWorkletSync(pipelineCore) };
}

function createWindow(calls, options = {}) {
  return {
    workletNode: options.workletNode,
    uiManager: options.uiManager === false ? null : {
      updateURL() {
        calls.push(['updateURL']);
      }
    }
  };
}

function createWorklet(calls) {
  return {
    port: {
      postMessage(message) {
        calls.push(['postMessage', message]);
      }
    }
  };
}

test('helper methods handle absent processors, non-array pipelines, sample rates, and parameter fallbacks', () => {
  const noRegister = createRuntime({ register: false, pipeline: 'not-array' });
  noRegister.sync.ensureProcessorsRegistered(['ignored']);
  assert.deepEqual(noRegister.sync.getCurrentPipeline(), []);
  assert.equal(noRegister.sync.getAudioSampleRate(), null);
  assert.deepEqual(noRegister.sync.getPluginParameters({}), {});

  const contextRuntime = createRuntime({
    contextManager: { audioContext: { sampleRate: 48000 } },
    audioContext: { sampleRate: 44100 }
  });
  assert.equal(contextRuntime.sync.getAudioSampleRate(), 48000);

  const fallbackRuntime = createRuntime({ audioContext: { sampleRate: 96000 } });
  const plugin = new TestPlugin(1, fallbackRuntime.calls, { parameters: { gain: -3 } });
  assert.equal(fallbackRuntime.sync.getAudioSampleRate(), 96000);
  assert.deepEqual(fallbackRuntime.sync.getPluginParameters(plugin), { gain: -3 });
  assert.deepEqual(fallbackRuntime.calls, [
    ['getParameters', 1, { sampleRate: 96000, commitSampleRate: true }]
  ]);
});

test('worklet update methods send full plugin payloads and update the URL', async () => {
  const runtime = createRuntime({
    contextManager: { audioContext: { sampleRate: 48000 } }
  });
  const pluginA = new TestPlugin(1, runtime.calls, {
    enabled: false,
    inputBus: 1,
    outputBus: 2,
    channel: 'L',
    parameters: { gain: -2 }
  });
  const pluginB = new TestPlugin(2, runtime.calls);
  runtime.audioManager.pipeline = [pluginA, pluginB];

  await withGlobals({ window: createWindow(runtime.calls, { workletNode: createWorklet(runtime.calls) }) }, async () => {
    runtime.sync.updateWorkletPlugins();
    runtime.sync.updateWorkletPlugin(pluginA);
    runtime.sync.sendParameterUpdate(pluginA);
  });

  const messages = runtime.calls.filter(call => call[0] === 'postMessage').map(call => call[1]);
  assert.equal(messages[0].type, 'updatePlugins');
  assert.deepEqual(messages[0].plugins[0], {
    id: 1,
    type: 'TestPlugin',
    enabled: false,
    parameters: { gain: -2 },
    inputBus: 1,
    outputBus: 2,
    channel: 'L'
  });
  assert.equal(messages[1].type, 'updatePlugin');
  assert.equal(messages[2].type, 'updatePlugin');
  assert.equal(runtime.calls.filter(call => call[0] === 'updateURL').length, 2);
  assert.equal(runtime.calls.filter(call => call[0] === 'registerPipelineProcessors').length, 3);
});

test('methods still update URLs when the worklet or UI manager is absent', async () => {
  const runtime = createRuntime();
  const plugin = new TestPlugin(1, runtime.calls);

  await withGlobals({ window: createWindow(runtime.calls, { workletNode: null, uiManager: false }) }, async () => {
    runtime.sync.updateWorkletPlugins();
    runtime.sync.updateWorkletPlugin(plugin);
    runtime.sync.batchUpdatePlugins([plugin]);
    runtime.sync.removePlugin(1);
    runtime.sync.addPlugin(plugin, 0);
    runtime.sync.reorderPlugin(0, 1);
    runtime.sync.resetWorklet();
    runtime.sync.requestPerformanceMetrics();
    runtime.sync.sendParameterUpdate(plugin);
    assert.equal(runtime.sync.isWorkletAvailable(), false);
  });

  await withGlobals({ window: { workletNode: undefined, uiManager: null } }, async () => {
    assert.equal(runtime.sync.isWorkletAvailable(), false);
  });

  await withGlobals({ window: { workletNode: {}, uiManager: null } }, async () => {
    assert.equal(runtime.sync.isWorkletAvailable(), true);
  });

  assert.deepEqual(runtime.calls, []);
});

test('master bypass synchronizes processor state and worklet payloads', async () => {
  const processorCalls = [];
  const runtime = createRuntime({
    pipeline: [new TestPlugin(1, processorCalls, { parameters: { mix: 1 } })],
    pipelineProcessor: {
      setMasterBypass(value) {
        processorCalls.push(['setMasterBypass', value]);
      }
    }
  });

  await withGlobals({ window: createWindow(runtime.calls, { workletNode: createWorklet(runtime.calls) }) }, async () => {
    runtime.sync.updateMasterBypass(1);
  });

  assert.equal(runtime.audioManager.masterBypass, true);
  assert.deepEqual(processorCalls, [
    ['setMasterBypass', true],
    ['getParameters', 1, { sampleRate: null, commitSampleRate: true }],
  ]);
  assert.deepEqual(runtime.calls.find(call => call[0] === 'postMessage')[1], {
    type: 'updatePlugins',
    plugins: [{
      id: 1,
      type: 'TestPlugin',
      enabled: true,
      parameters: { mix: 1 },
      inputBus: null,
      outputBus: null,
      channel: null
    }],
    masterBypass: 1
  });

  const noProcessorRuntime = createRuntime({ pipelineProcessor: {} });
  await withGlobals({ window: createWindow(noProcessorRuntime.calls, { workletNode: null }) }, async () => {
    noProcessorRuntime.sync.updateMasterBypass(0);
  });
  assert.equal(noProcessorRuntime.audioManager.masterBypass, false);
  assert.deepEqual(noProcessorRuntime.calls, [['updateURL']]);
});

test('batch, add, remove, reorder, reset, and metrics messages send expected worklet commands', async () => {
  const runtime = createRuntime();
  const plugin = new TestPlugin(7, runtime.calls, {
    parameters: { threshold: -12 },
    inputBus: 0,
    outputBus: 3,
    channel: 'A'
  });

  await withGlobals({ window: createWindow(runtime.calls, { workletNode: createWorklet(runtime.calls) }) }, async () => {
    runtime.sync.batchUpdatePlugins([]);
    runtime.sync.batchUpdatePlugins([plugin]);
    runtime.sync.addPlugin(plugin, 2);
    runtime.sync.removePlugin(7);
    runtime.sync.reorderPlugin(2, 0);
    runtime.sync.resetWorklet();
    runtime.sync.requestPerformanceMetrics();
  });

  const messages = runtime.calls.filter(call => call[0] === 'postMessage').map(call => call[1]);
  assert.deepEqual(messages.map(message => message.type), [
    'batchUpdatePlugins',
    'addPlugin',
    'removePlugin',
    'reorderPlugin',
    'reset',
    'getPerformanceMetrics'
  ]);
  assert.equal(messages[0].plugins[0].type, 'TestPlugin');
  assert.equal(messages[1].index, 2);
  assert.equal(messages[2].pluginId, 7);
  assert.deepEqual(messages[3], { type: 'reorderPlugin', fromIndex: 2, toIndex: 0 });
  assert.equal(runtime.calls.filter(call => call[0] === 'updateURL').length, 5);
});
