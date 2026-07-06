import assert from 'node:assert/strict';
import test from 'node:test';

import { MobileMenu } from '../../js/ui/mobile-menu.js';
import { MobileNav } from '../../js/ui/mobile-nav.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.classes = new Set();
  }

  sync() {
    this.element.className = [...this.classes].join(' ');
  }

  add(...classNames) {
    classNames.forEach(className => this.classes.add(className));
    this.sync();
  }

  remove(...classNames) {
    classNames.forEach(className => this.classes.delete(className));
    this.sync();
  }

  contains(className) {
    return this.classes.has(className);
  }

  toggle(className, force) {
    const shouldAdd = force === undefined ? !this.classes.has(className) : Boolean(force);
    if (shouldAdd) this.classes.add(className);
    else this.classes.delete(className);
    this.sync();
    return shouldAdd;
  }
}

function matchesSelector(element, selector) {
  if (selector.startsWith('.')) {
    return element.className.split(/\s+/).includes(selector.slice(1));
  }
  const attributeMatch = selector.match(/^([a-z0-9-]+)?\[([a-z0-9-]+)(?:="([^"]+)")?\]$/i);
  if (attributeMatch) {
    const [, tagName, attributeName, expectedValue] = attributeMatch;
    if (tagName && element.tagName.toLowerCase() !== tagName.toLowerCase()) return false;
    if (!(attributeName in element.attributes) && !(attributeName in element.dataset)) return false;
    if (expectedValue === undefined) return true;
    return element.attributes[attributeName] === expectedValue || element.dataset[attributeName] === expectedValue;
  }
  return element.tagName.toLowerCase() === selector.toLowerCase();
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.listeners = new Map();
    this.style = {};
    this.className = '';
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.id = '';
    this.type = '';
    this.title = '';
    this.clicked = false;
    this.classList = new FakeClassList(this);
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  prepend(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.unshift(child);
    return child;
  }

  insertBefore(child, reference) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    const index = this.children.indexOf(reference);
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  click() {
    this.clicked = true;
    for (const listener of this.listeners.get('click') || []) {
      listener({ target: this });
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
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

function createDocument() {
  const listeners = new Map();
  const body = new FakeElement('body');
  const mainContainer = new FakeElement('div');
  mainContainer.classList.add('main-container');
  const titleContainer = new FakeElement('div');
  titleContainer.classList.add('title-container');
  const pluginList = new FakeElement('div');
  pluginList.id = 'pluginList';
  const openMusicButton = new FakeElement('button');
  openMusicButton.id = 'openMusicButton';
  body.appendChild(titleContainer);
  body.appendChild(mainContainer);

  return {
    body,
    mainContainer,
    titleContainer,
    pluginList,
    openMusicButton,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    querySelector(selector) {
      if (selector === '.main-container') return mainContainer;
      if (selector === '.title-container') return titleContainer;
      return null;
    },
    getElementById(id) {
      if (id === 'pluginList') return pluginList;
      if (id === 'openMusicButton') return openMusicButton;
      return null;
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter(candidate => candidate !== listener));
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    }
  };
}

function createLayoutMode(initialMode = 'mobile') {
  const listeners = [];
  return {
    mode: initialMode,
    get isMobile() {
      return this.mode === 'mobile';
    },
    onChange(listener) {
      listeners.push(listener);
      return () => {};
    },
    setMode(mode) {
      this.mode = mode;
      listeners.forEach(listener => listener(mode));
    }
  };
}

function createStateManager(initialState = { currentTrackName: 'Track', isPlaying: false, playlist: [] }) {
  const listeners = new Map();
  let state = { ...initialState };
  return {
    addListener(key, listener) {
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(listener);
    },
    removeListener(key, listener) {
      listeners.set(key, (listeners.get(key) || []).filter(candidate => candidate !== listener));
    },
    setState(nextState) {
      state = { ...state, ...nextState };
      Object.keys(nextState).forEach(key => {
        (listeners.get(key) || []).forEach(listener => listener());
      });
    },
    getStateSnapshot() {
      return { ...state };
    }
  };
}

test('MobileNav removes generated mobile DOM and remounts the player on desktop mode', async () => {
  const documentRef = createDocument();
  const layoutMode = createLayoutMode('mobile');
  const mountCalls = [];
  const uiManager = {
    layoutMode,
    audioPlayer: {
      ui: {
        container: {},
        mountContainerForLayout(mode) {
          mountCalls.push(mode);
        }
      },
      stateManager: createStateManager()
    },
    audioManager: {
      audioContext: { state: 'running' }
    }
  };

  await withGlobals({
    document: documentRef,
    window: { location: { search: '' } },
    setTimeout
  }, async () => {
    const mobileNav = new MobileNav(uiManager);
    const generatedNodes = [
      mobileNav.playerView,
      mobileNav.miniPlayer,
      mobileNav.nav,
      mobileNav.fab,
      mobileNav.pluginListCloseButton
    ];

    assert.equal(documentRef.body.children.includes(mobileNav.playerView), true);
    assert.equal(documentRef.body.children.includes(mobileNav.miniPlayer), true);
    assert.equal(documentRef.body.children.includes(mobileNav.nav), true);
    assert.equal(documentRef.body.children.includes(mobileNav.fab), true);
    assert.equal(documentRef.pluginList.children[0], mobileNav.pluginListCloseButton);
    assert.equal(mobileNav.nav.innerHTML.includes('mobile-bottom-button'), true);
    assert.equal(mobileNav.nav.innerHTML.includes('mobile-bottom-button-icon'), true);
    assert.equal(mobileNav.miniPlayer.querySelector('.mobile-mini-play').innerHTML.includes('<svg'), true);
    assert.equal(mobileNav.fab.innerHTML.includes('<svg'), true);
    assert.equal(mobileNav.pluginListCloseButton.innerHTML.includes('<svg'), true);
    assert.equal(documentRef.listenerCount('pointerdown'), 1);

    documentRef.pluginList.classList.add('mobile-open');
    layoutMode.setMode('desktop');

    assert.deepEqual(mountCalls, ['mobile', 'desktop']);
    assert.equal(documentRef.body.classList.contains('view-player'), false);
    assert.equal(documentRef.body.classList.contains('view-effects'), false);
    assert.equal(documentRef.pluginList.classList.contains('mobile-open'), false);
    assert.equal(documentRef.listenerCount('pointerdown'), 0);
    assert.equal(mobileNav.playerView, null);
    assert.equal(mobileNav.miniPlayer, null);
    assert.equal(mobileNav.nav, null);
    assert.equal(mobileNav.fab, null);
    assert.equal(mobileNav.pluginListCloseButton, null);
    generatedNodes.forEach(node => assert.equal(node.parentNode, null));
  });
});

test('MobileNav shows Open Music on the mini player when no track is loaded', async () => {
  const documentRef = createDocument();
  const stateManager = createStateManager({
    currentTrack: null,
    currentTrackName: '',
    isPlaying: false,
    playlist: []
  });
  const uiManager = {
    layoutMode: createLayoutMode('mobile'),
    audioPlayer: {
      ui: {
        container: {},
        mountContainerForLayout() {}
      },
      stateManager,
      togglePlayPause() {},
      playNext() {}
    },
    audioManager: {
      audioContext: { state: 'running' }
    }
  };

  await withGlobals({
    document: documentRef,
    window: { location: { search: '' } },
    setTimeout
  }, async () => {
    const mobileNav = new MobileNav(uiManager);
    const track = mobileNav.miniPlayer.querySelector('.mobile-mini-track');
    const openMusic = mobileNav.miniPlayer.querySelector('.mobile-mini-open-music');
    const play = mobileNav.miniPlayer.querySelector('.mobile-mini-play');
    const next = mobileNav.miniPlayer.querySelector('.mobile-mini-next');

    assert.equal(track.textContent, 'No track loaded');
    assert.equal(openMusic.hidden, false);
    assert.equal(play.hidden, true);
    assert.equal(next.hidden, true);

    openMusic.click();
    assert.equal(documentRef.openMusicButton.clicked, true);

    stateManager.setState({ currentTrackName: 'Loaded track', isPlaying: true });
    assert.equal(track.textContent, 'Loaded track');
    assert.equal(openMusic.hidden, true);
    assert.equal(play.hidden, false);
    assert.equal(next.hidden, false);
    assert.equal(play.innerHTML.includes('<rect'), true);
  });
});

test('MobileMenu removes overflow controls when leaving mobile mode', async () => {
  const documentRef = createDocument();
  const layoutMode = createLayoutMode('mobile');
  const calls = [];
  const uiManager = { layoutMode };

  await withGlobals({
    document: documentRef,
    window: {
      location: { search: '' },
      electronIntegration: {
        isElectron: true,
        processAudioFiles() {
          calls.push('processAudioFiles');
        }
      }
    }
  }, async () => {
    const menu = new MobileMenu(uiManager);
    const button = menu.button;
    const panel = menu.panel;
    const backdrop = menu.backdrop;

    assert.equal(documentRef.titleContainer.children.includes(button), true);
    assert.equal(documentRef.body.children.includes(panel), true);
    assert.equal(documentRef.body.children.includes(backdrop), true);
    assert.equal(button.innerHTML.includes('<svg'), true);
    assert.equal(panel.children.some(item => item.textContent === 'Process Audio Files with Effects...'), true);

    menu.open();
    assert.equal(panel.classList.contains('mobile-open'), true);
    panel.children.find(item => item.textContent === 'Process Audio Files with Effects...').click();
    assert.deepEqual(calls, ['processAudioFiles']);
    assert.equal(panel.classList.contains('mobile-open'), false);

    menu.open();
    layoutMode.setMode('desktop');

    assert.equal(menu.button, null);
    assert.equal(menu.panel, null);
    assert.equal(menu.backdrop, null);
    assert.equal(button.parentNode, null);
    assert.equal(panel.parentNode, null);
    assert.equal(backdrop.parentNode, null);
  });
});

test('MobileMenu uses web file selection when Electron bridge is present but inactive', async () => {
  const documentRef = createDocument();
  const layoutMode = createLayoutMode('mobile');
  const calls = [];
  const dropArea = new FakeElement('div');
  const selectFiles = new FakeElement('span');
  selectFiles.className = 'select-files';
  dropArea.appendChild(selectFiles);
  const uiManager = {
    layoutMode,
    pipelineManager: {
      fileProcessor: { dropArea }
    }
  };

  await withGlobals({
    document: documentRef,
    window: {
      location: { search: '' },
      electronIntegration: {
        isElectron: false,
        isElectronEnvironment: () => false,
        processAudioFiles() {
          calls.push('electronProcessAudioFiles');
        }
      }
    }
  }, async () => {
    const menu = new MobileMenu(uiManager);
    const processItem = menu.panel.children.find(item => item.textContent === 'Process Audio Files with Effects...');
    processItem.click();

    assert.deepEqual(calls, []);
    assert.equal(selectFiles.clicked, true);
  });
});

test('MobileMenu applies translated labels to settings actions', async () => {
  const documentRef = createDocument();
  const layoutMode = createLayoutMode('mobile');
  const labels = {
    'menu.settings': 'Translated Settings',
    'menu.file.openMusicFile': 'Translated Open',
    'menu.file.processAudioFiles': 'Translated Process',
    'dialog.config.title': 'Translated Config',
    'dialog.audioConfig.title': 'Translated Audio',
    'menu.settings.performanceBenchmark': 'Translated Benchmark',
    'menu.settings.frequencyResponseMeasurement': 'Translated Measurement',
    'ui.resetButton': 'Translated Reset',
    'ui.shareButton': 'Translated Share',
    'ui.whatsThisApp': 'Translated Whats'
  };
  const uiManager = {
    layoutMode,
    t(key) {
      return labels[key] ?? key;
    }
  };

  await withGlobals({
    document: documentRef,
    window: { location: { search: '' } }
  }, async () => {
    const menu = new MobileMenu(uiManager);
    assert.equal(menu.button.title, 'Translated Settings');
    assert.equal(menu.button.attributes['aria-label'], 'Translated Settings');
    assert.equal(menu.panel.children.some(item => item.textContent === 'Translated Open'), true);
    assert.equal(menu.panel.children.some(item => item.textContent === 'Translated Process'), true);
    assert.equal(menu.panel.children.some(item => item.textContent === 'Translated Config'), true);
    assert.equal(menu.panel.children.some(item => item.textContent === 'Translated Audio'), true);
    assert.equal(menu.panel.children.some(item => item.textContent === 'Translated Benchmark'), true);
    assert.equal(menu.panel.children.some(item => item.textContent === 'Translated Share'), true);
    assert.equal(menu.panel.children.some(item => item.textContent === 'Translated Whats'), true);
    assert.equal(menu.panel.children.some(item => item.textContent === 'Translated Measurement'), true);
    assert.equal(menu.panel.children.some(item => item.textContent === 'Translated Reset'), true);

    labels['dialog.config.title'] = 'Updated Config';
    menu.updateLabels();
    assert.equal(menu.panel.children.some(item => item.textContent === 'Updated Config'), true);
  });
});
