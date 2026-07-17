import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioContextManager } from '../../js/ui/audio-player/audio-context-manager.js';
import { PlaybackManager } from '../../js/ui/audio-player/playback-manager.js';
import { CatalogSequence } from '../../js/ui/audio-player/playback-sequence.js';
import {
  getPlaybackRegion,
  getRegionEndTime,
  hasPlaybackRegionDescriptor,
  isRegionPlayableInMedia,
  logicalTimeToMediaTime,
  mediaTimeToLogicalTime
} from '../../js/ui/audio-player/playback-region.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

class TestFile {}

function createStateManager(initialState = {}) {
  const state = {
    currentTrack: null,
    currentTrackIndex: 0,
    currentTrackDuration: 0,
    currentTrackPosition: 0,
    playbackMode: 'audioElement',
    isPlaying: true,
    isPaused: false,
    isStopped: false,
    isTransitioning: false,
    repeatMode: 'OFF',
    shuffleMode: false,
    transportCommandGeneration: 0,
    ...initialState
  };
  return {
    state,
    getStateSnapshot() { return { ...state }; },
    getCurrentTrackIndex() { return state.currentTrackIndex; },
    updatePlaylist(playlist, currentTrackIndex) {
      Object.assign(state, {
        playlist,
        playlistLength: playlist.length,
        currentTrackIndex,
        currentTrack: playlist[currentTrackIndex] ?? null
      });
    },
    updateState(updates) { Object.assign(state, updates); }
  };
}

function createContextHarness(initialState = {}) {
  const stateManager = createStateManager(initialState);
  const audioPlayer = {
    audioContext: { currentTime: 0 },
    audioElement: null,
    stateManager,
    playbackManager: null,
    ui: { updatePlayerUIState() {} }
  };
  const audioManager = {
    audioContext: audioPlayer.audioContext,
    sourceNode: null,
    ioManager: null,
    workletNode: null
  };
  const manager = new AudioContextManager(audioPlayer, audioManager);
  return { audioPlayer, manager, state: stateManager.state, stateManager };
}

function regionTrack(name, startFrame, endFrame, durationSec) {
  return {
    name,
    path: '/album.wav',
    physicalSourceKey: 'album-source',
    startFrame,
    endFrame,
    durationSec
  };
}

function mediaLoadCandidate(manager, track, sourceGeneration) {
  const source = { disconnect() {} };
  const gate = { gain: { value: 0 }, disconnect() {} };
  manager.privatePipelineSourceGates.set(source, gate);
  manager.audioManager.workletNode = {};
  manager.audioManager.isSourceConnectedToPipeline = candidate => candidate === gate;
  return {
    mode: 'audioElement',
    backend: 'html-media',
    source,
    element: {
      duration: 30,
      currentTime: 0,
      paused: true,
      addEventListener() {},
      removeEventListener() {},
      pause() { this.paused = true; }
    },
    objectURL: null,
    region: getPlaybackRegion(track),
    sourceGeneration,
    ended: false,
    committed: false,
    cleaned: false
  };
}

test('CUE frame helpers expose logical time without changing persisted duration', () => {
  const region = getPlaybackRegion(regionTrack('Two', 750, 1500, 10));
  assert.equal(logicalTimeToMediaTime(region, 2.5), 12.5);
  assert.equal(mediaTimeToLogicalTime(region, 12.5), 2.5);
  assert.equal(mediaTimeToLogicalTime(region, 25), 10);
  assert.equal(getRegionEndTime(region), 20);
  assert.throws(
    () => getPlaybackRegion({ startFrame: 0, endFrame: null }),
    /descriptor is invalid/
  );
});

test('plain null region fields stay plain while partial descriptors are rejected', () => {
  assert.equal(hasPlaybackRegionDescriptor({ startFrame: null, endFrame: null }), false);
  assert.equal(hasPlaybackRegionDescriptor({ startFrame: undefined, endFrame: null }), false);
  assert.equal(getPlaybackRegion({ startFrame: null, endFrame: null }), null);
  assert.throws(
    () => getPlaybackRegion({ startFrame: 0, endFrame: undefined, durationSec: 10 }),
    /descriptor is invalid/
  );
  assert.throws(
    () => getPlaybackRegion({ startFrame: undefined, endFrame: 750, durationSec: 10 }),
    /descriptor is invalid/
  );
});

test('final CUE regions validate their persisted physical end within one media frame', () => {
  const finalRegion = getPlaybackRegion(regionTrack('Final', 1500, null, 10));

  assert.equal(isRegionPlayableInMedia(finalRegion, 30), true);
  assert.equal(isRegionPlayableInMedia(finalRegion, 30 + 0.5 / 75), true);
  assert.equal(isRegionPlayableInMedia(finalRegion, 30 + 2 / 75), false);
  assert.equal(isRegionPlayableInMedia(finalRegion, 35), false);
});

test('CUE descriptors use media elements and never enter current or next buffer decoding', async () => {
  await withGlobals({ File: TestFile, window: { audioPreferences: { useInputWithPlayer: true } } }, async () => {
    const { audioPlayer, manager, state } = createContextHarness();
    const track = regionTrack('One', 0, 750, 10);
    audioPlayer.playbackManager = {
      playlist: [track],
      getTrack(index) { return index === 0 ? track : null; }
    };
    let mediaLoads = 0;
    let bufferDecodes = 0;
    manager.loadMetadata = () => {};
    manager.prepareMediaTransitionCandidate = async (prepared, sourceGeneration) => {
      mediaLoads += 1;
      return mediaLoadCandidate(manager, prepared.playableTrack, sourceGeneration);
    };
    manager.prepareTrackBuffer = async () => {
      bufferDecodes += 1;
      return { duration: 10 };
    };

    assert.equal(await manager.loadTrack(track, 0), true);
    await manager.prepareNextTrackBufferForTrack(track, 0);
    assert.equal(mediaLoads, 1);
    assert.equal(bufferDecodes, 0);
    assert.equal(manager.nextBuffer, null);
    assert.equal(state.isTransitioning, false);
    assert.equal(state.transitionType, null);
  });
});

test('a stale CUE media load cannot complete the loading transition of a newer generation', async () => {
  await withGlobals({ File: TestFile, window: { audioPreferences: { useInputWithPlayer: true } } }, async () => {
    const { manager, state } = createContextHarness();
    const firstTrack = regionTrack('First', 0, 750, 10);
    const secondTrack = regionTrack('Second', 750, 1500, 10);
    const pendingSetups = new Map();
    manager.loadMetadata = () => {};
    manager.prepareMediaTransitionCandidate = (prepared, sourceGeneration) => new Promise(resolve => {
      pendingSetups.set(prepared.playableTrack, () => resolve(
        mediaLoadCandidate(manager, prepared.playableTrack, sourceGeneration)
      ));
    });

    const firstLoad = manager.loadTrack(firstTrack, 0);
    await flushMicrotasks();
    const secondLoad = manager.loadTrack(secondTrack, 1);
    await flushMicrotasks();

    pendingSetups.get(firstTrack)();
    assert.equal(await firstLoad, false);
    assert.equal(state.isTransitioning, true);
    assert.equal(state.transitionType, 'loading');

    pendingSetups.get(secondTrack)();
    assert.equal(await secondLoad, true);
    assert.equal(state.isTransitioning, false);
    assert.equal(state.transitionType, null);
  });
});

test('CUE metadata validation seeks to the frame start and rejects unavailable regions', async () => {
  const { manager, state } = createContextHarness();
  const track = regionTrack('Two', 750, 1500, 10);
  manager.activeSourceGeneration = 4;
  const activeRegion = manager.beginActiveRegion(track, 4);
  const audioElement = { duration: 30, currentTime: 0 };

  assert.equal(manager.handleRegionLoadedMetadata(audioElement), true);
  assert.equal(await activeRegion.metadataPromise, true);
  assert.equal(audioElement.currentTime, 10);
  assert.equal(state.currentTrackDuration, 10);
  assert.equal(state.currentTrackPosition, 0);

  manager.activeSourceGeneration = 5;
  const unavailable = manager.beginActiveRegion(regionTrack('Bad', 2250, null, 5), 5);
  assert.equal(manager.handleRegionLoadedMetadata(audioElement), true);
  assert.equal(await unavailable.metadataPromise, false);
});

test('CUE controls and graph rebind positions stay relative to the logical region', async () => {
  await withGlobals({ window: { audioPreferences: {} } }, async () => {
    const { audioPlayer, manager, state } = createContextHarness({
      currentTrackDuration: 10,
      currentTrackPosition: 4
    });
    const audioElement = {
      currentTime: 14,
      duration: 30,
      pause() { this.paused = true; }
    };
    audioPlayer.audioElement = audioElement;
    manager.activeSourceGeneration = 2;
    manager.activeRegion = {
      region: getPlaybackRegion(regionTrack('Two', 750, 1500, 10)),
      sourceGeneration: 2,
      boundaryCommitted: false
    };

    assert.equal(manager.getPlaybackPositionForGraphRebind(state), 4);
    await manager.pauseAudioElement();
    assert.equal(state.currentTrackPosition, 4);
    assert.equal(state.isPaused, true);

    await manager.seekAudioElement(7);
    assert.equal(audioElement.currentTime, 17);
    assert.equal(state.currentTrackPosition, 7);

    await manager.stopAudioElement();
    assert.equal(audioElement.currentTime, 10);
    assert.equal(state.currentTrackPosition, 0);
    assert.equal(state.isStopped, true);
  });
});

test('a physical source ending before its CUE boundary has one async recovery owner', () => {
  const { manager } = createContextHarness({ currentTrackIndex: 3 });
  manager.activeSourceGeneration = 7;
  manager.activeRegion = {
    region: getPlaybackRegion(regionTrack('Two', 750, 1500, 10)),
    sourceGeneration: 7,
    boundaryCommitted: false
  };
  const failures = [];
  manager.completeTrackLoadFailure = (...args) => {
    failures.push(args);
    return Promise.resolve(false);
  };

  assert.equal(manager.handlePrematureRegionEnded(), true);
  assert.equal(manager.handlePrematureRegionEnded(), true);
  assert.equal(failures.length, 1);
  assert.equal(failures[0][0].code, 'mediaLoadFailed');
  assert.equal(failures[0][3], 3);
});

test('duplicate premature media ended events cannot fall through to normal catalog ended transport', async () => {
  const { audioPlayer, manager } = createContextHarness({ currentTrackIndex: 3 });
  const listeners = new Map();
  const audioElement = {
    currentTime: 14,
    duration: 15,
    addEventListener(type, listener) { listeners.set(type, listener); }
  };
  audioPlayer.audioElement = audioElement;
  manager.activeSourceGeneration = 7;
  manager.activeRegion = {
    region: getPlaybackRegion(regionTrack('Two', 750, 1500, 10)),
    sourceGeneration: 7,
    boundaryCommitted: false,
    endedRecoveryPromise: null
  };
  let resolveRecovery;
  const recoveries = [];
  let normalEndedCount = 0;
  audioPlayer.playbackManager = {
    catalogSequence: {},
    recoverCatalogTrackLoadFailure(error, failedIndex) {
      recoveries.push([error, failedIndex]);
      return new Promise(resolve => { resolveRecovery = resolve; });
    },
    onTrackEnded() { normalEndedCount += 1; }
  };
  manager.setupEventHandlers();

  listeners.get('ended')({ target: audioElement });
  listeners.get('ended')({ target: audioElement });

  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0][0].code, 'mediaLoadFailed');
  assert.equal(recoveries[0][1], 3);
  assert.equal(normalEndedCount, 0);
  resolveRecovery({ accepted: true });
  await manager.activeRegion.endedRecoveryPromise;
  assert.equal(normalEndedCount, 0);
});

test('refreshing an active region replaces pending sequence plans and ignores their late result', async () => {
  const { audioPlayer, manager, state } = createContextHarness();
  const currentTrack = { ...regionTrack('One', 0, 750, 10), entryInstanceId: 'current' };
  let resolveOldPlan;
  const oldPlanPromise = new Promise(resolve => { resolveOldPlan = resolve; });
  const oldPlan = { kind: 'old' };
  const newPlan = { kind: 'published' };
  let prepareCount = 0;
  audioPlayer.playbackManager = {
    preparePlannedRegionMove() {
      prepareCount += 1;
      return prepareCount === 1 ? oldPlanPromise : Promise.resolve(newPlan);
    }
  };
  state.currentTrack = currentTrack;
  manager.activeSourceGeneration = 4;
  manager.activeRegion = {
    region: getPlaybackRegion(currentTrack),
    track: currentTrack,
    sourceGeneration: 4,
    boundaryCommitted: false,
    endedRecoveryPromise: null,
    transportPlan: null,
    transportPlanPending: false,
    transportPlanPromise: null,
    metadataValidated: true,
    metadataPromise: Promise.resolve(true)
  };

  const pendingPlan = manager.prepareRegionTransportPlan();
  assert.equal(manager.activeRegion.transportPlanPending, true);
  assert.equal(manager.refreshActiveRegionTransportPlan(), true);
  await manager.activeRegion.transportPlanPromise;
  assert.equal(manager.activeRegion.transportPlan, newPlan);
  assert.equal(prepareCount, 2);

  resolveOldPlan(oldPlan);
  await pendingPlan;
  assert.equal(manager.activeRegion.transportPlan, newPlan);
  assert.equal(manager.activeRegion.transportPlanPending, false);
});

test('repeat toggles refresh the active region plan once from the final transport state', async () => {
  await withGlobals({
    File: TestFile,
    document: { addEventListener() {}, removeEventListener() {} },
    window: {}
  }, async () => {
    const createActivePlayback = (tracks, currentTrackIndex, repeatMode) => {
      const { audioPlayer, manager, state } = createContextHarness({ repeatMode });
      const playbackManager = new PlaybackManager(audioPlayer);
      audioPlayer.playbackManager = playbackManager;
      audioPlayer.contextManager = manager;
      const entries = tracks.map(track => playbackManager.createTrackEntry(track));
      playbackManager.playlist = entries;
      playbackManager.originalPlaylist = entries.map(track => playbackManager.createOriginalTrackEntry(track));
      playbackManager.syncPlaylistState(currentTrackIndex);
      Object.assign(state, {
        currentTrack: entries[currentTrackIndex],
        currentTrackIndex,
        repeatMode
      });
      manager.activeSourceGeneration = 1;
      manager.activeRegion = {
        region: getPlaybackRegion(entries[currentTrackIndex]),
        track: entries[currentTrackIndex],
        sourceGeneration: 1,
        physicalSourceKey: 'album-source',
        boundaryCommitted: false,
        endedRecoveryPromise: null,
        transportPlan: null,
        transportPlanPending: false,
        transportPlanPromise: null,
        metadataValidated: true,
        metadataPromise: Promise.resolve(true)
      };
      let refreshCount = 0;
      const refreshPlan = manager.refreshActiveRegionTransportPlan.bind(manager);
      manager.refreshActiveRegionTransportPlan = () => {
        refreshCount += 1;
        return refreshPlan();
      };
      return { manager, playbackManager, state, getRefreshCount: () => refreshCount };
    };

    const forward = createActivePlayback([
      regionTrack('One', 0, 750, 10),
      regionTrack('Two', 750, 1500, 10)
    ], 0, 'ONE');
    await forward.manager.prepareRegionTransportPlan();
    assert.equal(forward.manager.activeRegion.transportPlan.nextOrdinal, 0);

    await forward.playbackManager.toggleRepeatMode();
    await forward.manager.activeRegion.transportPlanPromise;
    assert.equal(forward.state.repeatMode, 'OFF');
    assert.equal(forward.getRefreshCount(), 1);
    assert.equal(forward.manager.activeRegion.transportPlan.nextOrdinal, 1);
    assert.equal(
      forward.playbackManager.isPlannedRegionMoveCurrent(forward.manager.activeRegion.transportPlan),
      true
    );

    await forward.playbackManager.toggleRepeatMode();
    await forward.manager.activeRegion.transportPlanPromise;
    await forward.playbackManager.toggleRepeatMode();
    await forward.manager.activeRegion.transportPlanPromise;
    assert.equal(forward.state.repeatMode, 'ONE');
    assert.equal(forward.getRefreshCount(), 3);
    assert.equal(forward.manager.activeRegion.transportPlan.nextOrdinal, 0);
    forward.playbackManager.dispose();

    const wrap = createActivePlayback([
      regionTrack('Later', 750, 1500, 10),
      regionTrack('Earlier', 0, 750, 10)
    ], 1, 'OFF');
    await wrap.manager.prepareRegionTransportPlan();
    assert.equal(wrap.manager.activeRegion.transportPlan, null);

    await wrap.playbackManager.toggleRepeatMode();
    await wrap.manager.activeRegion.transportPlanPromise;
    assert.equal(wrap.state.repeatMode, 'ALL');
    assert.equal(wrap.getRefreshCount(), 1);
    assert.equal(wrap.manager.activeRegion.transportPlan.nextOrdinal, 0);
    assert.equal(
      wrap.playbackManager.isPlannedRegionMoveCurrent(wrap.manager.activeRegion.transportPlan),
      true
    );

    await wrap.playbackManager.toggleRepeatMode();
    await wrap.manager.activeRegion.transportPlanPromise;
    assert.equal(wrap.state.repeatMode, 'ONE');
    assert.equal(wrap.getRefreshCount(), 2);
    assert.equal(wrap.manager.activeRegion.transportPlan.nextOrdinal, 1);
    wrap.playbackManager.dispose();
  });
});

test('catalog shuffle off refreshes a contiguous active region plan and shuffle on clears it', async () => {
  await withGlobals({
    File: TestFile,
    document: { addEventListener() {}, removeEventListener() {} },
    window: {}
  }, async () => {
    const { audioPlayer, manager, state } = createContextHarness({ shuffleMode: true });
    const playbackManager = new PlaybackManager(audioPlayer);
    audioPlayer.playbackManager = playbackManager;
    audioPlayer.contextManager = manager;
    const catalogSequence = new CatalogSequence({
      sequenceId: 'cue-catalog',
      itemCount: 2,
      shuffleEnabled: true,
      shuffleSeed: 41,
      async readPage({ startOrdinal, limit }) {
        return {
          rows: Array.from({ length: Math.min(limit, 2 - startOrdinal) }, (_, index) => {
            const ordinal = startOrdinal + index;
            return {
              trackUid: `cue-${ordinal}`,
              title: ordinal === 0 ? 'One' : 'Two',
              artist: 'Catalog Artist'
            };
          })
        };
      },
      async resolveSource({ ordinal }) {
        return {
          path: '/album.wav',
          physicalSourceKey: 'album-source',
          startFrame: ordinal * 750,
          endFrame: (ordinal + 1) * 750,
          durationSec: 10
        };
      }
    });
    const currentOrdinal = catalogSequence.toTransportOrdinal(0);
    manager.loadTrack = async () => true;
    await playbackManager.loadCatalogSequence(catalogSequence, {
      currentOrdinal,
      autoPlay: false
    });
    Object.assign(state, { shuffleMode: true });
    const currentTrack = state.currentTrack;
    manager.activeSourceGeneration = 1;
    manager.activeRegion = {
      region: getPlaybackRegion(currentTrack),
      track: currentTrack,
      sourceGeneration: 1,
      physicalSourceKey: 'album-source',
      boundaryCommitted: false,
      endedRecoveryPromise: null,
      transportPlan: null,
      transportPlanPending: false,
      transportPlanPromise: null,
      metadataValidated: true,
      metadataPromise: Promise.resolve(true)
    };
    let refreshCount = 0;
    const refreshPlan = manager.refreshActiveRegionTransportPlan.bind(manager);
    manager.refreshActiveRegionTransportPlan = () => {
      refreshCount += 1;
      return refreshPlan();
    };
    await manager.prepareRegionTransportPlan();
    assert.equal(manager.activeRegion.transportPlan, null);

    await playbackManager.toggleShuffleMode();
    await manager.activeRegion.transportPlanPromise;
    assert.equal(state.shuffleMode, false);
    assert.equal(refreshCount, 1);
    assert.equal(manager.activeRegion.transportPlan.nextOrdinal, 1);
    assert.equal(playbackManager.isPlannedRegionMoveCurrent(manager.activeRegion.transportPlan), true);

    await playbackManager.toggleShuffleMode();
    await manager.activeRegion.transportPlanPromise;
    assert.equal(state.shuffleMode, true);
    assert.equal(refreshCount, 2);
    assert.equal(manager.activeRegion.transportPlan, null);
    playbackManager.dispose();
  });
});

test('paused and stopped timeupdates only update logical position at a region boundary', async () => {
  const { audioPlayer, manager, state } = createContextHarness({
    isPlaying: false,
    isPaused: true,
    isStopped: false
  });
  const listeners = new Map();
  const audioElement = {
    currentTime: 10,
    duration: 30,
    paused: true,
    addEventListener(type, listener) { listeners.set(type, listener); }
  };
  audioPlayer.audioElement = audioElement;
  let endedCount = 0;
  audioPlayer.playbackManager = { onTrackEnded() { endedCount += 1; } };
  manager.activeSourceGeneration = 1;
  manager.activeRegion = {
    region: getPlaybackRegion(regionTrack('One', 0, 750, 10)),
    track: regionTrack('One', 0, 750, 10),
    sourceGeneration: 1,
    boundaryCommitted: false
  };
  manager.setupEventHandlers();

  listeners.get('timeupdate')({ target: audioElement });
  await flushMicrotasks();
  assert.equal(state.currentTrackPosition, 10);
  assert.equal(manager.activeRegion.boundaryCommitted, false);
  assert.equal(endedCount, 0);

  Object.assign(state, { isPaused: false, isStopped: true, currentTrackPosition: 0 });
  listeners.get('timeupdate')({ target: audioElement });
  await flushMicrotasks();
  assert.equal(state.currentTrackPosition, 10);
  assert.equal(manager.activeRegion.boundaryCommitted, false);
  assert.equal(endedCount, 0);
});

test('a boundary delegates a pending plan once and never commits it late', async () => {
  const { audioPlayer, manager, state } = createContextHarness();
  const currentTrack = regionTrack('One', 0, 750, 10);
  const nextTrack = regionTrack('Two', 750, 1500, 10);
  let resolvePlan;
  const deferredPlan = new Promise(resolve => { resolvePlan = resolve; });
  const plan = {
    nextTrack,
    nextOrdinal: 1,
    preparedRequest: { playableTrack: nextTrack }
  };
  let prepareCount = 0;
  let currentCheckCount = 0;
  let commitCount = 0;
  let endedCount = 0;
  let transitionCount = 0;
  audioPlayer.playbackManager = {
    preparePlannedRegionMove() {
      prepareCount += 1;
      return prepareCount === 1 ? deferredPlan : Promise.resolve(null);
    },
    isPlannedRegionMoveCurrent() {
      currentCheckCount += 1;
      return true;
    },
    isPlannedAutomaticMoveCurrent() {
      currentCheckCount += 1;
      return true;
    },
    commitPlannedRegionMove(candidate) {
      assert.equal(candidate, plan);
      commitCount += 1;
      return true;
    },
    onTrackEnded() { endedCount += 1; }
  };
  manager.transitionPreparedAutomaticMove = prepared => {
    assert.equal(prepared.automaticMovePlan, plan);
    transitionCount += 1;
    return Promise.resolve(true);
  };
  audioPlayer.audioElement = {
    currentTime: 10,
    duration: 30,
    paused: false,
    pause() { this.paused = true; }
  };
  manager.loadMetadata = () => {};
  manager.activeSourceGeneration = 1;
  manager.sourceGenerationSequence = 1;
  manager.activeRegion = {
    region: getPlaybackRegion(currentTrack),
    track: currentTrack,
    sourceGeneration: 1,
    physicalSourceKey: 'album-source',
    boundaryCommitted: false,
    transportPlan: null,
    transportPlanPending: false,
    transportPlanPromise: null,
    metadataValidated: true,
    metadataPromise: Promise.resolve(true)
  };
  manager.prepareRegionTransportPlan(manager.activeRegion);

  const boundaryCommit = manager.commitRegionBoundary(1, manager.regionBoundaryArmToken);
  assert.equal(boundaryCommit, true);
  assert.equal(commitCount, 0);
  assert.equal(currentCheckCount, 0);
  assert.equal(endedCount, 1);
  assert.equal(transitionCount, 0);
  assert.equal(manager.activeRegion.boundaryCommitted, true);
  assert.equal(audioPlayer.audioElement.paused, true);
  assert.equal(audioPlayer.audioElement.currentTime, 10);
  assert.equal(state.currentTrackPosition, 10);

  resolvePlan(plan);
  await flushMicrotasks();
  await flushMicrotasks();
  assert.equal(manager.activeRegion.transportPlan, null);
  assert.equal(manager.activeRegion.transportPlanPending, false);
  assert.equal(commitCount, 0);
  assert.equal(currentCheckCount, 0);
  assert.equal(endedCount, 1);
  assert.equal(transitionCount, 0);
  assert.equal(manager.activeRegion.track, currentTrack);
});

test('three contiguous CUE regions consume one planned move per boundary without reloading media', async () => {
  const timers = [];
  await withGlobals({
    File: TestFile,
    document: { addEventListener() {}, removeEventListener() {} },
    window: {},
    setTimeout(callback, delay) {
      timers.push({ callback, delay, cleared: false });
      return timers.length;
    },
    clearTimeout(id) {
      if (timers[id - 1]) timers[id - 1].cleared = true;
    }
  }, async () => {
    const { audioPlayer, manager, state, stateManager } = createContextHarness();
    const playbackManager = new PlaybackManager(audioPlayer);
    audioPlayer.playbackManager = playbackManager;
    audioPlayer.contextManager = manager;
    const entries = [
      regionTrack('One', 0, 750, 10),
      regionTrack('Two', 750, 1500, 10),
      regionTrack('Three', 1500, null, 10)
    ].map(track => playbackManager.createTrackEntry(track));
    playbackManager.playlist = entries;
    playbackManager.originalPlaylist = entries.map(track => playbackManager.createOriginalTrackEntry(track));
    playbackManager.syncMaterializedSequence();
    Object.assign(state, {
      currentTrack: entries[0],
      currentTrackIndex: 0,
      currentTrackDuration: 10,
      currentTrackPosition: 9,
      isPlaying: true,
      isPaused: false,
      isStopped: false
    });

    let pauseCount = 0;
    const audioElement = {
      src: 'blob:album',
      currentSrc: 'blob:album',
      currentTime: 9,
      duration: 30,
      playbackRate: 1,
      paused: false,
      pause() { pauseCount += 1; this.paused = true; }
    };
    audioPlayer.audioElement = audioElement;
    manager.loadMetadata = () => {};
    manager.activeSourceGeneration = 1;
    manager.sourceGenerationSequence = 1;
    manager.activeRegion = {
      region: getPlaybackRegion(entries[0]),
      track: entries[0],
      sourceGeneration: 1,
      physicalSourceKey: 'album-source',
      boundaryCommitted: false,
      transportPlan: await playbackManager.preparePlannedRegionMove(entries[0]),
      metadataValidated: true,
      metadataPromise: Promise.resolve(true)
    };

    manager.armRegionBoundaryTimer();
    const firstTimer = timers.find(timer => !timer.cleared);
    assert.equal(firstTimer.delay, 1000);
    audioElement.currentTime = 10;
    firstTimer.callback();
    await flushMicrotasks();
    assert.equal(state.currentTrackIndex, 1);
    assert.equal(state.currentTrack.name, 'Two');
    assert.equal(state.transportCommandGeneration, 1);
    assert.equal(audioElement.src, 'blob:album');
    assert.equal(audioElement.currentTime, 10);

    await flushMicrotasks();
    audioElement.currentTime = 20;
    const secondGeneration = manager.activeSourceGeneration;
    const secondArmToken = manager.regionBoundaryArmToken;
    assert.equal(await manager.commitRegionBoundary(secondGeneration, secondArmToken), true);
    assert.equal(state.currentTrackIndex, 2);
    assert.equal(state.currentTrack.name, 'Three');
    assert.equal(state.transportCommandGeneration, 2);
    assert.equal(pauseCount, 0);
    assert.equal(audioElement.src, 'blob:album');
    assert.equal(audioElement.currentTime, 20);

    assert.equal(await manager.commitRegionBoundary(secondGeneration, secondArmToken), false);
    assert.equal(state.transportCommandGeneration, 2);
    assert.equal(stateManager.state.currentTrackDuration, 10);
    playbackManager.dispose();
  });
});

test('non-contiguous and shuffled CUE moves keep the prepared automatic plan', async () => {
  await withGlobals({
    File: TestFile,
    document: { addEventListener() {}, removeEventListener() {} },
    window: {}
  }, async () => {
    const { audioPlayer, manager, state } = createContextHarness();
    const playbackManager = new PlaybackManager(audioPlayer);
    audioPlayer.playbackManager = playbackManager;
    audioPlayer.contextManager = manager;
    const entries = [
      regionTrack('One', 0, 750, 10),
      regionTrack('Gap', 900, 1500, 8)
    ].map(track => playbackManager.createTrackEntry(track));
    playbackManager.playlist = entries;
    playbackManager.originalPlaylist = entries.map(track => playbackManager.createOriginalTrackEntry(track));
    playbackManager.syncMaterializedSequence();
    Object.assign(state, { currentTrack: entries[0], currentTrackIndex: 0 });
    const plan = await playbackManager.preparePlannedRegionMove(entries[0]);
    let endedCount = 0;
    let transitionCount = 0;
    playbackManager.onTrackEnded = () => { endedCount += 1; };
    manager.transitionPreparedAutomaticMove = prepared => {
      assert.equal(prepared.automaticMovePlan, plan);
      transitionCount += 1;
      assert.equal(playbackManager.commitPlannedAutomaticMove(plan, {
        playbackMode: 'audioElement',
        currentTrackDuration: entries[1].durationSec,
        currentTrackPosition: 0
      }), true);
      return Promise.resolve(true);
    };
    const audioElement = {
      currentTime: 10,
      duration: 30,
      playbackRate: 1,
      paused: false,
      pause() { this.paused = true; }
    };
    audioPlayer.audioElement = audioElement;
    manager.activeSourceGeneration = 1;
    manager.activeRegion = {
      region: getPlaybackRegion(entries[0]),
      track: entries[0],
      sourceGeneration: 1,
      physicalSourceKey: 'album-source',
      boundaryCommitted: false,
      transportPlan: plan,
      metadataValidated: true,
      metadataPromise: Promise.resolve(true)
    };

    assert.equal(await manager.commitRegionBoundary(1, manager.regionBoundaryArmToken), true);
    assert.equal(endedCount, 0);
    assert.equal(transitionCount, 1);
    assert.equal(audioElement.paused, true);
    assert.equal(audioElement.currentTime, 10);
    assert.equal(playbackManager.committedRegionTransportPlans.has(plan), true);
    assert.equal(state.currentTrack, entries[1]);

    state.shuffleMode = true;
    Object.assign(state, { currentTrack: entries[0], currentTrackIndex: 0 });
    const shuffledPlan = await playbackManager.preparePlannedRegionMove(entries[0]);
    assert.equal(shuffledPlan.shuffleMode, true);
    assert.equal(shuffledPlan.nextOrdinal, 1);
    playbackManager.dispose();
  });
});

test('materialized repeat OFF end reloads the first region stopped without starting playback', async () => {
  await withGlobals({
    File: TestFile,
    document: { addEventListener() {}, removeEventListener() {} },
    window: {}
  }, async () => {
    const { audioPlayer, state } = createContextHarness();
    const calls = [];
    audioPlayer.contextManager = {
      stop() {
        calls.push(['stop']);
        return Promise.resolve();
      },
      loadTrack(track, index) {
        calls.push(['loadTrack', track.name, index]);
        return Promise.resolve(true);
      },
      seamlessTransition() {
        calls.push(['seamlessTransition']);
        return Promise.resolve(true);
      },
      play() {
        calls.push(['play']);
        return Promise.resolve(true);
      },
      clearNextTrackBuffer() {}
    };
    const playbackManager = new PlaybackManager(audioPlayer);
    audioPlayer.playbackManager = playbackManager;
    const entries = [
      regionTrack('One', 0, 750, 10),
      regionTrack('Final', 750, null, 20)
    ].map(track => playbackManager.createTrackEntry(track));
    playbackManager.playlist = entries;
    playbackManager.originalPlaylist = entries.map(track => playbackManager.createOriginalTrackEntry(track));
    playbackManager.syncMaterializedSequence();
    Object.assign(state, {
      currentTrack: entries[1],
      currentTrackIndex: 1,
      isPlaying: true,
      isPaused: false,
      isStopped: false,
      repeatMode: 'OFF'
    });

    playbackManager.onTrackEnded();
    await flushMicrotasks();

    assert.deepEqual(calls, [['stop'], ['loadTrack', 'One', 0]]);
    assert.equal(state.currentTrack, entries[0]);
    assert.equal(state.currentTrackIndex, 0);
    assert.equal(state.isPlaying, false);
    assert.equal(state.isPaused, false);
    assert.equal(state.isStopped, true);
    playbackManager.dispose();
  });
});

test('Repeat ONE uses one prepared plan per boundary and re-arms the region', async () => {
  const timers = [];
  await withGlobals({
    File: TestFile,
    document: { addEventListener() {}, removeEventListener() {} },
    window: {},
    setTimeout(callback, delay) {
      timers.push({ callback, delay, cleared: false });
      return timers.length;
    },
    clearTimeout(id) {
      if (timers[id - 1]) timers[id - 1].cleared = true;
    }
  }, async () => {
    const track = regionTrack('Repeated', 750, 1500, 10);
    const { audioPlayer, manager, state } = createContextHarness({ repeatMode: 'ONE' });
    const playbackManager = new PlaybackManager(audioPlayer);
    audioPlayer.playbackManager = playbackManager;
    audioPlayer.contextManager = manager;
    const entry = playbackManager.createTrackEntry(track);
    playbackManager.playlist = [entry];
    playbackManager.originalPlaylist = [playbackManager.createOriginalTrackEntry(entry)];
    playbackManager.syncMaterializedSequence();
    Object.assign(state, {
      currentTrack: entry,
      currentTrackIndex: 0,
      currentTrackDuration: 10,
      currentTrackPosition: 10,
      isPlaying: true,
      isPaused: false,
      isStopped: false,
      repeatMode: 'ONE'
    });

    const audioElement = {
      src: 'blob:album',
      currentSrc: 'blob:album',
      currentTime: 20,
      duration: 30,
      playbackRate: 1,
      paused: false,
      ended: false,
      pause() { this.paused = true; }
    };
    audioPlayer.audioElement = audioElement;
    manager.activeSourceGeneration = 1;
    manager.sourceGenerationSequence = 1;
    manager.activeRegion = {
      region: getPlaybackRegion(entry),
      track: entry,
      sourceGeneration: 1,
      physicalSourceKey: 'album-source',
      boundaryCommitted: false,
      transportPlan: null,
      transportPlanPending: false,
      transportPlanPromise: null,
      metadataValidated: true,
      metadataPromise: Promise.resolve(true)
    };
    manager.transitionPreparedAutomaticMove = async prepared => {
      const plan = prepared.automaticMovePlan;
      assert.equal(playbackManager.commitPlannedAutomaticMove(plan, {
        playbackMode: 'audioElement',
        currentTrackDuration: track.durationSec,
        currentTrackPosition: 0
      }), true);
      const sourceGeneration = ++manager.sourceGenerationSequence;
      manager.activeSourceGeneration = sourceGeneration;
      manager.setValidatedActiveRegion(plan.nextTrack, sourceGeneration);
      audioElement.currentTime = 10;
      audioElement.paused = false;
      manager.prepareRegionTransportPlan(manager.activeRegion);
      manager.armRegionBoundaryTimer();
      return true;
    };

    await manager.prepareRegionTransportPlan(manager.activeRegion);
    assert.equal(manager.activeRegion.transportPlan.nextOrdinal, 0);

    assert.equal(await manager.commitRegionBoundary(1, manager.regionBoundaryArmToken), true);
    await flushMicrotasks();
    await flushMicrotasks();
    const secondGeneration = manager.activeSourceGeneration;
    assert.ok(secondGeneration > 1);
    assert.equal(manager.activeRegion.boundaryCommitted, false);
    assert.equal(manager.activeRegion.transportPlan.nextOrdinal, 0);
    assert.equal(audioElement.currentTime, 10);

    const secondBoundaryTimer = timers.find(timer => !timer.cleared);
    assert.ok(secondBoundaryTimer);
    assert.equal(secondBoundaryTimer.delay, 10000);
    audioElement.currentTime = 20;
    secondBoundaryTimer.callback();
    await flushMicrotasks();
    await flushMicrotasks();

    assert.ok(manager.activeSourceGeneration > secondGeneration);
    assert.equal(manager.activeRegion.boundaryCommitted, false);
    assert.equal(audioElement.currentTime, 10);
    assert.ok(timers.some(timer => !timer.cleared && timer !== secondBoundaryTimer));
    playbackManager.dispose();
  });
});

test('media ended listener delegates materialized Repeat OFF reset to a region-aware first-track load', async () => {
  await withGlobals({
    File: TestFile,
    document: { addEventListener() {}, removeEventListener() {} },
    window: {}
  }, async () => {
    const listeners = new Map();
    const { audioPlayer, manager, state } = createContextHarness({ repeatMode: 'OFF' });
    const playbackManager = new PlaybackManager(audioPlayer);
    audioPlayer.playbackManager = playbackManager;
    audioPlayer.contextManager = manager;
    const entries = [
      regionTrack('One', 0, 750, 10),
      regionTrack('Final', 750, null, 20)
    ].map(track => playbackManager.createTrackEntry(track));
    playbackManager.playlist = entries;
    playbackManager.originalPlaylist = entries.map(track => playbackManager.createOriginalTrackEntry(track));
    playbackManager.syncMaterializedSequence();
    Object.assign(state, {
      currentTrack: entries[1],
      currentTrackIndex: 1,
      currentTrackDuration: 20,
      currentTrackPosition: 20,
      isPlaying: true,
      isPaused: false,
      isStopped: false,
      repeatMode: 'OFF'
    });

    const audioElement = {
      currentTime: 30,
      duration: 30,
      paused: false,
      addEventListener(type, listener) { listeners.set(type, listener); },
      pause() { this.paused = true; }
    };
    audioPlayer.audioElement = audioElement;
    manager.activeSourceGeneration = 1;
    manager.sourceGenerationSequence = 1;
    manager.activeRegion = {
      region: getPlaybackRegion(entries[1]),
      track: entries[1],
      sourceGeneration: 1,
      physicalSourceKey: 'album-source',
      boundaryCommitted: false,
      transportPlan: null,
      transportPlanPending: false,
      transportPlanPromise: null,
      metadataValidated: true,
      metadataPromise: Promise.resolve(true)
    };
    const calls = [];
    manager.stop = async () => {
      calls.push(['stop']);
      Object.assign(state, { isPlaying: false, isPaused: false, isStopped: true });
    };
    manager.loadTrack = async (track, index) => {
      calls.push(['loadTrack', track.name, index]);
      const generation = ++manager.sourceGenerationSequence;
      manager.activeSourceGeneration = generation;
      const activeRegion = manager.beginActiveRegion(track, generation);
      activeRegion.metadataValidated = true;
      manager.settlePendingRegionMetadata(true);
      return true;
    };
    manager.setupEventHandlers();

    listeners.get('ended')({ target: audioElement });
    await flushMicrotasks();

    assert.deepEqual(calls, [['stop'], ['loadTrack', 'One', 0]]);
    assert.equal(state.currentTrack, entries[0]);
    assert.equal(state.currentTrackIndex, 0);
    assert.equal(state.isStopped, true);
    assert.equal(manager.activeRegion.track, entries[0]);
    assert.equal(manager.activeRegion.boundaryCommitted, false);
    playbackManager.dispose();
  });
});
