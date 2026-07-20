import assert from 'node:assert/strict';
import test from 'node:test';

import { PlaybackManager } from '../../js/ui/audio-player/playback-manager.js';
import {
  CatalogSequence,
  claimFolderPermissionAttempt
} from '../../js/ui/audio-player/playback-sequence.js';
import { StateManager } from '../../js/ui/audio-player/state-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function createHarness() {
  const calls = [];
  const audioPlayer = {
    libraryOperationService: null,
    resumeAudioContextInGesture() {
      calls.push(['resume']);
      return true;
    },
    contextManager: {
      async loadTrack(track, ordinal) {
        calls.push(['loadTrack', track.entryInstanceId, ordinal]);
        return true;
      },
      async play() {
        calls.push(['play']);
        return true;
      },
      async seamlessTransition(track, ordinal) {
        calls.push(['seamlessTransition', track.entryInstanceId, ordinal]);
        return true;
      },
      async transitionToNextTrack(track, ordinal) {
        calls.push(['transitionToNextTrack', track.entryInstanceId, ordinal]);
        return true;
      },
      getDirectElectronMediaSource(track) {
        return typeof track?.path === 'string'
          ? `file:///${track.path.replace(/\\/g, '/')}`
          : null;
      },
      clearNextTrackBuffer() {},
      stop() {},
      isUsingBufferPlayback() { return false; }
    },
    audioElement: { currentTime: 0 },
    ui: { updatePlayerUIState() {}, updatePlayPauseButton() {} }
  };
  audioPlayer.stateManager = new StateManager(audioPlayer);
  const manager = new PlaybackManager(audioPlayer);
  audioPlayer.playbackManager = manager;
  return { audioPlayer, calls, manager };
}

function catalogDescriptor(overrides = {}) {
  const sourceCalls = overrides.sourceCalls ?? [];
  return {
    sequenceId: overrides.sequenceId ?? 'catalog-sequence',
    itemCount: overrides.itemCount ?? 1_000_000,
    async readPage({ startOrdinal, limit }) {
      return {
        rows: Array.from({ length: limit }, (_, index) => ({
          ...(overrides.firstEntryInstanceId &&
              startOrdinal + index === (overrides.provisionalOrdinal ?? 0)
            ? { entryInstanceId: overrides.firstEntryInstanceId }
            : {}),
          trackUid: `${overrides.prefix ?? 'track'}-${startOrdinal + index}`,
          title: `Track ${startOrdinal + index}`,
          artist: 'Catalog Artist'
        }))
      };
    },
    async resolveSource(request) {
      sourceCalls.push(request);
      return { path: `/music/${request.trackUid}.flac` };
    },
    sourceCalls,
    ...(overrides.shuffleSeed !== undefined ? { shuffleSeed: overrides.shuffleSeed } : {}),
    ...(overrides.shuffleEnabled !== undefined ? { shuffleEnabled: overrides.shuffleEnabled } : {})
  };
}

async function withPlaybackHarness(callback) {
  return withGlobals({
    document: { addEventListener() {}, removeEventListener() {} },
    window: {},
    File: class FakeFile {}
  }, () => callback(createHarness()));
}

test('million-item catalog playback pages metadata and resolves only the selected source', async () => {
  await withPlaybackHarness(async ({ audioPlayer, calls, manager }) => {
    const descriptor = catalogDescriptor();
    await manager.loadCatalogSequence(descriptor, { currentOrdinal: 0, autoPlay: false });
    assert.equal(Array.isArray(manager.playlist), false);
    assert.equal(manager.playlist.length, 1_000_000);
    assert.equal(descriptor.sourceCalls.length, 1);
    assert.equal(calls.filter(call => call[0] === 'loadTrack').length, 1);
    assert.equal(calls.filter(call => call[0] === 'play').length, 0);
    assert.equal(audioPlayer.stateManager.state.playlist.length, 0);

    const result = await manager.transportNext(true);
    assert.equal(result.accepted, true);
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 1);
    assert.deepEqual(audioPlayer.stateManager.state.currentTrack.meta, {
      title: 'Track 1',
      artist: 'Catalog Artist',
      album: ''
    });
    assert.equal(descriptor.sourceCalls.length, 2);
    assert.equal(audioPlayer.stateManager.state.currentTrack.entryInstanceId, 'catalog-sequence:1');
    assert.ok(manager.catalogSequence.getCacheStats().cachedPageCount <= 5);
  });
});

test('catalog playback resolves track indices without scanning the lazy playlist facade', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    const ordinal = 731_245;
    await manager.loadCatalogSequence(catalogDescriptor(), {
      currentOrdinal: ordinal,
      autoPlay: true
    });
    const track = audioPlayer.stateManager.state.currentTrack;

    assert.equal(manager.getTrackIndex(track, true), ordinal);
    assert.equal(manager.getTrackIndex({ ...track }, true), -1);
    assert.equal(manager.getTrackIndex({ ...track }), ordinal);
  });
});

test('catalog CUE selection preserves the currently displayed queue page', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    await manager.loadCatalogSequence(catalogDescriptor(), {
      currentOrdinal: 0,
      autoPlay: false
    });
    await manager.refreshCatalogQueuePage(160);
    const refreshes = [];
    manager.refreshCatalogQueueWindow = ordinal => {
      refreshes.push(ordinal);
    };

    const result = await manager.selectSequenceOrdinal(239, {
      play: true,
      preserveQueueWindow: true
    });

    assert.equal(result.accepted, true);
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 239);
    assert.equal(audioPlayer.stateManager.state.queueWindow.startOrdinal, 160);
    assert.deepEqual(refreshes, []);
  });
});

test('catalog playback reports skipped tracks and stops when none can play', async () => {
  await withPlaybackHarness(async ({ audioPlayer, calls, manager }) => {
    globalThis.window.uiManager = {
      showTransientMessage(...args) {
        calls.push(['transientMessage', ...args]);
      }
    };
    await manager.loadCatalogSequence(catalogDescriptor({ itemCount: 4 }), {
      currentOrdinal: 0,
      autoPlay: false
    });
    audioPlayer.contextManager.loadTrack = async (track, ordinal) => {
      calls.push(['loadTrackFailed', track.entryInstanceId, ordinal]);
      return false;
    };

    const result = await manager.transportNext(true);

    assert.deepEqual(result, { accepted: false, reason: 'no-playable-track', skippedCount: 3 });
    assert.deepEqual(calls.filter(call => call[0] === 'loadTrackFailed'), [
      ['loadTrackFailed', 'catalog-sequence:1', 1],
      ['loadTrackFailed', 'catalog-sequence:2', 2],
      ['loadTrackFailed', 'catalog-sequence:3', 3]
    ]);
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 0);
    assert.equal(audioPlayer.stateManager.state.isStopped, true);
    assert.deepEqual(calls.find(call => call[0] === 'transientMessage'), [
      'transientMessage',
      'status.libraryTracksSkippedOffline',
      false,
      { count: 3 }
    ]);
  });
});

test('catalog selection skips an unavailable source once and loads the next playable occurrence', async () => {
  await withPlaybackHarness(async ({ audioPlayer, calls, manager }) => {
    const sourceCalls = [];
    await manager.loadCatalogSequence({
      ...catalogDescriptor({ itemCount: 3 }),
      async resolveSource(request) {
        sourceCalls.push(request.trackUid);
        if (request.trackUid === 'track-0') throw Object.assign(new Error('offline'), { code: 'sourceUnavailable' });
        return { path: `/music/${request.trackUid}.flac` };
      }
    }, { currentOrdinal: 0, autoPlay: true });

    assert.deepEqual(sourceCalls, ['track-0', 'track-1']);
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 1);
    assert.deepEqual(calls.filter(call => call[0] === 'loadTrack').map(call => call[2]), [1]);
    assert.equal(calls.filter(call => call[0] === 'play').length, 1);
  });
});

test('explicit catalog queue selection never treats another occurrence as the clicked track', async () => {
  await withPlaybackHarness(async ({ audioPlayer, calls, manager }) => {
    const sourceCalls = [];
    globalThis.window.uiManager = {
      setError(...args) {
        calls.push(['setError', ...args]);
      },
      showTransientMessage(...args) {
        calls.push(['transientMessage', ...args]);
      }
    };
    await manager.loadCatalogSequence({
      ...catalogDescriptor({ itemCount: 3 }),
      async resolveSource(request) {
        sourceCalls.push(request.trackUid);
        if (request.trackUid === 'track-1') throw new Error('offline');
        return { path: `/music/${request.trackUid}.flac` };
      }
    }, { currentOrdinal: 0, autoPlay: false });
    sourceCalls.length = 0;

    const result = await manager.selectQueueOrdinal(1);

    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'source-unavailable');
    assert.deepEqual(sourceCalls, ['track-1']);
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 0);
    assert.equal(calls.some(call => call[0] === 'play'), false);
    assert.equal(calls.some(call => call[0] === 'transientMessage'), false);
    assert.deepEqual(calls.find(call => call[0] === 'setError'), [
      'setError',
      'error.playbackCommandFailed',
      true
    ]);
  });
});

test('stopped catalog queue selection waits for playback readiness and starts only the clicked CUE entry', async () => {
  await withPlaybackHarness(async ({ audioPlayer, calls, manager }) => {
    const sourceCalls = [];
    await manager.loadCatalogSequence({
      ...catalogDescriptor({ itemCount: 3 }),
      async resolveSource(request) {
        sourceCalls.push(request.trackUid);
        return { path: '/music/album.flac', startFrame: Number(request.trackUid.slice(6)) * 1000 };
      }
    }, { currentOrdinal: 0, autoPlay: false });
    sourceCalls.length = 0;
    calls.length = 0;
    let releasePlayback;
    audioPlayer.resumeAudioContextInGesture = () => new Promise(resolve => {
      releasePlayback = resolve;
    });

    const selected = manager.selectQueueOrdinal(2);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(sourceCalls, []);
    assert.equal(calls.some(call => call[0] === 'loadTrack'), false);

    releasePlayback(true);
    const result = await selected;

    assert.equal(result.accepted, true);
    assert.deepEqual(sourceCalls, ['track-2']);
    assert.deepEqual(calls.filter(call => call[0] === 'loadTrack'), [
      ['loadTrack', 'catalog-sequence:2', 2]
    ]);
    assert.equal(calls.filter(call => call[0] === 'play').length, 1);
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 2);
  });
});

test('catalog track-ended handling re-resolves Repeat ONE and resets Repeat OFF in the session', async () => {
  await withPlaybackHarness(async ({ audioPlayer, calls, manager }) => {
    const sourceCalls = [];
    await manager.loadCatalogSequence(catalogDescriptor({
      itemCount: 2,
      sourceCalls
    }), { currentOrdinal: 1, autoPlay: false });
    sourceCalls.length = 0;
    calls.length = 0;
    audioPlayer.stateManager.updateState({ repeatMode: 'ONE' }, 'repeat one');

    const repeated = await manager.transportNext(false, { reason: 'ended' });

    assert.equal(repeated.accepted, true);
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 1);
    assert.deepEqual(sourceCalls.map(request => request.trackUid), ['track-1']);
    assert.deepEqual(calls.filter(call => call[0] === 'loadTrack').map(call => call[2]), [1]);
    assert.equal(calls.filter(call => call[0] === 'play').length, 1);

    audioPlayer.stateManager.updateState({ repeatMode: 'OFF' }, 'repeat off');
    audioPlayer.contextManager.stop = async () => {
      calls.push(['stop']);
    };
    sourceCalls.length = 0;
    calls.length = 0;

    const ended = await manager.transportNext(false, { reason: 'ended' });

    assert.equal(ended.accepted, true);
    assert.equal(ended.stoppedAtEnd, true);
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 0);
    assert.deepEqual(sourceCalls.map(request => request.trackUid), ['track-0']);
    assert.deepEqual(calls.filter(call => ['loadTrack', 'stop'].includes(call[0])), [
      ['loadTrack', 'catalog-sequence:0', 0],
      ['stop']
    ]);
  });
});

test('premature catalog load recovery ignores Repeat ONE and reuses candidate skip-or-stop', async () => {
  await withPlaybackHarness(async ({ audioPlayer, calls, manager }) => {
    globalThis.window.uiManager = {
      showTransientMessage(...args) {
        calls.push(['transientMessage', ...args]);
      }
    };
    await manager.loadCatalogSequence(catalogDescriptor({ itemCount: 3 }), {
      currentOrdinal: 0,
      autoPlay: false
    });
    audioPlayer.stateManager.updateState({ repeatMode: 'ONE' }, 'repeat one');
    audioPlayer.contextManager.loadTrack = async (track, ordinal) => {
      calls.push(['recoveryLoadTrack', track.entryInstanceId, ordinal]);
      return ordinal !== 1;
    };

    const error = Object.assign(new Error('source ended early'), { code: 'mediaLoadFailed' });
    const result = await manager.recoverCatalogTrackLoadFailure(error, 0);

    assert.equal(result.accepted, true);
    assert.equal(result.skippedCount, 1);
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 2);
    assert.deepEqual(calls.filter(call => call[0] === 'recoveryLoadTrack'), [
      ['recoveryLoadTrack', 'catalog-sequence:1', 1],
      ['recoveryLoadTrack', 'catalog-sequence:2', 2]
    ]);
    assert.deepEqual(
      calls.filter(call => call[0] === 'transientMessage').map(call => call[4]?.count ?? call[3]?.count),
      [1, 1]
    );
  });
});

test('catalog onTrackEnded identifies the command as an ended transition', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    manager.catalogSequence = {};
    audioPlayer.stateManager.updateState({
      isPlaying: true,
      isPaused: false,
      isStopped: false
    }, 'playing');
    const calls = [];
    manager.transportNext = async (...args) => {
      calls.push(args);
      return { accepted: true };
    };

    manager.onTrackEnded();
    await Promise.resolve();

    assert.deepEqual(calls, [[false, { reason: 'ended' }]]);
  });
});

test('an offline provisional first occurrence waits for the published sequence and starts the next playable track', async () => {
  await withPlaybackHarness(async ({ audioPlayer, calls, manager }) => {
    const sourceCalls = [];
    let provisionalResolutionScope;
    const receipt = {
      operationId: 'offline-first',
      provisionalEntry: {
        entryInstanceId: 'offline-entry',
        trackUid: 'track-0',
        title: 'Offline'
      }
    };
    const provisional = await manager.installBulkPlayProvisional({
      receipt,
      service: {},
      async resolveSource(entry, resolutionScope) {
        provisionalResolutionScope = resolutionScope;
        sourceCalls.push(`provisional:${entry.trackUid}`);
        throw Object.assign(new Error('offline'), { code: 'sourceUnavailable' });
      }
    });
    assert.equal(provisional.accepted, true);
    assert.equal(provisional.deferred, true);
    assert.equal(calls.some(call => call[0] === 'seamlessTransition'), false);

    const sequence = new CatalogSequence({
      ...catalogDescriptor({
        sequenceId: 'published-after-offline',
        itemCount: 3,
        firstEntryInstanceId: 'offline-entry',
        provisionalOrdinal: 0
      }),
      async resolveSource(request) {
        assert.equal(request.resolutionScope, provisionalResolutionScope);
        sourceCalls.push(`published:${request.trackUid}`);
        if (request.trackUid === 'track-0') {
          throw Object.assign(new Error('offline'), { code: 'sourceUnavailable' });
        }
        return { path: `/music/${request.trackUid}.flac` };
      }
    });
    const published = await manager.commitCatalogDestination({
      operationId: 'offline-first',
      operationKind: 'play',
      sequence,
      currentOrdinal: 0
    });

    assert.equal(published.accepted, true);
    assert.equal(published.playbackAccepted, true);
    assert.equal(published.skippedCount, 1);
    assert.deepEqual(sourceCalls, [
      'provisional:track-0',
      'published:track-0',
      'published:track-1'
    ]);
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 1);
    assert.equal(audioPlayer.stateManager.state.currentTrack.libraryTrackId, 'track-1');
    assert.deepEqual(calls.filter(call => call[0] === 'loadTrack').map(call => call[2]), [1]);
  });
});

test('Electron catalog source stays a direct path without a renderer byte provider', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    await manager.loadCatalogSequence({
      ...catalogDescriptor({ itemCount: 1 }),
      async resolveSource() {
        return {
          kind: 'electron-file',
          path: 'D:\\Music\\large.flac',
          trackUid: 'track-0',
          folderId: 'folder-1',
          lifecycleVersion: 12,
          fileName: 'large.flac',
          provider: () => { throw new Error('renderer byte provider must not be used'); }
        };
      }
    }, { currentOrdinal: 0, autoPlay: false });

    const track = audioPlayer.stateManager.state.currentTrack;
    assert.equal(track.path, 'D:\\Music\\large.flac');
    assert.equal(Object.hasOwn(track, 'mediaUrl'), false);
    assert.equal(track.sourceKind, 'electron-file');
    assert.equal(track.folderId, 'folder-1');
    assert.equal(track.sourceLifecycleVersion, 12);
    assert.equal('provider' in track, false);
  });
});

test('Stop aborts pending catalog source resolution and prevents late playback', async () => {
  await withPlaybackHarness(async ({ calls, manager }) => {
    let resolveSource;
    let sourceSignal;
    const loading = manager.loadCatalogSequence({
      ...catalogDescriptor({ itemCount: 1 }),
      async resolveSource(request) {
        sourceSignal = request.signal;
        return new Promise(resolve => {
          resolveSource = resolve;
        });
      }
    }, { currentOrdinal: 0, autoPlay: true });
    for (let turn = 0; turn < 10; turn += 1) {
      if (resolveSource) break;
      await Promise.resolve();
    }

    assert.equal(typeof resolveSource, 'function');
    assert.equal(sourceSignal.aborted, false);
    await manager.stop();
    assert.equal(sourceSignal.aborted, true);

    resolveSource({ path: '/music/late.flac' });
    assert.deepEqual(await loading, { accepted: false, reason: 'stale', generation: 2 });
    assert.equal(calls.some(call => call[0] === 'loadTrack'), false);
    assert.equal(calls.some(call => call[0] === 'play'), false);
  });
});

test('paused Web catalog buffer resumes at its position without source resolution or loading', async () => {
  await withPlaybackHarness(async ({ audioPlayer, calls, manager }) => {
    const descriptor = catalogDescriptor({ itemCount: 1 });
    await manager.loadCatalogSequence(descriptor, { currentOrdinal: 0, autoPlay: false });
    const currentTrack = audioPlayer.stateManager.state.currentTrack;
    audioPlayer.contextManager.hasCurrentBuffer = () => true;
    audioPlayer.contextManager.play = async (...args) => {
      calls.push(['play', ...args]);
      return true;
    };
    audioPlayer.stateManager.updateState({
      playbackMode: 'bufferSource',
      isPlaying: false,
      isPaused: true,
      isStopped: false,
      currentTrackPosition: 37
    }, 'paused Web catalog track');
    descriptor.sourceCalls.length = 0;
    calls.length = 0;

    assert.equal(await manager.play(), true);

    assert.deepEqual(descriptor.sourceCalls, []);
    assert.deepEqual(calls, [['play', false, true]]);
    assert.equal(audioPlayer.stateManager.state.currentTrack, currentTrack);
    assert.equal(audioPlayer.stateManager.state.currentTrackPosition, 37);
  });
});

test('paused Electron catalog media resumes at its position without source resolution or loading', async () => {
  await withPlaybackHarness(async ({ audioPlayer, calls, manager }) => {
    let resolveCalls = 0;
    await manager.loadCatalogSequence({
      ...catalogDescriptor({ itemCount: 1 }),
      async resolveSource() {
        resolveCalls += 1;
        return {
          kind: 'electron-file',
          path: 'D:\\Music\\large.flac',
          folderId: 'folder-1',
          lifecycleVersion: 12
        };
      }
    }, { currentOrdinal: 0, autoPlay: false });
    const currentTrack = audioPlayer.stateManager.state.currentTrack;
    const mediaSource = audioPlayer.contextManager.getDirectElectronMediaSource(currentTrack);
    Object.assign(audioPlayer.audioElement, {
      src: mediaSource,
      currentSrc: mediaSource,
      currentTime: 51,
      error: null,
      ended: false
    });
    audioPlayer.contextManager.play = async (...args) => {
      calls.push(['play', ...args]);
      return true;
    };
    audioPlayer.stateManager.updateState({
      playbackMode: 'audioElement',
      isPlaying: false,
      isPaused: true,
      isStopped: false,
      currentTrackPosition: 51
    }, 'paused Electron catalog track');
    resolveCalls = 0;
    calls.length = 0;

    assert.equal(await manager.play(), true);

    assert.equal(resolveCalls, 0);
    assert.deepEqual(calls, [['play', false, true]]);
    assert.equal(audioPlayer.stateManager.state.currentTrack, currentTrack);
    assert.equal(audioPlayer.stateManager.state.currentTrackPosition, 51);
    assert.equal(audioPlayer.audioElement.currentTime, 51);
  });
});

test('catalog Play reloads stopped, missing, and stale paused sources', async () => {
  await withPlaybackHarness(async ({ audioPlayer, calls, manager }) => {
    const descriptor = catalogDescriptor({ itemCount: 1 });
    await manager.loadCatalogSequence(descriptor, { currentOrdinal: 0, autoPlay: false });
    audioPlayer.contextManager.hasCurrentBuffer = () => false;
    audioPlayer.stateManager.updateState({
      playbackMode: 'bufferSource',
      isPlaying: false,
      isPaused: true,
      isStopped: false
    }, 'paused catalog track without source');

    for (const { state, hasCurrentBuffer } of [
      { state: {}, hasCurrentBuffer: false },
      { state: { isPaused: false, isStopped: true }, hasCurrentBuffer: true },
      {
        state: {
          isPaused: true,
          isStopped: false,
          playbackGeneration: manager.playbackGeneration - 1
        },
        hasCurrentBuffer: true
      }
    ]) {
      audioPlayer.stateManager.updateState(state, 'catalog resume fallback case');
      audioPlayer.contextManager.hasCurrentBuffer = () => hasCurrentBuffer;
      descriptor.sourceCalls.length = 0;
      calls.length = 0;

      assert.equal(await manager.play(), true);

      assert.equal(descriptor.sourceCalls.length, 1);
      assert.equal(calls.filter(call => call[0] === 'loadTrack').length, 1);
      assert.equal(calls.filter(call => call[0] === 'play').length, 1);
    }
  });
});

test('audio graph rebuild replaces the cached Electron source with a freshly authorized path', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    let resolveCalls = 0;
    await manager.loadCatalogSequence({
      ...catalogDescriptor({ itemCount: 1 }),
      async resolveSource() {
        resolveCalls += 1;
        return resolveCalls === 1
          ? {
              kind: 'electron-file',
              path: 'D:\\Music\\Old.flac',
              folderId: 'folder-1',
              lifecycleVersion: 4
            }
          : {
              kind: 'electron-file',
              path: 'D:\\Music\\Fresh.flac',
              folderId: 'folder-1',
              lifecycleVersion: 4
            };
      }
    }, { currentOrdinal: 0, autoPlay: false });
    const oldTrack = audioPlayer.stateManager.state.currentTrack;

    const revalidated = await manager.prepareCatalogTrackForGraphRebuild(oldTrack, { play: false });

    assert.equal(revalidated.handled, false);
    assert.equal(revalidated.track.path, 'D:\\Music\\Fresh.flac');
    assert.equal(Object.hasOwn(revalidated.track, 'mediaUrl'), false);
    assert.equal(manager.getTrack(0), revalidated.track);
    assert.equal(resolveCalls, 2);
  });
});

test('late audio graph revalidation cannot replace a newer catalog track', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    let resolveRevalidation;
    let firstTrackResolutionCount = 0;
    await manager.loadCatalogSequence({
      ...catalogDescriptor({ itemCount: 2 }),
      async resolveSource(request) {
        if (request.trackUid === 'track-1') return { path: 'D:\\Music\\New.flac' };
        firstTrackResolutionCount += 1;
        if (firstTrackResolutionCount === 1) {
          return {
            kind: 'electron-file',
            path: 'D:\\Music\\Old.flac',
            folderId: 'folder-1',
            lifecycleVersion: 4
          };
        }
        return new Promise(resolve => {
          resolveRevalidation = resolve;
        });
      }
    }, { currentOrdinal: 0, autoPlay: false });
    const oldTrack = audioPlayer.stateManager.state.currentTrack;
    const revalidation = manager.prepareCatalogTrackForGraphRebuild(oldTrack, { play: false });
    for (let turn = 0; turn < 10; turn += 1) {
      if (resolveRevalidation) break;
      await Promise.resolve();
    }

    assert.equal((await manager.selectSequenceOrdinal(1, { play: false })).accepted, true);
    resolveRevalidation({
      kind: 'electron-file',
      path: 'D:\\Music\\Late.flac',
      folderId: 'folder-1',
      lifecycleVersion: 4
    });

    assert.deepEqual(await revalidation, { handled: true, reason: 'stale' });
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 1);
    assert.equal(audioPlayer.stateManager.state.currentTrack.path, 'D:\\Music\\New.flac');
    assert.equal(manager.getTrack(0), null);
    assert.equal(manager.getTrack(1), audioPlayer.stateManager.state.currentTrack);
  });
});

test('catalog graph revalidation follows the same entry after shuffle retargets its ordinal', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    let gateGraphResolution = false;
    let releaseGraphResolution;
    let markGraphResolutionStarted;
    const graphResolutionStarted = new Promise(resolve => { markGraphResolutionStarted = resolve; });
    const descriptor = catalogDescriptor({
      itemCount: 5,
      shuffleSeed: 41
    });
    descriptor.resolveSource = async request => {
      if (gateGraphResolution && request.trackUid === 'track-1') {
        markGraphResolutionStarted();
        await new Promise(resolve => { releaseGraphResolution = resolve; });
      }
      return { kind: 'electron-file', path: `/music/${request.trackUid}.flac` };
    };
    await manager.loadCatalogSequence(descriptor, { currentOrdinal: 1, autoPlay: false });
    const currentTrack = audioPlayer.stateManager.state.currentTrack;
    gateGraphResolution = true;

    const revalidation = manager.prepareCatalogTrackForGraphRebuild(currentTrack);
    await graphResolutionStarted;
    await manager.setCatalogShuffleMode(true, audioPlayer.stateManager.getStateSnapshot());
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 2);
    gateGraphResolution = false;
    releaseGraphResolution();
    const result = await revalidation;

    assert.equal(result.handled, false);
    assert.equal(result.ordinal, 2);
    assert.equal(result.track.entryInstanceId, currentTrack.entryInstanceId);
    assert.equal(manager.getTrack(2), result.track);
  });
});

test('graph source refresh never issues transport while explicit Select remains the only command', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    let failCurrentSource = false;
    await manager.loadCatalogSequence({
      ...catalogDescriptor({ itemCount: 2 }),
      async resolveSource(request) {
        if (failCurrentSource && request.trackUid === 'track-0') throw new Error('offline');
        return { path: `/music/${request.trackUid}.flac`, kind: 'electron-file' };
      }
    }, { currentOrdinal: 0, autoPlay: false });
    const currentTrack = audioPlayer.stateManager.state.currentTrack;
    const commandGeneration = audioPlayer.stateManager.state.transportCommandGeneration;
    failCurrentSource = true;

    const refresh = await manager.prepareCatalogTrackForGraphRebuild(currentTrack);
    assert.equal(refresh.handled, true);
    assert.equal(refresh.committed, false);
    assert.equal(refresh.reason, 'source-unavailable');
    assert.equal(
      audioPlayer.stateManager.state.transportCommandGeneration,
      commandGeneration
    );
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 0);

    const selected = await manager.selectSequenceOrdinal(1, { play: false });
    assert.equal(selected.accepted, true);
    assert.equal(
      audioPlayer.stateManager.state.transportCommandGeneration,
      commandGeneration + 1
    );
  });
});

test('repeat-all shuffle advances its epoch within the active session', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    await manager.loadCatalogSequence({
      ...catalogDescriptor({ itemCount: 4 }),
      shuffleEnabled: true,
      shuffleSeed: 41,
      shuffleEpoch: 0,
      shuffleTransportOffset: 0
    }, { currentOrdinal: 3, autoPlay: false });
    audioPlayer.stateManager.updateState({ repeatMode: 'ALL' }, 'test repeat mode');
    const result = await manager.transportNext(true);

    const descriptor = manager.catalogSequence.getDescriptor();
    assert.equal(result.accepted, true);
    assert.equal(descriptor.shuffleEpoch, 1);
    assert.equal(descriptor.shuffleTransportOffset, 0);
  });
});

test('context Play Next uses its service command and never advances transport', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    const calls = [];
    const service = {
      async start(request) {
        calls.push(request);
        return { operationId: 'insert-operation' };
      }
    };
    const selectionDescriptor = {
      mode: 'all',
      contextToken: 'context-1',
      exclusions: []
    };
    audioPlayer.stateManager.updatePlaylist(
      Array.from({ length: 8 }, (_, index) => ({ name: `Track ${index}` })),
      7
    );

    await manager.contextPlayNext(selectionDescriptor, {
      service
    });

    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 7);
    assert.equal(audioPlayer.stateManager.state.contextCommandGeneration, 1);
    assert.equal(audioPlayer.stateManager.state.transportCommandGeneration, 0);
    assert.equal(calls[0].operationKind, 'playNext');
    assert.deepEqual(calls[0], {
      operationKind: 'playNext',
      selectionDescriptor,
      target: null,
      options: {}
    });
  });
});

test('catalog shuffle updates the active session without a service command', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    await manager.loadCatalogSequence(catalogDescriptor({ itemCount: 8 }), {
      currentOrdinal: 0,
      autoPlay: false
    });
    await manager.setCatalogShuffleMode(true);
    assert.equal(manager.catalogSequence.getDescriptor().shuffleEnabled, true);
  });
});

test('Play Next inserts after current while Queue appends in the active session', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    await manager.loadCatalogSequence(catalogDescriptor({
      sequenceId: 'original',
      itemCount: 6,
      prefix: 'original'
    }), { currentOrdinal: 0, autoPlay: false });
    await manager.selectSequenceOrdinal(2, { play: false });

    const insertedDescriptor = catalogDescriptor({ sequenceId: 'inserted', itemCount: 2, prefix: 'inserted' });
    const inserted = new CatalogSequence(insertedDescriptor);
    await manager.commitCatalogDestination({
      operationId: 'insert-operation',
      operationKind: 'playNext',
      sequence: inserted
    });
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 2);
    assert.deepEqual(
      (await manager.catalogSequence.getWindow({ startOrdinal: 0, limit: 8 })).rows.map(row => row.trackUid),
      ['original-0', 'original-1', 'original-2', 'inserted-0', 'inserted-1', 'original-3', 'original-4', 'original-5']
    );

    const appended = new CatalogSequence(catalogDescriptor({
      sequenceId: 'appended',
      itemCount: 2,
      prefix: 'appended'
    }));
    await manager.commitCatalogDestination({
      operationId: 'append-operation',
      operationKind: 'queue',
      sequence: appended
    });
    assert.deepEqual(
      (await manager.catalogSequence.getWindow({ startOrdinal: 8, limit: 2 })).rows.map(row => row.trackUid),
      ['appended-0', 'appended-1']
    );
  });
});

test('empty-queue Play Next and Queue share one folder prompt per action', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    const prompts = [];
    const scopes = [];
    const permissionError = Object.assign(new Error('permission required'), {
      code: 'folderPermissionRequired',
      details: { folderId: 'folder-1', lifecycleVersion: 8 }
    });
    const unavailableSequence = operationKind => new CatalogSequence({
      ...catalogDescriptor({ sequenceId: `${operationKind}-sequence`, itemCount: 2 }),
      async resolveSource(request) {
        scopes.push(request.resolutionScope);
        if (claimFolderPermissionAttempt(request.resolutionScope, 'folder-1', 8)) {
          prompts.push(operationKind);
        }
        throw permissionError;
      }
    });

    await manager.commitCatalogDestination({
      operationId: 'play-next-operation',
      operationKind: 'playNext',
      sequence: unavailableSequence('playNext')
    });
    audioPlayer.audioElement.pause = () => {};
    manager.clear();
    await manager.commitCatalogDestination({
      operationId: 'queue-operation',
      operationKind: 'queue',
      sequence: unavailableSequence('queue')
    });

    assert.deepEqual(prompts, ['playNext', 'queue']);
    assert.equal(scopes[0], scopes[1]);
    assert.equal(scopes[2], scopes[3]);
    assert.notEqual(scopes[0], scopes[2]);
  });
});

test('bulk Play keeps its provisional singleton on cancel and publishes without position reset', async () => {
  await withPlaybackHarness(async ({ audioPlayer, calls, manager }) => {
    const serviceCalls = [];
    let operationNumber = 0;
    const service = {
      async start() {
        operationNumber += 1;
        return {
          operationId: `bulk-${operationNumber}`,
          provisionalEntry: {
            entryInstanceId: 'clicked-instance',
            libraryTrackId: 'clicked-track',
            path: '/music/clicked.flac',
            name: 'Clicked'
          }
        };
      },
      async cancel(operationId) {
        serviceCalls.push(['cancel', operationId]);
        return { kind: 'cancelRequested', operationId };
      }
    };
    const selectionDescriptor = { mode: 'all', contextToken: 'context-1', exclusions: [] };
    audioPlayer.stateManager.updateState({ shuffleMode: true }, 'shuffle enabled');
    await manager.startBulkPlay({
      selectionDescriptor,
      service
    });
    assert.equal(manager.playlist.length, 1);
    assert.equal(manager.playlist[0].entryInstanceId, 'clicked-instance');
    assert.equal(calls.filter(call => call[0] === 'loadTrack').length, 0);
    assert.equal(calls.filter(call => call[0] === 'seamlessTransition').length, 1);

    assert.deepEqual(await manager.cancelBulkPlay('bulk-1'), {
      accepted: true,
      phase: 'cancel-requested'
    });
    assert.equal(manager.playlist[0].entryInstanceId, 'clicked-instance');
    assert.deepEqual(serviceCalls, [['cancel', 'bulk-1']]);
    assert.equal(await manager.finishBulkPlayTerminal('bulk-1'), true);
    assert.equal(manager.activeBulkPlay.phase, 'terminal');
    assert.equal(manager.playlist.length, 0);

    await manager.startBulkPlay({
      selectionDescriptor,
      service
    });
    let regionPlanRefreshes = 0;
    audioPlayer.contextManager.refreshActiveRegionTransportPlan = () => {
      regionPlanRefreshes += 1;
      return true;
    };
    audioPlayer.stateManager.updateState({ currentTrackPosition: 37 }, 'position');
    const currentOrdinal = 123;
    const publishedSequence = new CatalogSequence(catalogDescriptor({
      sequenceId: 'published-sequence',
      firstEntryInstanceId: 'clicked-instance',
      provisionalOrdinal: currentOrdinal
    }));
    await manager.commitCatalogDestination({
      operationId: 'bulk-2',
      operationKind: 'play',
      sequence: publishedSequence,
      currentOrdinal
    });
    assert.equal(audioPlayer.stateManager.state.currentTrackPosition, 37);
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, currentOrdinal);
    assert.equal(audioPlayer.stateManager.state.currentTrack.entryInstanceId, 'clicked-instance');
    assert.equal(regionPlanRefreshes, 1);
    assert.deepEqual(await manager.cancelBulkPlay('bulk-2'), {
      accepted: false,
      reason: 'tooLate'
    });
    assert.equal(await manager.finishBulkPlayTerminal('bulk-2', { succeeded: true }), true);
    assert.equal(manager.canUndoSessionTransport(), true);
    const originalUndo = manager.sessionTransportUndo;

    await manager.startBulkPlay({ selectionDescriptor, service });
    assert.equal(manager.sessionTransportUndo, originalUndo);
    assert.equal(await manager.finishBulkPlayTerminal('bulk-3'), true);
    assert.equal(manager.sessionTransportUndo, originalUndo);

    await manager.startBulkPlay({ selectionDescriptor, service });
    const replacementSequence = new CatalogSequence(catalogDescriptor({
      sequenceId: 'replacement-sequence',
      firstEntryInstanceId: 'clicked-instance',
      provisionalOrdinal: 0
    }));
    await manager.commitCatalogDestination({
      operationId: 'bulk-4',
      operationKind: 'play',
      sequence: replacementSequence,
      currentOrdinal: 0
    });
    assert.notEqual(manager.sessionTransportUndo, originalUndo);
    assert.equal(manager.sessionTransportUndo.sequence, publishedSequence);

    assert.deepEqual(await manager.undoSessionTransport(), { kind: 'published' });
    assert.equal(manager.canUndoSessionTransport(), false);
    assert.equal(manager.catalogSequence, publishedSequence);
  });
});

test('manual queue replacement and clear invalidate Library Play undo while append preserves it', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    const undo = { kind: 'catalog' };
    manager.sessionTransportUndo = undo;

    manager.loadFiles(['/music/appended.flac'], true);
    assert.equal(manager.sessionTransportUndo, undo);

    manager.loadFiles(['/music/replacement.flac'], false);
    assert.equal(manager.sessionTransportUndo, null);

    manager.sessionTransportUndo = undo;
    audioPlayer.audioElement.pause = () => {};
    manager.clear();
    assert.equal(manager.sessionTransportUndo, null);
  });
});
