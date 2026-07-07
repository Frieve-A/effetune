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
    }
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

test('loadFiles delegates playlist loading, creates missing UI, then loads and plays', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const player = createPlayer();
    player.playbackManager.loadFiles = (files, append) => calls.push(['loadFiles', files, append]);
    player.ui.container = null;
    player.ui.createPlayerUI = () => {
      calls.push(['createPlayerUI']);
      player.ui.container = { id: 'created' };
    };
    player.stateManager.getCurrentTrackIndex = () => 3;
    player.loadTrack = async index => calls.push(['loadTrack', index]);
    player.play = async () => calls.push(['play']);

    await player.loadFiles(['a.wav'], true);
    assert.deepEqual(calls.filter(call => ['loadFiles', 'createPlayerUI', 'loadTrack', 'play'].includes(call[0])), [
      ['loadFiles', ['a.wav'], true],
      ['createPlayerUI'],
      ['loadTrack', 3],
      ['play']
    ]);

    calls.length = 0;
    player.ui.container = { id: 'existing' };
    await player.loadFiles(['b.wav'], false);
    assert.equal(calls.some(call => call[0] === 'createPlayerUI'), false);
    assert.deepEqual(calls.filter(call => call[0] === 'loadFiles' || call[0] === 'loadTrack' || call[0] === 'play'), [
      ['loadFiles', ['b.wav'], false],
      ['loadTrack', 3],
      ['play']
    ]);
  });
});

test('loadFiles skips play when track load is aborted and loadTrack reports context result', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const player = createPlayer();
    player.playbackManager.loadFiles = (files, append) => calls.push(['loadFiles', files, append]);
    player.ui.container = { id: 'existing' };
    player.ui.createPlayerUI = () => calls.push(['createPlayerUI']);
    player.stateManager.getCurrentTrackIndex = () => 3;
    player.stateManager.getStateSnapshot = () => ({ isPaused: false });
    player.loadTrack = async index => {
      calls.push(['loadTrack', index]);
      return false;
    };
    player.play = async () => calls.push(['play']);

    await player.loadFiles(['a.wav'], false);
    assert.deepEqual(calls.filter(call => call[0] === 'loadFiles' || call[0] === 'loadTrack'), [
      ['loadFiles', ['a.wav'], false],
      ['loadTrack', 3]
    ]);
    assert.equal(calls.some(call => call[0] === 'play'), false);
  });

  await withAudioPlayerGlobals({}, async () => {
    const player = createPlayer();
    const track = { name: 'Song' };
    player.playbackManager = {
      getTrack(index) {
        return index === 1 ? track : null;
      }
    };
    player.contextManager = {
      async loadTrack() {
        return false;
      }
    };

    assert.equal(await player.loadTrack(1), false);
    player.contextManager.loadTrack = async () => undefined;
    assert.equal(await player.loadTrack(1), true);
    player.contextManager.loadTrack = async () => true;
    assert.equal(await player.loadTrack(1), true);
    assert.equal(await player.loadTrack(2), false);
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
      async playPrevious() {
        calls.push(['playPrevious']);
        return 'previous-result';
      },
      async playNext(userInitiated) {
        calls.push(['playNext', userInitiated]);
        return `next-result-${userInitiated}`;
      },
      fastForward() {
        calls.push(['fastForward']);
      },
      rewind() {
        calls.push(['rewind']);
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
      ['playPrevious'],
      ['playNext', true],
      ['playNext', false],
      ['fastForward'],
      ['rewind']
    ]);
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
