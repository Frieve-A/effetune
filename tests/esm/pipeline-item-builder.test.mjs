import assert from 'node:assert/strict';
import test from 'node:test';

import { PipelineItemBuilder } from '../../js/ui/pipeline/pipeline-item-builder.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  _tokens() {
    return new Set(String(this.element.className || '').split(/\s+/).filter(Boolean));
  }

  _write(tokens) {
    this.element.className = [...tokens].join(' ');
  }

  contains(token) {
    return this._tokens().has(token);
  }

  add(token) {
    const tokens = this._tokens();
    tokens.add(token);
    this._write(tokens);
  }

  remove(token) {
    const tokens = this._tokens();
    tokens.delete(token);
    this._write(tokens);
  }

  toggle(token, force) {
    const tokens = this._tokens();
    const shouldAdd = force === undefined ? !tokens.has(token) : !!force;
    if (shouldAdd) {
      tokens.add(token);
    } else {
      tokens.delete(token);
    }
    this._write(tokens);
    return shouldAdd;
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.eventListeners = new Map();
    this.className = '';
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.textContent = '';
    this.innerHTML = '';
    this.title = '';
    this.draggable = false;
    this.onclick = null;
    this.type = '';
    this.classList = new FakeClassList(this);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type).push(listener);
  }

  dispatch(type, event = {}) {
    const eventObject = createEvent(event.target ?? this, { ...event, type });
    for (const listener of this.eventListeners.get(type) || []) {
      listener(eventObject);
    }
    return eventObject;
  }

  matches(selector) {
    return selector.split(',').some(rawSelector => this._matchesSingle(rawSelector.trim()));
  }

  _matchesSingle(selector) {
    if (!selector) return false;
    const dataMatch = selector.match(/^\[data-plugin-id="([^"]+)"\]$/);
    if (dataMatch) {
      return String(this.dataset.pluginId) === dataMatch[1];
    }
    const classDataMatch = selector.match(/^\.([\w-]+)\[data-plugin-id="([^"]+)"\]$/);
    if (classDataMatch) {
      return this.classList.contains(classDataMatch[1]) && String(this.dataset.pluginId) === classDataMatch[2];
    }
    if (selector.startsWith('.')) {
      return this.classList.contains(selector.slice(1));
    }
    if (selector === 'button') {
      return this.tagName === 'BUTTON';
    }
    if (selector === 'input') {
      return this.tagName === 'INPUT';
    }
    if (selector === 'select') {
      return this.tagName === 'SELECT';
    }
    if (selector === 'input[type="range"]') {
      return this.tagName === 'INPUT' && this.type === 'range';
    }
    if (selector === 'input, button, select') {
      return ['INPUT', 'BUTTON', 'SELECT'].includes(this.tagName);
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const visit = element => {
      for (const child of element.children) {
        if (child.matches(selector)) {
          results.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return results;
  }
}

function createDocument() {
  const allElements = [];
  const document = {
    body: null,
    createElement(tagName) {
      const element = new FakeElement(tagName, document);
      allElements.push(element);
      return element;
    },
    querySelector(selector) {
      return document.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      return allElements.filter(element => element.matches(selector));
    }
  };
  document.body = document.createElement('body');
  return document;
}

function createEvent(target, options = {}) {
  return {
    target,
    type: options.type ?? '',
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    stopped: false,
    stopPropagation() {
      this.stopped = true;
    },
    preventDefault() {}
  };
}

class TestPlugin {
  constructor(options = {}) {
    Object.assign(this, {
      id: options.id ?? 1,
      name: options.name ?? 'Tone Control',
      enabled: options.enabled ?? true,
      inputBus: options.inputBus ?? null,
      outputBus: options.outputBus ?? null,
      channel: options.channel ?? null,
      defaultParameters: options.defaultParameters ?? { gain: 1 },
      parameters: options.parameters ?? { gain: 0.5 },
      saveStateTimeout: options.saveStateTimeout ?? null,
      _suppressParameterHistory: options.suppressHistory ?? false,
      updateMarkers: options.updateMarkers,
      updateResponse: options.updateResponse,
      _setSectionEnabled: options.setSectionEnabled
    });
    if (options.withUpdateParameters) {
      this.updateParameters = (...args) => {
        this.updateCalls = [...(this.updateCalls || []), args];
      };
    }
  }

  setEnabled(value) {
    this.enabled = value;
  }

  setParameters(parameters) {
    this.parameters = parameters;
  }

  getParameters() {
    return { ...this.parameters };
  }

  createUI() {
    const ui = document.createElement('div');
    ui.className = 'created-ui';
    return ui;
  }
}

class SectionPlugin extends TestPlugin {
  constructor(options = {}) {
    super({ ...options, name: 'Section' });
    this.cm = options.cm ?? '';
  }
}

function createCore(options = {}) {
  const calls = [];
  const historyManager = options.noHistory ? null : {
    isUndoRedoOperation: options.isUndoRedoOperation ?? false,
    saveState() {
      calls.push(['saveState']);
    }
  };
  const pipelineManager = options.noPipelineManager ? null : {
    historyManager,
    uiEventHandler: options.noDragHandler ? null : {
      setupDragEvents(handle, item, plugin) {
        calls.push(['setupDragEvents', handle.className, item.dataset.pluginId, plugin.name]);
      }
    }
  };
  const audioManager = {
    pipeline: options.pipeline ?? [],
    pipelineManager
  };
  const core = {
    calls,
    audioManager,
    pluginManager: {
      effectCategories: options.effectCategories ?? {
        Dynamics: { plugins: ['Tone Control', 'Loud Tool'] },
        Analyzer: { plugins: ['Analyzer'] }
      }
    },
    expandedPlugins: options.expandedPlugins ?? new Set(),
    selectedPlugins: options.selectedPlugins ?? new Set(),
    pipelineManager,
    updatePluginNameDisplayState(plugin, element) {
      calls.push(['updatePluginNameDisplayState', plugin.name, element.className]);
    },
    handlePluginSelection(plugin, event, preserve) {
      calls.push(['handlePluginSelection', plugin.name, preserve ?? null, !!event.shiftKey]);
    },
    handleSectionSelection(plugin, event) {
      calls.push(['handleSectionSelection', plugin.name, !!event.shiftKey]);
    },
    updateSelectionClasses() {
      calls.push(['updateSelectionClasses']);
    },
    showRoutingDialog(plugin, anchor) {
      calls.push(['showRoutingDialog', plugin.name, anchor.className]);
    },
    updateWorkletPlugin(plugin) {
      calls.push(['updateWorkletPlugin', plugin.name]);
    },
    updateAllPluginDisplayState() {
      calls.push(['updateAllPluginDisplayState']);
    },
    updateWorkletPlugins() {
      calls.push(['updateWorkletPlugins']);
    },
    updatePipelineUI(force) {
      calls.push(['updatePipelineUI', force ?? null]);
    },
    moveSectionUp(plugin) {
      calls.push(['moveSectionUp', plugin.name]);
    },
    moveSectionDown(plugin) {
      calls.push(['moveSectionDown', plugin.name]);
    },
    showAIDialog(plugin, anchor) {
      calls.push(['showAIDialog', plugin.name, anchor.className]);
    },
    deleteSectionRange(plugin) {
      calls.push(['deleteSectionRange', plugin.name]);
    },
    deleteSelectedPlugins() {
      calls.push(['deleteSelectedPlugins']);
    }
  };
  return core;
}

function find(element, selector) {
  const result = element.querySelector(selector);
  assert.ok(result, `Expected ${selector}`);
  return result;
}

async function withBuilderGlobals(options, callback) {
  const calls = [];
  const documentRef = createDocument();
  const timers = [];
  let now = 1000;
  const rafCallbacks = [];
  await withGlobals({
    document: documentRef,
    window: {
      uiManager: options.uiManager === false ? null : {
        t: key => `t:${key}`,
        getLocalizedDocPath: path => `localized:${path}`,
        updateURL: () => calls.push(['updateURL'])
      },
      electronAPI: options.electronAPI,
      workletNode: options.workletNode
    },
    requestAnimationFrame(callback) {
      rafCallbacks.push(callback);
      callback();
      return rafCallbacks.length;
    },
    setTimeout(callback, delay) {
      timers.push({ callback, delay, cleared: false });
      return timers.length;
    },
    clearTimeout(id) {
      if (timers[id - 1]) timers[id - 1].cleared = true;
      calls.push(['clearTimeout', id]);
    },
    Date: { now: () => now }
  }, async () => {
    await callback({
      calls,
      documentRef,
      timers,
      setNow(value) {
        now = value;
      },
      runTimers() {
        for (const timer of timers) {
          if (!timer.cleared) timer.callback();
        }
      }
    });
  });
}

test('creates pipeline items and exercises header controls for regular plugins', async () => {
  await withBuilderGlobals({
    electronAPI: {
      openExternalUrl: async url => {
        assert.equal(url, 'localized:/plugins/dynamics#tone-control');
      }
    }
  }, async ({ documentRef }) => {
    const before = new TestPlugin({ id: 1, name: 'Before' });
    const plugin = new TestPlugin({ id: 2, name: 'Tone Control', inputBus: 0, outputBus: 2, channel: 'L' });
    const after = new TestPlugin({ id: 3, name: 'After' });
    const core = createCore({ pipeline: [before, plugin, after] });
    const builder = new PipelineItemBuilder(core);
    const item = builder.createPipelineItem(plugin);
    documentRef.body.appendChild(item);

    assert.equal(item.className, 'pipeline-item');
    assert.equal(item.dataset.pluginId, 2);
    assert.ok(core.calls.some(call => call[0] === 'setupDragEvents'));
    const header = find(item, '.pipeline-item-header');
    const actions = find(item, '.plugin-header-actions');
    assert.equal(actions.parentNode, header);
    assert.equal(find(item, '.bus-info').parentNode, header);
    assert.equal(find(item, '.routing-button').parentNode, actions);
    assert.equal(find(item, '.delete-button').parentNode, actions);

    item.dispatch('click', { target: find(item, '.plugin-ui') });
    item.dispatch('click', { target: find(item, '.plugin-name') });
    item.dispatch('click', { target: find(item, '.routing-button') });
    core.selectedPlugins.add(plugin);
    item.dispatch('click', { target: item, ctrlKey: true });
    item.dispatch('touchstart', { target: item, metaKey: true });
    item.dispatch('click', { target: item });
    assert.ok(core.calls.some(call => call[0] === 'updateSelectionClasses'));

    find(item, '.handle').dispatch('mousedown', { target: item });
    find(item, '.toggle-button').onclick(createEvent(find(item, '.toggle-button')));
    assert.equal(plugin.enabled, false);
    assert.ok(core.calls.some(call => call[0] === 'updateWorkletPlugin'));

    find(item, '.bus-info').onclick(createEvent(find(item, '.bus-info')));
    find(item, '.routing-button').onclick(createEvent(find(item, '.routing-button')));
    plugin.saveStateTimeout = 1;
    find(item, '.reset-effect-button').onclick(createEvent(find(item, '.reset-effect-button')));
    assert.deepEqual(plugin.parameters, { gain: 1 });

    find(item, '.move-up-button').onclick(createEvent(find(item, '.move-up-button')));
    assert.deepEqual(core.audioManager.pipeline.map(p => p.name), ['Tone Control', 'Before', 'After']);
    find(item, '.move-down-button').onclick(createEvent(find(item, '.move-down-button')));
    assert.deepEqual(core.audioManager.pipeline.map(p => p.name), ['Before', 'Tone Control', 'After']);

    find(item, '.ai-button').onclick(createEvent(find(item, '.ai-button')));
    find(item, '.help-button').onclick(createEvent(find(item, '.help-button')));
    find(item, '.delete-button').onclick(createEvent(find(item, '.delete-button')));

    const input = documentRef.createElement('input');
    const range = documentRef.createElement('input');
    range.type = 'range';
    const ui = find(item, '.plugin-ui');
    ui.dispatch('mousedown', { target: input });
    ui.dispatch('mousedown', { target: range });
    ui.dispatch('mousedown', { target: ui });

    assert.ok(core.calls.some(call => call[0] === 'showRoutingDialog'));
    assert.ok(core.calls.some(call => call[0] === 'showAIDialog'));
    assert.ok(core.calls.some(call => call[0] === 'deleteSelectedPlugins'));
    assert.ok(core.calls.filter(call => call[0] === 'saveState').length >= 1);
  });
});

test('pipeline item blank areas select without stealing plugin control taps', async () => {
  await withBuilderGlobals({}, async ({ documentRef }) => {
    const plugin = new TestPlugin({ id: 40, name: 'Tone Control' });
    const core = createCore({ pipeline: [plugin] });
    const builder = new PipelineItemBuilder(core);
    const item = builder.createPipelineItem(plugin);
    documentRef.body.appendChild(item);

    const ui = find(item, '.plugin-ui');
    const selectionCount = () => core.calls.filter(call => call[0] === 'handlePluginSelection').length;

    let before = selectionCount();
    item.dispatch('click', { target: ui });
    assert.equal(selectionCount(), before + 1);

    const blankChild = documentRef.createElement('div');
    blankChild.className = 'blank-space';
    ui.appendChild(blankChild);
    before = selectionCount();
    const touchEvent = item.dispatch('touchstart', { target: blankChild });
    assert.equal(selectionCount(), before + 1);
    assert.equal(touchEvent.stopped, true);

    const pluginContainer = documentRef.createElement('div');
    pluginContainer.className = 'tone-control-plugin-ui plugin-parameter-ui';
    ui.appendChild(pluginContainer);
    before = selectionCount();
    const clickEvent = item.dispatch('click', { target: pluginContainer });
    assert.equal(selectionCount(), before + 1);
    assert.equal(clickEvent.stopped, true);

    const parameterRow = documentRef.createElement('div');
    parameterRow.className = 'parameter-row';
    ui.appendChild(parameterRow);
    before = selectionCount();
    item.dispatch('click', { target: parameterRow });
    assert.equal(selectionCount(), before);

    const input = documentRef.createElement('input');
    parameterRow.appendChild(input);
    before = selectionCount();
    item.dispatch('click', { target: input });
    assert.equal(selectionCount(), before);

    const graph = documentRef.createElement('div');
    graph.className = 'response-graph';
    ui.appendChild(graph);
    before = selectionCount();
    item.dispatch('click', { target: graph });
    assert.equal(selectionCount(), before);

    const canvas = documentRef.createElement('canvas');
    ui.appendChild(canvas);
    before = selectionCount();
    item.dispatch('click', { target: canvas });
    assert.equal(selectionCount(), before);
  });
});

test('section items wire section-specific buttons, selection, and animation propagation', async () => {
  await withBuilderGlobals({}, async ({ documentRef }) => {
    const section = new SectionPlugin({ id: 10, cm: 'Intro', inputBus: 1, channel: 'R' });
    const inside = new TestPlugin({
      id: 11,
      name: 'Inside',
      setSectionEnabled(value) {
        this.sectionEnabled = value;
      }
    });
    const nextSection = new SectionPlugin({ id: 12 });
    const core = createCore({ pipeline: [section, inside, nextSection] });
    const builder = new PipelineItemBuilder(core);
    const item = builder.createPipelineItem(section);
    documentRef.body.appendChild(item);

    assert.equal(item.className, 'pipeline-item section');
    assert.equal(find(item, '.plugin-name').textContent, 'Intro Section');
    assert.equal(item.querySelector('.routing-button'), null);

    item.dispatch('click', { target: item });
    find(item, '.bus-info').onclick(createEvent(find(item, '.bus-info')));
    find(item, '.toggle-button').onclick(createEvent(find(item, '.toggle-button')));
    assert.equal(inside.sectionEnabled, false);

    find(item, '.move-up-button').onclick(createEvent(find(item, '.move-up-button'), { shiftKey: true }));
    find(item, '.move-down-button').onclick(createEvent(find(item, '.move-down-button'), { shiftKey: true }));
    find(item, '.delete-button').onclick(createEvent(find(item, '.delete-button'), { shiftKey: true }));

    assert.ok(core.calls.some(call => call[0] === 'handleSectionSelection'));
    assert.ok(core.calls.some(call => call[0] === 'moveSectionUp'));
    assert.ok(core.calls.some(call => call[0] === 'moveSectionDown'));
    assert.ok(core.calls.some(call => call[0] === 'deleteSectionRange'));

    builder._propagateSectionEnabledToAnimations(new SectionPlugin({ id: 99 }));
    const noPipelineBuilder = new PipelineItemBuilder(createCore({ pipeline: null }));
    noPipelineBuilder.audioManager.pipeline = null;
    noPipelineBuilder._propagateSectionEnabledToAnimations(section);
  });
});

test('bus labels, fallback titles, reset guards, and movement boundaries handle edge cases', async () => {
  await withBuilderGlobals({ uiManager: false }, async () => {
    const core = createCore({ pipeline: [] });
    const builder = new PipelineItemBuilder(core);
    const item = document.createElement('div');
    const header = document.createElement('div');
    for (const channel of ['A', '34', '56', '78', '3', 'custom']) {
      const plugin = new TestPlugin({ id: 20 + header.children.length, inputBus: null, outputBus: 0, channel });
      builder.addBusInfo(header, plugin, item);
    }
    builder.addBusInfo(header, new TestPlugin({ id: 30, inputBus: null, outputBus: null, channel: null }), item);
    assert.equal(header.querySelectorAll('.bus-info').length, 6);

    assert.equal(builder.createToggleButton(new TestPlugin()).title, 'Enable or disable effect');
    assert.equal(builder.createPluginName(new SectionPlugin()).textContent, 'Section');
    assert.equal(builder.createRoutingButton(new TestPlugin()).title, 'Configure bus routing');
    assert.equal(builder.createResetButton(new TestPlugin()).title, 'Reset effect settings');
    assert.equal(builder.createMoveUpButton(new TestPlugin()).title, 'Move effect up');
    assert.equal(builder.createMoveDownButton(new TestPlugin()).title, 'Move effect down');
    assert.equal(builder.createAIButton(new TestPlugin()).title, 'Ask AI about this effector');
    assert.equal(builder.createHelpButton(new TestPlugin()).title, 'Open plugin documentation');
    assert.equal(builder.createDeleteButton(new TestPlugin()).title, 'Delete effect');

    builder.resetPluginToDefaults(null);
    builder.resetPluginToDefaults({});
    const noDefaultPlugin = new TestPlugin({ defaultParameters: undefined });
    delete noDefaultPlugin.defaultParameters;
    builder.resetPluginToDefaults(noDefaultPlugin);

    const first = new TestPlugin({ id: 31, name: 'First' });
    const last = new TestPlugin({ id: 32, name: 'Last' });
    core.audioManager.pipeline = [first, last];
    builder.createMoveUpButton(first).onclick(createEvent(document.createElement('button')));
    builder.createMoveDownButton(last).onclick(createEvent(document.createElement('button')));
    assert.deepEqual(core.audioManager.pipeline.map(p => p.name), ['First', 'Last']);

    const noHistoryCore = createCore({ pipeline: [first, last], noHistory: true });
    const noHistoryBuilder = new PipelineItemBuilder(noHistoryCore);
    noHistoryBuilder.resetPluginToDefaults(noDefaultPlugin);
    noHistoryBuilder.createMoveDownButton(first).onclick(createEvent(document.createElement('button')));
    noHistoryBuilder.createToggleButton(first).onclick(createEvent(document.createElement('button')));
  });
});

test('help button opens browser links, Electron fallback links, and uncategorized help', async () => {
  const opened = [];
  await withBuilderGlobals({ uiManager: false }, async () => {
    window.open = (...args) => opened.push(args);
    const core = createCore({ pipeline: [] });
    const builder = new PipelineItemBuilder(core);
    builder.createHelpButton(new TestPlugin({ name: 'Tone Control' })).onclick(createEvent(document.createElement('button')));
    builder.createHelpButton(new TestPlugin({ name: 'Missing' })).onclick(createEvent(document.createElement('button')));
    assert.deepEqual(opened[0], ['/plugins/dynamics#tone-control', '_blank']);
  });

  const fallbackOpened = [];
  await withBuilderGlobals({
    electronAPI: {
      openExternalUrl: async () => {
        throw new Error('open failed');
      }
    }
  }, async () => {
    window.open = (...args) => fallbackOpened.push(args);
    const builder = new PipelineItemBuilder(createCore({ pipeline: [] }));
    builder.createHelpButton(new TestPlugin({ name: 'Tone Control' })).onclick(createEvent(document.createElement('button')));
    await flushMicrotasks();
    assert.equal(fallbackOpened[0][0], 'localized:/plugins/dynamics#tone-control');
  });
});

test('parameter update wrapping updates worklet, history, section names, timers, and suppression state', async () => {
  await withBuilderGlobals({
    workletNode: {
      port: {
        postMessage(message) {
          window.workletMessages = [...(window.workletMessages || []), message];
        }
      }
    }
  }, async ({ documentRef, timers, setNow, runTimers }) => {
    const section = new SectionPlugin({ id: 40, cm: 'Old', withUpdateParameters: true });
    const core = createCore({ pipeline: [section] });
    const builder = new PipelineItemBuilder(core);
    const originalUpdateParameters = section.updateParameters;
    const item = builder.createPipelineItem(section);
    documentRef.body.appendChild(item);

    section.cm = 'New';
    section.parameters = { gain: 2 };
    section.saveStateTimeout = 1;
    builder.setupParameterUpdateHandling(section);
    assert.equal(section._pipelineOriginalUpdateParameters, originalUpdateParameters);
    section.updateParameters('first');
    assert.equal(find(item, '.plugin-name').textContent, 'New Section');
    assert.equal(window.workletMessages[0].plugin.parameters.gain, 2);
    assert.ok(core.calls.some(call => call[0] === 'saveState'));
    assert.ok(timers.some(timer => timer.delay === 500));

    setNow(1800);
    section.cm = '';
    section.updateParameters('later');
    assert.equal(find(item, '.plugin-name').textContent, 'Section');
    runTimers();
    assert.equal(section.paramChangeStarted, false);

    section._suppressParameterHistory = true;
    section.updateParameters('suppressed');

    core.pipelineManager.historyManager.isUndoRedoOperation = true;
    section._suppressParameterHistory = false;
    section.updateParameters('undo');

    const alreadyWrapped = new TestPlugin({ withUpdateParameters: true });
    alreadyWrapped._pipelineUpdateParametersWrapped = true;
    builder.setupParameterUpdateHandling(alreadyWrapped);
    builder.setupParameterUpdateHandling(new TestPlugin());
  });

  await withBuilderGlobals({ uiManager: false }, async () => {
    const section = new SectionPlugin({ id: 41, cm: 'NoItem', withUpdateParameters: true });
    const builder = new PipelineItemBuilder(createCore({ pipeline: [section], noPipelineManager: true }));
    builder.setupParameterUpdateHandling(section);
    section.updateParameters();
  });
});

test('name clicks toggle individual, global, and section expansion behavior', async () => {
  await withBuilderGlobals({}, async ({ documentRef }) => {
    const plugin = new TestPlugin({
      id: 50,
      name: 'Tone Control',
      updateMarkers() { this.markersUpdated = true; },
      updateResponse() { this.responseUpdated = true; }
    });
    const analyzer = new TestPlugin({ id: 51, name: 'Analyzer' });
    const missing = new TestPlugin({ id: 52, name: 'Missing' });
    const noUi = new TestPlugin({ id: 53, name: 'No Ui' });
    const noName = new TestPlugin({ id: 54, name: 'No Name' });
    const core = createCore({ pipeline: [plugin, analyzer, missing, noUi, noName] });
    const builder = new PipelineItemBuilder(core);
    const item = builder.createPipelineItem(plugin);
    const analyzerItem = builder.createPipelineItem(analyzer);
    const brokenItem = documentRef.createElement('div');
    brokenItem.className = 'pipeline-item';
    brokenItem.dataset.pluginId = '999';
    const noUiItem = documentRef.createElement('div');
    noUiItem.className = 'pipeline-item';
    noUiItem.dataset.pluginId = String(noUi.id);
    const noNameItem = documentRef.createElement('div');
    noNameItem.className = 'pipeline-item';
    noNameItem.dataset.pluginId = String(noName.id);
    const noNameUi = documentRef.createElement('div');
    noNameUi.className = 'plugin-ui';
    noNameItem.appendChild(noNameUi);
    documentRef.body.appendChild(item);
    documentRef.body.appendChild(analyzerItem);
    documentRef.body.appendChild(brokenItem);
    documentRef.body.appendChild(noUiItem);
    documentRef.body.appendChild(noNameItem);

    const name = find(item, '.plugin-name');
    name.onclick(createEvent(name));
    assert.equal(find(item, '.plugin-ui').classList.contains('expanded'), true);
    assert.equal(plugin.markersUpdated, true);
    name.onclick(createEvent(name));
    assert.equal(find(item, '.plugin-ui').classList.contains('expanded'), false);

    name.onclick(createEvent(name, { ctrlKey: true }));
    assert.equal(core.expandedPlugins.has(plugin), true);
    name.onclick(createEvent(name, { metaKey: true }));
    assert.equal(core.expandedPlugins.has(plugin), false);

    name.onclick(createEvent(name, { shiftKey: true }));
    assert.equal(core.expandedPlugins.has(plugin), true);
    assert.equal(core.expandedPlugins.has(analyzer), false);
    name.onclick(createEvent(name, { shiftKey: true }));
    assert.equal(core.expandedPlugins.has(plugin), false);
  });

  await withBuilderGlobals({}, async ({ documentRef }) => {
    const section = new SectionPlugin({ id: 60, cm: 'Block' });
    const inside = new TestPlugin({
      id: 61,
      name: 'Inside',
      updateMarkers() { this.markersUpdated = true; },
      updateResponse() { this.responseUpdated = true; }
    });
    const missingItem = new TestPlugin({ id: 63, name: 'Missing Item' });
    const missingUi = new TestPlugin({ id: 64, name: 'Missing Ui' });
    const nextSection = new SectionPlugin({ id: 62 });
    const core = createCore({ pipeline: [section, inside, missingItem, missingUi, nextSection] });
    const builder = new PipelineItemBuilder(core);
    const sectionItem = builder.createPipelineItem(section);
    const insideItem = builder.createPipelineItem(inside);
    const missingUiItem = documentRef.createElement('div');
    missingUiItem.className = 'pipeline-item';
    missingUiItem.dataset.pluginId = String(missingUi.id);
    documentRef.body.appendChild(sectionItem);
    documentRef.body.appendChild(insideItem);
    documentRef.body.appendChild(missingUiItem);

    const sectionName = find(sectionItem, '.plugin-name');
    sectionName.onclick(createEvent(sectionName, { shiftKey: true }));
    assert.equal(core.expandedPlugins.has(section), true);
    assert.equal(core.expandedPlugins.has(inside), true);
    sectionName.onclick(createEvent(sectionName, { shiftKey: true }));
    assert.equal(core.expandedPlugins.has(section), false);
    assert.equal(core.expandedPlugins.has(inside), false);

    builder.handleShiftClickExpansion(new SectionPlugin({ id: 99 }));
  });

  await withBuilderGlobals({ uiManager: false }, async ({ documentRef }) => {
    const plugin = new TestPlugin({ id: 70, name: 'Tone Control' });
    const expandedPlugins = new Set([plugin]);
    const core = createCore({ pipeline: [plugin], expandedPlugins });
    const builder = new PipelineItemBuilder(core);
    const item = builder.createPipelineItem(plugin);
    documentRef.body.appendChild(item);
    const name = find(item, '.plugin-name');
    assert.equal(name.title, 'Click to collapse');
    name.onclick(createEvent(name));
    assert.equal(name.title, 'Click to expand');
    name.onclick(createEvent(name));
    assert.equal(name.title, 'Click to collapse');
    name.onclick(createEvent(name, { ctrlKey: true }));
    name.onclick(createEvent(name, { ctrlKey: true }));
    builder.handleShiftClickExpansion(plugin);
    builder.handleShiftClickExpansion(plugin);
  });

  await withBuilderGlobals({}, async ({ documentRef }) => {
    const plugin = new TestPlugin({ id: 80, name: 'Tone Control' });
    const expandedPlugins = new Set([plugin]);
    const core = createCore({ pipeline: [plugin], expandedPlugins });
    const builder = new PipelineItemBuilder(core);
    const item = builder.createPipelineItem(plugin);
    documentRef.body.appendChild(item);
    assert.equal(find(item, '.plugin-name').title, 't:ui.title.collapse');
  });

  await withBuilderGlobals({ uiManager: false }, async ({ documentRef }) => {
    const plugin = new TestPlugin({ id: 81, name: 'Tone Control' });
    const core = createCore({ pipeline: [plugin] });
    const builder = new PipelineItemBuilder(core);
    const item = builder.createPipelineItem(plugin);
    documentRef.body.appendChild(item);
    assert.equal(find(item, '.plugin-name').title, 'Click to expand');
  });
});
