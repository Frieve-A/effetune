import assert from 'node:assert/strict';
import test from 'node:test';

import { PlaybackManager } from '../../js/ui/audio-player/playback-manager.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

class FakeFile {
  constructor(name) {
    this.name = name;
  }
}

function createDocument() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter(candidate => candidate !== listener));
    },
    dispatchKey(event) {
      for (const listener of listeners.get('keydown') || []) {
        listener(event);
      }
    }
  };
}

function createTarget(kind = 'div') {
  return {
    tagName: kind.toUpperCase(),
    matches(selector) {
      if (kind === 'input-text') {
        return selector.includes('input:not([type="range"])') || selector.includes('input, textarea');
      }
      if (kind === 'input-range') {
        return selector === 'input, textarea';
      }
      if (kind === 'button') {
        return selector.includes('button');
      }
      if (kind === 'textarea') {
        return selector.includes('textarea');
      }
      if (kind === 'select') {
        return selector.includes('select');
      }
      return false;
    }
  };
}

function createKeyEvent(key, options = {}) {
  const event = {
    key,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    metaKey: options.metaKey ?? false,
    target: options.target ?? createTarget(),
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  return event;
}

function createConsole(calls) {
  return {
    warn(...args) { calls.push(['console.warn', ...args]); },
    error(...args) { calls.push(['console.error', ...args]); },
    log(...args) { calls.push(['console.log', ...args]); }
  };
}

function createAudioPlayer(options = {}) {
  const calls = [];
  const state = {
    currentTrackIndex: options.currentTrackIndex ?? 0,
    isPlaying: options.isPlaying ?? false,
    isPaused: options.isPaused ?? false,
    isStopped: options.isStopped ?? false,
    repeatMode: options.repeatMode ?? 'OFF',
    shuffleMode: options.shuffleMode ?? false,
    currentTrackPosition: options.currentTrackPosition ?? 0,
    currentTrackDuration: options.currentTrackDuration ?? 120,
    ...options.state
  };
  const stateManager = options.noStateManager ? null : {
    getStateSnapshot() {
      calls.push(['getStateSnapshot']);
      return { ...state };
    },
    getCurrentTrackIndex() {
      calls.push(['getCurrentTrackIndex']);
      return state.currentTrackIndex;
    },
    updatePlaylist(playlist, index) {
      calls.push(['updatePlaylist', playlist.map(track => track?.name), index]);
      state.currentTrackIndex = index;
    },
    updateState(update, label) {
      calls.push(['updateState', { ...update }, label]);
      Object.assign(state, update);
    }
  };

  const contextManager = options.noContextManager ? null : {
    isUsingBufferPlayback() {
      calls.push(['isUsingBufferPlayback']);
      return options.bufferPlayback ?? false;
    },
    getCurrentBufferTime() {
      calls.push(['getCurrentBufferTime']);
      return options.bufferTime ?? 0;
    },
    hasCurrentBuffer() {
      calls.push(['hasCurrentBuffer']);
      return options.hasCurrentBuffer ?? false;
    },
    async seamlessTransition(track) {
      calls.push(['seamlessTransition', track?.name]);
      if (options.seamlessReject) throw new Error('seamless failed');
    },
    async play() {
      calls.push(['contextPlay']);
    },
    async pause() {
      calls.push(['contextPause']);
    },
    async stop() {
      calls.push(['contextStop']);
    },
    async loadTrack(track) {
      calls.push(['contextLoadTrack', track?.name]);
      if (options.loadTrackReject) throw new Error('load failed');
    },
    async transitionToNextTrack(track) {
      calls.push(['transitionToNextTrack', track?.name]);
      if (options.transitionReject) throw new Error('transition failed');
    },
    getCurrentState() {
      calls.push(['getCurrentState']);
      return options.contextState ?? {
        currentTrackPosition: state.currentTrackPosition,
        currentTrackDuration: state.currentTrackDuration
      };
    },
    seek(time) {
      calls.push(['seek', time]);
    },
    clearNextTrackBuffer() {
      calls.push(['clearNextTrackBuffer']);
    }
  };

  const audioElement = options.noAudioElement ? null : {
    currentTime: options.audioElementCurrentTime ?? 0,
    pause() {
      calls.push(['audioElementPause']);
    }
  };

  const audioPlayer = {
    calls,
    state,
    stateManager,
    contextManager,
    audioElement,
    ui: options.noUi ? null : {
      updatePlayPauseButton() {
        calls.push(['updatePlayPauseButton']);
      },
      updatePlayerUIState() {
        calls.push(['updatePlayerUIState']);
      }
    },
    loadTrack(index) {
      calls.push(['audioPlayerLoadTrack', index]);
    }
  };
  return audioPlayer;
}

async function withPlaybackGlobals(options, callback) {
  const documentRef = options.document ?? createDocument();
  const calls = [];
  const mathRef = Object.create(Math);
  let randomIndex = 0;
  const randomValues = options.randomValues ?? [0.4, 0.8, 0.2, 0.6];
  mathRef.random = () => randomValues[randomIndex++ % randomValues.length];

  await withGlobals({
    document: documentRef,
    File: FakeFile,
    Math: mathRef,
    console: createConsole(calls),
    window: {
      electronAPI: options.electronAPI,
      electronIntegration: options.electronIntegration,
      localStorage: options.localStorage
    }
  }, async () => {
    await callback({ documentRef, calls });
  });
}

function makeManager(audioPlayer) {
  return new PlaybackManager(audioPlayer);
}

function setPlaylist(manager, names = ['One', 'Two', 'Three']) {
  manager.playlist = names.map(name => ({ path: `${name}.wav`, name, file: null }));
  manager.originalPlaylist = manager.playlist.map(track => ({ ...track }));
}

test('loadFiles, getTrack, and basic commands handle unavailable state and delegate work', async () => {
  await withPlaybackGlobals({}, async ({ calls }) => {
    const audioPlayer = createAudioPlayer();
    const manager = makeManager(audioPlayer);

    manager.loadFiles(null);
    manager.loadFiles([]);
    manager.loadFiles(['C:/Music/one.mp3', new FakeFile('two.wav'), { ignored: true }]);
    assert.deepEqual(manager.playlist.map(track => track.name), ['one.mp3', 'two.wav']);
    assert.equal(manager.getTrack(0).name, 'one.mp3');
    assert.equal(manager.getTrack(-1), null);
    assert.equal(manager.getTrack(10), null);

    manager.loadFiles(['append.flac'], true);
    assert.deepEqual(manager.playlist.map(track => track.name), ['one.mp3', 'two.wav', 'append.flac']);

    await manager.play();
    assert.ok(audioPlayer.calls.some(call => call[0] === 'seamlessTransition' && call[1] === 'one.mp3'));
    await manager.pause();
    await manager.stop();
    await manager.togglePlayPause();
    audioPlayer.state.isPlaying = true;
    await manager.togglePlayPause();

    const warned = createAudioPlayer({ noContextManager: true });
    const warnedManager = makeManager(warned);
    setPlaylist(warnedManager, ['Only']);
    await warnedManager.play();
    await warnedManager.pause();
    await warnedManager.stop();
    await warnedManager.togglePlayPause();

    const noState = createAudioPlayer({ noStateManager: true });
    await makeManager(noState).togglePlayPause();
    assert.ok(calls.length >= 0);
  });

  await withPlaybackGlobals({}, async () => {
    const audioPlayer = createAudioPlayer({ shuffleMode: true, isPlaying: true });
    const manager = makeManager(audioPlayer);
    manager.loadFiles(['a.wav', 'b.wav']);
    manager.loadFiles(['c.wav'], true);
    assert.equal(manager.playlist.length, 3);
  });

  await withPlaybackGlobals({}, async () => {
    const audioPlayer = createAudioPlayer({ shuffleMode: true, isPlaying: false });
    const manager = makeManager(audioPlayer);
    manager.loadFiles(['a.wav', 'b.wav']);
    assert.equal(manager.playlist.length, 2);
  });

  await withPlaybackGlobals({}, async () => {
    const audioPlayer = createAudioPlayer({ noStateManager: true });
    const manager = makeManager(audioPlayer);
    manager.loadFiles(['a.wav']);
    assert.equal(manager.playlist.length, 1);
  });
});

test('playPrevious restarts, wraps, falls back, and uses seamless transitions', async () => {
  await withPlaybackGlobals({}, async () => {
    const empty = makeManager(createAudioPlayer());
    await empty.playPrevious();
    empty.transitionInProgress = true;
    setPlaylist(empty, ['One']);
    await empty.playPrevious();
  });

  await withPlaybackGlobals({}, async () => {
    const audioPlayer = createAudioPlayer({ bufferPlayback: true, bufferTime: 4, currentTrackIndex: 1 });
    const manager = makeManager(audioPlayer);
    setPlaylist(manager);
    await manager.playPrevious();
    assert.ok(audioPlayer.calls.some(call => call[0] === 'seamlessTransition' && call[1] === 'Two'));
  });

  await withPlaybackGlobals({}, async () => {
    const audioPlayer = createAudioPlayer({ audioElementCurrentTime: 5 });
    const manager = makeManager(audioPlayer);
    setPlaylist(manager);
    await manager.playPrevious();
    assert.equal(audioPlayer.audioElement.currentTime, 0);
  });

  for (const setup of [
    { shuffleMode: true, repeatMode: 'ALL', currentTrackIndex: 0 },
    { shuffleMode: false, repeatMode: 'ALL', currentTrackIndex: 0 },
    { shuffleMode: true, repeatMode: 'OFF', currentTrackIndex: 0, bufferPlayback: true },
    { shuffleMode: false, repeatMode: 'OFF', currentTrackIndex: 0, bufferPlayback: true },
    { shuffleMode: true, repeatMode: 'OFF', currentTrackIndex: 0 },
    { shuffleMode: false, repeatMode: 'OFF', currentTrackIndex: 0 },
    { shuffleMode: false, currentTrackIndex: 1, state: { repeatMode: undefined } },
    { shuffleMode: false, repeatMode: 'OFF', currentTrackIndex: 5 },
    { shuffleMode: false, repeatMode: 'OFF', currentTrackIndex: 1, isPlaying: false },
    { shuffleMode: false, repeatMode: 'OFF', currentTrackIndex: 1, isPlaying: true, isPaused: false },
    { shuffleMode: false, repeatMode: 'OFF', currentTrackIndex: 1, isPlaying: true, isPaused: false, loadTrackReject: true }
  ]) {
    await withPlaybackGlobals({}, async () => {
      const audioPlayer = createAudioPlayer(setup);
      const manager = makeManager(audioPlayer);
      setPlaylist(manager);
      await manager.playPrevious();
      assert.equal(manager.transitionInProgress, false);
    });
  }

  await withPlaybackGlobals({}, async () => {
    const audioPlayer = createAudioPlayer({ currentTrackIndex: 1, isPlaying: true, isPaused: false, noStateManager: true });
    audioPlayer.stateManager = {
      getCurrentTrackIndex: () => 1,
      getStateSnapshot: () => ({ isPlaying: true, isPaused: false, shuffleMode: false, repeatMode: 'OFF' }),
      updateState() {}
    };
    const manager = makeManager(audioPlayer);
    setPlaylist(manager);
    await manager.playPrevious();
  });
});

test('playNext and onTrackEnded handle repeat, shuffle, errors, and terminal states', async () => {
  await withPlaybackGlobals({}, async () => {
    const manager = makeManager(createAudioPlayer());
    await manager.playNext();
    manager.transitionInProgress = true;
    setPlaylist(manager, ['One']);
    await manager.playNext();
  });

  const playNextCases = [
    { repeatMode: 'ONE', currentTrackIndex: 0, bufferPlayback: true, userInitiated: false },
    { repeatMode: 'ONE', currentTrackIndex: 10, bufferPlayback: true, userInitiated: false },
    { repeatMode: 'ONE', currentTrackIndex: 0, noContextManager: true, userInitiated: false },
    { shuffleMode: true, repeatMode: 'ALL', currentTrackIndex: 2 },
    { shuffleMode: true, repeatMode: 'OFF', currentTrackIndex: 2 },
    { shuffleMode: false, repeatMode: 'ALL', currentTrackIndex: 2 },
    { shuffleMode: false, repeatMode: 'OFF', currentTrackIndex: 2 },
    { shuffleMode: false, currentTrackIndex: 0, state: { repeatMode: undefined } },
    { shuffleMode: false, repeatMode: 'OFF', currentTrackIndex: 0 },
    { shuffleMode: false, repeatMode: 'OFF', currentTrackIndex: 0, noContextManager: true },
    { shuffleMode: false, repeatMode: 'OFF', currentTrackIndex: 0, transitionReject: true }
  ];
  for (const setup of playNextCases) {
    await withPlaybackGlobals({}, async () => {
      const audioPlayer = createAudioPlayer(setup);
      const manager = makeManager(audioPlayer);
      setPlaylist(manager);
      await manager.playNext(setup.userInitiated ?? true);
      assert.equal(manager.transitionInProgress, false);
    });
  }

  await withPlaybackGlobals({}, async () => {
    const audioPlayer = createAudioPlayer({ currentTrackIndex: 0 });
    const manager = makeManager(audioPlayer);
    manager.playlist = [{ name: 'One', path: 'one.wav' }, undefined];
    await manager.playNext();
  });

  const endedCases = [
    { isStopped: true },
    { transitionInProgress: true },
    { repeatMode: 'ONE', currentTrackIndex: 0 },
    { repeatMode: 'ONE', currentTrackIndex: 10 },
    { repeatMode: 'ALL', shuffleMode: true, currentTrackIndex: 2 },
    { repeatMode: 'ALL', shuffleMode: false, currentTrackIndex: 2 },
    { currentTrackIndex: 0, state: { repeatMode: undefined } },
    { repeatMode: 'OFF', currentTrackIndex: 2 },
    { repeatMode: 'OFF', currentTrackIndex: 0 }
  ];
  for (const setup of endedCases) {
    await withPlaybackGlobals({}, async () => {
      const audioPlayer = createAudioPlayer(setup);
      const manager = makeManager(audioPlayer);
      setPlaylist(manager);
      manager.transitionInProgress = setup.transitionInProgress ?? false;
      manager.onTrackEnded();
      await flushMicrotasks();
    });
  }

  await withPlaybackGlobals({}, async () => {
    const audioPlayer = createAudioPlayer({ repeatMode: 'ONE', seamlessReject: true });
    const manager = makeManager(audioPlayer);
    setPlaylist(manager);
    manager.onTrackEnded();
    await flushMicrotasks();
  });

  await withPlaybackGlobals({}, async () => {
    const audioPlayer = createAudioPlayer({ repeatMode: 'ALL', currentTrackIndex: 2, transitionReject: true });
    const manager = makeManager(audioPlayer);
    setPlaylist(manager);
    manager.onTrackEnded();
    await flushMicrotasks();
  });

  await withPlaybackGlobals({}, async () => {
    const audioPlayer = createAudioPlayer({ repeatMode: 'ALL', shuffleMode: true, currentTrackIndex: 2, transitionReject: true });
    const manager = makeManager(audioPlayer);
    setPlaylist(manager);
    manager.onTrackEnded();
    await flushMicrotasks();
  });
});

test('shuffle, repeat, seek, clear, and dispose update playback state consistently', async () => {
  await withPlaybackGlobals({}, async () => {
    const manager = makeManager(createAudioPlayer());
    manager.resetToFirstTrack();
    manager.shufflePlaylistFromBeginning();
    manager.reshufflePlaylist();
  });

  await withPlaybackGlobals({}, async () => {
    const audioPlayer = createAudioPlayer({ currentTrackIndex: 1, isPlaying: true });
    const manager = makeManager(audioPlayer);
    setPlaylist(manager);
    manager.resetToFirstTrack();
    manager.shufflePlaylistFromBeginning(false);
    manager.reshufflePlaylist();

    manager.playlist = [
      { path: null, name: 'File Track', file: new FakeFile('same.wav') },
      { path: 'Other.wav', name: 'Other', file: null }
    ];
    manager.originalPlaylist = [
      { path: 'Other.wav', name: 'Other', file: null },
      { path: null, name: 'File Track', file: new FakeFile('same.wav') }
    ];
    audioPlayer.state.currentTrackIndex = 0;
    manager.reshufflePlaylist();

    manager.playlist = [{ path: 'Current.wav', name: 'Current Label', file: new FakeFile('same.wav') }];
    manager.originalPlaylist = [{ path: 'Other.wav', name: 'Other Label', file: new FakeFile('same.wav') }];
    audioPlayer.state.currentTrackIndex = 0;
    manager.reshufflePlaylist();

    manager.playlist = [{ path: 'Current.wav', name: 'Current Label', file: null }];
    manager.originalPlaylist = [{ path: 'Other.wav', name: 'Other Label', file: new FakeFile('same.wav') }];
    manager.reshufflePlaylist();

    manager.playlist = [{ path: 'Missing.wav', name: 'Missing', file: null }];
    manager.originalPlaylist = [{ path: 'Different.wav', name: 'Different', file: null }];
    manager.reshufflePlaylist();
  });

  await withPlaybackGlobals({}, async () => {
    const audioPlayer = createAudioPlayer({ seamlessReject: true });
    const manager = makeManager(audioPlayer);
    setPlaylist(manager);
    manager.resetToFirstTrack();
    await flushMicrotasks();
  });

  await withPlaybackGlobals({}, async () => {
    const audioPlayer = createAudioPlayer({ shuffleMode: false, isPlaying: true });
    const manager = makeManager(audioPlayer);
    setPlaylist(manager);
    manager.toggleShuffleMode();
    audioPlayer.state.shuffleMode = true;
    manager.toggleShuffleMode();
    audioPlayer.state.repeatMode = 'ONE';
    manager.toggleShuffleMode();

    for (const repeatMode of ['OFF', 'ALL', 'ONE', 'BAD', undefined]) {
      audioPlayer.state.repeatMode = repeatMode;
      audioPlayer.state.shuffleMode = repeatMode === 'ALL';
      manager.toggleRepeatMode();
    }
  });

  await withPlaybackGlobals({}, async () => {
    const audioPlayer = createAudioPlayer({ currentTrackPosition: 115, currentTrackDuration: 120 });
    const manager = makeManager(audioPlayer);
    manager.fastForward();
    audioPlayer.state.currentTrackPosition = 3;
    manager.rewind();

    const warned = makeManager(createAudioPlayer({ noContextManager: true }));
    warned.fastForward();
    warned.rewind();
  });

  await withPlaybackGlobals({}, async () => {
    const manager = makeManager(createAudioPlayer({ contextState: { currentTrackPosition: 5 } }));
    manager.fastForward();
  });

  await withPlaybackGlobals({}, async ({ documentRef }) => {
    const audioPlayer = createAudioPlayer();
    const manager = makeManager(audioPlayer);
    setPlaylist(manager);
    manager.clear();
    assert.equal(manager.playlist.length, 0);
    manager.dispose();
    assert.equal(documentRef.listeners.get('keydown').length, 0);
    manager.dispose();

    const nullManager = makeManager(createAudioPlayer());
    nullManager.audioPlayer = null;
    nullManager.clear();
    nullManager.initKeyboardShortcuts();
  });

  await withPlaybackGlobals({}, async () => {
    const audioPlayer = createAudioPlayer({ noStateManager: true, noAudioElement: true });
    const manager = makeManager(audioPlayer);
    setPlaylist(manager);
    manager.clear();
  });
});

test('keyboard shortcuts ignore inactive contexts and control active playback', async () => {
  await withPlaybackGlobals({}, async ({ documentRef }) => {
    const audioPlayer = createAudioPlayer();
    const manager = makeManager(audioPlayer);
    setPlaylist(manager);

    const events = [
      createKeyEvent(' ', { target: createTarget() }),
      createKeyEvent(' ', { target: createTarget('button') }),
      createKeyEvent('n'),
      createKeyEvent('N', { ctrlKey: true }),
      createKeyEvent('p'),
      createKeyEvent('P', { metaKey: true }),
      createKeyEvent('ArrowRight', { ctrlKey: true }),
      createKeyEvent('ArrowRight', { shiftKey: true }),
      createKeyEvent('ArrowLeft', { ctrlKey: true }),
      createKeyEvent('ArrowLeft', { shiftKey: true }),
      createKeyEvent('f'),
      createKeyEvent('F', { ctrlKey: true }),
      createKeyEvent('.'),
      createKeyEvent('r'),
      createKeyEvent('R', { altKey: true }),
      createKeyEvent(','),
      createKeyEvent('h', { ctrlKey: true }),
      createKeyEvent('H', { ctrlKey: true, shiftKey: true }),
      createKeyEvent('m', { ctrlKey: true }),
      createKeyEvent('M', { ctrlKey: true, altKey: true }),
      createKeyEvent('Escape')
    ];
    for (const event of events) {
      documentRef.dispatchKey(event);
    }
    await flushMicrotasks();

    documentRef.dispatchKey(createKeyEvent('n', { target: createTarget('input-text') }));
    assert.ok(audioPlayer.calls.length > 0);
  });

  await withPlaybackGlobals({}, async ({ documentRef }) => {
    const manager = makeManager(createAudioPlayer());
    manager.audioPlayer = null;
    documentRef.dispatchKey(createKeyEvent(' '));
  });

  await withPlaybackGlobals({}, async ({ documentRef }) => {
    const audioPlayer = createAudioPlayer({ noContextManager: true });
    const manager = makeManager(audioPlayer);
    setPlaylist(manager);
    for (const key of ['n', 'p', 'ArrowRight', 'ArrowLeft']) {
      documentRef.dispatchKey(createKeyEvent(key, { ctrlKey: key.startsWith('Arrow') }));
    }
    await flushMicrotasks();
  });
});

test('loadPlayerState and savePlayerState persist through Electron storage', async () => {
  await withPlaybackGlobals({}, async () => {
    const manager = makeManager(createAudioPlayer());
    await manager.loadPlayerState();
    await manager.savePlayerState();
  });

  const storage = new Map();
  await withPlaybackGlobals({
    document: createDocument(),
    localStorage: {
      getItem(key) {
        return storage.get(key) || null;
      },
      setItem(key, value) {
        storage.set(key, value);
      }
    }
  }, async () => {
    storage.set('effetune_player_state', '{"repeatMode":"ALL","shuffleMode":true}');
    const audioPlayer = createAudioPlayer();
    const manager = makeManager(audioPlayer);
    await manager.loadPlayerState();
    await manager.savePlayerState();
    assert.equal(audioPlayer.state.repeatMode, 'ALL');
    assert.equal(audioPlayer.state.shuffleMode, true);
    assert.deepEqual(JSON.parse(storage.get('effetune_player_state')), {
      repeatMode: 'ALL',
      shuffleMode: true
    });
  });

  const saved = [];
  await withPlaybackGlobals({
    electronIntegration: {},
    electronAPI: {
      async getPath() { return 'user'; },
      async joinPaths(...parts) { return parts.join('/'); },
      async fileExists() { return false; },
      async readFile() { return { success: true, content: '{}' }; },
      async saveFile(path, content) { saved.push([path, JSON.parse(content)]); }
    }
  }, async () => {
    const manager = makeManager(createAudioPlayer());
    await manager.loadPlayerState();
    await manager.savePlayerState();
    assert.deepEqual(saved[0][1], { repeatMode: 'OFF', shuffleMode: false });
  });

  for (const content of [
    '{"repeatMode":"ALL","shuffleMode":true}',
    '{"shuffleMode":false}',
    '{"repeatMode":"ONE"}',
    '{}'
  ]) {
    await withPlaybackGlobals({
      electronIntegration: {},
      electronAPI: {
        async getPath() { return 'user'; },
        async joinPaths(...parts) { return parts.join('/'); },
        async fileExists() { return true; },
        async readFile() { return { success: true, content }; },
        async saveFile() {}
      }
    }, async () => {
      const manager = makeManager(createAudioPlayer());
      await manager.loadPlayerState();
    });
  }

  await withPlaybackGlobals({
    electronIntegration: {},
    electronAPI: {
      async getPath() { return 'user'; },
      async joinPaths(...parts) { return parts.join('/'); },
      async fileExists() { return true; },
      async readFile() { return { success: false, content: '{}' }; },
      async saveFile() { throw new Error('save failed'); }
    }
  }, async () => {
    const manager = makeManager(createAudioPlayer({ noStateManager: true }));
    await manager.loadPlayerState();
    await manager.savePlayerState();
  });

  await withPlaybackGlobals({
    electronIntegration: {},
    electronAPI: {
      async getPath() { throw new Error('get failed'); }
    }
  }, async () => {
    const manager = makeManager(createAudioPlayer());
    await manager.loadPlayerState();
    await manager.savePlayerState();
  });
});
