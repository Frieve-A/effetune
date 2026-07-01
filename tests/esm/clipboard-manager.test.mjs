import assert from 'node:assert/strict';
import test from 'node:test';

import { ClipboardManager } from '../../js/ui/pipeline/clipboard-manager.js';
import { encodePipelineState } from '../../js/utils/pipeline-state-codec.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function createPlugin(name, calls, overrides = {}) {
  return {
    id: overrides.id ?? name,
    name,
    enabled: overrides.enabled ?? true,
    inputBus: overrides.inputBus ?? null,
    outputBus: overrides.outputBus ?? null,
    channel: overrides.channel ?? null,
    parameters: {},
    getSerializableParameters: overrides.getSerializableParameters,
    setEnabled(value) {
      calls.push(['setEnabled', name, value]);
      this.enabled = value;
    },
    setParameters(parameters) {
      calls.push(['setParameters', name, parameters]);
      this.parameters = { ...this.parameters, ...parameters };
    },
    updateParameters() {
      calls.push(['updateParameters', name]);
    }
  };
}

function createRuntime(options = {}) {
  const calls = [];
  const selectedPlugins = new Set(options.selectedPlugins ?? []);
  const pipeline = options.pipeline ?? [];
  const pipelineManager = {
    core: {
      selectedPlugins,
      updatePipelineUI() {
        calls.push(['updatePipelineUI']);
      },
      updateWorkletPlugins() {
        calls.push(['updateWorkletPlugins']);
      },
      deleteSelectedPlugins() {
        calls.push(['deleteSelectedPlugins']);
      }
    },
    audioManager: { pipeline },
    pluginManager: {
      createPlugin(name) {
        calls.push(['createPlugin', name]);
        if (options.missingPlugins?.has(name)) return null;
        return createPlugin(name, calls);
      }
    },
    expandedPlugins: new Set(),
    historyManager: {
      saveState() {
        calls.push(['saveState']);
      }
    }
  };

  return {
    calls,
    pipeline,
    selectedPlugins,
    pipelineManager,
    manager: new ClipboardManager(pipelineManager)
  };
}

async function withClipboardGlobals(calls, options, callback) {
  const frameCallbacks = [];
  const timeoutCallbacks = [];
  const uiManager = options.uiManager === false ? null : {
    setError(message, isError, details) {
      calls.push(['setError', message, isError, details]);
    },
    clearError() {
      calls.push(['clearError']);
    },
    isDoubleBlindActive: options.isDoubleBlindActive === undefined
      ? undefined
      : () => {
          calls.push(['isDoubleBlindActive']);
          return options.isDoubleBlindActive;
        },
    getDoubleBlindTest() {
      calls.push(['getDoubleBlindTest']);
      return {
        restoreFromShare(value) {
          calls.push(['restoreFromShare', value]);
          return options.restoreFromShare ?? false;
        }
      };
    }
  };
  if (options.uiManagerNoDoubleBlind) {
    delete uiManager.isDoubleBlindActive;
  }

  const windowRef = {
    uiManager,
    electronAPI: options.electronAPI,
    scrollTo(position) {
      calls.push(['scrollTo', position]);
    }
  };

  await withGlobals({
    window: windowRef,
    document: options.document ?? { body: { scrollHeight: 1234 } },
    requestAnimationFrame(fn) {
      calls.push(['requestAnimationFrame']);
      frameCallbacks.push(fn);
      return frameCallbacks.length;
    },
    setTimeout(fn, delay) {
      calls.push(['setTimeout', delay]);
      timeoutCallbacks.push(fn);
      return timeoutCallbacks.length;
    },
    console: {
      ...console,
      error: (...args) => calls.push(['consoleError', ...args])
    }
  }, async () => callback({ frameCallbacks, timeoutCallbacks }));
}

test('copySelectedPluginsToClipboard handles empty, successful, and failed copies', async () => {
  const emptyRuntime = createRuntime();
  await withClipboardGlobals(emptyRuntime.calls, {}, async () => {
    assert.equal(await emptyRuntime.manager.copySelectedPluginsToClipboard(), false);
  });

  const selected = createPlugin('Tone', [], {
    enabled: false,
    inputBus: 1,
    outputBus: 2,
    channel: 'L',
    getSerializableParameters: () => ({ gain: -3 })
  });
  const runtime = createRuntime({ selectedPlugins: [selected] });

  await withClipboardGlobals(runtime.calls, {
    electronAPI: {
      async writeClipboardText(text) {
        runtime.calls.push(['writeClipboardText', text]);
        return true;
      }
    }
  }, async ({ timeoutCallbacks }) => {
    assert.equal(await runtime.manager.copySelectedPluginsToClipboard(), true);
    timeoutCallbacks.forEach(fn => fn());
  });

  const copiedText = runtime.calls.find(call => call[0] === 'writeClipboardText')[1];
  assert.match(copiedText, /"nm": "Tone"/);
  assert.match(copiedText, /"gain": -3/);
  assert.ok(runtime.calls.some(call => call[0] === 'setError' && call[1] === 'success.settingsCopied'));
  assert.ok(runtime.calls.some(call => call[0] === 'clearError'));

  const failingRuntime = createRuntime({ selectedPlugins: [selected] });
  await withClipboardGlobals(failingRuntime.calls, {
    document: undefined,
    electronAPI: {
      async writeClipboardText() {
        failingRuntime.calls.push(['writeClipboardTextFail']);
        return false;
      }
    }
  }, async () => {
    assert.equal(await failingRuntime.manager.copySelectedPluginsToClipboard(), false);
  });
  assert.ok(failingRuntime.calls.some(call => call[0] === 'setError' && call[1] === 'error.failedToCopySettings'));
});

test('cutSelectedPlugins copies before deleting and handles failures', async () => {
  const selected = createPlugin('Cut', [], {});
  const emptyRuntime = createRuntime();
  await withClipboardGlobals(emptyRuntime.calls, {}, async () => {
    assert.equal(await emptyRuntime.manager.cutSelectedPlugins(), false);
  });

  const copyFalseRuntime = createRuntime({ selectedPlugins: [selected] });
  copyFalseRuntime.manager.copySelectedPluginsToClipboard = async () => false;
  await withClipboardGlobals(copyFalseRuntime.calls, {}, async () => {
    assert.equal(await copyFalseRuntime.manager.cutSelectedPlugins(), false);
  });
  assert.deepEqual(copyFalseRuntime.calls, []);

  const runtime = createRuntime({ selectedPlugins: [selected] });
  runtime.manager.copySelectedPluginsToClipboard = async () => true;
  await withClipboardGlobals(runtime.calls, {}, async ({ timeoutCallbacks }) => {
    assert.equal(await runtime.manager.cutSelectedPlugins(), true);
    timeoutCallbacks.forEach(fn => fn());
  });
  assert.ok(runtime.calls.some(call => call[0] === 'deleteSelectedPlugins'));
  assert.ok(runtime.calls.some(call => call[0] === 'setError' && call[1] === 'success.settingsCut'));

  const throwRuntime = createRuntime({ selectedPlugins: [selected] });
  throwRuntime.manager.copySelectedPluginsToClipboard = async () => {
    throw new Error('copy failed');
  };
  await withClipboardGlobals(throwRuntime.calls, {}, async () => {
    assert.equal(await throwRuntime.manager.cutSelectedPlugins(), false);
  });
  assert.ok(throwRuntime.calls.some(call => call[0] === 'setError' && call[1] === 'error.failedToCutSettings'));
});

test('handlePaste inserts JSON plugins before selected plugins and avoids end scrolling', async () => {
  const calls = [];
  const existingA = createPlugin('ExistingA', calls);
  const existingB = createPlugin('ExistingB', calls);
  const runtime = createRuntime({
    pipeline: [existingA, existingB],
    selectedPlugins: [existingB]
  });

  await withClipboardGlobals(runtime.calls, {}, async ({ timeoutCallbacks }) => {
    await runtime.manager.handlePaste(JSON.stringify([{ nm: 'Inserted', en: false, gain: 2 }]));
    timeoutCallbacks.forEach(fn => fn());
  });

  assert.deepEqual(runtime.pipeline.map(plugin => plugin.name), ['ExistingA', 'Inserted', 'ExistingB']);
  assert.deepEqual([...runtime.selectedPlugins].map(plugin => plugin.name), ['Inserted']);
  assert.equal(runtime.pipelineManager.expandedPlugins.size, 1);
  assert.ok(runtime.calls.some(call => call[0] === 'updatePipelineUI'));
  assert.ok(runtime.calls.some(call => call[0] === 'updateWorkletPlugins'));
  assert.ok(runtime.calls.some(call => call[0] === 'saveState'));
  assert.equal(runtime.calls.some(call => call[0] === 'requestAnimationFrame'), false);
});

test('handlePaste appends JSON plugins, scrolls to bottom, and works without a UI manager', async () => {
  const existing = createPlugin('Existing', []);
  const runtime = createRuntime({ pipeline: [existing] });

  await withClipboardGlobals(runtime.calls, { uiManager: false }, async ({ frameCallbacks }) => {
    await runtime.manager.handlePaste(JSON.stringify([{ nm: 'Tail', ch: 'Right' }]));
    frameCallbacks.forEach(fn => fn());
  });

  assert.deepEqual(runtime.pipeline.map(plugin => plugin.name), ['Existing', 'Tail']);
  assert.equal(runtime.pipeline[1].channel, 'R');
  assert.ok(runtime.calls.some(call => call[0] === 'scrollTo'));
  assert.equal(runtime.calls.some(call => call[0] === 'setError'), false);
});

test('handlePaste reports invalid JSON, non-arrays, and missing plugins', async () => {
  for (const text of ['not json', JSON.stringify({ nm: 'NotArray' }), JSON.stringify([{ nm: 'Missing' }])]) {
    const runtime = createRuntime({ missingPlugins: new Set(['Missing']) });
    await withClipboardGlobals(runtime.calls, {}, async () => {
      await runtime.manager.handlePaste(text);
    });
    assert.ok(runtime.calls.some(call => call[0] === 'setError' && call[1] === 'error.failedToPasteSettings'));
  }
});

test('handlePaste decodes pipeline share URLs and falls back after URL failures', async () => {
  const selected = createPlugin('Selected', []);
  const runtime = createRuntime({ pipeline: [selected], selectedPlugins: [selected] });
  const encoded = encodePipelineState([{ nm: 'Shared', mix: 0.25 }]);

  await withClipboardGlobals(runtime.calls, { restoreFromShare: false }, async () => {
    await runtime.manager.handlePaste(`https://example.test/share?dbt=keep-going&p=${encoded}`);
  });
  assert.deepEqual(runtime.pipeline.map(plugin => plugin.name), ['Shared', 'Selected']);
  assert.ok(runtime.calls.some(call => call[0] === 'restoreFromShare' && call[1] === 'keep-going'));

  const tailRuntime = createRuntime({ pipeline: [createPlugin('Existing', [])] });
  await withClipboardGlobals(tailRuntime.calls, {}, async ({ frameCallbacks, timeoutCallbacks }) => {
    await tailRuntime.manager.handlePaste(`https://example.test/share?p=${encoded}`);
    frameCallbacks.forEach(fn => fn());
    timeoutCallbacks.forEach(fn => fn());
  });
  assert.deepEqual(tailRuntime.pipeline.map(plugin => plugin.name), ['Existing', 'Shared']);
  assert.ok(tailRuntime.calls.some(call => call[0] === 'scrollTo'));
  assert.ok(tailRuntime.calls.some(call => call[0] === 'setError' && call[1] === 'success.settingsPasted'));

  const invalidCases = [
    'https://example.test/share?p=not-base64!*',
    `https://example.test/share?p=${encodePipelineState({ nm: 'NotArray' })}`,
    `https://example.test/share?p=${encodePipelineState([{ nm: 'Missing' }])}`,
    'http://%',
    'https://example.test/share'
  ];
  for (const text of invalidCases) {
    const failingRuntime = createRuntime({ missingPlugins: new Set(['Missing']) });
    await withClipboardGlobals(failingRuntime.calls, {}, async () => {
      await failingRuntime.manager.handlePaste(text);
    });
    assert.ok(failingRuntime.calls.some(call => call[0] === 'setError' && call[1] === 'error.failedToPasteSettings'));
  }
});

test('handlePaste honors double blind test guards and restoration paths', async () => {
  const activeRuntime = createRuntime();
  await withClipboardGlobals(activeRuntime.calls, { isDoubleBlindActive: true }, async () => {
    await activeRuntime.manager.handlePaste(JSON.stringify([{ nm: 'Ignored' }]));
  });
  assert.deepEqual(activeRuntime.pipeline, []);

  const activeUrlRuntime = createRuntime();
  await withClipboardGlobals(activeUrlRuntime.calls, { isDoubleBlindActive: true }, async () => {
    await activeUrlRuntime.manager.handlePaste('https://example.test/share?dbt=value');
  });
  assert.deepEqual(activeUrlRuntime.pipeline, []);
  assert.equal(activeUrlRuntime.calls.some(call => call[0] === 'getDoubleBlindTest'), false);

  const activePipelineUrlRuntime = createRuntime();
  await withClipboardGlobals(activePipelineUrlRuntime.calls, { isDoubleBlindActive: true }, async () => {
    await activePipelineUrlRuntime.manager.handlePaste(`https://example.test/share?p=${encodePipelineState([{ nm: 'Ignored' }])}`);
  });
  assert.deepEqual(activePipelineUrlRuntime.pipeline, []);

  const restoreRuntime = createRuntime();
  await withClipboardGlobals(restoreRuntime.calls, { restoreFromShare: true }, async () => {
    await restoreRuntime.manager.handlePaste('https://example.test/share?dbt=value');
  });
  assert.deepEqual(restoreRuntime.pipeline, []);
  assert.ok(restoreRuntime.calls.some(call => call[0] === 'restoreFromShare' && call[1] === 'value'));

  const noMethodRuntime = createRuntime();
  await withClipboardGlobals(noMethodRuntime.calls, { uiManagerNoDoubleBlind: true }, async () => {
    await noMethodRuntime.manager.handlePaste(JSON.stringify([{ nm: 'Allowed' }]));
  });
  assert.deepEqual(noMethodRuntime.pipeline.map(plugin => plugin.name), ['Allowed']);
});
