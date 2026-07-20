import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioPlayer } from '../../js/ui/audio-player.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

async function withAudioPlayerGlobals(options, callback) {
  const calls = [];
  const documentRef = {
    listeners: new Map(),
    addEventListener(type, listener) {
      calls.push(['documentAddEventListener', type]);
      documentRef.listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      calls.push(['documentRemoveEventListener', type, listener === documentRef.listeners.get(type)]);
      documentRef.listeners.delete(type);
    }
  };

  return withGlobals({
    window: options.window ?? {},
    document: documentRef,
    console: {
      ...console,
      log(...args) {
        calls.push(['consoleLog', ...args]);
      },
      warn(...args) {
        calls.push(['consoleWarn', ...args]);
      },
      error(...args) {
        calls.push(['consoleError', ...args]);
      }
    },
    requestAnimationFrame(callbackFn) {
      calls.push(['requestAnimationFrame']);
      callbackFn();
      return calls.length;
    },
    ...options.globals
  }, async () => callback({ calls, documentRef }));
}

function createAudioManager() {
  return {
    audioContext: { sampleRate: 48000 },
    sourceNode: {
      disconnect() {}
    },
    workletNode: {
      connect() {}
    }
  };
}

function createPlayer() {
  return new AudioPlayer(createAudioManager());
}

test('constructor wires sub-managers and refreshes UI only when a container exists', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const player = createPlayer();
    assert.equal(player.audioManager.audioContext, player.audioContext);
    assert.equal(player.audioElement, null);
    assert.ok(player.stateManager);
    assert.ok(player.playbackManager);
    assert.ok(player.ui);
    assert.ok(player.contextManager);
    assert.ok(player.mediaSessionManager);
    assert.ok(calls.some(call => call[0] === 'documentAddEventListener' && call[1] === 'keydown'));

    player.ui.container = { id: 'player' };
    player.ui.updatePlayerUIState = () => calls.push(['updatePlayerUIState']);
    await flushMicrotasks();
    assert.ok(calls.some(call => call[0] === 'updatePlayerUIState'));

    const playerWithoutContainer = createPlayer();
    playerWithoutContainer.ui.updatePlayerUIState = () => calls.push(['unexpectedUiUpdate']);
    await flushMicrotasks();
    assert.equal(calls.some(call => call[0] === 'unexpectedUiUpdate'), false);
  });
});

test('startup-created player uses the canonical AudioContext for buffer and media preparation', async () => {
  class TestAudio {
    constructor() {
      this.src = '';
      this.duration = 10;
      this.readyState = 1;
    }

    load() {}
    pause() {}
  }

  await withAudioPlayerGlobals({ globals: { Audio: TestAudio } }, async () => {
    const audioManager = createAudioManager();
    const startupContext = audioManager.audioContext;
    const decodedBuffer = { duration: 10 };
    const mediaSource = { disconnect() {} };
    startupContext.decodeAudioData = (_bytes, resolve) => resolve(decodedBuffer);
    startupContext.createMediaElementSource = () => mediaSource;
    audioManager.audioContext = null;
    audioManager.contextManager = { audioContext: null };
    const player = new AudioPlayer(audioManager);

    assert.equal(player.audioContext, null);

    audioManager.contextManager.audioContext = startupContext;
    audioManager.audioContext = startupContext;
    assert.equal(player.audioContext, startupContext);
    assert.equal(await player.contextManager.prepareTrackBuffer({
      name: 'Track 1',
      data: new Uint8Array([1, 2, 3])
    }), decodedBuffer);

    player.contextManager.waitForMediaCandidateReadiness = async (
      _element,
      _region,
      isStale,
      startLoad
    ) => {
      startLoad();
      return !isStale();
    };
    player.contextManager.connectPrivatePipelineSource = () => true;
    const mediaCandidate = await player.contextManager.prepareMediaTransitionCandidate({
      descriptor: { mediaSource: '/music/track-1.flac' },
      playableTrack: { name: 'Track 1', path: '/music/track-1.flac' }
    }, 1, () => false);
    assert.equal(mediaCandidate.source, mediaSource);

    const rebuiltContext = { sampleRate: 96000 };
    audioManager.contextManager.audioContext = rebuiltContext;
    assert.equal(player.audioContext, startupContext);
    player.audioContext = rebuiltContext;
    assert.equal(player.audioContext, rebuiltContext);

    audioManager.contextManager.audioContext = null;
    audioManager.audioContext = null;
    player.audioContext = null;
    assert.equal(player.audioContext, null);
  });
});

test('loadFiles delegates queue creation and activation through the shared selector', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const player = createPlayer();
    player.playbackManager.loadFiles = (files, append) => calls.push(['loadFiles', files, append]);
    player.ui.container = null;
    player.ui.createPlayerUI = () => {
      calls.push(['createPlayerUI']);
      player.ui.container = { id: 'created' };
    };
    player.stateManager.getCurrentTrackIndex = () => 3;
    player.playbackManager.selectQueueOrdinal = async (ordinal, options) => {
      calls.push(['selectQueueOrdinal', ordinal, options]);
      return { accepted: true };
    };

    await player.loadFiles(['a.wav'], true);
    assert.deepEqual(calls.filter(call => ['loadFiles', 'createPlayerUI', 'selectQueueOrdinal'].includes(call[0])), [
      ['loadFiles', ['a.wav'], true],
      ['createPlayerUI'],
      ['selectQueueOrdinal', 3, {
        play: true,
        userInitiated: true,
        skipUnavailable: true,
        playbackReady: true
      }]
    ]);

    calls.length = 0;
    player.ui.container = { id: 'existing' };
    await player.loadFiles(['b.wav'], false);
    assert.equal(calls.some(call => call[0] === 'createPlayerUI'), false);
    assert.deepEqual(calls.filter(call => call[0] === 'loadFiles' || call[0] === 'selectQueueOrdinal'), [
      ['loadFiles', ['b.wav'], false],
      ['selectQueueOrdinal', 3, {
        play: true,
        userInitiated: true,
        skipUnavailable: true,
        playbackReady: true
      }]
    ]);
  });
});

test('loadFiles starts a mixed resume synchronously and waits before queue activation', async () => {
  await withAudioPlayerGlobals({ window: { audioPreferences: { useInputWithPlayer: true } } }, async ({ calls }) => {
    const audioManager = createAudioManager();
    let finishResume;
    audioManager.powerPolicyController = {
      enabled: true,
      attachPlayer() {},
      beginUserGestureResume(kind) {
        calls.push(['beginUserGestureResume', kind]);
        return new Promise(resolve => { finishResume = resolve; });
      }
    };
    const player = new AudioPlayer(audioManager);
    player.stateManager.updateState({
      currentTrack: { name: 'A' },
      currentBuffer: { id: 'buffer-a' },
      currentTrackPosition: 12,
      isPlaying: true,
      isStopped: false
    }, 'test playing A');
    player.stop = async () => {
      calls.push(['stopOldSource']);
      player.stateManager.updateState({
        currentBuffer: null,
        currentTrackPosition: 0,
        isPlaying: false,
        isStopped: true
      }, 'test stop A');
    };
    player.playbackManager.loadFiles = () => {
      calls.push(['loadFiles']);
      player.stateManager.updateState({ currentTrack: { name: 'B' } }, 'test publish B');
    };
    player.ui.container = { id: 'ui' };
    player.stateManager.getCurrentTrackIndex = () => 0;
    player.playbackManager.selectQueueOrdinal = async (ordinal, options) => {
      calls.push(['selectQueueOrdinal', ordinal, options]);
      player.stateManager.updateState({ currentBuffer: { id: 'buffer-b' } }, 'test activated B');
      return { accepted: true };
    };

    const loading = player.loadFiles(['a.wav']);

    assert.equal(player.stateManager.getStateSnapshot().isPlaybackPending, true);

    assert.deepEqual(calls.filter(call => [
      'beginUserGestureResume',
      'stopOldSource',
      'loadFiles'
    ].includes(call[0])), [
      ['beginUserGestureResume', 'mixed-play'],
      ['stopOldSource'],
      ['loadFiles']
    ]);
    const pendingState = player.stateManager.getStateSnapshot();
    assert.equal(pendingState.currentTrack.name, 'B');
    assert.equal(pendingState.currentBuffer, null);
    assert.equal(pendingState.currentTrackPosition, 0);
    assert.equal(pendingState.isStopped, true);
    finishResume(true);
    await loading;
    assert.deepEqual(calls.find(call => call[0] === 'selectQueueOrdinal'), [
      'selectQueueOrdinal',
      0,
      { play: true, userInitiated: true, skipUnavailable: true, playbackReady: true }
    ]);
    assert.equal(player.stateManager.getStateSnapshot().currentBuffer.id, 'buffer-b');
    assert.equal(player.stateManager.getStateSnapshot().isPlaybackPending, false);
  });
});

test('loadFiles stops the old source and reports failure when a replacement resume fails', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const audioManager = createAudioManager();
    audioManager.powerPolicyController = {
      enabled: true,
      attachPlayer() {},
      beginUserGestureResume() {
        calls.push(['beginUserGestureResume']);
        return Promise.resolve(false);
      }
    };
    const player = new AudioPlayer(audioManager);
    player.stateManager.updateState({
      currentTrack: { name: 'A' },
      currentBuffer: { id: 'buffer-a' },
      currentTrackPosition: 23,
      isPlaying: true,
      isStopped: false
    }, 'test playing A');
    player.playbackManager.loadFiles = () => {
      calls.push(['loadFiles']);
      player.stateManager.updateState({ currentTrack: { name: 'B' } }, 'test select B');
    };
    player.ui.container = { id: 'ui' };
    player.stateManager.getCurrentTrackIndex = () => 0;
    player.playbackManager.selectQueueOrdinal = async () => {
      calls.push(['selectQueueOrdinal']);
      return { accepted: true };
    };
    player.stop = async () => {
      calls.push(['stopOldSource']);
      player.stateManager.updateState({
        isPlaying: false,
        isPaused: false,
        isStopped: true,
        currentTrackPosition: 0
      }, 'test stop after resume failure');
    };

    const loaded = await player.loadFiles(['b.wav']);

    assert.equal(loaded, false);
    assert.ok(calls.some(call => call[0] === 'beginUserGestureResume'));
    assert.ok(calls.some(call => call[0] === 'stopOldSource'));
    assert.equal(calls.some(call => call[0] === 'selectQueueOrdinal'), false);
    const state = player.stateManager.getStateSnapshot();
    assert.equal(state.currentTrack.name, 'B');
    assert.equal(state.currentBuffer.id, 'buffer-a');
    assert.equal(state.currentTrackPosition, 0);
    assert.equal(state.isStopped, true);
  });
});

test('loadFiles returns the shared selection result and preserves a later Stop barrier', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const player = createPlayer();
    player.playbackManager.loadFiles = () => calls.push(['loadFiles']);
    player.ui.container = { id: 'ui' };
    player.stateManager.getCurrentTrackIndex = () => 0;
    player.playbackManager.selectQueueOrdinal = async () => ({ accepted: false });
    assert.equal(await player.loadFiles(['a.wav']), false);

    calls.length = 0;
    player.playbackManager.selectQueueOrdinal = async () => ({ accepted: true });
    assert.equal(await player.loadFiles(['b.wav']), true);

    calls.length = 0;
    player.playbackManager.selectQueueOrdinal = async () => {
      player.contextManager.stopRequestToken++;
      return { accepted: true };
    };
    assert.equal(await player.loadFiles(['c.wav']), false);

    player.loadTrack = AudioPlayer.prototype.loadTrack.bind(player);
    player.playbackManager.getTrack = () => ({ name: 'Song' });
    player.contextManager = {
      async loadTrack() {
        return false;
      }
    };
    assert.equal(await player.loadTrack(0), false);
    player.contextManager.loadTrack = async () => undefined;
    assert.equal(await player.loadTrack(0), true);
    player.playbackManager.getTrack = () => null;
    assert.equal(await player.loadTrack(0), false);
  });
});

test('loadTrack and playback command methods delegate to their managers', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const player = createPlayer();
    const track = { name: 'Song' };
    let resolvePause;
    player.playbackManager = {
      getTrack(index) {
        calls.push(['getTrack', index]);
        return index === 1 ? track : null;
      },
      async play() {
        calls.push(['playbackPlay']);
      },
      pause() {
        calls.push(['playbackPause']);
        return new Promise(resolve => {
          resolvePause = () => {
            calls.push(['playbackPauseDone']);
            resolve();
          };
        });
      },
      async togglePlayPause() {
        calls.push(['togglePlayPause']);
      },
      async stop() {
        calls.push(['playbackStop']);
      },
      async playPrevious(userInitiated) {
        calls.push(['playPrevious', userInitiated]);
        return 'previous-result';
      },
      async playNext(userInitiated) {
        calls.push(['playNext', userInitiated]);
        return `next-result-${userInitiated}`;
      },
      fastForward(userInitiated) {
        calls.push(['fastForward', userInitiated]);
      },
      rewind(userInitiated) {
        calls.push(['rewind', userInitiated]);
      },
      playlist: []
    };
    player.contextManager = {
      async loadTrack(trackArg) {
        calls.push(['contextLoadTrack', trackArg]);
      }
    };

    await player.loadTrack(1);
    await player.loadTrack(2);
    await player.play();
    const pausePromise = player.pause();
    assert.equal(typeof pausePromise?.then, 'function');
    resolvePause();
    await pausePromise;
    await player.togglePlayPause();
    await player.stop();
    assert.equal(await player.playPrevious(), 'previous-result');
    assert.equal(await player.playNext(), 'next-result-true');
    assert.equal(await player.playNext(false), 'next-result-false');
    player.fastForward();
    player.rewind();

    assert.deepEqual(calls.filter(call => call[0] !== 'documentAddEventListener'), [
      ['getTrack', 1],
      ['contextLoadTrack', track],
      ['getTrack', 2],
      ['playbackPlay'],
      ['playbackPause'],
      ['playbackPauseDone'],
      ['togglePlayPause'],
      ['playbackStop'],
      ['playPrevious', true],
      ['playNext', true],
      ['playNext', false],
      ['fastForward', true],
      ['rewind', true]
    ]);
  });
});

test('toggle delegates the complete intent to the playback manager', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const player = createPlayer();
    player.resumeAudioContextInGesture = () => calls.push(['resumeAudioContextInGesture']);
    player.playbackManager.togglePlayPause = async () => {
      calls.push(['togglePlayPause']);
    };

    await player.togglePlayPause();
    assert.deepEqual(calls.filter(call => [
      'togglePlayPause',
      'resumeAudioContextInGesture'
    ].includes(call[0])), [
      ['togglePlayPause']
    ]);

    assert.equal(calls.some(call => call[0] === 'resumeAudioContextInGesture'), false);
  });
});

test('stop delegates to the playback manager', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const player = createPlayer();
    player.playbackManager.stop = async () => calls.push(['playbackStop']);

    await player.stop();

    assert.deepEqual(calls.filter(call => call[0] === 'playbackStop'), [['playbackStop']]);
  });
});

test('state listeners update seek and disabled controls when optional collaborators are missing', async () => {
  await withAudioPlayerGlobals({}, async () => {
    const player = createPlayer();
    await flushMicrotasks();
    const seekBar = { disabled: null };
    const controls = [
      { disabled: null },
      { disabled: null },
      null,
      { disabled: null },
      { disabled: null },
      { disabled: null }
    ];
    [
      player.ui.playPauseButton,
      player.ui.stopButton,
      player.ui.prevButton,
      player.ui.nextButton,
      player.ui.repeatButton,
      player.ui.shuffleButton
    ] = controls;
    player.ui.seekBar = seekBar;

    player.stateManager.updateState({ seekBarEnabled: false }, 'test');
    assert.equal(seekBar.disabled, true);

    player.stateManager.updateState({ controlsEnabled: false }, 'test');
    assert.deepEqual(controls.filter(Boolean).map(control => control.disabled), [
      true,
      true,
      true,
      true,
      true
    ]);

    player.ui = null;
    player.stateManager.updateState({
      seekBarEnabled: true,
      controlsEnabled: true
    }, 'test');
    assert.equal(seekBar.disabled, true);
  });
});

test('close cleans up collaborators, clears uiManager, and debug info reflects manager state', async () => {
  await withAudioPlayerGlobals({ window: { uiManager: { audioPlayer: 'existing' } } }, async ({ calls }) => {
    const player = createPlayer();
    globalThis.window.uiManager.audioPlayer = player;
    player.playbackManager = {
      playlist: [{}, {}],
      savePlayerState() {
        calls.push(['savePlayerState']);
      },
      dispose() {
        calls.push(['dispose']);
      }
    };
    player.contextManager = {
      currentPlaybackMode: 'bufferSource',
      nextTrackBuffer: { id: 'next' },
      isTransitioning: true,
      isUsingBufferPlayback() {
        calls.push(['isUsingBufferPlayback']);
        return true;
      },
      disconnect() {
        calls.push(['disconnect']);
      },
      clearNextTrackBuffer() {
        calls.push(['clearNextTrackBuffer']);
      }
    };
    player.ui = {
      removeUI() {
        calls.push(['removeUI']);
      }
    };
    player.stateManager.clearStateHistory = () => calls.push(['clearStateHistory']);

    const debugWithNext = player.getDebugInfo();
    assert.equal(debugWithNext.contextManager.hasNextTrackBuffer, true);

    player.contextManager.nextTrackBuffer = null;
    const debugWithoutNext = player.getDebugInfo();
    assert.equal(debugWithoutNext.contextManager.hasNextTrackBuffer, false);
    assert.equal(debugWithoutNext.playbackManager.playlistLength, 2);

    player.close();
    assert.equal(player.audioElement, null);
    assert.equal(globalThis.window.uiManager.audioPlayer, null);
    assert.deepEqual(calls.filter(call => [
      'savePlayerState',
      'disconnect',
      'clearNextTrackBuffer',
      'removeUI',
      'dispose',
      'clearStateHistory'
    ].includes(call[0])), [
      ['savePlayerState'],
      ['disconnect'],
      ['clearNextTrackBuffer'],
      ['removeUI'],
      ['dispose'],
      ['clearStateHistory']
    ]);
  });

  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const player = createPlayer();
    player.playbackManager = {
      playlist: [],
      savePlayerState() {
        calls.push(['savePlayerStateNoUiManager']);
      },
      dispose() {}
    };
    player.contextManager = {
      disconnect() {},
      clearNextTrackBuffer() {},
      isUsingBufferPlayback() {
        return false;
      }
    };
    player.ui = { removeUI() {} };
    player.stateManager.clearStateHistory = () => {};

    player.close();
    assert.ok(calls.some(call => call[0] === 'savePlayerStateNoUiManager'));
  });
});
