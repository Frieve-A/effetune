import assert from 'node:assert/strict';
import test from 'node:test';

import { UIManager } from '../../js/ui-manager.js';
import { LibraryManagerV2 } from '../../js/library/library-manager-v2.js';
import { PlaybackManager } from '../../js/ui/audio-player/playback-manager.js';
import {
  LibraryView,
  WEB_PLAYLIST_BLOB_EXPORT_MAX_BYTES
} from '../../js/ui/library/library-view.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class FakeClassList {
  constructor() {
    this.tokens = new Set();
  }

  add(...tokens) {
    tokens.forEach(token => this.tokens.add(token));
  }

  remove(...tokens) {
    tokens.forEach(token => this.tokens.delete(token));
  }

  contains(token) {
    return this.tokens.has(token);
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.textContent = '';
    this.title = '';
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.ownerDocument = null;
    this.value = '';
    this.className = '';
    this.tabIndex = 0;
    this.draggable = false;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.removeChild(this);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(candidate => candidate !== listener));
  }

  async dispatch(type, event = {}) {
    const eventObject = {
      target: this,
      currentTarget: this,
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
    for (const listener of this.listeners.get(type) || []) {
      results.push(listener(eventObject));
    }
    await Promise.all(results);
    return eventObject;
  }

  click() {
    return this.dispatch('click');
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    this[name] = String(value);
    if (name === 'disabled') this.disabled = true;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    delete this[name];
  }

  closest() {
    return null;
  }

  contains(candidate) {
    return candidate === this || this.children.some(child => child.contains?.(candidate));
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

function createDocument(elementsById = {}) {
  const listeners = new Map();
  const documentRef = {
    body: new FakeElement('body'),
    activeElement: null,
    getElementById(id) {
      return elementsById[id] || null;
    },
    querySelector() {
      return null;
    },
    createElement(tagName) {
      const element = new FakeElement(tagName);
      element.ownerDocument = documentRef;
      return element;
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter(candidate => candidate !== listener));
    },
    dispatch(type, event = {}) {
      const eventObject = {
        key: event.key,
        target: event.target ?? this.body,
        ctrlKey: Boolean(event.ctrlKey),
        metaKey: Boolean(event.metaKey),
        shiftKey: Boolean(event.shiftKey),
        altKey: Boolean(event.altKey),
        prevented: 0,
        preventDefault() {
          this.prevented++;
        },
        ...event
      };
      for (const listener of listeners.get(type) || []) {
        listener(eventObject);
      }
      return eventObject;
    }
  };
  documentRef.body.ownerDocument = documentRef;
  return documentRef;
}

function createMappedHtmlElement(tagName, ownerDocument, selectors) {
  const element = new FakeElement(tagName);
  element.ownerDocument = ownerDocument;
  element.selectorMap = new Map();
  Object.defineProperty(element, 'innerHTML', {
    get() {
      return this.html || '';
    },
    set(value) {
      this.html = String(value || '');
      this.selectorMap.clear();
      for (const selector of selectors) {
        const marker = selector === '[data-folder-status]'
          ? 'data-folder-status'
          : selector.slice(1);
        if (!this.html.includes(marker)) continue;
        const child = new FakeElement(selector === '[data-folder-status]' ? 'span' : 'button');
        child.ownerDocument = ownerDocument;
        this.selectorMap.set(selector, child);
      }
    }
  });
  element.querySelector = selector => element.selectorMap.get(selector) || null;
  element.querySelectorAll = selector => selector === '.library-paged-folder-actions button'
    ? [
        element.selectorMap.get('.library-paged-folder-reconnect'),
        element.selectorMap.get('.library-paged-folder-rescan'),
        element.selectorMap.get('.library-paged-folder-remove')
      ].filter(Boolean)
    : [];
  return element;
}

function createLibraryNavElement() {
  const nav = new FakeElement('aside');
  let html = '';
  let innerHTMLWrites = 0;
  Object.defineProperty(nav, 'innerHTML', {
    get() {
      return html;
    },
    set(value) {
      html = String(value || '');
      innerHTMLWrites += 1;
      nav.children = [...html.matchAll(
        /<button([^>]*)data-view="([^"]+)"([^>]*)>([\s\S]*?)<\/button>/g
      )].map(match => {
        const button = new FakeElement('button');
        const attributes = `${match[1]}${match[3]}`;
        const className = attributes.match(/class="([^"]*)"/)?.[1] || '';
        button.className = className;
        button.dataset.view = match[2];
        className.split(/\s+/).filter(Boolean).forEach(token => button.classList.add(token));
        if (attributes.includes('aria-current="page"')) button.setAttribute('aria-current', 'page');

        const label = new FakeElement('span');
        label.textContent = match[4].match(
          /<span class="library-nav-label">([^<]*)<\/span>/
        )?.[1] || '';
        const countMatch = match[4].match(
          /<span class="library-count"([^>]*)>([^<]*)<\/span>/
        );
        const count = new FakeElement('span');
        count.hidden = countMatch?.[1].includes('hidden') ?? true;
        count.textContent = countMatch?.[2] || '';
        button.appendChild(label);
        button.appendChild(count);
        button.querySelector = selector => selector === '.library-nav-label'
          ? label
          : (selector === '.library-count' ? count : null);
        button.parentNode = nav;
        return button;
      });
    }
  });
  Object.defineProperty(nav, 'innerHTMLWrites', {
    get() {
      return innerHTMLWrites;
    }
  });
  nav.querySelectorAll = selector => selector === '[data-view]' ? [...nav.children] : [];
  nav.querySelector = selector => selector === '[aria-current="page"]'
    ? nav.children.find(button => button.getAttribute('aria-current') === 'page') || null
    : null;
  return nav;
}

class DialogElement extends FakeElement {
  constructor(tagName, ownerDocument) {
    super(tagName);
    this.ownerDocument = ownerDocument;
    this.elements = new Map();
    this.focusables = [];
    this.html = '';
  }

  set innerHTML(value) {
    this.html = String(value || '');
    this.elements = new Map();
    this.focusables = [];
    if (this.html.includes('library-prompt-dialog')) {
      this.form = this.createDialogChild('form');
      this.closeButton = this.createDialogChild('button');
      this.input = this.createDialogChild('input');
      this.input.select = () => {
        this.input.selected = true;
      };
      this.cancelButton = this.createDialogChild('button');
      this.okButton = this.createDialogChild('button');
      this.elements.set('form', this.form);
      this.elements.set('.library-dialog-close', this.closeButton);
      this.elements.set('.library-prompt-input', this.input);
      this.elements.set('.library-prompt-cancel', this.cancelButton);
      this.elements.set('.library-prompt-ok', this.okButton);
      this.focusables.push(this.closeButton, this.input, this.cancelButton, this.okButton);
      return;
    }
    if (this.html.includes('library-properties-dialog')) {
      this.closeButton = this.createDialogChild('button');
      this.elements.set('.library-dialog-close', this.closeButton);
      this.focusables.push(this.closeButton);
      return;
    }
    if (this.html.includes('library-playlist-duplicate')) {
      for (const className of [
        'library-playlist-rename', 'library-playlist-duplicate',
        'library-playlist-export-m3u8', 'library-playlist-export-xspf',
        'library-playlist-delete'
      ]) {
        const button = this.createDialogChild('button');
        this.elements.set(`.${className}`, button);
      }
      return;
    }
    if (this.html.includes('library-playlist-menu-item')) {
      const buttonMatches = [...this.html.matchAll(/<button\b([^>]*)>/g)];
      this.playlistButtons = [];
      buttonMatches.forEach(match => {
        const attrs = match[1] || '';
        if (!attrs.includes('library-playlist-menu-item')) return;
        const button = this.createDialogChild('button');
        if (attrs.includes('library-playlist-menu-new')) {
          this.elements.set('.library-playlist-menu-new', button);
        }
        const playlistId = attrs.match(/data-playlist-id="([^"]+)"/)?.[1] || '';
        if (playlistId) {
          button.dataset.playlistId = playlistId;
          this.playlistButtons.push(button);
        }
        this.focusables.push(button);
      });
      this.elements.set('button:not(:disabled)', this.focusables[0] || null);
      return;
    }
    const actionMatches = [...this.html.matchAll(/<button\b[^>]*data-action="([^"]+)"[^>]*>/g)];
    if (actionMatches.length) {
      actionMatches.forEach(match => {
        const button = this.createDialogChild('button');
        button.dataset.action = match[1];
        if (/\bdisabled\b/.test(match[0])) button.disabled = true;
        this.elements.set(`[data-action="${match[1]}"]`, button);
        if (!button.disabled) this.focusables.push(button);
      });
      this.elements.set('button:not(:disabled)', this.focusables[0] || null);
    }
  }

  get innerHTML() {
    return this.html;
  }

  createDialogChild(tagName) {
    const element = new FakeElement(tagName);
    element.ownerDocument = this.ownerDocument;
    this.appendChild(element);
    return element;
  }

  querySelector(selector) {
    return this.elements.get(selector) || null;
  }

  querySelectorAll(selector) {
    if (selector === '[data-playlist-id]') return this.playlistButtons || [];
    return selector.includes('button') || selector.includes('input') || selector.includes('[tabindex]')
      ? this.focusables
      : [];
  }
}

function createDialogDocument() {
  const documentRef = createDocument();
  documentRef.createElement = tagName => new DialogElement(tagName, documentRef);
  return documentRef;
}

function createLibraryViewFixture(overrides = {}) {
  return Object.assign(Object.create(LibraryView.prototype), {
    navigationIntentId: 0
  }, overrides);
}

test('updateUITexts localizes the view switch button titles and aria labels', async () => {
  const calls = [];
  const effectPipelineButton = new FakeElement('button');
  const openLibraryButton = new FakeElement('button');
  const documentRef = createDocument({ effectPipelineButton, openLibraryButton });
  const manager = Object.assign(Object.create(UIManager.prototype), {
    doubleBlindTest: null,
    doubleBlindTestButton: null,
    mobileMenu: null,
    pipelineEmpty: null,
    pluginListManager: null,
    stateManager: null,
    libraryView: {
      updateUITexts() {
        calls.push(['libraryView.updateUITexts']);
      }
    },
    t(key) {
      if (key === 'ui.title.effectPipeline') return 'Localized Pipeline';
      return key === 'ui.title.openLibrary' ? 'Localized Library' : key;
    },
    updatePipelineEmptyContent() {}
  });

  await withGlobals({ document: documentRef }, async () => {
    manager.updateUITexts();
  });

  assert.equal(effectPipelineButton.title, 'Localized Pipeline');
  assert.equal(effectPipelineButton.attributes.get('aria-label'), 'Localized Pipeline');
  assert.equal(openLibraryButton.title, 'Localized Library');
  assert.equal(openLibraryButton.attributes.get('aria-label'), 'Localized Library');
  assert.deepEqual(calls, [['libraryView.updateUITexts']]);
});

test('LibraryView updateUITexts refreshes mounted static and rendered library text', () => {
  const root = new FakeElement('section');
  const nav = new FakeElement('aside');
  const searchInput = new FakeElement('input');
  const addFolderLabel = new FakeElement('span');
  const rescanButton = new FakeElement('button');
  const calls = [];
  root.querySelector = selector => ({
    '.library-add-folder span': addFolderLabel,
    '.library-rescan': rescanButton
  })[selector] || null;
  const translations = {
    'library.title': 'Music Library',
    'library.search.placeholder': 'Search music',
    'library.action.addFolder': 'Add Music Folder',
    'library.action.rescan': 'Rescan'
  };
  const view = createLibraryViewFixture({
    root,
    nav,
    searchInput,
    uiManager: { t: key => translations[key] || key },
    render() {
      calls.push(['render']);
    }
  });

  view.updateUITexts();

  assert.equal(root.getAttribute('aria-label'), 'Music Library');
  assert.equal(nav.getAttribute('aria-label'), 'Music Library');
  assert.equal(searchInput.placeholder, 'Search music');
  assert.equal(addFolderLabel.textContent, 'Add Music Folder');
  assert.equal(rescanButton.title, 'Rescan');
  assert.equal(rescanButton.getAttribute('aria-label'), 'Rescan');
  assert.deepEqual(calls, [['render']]);
});

test('initOpenLibraryButton wires the view switch buttons and Electron IPC callbacks', async () => {
  const calls = [];
  const effectPipelineButton = new FakeElement('button');
  const openLibraryButton = new FakeElement('button');
  const documentRef = createDocument({ effectPipelineButton, openLibraryButton });
  const ipcCallbacks = {};
  const manager = Object.assign(Object.create(UIManager.prototype), {
    libraryManager: {
      async addFolder() {
        calls.push(['libraryManager.addFolder']);
      },
      async scanFolders() {
        calls.push(['libraryManager.scanFolders']);
      }
    },
    libraryView: {
      render() {
        calls.push(['libraryView.render']);
      }
    },
    async ensureLibraryManager() {
      calls.push(['ensureLibraryManager']);
      return this.libraryManager;
    },
    async showLibraryView() {
      calls.push(['showLibraryView']);
    },
    showEffectPipelineView() {
      calls.push(['showEffectPipelineView']);
    },
    toggleLibraryView() {
      calls.push(['toggleLibraryView']);
    }
  });

  await withGlobals({
    document: documentRef,
    window: {
      electronAPI: {
        onIPC(channel, callback) {
          calls.push(['onIPC', channel]);
          ipcCallbacks[channel] = callback;
        }
      }
    }
  }, async () => {
    manager.initOpenLibraryButton();
    await openLibraryButton.click();
    await effectPipelineButton.click();
    await ipcCallbacks['open-library-view']();
    await ipcCallbacks['open-effect-pipeline-view']();
    await ipcCallbacks['add-music-folder']();
    await ipcCallbacks['rescan-library']();
  });

  assert.deepEqual(calls, [
    ['onIPC', 'open-library-view'],
    ['onIPC', 'open-effect-pipeline-view'],
    ['onIPC', 'add-music-folder'],
    ['onIPC', 'rescan-library'],
    ['toggleLibraryView'],
    ['showEffectPipelineView'],
    ['showLibraryView'],
    ['showEffectPipelineView'],
    ['showLibraryView'],
    ['libraryManager.addFolder'],
    ['libraryView.render'],
    ['ensureLibraryManager'],
    ['libraryManager.scanFolders']
  ]);
});

test('view switch buttons expose the selected view state', async () => {
  const effectPipelineButton = new FakeElement('button');
  const openLibraryButton = new FakeElement('button');
  const documentRef = createDocument({ effectPipelineButton, openLibraryButton });
  const manager = Object.assign(Object.create(UIManager.prototype), {
    effectPipelineButton,
    openLibraryButton
  });

  await withGlobals({ document: documentRef }, async () => {
    manager.updateViewSwitchButtons();
    assert.equal(effectPipelineButton.classList.contains('active'), true);
    assert.equal(effectPipelineButton.attributes.get('aria-pressed'), 'true');
    assert.equal(openLibraryButton.classList.contains('active'), false);
    assert.equal(openLibraryButton.attributes.get('aria-pressed'), 'false');

    documentRef.body.classList.add('view-library');
    manager.updateViewSwitchButtons();
    assert.equal(effectPipelineButton.classList.contains('active'), false);
    assert.equal(effectPipelineButton.attributes.get('aria-pressed'), 'false');
    assert.equal(openLibraryButton.classList.contains('active'), true);
    assert.equal(openLibraryButton.attributes.get('aria-pressed'), 'true');
  });
});

test('showLibraryTrack opens the library view and focuses the requested track', async () => {
  const calls = [];
  const manager = Object.assign(Object.create(UIManager.prototype), {
    async showLibraryView() {
      calls.push(['showLibraryView']);
    },
    libraryView: {
      showTrack(trackId, options) {
        calls.push(['showTrack', trackId, options]);
        return true;
      }
    }
  });

  assert.equal(await manager.showLibraryTrack('track-one', { view: 'artist' }), true);
  assert.deepEqual(calls, [
    ['showLibraryView'],
    ['showTrack', 'track-one', { view: 'artist' }]
  ]);
});

test('library selection actions use the connected catalog playback bridge', async () => {
  const calls = [];
  const catalogService = {
    async start(request) {
      calls.push(request);
      return { kind: 'inactive' };
    },
    async readSequencePage() {
      return { items: [] };
    },
    async resolveSequenceEntrySource() {
      return null;
    }
  };
  const libraryManager = new LibraryManagerV2({ bulkOperationService: catalogService });
  libraryManager.runtime = 'electron';
  const audioPlayer = { playbackManager: {} };
  const manager = Object.assign(Object.create(UIManager.prototype), {
    libraryManager,
    libraryPlaybackBridge: null,
    audioPlayer
  });

  const bridge = manager.connectLibraryPlaybackBridge();
  assert.equal(libraryManager.bulkOperationService, bridge);
  assert.equal(audioPlayer.libraryOperationService, bridge);
  assert.equal(typeof libraryManager.performRowAction, 'undefined');
  assert.deepEqual(await libraryManager.performSelectionAction('play', {
    mode: 'explicit',
    contextToken: 'context-1',
    trackUids: ['track-1']
  }), { kind: 'inactive' });
  assert.deepEqual(calls, [{
    operationKind: 'play',
    selectionDescriptor: {
      mode: 'explicit',
      contextToken: 'context-1',
      trackUids: ['track-1']
    },
    target: {},
    options: { playbackDestination: 'replace' }
  }]);
  bridge.close();
});

test('showLibraryView skips showing a stale mobile library request', async () => {
  const calls = [];
  const manager = Object.assign(Object.create(UIManager.prototype), {
    openLibraryButton: new FakeElement('button'),
    mobileNav: {
      setView(view, options) {
        calls.push(['mobileNav.setView', view, options]);
      }
    },
    async ensureLibraryManager() {
      calls.push(['ensureLibraryManager']);
      this.libraryView = {
        show(options) {
          calls.push(['libraryView.show', options]);
        }
      };
    }
  });

  const result = await manager.showLibraryView({
    isCurrentRequest: () => false
  });

  assert.equal(result, false);
  assert.deepEqual(calls, [
    ['ensureLibraryManager']
  ]);
});

test('showLibraryView forwards the configured startup subview', async () => {
  const calls = [];
  const opener = new FakeElement('button');
  const manager = Object.assign(Object.create(UIManager.prototype), {
    layoutMode: { isMobile: false },
    mobileNav: {
      setView(view, options) {
        calls.push(['mobileNav.setView', view, options]);
      }
    },
    async ensureLibraryManager() {
      calls.push(['ensureLibraryManager']);
      this.libraryView = {
        show(options) {
          calls.push(['libraryView.show', options]);
        }
      };
    },
    updateViewSwitchButtons(visible) {
      calls.push(['updateViewSwitchButtons', visible]);
    }
  });

  assert.equal(await manager.showLibraryView({
    focusSearch: false,
    initialView: 'artists',
    opener
  }), true);
  assert.deepEqual(calls, [
    ['ensureLibraryManager'],
    ['libraryView.show', { focusSearch: false, returnFocus: opener, initialView: 'artists' }],
    ['updateViewSwitchButtons', true],
    ['mobileNav.setView', 'library', { fromLibraryView: true }]
  ]);
});

test('Ctrl or Cmd plus L toggles the music library view', async () => {
  const calls = [];
  const documentRef = createDocument();
  const manager = Object.assign(Object.create(UIManager.prototype), {
    audioManager: { currentPipeline: 'A', pipelineB: [] },
    doubleBlindTest: null,
    toggleLibraryView() {
      calls.push(['toggleLibraryView']);
    }
  });

  await withGlobals({ document: documentRef }, async () => {
    manager.initKeyboardShortcuts();
    const ctrlEvent = documentRef.dispatch('keydown', { key: 'l', ctrlKey: true });
    const metaEvent = documentRef.dispatch('keydown', { key: 'L', metaKey: true });
    const inputEvent = documentRef.dispatch('keydown', { key: 'l', ctrlKey: true, target: new FakeElement('input') });
    const textareaEvent = documentRef.dispatch('keydown', { key: 'l', metaKey: true, target: new FakeElement('textarea') });
    const selectEvent = documentRef.dispatch('keydown', { key: 'l', ctrlKey: true, target: new FakeElement('select') });
    const editable = new FakeElement('div');
    editable.isContentEditable = true;
    const editableEvent = documentRef.dispatch('keydown', { key: 'l', ctrlKey: true, target: editable });
    assert.equal(ctrlEvent.prevented, 1);
    assert.equal(metaEvent.prevented, 1);
    assert.equal(inputEvent.prevented, 0);
    assert.equal(textareaEvent.prevented, 0);
    assert.equal(selectEvent.prevented, 0);
    assert.equal(editableEvent.prevented, 0);
  });

  assert.deepEqual(calls, [
    ['toggleLibraryView'],
    ['toggleLibraryView']
  ]);
});

test('Ctrl or Cmd plus L does not hide the library while a library dialog is active', async () => {
  const calls = [];
  const documentRef = createDocument();
  documentRef.body.classList.add('view-library');
  const manager = Object.assign(Object.create(UIManager.prototype), {
    audioManager: { currentPipeline: 'A', pipelineB: [] },
    doubleBlindTest: null,
    libraryView: {
      hasActiveDialog() {
        calls.push(['hasActiveDialog']);
        return true;
      }
    },
    toggleLibraryView() {
      calls.push(['toggleLibraryView']);
    }
  });

  await withGlobals({ document: documentRef }, async () => {
    manager.initKeyboardShortcuts();
    const ctrlEvent = documentRef.dispatch('keydown', { key: 'l', ctrlKey: true });

    assert.equal(ctrlEvent.prevented, 1);
    assert.equal(documentRef.body.classList.contains('view-library'), true);
  });

  assert.deepEqual(calls, [
    ['hasActiveDialog']
  ]);
});

test('LibraryView show can skip search focus and hide restores the opener', async () => {
  const documentRef = createDocument();
  const opener = new FakeElement('button');
  opener.ownerDocument = documentRef;
  documentRef.body.appendChild(opener);
  opener.focus();

  const root = new FakeElement('section');
  root.ownerDocument = documentRef;
  const searchInput = new FakeElement('input');
  searchInput.ownerDocument = documentRef;
  root.appendChild(searchInput);
  documentRef.body.appendChild(root);

  const view = Object.assign(Object.create(LibraryView.prototype), {
    root,
    searchInput,
    uiManager: {},
    currentView: 'tracks',
    detail: { type: 'album', key: 'old' },
    detailSortOverride: true,
    searchQuery: 'old query',
    mount() {
      return root;
    },
    syncNowPlayingTrack() {},
    render() {}
  });

  await withGlobals({ document: documentRef }, async () => {
    view.show({ focusSearch: false, returnFocus: opener, initialView: 'subfolders' });
    assert.equal(documentRef.body.classList.contains('view-library'), true);
    assert.equal(documentRef.activeElement, opener);
    assert.equal(view.currentView, 'subfolders');
    assert.equal(view.detail, null);
    assert.equal(view.detailSortOverride, false);
    assert.equal(view.searchQuery, '');

    searchInput.focus();
    view.hide();
    assert.equal(documentRef.body.classList.contains('view-library'), false);
    assert.equal(documentRef.activeElement, opener);

    view.show({ returnFocus: opener });
    assert.equal(documentRef.activeElement, searchInput);

    view.show({ focusSearch: false, initialView: 'folders' });
    assert.equal(view.currentView, 'tracks');
  });
});

test('LibraryView commits each search after the normal short input pause', async () => {
  const timers = new Map();
  let nextTimerId = 1;
  await withGlobals({
    setTimeout(callback, delay) {
      const timerId = nextTimerId++;
      timers.set(timerId, { callback, delay });
      return timerId;
    },
    clearTimeout(timerId) {
      timers.delete(timerId);
    }
  }, () => {
    const view = createLibraryViewFixture();
    view.searchInput = { value: 'first' };
    view.searchQuery = '';
    view.detail = { type: 'album', key: 'old' };
    view.searchDebounceTimer = null;
    let renders = 0;
    view.render = () => { renders += 1; };

    view.scheduleSearchQuery();
    view.searchInput.value = 'final';
    view.scheduleSearchQuery();

    assert.equal(view.searchQuery, '');
    assert.equal(timers.size, 1);
    const pending = [...timers.values()][0];
    assert.equal(pending.delay, 100);

    pending.callback();

    assert.equal(view.searchQuery, 'final');
    assert.equal(view.detail, null);
    assert.equal(renders, 1);
  });
});

test('desktop library avoids page overflow while preserving a usable minimum height', async () => {
  const version = new FakeElement('span');
  const documentRef = createDocument({ 'app-version': version });
  const root = new FakeElement('section');
  const versionFooter = new FakeElement('div');
  let top = 220;
  root.getBoundingClientRect = () => ({ top });
  versionFooter.getBoundingClientRect = () => ({ height: 18 });
  versionFooter.appendChild(version);
  const view = Object.assign(Object.create(LibraryView.prototype), {
    root
  });

  await withGlobals({
    document: documentRef,
    window: {
      innerHeight: 800,
      getComputedStyle(element) {
        return element === versionFooter
          ? { display: 'block', marginTop: '20px', marginBottom: '0px' }
          : { display: 'block', marginTop: '0px', marginBottom: '0px' };
      }
    }
  }, async () => {
    view.updateDesktopLayoutHeight();
    assert.equal(root.style['--library-desktop-height'], '522px');

    top = 620;
    view.updateDesktopLayoutHeight();
    assert.equal(root.style['--library-desktop-height'], '360px');

    documentRef.body.classList.add('layout-mobile');
    view.updateDesktopLayoutHeight();
    assert.equal(root.style['--library-desktop-height'], undefined);
  });
});

test('LibraryView syncs the content inset to the scrollbar width', () => {
  const root = new FakeElement('section');
  const content = new FakeElement('div');
  const view = Object.assign(Object.create(LibraryView.prototype), {
    root,
    content
  });

  content.offsetWidth = 480;
  content.clientWidth = 463;
  view.syncContentScrollbarInset();
  assert.equal(root.style['--library-content-scrollbar-width'], '17px');

  content.clientWidth = 480;
  view.syncContentScrollbarInset();
  assert.equal(root.style['--library-content-scrollbar-width'], '0px');
});

test('LibraryView resyncs the content inset after publishing paged rows', () => {
  const root = new FakeElement('section');
  const content = new FakeElement('div');
  content.replaceChildren = child => {
    content.children = [child];
    content.offsetWidth = 480;
    content.clientWidth = 463;
  };
  const view = Object.assign(Object.create(LibraryView.prototype), {
    root,
    content,
    isCurrentPagedAttempt: () => true
  });

  const published = view.publishPagedAttemptDom({
    ariaBusy: false,
    ariaRowCount: 100
  }, new FakeElement('section'));

  assert.equal(published, true);
  assert.equal(root.style['--library-content-scrollbar-width'], '17px');
});

test('desktop library resizes when player or blind test panels change', async () => {
  const documentRef = createDocument();
  const root = new FakeElement('section');
  let top = 160;
  let mutationCallback = null;
  let animationCallback = null;
  const calls = [];
  root.getBoundingClientRect = () => ({ top });
  const view = Object.assign(Object.create(LibraryView.prototype), {
    root,
    desktopLayoutHeightCleanup: null,
    refreshDesktopLayoutHeightObservers: null,
    desktopLayoutHeightFrame: null,
    desktopLayoutHeightFrameType: null
  });
  class FakeMutationObserver {
    constructor(callback) {
      mutationCallback = callback;
    }

    observe(target, options) {
      calls.push(['mutationObserve', target, options]);
    }

    disconnect() {
      calls.push(['mutationDisconnect']);
    }
  }

  await withGlobals({
    document: documentRef,
    window: {
      innerHeight: 900,
      addEventListener(type, listener) {
        calls.push(['windowAdd', type, listener]);
      },
      removeEventListener(type, listener) {
        calls.push(['windowRemove', type, listener]);
      }
    },
    MutationObserver: FakeMutationObserver,
    requestAnimationFrame(callback) {
      animationCallback = callback;
      return 42;
    },
    cancelAnimationFrame(id) {
      calls.push(['cancelAnimationFrame', id]);
    }
  }, async () => {
    view.startDesktopLayoutHeightTracking();
    assert.equal(root.style['--library-desktop-height'], '720px');

    top = 300;
    mutationCallback();
    assert.equal(root.style['--library-desktop-height'], '720px');
    animationCallback();
    assert.equal(root.style['--library-desktop-height'], '580px');

    view.stopDesktopLayoutHeightTracking();
    assert.equal(root.style['--library-desktop-height'], undefined);
  });

  assert.ok(calls.some(call => call[0] === 'mutationObserve' && call[1] === documentRef.body && call[2].childList === true));
  assert.ok(calls.some(call => call[0] === 'mutationDisconnect'));
  assert.ok(calls.some(call => call[0] === 'windowRemove' && call[1] === 'resize'));
});

test('LibraryView hide closes context and playlist menus', async () => {
  const calls = [];
  const documentRef = createDocument();
  documentRef.body.classList.add('view-library');
  const root = new FakeElement('section');
  root.ownerDocument = documentRef;
  const contextMenu = new FakeElement('div');
  contextMenu.ownerDocument = documentRef;
  const playlistMenu = new FakeElement('div');
  playlistMenu.ownerDocument = documentRef;
  documentRef.body.appendChild(root);
  documentRef.body.appendChild(contextMenu);
  documentRef.body.appendChild(playlistMenu);
  const view = Object.assign(Object.create(LibraryView.prototype), {
    root,
    contextMenu,
    contextMenuReturnFocus: null,
    contextMenuCleanup() {
      calls.push(['contextMenuCleanup']);
    },
    playlistMenu,
    playlistMenuReturnFocus: null,
    libraryReturnFocus: null
  });

  await withGlobals({ document: documentRef }, async () => {
    view.hide({ restoreFocus: false });
  });

  assert.equal(documentRef.body.classList.contains('view-library'), false);
  assert.equal(contextMenu.parentNode, null);
  assert.equal(playlistMenu.parentNode, null);
  assert.equal(view.contextMenu, null);
  assert.equal(view.playlistMenu, null);
  assert.deepEqual(calls, [['contextMenuCleanup']]);
});

test('paged entity-card keyboard navigation is fenced by the row dispatcher', async () => {
  const calls = [];
  const row = {
    dataset: { queryGeneration: '4', pageAttemptId: '2' },
    closest(selector) {
      return selector === '.library-paged-row' ? this : null;
    }
  };
  const view = Object.assign(Object.create(LibraryView.prototype), {
    content: { clientHeight: 480 },
    pagedState: { phase: 'committed' },
    pagedController: {
      dispatchRowAction(identity, callback) {
        calls.push(['dispatch', identity]);
        return { accepted: true, value: callback() };
      },
      createViewState() {
        return { queryGeneration: 4, pageAttemptId: 2 };
      }
    },
    getPagedQuery() {
      return { endpoint: 'entities', entityType: 'album' };
    },
    getTrackRowHeight() {
      return 40;
    },
    async movePagedFocus(delta) {
      calls.push(['move', delta]);
    }
  });
  const event = {
    key: 'ArrowDown',
    target: row,
    preventDefault() {
      calls.push(['prevent']);
    }
  };

  view.handleContentKeyDown(event);
  await Promise.resolve();

  assert.deepEqual(calls, [
    ['prevent'],
    ['dispatch', { queryGeneration: 4, pageAttemptId: 2 }],
    ['move', 1]
  ]);
});

test('paged track rows show and refresh the now-playing indicator', async () => {
  const documentRef = createDocument();
  const view = Object.assign(Object.create(LibraryView.prototype), {
    detail: null,
    nowPlayingTrackId: 'track-one',
    pagedFocusedEntityId: null,
    pagedController: {
      isSelected() { return false; }
    },
    uiManager: { t: key => key },
    startPagedTrackPlay() {},
    dispatchPagedRowAction() {}
  });

  await withGlobals({ document: documentRef }, async () => {
    const row = view.createPagedRow({
      trackUid: 'track-one',
      title: 'Now Playing'
    }, 0, { queryGeneration: 1, pageAttemptId: 1 }, true);

    assert.equal(row.dataset.trackId, 'track-one');
    assert.match(row.className, /\bnow-playing\b/);
    assert.equal(row.getAttribute('aria-current'), 'true');
    assert.match(row.innerHTML, /class="library-now-playing-indicator"[^>]*>♪<\/span>/);

    const indicator = new FakeElement('span');
    row.querySelector = selector => selector === '.library-now-playing-indicator' ? indicator : null;
    view.content = {
      querySelectorAll(selector) {
        assert.equal(selector, '.library-paged-row[data-track-id]');
        return [row];
      }
    };
    view.nowPlayingTrackId = 'track-two';
    view.refreshRenderedNowPlaying();

    assert.equal(row.classList.contains('now-playing'), false);
    assert.equal(row.getAttribute('aria-current'), null);
    assert.equal(indicator.hidden, true);

    view.nowPlayingTrackId = 'track-one';
    view.refreshRenderedNowPlaying();

    assert.equal(row.classList.contains('now-playing'), true);
    assert.equal(row.getAttribute('aria-current'), 'true');
    assert.equal(indicator.hidden, false);
  });
});

test('paged track rows expose the properties menu from right click and More', async () => {
  const documentRef = createDocument();
  const originalCreateElement = documentRef.createElement;
  const selectors = ['.library-paged-select', '.library-paged-row-more'];
  documentRef.createElement = tagName => tagName === 'div'
    ? createMappedHtmlElement(tagName, documentRef, selectors)
    : originalCreateElement(tagName);
  const calls = [];
  const view = Object.assign(Object.create(LibraryView.prototype), {
    detail: null,
    nowPlayingTrackId: null,
    pagedFocusedEntityId: null,
    pagedController: {
      isSelected() { return false; }
    },
    uiManager: { t: key => key },
    startPagedTrackPlay() {},
    dispatchPagedRowAction() {},
    openPagedTrackContextMenu(event, track, context) {
      calls.push([event.clientX, event.clientY, track.trackUid, context.returnFocus]);
    }
  });
  const track = { trackUid: 'track-one', title: 'Track One' };

  await withGlobals({ document: documentRef }, async () => {
    const row = view.createPagedRow(track, 0, { queryGeneration: 1, pageAttemptId: 1 }, true);
    await row.dispatch('contextmenu', { clientX: 10, clientY: 20 });

    const more = row.querySelector('.library-paged-row-more');
    more.getBoundingClientRect = () => ({ left: 30, bottom: 40 });
    await more.click();

    assert.deepEqual(calls, [
      [10, 20, 'track-one', row],
      [30, 44, 'track-one', more]
    ]);
  });
});

test('paged track properties menu opens from Shift+F10', () => {
  const content = new FakeElement('div');
  const row = new FakeElement('div');
  row._pagedItem = { trackUid: 'track-one', title: 'Track One' };
  row.getBoundingClientRect = () => ({ left: 10, top: 20 });
  content.querySelector = selector => selector.includes('track-one') ? row : null;
  const calls = [];
  const view = Object.assign(Object.create(LibraryView.prototype), {
    content,
    pagedState: { phase: 'committed' },
    pagedFocusedEntityId: 'track-one',
    renderedPageTrackIds: ['track-one'],
    getPagedQuery() { return { endpoint: 'tracks' }; },
    openPagedTrackContextMenu(event, track, context) {
      calls.push([event.clientX, event.clientY, track.trackUid, context.returnFocus]);
    }
  });
  const event = {
    key: 'F10',
    shiftKey: true,
    target: content,
    prevented: 0,
    preventDefault() { this.prevented += 1; }
  };

  view.handleContentKeyDown(event);

  assert.equal(event.prevented, 1);
  assert.deepEqual(calls, [[34, 44, 'track-one', row]]);
});

test('paged scrolling refreshes an expired catalog context without showing an error', async () => {
  const documentRef = createDocument();
  const content = new FakeElement('div');
  const calls = [];
  const error = Object.assign(new Error('The music library request could not be completed. Try again.'), {
    code: 'STALE_CURSOR'
  });
  const view = Object.assign(Object.create(LibraryView.prototype), {
    content,
    pagedQueryKey: 'albums-query',
    pagedRestartPreservesSelection: false,
    pagedController: {
      async requestViewportOrdinal() {
        throw error;
      },
      markSelectionStale() {
        calls.push('markSelectionStale');
      }
    },
    capturePagedAnchor() {
      calls.push('capturePagedAnchor');
    },
    scheduleRender() {
      calls.push('scheduleRender');
    }
  });

  await withGlobals({ document: documentRef }, async () => {
    const result = await view.ensurePagedOrdinal(1000);
    assert.equal(result.reason, 'snapshot-expired');
  });

  assert.deepEqual(calls, ['capturePagedAnchor', 'markSelectionStale', 'scheduleRender']);
  assert.equal(view.pagedQueryKey, null);
  assert.equal(view.pagedRestartPreservesSelection, true);
  assert.equal(content.children.length, 0);
});

test('paged scrolling ignores work from an inactive replacement page', async () => {
  const documentRef = createDocument();
  const content = new FakeElement('div');
  const view = Object.assign(Object.create(LibraryView.prototype), {
    content,
    pagedController: {
      async ensureOrdinal() {
        return { accepted: false, reason: 'inactive-page' };
      }
    }
  });

  await withGlobals({ document: documentRef }, async () => {
    assert.deepEqual(await view.ensurePagedOrdinal(1000), {
      accepted: false,
      reason: 'inactive-page'
    });
  });

  assert.equal(content.children.length, 0);
});

test('paged folder status requires a successful scan before reporting OK', () => {
  const view = Object.assign(Object.create(LibraryView.prototype), {
    removingFolderIds: new Set()
  });
  const unscanned = { id: 'folder-one', status: 'ok', lastScanAt: null };

  assert.deepEqual(view.getPagedFolderStatus(unscanned), {
    key: 'never-scanned', className: 'never-scanned', busy: false
  });
  assert.deepEqual(view.getPagedFolderStatus({ ...unscanned, status: 'active' }), {
    key: 'never-scanned', className: 'never-scanned', busy: false
  });
  assert.deepEqual(view.getPagedFolderStatus({ ...unscanned, status: 'missing' }), {
    key: 'missing', className: 'missing', busy: false
  });
  assert.deepEqual(view.getPagedFolderStatus({ ...unscanned, status: 'needs-permission' }), {
    key: 'needs-permission', className: 'needs-permission', busy: false
  });
  assert.deepEqual(view.getPagedFolderStatus({ ...unscanned, lastScanAt: 123 }), {
    key: 'ok', className: 'ok', busy: false
  });
  assert.deepEqual(view.getPagedFolderStatus(unscanned, {
    phase: 'scanning', folderIds: ['folder-one']
  }), {
    key: 'scanning', className: 'scanning', busy: true
  });
  assert.deepEqual(view.getPagedFolderStatus({ ...unscanned, status: 'missing' }, {
    phase: 'error', folderId: 'folder-one'
  }), {
    key: 'scanError', className: 'scan-error', busy: false
  });
});

test('paged folder rows restore status, rescan, removal, and live scan updates', async () => {
  const documentRef = createDocument();
  const originalCreateElement = documentRef.createElement;
  const selectors = [
    '.library-paged-folder-main',
    '.library-paged-folder-reconnect',
    '.library-paged-folder-rescan',
    '.library-paged-folder-remove',
    '[data-folder-status]'
  ];
  documentRef.createElement = tagName => tagName === 'div'
    ? createMappedHtmlElement(tagName, documentRef, selectors)
    : originalCreateElement(tagName);
  const calls = [];
  let finishRemoval;
  const removalPending = new Promise(resolve => { finishRemoval = resolve; });
  const view = Object.assign(Object.create(LibraryView.prototype), {
    currentView: 'folders',
    detail: null,
    searchQuery: '',
    sortDirection: 'asc',
    lastScanState: null,
    deferredCatalogInvalidationScopes: null,
    pagedFocusedEntityId: null,
    manager: {
      async requestFolderAccess(folderId) {
        calls.push(['reconnect', folderId]);
        return { canceled: false, folderId };
      },
      async scanFolders(request) {
        calls.push(['scan', request]);
        return { accepted: true, scanId: 'scan-one' };
      },
      async removeFolder(folderId) {
        calls.push(['remove', folderId]);
        await removalPending;
      }
    },
    pagedController: {
      dispatchRowAction(identity, callback) {
        calls.push(['dispatch', identity]);
        return { accepted: true, value: callback() };
      }
    },
    content: {
      querySelectorAll() {
        return [];
      }
    },
    renderStatus() {
      calls.push(['status']);
    },
    navigateToDetail(detail) {
      calls.push(['open', detail]);
    }
  });

  await withGlobals({ document: documentRef, confirm: () => true }, async () => {
    const folder = {
      id: 'folder-one',
      kind: 'electron',
      displayName: 'Music',
      status: 'ok',
      lastScanAt: 123
    };
    const row = view.createPagedRow(folder, 0, { queryGeneration: 3, pageAttemptId: 5 }, false);
    view.content.querySelectorAll = selector => selector === '.library-paged-folder-row' ? [row] : [];

    assert.equal(row.tagName, 'DIV');
    assert.match(row.innerHTML, /library-paged-folder-rescan/);
    assert.match(row.innerHTML, /library-paged-folder-remove/);
    assert.equal(row.querySelector('[data-folder-status]').textContent, 'OK');

    await row.querySelector('.library-paged-folder-main').click();
    await row.querySelector('.library-paged-folder-rescan').click();
    const removalClick = row.querySelector('.library-paged-folder-remove').click();
    assert.equal(row.querySelector('[data-folder-status]').textContent, 'Removing folder');
    assert.equal(row.getAttribute('aria-busy'), 'true');
    assert.equal(row.querySelector('.library-paged-folder-rescan').disabled, true);
    assert.equal(row.querySelector('.library-paged-folder-remove').disabled, true);
    view.handleFolderRemovalState({
      folderId: 'folder-one', phase: 'removing', deleted: 1, total: 2
    });
    assert.equal(row.querySelector('[data-folder-status]').textContent, 'Removing folder 1/2');
    finishRemoval();
    await removalClick;
    assert.equal(row.querySelector('[data-folder-status]').textContent, 'OK');
    assert.equal(row.getAttribute('aria-busy'), 'false');

    view.handleScanState({
      phase: 'scanning', scanId: 'scan-one', folderIds: ['folder-one'], found: 10, parsed: 4
    });
    assert.equal(row.querySelector('[data-folder-status]').textContent, 'Scanning');
    assert.equal(row.querySelector('.library-paged-folder-rescan').disabled, true);
    assert.equal(row.querySelector('.library-paged-folder-remove').disabled, true);

    const unaffectedFolder = {
      id: 'folder-two',
      kind: 'electron',
      displayName: 'Archive',
      status: 'ok',
      lastScanAt: 123
    };
    assert.deepEqual(view.getPagedFolderStatus(unaffectedFolder), {
      key: 'ok', className: 'ok', busy: false
    });
    assert.deepEqual(view.getPagedFolderStatus(unaffectedFolder, {
      phase: 'scanning', folderId: 'folder-one'
    }), {
      key: 'ok', className: 'ok', busy: false
    });
    assert.deepEqual(view.getPagedFolderStatus(unaffectedFolder, {
      phase: 'scanning'
    }), {
      key: 'ok', className: 'ok', busy: false
    });

    view.handleScanState({ phase: 'done', scanId: 'scan-one', folderIds: ['folder-one'] });
    assert.equal(row.querySelector('[data-folder-status]').textContent, 'OK');
    assert.equal(row.querySelector('.library-paged-folder-rescan').disabled, false);
    assert.equal(row.querySelector('.library-paged-folder-remove').disabled, false);

    const reconnectRow = view.createPagedRow({
      id: 'folder-two',
      kind: 'web-fsa',
      displayName: 'Archive',
      status: 'needs-permission'
    }, 1, { queryGeneration: 3, pageAttemptId: 5 }, false);
    const reconnect = reconnectRow.querySelector('.library-paged-folder-reconnect');
    const keyEvent = await reconnect.dispatch('keydown', { key: 'Enter' });
    assert.equal(keyEvent.stopped, 1);
    await reconnect.click();
    assert.deepEqual(calls.slice(-3), [
      ['dispatch', { queryGeneration: 3, pageAttemptId: 5 }],
      ['reconnect', 'folder-two'],
      ['scan', { folderIds: ['folder-two'], scanReason: 'explicit-rescan' }]
    ]);
  });

  assert.deepEqual(calls.slice(0, 7), [
    ['dispatch', { queryGeneration: 3, pageAttemptId: 5 }],
    ['open', { type: 'folder', key: 'folder-one', title: 'Music' }],
    ['dispatch', { queryGeneration: 3, pageAttemptId: 5 }],
    ['scan', { folderIds: ['folder-one'], scanReason: 'explicit-rescan' }],
    ['dispatch', { queryGeneration: 3, pageAttemptId: 5 }],
    ['status'],
    ['remove', 'folder-one']
  ]);
});

test('paged scan status offers cancellation while a scan is running', async () => {
  const documentRef = createDocument();
  const status = new FakeElement('footer');
  status.ownerDocument = documentRef;
  const calls = [];
  const view = Object.assign(Object.create(LibraryView.prototype), {
    status,
    content: null,
    pagedStatusVersion: 0,
    nowPlayingTrackId: null,
    manager: {
      async getCounts() {
        return { tracks: 12, albums: 3 };
      },
      cancelScan(scanId) {
        calls.push(scanId);
      }
    },
    syncContentScrollbarInset() {}
  });

  await withGlobals({ document: documentRef }, async () => {
    await view.renderPagedStatus({
      phase: 'scanning', scanId: 'scan-running', found: 8, parsed: 5
    });
    assert.match(status.innerHTML, /Scanning 5\/8/);
    assert.equal(status.children[0].textContent, 'Cancel');
    await status.children[0].click();
  });
  assert.deepEqual(calls, ['scan-running']);
});

test('paged status reports an active folder removal', async () => {
  const documentRef = createDocument();
  const status = new FakeElement('footer');
  status.ownerDocument = documentRef;
  let rejectCounts;
  const countsPromise = new Promise((_resolve, reject) => {
    rejectCounts = reject;
  });
  const view = Object.assign(Object.create(LibraryView.prototype), {
    status,
    content: null,
    pagedStatusVersion: 0,
    nowPlayingTrackId: null,
    pagedState: {
      totalCount: 10,
      selectionProjection: { hasAny: false, selectedCount: 0 }
    },
    pagedController: {
      getSelectionProjection() {
        return { hasAny: true, selectedCount: 2 };
      }
    },
    removingFolderIds: new Set(['folder-one']),
    folderRemovalProgress: new Map([[
      'folder-one', { deleted: 3, total: 10 }
    ]]),
    manager: {
      getCounts() {
        return countsPromise;
      }
    },
    syncContentScrollbarInset() {}
  });

  await withGlobals({ document: documentRef }, async () => {
    const rendering = view.renderPagedStatus({ phase: 'done' });
    assert.match(status.innerHTML, /2 selected/);
    assert.match(status.innerHTML, /Removing folder 3\/10/);
    rejectCounts(new Error('counts unavailable'));
    await rendering;
  });
  assert.match(status.innerHTML, /Removing folder 3\/10/);
  assert.equal(status.children.length, 0);
});

test('LibraryView marks the active desktop nav item as current', () => {
  const nav = new FakeElement('aside');
  const view = Object.assign(Object.create(LibraryView.prototype), {
    nav,
    currentView: 'albums',
    uiManager: { t: key => key }
  });

  view.updateNav({ tracks: 3, albums: 1, artists: 2, genres: 0, subfolders: 4 });

  assert.match(nav.innerHTML, /class="library-nav-item active" data-view="albums" aria-current="page"/);
  assert.doesNotMatch(nav.innerHTML, /data-view="tracks" aria-current="page"/);
  assert.match(nav.innerHTML, /data-view="subfolders"[^]*?<span class="library-count">4<\/span>/);
});

test('LibraryView keeps paged nav buttons mounted when a nav item is clicked', async () => {
  let resolveCounts;
  const countsPromise = new Promise(resolve => {
    resolveCounts = resolve;
  });
  const nav = createLibraryNavElement();
  const view = Object.assign(Object.create(LibraryView.prototype), {
    nav,
    currentView: 'tracks',
    manager: {
      getCounts() {
        return countsPromise;
      }
    },
    uiManager: { t: key => key },
    navigateToView(nextView) {
      this.currentView = nextView;
      this.renderPagedNav();
    }
  });

  view.renderPagedNav();
  const originalButtons = [...nav.children];
  const artistsButton = nav.children.find(button => button.dataset.view === 'artists');
  await artistsButton.click();

  assert.equal(nav.innerHTMLWrites, 1);
  assert.equal(nav.children.length, originalButtons.length);
  nav.children.forEach((button, index) => assert.equal(button, originalButtons[index]));
  assert.equal(artistsButton.classList.contains('active'), true);
  assert.equal(artistsButton.getAttribute('aria-current'), 'page');
  assert.equal(originalButtons[0].classList.contains('active'), false);
  assert.equal(originalButtons[0].getAttribute('aria-current'), null);

  resolveCounts({ tracks: 12, albums: 3, artists: 4, genres: 5, folders: 2 });
  await countsPromise;
  await Promise.resolve();

  assert.equal(nav.innerHTMLWrites, 1);
  assert.equal(artistsButton.querySelector('.library-count').textContent, '4');
  assert.equal(artistsButton.querySelector('.library-count').hidden, false);
});

test('LibraryView reveals a newly active mobile nav item once it is visible', async () => {
  const nav = createLibraryNavElement();
  const documentRef = createDocument();
  documentRef.body.classList.add('layout-mobile', 'view-library');
  const scrollCalls = [];
  const view = Object.assign(Object.create(LibraryView.prototype), {
    nav,
    currentView: 'tracks',
    isViewShown: false,
    lastRevealedMobileNavView: null,
    uiManager: { t: key => key }
  });

  await withGlobals({ document: documentRef }, async () => {
    view.updateNav();
    nav.children.forEach(button => {
      button.scrollIntoView = options => scrollCalls.push([button.dataset.view, options]);
    });

    view.currentView = 'subfolders';
    view.isViewShown = true;
    view.updateNav();
    view.updateNav();

    assert.deepEqual(scrollCalls, [[
      'subfolders',
      { block: 'nearest', inline: 'nearest' }
    ]]);

    view.currentView = 'genres';
    view.updateNav();
    assert.equal(scrollCalls.at(-1)[0], 'genres');

    documentRef.body.classList.remove('layout-mobile');
    view.currentView = 'artists';
    view.updateNav();
    assert.equal(scrollCalls.length, 2);

    documentRef.body.classList.add('layout-mobile');
    view.isViewShown = false;
    view.currentView = 'tracks';
    view.updateNav();
    assert.equal(scrollCalls.length, 2);
  });
});

test('LibraryView defers catalog redraws until scanning finishes', () => {
  const calls = [];
  const view = Object.assign(Object.create(LibraryView.prototype), {
    lastScanState: { phase: 'scanning' },
    deferredCatalogInvalidationScopes: null,
    pagedQueryKey: 'tracks-query',
    pagedRestartPreservesSelection: false,
    pagedController: {
      markSelectionStale() {
        calls.push('markSelectionStale');
      }
    },
    getPagedQuery() {
      return { endpoint: 'tracks' };
    },
    renderStatus() {
      calls.push('renderStatus');
    },
    refreshPagedFolderScanState() {},
    capturePagedAnchor() {
      calls.push('capturePagedAnchor');
    },
    scheduleRender() {
      calls.push('scheduleRender');
    },
    renderPagedNav() {
      calls.push('renderPagedNav');
    },
    renderPagedStatus() {
      calls.push('renderPagedStatus');
    }
  });

  view.handleCatalogInvalidation({ changedScopes: ['folders'] });
  view.handleCatalogInvalidation({ changedScopes: ['tracks'] });
  assert.deepEqual(calls, []);
  assert.deepEqual([...view.deferredCatalogInvalidationScopes], ['folders', 'tracks']);

  view.handleScanState({ phase: 'scanning', parsed: 1, found: 2 });
  assert.deepEqual(calls, ['renderStatus']);

  view.handleScanState({ phase: 'done', parsed: 2, found: 2 });
  assert.deepEqual(calls, [
    'renderStatus',
    'renderStatus',
    'capturePagedAnchor',
    'markSelectionStale',
    'scheduleRender'
  ]);
  assert.equal(view.deferredCatalogInvalidationScopes, null);
  assert.equal(view.pagedQueryKey, null);
  assert.equal(view.pagedRestartPreservesSelection, true);
});

test('LibraryView defers catalog redraws until folder removal finishes', () => {
  const calls = [];
  const view = Object.assign(Object.create(LibraryView.prototype), {
    lastScanState: { phase: 'done' },
    removingFolderIds: new Set(['folder-one']),
    deferredCatalogInvalidationScopes: null,
    pagedQueryKey: 'folders-query',
    pagedRestartPreservesSelection: false,
    pagedController: {
      markSelectionStale() {
        calls.push('markSelectionStale');
      }
    },
    getPagedQuery() {
      return { endpoint: 'entities', entityType: 'folder' };
    },
    capturePagedAnchor() {
      calls.push('capturePagedAnchor');
    },
    scheduleRender() {
      calls.push('scheduleRender');
    },
    renderPagedNav() {
      calls.push('renderPagedNav');
    },
    renderPagedStatus() {
      calls.push('renderPagedStatus');
    }
  });

  view.handleCatalogInvalidation({ changedScopes: ['folders', 'tracks'] });
  assert.deepEqual(calls, []);
  assert.deepEqual([...view.deferredCatalogInvalidationScopes], ['folders', 'tracks']);

  view.removingFolderIds.clear();
  view.flushDeferredCatalogInvalidation();
  assert.deepEqual(calls, [
    'capturePagedAnchor',
    'markSelectionStale',
    'scheduleRender'
  ]);
  assert.equal(view.deferredCatalogInvalidationScopes, null);
});

test('LibraryView handleAddFolder only navigates when a folder is actually added', async () => {
  const makeView = addFolder => {
    const calls = [];
    const view = Object.assign(Object.create(LibraryView.prototype), {
      manager: {
        addFolder
      },
      uiManager: {
        t: key => key,
        setError(message) {
          calls.push(['error', message]);
        }
      },
      navigateToView(name) {
        calls.push(['navigate', name]);
      }
    });
    return { view, calls };
  };

  // Picker canceled: addFolder resolves null, no navigation.
  const canceled = makeView(async () => null);
  await canceled.view.handleAddFolder();
  assert.deepEqual(canceled.calls, []);

  const rejected = makeView(async () => ({
    rejected: true,
    reason: 'descendant-root',
    candidate: { displayName: 'Album' },
    existing: { displayName: 'Music' }
  }));
  await rejected.view.handleAddFolder();
  assert.deepEqual(rejected.calls, [['error', 'Album is already included in Music.']]);

  // Successful add: navigate to the tracks view.
  const added = makeView(async () => ({ id: 'f_new' }));
  await added.view.handleAddFolder();
  assert.deepEqual(added.calls, [['navigate', 'tracks']]);
});

test('LibraryView track sort headers expose active direction and aria state', () => {
  const view = Object.assign(Object.create(LibraryView.prototype), {
    uiManager: {
      t(key, params = {}) {
        const labels = {
          'library.column.title': 'Title',
          'library.column.artist': 'Artist',
          'library.sort.sortBy': `Sort by ${params.column}`,
          'library.sort.sortedAscending': `${params.column} sorted ascending`,
          'library.sort.sortedDescending': `${params.column} sorted descending`
        };
        return labels[key] || key;
      }
    },
    sort: 'artist',
    sortDirection: 'desc'
  });

  const titleHeader = view.renderSortHeader({ key: 'title', labelKey: 'library.column.title' });
  const artistHeader = view.renderSortHeader({ key: 'artist', labelKey: 'library.column.artist' });

  assert.match(
    titleHeader,
    /class="library-sort-cell" role="columnheader" aria-sort="none"[\s\S]*data-sort="title" aria-label="Sort by Title"/
  );
  assert.match(
    artistHeader,
    /class="library-sort-cell active" role="columnheader" aria-sort="descending"[\s\S]*data-sort="artist" aria-label="Artist sorted descending"/
  );
  assert.match(artistHeader, /class="library-sort-button active"/);
  assert.match(artistHeader, /class="library-sort-indicator" aria-hidden="true"><svg/);
});

test('LibraryView preserves paged artwork cache within one query attempt', () => {
  const calls = [];
  const retainedLoader = {
    resetTargets() { calls.push('reset'); },
    destroy() { calls.push('destroy'); }
  };
  const replacementLoader = { resetTargets() {}, destroy() {} };
  const view = Object.assign(Object.create(LibraryView.prototype), {
    pagedArtworkLoader: retainedLoader,
    pagedArtworkLoaderAttemptKey: '3:7',
    createPagedArtworkLoader() {
      calls.push('create');
      return replacementLoader;
    }
  });

  view.preparePagedArtworkLoader({ queryGeneration: 3, pageAttemptId: 7 });
  assert.equal(view.pagedArtworkLoader, retainedLoader);
  assert.deepEqual(calls, ['reset']);

  view.preparePagedArtworkLoader({ queryGeneration: 4, pageAttemptId: 1 });
  assert.equal(view.pagedArtworkLoader, replacementLoader);
  assert.equal(view.pagedArtworkLoaderAttemptKey, '4:1');
  assert.deepEqual(calls, ['reset', 'destroy', 'create']);
});

test('LibraryView artist links navigate to the displayed performer artist key', async () => {
  const calls = [];
  const controls = new Map([
    ['.library-paged-select', new FakeElement('input')],
    ['.library-paged-row-more', new FakeElement('button')],
    ['.library-artist-link', new FakeElement('button')],
    ['.library-album-link', new FakeElement('button')]
  ]);
  const row = new FakeElement('div');
  row.querySelector = selector => controls.get(selector) || null;
  const documentRef = createDocument();
  documentRef.createElement = () => row;
  const view = Object.assign(Object.create(LibraryView.prototype), {
    pagedController: {
      isSelected() {
        return false;
      }
    },
    uiManager: { t: key => key },
    nowPlayingTrackId: null,
    pagedFocusedEntityId: 't_guest',
    pagedMobileSelectionActive: false,
    detail: null,
    navigateToDetail(detail) {
      calls.push(['navigateToDetail', detail]);
    }
  });

  await withGlobals({ document: documentRef }, async () => {
    view.createPagedRow({
      trackUid: 't_guest',
      title: 'Guest Song',
      artist: 'Guest',
      albumArtist: 'Various Artists',
      artistKey: 'various artists',
      artistDisplayKey: 'display-artist\u0000guest',
      album: 'Sampler',
      albumKey: 'sampler'
    }, 0, { queryGeneration: 1, pageAttemptId: 1, totalCount: 1 }, true);
    await controls.get('.library-artist-link').click();
  });

  assert.deepEqual(calls, [[
    'navigateToDetail',
    { type: 'artist', key: 'display-artist\u0000guest', title: 'Guest' }
  ]]);
});

test('LibraryView modal dialogs trap focus, restore focus, and label prompt input', async () => {
  const documentRef = createDialogDocument();
  const opener = new FakeElement('button');
  opener.ownerDocument = documentRef;
  opener.focus();
  const view = createLibraryViewFixture({
    manager: {
      getFolders() {
        return [{ id: 'f_music', path: 'D:/Music' }];
      }
    },
    uiManager: {
      t(key) {
        return {
          'library.properties.heading': 'Track Properties',
          'library.properties.title': 'Localized Title',
          'library.dialog.close': 'Close',
          'library.prompt.playlistName': 'Playlist name',
          'library.action.cancel': 'Cancel',
          'library.state.ok': 'OK'
        }[key] || key;
      }
    }
  });

  await withGlobals({ document: documentRef }, async () => {
    view.showTrackProperties({
      id: 't_song',
      folderId: 'f_music',
      relativePath: 'Album/Song.flac',
      fileName: 'Song.flac',
      title: 'Song'
    });
    const propertiesBackdrop = documentRef.body.children[0];
    assert.match(propertiesBackdrop.innerHTML, /aria-modal="true"/);
    assert.match(propertiesBackdrop.innerHTML, /Localized Title/);
    assert.equal(documentRef.activeElement, propertiesBackdrop.closeButton);
    const tabEvent = await propertiesBackdrop.dispatch('keydown', { key: 'Tab', shiftKey: true });
    assert.equal(tabEvent.prevented, 1);
    assert.equal(documentRef.activeElement, propertiesBackdrop.closeButton);
    const escapeEvent = documentRef.dispatch('keydown', { key: 'Escape' });
    assert.equal(escapeEvent.prevented, 1);
    assert.equal(documentRef.body.children.length, 0);
    assert.equal(documentRef.activeElement, opener);

    const promptResult = view.promptText('library.prompt.playlistName', 'Daily');
    const promptBackdrop = documentRef.body.children[0];
    assert.match(promptBackdrop.innerHTML, /<label for="library-prompt-\d+-input"/);
    assert.equal(documentRef.activeElement, promptBackdrop.input);
    assert.equal(promptBackdrop.input.selected, true);
    documentRef.activeElement = promptBackdrop.okButton;
    const promptTabEvent = await promptBackdrop.dispatch('keydown', { key: 'Tab' });
    assert.equal(promptTabEvent.prevented, 1);
    assert.equal(documentRef.activeElement, promptBackdrop.closeButton);
    await promptBackdrop.cancelButton.click();
    assert.equal(await promptResult, '');
    assert.equal(documentRef.body.children.length, 0);
    assert.equal(documentRef.activeElement, opener);
  });
});

test('paged track properties load complete metadata and the resolved Electron path', async () => {
  const documentRef = createDialogDocument();
  const calls = [];
  const view = createLibraryViewFixture({
    manager: {
      runtime: 'electron',
      async getTrack(trackUid) {
        calls.push(['getTrack', trackUid]);
        return {
          trackUid,
          fileName: 'Song.flac',
          title: 'Detailed Song',
          artist: 'Artist',
          album: 'Album',
          genre: 'Rock',
          year: 2026,
          trackNo: 2,
          trackTotal: 10,
          durationSec: 125,
          codec: 'FLAC',
          sampleRate: 96000,
          bitsPerSample: 24,
          bitrate: 1411200
        };
      },
      async resolvePlaybackSource(trackUid) {
        calls.push(['resolvePlaybackSource', trackUid]);
        return { kind: 'electron-file', path: 'D:\\Music\\Album\\Song.flac' };
      }
    },
    uiManager: { t: key => key }
  });

  await withGlobals({ document: documentRef }, async () => {
    await view.showTrackProperties({ trackUid: 'track-one', title: 'Summary Song' });

    const propertiesBackdrop = documentRef.body.children[0];
    assert.match(propertiesBackdrop.innerHTML, /Detailed Song/);
    assert.match(propertiesBackdrop.innerHTML, /D:\\Music\\Album\\Song\.flac/);
    assert.match(propertiesBackdrop.innerHTML, /96000 Hz/);
    assert.match(propertiesBackdrop.innerHTML, /24 bit/);
    assert.match(propertiesBackdrop.innerHTML, /1411 kbps/);
  });
  assert.deepEqual(calls, [
    ['getTrack', 'track-one'],
    ['resolvePlaybackSource', 'track-one']
  ]);
});

test('paged CUE track properties show provenance, physical source, and logical region', async () => {
  const documentRef = createDialogDocument();
  const view = createLibraryViewFixture({
    manager: {
      runtime: 'electron',
      async getTrack(trackUid) {
        return {
          trackUid,
          sourceKind: 'cue-track',
          entryKey: 'cue:Album/Disc.cue#03',
          cueRelativePath: 'Album/Disc.cue',
          relativePath: 'Album/Disc.flac',
          fileName: 'Disc.flac',
          title: 'Third Song',
          durationSec: 120,
          startFrame: 5625,
          endFrame: 14625
        };
      },
      async resolvePlaybackSource() {
        return {
          kind: 'electron-file',
          path: 'D:\\Music\\Album\\Disc.flac',
          startFrame: 5625,
          endFrame: 14625
        };
      },
      getFolders() {
        return [{ id: 'folder-1', path: 'D:\\Music' }];
      }
    },
    uiManager: { t: key => key }
  });

  await withGlobals({ document: documentRef }, async () => {
    await view.showTrackProperties({
      trackUid: 'cue-three',
      folderId: 'folder-1',
      title: 'Third Song'
    });
    const html = documentRef.body.children[0].innerHTML;
    assert.match(html, /CUE track/);
    assert.match(html, /D:\\Music\\Album\\Disc\.cue/);
    assert.match(html, /D:\\Music\\Album\\Disc\.flac/);
    assert.match(html, /1:15\.000/);
    assert.match(html, /3:15\.000/);
  });
});

test('paged properties context menu opens the track dialog and preserves its return focus', async () => {
  const documentRef = createDialogDocument();
  const opener = new FakeElement('button');
  opener.ownerDocument = documentRef;
  documentRef.body.appendChild(opener);
  const calls = [];
  const view = Object.assign(Object.create(LibraryView.prototype), {
    contextMenu: null,
    contextMenuCleanup: null,
    contextMenuReturnFocus: null,
    uiManager: { t: key => key },
    showTrackProperties(track, options) {
      calls.push([track.trackUid, options.returnFocus]);
    }
  });

  await withGlobals({
    document: documentRef,
    window: { innerWidth: 800, innerHeight: 600 }
  }, async () => {
    view.openPagedTrackContextMenu({
      preventDefault() {},
      clientX: 20,
      clientY: 30,
      currentTarget: opener,
      target: opener
    }, { trackUid: 'track-one' }, { returnFocus: opener });

    const menu = view.contextMenu;
    assert.equal(documentRef.activeElement, menu.querySelector('button:not(:disabled)'));
    await menu.querySelector('[data-action="properties"]').click();
    assert.equal(view.contextMenu, null);
  });
  assert.deepEqual(calls, [['track-one', opener]]);
});

test('LibraryView context menu can skip focus restoration for properties dialogs', async () => {
  const documentRef = createDialogDocument();
  const opener = new FakeElement('button');
  opener.ownerDocument = documentRef;
  documentRef.body.appendChild(opener);
  opener.focus();
  const menu = new FakeElement('div');
  menu.ownerDocument = documentRef;
  documentRef.body.appendChild(menu);
  const view = createLibraryViewFixture({
    contextMenu: menu,
    contextMenuCleanup: null,
    contextMenuReturnFocus: opener,
    manager: {
      getFolders() {
        return [];
      }
    },
    uiManager: {
      t(key) {
        return {
          'library.properties.heading': 'Track Properties',
          'library.properties.title': 'Localized Title',
          'library.dialog.close': 'Close'
        }[key] || key;
      }
    }
  });

  await withGlobals({ document: documentRef }, async () => {
    view.showTrackProperties({
      id: 't_song',
      title: 'Song',
      fileName: 'Song.flac'
    });
    const propertiesBackdrop = documentRef.body.children[2];
    assert.equal(documentRef.activeElement, propertiesBackdrop.closeButton);

    view.closeContextMenu({ restoreFocus: false });
    assert.equal(documentRef.body.children.includes(menu), false);
    assert.equal(documentRef.activeElement, propertiesBackdrop.closeButton);
  });
});

test('paged playlist detail exposes Duplicate through the bounded service', async () => {
  const documentRef = createDialogDocument();
  const calls = [];
  const manager = {
    async createContext() { return 'context'; },
    async queryTracks() { return { rows: [] }; },
    async queryEntities() { return { rows: [] }; },
    async releaseContext() {},
    async getCounts() { return {}; },
    async getTrack() { return null; },
    playlists: {
      async get(playlistId) {
        calls.push(['get', playlistId]);
        return { playlistId, version: 4 };
      },
      async duplicate(playlistId, name, options) {
        calls.push(['duplicate', playlistId, name, options.playlist.version]);
        return { playlistId: 'playlist-copy' };
      }
    }
  };
  await withGlobals({ document: documentRef }, async () => {
    const view = new LibraryView({ manager, uiManager: { t: key => key } });
    view.detail = { type: 'playlist', key: 'playlist-source', title: 'Source' };
    view.promptText = async () => 'Source copy';
    view.navigateToDetail = (...args) => calls.push(['navigate', ...args]);
    const controls = view.createPagedPlaylistControls();
    await controls.querySelector('.library-playlist-duplicate').click();
  });
  assert.deepEqual(calls, [
    ['get', 'playlist-source'],
    ['duplicate', 'playlist-source', 'Source copy', 4],
    ['navigate', { type: 'playlist', key: 'playlist-copy', title: 'Source copy' }, 'playlists']
  ]);
});

test('paged Electron playlist drop imports only through a main-owned opaque grant', async () => {
  const calls = [];
  const file = { name: 'daily.m3u8' };
  const source = {
    kind: 'electron-import-grant', token: 'grant-1', name: 'daily.m3u8',
    size: 12, lastModified: 1, type: ''
  };
  const view = Object.assign(Object.create(LibraryView.prototype), {
    manager: {
      playlists: {
        async previewImport(received) {
          calls.push(['preview', received]);
          return {
            previewToken: 'preview-1',
            playlistId: 'playlist-1',
            playlistName: 'Daily',
            totalCount: 1,
            resolvedCount: 1,
            unresolvedCount: 0,
            unresolvedItems: []
          };
        },
        async commitImport(preview) {
          calls.push(['commit', preview.previewToken]);
          return { playlistId: preview.playlistId, playlistName: preview.playlistName };
        },
        async cancelImportPreview(preview) {
          calls.push(['cancel', preview.previewToken]);
        }
      }
    },
    navigateToDetail(detail, viewName) {
      calls.push(['navigate', detail, viewName]);
    },
    uiManager: { setError(message) { calls.push(['error', message]); } }
  });

  await withGlobals({
    window: {
      electronAPI: {
        libraryCatalogV1: {
          async grantDroppedPlaylistImport(received) {
            calls.push(['grant', received]);
            return { canceled: false, source };
          }
        }
      }
    }
  }, async () => {
    await view.handlePlaylistFileDrop({
      dataTransfer: { files: [file] },
      preventDefault() { calls.push(['prevent']); }
    });
  });

  assert.deepEqual(calls, [
    ['prevent'],
    ['grant', file],
    ['preview', source],
    ['commit', 'preview-1'],
    ['navigate', { type: 'playlist', key: 'playlist-1', title: 'Daily' }, 'playlists']
  ]);
});

test('LibraryView browser playlist picker resolves null and cleans up on cancel', async () => {
  const input = new FakeElement('input');
  input.files = [];
  let clickCount = 0;
  input.click = () => {
    clickCount += 1;
  };
  const documentRef = createDocument();
  documentRef.createElement = tagName => tagName === 'input' ? input : new FakeElement(tagName);
  const windowRef = {
    addEventListener() {},
    removeEventListener() {}
  };
  const view = Object.assign(Object.create(LibraryView.prototype), {
    t: key => key
  });

  await withGlobals({
    document: documentRef,
    window: windowRef
  }, async () => {
    const picked = view.pickBrowserPlaylistFile();
    assert.equal(clickCount, 1);
    assert.equal(input.parentNode, documentRef.body);

    await input.dispatch('cancel');
    assert.equal(await picked, null);
    assert.equal(input.parentNode, null);
    assert.equal(input.listeners.get('change')?.length || 0, 0);
    assert.equal(input.listeners.get('cancel')?.length || 0, 0);
  });
});

test('LibraryView browser playlist picker resolves null after focus timeout fallback', async () => {
  const input = new FakeElement('input');
  input.files = [];
  input.click = () => {};
  const documentRef = createDocument();
  documentRef.createElement = tagName => tagName === 'input' ? input : new FakeElement(tagName);
  let focusListener = null;
  let timeoutCallback = null;
  let timeoutDelay = 0;
  const windowRef = {
    addEventListener(type, listener) {
      if (type === 'focus') focusListener = listener;
    },
    removeEventListener(type, listener) {
      if (type === 'focus' && focusListener === listener) focusListener = null;
    }
  };
  const view = Object.assign(Object.create(LibraryView.prototype), {
    t: key => key
  });

  await withGlobals({
    document: documentRef,
    window: windowRef,
    setTimeout(callback, delay) {
      timeoutCallback = callback;
      timeoutDelay = delay;
      return 7;
    },
    clearTimeout() {}
  }, async () => {
    const picked = view.pickBrowserPlaylistFile();
    assert.equal(input.parentNode, documentRef.body);
    assert.equal(typeof focusListener, 'function');

    focusListener();
    assert.equal(input.parentNode, documentRef.body);
    assert.equal(timeoutDelay, 1000);

    timeoutCallback();
    assert.equal(await picked, null);
    assert.equal(input.parentNode, null);
    assert.equal(focusListener, null);
  });
});

test('paged browser playlist picker reuses cancellation fallback and returns the File stream', async () => {
  let arrayBufferReads = 0;
  const file = {
    name: 'Daily.m3u8',
    async arrayBuffer() {
      arrayBufferReads += 1;
      return new ArrayBuffer(0);
    }
  };
  const input = new FakeElement('input');
  input.files = [file];
  input.click = () => {};
  const documentRef = createDocument();
  documentRef.createElement = tagName => tagName === 'input' ? input : new FakeElement(tagName);
  let focusListener = null;
  const windowRef = {
    addEventListener(type, listener) {
      if (type === 'focus') focusListener = listener;
    },
    removeEventListener(type, listener) {
      if (type === 'focus' && focusListener === listener) focusListener = null;
    }
  };
  const view = Object.assign(Object.create(LibraryView.prototype), {});

  await withGlobals({ document: documentRef, window: windowRef }, async () => {
    const picked = view.pickPagedPlaylistFile();
    await input.dispatch('change');

    assert.equal(await picked, file);
    assert.equal(arrayBufferReads, 0);
    assert.equal(input.parentNode, null);
    assert.equal(focusListener, null);
    assert.equal(input.listeners.get('change')?.length || 0, 0);
    assert.equal(input.listeners.get('cancel')?.length || 0, 0);
  });
});

test('paged playlist export passes the relative path checkbox state', async () => {
  const calls = [];
  const sink = { write() {}, commit() {}, abort() {} };
  const view = Object.assign(Object.create(LibraryView.prototype), {
    manager: {
      playlists: {
        async exportToSink(id, options) {
          calls.push(['exportToSink', id, options]);
        }
      }
    },
    content: {
      querySelector(selector) {
        return selector === '.library-playlist-export-relative' ? { checked: false } : null;
      }
    },
    uiManager: {
      setError(message, sticky) {
        calls.push(['setError', message, sticky]);
      }
    },
    t(key) {
      return key;
    },
    async createPagedPlaylistExportSink(options) {
      calls.push(['createSink', options]);
      return sink;
    }
  });

  await view.handleExportPlaylist({ id: 'p_daily', name: 'Daily' }, 'm3u8');

  assert.deepEqual(calls, [
    ['createSink', {
      fileName: 'Daily.m3u8',
      dialogTitle: 'library.action.exportM3U8',
      filters: [{ name: 'Playlists', extensions: ['m3u8'] }]
    }],
    ['exportToSink', 'p_daily', {
      format: 'm3u8',
      relative: false,
      sink
    }]
  ]);
});

test('paged playlist export reports skipped CUE tracks as a localized non-error notification', async () => {
  const calls = [];
  const live = { textContent: '' };
  const view = Object.assign(Object.create(LibraryView.prototype), {
    manager: {
      playlists: {
        async exportToSink() {
          return { exportedCount: 2, skippedCueCount: 3 };
        }
      }
    },
    content: {
      querySelector(selector) {
        return selector === '.library-paged-live' ? live : { checked: true };
      }
    },
    uiManager: {
      t(key, params) {
        return key === 'library.paged.exportSkippedCueTracks'
          ? `Skipped ${params.count} CUE tracks`
          : key;
      },
      setError(message, sticky) {
        calls.push([message, sticky]);
      }
    },
    async createPagedPlaylistExportSink() {
      return { write() {}, commit() {}, abort() {} };
    }
  });

  await view.handleExportPlaylist({ id: 'playlist-1', name: 'CUE mix' }, 'xspf');

  assert.deepEqual(calls, [['Skipped 3 CUE tracks', false]]);
  assert.equal(live.textContent, 'Skipped 3 CUE tracks');
});

test('paged Electron export sink retains the selected destination path', async () => {
  const calls = [];
  const view = Object.assign(Object.create(LibraryView.prototype), {});
  await withGlobals({
    window: {
      electronAPI: {
        async showSaveDialog() { return { filePath: 'D:/Playlists/Daily.m3u8' }; },
        async beginAtomicFileWrite(path) { calls.push(['begin', path]); return { success: true, token: 'write-1' }; },
        async writeAtomicFileChunk() { return { success: true }; },
        async commitAtomicFileWrite() { return { success: true }; },
        async abortAtomicFileWrite() { return { success: true }; }
      }
    }
  }, async () => {
    const sink = await view.createPagedPlaylistExportSink({
      fileName: 'Daily.m3u8', dialogTitle: 'Export', filters: [{ name: 'Playlists', extensions: ['m3u8'] }]
    });
    assert.equal(sink.destinationPath, 'D:/Playlists/Daily.m3u8');
  });
  assert.deepEqual(calls, [['begin', 'D:/Playlists/Daily.m3u8']]);
});

test('paged FSA export treats AbortError as a silent save-picker cancellation', async () => {
  const calls = [];
  const view = Object.assign(Object.create(LibraryView.prototype), {
    manager: {
      playlists: {
        async exportToSink() {
          calls.push('export');
        }
      }
    },
    uiManager: {
      setError() {
        calls.push('error');
      }
    },
    t: key => key
  });

  await withGlobals({
    window: {
      async showSaveFilePicker() {
        throw Object.assign(new Error('Canceled'), { name: 'AbortError' });
      }
    }
  }, async () => {
    await view.handleExportPlaylist({ playlistId: 'playlist-1', name: 'Daily' }, 'm3u8');
  });

  assert.deepEqual(calls, []);
});

test('paged non-FSA export uses a bounded Blob sink and returns a typed overflow', async () => {
  const documentRef = createDocument();
  const urls = [];
  const view = Object.assign(Object.create(LibraryView.prototype), {});
  await withGlobals({
    document: documentRef,
    window: {},
    URL: {
      createObjectURL(blob) {
        urls.push(['create', blob.size, blob.type]);
        return 'blob:playlist';
      },
      revokeObjectURL(url) {
        urls.push(['revoke', url]);
      }
    }
  }, async () => {
    const sink = await view.createPagedPlaylistExportSink({
      fileName: 'Daily.m3u8', dialogTitle: 'Export', filters: [{ name: 'Playlists', extensions: ['m3u8'] }]
    });
    await sink.write('#EXTM3U\n');
    await sink.commit();
    assert.deepEqual(urls, [
      ['create', 8, 'audio/x-mpegurl;charset=utf-8'],
      ['revoke', 'blob:playlist']
    ]);

    const overflowing = await view.createPagedPlaylistExportSink({
      fileName: 'Large.xspf', dialogTitle: 'Export', filters: [{ name: 'Playlists', extensions: ['xspf'] }]
    });
    await overflowing.write(new Uint8Array(WEB_PLAYLIST_BLOB_EXPORT_MAX_BYTES));
    await assert.rejects(
      overflowing.write(new Uint8Array(1)),
      error => error.code === 'playlistExportTooLarge' &&
        error.limitBytes === WEB_PLAYLIST_BLOB_EXPORT_MAX_BYTES
    );
    await overflowing.abort();
  });
});

test('PlaybackManager keeps extended library queue entries in insertAt order', async () => {
  const playlistUpdates = [];
  const audioPlayer = {
    stateManager: {
      getStateSnapshot() {
        return { shuffleMode: false };
      },
      updatePlaylist(playlist, index) {
        playlistUpdates.push([playlist.map(track => track.libraryTrackId), index]);
      },
      updateState() {
      }
    },
    contextManager: {
      clearNextTrackBuffer() {}
    }
  };

  await withGlobals({
    document: createDocument(),
    File: class FakeFile {}
  }, async () => {
    const manager = new PlaybackManager(audioPlayer);
    manager.loadFiles([
      {
        libraryTrackId: 'track-one',
        path: 'C:/Music/one.flac',
        provider: { kind: 'library' },
        meta: { title: 'One' }
      },
      {
        libraryTrackId: 'track-two',
        path: 'C:/Music/two.flac',
        provider: { kind: 'library' },
        meta: { title: 'Two' }
      }
    ]);
    manager.loadFiles([
      {
        libraryTrackId: 'track-inserted',
        path: 'C:/Music/inserted.flac',
        provider: { kind: 'library' },
        meta: { title: 'Inserted' }
      }
    ], true, 1);

    assert.deepEqual(manager.playlist.map(track => track.libraryTrackId), [
      'track-one',
      'track-inserted',
      'track-two'
    ]);
    assert.deepEqual(manager.originalPlaylist.map(track => track.libraryTrackId), [
      'track-one',
      'track-inserted',
      'track-two'
    ]);
    assert.deepEqual(manager.playlist[1].provider, { kind: 'library' });
    assert.deepEqual(manager.playlist[1].meta, { title: 'Inserted' });
    manager.dispose();
  });

  assert.deepEqual(playlistUpdates.at(-1), [
    ['track-one', 'track-inserted', 'track-two'],
    0
  ]);
});

test('PlaybackManager preserves the current index when appending library queue entries', async () => {
  let state = { shuffleMode: false, currentTrackIndex: 2 };
  const playlistUpdates = [];
  const audioPlayer = {
    stateManager: {
      getStateSnapshot() {
        return { ...state };
      },
      updatePlaylist(playlist, index) {
        playlistUpdates.push([playlist.map(track => track.libraryTrackId || track.name), index]);
        state.currentTrackIndex = index;
      },
      updateState(update) {
        state = { ...state, ...update };
      }
    },
    contextManager: {
      clearNextTrackBuffer() {}
    }
  };

  await withGlobals({
    document: createDocument(),
    File: class FakeFile {}
  }, async () => {
    const manager = new PlaybackManager(audioPlayer);
    manager.loadFiles(['one.wav', 'two.wav', 'three.wav']);
    state.currentTrackIndex = 2;
    manager.loadFiles([{ libraryTrackId: 'tail', meta: { title: 'Tail' } }], true);
    assert.equal(playlistUpdates.at(-1)[1], 2);

    state.currentTrackIndex = 2;
    manager.loadFiles([{ libraryTrackId: 'before', meta: { title: 'Before' } }], true, 1);
    assert.equal(playlistUpdates.at(-1)[1], 3);
    manager.dispose();
  });
});
