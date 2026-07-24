import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { UIManager } from '../../js/ui-manager.js';
import { AudioPlayer } from '../../js/ui/audio-player.js';
import { encodePipelineState, decodePipelineState } from '../../js/utils/pipeline-state-codec.js';
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

  add(...items) {
    const tokens = this._tokens();
    items.forEach(item => tokens.add(item));
    this._write(tokens);
  }

  remove(...items) {
    const tokens = this._tokens();
    items.forEach(item => tokens.delete(item));
    this._write(tokens);
  }

  contains(item) {
    return this._tokens().has(item);
  }

  toggle(item, force) {
    const tokens = this._tokens();
    const shouldAdd = force === undefined ? !tokens.has(item) : Boolean(force);
    if (shouldAdd) tokens.add(item);
    else tokens.delete(item);
    this._write(tokens);
    return shouldAdd;
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
    this.id = '';
    this.className = '';
    this.classList = new FakeClassList(this);
    this.style = {
      setProperty: (name, value) => {
        this.style[name] = value;
      }
    };
    this.dataset = {};
    this.textContent = '';
    this.value = '';
    this.href = '';
    this.target = '';
    this.title = '';
    this.type = '';
    this.accept = '';
    this.multiple = false;
    this.files = [];
    this.clicked = false;
    this.draggable = false;
    this.rect = { left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 };
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    this.childNodes = this.children;
    this.ownerDocument.allElements.add(child);
    if (child.id) this.ownerDocument.elementsById.set(child.id, child);
    return child;
  }

  append(...nodes) {
    nodes.forEach(node => this.appendChild(node));
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      this.childNodes = this.children;
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, []);
    this.eventListeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    if (!this.eventListeners.has(type)) return;
    this.eventListeners.set(type, this.eventListeners.get(type).filter(candidate => candidate !== listener));
  }

  dispatch(type, event = {}) {
    const eventObject = {
      target: this,
      key: event.key,
      ctrlKey: Boolean(event.ctrlKey),
      shiftKey: Boolean(event.shiftKey),
      altKey: Boolean(event.altKey),
      metaKey: Boolean(event.metaKey),
      prevented: 0,
      stopped: 0,
      preventDefault() {
        this.prevented++;
      },
      stopPropagation() {
        this.stopped++;
      },
      ...event
    };
    const results = [];
    for (const listener of this.eventListeners.get(type) || []) {
      results.push(listener(eventObject));
    }
    return Promise.all(results).then(() => eventObject);
  }

  click() {
    this.clicked = true;
    return this.dispatch('click');
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  select() {
    this.selected = true;
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  getBoundingClientRect() {
    return this.rect;
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
    if (!selector) return false;
    if (selector === 'input, textarea') return this.tagName === 'INPUT' || this.tagName === 'TEXTAREA';
    if (selector === 'input[type="range"]') return this.tagName === 'INPUT' && this.type === 'range';
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) {
      return selector.slice(1).split('.').every(cls => this.classList.contains(cls));
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches?.(selector)) return current;
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
        if (matchesSelector(child, selector)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }
}

function matchesSelector(element, selector) {
  if (selector === '.pipeline-header h2') {
    return element.tagName === 'H2' && element.parentNode?.classList?.contains('pipeline-header');
  }
  return element.matches(selector);
}

function createDocument() {
  const document = {
    allElements: new Set(),
    elementsById: new Map(),
    eventListeners: new Map(),
    body: null,
    documentElement: null,
    activeElement: null,
    createElement(tagName) {
      const element = new FakeElement(tagName, document);
      document.allElements.add(element);
      return element;
    },
    createTextNode(text) {
      const node = new FakeElement('#text', document);
      node.textContent = text;
      return node;
    },
    getElementById(id) {
      return document.elementsById.get(id) || null;
    },
    querySelector(selector) {
      return document.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      return [...document.allElements].filter(element => matchesSelector(element, selector));
    },
    addEventListener(type, listener) {
      if (!document.eventListeners.has(type)) document.eventListeners.set(type, []);
      document.eventListeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      if (!document.eventListeners.has(type)) return;
      document.eventListeners.set(
        type,
        document.eventListeners.get(type).filter(candidate => candidate !== listener)
      );
    },
    dispatch(type, event = {}) {
      const eventObject = {
        key: event.key,
        target: event.target ?? document.body,
        ctrlKey: Boolean(event.ctrlKey),
        shiftKey: Boolean(event.shiftKey),
        altKey: Boolean(event.altKey),
        metaKey: Boolean(event.metaKey),
        prevented: 0,
        preventDefault() {
          this.prevented++;
        },
        ...event
      };
      const results = [];
      for (const listener of document.eventListeners.get(type) || []) {
        results.push(listener(eventObject));
      }
      return { event: eventObject, results };
    },
    elementFromPoint() {
      return document.getElementById('pipelineList');
    }
  };
  document.body = document.createElement('body');
  document.documentElement = document.createElement('html');
  return document;
}

function appendElement(document, parent, tagName, id, className = '') {
  const element = document.createElement(tagName);
  element.id = id || '';
  element.className = className;
  if (id) document.elementsById.set(id, element);
  parent.appendChild(element);
  return element;
}

function seedDocument(document) {
  const ids = [
    'errorDisplay', 'resetButton', 'shareButton', 'pluginList', 'pipelineList',
    'pipelineEmpty', 'sampleRate', 'effectSearchButton', 'effectSearchInput',
    'effectSearchClearButton', 'availableEffectsTitle', 'tabSwitcher',
    'effectsTab', 'systemPresetsTab', 'userPresetsTab', 'pipeline',
    'presetSelect', 'presetList', 'savePresetButton', 'deletePresetButton',
    'openMusicButton', 'undoButton', 'redoButton', 'cutButton', 'copyButton',
    'pasteButton', 'pipelineToggleButton', 'pipelineMenuButton', 'pipelineMenu',
    'copyAToBButton', 'copyBToAButton', 'doubleBlindTestButton',
    'decreaseColumnsButton', 'increaseColumnsButton', 'sidebarButton'
  ];
  ids.forEach(id => appendElement(document, document.body, id.includes('Input') || id.includes('Select') ? 'input' : 'button', id));

  appendElement(document, document.body, 'div', '', 'subtitle');
  appendElement(document, document.body, 'a', '', 'whats-this');
  const header = appendElement(document, document.body, 'div', '', 'pipeline-header');
  appendElement(document, header, 'h2', '');
  appendElement(document, document.body, 'button', '', 'toggle-button master-toggle');
}

function createStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    }
  };
}

function createPlugin(name = 'Gain') {
  return {
    id: name,
    name,
    enabled: true,
    inputBus: 1,
    outputBus: 2,
    channel: 'L',
    getSerializableParameters() {
      return { amount: 3 };
    }
  };
}

function createManagers(calls) {
  const pluginManager = {
    effectCategories: {},
    pluginClasses: {},
    isPluginAvailable(name) {
      calls.push(['isPluginAvailable', name]);
      return name !== 'Missing';
    }
  };
  const audioManager = {
    pipeline: [],
    pipelineA: [createPlugin('A')],
    pipelineB: null,
    currentPipeline: 'A',
    audioContext: { sampleRate: 48000, destination: { channelCount: 2 } },
    listeners: new Map(),
    getCurrentPipeline() {
      return this.currentPipeline === 'A' ? this.pipelineA : (this.pipelineB || []);
    },
    addEventListener(event, listener) {
      calls.push(['audio.addEventListener', event]);
      this.listeners.set(event, listener);
    },
    async togglePipelineWithTransition() {
      calls.push(['audio.togglePipelineWithTransition']);
      this.currentPipeline = this.currentPipeline === 'A' ? 'B' : 'A';
    },
    async setCurrentPipelineWithTransition(pipeline) {
      calls.push(['audio.setCurrentPipelineWithTransition', pipeline]);
      this.currentPipeline = pipeline;
    },
    copyAToB() {
      calls.push(['audio.copyAToB']);
      this.pipelineB = [...this.pipelineA];
      this.currentPipeline = 'B';
    },
    copyBToA() {
      calls.push(['audio.copyBToA']);
      this.pipelineA = this.pipelineB ? [...this.pipelineB] : this.pipelineA;
      this.currentPipeline = 'A';
    }
  };
  return { audioManager, pluginManager };
}

function createFetch(responses) {
  return async url => {
    const entry = responses[url] ?? responses.default;
    if (entry instanceof Error) throw entry;
    return {
      ok: entry?.ok !== false,
      async text() {
        return entry?.text ?? '{}';
      }
    };
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function withUIHarness(options = {}, callback) {
  const calls = [];
  const document = createDocument();
  seedDocument(document);
  const storage = createStorage();
  const opened = [];
  const objectUrls = [];
  const timers = [];
  const { audioManager, pluginManager } = createManagers(calls);
  const electronIntegration = options.electronIntegration ?? {
    isElectronEnvironment: () => Boolean(options.isElectron),
    updateApplicationMenu: () => calls.push(['electron.updateApplicationMenu']),
    saveConfig: async config => calls.push(['electron.saveConfig', config]),
    openMusicFile: () => calls.push(['electron.openMusicFile']),
    showAudioConfigDialog: () => calls.push(['electron.showAudioConfigDialog'])
  };
  const electronAPI = options.electronAPI ?? null;
  const globals = {
    document,
    window: {
      location: { href: 'https://example.test/effetune.html?p=old', search: options.search ?? '', reload: () => calls.push(['window.reload']) },
      history: { replaceState: (...args) => calls.push(['history.replaceState', ...args]) },
      appConfig: options.appConfig ?? {},
      electronIntegration,
      electronAPI,
      showOpenFilePicker: options.showOpenFilePicker,
      open: (...args) => opened.push(args),
      addEventListener: (...args) => calls.push(['window.addEventListener', ...args]),
      removeEventListener: (...args) => calls.push(['window.removeEventListener', ...args]),
      matchMedia: query => ({
        // Simulate an installed (standalone) desktop session so the layout
        // manager resolves to the desktop layout in these tests.
        matches: query.includes('display-mode: standalone'),
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {}
      })
    },
    navigator: {
      language: options.language ?? 'en-US',
      userAgent: options.userAgent ?? 'Mozilla/5.0',
      platform: options.platform ?? '',
      maxTouchPoints: options.maxTouchPoints ?? 0,
      clipboard: {
        async writeText(text) {
          if (options.clipboardWriteError) throw options.clipboardWriteError;
          calls.push(['clipboard.writeText', text]);
          if (options.clipboardWrite) return options.clipboardWrite(text);
        },
        async readText() {
          if (options.clipboardReadError) throw options.clipboardReadError;
          calls.push(['clipboard.readText']);
          return options.clipboardText ?? 'pasted settings';
        }
      }
    },
    localStorage: storage,
    fetch: createFetch({
      'js/locales/en.json5': options.enResponse ?? { text: JSON.stringify(options.englishTranslations ?? {
        'ui.sleepMode': 'Sleep',
        'success.urlCopied': 'Copied URL',
        'error.failedToCopyUrl': 'Copy failed',
        'error.failedToReadClipboard': 'Read failed',
        'error.invalidUrl': 'Invalid URL: {message}',
        'ui.whatsThisApp': 'What is this?',
        'ui.shareButton': 'Share',
        'ui.dragPluginsHere': 'Drop here',
        'ui.searchEffectsPlaceholder': 'Search',
        'ui.configAudioButton': 'Config Audio',
        'ui.resetButton': 'Reset',
        'ui.dragEffectMessage': 'Drag effect',
        'ui.title.openMusic': 'Open music',
        'menu.doubleBlindTest': 'Double Blind Test'
      }) },
      'js/locales/ja.json5': options.jaResponse ?? { text: JSON.stringify({ 'ui.whatsThisApp': 'これは何ですか', hello: 'こんにちは {name}' }) },
      default: options.defaultFetch ?? { ok: false, text: '{}' }
    }),
    MutationObserver: class {
      constructor(listener) {
        this.listener = listener;
        calls.push(['MutationObserver', this]);
      }
      observe(...args) {
        calls.push(['MutationObserver.observe', ...args]);
      }
    },
    requestAnimationFrame: fn => {
      calls.push(['requestAnimationFrame']);
      fn();
      return 1;
    },
    cancelAnimationFrame: id => calls.push(['cancelAnimationFrame', id]),
    setTimeout: (fn, delay) => {
      timers.push({ fn, delay });
      return timers.length;
    },
    clearTimeout: id => calls.push(['clearTimeout', id]),
    setInterval: (fn, delay) => {
      calls.push(['setInterval', delay]);
      return calls.length;
    },
    clearInterval: id => calls.push(['clearInterval', id]),
    URL: Object.assign(URL, {
      createObjectURL(file) {
        const url = `blob:${file.name}`;
        objectUrls.push(['create', url]);
        return url;
      },
      revokeObjectURL(url) {
        objectUrls.push(['revoke', url]);
      }
    }),
    console: {
      ...console,
      log: (...args) => calls.push(['console.log', ...args]),
      warn: (...args) => calls.push(['console.warn', ...args]),
      error: (...args) => calls.push(['console.error', ...args])
    }
  };

  return withGlobals(globals, async () => {
    const manager = new UIManager(pluginManager, audioManager);
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();
    patchManager(manager, calls);
    return callback({ audioManager, calls, document, manager, objectUrls, opened, pluginManager, timers, window: globals.window });
  });
}

function patchManager(manager, calls) {
  manager.pluginListManager.showLoadingSpinner = () => calls.push(['pluginList.showLoadingSpinner']);
  manager.pluginListManager.hideLoadingSpinner = () => calls.push(['pluginList.hideLoadingSpinner']);
  manager.pluginListManager.updateLoadingProgress = percent => calls.push(['pluginList.updateLoadingProgress', percent]);
  manager.pluginListManager.initPluginList = () => calls.push(['pluginList.initPluginList']);
  manager.pipelineManager.initDragAndDrop = () => calls.push(['pipeline.initDragAndDrop']);
  manager.pipelineManager.updatePipelineUI = (...args) => calls.push(['pipeline.updatePipelineUI', ...args]);
  manager.pipelineManager.getCurrentPresetData = () => ({ preset: true });
  manager.pipelineManager.loadPreset = preset => calls.push(['pipeline.loadPreset', preset]);
  manager.pipelineManager.undo = () => calls.push(['pipeline.undo']);
  manager.pipelineManager.redo = () => calls.push(['pipeline.redo']);
  manager.pipelineManager.clipboardManager = {
    cutSelectedPlugins: () => calls.push(['clipboard.cut']),
    copySelectedPluginsToClipboard: () => calls.push(['clipboard.copy']),
    handlePaste: text => calls.push(['clipboard.paste', text])
  };
}

test('constructs, delegates manager methods, translates errors, parses and serializes URL state', async () => {
  const validState = encodePipelineState([
    { nm: 'Gain', en: false, ib: 1, ob: 2, ch: 'R', amount: 5 },
    { nm: 'Missing' }
  ]);
  await withUIHarness({ search: `?p=${validState}` }, async ({ audioManager, calls, manager, timers }) => {
    manager.audioManager.pipeline = [createPlugin('Gain')];
    manager.showLoadingSpinner();
    manager.hideLoadingSpinner();
    manager.updateLoadingProgress(42);
    manager.initPluginList();
    manager.initDragAndDrop();
    manager.updatePipelineUI();
    assert.equal(calls.some(call => call[0] === 'pluginList.showLoadingSpinner'), true);
    assert.equal(calls.some(call => call[0] === 'pluginList.hideLoadingSpinner'), true);
    assert.equal(calls.some(call => call[0] === 'pluginList.updateLoadingProgress' && call[1] === 42), true);
    assert.equal(calls.some(call => call[0] === 'pluginList.initPluginList'), true);
    assert.equal(calls.some(call => call[0] === 'pipeline.initDragAndDrop'), true);
    assert.equal(calls.some(call => call[0] === 'pipeline.updatePipelineUI'), true);

    manager.setError('success.urlCopied');
    assert.equal(manager.stateManager.errorDisplay.textContent, 'Copied URL');
    manager.setError('status.loading');
    assert.equal(manager.stateManager.errorDisplay.textContent, 'status.loading');
    manager.clearError();
    assert.equal(manager.stateManager.errorDisplay.textContent, '');

    manager.setError('Failure', true);
    const errorTimer = timers.at(-1);
    assert.equal(errorTimer.delay, 5000);
    errorTimer.fn();
    assert.equal(manager.stateManager.errorDisplay.textContent, '');

    manager.setError('Failure', true);
    const supersededErrorTimer = timers.at(-1);
    manager.setError('status.loading');
    supersededErrorTimer.fn();
    assert.equal(manager.stateManager.errorDisplay.textContent, 'status.loading');

    manager.showTransientMessage('success.urlCopied');
    const firstMessageTimer = timers.at(-1);
    assert.equal(firstMessageTimer.delay, 3000);
    manager.showTransientMessage('status.loading');
    const secondMessageTimer = timers.at(-1);
    firstMessageTimer.fn();
    assert.equal(manager.stateManager.errorDisplay.textContent, 'status.loading');
    secondMessageTimer.fn();
    assert.equal(manager.stateManager.errorDisplay.textContent, '');

    const parsed = manager.parsePipelineState();
    assert.equal(parsed[0].name, 'Gain');
    assert.equal(parsed[0].enabled, false);
    assert.equal(parsed[0].channel, 'R');
    assert.equal(parsed[1].enabled, true);

    const encoded = manager.getPipelineState();
    assert.equal(decodePipelineState(encoded)[0].nm, 'Gain');
    assert.equal(manager.isDoubleBlindActive(), false);
    const dbt = manager.getDoubleBlindTest();
    assert.equal(manager.getDoubleBlindTest(), dbt);
    dbt.isActive = () => true;
    dbt._updateStartAvailability = () => calls.push(['doubleBlind.updateStartAvailability']);
    assert.equal(manager.isDoubleBlindActive(), true);
    audioManager.listeners.get('pipelineChanged')?.({});
    assert.equal(calls.some(call => call[0] === 'doubleBlind.updateStartAvailability'), true);
  });
});

test('mini player mode coordinates renderer state, Electron bounds, pinning, and DSP UI suppression', async () => {
  const ipcCalls = [];
  let exitFromMain = null;
  let toggleFromMenu = null;
  const electronAPI = {
    onExitMiniPlayer(callback) {
      exitFromMain = callback;
    },
    onToggleMiniPlayer(callback) {
      toggleFromMenu = callback;
    },
    async setMiniPlayerMode(options) {
      ipcCalls.push(['setMiniPlayerMode', options]);
      return { success: true };
    },
    async setAlwaysOnTop(enabled) {
      ipcCalls.push(['setAlwaysOnTop', enabled]);
      return { success: true };
    }
  };

  await withUIHarness({ electronAPI }, async ({ audioManager, document, manager }) => {
    const uiCalls = [];
    audioManager.powerPolicyController = {
      setDspUiSuppressed: (reason, enabled) => uiCalls.push(['setDspUiSuppressed', reason, enabled])
    };
    manager.audioPlayer = {
      ui: {
        container: {},
        setMiniMode: enabled => uiCalls.push(['setMiniMode', enabled]),
        setMiniPlayerAlwaysOnTop: enabled => uiCalls.push(['setMiniPlayerAlwaysOnTop', enabled])
      }
    };

    assert.equal(typeof exitFromMain, 'function');
    assert.equal(typeof toggleFromMenu, 'function');
    await toggleFromMenu();
    assert.equal(manager.miniPlayerMode, true);
    assert.equal(document.body.classList.contains('layout-mini-player'), true);
    assert.deepEqual(ipcCalls[0], ['setMiniPlayerMode', { enabled: true, alwaysOnTop: false }]);
    assert.deepEqual(uiCalls.slice(0, 2), [
      ['setMiniMode', true],
      ['setDspUiSuppressed', 'mini-player', true]
    ]);

    await manager.setMiniPlayerAlwaysOnTop(true);
    assert.equal(manager.miniPlayerAlwaysOnTop, true);
    assert.deepEqual(ipcCalls[1], ['setAlwaysOnTop', true]);

    await exitFromMain();
    assert.equal(manager.miniPlayerMode, false);
    assert.equal(document.body.classList.contains('layout-mini-player'), false);
    assert.deepEqual(ipcCalls[2], ['setMiniPlayerMode', { enabled: false, alwaysOnTop: true }]);
  });
});

test('mini player mode stays normal when no player UI exists', async () => {
  const ipcCalls = [];
  await withUIHarness({
    electronAPI: {
      onToggleMiniPlayer() {},
      async setMiniPlayerMode(options) { ipcCalls.push(options); }
    }
  }, async ({ document, manager }) => {
    assert.equal(await manager.setMiniPlayerMode(true), false);
    assert.equal(manager.miniPlayerMode, false);
    assert.equal(document.body.classList.contains('layout-mini-player'), false);
    assert.deepEqual(ipcCalls, []);
    assert.equal(manager.stateManager.errorDisplay.textContent, 'ui.mobileNav.noTrack');
  });
});

test('rapid mini player toggles preserve the latest requested mode', async () => {
  const ipcCalls = [];
  await withUIHarness({
    electronAPI: {
      onToggleMiniPlayer() {},
      async setMiniPlayerMode(options) {
        ipcCalls.push(options.enabled);
        return { success: true };
      }
    }
  }, async ({ audioManager, document, manager }) => {
    audioManager.powerPolicyController = { setDspUiSuppressed() {} };
    manager.audioPlayer = {
      ui: {
        container: {},
        setMiniMode() {},
        setMiniPlayerAlwaysOnTop() {}
      }
    };

    const enter = manager.toggleMiniPlayer();
    const exit = manager.toggleMiniPlayer();
    await Promise.all([enter, exit]);

    assert.deepEqual(ipcCalls, [true, false]);
    assert.equal(manager.miniPlayerMode, false);
    assert.equal(manager.miniPlayerTargetMode, false);
    assert.equal(document.body.classList.contains('layout-mini-player'), false);
  });
});

test('handles invalid URL state and URL updates', async () => {
  await withUIHarness({ search: '?p=bad!' }, async ({ calls, manager, timers, window }) => {
    manager.audioManager.pipeline = [createPlugin('Gain')];
    assert.equal(manager.parsePipelineState(), null);
    assert.match(manager.stateManager.errorDisplay.textContent, /Invalid URL/);

    manager.urlReflectionEnabled = false;
    manager.updateURL();
    assert.equal(calls.some(call => call[0] === 'history.replaceState'), false);

    manager.urlReflectionEnabled = true;
    manager.updateURL();
    manager.updateURL();
    assert.equal(calls.some(call => call[0] === 'clearTimeout'), true);
    timers.splice(0).forEach(timer => timer.fn());
    assert.equal(calls.some(call => call[0] === 'history.replaceState'), true);
    assert.ok(window.uiManager);
  });

  await withUIHarness({}, async ({ manager }) => {
    assert.equal(manager.parsePipelineState(), null);
  });

  for (const state of ['not-array', [null], [{ nm: '' }], [{ nm: 'Gain', en: 'yes' }]]) {
    await withUIHarness({ search: `?p=${encodePipelineState(state)}` }, async ({ manager }) => {
      assert.equal(manager.parsePipelineState(), null);
    });
  }
});

test('updates audio, sleep, sample-rate, language, translations, and UI text', async () => {
  await withUIHarness({ isElectron: true, appConfig: { language: 'ja' }, language: 'ja-JP' }, async ({ calls, document, manager }) => {
    manager.initAudio();
    assert.equal(calls.some(call => call[0] === 'MutationObserver.observe'), true);
    const observer = calls.find(call => call[0] === 'MutationObserver')?.[1];
    manager.sampleRate.textContent = 'Sleep';
    observer.listener([{ type: 'childList' }]);
    assert.match(manager.sampleRate.textContent, /Hz/);
    manager.sampleRate.textContent = 'Sleep';
    observer.listener([{ type: 'characterData' }]);
    assert.match(manager.sampleRate.textContent, /Hz/);
    manager.audioManager.listeners.get('sleepModeChanged')?.({ isSleepMode: true, sampleRate: 48000 });
    assert.match(manager.sampleRate.textContent, /Sleep/);
    manager.sampleRate.textContent = '48000 Hz';
    manager.audioManager.powerPolicyController = { isControllerEnabled: () => true };
    manager.audioManager.listeners.get('sleepModeChanged')?.({ isSleepMode: true, sampleRate: 48000 });
    assert.equal(manager.sampleRate.textContent, '48000 Hz');
    manager.audioManager.powerPolicyController = null;
    const sampleRateElement = manager.sampleRate;
    manager.sampleRate = null;
    manager.updateSleepModeDisplay(false, 48000);
    manager.sampleRate = sampleRateElement;
    manager.sampleRate.textContent = '48000 Hz';
    manager.updateSleepModeDisplay(true, 48000);
    assert.match(manager.sampleRate.textContent, /Sleep/);
    manager.audioManager.audioContext.destination.channelCount = 6;
    manager.sampleRate.textContent = 'Sleep';
    manager.updateSleepModeDisplay(false, 96000);
    assert.equal(manager.sampleRate.textContent, '96000 Hz 6ch');
    manager.audioManager.audioContext.destination.channelCount = 2;
    manager.sampleRate.textContent = 'Sleep';
    manager.updateSleepModeDisplay(false, 44100);
    assert.equal(manager.sampleRate.textContent, '44100 Hz');
    manager.audioManager.audioContext.destination.channelCount = 0;
    manager.sampleRate.textContent = 'Sleep';
    manager.updateSleepModeDisplay(false, 32000);
    assert.equal(manager.sampleRate.textContent, '32000 Hz');

    manager.audioManager.audioContext.sampleRate = 44100;
    manager.updateSampleRateDisplay();
    assert.equal(manager.sampleRate.classList.contains('low-sample-rate'), true);
    manager.sampleRate.textContent = '48000 Hz - Sleep';
    manager.audioManager.audioContext.destination.channelCount = 6;
    manager.audioManager.audioContext.sampleRate = 96000;
    manager.updateSampleRateDisplay();
    assert.equal(manager.sampleRate.classList.contains('low-sample-rate'), false);
    assert.match(manager.sampleRate.textContent, /Sleep/);
    assert.match(manager.sampleRate.textContent, /6ch/);
    manager.sampleRate.textContent = '48000 Hz';
    manager.audioManager.audioContext = { sampleRate: 88200, destination: { channelCount: 4 } };
    manager.audioManager.listeners.get('audioGraphRebuilt')?.({
      audioContext: manager.audioManager.audioContext
    });
    assert.equal(manager.sampleRate.textContent, '88200 Hz 4ch');

    assert.equal(manager.getStoredLanguagePreference(), 'ja');
    assert.equal(manager.determineUserLanguage('auto'), 'ja');
    assert.equal(await manager.syncLanguageWithConfig({ language: 'ja' }), 'ja');
    assert.equal(await manager.setLanguagePreference('en'), 'en');
    assert.equal(await manager.syncLanguageWithConfig({ language: 'ja' }), 'ja');
    window.appConfig = null;
    assert.equal(await manager.setLanguagePreference('en'), 'en');
    await manager.loadTranslations();
    assert.equal(calls.some(call => call[0] === 'electron.saveConfig'), true);
    await manager.setLanguagePreference('ja', { persist: false });
    assert.equal(manager.t('hello', { name: 'A' }), 'こんにちは A');
    assert.equal(manager.t('missing.key'), 'missing.key');
    manager.doubleBlindTest = {
      isActive: () => true,
      updateTexts: () => calls.push(['doubleBlind.updateTexts'])
    };
    manager.pluginListManager.dragMessage = document.createElement('div');
    manager.updateUITexts();
    assert.equal(manager.shareButton.textContent, 'Share');
    assert.equal(manager.pipelineEmpty.querySelector('.pipeline-empty-message').textContent, 'Drop here');
    assert.equal(manager.pipelineEmpty.querySelector('.mobile-effects-open-music'), null);
    assert.equal(calls.some(call => call[0] === 'doubleBlind.updateTexts'), true);
    assert.equal(manager.pluginListManager.dragMessage.textContent, 'Drag effect');
  });

  await withUIHarness({ enResponse: { ok: false } }, async ({ manager }) => {
    await manager.loadEnglishTranslations();
    assert.deepEqual(manager.englishTranslations, {});
  });
  await withUIHarness({ enResponse: new Error('fetch failed') }, async ({ manager }) => {
    await manager.loadEnglishTranslations();
    assert.deepEqual(manager.englishTranslations, {});
  });
  await withUIHarness({}, async ({ manager }) => {
    manager.loadEnglishTranslations = async () => { throw new Error('fetch failed'); };
    assert.equal(await manager.initLocalization(), false);
  });
  await withUIHarness({ isElectron: true, jaResponse: { ok: false } }, async ({ calls, manager }) => {
    await manager.setLanguagePreference('ja', { persist: false });
    assert.equal(manager.translations, manager.englishTranslations);
    assert.equal(calls.some(call => call[0] === 'electron.updateApplicationMenu'), true);
  });
  await withUIHarness({ isElectron: true, jaResponse: new Error('locale failed') }, async ({ calls, manager }) => {
    await manager.setLanguagePreference('ja', { persist: false });
    assert.equal(manager.translations, manager.englishTranslations);
    assert.equal(calls.some(call => call[0] === 'electron.updateApplicationMenu'), true);
  });
});

test('publishes only the latest requested language when translation loads finish out of order', async () => {
  const jaTranslations = createDeferred();
  const frTranslations = createDeferred();
  await withUIHarness({
    isElectron: true,
    jaResponse: { text: jaTranslations.promise },
    defaultFetch: { text: frTranslations.promise }
  }, async ({ calls, document, manager }) => {
    calls.length = 0;
    const japanese = manager.setLanguagePreference('ja', { persist: false });
    const french = manager.setLanguagePreference('fr', { persist: false });

    frTranslations.resolve(JSON.stringify({ 'ui.whatsThisApp': 'Qu’est-ce que c’est ?' }));
    await french;
    assert.equal(manager.userLanguage, 'fr');
    assert.equal(manager.translations['ui.whatsThisApp'], 'Qu’est-ce que c’est ?');
    assert.equal(document.querySelector('.whats-this').textContent, 'Qu’est-ce que c’est ?');
    assert.equal(calls.filter(call => call[0] === 'electron.updateApplicationMenu').length, 1);

    jaTranslations.resolve(JSON.stringify({ 'ui.whatsThisApp': 'これは何ですか' }));
    await japanese;
    assert.equal(manager.userLanguage, 'fr');
    assert.equal(manager.translations['ui.whatsThisApp'], 'Qu’est-ce que c’est ?');
    assert.equal(document.querySelector('.whats-this').textContent, 'Qu’est-ce que c’est ?');
    assert.equal(calls.filter(call => call[0] === 'electron.updateApplicationMenu').length, 1);
  });
});

test('resolves documentation paths and whats-this link behavior', async () => {
  await withUIHarness({ isElectron: false }, async ({ document, manager, opened }) => {
    assert.equal(manager.getLocalizedDocPath('/README.md'), 'https://effetune.frieve.com/');
    assert.equal(manager.getLocalizedDocPath('/plugins/eq.md#p'), 'https://effetune.frieve.com/docs/plugins/eq.html#p');
    assert.equal(manager.getLocalizedDocPath('/index.html'), 'https://effetune.frieve.com/docs/');
    assert.equal(manager.getLocalizedDocPath('/guide/page.html'), 'https://effetune.frieve.com/docs/guide/page.html');
    manager.userLanguage = 'ja';
    assert.equal(manager.getLocalizedDocPath('/README.html'), 'https://effetune.frieve.com/docs/i18n/ja/');
    assert.equal(manager.getLocalizedDocPath('/plugins/eq.md#p'), 'https://effetune.frieve.com/docs/i18n/ja/plugins/eq.html#p');
    assert.equal(manager.getLocalizedDocPath('/index.html'), 'https://effetune.frieve.com/docs/i18n/ja/');
    assert.equal(manager.getLocalizedDocPath('/guide/page.html'), 'https://effetune.frieve.com/docs/i18n/ja/guide/page.html');
    document.querySelector('.whats-this').click();
    assert.equal(opened[0][0], 'https://effetune.frieve.com/docs/i18n/ja/');
  });

  await withUIHarness({}, async ({ document, manager }) => {
    document.allElements.delete(document.querySelector('.whats-this'));
    manager.updateWhatsThisLinkTarget();
  });

  await withUIHarness({ electronAPI: { openExternalUrl: async () => { throw new Error('open failed'); } } }, async ({ document, opened }) => {
    await document.querySelector('.whats-this').click();
    await flushMicrotasks();
    assert.equal(opened.length, 1);
  });
});

test('shares URLs, opens music, manages presets, and creates audio players', async () => {
  const originalLoadFiles = AudioPlayer.prototype.loadFiles;
  const originalClose = AudioPlayer.prototype.close;
  let activeCalls = null;

  AudioPlayer.prototype.loadFiles = function loadFiles(files, append) {
    activeCalls?.push(['AudioPlayer.loadFiles', files, append]);
  };
  AudioPlayer.prototype.close = function close() {
    activeCalls?.push(['AudioPlayer.close']);
  };

  try {
    await withUIHarness({ isElectron: true, electronAPI: { openExternalUrl: async () => true } }, async ({ calls, document, manager, timers }) => {
      activeCalls = calls;
      const sharedPlugin = createPlugin('Gain');
      sharedPlugin.externalAssetInfo = {
        missing: false,
        kind: 'IR',
        ids: ['aaaaaaaaaaaaaaaaaaaaaaaa'],
        names: ['Measured Hall']
      };
      const missingBPlugin = createPlugin('IR Reverb');
      missingBPlugin.externalAssetInfo = {
        missing: true,
        kind: 'IR',
        ids: ['bbbbbbbbbbbbbbbbbbbbbbbb'],
        names: ['Missing B Hall']
      };
      manager.audioManager.pipelineA = [sharedPlugin];
      manager.audioManager.pipelineB = [missingBPlugin];
      manager.audioManager.pipeline = [sharedPlugin];
      await manager.shareButton.click();
      const shareMessageTimer = [...timers].reverse().find(timer => timer.delay === 3000);
      assert.ok(shareMessageTimer);
      assert.match(manager.stateManager.errorDisplay.textContent, /Copied URL/);
      assert.match(manager.stateManager.errorDisplay.textContent, /external IR data \(Measured Hall\)/);

      manager.queueMissingExternalAssetSummary();
      manager.queueMissingExternalAssetSummary();
      const summaryTimers = timers.filter(timer => timer.delay === 50);
      assert.equal(summaryTimers.length, 2);
      assert.equal(calls.some(call => call[0] === 'clearTimeout'), true);
      summaryTimers.at(-1).fn();
      assert.match(manager.stateManager.errorDisplay.textContent, /One external file could not be found/);
      shareMessageTimer.fn();
      assert.match(manager.stateManager.errorDisplay.textContent, /One external file could not be found/);
      for (let index = timers.length - 1; index >= 0; index -= 1) {
        if (timers[index].delay === 50) timers.splice(index, 1);
      }
      timers.splice(0).forEach(timer => timer.fn());
      assert.equal(manager.stateManager.errorDisplay.textContent, '');

      await manager.openMusicButton.click();
      assert.equal(calls.some(call => call[0] === 'electron.openMusicFile'), true);

      assert.deepEqual(manager.getCurrentPresetData(), { preset: true });
      manager.loadPreset(null);
      assert.match(manager.stateManager.errorDisplay.textContent, /invalidPresetData/);
      manager.loadPreset({ pipeline: [{ name: 'A' }] });
      manager.loadPreset({ plugins: [{ name: 'B' }] });
      manager.loadPreset({ nope: true });
      manager.pipelineManager.loadPreset = () => { throw new Error('load failed'); };
      manager.loadPreset({ plugins: [] });

      const player = manager.createAudioPlayer(['a.wav']);
      assert.equal(manager.createAudioPlayer(['b.wav']), player);
      assert.equal(calls.some(call => call[0] === 'AudioPlayer.loadFiles'), true);
      const replacement = manager.createAudioPlayer(['c.wav'], true);
      assert.notEqual(replacement, player);
      assert.equal(calls.some(call => call[0] === 'AudioPlayer.close'), true);

      assert.equal(document.getElementById('presetSelect').value, '');
    });

    await withUIHarness({ isElectron: false }, async ({ calls, document, objectUrls, manager }) => {
      activeCalls = calls;
      await manager.openMusicButton.click();
      const fileInput = [...document.allElements].find(element => element.type === 'file' && element.parentNode);
      assert.equal(fileInput.accept, 'audio/*,video/mp4,image/jpeg,image/png,.mp4,.cue,.jpg,.png');
      fileInput.files = [{ name: 'song.wav', async arrayBuffer() { return new ArrayBuffer(0); } }];
      await fileInput.dispatch('change', { target: fileInput });
      await flushMicrotasks();
      const loadFilesCall = calls.find(call => call[0] === 'AudioPlayer.loadFiles');
      assert.equal(loadFilesCall[1][0].name, 'song.wav');
      assert.equal(objectUrls.length, 0);
      assert.equal(calls.some(call => call[0] === 'window.addEventListener' && call[1] === 'unload'), false);
      assert.ok(manager.audioPlayer);
    });

    const cue = { name: 'album.cue', size: 100, async arrayBuffer() { return new ArrayBuffer(0); } };
    const cueHandle = { kind: 'file', async getFile() { return cue; } };
    await withUIHarness({
      isElectron: false,
      async showOpenFilePicker(options) {
        assert.equal(options.multiple, true);
        return [cueHandle];
      }
    }, async ({ calls, document, manager }) => {
      activeCalls = calls;
      const source = { name: 'album.wav', size: 1000, async arrayBuffer() { return new ArrayBuffer(0); } };
      manager.webCueSourceResolver = async request => {
        assert.equal(request.cueFileHandle, cueHandle);
        return [source];
      };
      manager.playbackSelectionResolver = async (files, options) => {
        assert.deepEqual(files, [cue]);
        assert.equal(typeof options.cueSourceProvider, 'function');
        return { kind: 'cue', tracks: await options.cueSourceProvider({ parsedCue: { ok: true } }) };
      };

      await manager.openMusicButton.click();
      await flushMicrotasks();
      await flushMicrotasks();

      assert.equal([...document.allElements].some(element => element.type === 'file' && element.parentNode), false);
      const loadFilesCall = calls.find(call => call[0] === 'AudioPlayer.loadFiles');
      assert.deepEqual(loadFilesCall[1], [source]);
    });

    await withUIHarness({
      isElectron: false,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
    }, async ({ document, manager }) => {
      await manager.openMusicButton.click();
      const fileInput = [...document.allElements].find(element => element.type === 'file');
      assert.equal(fileInput.accept, '');
      assert.equal(fileInput.multiple, true);
    });
  } finally {
    activeCalls = null;
    AudioPlayer.prototype.loadFiles = originalLoadFiles;
    AudioPlayer.prototype.close = originalClose;
  }
});

test('share success warning stays bound to the pipeline copied before clipboard completion', async () => {
  let releaseClipboard;
  let clipboardStarted;
  const clipboardReady = new Promise(resolve => {
    clipboardStarted = resolve;
  });
  const clipboardPending = new Promise(resolve => {
    releaseClipboard = resolve;
  });

  await withUIHarness({
    clipboardWrite() {
      clipboardStarted();
      return clipboardPending;
    }
  }, async ({ manager }) => {
    const plugin = createPlugin('IR Reverb');
    plugin.externalAssetInfo = {
      missing: false,
      kind: 'IR',
      ids: ['aaaaaaaaaaaaaaaaaaaaaaaa'],
      names: ['Copied Hall']
    };
    manager.audioManager.pipeline = [plugin];

    const share = manager.shareButton.click();
    await clipboardReady;
    plugin.externalAssetInfo.names = ['Later Hall'];
    manager.audioManager.pipeline = [];
    releaseClipboard();
    await share;

    assert.match(manager.stateManager.errorDisplay.textContent, /external IR data \(Copied Hall\)/);
    assert.doesNotMatch(manager.stateManager.errorDisplay.textContent, /Later Hall/);
  });
});

test('only the latest pipeline share attempt can publish completion feedback', async () => {
  const scenarios = [
    {
      latestSucceeds: true,
      completeLatest: deferred => deferred.resolve(),
      completeStale: deferred => deferred.reject(new Error('stale copy failure')),
      expectedMessage: /Copied URL/,
      unexpectedMessage: /Copy failed/,
      expectedTimerDuration: 3000
    },
    {
      latestSucceeds: false,
      completeLatest: deferred => deferred.reject(new Error('latest copy failure')),
      completeStale: deferred => deferred.resolve(),
      expectedMessage: /Copy failed/,
      unexpectedMessage: /Copied URL/,
      expectedTimerDuration: 5000
    }
  ];

  for (const scenario of scenarios) {
    const clipboardAttempts = [createDeferred(), createDeferred()];
    let clipboardIndex = 0;
    await withUIHarness({
      clipboardWrite() {
        return clipboardAttempts[clipboardIndex++].promise;
      }
    }, async ({ manager, timers }) => {
      manager.audioManager.pipeline = [createPlugin('Gain')];

      const staleShare = manager.shareButton.click();
      const latestShare = manager.shareButton.click();
      assert.equal(clipboardIndex, 2);

      scenario.completeLatest(clipboardAttempts[1]);
      await latestShare;
      scenario.completeStale(clipboardAttempts[0]);
      await staleShare;

      assert.match(manager.stateManager.errorDisplay.textContent, scenario.expectedMessage);
      assert.doesNotMatch(manager.stateManager.errorDisplay.textContent, scenario.unexpectedMessage);
      assert.equal(timers.filter(timer => timer.delay === scenario.expectedTimerDuration).length, 1);
      const staleDuration = scenario.latestSucceeds ? 5000 : 3000;
      assert.equal(timers.some(timer => timer.delay === staleDuration), false);
    });
  }
});

test('audio player replacement reserves layout until the new player mounts', async () => {
  await withUIHarness({}, async ({ document, manager, timers }) => {
    const container = document.createElement('div');
    container.className = 'audio-player';
    container.rect = { left: 0, top: 0, right: 640, bottom: 72, width: 640, height: 72 };
    container.style.margin = '1px 2px 3px 4px';
    document.body.appendChild(container);
    manager.audioPlayer = { ui: { container } };

    manager.preserveAudioPlayerLayoutForReplacement();

    const placeholder = manager.audioPlayerLayoutPlaceholder;
    assert.ok(placeholder);
    assert.equal(placeholder.className, 'audio-player-layout-placeholder');
    assert.equal(placeholder.style.height, '72px');
    assert.equal(placeholder.style.margin, '1px 2px 3px 4px');
    assert.equal(placeholder.parentNode, document.body);
    assert.equal(timers.at(-1).delay, 5000);

    manager.releaseAudioPlayerLayoutPlaceholder();

    assert.equal(manager.audioPlayerLayoutPlaceholder, null);
    assert.equal(placeholder.parentNode, null);
  });
});

test('wires clipboard, history, pipeline toggles, menus, and keyboard shortcuts', async () => {
  await withUIHarness({}, async ({ audioManager, calls, document, manager }) => {
    await manager.cutButton.click();
    await manager.copyButton.click();
    await manager.pasteButton.click();
    await flushMicrotasks();
    assert.equal(calls.some(call => call[0] === 'clipboard.cut'), true);
    assert.equal(calls.some(call => call[0] === 'clipboard.copy'), true);

    await manager.undoButton.click();
    await manager.redoButton.click();
    assert.equal(calls.some(call => call[0] === 'pipeline.undo'), true);
    assert.equal(calls.some(call => call[0] === 'pipeline.redo'), true);

    await manager.pipelineToggleButton.click();
    assert.equal(calls.some(call => call[0] === 'audio.togglePipelineWithTransition'), true);
    await manager.pipelineMenuButton.click();
    assert.equal(manager.pipelineMenu.classList.contains('show'), true);
    await manager.copyAToBButton.click();
    assert.equal(manager.pipelineMenu.classList.contains('show'), false);
    manager.pipelineMenu.classList.add('show');
    document.dispatch('click', { target: document.body });
    assert.equal(manager.pipelineMenu.classList.contains('show'), false);
    await manager.copyBToAButton.click();
    const doubleBlind = {
      active: false,
      enterFresh() {
        calls.push(['doubleBlind.enterFresh']);
        this.active = true;
      },
      isActive() {
        return this.active;
      }
    };
    manager.doubleBlindTest = doubleBlind;
    manager.getDoubleBlindTest = () => doubleBlind;
    await manager.doubleBlindTestButton.click();
    assert.equal(manager.getDoubleBlindTest().isActive(), true);
    doubleBlind.active = false;

    manager.updatePipelineToggleButton();
    assert.equal(manager.pipelineToggleButton.textContent, audioManager.currentPipeline);
    manager.togglePipelineMenu();
    manager.hidePipelineMenu();

    manager._pipelineSwitching = true;
    await manager.togglePipeline();
    await manager.switchPipelineWithTransition('A');
    manager._pipelineSwitching = false;
    audioManager.currentPipeline = 'A';
    await manager.switchPipelineWithTransition('A');
    await manager.switchPipelineWithTransition('B');
    assert.equal(calls.some(call => call[0] === 'audio.setCurrentPipelineWithTransition' && call[1] === 'B'), true);

    document.dispatch('keydown', { key: 't', target: document.body });
    document.dispatch('keydown', { key: 'a', target: document.body });
    audioManager.pipelineB = null;
    document.dispatch('keydown', { key: 'b', target: document.body });
    audioManager.pipelineB = [createPlugin('B')];
    document.dispatch('keydown', { key: 'b', target: document.body });
    document.dispatch('keydown', { key: 'b', ctrlKey: true, target: document.body });
    const input = document.createElement('input');
    document.dispatch('keydown', { key: 'b', target: input });
    doubleBlind.isActive = () => true;
    document.dispatch('keydown', { key: 't', target: document.body });
  });

  await withUIHarness({}, async ({ manager }) => {
    manager.pipelineManager.clipboardManager.handlePaste = () => { throw new Error('paste failed'); };
    await manager.pasteButton.click();
    await flushMicrotasks();
    assert.match(manager.stateManager.errorDisplay.textContent, /Read failed/);
  });
});

test('keeps a parameter slider fill synced during consecutive direct number input', async () => {
  await withUIHarness({}, async ({ document, manager }) => {
    const row = appendElement(document, document.body, 'div', '', 'parameter-row');
    const slider = appendElement(document, row, 'input', 'parameter-slider');
    slider.type = 'range';
    slider.min = '-10';
    slider.max = '30';
    slider.value = '0';
    const valueInput = appendElement(document, row, 'input', 'parameter-value');
    valueInput.type = 'number';
    valueInput.addEventListener('input', (event) => {
      slider.value = event.target.value;
    });

    manager.initRangeFillStyling();
    assert.equal(slider.style['--et-range-fill'], '25%');

    valueInput.focus();
    for (const [value, expectedFill] of [['-5', '12.5%'], ['20', '75%'], ['30', '100%']]) {
      valueInput.value = value;
      await valueInput.dispatch('input');
      document.dispatch('input', { target: valueInput });

      assert.equal(document.activeElement, valueInput);
      assert.equal(slider.style['--et-range-fill'], expectedFill);
    }
  });
});

test('keeps a custom plugin parameter slider fill synced from number input', async () => {
  await withUIHarness({}, async ({ document, manager }) => {
    const pluginUi = appendElement(document, document.body, 'div', '', 'plugin-parameter-ui');
    const customRow = appendElement(document, pluginUi, 'div', '', 'band-controls');
    const slider = appendElement(document, customRow, 'input', 'band-q-slider');
    slider.type = 'range';
    slider.min = '0.1';
    slider.max = '10.1';
    slider.value = '2.1';
    const valueInput = appendElement(document, customRow, 'input', 'band-q-value');
    valueInput.type = 'number';
    valueInput.addEventListener('input', (event) => {
      slider.value = event.target.value;
    });

    manager.initRangeFillStyling();
    assert.equal(slider.style['--et-range-fill'], '20%');

    valueInput.value = '8.1';
    await valueInput.dispatch('input');
    document.dispatch('input', { target: valueInput });

    assert.equal(slider.style['--et-range-fill'], '80%');
  });
});

test('handles constructor localization rejection, menu refresh, and share failure', async () => {
  const originalInitLocalization = UIManager.prototype.initLocalization;
  UIManager.prototype.initLocalization = async () => { throw new Error('init failed'); };
  try {
    await withUIHarness({}, async ({ manager }) => {
      assert.ok(manager);
      await flushMicrotasks();
    });
  } finally {
    UIManager.prototype.initLocalization = originalInitLocalization;
  }

  await withUIHarness({}, async ({ manager }) => {
    manager.refreshApplicationMenu();
  });

  await withUIHarness({
    isElectron: true,
    electronAPI: {
      updateApplicationMenu: async () => ({ success: true }),
      getUserPresetsForTray: async () => ({ success: true, presets: [] }),
      updateTrayMenu: async () => ({ success: true })
    }
  }, async ({ manager, window }) => {
    manager.refreshApplicationMenu();
    await flushMicrotasks();
    const savedWindow = globalThis.window;
    manager.refreshApplicationMenu();
    const rejectingWindow = {};
    Object.defineProperty(rejectingWindow, 'uiManager', {
      get() {
        throw new Error('window unavailable');
      }
    });
    globalThis.window = rejectingWindow;
    await delay(0);
    globalThis.window = savedWindow;
  });

  await withUIHarness({ clipboardWriteError: new Error('copy failed') }, async ({ manager }) => {
    manager.audioManager.pipeline = [createPlugin('Gain')];
    await manager.shareButton.click();
    await flushMicrotasks();
    assert.match(manager.stateManager.errorDisplay.textContent, /Copy failed/);
  });
});
