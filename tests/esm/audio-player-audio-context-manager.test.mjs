import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioContextManager } from '../../js/ui/audio-player/audio-context-manager.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

class FakeFile {
  constructor(name, buffer = new Uint8Array([1, 2, 3]).buffer) {
    this.name = name;
    this._buffer = buffer;
  }

  async arrayBuffer() {
    return this._buffer;
  }
}

class FakeAudioElement {
  static calls = [];
  static nextOptions = [];
  static instances = [];

  constructor() {
    const options = FakeAudioElement.nextOptions.shift() ?? {};
    this.listeners = new Map();
    this.src = options.src ?? '';
    this._currentTime = options.currentTime ?? 0;
    this.throwOnCurrentTimeSet = options.throwOnCurrentTimeSet ?? false;
    this.duration = options.duration ?? 12;
    this.readyState = options.readyState ?? 1;
    this.paused = options.paused ?? true;
    this.title = options.title ?? '';
    this.error = options.error ?? null;
    this.playReject = options.playReject ?? null;
    this.pauseThrows = options.pauseThrows ?? false;
    FakeAudioElement.instances.push(this);
  }

  get currentTime() {
    return this._currentTime;
  }

  set currentTime(value) {
    if (this.throwOnCurrentTimeSet) throw new Error('currentTime set failed');
    this._currentTime = value;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
    FakeAudioElement.calls.push(['audio.addEventListener', type]);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(candidate => candidate !== listener));
    FakeAudioElement.calls.push(['audio.removeEventListener', type]);
  }

  dispatch(type, event = { target: this }) {
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
  }

  load() {
    FakeAudioElement.calls.push(['audio.load', this.src]);
  }

  async play() {
    FakeAudioElement.calls.push(['audio.play', this.src]);
    if (this.playReject) throw this.playReject;
    this.paused = false;
  }

  pause() {
    FakeAudioElement.calls.push(['audio.pause', this.src]);
    if (this.pauseThrows) throw new Error('pause failed');
    this.paused = true;
  }
}

function createNode(calls, name, options = {}) {
  return {
    name,
    buffer: null,
    onended: null,
    gain: { value: 1 },
    connect(target) {
      calls.push(['node.connect', name, target?.name]);
      if (options.connectThrows) throw new Error(`${name} connect failed`);
    },
    disconnect() {
      calls.push(['node.disconnect', name]);
      if (options.disconnectThrows) throw new Error(`${name} disconnect failed`);
    },
    start(...args) {
      calls.push(['node.start', name, ...args]);
      if (options.startThrows) throw new Error(`${name} start failed`);
    },
    stop() {
      calls.push(['node.stop', name]);
      if (options.stopThrows) throw new Error(`${name} stop failed`);
    }
  };
}

function createAudioContext(calls, options = {}) {
  return {
    currentTime: options.currentTime ?? 10,
    sampleRate: 48000,
    createGain() {
      calls.push(['audioContext.createGain']);
      if (options.createGainThrows) throw new Error('createGain failed');
      return createNode(calls, 'gain', options.gainOptions);
    },
    createBufferSource() {
      calls.push(['audioContext.createBufferSource']);
      return createNode(calls, `bufferSource${calls.length}`, options.bufferSourceOptions);
    },
    createMediaElementSource(element) {
      calls.push(['audioContext.createMediaElementSource', element.src]);
      const error = options.mediaElementSourceErrors?.shift();
      if (error) throw error;
      return createNode(calls, 'mediaSource', options.mediaSourceOptions);
    },
    decodeAudioData(arrayBuffer, resolve, reject) {
      calls.push(['audioContext.decodeAudioData', arrayBuffer.byteLength]);
      if (options.decodeReject) reject(new Error('decode failed'));
      else resolve(options.decodedBuffer ?? { duration: options.duration ?? 20 });
    }
  };
}

function createMediaSession(calls) {
  const handlers = new Map();
  return {
    handlers,
    metadata: null,
    playbackState: 'none',
    setActionHandler(action, handler) {
      calls.push(['mediaSession.setActionHandler', action, handler === null ? null : 'handler']);
      if (handler) handlers.set(action, handler);
      else handlers.delete(action);
    }
  };
}

async function withAudioContextGlobals(options = {}, callback) {
  const calls = [];
  const timers = [];
  const intervals = new Map();
  const objectUrls = [];
  const mediaSession = createMediaSession(calls);

  FakeAudioElement.calls = calls;
  FakeAudioElement.nextOptions = [...(options.audioElements ?? [])];
  FakeAudioElement.instances = [];

  const globals = {
    Audio: FakeAudioElement,
    File: FakeFile,
    MediaError: { MEDIA_ERR_SRC_NOT_SUPPORTED: 4 },
    MediaMetadata: class {
      constructor(metadata) {
        this.metadata = metadata;
        calls.push(['MediaMetadata', metadata]);
      }
    },
    navigator: options.navigator ?? { mediaSession },
    window: {
      electronIntegration: options.electronIntegration ?? {},
      electronAPI: options.electronAPI ?? null,
      jsmediatags: options.jsmediatags,
      uiManager: options.uiManager
    },
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
    fetch: async url => {
      calls.push(['fetch', url]);
      if (options.fetchReject) throw new Error('fetch failed');
      const response = options.fetchResponse ?? { ok: true, statusText: 'OK', buffer: new Uint8Array([4, 5]).buffer };
      return {
        ok: response.ok,
        statusText: response.statusText,
        async arrayBuffer() {
          calls.push(['fetch.arrayBuffer']);
          return response.buffer;
        }
      };
    },
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    setTimeout(fn, delay) {
      timers.push({ fn, delay });
      return timers.length;
    },
    clearTimeout(id) {
      calls.push(['clearTimeout', id]);
    },
    setInterval(fn, delay) {
      const id = intervals.size + 1;
      intervals.set(id, fn);
      calls.push(['setInterval', delay, id]);
      return id;
    },
    clearInterval(id) {
      calls.push(['clearInterval', id]);
      intervals.delete(id);
    },
    console: {
      ...console,
      warn(...args) { calls.push(['console.warn', ...args]); },
      error(...args) { calls.push(['console.error', ...args]); }
    }
  };

  return withGlobals(globals, async () => callback({
    calls,
    intervals,
    mediaSession,
    objectUrls,
    timers
  }));
}

function createHarness(options = {}) {
  const calls = options.calls ?? [];
  const state = {
    currentTrack: options.currentTrack ?? null,
    currentTrackIndex: options.currentTrackIndex ?? 0,
    currentTrackName: options.currentTrackName ?? '',
    currentTrackDuration: options.currentTrackDuration ?? 20,
    currentTrackPosition: options.currentTrackPosition ?? 0,
    isPlaying: options.isPlaying ?? false,
    isPaused: options.isPaused ?? false,
    isStopped: options.isStopped ?? false,
    isTransitioning: options.isTransitioning ?? false,
    playbackMode: options.playbackMode ?? 'bufferSource',
    repeatMode: options.repeatMode ?? 'OFF',
    shuffleMode: false,
    ...options.state
  };
  const playlist = options.playlist ?? [
    { name: 'One', path: '/one.wav' },
    { name: 'Two', path: '/two.wav' }
  ];
  const audioContext = options.audioContext ?? createAudioContext(calls, options.audioContextOptions);
  const originalSource = options.noOriginalSource ? null : createNode(calls, 'originalSource', options.originalSourceOptions);
  const workletNode = options.noWorklet ? null : createNode(calls, 'worklet');
  const ioManager = options.noIoManager ? null : { sourceNode: originalSource };
  const audioManager = {
    audioContext,
    sourceNode: originalSource,
    ioManager,
    workletNode,
    connectSourceToPipeline(source) {
      calls.push(['connectSourceToPipeline', source?.name]);
      if (options.connectSourceThrows) throw new Error('connect pipeline failed');
      if (options.connectSourceThrowsOnce) {
        options.connectSourceThrowsOnce = false;
        throw new Error('connect once failed');
      }
    },
    ...options.audioManager
  };
  const stateManager = options.noStateManager ? null : {
    getStateSnapshot() {
      calls.push(['state.getSnapshot']);
      return { ...state };
    },
    getCurrentTrackIndex() {
      calls.push(['state.getCurrentTrackIndex']);
      return state.currentTrackIndex;
    },
    getNextTrack() {
      calls.push(['state.getNextTrack']);
      const nextIndex = state.currentTrackIndex + 1;
      return playlist[nextIndex] ?? (state.repeatMode === 'ALL' ? playlist[0] : null);
    },
    updateState(updates, message) {
      calls.push(['state.updateState', { ...updates }, message]);
      Object.assign(state, updates);
    }
  };
  const playbackManager = options.noPlaybackManager ? null : {
    playlist,
    currentTrackIndex: options.playbackCurrentIndex ?? state.currentTrackIndex,
    getTrack(index) {
      calls.push(['playback.getTrack', index]);
      return playlist[index] ?? null;
    },
    onTrackEnded() {
      calls.push(['playback.onTrackEnded']);
    }
  };
  const audioPlayer = {
    audioContext,
    audioElement: options.audioElement ?? null,
    stateManager,
    playbackManager,
    ui: options.noUi ? null : { trackNameDisplay: { textContent: '' } },
    playNext() {
      calls.push(['audioPlayer.playNext']);
    },
    playPrevious() {
      calls.push(['audioPlayer.playPrevious']);
    }
  };
  const manager = new AudioContextManager(audioPlayer, audioManager);
  return { audioContext, audioManager, audioPlayer, calls, manager, playlist, state };
}

function runTimers(timers) {
  timers.splice(0).forEach(timer => timer.fn());
}

test('core graph connections and source management preserve playback wiring', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const harness = createHarness({ calls });
    const { audioManager, manager } = harness;

    const silentGain = manager.createSilentGain();
    assert.equal(silentGain.gain.value, 0);
    manager.setManagedSourceNode(silentGain);
    assert.equal(audioManager.sourceNode, silentGain);
    assert.equal(audioManager.ioManager.sourceNode, silentGain);

    manager.connectBufferSource(createNode(calls, 'bufferA'));
    assert.equal(calls.some(call => call[0] === 'connectSourceToPipeline' && call[1] === 'bufferA'), true);

    window.electronIntegration.audioPreferences = { useInputWithPlayer: true };
    manager.connectBufferSource(createNode(calls, 'bufferB'));
    assert.equal(calls.some(call => call[0] === 'connectSourceToPipeline' && call[1] === 'bufferB'), true);

    const noWorklet = createHarness({ calls, noWorklet: true });
    noWorklet.manager.connectBufferSource(createNode(calls, 'bufferC'));
    assert.equal(calls.some(call => call[0] === 'console.warn'), true);

    const mediaSource = createNode(calls, 'mediaA');
    window.electronIntegration.audioPreferences = { useInputWithPlayer: false };
    const retryHarness = createHarness({ calls, connectSourceThrowsOnce: true });
    retryHarness.manager.connectMediaSource(mediaSource);
    assert.equal(calls.filter(call => call[0] === 'connectSourceToPipeline' && call[1] === 'mediaA').length, 2);

    const innerFail = createHarness({ calls, connectSourceThrows: true });
    innerFail.manager.connectMediaSource(createNode(calls, 'mediaB', { disconnectThrows: true }));

    window.electronIntegration.audioPreferences = { useInputWithPlayer: false };
    const maintained = createHarness({ calls });
    maintained.manager.maintainSilentSource();
    assert.equal(calls.some(call => call[0] === 'audioContext.createGain'), true);

    window.electronIntegration.audioPreferences = { useInputWithPlayer: true };
    maintained.manager.maintainSilentSource();

    const failingGain = createHarness({ calls, audioContextOptions: { createGainThrows: true } });
    assert.equal(failingGain.manager.createSilentGain(), null);
  });
});

test('buffer source lifecycle and graph rebuilds keep playback recoverable', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const harness = createHarness({ calls, state: { isStopped: false } });
    const { audioPlayer, manager, playlist, state } = harness;

    manager.handleTrackEnded = () => calls.push(['manager.handleTrackEnded']);
    manager.currentInstanceId = 7;
    const bufferSource = manager.createBufferSource({ duration: 8 }, 7);
    bufferSource.onended();
    assert.equal(calls.some(call => call[0] === 'manager.handleTrackEnded'), true);

    state.isStopped = true;
    bufferSource.onended();
    state.isStopped = false;
    state.isTransitioning = true;
    bufferSource.onended();

    manager.currentBufferSource = createNode(calls, 'currentBufferSource');
    manager.mediaSource = createNode(calls, 'mediaSource');
    audioPlayer.audioElement = new Audio();
    manager.bufferMonitoringInterval = 9;
    manager.detachCurrentGraphNodesForRebind();
    assert.equal(manager.currentBufferSource, null);
    assert.equal(manager.mediaSource, null);
    assert.equal(manager.currentInstanceId, 8);

    manager.setupEventHandlers();
    manager.detachAudioElementForGraphRebuild();
    assert.equal(audioPlayer.audioElement, null);

    manager.currentBufferSource = createNode(calls, 'rebindingBuffer');
    manager.bufferDuration = 5;
    manager.bufferStartTime = 7;
    assert.equal(manager.getPlaybackPositionForGraphRebind({ playbackMode: 'bufferSource', currentTrackDuration: 5 }), 3);
    audioPlayer.audioElement = new Audio();
    audioPlayer.audioElement.currentTime = 4;
    assert.equal(manager.getPlaybackPositionForGraphRebind({ playbackMode: 'audioElement' }), 4);
    assert.equal(manager.getPlaybackPositionForGraphRebind({ currentTrackPosition: -3 }), 0);

    assert.equal(manager.getTrackForGraphRebind({ currentTrack: playlist[1] }), playlist[1]);
    assert.equal(manager.getTrackForGraphRebind({}), playlist[0]);
    harness.state.currentTrackIndex = -1;
    assert.equal(manager.getTrackForGraphRebind({}), null);

    const noContext = createHarness({ calls, audioManager: { audioContext: null } });
    await noContext.manager.handleAudioGraphRebuilt();

    const noTrack = createHarness({ calls, currentTrackIndex: -1 });
    await noTrack.manager.handleAudioGraphRebuilt();
    assert.equal(noTrack.state.isTransitioning, false);

    const success = createHarness({
      calls,
      currentTrackIndex: 0,
      isPlaying: true,
      state: { currentTrack: playlist[0], playbackMode: 'bufferSource', currentTrackPosition: 2 }
    });
    success.manager.prepareTrackBuffer = async () => ({ duration: 10 });
    success.manager.playBufferSource = async () => calls.push(['playBufferSource']);
    success.manager.prepareNextTrackBufferWithRepeatMode = () => calls.push(['prepareNext']);
    await success.manager.handleAudioGraphRebuilt();
    assert.equal(calls.some(call => call[0] === 'playBufferSource'), true);

    const fallback = createHarness({
      calls,
      currentTrackIndex: 0,
      isPaused: true,
      state: { currentTrack: playlist[0], playbackMode: 'bufferSource', currentTrackPosition: 30 },
      audioElements: [{ readyState: 0, duration: 5 }]
    });
    fallback.manager.prepareTrackBuffer = async () => { throw new Error('decode failed'); };
    await fallback.manager.handleAudioGraphRebuilt();
    const reboundElement = fallback.audioPlayer.audioElement;
    reboundElement.dispatch('loadedmetadata');
    assert.equal(reboundElement.currentTime, 12);
  });
});

test('audio element setup, metadata, media session, and fallback naming stay synchronized', async () => {
  await withAudioContextGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {},
    jsmediatags: {
      read(input, handlers) {
        if (String(input?.name ?? input).includes('bad')) {
          handlers.onError({ type: 'io' });
        } else {
          handlers.onSuccess({ tags: { title: 'Title', artist: 'Artist', album: 'Album' } });
        }
      }
    },
    uiManager: { setError: message => void message }
  }, async ({ calls, mediaSession, objectUrls, timers }) => {
    const harness = createHarness({ calls });
    const { audioPlayer, manager, state } = harness;
    const fileTrack = { name: 'File Track', file: new FakeFile('song.mp3') };

    manager.currentObjectURL = 'blob:old';
    manager.setupAudioElement(fileTrack);
    assert.equal(objectUrls.some(call => call[0] === 'revoke' && call[1] === 'blob:old'), true);
    assert.equal(audioPlayer.audioElement.src, 'blob:song.mp3');
    assert.equal(audioPlayer.ui.trackNameDisplay.textContent, 'Artist - Title');
    assert.equal(mediaSession.metadata.metadata.title, 'Title');

    audioPlayer.audioElement.currentTime = 3;
    state.playbackMode = 'audioElement';
    audioPlayer.audioElement.dispatch('timeupdate');
    assert.equal(state.currentTrackPosition, 3);

    audioPlayer.audioElement.error = { code: 1, message: 'broken' };
    window.uiManager = { setError: message => calls.push(['ui.setError', message]) };
    audioPlayer.audioElement.dispatch('error', { target: audioPlayer.audioElement });
    assert.equal(calls.some(call => call[0] === 'ui.setError'), true);
    audioPlayer.audioElement.error = { code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED, message: 'unsupported' };
    audioPlayer.audioElement.dispatch('error', { target: audioPlayer.audioElement });

    state.isStopped = false;
    manager.handleTrackEnded = () => calls.push(['element.ended']);
    audioPlayer.audioElement.dispatch('ended');
    assert.equal(calls.some(call => call[0] === 'element.ended'), true);
    audioPlayer.audioElement.duration = 33;
    audioPlayer.audioElement.dispatch('loadedmetadata');
    assert.equal(state.currentTrackDuration, 33);

    manager.setupAudioElement({ name: 'Path Track', path: 'C:\\Music\\song.wav' });
    assert.equal(audioPlayer.audioElement.src, 'file://C:/Music/song.wav');
    manager.setupAudioElement({ name: 'No Source' });

    manager.readID3Tags(new FakeFile('bad.mp3'), 0);
    manager.readID3Tags(new FakeFile('tag.mp3'), 2);

    manager.tryReadFromAudioElementSrc({ name: 'Src Track' }, 0);
    runTimers(timers);
    assert.equal(audioPlayer.ui.trackNameDisplay.textContent, 'Artist - Title');

    window.jsmediatags = {
      read() {
        throw new Error('tag read failed');
      }
    };
    manager.tryReadFromAudioElementSrc({ name: 'Src Fallback' }, 0);
    runTimers(timers);

    window.jsmediatags = null;
    audioPlayer.audioElement.title = 'Element Title';
    manager.fallbackToMediaSession(0);
    assert.equal(audioPlayer.ui.trackNameDisplay.textContent, 'Element Title');
    audioPlayer.audioElement.title = '';
    manager.fallbackToMediaSession(0);
    assert.equal(audioPlayer.ui.trackNameDisplay.textContent, 'One');
    manager.fallbackToMediaSession(99);
    audioPlayer.audioElement = null;
    manager.fallbackToMediaSession(0);
    manager.updateTrackNameFromMetadata();

    for (const action of ['play', 'pause', 'nexttrack', 'previoustrack', 'stop', 'seekto']) {
      assert.equal(mediaSession.handlers.has(action), true);
    }
    mediaSession.handlers.get('play')();
    mediaSession.handlers.get('pause')();
    mediaSession.handlers.get('nexttrack')();
    mediaSession.handlers.get('previoustrack')();
    mediaSession.handlers.get('stop')();
    mediaSession.handlers.get('seekto')({ seekTime: 4 });
    mediaSession.handlers.get('seekto')({});
  });
});

test('playback controls operate on buffer sources and audio elements', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const harness = createHarness({ calls, playbackMode: 'bufferSource', isPaused: true, currentTrackPosition: 2 });
    const { audioPlayer, manager, state } = harness;
    manager.currentBuffer = { duration: 10 };

    state.isTransitioning = true;
    await manager.play();
    await manager.pause();
    await manager.seek(3);
    state.isTransitioning = false;

    await manager.play();
    assert.equal(state.isPlaying, true);
    audioPlayer.audioContext.currentTime = 14;
    await manager.pauseBufferSource();
    assert.equal(state.isPaused, true);

    await manager.playBufferSource();
    await manager.stop();
    assert.equal(state.isStopped, true);

    await manager.seekBufferSource(99);
    assert.equal(state.currentTrackPosition, 10);

    const failingStart = createHarness({
      calls,
      playbackMode: 'bufferSource',
      audioContextOptions: { bufferSourceOptions: { startThrows: true } }
    });
    failingStart.manager.currentBuffer = { duration: 10 };
    await failingStart.manager.playBufferSource();
    await failingStart.manager.seekBufferSource(1);

    const noBuffer = createHarness({ calls, playbackMode: 'bufferSource' });
    await noBuffer.manager.playBufferSource();
    await noBuffer.manager.seekBufferSource(1);

    const audioElement = new Audio();
    const elementHarness = createHarness({ calls, playbackMode: 'audioElement', audioElement });
    await elementHarness.manager.play();
    await elementHarness.manager.pause();
    await elementHarness.manager.seek(6);
    await elementHarness.manager.stop();
    assert.equal(elementHarness.state.currentTrackPosition, 0);

    const rejectElement = new Audio();
    rejectElement.playReject = new Error('play failed');
    const rejectHarness = createHarness({ calls, playbackMode: 'audioElement', audioElement: rejectElement });
    await rejectHarness.manager.playAudioElement();
    assert.equal(rejectHarness.state.isPaused, true);
    await createHarness({ calls, playbackMode: 'audioElement', audioElement: null }).manager.playAudioElement();
  });
});

test('track-ended handling, monitoring, and load helpers advance playback state', async () => {
  await withAudioContextGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async readFile(path, asBuffer) {
        if (path.includes('missing')) return { success: false, error: 'missing' };
        assert.equal(asBuffer, true);
        return { success: true, content: Buffer.from('abc').toString('base64') };
      }
    },
    fetchResponse: { ok: true, statusText: 'OK', buffer: new Uint8Array([9]).buffer }
  }, async ({ calls, intervals }) => {
    const playlist = [
      { name: 'One', path: '/one.wav' },
      { name: 'Two', path: '/two.wav' }
    ];
    const harness = createHarness({ calls, playlist, currentTrackIndex: 1, repeatMode: 'ALL' });
    const { manager, state } = harness;

    manager.seamlessTransition = async track => calls.push(['seamlessTransition', track.name]);
    state.repeatMode = 'ONE';
    manager.handleTrackEnded();
    assert.equal(calls.some(call => call[0] === 'seamlessTransition'), true);

    state.repeatMode = 'ALL';
    manager.transitionToNextTrack = async track => calls.push(['transitionToNextTrack', track.name]);
    manager.handleTrackEnded();
    assert.equal(state.currentTrackIndex, 0);

    state.repeatMode = 'OFF';
    state.currentTrackIndex = 1;
    manager.prepareTrackBuffer = async track => ({ duration: track.name.length });
    manager.prepareNextTrackBufferWithRepeatMode = () => calls.push(['prepareNext']);
    manager.handleTrackEnded();
    await flushMicrotasks();
    assert.equal(state.isStopped, true);

    const noPlaylist = createHarness({ calls, playlist: [], currentTrackIndex: 0, repeatMode: 'OFF' });
    noPlaylist.manager.handleTrackEnded();
    assert.equal(noPlaylist.state.currentTrack, null);

    const middle = createHarness({ calls, playlist, currentTrackIndex: 0, repeatMode: 'OFF' });
    middle.manager.handleTrackEnded();
    assert.equal(calls.some(call => call[0] === 'playback.onTrackEnded'), true);

    state.isPlaying = true;
    state.isStopped = false;
    state.isTransitioning = false;
    manager.currentBuffer = { duration: 10 };
    manager.currentBufferSource = createNode(calls, 'monitorSource');
    manager.bufferStartTime = 0;
    manager.bufferDuration = 10;
    manager.audioPlayer.audioContext.currentTime = 9.95;
    manager.handleTrackEnded = () => calls.push(['monitor.handleTrackEnded']);
    manager.setupBufferMonitoring();
    [...intervals.values()][0]();
    assert.equal(calls.some(call => call[0] === 'monitor.handleTrackEnded'), true);
    state.isPlaying = false;
    state.isStopped = true;
    state.currentTrackDuration = 10;
    state.currentTrackPosition = 2;
    [...intervals.values()][0]();
    manager.currentBuffer = null;
    [...intervals.values()][0]();

    assert.equal(manager.shouldUseElectronFileRead('C:\\song.wav'), true);
    assert.equal(manager.shouldUseElectronFileRead('file:///song.wav'), false);
    assert.equal(manager.shouldUseElectronFileRead('/song.wav'), true);
    assert.equal(manager.shouldUseElectronFileRead('folder\\song.wav'), true);
    assert.equal(manager.shouldUseElectronFileRead(42), false);
    assert.equal(new Uint8Array(manager.base64ToArrayBuffer(Buffer.from('x').toString('base64')))[0], 120);

    const fileBuffer = await manager.loadTrackData({ name: 'File', file: new FakeFile('file.wav') });
    assert.equal(fileBuffer.byteLength, 3);
    assert.equal((await manager.loadTrackData({ name: 'Local', path: 'C:\\song.wav' })).byteLength, 3);
    await assert.rejects(() => manager.loadTrackData({ name: 'Missing', path: 'C:\\missing.wav' }));
    assert.equal((await manager.loadTrackData({ name: 'Remote', path: 'https://example.test/a.wav' })).byteLength, 1);
    await assert.rejects(() => manager.loadTrackData({ name: 'Invalid' }));

    const decodeHarness = createHarness({ calls, audioContextOptions: { decodeReject: true } });
    await assert.rejects(() => decodeHarness.manager.prepareTrackBuffer({ name: 'Bad', file: new FakeFile('bad.wav') }));

    const loadHarness = createHarness({ calls, playlist, currentTrackIndex: 0 });
    loadHarness.manager.prepareTrackBuffer = async () => ({ duration: 8 });
    loadHarness.manager.loadMetadata = track => calls.push(['loadMetadata', track.name]);
    loadHarness.manager.prepareNextTrackBufferWithRepeatMode = () => calls.push(['prepareNextAfterLoad']);
    await loadHarness.manager.loadTrack(playlist[0]);
    assert.equal(loadHarness.state.playbackMode, 'bufferSource');

    const fallbackLoad = createHarness({ calls, playlist, currentTrackIndex: 0 });
    fallbackLoad.manager.prepareTrackBuffer = async () => { throw new Error('decode failed'); };
    fallbackLoad.manager.setupAudioElement = track => calls.push(['fallbackSetupAudioElement', track.name]);
    await fallbackLoad.manager.loadTrack(playlist[0]);
    assert.equal(fallbackLoad.state.playbackMode, 'audioElement');
  });
});

test('next-buffer preparation, transitions, cleanup, and utilities coordinate playback', async () => {
  await withAudioContextGlobals({}, async ({ calls, mediaSession, objectUrls }) => {
    const playlist = [
      { name: 'One', path: '/one.wav' },
      { name: 'Two', path: '/two.wav' },
      { name: 'Three', path: '/three.wav' }
    ];
    const harness = createHarness({ calls, playlist, currentTrackIndex: 0 });
    const { audioManager, audioPlayer, manager, state } = harness;

    manager.prepareTrackBuffer = async track => ({ duration: track.name.length });
    await manager.prepareNextTrackBufferWithRepeatMode();
    assert.equal(manager.nextBuffer.duration, 3);

    state.currentTrackIndex = 2;
    state.repeatMode = 'OFF';
    manager.nextBuffer = null;
    await manager.prepareNextTrackBufferWithRepeatMode();
    assert.equal(manager.nextBuffer, null);
    state.repeatMode = 'ALL';
    await manager.prepareNextTrackBufferWithRepeatMode();
    assert.equal(manager.nextBuffer.duration, 3);
    await manager.prepareNextTrackBufferForTrack(null);
    manager.prepareTrackBuffer = async () => { throw new Error('prepare next failed'); };
    await manager.prepareNextTrackBufferForTrack(playlist[1]);

    assert.equal(manager.getNextTrack(), playlist[0]);
    const noPlayback = createHarness({ calls, noStateManager: true, noPlaybackManager: true });
    assert.equal(noPlayback.manager.getNextTrack(), null);

    const transition = createHarness({ calls, playlist, currentTrackIndex: 0, repeatMode: 'ALL' });
    transition.manager.nextBuffer = { duration: 12 };
    transition.manager.prepareNextTrackBufferForTrack = async track => calls.push(['prepareSpecificNext', track.name]);
    await transition.manager.transitionToNextTrack(playlist[1]);
    assert.equal(transition.state.currentTrackName, 'Two');

    const transitionLoad = createHarness({ calls, playlist });
    transitionLoad.manager.loadTrack = async track => calls.push(['transitionLoadTrack', track.name]);
    transitionLoad.manager.play = async () => calls.push(['transitionPlay']);
    await transitionLoad.manager.transitionToNextTrack(playlist[2]);

    const transitionFail = createHarness({ calls, playlist });
    transitionFail.manager.nextBuffer = { duration: 4 };
    transitionFail.manager.createBufferSource = () => { throw new Error('source failed'); };
    await assert.rejects(() => transitionFail.manager.transitionToNextTrack(playlist[1]));

    const noCurrent = createHarness({ calls });
    await assert.rejects(() => noCurrent.manager.createAndStartBufferSource());

    const seamless = createHarness({ calls });
    seamless.manager.loadTrack = async track => calls.push(['seamlessLoad', track.name]);
    seamless.manager.play = async () => calls.push(['seamlessPlay']);
    await seamless.manager.seamlessTransition(playlist[0]);
    seamless.manager.loadTrack = async () => { throw new Error('load failed'); };
    await assert.rejects(() => seamless.manager.seamlessTransition(playlist[0]));

    audioPlayer.audioElement = new Audio();
    manager.setupEventHandlers();
    manager.mediaSource = createNode(calls, 'disconnectMedia');
    manager.currentObjectURL = 'blob:old';
    manager.currentBuffer = { duration: 1 };
    manager.nextBuffer = { duration: 2 };
    manager.bufferMonitoringInterval = 3;
    window.electronIntegration.audioPreferences = { useInputWithPlayer: false };
    objectUrls.push(['create', 'blob:old']);
    manager.disconnect();
    assert.equal(manager.currentBuffer, null);
    assert.equal(manager.nextBuffer, null);
    assert.equal(objectUrls.some(call => call[0] === 'revoke' && call[1] === 'blob:old'), true);
    assert.equal(mediaSession.handlers.size, 0);
    assert.equal(audioManager.sourceNode.name, 'originalSource');

    const throwingDisconnect = createHarness({ calls });
    throwingDisconnect.manager.stopCurrentPlayback = () => { throw new Error('stop failed'); };
    throwingDisconnect.manager.disconnect();

    state.playbackMode = 'bufferSource';
    state.isPlaying = true;
    manager.currentBuffer = { duration: 9 };
    manager.bufferStartTime = 1;
    manager.bufferDuration = 9;
    audioPlayer.audioContext.currentTime = 4;
    assert.equal(manager.isUsingBufferPlayback(), true);
    assert.equal(manager.getCurrentBufferTime(), 3);
    assert.equal(manager.hasCurrentBuffer(), true);
    assert.equal(manager.getCurrentBuffer(), manager.currentBuffer);
    manager.clearNextTrackBuffer();
    assert.equal(manager.nextBuffer, null);
    state.playbackMode = 'audioElement';
    assert.equal(manager.getCurrentBufferTime(), 0);
  });
});

test('defensive failures leave playback state recoverable', async () => {
  await withAudioContextGlobals({}, async ({ calls, mediaSession, timers }) => {
    window.electronIntegration.audioPreferences = { useInputWithPlayer: false };

    createHarness({ calls, originalSourceOptions: { disconnectThrows: true } })
      .manager.connectBufferSource(createNode(calls, 'bufferWithDisconnectFailure'));
    createHarness({ calls, noWorklet: true })
      .manager.connectBufferSource(createNode(calls, 'bufferWithoutWorklet'));

    window.electronIntegration.audioPreferences = { useInputWithPlayer: true };
    createHarness({ calls })
      .manager.connectMediaSource(createNode(calls, 'inputMedia'));
    window.electronIntegration.audioPreferences = { useInputWithPlayer: false };
    createHarness({ calls, originalSourceOptions: { disconnectThrows: true } })
      .manager.connectMediaSource(createNode(calls, 'mediaWithDisconnectFailure'));
    createHarness({ calls, originalSourceOptions: { disconnectThrows: true } })
      .manager.maintainSilentSource();

    const playback = createHarness({ calls, currentTrackPosition: 6 });
    playback.manager.currentBufferSource = createNode(calls, 'positionSource');
    playback.manager.bufferDuration = 0;
    playback.manager.bufferStartTime = 4;
    playback.audioPlayer.audioContext.currentTime = 7;
    assert.equal(playback.manager.getPlaybackPositionForGraphRebind({
      playbackMode: 'bufferSource',
      currentTrackDuration: 0
    }), 3);
    assert.equal(playback.manager.getPlaybackPositionForGraphRebind({
      playbackMode: 'bufferSource',
      currentTrackDuration: 2
    }), 2);
    playback.audioPlayer.audioContext = {};
    Object.defineProperty(playback.audioPlayer.audioContext, 'currentTime', {
      configurable: true,
      get() {
        throw new Error('context read failed');
      }
    });
    assert.equal(playback.manager.getPlaybackPositionForGraphRebind({
      playbackMode: 'bufferSource',
      currentTrackPosition: 6
    }), 6);

    const trackFallback = createHarness({ calls, currentTrackIndex: 1 });
    trackFallback.audioPlayer.stateManager.getCurrentTrackIndex = undefined;
    assert.equal(trackFallback.manager.getTrackForGraphRebind({}).name, 'Two');
    trackFallback.audioPlayer.playbackManager.currentTrackIndex = undefined;
    assert.equal(trackFallback.manager.getTrackForGraphRebind({}), null);
    trackFallback.audioPlayer.stateManager.getCurrentTrackIndex = () => 99;
    assert.equal(trackFallback.manager.getTrackForGraphRebind({}), null);

    const detach = createHarness({ calls });
    detach.manager.currentBufferSource = createNode(calls, 'throwingBufferSource', { stopThrows: true });
    detach.manager.mediaSource = createNode(calls, 'throwingMediaSource', { disconnectThrows: true });
    detach.audioPlayer.audioElement = new Audio();
    detach.audioPlayer.audioElement.pauseThrows = true;
    detach.manager.detachCurrentGraphNodesForRebind();

    const detachElement = createHarness({ calls });
    detachElement.audioPlayer.audioElement = new Audio();
    detachElement.manager.setupEventHandlers();
    detachElement.audioPlayer.audioElement.removeEventListener = () => { throw new Error('remove failed'); };
    detachElement.audioPlayer.audioElement.pauseThrows = true;
    detachElement.manager.detachAudioElementForGraphRebuild();

    const noState = createHarness({ calls, noStateManager: true });
    assert.equal(noState.manager.getCurrentState(), null);
    noState.manager.updateState({ isPlaying: true });

    const noPlayback = createHarness({ calls, noPlaybackManager: true });
    noPlayback.manager.setupAudioElement({ name: 'No Playback File', file: new FakeFile('nop.wav') });
    assert.equal(noPlayback.state.currentTrackIndex, -1);

    const unknownError = createHarness({ calls, uiManager: { setError: message => calls.push(['ui.error', message]) } });
    unknownError.audioPlayer.audioElement = new Audio();
    unknownError.manager.setupEventHandlers();
    window.uiManager = { setError: message => calls.push(['ui.error', message]) };
    unknownError.audioPlayer.audioElement.error = { code: 1 };
    unknownError.audioPlayer.audioElement.dispatch('error', { target: unknownError.audioPlayer.audioElement });
    unknownError.audioPlayer.audioElement.duration = 0;
    unknownError.audioPlayer.audioElement.dispatch('loadedmetadata');

    const invalidState = Object.assign(new Error('already connected once'), {
      name: 'InvalidStateError',
      message: 'already connected'
    });
    FakeAudioElement.nextOptions.push({ paused: false, src: 'old.wav', playReject: new Error('resume failed') });
    const reconnect = createHarness({
      calls,
      audioElement: new Audio(),
      audioContextOptions: { mediaElementSourceErrors: [invalidState] }
    });
    reconnect.audioPlayer.audioElement.src = 'old.wav';
    reconnect.audioPlayer.audioElement.paused = false;
    FakeAudioElement.nextOptions.push({ playReject: new Error('resume failed') });
    reconnect.manager.connectToAudioContext();
    await flushMicrotasks();

    const disconnectingMedia = createHarness({ calls });
    disconnectingMedia.manager.mediaSource = createNode(calls, 'mediaDisconnectFail', { disconnectThrows: true });
    disconnectingMedia.manager.connectToAudioContext();

    const outerConnectFail = createHarness({
      calls,
      audioElement: new Audio(),
      audioContextOptions: { mediaElementSourceErrors: [new Error('media source failed')] }
    });
    outerConnectFail.manager.connectToAudioContext();

    window.jsmediatags = null;
    const tagFallback = createHarness({ calls });
    tagFallback.audioPlayer.audioElement = new Audio();
    tagFallback.manager.readID3Tags(new FakeFile('plain.mp3'), 0);

    window.jsmediatags = {
      read(input, handlers) {
        handlers.onSuccess({ tags: {} });
      }
    };
    tagFallback.manager.readID3Tags(new FakeFile('empty.mp3'), 0);
    assert.equal(tagFallback.audioPlayer.ui.trackNameDisplay.textContent, 'empty.mp3');

    tagFallback.manager.tryReadFromAudioElementSrc({ name: 'Mismatch' }, 99);
    runTimers(timers);
    window.jsmediatags = null;
    tagFallback.audioPlayer.audioElement.src = 'src.wav';
    tagFallback.manager.tryReadFromAudioElementSrc({ name: 'No Tags' }, 0);
    runTimers(timers);
    window.jsmediatags = {
      read(input, handlers) {
        handlers.onSuccess({ tags: {} });
      }
    };
    tagFallback.manager.tryReadFromAudioElementSrc({ name: 'Empty Src Tags' }, 0);
    runTimers(timers);
    window.jsmediatags = {
      read(input, handlers) {
        handlers.onError({ type: 'io' });
      }
    };
    tagFallback.manager.tryReadFromAudioElementSrc({ name: 'Src Error' }, 0);
    runTimers(timers);

    tagFallback.state.isPlaying = true;
    tagFallback.manager.updateMediaSessionWithTags('', '', '');
    assert.equal(mediaSession.playbackState, 'playing');
    await withGlobals({ navigator: {} }, async () => {
      tagFallback.manager.setupMediaSessionHandlers();
    });

    const bufferPause = createHarness({ calls, playbackMode: 'bufferSource' });
    bufferPause.manager.currentBufferSource = createNode(calls, 'pauseThrowSource', { stopThrows: true });
    await bufferPause.manager.pause();
    const bufferStop = createHarness({ calls, playbackMode: 'bufferSource' });
    bufferStop.manager.currentBufferSource = createNode(calls, 'stopThrowSource', { stopThrows: true });
    await bufferStop.manager.stopBufferSource();
    const seekViaDispatch = createHarness({ calls, playbackMode: 'bufferSource' });
    seekViaDispatch.manager.currentBuffer = { duration: 5 };
    await seekViaDispatch.manager.seek(3);

    const endedStopped = createHarness({ calls, state: { isStopped: true } });
    endedStopped.manager.handleTrackEnded();
    const endedTransitioning = createHarness({ calls, state: { isTransitioning: true } });
    endedTransitioning.manager.handleTrackEnded();
    const endedDefault = createHarness({ calls, state: { repeatMode: undefined }, currentTrackIndex: 0 });
    endedDefault.manager.handleTrackEnded();
    const endedNoPlayback = createHarness({ calls, noPlaybackManager: true });
    endedNoPlayback.manager.handleTrackEnded();

    const repeatReject = createHarness({ calls, repeatMode: 'ONE' });
    repeatReject.manager.seamlessTransition = async () => { throw new Error('repeat failed'); };
    repeatReject.manager.handleTrackEnded();
    await flushMicrotasks();

    const repeatAllReject = createHarness({ calls, currentTrackIndex: 1, repeatMode: 'ALL' });
    repeatAllReject.manager.transitionToNextTrack = async () => { throw new Error('transition failed'); };
    repeatAllReject.manager.handleTrackEnded();
    await flushMicrotasks();

    const repeatAllEmpty = createHarness({ calls, playlist: [], currentTrackIndex: 0, repeatMode: 'ALL' });
    repeatAllEmpty.manager.handleTrackEnded();

    const prepareReject = createHarness({ calls, currentTrackIndex: 1, repeatMode: 'OFF' });
    prepareReject.manager.prepareTrackBuffer = async () => { throw new Error('prepare failed'); };
    prepareReject.manager.handleTrackEnded();
    await flushMicrotasks();

    const stopCurrent = createHarness({ calls });
    stopCurrent.manager.currentBufferSource = createNode(calls, 'stopCurrentThrow', { stopThrows: true });
    await stopCurrent.manager.stopCurrentPlayback();

    const fileMatch = createHarness({
      calls,
      playlist: [{ name: 'File A', file: new FakeFile('same.wav') }],
      currentTrackIndex: 0
    });
    fileMatch.manager.prepareTrackBuffer = async () => ({ duration: 4 });
    fileMatch.manager.loadMetadata = () => {};
    await fileMatch.manager.loadTrack({ name: 'Other Name', file: new FakeFile('same.wav') });
    assert.equal(fileMatch.state.currentTrackIndex, 0);

    const missingTrackIndex = createHarness({ calls });
    missingTrackIndex.manager.prepareTrackBuffer = async () => ({ duration: 7 });
    missingTrackIndex.manager.loadMetadata = () => {};
    await missingTrackIndex.manager.loadTrack({ name: 'Missing Index', path: '/missing-index.wav' });
    assert.equal(missingTrackIndex.state.currentTrackIndex, 0);

    const realPrepare = createHarness({ calls });
    assert.equal((await realPrepare.manager.prepareTrackBuffer({ name: 'Real', file: new FakeFile('real.wav') })).duration, 20);

    const badFetch = createHarness({ calls });
    await withAudioContextGlobals({ fetchResponse: { ok: false, statusText: 'Nope', buffer: new ArrayBuffer(0) } }, async () => {
      await assert.rejects(() => badFetch.manager.loadTrackData({ name: 'Fetch Bad', path: 'https://example.test/bad.wav' }));
    });

    const unknownElectron = createHarness({ calls });
    window.electronAPI = { async readFile() { return { success: false }; } };
    window.electronIntegration = { isElectron: true };
    await assert.rejects(() => unknownElectron.manager.loadElectronFileTrackData('C:\\unknown.wav'));

    const noPlaybackNext = createHarness({ calls, noPlaybackManager: true });
    await noPlaybackNext.manager.prepareNextTrackBufferWithRepeatMode();
    const defaultRepeatNext = createHarness({ calls, currentTrackIndex: 0, state: { repeatMode: undefined } });
    defaultRepeatNext.manager.prepareNextTrackBufferForTrack = async track => calls.push(['defaultRepeatNext', track.name]);
    await defaultRepeatNext.manager.prepareNextTrackBufferWithRepeatMode();

    const fallbackNext = createHarness({ calls, noStateManager: true });
    let stateAccess = 0;
    const fakeStateManager = {
      getCurrentTrackIndex: () => 1,
      getStateSnapshot: () => ({ repeatMode: 'ALL' })
    };
    Object.defineProperty(fallbackNext.audioPlayer, 'stateManager', {
      configurable: true,
      get() {
        stateAccess++;
        return stateAccess === 1 ? null : fakeStateManager;
      }
    });
    assert.equal(fallbackNext.manager.getNextTrack().name, 'One');

    const fallbackNextOff = createHarness({ calls, noStateManager: true });
    let offAccess = 0;
    const offStateManager = {
      getCurrentTrackIndex: () => 1,
      getStateSnapshot: () => ({ repeatMode: undefined })
    };
    Object.defineProperty(fallbackNextOff.audioPlayer, 'stateManager', {
      configurable: true,
      get() {
        offAccess++;
        return offAccess === 1 ? null : offStateManager;
      }
    });
    assert.equal(fallbackNextOff.manager.getNextTrack(), null);

    const fallbackNextNullSlot = createHarness({
      calls,
      noStateManager: true,
      playlist: [{ name: 'Only', path: '/only.wav' }, undefined]
    });
    let nullSlotAccess = 0;
    const nullSlotStateManager = {
      getCurrentTrackIndex: () => 0,
      getStateSnapshot: () => ({ repeatMode: 'OFF' })
    };
    Object.defineProperty(fallbackNextNullSlot.audioPlayer, 'stateManager', {
      configurable: true,
      get() {
        nullSlotAccess++;
        return nullSlotAccess === 1 ? null : nullSlotStateManager;
      }
    });
    assert.equal(fallbackNextNullSlot.manager.getNextTrack(), null);

    const noPlaylistNext = createHarness({ calls, noStateManager: true });
    Object.defineProperty(noPlaylistNext.audioPlayer, 'stateManager', {
      configurable: true,
      get() { return null; }
    });
    noPlaylistNext.audioPlayer.playbackManager = null;
    assert.equal(noPlaylistNext.manager.getNextTrack(), null);

    const transitionLastAll = createHarness({
      calls,
      playlist: [{ name: 'A', path: '/a' }, { name: 'B', path: '/b' }],
      currentTrackIndex: 0,
      repeatMode: 'ALL'
    });
    transitionLastAll.manager.nextBuffer = { duration: 2 };
    transitionLastAll.manager.prepareNextTrackBufferForTrack = async track => calls.push(['transitionLastAllNext', track.name]);
    await transitionLastAll.manager.transitionToNextTrack({ name: 'B', path: '/b' });

    const transitionLastOff = createHarness({
      calls,
      playlist: [{ name: 'A', path: '/a' }, { name: 'B', path: '/b' }],
      currentTrackIndex: 0,
      repeatMode: 'OFF'
    });
    transitionLastOff.manager.nextBuffer = { duration: 2 };
    transitionLastOff.manager.prepareNextTrackBufferWithRepeatMode = () => calls.push(['transitionPrepareFallback']);
    await transitionLastOff.manager.transitionToNextTrack({ name: 'B', path: '/b' });

    const transitionFile = createHarness({
      calls,
      playlist: [{ name: 'File', file: new FakeFile('next.wav') }],
      currentTrackIndex: 0
    });
    transitionFile.manager.nextBuffer = { duration: 5 };
    await transitionFile.manager.transitionToNextTrack({ name: 'Different', file: new FakeFile('next.wav') });

    const disconnectFailures = createHarness({ calls, connectSourceThrows: true });
    disconnectFailures.manager.mediaSource = createNode(calls, 'disconnectThrowingMedia', { disconnectThrows: true });
    disconnectFailures.manager.disconnect();

    const noIoRebuild = createHarness({
      calls,
      noIoManager: true,
      currentTrackIndex: 0,
      state: { currentTrack: { name: 'One', path: '/one.wav' }, isPaused: true }
    });
    noIoRebuild.manager.prepareTrackBuffer = async () => ({ duration: Number.NaN });
    noIoRebuild.manager.maintainSilentSource = () => calls.push(['noIoMaintainSilent']);
    await noIoRebuild.manager.handleAudioGraphRebuilt();
    assert.equal(calls.some(call => call[0] === 'noIoMaintainSilent'), true);

    const nullSourceRebuild = createHarness({
      calls,
      noIoManager: true,
      noOriginalSource: true,
      currentTrackIndex: 0,
      state: { currentTrack: { name: 'One', path: '/one.wav' }, isStopped: true }
    });
    nullSourceRebuild.manager.prepareTrackBuffer = async () => ({ duration: 5 });
    await nullSourceRebuild.manager.handleAudioGraphRebuilt();
    assert.equal(nullSourceRebuild.state.currentTrackPosition, 0);

    FakeAudioElement.nextOptions.push({ readyState: 0, duration: Number.NaN });
    const directRebind = createHarness({ calls });
    directRebind.manager.playAudioElement = async () => calls.push(['directRebindPlay']);
    await directRebind.manager.rebindAudioElementAfterGraphRebuild(
      { name: 'Direct', path: '/direct.wav' },
      6,
      true,
      false,
      false
    );
    directRebind.audioPlayer.audioElement.dispatch('loadedmetadata');
    assert.equal(directRebind.audioPlayer.audioElement.currentTime, 6);
    assert.equal(calls.some(call => call[0] === 'directRebindPlay'), true);

    FakeAudioElement.nextOptions.push({ readyState: 1, duration: 4, throwOnCurrentTimeSet: true });
    const throwingRebind = createHarness({ calls });
    await throwingRebind.manager.rebindAudioElementAfterGraphRebuild(
      { name: 'Throwing', path: '/throwing.wav' },
      2,
      false,
      false,
      true
    );
    assert.equal(throwingRebind.state.currentTrackPosition, 0);
  });
});
