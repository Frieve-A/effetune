import assert from 'node:assert/strict';
import test from 'node:test';

import { MobileNav } from '../../js/ui/mobile-nav.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.eventListeners = new Map();
    this.style = {};
    this.dataset = {};
    this.hidden = false;
    this.id = '';
    this.className = '';
    this.innerHTML = '';
    this.textContent = '';
    this.type = '';
    this.title = '';
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.classes.has(name) : !!force;
        if (enabled) this.classes.add(name);
        else this.classes.delete(name);
        return enabled;
      }
    };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    child.parentNode = this;
    const index = this.children.indexOf(reference);
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  prepend(child) {
    child.parentNode = this;
    this.children.unshift(child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index !== -1) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, []);
    this.eventListeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    this.eventListeners.set(type, (this.eventListeners.get(type) || []).filter(candidate => candidate !== listener));
  }

  setAttribute(name, value) {
    if (!this.attributes) this.attributes = new Map();
    this.attributes.set(name, String(value));
    this[name] = value;
  }

  removeAttribute(name) {
    this.attributes?.delete(name);
    delete this[name];
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

function createBottomNav() {
  const nav = new FakeElement('nav');
  const entries = ['player', 'library', 'effects'].map(view => {
    const button = new FakeElement('button');
    const label = new FakeElement('span');
    button.dataset.view = view;
    button.querySelector = selector => selector === '.mobile-bottom-button-label' ? label : null;
    return { button, label };
  });
  nav.querySelectorAll = selector => selector === 'button[data-view]' ? entries.map(entry => entry.button) : [];
  return { nav, entries };
}

function createDocument() {
  const listeners = new Map();
  const body = new FakeElement('body');
  const mainContainer = new FakeElement('div');
  mainContainer.className = 'main-container';
  const pluginList = new FakeElement('div');
  pluginList.id = 'pluginList';
  body.appendChild(mainContainer);

  return {
    body,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    querySelector(selector) {
      if (selector === '.main-container') return mainContainer;
      return null;
    },
    getElementById(id) {
      if (id === 'pluginList') return pluginList;
      return null;
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter(candidate => candidate !== listener));
    }
  };
}

test('MobileNav updates the resume prompt on AudioContext statechange', async () => {
  const documentRef = createDocument();
  const audioContextListeners = new Map();
  const audioContext = {
    state: 'suspended',
    addEventListener(type, listener) {
      audioContextListeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (audioContextListeners.get(type) === listener) {
        audioContextListeners.delete(type);
      }
    }
  };
  const layoutMode = {
    mode: 'mobile',
    isMobile: true,
    onChange() {
      return () => {};
    }
  };

  await withGlobals({
    document: documentRef,
    window: { location: { search: '' } }
  }, async () => {
    const nav = new MobileNav({
      layoutMode,
      audioManager: { audioContext },
      audioPlayer: null
    });

    assert.equal(nav.resumePrompt.hidden, false);
    assert.equal(typeof audioContextListeners.get('statechange'), 'function');

    audioContext.state = 'running';
    audioContextListeners.get('statechange')();
    assert.equal(nav.resumePrompt.hidden, true);

    nav.dispose();
    assert.equal(audioContextListeners.size, 0);
  });
});

test('MobileNav restores the previous tab when library initialization fails', async () => {
  const documentRef = createDocument();
  documentRef.body.classList.add('view-player');
  const calls = [];
  let rejectLibrary;
  const libraryInit = new Promise((_, reject) => {
    rejectLibrary = reject;
  });
  const nav = Object.assign(Object.create(MobileNav.prototype), {
    nav: null,
    uiManager: {
      showLibraryView(options) {
        calls.push(['showLibraryView', options]);
        return libraryInit;
      }
    },
    closePluginList() {},
    updateAudioResumePrompt() {}
  });

  await withGlobals({
    document: documentRef,
    window: { location: { search: '' } }
  }, async () => {
    const pending = nav.setView('library');
    assert.equal(documentRef.body.classList.contains('view-player'), true);
    assert.equal(documentRef.body.classList.contains('view-library'), false);
    assert.equal(calls[0][1].focusSearch, false);

    rejectLibrary(new Error('library failed'));
    await pending;

    assert.equal(documentRef.body.classList.contains('view-player'), true);
    assert.equal(documentRef.body.classList.contains('view-library'), false);
  });
});

test('MobileNav ignores a stale library open after another tab is selected', async () => {
  const documentRef = createDocument();
  documentRef.body.classList.add('view-player');
  const calls = [];
  let resolveLibrary;
  const libraryInit = new Promise(resolve => {
    resolveLibrary = resolve;
  });
  const nav = Object.assign(Object.create(MobileNav.prototype), {
    nav: null,
    uiManager: {
      async showLibraryView(options) {
        calls.push(['showLibraryView', options]);
        await libraryInit;
        if (options.isCurrentRequest?.() === false) return false;
        document.body.classList.add('view-library');
        return true;
      },
      hideLibraryView(options) {
        calls.push(['hideLibraryView', options]);
      }
    },
    closePluginList() {},
    updateAudioResumePrompt() {}
  });

  await withGlobals({
    document: documentRef,
    window: { location: { search: '' } }
  }, async () => {
    const pending = nav.setView('library');
    assert.equal(typeof calls[0][1].isCurrentRequest, 'function');

    nav.setView('effects');
    assert.equal(documentRef.body.classList.contains('view-effects'), true);
    assert.equal(documentRef.body.classList.contains('view-library'), false);

    resolveLibrary();
    await pending;

    assert.equal(documentRef.body.classList.contains('view-effects'), true);
    assert.equal(documentRef.body.classList.contains('view-library'), false);
  });

  assert.equal(calls[1][0], 'hideLibraryView');
});

test('MobileNav passes focus targets when opening and leaving the library tab', async () => {
  const documentRef = createDocument();
  const calls = [];
  const libraryButton = new FakeElement('button');
  const effectsButton = new FakeElement('button');
  const nav = Object.assign(Object.create(MobileNav.prototype), {
    nav: null,
    uiManager: {
      async showLibraryView(options) {
        calls.push(['showLibraryView', options]);
      },
      hideLibraryView(options) {
        calls.push(['hideLibraryView', options]);
      }
    },
    closePluginList() {},
    updateAudioResumePrompt() {}
  });

  await withGlobals({
    document: documentRef,
    window: { location: { search: '' } }
  }, async () => {
    await nav.setView('library', { returnFocus: libraryButton });
    nav.setView('effects', { returnFocus: effectsButton });
  });

  assert.equal(calls[0][0], 'showLibraryView');
  assert.equal(calls[0][1].focusSearch, false);
  assert.equal(calls[0][1].returnFocus, libraryButton);
  assert.equal(typeof calls[0][1].isCurrentRequest, 'function');
  assert.deepEqual(calls.slice(1), [
    ['hideLibraryView', { returnFocus: effectsButton }]
  ]);
});

test('MobileNav marks the active bottom tab as current', async () => {
  const documentRef = createDocument();
  const { nav: bottomNav, entries } = createBottomNav();
  const nav = Object.assign(Object.create(MobileNav.prototype), {
    nav: bottomNav,
    uiManager: {},
    closePluginList() {},
    updateAudioResumePrompt() {}
  });

  await withGlobals({
    document: documentRef,
    window: { location: { search: '' } }
  }, async () => {
    nav.applyViewState('library', { fromLibraryView: true });
    assert.deepEqual(entries.map(entry => entry.button.attributes?.get('aria-current') || null), [
      null,
      'page',
      null
    ]);

    nav.applyViewState('effects', { fromLibraryView: true });
    assert.deepEqual(entries.map(entry => entry.button.attributes?.get('aria-current') || null), [
      null,
      null,
      'page'
    ]);
  });
});

test('MobileNav keeps the library tab active when mobile layout starts from an open library', async () => {
  const documentRef = createDocument();
  documentRef.body.classList.add('view-library');
  const { nav: bottomNav, entries } = createBottomNav();
  const calls = [];
  const nav = Object.assign(Object.create(MobileNav.prototype), {
    nav: bottomNav,
    uiManager: {
      showLibraryView(options) {
        calls.push(['showLibraryView', options]);
      }
    },
    ensureElements() {},
    mountAudioPlayer(mode) {
      calls.push(['mountAudioPlayer', mode]);
    },
    attachPlayerState() {},
    updateMiniPlayer() {},
    updatePlayerPlaceholder() {},
    updateAudioResumePrompt() {},
    closePluginList() {}
  });

  await withGlobals({
    document: documentRef,
    window: { location: { search: '' } }
  }, async () => {
    nav.applyMode('mobile');
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.equal(calls[0][0], 'mountAudioPlayer');
  assert.equal(calls[0][1], 'mobile');
  assert.equal(calls[1][0], 'showLibraryView');
  assert.equal(calls[1][1].focusSearch, false);
  assert.equal(calls[1][1].returnFocus, undefined);
  assert.equal(typeof calls[1][1].isCurrentRequest, 'function');
  assert.equal(documentRef.body.classList.contains('view-library'), true);
  assert.equal(documentRef.body.classList.contains('view-player'), false);
  assert.equal(documentRef.body.classList.contains('view-effects'), false);
  assert.deepEqual(entries.map(entry => entry.button.classList.contains('active')), [
    false,
    true,
    false
  ]);
  assert.deepEqual(entries.map(entry => entry.button.attributes?.get('aria-current') || null), [
    null,
    'page',
    null
  ]);
});

test('MobileNav refreshes bottom tab labels through UIManager.updateUITexts', async () => {
  const documentRef = createDocument();
  const { nav: bottomNav, entries } = createBottomNav();
  const calls = [];
  const labels = {
    'ui.mobileNav.primary': 'Localized primary nav',
    'ui.mobileNav.player': 'Localized Player',
    'ui.mobileNav.library': 'Localized Library',
    'ui.mobileNav.effects': 'Localized Effects'
  };
  const uiManager = {
    layoutMode: {
      mode: 'desktop',
      onChange() {
        return () => {};
      }
    },
    updateUITexts() {
      calls.push('original');
    },
    t(key) {
      return labels[key] || key;
    }
  };

  await withGlobals({
    document: documentRef,
    window: { location: { search: '' } }
  }, async () => {
    const mobileNav = new MobileNav(uiManager);
    uiManager.mobileNav = mobileNav;
    mobileNav.nav = bottomNav;

    uiManager.updateUITexts();

    assert.deepEqual(calls, ['original']);
    assert.equal(bottomNav.attributes.get('aria-label'), 'Localized primary nav');
    assert.deepEqual(entries.map(entry => entry.label.textContent), [
      'Localized Player',
      'Localized Library',
      'Localized Effects'
    ]);
    assert.deepEqual(entries.map(entry => entry.button.attributes.get('aria-label')), [
      'Localized Player',
      'Localized Library',
      'Localized Effects'
    ]);

    mobileNav.dispose();
  });
});

test('MobileNav localizes mobile player controls, FAB, and effect-list close labels', async () => {
  const labels = {
    'ui.title.openMusic': 'Localized open music title',
    'ui.title.playPause': 'Localized play pause',
    'ui.title.nextTrack': 'Localized next track',
    'ui.mobileNav.noTrack': 'Localized no track',
    'ui.mobileNav.openMusic': 'Localized Open Music',
    'ui.mobileNav.resumePlayback': 'Localized resume playback',
    'ui.mobileNav.addEffect': 'Localized add effect',
    'ui.mobileNav.closeEffectList': 'Localized close effect list'
  };
  const emptyTitle = new FakeElement('div');
  const emptyOpenMusic = new FakeElement('button');
  const emptyPlayer = new FakeElement('div');
  emptyPlayer.querySelector = selector => ({
    '.mobile-player-empty-title': emptyTitle,
    '.mobile-open-music': emptyOpenMusic
  })[selector] || null;
  const miniTrack = new FakeElement('div');
  const openMusic = new FakeElement('button');
  const play = new FakeElement('button');
  const next = new FakeElement('button');
  const miniPlayer = new FakeElement('div');
  miniPlayer.querySelector = selector => ({
    '.mobile-mini-track': miniTrack,
    '.mobile-mini-open-music': openMusic,
    '.mobile-mini-play': play,
    '.mobile-mini-next': next
  })[selector] || null;
  const resumePrompt = new FakeElement('button');
  const fab = new FakeElement('button');
  const closeButton = new FakeElement('button');
  const nav = Object.assign(Object.create(MobileNav.prototype), {
    uiManager: {
      audioPlayer: {
        stateManager: {
          getStateSnapshot() {
            return {};
          }
        }
      },
      t(key) {
        return labels[key] || key;
      }
    },
    nav: null,
    emptyPlayer,
    miniPlayer,
    resumePrompt,
    fab,
    pluginListCloseButton: closeButton
  });

  nav.updateLabels();
  nav.updateMiniPlayer();

  assert.equal(emptyTitle.textContent, 'Localized no track');
  assert.equal(emptyOpenMusic.textContent, 'Localized Open Music');
  assert.equal(emptyOpenMusic.title, 'Localized open music title');
  assert.equal(emptyOpenMusic.attributes.get('aria-label'), 'Localized open music title');
  assert.equal(resumePrompt.textContent, 'Localized resume playback');
  assert.equal(resumePrompt.attributes.get('aria-label'), 'Localized resume playback');
  assert.equal(miniTrack.textContent, 'Localized no track');
  assert.equal(openMusic.textContent, 'Localized Open Music');
  assert.equal(openMusic.title, 'Localized open music title');
  assert.equal(openMusic.attributes.get('aria-label'), 'Localized open music title');
  assert.equal(play.title, 'Localized play pause');
  assert.equal(play.attributes.get('aria-label'), 'Localized play pause');
  assert.equal(next.title, 'Localized next track');
  assert.equal(next.attributes.get('aria-label'), 'Localized next track');
  assert.equal(fab.title, 'Localized add effect');
  assert.equal(fab.attributes.get('aria-label'), 'Localized add effect');
  assert.equal(closeButton.title, 'Localized close effect list');
  assert.equal(closeButton.attributes.get('aria-label'), 'Localized close effect list');
});
