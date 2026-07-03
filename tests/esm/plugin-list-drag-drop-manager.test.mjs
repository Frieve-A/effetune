import assert from 'node:assert/strict';
import test from 'node:test';

import { DragDropManager } from '../../js/ui/plugin-list/drag-drop-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
  }
}

class FakeElement {
  constructor(tagName = 'div', options = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = options.id ?? '';
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.listeners = new Map();
    this.dispatchedEvents = [];
    this.dataset = options.dataset ?? {};
    this.textContent = options.textContent ?? '';
    this.offsetTop = options.offsetTop ?? 0;
    this.offsetLeft = options.offsetLeft ?? 0;
    this.offsetWidth = options.offsetWidth ?? options.rect?.width ?? 100;
    this.offsetHeight = options.offsetHeight ?? options.rect?.height ?? 20;
    this.clientWidth = options.clientWidth ?? this.offsetWidth;
    this.scrollTop = options.scrollTop ?? 0;
    this.rect = options.rect ?? {
      left: this.offsetLeft,
      top: this.offsetTop,
      right: this.offsetLeft + this.offsetWidth,
      bottom: this.offsetTop + this.offsetHeight,
      width: this.offsetWidth,
      height: this.offsetHeight
    };
    this.removed = false;
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
      contains: className => this.classes.has(className)
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

  appendChild(child) {
    child.parentNode = this;
    child.removed = false;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentNode = null;
      child.removed = true;
    }
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
    this.removed = true;
  }

  cloneNode() {
    return new FakeElement(this.tagName.toLowerCase(), {
      className: this.className,
      textContent: this.textContent,
      offsetWidth: this.offsetWidth,
      offsetHeight: this.offsetHeight,
      rect: { ...this.rect }
    });
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  async dispatchEvent(typeOrEvent, event = {}) {
    const eventObject = typeof typeOrEvent === 'string'
      ? { target: this, type: typeOrEvent, ...event }
      : { target: this, ...typeOrEvent };
    this.dispatchedEvents.push(eventObject);
    const listeners = this.listeners.get(eventObject.type) || [];
    await Promise.all(listeners.map(listener => listener(eventObject)));
    return true;
  }

  matches(selector) {
    if (selector.startsWith('.')) {
      return this.classes.has(selector.slice(1));
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

  contains(element) {
    let current = element;
    while (current) {
      if (current === this) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = element => {
      for (const child of element.children) {
        if (child.matches(selector)) {
          matches.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

function createColumn(options = {}) {
  return new FakeElement('div', {
    className: 'pipeline-column',
    offsetTop: options.offsetTop ?? 0,
    offsetLeft: options.offsetLeft ?? options.rect?.left ?? 0,
    offsetWidth: options.offsetWidth ?? options.rect?.width ?? 120,
    rect: options.rect ?? { left: 0, top: 0, right: 120, bottom: 200, width: 120, height: 200 }
  });
}

function createItem(options = {}) {
  return new FakeElement('div', {
    className: 'pipeline-item',
    offsetTop: options.offsetTop ?? options.rect?.top ?? 0,
    offsetWidth: options.offsetWidth ?? options.rect?.width ?? 100,
    offsetHeight: options.offsetHeight ?? options.rect?.height ?? 20,
    rect: options.rect ?? { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 }
  });
}

function createDom(options = {}) {
  const elements = new Map();
  const body = new FakeElement('body');
  const pipeline = new FakeElement('div', {
    id: 'pipeline',
    rect: options.pipelineRect ?? { left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500 }
  });
  const pipelineList = options.pipelineList === null
    ? null
    : new FakeElement('div', {
        id: 'pipelineList',
        offsetTop: options.listOffsetTop ?? 10,
        offsetLeft: options.listOffsetLeft ?? 20,
        clientWidth: options.listClientWidth ?? 320,
        scrollTop: options.listScrollTop ?? 0
      });
  let hoveredElement = null;

  elements.set('pipeline', pipeline);
  if (pipelineList) {
    elements.set('pipelineList', pipelineList);
    pipeline.appendChild(pipelineList);
  }

  return {
    body,
    pipeline,
    pipelineList,
    elements,
    setHoveredElement(element) {
      hoveredElement = element;
    },
    documentRef: {
      body,
      createElement(tagName) {
        return new FakeElement(tagName);
      },
      getElementById(id) {
        return elements.get(id) ?? null;
      },
      querySelectorAll(selector) {
        if (selector === '.pipeline-column' && pipelineList) {
          return pipelineList.querySelectorAll(selector);
        }
        return [];
      },
      elementFromPoint() {
        return hoveredElement;
      }
    }
  };
}

function createPluginListManager() {
  const calls = [];
  return {
    calls,
    collapseManager: {
      checkWindowWidthAndAdjust() {
        calls.push(['checkWindowWidthAndAdjust']);
      }
    }
  };
}

async function withDragGlobals(options, callback) {
  const dom = options.dom ?? createDom(options.domOptions);
  const calls = [];
  const frameCallbacks = new Map();
  const timeoutCallbacks = [];
  let nextFrameId = 1;
  let now = options.now ?? 0;
  const windowRef = options.window ?? {
    uiManager: options.uiManager,
    getComputedStyle(element) {
      return element.computedStyle ?? { paddingTop: '6px', paddingLeft: '4px' };
    }
  };

  await withGlobals({
    document: dom.documentRef,
    window: windowRef,
    Date: { now: () => now },
    Event: FakeEvent,
    requestAnimationFrame(callbackRef) {
      const id = nextFrameId++;
      calls.push(['requestAnimationFrame', id]);
      frameCallbacks.set(id, callbackRef);
      return id;
    },
    cancelAnimationFrame(id) {
      calls.push(['cancelAnimationFrame', id]);
      frameCallbacks.delete(id);
    },
    setTimeout(callbackRef, delay) {
      timeoutCallbacks.push({ callbackRef, delay });
      calls.push(['setTimeout', delay]);
      return timeoutCallbacks.length;
    }
  }, async () => {
    await callback({
      dom,
      calls,
      frameCallbacks,
      timeoutCallbacks,
      windowRef,
      setNow(value) {
        now = value;
      },
      runFrames() {
        const pending = [...frameCallbacks.entries()];
        frameCallbacks.clear();
        for (const [, callbackRef] of pending) {
          callbackRef();
        }
      },
      runTimeouts() {
        for (const timeout of timeoutCallbacks.splice(0)) {
          timeout.callbackRef();
        }
      }
    });
  });
}

function dataTransferRecorder() {
  const records = [];
  return {
    records,
    dataTransfer: {
      setData(type, value) {
        records.push([type, value]);
      }
    }
  };
}

async function performTouch(item, type, clientX, clientY, extra = {}) {
  const touch = { clientX, clientY };
  let prevented = 0;
  await item.dispatchEvent(type, {
    touches: [touch],
    changedTouches: [touch],
    preventDefault() {
      prevented += 1;
    },
    ...extra
  });
  return prevented;
}

test('constructor, getters, and throttle maintain drag UI state', async () => {
  await withDragGlobals({}, async ({ dom, calls, frameCallbacks, setNow, runFrames }) => {
    const manager = new DragDropManager(createPluginListManager());

    assert.equal(manager.getDragMessage().className, 'drag-message');
    assert.equal(manager.getDragMessage().style.whiteSpace, 'pre');
    assert.equal(manager.getInsertionIndicator().className, 'insertion-indicator');
    assert.equal(dom.pipeline.children.includes(manager.getDragMessage()), true);
    assert.equal(dom.pipeline.children.includes(manager.getInsertionIndicator()), true);

    let invoked = 0;
    setNow(100);
    manager.rafId = 99;
    manager.throttle(() => {
      invoked += 1;
    }, 100);
    assert.deepEqual(calls.filter(call => call[0] === 'cancelAnimationFrame'), [['cancelAnimationFrame', 99]]);
    assert.equal(frameCallbacks.size, 1);
    runFrames();
    assert.equal(invoked, 1);
    assert.equal(manager.lastDragOverTime, 100);
    assert.equal(manager.rafId, null);

    setNow(150);
    manager.throttle(() => {
      invoked += 1;
    }, 100);
    assert.equal(invoked, 1);

    setNow(250);
    manager.throttle(() => {
      invoked += 1;
    }, 100);
    runFrames();
    assert.equal(invoked, 2);
  });
});

test('findPotentialInsertionTarget handles empty lists, columns, items, gaps, and stale targets', async () => {
  await withDragGlobals({}, async ({ dom }) => {
    const manager = new DragDropManager(createPluginListManager());

    dom.setHoveredElement(null);
    assert.deepEqual(manager.findPotentialInsertionTarget(10, 10), { columnIndex: null, itemIndex: null });

    dom.setHoveredElement(dom.pipelineList);
    assert.deepEqual(manager.findPotentialInsertionTarget(10, 10), { columnIndex: 0, itemIndex: 0 });

    const firstColumn = createColumn({ rect: { left: 0, top: 0, right: 100, bottom: 300, width: 100, height: 300 } });
    const secondColumn = createColumn({ rect: { left: 100, top: 0, right: 220, bottom: 300, width: 120, height: 300 } });
    const firstItem = createItem({ rect: { left: 100, top: 20, right: 200, bottom: 60, width: 100, height: 40 } });
    const secondItem = createItem({ rect: { left: 100, top: 70, right: 200, bottom: 110, width: 100, height: 40 } });
    secondColumn.appendChild(firstItem);
    secondColumn.appendChild(secondItem);
    dom.pipelineList.appendChild(firstColumn);
    dom.pipelineList.appendChild(secondColumn);

    dom.setHoveredElement(dom.pipelineList);
    assert.deepEqual(manager.findPotentialInsertionTarget(150, 25), { columnIndex: 1, itemIndex: 0 });
    assert.deepEqual(manager.findPotentialInsertionTarget(260, 200), { columnIndex: 1, itemIndex: 2 });
    assert.deepEqual(manager.findPotentialInsertionTarget(50, 200), { columnIndex: 0, itemIndex: 0 });

    const outsideElement = new FakeElement('div');
    dom.setHoveredElement(outsideElement);
    assert.deepEqual(manager.findPotentialInsertionTarget(150, 25), { columnIndex: null, itemIndex: null });

    dom.setHoveredElement(firstItem);
    assert.deepEqual(manager.findPotentialInsertionTarget(150, 25), { columnIndex: 1, itemIndex: 0 });
    assert.deepEqual(manager.findPotentialInsertionTarget(150, 58), { columnIndex: 1, itemIndex: 1 });

    dom.setHoveredElement(secondColumn);
    assert.deepEqual(manager.findPotentialInsertionTarget(150, 85), { columnIndex: 1, itemIndex: 1 });

    const zeroHeightItem = createItem({
      rect: { left: 0, top: 40, right: 100, bottom: 40, width: 100, height: 0 },
      offsetHeight: 0
    });
    firstColumn.appendChild(zeroHeightItem);
    dom.setHoveredElement(firstColumn);
    assert.deepEqual(manager.findPotentialInsertionTarget(50, 39), { columnIndex: 0, itemIndex: 0 });
    assert.deepEqual(manager.findPotentialInsertionTarget(50, 41), { columnIndex: 0, itemIndex: 1 });

    const rogueColumn = createColumn();
    dom.setHoveredElement(rogueColumn);
    assert.deepEqual(manager.findPotentialInsertionTarget(20, 20), { columnIndex: null, itemIndex: null });

    const foreignItem = createItem();
    const proxy = new FakeElement('span');
    proxy.closest = selector => {
      if (selector === '.pipeline-column') return firstColumn;
      if (selector === '.pipeline-item') return foreignItem;
      return null;
    };
    dom.setHoveredElement(proxy);
    assert.deepEqual(manager.findPotentialInsertionTarget(50, 39), { columnIndex: 0, itemIndex: 0 });
  });

  await withDragGlobals({ domOptions: { pipelineList: null } }, async ({ dom }) => {
    const manager = new DragDropManager(createPluginListManager());
    const column = createColumn();
    dom.setHoveredElement(column);
    assert.deepEqual(manager.findPotentialInsertionTarget(10, 10), { columnIndex: null, itemIndex: null });
  });
});

test('updateInsertionIndicator and findInsertionIndex handle empty, invalid, and populated layouts', async () => {
  await withDragGlobals({ domOptions: { listOffsetTop: 10, listOffsetLeft: 20, listClientWidth: 333, listScrollTop: 5 } }, async ({ dom }) => {
    const manager = new DragDropManager(createPluginListManager());
    const indicator = manager.getInsertionIndicator();

    manager.findPotentialInsertionTarget = () => ({ columnIndex: null, itemIndex: null });
    manager.updateInsertionIndicator(1, 1);
    assert.equal(indicator.style.display, 'none');

    manager.findPotentialInsertionTarget = () => ({ columnIndex: 0, itemIndex: 0 });
    manager.getInsertionIndicator = () => null;
    manager.updateInsertionIndicator(1, 1);
    manager.getInsertionIndicator = () => indicator;

    dom.elements.delete('pipelineList');
    manager.updateInsertionIndicator(1, 1);
    assert.equal(indicator.style.display, 'none');
    dom.elements.set('pipelineList', dom.pipelineList);

    dom.elements.delete('pipeline');
    manager.updateInsertionIndicator(1, 1);
    assert.equal(indicator.style.display, 'none');
    dom.elements.set('pipeline', dom.pipeline);

    dom.pipelineList.computedStyle = { paddingTop: '6.4px', paddingLeft: '4.4px' };
    manager.updateInsertionIndicator(1, 1);
    assert.deepEqual(
      [indicator.style.top, indicator.style.left, indicator.style.width, indicator.style.display, indicator.style.opacity],
      ['16px', '24px', '333px', 'block', '1']
    );

    dom.pipelineList.computedStyle = { paddingTop: 'invalid', paddingLeft: 'invalid' };
    manager.updateInsertionIndicator(1, 1);
    assert.deepEqual([indicator.style.top, indicator.style.left], ['10px', '20px']);

    manager.findPotentialInsertionTarget = () => ({ columnIndex: 1, itemIndex: 0 });
    manager.updateInsertionIndicator(1, 1);
    assert.equal(indicator.style.display, 'none');

    const column = createColumn({ offsetTop: 20, offsetLeft: 70, offsetWidth: 140 });
    const firstItem = createItem({ offsetTop: 10, offsetHeight: 20 });
    const secondItem = createItem({ offsetTop: 35, offsetHeight: 25 });
    column.appendChild(firstItem);
    column.appendChild(secondItem);
    dom.pipelineList.appendChild(column);

    manager.findPotentialInsertionTarget = () => ({ columnIndex: 0, itemIndex: 1 });
    manager.updateInsertionIndicator(1, 1);
    assert.deepEqual([indicator.style.top, indicator.style.left, indicator.style.width], ['50px', '70px', '140px']);

    manager.findPotentialInsertionTarget = () => ({ columnIndex: 0, itemIndex: 2 });
    manager.updateInsertionIndicator(1, 1);
    assert.equal(indicator.style.top, '75px');

    manager.findPotentialInsertionTarget = () => ({ columnIndex: 0, itemIndex: -1 });
    manager.updateInsertionIndicator(1, 1);
    assert.equal(indicator.style.top, '75px');

    const emptyColumn = createColumn({ offsetLeft: 210, offsetWidth: 90 });
    dom.pipelineList.appendChild(emptyColumn);
    dom.pipelineList.computedStyle = { paddingTop: 'invalid', paddingLeft: '8px' };
    manager.findPotentialInsertionTarget = () => ({ columnIndex: 1, itemIndex: 0 });
    manager.updateInsertionIndicator(1, 1);
    assert.deepEqual([indicator.style.top, indicator.style.left, indicator.style.width], ['10px', '210px', '90px']);

    manager.findPotentialInsertionTarget = () => ({ columnIndex: null, itemIndex: 0 });
    assert.equal(manager.findInsertionIndex(1, 1, ['a', 'b', 'c']), 3);
    manager.findPotentialInsertionTarget = () => ({ columnIndex: 0, itemIndex: null });
    assert.equal(manager.findInsertionIndex(1, 1, ['a', 'b', 'c']), 3);

    const savedChildren = dom.pipelineList.children;
    dom.pipelineList.children = [];
    manager.findPotentialInsertionTarget = () => ({ columnIndex: 0, itemIndex: 0 });
    assert.equal(manager.findInsertionIndex(1, 1, ['a', 'b', 'c']), 3);
    dom.pipelineList.children = savedChildren;

    manager.findPotentialInsertionTarget = () => ({ columnIndex: 0, itemIndex: 2 });
    assert.equal(manager.findInsertionIndex(1, 1, ['a', 'b', 'c', 'd', 'e']), 2);
    manager.findPotentialInsertionTarget = () => ({ columnIndex: 1, itemIndex: 3 });
    assert.equal(manager.findInsertionIndex(1, 1, ['a', 'b', 'c', 'd', 'e']), 5);
  });
});

test('plugin item drag and touch handlers dispatch drops and clean up state', async () => {
  await withDragGlobals({}, async ({ dom, calls, setNow, runFrames, timeoutCallbacks, runTimeouts }) => {
    const pluginListManager = createPluginListManager();
    const manager = new DragDropManager(pluginListManager);
    const item = createItem({
      offsetWidth: 130,
      rect: { left: 10, top: 20, right: 140, bottom: 70, width: 130, height: 50 }
    });
    const updates = [];
    manager.updateInsertionIndicator = (clientX, clientY) => updates.push([clientX, clientY]);
    manager.setupPluginItemDragEvents(item, { name: 'Delay' });

    const drag = dataTransferRecorder();
    await item.dispatchEvent('dragstart', { dataTransfer: drag.dataTransfer });
    assert.deepEqual(drag.records, [['text/plain', 'Delay']]);
    assert.equal(item.classList.contains('dragging'), true);

    manager.rafId = 44;
    await item.dispatchEvent('dragend');
    assert.equal(item.classList.contains('dragging'), false);
    assert.equal(manager.rafId, null);
    assert.equal(manager.getInsertionIndicator().style.display, 'none');
    assert.deepEqual(calls.filter(call => call[0] === 'cancelAnimationFrame').at(-1), ['cancelAnimationFrame', 44]);

    await item.dispatchEvent('dragend');

    assert.equal(await performTouch(item, 'touchmove', 1, 1), 1);
    assert.equal(await performTouch(item, 'touchend', 1, 1), 0);

    await performTouch(item, 'touchstart', 40, 55);
    assert.equal(item.classList.contains('dragging'), true);
    assert.equal(dom.body.children.at(-1).style.left, '10px');
    setNow(200);
    assert.equal(await performTouch(item, 'touchmove', 60, 80), 1);
    runFrames();
    assert.deepEqual(updates, [[60, 80]]);

    const insidePrevented = await performTouch(item, 'touchend', 70, 90);
    assert.equal(insidePrevented, 1);
    const dropEvent = dom.pipeline.dispatchedEvents.find(event => event.type === 'drop');
    assert.equal(dropEvent.clientX, 70);
    dropEvent.preventDefault();
    assert.equal(dropEvent.dataTransfer.getData('text/plain'), 'Delay');
    assert.equal(dropEvent.dataTransfer.getData('application/json'), '');
    assert.equal(timeoutCallbacks[0].delay, 100);
    runTimeouts();
    assert.deepEqual(pluginListManager.calls, [['checkWindowWidthAndAdjust']]);
    assert.equal(item.classList.contains('dragging'), false);

    for (const [clientX, clientY] of [[-1, 50], [501, 50], [50, -1], [50, 501]]) {
      const beforeDrops = dom.pipeline.dispatchedEvents.filter(event => event.type === 'drop').length;
      await performTouch(item, 'touchstart', 40, 55);
      assert.equal(await performTouch(item, 'touchend', clientX, clientY), 1);
      assert.equal(dom.pipeline.dispatchedEvents.filter(event => event.type === 'drop').length, beforeDrops);
    }
  });
});

test('plugin item touch handlers preserve synthetic clicks in mobile layout', async () => {
  await withDragGlobals({
    uiManager: { layoutMode: { isMobile: true } }
  }, async ({ dom }) => {
    const manager = new DragDropManager(createPluginListManager());
    const item = createItem({
      offsetWidth: 130,
      rect: { left: 10, top: 20, right: 140, bottom: 70, width: 130, height: 50 }
    });
    const bodyChildCount = dom.body.children.length;
    manager.setupPluginItemDragEvents(item, { name: 'Delay' });

    assert.equal(await performTouch(item, 'touchstart', 40, 55), 0);
    assert.equal(item.classList.contains('dragging'), false);
    assert.equal(dom.body.children.length, bodyChildCount);
    assert.equal(await performTouch(item, 'touchmove', 60, 80), 0);
    assert.equal(await performTouch(item, 'touchend', 70, 90), 0);
    assert.equal(dom.pipeline.dispatchedEvents.filter(event => event.type === 'drop').length, 0);
  });
});

test('preset item touch handlers preserve synthetic clicks in mobile layout', async () => {
  await withDragGlobals({
    uiManager: { layoutMode: { isMobile: true } }
  }, async ({ dom }) => {
    const manager = new DragDropManager(createPluginListManager());
    const item = createItem({
      offsetWidth: 150,
      rect: { left: 15, top: 25, right: 165, bottom: 85, width: 150, height: 60 }
    });
    const bodyChildCount = dom.body.children.length;
    manager.setupPresetItemDragEvents(item, 'Factory');

    assert.equal(await performTouch(item, 'touchstart', 45, 65), 0);
    assert.equal(item.classList.contains('dragging'), false);
    assert.equal(dom.body.children.length, bodyChildCount);
    assert.equal(await performTouch(item, 'touchmove', 80, 100), 0);
    assert.equal(await performTouch(item, 'touchend', 85, 105), 0);
    assert.equal(dom.pipeline.dispatchedEvents.filter(event => event.type === 'drop').length, 0);
  });
});

test('preset item mouse, drag, and touch handlers move preset and user preset items', async () => {
  await withDragGlobals({
    uiManager: {
      t: key => `translated:${key}`
    }
  }, async ({ dom, windowRef, setNow, runFrames, timeoutCallbacks, runTimeouts }) => {
    const pluginListManager = createPluginListManager();
    const manager = new DragDropManager(pluginListManager);
    const item = createItem({
      offsetWidth: 150,
      rect: { left: 15, top: 25, right: 165, bottom: 85, width: 150, height: 60 }
    });
    const updates = [];
    manager.updateInsertionIndicator = (clientX, clientY) => updates.push([clientX, clientY]);
    manager.setupPresetItemDragEvents(item, 'Factory');

    await item.dispatchEvent('mousedown');
    assert.equal(manager.getDragMessage().textContent, 'translated:ui.dragEffectMessage');
    assert.equal(manager.getDragMessage().style.display, 'block');
    await item.dispatchEvent('mouseup');
    assert.equal(manager.getDragMessage().style.display, 'none');

    windowRef.uiManager = null;
    await item.dispatchEvent('mousedown');
    assert.equal(manager.getDragMessage().style.display, 'block');
    windowRef.uiManager = {};
    await item.dispatchEvent('mousedown');

    setNow(10);
    const drag = dataTransferRecorder();
    await item.dispatchEvent('dragstart', { dataTransfer: drag.dataTransfer });
    assert.deepEqual(JSON.parse(drag.records[0][1]), { type: 'preset', name: 'Factory' });
    await item.dispatchEvent('mouseup');
    assert.equal(manager.getDragMessage().style.display, 'block');

    setNow(100);
    await item.dispatchEvent('drag', { clientX: 20, clientY: 30 });
    assert.deepEqual(updates, []);
    setNow(111);
    await item.dispatchEvent('drag', { clientX: 25, clientY: 35 });
    runFrames();
    assert.deepEqual(updates, [[25, 35]]);

    manager.rafId = 55;
    await item.dispatchEvent('dragend');
    assert.equal(manager.rafId, null);
    await item.dispatchEvent('dragend');

    assert.equal(await performTouch(item, 'touchmove', 1, 1), 1);
    assert.equal(await performTouch(item, 'touchend', 1, 1), 0);

    for (const [clientX, clientY, uiManager] of [
      [-1, 50, null],
      [501, 50, {}],
      [50, -1, { t: key => `touch:${key}` }],
      [50, 501, { t: key => `touch:${key}` }]
    ]) {
      const beforeDrops = dom.pipeline.dispatchedEvents.filter(event => event.type === 'drop').length;
      windowRef.uiManager = uiManager;
      await performTouch(item, 'touchstart', 45, 65);
      assert.equal(await performTouch(item, 'touchend', clientX, clientY), 1);
      assert.equal(dom.pipeline.dispatchedEvents.filter(event => event.type === 'drop').length, beforeDrops);
    }

    windowRef.uiManager = { t: key => `touch:${key}` };
    await performTouch(item, 'touchstart', 45, 65);
    setNow(230);
    assert.equal(await performTouch(item, 'touchmove', 80, 100), 1);
    runFrames();
    assert.deepEqual(updates.at(-1), [80, 100]);
    assert.equal(await performTouch(item, 'touchend', 85, 105), 1);
    const presetDrop = dom.pipeline.dispatchedEvents.filter(event => event.type === 'drop').at(-1);
    presetDrop.preventDefault();
    assert.deepEqual(JSON.parse(presetDrop.dataTransfer.getData('text/plain')), { type: 'preset', name: 'Factory' });
    assert.equal(presetDrop.dataTransfer.getData('application/json'), '');
    assert.equal(timeoutCallbacks.at(-1).delay, 100);
    runTimeouts();
    assert.ok(pluginListManager.calls.length >= 1);

    const userItem = createItem({
      offsetWidth: 120,
      rect: { left: 20, top: 30, right: 140, bottom: 80, width: 120, height: 50 }
    });
    manager.setupPresetItemDragEvents(userItem, 'User One', true);
    const userDrag = dataTransferRecorder();
    await userItem.dispatchEvent('dragstart', { dataTransfer: userDrag.dataTransfer });
    assert.deepEqual(JSON.parse(userDrag.records[0][1]), { type: 'userPreset', name: 'User One' });
    await userItem.dispatchEvent('dragend');

    await performTouch(userItem, 'touchstart', 50, 60);
    assert.equal(await performTouch(userItem, 'touchend', 60, 70), 1);
    const userDrop = dom.pipeline.dispatchedEvents.filter(event => event.type === 'drop').at(-1);
    assert.deepEqual(JSON.parse(userDrop.dataTransfer.getData('text/plain')), { type: 'userPreset', name: 'User One' });
  });
});
