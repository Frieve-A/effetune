import assert from 'node:assert/strict';
import test from 'node:test';

import { PluginListManager } from '../../js/ui/plugin-list-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class FakeElement {
  constructor(tagName = 'div', options = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = options.id ?? '';
    this.dataset = options.dataset ?? {};
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.listeners = new Map();
    this.textContent = options.textContent ?? '';
    this.value = options.value ?? '';
    this.draggable = false;
    this.type = '';
    this.offsetWidth = options.offsetWidth ?? 120;
    this.offsetLeft = options.offsetLeft ?? 20;
    this.offsetTop = options.offsetTop ?? 0;
    this.scrollTop = 0;
    this.rect = options.rect ?? {
      left: this.offsetLeft,
      top: this.offsetTop,
      right: this.offsetLeft + this.offsetWidth,
      bottom: this.offsetTop + 40,
      width: this.offsetWidth,
      height: 40
    };
    this._className = '';
    this.classes = new Set();
    this.classList = {
      add: className => {
        this.classes.add(className);
        this._className = [...this.classes].join(' ');
      },
      remove: className => {
        this.classes.delete(className);
        this._className = [...this.classes].join(' ');
      },
      contains: className => this.classes.has(className),
      toggle: (className, force) => {
        const shouldAdd = force === undefined ? !this.classes.has(className) : Boolean(force);
        if (shouldAdd) {
          this.classes.add(className);
        } else {
          this.classes.delete(className);
        }
        this._className = [...this.classes].join(' ');
        return shouldAdd;
      }
    };
    this.className = options.className ?? '';
  }

  set className(value) {
    this._className = value;
    this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get className() {
    return this._className;
  }

  set innerHTML(value) {
    this.textContent = value;
  }

  get innerHTML() {
    return this.textContent;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter(candidate => candidate !== listener));
  }

  async dispatchEvent(type, event = {}) {
    const eventObject = { target: this, type, ...event };
    await Promise.all((this.listeners.get(type) || []).map(listener => listener(eventObject)));
    return true;
  }

  click() {
    return this.dispatchEvent('click', {
      preventDefault() {},
      stopPropagation() {}
    });
  }

  focus() {
    this.focused = true;
  }

  select() {
    this.selected = true;
  }

  matches(selector) {
    if (selector.startsWith('.category-row[data-category="')) {
      const category = selector.slice('.category-row[data-category="'.length, -2);
      return this.classes.has('category-row') && this.dataset.category === category;
    }
    if (selector.startsWith('.')) {
      return this.classes.has(selector.slice(1));
    }
    if (selector.startsWith('#')) {
      return this.id === selector.slice(1);
    }
    return selector.toUpperCase() === this.tagName;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) {
        return child;
      }
      const nested = child.querySelector?.(selector);
      if (nested) {
        return nested;
      }
    }
    return null;
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

  getBoundingClientRect() {
    return this.rect;
  }
}

class AlphaPlugin {
  constructor() {
    this.name = 'Alpha';
    this.description = 'Alpha description';
  }
}

class BetaPlugin {
  constructor() {
    this.name = 'Beta';
    this.description = 'Beta description';
  }
}

function createDocument() {
  const elements = new Map();
  const body = new FakeElement('body', { rect: { left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 } });
  body.scrollHeight = 1500;
  const head = new FakeElement('head');
  const mainContainer = new FakeElement('div', { className: 'main-container' });

  const register = element => {
    if (element.id) {
      elements.set(element.id, element);
    }
    body.appendChild(element);
    return element;
  };

  const pluginList = register(new FakeElement('div', {
    id: 'pluginList',
    offsetWidth: 180,
    offsetLeft: 20,
    rect: { left: 20, top: 0, right: 200, bottom: 500, width: 180, height: 500 }
  }));
  const pipeline = register(new FakeElement('div', {
    id: 'pipeline',
    rect: { left: 220, top: 0, right: 800, bottom: 500, width: 580, height: 500 }
  }));
  register(new FakeElement('div', { id: 'pipelineList' }));
  register(new FakeElement('div', { id: 'pluginListPullTab' }));
  register(new FakeElement('button', { id: 'sidebarButton' }));
  register(new FakeElement('button', { id: 'effectSearchButton' }));
  register(new FakeElement('input', { id: 'effectSearchInput' }));
  register(new FakeElement('button', { id: 'effectSearchClearButton' }));
  register(new FakeElement('h2', { id: 'availableEffectsTitle' }));
  register(new FakeElement('div', { id: 'tabSwitcher' }));
  register(new FakeElement('button', { id: 'effectsTab' }));
  register(new FakeElement('button', { id: 'systemPresetsTab' }));
  register(new FakeElement('button', { id: 'userPresetsTab' }));
  body.appendChild(mainContainer);

  const documentRef = {
    body,
    head,
    documentElement: {
      style: {
        values: {},
        setProperty(name, value) {
          this.values[name] = value;
        }
      }
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    createTextNode(text) {
      return new FakeElement('#text', { textContent: text });
    },
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    querySelector(selector) {
      if (selector === '.main-container') return mainContainer;
      return body.querySelector(selector);
    },
    querySelectorAll(selector) {
      if (selector === '.pipeline-column') return [];
      return body.querySelectorAll(selector);
    },
    elementFromPoint() {
      return null;
    }
  };

  return { documentRef, elements, pluginList, pipeline, body };
}

function createPluginManager() {
  const calls = [];
  return {
    calls,
    effectCategories: {
      Tone: { description: 'Tone category', plugins: ['Alpha', 'Missing'] },
      Dynamics: { description: 'Dynamics category', plugins: ['Beta'] }
    },
    pluginClasses: {
      Alpha: AlphaPlugin,
      Beta: BetaPlugin
    },
    createPlugin(name) {
      calls.push(['createPlugin', name]);
      if (name === 'Missing') return null;
      return { name, description: `${name} copy` };
    }
  };
}

function createPipelineManager(options = {}) {
  const calls = [];
  const firstPlugin = { name: 'Existing A' };
  const secondPlugin = { name: 'Existing B' };
  return {
    calls,
    audioManager: {
      pipeline: options.pipeline ?? [firstPlugin, secondPlugin]
    },
    selectedPlugins: options.selectedPlugins ?? new Set(),
    expandedPlugins: new Set(),
    core: options.core ?? {
      updateWorkletPlugins() {
        calls.push(['updateWorkletPlugins']);
      },
      updatePipelineUI(immediate) {
        calls.push(['updatePipelineUI', immediate]);
      }
    },
    historyManager: {
      saveState() {
        calls.push(['saveState']);
      }
    },
    updateSelectionClasses() {
      calls.push(['updateSelectionClasses']);
    },
    updateURL() {
      calls.push(['updateURL']);
    },
    firstPlugin,
    secondPlugin
  };
}

async function withPluginListGlobals(callback) {
  const dom = createDocument();
  const calls = [];
  const frameCallbacks = [];
  const windowListeners = new Map();
  const windowRef = {
    innerWidth: 1200,
    app: { initialized: true },
    uiManager: null,
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) {
        windowListeners.set(type, []);
      }
      windowListeners.get(type).push(listener);
    },
    getComputedStyle() {
      return { paddingLeft: '20px' };
    },
    scrollTo(options) {
      calls.push(['scrollTo', options]);
    },
    listeners: windowListeners
  };
  const localStorageRef = {
    getItem() {
      return null;
    },
    setItem(key, value) {
      calls.push(['localStorageSet', key, value]);
    }
  };
  const consoleRef = {
    error(...args) {
      calls.push(['console.error', ...args]);
    },
    warn(...args) {
      calls.push(['console.warn', ...args]);
    },
    log(...args) {
      calls.push(['console.log', ...args]);
    }
  };

  await withGlobals({
    document: dom.documentRef,
    window: windowRef,
    localStorage: localStorageRef,
    console: consoleRef,
    requestAnimationFrame(callbackRef) {
      frameCallbacks.push(callbackRef);
      return frameCallbacks.length;
    },
    cancelAnimationFrame() {},
    setTimeout(callbackRef) {
      callbackRef();
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {}
  }, async () => {
    await callback({
      dom,
      calls,
      windowRef,
      frameCallbacks,
      runFrames() {
        for (const callbackRef of frameCallbacks.splice(0)) {
          callbackRef();
        }
      }
    });
  });
}

test('initPluginList builds categorized plugin rows and loading state', async () => {
  await withPluginListGlobals(async ({ dom, windowRef }) => {
    const manager = new PluginListManager(createPluginManager());
    const dragSetupCalls = [];
    manager.dragDropManager.setupPluginItemDragEvents = (item, plugin) => {
      dragSetupCalls.push([item.textContent, plugin.name]);
    };
    manager.collapseManager.collapsedCategories = { Tone: true };
    manager.collapseManager.toggleCategoryCollapse = category => {
      dragSetupCalls.push(['toggleCategoryCollapse', category]);
    };

    const staleContent = new FakeElement('div', { className: 'plugin-list-content' });
    dom.pluginList.appendChild(staleContent);
    windowRef.uiManager = { t: (key, params) => `${key}:${params.count}` };
    manager.initPluginList();

    assert.equal(dom.pluginList.children.includes(staleContent), false);
    assert.equal(manager.progressDisplay.style.display, 'none');
    assert.equal(dom.pluginList.querySelector('#effectCount').textContent, 'ui.effectsAvailable:3');
    assert.deepEqual(dragSetupCalls.filter(call => call[0] !== 'toggleCategoryCollapse'), [
      ['Alpha', 'Alpha'],
      ['Beta', 'Beta']
    ]);

    const rows = dom.pluginList.querySelectorAll('.category-row');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].querySelector('.plugin-category-items').style.display, 'none');
    assert.equal(rows[0].querySelector('.category-effects-count').style.display, 'block');
    assert.equal(rows[1].querySelector('.plugin-category-items').style.display, 'flex');
    assert.equal(rows[1].querySelector('.category-effects-count').style.display, 'none');
    await rows[0].querySelector('h3').dispatchEvent('click');
    assert.deepEqual(dragSetupCalls.at(-1), ['toggleCategoryCollapse', 'Tone']);

    manager.showLoadingSpinner();
    assert.equal(manager.loadingSpinner.style.display, 'block');
    assert.equal(manager.progressDisplay.textContent, '0%');
    manager.updateLoadingProgress(-1);
    assert.equal(manager.progressDisplay.textContent, '0%');
    manager.updateLoadingProgress(101);
    assert.equal(manager.progressDisplay.textContent, '100%');
    manager.updateLoadingProgress(44.4);
    assert.equal(manager.progressDisplay.textContent, '44%');
    manager.hideLoadingSpinner();
    assert.equal(manager.loadingSpinner.style.display, 'none');

    windowRef.uiManager = null;
    manager.initPluginList();
    assert.equal(dom.pluginList.querySelectorAll('#effectCount').at(-1).textContent, '3 effects available');
  });
});

test('plugin item events add plugins at selected and appended positions', async () => {
  await withPluginListGlobals(async ({ dom, windowRef, calls, runFrames }) => {
    const pluginManager = createPluginManager();
    const manager = new PluginListManager(pluginManager);
    manager.dragDropManager = {
      dragMessage: { style: {} },
      setupPluginItemDragEvents(item, plugin) {
        calls.push(['setupPluginItemDragEvents', item.textContent, plugin.name]);
      }
    };
    manager.collapseManager.checkWindowWidthAndAdjust = () => calls.push(['checkWindowWidthAndAdjust']);

    const plugin = { name: 'Alpha', description: 'Alpha description' };
    const item = manager.createPluginItem(plugin);
    dom.pluginList.appendChild(item);

    await item.dispatchEvent('mousedown');
    assert.equal(manager.dragDropManager.dragMessage.style.display, 'block');
    await item.dispatchEvent('mouseenter');
    assert.equal(item.querySelector('.plugin-description').style.left, '150px');
    await item.dispatchEvent('mouseup');
    assert.equal(manager.dragDropManager.dragMessage.style.display, 'none');
    item.classList.add('dragging');
    manager.dragDropManager.dragMessage.style.display = 'block';
    await item.dispatchEvent('mouseup');
    assert.equal(manager.dragDropManager.dragMessage.style.display, 'block');
    item.classList.remove('dragging');

    const noDescriptionItem = new FakeElement('div');
    manager.setupPluginItemEvents(noDescriptionItem, plugin);

    pluginManager.createPlugin = () => null;
    let prevented = 0;
    let stopped = 0;
    await item.dispatchEvent('dblclick', {
      preventDefault() { prevented += 1; },
      stopPropagation() { stopped += 1; }
    });
    assert.deepEqual([prevented, stopped], [1, 1]);

    pluginManager.createPlugin = name => ({ name, description: `${name} copy` });
    windowRef.uiManager = { pipelineManager: null };
    await item.dispatchEvent('dblclick', {
      preventDefault() {},
      stopPropagation() {}
    });

    const appendPipelineManager = createPipelineManager({ pipeline: [] });
    windowRef.uiManager = { pipelineManager: appendPipelineManager };
    await item.dispatchEvent('dblclick', {
      preventDefault() {},
      stopPropagation() {}
    });
    runFrames();
    assert.deepEqual(appendPipelineManager.audioManager.pipeline.map(entry => entry.name), ['Alpha']);
    assert.equal(appendPipelineManager.expandedPlugins.size, 1);
    assert.deepEqual(appendPipelineManager.calls, [
      ['updateSelectionClasses'],
      ['updateWorkletPlugins'],
      ['saveState'],
      ['updateURL'],
      ['updatePipelineUI', true]
    ]);
    assert.deepEqual(calls.filter(call => call[0] === 'scrollTo').at(-1), [
      'scrollTo',
      { top: 1500, behavior: 'smooth' }
    ]);

    const selectedPipelineManager = createPipelineManager();
    selectedPipelineManager.selectedPlugins.add(selectedPipelineManager.secondPlugin);
    selectedPipelineManager.core = {
      updateWorkletPlugins() {
        selectedPipelineManager.calls.push(['updateWorkletPlugins']);
      }
    };
    windowRef.uiManager = { pipelineManager: selectedPipelineManager };
    await item.dispatchEvent('dblclick', {
      preventDefault() {},
      stopPropagation() {}
    });
    runFrames();
    assert.deepEqual(
      selectedPipelineManager.audioManager.pipeline.map(entry => entry.name),
      ['Existing A', 'Alpha', 'Existing B']
    );
    assert.ok(calls.some(call => call[0] === 'console.error'));
  });
});

test('delegating methods forward to child managers', async () => {
  await withPluginListGlobals(async () => {
    const manager = new PluginListManager(createPluginManager());
    const calls = [];
    const dragMessage = {};
    const indicator = {};
    manager.collapseManager = {
      updateCategoryVisibility: category => calls.push(['updateCategoryVisibility', category]),
      updateAllCategoriesVisibility: () => calls.push(['updateAllCategoriesVisibility']),
      updatePositions: () => calls.push(['updatePositions']),
      checkWindowWidthAndAdjust: () => calls.push(['checkWindowWidthAndAdjust'])
    };
    manager.searchManager = {
      switchToTab: tab => calls.push(['switchToTab', tab])
    };
    manager.dragDropManager = {
      getDragMessage: () => dragMessage,
      getInsertionIndicator: () => indicator,
      updateInsertionIndicator: (x, y) => calls.push(['updateInsertionIndicator', x, y]),
      findInsertionIndex: (x, y, pipeline) => {
        calls.push(['findInsertionIndex', x, y, pipeline.length]);
        return 7;
      },
      throttle: (callbackRef, delay) => {
        calls.push(['throttle', delay]);
        callbackRef();
      }
    };
    manager.presetManager = {
      initSystemPresetList: async () => calls.push(['initSystemPresetList']),
      initUserPresetList: async () => calls.push(['initUserPresetList']),
      refreshPresetsIfVisible: async () => calls.push(['refreshPresetsIfVisible']),
      initPresetManager: async () => calls.push(['initPresetManager']),
      addUserPresetToPipeline: async (name, index) => calls.push(['addUserPresetToPipeline', name, index])
    };

    manager.updateCategoryVisibility('Tone');
    manager.updateAllCategoriesVisibility();
    manager.switchToTab('systemPresets');
    await manager.initSystemPresetList();
    await manager.initUserPresetList();
    await manager.refreshPresetsIfVisible();
    assert.equal(manager.getDragMessage(), dragMessage);
    assert.equal(manager.getInsertionIndicator(), indicator);
    manager.updateInsertionIndicator(1, 2);
    assert.equal(manager.findInsertionIndex(3, 4, ['a', 'b']), 7);
    let throttled = false;
    manager.throttle(() => {
      throttled = true;
    }, 25);
    manager.updatePositions();
    manager.checkWindowWidthAndAdjust();
    await manager.initPresetManager();
    await manager.addUserPresetToPipeline('Preset', 2);

    assert.equal(throttled, true);
    assert.deepEqual(calls, [
      ['updateCategoryVisibility', 'Tone'],
      ['updateAllCategoriesVisibility'],
      ['switchToTab', 'systemPresets'],
      ['initSystemPresetList'],
      ['initUserPresetList'],
      ['refreshPresetsIfVisible'],
      ['updateInsertionIndicator', 1, 2],
      ['findInsertionIndex', 3, 4, 2],
      ['throttle', 25],
      ['updatePositions'],
      ['checkWindowWidthAndAdjust'],
      ['initPresetManager'],
      ['addUserPresetToPipeline', 'Preset', 2]
    ]);
  });
});
