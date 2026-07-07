import assert from 'node:assert/strict';
import test from 'node:test';

import { UIEventHandler } from '../../js/ui/pipeline/ui-event-handler.js';
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

  contains(token) {
    return this._tokens().has(token);
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.eventListeners = new Map();
    this.className = '';
    this.id = '';
    this.style = {};
    this.dataset = {};
    this.textContent = '';
    this.innerHTML = '';
    this.draggable = false;
    this.classList = new FakeClassList(this);
    this.rect = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    if (child.id) this.ownerDocument.elementsById.set(child.id, child);
    this.ownerDocument.allElements.add(child);
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      this.parentNode.childNodes = this.parentNode.children;
      this.parentNode = null;
    }
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type).push(listener);
  }

  dispatch(type, event = {}) {
    const eventObject = createEvent(this, event);
    const results = [];
    for (const listener of this.eventListeners.get(type) || []) {
      results.push(listener(eventObject));
    }
    return { event: eventObject, results };
  }

  contains(target) {
    let current = target;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }

  matches(selector) {
    return selector.split(',').some(part => this._matchesSingle(part.trim()));
  }

  _matchesSingle(selector) {
    if (!selector) return false;
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector === 'input, textarea') return this.tagName === 'INPUT' || this.tagName === 'TEXTAREA';
    if (selector === 'input[type="range"]') return this.tagName === 'INPUT' && this.type === 'range';
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (typeof current.matches === 'function' && current.matches(selector)) {
        return current;
      }
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

  getBoundingClientRect() {
    return this.rect;
  }
}

function createDocument() {
  const documentRef = {
    allElements: new Set(),
    elementsById: new Map(),
    eventListeners: new Map(),
    body: null,
    head: null,
    documentElement: null,
    activeElement: null,
    createElement(tagName) {
      const element = new FakeElement(tagName, documentRef);
      documentRef.allElements.add(element);
      return element;
    },
    getElementById(id) {
      return documentRef.elementsById.get(id) || null;
    },
    querySelector(selector) {
      return documentRef.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      return [...documentRef.allElements].filter(element => element.matches(selector));
    },
    addEventListener(type, listener) {
      if (!documentRef.eventListeners.has(type)) {
        documentRef.eventListeners.set(type, []);
      }
      documentRef.eventListeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      if (!documentRef.eventListeners.has(type)) return;
      documentRef.eventListeners.set(
        type,
        documentRef.eventListeners.get(type).filter(candidate => candidate !== listener)
      );
    },
    dispatch(type, event = {}) {
      const eventObject = createEvent(documentRef, event);
      const results = [];
      for (const listener of documentRef.eventListeners.get(type) || []) {
        results.push(listener(eventObject));
      }
      return { event: eventObject, results };
    },
    elementFromPoint() {
      return documentRef.elementFromPointTarget || documentRef.getElementById('pipelineList');
    }
  };
  documentRef.body = documentRef.createElement('body');
  documentRef.head = documentRef.createElement('head');
  documentRef.documentElement = documentRef.createElement('html');
  return documentRef;
}

function appendWithId(parent, tagName, id, className = '') {
  const element = parent.ownerDocument.createElement(tagName);
  element.id = id;
  element.className = className;
  parent.appendChild(element);
  return element;
}

function createEvent(defaultTarget, options = {}) {
  return {
    key: options.key,
    ctrlKey: Boolean(options.ctrlKey),
    metaKey: Boolean(options.metaKey),
    shiftKey: Boolean(options.shiftKey),
    target: options.target ?? defaultTarget,
    relatedTarget: options.relatedTarget ?? null,
    dataTransfer: options.dataTransfer ?? createDataTransfer(),
    clientX: options.clientX ?? 10,
    clientY: options.clientY ?? 10,
    touches: options.touches ?? [],
    changedTouches: options.changedTouches ?? [],
    clipboardData: options.clipboardData,
    prevented: 0,
    stopped: 0,
    preventDefault() {
      this.prevented += 1;
    },
    stopPropagation() {
      this.stopped += 1;
    }
  };
}

function createDataTransfer(options = {}) {
  const data = new Map(Object.entries(options.data || {}));
  return {
    types: options.types ?? [],
    files: options.files ?? [],
    items: options.items ?? [],
    dropEffect: '',
    effectAllowed: '',
    setData(type, value) {
      data.set(type, value);
    },
    getData(type) {
      return data.get(type) ?? '';
    }
  };
}

function createFile(name, options = {}) {
  return {
    name,
    text: options.text ?? '{"ok":true}',
    failRead: Boolean(options.failRead)
  };
}

class FakeFileReader {
  readAsText(file) {
    if (file.failRead) {
      this.onerror?.(new Error('read failed'));
      return;
    }
    this.onload?.({ target: { result: file.text } });
  }
}

function createRafHarness() {
  let nextId = 1;
  const frames = new Map();
  return {
    frames,
    requestAnimationFrame(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    runNextFrame() {
      const [id, callback] = frames.entries().next().value || [];
      if (!id) return false;
      frames.delete(id);
      callback();
      return true;
    }
  };
}

function createHarness(options = {}) {
  const calls = [];
  const documentRef = createDocument();
  const pipeline = appendWithId(documentRef.body, 'div', 'pipeline');
  const header = documentRef.createElement('div');
  header.className = 'pipeline-header';
  pipeline.appendChild(header);
  const pipelineList = appendWithId(pipeline, 'div', 'pipelineList');
  const fileDropArea = documentRef.createElement('div');
  fileDropArea.className = 'file-drop-area';
  pipeline.appendChild(fileDropArea);
  const indicator = documentRef.createElement('div');
  indicator.style.display = 'none';
  const plugins = options.plugins ?? [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }, { id: 3, name: 'Three' }];
  const pluginListManager = options.pluginListManager ?? {
    getInsertionIndicator: () => indicator,
    findInsertionIndex: (...args) => {
      calls.push(['findInsertionIndex', ...args]);
      return options.targetIndex ?? 1;
    },
    updateInsertionIndicator: (x, y) => calls.push(['updateInsertionIndicator', x, y]),
    checkWindowWidthAndAdjust: () => calls.push(['checkWindowWidthAndAdjust']),
    addUserPresetToPipeline: async (name, index) => calls.push(['addUserPresetToPipeline', name, index]),
    initPresetManager: async () => calls.push(['initPresetManager']),
    presetManager: {
      addPresetToPipeline: async (name, index) => calls.push(['addPresetToPipeline', name, index])
    }
  };
  const fileProcessor = options.fileProcessor ?? {
    createFileDropArea: element => calls.push(['createFileDropArea', element?.id]),
    setupFileDropHandlers: () => calls.push(['setupFileDropHandlers'])
  };
  const pipelineManager = options.pipelineManager ?? {
    clipboardManager: {
      copySelectedPluginsToClipboard: () => calls.push(['copySelectedPluginsToClipboard']),
      cutSelectedPlugins: () => calls.push(['cutSelectedPlugins']),
      handlePaste: text => calls.push(['handlePaste', text])
    },
    presetManager: {
      presetSelect: {
        value: 'Name',
        focus: () => calls.push(['focusPreset']),
        select: () => calls.push(['selectPreset']),
        matches: () => true
      },
      savePreset: name => calls.push(['savePreset', name])
    },
    fileProcessor,
    pluginListManager,
    pluginManager: {
      pluginClasses: { Gain: class Gain {} },
      createPlugin: name => {
        calls.push(['createPlugin', name]);
        return Object.prototype.hasOwnProperty.call(options, 'createPluginResult')
          ? options.createPluginResult
          : { id: 99, name };
      }
    },
    expandedPlugins: new Set(),
    audioManager: {
      pipeline: plugins
    }
  };
  const selectedPlugins = new Set([plugins[0]]);
  const core = options.core ?? {
    pipelineList,
    selectedPlugins,
    updateSelectionClasses: () => calls.push(['updateSelectionClasses']),
    handlePluginSelection: (plugin, event) => calls.push(['handlePluginSelection', plugin.name, event.clientX]),
    updateWorkletPlugins: () => calls.push(['updateWorkletPlugins']),
    updatePipelineUI: force => calls.push(['updatePipelineUI', force]),
    deleteSelectedPlugins: () => calls.push(['deleteSelectedPlugins'])
  };
  const historyManager = options.historyManager ?? {
    undo: () => calls.push(['undo']),
    redo: () => calls.push(['redo']),
    saveState: () => calls.push(['saveState'])
  };
  const uiManager = options.uiManager === false ? null : {
    pluginListManager: options.windowPluginListManager,
    loadPreset: preset => calls.push(['loadPreset', preset]),
    setError: (...args) => calls.push(['setError', ...args]),
    createAudioPlayer: (...args) => calls.push(['createAudioPlayer', ...args])
  };
  const raf = createRafHarness();
  const windowRef = {
    electronIntegration: options.electronIntegration ?? null,
    uiManager,
    electronAPI: options.electronAPI
  };

  return {
    calls,
    documentRef,
    windowRef,
    raf,
    pipeline,
    pipelineList,
    header,
    fileDropArea,
    indicator,
    plugins,
    pipelineManager,
    pluginListManager,
    core,
    historyManager
  };
}

async function withUIEventGlobals(options, callback) {
  const harness = createHarness(options);
  await withGlobals({
    document: harness.documentRef,
    window: harness.windowRef,
    FileReader: options.FileReader ?? FakeFileReader,
    requestAnimationFrame: harness.raf.requestAnimationFrame,
    cancelAnimationFrame: harness.raf.cancelAnimationFrame,
    console: {
      log: (...args) => harness.calls.push(['console.log', ...args]),
      warn: (...args) => harness.calls.push(['console.warn', ...args]),
      error: (...args) => harness.calls.push(['console.error', ...args])
    }
  }, async () => {
    await callback(harness);
  });
}

function createHandler(harness) {
  return new UIEventHandler(harness.pipelineManager, harness.historyManager, harness.core);
}

test('constructor and keyboard/paste listeners handle missing and active documents', async () => {
  await withUIEventGlobals({}, async harness => {
    createHandler(harness);

    harness.documentRef.dispatch('keydown', { key: 'a', ctrlKey: true });
    harness.documentRef.dispatch('paste', {
      clipboardData: { getData: () => 'copied pipeline' },
      target: harness.pipeline
    });

    assert.ok(harness.calls.some(call => call[0] === 'updateSelectionClasses'));
    assert.ok(harness.calls.some(call => call[0] === 'handlePaste' && call[1] === 'copied pipeline'));
  });

  await withUIEventGlobals({}, async harness => {
    harness.documentRef.elementsById.delete('pipelineList');
    const handler = createHandler(harness);
    assert.equal(handler.pipelineListElement, null);
    assert.ok(harness.calls.some(call => call[0] === 'console.error'));
  });
});

test('initDragAndDrop handles browser files, presets, music, errors, and Electron skips', async () => {
  await withUIEventGlobals({}, async harness => {
    createHandler(harness).initDragAndDrop();
    assert.ok(harness.calls.some(call => call[0] === 'createFileDropArea'));
    assert.ok(harness.calls.some(call => call[0] === 'setupFileDropHandlers'));
    assert.equal(harness.documentRef.head.querySelector('#drag-drop-style') !== null, true);
    createHandler(harness).initDragAndDrop();

    const dragEvent = harness.documentRef.dispatch('dragover', {
      target: harness.pipeline,
      dataTransfer: createDataTransfer({
        types: ['Files'],
        items: [{ kind: 'file' }],
        files: [createFile('song.wav')]
      })
    }).event;
    assert.ok(dragEvent.prevented >= 1);
    assert.ok(dragEvent.stopped >= 1);
    assert.equal(harness.documentRef.body.classList.contains('drag-over'), true);

    harness.documentRef.dispatch('dragover', {
      target: harness.pipeline,
      dataTransfer: createDataTransfer({
        types: ['Files'],
        files: [createFile('song.wav')]
      })
    });

    harness.documentRef.dispatch('dragover', {
      target: harness.fileDropArea,
      dataTransfer: createDataTransfer({
        types: ['Files'],
        items: [{ kind: 'file' }],
        files: [createFile('song.wav')]
      })
    });
    assert.equal(harness.documentRef.body.classList.contains('drag-over'), false);

    harness.documentRef.body.classList.add('drag-over');
    harness.documentRef.dispatch('dragleave', { relatedTarget: harness.documentRef.documentElement });
    assert.equal(harness.documentRef.body.classList.contains('drag-over'), false);

    harness.documentRef.dispatch('drop', {
      target: harness.fileDropArea,
      dataTransfer: createDataTransfer({
        types: ['Files'],
        files: [createFile('song.wav')]
      })
    });

    const libraryView = harness.documentRef.createElement('section');
    libraryView.className = 'library-view';
    const libraryContent = harness.documentRef.createElement('div');
    libraryContent.className = 'library-content';
    libraryView.appendChild(libraryContent);
    harness.documentRef.body.appendChild(libraryView);
    harness.documentRef.body.classList.add('drag-over');
    const libraryDrag = harness.documentRef.dispatch('dragover', {
      target: libraryContent,
      dataTransfer: createDataTransfer({
        types: ['Files'],
        items: [{ kind: 'file' }],
        files: []
      })
    }).event;
    assert.ok(libraryDrag.prevented >= 1);
    assert.equal(libraryDrag.stopped, 0);
    assert.equal(libraryDrag.dataTransfer.dropEffect, 'copy');
    assert.equal(harness.documentRef.body.classList.contains('drag-over'), false);

    const beforeLibraryDropCalls = harness.calls.length;
    const libraryDrop = harness.documentRef.dispatch('drop', {
      target: libraryContent,
      dataTransfer: createDataTransfer({
        types: ['Files'],
        files: [createFile('daily.m3u8')]
      })
    }).event;
    assert.equal(libraryDrop.prevented, 0);
    assert.equal(libraryDrop.stopped, 0);
    assert.deepEqual(harness.calls.slice(beforeLibraryDropCalls), []);

    harness.documentRef.dispatch('drop', {
      target: harness.pipeline,
      dataTransfer: createDataTransfer({
        types: ['Files'],
        files: [createFile('preset.effetune_preset', { text: '{"name":"Preset"}' })]
      })
    });
    assert.ok(harness.calls.some(call => call[0] === 'loadPreset' && call[1].name === 'Preset'));

    harness.documentRef.dispatch('drop', {
      target: harness.pipeline,
      dataTransfer: createDataTransfer({
        types: ['Files'],
        files: [createFile('bad.effetune_preset', { text: '{bad' })]
      })
    });
    assert.ok(harness.calls.some(call => call[0] === 'setError' && call[1] === 'Invalid preset file format'));

    harness.documentRef.dispatch('drop', {
      target: harness.pipeline,
      dataTransfer: createDataTransfer({
        types: ['Files'],
        files: [createFile('bad.effetune_preset', { failRead: true })]
      })
    });
    assert.ok(harness.calls.some(call => call[0] === 'setError' && call[1] === 'Failed to read preset file'));

    harness.documentRef.dispatch('drop', {
      target: harness.pipeline,
      dataTransfer: createDataTransfer({
        types: ['Files'],
        files: [createFile('track.flac'), createFile('note.txt'), {}]
      })
    });
    assert.ok(harness.calls.some(call => call[0] === 'createAudioPlayer' && call[1].length === 1));

    harness.documentRef.dispatch('drop', {
      target: harness.pipeline,
      dataTransfer: createDataTransfer({
        types: ['Files', 'text/plain'],
        files: [createFile('ignored.wav')]
      })
    });
  });

  await withUIEventGlobals({
    electronIntegration: { isElectron: true },
    fileProcessor: null
  }, async harness => {
    createHandler(harness).initDragAndDrop();
    assert.equal(harness.documentRef.head.children.length, 0);
  });
});

test('selection and pipeline-level drag handlers handle skips, clears, files, reorders, and new plugin drops', async () => {
  await withUIEventGlobals({}, async harness => {
    const handler = createHandler(harness);
    handler.setupPluginSelectionHandlers(harness.pipeline);

    const cutButton = harness.documentRef.createElement('button');
    cutButton.className = 'cut-button';
    harness.pipeline.appendChild(cutButton);
    harness.pipeline.dispatch('click', { target: cutButton });
    assert.equal(harness.calls.some(call => call[0] === 'updateSelectionClasses'), false);

    harness.pipeline.dispatch('click', { target: harness.header });
    assert.equal(harness.core.selectedPlugins.size, 0);
    assert.ok(harness.calls.some(call => call[0] === 'updateSelectionClasses'));

    const headerChild = harness.documentRef.createElement('span');
    harness.header.appendChild(headerChild);
    harness.pipeline.dispatch('click', { target: headerChild });

    handler.setupPluginDragHandlers(harness.pipeline);
    harness.pipeline.dispatch('dragleave', { relatedTarget: harness.pipelineList });
    assert.equal(harness.indicator.style.display, 'none');
    harness.indicator.style.display = 'block';
    harness.pipeline.dispatch('dragleave', { relatedTarget: null });
    assert.equal(harness.indicator.style.display, 'none');

    let drop = harness.pipeline.dispatch('drop', {
      target: harness.pipelineList,
      dataTransfer: createDataTransfer({ types: [] })
    }).event;
    assert.equal(drop.prevented, 0);

    drop = harness.pipeline.dispatch('drop', {
      target: harness.pipeline,
      dataTransfer: createDataTransfer({ types: ['Files'] })
    }).event;
    assert.equal(drop.prevented, 0);

    drop = harness.pipeline.dispatch('drop', {
      target: harness.pipeline,
      dataTransfer: createDataTransfer({
        types: ['application/plugin-index'],
        data: { 'application/plugin-index': '1' }
      })
    }).event;
    assert.equal(drop.prevented, 1);
    assert.equal(harness.calls.some(call => call[0] === 'createPlugin'), false);

    harness.pipeline.dispatch('drop', {
      target: harness.pipeline,
      dataTransfer: createDataTransfer({ types: [] })
    });

    drop = harness.pipeline.dispatch('drop', {
      target: harness.pipeline,
      clientX: 20,
      clientY: 30,
      dataTransfer: createDataTransfer({
        types: ['text/plain'],
        data: { 'text/plain': 'Gain' }
      })
    }).event;
    await flushMicrotasks();
    assert.equal(drop.prevented, 1);
    assert.ok(harness.calls.some(call => call[0] === 'createPlugin' && call[1] === 'Gain'));
  });
});

test('setupDragEvents handles mouse, touch, cancellation, and unavailable pipeline guards', async () => {
  await withUIEventGlobals({}, async harness => {
    const handler = createHandler(harness);
    const handle = harness.documentRef.createElement('div');
    const item = harness.documentRef.createElement('div');
    handler.setupDragEvents(handle, item, harness.plugins[0]);

    const dataTransfer = createDataTransfer();
    handle.dispatch('dragstart', { dataTransfer });
    assert.equal(dataTransfer.getData('application/plugin-id'), '1');
    assert.equal(dataTransfer.getData('application/plugin-index'), '0');
    assert.equal(item.classList.contains('dragging'), true);
    handle.dispatch('dragend');
    assert.equal(item.classList.contains('dragging'), false);

    handle.dispatch('touchmove', { touches: [{ clientX: 2, clientY: 3 }] });
    handle.dispatch('touchend', { changedTouches: [{ clientX: 2, clientY: 3 }] });

    handle.dispatch('touchstart', { touches: [{ clientX: 30, clientY: 40 }] });
    assert.equal(item.classList.contains('dragging'), true);
    assert.equal(harness.indicator.style.display, 'block');
    handle.dispatch('touchmove', { touches: [{ clientX: 55, clientY: 65 }] });
    harness.pluginListManager.findInsertionIndex = () => 3;
    harness.documentRef.elementFromPointTarget = harness.pipelineList;
    handle.dispatch('touchend', { changedTouches: [{ clientX: 70, clientY: 80 }] });
    assert.equal(item.classList.contains('dragging'), false);
    assert.ok(harness.calls.some(call => call[0] === 'handlePluginSelection'));

    handle.dispatch('touchstart', { touches: [] });
    harness.documentRef.elementFromPointTarget = harness.pipeline;
    handle.dispatch('touchend', { changedTouches: [{ clientX: 70, clientY: 80 }] });
    for (let i = 0; i < 3; i++) {
      harness.raf.runNextFrame();
    }
    assert.ok(harness.calls.some(call => call[0] === 'updatePipelineUI' && call[1] === false));

    handle.dispatch('touchstart', { touches: [{ clientX: 1, clientY: 2 }] });
    handle.dispatch('touchcancel');
    for (let i = 0; i < 3; i++) {
      harness.raf.runNextFrame();
    }
    assert.equal(handler.draggingPluginInfo, null);

    handle.dispatch('touchstart', { touches: [{ clientX: 1, clientY: 2 }] });
    handler.draggingPluginInfo = null;
    handle.dispatch('touchend', { changedTouches: [{ clientX: 1, clientY: 2 }] });
    for (let i = 0; i < 3; i++) {
      harness.raf.runNextFrame();
    }
  });

  await withUIEventGlobals({
    pipelineManager: { clipboardManager: {}, audioManager: null }
  }, async harness => {
    const handler = createHandler(harness);
    handler.setupDragEvents(harness.documentRef.createElement('div'), harness.documentRef.createElement('div'), { name: 'Missing' });
    assert.ok(harness.calls.some(call => call[0] === 'console.error'));
  });

  await withUIEventGlobals({}, async harness => {
    const handler = createHandler(harness);
    handler.setupDragEvents(harness.documentRef.createElement('div'), harness.documentRef.createElement('div'), { name: 'Absent' });
    assert.ok(harness.calls.some(call => call[0] === 'console.warn'));
  });
});

test('handlePluginReordering handles guards, no-op moves, bounds, and successful reorder', async () => {
  await withUIEventGlobals({}, async harness => {
    const handler = createHandler(harness);
    handler.handlePluginReordering({ clientX: 10, clientY: 20 }, -1);
    handler.handlePluginReordering({ clientX: 'x', clientY: 20 }, 0);
    handler.handlePluginReordering({ clientX: 10, clientY: 20 }, 0);
    for (let i = 0; i < 4; i++) {
      harness.raf.runNextFrame();
    }
    assert.ok(harness.calls.some(call => call[0] === 'updatePipelineUI' && call[1] === false));

    const secondPlugin = harness.pipelineManager.audioManager.pipeline[1];
    harness.pipelineManager.audioManager.pipeline[1] = undefined;
    handler.handlePluginReordering({ clientX: 10, clientY: 20 }, 1);
    for (let i = 0; i < 2; i++) {
      harness.raf.runNextFrame();
    }
    harness.pipelineManager.audioManager.pipeline[1] = secondPlugin;

    harness.pluginListManager.findInsertionIndex = () => 3;
    handler.handlePluginReordering({ clientX: 10, clientY: 20 }, 0);
    harness.raf.runNextFrame();
    assert.deepEqual(harness.pipelineManager.audioManager.pipeline.map(plugin => plugin.name), ['Two', 'Three', 'One']);
    assert.ok(harness.calls.some(call => call[0] === 'saveState'));

    harness.pluginListManager.findInsertionIndex = () => -10;
    handler.handlePluginReordering({ clientX: 10, clientY: 20 }, 1);
    harness.pluginListManager.findInsertionIndex = () => 99;
    handler.handlePluginReordering({ clientX: 10, clientY: 20 }, 0);
  });

  await withUIEventGlobals({
    pluginListManager: null,
    windowPluginListManager: null
  }, async harness => {
    const handler = createHandler(harness);
    handler.pipelineManager.pluginListManager = null;
    handler.handlePluginReordering({ clientX: 1, clientY: 2 }, 0);
    assert.ok(harness.calls.some(call => call[0] === 'console.error'));
  });

  await withUIEventGlobals({}, async harness => {
    const handler = createHandler(harness);
    handler.pipelineManager.audioManager = null;
    handler.handlePluginReordering({ clientX: 1, clientY: 2 }, 0);
    assert.ok(harness.calls.some(call => call[0] === 'console.error'));
  });
});

test('UIEventHandler defensive paths recover through direct guards and rAF fallbacks', async () => {
  await withUIEventGlobals({}, async harness => {
    const handler = createHandler(harness);
    handler.pipelineListElement = null;
    handler.setupPipelineDropZoneEvents();
    assert.ok(harness.calls.some(call => call[0] === 'console.error'));
  });

  await withUIEventGlobals({}, async harness => {
    const handler = createHandler(harness);
    handler.rafId = harness.raf.requestAnimationFrame(() => {});
    const event = harness.pipelineList.dispatch('drop', {
      dataTransfer: createDataTransfer()
    }).event;
    assert.equal(event.prevented, 1);
    assert.equal(handler.rafId, null);
  });

  await withUIEventGlobals({}, async harness => {
    const handler = createHandler(harness);
    handler.core = {
      handlePluginSelection: () => {},
      updateWorkletPlugins: () => {}
    };
    harness.pluginListManager.findInsertionIndex = () => 3;
    handler.handlePluginReordering({ clientX: 10, clientY: 20 }, 0);
    harness.raf.runNextFrame();
    assert.ok(harness.calls.some(call => call[0] === 'console.error'));
  });

  await withUIEventGlobals({}, async harness => {
    const handler = createHandler(harness);
    handler.core = {
      handlePluginSelection: () => {},
      updateWorkletPlugins: () => {}
    };
    await handler.handleNewPluginDrop({
      clientX: 5,
      clientY: 6,
      dataTransfer: createDataTransfer({ data: { 'text/plain': 'Gain' } })
    });
    harness.raf.runNextFrame();
    assert.ok(harness.calls.some(call => call[0] === 'console.error'));
  });

  await withUIEventGlobals({}, async harness => {
    const handler = createHandler(harness);
    await handler.handleNewPluginDrop({
      dataTransfer: createDataTransfer({ data: { 'text/plain': 'Unknown' } })
    });
    await handler.handleNewPluginDrop({
      dataTransfer: createDataTransfer({ data: { 'text/plain': '' } })
    });
  });

  await withUIEventGlobals({
    windowPluginListManager: {
      getInsertionIndicator: () => ({ style: {} })
    }
  }, async harness => {
    const handler = createHandler(harness);
    handler.pipelineManager = null;
    await handler.handleNewPluginDrop({
      dataTransfer: createDataTransfer({ data: { 'text/plain': 'Gain' } })
    });
    assert.ok(harness.calls.some(call => call[0] === 'console.error'));
  });
});

test('fallback plugin-list manager supports touch cancellation and preset drops', async () => {
  const fallbackManager = {
    indicator: { style: { display: 'none' } },
    getInsertionIndicator() {
      return this.indicator;
    },
    updateInsertionIndicator() {},
    findInsertionIndex: () => 2,
    checkWindowWidthAndAdjust() {},
    addUserPresetToPipeline: async () => {},
    initPresetManager: async () => {},
    presetManager: {
      addPresetToPipeline: async () => {}
    }
  };

  await withUIEventGlobals({ windowPluginListManager: fallbackManager }, async harness => {
    const handler = createHandler(harness);
    handler.pipelineManager.pluginListManager = null;
    const handle = harness.documentRef.createElement('div');
    const item = harness.documentRef.createElement('div');
    handler.setupDragEvents(handle, item, harness.plugins[0]);
    handler.handlePluginReordering = event => {
      event.preventDefault();
      event.stopPropagation();
      harness.calls.push(['mockReorder']);
    };

    handle.dispatch('touchcancel');
    handle.dispatch('touchstart', { touches: [{ clientX: 1, clientY: 2 }] });
    harness.documentRef.elementFromPointTarget = harness.pipelineList;
    handle.dispatch('touchend', { changedTouches: [{ clientX: 3, clientY: 4 }] });
    assert.ok(harness.calls.some(call => call[0] === 'mockReorder'));

    handle.dispatch('touchstart', { touches: [{ clientX: 1, clientY: 2 }] });
    handle.dispatch('touchcancel');
    for (let i = 0; i < 3; i++) {
      harness.raf.runNextFrame();
    }
  });

  await withUIEventGlobals({ windowPluginListManager: fallbackManager }, async harness => {
    const handler = createHandler(harness);
    handler.pipelineManager.pluginListManager = null;
    await handler.handleUserPresetDrop({ clientX: 1, clientY: 2 }, 'User');
    await handler.handlePresetDrop({ clientX: 1, clientY: 2 }, 'System');

    harness.pipelineList.dispatch('dragover', {
      dataTransfer: createDataTransfer({ types: ['text/plain', 'Files'] })
    });

    handler.rafId = harness.raf.requestAnimationFrame(() => {});
    harness.pipelineList.dispatch('dragleave', { clientX: -1, clientY: 5 });

    handler.rafId = harness.raf.requestAnimationFrame(() => {});
    harness.pipelineList.dispatch('drop', {
      dataTransfer: createDataTransfer()
    });

    handler.isDraggingOver = true;
    handler.lastClientX = 1;
    handler.lastClientY = 2;
    handler.updateIndicatorLoop();
    handler.isDraggingOver = false;
    harness.raf.runNextFrame();
    assert.equal(handler.prevClientX, -1);
  });
});

test('new plugin and preset drops handle JSON, creation, missing dependencies, and error reporting', async () => {
  await withUIEventGlobals({}, async harness => {
    const handler = createHandler(harness);
    await handler.handleNewPluginDrop({
      clientX: 5,
      clientY: 6,
      dataTransfer: createDataTransfer({ data: { 'text/plain': JSON.stringify({ type: 'preset', name: 'System' }) } })
    });
    await handler.handleNewPluginDrop({
      clientX: 7,
      clientY: 8,
      dataTransfer: createDataTransfer({ data: { 'text/plain': JSON.stringify({ type: 'userPreset', name: 'User' }) } })
    });
    await handler.handleNewPluginDrop({
      clientX: 9,
      clientY: 10,
      dataTransfer: createDataTransfer({ data: { 'text/plain': 'Gain' } })
    });
    harness.raf.runNextFrame();
    assert.ok(harness.calls.some(call => call[0] === 'addPresetToPipeline' && call[1] === 'System'));
    assert.ok(harness.calls.some(call => call[0] === 'addUserPresetToPipeline' && call[1] === 'User'));
    assert.ok(harness.calls.some(call => call[0] === 'checkWindowWidthAndAdjust'));
  });

  await withUIEventGlobals({ createPluginResult: null }, async harness => {
    await createHandler(harness).handleNewPluginDrop({
      dataTransfer: createDataTransfer({ data: { 'text/plain': 'Gain' } })
    });
    assert.ok(harness.calls.some(call => call[0] === 'console.error'));
  });

  await withUIEventGlobals({}, async harness => {
    const handler = createHandler(harness);
    handler.pipelineManager.expandedPlugins = null;
    await handler.handleNewPluginDrop({
      dataTransfer: createDataTransfer({ data: { 'text/plain': 'Gain' } })
    });
    assert.ok(harness.calls.some(call => call[0] === 'console.error'));
  });

  await withUIEventGlobals({}, async harness => {
    const handler = createHandler(harness);
    handler.core = {};
    await handler.handleNewPluginDrop({
      dataTransfer: createDataTransfer({ data: { 'text/plain': 'Gain' } })
    });
    assert.ok(harness.pipelineManager.audioManager.pipeline.some(plugin => plugin.name === 'Gain'));
  });

  await withUIEventGlobals({}, async harness => {
    const handler = createHandler(harness);
    handler.core = { handlePluginSelection: () => {} };
    await handler.handleNewPluginDrop({
      dataTransfer: createDataTransfer({ data: { 'text/plain': 'Gain' } })
    });
    assert.ok(harness.pipelineManager.audioManager.pipeline.some(plugin => plugin.name === 'Gain'));
  });

  await withUIEventGlobals({}, async harness => {
    const handler = createHandler(harness);
    handler.historyManager = {};
    await handler.handleNewPluginDrop({
      dataTransfer: createDataTransfer({ data: { 'text/plain': 'Gain' } })
    });
    assert.ok(harness.calls.some(call => call[0] === 'updateWorkletPlugins'));
  });

  await withUIEventGlobals({
    pluginListManager: {
      getInsertionIndicator: () => ({ style: {} }),
      findInsertionIndex: () => 0,
      checkWindowWidthAndAdjust: () => { throw new Error('preset failed'); },
      addUserPresetToPipeline: async () => { throw new Error('user failed'); },
      initPresetManager: async () => { throw new Error('system failed'); }
    }
  }, async harness => {
    const handler = createHandler(harness);
    await handler.handleUserPresetDrop({ clientX: 1, clientY: 2 }, 'User');
    await handler.handlePresetDrop({ clientX: 1, clientY: 2 }, 'System');
    assert.ok(harness.calls.some(call => call[0] === 'setError' && String(call[1]).includes('user failed')));
    assert.ok(harness.calls.some(call => call[0] === 'setError' && String(call[1]).includes('system failed')));
  });

  await withUIEventGlobals({
    pluginListManager: null,
    windowPluginListManager: null,
    uiManager: false
  }, async harness => {
    const handler = createHandler(harness);
    handler.pipelineManager.pluginListManager = null;
    await handler.handleNewPluginDrop({ dataTransfer: createDataTransfer({ data: { 'text/plain': 'Gain' } }) });
    await handler.handleUserPresetDrop({ clientX: 1, clientY: 2 }, 'User');
    await handler.handlePresetDrop({ clientX: 1, clientY: 2 }, 'System');
    assert.ok(harness.calls.some(call => call[0] === 'console.error'));
  });
});

test('pipeline drop zone events and indicator loop handle plugin and non-plugin drops', async () => {
  await withUIEventGlobals({}, async harness => {
    const handler = createHandler(harness);

    let event = harness.pipelineList.dispatch('dragenter', {
      dataTransfer: createDataTransfer({ types: ['text/plain'] })
    }).event;
    assert.equal(event.prevented, 1);
    assert.equal(harness.indicator.style.display, 'block');

    event = harness.pipelineList.dispatch('dragover', {
      clientX: 33,
      clientY: 44,
      dataTransfer: createDataTransfer({ types: ['application/plugin-id'] })
    }).event;
    assert.equal(event.prevented, 1);
    assert.equal(event.dataTransfer.dropEffect, 'move');
    assert.equal(handler.lastClientX, 33);

    handler.isDraggingOver = true;
    handler.lastClientX = 11;
    handler.lastClientY = 12;
    handler.updateIndicatorLoop();
    assert.ok(harness.calls.some(call => call[0] === 'updateInsertionIndicator' && call[1] === 11));

    handler.lastClientX = 'bad';
    handler.lastClientY = 12;
    handler.updateIndicatorLoop();

    harness.pipelineList.dispatch('dragleave', { clientX: 50, clientY: 50 });
    assert.equal(handler.isDraggingOver, true);
    harness.pipelineList.dispatch('dragleave', { clientX: -1, clientY: 50 });
    assert.equal(handler.isDraggingOver, false);

    event = harness.pipelineList.dispatch('drop', {
      clientX: 10,
      clientY: 20,
      dataTransfer: createDataTransfer({
        data: { 'application/plugin-index': '1' }
      })
    }).event;
    assert.equal(event.stopped, 1);

    event = harness.pipelineList.dispatch('drop', {
      clientX: 10,
      clientY: 20,
      dataTransfer: createDataTransfer({
        data: { 'application/plugin-index': 'not-a-number' }
      })
    }).event;
    assert.equal(event.stopped, 0);

    event = harness.pipelineList.dispatch('drop', {
      clientX: 10,
      clientY: 20,
      dataTransfer: createDataTransfer({
        data: { 'text/plain': 'Gain' }
      })
    }).event;
    await flushMicrotasks();
    assert.equal(event.stopped, 1);

    event = harness.pipelineList.dispatch('drop', {
      dataTransfer: createDataTransfer()
    }).event;
    assert.equal(event.prevented, 1);

    harness.pipelineList.dispatch('dragenter', {
      dataTransfer: createDataTransfer({ types: ['Files'] })
    });
    harness.pipelineList.dispatch('dragover', {
      dataTransfer: createDataTransfer({ types: ['Files'] })
    });

    handler.isDraggingOver = false;
    handler.updateIndicatorLoop();
    assert.equal(handler.prevClientX, -1);
  });

  await withUIEventGlobals({
    pluginListManager: null,
    windowPluginListManager: {
      getInsertionIndicator: () => ({ style: {} }),
      updateInsertionIndicator: () => {},
      findInsertionIndex: () => 0,
      checkWindowWidthAndAdjust: () => {}
    }
  }, async harness => {
    const handler = createHandler(harness);
    handler.pipelineManager.pluginListManager = null;
    harness.pipelineList.dispatch('dragenter', {
      dataTransfer: createDataTransfer({ types: ['text/plain'] })
    });
    handler.isDraggingOver = true;
    handler.updateIndicatorLoop();
  });
});
