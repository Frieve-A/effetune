import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioPlayerUI } from '../../js/ui/audio-player/audio-player-ui.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class FakeElement {
  constructor(tagName, ownerDocument, calls = []) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.calls = calls;
    this.children = [];
    this.parentNode = null;
    this.eventListeners = new Map();
    this.className = '';
    this.textContent = '';
    this.title = '';
    this.value = '';
    this.disabled = false;
    this.style = {};
    this._innerHTML = '';
    this.offsetHeight = 20;
    this.id = '';
    this.attributes = new Map();
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (value === '') {
      this.children.forEach(child => {
        child.parentNode = null;
      });
      this.children = [];
    }
    if (this.classList().includes('audio-player')) {
      this.children = [];
      this.ownerDocument.populateAudioPlayerMarkup(value, this);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  classList() {
    return this.className.split(/\s+/).filter(Boolean);
  }

  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
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

  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children;
    const index = siblings.indexOf(this);
    return index === -1 ? null : siblings[index + 1] ?? null;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    this.calls.push(['removeChild', child.className]);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    this[name] = String(value);
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type).push(listener);
  }

  dispatchEvent(type, event = {}) {
    const eventObject = { target: this, ...event };
    return (this.eventListeners.get(type) || []).map(listener => listener(eventObject));
  }

  querySelector(selector) {
    if (!selector.startsWith('.')) return null;
    return this.findByClass(selector.slice(1));
  }

  findByClass(className) {
    if (this.classList().includes(className)) return this;
    for (const child of this.children) {
      const match = child.findByClass(className);
      if (match) return match;
    }
    return null;
  }
}

function extractButtonContent(html, className) {
  const pattern = new RegExp(`<button[^>]*class="[^"]*${className}[^"]*"[^>]*title="([^"]*)"[^>]*>([\\s\\S]*?)<\\/button>`);
  const match = pattern.exec(html);
  return {
    title: match?.[1] ?? '',
    innerHTML: match?.[2] ?? ''
  };
}

function createDocument(calls, options = {}) {
  const documentRef = {
    body: null,
    mainContainer: null,
    dbtPanel: null,
    createElement(tagName) {
      return new FakeElement(tagName, documentRef, calls);
    },
    getElementById(id) {
      if (id === 'mobilePlayerView') return documentRef.mobilePlayerView ?? null;
      return null;
    },
    querySelector(selector) {
      calls.push(['documentQuerySelector', selector]);
      if (selector === '.main-container') return documentRef.mainContainer;
      if (selector === '.double-blind-test') return documentRef.dbtPanel;
      return null;
    },
    populateAudioPlayerMarkup(html, parent) {
      const artwork = this.createElement('div');
      artwork.className = 'player-artwork';
      const artworkPlaceholder = this.createElement('div');
      artworkPlaceholder.className = 'player-artwork-placeholder';
      const artworkImage = this.createElement('img');
      artworkImage.className = 'player-artwork-image';
      artwork.appendChild(artworkPlaceholder);
      artwork.appendChild(artworkImage);
      parent.appendChild(artwork);

      const trackContainer = this.createElement('div');
      trackContainer.className = 'track-name-container';
      const trackName = this.createElement('div');
      trackName.className = 'track-name';
      trackName.textContent = 'No track loaded';
      trackContainer.appendChild(trackName);
      parent.appendChild(trackContainer);

      const controls = this.createElement('div');
      controls.className = 'player-controls';

      const seekBar = this.createElement('input');
      seekBar.className = 'seek-bar';
      seekBar.value = '0';
      controls.appendChild(seekBar);

      const timeDisplay = this.createElement('div');
      timeDisplay.className = 'time-display';
      timeDisplay.textContent = '00:00';
      controls.appendChild(timeDisplay);

      for (const className of [
        'play-pause-button',
        'stop-button',
        'prev-button',
        'next-button',
        'repeat-button',
        'shuffle-button',
        'close-button'
      ]) {
        const button = this.createElement('button');
        const content = extractButtonContent(html, className);
        button.className = `player-button ${className}`;
        button.title = content.title;
        button.innerHTML = content.innerHTML;
        controls.appendChild(button);
      }

      const playlist = this.createElement('div');
      playlist.className = 'player-playlist';
      controls.appendChild(playlist);

      parent.appendChild(controls);
    }
  };

  documentRef.body = documentRef.createElement('body');

  if (options.main !== false) {
    documentRef.mainContainer = documentRef.createElement('div');
    documentRef.mainContainer.className = 'main-container';
    if (!options.detachedMain) {
      documentRef.body.appendChild(documentRef.mainContainer);
    }
  }

  if (options.dbt) {
    documentRef.dbtPanel = documentRef.createElement('div');
    documentRef.dbtPanel.className = 'double-blind-test';
    documentRef.body.insertBefore(documentRef.dbtPanel, documentRef.mainContainer);
  }

  if (options.mobilePlayerView) {
    documentRef.mobilePlayerView = documentRef.createElement('div');
    documentRef.mobilePlayerView.id = 'mobilePlayerView';
    documentRef.mobilePlayerView.className = 'mobile-player-view';
    documentRef.body.appendChild(documentRef.mobilePlayerView);
  }

  return documentRef;
}

function createWindow(calls, options = {}) {
  if (options.uiManager === false) return { uiManager: null };
  const uiManager = {
    t(key) {
      calls.push(['translate', key]);
      return `T:${key}`;
    },
    ...(options.uiManager || {})
  };
  return {
    uiManager
  };
}

function createStateManager(initialState, calls) {
  const listeners = new Map();
  const manager = {
    state: {
      seekBarEnabled: true,
      repeatMode: 'OFF',
      shuffleMode: false,
      isPlaying: false,
      currentTrack: null,
      currentTrackPosition: 0,
      currentTrackDuration: 0,
      ...initialState
    },
    listeners,
    addListener(key, listener) {
      calls.push(['addListener', key]);
      if (!listeners.has(key)) {
        listeners.set(key, []);
      }
      listeners.get(key).push(listener);
    },
    removeListener(key, listener) {
      calls.push(['removeListener', key]);
      if (!listeners.has(key)) return;
      listeners.set(key, listeners.get(key).filter(candidate => candidate !== listener));
    },
    getStateSnapshot() {
      calls.push(['getStateSnapshot']);
      return { ...this.state };
    },
    setState(patch) {
      Object.assign(this.state, patch);
    },
    emit(key, value) {
      for (const listener of listeners.get(key) || []) {
        listener(value);
      }
    },
    emitAny(key, value, source) {
      for (const listener of listeners.get('*') || []) {
        listener(value, key, source);
      }
    }
  };
  return manager;
}

function createAudioPlayer(calls, options = {}) {
  const stateManager = options.stateManager === false
    ? null
    : createStateManager(options.state, calls);
  return {
    calls,
    stateManager,
    contextManager: options.contextManager,
    audioElement: options.audioElement,
    playbackManager: {
      toggleRepeatMode() {
        calls.push(['toggleRepeatMode']);
      },
      toggleShuffleMode() {
        calls.push(['toggleShuffleMode']);
      }
    },
    togglePlayPause() {
      calls.push(['togglePlayPause']);
    },
    stop() {
      calls.push(['stop']);
    },
    playPrevious() {
      calls.push(['playPrevious']);
    },
    playNext() {
      calls.push(['playNext']);
    },
    close() {
      calls.push(['close']);
    },
    async loadTrack(index) {
      calls.push(['loadTrack', index]);
    },
    async play(userInitiated) {
      calls.push(['play', userInitiated]);
    },
    resumeAudioContextInGesture() {
      calls.push(['resumeAudioContextInGesture']);
    }
  };
}

async function withAudioPlayerGlobals(options, callback) {
  const calls = [];
  const documentRef = options.document ?? createDocument(calls, options.documentOptions);
  const windowRef = options.window ?? createWindow(calls, options.windowOptions);
  const frames = [];
  const timers = new Map();
  const nativeConsole = globalThis.console;
  let nextTimer = 1;

  await withGlobals({
    document: documentRef,
    window: windowRef,
    requestAnimationFrame(fn) {
      calls.push(['requestAnimationFrame']);
      frames.push(fn);
      return frames.length;
    },
    setInterval(fn, delay) {
      calls.push(['setInterval', delay]);
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    },
    clearInterval(id) {
      calls.push(['clearInterval', id]);
      timers.delete(id);
    },
    console: {
      ...nativeConsole,
      warn(message) {
        calls.push(['warn', message]);
      }
    }
  }, async () => callback({ calls, documentRef, windowRef, frames, timers }));
}

function createControlElement(calls, className = '') {
  const ownerDocument = {
    populateAudioPlayerMarkup() {}
  };
  const element = new FakeElement('button', ownerDocument, calls);
  element.className = className;
  return element;
}

test('creates translated controls, inserts before the double blind panel, and wires state listeners', async () => {
  await withAudioPlayerGlobals({
    documentOptions: { dbt: true },
    state: {
      repeatMode: 'ONE',
      shuffleMode: true,
      currentTrackPosition: 3,
      currentTrackDuration: 30
    }
  }, async ({ calls, documentRef, frames }) => {
    const player = createAudioPlayer(calls, {
      state: {
        repeatMode: 'ONE',
        shuffleMode: true,
        isPlaying: true,
        currentTrackPosition: 3,
        currentTrackDuration: 30
      }
    });
    player.audioContext = { state: 'running' };
    const ui = new AudioPlayerUI(player);
    const container = ui.createPlayerUI();

    assert.deepEqual([...player.stateManager.listeners.keys()].sort(), [
      '*',
      'artworkUrl',
      'currentTrack',
      'currentTrackDuration',
      'currentTrackIndex',
      'currentTrackName',
      'currentTrackPosition',
      'isPaused',
      'isPlaying',
      'isStopped',
      'playlist'
    ].sort());
    assert.equal(documentRef.body.children[0], container);
    assert.equal(documentRef.body.children[1], documentRef.dbtPanel);
    assert.equal(ui.playPauseButton.title, 'T:ui.title.playPause');
    assert.match(ui.repeatButton.innerHTML, /M11\.3 10\.3/);
    assert.equal(ui.shuffleButton.disabled, true);
    assert.equal(ui.shuffleButton.style.opacity, '0.5');

    ui.playPauseButton.dispatchEvent('click');
    ui.stopButton.dispatchEvent('click');
    ui.prevButton.dispatchEvent('click');
    ui.nextButton.dispatchEvent('click');
    ui.repeatButton.dispatchEvent('click');
    ui.shuffleButton.dispatchEvent('click');
    ui.closeButton.dispatchEvent('click');

    assert.deepEqual(calls.filter(call => [
      'togglePlayPause',
      'stop',
      'playPrevious',
      'playNext',
      'toggleRepeatMode',
      'toggleShuffleMode',
      'close'
    ].includes(call[0])), [
      ['togglePlayPause'],
      ['stop'],
      ['playPrevious'],
      ['playNext'],
      ['toggleRepeatMode'],
      ['toggleShuffleMode'],
      ['close']
    ]);

    assert.equal(ui.handleStateChange('initialKey', 'initialValue', 'direct'), undefined);
    ui.handleStateChange = (key, value, source) => calls.push(['handleStateChange', key, value, source]);
    player.stateManager.emitAny('customKey', 'newValue', 'unit-test');
    assert.ok(calls.some(call => call[0] === 'handleStateChange' && call[1] === 'customKey'));

    player.stateManager.emit('currentTrack', { name: 'State listener track' });
    assert.equal(ui.trackNameDisplay.textContent, 'State listener track');

    player.stateManager.setState({ currentTrackPosition: 10, currentTrackDuration: 40 });
    player.stateManager.emit('currentTrackPosition', 10);
    assert.equal(frames.length, 1);
    frames.shift()();
    assert.equal(ui.timeDisplay.textContent, '00:10 / 00:40');

    player.stateManager.emit('currentTrackDuration', 40);
    assert.equal(ui.timeDisplay.textContent, '00:10 / 00:40');

    player.stateManager.setState({ isPlaying: true });
    player.stateManager.emit('isPlaying', true);
    assert.match(ui.playPauseButton.innerHTML, /<rect x="7"/);

    player.stateManager.setState({ isPlaying: false });
    player.stateManager.emit('isPaused', true);
    assert.match(ui.playPauseButton.innerHTML, /M8 5\.14/);

    player.stateManager.setState({ currentTrackPosition: 0, currentTrackDuration: 0 });
    player.stateManager.emit('isStopped', true);
    assert.equal(ui.timeDisplay.textContent, '00:00 / 00:00');
    assert.match(ui.playPauseButton.innerHTML, /M8 5\.14/);
  });
});

test('createPlayerUI uses fallback text and handles alternate insertion targets', async () => {
  await withAudioPlayerGlobals({
    documentOptions: {},
    windowOptions: { uiManager: false }
  }, async ({ documentRef, calls }) => {
    const ui = new AudioPlayerUI(createAudioPlayer(calls));
    const container = ui.createPlayerUI();

    assert.equal(documentRef.body.children[0], container);
    assert.equal(documentRef.body.children[1], documentRef.mainContainer);
    assert.equal(ui.playPauseButton.title, 'Play or pause');
    assert.equal(ui.stopButton.title, 'Stop');
    assert.equal(ui.prevButton.title, 'Previous track');
    assert.equal(ui.nextButton.title, 'Next track');
    assert.equal(ui.repeatButton.title, 'Toggle repeat mode');
    assert.equal(ui.shuffleButton.title, 'Toggle shuffle');
    assert.equal(ui.closeButton.title, 'Close player');
  });

  await withAudioPlayerGlobals({
    documentOptions: { detachedMain: true }
  }, async ({ documentRef, calls }) => {
    const ui = new AudioPlayerUI(createAudioPlayer(calls));
    const container = ui.createPlayerUI();

    assert.equal(container.parentNode, null);
    assert.equal(documentRef.body.children.includes(container), false);
  });
});

test('mountContainerForLayout moves an existing player between mobile and desktop roots', async () => {
  await withAudioPlayerGlobals({
    documentOptions: { mobilePlayerView: true },
    windowOptions: {
      uiManager: {
        layoutMode: { isMobile: true },
        mobileNav: {
          updatePlayerPlaceholder() {}
        }
      }
    }
  }, async ({ documentRef, calls, windowRef }) => {
    const ui = new AudioPlayerUI(createAudioPlayer(calls));
    const container = ui.createPlayerUI();

    assert.equal(container.parentNode, documentRef.mobilePlayerView);
    assert.equal(documentRef.mobilePlayerView.children.includes(container), true);

    windowRef.uiManager.layoutMode.isMobile = false;
    ui.mountContainerForLayout('desktop');
    assert.equal(container.parentNode, documentRef.body);
    assert.equal(container.nextSibling, documentRef.mainContainer);
    assert.equal(documentRef.mobilePlayerView.children.includes(container), false);

    windowRef.uiManager.layoutMode.isMobile = true;
    ui.mountContainerForLayout('mobile');
    assert.equal(container.parentNode, documentRef.mobilePlayerView);
    assert.equal(documentRef.body.children.includes(container), false);
  });
});

test('updatePlayerUIState handles repeat, shuffle, default, and missing-control states', () => {
  const calls = [];
  const player = createAudioPlayer(calls, {
    state: { repeatMode: 'ALL', shuffleMode: true }
  });
  const ui = new AudioPlayerUI(player);

  ui.updatePlayerUIState();

  ui.repeatButton = createControlElement(calls, 'repeat-button');
  ui.shuffleButton = createControlElement(calls, 'shuffle-button');

  ui.updatePlayerUIState();
  assert.equal(ui.repeatButton.attributes.get('data-active'), 'true');
  assert.equal(ui.shuffleButton.attributes.get('data-active'), 'true');

  player.stateManager.setState({ repeatMode: 'ONE', shuffleMode: true });
  ui.updatePlayerUIState();
  assert.match(ui.repeatButton.innerHTML, /M11\.3 10\.3/);
  assert.equal(ui.repeatButton.attributes.get('data-active'), 'true');
  assert.equal(ui.shuffleButton.disabled, true);
  assert.equal(ui.shuffleButton.style.opacity, '0.5');
  assert.equal(ui.shuffleButton.attributes.get('data-active'), 'false');

  player.stateManager.setState({ repeatMode: 'OFF', shuffleMode: false });
  ui.updatePlayerUIState();
  assert.equal(ui.repeatButton.attributes.get('data-active'), 'false');
  assert.equal(ui.shuffleButton.disabled, false);
  assert.equal(ui.shuffleButton.style.opacity, '1');
  assert.equal(ui.shuffleButton.attributes.get('data-active'), 'false');

  player.stateManager.setState({ repeatMode: 'UNEXPECTED', shuffleMode: true });
  ui.updatePlayerUIState();
  assert.equal(ui.repeatButton.attributes.get('data-active'), 'false');
  assert.equal(ui.shuffleButton.attributes.get('data-active'), 'true');

  const fallbackUI = new AudioPlayerUI(createAudioPlayer(calls, { stateManager: false }));
  fallbackUI.repeatButton = createControlElement(calls, 'repeat-button');
  fallbackUI.shuffleButton = createControlElement(calls, 'shuffle-button');
  fallbackUI.updatePlayerUIState();
  assert.equal(fallbackUI.repeatButton.attributes.get('data-active'), 'false');
  assert.equal(fallbackUI.shuffleButton.disabled, false);
  assert.equal(fallbackUI.shuffleButton.attributes.get('data-active'), 'false');
});

test('seek bar input respects disabled state and context manager duration validity', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const contextState = { currentTrackDuration: 100 };
    const contextManager = {
      getCurrentState() {
        calls.push(['getCurrentState']);
        return contextState;
      },
      seek(value) {
        calls.push(['seek', value]);
      }
    };
    const player = createAudioPlayer(calls, {
      contextManager,
      state: {
        seekBarEnabled: false,
        currentTrackPosition: 0,
        currentTrackDuration: 100
      }
    });
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();

    ui.seekBar.value = '50';
    ui.seekBar.dispatchEvent('input');
    assert.equal(calls.some(call => call[0] === 'seek'), false);

    player.stateManager.setState({ seekBarEnabled: true });
    ui.seekBar.dispatchEvent('input');
    assert.ok(calls.some(call => call[0] === 'seek' && call[1] === 50));
    assert.ok(calls.findIndex(call => call[0] === 'resumeAudioContextInGesture') <
      calls.findIndex(call => call[0] === 'seek'));

    contextState.currentTrackDuration = 0;
    ui.seekBar.dispatchEvent('input');
    assert.equal(calls.filter(call => call[0] === 'seek').length, 1);

    contextState.currentTrackDuration = Infinity;
    ui.seekBar.dispatchEvent('input');
    assert.equal(calls.filter(call => call[0] === 'seek').length, 1);
  });

  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const contextManager = {
      getCurrentState() {
        return { currentTrackDuration: 80 };
      },
      seek(value) {
        calls.push(['seekWithoutState', value]);
      }
    };
    const ui = new AudioPlayerUI(createAudioPlayer(calls, {
      stateManager: false,
      contextManager
    }));
    ui.createPlayerUI();
    ui.seekBar.value = '25';
    ui.seekBar.dispatchEvent('input');

    assert.deepEqual(calls.filter(call => call[0] === 'seekWithoutState'), [['seekWithoutState', 20]]);
  });
});

test('seek bar input uses audio-element fallback paths', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const player = createAudioPlayer(calls, {
      state: { seekBarEnabled: true },
      audioElement: { duration: 0, paused: false }
    });
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();

    ui.seekBar.value = '50';
    ui.seekBar.dispatchEvent('input');

    player.audioElement = { duration: Infinity, paused: false };
    ui.seekBar.dispatchEvent('input');

    player.audioElement = { duration: 60, paused: true };
    ui.seekBar.dispatchEvent('input');

    player.audioElement = { duration: 60, paused: false };
    assert.throws(() => ui.seekBar.dispatchEvent('input'), TypeError);
  });
});

test('display updates handle fallbacks, invalid values, and warning paths', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const player = createAudioPlayer(calls, {
      state: {
        currentTrack: { name: 'Snapshot track' },
        currentTrackPosition: -5,
        currentTrackDuration: Infinity
      }
    });
    const ui = new AudioPlayerUI(player);

    ui.updatePlayPauseButton();
    ui.updateTrackDisplay();
    ui.updateTimeDisplay();
    assert.ok(calls.some(call => call[0] === 'warn' && call[1].includes('Time display')));

    ui.playPauseButton = createControlElement(calls, 'play-pause-button');
    ui.trackNameDisplay = createControlElement(calls, 'track-name');
    ui.timeDisplay = createControlElement(calls, 'time-display');
    ui.seekBar = createControlElement(calls, 'seek-bar');
    ui.seekBar.value = '77';

    ui.updateTrackDisplay();
    assert.equal(ui.trackNameDisplay.textContent, 'Snapshot track');

    ui.updateTrackDisplay({ name: 'Explicit track' });
    assert.equal(ui.trackNameDisplay.textContent, 'Explicit track');

    ui.updateTrackDisplay({ name: '' });
    assert.equal(ui.trackNameDisplay.textContent, 'No track loaded');

    ui.updateTimeDisplay();
    assert.equal(ui.timeDisplay.textContent, '00:00 / 00:00');
    assert.equal(ui.seekBar.value, 0);

    player.stateManager.setState({ currentTrackPosition: 0, currentTrackDuration: undefined });
    ui.seekBar.value = '33';
    ui.updateTimeDisplay();
    assert.equal(ui.timeDisplay.textContent, '00:00 / 00:00');
    assert.equal(ui.seekBar.value, 0);

    player.stateManager.setState({ currentTrackPosition: Infinity, currentTrackDuration: 0 });
    ui.seekBar.value = '44';
    ui.updateTimeDisplay();
    assert.equal(ui.timeDisplay.textContent, '00:00 / 00:00');
    assert.equal(ui.seekBar.value, 0);

    player.stateManager.setState({ currentTrackPosition: 30, currentTrackDuration: 120 });
    ui.updateTimeDisplay();
    assert.equal(ui.timeDisplay.textContent, '00:30 / 02:00');
    assert.equal(ui.seekBar.value, 25);
    assert.equal(ui.seekBar.style.display, '');

    player.stateManager.setState({ currentTrackPosition: 150, currentTrackDuration: 120 });
    ui.seekBar.value = 25;
    ui.updateTimeDisplay();
    assert.equal(ui.seekBar.value, 25);

    player.stateManager.setState({ isPlaying: true });
    ui.updatePlayPauseButton();
    assert.match(ui.playPauseButton.innerHTML, /<rect x="7"/);

    player.stateManager.setState({ isPlaying: false });
    ui.updatePlayPauseButton();
    assert.match(ui.playPauseButton.innerHTML, /M8 5\.14/);

    assert.equal(ui.formatTime(Number.NaN), '00:00');
    assert.equal(ui.formatTime(125), '02:05');
  });

  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const ui = new AudioPlayerUI(createAudioPlayer(calls, { stateManager: false }));
    ui.playPauseButton = createControlElement(calls, 'play-pause-button');
    ui.timeDisplay = createControlElement(calls, 'time-display');
    ui.seekBar = createControlElement(calls, 'seek-bar');
    ui.trackNameDisplay = createControlElement(calls, 'track-name');

    ui.updatePlayPauseButton();
    ui.updateTimeDisplay();
    ui.updateTrackDisplay();

    assert.ok(calls.some(call => call[0] === 'warn' && call[1].includes('StateManager not available for updatePlayPauseButton')));
    assert.ok(calls.some(call => call[0] === 'warn' && call[1].includes('StateManager not available for updateTimeDisplay')));
    assert.equal(ui.trackNameDisplay.textContent, 'No track loaded');
  });
});

test('playlist display syncs active track and mobile tap starts playback', async () => {
  await withAudioPlayerGlobals({
    windowOptions: {
      uiManager: {
        layoutMode: { isMobile: true }
      }
    }
  }, async ({ calls }) => {
    const player = createAudioPlayer(calls, {
      state: {
        playlist: [
          { name: 'One', path: '/one.wav' },
          { name: 'Two', path: '/two.wav' }
        ],
        currentTrackIndex: 1,
        currentTrack: { name: 'Two', path: '/two.wav' },
        currentBuffer: { id: 'buffer-two' },
        currentTrackPosition: 8,
        isPlaying: false,
        isPaused: true,
        isStopped: false
      }
    });
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();
    let finishResume;
    player.resumeAudioContextInGesture = () => {
      calls.push(['resumeAudioContextInGesture']);
      return new Promise(resolve => { finishResume = resolve; });
    };
    player.stop = async () => {
      calls.push(['stopOldSource']);
      player.stateManager.setState({
        currentBuffer: null,
        currentTrackPosition: 0,
        isPlaying: false,
        isStopped: true
      });
    };
    let finishLoading;
    player.loadTrack = index => {
      calls.push(['loadTrack', index]);
      player.stateManager.setState({
        currentTrackIndex: index,
        currentTrack: player.stateManager.state.playlist[index],
        currentBuffer: null,
        currentTrackPosition: 0
      });
      return new Promise(resolve => {
        finishLoading = value => {
          player.stateManager.setState({ currentBuffer: { id: 'buffer-one' } });
          resolve(value);
        };
      });
    };

    assert.equal(ui.playlistDisplay.parentNode.classList().includes('player-controls'), true);
    assert.equal(ui.playlistDisplay.children.length, 2);
    assert.match(ui.playlistDisplay.children[1].className, /active/);

    const tap = Promise.all(ui.playlistDisplay.children[0].dispatchEvent('click'));
    await Promise.resolve();
    assert.ok(calls.some(call => call[0] === 'loadTrack' && call[1] === 0));
    assert.equal(calls.some(call => call[0] === 'play'), false);
    const pendingState = player.stateManager.getStateSnapshot();
    assert.equal(pendingState.currentTrack.name, 'One');
    assert.equal(pendingState.currentBuffer, null);
    assert.equal(pendingState.currentTrackPosition, 0);
    assert.equal(pendingState.isStopped, true);
    assert.ok(calls.findIndex(call => call[0] === 'resumeAudioContextInGesture') <
      calls.findIndex(call => call[0] === 'stopOldSource'));
    assert.ok(calls.findIndex(call => call[0] === 'stopOldSource') <
      calls.findIndex(call => call[0] === 'loadTrack'));
    finishResume(true);
    await Promise.resolve();
    assert.equal(calls.some(call => call[0] === 'play'), false);
    finishLoading(true);
    await tap;
    assert.deepEqual(calls.find(call => call[0] === 'play'), ['play', false]);
    assert.ok(calls.findIndex(call => call[0] === 'resumeAudioContextInGesture') <
      calls.findIndex(call => call[0] === 'loadTrack'));
  });
});

test('desktop playlist selections carry play intent to the latest generation only', async () => {
  await withAudioPlayerGlobals({
    windowOptions: { uiManager: { layoutMode: { isMobile: false } } }
  }, async ({ calls }) => {
    const player = createAudioPlayer(calls, {
      state: {
        playlist: [
          { name: 'A', path: '/a.wav' },
          { name: 'B', path: '/b.wav' },
          { name: 'C', path: '/c.wav' }
        ],
        currentTrackIndex: 0,
        currentTrack: { name: 'A', path: '/a.wav' },
        currentBuffer: { id: 'buffer-a' },
        isPlaying: true,
        isStopped: false
      }
    });
    const resumeResolvers = [];
    const loadResolvers = new Map();
    player.resumeAudioContextInGesture = () => {
      calls.push(['resumeAudioContextInGesture']);
      return new Promise(resolve => resumeResolvers.push(resolve));
    };
    player.stop = async () => {
      calls.push(['stopOldSource']);
      player.stateManager.setState({
        currentBuffer: null,
        currentTrackPosition: 0,
        isPlaying: false,
        isStopped: true
      });
    };
    player.loadTrack = index => {
      calls.push(['loadTrack', index]);
      player.stateManager.setState({
        currentTrackIndex: index,
        currentTrack: player.stateManager.state.playlist[index],
        currentBuffer: null
      });
      return new Promise(resolve => loadResolvers.set(index, resolve));
    };
    player.play = async userInitiated => {
      calls.push(['play', userInitiated]);
      player.stateManager.setState({ isPlaying: true, isStopped: false });
      return true;
    };
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();

    const [selectB] = ui.playlistDisplay.children[1].dispatchEvent('click');
    const [selectC] = ui.playlistDisplay.children[2].dispatchEvent('click');

    assert.equal(resumeResolvers.length, 2);
    assert.equal(calls.filter(call => call[0] === 'stopOldSource').length, 2);
    assert.equal(player.stateManager.state.currentTrack.name, 'C');
    assert.equal(player.stateManager.state.isStopped, true);

    resumeResolvers[1](true);
    loadResolvers.get(2)(true);
    assert.equal(await selectC, true);
    assert.deepEqual(calls.filter(call => call[0] === 'play'), [['play', false]]);
    assert.equal(player.stateManager.state.currentTrack.name, 'C');
    assert.equal(player.stateManager.state.isPlaying, true);

    resumeResolvers[0](true);
    loadResolvers.get(1)(true);
    assert.equal(await selectB, false);
    assert.deepEqual(calls.filter(call => call[0] === 'play'), [['play', false]]);
    assert.equal(player.stateManager.state.currentTrack.name, 'C');
  });
});

test('latest desktop playlist resume failure wins and an explicit cancel prevents inherited autoplay', async () => {
  await withAudioPlayerGlobals({
    windowOptions: { uiManager: { layoutMode: { isMobile: false } } }
  }, async ({ calls }) => {
    const player = createAudioPlayer(calls, {
      state: {
        playlist: [
          { name: 'A', path: '/a.wav' },
          { name: 'B', path: '/b.wav' },
          { name: 'C', path: '/c.wav' }
        ],
        currentTrackIndex: 0,
        isPlaying: true,
        isStopped: false
      }
    });
    const resumeResolvers = [];
    const loadResolvers = new Map();
    player.resumeAudioContextInGesture = () => {
      calls.push(['resumeAudioContextInGesture']);
      return new Promise(resolve => resumeResolvers.push(resolve));
    };
    player.stop = async () => {
      calls.push(['stopOldSource']);
      player.stateManager.setState({ isPlaying: false, isStopped: true });
    };
    player.loadTrack = index => {
      calls.push(['loadTrack', index]);
      player.stateManager.setState({
        currentTrackIndex: index,
        currentTrack: player.stateManager.state.playlist[index]
      });
      return new Promise(resolve => loadResolvers.set(index, resolve));
    };
    player.play = async () => {
      calls.push(['play']);
      return true;
    };
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();

    const [selectB] = ui.playlistDisplay.children[1].dispatchEvent('click');
    const [selectC] = ui.playlistDisplay.children[2].dispatchEvent('click');
    resumeResolvers[1](false);
    loadResolvers.get(2)(true);
    assert.equal(await selectC, false);
    resumeResolvers[0](true);
    loadResolvers.get(1)(true);
    assert.equal(await selectB, false);
    assert.equal(calls.some(call => call[0] === 'play'), false);
    assert.equal(player.stateManager.state.currentTrack.name, 'C');
    assert.equal(player.stateManager.state.isStopped, true);

    player.stateManager.setState({ isPlaying: true, isStopped: false });
    const [selectBAgain] = ui.playlistDisplay.children[1].dispatchEvent('click');
    ui.cancelPlaylistSelectionIntent();
    player.stateManager.setState({ isPlaying: false, isStopped: true });
    const resumeCountBeforeC = resumeResolvers.length;
    const [selectCAfterStop] = ui.playlistDisplay.children[2].dispatchEvent('click');
    loadResolvers.get(2)(true);
    assert.equal(await selectCAfterStop, true);
    assert.equal(resumeResolvers.length, resumeCountBeforeC);
    resumeResolvers.at(-1)(true);
    loadResolvers.get(1)(true);
    assert.equal(await selectBAgain, false);
    assert.equal(calls.some(call => call[0] === 'play'), false);
  });
});

test('mobile playlist selection stops the old source and reports failure when resume fails', async () => {
  await withAudioPlayerGlobals({
    windowOptions: { uiManager: { layoutMode: { isMobile: true } } }
  }, async ({ calls }) => {
    const player = createAudioPlayer(calls, {
      state: {
        playlist: [
          { name: 'A', path: '/a.wav' },
          { name: 'B', path: '/b.wav' }
        ],
        currentTrackIndex: 0,
        currentTrack: { name: 'A', path: '/a.wav' },
        currentBuffer: { id: 'buffer-a' },
        currentTrackPosition: 19,
        isPlaying: true,
        isStopped: false
      }
    });
    player.resumeAudioContextInGesture = () => {
      calls.push(['resumeAudioContextInGesture']);
      return Promise.resolve(false);
    };
    player.loadTrack = async index => {
      calls.push(['loadTrack', index]);
      player.stateManager.setState({
        currentTrackIndex: index,
        currentTrack: player.stateManager.state.playlist[index],
        currentBuffer: { id: 'buffer-b' },
        currentTrackPosition: 0
      });
      return true;
    };
    player.stop = async () => {
      calls.push(['stopOldSource']);
      player.stateManager.setState({
        isPlaying: false,
        isPaused: false,
        isStopped: true,
        currentTrackPosition: 0
      });
    };
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();

    const [selected] = await Promise.all(ui.playlistDisplay.children[1].dispatchEvent('click'));

    assert.equal(selected, false);
    assert.ok(calls.some(call => call[0] === 'loadTrack' && call[1] === 1));
    assert.ok(calls.some(call => call[0] === 'stopOldSource'));
    assert.equal(calls.some(call => call[0] === 'play'), false);
    const state = player.stateManager.getStateSnapshot();
    assert.equal(state.currentTrack.name, 'B');
    assert.equal(state.currentBuffer.id, 'buffer-b');
    assert.equal(state.currentTrackPosition, 0);
    assert.equal(state.isStopped, true);
  });
});

test('library queue helpers notify now playing and save library queues as playlists', async () => {
  const playlistCreates = [];
  const nowPlaying = [];
  const queueAdds = [];
  await withAudioPlayerGlobals({
    windowOptions: {
      uiManager: {
        libraryView: {
          setNowPlayingTrack(trackId) {
            nowPlaying.push(trackId);
          }
        },
        async ensureLibraryManager() {
          return {
            playlists: {
              async create(name, trackIds) {
                playlistCreates.push([name, trackIds]);
              },
              async list() {
                return [];
              }
            },
            async addToQueue(trackIds) {
              queueAdds.push(trackIds);
            },
            findTrackForPlaybackEntry(track) {
              return track?.path === 'D:/Music/one.flac' ? { id: 'track-one' } : null;
            },
            createPlaylistItemsFromQueueEntries(entries) {
              return entries.map(track => (
                track.libraryTrackId
                  ? { trackId: track.libraryTrackId }
                  : { trackId: null, unresolved: { sourceLine: track.path || track.name, title: track.name } }
              ));
            }
          };
        }
      }
    }
  }, async ({ calls, documentRef }) => {
    const player = createAudioPlayer(calls, {
      state: {
        playlist: [
          { path: 'D:/Music/one.flac', meta: { title: 'One' } },
          { libraryTrackId: 'track-two', meta: { title: 'Two' } },
          { name: 'Loose file' }
        ],
        currentTrackIndex: 1,
        currentTrack: { libraryTrackId: 'track-two', meta: { title: 'Two' } }
      }
    });
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();

    ui.notifyLibraryNowPlaying();
    assert.deepEqual(nowPlaying, ['track-two']);

    await ui.openLibraryTrackMenu({
      preventDefault() {
        calls.push(['preventDefault']);
      },
      clientX: 20,
      clientY: 30
    }, player.stateManager.state.playlist[0]);
    assert.ok(documentRef.body.children.some(child => child.className === 'player-library-context-menu'));
    assert.ok(calls.some(call => call[0] === 'preventDefault'));

    const savePromise = ui.saveQueueAsPlaylist();
    await new Promise(resolve => setImmediate(resolve));
    const promptBackdrop = documentRef.body.children.find(child => child.classList().includes('player-prompt-backdrop'));
    assert.ok(promptBackdrop, 'expected in-app prompt dialog instead of window.prompt');
    const promptInput = promptBackdrop.querySelector('.player-prompt-input');
    assert.equal(promptInput.value, 'T:library.prompt.queuePlaylistName');
    promptInput.value = 'Saved Queue';
    promptBackdrop.querySelector('.player-prompt-dialog').dispatchEvent('submit');
    await savePromise;
    assert.equal(documentRef.body.children.includes(promptBackdrop), false);
    assert.deepEqual(playlistCreates, [['Saved Queue', [
      { trackId: null, unresolved: { sourceLine: 'D:/Music/one.flac', title: undefined } },
      { trackId: 'track-two' },
      { trackId: null, unresolved: { sourceLine: 'Loose file', title: 'Loose file' } }
    ]]]);

    let dragPrevented = 0;
    const dragOver = {
      dataTransfer: {
        types: ['application/x-effetune-library-tracks'],
        dropEffect: ''
      },
      preventDefault() {
        dragPrevented++;
      }
    };
    ui.container.dispatchEvent('dragover', dragOver);
    assert.equal(dragPrevented, 1);
    assert.equal(dragOver.dataTransfer.dropEffect, 'copy');

    let dropPrevented = 0;
    const drop = {
      dataTransfer: {
        types: ['application/x-effetune-library-tracks'],
        getData() {
          return JSON.stringify(['track-one', 'track-two']);
        }
      },
      preventDefault() {
        dropPrevented++;
      }
    };
    await Promise.all(ui.container.dispatchEvent('drop', drop));
    assert.equal(dropPrevented, 1);
    assert.deepEqual(queueAdds, [['track-one', 'track-two']]);
  });
});

test('interval management and removeUI clean up timers, DOM nodes, and references', async () => {
  await withAudioPlayerGlobals({}, async ({ calls, documentRef, frames, timers }) => {
    const player = createAudioPlayer(calls, { state: { isPlaying: true } });
    player.audioContext = { state: 'running' };
    const ui = new AudioPlayerUI(player);
    const container = ui.createPlayerUI();
    const firstInterval = ui.updateInterval;

    assert.equal(timers.has(firstInterval), true);

    ui.updateTimeDisplay = () => calls.push(['manualTick']);
    ui.startUpdateInterval();
    assert.ok(calls.some(call => call[0] === 'clearInterval' && call[1] === firstInterval));
    assert.notEqual(ui.updateInterval, firstInterval);

    timers.get(ui.updateInterval)();
    assert.ok(calls.some(call => call[0] === 'manualTick'));

    ui.stopUpdateInterval();
    assert.equal(ui.updateInterval, null);

    ui.stopUpdateInterval();
    assert.equal(ui.updateInterval, null);

    ui.removeUI();
    const frameCountAfterRemove = frames.length;
    const warningCountAfterRemove = calls.filter(call =>
      call[0] === 'warn' && call[1].includes('Time display')
    ).length;
    player.stateManager.emit('currentTrackPosition', 1);
    player.stateManager.emit('isStopped', true);
    assert.equal(frames.length, frameCountAfterRemove);
    assert.equal(calls.filter(call =>
      call[0] === 'warn' && call[1].includes('Time display')
    ).length, warningCountAfterRemove);
    assert.equal(calls.filter(call => call[0] === 'removeListener').length, 11);
    assert.equal(documentRef.body.children.includes(container), false);
    assert.equal(ui.container, null);
    assert.equal(ui.trackNameDisplay, null);
    assert.equal(ui.seekBar, null);
    assert.equal(ui.timeDisplay, null);
    assert.equal(ui.playPauseButton, null);
    assert.equal(ui.stopButton, null);
    assert.equal(ui.prevButton, null);
    assert.equal(ui.nextButton, null);
    assert.equal(ui.repeatButton, null);
    assert.equal(ui.shuffleButton, null);
    assert.equal(ui.closeButton, null);
    assert.equal(ui.artworkImage, null);
    assert.equal(ui.playlistDisplay, null);

    ui.removeUI();
  });
});
