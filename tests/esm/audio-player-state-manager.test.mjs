import assert from 'node:assert/strict';
import test from 'node:test';

import { StateManager } from '../../js/ui/audio-player/state-manager.js';

async function withMutedConsole(method, callback) {
  const original = console[method];
  console[method] = () => {};
  try {
    return await callback();
  } finally {
    console[method] = original;
  }
}

async function withCapturedConsole(method, callback) {
  const original = console[method];
  const calls = [];
  console[method] = (...args) => calls.push(args);
  try {
    return await callback(calls);
  } finally {
    console[method] = original;
  }
}

function createStableStateManager() {
  const manager = new StateManager({});
  manager.state.playlist = [{ name: 'Stable' }];
  manager.state.playlistLength = 1;
  return manager;
}

test('StateManager initializes defaults and returns defensive snapshots', () => {
  const manager = new StateManager({ id: 'player' });
  const snapshot = manager.getStateSnapshot();

  assert.equal(snapshot.isStopped, true);
  assert.equal(snapshot.repeatMode, 'OFF');
  assert.equal(snapshot.artworkUrl, '');
  assert.equal(snapshot.isTrackPresentationPending, false);
  assert.equal(snapshot.isPlaybackPending, false);
  snapshot.isStopped = false;
  assert.equal(manager.getStateSnapshot().isStopped, true);
});

test('playback pending ownership is immediate, scoped, and cancellation-safe', () => {
  const manager = new StateManager({});

  const finishExplicit = manager.beginPlaybackPending(2);
  assert.equal(manager.state.isPlaybackPending, true);

  const finishAutomatic = manager.beginPlaybackPending(1);
  finishExplicit();
  assert.equal(manager.state.isPlaybackPending, true, 'a lower-priority active wait remains visible');
  finishAutomatic();
  assert.equal(manager.state.isPlaybackPending, false);

  const finishOld = manager.beginPlaybackPending(2);
  const finishLatest = manager.beginPlaybackPending(2);
  finishOld();
  assert.equal(manager.state.isPlaybackPending, true, 'an obsolete owner cannot clear the latest wait');
  finishLatest();
  assert.equal(manager.state.isPlaybackPending, false);

  const finishCancelled = manager.beginPlaybackPending(3);
  manager.cancelPlaybackPending();
  assert.equal(manager.state.isPlaybackPending, false);
  finishCancelled();
  assert.equal(manager.state.isPlaybackPending, false, 'late completion cannot revive a cancelled wait');
});

test('StateManager validates playback state, track bounds, and enum values', async () => {
  const manager = new StateManager({});

  await withMutedConsole('warn', async () => {
    manager.updateState({
      isPlaying: true,
      isPaused: true,
      isStopped: true,
      playlistLength: 2,
      currentTrackIndex: 9,
      repeatMode: 'BAD',
      playbackMode: 'invalid'
    }, 'invalid_playing');
  });

  assert.equal(manager.state.isPlaying, true);
  assert.equal(manager.state.isPaused, false);
  assert.equal(manager.state.isStopped, false);
  assert.equal(manager.state.currentTrackIndex, 1);
  assert.equal(manager.state.repeatMode, 'OFF');
  assert.equal(manager.state.playbackMode, 'audioElement');

  await withMutedConsole('warn', async () => {
    manager.updateState({
      isPlaying: false,
      isPaused: true,
      isStopped: true,
      currentTrackIndex: -4,
      playlistLength: 3
    }, 'invalid_paused');
  });
  assert.equal(manager.state.isPaused, true);
  assert.equal(manager.state.isStopped, false);
  assert.equal(manager.state.currentTrackIndex, 0);

  await withMutedConsole('warn', async () => {
    manager.updateState({
      isPlaying: false,
      isPaused: false,
      isStopped: false,
      playlistLength: 0,
      currentTrackIndex: 4
    }, 'invalid_empty');
  });
  assert.equal(manager.state.isStopped, true);
  assert.equal(manager.state.currentTrackIndex, 0);

  await withCapturedConsole('warn', async warnings => {
    manager.updateState({
      playlist: [],
      playlistLength: 0,
      currentTrackIndex: 0
    }, 'empty_queue_default_index');
    manager.updateState({
      playlist: [],
      playlistLength: 0,
      currentTrackIndex: -1
    }, 'empty_queue_teardown_index');

    assert.equal(warnings.some(warning => warning[0] === '[StateManager] Invalid track index:'), false);

    manager.updateState({
      playlist: [],
      playlistLength: 0,
      currentTrackIndex: 4
    }, 'empty_queue_invalid_positive_index');
    assert.equal(manager.state.currentTrackIndex, 0);
    assert.equal(warnings.some(warning => warning[0] === '[StateManager] Invalid track index:'), true);
  });
});

test('StateManager records bounded history only for actual changes', () => {
  const manager = createStableStateManager();
  manager.maxHistorySize = 3;

  manager.updateState({ isStopped: true }, 'unchanged');
  assert.equal(manager.getStateHistory().length, 0);

  manager.updateState({ currentTrackName: 'A' }, 'one');
  manager.updateState({ currentTrackName: 'B' }, 'two');
  manager.updateState({ currentTrackName: 'C' }, 'three');
  manager.updateState({ currentTrackName: 'D' }, 'four');

  const history = manager.getStateHistory();
  assert.equal(history.length, 3);
  assert.deepEqual(history.map(entry => entry.source), ['two', 'three', 'four']);
  history.length = 0;
  assert.equal(manager.getStateHistory().length, 3);

  manager.clearStateHistory();
  assert.deepEqual(manager.getStateHistory(), []);
});

test('StateManager notifies specific and wildcard listeners and isolates listener failures', async () => {
  const manager = createStableStateManager();
  const calls = [];
  const specific = (value, key, source) => calls.push(['specific', value, key, source]);
  const wildcard = (value, key, source) => calls.push(['wildcard', value, key, source]);
  const throwing = () => {
    throw new Error('listener failed');
  };

  manager.addListener('repeatMode', specific);
  manager.addListener('repeatMode', throwing);
  manager.addListener('*', wildcard);
  manager.addListener('*', throwing);

  await withMutedConsole('error', async () => {
    manager.updateState({ repeatMode: 'ALL' }, 'listener_test');
  });

  assert.deepEqual(calls, [
    ['specific', 'ALL', 'repeatMode', 'listener_test'],
    ['wildcard', 'ALL', 'repeatMode', 'listener_test']
  ]);

  manager.removeListener('repeatMode', specific);
  manager.removeListener('missing', specific);
  await withMutedConsole('error', async () => {
    manager.updateState({ repeatMode: 'ONE' }, 'after_remove');
  });

  assert.deepEqual(calls.at(-1), ['wildcard', 'ONE', 'repeatMode', 'after_remove']);
});

test('StateManager resolves current, next, and previous tracks', () => {
  const manager = new StateManager({});
  const playlist = [{ name: 'A' }, { name: 'B' }];

  assert.equal(manager.getCurrentTrack(), null);
  assert.equal(manager.getNextTrackIndex(), -1);
  assert.equal(manager.getPreviousTrackIndex(), -1);

  manager.updatePlaylist(playlist, 9);
  assert.equal(manager.getCurrentTrackIndex(), 1);
  assert.deepEqual(manager.getCurrentTrack(), { name: 'B' });
  assert.equal(manager.getNextTrack(), null);
  assert.equal(manager.getNextTrackIndex(), -1);
  assert.equal(manager.getPreviousTrackIndex(), 0);

  manager.updateState({ repeatMode: 'ALL' }, 'repeat');
  assert.equal(manager.getNextTrackIndex(), 0);
  manager.updateState({ currentTrackIndex: 0 }, 'first');
  assert.deepEqual(manager.getNextTrack(), { name: 'B' });
  assert.equal(manager.getPreviousTrackIndex(), 1);

  manager.updateState({ repeatMode: 'OFF' }, 'repeat_off');
  assert.equal(manager.getPreviousTrackIndex(), -1);

  manager.state.currentTrackIndex = 99;
  assert.equal(manager.getCurrentTrack(), null);
});

test('StateManager update helpers apply derived state', async () => {
  const manager = new StateManager({});

  await withMutedConsole('warn', async () => {
    manager.updatePlaylist([], 4);
    assert.equal(manager.state.playlistLength, 0);
    assert.equal(manager.state.currentTrack, null);
    assert.equal(manager.state.currentTrackIndex, 0);

    manager.setPlaybackState('playing');
    assert.equal(manager.state.isPlaying, true);
    manager.setPlaybackState('paused');
    assert.equal(manager.state.isPaused, true);
    manager.setPlaybackState('stopped');
    assert.equal(manager.state.isStopped, true);

    manager.setPlaybackMode('bufferSource');
    manager.setTransitionState(true, 'manual');
    manager.updateTrackInfo({ name: 'Track' }, 120, 12);
    manager.setBufferState(true, 'ready');
    manager.setUIState(false);
    assert.equal(manager.state.seekBarEnabled, false);
    assert.equal(manager.state.controlsEnabled, false);
    manager.setUIState(true, { seekBarEnabled: false, controlsEnabled: true });
  });

  assert.equal(manager.state.playbackMode, 'bufferSource');
  assert.equal(manager.state.transitionType, 'manual');
  assert.equal(manager.state.currentTrackDuration, 120);
  assert.equal(manager.state.hasNextTrackBuffer, true);
  assert.equal(manager.state.bufferPreparationStatus, 'ready');
  assert.equal(manager.state.seekBarEnabled, false);
  assert.equal(manager.state.controlsEnabled, true);
});

test('StateManager exposes debug information', () => {
  const manager = createStableStateManager();
  const listener = () => {};
  manager.addListener('currentTrackName', listener);
  manager.updateState({ currentTrackName: 'Debug' }, 'debug');

  const debug = manager.getDebugInfo();
  assert.equal(debug.currentState.currentTrackName, 'Debug');
  assert.deepEqual(debug.listeners, ['currentTrackName']);
  assert.deepEqual(debug.listenerCounts, { currentTrackName: 1 });
  assert.equal(debug.stateHistory.length, 1);
});
