import assert from 'node:assert/strict';
import test from 'node:test';

import { UIManager } from '../../js/ui-manager.js';
import { PlaybackManager } from '../../js/ui/audio-player/playback-manager.js';
import { LibraryView } from '../../js/ui/library/library-view.js';
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

test('updateUITexts localizes the view switch button titles and aria labels', async () => {
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
    mount() {
      return root;
    },
    syncNowPlayingTrack() {},
    render() {}
  });

  await withGlobals({ document: documentRef }, async () => {
    view.show({ focusSearch: false, returnFocus: opener });
    assert.equal(documentRef.body.classList.contains('view-library'), true);
    assert.equal(documentRef.activeElement, opener);

    searchInput.focus();
    view.hide();
    assert.equal(documentRef.body.classList.contains('view-library'), false);
    assert.equal(documentRef.activeElement, opener);

    view.show({ returnFocus: opener });
    assert.equal(documentRef.activeElement, searchInput);
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

test('LibraryView syncs the status inset to the content scrollbar width', () => {
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

test('LibraryView keyboard shortcuts focus search and route focused tracks', async () => {
  const calls = [];
  const body = new FakeElement('body');
  body.classList.add('view-library');
  const documentRef = createDocument();
  documentRef.body = body;
  documentRef.activeElement = null;
  const storage = new Map();
  const searchInput = new FakeElement('input');
  searchInput.value = 'query';
  searchInput.focus = () => calls.push(['search.focus']);
  searchInput.select = () => calls.push(['search.select']);
  const content = new FakeElement('div');
  content.getBoundingClientRect = () => ({ left: 10, top: 20 });
  content.querySelector = () => null;
  const status = new FakeElement('footer');
  const tracks = new Map([
    ['t_one', { id: 't_one', title: 'Alpha' }],
    ['t_two', { id: 't_two', title: 'Beta' }],
    ['t_three', { id: 't_three', title: 'Bravo' }]
  ]);
  const view = Object.assign(Object.create(LibraryView.prototype), {
    manager: {
      getTrackById(id) {
        return tracks.get(id) || null;
      },
      playTrackIds(ids, options) {
        calls.push(['play', ids, options]);
      },
      addToQueue(ids) {
        calls.push(['queue', ids]);
      },
      playNext(ids) {
        calls.push(['next', ids]);
      },
      getCounts() {
        return { tracks: 3, albums: 1 };
      }
    },
    uiManager: { t: key => key },
    content,
    status,
    searchInput,
    searchQuery: '',
    selectedTrackIds: new Set(),
    currentVisibleTrackIds: ['t_one', 't_two', 't_three'],
    focusedTrackId: 't_one',
    contextMenu: null,
    playlistMenu: null,
    typeJumpBuffer: '',
    typeJumpTimer: null,
    renderStatus() {},
    render() {
      calls.push(['render']);
    },
    scrollTrackIntoView(trackId) {
      calls.push(['scroll', trackId]);
    }
  });

  await withGlobals({
    document: documentRef,
    localStorage: {
      getItem(key) {
        return storage.get(key) || null;
      },
      setItem(key, value) {
        storage.set(key, value);
      }
    }
  }, async () => {
    view.sort = 'artist';
    view.sortDirection = 'asc';
    view.saveUIState();
    view.sort = 'title';
    view.sortDirection = 'desc';
    view.loadUIState();
    assert.equal(view.sort, 'artist');
    assert.equal(view.sortDirection, 'asc');

    const focusEvent = documentRef.dispatch('keydown', { key: '/', target: body });
    view.handleGlobalLibraryKeyDown(focusEvent);
    assert.equal(focusEvent.prevented, 1);
    assert.ok(calls.some(call => call[0] === 'search.focus'));

    view.handleContentKeyDown({
      key: 'ArrowDown',
      prevented: 0,
      preventDefault() {
        this.prevented++;
      },
      target: content
    });
    assert.equal(view.focusedTrackId, 't_two');

    view.handleContentKeyDown({
      key: 'Enter',
      prevented: 0,
      preventDefault() {
        this.prevented++;
      },
      target: content
    });
    assert.ok(calls.some(call => call[0] === 'play' && call[2].startIndex === 1));

    view.handleContentKeyDown({
      key: 'Enter',
      ctrlKey: true,
      prevented: 0,
      preventDefault() {
        this.prevented++;
      },
      target: content
    });
    assert.ok(calls.some(call => call[0] === 'queue' && call[1][0] === 't_two'));

    // Enter on an interactive element (button, link, ...) must not hijack activation.
    const playCallsBefore = calls.filter(call => call[0] === 'play').length;
    const buttonEvent = {
      key: 'Enter',
      prevented: 0,
      preventDefault() {
        this.prevented++;
      },
      target: { closest: () => ({}) }
    };
    view.handleContentKeyDown(buttonEvent);
    assert.equal(buttonEvent.prevented, 0);
    assert.equal(calls.filter(call => call[0] === 'play').length, playCallsBefore);

    view.handleContentKeyDown({
      key: 'B',
      prevented: 0,
      preventDefault() {
        this.prevented++;
      },
      target: content
    });
    assert.equal(view.focusedTrackId, 't_three');
    clearTimeout(view.typeJumpTimer);
    view.typeJumpBuffer = '';
    view.typeJumpTimer = null;

    view.searchQuery = 'query';
    view.handleContentKeyDown({
      key: 'Escape',
      prevented: 0,
      preventDefault() {
        this.prevented++;
      },
      target: content
    });
    assert.equal(view.searchQuery, '');
    assert.equal(searchInput.value, '');
  });
});

test('LibraryView type-jump consumes printable keys and ignores space', async () => {
  const calls = [];
  const documentRef = createDocument();
  const content = new FakeElement('div');
  content.ownerDocument = documentRef;
  const tracks = new Map([
    ['t_alpha', { id: 't_alpha', title: 'Alpha' }],
    ['t_nirvana', { id: 't_nirvana', title: 'Nirvana' }]
  ]);
  const view = Object.assign(Object.create(LibraryView.prototype), {
    manager: {
      getTrackById(id) {
        return tracks.get(id) || null;
      }
    },
    content,
    currentVisibleTrackIds: ['t_alpha', 't_nirvana'],
    focusedTrackId: 't_alpha',
    typeJumpBuffer: '',
    typeJumpTimer: null,
    scrollTrackIntoView(trackId) {
      calls.push(['scroll', trackId]);
    }
  });

  await withGlobals({ document: documentRef }, async () => {
    const event = {
      key: 'n',
      target: content,
      prevented: 0,
      stopped: 0,
      preventDefault() {
        this.prevented++;
      },
      stopPropagation() {
        this.stopped++;
      }
    };
    view.handleContentKeyDown(event);

    assert.equal(event.prevented, 1);
    assert.equal(event.stopped, 1);
    assert.equal(view.focusedTrackId, 't_nirvana');
    assert.deepEqual(calls, [['scroll', 't_nirvana']]);

    clearTimeout(view.typeJumpTimer);
    view.typeJumpBuffer = '';
    view.typeJumpTimer = null;

    const spaceEvent = {
      key: ' ',
      target: content,
      prevented: 0,
      stopped: 0,
      preventDefault() {
        this.prevented++;
      },
      stopPropagation() {
        this.stopped++;
      }
    };
    view.handleContentKeyDown(spaceEvent);

    assert.equal(spaceEvent.prevented, 0);
    assert.equal(spaceEvent.stopped, 0);
    assert.equal(view.typeJumpBuffer, '');
  });

  clearTimeout(view.typeJumpTimer);
  view.typeJumpBuffer = '';
  view.typeJumpTimer = null;
});

test('LibraryView marks the active desktop nav item as current', () => {
  const nav = new FakeElement('aside');
  const view = Object.assign(Object.create(LibraryView.prototype), {
    nav,
    currentView: 'albums',
    manager: {
      getCounts() {
        return { tracks: 3, albums: 1, artists: 2, genres: 0 };
      },
      getFolders() {
        return [];
      }
    },
    uiManager: { t: key => key }
  });

  view.renderNav();

  assert.match(nav.innerHTML, /class="library-nav-item active" data-view="albums" aria-current="page"/);
  assert.doesNotMatch(nav.innerHTML, /data-view="tracks" aria-current="page"/);
});

test('LibraryView handleAddFolder only navigates when a folder is actually added', async () => {
  const makeView = addFolder => {
    const calls = [];
    const listeners = new Map();
    const view = Object.assign(Object.create(LibraryView.prototype), {
      manager: {
        addListener(event, callback) {
          listeners.set(event, callback);
          return () => listeners.delete(event);
        },
        addFolder: () => addFolder(listeners)
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
    return { view, calls, listeners };
  };

  // Picker canceled: addFolder resolves null, no navigation.
  const canceled = makeView(async () => null);
  await canceled.view.handleAddFolder();
  assert.deepEqual(canceled.calls, []);
  assert.equal(canceled.listeners.size, 0);

  // Rejected folder (same/descendant root): no navigation even though a folder is returned.
  const rejected = makeView(async listeners => {
    listeners.get('folder-add-rejected')?.({ reason: 'same-root', folder: { displayName: 'Music' }, existing: { displayName: 'Music' } });
    return { id: 'f_existing' };
  });
  await rejected.view.handleAddFolder();
  assert.deepEqual(rejected.calls, []);

  // Successful add: navigate to the tracks view.
  const added = makeView(async () => ({ id: 'f_new' }));
  await added.view.handleAddFolder();
  assert.deepEqual(added.calls, [['navigate', 'tracks']]);
});

test('LibraryView surfaces folder-add-rejected reasons through the UI manager', () => {
  const errors = [];
  const view = Object.assign(Object.create(LibraryView.prototype), {
    uiManager: {
      t: key => key,
      setError(message) {
        errors.push(message);
      }
    }
  });
  view.handleFolderAddRejected({
    reason: 'descendant-root',
    folder: { displayName: 'Albums' },
    existing: { displayName: 'Music' }
  });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('Albums'));
  assert.ok(errors[0].includes('Music'));
  view.handleFolderAddRejected({
    reason: 'same-root',
    folder: { displayName: 'Music' }
  });
  assert.equal(errors.length, 2);
  assert.ok(errors[1].includes('Music'));
});

test('LibraryView search results follow the current track sort', () => {
  const calls = [];
  const appended = [];
  const sortedTracks = [
    { id: 't_beta', title: 'Beta' },
    { id: 't_alpha', title: 'Alpha' }
  ];
  const view = Object.assign(Object.create(LibraryView.prototype), {
    manager: {
      search(query) {
        calls.push(['search', query]);
        return {
          trackIds: ['t_alpha', 't_beta'],
          tracks: [...sortedTracks].reverse(),
          albums: [],
          artists: []
        };
      },
      getTracks(options) {
        calls.push(['getTracks', options]);
        return sortedTracks;
      }
    },
    uiManager: { t: key => key },
    content: {
      innerHTML: '',
      appendChild(node) {
        appended.push(node);
      }
    },
    searchQuery: 'song',
    sort: 'title',
    sortDirection: 'desc',
    createActionBar(trackIds) {
      calls.push(['actionBar', trackIds]);
      return { type: 'actionBar', trackIds };
    },
    createTrackTable(tracks) {
      calls.push(['trackTable', tracks.map(track => track.id)]);
      return { type: 'trackTable', tracks };
    }
  });

  view.renderSearch();

  assert.deepEqual(calls, [
    ['search', 'song'],
    ['getTracks', { ids: ['t_alpha', 't_beta'], sort: 'title', direction: 'desc' }],
    ['actionBar', ['t_beta', 't_alpha']],
    ['trackTable', ['t_beta', 't_alpha']]
  ]);
  assert.equal(appended.length, 2);
});

test('LibraryView album detail keeps track order while recent lists apply the current sort', () => {
  const calls = [];
  const sortedTracks = [
    { id: 't_beta', title: 'Beta' },
    { id: 't_alpha', title: 'Alpha' }
  ];
  const makeView = extra => Object.assign(Object.create(LibraryView.prototype), {
    root: new FakeElement('section'),
    nav: new FakeElement('nav'),
    content: new FakeElement('div'),
    status: new FakeElement('footer'),
    searchQuery: '',
    sort: 'title',
    sortDirection: 'desc',
    detailSortOverride: false,
    selectedTrackIds: new Set(),
    currentVisibleTrackIds: [],
    manager: {
      getCounts() {
        return { tracks: 2, albums: 1, artists: 1, genres: 1 };
      },
      getFolders() {
        return [];
      },
      getAlbums() {
        return [{ key: 'album-one', name: 'Album One', artist: 'Artist', trackIds: ['t_alpha', 't_beta'] }];
      },
      getAlbumTracks(key) {
        calls.push(['getAlbumTracks', key]);
        return [...sortedTracks].reverse();
      },
      getRecentlyAdded(limit) {
        calls.push(['getRecentlyAdded', limit]);
        return [...sortedTracks].reverse();
      },
      getTracks(options) {
        calls.push(['getTracks', options]);
        return sortedTracks;
      }
    },
    uiManager: { t: key => key },
    closePlaylistMenu() {},
    closeContextMenu() {},
    syncNowPlayingTrack() {},
    renderNav() {},
    renderStatus() {},
    renderArtwork() {},
    createActionBar(trackIds) {
      calls.push(['actionBar', trackIds]);
      return new FakeElement('div');
    },
    createTrackTable(tracks) {
      calls.push(['trackTable', tracks.map(track => track.id)]);
      return new FakeElement('div');
    },
    ...extra
  });

  makeView({ detail: { type: 'album', key: 'album-one' } }).renderAlbumDetail('album-one');
  makeView({ currentView: 'recent', detail: null }).render();

  assert.deepEqual(calls, [
    ['getAlbumTracks', 'album-one'],
    ['actionBar', ['t_alpha', 't_beta']],
    ['trackTable', ['t_alpha', 't_beta']],
    ['getRecentlyAdded', 500],
    ['getTracks', { ids: ['t_alpha', 't_beta'], sort: 'title', direction: 'desc' }],
    ['actionBar', ['t_beta', 't_alpha']],
    ['trackTable', ['t_beta', 't_alpha']]
  ]);
});

test('LibraryView album detail applies the current sort only after a header click override', () => {
  const calls = [];
  const sortedTracks = [
    { id: 't_beta', title: 'Beta' },
    { id: 't_alpha', title: 'Alpha' }
  ];
  const makeView = extra => Object.assign(Object.create(LibraryView.prototype), {
    root: new FakeElement('section'),
    nav: new FakeElement('nav'),
    content: new FakeElement('div'),
    status: new FakeElement('footer'),
    searchQuery: '',
    sort: 'title',
    sortDirection: 'desc',
    selectedTrackIds: new Set(),
    currentVisibleTrackIds: [],
    manager: {
      getCounts() {
        return { tracks: 2, albums: 1, artists: 1, genres: 1 };
      },
      getFolders() {
        return [];
      },
      getAlbums() {
        return [{ key: 'album-one', name: 'Album One', artist: 'Artist', trackIds: ['t_alpha', 't_beta'] }];
      },
      getAlbumTracks(key) {
        calls.push(['getAlbumTracks', key]);
        return [...sortedTracks].reverse();
      },
      getTracks(options) {
        calls.push(['getTracks', options]);
        return sortedTracks;
      }
    },
    uiManager: { t: key => key },
    closePlaylistMenu() {},
    closeContextMenu() {},
    syncNowPlayingTrack() {},
    renderNav() {},
    renderStatus() {},
    renderArtwork() {},
    createActionBar(trackIds) {
      calls.push(['actionBar', trackIds]);
      return new FakeElement('div');
    },
    createTrackTable(tracks) {
      calls.push(['trackTable', tracks.map(track => track.id)]);
      return new FakeElement('div');
    },
    ...extra
  });

  makeView({ detail: { type: 'album', key: 'album-one' }, detailSortOverride: false }).renderAlbumDetail('album-one');
  assert.deepEqual(calls, [
    ['getAlbumTracks', 'album-one'],
    ['actionBar', ['t_alpha', 't_beta']],
    ['trackTable', ['t_alpha', 't_beta']]
  ]);

  calls.length = 0;
  makeView({ detail: { type: 'album', key: 'album-one' }, detailSortOverride: true }).renderAlbumDetail('album-one');
  assert.deepEqual(calls, [
    ['getAlbumTracks', 'album-one'],
    ['getTracks', { ids: ['t_alpha', 't_beta'], sort: 'title', direction: 'desc' }],
    ['actionBar', ['t_beta', 't_alpha']],
    ['trackTable', ['t_beta', 't_alpha']]
  ]);
});

test('LibraryView track sort headers expose active direction and aria state', async () => {
  const documentRef = createDocument();
  const content = new FakeElement('div');
  const view = Object.assign(Object.create(LibraryView.prototype), {
    content,
    manager: {
      playTrackIds() {}
    },
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
    selectedTrackIds: new Set(),
    nowPlayingTrackId: null,
    focusedTrackId: null,
    currentVisibleTrackIds: [],
    sort: 'artist',
    sortDirection: 'desc',
    trackScrollCleanup: null
  });

  await withGlobals({ document: documentRef }, async () => {
    const table = view.createTrackTable([{ id: 't_one', title: 'One' }]);
    const header = table.children[0];

    assert.equal(table.attributes.get('aria-colcount'), '7');
    assert.equal(table.attributes.get('aria-rowcount'), '2');
    assert.equal(header.attributes.get('role'), 'row');
    assert.equal(header.attributes.get('aria-rowindex'), '1');
    assert.match(
      header.innerHTML,
      /class="library-track-control-header" role="columnheader" aria-label="Play"/
    );
    assert.match(
      header.innerHTML,
      /class="library-sort-cell" role="columnheader" aria-sort="none"[\s\S]*data-sort="title" aria-label="Sort by Title"/
    );
    assert.match(
      header.innerHTML,
      /class="library-sort-cell active" role="columnheader" aria-sort="descending"[\s\S]*data-sort="artist" aria-label="Artist sorted descending"/
    );
    assert.match(header.innerHTML, /class="library-sort-button active"/);
    assert.match(header.innerHTML, /class="library-sort-indicator" aria-hidden="true"><svg/);
  });
});

test('LibraryView track rows expose gridcells and fallback labels for unknown metadata', async () => {
  const documentRef = createDocument();
  const view = Object.assign(Object.create(LibraryView.prototype), {
    manager: {
      playTrackIds() {}
    },
    uiManager: {
      t(key) {
        return {
          'library.action.play': 'Play',
          'library.action.more': 'More',
          'library.unknownArtist': 'Localized Unknown Artist',
          'library.unknownAlbum': 'Localized Unknown Album'
        }[key] || key;
      }
    },
    selectedTrackIds: new Set(),
    nowPlayingTrackId: null,
    focusedTrackId: null,
    refreshRenderedFocus() {}
  });

  await withGlobals({ document: documentRef }, async () => {
    const row = view.createTrackRow({ id: 't_unknown', title: 'Untitled' }, 0, ['t_unknown'], 40);

    assert.equal(row.attributes.get('role'), 'row');
    assert.equal(row.attributes.get('aria-rowindex'), '2');
    assert.match(row.innerHTML, /class="library-gridcell library-track-play-cell" role="gridcell"/);
    assert.match(row.innerHTML, /class="library-gridcell library-track-title" role="gridcell"/);
    assert.match(row.innerHTML, /class="library-gridcell library-artist-cell" role="gridcell">Localized Unknown Artist<\/span>/);
    assert.match(row.innerHTML, /class="library-gridcell library-album-cell" role="gridcell">Localized Unknown Album<\/span>/);
    assert.doesNotMatch(row.innerHTML, /class="library-link library-artist-link"/);
    assert.doesNotMatch(row.innerHTML, /class="library-link library-album-link"/);
  });
});

test('LibraryView album cards use sibling open and play buttons and play in album order', async () => {
  const calls = [];
  const documentRef = createDocument();
  const content = new FakeElement('div');
  const view = Object.assign(Object.create(LibraryView.prototype), {
    content,
    manager: {
      getAlbums() {
        return [{
          key: 'album-one',
          name: 'Album One',
          artist: 'Artist',
          year: 2026,
          trackIds: ['t_two', 't_one']
        }];
      },
      getAlbumTracks(key) {
        calls.push(['getAlbumTracks', key]);
        return [{ id: 't_one' }, { id: 't_two' }];
      },
      playTrackIds(ids) {
        calls.push(['playTrackIds', ids]);
      }
    },
    uiManager: { t: key => key },
    navigateToDetail(detail, viewName) {
      calls.push(['navigateToDetail', detail, viewName]);
    },
    renderArtwork() {}
  });

  await withGlobals({ document: documentRef }, async () => {
    view.renderAlbums();
    const grid = content.children[0];
    const card = grid.children[0];
    const buttons = card.children.filter(child => child.tagName === 'BUTTON');

    assert.equal(card.tagName, 'DIV');
    assert.deepEqual(buttons.map(button => button.className), ['library-album-open', 'library-card-play']);
    assert.ok(buttons.every(button => button.parentNode === card));

    await buttons[0].click();
    await buttons[1].click();
  });

  assert.deepEqual(calls, [
    ['navigateToDetail', { type: 'album', key: 'album-one' }, 'albums'],
    ['getAlbumTracks', 'album-one'],
    ['playTrackIds', ['t_one', 't_two']]
  ]);
});

test('LibraryView artist links navigate to the displayed performer artist key', async () => {
  const calls = [];
  const controls = new Map([
    ['.library-row-play', new FakeElement('button')],
    ['.library-row-more', new FakeElement('button')],
    ['.library-artist-link', new FakeElement('button')],
    ['.library-album-link', new FakeElement('button')]
  ]);
  const row = new FakeElement('div');
  row.querySelector = selector => controls.get(selector) || null;
  const documentRef = createDocument();
  documentRef.createElement = () => row;
  const view = Object.assign(Object.create(LibraryView.prototype), {
    manager: {
      playTrackIds() {}
    },
    uiManager: { t: key => key },
    selectedTrackIds: new Set(),
    nowPlayingTrackId: null,
    focusedTrackId: 't_guest',
    navigateToDetail(detail, viewName) {
      calls.push(['navigateToDetail', detail, viewName]);
    },
    refreshRenderedFocus() {}
  });

  await withGlobals({ document: documentRef }, async () => {
    view.createTrackRow({
      id: 't_guest',
      title: 'Guest Song',
      artist: 'Guest',
      albumArtist: 'Various Artists',
      artistKey: 'various artists',
      artistDisplayKey: 'display-artist\u0000guest',
      album: 'Sampler',
      albumKey: 'sampler'
    }, 0, ['t_guest'], 40);
    await controls.get('.library-artist-link').click();
  });

  assert.deepEqual(calls, [[
    'navigateToDetail',
    { type: 'artist', key: 'display-artist\u0000guest', title: 'Guest' },
    'artists'
  ]]);
});

test('LibraryView track grid advertises multi-select support', async () => {
  const documentRef = createDocument();
  const content = new FakeElement('div');
  content.ownerDocument = documentRef;
  const view = Object.assign(Object.create(LibraryView.prototype), {
    content,
    trackScrollCleanup: null,
    selectedTrackIds: new Set(['t_song']),
    nowPlayingTrackId: null,
    focusedTrackId: null,
    manager: {
      playTrackIds() {}
    },
    uiManager: { t: key => key },
    refreshRenderedFocus() {}
  });

  await withGlobals({ document: documentRef }, async () => {
    const table = view.createTrackTable([{
      id: 't_song',
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      durationSec: 64
    }]);

    assert.equal(table.attributes.get('role'), 'grid');
    assert.equal(table.attributes.get('aria-multiselectable'), 'true');
  });
});

test('LibraryView modal dialogs trap focus, restore focus, and label prompt input', async () => {
  const documentRef = createDialogDocument();
  const opener = new FakeElement('button');
  opener.ownerDocument = documentRef;
  opener.focus();
  const view = Object.assign(Object.create(LibraryView.prototype), {
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

test('LibraryView context menu can skip focus restoration for properties dialogs', async () => {
  const documentRef = createDialogDocument();
  const opener = new FakeElement('button');
  opener.ownerDocument = documentRef;
  documentRef.body.appendChild(opener);
  opener.focus();
  const menu = new FakeElement('div');
  menu.ownerDocument = documentRef;
  documentRef.body.appendChild(menu);
  const view = Object.assign(Object.create(LibraryView.prototype), {
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

test('LibraryView context menu properties restores focus to the menu opener after close', async () => {
  const documentRef = createDialogDocument();
  const opener = new FakeElement('button');
  opener.ownerDocument = documentRef;
  documentRef.body.appendChild(opener);
  opener.focus();
  const view = Object.assign(Object.create(LibraryView.prototype), {
    contextMenu: null,
    contextMenuCleanup: null,
    contextMenuReturnFocus: null,
    selectedTrackIds: new Set(['t_song']),
    manager: {
      getFolders() {
        return [];
      }
    },
    uiManager: { t: key => key }
  });

  await withGlobals({
    document: documentRef,
    window: { innerWidth: 800, innerHeight: 600 }
  }, async () => {
    view.openContextMenu({
      preventDefault() {},
      clientX: 20,
      clientY: 30,
      currentTarget: opener,
      target: opener
    }, { id: 't_song', title: 'Song', fileName: 'Song.flac' }, ['t_song'], 0, { returnFocus: opener });
    const menu = view.contextMenu;
    assert.equal(documentRef.activeElement, menu.querySelector('button:not(:disabled)'));

    await menu.querySelector('[data-action="properties"]').click();
    assert.equal(documentRef.body.children.includes(menu), false);
    const propertiesBackdrop = documentRef.body.children.find(child => child.className === 'library-dialog-backdrop');
    assert.equal(documentRef.activeElement, propertiesBackdrop.closeButton);

    await propertiesBackdrop.closeButton.click();
    assert.equal(documentRef.activeElement, opener);
  });
});

test('LibraryView context menu Add to Playlist focuses picker and restores opener on close', async () => {
  const documentRef = createDialogDocument();
  const opener = new FakeElement('button');
  opener.ownerDocument = documentRef;
  const content = new FakeElement('div');
  content.ownerDocument = documentRef;
  documentRef.body.appendChild(opener);
  opener.focus();
  const calls = [];
  const view = Object.assign(Object.create(LibraryView.prototype), {
    content,
    playlistMenu: null,
    playlistMenuReturnFocus: null,
    contextMenu: null,
    contextMenuCleanup: null,
    contextMenuReturnFocus: null,
    selectedTrackIds: new Set(['t_song']),
    manager: {
      playlists: {
        async list() {
          return [{ id: 'p_daily', name: 'Daily', items: [] }];
        },
        async addTracks(playlistId, trackIds) {
          calls.push(['addTracks', playlistId, trackIds]);
        }
      }
    },
    uiManager: { t: key => key }
  });

  await withGlobals({
    document: documentRef,
    window: { innerWidth: 800, innerHeight: 600 }
  }, async () => {
    view.openContextMenu({
      preventDefault() {},
      clientX: 20,
      clientY: 30,
      currentTarget: opener,
      target: opener
    }, { id: 't_song', title: 'Song', fileName: 'Song.flac' }, ['t_song'], 0, { returnFocus: opener });
    const menu = view.contextMenu;

    await menu.querySelector('[data-action="playlist"]').click();

    assert.equal(documentRef.body.children.includes(menu), false);
    assert.ok(view.playlistMenu);
    assert.equal(documentRef.activeElement, view.playlistMenu.querySelector('button:not(:disabled)'));
    assert.notEqual(documentRef.activeElement, opener);

    await view.playlistMenu.querySelectorAll('[data-playlist-id]')[0].click();

    assert.deepEqual(calls, [['addTracks', 'p_daily', ['t_song']]]);
    assert.equal(view.playlistMenu, null);
    assert.equal(documentRef.activeElement, opener);
  });
});

test('LibraryView add-to-playlist restores focus when playlist changes trigger render', async () => {
  const documentRef = createDialogDocument();
  const opener = new FakeElement('button');
  opener.ownerDocument = documentRef;
  const content = new FakeElement('div');
  content.ownerDocument = documentRef;
  documentRef.body.appendChild(opener);
  opener.focus();
  const calls = [];
  const view = Object.assign(Object.create(LibraryView.prototype), {
    content,
    root: new FakeElement('section'),
    renderVersion: 4,
    currentView: 'tracks',
    detail: null,
    searchQuery: '',
    playlistMenu: null,
    playlistMenuReturnFocus: null,
    manager: {
      playlists: {
        async list() {
          return [{ id: 'p_daily', name: 'Daily', items: [] }];
        },
        async addTracks(playlistId, trackIds) {
          calls.push(['addTracks', playlistId, trackIds]);
          view.render();
        }
      }
    },
    render() {
      calls.push(['render']);
      this.closePlaylistMenu({ restoreFocus: false });
    },
    uiManager: { t: key => key }
  });
  view.root.ownerDocument = documentRef;

  await withGlobals({
    document: documentRef,
    window: { innerWidth: 800, innerHeight: 600 }
  }, async () => {
    await view.openAddToPlaylistMenu(opener, ['t_song'], { returnFocus: opener });
    const playlistButton = view.playlistMenu.querySelectorAll('[data-playlist-id]')[0];
    assert.equal(documentRef.activeElement, view.playlistMenu.querySelector('button:not(:disabled)'));

    await playlistButton.click();

    assert.deepEqual(calls, [
      ['addTracks', 'p_daily', ['t_song']],
      ['render']
    ]);
    assert.equal(view.playlistMenu, null);
    assert.equal(documentRef.activeElement, opener);
  });
});

test('LibraryView add-to-playlist picker handles menu keys without reaching track navigation', async () => {
  const documentRef = createDialogDocument();
  const opener = new FakeElement('button');
  opener.ownerDocument = documentRef;
  const content = new FakeElement('div');
  content.ownerDocument = documentRef;
  const view = Object.assign(Object.create(LibraryView.prototype), {
    content,
    root: new FakeElement('section'),
    renderVersion: 3,
    currentView: 'tracks',
    detail: null,
    searchQuery: '',
    playlistMenu: null,
    playlistMenuReturnFocus: null,
    manager: {
      playlists: {
        async list() {
          return [
            { id: 'p_daily', name: 'Daily', items: [] },
            { id: 'p_late', name: 'Late', items: [] }
          ];
        }
      }
    },
    uiManager: {
      t(key) {
        return {
          'library.action.addToPlaylist': 'Add to Playlist',
          'library.action.newPlaylist': 'New Playlist'
        }[key] || key;
      }
    }
  });

  await withGlobals({
    document: documentRef,
    window: { innerWidth: 800, innerHeight: 600 }
  }, async () => {
    await view.openAddToPlaylistMenu(opener, ['t_song'], { returnFocus: opener });
    const menu = view.playlistMenu;
    const items = menu.querySelectorAll('button:not(:disabled)');
    assert.equal(menu.attributes.get('role'), 'menu');
    assert.equal(menu.attributes.get('aria-label'), 'Add to Playlist');
    assert.match(menu.innerHTML, /role="menuitem"/);
    assert.equal(documentRef.activeElement, items[0]);

    const downEvent = await menu.dispatch('keydown', { key: 'ArrowDown' });
    assert.equal(downEvent.prevented, 1);
    assert.equal(downEvent.stopped, 1);
    assert.equal(documentRef.activeElement, items[1]);

    const endEvent = await menu.dispatch('keydown', { key: 'End' });
    assert.equal(endEvent.prevented, 1);
    assert.equal(endEvent.stopped, 1);
    assert.equal(documentRef.activeElement, items.at(-1));

    const homeEvent = await menu.dispatch('keydown', { key: 'Home' });
    assert.equal(homeEvent.prevented, 1);
    assert.equal(homeEvent.stopped, 1);
    assert.equal(documentRef.activeElement, items[0]);

    const escapeEvent = await menu.dispatch('keydown', { key: 'Escape' });
    assert.equal(escapeEvent.prevented, 1);
    assert.equal(escapeEvent.stopped, 1);
    assert.equal(view.playlistMenu, null);
    assert.equal(documentRef.activeElement, opener);
  });
});

test('LibraryView add-to-playlist picker ignores stale async results after navigation', async () => {
  const documentRef = createDialogDocument();
  const opener = new FakeElement('button');
  opener.ownerDocument = documentRef;
  const content = new FakeElement('div');
  content.ownerDocument = documentRef;
  let resolvePlaylists;
  const view = Object.assign(Object.create(LibraryView.prototype), {
    content,
    root: new FakeElement('section'),
    renderVersion: 7,
    currentView: 'tracks',
    detail: null,
    searchQuery: '',
    playlistMenu: null,
    playlistMenuReturnFocus: null,
    manager: {
      playlists: {
        list() {
          return new Promise(resolve => {
            resolvePlaylists = resolve;
          });
        }
      }
    },
    uiManager: { t: key => key }
  });

  await withGlobals({
    document: documentRef,
    window: { innerWidth: 800, innerHeight: 600 }
  }, async () => {
    const pending = view.openAddToPlaylistMenu(opener, ['t_song'], { returnFocus: opener });
    view.renderVersion += 1;
    view.currentView = 'albums';
    resolvePlaylists([{ id: 'p_daily', name: 'Daily', items: [] }]);
    await pending;

    assert.equal(view.playlistMenu, null);
    assert.equal(content.children.length, 0);
    assert.equal(documentRef.activeElement, null);
  });
});

test('LibraryView Shift+F10 properties restores focus to the focused row after close', async () => {
  const documentRef = createDialogDocument();
  const row = new FakeElement('div');
  row.ownerDocument = documentRef;
  row.dataset.trackId = 't_song';
  const content = new FakeElement('div');
  content.ownerDocument = documentRef;
  content.getBoundingClientRect = () => ({ left: 10, top: 20 });
  content.querySelector = selector => selector.includes('t_song') ? row : null;
  const view = Object.assign(Object.create(LibraryView.prototype), {
    content,
    contextMenu: null,
    contextMenuCleanup: null,
    contextMenuReturnFocus: null,
    selectedTrackIds: new Set(['t_song']),
    currentVisibleTrackIds: ['t_song'],
    focusedTrackId: 't_song',
    manager: {
      getTrackById(id) {
        return id === 't_song' ? { id: 't_song', title: 'Song', fileName: 'Song.flac' } : null;
      },
      getFolders() {
        return [];
      }
    },
    uiManager: { t: key => key }
  });

  await withGlobals({
    document: documentRef,
    window: { innerWidth: 800, innerHeight: 600 }
  }, async () => {
    const keyEvent = {
      key: 'F10',
      shiftKey: true,
      target: content,
      prevented: 0,
      preventDefault() {
        this.prevented++;
      }
    };
    view.handleContentKeyDown(keyEvent);
    assert.equal(keyEvent.prevented, 1);

    const menu = view.contextMenu;
    await menu.querySelector('[data-action="properties"]').click();
    const propertiesBackdrop = documentRef.body.children.find(child => child.className === 'library-dialog-backdrop');
    assert.equal(documentRef.activeElement, propertiesBackdrop.closeButton);

    await propertiesBackdrop.closeButton.click();
    assert.equal(documentRef.activeElement, row);
  });
});

test('LibraryView keyboard context menu targets the focused visible row', async () => {
  const calls = [];
  const documentRef = createDialogDocument();
  const rows = new Map(['t_one', 't_two', 't_three'].map(trackId => {
    const row = new FakeElement('div');
    row.ownerDocument = documentRef;
    row.dataset.trackId = trackId;
    return [trackId, row];
  }));
  const content = new FakeElement('div');
  content.ownerDocument = documentRef;
  content.getBoundingClientRect = () => ({ left: 10, top: 20 });
  content.querySelector = selector => {
    for (const [trackId, row] of rows) {
      if (selector.includes(trackId)) return row;
    }
    return null;
  };
  content.querySelectorAll = selector => selector === '.library-track-row' ? [...rows.values()] : [];
  const tracks = new Map([
    ['t_one', { id: 't_one', title: 'One' }],
    ['t_two', { id: 't_two', title: 'Two' }],
    ['t_three', { id: 't_three', title: 'Three' }]
  ]);
  const view = Object.assign(Object.create(LibraryView.prototype), {
    root: new FakeElement('section'),
    content,
    contextMenu: null,
    contextMenuCleanup: null,
    contextMenuReturnFocus: null,
    playlistMenu: null,
    selectedTrackIds: new Set(['t_one', 't_three']),
    currentVisibleTrackIds: ['t_one', 't_two', 't_three'],
    focusedTrackId: 't_two',
    manager: {
      getTrackById(id) {
        return tracks.get(id) || null;
      },
      addToQueue(ids) {
        calls.push(['queue', ids]);
      }
    },
    renderStatus() {},
    uiManager: { t: key => key }
  });

  await withGlobals({
    document: documentRef,
    window: { innerWidth: 800, innerHeight: 600 }
  }, async () => {
    view.handleContentKeyDown({
      key: 'ContextMenu',
      target: content,
      prevented: 0,
      preventDefault() {
        this.prevented++;
      }
    });

    assert.deepEqual([...view.selectedTrackIds], ['t_two']);
    await view.contextMenu.querySelector('[data-action="queue"]').click();

    view.selectedTrackIds = new Set(['t_one', 't_two']);
    view.focusedTrackId = 't_two';
    view.handleContentKeyDown({
      key: 'F10',
      shiftKey: true,
      target: content,
      prevented: 0,
      preventDefault() {
        this.prevented++;
      }
    });
    await view.contextMenu.querySelector('[data-action="queue"]').click();
  });

  assert.deepEqual(calls, [
    ['queue', ['t_two']],
    ['queue', ['t_one', 't_two']]
  ]);
});

test('LibraryView mobile navigation history and selection mode update state', async () => {
  const calls = [];
  const body = new FakeElement('body');
  body.classList.add('layout-mobile');
  body.classList.add('view-library');
  const documentRef = createDocument();
  documentRef.body = body;
  const root = new FakeElement('section');
  const searchInput = new FakeElement('input');
  const view = Object.assign(Object.create(LibraryView.prototype), {
    root,
    content: new FakeElement('div'),
    status: new FakeElement('footer'),
    searchInput,
    currentView: 'tracks',
    detail: null,
    searchQuery: '',
    focusedTrackId: 't_one',
    selectedTrackIds: new Set(),
    mobileSelectionMode: false,
    mobileHistoryInitialized: false,
    mobileHistoryDepth: 0,
    renderStatus() {},
    refreshRenderedSelection() {
      calls.push(['refreshSelection', [...this.selectedTrackIds]]);
    },
    render() {
      calls.push(['render', this.currentView, this.detail?.type || null]);
    }
  });
  const historyRef = {
    state: null,
    replaceState(state) {
      calls.push(['replaceState', state.snapshot.currentView]);
      this.state = state;
    },
    pushState(state) {
      calls.push(['pushState', state.snapshot.currentView, state.snapshot.detail?.type || null]);
      this.state = state;
    },
    back() {
      calls.push(['history.back']);
    }
  };

  await withGlobals({ document: documentRef, history: historyRef }, async () => {
    view.navigateToDetail({ type: 'album', key: 'album-one' }, 'albums');
    assert.equal(view.currentView, 'albums');
    assert.equal(view.detail.type, 'album');
    assert.equal(view.mobileHistoryDepth, 1);
    assert.ok(calls.some(call => call[0] === 'pushState'));

    view.handleMobilePopState({
      state: {
        effetuneLibrary: true,
        snapshot: {
          currentView: 'tracks',
          detail: null,
          searchQuery: '',
          focusedTrackId: 't_one'
        }
      }
    });
    assert.equal(view.currentView, 'tracks');
    assert.equal(view.detail, null);

    view.startMobileSelection('t_one');
    assert.equal(view.mobileSelectionMode, true);
    assert.deepEqual([...view.selectedTrackIds], ['t_one']);
    view.toggleMobileTrackSelection('t_one');
    assert.equal(view.mobileSelectionMode, false);
    assert.deepEqual([...view.selectedTrackIds], []);
  });
});

test('LibraryView mobile long press selection ignores the synthetic follow-up click', async () => {
  const calls = [];
  const body = new FakeElement('body');
  body.classList.add('layout-mobile');
  const documentRef = createDocument();
  documentRef.body = body;
  let row = null;
  let longPressCallback = null;
  const view = Object.assign(Object.create(LibraryView.prototype), {
    manager: {
      playTrackIds(ids, options) {
        calls.push(['playTrackIds', ids, options]);
      }
    },
    uiManager: { t: key => key },
    root: new FakeElement('section'),
    content: {
      querySelectorAll(selector) {
        return selector === '.library-track-row' && row ? [row] : [];
      }
    },
    selectedTrackIds: new Set(),
    lastSelectedTrackId: null,
    nowPlayingTrackId: null,
    focusedTrackId: null,
    mobileSelectionMode: false,
    renderStatus() {
      calls.push(['renderStatus', [...this.selectedTrackIds]]);
    }
  });

  await withGlobals({
    document: documentRef,
    setTimeout(callback, delay) {
      calls.push(['setTimeout', delay]);
      longPressCallback = callback;
      return 1;
    },
    clearTimeout() {}
  }, async () => {
    row = view.createTrackRow({ id: 't_one', title: 'One' }, 0, ['t_one'], 56);
    const touchEvent = await row.dispatch('touchstart', {
      touches: [{ clientX: 12, clientY: 12 }]
    });
    longPressCallback();

    assert.equal(touchEvent.prevented, 1);
    assert.equal(view.mobileSelectionMode, true);
    assert.deepEqual([...view.selectedTrackIds], ['t_one']);

    const clickEvent = await row.dispatch('click', {
      stopPropagation() {
        calls.push(['click.stopPropagation']);
      }
    });

    assert.equal(clickEvent.prevented, 1);
    assert.deepEqual([...view.selectedTrackIds], ['t_one']);
    assert.equal(calls.some(call => call[0] === 'playTrackIds'), false);
    assert.ok(calls.some(call => call[0] === 'click.stopPropagation'));
  });
});

test('LibraryView playlist actions shuffle, duplicate, reorder, and retry unresolved items', async () => {
  const calls = [];
  const playlist = {
    id: 'p_daily',
    name: 'Daily',
    items: [
      { trackId: 't_one' },
      { trackId: 't_two' },
      { unresolved: { sourceLine: 'Missing.flac' } }
    ]
  };
  const rows = [
    { classList: new FakeClassList(), getBoundingClientRect: () => ({ top: 0, height: 20 }) },
    { classList: new FakeClassList(), getBoundingClientRect: () => ({ top: 0, height: 20 }) },
    { classList: new FakeClassList(), getBoundingClientRect: () => ({ top: 0, height: 20 }) }
  ];
  const view = Object.assign(Object.create(LibraryView.prototype), {
    manager: {
      getTrackById(id) {
        return id === 't_one' || id === 't_two' ? { id } : null;
      },
      playTrackIds(ids, options) {
        calls.push(['playTrackIds', ids, options]);
      },
      playlists: {
        async duplicate(id, name) {
          calls.push(['duplicate', id, name]);
          return { id: 'p_copy', name };
        },
        async replaceItems(id, items) {
          calls.push(['replaceItems', id, items.map(item => item.trackId || item.unresolved.sourceLine)]);
          return { id, items };
        }
      },
      async resolvePlaylistItem(id, index) {
        calls.push(['resolvePlaylistItem', id, index]);
        return index === 2 ? { status: 'resolved', trackId: 't_three' } : { status: 'unresolved' };
      }
    },
    uiManager: {
      t(key, params = {}) {
        if (key === 'library.playlist.copyName') return `Copy of ${params.name}`;
        if (key === 'library.state.noMatchingTrack') return 'No match';
        return key;
      },
      setError(message, sticky) {
        calls.push(['setError', message, sticky]);
      }
    },
    content: {
      querySelectorAll() {
        return rows;
      }
    },
    render() {
      calls.push(['render']);
    },
    navigateToDetail(detail, viewName) {
      calls.push(['navigateToDetail', detail, viewName]);
    }
  });

  view.playPlaylistItems(playlist.items, { shuffle: true });
  await view.handleDuplicatePlaylist(playlist);
  await view.movePlaylistItemToIndex(playlist, 0, 3);
  await view.handlePlaylistItemDrop({
    currentTarget: rows[1],
    clientY: 18,
    dataTransfer: {
      types: ['application/x-effetune-playlist-item-index'],
      dropEffect: '',
      getData() {
        return '0';
      }
    },
    preventDefault() {
      calls.push(['drop.preventDefault']);
    },
    stopPropagation() {
      calls.push(['drop.stopPropagation']);
    }
  }, playlist, 1);
  await view.handleLocatePlaylistItem(playlist, 2);
  await view.handleLocatePlaylistItem(playlist, 1);

  assert.deepEqual(calls.filter(call => call[0] === 'playTrackIds'), [
    ['playTrackIds', ['t_one', 't_two'], { shuffle: true }]
  ]);
  assert.ok(calls.some(call => call[0] === 'duplicate' && call[2] === 'Copy of Daily'));
  assert.ok(calls.some(call => call[0] === 'navigateToDetail' && call[1].key === 'p_copy'));
  assert.ok(calls.some(call => call[0] === 'replaceItems' && call[2].join(',') === 't_two,Missing.flac,t_one'));
  assert.ok(calls.some(call => call[0] === 'drop.preventDefault'));
  assert.ok(calls.some(call => call[0] === 'drop.stopPropagation'));
  assert.ok(calls.some(call => call[0] === 'resolvePlaylistItem' && call[2] === 2));
  assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'No match'));
});

test('LibraryView playlist file drag and drop import only playlist files', async () => {
  const calls = [];
  const playlistFile = {
    name: 'daily.m3u8',
    async arrayBuffer() {
      calls.push(['arrayBuffer']);
      return new TextEncoder().encode('#EXTM3U\nsong.flac\n').buffer;
    }
  };
  const view = Object.assign(Object.create(LibraryView.prototype), {
    manager: {
      previewPlaylistImport(request) {
        calls.push(['preview', request.fileName, request.playlistPath, request.content.byteLength]);
        return { playlistName: 'daily', resolvedCount: 1, unresolvedCount: 0, totalCount: 1 };
      },
      async commitPlaylistImport(preview) {
        calls.push(['commit', preview.playlistName]);
        return { playlist: { id: 'p_daily' } };
      }
    },
    uiManager: {
      setError(message, sticky) {
        calls.push(['setError', message, sticky]);
      }
    },
    confirmPlaylistImport(preview) {
      calls.push(['confirm', preview.playlistName]);
      return true;
    },
    navigateToDetail(detail, viewName) {
      calls.push(['navigateToDetail', detail, viewName]);
    }
  });
  const playlistDrag = {
    dataTransfer: { files: [playlistFile], dropEffect: '' },
    prevented: 0,
    preventDefault() {
      this.prevented++;
    }
  };
  const audioDrag = {
    dataTransfer: { files: [{ name: 'song.wav' }], dropEffect: '' },
    prevented: 0,
    preventDefault() {
      this.prevented++;
    }
  };

  view.handlePlaylistFileDragOver(playlistDrag);
  view.handlePlaylistFileDragOver(audioDrag);
  await view.handlePlaylistFileDrop({
    dataTransfer: { files: [playlistFile] },
    prevented: 0,
    preventDefault() {
      this.prevented++;
      calls.push(['drop.preventDefault']);
    }
  });

  assert.equal(playlistDrag.prevented, 1);
  assert.equal(playlistDrag.dataTransfer.dropEffect, 'copy');
  assert.equal(audioDrag.prevented, 0);
  assert.deepEqual(calls, [
    ['drop.preventDefault'],
    ['arrayBuffer'],
    ['preview', 'daily.m3u8', 'daily.m3u8', 18],
    ['confirm', 'daily'],
    ['commit', 'daily'],
    ['navigateToDetail', { type: 'playlist', key: 'p_daily' }, 'playlists']
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
    const picked = view.pickPlaylistFile();
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
    const picked = view.pickPlaylistFile();
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

test('LibraryView playlist export passes the relative path checkbox state', async () => {
  const calls = [];
  const view = Object.assign(Object.create(LibraryView.prototype), {
    manager: {
      async exportPlaylist(id, options) {
        calls.push(['exportPlaylist', id, options]);
        return '#EXTM3U\n';
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
    }
  });

  await withGlobals({
    window: {
      electronAPI: {
        async showSaveDialog(options) {
          calls.push(['showSaveDialog', options.defaultPath]);
          return { filePath: 'D:/Playlists/Daily.m3u8' };
        },
        async saveFile(filePath, text) {
          calls.push(['saveFile', filePath, text]);
          return { success: true };
        }
      }
    }
  }, async () => {
    await view.handleExportPlaylist({ id: 'p_daily', name: 'Daily' }, 'm3u8');
  });

  assert.deepEqual(calls, [
    ['showSaveDialog', 'Daily.m3u8'],
    ['exportPlaylist', 'p_daily', {
      format: 'm3u8',
      targetPath: 'D:/Playlists/Daily.m3u8',
      preferRelative: false
    }],
    ['saveFile', 'D:/Playlists/Daily.m3u8', '#EXTM3U\n']
  ]);
});

test('LibraryView export dialogs use format-specific titles and extension filters', async () => {
  const dialogs = [];
  const saves = [];
  const view = Object.assign(Object.create(LibraryView.prototype), {
    manager: {
      async exportPlaylist(_id, options) {
        return options.format === 'xspf' ? '<?xml version="1.0"?>\n' : '#EXTM3U\n';
      }
    },
    content: {
      querySelector(selector) {
        return selector === '.library-playlist-export-relative' ? { checked: true } : null;
      }
    },
    uiManager: {
      setError(message, sticky) {
        saves.push(['setError', message, sticky]);
      }
    },
    t(key) {
      return key;
    }
  });

  await withGlobals({
    window: {
      electronAPI: {
        async showSaveDialog(options) {
          dialogs.push(options);
          return { filePath: `D:/Playlists/${options.defaultPath}` };
        },
        async saveFile(filePath, text) {
          saves.push([filePath, text]);
          return { success: true };
        }
      }
    }
  }, async () => {
    await view.handleExportPlaylist({ id: 'p1', name: 'Daily' }, 'xspf');
    await view.handleExportPlaylist({ id: 'p1', name: 'Daily' }, 'm3u8');
  });

  assert.equal(dialogs[0].title, 'library.action.exportXSPF');
  assert.equal(dialogs[0].defaultPath, 'Daily.xspf');
  assert.deepEqual(dialogs[0].filters, [{ name: 'Playlists', extensions: ['xspf'] }]);
  assert.equal(dialogs[1].title, 'library.action.exportM3U8');
  assert.equal(dialogs[1].defaultPath, 'Daily.m3u8');
  assert.deepEqual(dialogs[1].filters, [{ name: 'Playlists', extensions: ['m3u8'] }]);
  assert.deepEqual(saves, [
    ['D:/Playlists/Daily.xspf', '<?xml version="1.0"?>\n'],
    ['D:/Playlists/Daily.m3u8', '#EXTM3U\n']
  ]);
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
