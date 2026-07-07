import assert from 'node:assert/strict';
import test from 'node:test';

import { MediaSessionManager } from '../../js/ui/audio-player/media-session-manager.js';

function createStateManager(initialState, calls) {
  const listeners = new Map();
  const state = { ...initialState };
  return {
    state,
    addListener(key, listener) {
      calls.push(['state.addListener', key]);
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(listener);
    },
    removeListener(key, listener) {
      calls.push(['state.removeListener', key]);
      listeners.get(key)?.delete(listener);
    },
    getStateSnapshot() {
      calls.push(['state.getSnapshot']);
      return { ...state };
    },
    update(updates) {
      Object.assign(state, updates);
      for (const [key, value] of Object.entries(updates)) {
        for (const listener of listeners.get(key) || []) {
          listener(value, key, 'test');
        }
        for (const listener of listeners.get('*') || []) {
          listener(value, key, 'test');
        }
      }
    },
    listenerCount(key) {
      return listeners.get(key)?.size || 0;
    }
  };
}

function createMediaSession(calls) {
  const handlers = new Map();
  return {
    handlers,
    metadata: null,
    playbackState: 'none',
    positionStates: [],
    setActionHandler(action, handler) {
      calls.push(['mediaSession.setActionHandler', action, handler === null ? null : 'handler']);
      if (handler) {
        handlers.set(action, handler);
      } else {
        handlers.delete(action);
      }
    },
    setPositionState(positionState) {
      calls.push(['mediaSession.setPositionState', { ...positionState }]);
      this.positionStates.push({ ...positionState });
    }
  };
}

function createHarness(options = {}) {
  const calls = [];
  const stateManager = createStateManager({
    currentTrack: {
      name: 'file.wav',
      meta: {
        title: 'Meta Title',
        artist: 'Meta Artist',
        album: 'Meta Album'
      }
    },
    currentTrackName: 'Display Name',
    artworkUrl: '',
    currentTrackDuration: 120,
    currentTrackPosition: 12,
    isPlaying: false,
    isPaused: true,
    isStopped: false,
    ...options.state
  }, calls);
  const mediaSession = createMediaSession(calls);
  let currentTime = options.now ?? 0;
  const audioPlayer = {
    stateManager,
    contextManager: {
      seek(time) {
        calls.push(['context.seek', time]);
      }
    },
    play() {
      calls.push(['player.play']);
    },
    pause() {
      calls.push(['player.pause']);
    },
    stop() {
      calls.push(['player.stop']);
    },
    playPrevious() {
      calls.push(['player.previous']);
    },
    playNext() {
      calls.push(['player.next']);
    }
  };
  class TestMediaMetadata {
    constructor(metadata) {
      this.metadata = metadata;
      calls.push(['MediaMetadata', metadata]);
    }
  }
  const manager = new MediaSessionManager(audioPlayer, {
    navigatorRef: { mediaSession },
    mediaMetadataCtor: TestMediaMetadata,
    now: () => currentTime
  });

  return {
    audioPlayer,
    calls,
    manager,
    mediaSession,
    setNow(value) {
      currentTime = value;
    },
    stateManager
  };
}

test('MediaSessionManager syncs player metadata, playback state, and position', () => {
  const { calls, mediaSession, setNow, stateManager } = createHarness();

  assert.equal(stateManager.listenerCount('*'), 1);
  assert.equal(mediaSession.metadata.metadata.title, 'Meta Title');
  assert.equal(mediaSession.metadata.metadata.artist, 'Meta Artist');
  assert.equal(mediaSession.metadata.metadata.album, 'Meta Album');
  assert.equal(mediaSession.playbackState, 'paused');
  assert.deepEqual(mediaSession.positionStates.at(-1), {
    duration: 120,
    playbackRate: 1,
    position: 12
  });

  stateManager.update({
    isPlaying: true,
    isPaused: false
  });
  assert.equal(mediaSession.playbackState, 'playing');

  calls.length = 0;
  setNow(500);
  stateManager.update({ currentTrackPosition: 12.4 });
  assert.equal(calls.some(call => call[0] === 'mediaSession.setPositionState'), false);

  setNow(1200);
  stateManager.update({ currentTrackPosition: 13.4 });
  assert.deepEqual(mediaSession.positionStates.at(-1), {
    duration: 120,
    playbackRate: 1,
    position: 13.4
  });

  stateManager.update({ currentTrackDuration: 0 });
  assert.deepEqual(mediaSession.positionStates.at(-1), {});
});

test('MediaSessionManager clears and skips position state while stopped', () => {
  const { calls, mediaSession, stateManager } = createHarness();

  calls.length = 0;
  stateManager.update({
    isPlaying: false,
    isPaused: false,
    isStopped: true,
    currentTrackDuration: 120,
    currentTrackPosition: 55
  });

  assert.equal(mediaSession.playbackState, 'none');
  assert.deepEqual(mediaSession.positionStates.at(-1), {});

  calls.length = 0;
  stateManager.update({ currentTrackPosition: 60 });
  assert.equal(calls.some(call => call[0] === 'mediaSession.setPositionState'), false);

  stateManager.update({
    isStopped: false,
    isPaused: true,
    currentTrackPosition: 0
  });
  assert.deepEqual(mediaSession.positionStates.at(-1), {
    duration: 120,
    playbackRate: 1,
    position: 0
  });
});

test('MediaSessionManager routes OS media actions to Player commands', () => {
  const { calls, mediaSession, stateManager } = createHarness({
    state: {
      currentTrackPosition: 20
    }
  });

  mediaSession.handlers.get('play')();
  mediaSession.handlers.get('pause')();
  mediaSession.handlers.get('stop')();
  mediaSession.handlers.get('previoustrack')();
  mediaSession.handlers.get('nexttrack')();
  mediaSession.handlers.get('seekto')({ seekTime: 42 });
  mediaSession.handlers.get('seekbackward')({ seekOffset: 5 });
  mediaSession.handlers.get('seekforward')({});

  assert.deepEqual(calls.filter(call => [
    'player.play',
    'player.pause',
    'player.stop',
    'player.previous',
    'player.next',
    'context.seek'
  ].includes(call[0])), [
    ['player.play'],
    ['player.pause'],
    ['player.stop'],
    ['player.previous'],
    ['player.next'],
    ['context.seek', 42],
    ['context.seek', 15],
    ['context.seek', 30]
  ]);
  assert.equal(stateManager.listenerCount('*'), 1);
});

test('MediaSessionManager returns and waits for async OS media action commands', async () => {
  const { audioPlayer, calls, mediaSession } = createHarness();
  let resolveNext;
  let resolvePause;

  audioPlayer.playNext = () => new Promise(resolve => {
    calls.push(['player.next.start']);
    resolveNext = () => {
      calls.push(['player.next.done']);
      resolve();
    };
  });
  audioPlayer.pause = () => new Promise(resolve => {
    calls.push(['player.pause.start']);
    resolvePause = () => {
      calls.push(['player.pause.done']);
      resolve();
    };
  });

  calls.length = 0;
  const actionPromise = mediaSession.handlers.get('nexttrack')();
  assert.equal(typeof actionPromise?.then, 'function');
  assert.deepEqual(calls, [
    ['player.next.start']
  ]);

  resolveNext();
  await actionPromise;

  const doneIndex = calls.findIndex(call => call[0] === 'player.next.done');
  const syncIndex = calls.findIndex((call, index) => index > doneIndex && call[0] === 'state.getSnapshot');
  assert.ok(syncIndex > doneIndex);

  calls.length = 0;
  const pausePromise = mediaSession.handlers.get('pause')();
  assert.equal(typeof pausePromise?.then, 'function');
  assert.deepEqual(calls, [
    ['player.pause.start']
  ]);

  resolvePause();
  await pausePromise;

  const pauseDoneIndex = calls.findIndex(call => call[0] === 'player.pause.done');
  const pauseSyncIndex = calls.findIndex((call, index) => index > pauseDoneIndex && call[0] === 'state.getSnapshot');
  assert.ok(pauseSyncIndex > pauseDoneIndex);
});

test('MediaSessionManager clears position state before publishing metadata for a new track', () => {
  const { calls, mediaSession, stateManager } = createHarness();

  calls.length = 0;
  stateManager.update({
    currentTrack: {
      name: 'next.wav',
      meta: {
        title: 'Next Title',
        artist: 'Next Artist'
      }
    }
  });

  assert.deepEqual(mediaSession.positionStates.at(-1), {});
  const clearIndex = calls.findIndex(call =>
    call[0] === 'mediaSession.setPositionState' &&
    Object.keys(call[1]).length === 0
  );
  const metadataIndex = calls.findIndex(call => call[0] === 'MediaMetadata');
  assert.ok(clearIndex >= 0);
  assert.ok(metadataIndex > clearIndex);
  assert.equal(calls.some(call =>
    call[0] === 'mediaSession.setPositionState' &&
    call[1].duration === 120 &&
    call[1].position === 12
  ), false);
});

test('MediaSessionManager accepts tag metadata and clears it when tracks change', () => {
  const { manager, mediaSession, stateManager } = createHarness();

  manager.updateMetadataFromTags('Tag Title', 'Tag Artist', 'Tag Album', 'blob:art');
  assert.deepEqual(mediaSession.metadata.metadata, {
    title: 'Tag Title',
    artist: 'Tag Artist',
    album: 'Tag Album',
    artwork: [{ src: 'blob:art' }]
  });

  stateManager.update({
    currentTrack: {
      name: 'next.wav',
      meta: {
        title: 'Next Title',
        artist: 'Next Artist'
      }
    },
    artworkUrl: 'blob:next'
  });
  assert.deepEqual(mediaSession.metadata.metadata, {
    title: 'Next Title',
    artist: 'Next Artist',
    album: '',
    artwork: [{ src: 'blob:next' }]
  });
});

test('MediaSessionManager clears stale OS metadata when a metadata update fails', () => {
  const { manager, mediaSession, stateManager } = createHarness();

  assert.equal(mediaSession.metadata.metadata.title, 'Meta Title');
  manager.MediaMetadataCtor = class {
    constructor() {
      throw new Error('metadata update failed');
    }
  };

  stateManager.update({
    currentTrack: {
      name: 'broken.wav',
      meta: {
        title: 'Broken Title'
      }
    }
  });

  assert.equal(mediaSession.metadata, null);
  assert.equal(manager.lastMetadataKey, '');
  assert.equal(manager.hasSessionMetadata, false);
});

test('MediaSessionManager disposes listeners and clears the OS media session', () => {
  const { manager, mediaSession, stateManager } = createHarness();

  assert.equal(mediaSession.handlers.size, 8);
  manager.dispose();

  assert.equal(stateManager.listenerCount('*'), 0);
  assert.equal(mediaSession.handlers.size, 0);
  assert.equal(mediaSession.metadata, null);
  assert.equal(mediaSession.playbackState, 'none');
  assert.deepEqual(mediaSession.positionStates.at(-1), {});
});
