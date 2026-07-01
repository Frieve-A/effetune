import assert from 'node:assert/strict';
import test from 'node:test';

import { HistoryManager } from '../../js/ui/pipeline/history-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function createRuntime(options = {}) {
  const calls = [];
  const audioManager = {
    pipelineA: options.pipelineA ?? [],
    pipelineB: options.pipelineB ?? null,
    pipeline: options.pipeline ?? options.pipelineA ?? [],
    currentPipeline: options.currentPipeline ?? 'A',
    workletNode: options.workletNode ?? null,
    getCurrentPipeline() {
      calls.push(['getCurrentPipeline', this.currentPipeline]);
      return this.currentPipeline === 'B' ? this.pipelineB : this.pipelineA;
    },
    rebuildPipeline() {
      calls.push(['rebuildPipeline']);
    },
    dispatchEvent(name, detail) {
      calls.push(['dispatchEvent', name, detail]);
    },
    setMasterBypass(value) {
      calls.push(['setMasterBypass', value]);
    }
  };

  const core = {
    enabled: false,
    getSerializablePluginState(plugin, includeRouting, includeInternal, includeRuntime) {
      calls.push(['getSerializablePluginState', plugin.name, includeRouting, includeInternal, includeRuntime]);
      return plugin.serialized ?? { nm: plugin.name, en: plugin.enabled ?? true };
    },
    updatePipelineUI(force) {
      calls.push(['updatePipelineUI', force]);
    },
    updateWorkletPlugins() {
      calls.push(['updateWorkletPlugins']);
    }
  };

  const pipelineManager = {
    audioManager,
    core,
    expandedPlugins: new Set(),
    pluginManager: {
      createPlugin(name) {
        calls.push(['createPlugin', name]);
        return options.createPlugin ? options.createPlugin(name, calls) : createRestoredPlugin(name, calls);
      }
    }
  };

  return { calls, audioManager, core, pipelineManager };
}

function createSourcePlugin(name, options = {}) {
  const plugin = {
    name,
    enabled: options.enabled ?? true,
    serialized: options.serialized
  };
  if (options.cleanup) {
    plugin.cleanup = () => options.calls?.push(['cleanupSource', name]);
  }
  return plugin;
}

function createRestoredPlugin(name, calls) {
  return {
    name,
    enabled: true,
    parameters: {},
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

async function withHistoryGlobals(calls, options, callback) {
  const timers = {
    nextId: 100,
    callbacks: [],
    cleared: []
  };

  const masterToggle = options.masterToggle === false ? null : {
    classList: {
      remove(className) {
        calls.push(['masterToggleRemove', className]);
      }
    }
  };

  const windowRef = options.uiManager === false ? {} : {
    uiManager: {
      updatePipelineToggleButton() {
        calls.push(['updatePipelineToggleButton']);
      }
    }
  };

  const documentRef = {
    querySelector(selector) {
      calls.push(['querySelector', selector]);
      return masterToggle;
    }
  };

  await withGlobals({
    window: windowRef,
    document: documentRef,
    setTimeout(fn, delay) {
      calls.push(['setTimeout', delay]);
      timers.callbacks.push(fn);
      timers.nextId += 1;
      return timers.nextId;
    },
    clearTimeout(id) {
      calls.push(['clearTimeout', id]);
      timers.cleared.push(id);
    }
  }, async () => callback(timers));
}

test('saveState captures dual-pipeline state and ignores invalid save attempts', () => {
  const runtime = createRuntime({
    pipelineA: [
      createSourcePlugin('Alpha', {
        enabled: false,
        serialized: { nm: 'Alpha', en: false, gain: -1 }
      })
    ],
    pipelineB: [
      createSourcePlugin('Beta', {
        serialized: { nm: 'Beta', en: true, mix: 0.5 }
      })
    ],
    currentPipeline: 'B'
  });
  const manager = new HistoryManager(runtime.pipelineManager);

  manager.saveState();
  assert.deepEqual(manager.history, [{
    pipelineA: [{ nm: 'Alpha', en: false, gain: -1 }],
    pipelineB: [{ nm: 'Beta', en: true, mix: 0.5 }],
    currentPipeline: 'B'
  }]);

  manager.isUndoRedoOperation = true;
  manager.saveState();
  assert.equal(manager.history.length, 1);

  manager.specialSaveOverride = true;
  manager.saveState();
  assert.equal(manager.specialSaveOverride, false);
  assert.equal(manager.history.length, 2);

  manager.isUndoRedoOperation = false;
  manager.history = [{ id: 'old' }, { id: 'discarded' }];
  manager.historyIndex = 0;
  manager.saveState();
  assert.equal(manager.history.length, 2);
  assert.equal(manager.history[0].id, 'old');

  manager.maxHistorySize = 2;
  manager.historyIndex = manager.history.length - 1;
  manager.saveState();
  assert.equal(manager.history.length, 2);
  assert.equal(manager.historyIndex, 1);

  const singleRuntime = createRuntime({
    pipelineA: [createSourcePlugin('Solo')],
    pipelineB: null
  });
  const singleManager = new HistoryManager(singleRuntime.pipelineManager);
  singleManager.saveState();
  assert.deepEqual(singleManager.history[0].pipelineB, null);
});

test('undo and redo guard history boundaries and missing redo state', () => {
  const runtime = createRuntime();
  const manager = new HistoryManager(runtime.pipelineManager);
  const calls = [];
  manager.loadStateFromHistory = () => calls.push(['loadStateFromHistory']);

  manager.history = [{ id: 0 }, { id: 1 }];
  manager.historyIndex = 0;
  manager.undo();
  assert.deepEqual(calls, []);
  assert.equal(manager.historyIndex, 0);

  manager.historyIndex = 1;
  manager.undo();
  assert.equal(manager.historyIndex, 0);
  assert.deepEqual(calls, [['loadStateFromHistory']]);

  manager.redo();
  assert.equal(manager.historyIndex, 1);
  assert.deepEqual(calls, [['loadStateFromHistory'], ['loadStateFromHistory']]);

  manager.redo();
  assert.equal(manager.historyIndex, 1);
  assert.deepEqual(calls, [['loadStateFromHistory'], ['loadStateFromHistory']]);

  manager.history = [{ id: 0 }, undefined];
  manager.historyIndex = 0;
  manager.redo();
  assert.equal(manager.historyIndex, 0);
  assert.deepEqual(calls, [['loadStateFromHistory'], ['loadStateFromHistory']]);
});

test('loadStateFromHistory restores dual pipeline state and resets undo guard', async () => {
  const cleanupCalls = [];
  const runtime = createRuntime({
    pipelineA: [
      createSourcePlugin('ExistingA', { cleanup: true, calls: cleanupCalls }),
      createSourcePlugin('ExistingPlain')
    ],
    pipelineB: [
      createSourcePlugin('ExistingB', { cleanup: true, calls: cleanupCalls }),
      createSourcePlugin('ExistingBPlain')
    ],
    currentPipeline: 'A',
    workletNode: {}
  });
  const manager = new HistoryManager(runtime.pipelineManager);
  manager.undoRedoTimeoutId = 41;
  manager.history = [{
    pipelineA: [
      { nm: 'RestoredA', en: false, gain: -2 },
      { nm: 'MissingA' }
    ],
    pipelineB: [
      { nm: 'RestoredB', ch: 'Left', width: 0.8 }
    ],
    currentPipeline: 'B'
  }];
  manager.historyIndex = 0;
  runtime.pipelineManager.pluginManager.createPlugin = (name) => {
    runtime.calls.push(['createPlugin', name]);
    return name.startsWith('Missing') ? null : createRestoredPlugin(name, runtime.calls);
  };

  await withHistoryGlobals(runtime.calls, {}, async (timers) => {
    manager.loadStateFromHistory();

    assert.deepEqual(cleanupCalls, [
      ['cleanupSource', 'ExistingA'],
      ['cleanupSource', 'ExistingB']
    ]);
    assert.equal(runtime.audioManager.pipelineA.length, 1);
    assert.equal(runtime.audioManager.pipelineA[0].name, 'RestoredA');
    assert.equal(runtime.audioManager.pipelineB.length, 1);
    assert.equal(runtime.audioManager.pipelineB[0].channel, 'L');
    assert.equal(runtime.audioManager.currentPipeline, 'B');
    assert.equal(runtime.audioManager.pipeline, runtime.audioManager.pipelineB);
    assert.equal(runtime.pipelineManager.expandedPlugins.size, 2);
    assert.equal(runtime.core.enabled, true);
    assert.deepEqual(timers.cleared, [41]);
    assert.equal(manager.isUndoRedoOperation, true);

    timers.callbacks.at(-1)();
    assert.equal(manager.isUndoRedoOperation, false);
    assert.equal(manager.undoRedoTimeoutId, null);
  });

  assert.deepEqual(runtime.calls.filter(call => call[0] === 'dispatchEvent'), [
    ['dispatchEvent', 'pipelineChanged', { pipeline: 'B' }]
  ]);
  assert.ok(runtime.calls.some(call => call[0] === 'rebuildPipeline'));
  assert.ok(runtime.calls.some(call => call[0] === 'updatePipelineToggleButton'));
  assert.ok(runtime.calls.some(call => call[0] === 'masterToggleRemove' && call[1] === 'off'));
});

test('loadStateFromHistory handles null pipeline B and absent optional UI', async () => {
  const runtime = createRuntime({
    pipelineA: [],
    pipelineB: null,
    currentPipeline: 'B'
  });
  const manager = new HistoryManager(runtime.pipelineManager);
  manager.history = [{
    pipelineA: [],
    pipelineB: null
  }];
  manager.historyIndex = 0;

  await withHistoryGlobals(runtime.calls, { uiManager: false, masterToggle: false }, async (timers) => {
    manager.loadStateFromHistory();

    assert.equal(runtime.audioManager.pipelineB, null);
    assert.equal(runtime.audioManager.currentPipeline, 'A');
    assert.equal(runtime.audioManager.pipeline, runtime.audioManager.pipelineA);
    assert.equal(runtime.pipelineManager.expandedPlugins.size, 0);
    assert.equal(runtime.core.enabled, true);

    timers.callbacks.at(-1)();
  });

  assert.equal(runtime.calls.some(call => call[0] === 'rebuildPipeline'), false);
  assert.equal(runtime.calls.some(call => call[0] === 'updatePipelineToggleButton'), false);
  assert.ok(runtime.calls.some(call => call[0] === 'querySelector'));
});

test('loadStateFromHistory restores legacy single-pipeline states', async () => {
  const cleanupCalls = [];
  const runtime = createRuntime({
    pipeline: [
      createSourcePlugin('ExistingLegacy', { cleanup: true, calls: cleanupCalls }),
      createSourcePlugin('ExistingLegacyPlain')
    ],
    pipelineA: [],
    pipelineB: null
  });
  const legacyState = [
    { nm: 'LegacyA', en: false, tone: 3 },
    { nm: 'MissingLegacy' }
  ];
  legacyState.pipelineA = [{ nm: 'IgnoredDualMarker' }];

  const manager = new HistoryManager(runtime.pipelineManager);
  manager.history = [legacyState];
  manager.historyIndex = 0;
  runtime.pipelineManager.pluginManager.createPlugin = (name) => {
    runtime.calls.push(['createPlugin', name]);
    return name === 'MissingLegacy' ? null : createRestoredPlugin(name, runtime.calls);
  };

  await withHistoryGlobals(runtime.calls, {}, async (timers) => {
    manager.loadStateFromHistory();

    assert.deepEqual(cleanupCalls, [['cleanupSource', 'ExistingLegacy']]);
    assert.equal(runtime.audioManager.pipeline.length, 1);
    assert.equal(runtime.audioManager.pipeline[0].name, 'LegacyA');
    assert.equal(runtime.audioManager.pipeline[0].enabled, false);
    assert.equal(runtime.pipelineManager.expandedPlugins.size, 1);

    timers.callbacks.at(-1)();
  });

  assert.ok(runtime.calls.some(call => call[0] === 'updatePipelineUI' && call[1] === true));
  assert.ok(runtime.calls.some(call => call[0] === 'updateWorkletPlugins'));
  assert.ok(runtime.calls.some(call => call[0] === 'setMasterBypass' && call[1] === false));
});

test('loadStateFromHistory handles missing history entries through finally cleanup', async () => {
  const runtime = createRuntime();
  const manager = new HistoryManager(runtime.pipelineManager);
  manager.history = [];
  manager.historyIndex = 0;

  await withHistoryGlobals(runtime.calls, {}, async (timers) => {
    manager.loadStateFromHistory();

    assert.equal(manager.isUndoRedoOperation, true);
    assert.equal(timers.callbacks.length, 1);
    timers.callbacks[0]();
    assert.equal(manager.isUndoRedoOperation, false);
    assert.equal(manager.undoRedoTimeoutId, null);
  });

  assert.equal(runtime.calls.some(call => call[0] === 'updatePipelineUI'), false);
  assert.equal(runtime.calls.some(call => call[0] === 'querySelector'), false);
});
