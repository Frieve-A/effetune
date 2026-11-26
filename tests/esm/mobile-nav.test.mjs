import assert from 'node:assert/strict';
import test from 'node:test';

import { MobileNav } from '../../js/ui/mobile-nav.js';
import { returnToEffeTune, saveFeatureReturnTab } from '../../features/measurement/return-to-effetune.js';
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

test('Android player prompt follows the service and resumes without a track or AudioContext', async () => {
  const documentRef = createDocument();
  const listeners = new Map();
  let starts = 0;
  const manager = {
    isAndroid: true, snapshot: {},
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    resumeStoppedOutput() { starts++; }
  };
  await withGlobals({ document: documentRef, window: { location: { search: '' } } }, () => {
    const nav = new MobileNav({
      layoutMode: { mode: 'mobile', isMobile: true, onChange: () => () => {} },
      audioManager: manager
    });
    assert.equal(nav.resumePrompt.hidden, true);
    for (const reason of ['noisy', 'feature-page']) {
      manager.snapshot = { outputStopReason: reason };
      listeners.get('nativeSnapshot')();
      assert.equal(nav.resumePrompt.hidden, false);
      nav.resumeAudioContext();
      manager.snapshot = {};
      listeners.get('nativeSnapshot')();
      assert.equal(nav.resumePrompt.hidden, true);
    }
    assert.equal(starts, 2);
    nav.dispose();
    assert.equal(listeners.size, 0);
  });
});

test('wide Android layout offers service resume in the settings menu', async () => {
  const documentRef = createDocument();
  const menu = new FakeElement('div');
  const existing = new FakeElement('button');
  menu.appendChild(existing);
  const query = documentRef.querySelector;
  documentRef.querySelector = selector => selector === '.settings-menu [data-power-resume-action]' ? existing : query(selector);
  const listeners = new Map();
  let starts = 0;
  const manager = {
    isAndroid: true, snapshot: { outputStopReason: 'feature-page' },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    resumeStoppedOutput() { starts++; }
  };
  await withGlobals({ document: documentRef, window: { location: { search: '' } } }, () => {
    const nav = new MobileNav({ layoutMode: { mode: 'desktop', isMobile: false, onChange: () => () => {} }, audioManager: manager });
    const action = nav.desktopResumeAction;
    assert.equal(action.hidden, false);
    action.eventListeners.get('click')[0]();
    assert.equal(starts, 1);
    manager.snapshot = {};
    listeners.get('nativeSnapshot')();
    assert.equal(action.hidden, true);
    nav.dispose();
    assert.equal(listeners.size, 0);
    assert.equal(action.parentNode, null);
  });
});

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

test('resumeAudioContext handles power controller resume rejection without unhandled rejection', async () => {
  const errors = [];
  let unhandled = null;
  const onUnhandled = reason => { unhandled = reason; };
  process.on('unhandledRejection', onUnhandled);
  try {
    let updates = 0;
    const nav = Object.assign(Object.create(MobileNav.prototype), {
      uiManager: {
        audioManager: {
          powerPolicyController: {
            enabled: true,
            requestResumeFromUserGesture() {
              return Promise.reject(new Error('resume failed'));
            }
          }
        }
      },
      updateAudioResumePrompt() { updates++; }
    });
    await withGlobals({
      console: { ...console, error: (...args) => { errors.push(args); } }
    }, async () => {
      nav.resumeAudioContext();
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
    });
    assert.equal(updates, 1);
    assert.equal(errors.length, 1);
    assert.equal(unhandled, null);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('MobileNav preserves Visualizer on layout reapplication and leaves on explicit navigation', async () => {
  const documentRef = createDocument();
  documentRef.body.classList.add('view-player', 'view-visualizer');
  const { nav: bottomNav, entries } = createBottomNav();
  const nav = Object.assign(Object.create(MobileNav.prototype), {
    nav: bottomNav,
    uiManager: {
      hideVisualizerView() { documentRef.body.classList.remove('view-visualizer'); },
      hideLibraryView() {}
    },
    closePluginList() {}, updateAudioResumePrompt() {}
  });
  await withGlobals({ document: documentRef }, () => {
    nav.applyViewState('visualizer', { fromLibraryView: true });
    assert.equal(nav.getCurrentView(), 'visualizer');
    assert.equal(documentRef.body.classList.contains('view-player'), false);
    assert.equal(entries[0].button.classList.contains('active'), true);
    nav.setView('effects');
    assert.equal(nav.getCurrentView(), 'effects');
    assert.equal(documentRef.body.classList.contains('view-visualizer'), false);
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

test('Android feature returns traverse the main entry and the saved tab takes precedence over the pipeline URL', async () => {
  const state = new Map();
  const origin = 'https://appassets.androidplatform.net';
  const main = `${origin}/app/effetune.html`;
  const calls = [];
  const win = {
    effetuneAndroid: { postMessage() {} },
    localStorage: { getItem: () => null },
    history: { length: 2, back() { calls.push('back'); } },
    location: { origin, href: new URL('features/effetune_bench.html', main).href, search: '?p=local',
      replace(url) { calls.push(url); } },
    sessionStorage: { getItem: key => state.get(key), setItem: (key, value) => state.set(key, value) },
    navigation: { currentEntry: { index: 1 }, entries: () => [{ url: main + '?p=local' }, {}] }
  };
  const nav = Object.assign(Object.create(MobileNav.prototype), {
    ensureElements() {}, mountAudioPlayer() {}, attachPlayerState() {}, updateMiniPlayer() {},
    updatePlayerPlaceholder() {}, updateAudioResumePrompt() {}, setView(view) { calls.push(view); }
  });
  await withGlobals({ window: win, document: createDocument() }, async () => {
    for (const tab of ['player', 'effects', 'library']) {
      saveFeatureReturnTab(tab);
      await returnToEffeTune('../effetune.html');
      nav.applyMode('mobile');
      assert.deepEqual(calls.splice(0), ['back', tab]);
    }
    state.clear();
    win.navigation.entries = () => [{ url: 'https://other.test/app/effetune.html' }, {}];
    await returnToEffeTune('../effetune.html');
    nav.applyMode('mobile');
    assert.deepEqual(calls, [main, 'effects']);
    win.electronAPI = { async navigateToMain() { calls.push('ipc'); return { success: true }; } };
    await returnToEffeTune('../effetune.html');
    assert.deepEqual(calls, [main, 'effects', 'ipc']);
  });
});

test('Android MobileNav restores the selected tab in a fresh document', async () => {
  const window = {
    location: { origin: 'https://appassets.androidplatform.net', search: '' },
    effetuneAndroid: { postMessage() {} },
    localStorage: new Map()
  };
  window.localStorage.getItem = window.localStorage.get.bind(window.localStorage);
  window.localStorage.setItem = window.localStorage.set.bind(window.localStorage);
  const makeNav = () => Object.assign(Object.create(MobileNav.prototype), {
    uiManager: { showLibraryView: async () => true },
    ensureElements() { this.nav = createBottomNav().nav; },
    mountAudioPlayer() {}, attachPlayerState() {}, updateMiniPlayer() {},
    updatePlayerPlaceholder() {}, updateAudioResumePrompt() {}, closePluginList() {}
  });
  await withGlobals({ document: createDocument(), window }, async () => {
    const nav = makeNav();
    nav.applyMode('mobile');
    await nav.setView('library');
    assert.equal(nav.getCurrentView(), 'library');
  });
  await withGlobals({ document: createDocument(), window }, async () => {
    const nav = makeNav();
    nav.applyMode('mobile');
    await Promise.resolve();
    assert.equal(nav.getCurrentView(), 'library');
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
