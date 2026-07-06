import assert from 'node:assert/strict';
import test from 'node:test';

import { DoubleBlindTest } from '../../js/ui/double-blind-test/double-blind-test.js';
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

  add(...tokensToAdd) {
    const tokens = this._tokens();
    tokensToAdd.forEach(token => tokens.add(token));
    this._write(tokens);
  }

  remove(...tokensToRemove) {
    const tokens = this._tokens();
    tokensToRemove.forEach(token => tokens.delete(token));
    this._write(tokens);
  }

  contains(token) {
    return this._tokens().has(token);
  }

  toggle(token, force) {
    const tokens = this._tokens();
    const shouldAdd = force === undefined ? !tokens.has(token) : Boolean(force);
    if (shouldAdd) {
      tokens.add(token);
    } else {
      tokens.delete(token);
    }
    this._write(tokens);
    return shouldAdd;
  }
}

function parseAttributes(source) {
  const attrs = {};
  const pattern = /([:\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? true;
  }
  return attrs;
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.eventListeners = new Map();
    this.attributes = {};
    this.className = '';
    this.classList = new FakeClassList(this);
    this.id = '';
    this.type = '';
    this.value = '';
    this.disabled = false;
    this.checked = false;
    this.textContent = '';
    this.style = { minWidth: '' };
    this.dataset = {};
    this.title = '';
    this.placeholder = '';
    this.isContentEditable = false;
    this.rect = { left: 0, top: 0, right: 640, bottom: 100, width: 640, height: 100 };
    this._innerHTML = '';
    this.focused = false;
    this.selected = false;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.replaceChildren();
    this._seedChildrenFromHTML(value);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children;
    const index = siblings.indexOf(this);
    return index === -1 ? null : siblings[index + 1] || null;
  }

  setAttribute(name, value) {
    const normalized = value === undefined ? '' : String(value);
    this.attributes[name] = normalized;
    if (name === 'class') this.className = normalized;
    if (name === 'id') {
      this.id = normalized;
      this.ownerDocument.elementsById.set(normalized, this);
    }
    if (name === 'value') this.value = normalized;
    if (name === 'type') this.type = normalized;
    this[name] = normalized;
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
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

  insertBefore(child, reference) {
    if (!reference) return this.appendChild(child);
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    const index = this.children.indexOf(reference);
    if (index === -1) return this.appendChild(child);
    child.parentNode = this;
    this.children.splice(index, 0, child);
    this.childNodes = this.children;
    this.ownerDocument.allElements.add(child);
    if (child.id) this.ownerDocument.elementsById.set(child.id, child);
    return child;
  }

  replaceChildren(...nodes) {
    this.children.forEach(child => {
      child.parentNode = null;
    });
    this.children = [];
    this.childNodes = this.children;
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
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    if (!this.eventListeners.has(type)) return;
    this.eventListeners.set(
      type,
      this.eventListeners.get(type).filter(candidate => candidate !== listener)
    );
  }

  dispatch(type, event = {}) {
    const eventObject = createEvent(this, event);
    const results = [];
    for (const listener of this.eventListeners.get(type) || []) {
      results.push(listener(eventObject));
    }
    return Promise.all(results);
  }

  click() {
    return this.dispatch('click');
  }

  focus() {
    this.focused = true;
    this.ownerDocument.activeElement = this;
  }

  select() {
    this.selected = true;
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
    if (selector === 'input[type="range"]') return this.tagName === 'INPUT' && this.type === 'range';
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const visit = element => {
      for (const child of element.children) {
        if (child.matches(selector)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  _seedChildrenFromHTML(html) {
    if (!html.includes('dbt-')) return;

    const elementPattern = /<(div|h2|h3|button|p|label|input|datalist|ul)\b([^>]*)>/gi;
    let match;
    while ((match = elementPattern.exec(html)) !== null) {
      const tagName = match[1];
      const attrs = parseAttributes(match[2]);
      const child = this.ownerDocument.createElement(tagName);
      if (attrs.class) child.className = attrs.class;
      if (attrs.id) child.id = attrs.id;
      if (attrs.type) child.type = attrs.type;
      if (attrs.value !== undefined) child.value = String(attrs.value);
      if (attrs.disabled === true) child.disabled = true;
      child.attributes = attrs;
      this.appendChild(child);
    }
  }
}

function createEvent(defaultTarget, options = {}) {
  return {
    key: options.key,
    ctrlKey: Boolean(options.ctrlKey),
    metaKey: Boolean(options.metaKey),
    altKey: Boolean(options.altKey),
    repeat: Boolean(options.repeat),
    target: options.target ?? defaultTarget,
    prevented: 0,
    preventDefault() {
      this.prevented++;
    },
    ...options
  };
}

function createDocument(options = {}) {
  const documentRef = {
    allElements: new Set(),
    elementsById: new Map(),
    eventListeners: new Map(),
    body: null,
    head: null,
    activeElement: null,
    copiedBySelection: '',
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
    listenerCount(type) {
      return (documentRef.eventListeners.get(type) || []).length;
    },
    getSelection() {
      return options.selection ?? null;
    }
  };

  if (options.execCommand) {
    documentRef.execCommand = command => {
      documentRef.copiedBySelection = command;
      return options.execCommand(command);
    };
  }

  documentRef.body = documentRef.createElement('body');
  documentRef.head = documentRef.createElement('head');
  return documentRef;
}

function createStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    clear() {
      data.clear();
    }
  };
}

function appendElement(parent, tagName, className, options = {}) {
  const element = parent.ownerDocument.createElement(tagName);
  element.className = className;
  if (options.id) element.id = options.id;
  if (options.width !== undefined) {
    element.rect = { ...element.rect, width: options.width };
  }
  parent.appendChild(element);
  return element;
}

function createPlugin(name, params = {}) {
  return {
    name,
    enabled: true,
    inputBus: params.inputBus ?? null,
    outputBus: params.outputBus ?? null,
    channel: params.channel ?? null,
    parameters: { gain: params.gain ?? 1 },
    updateCount: 0,
    setEnabled(value) {
      this.enabled = value;
    },
    getSerializableParameters() {
      return {
        ...this.parameters,
        id: 'ignored-id',
        type: 'ignored-type',
        enabled: 'ignored-enabled'
      };
    },
    setParameters(parameters) {
      this.parameters = { ...parameters };
    },
    updateParameters() {
      this.updateCount++;
    }
  };
}

function createHarness(options = {}) {
  const document = createDocument(options.documentOptions);
  const storage = createStorage(options.storage);
  const timers = [];
  const errors = [];
  const consoleMessages = [];
  const menuRefreshes = [];
  const urlUpdates = [];
  const historyReplacements = [];

  const mobilePlayerView = options.includeMobilePlayerView
    ? appendElement(document.body, 'div', 'mobile-player-view', { id: 'mobilePlayerView' })
    : null;
  const playerParent = options.playerInMobileView && mobilePlayerView
    ? mobilePlayerView
    : document.body;
  const player = options.includePlayer === false
    ? null
    : appendElement(playerParent, 'div', 'audio-player');
  const main = options.includeMain === false
    ? null
    : appendElement(document.body, 'div', 'main-container', { width: options.mainWidth ?? 640 });
  if (main) {
    appendElement(main, 'div', 'pipeline-child-a');
    appendElement(main, 'div', 'pipeline-child-b');
    main.style.display = options.mainDisplay ?? '';
  }

  const calls = [];
  const audioManager = {
    pipelineA: options.pipelineA ?? [createPlugin('Alpha', { gain: 1, inputBus: 0, outputBus: 1, channel: 'L' })],
    pipelineB: options.pipelineB ?? [createPlugin('Beta', { gain: 2 })],
    currentPipeline: options.currentPipeline ?? 'B',
    audioContext: options.audioContext ?? { sampleRate: 48000 },
    setCurrentPipeline(label, silent) {
      calls.push(['setCurrentPipeline', label, silent]);
      if (options.throwSetCurrentPipeline) throw new Error('set current failed');
      this.currentPipeline = label;
    },
    enableParallelPipelines(label) {
      calls.push(['enableParallelPipelines', label]);
      return options.rejectEnableParallel
        ? Promise.reject(new Error('parallel failed'))
        : Promise.resolve();
    },
    disableParallelPipelines() {
      calls.push(['disableParallelPipelines']);
      if (options.throwDisableParallel) throw new Error('disable failed');
    },
    fadeInOutput(seconds) {
      calls.push(['fadeInOutput', seconds]);
      if (options.throwFadeIn) throw new Error('fade in failed');
    },
    fadeOutOutput(seconds) {
      calls.push(['fadeOutOutput', seconds]);
      if (options.throwFadeOut) throw new Error('fade out failed');
    },
    setBlindSelection(label, seconds) {
      calls.push(['setBlindSelection', label, seconds]);
    }
  };

  const createdPlugins = [];
  const pluginManager = {
    createPlugin(name) {
      calls.push(['createPlugin', name]);
      if (options.throwCreatePluginNames?.has(name)) throw new Error(`boom ${name}`);
      if (options.nullCreatePluginNames?.has(name)) return null;
      const plugin = createPlugin(name, { gain: 0 });
      createdPlugins.push(plugin);
      return plugin;
    }
  };

  const uiManager = {
    audioManager,
    pluginManager,
    expandedPlugins: new Set(),
    urlReflectionEnabled: true,
    t(key, params = undefined) {
      if (!params) return key;
      return `${key}:${JSON.stringify(params)}`;
    },
    setError(message, isError) {
      errors.push({ message, isError });
    },
    clearError() {
      errors.push({ clear: true });
    },
    refreshApplicationMenu: options.omitRefreshMenu ? undefined : () => {
      menuRefreshes.push('refresh');
    },
    updateURL() {
      urlUpdates.push('update');
      if (options.throwUpdateURL) throw new Error('url failed');
    },
    updatePipelineToggleButton() {
      calls.push(['updatePipelineToggleButton']);
      if (options.throwPipelineRestore) throw new Error('toggle failed');
    },
    pipelineManager: {
      updatePipelineUI() {
        calls.push(['updatePipelineUI']);
        if (options.throwPipelineRestore) throw new Error('pipeline ui failed');
      }
    }
  };

  const windowObject = {
    document,
    location: {
      origin: 'https://example.test',
      pathname: '/effetune.html'
    },
    history: {
      replaceState(state, title, url) {
        historyReplacements.push({ state, title, url });
        if (options.throwReplaceState) throw new Error('replace failed');
      }
    },
    electronAPI: options.electronAPI ?? null,
    electronIntegration: options.electronIntegration ?? null
  };

  const navigator = {
    clipboard: options.clipboard
  };

  const globals = {
    document,
    window: windowObject,
    localStorage: storage,
    navigator,
    confirm: options.confirm ?? (() => true),
    setTimeout(fn, delay) {
      timers.push({ fn, delay });
      return timers.length;
    },
    clearTimeout() {},
    console: {
      ...console,
      error(...args) {
        consoleMessages.push(['error', ...args]);
      },
      warn(...args) {
        consoleMessages.push(['warn', ...args]);
      }
    },
    btoa(text) {
      return Buffer.from(text, 'binary').toString('base64');
    },
    atob(text) {
      return Buffer.from(text, 'base64').toString('binary');
    }
  };

  const dbt = new DoubleBlindTest(uiManager);

  return {
    calls,
    consoleMessages,
    createdPlugins,
    dbt,
    document,
    errors,
    globals,
    historyReplacements,
    main,
    menuRefreshes,
    mobilePlayerView,
    player,
    runTimers() {
      while (timers.length) {
        timers.shift().fn();
      }
    },
    storage,
    timers,
    uiManager,
    urlUpdates,
    windowObject
  };
}

async function withHarness(options, callback) {
  const harness = createHarness(options);
  return withGlobals(harness.globals, () => callback(harness));
}

test('validates pipeline availability and manages entry/exit gating', async () => {
  await withHarness({}, async h => {
    assert.equal(DoubleBlindTest.abValid(null), false);
    assert.equal(DoubleBlindTest.abValid({ pipelineA: [], pipelineB: [] }), false);
    assert.equal(DoubleBlindTest.abValid({ pipelineA: [1], pipelineB: null }), false);
    assert.equal(DoubleBlindTest.abValid(h.uiManager.audioManager), true);
    assert.equal(h.dbt.isActive(), false);

    h.dbt.enterFresh();
    await flushMicrotasks();

    assert.equal(h.dbt.isActive(), true);
    assert.equal(h.uiManager.urlReflectionEnabled, false);
    assert.equal(h.historyReplacements[0].url, 'https://example.test/effetune.html');
    assert.equal(h.main.style.display, 'none');
    assert.equal(h.document.body.style.minWidth, '640px');
    assert.equal(h.document.listenerCount('keydown'), 1);
    assert.equal(h.menuRefreshes.length, 1);

    h.dbt.enterFresh();
    assert.equal(h.document.listenerCount('keydown'), 1);

    h.dbt.exit();
    assert.equal(h.dbt.isActive(), false);
    assert.equal(h.document.listenerCount('keydown'), 0);
    assert.equal(h.uiManager.urlReflectionEnabled, true);
    assert.equal(h.urlUpdates.length, 1);
    assert.equal(h.main.style.display, '');
    assert.equal(h.main.children.length, 2);
    assert.equal(h.document.body.style.minWidth, '');
    assert.deepEqual(h.calls.filter(call => call[0] === 'setCurrentPipeline').at(-1), ['setCurrentPipeline', 'B', true]);

    h.dbt.exit();
    assert.equal(h.menuRefreshes.length, 2);
  });
});

test('gating fallbacks and panel insertion keep the panel usable', async () => {
  await withHarness({ includeMain: false, throwReplaceState: true, throwUpdateURL: true, omitRefreshMenu: true }, async h => {
    h.dbt._applyGating(true);
    assert.equal(h.uiManager.urlReflectionEnabled, false);
    h.dbt._applyGating(false);
    assert.equal(h.uiManager.urlReflectionEnabled, true);
    h.dbt._refreshNativeMenu();
  });

  await withHarness({ includePlayer: false, mainWidth: 0 }, async h => {
    h.dbt._buildPanel();
    assert.equal(h.dbt.container.parentNode, h.document.body);
    assert.equal(h.document.body.children.indexOf(h.dbt.container), 0);
    h.dbt._removePanel();
    h.dbt._removePanel();
    h.dbt._detachPipelineUI();
    assert.equal(h.document.body.style.minWidth, '');
    h.dbt._reattachPipelineUI();
  });

  await withHarness({ mainWidth: 640 }, async h => {
    h.document.body.classList.add('layout-mobile');
    h.dbt._detachPipelineUI();
    assert.equal(h.document.body.style.minWidth, '');
    assert.equal(h.main.style.display, 'none');
    h.dbt._reattachPipelineUI();
    assert.equal(h.main.style.display, '');
  });

  await withHarness({ includePlayer: false, includeMain: false }, async h => {
    h.dbt._buildPanel();
    assert.equal(h.dbt.container.parentNode, h.document.body);
  });
});

test('mobile panel insertion keeps DBT shared by Player and Effects tabs', async () => {
  await withHarness({ includeMobilePlayerView: true, playerInMobileView: true }, async h => {
    h.document.body.classList.add('layout-mobile');
    h.document.body.classList.add('view-player');

    h.dbt.enterFresh();
    await flushMicrotasks();

    assert.equal(h.player.parentNode, h.mobilePlayerView);
    assert.equal(h.dbt.container.parentNode, h.document.body);
    assert.equal(h.mobilePlayerView.children.includes(h.dbt.container), false);
    assert.equal(h.main.children.includes(h.dbt.container), false);
    assert.equal(
      h.document.body.children[h.document.body.children.indexOf(h.main) - 1],
      h.dbt.container
    );

    h.document.body.classList.remove('view-player');
    h.document.body.classList.add('view-effects');
    assert.equal(h.dbt.container.parentNode, h.document.body);
    assert.equal(h.mobilePlayerView.children.includes(h.dbt.container), false);
    assert.equal(h.main.children.includes(h.dbt.container), false);

    h.dbt.exit();
    h.dbt.enterFresh();
    await flushMicrotasks();

    assert.equal(h.dbt.container.parentNode, h.document.body);
    assert.equal(h.mobilePlayerView.children.includes(h.dbt.container), false);
    assert.equal(h.main.children.includes(h.dbt.container), false);
    assert.equal(
      h.document.body.children[h.document.body.children.indexOf(h.main) - 1],
      h.dbt.container
    );
  });
});

test('builds the panel and runs every event listener path', async () => {
  await withHarness({
    storage: {
      effetune_dbt_tests: JSON.stringify({
        Existing: {
          v: 1,
          tc: 7,
          pA: [{ nm: 'SavedA', en: true, gain: 4 }],
          pB: [{ nm: 'SavedB', en: false, gain: 5 }]
        }
      })
    },
    electronAPI: {
      async writeClipboardText(text) {
        this.text = text;
        return true;
      }
    }
  }, async h => {
    h.dbt.enterFresh();
    await flushMicrotasks();
    const e = h.dbt.els;

    e.testNameInput.value = ' Listener test ';
    await e.testNameInput.dispatch('input');
    assert.equal(h.dbt.testName, ' Listener test ');
    assert.equal(e.testNameClear.classList.contains('visible'), true);

    await e.testNameInput.dispatch('keydown', { key: 'Escape' });
    assert.equal(h.dbt.testName, '');
    await e.testNameInput.dispatch('keydown', { key: 'Tab' });

    e.testNameInput.value = 'To clear';
    await e.testNameClear.dispatch('click');
    assert.equal(e.testNameInput.focused, true);

    e.testNameInput.value = '';
    await e.testSaveBtn.dispatch('click');
    e.testNameInput.value = 'Saved via click';
    e.countInput.value = '9';
    await e.testSaveBtn.dispatch('click');
    await flushMicrotasks();
    h.runTimers();
    assert.match(h.storage.getItem('effetune_dbt_tests'), /Saved via click/);

    e.testNameInput.value = 'Existing';
    await e.testDeleteBtn.dispatch('click');
    await flushMicrotasks();
    h.runTimers();
    assert.doesNotMatch(h.storage.getItem('effetune_dbt_tests'), /"Existing"/);

    e.testNameInput.value = 'Missing';
    await e.testDeleteBtn.dispatch('click');

    const tests = JSON.parse(h.storage.getItem('effetune_dbt_tests'));
    tests.Recall = { v: 1, tc: 3, pA: [{ nm: 'RecallA', en: true }], pB: [{ nm: 'RecallB', en: true }] };
    h.storage.setItem('effetune_dbt_tests', JSON.stringify(tests));
    e.testNameInput.value = 'Recall';
    await e.testNameInput.dispatch('change');
    await flushMicrotasks();
    assert.equal(h.dbt.testName, 'Recall');
    assert.equal(h.uiManager.audioManager.pipelineA[0].name, 'RecallA');

    e.testNameInput.value = 'Not found';
    await e.testNameInput.dispatch('change');
    await e.nameInput.dispatch('input');
    e.nameInput.value = 'Listener';
    await e.nameInput.dispatch('input');
    assert.equal(h.dbt.localName, 'Listener');

    e.countInput.value = '11';
    await e.countInput.dispatch('input');
    assert.equal(e.countRange.value, '11');
    e.countRange.value = '12';
    await e.countRange.dispatch('input');
    assert.equal(e.countInput.value, '12');

    await e.configShareBtn.dispatch('click');
    await flushMicrotasks();
    h.runTimers();
    assert.match(h.windowObject.electronAPI.text, /^https:\/\/effetune\.frieve\.com\/effetune\.html\?dbt=/);

    await e.startAbx.dispatch('click');
    await flushMicrotasks();
    assert.equal(h.dbt.testRunning, true);
    await e.switchA.dispatch('click');
    await e.switchB.dispatch('click');
    await e.switchX.dispatch('click');
    h.runTimers();
    await e.voteA.dispatch('click');
    await e.voteB.dispatch('click');

    await e.startAbpref.dispatch('click');
    assert.equal(h.dbt.testType, 'ABPREF');

    await e.close.dispatch('click');
    assert.equal(h.dbt.isActive(), false);
  });
});

test('shows configuration states and localizes both ABX and preference text', async () => {
  await withHarness({ pipelineB: [] }, async h => {
    h.dbt.enterFresh();
    await flushMicrotasks();
    assert.equal(h.dbt.els.startAbx.disabled, true);
    assert.equal(h.dbt.els.bWarning.classList.contains('hidden'), false);
    assert.equal(h.dbt.els.configShareBtn.disabled, true);

    h.dbt.els = {};
    h.dbt._showConfigScreen();
    h.dbt._applyConfigToInputs();
    h.dbt._updateTestNameClear();
    h.dbt._updateStartAvailability();
    h.dbt.container = {};
    h.dbt.updateTexts();
    h.dbt.container = null;
    h.dbt.updateTexts();
  });

  await withHarness({}, async h => {
    h.dbt.enterFresh();
    await flushMicrotasks();
    h.dbt.testName = 'Named';
    h.dbt._applyConfigToInputs();
    assert.equal(h.dbt.els.countRange.value, 20);
    h.dbt.testCount = 100;
    h.dbt._applyConfigToInputs();
    assert.equal(h.dbt.els.countRange.value, 20);

    h.dbt.updateTexts();
    assert.equal(h.dbt.els.voteA.textContent, 'dbt.voteXisA');
    h.dbt.testType = 'ABPREF';
    h.dbt.updateTexts();
    assert.equal(h.dbt.els.voteA.textContent, 'dbt.preferA');
    h.dbt.audioManager.audioContext = null;
    h.dbt._updateSampleRateText();
    assert.equal(h.dbt.els.sampleRate.textContent, '');
  });
});

test('stores, loads, deletes, and recovers saved test definitions', async () => {
  await withHarness({}, async h => {
    assert.deepEqual(await h.dbt._getTests(), {});
    h.storage.setItem('effetune_dbt_tests', '{bad json');
    assert.deepEqual(await h.dbt._getTests(), {});

    h.dbt._buildPanel();
    await h.dbt._loadTestList();
    await h.dbt._loadTestList('Preserve me');
    assert.equal(h.dbt.els.testNameInput.value, 'Preserve me');

    h.dbt.els.countInput.value = '0';
    await h.dbt._saveTest('Fallback Count');
    await flushMicrotasks();
    h.runTimers();
    assert.equal(JSON.parse(h.storage.getItem('effetune_dbt_tests'))['Fallback Count'].tc, 20);

    await h.dbt._deleteTest('Missing');
    await h.dbt._deleteTest('Fallback Count');
    await flushMicrotasks();
    h.runTimers();
    assert.deepEqual(JSON.parse(h.storage.getItem('effetune_dbt_tests')), {});

    h.dbt._persistTests = async () => {
      throw new Error('persist failed');
    };
    await h.dbt._saveTest('Bad Save');
    h.storage.setItem('effetune_dbt_tests', JSON.stringify({ 'Bad Delete': { tc: 1 } }));
    await h.dbt._deleteTest('Bad Delete');
    h.runTimers();
    assert.equal(h.errors.some(error => error.message === 'dbt.testDeleteFailed'), true);
  });

  const electronFiles = new Map();
  const electronAPI = {
    async getPath(name) {
      assert.equal(name, 'userData');
      return 'C:/user-data';
    },
    async joinPaths(...parts) {
      return parts.join('/');
    },
    async fileExists(path) {
      return electronFiles.has(path);
    },
    async readFile(path) {
      return electronFiles.get(path);
    },
    async saveFile(path, content) {
      electronFiles.set(path, { success: true, content });
    }
  };

  await withHarness({ electronAPI, electronIntegration: { isElectron: true } }, async h => {
    assert.deepEqual(await h.dbt._getTests(), {});
    await h.dbt._persistTests({ Electron: { tc: 5 } });
    assert.deepEqual(await h.dbt._getTests(), { Electron: { tc: 5 } });
    electronFiles.set('C:/user-data/effetune_dbt_tests.json', { success: false, error: 'read failed' });
    assert.deepEqual(await h.dbt._getTests(), {});
  });
});

test('loads saved tests with partial plugin creation failures', async () => {
  await withHarness({
    nullCreatePluginNames: new Set(['NullB']),
    throwCreatePluginNames: new Set(['ThrowA']),
    storage: {
      effetune_dbt_tests: JSON.stringify({
        Empty: { v: 1, tc: 8, pA: [{ nm: 'ThrowA', en: true }], pB: [{ nm: 'NullB', en: true }] },
        Mixed: { v: 1, tc: '6', pA: [{ nm: 'GoodA', en: false, ch: 'Right', gain: 7 }], pB: [{ nm: 'NullB', en: true }] }
      })
    }
  }, async h => {
    h.dbt._buildPanel();
    await h.dbt._loadTest('Missing');
    await h.dbt._loadTest('Empty');
    assert.equal(h.uiManager.audioManager.pipelineA.length, 0);
    assert.equal(h.uiManager.audioManager.pipelineB, null);

    await h.dbt._loadTest('Mixed');
    assert.equal(h.uiManager.audioManager.pipelineA[0].name, 'GoodA');
    assert.equal(h.uiManager.audioManager.pipelineA[0].enabled, false);
    assert.equal(h.uiManager.audioManager.pipelineA[0].channel, 'R');
    assert.equal(h.uiManager.audioManager.pipelineB, null);
    h.runTimers();
  });
});

test('restores shared payloads and rejects malformed or empty shares', async () => {
  await withHarness({}, async h => {
    h.dbt.enterFresh();
    assert.equal(h.dbt.restoreFromShare('AAAA'), false);
  });

  await withHarness({}, async h => {
    assert.equal(h.dbt.restoreFromShare('not-url-safe!'), false);
    assert.equal(h.dbt.restoreFromShare(encodePipelineState({ pA: [] })), false);
  });

  await withHarness({ nullCreatePluginNames: new Set(['Missing']) }, async h => {
    const encoded = encodePipelineState({ pA: [{ nm: 'Missing', en: true }], pB: [{ nm: 'Missing', en: true }] });
    assert.equal(h.dbt.restoreFromShare(encoded), false);
  });

  await withHarness({ throwCreatePluginNames: new Set(['Broken']) }, async h => {
    const encoded = encodePipelineState({ pA: [{ nm: 'Broken', en: true }], pB: [{ nm: 'Good', en: true }] });
    assert.equal(h.dbt.restoreFromShare(encoded), false);
  });

  await withHarness({}, async h => {
    h.dbt._loadTestList = () => Promise.reject(new Error('list failed'));
    const encoded = encodePipelineState({
      pA: [{ nm: 'ShareA', en: true, ib: 1, ob: 2, ch: 'All', gain: 3 }],
      pB: [{ nm: 'ShareB', en: false, ch: '3', gain: 4 }],
      tT: 'ABPREF',
      tn: 'Completed share',
      tc: '2',
      n: 'Alice',
      cC: 1,
      tC: 2,
      pa: 2,
      ts: 123000
    });
    assert.equal(h.dbt.restoreFromShare(encoded), true);
    await flushMicrotasks();
    assert.equal(h.dbt.restoredFromURI, true);
    assert.equal(h.dbt.els.shareBtn.classList.contains('hidden'), true);
    assert.equal(h.uiManager.audioManager.pipelineA[0].channel, 'A');
    assert.equal(h.uiManager.audioManager.pipelineB[0].channel, '3');
  });
});

test('starts tests, randomizes trials, switches labels, and handles keyboard shortcuts', async () => {
  await withHarness({ rejectEnableParallel: true, throwFadeOut: true, throwFadeIn: true }, async h => {
    h.dbt.enterFresh();
    await flushMicrotasks();

    h.dbt.audioManager.pipelineB = [];
    h.dbt._startTest('ABX');
    assert.equal(h.dbt.testRunning, false);
    h.dbt.audioManager.pipelineB = [createPlugin('Beta')];

    h.dbt.els.countInput.value = '0';
    h.dbt._startTest('ABX');
    assert.equal(h.dbt.els.configError.classList.contains('hidden'), false);

    h.dbt.els.countInput.value = '2';
    const originalRandom = Math.random;
    Math.random = () => 0.25;
    try {
      h.dbt._startTest('ABX');
      await flushMicrotasks();
      assert.equal(h.dbt.testRunning, true);
      assert.equal(h.dbt._aIsPhysicalA, true);
      assert.equal(h.dbt._xIsA, true);
    } finally {
      Math.random = originalRandom;
    }

    const input = h.document.createElement('input');
    h.dbt._onKeyDown({ key: 'a', target: input, preventDefault() { this.prevented = true; } });
    h.dbt._onKeyDown({ key: 'a', ctrlKey: true });
    h.dbt._onKeyDown({ key: 'a', metaKey: true });
    h.dbt._onKeyDown({ key: 'a', altKey: true });
    h.dbt._onKeyDown({ key: 'a', repeat: true });
    h.dbt._onKeyDown({ key: 'z', target: h.document.body });

    const q = createEvent(h.document.body, { key: 'q' });
    h.dbt._onKeyDown(q);
    assert.equal(q.prevented, 1);

    h.dbt.testRunning = true;
    const w = createEvent(h.document.body, { key: 'W' });
    h.dbt._onKeyDown(w);
    assert.equal(w.prevented, 1);

    h.dbt.testRunning = true;
    const one = createEvent(h.document.body, { key: '1' });
    h.dbt._onKeyDown(one);
    assert.equal(one.prevented, 1);
    const two = createEvent(h.document.body, { key: '2' });
    h.dbt._onKeyDown(two);
    const three = createEvent(h.document.body, { key: '3' });
    h.dbt._onKeyDown(three);
    h.runTimers();

    h.dbt.testType = 'ABPREF';
    const x = createEvent(h.document.body, { key: 'X' });
    h.dbt._onKeyDown(x);
    assert.equal(x.prevented, 0);
    h.dbt._switchToLabel('X');

    h.dbt.testRunning = false;
    h.dbt._switchToLabel('A');
    h.dbt._onKeyDown(createEvent(h.document.body, { key: 'A' }));
  });

  await withHarness({}, async h => {
    h.dbt.enterFresh();
    await flushMicrotasks();
    h.dbt.els.countInput.value = '1';
    const values = [0.75, 0.75];
    const originalRandom = Math.random;
    Math.random = () => values.shift() ?? 0.75;
    try {
      h.dbt._startTest('ABPREF');
      assert.equal(h.dbt._aIsPhysicalA, false);
      assert.equal(h.dbt._xIsA, false);
      assert.equal(h.dbt.els.switchX.style.display, 'none');
    } finally {
      Math.random = originalRandom;
    }
  });
});

test('resolves physical labels, votes, finishes, and displays result variants', async () => {
  await withHarness({}, async h => {
    h.dbt.enterFresh();
    await flushMicrotasks();
    h.dbt._aIsPhysicalA = true;
    h.dbt._xIsA = false;
    assert.equal(h.dbt._physicalFor('A'), 'A');
    assert.equal(h.dbt._physicalFor('B'), 'B');
    assert.equal(h.dbt._physicalFor('X'), 'B');
    h.dbt._aIsPhysicalA = false;
    h.dbt._xIsA = true;
    assert.equal(h.dbt._physicalFor('A'), 'B');
    assert.equal(h.dbt._physicalFor('B'), 'A');
    assert.equal(h.dbt._physicalFor('X'), 'B');

    h.dbt.testRunning = false;
    h.dbt._vote('A');
    assert.equal(h.dbt.totalCount, 0);

    h.dbt.testRunning = true;
    h.dbt.testCount = 3;
    h.dbt.testType = 'ABX';
    h.dbt._xIsA = true;
    h.dbt._vote('A');
    h.dbt.testRunning = true;
    h.dbt._xIsA = true;
    h.dbt._vote('B');
    assert.equal(h.dbt.correctCount, 1);

    h.dbt.testRunning = true;
    h.dbt.testType = 'ABPREF';
    h.dbt._aIsPhysicalA = true;
    h.dbt._vote('A');
    assert.equal(h.dbt.prefACount, 1);
    h.dbt.testRunning = true;
    h.dbt._aIsPhysicalA = true;
    h.dbt._vote('B');
    assert.equal(h.dbt.prefACount, 1);

    h.dbt.testRunning = true;
    h.dbt.testCount = h.dbt.totalCount;
    h.dbt.localName = '';
    h.dbt.startTime = 0;
    h.dbt.timeSpent = 45000;
    h.dbt._nextTrial();
    assert.equal(h.dbt.name, 'dbt.anonymous');
    assert.equal(h.dbt.testRunning, false);
  });

  await withHarness({ throwDisableParallel: true, throwFadeIn: true }, async h => {
    h.dbt.enterFresh();
    await flushMicrotasks();
    h.dbt.testRunning = true;
    h.dbt.testType = 'ABX';
    h.dbt.testName = '';
    h.dbt.name = 'No total';
    h.dbt.localName = 'No total';
    h.dbt.totalCount = 0;
    h.dbt.correctCount = 0;
    h.dbt.startTime = Date.now() - 1000;
    h.dbt._finishTest();
    assert.match(h.dbt.els.resultTitle.textContent, /No total/);
  });
});

test('renders ABX and preference result significance states', async () => {
  await withHarness({}, async h => {
    h.dbt.enterFresh();
    await flushMicrotasks();

    h.dbt.testType = 'ABX';
    h.dbt.testName = 'ABX named';
    h.dbt.name = 'Bob';
    h.dbt.totalCount = 10;
    h.dbt.correctCount = 10;
    h.dbt.timeSpent = 61000;
    h.dbt.restoredFromURI = false;
    h.dbt._displayResult();
    assert.match(h.dbt.els.resultConclusion.textContent, /abxSignificant/);
    assert.equal(h.dbt.els.resultTestName.classList.contains('hidden'), false);

    h.dbt.testName = '';
    h.dbt.correctCount = 5;
    h.dbt._displayResult();
    assert.match(h.dbt.els.resultConclusion.textContent, /abxNotSignificant/);
    assert.equal(h.dbt.els.resultTestName.classList.contains('hidden'), true);

    h.dbt.testType = 'ABPREF';
    h.dbt.testName = 'Preference named';
    h.dbt.totalCount = 10;
    h.dbt.prefACount = 10;
    h.dbt._displayResult();
    assert.match(h.dbt.els.resultConclusion.textContent, /abprefSignificant/);
    assert.match(h.dbt.els.resultAnswers.textContent, /"pipeline":"A"/);

    h.dbt.prefACount = 1;
    h.dbt._displayResult();
    assert.match(h.dbt.els.resultAnswers.textContent, /"pipeline":"B"/);

    h.dbt.prefACount = 5;
    h.dbt.restoredFromURI = true;
    h.dbt._displayResult();
    assert.match(h.dbt.els.resultConclusion.textContent, /abprefNotSignificant/);
    assert.equal(h.dbt.els.shareBtn.classList.contains('hidden'), true);
  });
});

test('builds and shares payloads through success and failure clipboard paths', async () => {
  await withHarness({
    electronAPI: {
      async writeClipboardText(text) {
        this.text = text;
        return true;
      }
    }
  }, async h => {
    h.dbt.enterFresh();
    await flushMicrotasks();
    h.dbt.testName = 'Shareable';
    h.dbt.name = 'Sharer';
    h.dbt.testType = 'ABX';
    h.dbt.testCount = 4;
    h.dbt.correctCount = 3;
    h.dbt.totalCount = 4;
    h.dbt.prefACount = 0;
    h.dbt.timeSpent = 1000;

    const payload = h.dbt._buildSharePayload();
    assert.equal(payload.pA[0].nm, 'Alpha');
    assert.equal(payload.pA[0].ib, 0);
    assert.equal(payload.pA[0].ob, 1);
    assert.equal(payload.pA[0].ch, 'L');
    assert.equal(payload.pA[0].id, undefined);

    await h.dbt._share();
    await flushMicrotasks();
    h.runTimers();
    const dbtParam = new URL(h.windowObject.electronAPI.text).searchParams.get('dbt');
    assert.equal(decodePipelineState(dbtParam).tn, 'Shareable');
    assert.deepEqual(h.errors.at(-2), { message: 'dbt.copySuccess', isError: false });
  });

  await withHarness({
    clipboard: {
      async writeText() {
        throw new Error('denied');
      }
    }
  }, async h => {
    h.dbt._buildPanel();
    await h.dbt._share();
    assert.deepEqual(h.errors.at(-1), { message: 'dbt.copyFailure', isError: true });
  });

  await withHarness({ documentOptions: { execCommand: command => command === 'copy' } }, async h => {
    h.dbt._buildPanel();
    await h.dbt._share();
    await flushMicrotasks();
    h.runTimers();
    assert.deepEqual(h.errors.at(-1), { clear: true });
  });
});

test('computes binomial probabilities and coefficients at edge cases', async () => {
  await withHarness({}, async h => {
    assert.equal(h.dbt._binomialOneSided(0, 0), 1);
    assert.equal(h.dbt._binomialTwoSided(0, 0), 1);
    assert.equal(h.dbt._binomialCoeff(5, -1), 0);
    assert.equal(h.dbt._binomialCoeff(5, 6), 0);
    assert.equal(h.dbt._binomialCoeff(5, 3), 10);
    assert.equal(h.dbt._binomialOneSided(3, 4), 0.3125);
    assert.equal(h.dbt._binomialTwoSided(3, 4), 0.625);
  });
});
