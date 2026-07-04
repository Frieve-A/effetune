import assert from 'node:assert/strict';
import test from 'node:test';

import { CollapseManager } from '../../js/ui/plugin-list/collapse-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class FakeElement {
  constructor(tagName = 'div', options = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = options.id ?? '';
    this.className = options.className ?? '';
    this.textContent = options.textContent ?? '';
    this.dataset = options.dataset ?? {};
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.listeners = new Map();
    this.offsetWidth = options.offsetWidth ?? 120;
    this.rect = options.rect ?? { left: 20, right: 140, width: this.offsetWidth };
    this.classes = new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList = {
      add: className => {
        this.classes.add(className);
        this.className = [...this.classes].join(' ');
      },
      remove: className => {
        this.classes.delete(className);
        this.className = [...this.classes].join(' ');
      },
      contains: className => this.classes.has(className)
    };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
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

  dispatchEvent(type, event = {}) {
    return (this.listeners.get(type) || []).map(listener => listener(event));
  }

  matches(selector) {
    if (selector === this.tagName.toLowerCase()) return true;
    if (selector.startsWith('.category-row[data-category="')) {
      const category = selector.slice('.category-row[data-category="'.length, -2);
      return this.classes.has('category-row') && this.dataset.category === category;
    }
    if (selector.startsWith('.')) return this.classes.has(selector.slice(1));
    return false;
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

function createCategoryRow(category, options = {}) {
  const row = new FakeElement('div', {
    className: 'category-row',
    dataset: { category }
  });
  const title = new FakeElement('h3');
  title.appendChild(new FakeElement('span', { className: 'collapse-indicator', textContent: '>' }));
  row.appendChild(title);

  if (options.rightColumn !== false) {
    const rightColumn = new FakeElement('div', { className: 'right-column-content' });
    rightColumn.appendChild(new FakeElement('div', { className: 'plugin-category-items' }));
    if (options.effectsCount !== false) {
      rightColumn.appendChild(new FakeElement('div', { className: 'category-effects-count' }));
    }
    row.appendChild(rightColumn);
  }

  return row;
}

function createDom(options = {}) {
  const elements = new Map();
  const body = new FakeElement('body');
  const pluginList = options.pluginList === null
    ? null
    : new FakeElement('div', {
        id: 'pluginList',
        offsetWidth: options.pluginListWidth ?? 120,
        rect: options.pluginListRect ?? { left: 20, right: 140, width: options.pluginListRectWidth ?? 120 }
      });
  const pullTab = options.pullTab === null
    ? null
    : new FakeElement('div', { id: 'pluginListPullTab' });
  const mainContainer = options.mainContainer === null
    ? null
    : new FakeElement('div', { className: 'main-container' });
  const pipeline = options.pipeline === null
    ? null
    : new FakeElement('div', {
        id: 'pipeline',
        rect: options.pipelineRect ?? { left: 200, right: options.pipelineRight ?? 700, width: 500 }
      });
  const sidebarButton = options.sidebarButton === false
    ? null
    : new FakeElement('button', { id: 'sidebarButton' });

  for (const element of [pullTab, pipeline, sidebarButton]) {
    if (element?.id) {
      elements.set(element.id, element);
    }
  }

  const documentRef = {
    body,
    documentElement: {
      style: {
        values: {},
        setProperty(name, value) {
          this.values[name] = value;
        }
      }
    },
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    querySelector(selector) {
      if (selector === '.main-container') return mainContainer;
      return null;
    }
  };

  return { documentRef, pluginList, pullTab, mainContainer, pipeline, sidebarButton };
}

function createWindow(calls, options = {}) {
  const listeners = new Map();
  const windowRef = {
    innerWidth: options.innerWidth ?? 800,
    app: options.app,
    appInitializedListener: options.appInitializedListener,
    addEventListener(type, listener) {
      calls.push(['windowAddEventListener', type]);
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(listener);
    },
    dispatchEvent(type, event = {}) {
      return (listeners.get(type) || []).map(listener => listener(event));
    },
    getComputedStyle() {
      return options.computedStyle ?? { paddingLeft: '20px' };
    },
    listeners
  };
  if (options.touch) {
    windowRef.ontouchstart = true;
  }
  return windowRef;
}

async function withCollapseGlobals(options, callback) {
  const calls = [];
  const dom = options.dom ?? createDom(options.domOptions);
  const windowRef = options.window ?? createWindow(calls, options.windowOptions);
  const frameCallbacks = new Map();
  const intervalCallbacks = new Map();
  const timeoutCallbacks = new Map();
  let nextFrameId = 1;
  let nextIntervalId = 1;
  let nextTimeoutId = 1;

  const storage = {
    getItem(key) {
      calls.push(['getItem', key]);
      if (options.storageGetError) throw new Error('get failed');
      return options.savedState ?? null;
    },
    setItem(key, value) {
      calls.push(['setItem', key, value]);
      if (options.storageSetError) throw new Error('set failed');
    }
  };
  const nativeConsole = globalThis.console;

  await withGlobals({
    document: dom.documentRef,
    window: windowRef,
    localStorage: storage,
    requestAnimationFrame(fn) {
      const id = nextFrameId++;
      calls.push(['requestAnimationFrame', id]);
      frameCallbacks.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) {
      calls.push(['cancelAnimationFrame', id]);
      frameCallbacks.delete(id);
    },
    setInterval(fn, delay) {
      const id = nextIntervalId++;
      calls.push(['setInterval', delay, id]);
      intervalCallbacks.set(id, fn);
      return id;
    },
    clearInterval(id) {
      calls.push(['clearInterval', id]);
      intervalCallbacks.delete(id);
    },
    setTimeout(fn, delay) {
      const id = nextTimeoutId++;
      calls.push(['setTimeout', delay, id]);
      timeoutCallbacks.set(id, fn);
      return id;
    },
    console: {
      ...nativeConsole,
      error(...args) {
        calls.push(['consoleError', ...args]);
      }
    }
  }, async () => callback({
    calls,
    dom,
    windowRef,
    frameCallbacks,
    intervalCallbacks,
    timeoutCallbacks
  }));
}

test('loads, saves, toggles, and applies category collapsed state', async () => {
  await withCollapseGlobals({
    savedState: '{"alpha":true,"beta":false}',
    windowOptions: { appInitializedListener: true }
  }, async ({ calls, dom }) => {
    dom.pluginList.appendChild(createCategoryRow('alpha'));
    dom.pluginList.appendChild(createCategoryRow('beta'));
    dom.pluginList.appendChild(createCategoryRow('gamma', { effectsCount: false }));
    dom.pluginList.appendChild(createCategoryRow('missing-right', { rightColumn: false }));
    const manager = new CollapseManager({ pluginList: dom.pluginList });

    manager.updateCategoryVisibility('missing');
    manager.updateCategoryVisibility('missing-right');

    manager.updateCategoryVisibility('alpha');
    assert.equal(dom.pluginList.querySelector('.category-row[data-category="alpha"]').querySelector('.plugin-category-items').style.display, 'none');
    assert.equal(dom.pluginList.querySelector('.category-row[data-category="alpha"]').querySelector('.collapse-indicator').textContent, '>');
    assert.equal(dom.pluginList.querySelector('.category-row[data-category="alpha"]').querySelector('.category-effects-count').style.display, 'block');

    manager.updateCategoryVisibility('beta');
    assert.equal(dom.pluginList.querySelector('.category-row[data-category="beta"]').querySelector('.plugin-category-items').style.display, 'flex');
    assert.equal(dom.pluginList.querySelector('.category-row[data-category="beta"]').querySelector('.collapse-indicator').textContent, '\u2335');
    assert.equal(dom.pluginList.querySelector('.category-row[data-category="beta"]').querySelector('.category-effects-count').style.display, 'none');

    manager.updateCategoryVisibility('gamma');
    manager.toggleCategoryCollapse('beta');
    assert.equal(manager.collapsedCategories.beta, true);
    assert.ok(calls.some(call => call[0] === 'setItem' && call[1] === 'collapsedCategories'));

    manager.updateAllCategoriesVisibility();
  });

  await withCollapseGlobals({
    storageGetError: true,
    storageSetError: true,
    windowOptions: { appInitializedListener: true }
  }, async ({ calls, dom }) => {
    const manager = new CollapseManager({ pluginList: dom.pluginList });
    assert.deepEqual(manager.collapsedCategories, {});
    manager.saveCollapsedState();
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Error loading')));
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Error saving')));
  });
});

test('collapse toggling updates classes, followers, transition cleanup, and final positions', async () => {
  await withCollapseGlobals({
    windowOptions: { appInitializedListener: true }
  }, async ({ calls, dom, frameCallbacks }) => {
    const manager = new CollapseManager({ pluginList: dom.pluginList });

    manager.animationFrameId = 99;
    manager.handleTransitionEnd = () => calls.push(['oldTransition']);
    manager.togglePluginListCollapse();
    assert.equal(manager.isCollapsed, true);
    assert.equal(dom.pluginList.classList.contains('collapsed'), true);
    assert.equal(dom.pullTab.classList.contains('collapsed'), true);
    assert.equal(dom.mainContainer.classList.contains('plugin-list-collapsed'), true);
    assert.equal(dom.pullTab.textContent, '\u25b6');
    assert.ok(calls.some(call => call[0] === 'cancelAnimationFrame' && call[1] === 99));

    const firstFrame = manager.animationFrameId;
    frameCallbacks.get(firstFrame)();
    assert.equal(dom.pullTab.style.left, '140px');
    assert.equal(dom.pipeline.style.transform, 'none');
    assert.notEqual(manager.animationFrameId, firstFrame);

    const transitionHandler = manager.handleTransitionEnd;
    transitionHandler({ propertyName: 'opacity', target: dom.pluginList });
    assert.equal(manager.handleTransitionEnd, transitionHandler);
    transitionHandler({ propertyName: 'transform', target: dom.pluginList });
    assert.equal(manager.handleTransitionEnd, null);
    assert.equal(dom.pullTab.style.left, '0px');
    assert.equal(dom.pipeline.style.marginLeft, '-120px');

    manager.togglePluginListCollapse();
    assert.equal(manager.isCollapsed, false);
    assert.equal(dom.pluginList.classList.contains('collapsed'), false);
    assert.equal(dom.pullTab.classList.contains('collapsed'), false);
    assert.equal(dom.mainContainer.classList.contains('plugin-list-collapsed'), false);
    assert.equal(dom.pullTab.textContent, '\u25c0');
  });

  await withCollapseGlobals({
    domOptions: { pipeline: null },
    windowOptions: { appInitializedListener: true }
  }, async ({ dom }) => {
    const manager = new CollapseManager({ pluginList: dom.pluginList });
    manager.togglePluginListCollapse();
    assert.equal(manager.isCollapsed, true);
  });
});

test('animateFollowers and updatePositions handle guard and zero-width cases', async () => {
  await withCollapseGlobals({
    domOptions: {
      pluginListWidth: 0,
      pluginListRect: { left: 0, right: 0, width: 0 },
      pluginListRectWidth: 0
    },
    windowOptions: {
      appInitializedListener: true,
      computedStyle: { paddingLeft: 'not-a-number' }
    }
  }, async ({ calls, dom, frameCallbacks }) => {
    const manager = new CollapseManager({ pluginList: dom.pluginList });

    manager.animationFrameId = 77;
    manager.animateFollowers();
    assert.ok(calls.some(call => call[0] === 'cancelAnimationFrame' && call[1] === 77));

    manager.handleTransitionEnd = null;
    manager.animateFollowers();
    frameCallbacks.get(manager.animationFrameId)();
    assert.equal(manager.animationFrameId, null);
    assert.equal(dom.pullTab.style.left, '0px');
    assert.equal(dom.pipeline.style.marginLeft, '0px');

    manager.animationFrameId = 42;
    manager.handleTransitionEnd = () => {};
    manager.isCollapsed = false;
    manager.updatePositions();
    assert.equal(manager.animationFrameId, null);
    assert.equal(manager.handleTransitionEnd, null);
    assert.equal(dom.documentRef.documentElement.style.values['--plugin-list-total-width'], '0px');
    assert.equal(dom.pipeline.style.marginLeft, '0');

    manager.pluginList = null;
    manager.updatePositions();
    manager.animateFollowers();
    assert.ok(calls.some(call => call[0] === 'cancelAnimationFrame' && call[1] === 42));
  });

  await withCollapseGlobals({
    domOptions: { pipeline: null },
    windowOptions: { appInitializedListener: true }
  }, async ({ dom }) => {
    const manager = new CollapseManager({ pluginList: dom.pluginList });
    manager.updatePositions();
  });
});

test('mobile updatePositions clears desktop collapse animation state', async () => {
  await withCollapseGlobals({
    windowOptions: { appInitializedListener: true }
  }, async ({ calls, dom, windowRef }) => {
    windowRef.uiManager = { layoutMode: { isMobile: true } };
    const manager = new CollapseManager({ pluginList: dom.pluginList });
    const transitionHandler = () => {};

    manager.animationFrameId = 123;
    manager.handleTransitionEnd = transitionHandler;
    manager.isCollapsed = true;
    dom.pluginList.classList.add('collapsed');
    dom.pullTab.classList.add('collapsed');
    dom.mainContainer.classList.add('plugin-list-collapsed');
    dom.pullTab.style.left = '120px';
    dom.pullTab.textContent = '\u25b6';
    dom.pipeline.style.marginLeft = '-120px';
    dom.pipeline.style.transform = 'none';

    manager.updatePositions();

    assert.ok(calls.some(call => call[0] === 'cancelAnimationFrame' && call[1] === 123));
    assert.equal(manager.animationFrameId, null);
    assert.equal(manager.handleTransitionEnd, null);
    assert.equal(manager.isCollapsed, false);
    assert.equal(dom.pluginList.classList.contains('collapsed'), false);
    assert.equal(dom.pullTab.classList.contains('collapsed'), false);
    assert.equal(dom.mainContainer.classList.contains('plugin-list-collapsed'), false);
    assert.equal(dom.pullTab.style.left, '');
    assert.equal(dom.pullTab.textContent, '\u25c0');
    assert.equal(dom.pipeline.style.marginLeft, '0');
    assert.equal(dom.pipeline.style.transform, 'none');
  });
});

test('pull tab, resize, touch swipe, sidebar, and load handlers trigger collapse checks', async () => {
  await withCollapseGlobals({
    windowOptions: { touch: true, appInitializedListener: true, app: { initialized: true } }
  }, async ({ calls, dom, windowRef }) => {
    const manager = new CollapseManager({ pluginList: dom.pluginList });
    let toggleCount = 0;
    manager.togglePluginListCollapse = () => {
      toggleCount++;
      manager.isCollapsed = !manager.isCollapsed;
    };
    let checkCount = 0;
    manager.checkWindowWidthAndAdjust = () => {
      checkCount++;
    };

    dom.pullTab.dispatchEvent('click');
    assert.equal(toggleCount, 1);

    dom.sidebarButton.dispatchEvent('click');
    assert.equal(toggleCount, 2);

    windowRef.dispatchEvent('resize');
    assert.equal(checkCount, 1);

    windowRef.dispatchEvent('load');
    assert.equal(checkCount, 2);

    manager.isCollapsed = false;
    dom.documentRef.body.dispatchEvent('touchstart', { touches: [{ clientX: 10 }] });
    dom.documentRef.body.dispatchEvent('touchend', { changedTouches: [{ clientX: 90 }] });
    assert.equal(toggleCount, 2);

    manager.isCollapsed = true;
    dom.documentRef.body.dispatchEvent('touchstart', { touches: [{ clientX: 40 }] });
    dom.documentRef.body.dispatchEvent('touchend', { changedTouches: [{ clientX: 120 }] });
    assert.equal(toggleCount, 2);

    dom.documentRef.body.dispatchEvent('touchstart', { touches: [{ clientX: 10 }] });
    dom.documentRef.body.dispatchEvent('touchend', { changedTouches: [{ clientX: 40 }] });
    assert.equal(toggleCount, 2);

    dom.documentRef.body.dispatchEvent('touchstart', { touches: [{ clientX: 10 }] });
    dom.documentRef.body.dispatchEvent('touchend', { changedTouches: [{ clientX: 90 }] });
    assert.equal(toggleCount, 3);

    assert.ok(calls.some(call => call[0] === 'windowAddEventListener' && call[1] === 'resize'));
    assert.ok(calls.some(call => call[0] === 'windowAddEventListener' && call[1] === 'load'));
  });

  await withCollapseGlobals({
    domOptions: { pullTab: null, sidebarButton: false },
    windowOptions: { appInitializedListener: true }
  }, async ({ dom }) => {
    const manager = new CollapseManager({ pluginList: dom.pluginList });
    manager.setupPullTabFunctionality();
    manager.setupTouchSwipeFunctionality();
  });
});

test('checkWindowWidthAndAdjust and initialization polling wait for app readiness', async () => {
  await withCollapseGlobals({
    windowOptions: { appInitializedListener: true }
  }, async ({ dom, windowRef }) => {
    const manager = new CollapseManager({ pluginList: dom.pluginList });
    let toggles = 0;
    manager.togglePluginListCollapse = () => {
      toggles++;
      manager.isCollapsed = !manager.isCollapsed;
    };

    windowRef.app = null;
    manager.checkWindowWidthAndAdjust();
    assert.equal(toggles, 0);

    windowRef.app = { initialized: true };
    dom.pipeline.rect = { left: 0, right: 790, width: 790 };
    manager.isCollapsed = false;
    manager.checkWindowWidthAndAdjust();
    assert.equal(toggles, 1);

    dom.pipeline.rect = { left: 0, right: 600, width: 600 };
    manager.isCollapsed = false;
    manager.checkWindowWidthAndAdjust();
    assert.equal(toggles, 1);

    manager.isCollapsed = true;
    dom.pipeline.rect = { left: 0, right: 500, width: 500 };
    manager.checkWindowWidthAndAdjust();
    assert.equal(toggles, 2);

    manager.isCollapsed = true;
    dom.pipeline.rect = { left: 0, right: 700, width: 700 };
    manager.checkWindowWidthAndAdjust();
    assert.equal(toggles, 2);
  });

  await withCollapseGlobals({
    domOptions: { pipeline: null },
    windowOptions: { appInitializedListener: true, app: { initialized: true } }
  }, async ({ dom }) => {
    const manager = new CollapseManager({ pluginList: dom.pluginList });
    manager.checkWindowWidthAndAdjust();
  });

  await withCollapseGlobals({
    windowOptions: { app: { initialized: true } }
  }, async ({ calls, dom }) => {
    const manager = new CollapseManager({ pluginList: dom.pluginList });
    manager.checkWindowWidthAndAdjust = () => calls.push(['checkedReady']);
    manager.initializeAfterAppLoaded();
    assert.ok(calls.some(call => call[0] === 'checkedReady'));
  });

  await withCollapseGlobals({
    windowOptions: {}
  }, async ({ calls, dom, windowRef, intervalCallbacks, timeoutCallbacks }) => {
    const manager = new CollapseManager({ pluginList: dom.pluginList });
    manager.checkWindowWidthAndAdjust = () => calls.push(['checkedLater']);
    manager.initializeAfterAppLoaded();
    assert.equal(windowRef.appInitializedListener, true);
    assert.ok(calls.some(call => call[0] === 'setInterval' && call[1] === 200));
    assert.ok(calls.some(call => call[0] === 'setTimeout' && call[1] === 10000));

    windowRef.app = { initialized: true };
    for (const callback of intervalCallbacks.values()) {
      callback();
    }
    assert.ok(calls.some(call => call[0] === 'checkedLater'));

    for (const callback of timeoutCallbacks.values()) {
      callback();
    }
    assert.ok(calls.some(call => call[0] === 'clearInterval'));
  });

  await withCollapseGlobals({
    windowOptions: { appInitializedListener: undefined }
  }, async ({ calls, dom, windowRef }) => {
    let appReads = 0;
    Object.defineProperty(windowRef, 'app', {
      configurable: true,
      get() {
        appReads++;
        return appReads === 1 ? null : { initialized: true };
      }
    });
    const manager = new CollapseManager({ pluginList: dom.pluginList });
    manager.checkWindowWidthAndAdjust = () => calls.push(['checkedImmediately']);
    appReads = 0;
    windowRef.appInitializedListener = false;
    manager.initializeAfterAppLoaded();
    assert.ok(calls.some(call => call[0] === 'checkedImmediately'));
  });
});
