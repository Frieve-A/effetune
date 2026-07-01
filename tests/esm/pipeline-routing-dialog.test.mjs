import assert from 'node:assert/strict';
import test from 'node:test';

import { PipelineRoutingDialog } from '../../js/ui/pipeline/pipeline-routing-dialog.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class FakeElement {
  constructor(tagName, ownerDocument, calls = []) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.calls = calls;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.className = '';
    this.textContent = '';
    this.title = '';
    this.value = '';
    this.selected = false;
    this.dataset = {};
    this.onclick = null;
    this.onchange = null;
    this.removed = false;
    this.rect = { top: 0, left: 0, right: 0, bottom: 0, width: 100, height: 20 };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    child.parentNode = this;
    const index = this.children.indexOf(reference);
    if (index === -1) {
      this.children.push(child);
    } else {
      this.children.splice(index, 0, child);
    }
    this.calls.push(['insertBefore', child.className, reference?.className ?? null]);
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
    this.removed = true;
    this.parentNode?.removeChild(this);
  }

  contains(target) {
    if (target === this) return true;
    return this.children.some(child => child.contains?.(target));
  }

  getBoundingClientRect() {
    return this.rect;
  }

  querySelector() {
    return null;
  }
}

function createDocument(calls, options = {}) {
  const documentRef = {
    routingDialog: options.routingDialog ?? null,
    listeners: new Map(),
    documentElement: {
      scrollLeft: options.scrollLeft ?? 0,
      scrollTop: options.scrollTop ?? 0
    },
    body: null,
    createElement(tagName) {
      const element = new FakeElement(tagName, documentRef, calls);
      if (tagName === 'div' && options.measureWidth) {
        element.rect = { ...element.rect, width: options.measureWidth };
      }
      return element;
    },
    querySelector(selector) {
      calls.push(['documentQuerySelector', selector]);
      if (selector === '.routing-dialog') return documentRef.routingDialog;
      return null;
    },
    addEventListener(type, listener) {
      calls.push(['documentAddEventListener', type]);
      documentRef.listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      calls.push(['documentRemoveEventListener', type, listener === documentRef.listeners.get(type)]);
      documentRef.listeners.delete(type);
    }
  };
  documentRef.body = new FakeElement('body', documentRef, calls);
  documentRef.body.style.zoom = options.bodyZoom ?? '';
  return documentRef;
}

function createWindow(calls, options = {}) {
  return {
    uiManager: options.uiManager === false ? null : {
      t(key) {
        calls.push(['translate', key]);
        return `T:${key}`;
      }
    },
    electronIntegration: options.electronIntegration,
    scrollX: options.scrollX,
    scrollY: options.scrollY,
    pageXOffset: options.pageXOffset,
    pageYOffset: options.pageYOffset
  };
}

function createPipelineCore(calls, options = {}) {
  return {
    pipelineList: options.pipelineList,
    pipelineManager: options.pipelineManager,
    updateBusInfo(plugin) {
      calls.push(['coreUpdateBusInfo', plugin.id]);
    },
    handlePluginSelection(plugin, event) {
      calls.push(['handlePluginSelection', plugin.id, event.type]);
    }
  };
}

function createPlugin(overrides = {}) {
  const calls = [];
  return {
    id: overrides.id ?? 1,
    inputBus: overrides.inputBus ?? null,
    outputBus: overrides.outputBus ?? null,
    channel: Object.prototype.hasOwnProperty.call(overrides, 'channel') ? overrides.channel : null,
    calls,
    updateParameters() {
      calls.push(['updateParameters', this.inputBus, this.outputBus, this.channel]);
    }
  };
}

async function withRoutingGlobals(calls, options, callback) {
  const documentRef = options.document ?? createDocument(calls, options);
  const timeoutCallbacks = [];
  await withGlobals({
    document: documentRef,
    window: options.window ?? createWindow(calls, options),
    setTimeout(fn, delay) {
      calls.push(['setTimeout', delay]);
      timeoutCallbacks.push(fn);
      return timeoutCallbacks.length;
    }
  }, async () => callback({ documentRef, timeoutCallbacks }));
}

test('dialog header translates labels, closes existing dialogs, and has fallback text', async () => {
  const calls = [];
  const existingDialog = new FakeElement('div', null, calls);
  const documentRef = createDocument(calls, { routingDialog: existingDialog });
  const handler = new PipelineRoutingDialog(createPipelineCore(calls));

  await withRoutingGlobals(calls, { document: documentRef }, async () => {
    const header = handler.createDialogHeader();
    const closeButton = header.children[0];

    assert.equal(header.textContent, 'T:ui.busRouting');
    assert.equal(closeButton.title, 'T:ui.title.close');

    closeButton.onclick();
    assert.equal(existingDialog.removed, true);
    documentRef.routingDialog = null;
    assert.doesNotThrow(() => closeButton.onclick());
  });

  const fallbackCalls = [];
  await withRoutingGlobals(fallbackCalls, { window: createWindow(fallbackCalls, { uiManager: false }) }, async () => {
    const header = handler.createDialogHeader();
    assert.equal(header.textContent, 'Bus Routing');
    assert.equal(header.children[0].title, 'Close');
  });
});

test('selectors render options and update plugin routing values', async () => {
  const calls = [];
  const plugin = createPlugin({ inputBus: 2, outputBus: 3, channel: 'A' });
  const handler = new PipelineRoutingDialog(createPipelineCore(calls));

  await withRoutingGlobals(calls, {}, async () => {
    const channelContainer = handler.createChannelSelector(plugin);
    const channelSelect = channelContainer.children[1];
    assert.equal(channelSelect.children.length, 13);
    assert.equal(channelSelect.children.some(option => option.value === 'A' && option.selected), true);

    channelSelect.value = '34';
    channelSelect.onchange();
    assert.equal(plugin.channel, '34');

    channelSelect.value = '';
    channelSelect.onchange();
    assert.equal(plugin.channel, null);

    const inputContainer = handler.createInputBusSelector(plugin);
    const inputSelect = inputContainer.children[1];
    assert.equal(inputSelect.children[2].selected, true);
    inputSelect.value = '0';
    inputSelect.onchange();
    assert.equal(plugin.inputBus, null);
    inputSelect.value = '4';
    inputSelect.onchange();
    assert.equal(plugin.inputBus, 4);

    const outputContainer = handler.createOutputBusSelector(plugin);
    const outputSelect = outputContainer.children[1];
    outputSelect.value = '0';
    outputSelect.onchange();
    assert.equal(plugin.outputBus, null);
    outputSelect.value = '1';
    outputSelect.onchange();
    assert.equal(plugin.outputBus, 1);
  });

  assert.deepEqual(plugin.calls, [
    ['updateParameters', 2, 3, '34'],
    ['updateParameters', 2, 3, null],
    ['updateParameters', null, 3, null],
    ['updateParameters', 4, 3, null],
    ['updateParameters', 4, null, null],
    ['updateParameters', 4, 1, null]
  ]);
  assert.equal(calls.filter(call => call[0] === 'coreUpdateBusInfo').length, 6);
});

test('positionDialog handles web zoom measurement and Electron CSS zoom correction', async () => {
  const calls = [];
  const handler = new PipelineRoutingDialog(createPipelineCore(calls));
  const button = new FakeElement('button', null, calls);
  button.rect = { bottom: 200, left: 40, width: 20, height: 20 };

  await withRoutingGlobals(calls, {
    measureWidth: 50,
    window: createWindow(calls, { scrollX: 5, scrollY: 10 })
  }, async () => {
    const dialog = new FakeElement('div', null, calls);
    handler.positionDialog(dialog, button);
    assert.equal(dialog.style.top, '410px');
    assert.equal(dialog.style.left, '85px');
  });

  await withRoutingGlobals(calls, {
    bodyZoom: '2',
    window: createWindow(calls, {
      electronIntegration: { isElectronEnvironment: () => true },
      scrollX: 20,
      scrollY: 0,
      pageYOffset: 40
    })
  }, async () => {
    const dialog = new FakeElement('div', null, calls);
    button.rect = { bottom: 200, left: 60, width: 20, height: 20 };
    handler.positionDialog(dialog, button);
    assert.equal(dialog.style.top, '120px');
    assert.equal(dialog.style.left, '40px');
  });

  await withRoutingGlobals(calls, {
    bodyZoom: 'bad',
    scrollLeft: 12,
    scrollTop: 18,
    window: createWindow(calls, {
      electronIntegration: { isElectronEnvironment: () => true },
      scrollX: 0,
      scrollY: 0,
      pageXOffset: 0,
      pageYOffset: 0
    })
  }, async () => {
    const dialog = new FakeElement('div', null, calls);
    button.rect = { bottom: 200, left: 60, width: 20, height: 20 };
    handler.positionDialog(dialog, button);
    assert.equal(dialog.style.top, '218px');
    assert.equal(dialog.style.left, '72px');
  });

  await withRoutingGlobals(calls, {
    bodyZoom: '',
    window: createWindow(calls, {
      electronIntegration: { isElectronEnvironment: () => true }
    })
  }, async () => {
    const dialog = new FakeElement('div', null, calls);
    handler.positionDialog(dialog, button);
    assert.equal(dialog.style.top, '200px');
    assert.equal(dialog.style.left, '60px');
  });
});

test('showRoutingDialog replaces existing dialogs and delayed outside clicks close it', async () => {
  const calls = [];
  const existingDialog = new FakeElement('div', null, calls);
  const documentRef = createDocument(calls, { routingDialog: existingDialog, measureWidth: 100 });
  const button = new FakeElement('button', documentRef, calls);
  button.rect = { bottom: 10, left: 20, width: 1, height: 1 };
  const plugin = createPlugin();
  const handler = new PipelineRoutingDialog(createPipelineCore(calls));

  await withRoutingGlobals(calls, { document: documentRef }, async ({ timeoutCallbacks }) => {
    handler.showRoutingDialog(plugin, button);
    assert.equal(existingDialog.removed, true);
    const dialog = documentRef.body.children.find(child => child.className === 'routing-dialog');
    assert.ok(dialog);

    timeoutCallbacks[0]();
    const clickListener = documentRef.listeners.get('click');
    const inside = dialog.children[0];
    const outside = new FakeElement('div', documentRef, calls);

    clickListener({ target: inside });
    assert.equal(dialog.removed, false);

    clickListener({ target: button });
    assert.equal(dialog.removed, false);

    clickListener({ target: outside });
    assert.equal(dialog.removed, true);
    assert.equal(documentRef.listeners.has('click'), false);
  });
});

function createPipelineItem(calls, options = {}) {
  const item = new FakeElement('div', null, calls);
  item.busInfo = options.busInfo ?? null;
  item.routingButton = options.routingButton ?? null;
  item.header = new FakeElement('div', null, calls);
  item.header.className = 'pipeline-item-header';
  item.header.children = options.headerChildren ?? [];
  item.header.insertBefore = (child, reference) => {
    child.parentNode = item.header;
    item.busInfo = child;
    const index = item.header.children.indexOf(reference);
    if (index === -1) {
      item.header.children.push(child);
    } else {
      item.header.children.splice(index, 0, child);
    }
    calls.push(['headerInsertBefore', child.className, reference?.className ?? null]);
    return child;
  };
  item.querySelector = selector => {
    if (selector === '.bus-info') return item.busInfo;
    if (selector === '.pipeline-item-header') return item.header;
    if (selector === '.routing-button') return item.routingButton;
    return null;
  };
  return item;
}

function createPipelineListForItem(item) {
  return {
    querySelector(selector) {
      return selector.includes("data-plugin-id='") ? item : null;
    }
  };
}

test('updateBusInfo creates, updates, clicks, and removes routing summaries', async () => {
  const calls = [];
  const routingButton = new FakeElement('button', null, calls);
  routingButton.className = 'routing-button';
  const item = createPipelineItem(calls, { routingButton });
  const pipelineManager = {
    historyManager: {
      saveState() {
        calls.push(['saveState']);
      }
    }
  };
  const handler = new PipelineRoutingDialog(createPipelineCore(calls, {
    pipelineList: createPipelineListForItem(item),
    pipelineManager
  }));
  const dialogs = [];
  handler.showRoutingDialog = (plugin, button) => dialogs.push([plugin.id, button]);

  await withRoutingGlobals(calls, {}, async () => {
    const plugin = createPlugin({ id: 10, inputBus: null, outputBus: 2, channel: 'L' });
    handler.updateBusInfo(plugin);

    assert.equal(item.busInfo.textContent, 'Main\u2192Bus 2 Left');
    assert.equal(item.busInfo.title, 'T:ui.title.configureBusRouting');
    assert.equal(item.busInfo.style.cursor, 'pointer');

    const clickEvent = {
      type: 'click',
      stopped: false,
      stopPropagation() {
        this.stopped = true;
      }
    };
    item.busInfo.onclick(clickEvent);
    assert.equal(clickEvent.stopped, true);
    assert.deepEqual(dialogs, [[10, routingButton]]);

    plugin.inputBus = null;
    plugin.outputBus = null;
    plugin.channel = null;
    handler.updateBusInfo(plugin);
    assert.equal(item.busInfo.removed, true);
  });

  assert.ok(calls.some(call => call[0] === 'headerInsertBefore' && call[2] === 'routing-button'));
  assert.equal(calls.filter(call => call[0] === 'saveState').length, 2);
});

test('updateBusInfo handles fallback insertion, fallback titles, channel labels, and missing state managers', async () => {
  const calls = [];
  const before = new FakeElement('button', null, calls);
  before.className = 'before';
  const reference = new FakeElement('button', null, calls);
  reference.className = 'reference';
  const item = createPipelineItem(calls, { headerChildren: [before, before, reference] });
  const handler = new PipelineRoutingDialog(createPipelineCore(calls, {
    pipelineList: createPipelineListForItem(item),
    pipelineManager: null
  }));
  const dialogs = [];
  handler.showRoutingDialog = (plugin, button) => dialogs.push([plugin.id, button.className]);

  await withRoutingGlobals(calls, { window: createWindow(calls, { uiManager: false }) }, async () => {
    const plugin = createPlugin({ id: 11, inputBus: 0, outputBus: 0, channel: 'R' });
    handler.updateBusInfo(plugin);
    assert.equal(item.busInfo.textContent, 'Bus 0\u2192Bus 0 Right');
    assert.equal(item.busInfo.title, 'Click to configure bus routing');
    item.busInfo.onclick({ type: 'click', stopPropagation() {} });
    assert.deepEqual(dialogs, [[11, 'bus-info']]);
  });

  assert.ok(calls.some(call => call[0] === 'headerInsertBefore' && call[2] === 'reference'));

  const channelCases = [
    ['A', 'All'],
    ['34', '3+4'],
    ['56', '5+6'],
    ['78', '7+8'],
    ['3', 'Ch 3'],
    ['custom', 'custom']
  ];

  await withRoutingGlobals(calls, {}, async () => {
    for (const [channel, expected] of channelCases) {
      const channelItem = createPipelineItem(calls);
      const channelHandler = new PipelineRoutingDialog(createPipelineCore(calls, {
        pipelineList: createPipelineListForItem(channelItem),
        pipelineManager: {}
      }));
      channelHandler.updateBusInfo(createPlugin({ id: 12, channel }));
      assert.equal(channelItem.busInfo.textContent, expected);
    }

    const busOnlyItem = createPipelineItem(calls);
    const busOnlyHandler = new PipelineRoutingDialog(createPipelineCore(calls, {
      pipelineList: createPipelineListForItem(busOnlyItem),
      pipelineManager: {}
    }));
    busOnlyHandler.updateBusInfo(createPlugin({ id: 13, inputBus: 1, outputBus: null }));
    assert.equal(busOnlyItem.busInfo.textContent, 'Bus 1\u2192Main');

    const emptyItem = createPipelineItem(calls);
    const emptyHandler = new PipelineRoutingDialog(createPipelineCore(calls, {
      pipelineList: createPipelineListForItem(emptyItem),
      pipelineManager: {}
    }));
    emptyHandler.updateBusInfo(createPlugin({ id: 14 }));
    assert.equal(emptyItem.busInfo, null);
  });

  assert.ok(calls.some(call => call[0] === 'headerInsertBefore' && call[2] === null));
});

test('updateBusInfo exits when the pipeline item is missing', async () => {
  const calls = [];
  const handler = new PipelineRoutingDialog(createPipelineCore(calls, {
    pipelineList: { querySelector: () => null },
    pipelineManager: {
      historyManager: {
        saveState() {
          calls.push(['saveState']);
        }
      }
    }
  }));

  await withRoutingGlobals(calls, {}, async () => {
    handler.updateBusInfo(createPlugin({ id: 404, inputBus: 1 }));
  });

  assert.equal(calls.some(call => call[0] === 'saveState'), false);
});
