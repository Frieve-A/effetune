import assert from 'node:assert/strict';
import test from 'node:test';

import { PipelineManager } from '../../js/ui/pipeline-manager.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

function createClassList(calls, label) {
  return {
    toggle(className, force) {
      calls.push(['classToggle', label, className, force]);
    },
    add(className) {
      calls.push(['classAdd', label, className]);
    },
    remove(className) {
      calls.push(['classRemove', label, className]);
    },
    contains() {
      return false;
    }
  };
}

class FakeElement {
  constructor(id, calls) {
    this.id = id;
    this.calls = calls;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.value = '';
    this.innerHTML = '';
    this.className = '';
    this.disabled = false;
    this.listeners = {};
    this.classList = createClassList(calls, id);
  }

  addEventListener(type, listener) {
    this.calls.push(['addEventListener', this.id, type]);
    this.listeners[type] = listener;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    this.calls.push(['appendChild', this.id, child.id ?? child.className ?? child.tagName]);
    return child;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  getBoundingClientRect() {
    return { left: 0, right: 100, top: 0, bottom: 100 };
  }

  focus() {
    this.calls.push(['focus', this.id]);
  }
}

function createDocument(calls) {
  const elements = {
    pipelineList: new FakeElement('pipelineList', calls),
    pipelineEmpty: new FakeElement('pipelineEmpty', calls),
    presetSelect: new FakeElement('presetSelect', calls),
    presetClearButton: new FakeElement('presetClearButton', calls),
    savePresetButton: new FakeElement('savePresetButton', calls),
    deletePresetButton: new FakeElement('deletePresetButton', calls),
    presetList: new FakeElement('presetList', calls),
    decreaseColumnsButton: null,
    increaseColumnsButton: null,
    pipeline: new FakeElement('pipeline', calls)
  };

  return {
    elements,
    body: new FakeElement('body', calls),
    head: new FakeElement('head', calls),
    documentElement: new FakeElement('documentElement', calls),
    getElementById(id) {
      calls.push(['getElementById', id]);
      return Object.prototype.hasOwnProperty.call(elements, id) ? elements[id] : null;
    },
    querySelector(selector) {
      calls.push(['querySelector', selector]);
      return null;
    },
    querySelectorAll(selector) {
      calls.push(['documentQuerySelectorAll', selector]);
      return [];
    },
    addEventListener(type, listener) {
      calls.push(['documentAddEventListener', type]);
      elements.documentListeners ??= {};
      elements.documentListeners[type] = listener;
    },
    createElement(tagName) {
      calls.push(['createElement', tagName]);
      return new FakeElement(tagName, calls);
    }
  };
}

function createStorage(calls) {
  const values = new Map([['effetune_presets', JSON.stringify({ Alpha: { plugins: [] } })]]);
  return {
    getItem(key) {
      calls.push(['getItem', key]);
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      calls.push(['setItem', key, value]);
      values.set(key, String(value));
    }
  };
}

async function withManagerGlobals(calls, callback) {
  const timeouts = [];
  const animationCallbacks = [];
  const windowListeners = {};
  const documentRef = createDocument(calls);

  await withGlobals({
    document: documentRef,
    window: {
      electronAPI: null,
      electronIntegration: null,
      uiManager: null,
      addEventListener(type, listener) {
        calls.push(['windowAddEventListener', type]);
        windowListeners[type] = listener;
      }
    },
    localStorage: createStorage(calls),
    setTimeout(fn, delay) {
      calls.push(['setTimeout', delay]);
      timeouts.push(fn);
      return timeouts.length;
    },
    requestAnimationFrame(fn) {
      calls.push(['requestAnimationFrame']);
      animationCallbacks.push(fn);
      return animationCallbacks.length;
    },
    cancelAnimationFrame(id) {
      calls.push(['cancelAnimationFrame', id]);
    },
    console
  }, async () => callback({ documentRef, timeouts, animationCallbacks, windowListeners }));
}

function createDelegatingManager() {
  const calls = [];
  const manager = Object.create(PipelineManager.prototype);
  manager.audioManager = {
    pipeline: ['stale'],
    getCurrentPipeline() {
      calls.push(['getCurrentPipeline']);
      return ['current'];
    }
  };
  manager.core = {
    updatePipelineUI(force) {
      calls.push(['coreUpdatePipelineUI', force]);
    },
    updateSelectionClasses() {
      calls.push(['coreUpdateSelectionClasses']);
    },
    handlePluginSelection(plugin, event, clearExisting) {
      calls.push(['coreHandlePluginSelection', plugin.id, event.type, clearExisting]);
    },
    deleteSelectedPlugins() {
      calls.push(['coreDeleteSelectedPlugins']);
      return 'deleted';
    },
    updateURL() {
      calls.push(['coreUpdateURL']);
    },
    updateWorkletPlugins() {
      calls.push(['coreUpdateWorkletPlugins']);
    },
    updateWorkletPlugin(plugin) {
      calls.push(['coreUpdateWorkletPlugin', plugin.id]);
    },
    getSerializablePluginState(...args) {
      calls.push(['coreGetSerializablePluginState', ...args]);
      return { args };
    }
  };
  manager.historyManager = {
    saveState() {
      calls.push(['historySaveState']);
    },
    undo() {
      calls.push(['historyUndo']);
    },
    redo() {
      calls.push(['historyRedo']);
    }
  };
  manager.presetManager = {
    async loadPreset(nameOrPreset) {
      calls.push(['presetLoadPreset', nameOrPreset]);
    },
    getCurrentPresetData() {
      calls.push(['presetGetCurrentPresetData']);
      return { name: 'Current' };
    }
  };
  manager.clipboardManager = {
    async copySelectedPluginsToClipboard() {
      calls.push(['clipboardCopy']);
      return true;
    },
    async cutSelectedPlugins() {
      calls.push(['clipboardCut']);
      return false;
    }
  };
  manager.fileProcessor = {
    async processDroppedAudioFiles(files) {
      calls.push(['fileProcessDroppedAudioFiles', files.map(file => file.name)]);
    }
  };
  manager.uiEventHandler = {
    initDragAndDrop() {
      calls.push(['uiInitDragAndDrop']);
    }
  };

  return { calls, manager };
}

test('constructor creates collaborators, compatibility properties, and initial history save', async () => {
  const calls = [];
  const audioManager = {
    pipeline: [],
    pipelineA: [],
    pipelineB: null,
    currentPipeline: 'A',
    getCurrentPipeline() {
      return this.pipeline;
    }
  };
  const pluginManager = {};
  const expandedPlugins = new Set();
  const pluginListManager = {};

  await withManagerGlobals(calls, async ({ documentRef, timeouts }) => {
    const manager = new PipelineManager(audioManager, pluginManager, expandedPlugins, pluginListManager);
    await flushMicrotasks();
    await flushMicrotasks();

    assert.equal(manager.audioManager, audioManager);
    assert.equal(manager.pluginManager, pluginManager);
    assert.equal(manager.expandedPlugins, expandedPlugins);
    assert.equal(manager.pluginListManager, pluginListManager);
    assert.equal(manager.core.pipelineManager, manager);
    assert.equal(manager.selectedPlugins, manager.core.selectedPlugins);
    assert.equal(manager.enabled, true);
    assert.equal(manager.pipelineList, documentRef.elements.pipelineList);
    assert.equal(manager.pipelineEmpty, documentRef.elements.pipelineEmpty);
    assert.equal(manager.presetSelect, documentRef.elements.presetSelect);
    assert.equal(manager.savePresetButton, documentRef.elements.savePresetButton);
    assert.equal(manager.deletePresetButton, documentRef.elements.deletePresetButton);

    const timeoutSaveCalls = [];
    manager.historyManager = {
      saveState() {
        timeoutSaveCalls.push('saved');
      }
    };
    assert.equal(timeouts.length, 1);
    timeouts[0]();
    assert.deepEqual(timeoutSaveCalls, ['saved']);

    assert.ok(calls.some(call => call[0] === 'documentAddEventListener' && call[1] === 'keydown'));
    assert.ok(calls.some(call => call[0] === 'documentAddEventListener' && call[1] === 'paste'));
    assert.ok(calls.some(call => call[0] === 'addEventListener' && call[1] === 'pipelineList' && call[2] === 'drop'));
    assert.ok(calls.some(call => call[0] === 'appendChild' && call[1] === 'presetList'));
  });
});

test('facade methods delegate to collaborators and preserve return values', async () => {
  const { calls, manager } = createDelegatingManager();
  const plugin = { id: 3 };
  const files = [{ name: 'track.wav' }];

  manager.initDragAndDrop();
  manager.updatePipelineUI();
  assert.deepEqual(manager.audioManager.pipeline, ['current']);
  manager.updatePipelineUI(true);
  manager.updateSelectionClasses();
  manager.handlePluginSelection(plugin, { type: 'click' });
  manager.handlePluginSelection(plugin, { type: 'keydown' }, false);
  assert.equal(manager.deleteSelectedPlugins(), 'deleted');
  manager.updateURL();
  manager.updateWorkletPlugins();
  manager.updateWorkletPlugin(plugin);
  assert.deepEqual(manager.getSerializablePluginState(plugin), {
    args: [plugin, false, false, false]
  });
  assert.deepEqual(manager.getSerializablePluginState(plugin, true, true, true), {
    args: [plugin, true, true, true]
  });
  manager.saveState();
  manager.undo();
  manager.redo();
  await manager.loadPreset('Factory');
  assert.deepEqual(manager.getCurrentPresetData(), { name: 'Current' });
  assert.equal(await manager.copySelectedPluginsToClipboard(), true);
  assert.equal(await manager.cutSelectedPlugins(), false);
  await manager.processDroppedAudioFiles(files);
  assert.equal(manager.getLocalizedDocPath('/docs/page'), '/docs/page');

  assert.deepEqual(calls, [
    ['uiInitDragAndDrop'],
    ['getCurrentPipeline'],
    ['coreUpdatePipelineUI', false],
    ['getCurrentPipeline'],
    ['coreUpdatePipelineUI', true],
    ['coreUpdateSelectionClasses'],
    ['coreHandlePluginSelection', 3, 'click', true],
    ['coreHandlePluginSelection', 3, 'keydown', false],
    ['coreDeleteSelectedPlugins'],
    ['coreUpdateURL'],
    ['coreUpdateWorkletPlugins'],
    ['coreUpdateWorkletPlugin', 3],
    ['coreGetSerializablePluginState', plugin, false, false, false],
    ['coreGetSerializablePluginState', plugin, true, true, true],
    ['historySaveState'],
    ['historyUndo'],
    ['historyRedo'],
    ['presetLoadPreset', 'Factory'],
    ['presetGetCurrentPresetData'],
    ['clipboardCopy'],
    ['clipboardCut'],
    ['fileProcessDroppedAudioFiles', ['track.wav']]
  ]);
});
