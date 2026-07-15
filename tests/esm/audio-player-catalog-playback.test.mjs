import assert from 'node:assert/strict';
import test from 'node:test';

import { PlaybackManager } from '../../js/ui/audio-player/playback-manager.js';
import { CatalogSequence } from '../../js/ui/audio-player/playback-sequence.js';
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
    transportVersion: overrides.transportVersion ?? 1,
    async readPage({ startOrdinal, limit }) {
      return {
        rows: Array.from({ length: limit }, (_, index) => ({
          ...(overrides.firstEntryInstanceId && startOrdinal + index === 0
            ? { entryInstanceId: overrides.firstEntryInstanceId }
            : {}),
          trackUid: `${overrides.prefix ?? 'track'}-${startOrdinal + index}`,
          title: `Track ${startOrdinal + index}`
        }))
      };
    },
    async resolveSource(request) {
      sourceCalls.push(request);
      return { path: `/music/${request.trackUid}.flac` };
    },
    sourceCalls
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
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    const descriptor = catalogDescriptor();
    const transportCommits = [];
    audioPlayer.libraryOperationService = {
      async commitTransportCommand(request) {
        transportCommits.push(request);
        return {
          kind: 'published',
          transportVersion: request.expectedTransportVersion + 1,
          descriptor: request.descriptor
        };
      }
    };
    await manager.loadCatalogSequence(descriptor, { currentOrdinal: 0, autoPlay: false });
    assert.equal(Array.isArray(manager.playlist), false);
    assert.equal(manager.playlist.length, 1_000_000);
    assert.equal(descriptor.sourceCalls.length, 0);
    assert.equal(audioPlayer.stateManager.state.playlist.length, 0);

    const result = await manager.transportNext(true);
    assert.equal(result.accepted, true);
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 1);
    assert.equal(descriptor.sourceCalls.length, 1);
    assert.equal(audioPlayer.stateManager.state.currentTrack.entryInstanceId, 'catalog-sequence:1');
    assert.equal(manager.transportVersion, 2);
    assert.equal(transportCommits.length, 1);
    assert.equal(transportCommits[0].descriptor.currentOrdinal, 1);
    assert.ok(manager.catalogSequence.getCacheStats().cachedPageCount <= 5);
  });
});

test('catalog transport commits before media and compensates a terminal media failure', async () => {
  await withPlaybackHarness(async ({ audioPlayer, calls, manager }) => {
    await manager.loadCatalogSequence(catalogDescriptor({ itemCount: 4, transportVersion: 1 }), {
      currentOrdinal: 0,
      autoPlay: false
    });
    audioPlayer.libraryOperationService = {
      async commitTransportCommand(request) {
        calls.push(['commit', request.descriptor.currentOrdinal]);
        return {
          kind: 'published',
          transportVersion: request.expectedTransportVersion + 1,
          descriptor: request.descriptor
        };
      }
    };
    audioPlayer.contextManager.loadTrack = async (track, ordinal) => {
      calls.push(['loadTrackFailed', track.entryInstanceId, ordinal]);
      return false;
    };

    const result = await manager.transportNext(true);

    assert.deepEqual(result, { accepted: false, reason: 'media-load-failed' });
    assert.deepEqual(calls.filter(call => ['commit', 'loadTrackFailed'].includes(call[0])), [
      ['commit', 1],
      ['loadTrackFailed', 'catalog-sequence:1', 1],
      ['commit', 0]
    ]);
    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 0);
    assert.equal(manager.transportVersion, 3);
  });
});

test('repeat-all shuffle restores its epoch when the durable transport CAS conflicts', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    await manager.loadCatalogSequence({
      ...catalogDescriptor({ itemCount: 4, transportVersion: 7 }),
      shuffleEnabled: true,
      shuffleSeed: 41,
      shuffleEpoch: 0,
      shuffleTransportOffset: 0
    }, { currentOrdinal: 3, autoPlay: false });
    audioPlayer.stateManager.updateState({ repeatMode: 'ALL' }, 'test repeat mode');
    audioPlayer.libraryOperationService = {
      async commitTransportCommand() {
        return { kind: 'conflict', currentTransportVersion: 8 };
      }
    };

    await assert.rejects(
      manager.transportNext(true),
      error => error.code === 'staleTransportVersion'
    );

    const descriptor = manager.catalogSequence.getDescriptor();
    assert.equal(descriptor.shuffleEpoch, 0);
    assert.equal(descriptor.shuffleTransportOffset, 0);
    assert.equal(manager.transportVersion, 7);
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
      service,
      clientRequestId: 'request-1',
      expectedTransportVersion: 4
    });

    assert.equal(audioPlayer.stateManager.state.currentTrackIndex, 7);
    assert.equal(audioPlayer.stateManager.state.contextCommandGeneration, 1);
    assert.equal(audioPlayer.stateManager.state.transportCommandGeneration, 0);
    assert.equal(calls[0].operationKind, 'playNext');
    assert.equal(calls[0].expectedTargetVersion, 4);
  });
});

test('catalog shuffle publishes through durable CAS and rolls back local permutation on conflict', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    await manager.loadCatalogSequence(catalogDescriptor({ itemCount: 8, transportVersion: 3 }), {
      currentOrdinal: 0,
      autoPlay: false
    });
    audioPlayer.libraryOperationService = {
      async commitTransportCommand() { return { kind: 'conflict', currentTransportVersion: 4 }; }
    };
    await assert.rejects(
      manager.setCatalogShuffleMode(true),
      error => error.code === 'staleTransportVersion'
    );
    assert.equal(manager.catalogSequence.getDescriptor().shuffleEnabled, false);
    assert.equal(manager.transportVersion, 3);
  });
});

test('Play Next inserts after current while Queue appends and each destination uses one CAS increment', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    await manager.loadCatalogSequence(catalogDescriptor({
      sequenceId: 'original',
      itemCount: 6,
      transportVersion: 10,
      prefix: 'original'
    }), { currentOrdinal: 0, autoPlay: false });
    await manager.selectCatalogOrdinal(2, { play: false });
    assert.equal(manager.transportVersion, 11);

    const insertedDescriptor = catalogDescriptor({ sequenceId: 'inserted', itemCount: 2, prefix: 'inserted' });
    const inserted = new CatalogSequence(insertedDescriptor);
    await manager.commitCatalogDestination({
      operationId: 'insert-operation',
      operationKind: 'playNext',
      sequence: inserted,
      expectedTransportVersion: 11,
      transportVersion: 12,
      transportDescriptor: {
        segments: [
          { sequenceId: 'original', startOrdinal: 0, endOrdinal: 3 },
          { sequenceId: 'inserted', startOrdinal: 0, endOrdinal: 2 },
          { sequenceId: 'original', startOrdinal: 3, endOrdinal: 6 }
        ],
        currentOrdinal: 2
      }
    });
    assert.equal(manager.transportVersion, 12);
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
      sequence: appended,
      expectedTransportVersion: 12,
      transportVersion: 13,
      transportDescriptor: {
        segments: [
          { sequenceId: 'original', startOrdinal: 0, endOrdinal: 3 },
          { sequenceId: 'inserted', startOrdinal: 0, endOrdinal: 2 },
          { sequenceId: 'original', startOrdinal: 3, endOrdinal: 6 },
          { sequenceId: 'appended', startOrdinal: 0, endOrdinal: 2 }
        ],
        currentOrdinal: 2
      }
    });
    assert.equal(manager.transportVersion, 13);
    assert.deepEqual(
      (await manager.catalogSequence.getWindow({ startOrdinal: 8, limit: 2 })).rows.map(row => row.trackUid),
      ['appended-0', 'appended-1']
    );
  });
});

test('bulk Play keeps its provisional singleton on cancel and publishes without position reset', async () => {
  await withPlaybackHarness(async ({ audioPlayer, manager }) => {
    const serviceCalls = [];
    let operationNumber = 0;
    const service = {
      async start() {
        operationNumber += 1;
        const transportVersion = operationNumber;
        return {
          operationId: `bulk-${operationNumber}`,
          transportVersion,
          transportDescriptor: {
            segments: [{
              sequenceId: `provisional:bulk-${operationNumber}`,
              startOrdinal: 0,
              endOrdinal: 1
            }],
            currentOrdinal: 0
          },
          undoId: `transport:bulk-${operationNumber}`,
          undoExpiresAt: 10_000 + operationNumber,
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
        return { accepted: true };
      }
    };
    const selectionDescriptor = { mode: 'all', contextToken: 'context-1', exclusions: [] };
    await manager.startBulkPlay({
      selectionDescriptor,
      service,
      clientRequestId: 'bulk-request',
      expectedTransportVersion: 0
    });
    assert.equal(manager.playlist.length, 1);
    assert.equal(manager.playlist[0].entryInstanceId, 'clicked-instance');

    assert.deepEqual(await manager.cancelBulkPlay('bulk-1'), {
      accepted: true,
      phase: 'cancelled',
      undoId: 'transport:bulk-1',
      undoExpiresAt: 10_001
    });
    assert.equal(manager.playlist[0].entryInstanceId, 'clicked-instance');
    assert.deepEqual(serviceCalls, [['cancel', 'bulk-1']]);

    await manager.startBulkPlay({
      selectionDescriptor,
      service,
      clientRequestId: 'bulk-request-2',
      expectedTransportVersion: 1
    });
    audioPlayer.stateManager.updateState({ currentTrackPosition: 37 }, 'position');
    await manager.publishBulkPlaySequence({
      operationId: 'bulk-2',
      ...catalogDescriptor({
        sequenceId: 'published-sequence',
        transportVersion: 2,
        firstEntryInstanceId: 'clicked-instance'
      }),
      currentOrdinal: 0,
      expectedTransportVersion: 1,
      transportDescriptor: {
        segments: [{ sequenceId: 'published-sequence', startOrdinal: 0, endOrdinal: 1_000_000 }],
        currentOrdinal: 0
      }
    });
    assert.equal(audioPlayer.stateManager.state.currentTrackPosition, 37);
    assert.equal(audioPlayer.stateManager.state.currentTrack.entryInstanceId, 'clicked-instance');
    assert.deepEqual(await manager.cancelBulkPlay('bulk-2'), {
      accepted: false,
      reason: 'tooLate'
    });
  });
});
