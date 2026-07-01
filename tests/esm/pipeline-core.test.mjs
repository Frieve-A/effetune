import assert from 'node:assert/strict';
import test from 'node:test';

import { PipelineCore } from '../../js/ui/pipeline/pipeline-core.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function createClassList(calls, label) {
  return {
    values: new Set(),
    add(className) {
      this.values.add(className);
      calls.push(['classAdd', label, className]);
    },
    remove(className) {
      this.values.delete(className);
      calls.push(['classRemove', label, className]);
    },
    toggle(className, force) {
      const enabled = force === undefined ? !this.values.has(className) : !!force;
      if (enabled) {
        this.values.add(className);
      } else {
        this.values.delete(className);
      }
      calls.push(['classToggle', label, className, enabled]);
      return enabled;
    },
    contains(className) {
      return this.values.has(className);
    }
  };
}

function createMasterToggle(calls, label = 'master') {
  return {
    title: '',
    onclick: null,
    classList: createClassList(calls, label)
  };
}

function createDocument(calls, options = {}) {
  const pipelineList = options.pipelineList ?? {
    querySelectorAll: () => [],
    querySelector: () => null
  };
  const pipelineEmpty = options.pipelineEmpty ?? { style: {} };
  const elements = {
    pipelineList,
    pipelineEmpty,
    decreaseColumnsButton: options.decreaseButton ?? null,
    increaseColumnsButton: options.increaseButton ?? null,
    pipeline: options.pipelineElement ?? null,
    ...(options.elements ?? {})
  };

  return {
    documentElement: {
      style: {
        setProperty(name, value) {
          calls.push(['setProperty', name, value]);
        }
      }
    },
    getElementById(id) {
      calls.push(['getElementById', id]);
      return Object.prototype.hasOwnProperty.call(elements, id) ? elements[id] : null;
    },
    querySelector(selector) {
      calls.push(['querySelector', selector]);
      if (selector === '.toggle-button.master-toggle') return options.masterToggle ?? null;
      return null;
    },
    querySelectorAll(selector) {
      calls.push(['documentQuerySelectorAll', selector]);
      if (selector === '.pipeline-item') return options.pipelineItems ?? [];
      return [];
    },
    createElement(tagName) {
      calls.push(['createElement', tagName]);
      return { tagName, className: '', dataset: {}, style: {}, children: [], appendChild() {} };
    }
  };
}

function createWindow(calls, options = {}) {
  const listeners = {};
  return {
    listeners,
    workletNode: options.workletNode,
    uiManager: options.uiManager === false ? null : {
      t(key) {
        calls.push(['translate', key]);
        return `T:${key}`;
      },
      updateURL() {
        calls.push(['uiUpdateURL']);
      }
    },
    addEventListener(type, listener) {
      calls.push(['windowAddEventListener', type]);
      listeners[type] = listener;
    }
  };
}

function createStorage(calls, entries = {}) {
  const storage = new Map(Object.entries(entries));
  return {
    getItem(key) {
      calls.push(['getItem', key]);
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      calls.push(['setItem', key, value]);
      storage.set(key, String(value));
    }
  };
}

function createPipelineList(options = {}) {
  return {
    columns: options.columns ?? [],
    childElementCount: options.childElementCount ?? (options.columns?.length ?? 0),
    querySelectorAll(selector) {
      if (selector === '.pipeline-column') return this.columns;
      return [];
    }
  };
}

function createBareCore(options = {}) {
  const calls = [];
  const core = Object.create(PipelineCore.prototype);
  core.audioManager = {
    pipeline: options.pipeline ?? [],
    masterBypass: options.masterBypass ?? false
  };
  core.enabled = options.enabled ?? true;
  core.pluginManager = {};
  core.expandedPlugins = new Set();
  core.pipelineManager = {};
  core.pipelineList = options.pipelineList ?? createPipelineList();
  core.itemBuilder = {
    createPipelineItem(plugin) {
      calls.push(['createPipelineItem', plugin.id]);
      return { pluginId: plugin.id };
    }
  };
  core.selectionManager = {
    selectedPlugins: new Set(),
    updateSelectionClasses() {
      calls.push(['updateSelectionClasses']);
    },
    handlePluginSelection(plugin, event, clearExisting) {
      calls.push(['handlePluginSelection', plugin.id, event.type, clearExisting]);
    },
    handleSectionSelection(plugin, event) {
      calls.push(['handleSectionSelection', plugin.id, event.type]);
    },
    deleteSelectedPlugins() {
      calls.push(['deleteSelectedPlugins']);
      return true;
    }
  };
  core.routingDialog = {
    showRoutingDialog(plugin, button) {
      calls.push(['showRoutingDialog', plugin.id, button.id]);
    },
    updateBusInfo(plugin) {
      calls.push(['updateBusInfo', plugin.id]);
    }
  };
  core.aiDialog = {
    showAIDialog(plugin, button) {
      calls.push(['showAIDialog', plugin.id, button.id]);
    }
  };
  core.columnManager = {
    handleEmptyPipelineState() {
      calls.push(['handleEmptyPipelineState']);
    },
    handleNonEmptyPipelineState() {
      calls.push(['handleNonEmptyPipelineState']);
    },
    rebuildPipelineColumns(columns) {
      calls.push(['rebuildPipelineColumns', columns]);
    },
    distributePluginsToColumns() {
      calls.push(['distributePluginsToColumns']);
    },
    updatePluginListPullTab() {
      calls.push(['updatePluginListPullTab']);
    },
    setupColumnControl() {
      calls.push(['setupColumnControl']);
    },
    updateColumnButtonStates(columns) {
      calls.push(['updateColumnButtonStates', columns]);
    },
    updatePipelineColumns(columns) {
      calls.push(['updatePipelineColumns', columns]);
    },
    setupResponsiveColumnAdjustment() {
      calls.push(['setupResponsiveColumnAdjustment']);
    }
  };
  core.sectionHandler = {
    deleteSectionRange(plugin) {
      calls.push(['deleteSectionRange', plugin.id]);
    },
    moveSectionUp(plugin) {
      calls.push(['moveSectionUp', plugin.id]);
    },
    moveSectionDown(plugin) {
      calls.push(['moveSectionDown', plugin.id]);
    },
    addEndSectionPluginAtPosition(plugins, pipelineLength) {
      calls.push(['addEndSectionPluginAtPosition', plugins.map(plugin => plugin.id), pipelineLength]);
    },
    getPluginSectionState(plugin) {
      calls.push(['getPluginSectionState', plugin.id]);
      return options.sectionState ?? { insideSection: false, sectionEnabled: true };
    }
  };
  core.workletSync = {
    updateMasterBypass(value) {
      calls.push(['updateMasterBypass', value]);
    },
    updateWorkletPlugins() {
      calls.push(['updateWorkletPlugins']);
    },
    updateWorkletPlugin(plugin) {
      calls.push(['updateWorkletPlugin', plugin.id]);
    }
  };

  return { calls, core };
}

async function withPipelineGlobals(options, callback) {
  const calls = options.calls ?? [];
  const animationCallbacks = [];
  const documentRef = options.document ?? createDocument(calls, options);
  const windowRef = options.window ?? createWindow(calls, options);

  await withGlobals({
    document: documentRef,
    window: windowRef,
    localStorage: options.localStorage ?? createStorage(calls, options.storage),
    requestAnimationFrame(fn) {
      calls.push(['requestAnimationFrame']);
      animationCallbacks.push(fn);
      return animationCallbacks.length;
    },
    setTimeout(fn, delay) {
      calls.push(['setTimeout', delay]);
      animationCallbacks.push(fn);
      return animationCallbacks.length;
    },
    clearTimeout(id) {
      calls.push(['clearTimeout', id]);
    },
    console: options.console ?? console
  }, async () => callback({ animationCallbacks, documentRef, windowRef }));
}

test('constructor initializes managers and wires the translated master toggle', async () => {
  const calls = [];
  const masterToggle = createMasterToggle(calls);
  const audioManager = { pipeline: [], masterBypass: false };
  const pluginManager = {};
  const expandedPlugins = new Set(['expanded']);
  const pipelineManager = {};

  await withPipelineGlobals({ calls, masterToggle }, async () => {
    const core = new PipelineCore(audioManager, pluginManager, expandedPlugins, pipelineManager);

    assert.equal(core.audioManager, audioManager);
    assert.equal(core.pluginManager, pluginManager);
    assert.equal(core.expandedPlugins, expandedPlugins);
    assert.equal(core.pipelineManager, pipelineManager);
    assert.equal(core.enabled, true);
    assert.equal(core.selectedPlugins, core.selectionManager.selectedPlugins);
    assert.equal(masterToggle.title, 'T:ui.title.masterToggle');
    assert.equal(typeof masterToggle.onclick, 'function');

    masterToggle.onclick();

    assert.equal(core.enabled, false);
    assert.equal(audioManager.masterBypass, true);
    assert.ok(calls.some(call => call[0] === 'classToggle' && call[2] === 'off' && call[3] === true));
    assert.ok(calls.some(call => call[0] === 'uiUpdateURL'));
    assert.ok(calls.some(call => call[0] === 'windowAddEventListener' && call[1] === 'resize'));
  });
});

test('createMasterToggle handles absent controls and fallback labels', async () => {
  const noToggleCalls = [];
  await withPipelineGlobals({ calls: noToggleCalls, masterToggle: null, uiManager: false }, async () => {
    const { core } = createBareCore();
    core.createMasterToggle();
    assert.equal(core.masterToggle, null);
  });

  const fallbackCalls = [];
  const fallbackToggle = createMasterToggle(fallbackCalls, 'fallback');
  await withPipelineGlobals({ calls: fallbackCalls, masterToggle: fallbackToggle, uiManager: false }, async () => {
    const { core, calls } = createBareCore();
    core.createMasterToggle();
    assert.equal(fallbackToggle.title, 'Enable or disable all effects');

    fallbackToggle.onclick();

    assert.equal(core.enabled, false);
    assert.deepEqual(calls, [
      ['updateMasterBypass', true]
    ]);
  });
});

test('updatePipelineUI handles missing, empty, rebuild, forced, and redistribute paths', async () => {
  const consoleCalls = [];
  const consoleRef = {
    error(message) {
      consoleCalls.push(['error', message]);
    }
  };
  const missing = createBareCore();
  missing.core.pipelineList = null;

  await withPipelineGlobals({ console: consoleRef }, async () => {
    missing.core.updatePipelineUI();
  });
  assert.deepEqual(consoleCalls, [['error', 'pipelineList element not found in PipelineCore']]);

  const empty = createBareCore({ pipeline: [] });
  await withPipelineGlobals({}, async () => {
    empty.core.updatePipelineUI();
  });
  assert.deepEqual(empty.calls, [['handleEmptyPipelineState']]);

  const mismatch = createBareCore({
    pipeline: [{ id: 1 }],
    pipelineList: createPipelineList({ columns: [], childElementCount: 0 })
  });
  await withPipelineGlobals({ storage: { pipelineColumns: '2' } }, async ({ animationCallbacks }) => {
    mismatch.core.updatePipelineUI();
    animationCallbacks.splice(0).forEach(fn => fn());
  });
  assert.deepEqual(mismatch.calls, [
    ['handleNonEmptyPipelineState'],
    ['rebuildPipelineColumns', 2],
    ['updateSelectionClasses'],
    ['updatePluginListPullTab']
  ]);

  const forced = createBareCore({
    pipeline: [{ id: 1 }],
    pipelineList: createPipelineList({ columns: [{}, {}], childElementCount: 2 })
  });
  await withPipelineGlobals({ storage: { pipelineColumns: '2' } }, async ({ animationCallbacks }) => {
    forced.core.updatePipelineUI(true);
    animationCallbacks.splice(0).forEach(fn => fn());
  });
  assert.deepEqual(forced.calls, [
    ['handleNonEmptyPipelineState'],
    ['rebuildPipelineColumns', 2],
    ['updateSelectionClasses'],
    ['updatePluginListPullTab']
  ]);

  const emptyChildren = createBareCore({
    pipeline: [{ id: 1 }],
    pipelineList: createPipelineList({ columns: [{}], childElementCount: 0 })
  });
  await withPipelineGlobals({}, async ({ animationCallbacks }) => {
    emptyChildren.core.updatePipelineUI();
    animationCallbacks.splice(0).forEach(fn => fn());
  });
  assert.deepEqual(emptyChildren.calls, [
    ['handleNonEmptyPipelineState'],
    ['rebuildPipelineColumns', 1],
    ['updateSelectionClasses'],
    ['updatePluginListPullTab']
  ]);

  const distribute = createBareCore({
    pipeline: [{ id: 1 }],
    pipelineList: createPipelineList({ columns: [{}], childElementCount: 1 })
  });
  await withPipelineGlobals({}, async ({ animationCallbacks }) => {
    distribute.core.updatePipelineUI(false);
    animationCallbacks.splice(0).forEach(fn => fn());
  });
  assert.deepEqual(distribute.calls, [
    ['handleNonEmptyPipelineState'],
    ['distributePluginsToColumns'],
    ['updateSelectionClasses'],
    ['updatePluginListPullTab']
  ]);
});

test('delegating methods forward calls to their managers', () => {
  const { calls, core } = createBareCore();
  const plugin = { id: 7 };
  const button = { id: 'button' };
  const sectionPlugins = [{ id: 8 }];

  assert.deepEqual(core.createPipelineItem(plugin), { pluginId: 7 });
  core.rebuildPipelineColumns(3);
  core.distributePluginsToColumns();
  core.updateSelectionClasses();
  core.handlePluginSelection(plugin, { type: 'click' });
  core.handlePluginSelection(plugin, { type: 'keydown' }, false);
  core.handleSectionSelection(plugin, { type: 'section-click' });
  core.deleteSectionRange(plugin);
  core.moveSectionUp(plugin);
  core.moveSectionDown(plugin);
  core.addEndSectionPluginAtPosition(sectionPlugins, 4);
  assert.equal(core.deleteSelectedPlugins(), true);
  core.updateWorkletPlugins();
  core.updateWorkletPlugin(plugin);
  core.showRoutingDialog(plugin, button);
  core.showAIDialog(plugin, button);
  core.updateBusInfo(plugin);
  assert.deepEqual(core.getPluginSectionState(plugin), { insideSection: false, sectionEnabled: true });
  core.setupColumnControl();
  core.updateColumnButtonStates(5);
  core.updatePipelineColumns(6);
  core.updatePluginListPullTab();
  core.setupResponsiveColumnAdjustment();

  assert.deepEqual(calls, [
    ['createPipelineItem', 7],
    ['rebuildPipelineColumns', 3],
    ['distributePluginsToColumns'],
    ['updateSelectionClasses'],
    ['handlePluginSelection', 7, 'click', true],
    ['handlePluginSelection', 7, 'keydown', false],
    ['handleSectionSelection', 7, 'section-click'],
    ['deleteSectionRange', 7],
    ['moveSectionUp', 7],
    ['moveSectionDown', 7],
    ['addEndSectionPluginAtPosition', [8], 4],
    ['deleteSelectedPlugins'],
    ['updateWorkletPlugins'],
    ['updateWorkletPlugin', 7],
    ['showRoutingDialog', 7, 'button'],
    ['showAIDialog', 7, 'button'],
    ['updateBusInfo', 7],
    ['getPluginSectionState', 7],
    ['setupColumnControl'],
    ['updateColumnButtonStates', 5],
    ['updatePipelineColumns', 6],
    ['updatePluginListPullTab'],
    ['setupResponsiveColumnAdjustment']
  ]);
});

test('updateURL runs only when an UI manager is present', async () => {
  const present = createBareCore();
  const presentCalls = [];
  await withPipelineGlobals({ calls: presentCalls }, async () => {
    present.core.updateURL();
  });
  assert.deepEqual(presentCalls, [['uiUpdateURL']]);

  const absent = createBareCore();
  const absentCalls = [];
  await withPipelineGlobals({ calls: absentCalls, uiManager: false }, async () => {
    absent.core.updateURL();
  });
  assert.deepEqual(absentCalls, []);
});

test('serializable state supports short, copied short, default long, and copied long output', () => {
  const { core } = createBareCore();
  const plugin = {
    name: 'Tone',
    enabled: true,
    inputBus: 1,
    outputBus: 2,
    channel: 'L',
    getSerializableParameters() {
      return {
        id: 99,
        type: 'ignored',
        enabled: false,
        gain: { value: -3 }
      };
    }
  };

  const shortState = core.getSerializablePluginState(plugin, true);
  assert.deepEqual(shortState, {
    gain: { value: -3 },
    nm: 'Tone',
    en: true,
    ib: 1,
    ob: 2,
    ch: 'L'
  });

  const copiedShort = core.getSerializablePluginState(plugin, true, true);
  copiedShort.gain.value = -12;
  assert.equal(shortState.gain.value, -3);

  assert.deepEqual(core.getSerializablePluginState(plugin), {
    name: 'Tone',
    enabled: true,
    parameters: { type: 'ignored', gain: { value: -3 } },
    inputBus: 1,
    outputBus: 2,
    channel: 'L'
  });

  const copiedLong = core.getSerializablePluginState(plugin, false, true);
  assert.deepEqual(copiedLong.parameters, { type: 'ignored', gain: { value: -3 } });
});

test('plugin display state combines master bypass, plugin enabled, and section state', () => {
  const { calls, core } = createBareCore();
  const plugin = { id: 1, enabled: true };
  const nameElement = {
    classList: {
      toggle(className, force) {
        calls.push(['nameToggle', className, force]);
      }
    }
  };
  const sectionStates = [
    { insideSection: false, sectionEnabled: true },
    { insideSection: true, sectionEnabled: false },
    { insideSection: true, sectionEnabled: true },
    { insideSection: false, sectionEnabled: true }
  ];
  core.sectionHandler.getPluginSectionState = currentPlugin => {
    calls.push(['getPluginSectionState', currentPlugin.id]);
    return sectionStates.shift();
  };

  core.audioManager.masterBypass = false;
  core.updatePluginNameDisplayState(plugin, nameElement);

  core.audioManager.masterBypass = false;
  core.updatePluginNameDisplayState(plugin, nameElement);

  core.audioManager.masterBypass = true;
  core.updatePluginNameDisplayState(plugin, nameElement);

  core.audioManager.masterBypass = false;
  plugin.enabled = false;
  core.updatePluginNameDisplayState(plugin, nameElement);

  assert.deepEqual(calls, [
    ['getPluginSectionState', 1],
    ['nameToggle', 'plugin-disabled', false],
    ['getPluginSectionState', 1],
    ['nameToggle', 'plugin-disabled', true],
    ['getPluginSectionState', 1],
    ['nameToggle', 'plugin-disabled', true],
    ['getPluginSectionState', 1],
    ['nameToggle', 'plugin-disabled', true]
  ]);
});

test('updateAllPluginDisplayState updates matching items and ignores missing data', async () => {
  const { calls, core } = createBareCore({
    pipeline: [{ id: 1 }, { id: 2 }]
  });
  const nameElement = { id: 'name' };
  const pipelineItems = [
    {
      dataset: { pluginId: '1' },
      querySelector(selector) {
        calls.push(['itemQuerySelector', 'one', selector]);
        return nameElement;
      }
    },
    {
      dataset: { pluginId: '2' },
      querySelector(selector) {
        calls.push(['itemQuerySelector', 'two', selector]);
        return null;
      }
    },
    {
      dataset: { pluginId: '404' },
      querySelector(selector) {
        calls.push(['itemQuerySelector', 'missing', selector]);
        return nameElement;
      }
    }
  ];
  const documentCalls = [];
  const documentRef = createDocument(documentCalls, { pipelineItems });

  core.updatePluginNameDisplayState = (plugin, element) => {
    calls.push(['updatePluginNameDisplayState', plugin.id, element.id]);
  };

  await withPipelineGlobals({ calls: documentCalls, document: documentRef }, async () => {
    core.updateAllPluginDisplayState();
  });

  assert.deepEqual(calls, [
    ['itemQuerySelector', 'one', '.plugin-name'],
    ['updatePluginNameDisplayState', 1, 'name'],
    ['itemQuerySelector', 'two', '.plugin-name']
  ]);
  assert.deepEqual(documentCalls, [['documentQuerySelectorAll', '.pipeline-item']]);
});
