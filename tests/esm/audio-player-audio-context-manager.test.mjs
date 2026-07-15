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

function decodeLatin1(bytes) {
  return String.fromCharCode(...bytes);
}

function bytesFromHex(hex) {
  const clean = hex.replace(/\s+/g, '');
  const bytes = [];
  for (let index = 0; index + 1 < clean.length; index += 2) {
    bytes.push(Number.parseInt(clean.slice(index, index + 2), 16));
  }
  return Uint8Array.from(bytes);
}

function asciiBytes(text) {
  return Uint8Array.from([...text].map(char => char.charCodeAt(0) & 0xff));
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function uint32Le(value) {
  return Uint8Array.from([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  ]);
}

function createChunkBytes(id, data) {
  const payload = data instanceof Uint8Array ? data : Uint8Array.from(data);
  const padding = payload.length % 2 ? Uint8Array.from([0]) : Uint8Array.from([]);
  return concatBytes([asciiBytes(id), uint32Le(payload.length), payload, padding]);
}

function createRiffInfoWaveBytes(tags) {
  const fmt = new Uint8Array(16);
  fmt[0] = 1;
  fmt[2] = 1;
  fmt.set(uint32Le(44100), 4);
  fmt.set(uint32Le(88200), 8);
  fmt[12] = 2;
  fmt[14] = 16;
  const infoPayload = concatBytes([
    asciiBytes('INFO'),
    ...tags.map(tag => createChunkBytes(tag.id, tag.data))
  ]);
  const chunks = [
    createChunkBytes('fmt ', fmt),
    createChunkBytes('data', new Uint8Array(0)),
    createChunkBytes('LIST', infoPayload)
  ];
  const riffSize = 4 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  return concatBytes([asciiBytes('RIFF'), uint32Le(riffSize), asciiBytes('WAVE'), ...chunks]);
}

class FakeBlobFile extends FakeFile {
  constructor(name, bytes) {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    super(name, buffer);
    this.size = bytes.byteLength;
  }

  slice(start = 0, end = this.size) {
    const bytes = new Uint8Array(this._buffer).slice(start, end);
    return {
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
    };
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
  const ioManager = options.noIoManager ? null : {
    sourceNode: originalSource
  };
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
      if (options.connectSourceReturnsFalse) return false;
      return true;
    },
    disconnectSourceFromPipeline(source) {
      calls.push(['disconnectSourceFromPipeline', source?.name]);
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
    async playNext(userInitiated, playNextOptions) {
      calls.push(['playback.playNext', userInitiated, playNextOptions ? { ...playNextOptions } : playNextOptions]);
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

function setPreparedNextBuffer(manager, track, buffer, targetIndex = null) {
  const request = manager.beginNextBufferRequest(track, targetIndex);
  manager.nextBuffer = {
    buffer,
    track,
    targetIndex: request.targetIndex,
    requestToken: request.token
  };
}

function setConnectedMediaSource(harness, name = 'mediaSource') {
  const source = createNode(harness.calls, name);
  harness.manager.mediaSource = source;
  harness.manager.mediaSourceGeneration++;
  return source;
}

test('playback resume kind follows the mixed-input preference', async () => {
  await withAudioContextGlobals({
    electronIntegration: { audioPreferences: { useInputWithPlayer: true } }
  }, async ({ calls }) => {
    const harness = createHarness({
      calls,
      audioManager: {
        powerPolicyController: {
          enabled: true,
          async ensureActive(kind) {
            calls.push(['ensureActive', kind]);
          }
        }
      }
    });

    await harness.manager.resumePlaybackAudioContext();
    assert.deepEqual(calls.filter(call => call[0] === 'ensureActive'), [
      ['ensureActive', 'mixed-play']
    ]);

    window.electronIntegration.audioPreferences.useInputWithPlayer = false;
    await harness.manager.resumePlaybackAudioContext();
    assert.deepEqual(calls.filter(call => call[0] === 'ensureActive'), [
      ['ensureActive', 'mixed-play'],
      ['ensureActive', 'player-only-play']
    ]);
  });
});

test('automatic playback checks active state without entering the gesture resume path', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const harness = createHarness({
      calls,
      audioManager: {
        powerPolicyController: {
          enabled: true,
          async ensureActive() {
            calls.push(['unexpectedGestureResume']);
            return true;
          },
          async ensureActiveForAutomaticPlayback() {
            calls.push(['ensureActiveForAutomaticPlayback']);
            return false;
          }
        }
      }
    });

    assert.equal(await harness.manager.resumePlaybackAudioContext(false), false);
    assert.deepEqual(calls.filter(call => call[0].includes('Active') || call[0].includes('Gesture')), [
      ['ensureActiveForAutomaticPlayback']
    ]);
  });
});

test('power source status reflects the current connected player source', () => {
  const connectedSources = new Set();
  const harness = createHarness({
    isPlaying: true,
    playbackMode: 'bufferSource',
    audioManager: {
      isSourceConnectedToPipeline(source) { return connectedSources.has(source); }
    }
  });
  const source = createNode(harness.calls, 'current-player-source');
  harness.manager.currentBufferSource = source;

  assert.deepEqual(harness.manager.getPowerSourceStatus(), {
    state: 'disconnected',
    sourcePresent: true
  });
  connectedSources.add(source);
  assert.deepEqual(harness.manager.getPowerSourceStatus(), {
    state: 'connected',
    sourcePresent: true
  });
  harness.state.isPlaying = false;
  harness.state.isPaused = true;
  assert.deepEqual(harness.manager.getPowerSourceStatus(), {
    state: 'not-required',
    sourcePresent: false
  });
});

test('core graph connections and source management preserve playback wiring', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const harness = createHarness({ calls });
    const { audioManager, manager } = harness;

    const silentGain = manager.createSilentGain();
    assert.equal(silentGain.gain.value, 0);
    manager.setManagedSourceNode(silentGain);
    assert.equal(audioManager.sourceNode, silentGain);
    assert.equal(audioManager.ioManager.sourceNode, silentGain);

    calls.length = 0;
    const centralSilent = createHarness({ calls });
    const runningSilentSource = createNode(calls, 'runningSilentSource');
    centralSilent.audioManager.ioManager.ensureSilentSourceFallback = () => {
      calls.push(['io.ensureSilentSourceFallback']);
      centralSilent.audioManager.ioManager.sourceNode = runningSilentSource;
      return runningSilentSource;
    };
    const maintainedSource = centralSilent.manager.createSilentGain();
    assert.equal(maintainedSource, runningSilentSource);
    assert.equal(calls.some(call => call[0] === 'io.ensureSilentSourceFallback'), true);
    assert.equal(calls.some(call => call[0] === 'connectSourceToPipeline' &&
      call[1] === 'runningSilentSource'), true);
    assert.equal(calls.some(call => call[0] === 'audioContext.createGain'), false);

    calls.length = 0;
    assert.equal(
      centralSilent.manager.connectBufferSource(createNode(calls, 'centralBuffer')),
      true
    );
    const silentConnectIndex = calls.findIndex(call =>
      call[0] === 'connectSourceToPipeline' && call[1] === 'runningSilentSource');
    const oldInputDisconnectIndex = calls.findIndex(call =>
      call[0] === 'disconnectSourceFromPipeline' && call[1] === 'originalSource');
    const playerConnectIndex = calls.findIndex(call =>
      call[0] === 'connectSourceToPipeline' && call[1] === 'centralBuffer');
    assert.ok(silentConnectIndex >= 0 && silentConnectIndex < oldInputDisconnectIndex);
    assert.ok(oldInputDisconnectIndex < playerConnectIndex);

    const rejectedSilent = createHarness({ calls, connectSourceReturnsFalse: true });
    const rejectedSilentSource = createNode(calls, 'rejectedSilentSource');
    rejectedSilent.audioManager.ioManager.ensureSilentSourceFallback = () => rejectedSilentSource;
    assert.equal(rejectedSilent.manager.createSilentGain(), null);
    calls.length = 0;
    assert.equal(
      rejectedSilent.manager.connectBufferSource(createNode(calls, 'rejectedBuffer')),
      false
    );
    assert.equal(calls.some(call => call[0] === 'disconnectSourceFromPipeline' &&
      call[1] === 'originalSource'), false);
    assert.notEqual(rejectedSilent.audioManager.sourceNode?.name, 'rejectedBuffer');

    calls.length = 0;
    const alreadyConnected = createNode(calls, 'alreadyConnected');
    window.electronIntegration.audioPreferences = { useInputWithPlayer: true };
    const canonicalHarness = createHarness({
      calls,
      audioManager: {
        isSourceConnectedToPipeline: source => source === alreadyConnected,
        connectSourceToPipeline() {
          calls.push(['unexpectedCanonicalReconnect']);
          return false;
        }
      }
    });
    assert.equal(canonicalHarness.manager.replaceCanonicalInputSource(alreadyConnected), true);
    assert.equal(calls.some(call => call[0] === 'unexpectedCanonicalReconnect'), false);
    window.electronIntegration.audioPreferences = { useInputWithPlayer: false };

    assert.equal(manager.connectBufferSource(createNode(calls, 'bufferA')), true);
    assert.equal(calls.some(call => call[0] === 'connectSourceToPipeline' && call[1] === 'bufferA'), true);
    assert.equal(calls.some(call => call[0] === 'disconnectSourceFromPipeline' &&
      call[1] === 'originalSource'), true);

    window.electronIntegration.audioPreferences = { useInputWithPlayer: true };
    assert.equal(manager.connectBufferSource(createNode(calls, 'bufferB')), true);
    assert.equal(calls.some(call => call[0] === 'connectSourceToPipeline' && call[1] === 'bufferB'), true);

    const noWorklet = createHarness({ calls, noWorklet: true });
    assert.equal(noWorklet.manager.connectBufferSource(createNode(calls, 'bufferC')), false);
    assert.equal(calls.some(call => call[0] === 'console.warn'), true);

    const mediaSource = createNode(calls, 'mediaA');
    window.electronIntegration.audioPreferences = { useInputWithPlayer: false };
    const retryHarness = createHarness({ calls, connectSourceThrowsOnce: true });
    assert.equal(retryHarness.manager.connectMediaSource(mediaSource), false);
    assert.equal(calls.filter(call => call[0] === 'connectSourceToPipeline' && call[1] === 'mediaA').length, 1);

    const innerFail = createHarness({ calls, connectSourceThrows: true });
    assert.equal(
      innerFail.manager.connectMediaSource(
        createNode(calls, 'mediaB', { disconnectThrows: true })
      ),
      false
    );

    const rejectedBuffer = createHarness({ calls, connectSourceReturnsFalse: true });
    assert.throws(
      () => rejectedBuffer.manager.createBufferSource({ duration: 1 }, 1),
      /pipeline-source-connect-failed/
    );

    window.electronIntegration.audioPreferences = { useInputWithPlayer: false };
    const maintained = createHarness({ calls });
    maintained.manager.maintainSilentSource();
    assert.equal(calls.some(call => call[0] === 'audioContext.createGain'), true);

    window.electronIntegration.audioPreferences = { useInputWithPlayer: true };
    maintained.manager.maintainSilentSource();

    window.electronIntegration.audioPreferences = { useInputWithPlayer: false };
    window.audioPreferences = { useInputWithPlayer: true };
    calls.length = 0;
    const webPreferenceMaintained = createHarness({ calls });
    webPreferenceMaintained.manager.maintainSilentSource();
    assert.equal(calls.some(call => call[0] === 'audioContext.createGain'), false);
    delete window.audioPreferences;

    window.electronIntegration = { audioPreferences: { useInputWithPlayer: true } };
    window.audioPreferences = { useInputWithPlayer: false };
    calls.length = 0;
    const staleElectronPreference = createHarness({ calls });
    staleElectronPreference.manager.maintainSilentSource();
    assert.equal(calls.some(call => call[0] === 'audioContext.createGain'), true);
    delete window.audioPreferences;

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
    assert.equal(calls.some(call => call[0] === 'disconnectSourceFromPipeline' &&
      call[1] === bufferSource.name), true);

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

test('a late buffer graph rebuild cannot overwrite a newer track load', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const playlist = [
      { name: 'Old', path: '/old.wav' },
      { name: 'New', path: '/new.wav' }
    ];
    const harness = createHarness({
      calls,
      playlist,
      currentTrackIndex: 0,
      state: {
        currentTrack: playlist[0],
        playbackMode: 'bufferSource',
        isPlaying: true,
        isStopped: false
      }
    });
    let releaseBuffer;
    let markPreparationStarted;
    const preparationStarted = new Promise(resolve => {
      markPreparationStarted = resolve;
    });
    harness.manager.prepareTrackBuffer = () => new Promise(resolve => {
      releaseBuffer = resolve;
      markPreparationStarted();
    });
    harness.manager.playBufferSource = async () => calls.push(['staleGraphPlay']);

    const rebuilding = harness.manager.handleAudioGraphRebuilt();
    await preparationStarted;
    Object.assign(harness.state, {
      currentTrack: playlist[1],
      currentTrackIndex: 1,
      isTransitioning: true,
      transitionType: 'loading'
    });
    harness.manager.beginLoadRequest(playlist[1], 1);
    releaseBuffer({ duration: 10 });
    await rebuilding;

    assert.equal(harness.state.currentTrack, playlist[1]);
    assert.equal(harness.state.currentTrackIndex, 1);
    assert.equal(harness.manager.currentBuffer, null);
    assert.equal(calls.some(call => call[0] === 'staleGraphPlay'), false);
  });
});

test('buffer source onended remains active after pause and resume', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const { audioContext, manager, state } = createHarness({
      calls,
      playbackMode: 'bufferSource',
      isPlaying: true,
      isPaused: false,
      state: { isStopped: false }
    });
    manager.currentBuffer = { duration: 12 };
    manager.handleTrackEnded = () => calls.push(['manager.handleTrackEnded.afterResume']);

    audioContext.currentTime = 10;
    await manager.playBufferSource();
    audioContext.currentTime = 14;
    await manager.pauseBufferSource();
    assert.equal(state.currentTrackPosition, 4);

    audioContext.currentTime = 20;
    await manager.playBufferSource();
    manager.currentBufferSource.onended();

    assert.equal(calls.some(call => call[0] === 'manager.handleTrackEnded.afterResume'), true);
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

    const invalidState = Object.assign(new Error('already connected once'), {
      name: 'InvalidStateError',
      message: 'already connected'
    });
    const staleElementHarness = createHarness({
      calls,
      audioContextOptions: { mediaElementSourceErrors: [invalidState] }
    });
    const firstNewElementIndex = FakeAudioElement.instances.length;
    staleElementHarness.manager.setupAudioElement({ name: 'Reconnect', path: '/reconnect.wav' });
    const oldElement = FakeAudioElement.instances[firstNewElementIndex];
    const replacementElement = FakeAudioElement.instances[firstNewElementIndex + 1];
    assert.equal(oldElement.paused, true);
    assert.equal(oldElement.src, '');
    assert.equal((oldElement.listeners.get('timeupdate') || []).length, 0);

    staleElementHarness.state.playbackMode = 'audioElement';
    staleElementHarness.manager.handleTrackEnded = () => calls.push(['staleElementEnded']);
    oldElement.currentTime = 7;
    oldElement.duration = 77;
    oldElement.dispatch('timeupdate', { target: oldElement });
    oldElement.dispatch('loadedmetadata', { target: oldElement });
    oldElement.dispatch('ended', { target: oldElement });
    assert.notEqual(staleElementHarness.state.currentTrackPosition, 7);
    assert.notEqual(staleElementHarness.state.currentTrackDuration, 77);
    assert.equal(calls.some(call => call[0] === 'staleElementEnded'), false);

    replacementElement.currentTime = 5;
    replacementElement.duration = 55;
    replacementElement.dispatch('timeupdate', { target: replacementElement });
    replacementElement.dispatch('loadedmetadata', { target: replacementElement });
    assert.equal(staleElementHarness.state.currentTrackPosition, 5);
    assert.equal(staleElementHarness.state.currentTrackDuration, 55);

    const fallbackIndex = createHarness({ calls, currentTrackIndex: 0 });
    fallbackIndex.audioPlayer.playbackManager.currentTrackIndex = undefined;
    fallbackIndex.manager.setupAudioElement({ name: 'Two Fallback', path: '/two.wav' });
    assert.equal(fallbackIndex.state.currentTrackIndex, 1);

    manager.setupAudioElement({ name: 'No Source' });

    const rejectedSetup = createHarness({ calls, connectSourceReturnsFalse: true });
    assert.equal(
      rejectedSetup.manager.setupAudioElement({ name: 'Rejected', path: '/rejected.wav' }),
      false
    );
    assert.equal(rejectedSetup.state.currentTrack, null);

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

    calls.length = 0;
    await manager.seek(7);
    assert.equal(state.currentTrackPosition, 7);
    assert.equal(state.isPlaying, false);
    assert.equal(state.isPaused, true);
    assert.equal(state.isStopped, false);
    assert.equal(manager.currentBufferSource, null);
    assert.equal(calls.some(call => call[0] === 'node.start'), false);

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

    calls.length = 0;
    const resumeHarness = createHarness({
      calls,
      playbackMode: 'bufferSource',
      isPaused: true,
      currentTrackPosition: 1,
      audioManager: {
        contextManager: {
          async resumeAudioContext() {
            calls.push(['core.resumeAudioContext']);
          }
        }
      }
    });
    resumeHarness.manager.currentBuffer = { duration: 10 };
    await resumeHarness.manager.play();
    const resumeIndex = calls.findIndex(call => call[0] === 'core.resumeAudioContext');
    const startIndex = calls.findIndex(call => call[0] === 'node.start');
    assert.ok(resumeIndex >= 0);
    assert.ok(startIndex > resumeIndex);

    const audioElement = new Audio();
    const elementHarness = createHarness({ calls, playbackMode: 'audioElement', audioElement });
    setConnectedMediaSource(elementHarness, 'playbackMediaSource');
    await elementHarness.manager.play();
    await elementHarness.manager.pause();
    await elementHarness.manager.seek(6);
    await elementHarness.manager.stop();
    assert.equal(elementHarness.state.currentTrackPosition, 0);

    const rejectElement = new Audio();
    rejectElement.playReject = new Error('play failed');
    const rejectHarness = createHarness({ calls, playbackMode: 'audioElement', audioElement: rejectElement });
    setConnectedMediaSource(rejectHarness, 'rejectMediaSource');
    await rejectHarness.manager.playAudioElement();
    assert.equal(rejectHarness.state.isPaused, true);
    await createHarness({ calls, playbackMode: 'audioElement', audioElement: null }).manager.playAudioElement();
  });
});

test('a stale audio element play completion cannot pause newer playback', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const audioElement = new Audio();
    const pendingPlays = [];
    audioElement.play = () => new Promise((resolve, reject) => {
      pendingPlays.push({
        resolve() {
          audioElement.paused = false;
          resolve();
        },
        reject
      });
    });
    const harness = createHarness({ calls, playbackMode: 'audioElement', audioElement });
    setConnectedMediaSource(harness, 'staleCompletionMediaSource');

    const stalePlay = harness.manager.playAudioElement();
    await flushMicrotasks();
    assert.equal(pendingPlays.length, 1);

    await harness.manager.pause();
    const pauseCount = calls.filter(call => call[0] === 'audio.pause').length;
    assert.equal(pauseCount, 1);

    const currentPlay = harness.manager.playAudioElement();
    await flushMicrotasks();
    assert.equal(pendingPlays.length, 2);
    pendingPlays[1].resolve();
    assert.equal(await currentPlay, true);
    assert.equal(harness.state.isPlaying, true);
    assert.equal(audioElement.paused, false);

    pendingPlays[0].resolve();
    assert.equal(await stalePlay, false);
    assert.equal(audioElement.paused, false);
    assert.equal(calls.filter(call => call[0] === 'audio.pause').length, pauseCount);
  });
});

test('a stale audio element play rejection cannot clear a newer pending playback', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const audioElement = new Audio();
    const pendingPlays = [];
    audioElement.play = () => new Promise((resolve, reject) => {
      pendingPlays.push({
        resolve() {
          audioElement.paused = false;
          resolve();
        },
        reject
      });
    });
    const harness = createHarness({ calls, playbackMode: 'audioElement', audioElement });
    setConnectedMediaSource(harness, 'staleRejectionMediaSource');

    const stalePlay = harness.manager.playAudioElement();
    await flushMicrotasks();
    await harness.manager.pause();

    const currentPlay = harness.manager.playAudioElement();
    await flushMicrotasks();
    assert.equal(pendingPlays.length, 2);
    const currentActivation = harness.manager.pendingMediaActivation;
    const pauseCount = calls.filter(call => call[0] === 'audio.pause').length;
    assert.ok(currentActivation);
    assert.equal(pauseCount, 1);

    const abortError = new Error('stale play interrupted');
    abortError.name = 'AbortError';
    pendingPlays[0].reject(abortError);
    assert.equal(await stalePlay, false);
    assert.equal(harness.manager.pendingMediaActivation, currentActivation);
    assert.equal(calls.filter(call => call[0] === 'audio.pause').length, pauseCount);

    pendingPlays[1].resolve();
    assert.equal(await currentPlay, true);
    assert.equal(harness.state.isPlaying, true);
    assert.equal(audioElement.paused, false);
  });
});

test('staged buffer playback stays private until the source-bound fresh-render commit', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    let releaseProof;
    const proof = new Promise(resolve => { releaseProof = resolve; });
    let capturedIntent = null;
    const harness = createHarness({
      calls,
      playbackMode: 'bufferSource',
      isPaused: true,
      currentTrackPosition: 3,
      currentTrack: { name: 'Staged', path: '/staged.wav' },
      audioManager: {
        isStagedAudioActivationEnabled: () => true,
        async stageAudioActivation(intent) {
          capturedIntent = intent;
          return { generation: 4 };
        },
        fadeOutOutput() { throw new Error('master output must stay unchanged'); },
        fadeInOutputForToken() { throw new Error('master output must stay unchanged'); },
        isSourceConnectedToPipeline: () => true,
        async activateStagedAudioCandidate(stage, callbacks) {
          const candidate = await callbacks.acquire(stage);
          await proof;
          if (!callbacks.isCandidateCurrent(candidate, stage)) {
            await callbacks.cleanup(candidate, stage);
            return { activated: false };
          }
          callbacks.commit(candidate, stage);
          return { activated: true };
        }
      }
    });
    harness.manager.currentBuffer = { duration: 12 };
    harness.manager.activeSourceGeneration = 9;

    const playing = harness.manager.playBufferSource();
    for (let i = 0; i < 5 && !harness.manager.pendingBufferSource; i++) {
      await flushMicrotasks();
    }
    assert.equal(harness.state.isPlaying, false);
    assert.equal(harness.manager.currentBufferSource, null);
    assert.ok(harness.manager.pendingBufferSource);
    const privateGate = harness.manager.privatePipelineSourceGates.get(
      harness.manager.pendingBufferSource
    );
    assert.ok(privateGate);
    assert.equal(privateGate.gain.value, 0);
    assert.equal(capturedIntent.intentIdentity.sourceGeneration, 9);
    assert.equal(capturedIntent.intentIdentity.intendedPosition, 3);

    releaseProof();
    assert.equal(await playing, true);
    assert.equal(harness.state.isPlaying, true);
    assert.ok(harness.manager.currentBufferSource);
    assert.equal(harness.manager.pendingBufferSource, null);
    assert.equal(privateGate.gain.value, 1);
  });
});

test('a late staged buffer source stays private without mutating the master output', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    let releaseProof;
    const proof = new Promise(resolve => { releaseProof = resolve; });
    let cleaned = 0;
    const harness = createHarness({
      calls,
      playbackMode: 'bufferSource',
      currentTrack: { name: 'Old', path: '/old.wav' },
      audioManager: {
        isStagedAudioActivationEnabled: () => true,
        stageAudioActivation: async () => ({ generation: 1 }),
        fadeOutOutput() { throw new Error('master output must stay unchanged'); },
        fadeInOutputForToken() { throw new Error('master output must stay unchanged'); },
        isSourceConnectedToPipeline: () => true,
        async activateStagedAudioCandidate(stage, callbacks) {
          const candidate = await callbacks.acquire(stage);
          await proof;
          if (!callbacks.isCandidateCurrent(candidate, stage)) {
            cleaned++;
            await callbacks.cleanup(candidate, stage);
            return { activated: false };
          }
          callbacks.commit(candidate, stage);
          return { activated: true };
        }
      }
    });
    harness.manager.currentBuffer = { duration: 8 };
    harness.manager.activeSourceGeneration = 2;

    const playing = harness.manager.playBufferSource();
    for (let i = 0; i < 5 && !harness.manager.pendingBufferSource; i++) {
      await flushMicrotasks();
    }
    const staleSource = harness.manager.pendingBufferSource;
    const privateGate = harness.manager.privatePipelineSourceGates.get(staleSource);
    assert.ok(privateGate);
    assert.equal(privateGate.gain.value, 0);
    harness.manager.currentBuffer = { duration: 30 };
    harness.manager.activeSourceGeneration = 3;
    releaseProof();

    assert.equal(await playing, false);
    assert.equal(cleaned, 1);
    assert.equal(harness.state.isPlaying, false);
    assert.equal(harness.manager.currentBufferSource, null);
    assert.equal(harness.manager.pendingBufferSource, null);
    assert.equal(privateGate.gain.value, 0);
    assert.equal(harness.manager.privatePipelineSourceGates.has(staleSource), false);
  });
});

test('staged media playback publishes only its source gate and leaves the master output unchanged', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    let releaseProof;
    const proof = new Promise(resolve => { releaseProof = resolve; });
    const audioElement = new Audio();
    const harness = createHarness({
      calls,
      playbackMode: 'audioElement',
      audioElement,
      audioManager: {
        isStagedAudioActivationEnabled: () => true,
        stageAudioActivation: async () => ({ generation: 5 }),
        fadeOutOutput() { throw new Error('master output must stay unchanged'); },
        fadeInOutputForToken() { throw new Error('master output must stay unchanged'); },
        isSourceConnectedToPipeline: () => true,
        async activateStagedAudioCandidate(stage, callbacks) {
          const candidate = await callbacks.acquire(stage);
          await proof;
          assert.equal(callbacks.isCandidateCurrent(candidate, stage), true);
          callbacks.commit(candidate, stage);
          return { activated: true };
        }
      }
    });
    const mediaSource = setConnectedMediaSource(harness, 'stagedMediaSource');

    const playing = harness.manager.playAudioElement();
    for (let i = 0; i < 5 && !harness.manager.pendingMediaActivation; i++) {
      await flushMicrotasks();
    }
    const privateGate = harness.manager.privatePipelineSourceGates.get(mediaSource);
    assert.ok(privateGate);
    assert.equal(privateGate.gain.value, 0);
    assert.equal(harness.state.isPlaying, false);

    releaseProof();
    assert.equal(await playing, true);
    assert.equal(privateGate.gain.value, 1);
    assert.equal(harness.state.isPlaying, true);
  });
});

test('catalog Repeat ONE forwards track end to the catalog transport', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const harness = createHarness({
      calls,
      currentTrackIndex: 0,
      repeatMode: 'ONE',
      state: { isStopped: false }
    });
    harness.audioPlayer.playbackManager.catalogSequence = {};

    harness.manager.handleTrackEnded();

    assert.deepEqual(calls.filter(call => call[0] === 'playback.onTrackEnded'), [
      ['playback.onTrackEnded']
    ]);
    assert.deepEqual(calls.filter(call => call[0] === 'playback.getTrack'), []);
  });
});

test('track-ended handling, monitoring, and load helpers advance playback state', async () => {
  await withAudioContextGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async readFileBytes(path) {
        if (path !== 'C:\\song.wav') {
          throw new Error('missing');
        }
        return new Uint8Array([1, 2, 3]).buffer;
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

    manager.seamlessTransition = async (track, targetIndex, userInitiated) =>
      calls.push(['seamlessTransition', track.name, targetIndex, userInitiated]);
    state.repeatMode = 'ONE';
    manager.handleTrackEnded();
    assert.deepEqual(
      calls.find(call => call[0] === 'seamlessTransition'),
      ['seamlessTransition', 'Two', 1, false]
    );

    state.repeatMode = 'ALL';
    const repeatAllEndedCalls = calls.filter(call => call[0] === 'playback.onTrackEnded').length;
    manager.transitionToNextTrack = async track => calls.push(['unexpectedRepeatAllTransition', track.name]);
    manager.handleTrackEnded();
    assert.equal(calls.filter(call => call[0] === 'playback.onTrackEnded').length, repeatAllEndedCalls + 1);
    assert.equal(state.currentTrackIndex, 1);
    assert.equal(calls.some(call => call[0] === 'unexpectedRepeatAllTransition'), false);

    const shuffleRepeatAll = createHarness({
      calls,
      playlist: [
        { name: 'Shuffle One', path: '/shuffle-one.wav' },
        { name: 'Shuffle Two', path: '/shuffle-two.wav' },
        { name: 'Shuffle Three', path: '/shuffle-three.wav' }
      ],
      currentTrackIndex: 2,
      repeatMode: 'ALL',
      state: { shuffleMode: true }
    });
    const shuffleEndedCalls = calls.filter(call => call[0] === 'playback.onTrackEnded').length;
    shuffleRepeatAll.manager.transitionToNextTrack = async track => calls.push(['unexpectedShuffleRepeatAllTransition', track.name]);
    shuffleRepeatAll.manager.handleTrackEnded();
    assert.equal(calls.filter(call => call[0] === 'playback.onTrackEnded').length, shuffleEndedCalls + 1);
    assert.equal(shuffleRepeatAll.state.currentTrackIndex, 2);
    assert.equal(calls.some(call => call[0] === 'unexpectedShuffleRepeatAllTransition'), false);

    const fallbackRepeatAll = createHarness({
      calls,
      playlist,
      currentTrackIndex: 1,
      repeatMode: 'ALL'
    });
    fallbackRepeatAll.audioPlayer.playbackManager = { playlist };
    fallbackRepeatAll.manager.transitionToNextTrack = async (track, targetIndex, userInitiated) =>
      calls.push(['fallbackRepeatAllTransition', track.name, targetIndex, userInitiated]);
    fallbackRepeatAll.manager.handleTrackEnded();
    assert.deepEqual(
      calls.find(call => call[0] === 'fallbackRepeatAllTransition'),
      ['fallbackRepeatAllTransition', 'One', 0, false]
    );

    state.repeatMode = 'OFF';
    state.currentTrackIndex = 1;
    manager.prepareTrackBuffer = async track => ({ duration: track.name.length });
    manager.loadMetadata = track => calls.push(['endedLoadMetadata', track.name]);
    manager.prepareNextTrackBufferWithRepeatMode = () => calls.push(['prepareNext']);
    manager.handleTrackEnded();
    await flushMicrotasks();
    assert.equal(state.isStopped, true);
    assert.equal(calls.some(call => call[0] === 'endedLoadMetadata' && call[1] === 'One'), true);

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

    const duplicatePathPlaylist = [
      { name: 'Same Path A', path: '/same.wav' },
      { name: 'Same Path B', path: '/same.wav' }
    ];
    const duplicatePathLoad = createHarness({ calls, playlist: duplicatePathPlaylist, currentTrackIndex: 0 });
    duplicatePathLoad.manager.prepareTrackBuffer = async () => ({ duration: 6 });
    duplicatePathLoad.manager.loadMetadata = () => {};
    duplicatePathLoad.manager.prepareNextTrackBufferWithRepeatMode = () => {};
    await duplicatePathLoad.manager.loadTrack(duplicatePathPlaylist[1], 1);
    assert.equal(duplicatePathLoad.state.currentTrackIndex, 1);

    const duplicateLibraryPlaylist = [
      { name: 'Library A', path: '/library-a.wav', libraryTrackId: 'duplicate-id' },
      { name: 'Library B', path: '/library-b.wav', libraryTrackId: 'duplicate-id' }
    ];
    const duplicateLibraryLoad = createHarness({ calls, playlist: duplicateLibraryPlaylist, currentTrackIndex: 0 });
    duplicateLibraryLoad.manager.prepareTrackBuffer = async () => ({ duration: 7 });
    duplicateLibraryLoad.manager.loadMetadata = () => {};
    duplicateLibraryLoad.manager.prepareNextTrackBufferWithRepeatMode = () => {};
    await duplicateLibraryLoad.manager.loadTrack(duplicateLibraryPlaylist[1], 1);
    assert.equal(duplicateLibraryLoad.state.currentTrackIndex, 1);

    const resetLoad = createHarness({
      calls,
      playlist,
      currentTrackIndex: 0,
      currentTrackDuration: 99,
      currentTrackPosition: 7
    });
    resetLoad.manager.currentBuffer = { duration: 99 };
    resetLoad.manager.prepareTrackBuffer = async () => {
      assert.equal(resetLoad.manager.currentBuffer, null);
      assert.equal(resetLoad.state.currentTrackDuration, 0);
      assert.equal(resetLoad.state.currentTrackPosition, 0);
      return { duration: 8 };
    };
    resetLoad.manager.loadMetadata = () => {};
    resetLoad.manager.prepareNextTrackBufferWithRepeatMode = () => {};
    await resetLoad.manager.loadTrack(playlist[0]);
    assert.equal(resetLoad.state.currentTrackDuration, 8);

    const fallbackLoad = createHarness({ calls, playlist, currentTrackIndex: 0 });
    fallbackLoad.manager.prepareTrackBuffer = async () => { throw new Error('decode failed'); };
    fallbackLoad.manager.setupAudioElement = track => calls.push(['fallbackSetupAudioElement', track.name]);
    await fallbackLoad.manager.loadTrack(playlist[0]);
    assert.equal(fallbackLoad.state.playbackMode, 'audioElement');

    const repeatOneSkipPlaylist = [
      { name: 'Bad', path: '/bad.wav' },
      { name: 'Good', path: '/good.wav' }
    ];
    const repeatOneSkip = createHarness({
      calls,
      playlist: repeatOneSkipPlaylist,
      currentTrackIndex: 0,
      repeatMode: 'ONE'
    });
    const loadAttempts = [];
    repeatOneSkip.manager.prepareTrackBuffer = async track => {
      loadAttempts.push(track.name);
      if (track.name === 'Bad') throw new Error('bad decode');
      return { duration: 9 };
    };
    repeatOneSkip.manager.setupResolvedAudioElement = async () => {
      throw new Error('fallback failed');
    };
    repeatOneSkip.manager.loadMetadata = track => calls.push(['repeatOneSkipMetadata', track.name]);
    repeatOneSkip.manager.prepareNextTrackBufferWithRepeatMode = () => calls.push(['repeatOneSkipPrepareNext']);
    repeatOneSkip.audioPlayer.playbackManager.playNext = async (userInitiated, playNextOptions) => {
      calls.push(['repeatOneSkipPlayNext', userInitiated, { ...playNextOptions }]);
      await repeatOneSkip.manager.loadTrack(repeatOneSkipPlaylist[1], 1);
    };

    await repeatOneSkip.manager.loadTrack(repeatOneSkipPlaylist[0], 0);

    assert.deepEqual(loadAttempts, ['Bad', 'Good']);
    assert.equal(repeatOneSkip.state.currentTrackIndex, 1);
    assert.deepEqual(
      calls.find(call => call[0] === 'repeatOneSkipPlayNext'),
      ['repeatOneSkipPlayNext', false, { allowDuringTransition: true, ignoreRepeatOne: true, failedIndex: 0 }]
    );
  });
});

test('catalog track reload does not require an array-backed playlist', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const ordinal = 42;
    const track = {
      name: 'Catalog Track',
      path: '/catalog.wav',
      entryInstanceId: 'catalog-sequence:42'
    };
    const playlist = new Proxy(Object.create(null), {
      get(_target, property) {
        if (property === 'length') return 1_000_000;
        if (property === String(ordinal)) return track;
        return undefined;
      }
    });
    const harness = createHarness({
      calls,
      playlist,
      currentTrack: track,
      currentTrackIndex: ordinal
    });
    harness.audioPlayer.playbackManager.getTrackIndex = (candidate, identityOnly = false) => {
      calls.push(['playback.getTrackIndex', candidate, identityOnly]);
      return candidate === track ? ordinal : -1;
    };
    harness.manager.prepareTrackBuffer = async () => ({ duration: 8 });
    harness.manager.loadMetadata = () => {};
    harness.manager.prepareNextTrackBufferWithRepeatMode = () => {};

    assert.equal(await harness.manager.loadTrack(track, ordinal), true);
    assert.equal(harness.state.currentTrackIndex, ordinal);
    assert.equal(
      calls.some(call => call[0] === 'playback.getTrackIndex' && call[2] === true),
      true
    );
  });
});

test('out-of-order loadTrack completions do not overwrite the active track', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const playlist = [
      { name: 'One', path: '/one.wav' },
      { name: 'Two', path: '/two.wav' }
    ];
    const { manager, state } = createHarness({ calls, playlist, currentTrackIndex: 0 });
    const pending = new Map();

    manager.prepareTrackBuffer = async track => new Promise(resolve => {
      pending.set(track.name, resolve);
    });
    manager.loadMetadata = track => calls.push(['loadMetadata', track.name]);
    manager.prepareNextTrackBufferWithRepeatMode = () => calls.push(['prepareNextAfterLoad']);

    const firstLoad = manager.loadTrack(playlist[0]);
    const secondLoad = manager.loadTrack(playlist[1]);

    pending.get('Two')({ duration: 22 });
    await secondLoad;
    assert.equal(state.currentTrackName, 'Two');
    assert.equal(manager.currentBuffer.duration, 22);

    pending.get('One')({ duration: 11 });
    await firstLoad;
    assert.equal(state.currentTrackName, 'Two');
    assert.equal(manager.currentBuffer.duration, 22);
    assert.deepEqual(calls.filter(call => call[0] === 'loadMetadata'), [
      ['loadMetadata', 'Two']
    ]);
  });
});

test('repeat OFF first-track preparation is discarded after a newer load starts', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const playlist = [
      { name: 'One', path: '/one.wav' },
      { name: 'Two', path: '/two.wav' }
    ];
    const { manager, state } = createHarness({
      calls,
      playlist,
      currentTrackIndex: 1,
      repeatMode: 'OFF'
    });
    const pending = new Map();

    manager.prepareTrackBuffer = async (track, isStale) => new Promise(resolve => {
      pending.set(track.name, { resolve, isStale });
    });
    manager.loadMetadata = track => calls.push(['loadMetadata', track.name]);
    manager.prepareNextTrackBufferWithRepeatMode = () => calls.push(['prepareNextAfterLoad']);

    manager.handleTrackEnded();
    assert.equal(state.currentTrackIndex, 0);
    assert.equal(state.currentTrackName, 'One');
    assert.equal(pending.get('One').isStale(), false);

    const secondLoad = manager.loadTrack(playlist[1]);
    assert.equal(pending.get('One').isStale(), true);
    pending.get('Two').resolve({ duration: 22 });
    await secondLoad;
    assert.equal(state.currentTrackName, 'Two');
    assert.equal(manager.currentBuffer.duration, 22);

    pending.get('One').resolve({ duration: 11 });
    await flushMicrotasks();
    assert.equal(state.currentTrackName, 'Two');
    assert.equal(manager.currentBuffer.duration, 22);
    assert.equal(calls.some(call =>
      call[0] === 'state.updateState' &&
      call[2] === 'First track buffer prepared for next playback'
    ), false);
  });
});

test('repeat OFF first-track ready state clears stale ended buffer before prebuffer resolves', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const playlist = [
      { name: 'One', path: '/one.wav' },
      { name: 'Two', path: '/two.wav' }
    ];
    const endedBuffer = { duration: 99 };
    const { manager, state } = createHarness({
      calls,
      playlist,
      currentTrackIndex: 1,
      repeatMode: 'OFF',
      state: {
        currentTrack: playlist[1],
        currentBuffer: endedBuffer
      }
    });
    let resolvePrepare;

    manager.currentBuffer = endedBuffer;
    manager.bufferDuration = endedBuffer.duration;
    manager.prepareTrackBuffer = async () => new Promise(resolve => {
      resolvePrepare = resolve;
    });
    manager.loadMetadata = () => {};
    manager.prepareNextTrackBufferWithRepeatMode = () => calls.push(['prepareNextAfterStoppedPrebuffer']);

    manager.handleTrackEnded();

    assert.equal(state.currentTrackIndex, 0);
    assert.equal(state.currentTrackName, 'One');
    assert.equal(state.currentBuffer, null);
    assert.equal(manager.currentBuffer, null);
    assert.equal(manager.bufferDuration, 0);
    assert.equal(manager.hasCurrentBuffer(), false);

    resolvePrepare({ duration: 11 });
    await flushMicrotasks();
    assert.equal(manager.currentBuffer.duration, 11);
  });
});

test('repeat OFF first-track prebuffer does not start monitoring while stopped', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const playlist = [
      { name: 'One', path: '/one.wav' },
      { name: 'Two', path: '/two.wav' }
    ];
    const { manager, state } = createHarness({
      calls,
      playlist,
      currentTrackIndex: 1,
      repeatMode: 'OFF'
    });

    manager.prepareTrackBuffer = async () => ({ duration: 11 });
    manager.loadMetadata = () => {};
    manager.prepareNextTrackBufferWithRepeatMode = () => calls.push(['prepareNextAfterStoppedPrebuffer']);

    manager.handleTrackEnded();
    await flushMicrotasks();

    assert.equal(state.isStopped, true);
    assert.equal(manager.currentBuffer.duration, 11);
    assert.equal(manager.bufferMonitoringInterval, null);
    assert.equal(calls.some(call => call[0] === 'setInterval'), false);
  });
});

test('stale catalog artwork callbacks do not update the current track state', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const oldTrack = { name: 'Old', meta: { title: 'Old Title', artworkId: 'old-art' } };
    const newTrack = { name: 'New', meta: { title: 'New Title' } };
    const { audioPlayer, manager, state } = createHarness({
      calls,
      playlist: [oldTrack],
      state: { currentTrack: oldTrack }
    });
    let resolveOldArtwork;

    window.libraryManager = {
      getArtworkThumbURL(artworkId) {
        calls.push(['getArtworkThumbURL', artworkId]);
        return new Promise(resolve => {
          resolveOldArtwork = resolve;
        });
      }
    };

    manager.loadMetadata(oldTrack);
    state.currentTrack = newTrack;
    manager.loadMetadata(newTrack);

    resolveOldArtwork('blob:old-art');
    await flushMicrotasks();

    assert.equal(state.currentTrackName, 'New Title');
    assert.equal(state.artworkUrl, '');
    assert.equal(audioPlayer.ui.trackNameDisplay.textContent, 'New Title');
  });
});

test('v2 catalog metadata requests Now Playing artwork by track identity', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const track = {
      name: 'Catalog Track',
      libraryTrackId: 'track-uid-1',
      meta: { title: 'Catalog Title', artworkId: null }
    };
    const { manager } = createHarness({
      calls,
      playlist: [track],
      state: { currentTrack: track }
    });
    window.libraryManager = {
      runtime: 'web',
      async getArtworkThumbURL(trackUid, options) {
        calls.push(['getArtworkThumbURL', trackUid, options]);
        return '';
      }
    };

    manager.loadMetadata(track);
    await flushMicrotasks();

    assert.equal(calls.some(call =>
      call[0] === 'getArtworkThumbURL' &&
      call[1] === 'track-uid-1' &&
      call[2]?.reason === 'now-playing'
    ), true);
  });
});

test('stale ID3 metadata callbacks do not update the current track state', async () => {
  const tagHandlers = new Map();
  await withAudioContextGlobals({
    jsmediatags: {
      read(file, handlers) {
        tagHandlers.set(file.name, handlers);
      }
    }
  }, async ({ calls, objectUrls }) => {
    const oldTrack = { name: 'Old', file: new FakeFile('old.mp3') };
    const newTrack = { name: 'New', file: new FakeFile('new.mp3') };
    const { audioPlayer, manager, state } = createHarness({
      calls,
      playlist: [oldTrack],
      state: { currentTrack: oldTrack }
    });

    manager.loadMetadata(oldTrack);
    state.currentTrack = newTrack;
    manager.loadMetadata(newTrack);

    tagHandlers.get('new.mp3').onSuccess({ tags: { title: 'New Title' } });
    tagHandlers.get('old.mp3').onSuccess({
      tags: {
        title: 'Old Title',
        artist: 'Old Artist',
        picture: {
          data: new Uint8Array([1, 2, 3]),
          format: 'image/png'
        }
      }
    });

    assert.equal(state.currentTrackName, 'New Title');
    assert.equal(state.artworkUrl, '');
    assert.equal(audioPlayer.ui.trackNameDisplay.textContent, 'New Title');
    assert.equal(objectUrls.some(call => call[0] === 'create'), false);
  });
});

test('ID3 metadata normalizes legacy CP932 text before updating playback display', async () => {
  await withAudioContextGlobals({
    jsmediatags: {
      read(file, handlers) {
        assert.equal(file.name, '01-土曜日の嘘.mp3');
        handlers.onSuccess({
          tags: {
            title: '土曜日の嘘',
            artist: decodeLatin1([0x90, 0x58, 0x8e, 0x52, 0x92, 0xbc, 0x91, 0xbe, 0x98, 0x4e]),
            album: decodeLatin1([0x8c, 0x86, 0x8d, 0xec, 0x90, 0xef, 0x20, 0x32, 0x30, 0x30, 0x31, 0x81, 0x60, 0x32, 0x30, 0x30, 0x35, 0x20, 0x5b, 0x42, 0x6f, 0x6e, 0x75, 0x73, 0x20, 0x44, 0x69, 0x73, 0x63, 0x5d])
          }
        });
      }
    }
  }, async ({ calls, mediaSession }) => {
    const track = { name: '01-土曜日の嘘.mp3', file: new FakeFile('01-土曜日の嘘.mp3') };
    const { audioPlayer, manager, state } = createHarness({
      calls,
      playlist: [track],
      currentTrackIndex: 0,
      state: { currentTrack: track }
    });

    manager.loadMetadata(track, null, 0);

    assert.equal(state.currentTrackName, '森山直太朗 - 土曜日の嘘');
    assert.equal(audioPlayer.ui.trackNameDisplay.textContent, '森山直太朗 - 土曜日の嘘');
    assert.equal(mediaSession.metadata.metadata.title, '土曜日の嘘');
    assert.equal(mediaSession.metadata.metadata.artist, '森山直太朗');
    assert.equal(mediaSession.metadata.metadata.album, '傑作撰 2001～2005 [Bonus Disc]');
  });
});

test('WAV RIFF INFO metadata normalizes raw CP932 tags before updating playback display', async () => {
  await withAudioContextGlobals({
    jsmediatags: null
  }, async ({ calls, mediaSession }) => {
    const artistBytes = bytesFromHex('95bd89ea837d838a834a00');
    const albumBytes = bytesFromHex('83828369a5838a8354202081608367838a83728385815b836781458367834481458369836283678145834c8393834f81458352815b838b816000');
    const file = new FakeBlobFile('ddcb130163-3_1_01.wav', createRiffInfoWaveBytes([
      { id: 'INAM', data: asciiBytes('MONA LISA\0') },
      { id: 'IART', data: artistBytes },
      { id: 'IPRD', data: albumBytes }
    ]));
    const track = { name: file.name, file };
    const { audioPlayer, manager, state } = createHarness({
      calls,
      playlist: [track],
      currentTrackIndex: 0,
      state: { currentTrack: track }
    });

    manager.loadMetadata(track, null, 0);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await flushMicrotasks();
    }

    assert.equal(state.currentTrackName, '平賀マリカ - MONA LISA');
    assert.equal(audioPlayer.ui.trackNameDisplay.textContent, '平賀マリカ - MONA LISA');
    assert.equal(mediaSession.metadata.metadata.title, 'MONA LISA');
    assert.equal(mediaSession.metadata.metadata.artist, '平賀マリカ');
    assert.equal(mediaSession.metadata.metadata.album, 'モナ･リサ  ～トリビュート・トゥ・ナット・キング・コール～');
  });
});

test('disconnect invalidates pending metadata so late ID3 artwork is ignored', async () => {
  const tagHandlers = new Map();
  await withAudioContextGlobals({
    jsmediatags: {
      read(file, handlers) {
        tagHandlers.set(file.name, handlers);
      }
    }
  }, async ({ calls, objectUrls }) => {
    const fileTrack = { name: 'Pending Track', file: new FakeFile('pending.mp3') };
    const { manager, state } = createHarness({
      calls,
      playlist: [fileTrack],
      currentTrackIndex: 0,
      state: {
        currentTrack: fileTrack,
        currentTrackName: 'Pending Track'
      }
    });
    const loadRequest = manager.beginLoadRequest(fileTrack, 0);
    manager.beginTransitionRequest(fileTrack, 0);

    manager.loadMetadata(fileTrack, loadRequest, 0);
    assert.notEqual(manager.activeLoadRequest, null);
    assert.notEqual(manager.activeMetadataRequest, null);
    assert.notEqual(manager.activeTransitionRequest, null);

    manager.disconnect();
    assert.equal(manager.activeLoadRequest, null);
    assert.equal(manager.activeMetadataRequest, null);
    assert.equal(manager.activeTransitionRequest, null);

    tagHandlers.get('pending.mp3').onSuccess({
      tags: {
        title: 'Late Title',
        artist: 'Late Artist',
        picture: {
          data: new Uint8Array([1, 2, 3]),
          format: 'image/png'
        }
      }
    });

    assert.equal(state.currentTrack, null);
    assert.equal(state.currentTrackName, '');
    assert.equal(state.artworkUrl, '');
    assert.equal(manager.currentArtworkURL, null);
    assert.equal(objectUrls.some(call => call[0] === 'create'), false);
  });
});

test('disconnect restores a silent fallback source when no canonical input exists', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    window.electronIntegration.audioPreferences = { useInputWithPlayer: false };
    const harness = createHarness({ calls, noOriginalSource: true });
    harness.audioManager.ioManager.inputSourceNode = null;
    const staleNode = createNode(calls, 'destroyedPlayerSource');
    harness.audioManager.sourceNode = staleNode;

    harness.manager.disconnect();

    assert.notEqual(harness.audioManager.sourceNode, staleNode);
    assert.equal(harness.audioManager.sourceNode.name, 'gain');
    assert.equal(harness.manager.originalSourceNode, harness.audioManager.sourceNode);
    assert.equal(calls.some(call => call[0] === 'node.connect' &&
      call[1] === 'gain' && call[2] === 'worklet'), true);
  });
});

test('disconnect never publishes a canonical input that failed to reconnect', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    window.electronIntegration.audioPreferences = { useInputWithPlayer: false };
    const harness = createHarness({ calls, connectSourceReturnsFalse: true });
    const canonicalInput = harness.manager.originalSourceNode;

    harness.manager.disconnect();

    assert.notEqual(harness.audioManager.sourceNode, canonicalInput);
    assert.equal(harness.audioManager.sourceNode.name, 'gain');
    assert.equal(harness.manager.originalSourceNode, harness.audioManager.sourceNode);
  });
});

test('catalog metadata revokes previous embedded artwork URL', async () => {
  const tagHandlers = new Map();
  await withAudioContextGlobals({
    jsmediatags: {
      read(file, handlers) {
        tagHandlers.set(file.name, handlers);
      }
    }
  }, async ({ calls, objectUrls }) => {
    const embeddedTrack = { name: 'Embedded Track', file: new FakeFile('embedded.mp3') };
    const catalogTrack = {
      name: 'Catalog Track',
      meta: {
        title: 'Catalog Title',
        artist: 'Catalog Artist'
      }
    };
    const { audioPlayer, manager, state } = createHarness({
      calls,
      playlist: [embeddedTrack, catalogTrack],
      currentTrackIndex: 0,
      state: { currentTrack: embeddedTrack }
    });

    manager.loadMetadata(embeddedTrack, null, 0);
    tagHandlers.get('embedded.mp3').onSuccess({
      tags: {
        title: 'Embedded Title',
        artist: 'Embedded Artist',
        picture: {
          data: new Uint8Array([4, 5, 6]),
          format: 'image/png'
        }
      }
    });

    const artworkUrl = state.artworkUrl;
    assert.ok(artworkUrl);
    assert.equal(manager.currentArtworkURL, artworkUrl);
    assert.equal(objectUrls.some(call => call[0] === 'create' && call[1] === artworkUrl), true);

    state.currentTrack = catalogTrack;
    state.currentTrackIndex = 1;
    manager.loadMetadata(catalogTrack, null, 1);

    assert.equal(state.currentTrackName, 'Catalog Artist - Catalog Title');
    assert.equal(state.artworkUrl, '');
    assert.equal(manager.currentArtworkURL, null);
    assert.equal(objectUrls.some(call => call[0] === 'revoke' && call[1] === artworkUrl), true);
    assert.equal(audioPlayer.ui.trackNameDisplay.textContent, 'Catalog Artist - Catalog Title');
  });
});

test('stale nextBuffer preparation and consumption are discarded', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const trackA = { name: 'A', path: '/a.wav' };
    const trackB = { name: 'B', path: '/b.wav' };
    const inserted = { name: 'Inserted', path: '/inserted.wav' };
    const playlist = [trackA, trackB];
    const { manager } = createHarness({ calls, playlist, currentTrackIndex: 0 });
    let resolvePrepared;

    manager.prepareTrackBuffer = async track => new Promise(resolve => {
      calls.push(['prepareTrackBuffer', track.name]);
      resolvePrepared = resolve;
    });

    const preparePromise = manager.prepareNextTrackBufferWithRepeatMode();
    playlist.splice(1, 0, inserted);
    resolvePrepared({ duration: 5 });
    await preparePromise;
    assert.equal(manager.nextBuffer, null);

    setPreparedNextBuffer(manager, trackB, { duration: 9 });
    manager.loadTrack = async track => calls.push(['fallbackLoadTrack', track.name]);
    manager.play = async () => calls.push(['fallbackPlay']);

    await manager.transitionToNextTrack(inserted);
    assert.equal(manager.nextBuffer, null);
    assert.deepEqual(calls.filter(call => ['fallbackLoadTrack', 'fallbackPlay'].includes(call[0])), [
      ['fallbackLoadTrack', 'Inserted'],
      ['fallbackPlay']
    ]);
  });
});

test('handled transition load failures do not publish success after scheduling a skip', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const playlist = [
      { name: 'One', path: '/one.wav' },
      { name: 'Bad', path: '/bad.wav' },
      { name: 'Good', path: '/good.wav' }
    ];
    const { manager, state } = createHarness({ calls, playlist, currentTrackIndex: 0 });

    manager.prepareTrackBuffer = async track => {
      if (track.name === 'Bad') throw new Error('decode failed');
      return { duration: 12 };
    };
    manager.setupResolvedAudioElement = async () => {
      throw new Error('fallback failed');
    };
    manager.play = async () => {
      calls.push(['transitionFailurePlay']);
      return true;
    };

    assert.equal(await manager.transitionToNextTrack(playlist[1], 1), false);
    assert.equal(calls.some(call => call[0] === 'transitionFailurePlay'), false);
    assert.equal(
      calls.filter(call => call[0] === 'state.updateState' && call[2] === 'Transition completed').length,
      0
    );
    assert.deepEqual(
      calls.find(call => call[0] === 'playback.playNext'),
      ['playback.playNext', false, { allowDuringTransition: true, ignoreRepeatOne: true, failedIndex: 1 }]
    );
    assert.equal(state.isTransitioning, false);
    assert.equal(state.isPlaying, false);
  });
});

test('catalog load failure returns to the catalog candidate loop without scheduling a second skip', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const playlist = [{ name: 'Bad', path: '/bad.wav' }, { name: 'Good', path: '/good.wav' }];
    const { audioPlayer, manager } = createHarness({ calls, playlist });
    audioPlayer.playbackManager.catalogSequence = {};
    manager.prepareTrackBuffer = async () => { throw new Error('decode failed'); };
    manager.setupResolvedAudioElement = async () => { throw new Error('fallback failed'); };

    assert.equal(await manager.loadTrack(playlist[0], 0), false);
    assert.equal(calls.some(call => call[0] === 'playback.playNext'), false);
  });
});

test('stop invalidates pending transition loads before they can restart playback', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const playlist = [
      { name: 'One', path: '/one.wav' },
      { name: 'Two', path: '/two.wav' }
    ];
    const { manager, state } = createHarness({
      calls,
      playlist,
      currentTrackIndex: 0,
      isPlaying: true,
      isStopped: false,
      state: { isTransitioning: false, transitionType: null }
    });
    let resolveLoad;
    let isLoadStale;

    manager.prepareTrackBuffer = async (_track, isStale) => new Promise(resolve => {
      isLoadStale = isStale;
      resolveLoad = resolve;
    });
    manager.loadMetadata = track => calls.push(['stopRaceLoadMetadata', track.name]);
    manager.prepareNextTrackBufferWithRepeatMode = () => calls.push(['stopRacePrepareNext']);
    manager.play = async () => {
      calls.push(['stopRacePlay']);
      return true;
    };

    const transitionPromise = manager.transitionToNextTrack(playlist[1], 1);
    await flushMicrotasks();
    assert.equal(state.isTransitioning, true);

    await manager.stop();
    assert.equal(isLoadStale(), true);
    assert.equal(manager.activeLoadRequest, null);
    assert.equal(manager.activeTransitionRequest, null);
    assert.equal(state.isTransitioning, false);
    assert.equal(state.transitionType, null);

    resolveLoad({ duration: 12 });
    assert.equal(await transitionPromise, false);
    assert.equal(calls.some(call => call[0] === 'stopRacePlay'), false);
    assert.equal(calls.some(call => call[0] === 'stopRaceLoadMetadata'), false);
    assert.equal(state.isStopped, true);
    assert.equal(state.isPlaying, false);
  });
});

test('pause invalidates pending transition loads before they can restart playback', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const playlist = [
      { name: 'One', path: '/one.wav' },
      { name: 'Two', path: '/two.wav' }
    ];
    const { audioContext, manager, state } = createHarness({
      calls,
      playlist,
      currentTrackIndex: 0,
      isPlaying: true,
      isPaused: false,
      isStopped: false,
      playbackMode: 'bufferSource',
      state: {
        currentTrack: playlist[0],
        isTransitioning: false,
        transitionType: null
      }
    });
    let resolveLoad;
    let isLoadStale;

    manager.currentBuffer = { duration: 20 };
    manager.currentBufferSource = createNode(calls, 'pauseTransitionSource');
    manager.bufferStartTime = 10;
    manager.bufferDuration = 20;
    audioContext.currentTime = 15;
    manager.prepareTrackBuffer = async (_track, isStale) => new Promise(resolve => {
      isLoadStale = isStale;
      resolveLoad = resolve;
    });
    manager.loadMetadata = track => calls.push(['pauseRaceLoadMetadata', track.name]);
    manager.prepareNextTrackBufferWithRepeatMode = () => calls.push(['pauseRacePrepareNext']);
    manager.play = async () => {
      calls.push(['pauseRacePlay']);
      return true;
    };

    const transitionPromise = manager.transitionToNextTrack(playlist[1], 1);
    await flushMicrotasks();
    assert.equal(state.isTransitioning, true);
    assert.equal(typeof isLoadStale, 'function');

    await manager.pause();
    assert.equal(isLoadStale(), true);
    assert.equal(manager.activeLoadRequest, null);
    assert.equal(manager.activeTransitionRequest, null);
    assert.equal(state.isTransitioning, false);
    assert.equal(state.transitionType, null);
    assert.equal(state.isPaused, true);
    assert.equal(state.isStopped, false);
    assert.equal(state.isPlaying, false);
    assert.equal(calls.some(call => call[0] === 'node.stop' && call[1] === 'pauseTransitionSource'), true);

    resolveLoad({ duration: 12 });
    assert.equal(await transitionPromise, false);
    assert.equal(calls.some(call => call[0] === 'pauseRacePlay'), false);
    assert.equal(calls.some(call => call[0] === 'pauseRaceLoadMetadata'), false);
    assert.equal(calls.some(call => call[0] === 'node.start'), false);
    assert.equal(state.isPaused, true);
    assert.equal(state.isPlaying, false);
    assert.equal(state.isStopped, false);
  });
});

test('buffer source stop paths clear monitoring intervals', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const { manager } = createHarness({ calls, playbackMode: 'bufferSource' });

    manager.currentBufferSource = createNode(calls, 'stopSource');
    manager.bufferMonitoringInterval = 3;
    await manager.stopBufferSource();
    assert.equal(manager.bufferMonitoringInterval, null);
    assert.equal(calls.some(call => call[0] === 'clearInterval' && call[1] === 3), true);
    assert.equal(calls.some(call => call[0] === 'disconnectSourceFromPipeline' &&
      call[1] === 'stopSource'), true);

    manager.currentBufferSource = createNode(calls, 'stopCurrentSource');
    manager.bufferMonitoringInterval = 4;
    await manager.stopCurrentPlayback();
    assert.equal(manager.bufferMonitoringInterval, null);
    assert.equal(calls.some(call => call[0] === 'clearInterval' && call[1] === 4), true);
  });
});

test('seeking while stopped pauses at the target position for the next play', async () => {
  await withAudioContextGlobals({}, async ({ calls }) => {
    const bufferHarness = createHarness({
      calls,
      playbackMode: 'bufferSource',
      isStopped: true
    });
    bufferHarness.manager.currentBuffer = { duration: 10 };

    await bufferHarness.manager.seekBufferSource(4);
    assert.equal(bufferHarness.state.currentTrackPosition, 4);
    assert.equal(bufferHarness.state.isPaused, true);
    assert.equal(bufferHarness.state.isStopped, false);

    calls.length = 0;
    await bufferHarness.manager.playBufferSource();
    assert.equal(calls.some(call => call[0] === 'node.start' && call[3] === 4), true);

    const audioElement = new Audio();
    const elementHarness = createHarness({
      calls,
      playbackMode: 'audioElement',
      audioElement,
      isStopped: true
    });
    await elementHarness.manager.seekAudioElement(6);
    assert.equal(elementHarness.state.currentTrackPosition, 6);
    assert.equal(elementHarness.state.isPaused, true);
    assert.equal(elementHarness.state.isStopped, false);
  });
});

test('catalog track providers can supply authorized playback bytes without a filesystem path', async () => {
  await withAudioContextGlobals({}, async () => {
    const { manager } = createHarness();
    const data = await manager.loadTrackData({
      name: 'Catalog Track',
      libraryTrackId: 'track-1',
      provider: async () => ({ data: new Uint8Array([4, 5, 6]) })
    });
    assert.deepEqual([...new Uint8Array(data)], [4, 5, 6]);
  });
});

test('Electron catalog paths larger than 256 MiB stream without renderer byte IPC or object URLs', async () => {
  const byteReads = [];
  const catalogFileSize = (256 * 1024 * 1024) + 1;
  await withAudioContextGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      library: {
        async readFileBytes(request) {
          byteReads.push(['library.readFileBytes', request]);
          const error = new Error('ERR_LIBRARY_READ_LIMIT: renderer byte IPC must not receive catalog files');
          error.code = 'ERR_LIBRARY_READ_LIMIT';
          throw error;
        }
      },
      async readFile(path) {
        byteReads.push(['readFile', path]);
        throw new Error('must not use legacy base64 reads');
      }
    }
  }, async ({ calls, objectUrls }) => {
    const { audioPlayer, manager, state } = createHarness({ calls });
    const track = {
      name: 'Large catalog track',
      path: 'D:\\Music\\large.flac',
      libraryTrackId: 'track-large',
      sourceKind: 'electron-file',
      fileSize: catalogFileSize
    };

    assert.equal(await manager.loadTrack(track, 0), true);
    assert.equal(audioPlayer.audioElement.src, 'file:///D:/Music/large.flac');
    assert.equal(state.playbackMode, 'audioElement');
    assert.ok(track.fileSize > 256 * 1024 * 1024);
    assert.deepEqual(byteReads, []);
    assert.deepEqual(objectUrls, []);

    assert.equal(await manager.seamlessTransition(track, 0), true);
    assert.equal(state.isPlaying, true);
    assert.equal(calls.some(call => call[0] === 'audio.play'), true);

    await manager.prepareNextTrackBufferForTrack(track, 0);
    assert.equal(manager.nextBuffer, null);
    await assert.rejects(
      manager.prepareTrackBuffer(track),
      error => error?.code === 'directElectronCatalogSource'
    );
    await assert.rejects(
      manager.prepareTrackBuffer({
        name: 'Malformed catalog source',
        sourceKind: 'electron-file',
        data: new Uint8Array([1, 2, 3])
      }),
      error => error?.code === 'directElectronCatalogSource'
    );
    assert.deepEqual(byteReads, []);
  });
});

test('audio graph rebuild refreshes an Electron catalog occurrence without renderer byte reads', async () => {
  const byteReads = [];
  await withAudioContextGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      library: {
        async readFileBytes(request) {
          byteReads.push(['library.readFileBytes', request]);
          throw new Error('catalog graph rebuild must not read file bytes');
        }
      },
      async readFile(filePath) {
        byteReads.push(['readFile', filePath]);
        throw new Error('catalog graph rebuild must not use legacy file reads');
      }
    }
  }, async ({ calls, objectUrls }) => {
    const oldTrack = {
      name: 'Old grant',
      path: 'D:\\Music\\Old.flac',
      libraryTrackId: 'track-rebind',
      sourceKind: 'electron-file'
    };
    const refreshedTrack = {
      ...oldTrack,
      name: 'Refreshed grant',
      path: 'D:\\Music\\A # 100% 日本語.flac'
    };
    const harness = createHarness({
      calls,
      playlist: [oldTrack],
      currentTrackIndex: 0,
      state: {
        currentTrack: oldTrack,
        playbackMode: 'audioElement',
        currentTrackPosition: 7,
        isPlaying: false,
        isPaused: true,
        isStopped: false
      }
    });
    const revalidations = [];
    harness.audioPlayer.playbackManager.prepareCatalogTrackForGraphRebuild = async (track, options) => {
      revalidations.push([track, options]);
      return { handled: false, track: refreshedTrack };
    };
    harness.manager.prepareTrackBuffer = async () => {
      throw new Error('direct Electron catalog sources must not be decoded after a graph rebuild');
    };

    await harness.manager.handleAudioGraphRebuilt();

    assert.deepEqual(revalidations, [[oldTrack, { play: false }]]);
    assert.equal(
      harness.audioPlayer.audioElement.src,
      'file:///D:/Music/A%20%23%20100%25%20%E6%97%A5%E6%9C%AC%E8%AA%9E.flac'
    );
    assert.equal(harness.state.currentTrack, refreshedTrack);
    assert.equal(harness.state.currentTrackPosition, 7);
    assert.equal(harness.state.isPaused, true);
    assert.deepEqual(byteReads, []);
    assert.deepEqual(objectUrls, []);
  });
});

test('repeat OFF resets to a direct Electron first track without decoding or byte IPC', async () => {
  const byteReads = [];
  await withAudioContextGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      library: {
        async readFileBytes(request) {
          byteReads.push(request);
          throw new Error('repeat reset must not read direct catalog bytes');
        }
      }
    }
  }, async ({ calls }) => {
    const firstTrack = {
      name: 'First',
      path: 'D:\\Music\\First.flac',
      libraryTrackId: 'track-first',
      sourceKind: 'electron-file'
    };
    const lastTrack = {
      name: 'Last',
      path: 'D:\\Music\\Last.flac',
      libraryTrackId: 'track-last',
      sourceKind: 'electron-file'
    };
    const harness = createHarness({
      calls,
      playlist: [firstTrack, lastTrack],
      currentTrackIndex: 1,
      repeatMode: 'OFF',
      state: { currentTrack: lastTrack, isStopped: false }
    });
    let prepareCalls = 0;
    harness.manager.prepareTrackBuffer = async () => {
      prepareCalls += 1;
      throw new Error('direct Electron catalog reset must not decode');
    };
    harness.manager.loadMetadata = () => {};

    harness.manager.handleTrackEnded();
    await flushMicrotasks();

    assert.equal(harness.state.currentTrack, firstTrack);
    assert.equal(harness.state.currentTrackIndex, 0);
    assert.equal(harness.state.isStopped, true);
    assert.equal(prepareCalls, 0);
    assert.deepEqual(byteReads, []);
  });
});

test('Electron direct file loading uses the generic bounded byte reader', async () => {
  const apiCalls = [];
  await withAudioContextGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async readFileBytes(path) {
        apiCalls.push(['readFileBytes', path]);
        return Buffer.from('bytes');
      }
    }
  }, async () => {
    const { manager } = createHarness();
    const data = await manager.loadTrackData({ name: 'Local', path: 'C:\\outside.wav' });
    assert.deepEqual(Array.from(new Uint8Array(data)), Array.from(Buffer.from('bytes')));
  });

  assert.deepEqual(apiCalls, [['readFileBytes', 'C:\\outside.wav']]);
});

test('non-catalog Electron file loading preserves byte-read limits', async () => {
  const apiCalls = [];
  await withAudioContextGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async readFileBytes(path) {
        apiCalls.push(['readFileBytes', path]);
        throw new Error(
          'Error invoking remote method read-file-bytes: ERR_LIBRARY_READ_LIMIT: ' +
          'File exceeds maximum read size of 268435456 bytes'
        );
      }
    }
  }, async () => {
    const { manager } = createHarness();
    await assert.rejects(
      () => manager.loadTrackData({ name: 'Large', path: 'C:\\large.wav' }),
      error => error?.suppressAudioElementFallback === true &&
        /ERR_LIBRARY_READ_LIMIT/.test(error.message) &&
        /maximum read size/.test(error.message)
    );
  });

  assert.deepEqual(apiCalls, [
    ['readFileBytes', 'C:\\large.wav']
  ]);
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
    assert.equal(manager.nextBuffer.buffer.duration, 3);
    assert.equal(manager.nextBuffer.track, playlist[1]);

    state.currentTrackIndex = 2;
    state.repeatMode = 'OFF';
    manager.nextBuffer = null;
    await manager.prepareNextTrackBufferWithRepeatMode();
    assert.equal(manager.nextBuffer, null);
    state.repeatMode = 'ALL';
    await manager.prepareNextTrackBufferWithRepeatMode();
    assert.equal(manager.nextBuffer.buffer.duration, 3);
    assert.equal(manager.nextBuffer.track, playlist[0]);
    await manager.prepareNextTrackBufferForTrack(null);
    manager.prepareTrackBuffer = async () => { throw new Error('prepare next failed'); };
    await manager.prepareNextTrackBufferForTrack(playlist[1]);

    assert.equal(manager.getNextTrack(), playlist[0]);
    const noPlayback = createHarness({ calls, noStateManager: true, noPlaybackManager: true });
    assert.equal(noPlayback.manager.getNextTrack(), null);

    const transition = createHarness({ calls, playlist, currentTrackIndex: 0, repeatMode: 'ALL' });
    setPreparedNextBuffer(transition.manager, playlist[1], { duration: 12 });
    transition.manager.prepareNextTrackBufferForTrack = async track => calls.push(['prepareSpecificNext', track.name]);
    await transition.manager.transitionToNextTrack(playlist[1]);
    assert.equal(transition.state.currentTrackName, 'Two');

    const duplicatePathTransitionPlaylist = [
      { name: 'Current', path: '/current.wav' },
      { name: 'Same Path A', path: '/same.wav' },
      { name: 'Same Path B', path: '/same.wav' }
    ];
    const duplicatePathTransition = createHarness({
      calls,
      playlist: duplicatePathTransitionPlaylist,
      currentTrackIndex: 0
    });
    duplicatePathTransition.manager.loadMetadata = () => {};
    duplicatePathTransition.manager.prepareNextTrackBufferWithRepeatMode = () => {};
    setPreparedNextBuffer(duplicatePathTransition.manager, duplicatePathTransitionPlaylist[2], { duration: 4 }, 2);
    await duplicatePathTransition.manager.transitionToNextTrack(duplicatePathTransitionPlaylist[2], 2);
    assert.equal(duplicatePathTransition.state.currentTrackIndex, 2);

    const duplicateLibraryTransitionPlaylist = [
      { name: 'Current', path: '/current.wav' },
      { name: 'Library A', path: '/library-a.wav', libraryTrackId: 'duplicate-id' },
      { name: 'Library B', path: '/library-b.wav', libraryTrackId: 'duplicate-id' }
    ];
    const duplicateLibraryTransition = createHarness({
      calls,
      playlist: duplicateLibraryTransitionPlaylist,
      currentTrackIndex: 0
    });
    duplicateLibraryTransition.manager.loadMetadata = () => {};
    duplicateLibraryTransition.manager.prepareNextTrackBufferWithRepeatMode = () => {};
    setPreparedNextBuffer(duplicateLibraryTransition.manager, duplicateLibraryTransitionPlaylist[2], { duration: 5 }, 2);
    await duplicateLibraryTransition.manager.transitionToNextTrack(duplicateLibraryTransitionPlaylist[2], 2);
    assert.equal(duplicateLibraryTransition.state.currentTrackIndex, 2);

    const transitionLoad = createHarness({ calls, playlist });
    transitionLoad.manager.loadTrack = async track => calls.push(['transitionLoadTrack', track.name]);
    transitionLoad.manager.play = async () => calls.push(['transitionPlay']);
    await transitionLoad.manager.transitionToNextTrack(playlist[2]);

    const transitionFail = createHarness({ calls, playlist });
    setPreparedNextBuffer(transitionFail.manager, playlist[1], { duration: 4 });
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
    setPreparedNextBuffer(manager, playlist[1], { duration: 2 });
    manager.bufferMonitoringInterval = 3;
    window.electronIntegration.audioPreferences = { useInputWithPlayer: false };
    objectUrls.push(['create', 'blob:old']);
    manager.disconnect();
    assert.equal(manager.currentBuffer, null);
    assert.equal(manager.nextBuffer, null);
    assert.equal(objectUrls.some(call => call[0] === 'revoke' && call[1] === 'blob:old'), true);
    assert.equal(mediaSession.handlers.size, 0);
    assert.equal(audioManager.sourceNode.name, 'originalSource');
    assert.equal(calls.some(call => call[0] === 'disconnectSourceFromPipeline' &&
      call[1] === 'disconnectMedia'), true);

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
    assert.equal(noPlayback.state.currentTrackIndex, 0);

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
    setPreparedNextBuffer(transitionLastAll.manager, transitionLastAll.playlist[1], { duration: 2 });
    transitionLastAll.manager.prepareNextTrackBufferForTrack = async track => calls.push(['transitionLastAllNext', track.name]);
    await transitionLastAll.manager.transitionToNextTrack({ name: 'B', path: '/b' });

    const transitionLastOff = createHarness({
      calls,
      playlist: [{ name: 'A', path: '/a' }, { name: 'B', path: '/b' }],
      currentTrackIndex: 0,
      repeatMode: 'OFF'
    });
    setPreparedNextBuffer(transitionLastOff.manager, transitionLastOff.playlist[1], { duration: 2 });
    transitionLastOff.manager.prepareNextTrackBufferWithRepeatMode = () => calls.push(['transitionPrepareFallback']);
    await transitionLastOff.manager.transitionToNextTrack({ name: 'B', path: '/b' });

    const transitionFile = createHarness({
      calls,
      playlist: [{ name: 'File', file: new FakeFile('next.wav') }],
      currentTrackIndex: 0
    });
    setPreparedNextBuffer(transitionFile.manager, transitionFile.playlist[0], { duration: 5 });
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
