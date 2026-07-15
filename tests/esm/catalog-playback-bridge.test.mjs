import assert from 'node:assert/strict';
import test from 'node:test';

import { CatalogPlaybackBridge } from '../../js/ui/audio-player/catalog-playback-bridge.js';

test('production playback bridge installs provisional source then publishes terminal CatalogSequence', async () => {
  const calls = [];
  let operationListener = null;
  let finishCommit;
  let resolveProvisional;
  const committed = new Promise(resolve => { finishCommit = resolve; });
  const provisional = new Promise(resolve => { resolveProvisional = resolve; });
  const service = {
    async start(request) {
      calls.push(['start', request]);
      return {
        kind: 'started',
        operationId: 'operation-1'
      };
    },
    async getProvisionalEntry() { return provisional; },
    async status() { return null; },
    subscribeOperations(listener) {
      operationListener = listener;
      return () => { operationListener = null; };
    }
  };
  const sequenceClient = {
    async readSequencePage() {
      return { items: [{ ordinal: 0, entryInstanceId: 'entry-1', trackUid: 'track-1' }] };
    },
    async resolveSequenceEntrySource(request) {
      calls.push(['resolve', request]);
      return { path: '/music/track-1.flac' };
    }
  };
  const player = {
    libraryOperationService: null,
    ui: { container: {}, createPlayerUI() {} },
    playbackManager: {
      transportVersion: 4,
      async installBulkPlayProvisional(options) {
        calls.push(['provisional', options.expectedTransportVersion]);
        await options.resolveSource(options.receipt.provisionalEntry);
        return { accepted: true };
      },
      async commitCatalogDestination(options) {
        calls.push(['commit', options]);
        finishCommit();
        return { accepted: true, transportVersion: 6 };
      }
    }
  };
  const uiManager = { audioPlayer: player, setError(error) { calls.push(['error', error]); } };
  const bridge = new CatalogPlaybackBridge({ uiManager, service, sequenceClient });
  const receipt = await bridge.start({
    clientRequestId: 'request-1',
    operationKind: 'play',
    selectionDescriptor: { mode: 'all', contextToken: 'context-1', exclusions: [] },
    target: null,
    expectedTargetVersion: null,
    options: {}
  });
  assert.equal(receipt.operationId, 'operation-1');
  assert.equal(calls.some(call => call[0] === 'resolve'), false);
  assert.equal(calls[0][1].expectedTargetVersion, 4);
  assert.equal(calls[0][1].options.playbackDestination, 'replace');
  resolveProvisional({ entryInstanceId: 'entry-1', trackUid: 'track-1' });

  operationListener({
    kind: 'terminal',
    operationId: 'operation-1',
    result: {
      state: 'succeeded',
      result: {
        operationKind: 'play',
        destination: 'replace',
        sequenceId: 'sequence-1',
        itemCount: 1_000_000,
        expectedTransportVersion: 4,
        transportVersion: 5,
        transportDescriptor: {
          segments: [{ sequenceId: 'sequence-1', startOrdinal: 0, endOrdinal: 1_000_000 }],
          currentOrdinal: 0
        }
      }
    }
  });
  await committed;
  assert.deepEqual(calls.find(call => call[0] === 'resolve')[1], {
    entryInstanceId: 'entry-1',
    trackUid: 'track-1'
  });
  const commit = calls.find(call => call[0] === 'commit')[1];
  assert.equal(commit.operationKind, 'play');
  assert.equal(commit.expectedTransportVersion, 4);
  assert.equal(commit.sequence.itemCount, 1_000_000);
});

test('web playback reconnects a permission-waiting folder and retries the same source once', async () => {
  const calls = [];
  let resolveCalls = 0;
  const service = {
    async start() {},
    async getTransportState() {
      return {
        transportVersion: 1,
        descriptor: {
          segments: [{ sequenceId: 'sequence-1', startOrdinal: 0, endOrdinal: 1 }],
          currentOrdinal: 0
        }
      };
    }
  };
  const sequenceClient = {
    async readSequencePage() {
      return {
        sequence: { itemCount: 1 },
        items: [{ ordinal: 0, entryInstanceId: 'entry-1', trackUid: 'track-1' }]
      };
    },
    async resolveSequenceEntrySource(request) {
      resolveCalls += 1;
      calls.push(['resolve', request.trackUid]);
      if (resolveCalls === 1) {
        const error = new Error('permission required');
        error.code = 'folderPermissionRequired';
        error.details = { folderId: 'folder-1' };
        throw error;
      }
      return { path: '/music/track-1.flac' };
    }
  };
  const player = {
    playbackManager: {
      async loadCatalogSequence(sequence) {
        const entry = await sequence.getEntry(0);
        const source = await sequence.resolveEntrySource(entry);
        calls.push(['loaded', source.path]);
      }
    }
  };
  const bridge = new CatalogPlaybackBridge({
    uiManager: { audioPlayer: player },
    service,
    sequenceClient,
    runtime: 'web',
    async requestFolderAccess(folderId) {
      calls.push(['reconnect', folderId]);
      return { folder: { id: folderId, status: 'active' } };
    }
  });

  assert.equal((await bridge.restoreTransport()).restored, true);
  assert.deepEqual(calls, [
    ['resolve', 'track-1'],
    ['reconnect', 'folder-1'],
    ['resolve', 'track-1'],
    ['loaded', '/music/track-1.flac']
  ]);
});

test('web playback does not retry source resolution after folder reconnection is cancelled', async () => {
  let resolveCalls = 0;
  let reconnects = 0;
  const permissionError = Object.assign(new Error('permission required'), {
    code: 'folderPermissionRequired',
    details: { folderId: 'folder-1' }
  });
  const service = {
    async start() {},
    async getTransportState() {
      return {
        transportVersion: 1,
        descriptor: {
          segments: [{ sequenceId: 'sequence-1', startOrdinal: 0, endOrdinal: 1 }]
        }
      };
    }
  };
  const sequenceClient = {
    async readSequencePage() {
      return {
        sequence: { itemCount: 1 },
        items: [{ ordinal: 0, entryInstanceId: 'entry-1', trackUid: 'track-1' }]
      };
    },
    async resolveSequenceEntrySource() {
      resolveCalls += 1;
      throw permissionError;
    }
  };
  const bridge = new CatalogPlaybackBridge({
    uiManager: {
      audioPlayer: {
        playbackManager: {
          async loadCatalogSequence(sequence) {
            const entry = await sequence.getEntry(0);
            await sequence.resolveEntrySource(entry);
          }
        }
      }
    },
    service,
    sequenceClient,
    runtime: 'web',
    async requestFolderAccess() {
      reconnects += 1;
      return null;
    }
  });

  await assert.rejects(bridge.restoreTransport(), error => error === permissionError);
  assert.equal(resolveCalls, 1);
  assert.equal(reconnects, 1);
});

test('terminal response-loss recovery restores the already-published durable transport', async () => {
  const calls = [];
  const terminal = {
    state: 'succeeded',
    result: {
      operationKind: 'play',
      destination: 'replace',
      sequenceId: 'sequence-recovered',
      itemCount: 2,
      firstOrdinal: 0,
      firstEntry: { entryInstanceId: 'entry-recovered', trackUid: 'track-recovered' },
      expectedTransportVersion: 2,
      transportVersion: 3,
      transportDescriptor: {
        segments: [{ sequenceId: 'sequence-recovered', startOrdinal: 0, endOrdinal: 2 }],
        currentOrdinal: 0
      }
    }
  };
  const service = {
    async start() { return { kind: 'terminal', result: terminal }; },
    async getTransportState() {
      return {
        transportVersion: terminal.result.transportVersion,
        descriptor: terminal.result.transportDescriptor
      };
    }
  };
  const sequenceClient = {
    async readSequencePage() {
      return {
        sequence: { itemCount: 2 },
        items: [terminal.result.firstEntry, { entryInstanceId: 'entry-2', trackUid: 'track-2' }]
      };
    },
    async resolveSequenceEntrySource(request) {
      calls.push(['resolve', request]);
      return { path: '/music/recovered.flac' };
    }
  };
  const player = {
    ui: { container: {} },
    playbackManager: {
      transportVersion: 2,
      durableTransportDescriptor: null,
      async loadCatalogSequence(sequence, options) {
        calls.push(['restore', sequence, options]);
      }
    }
  };
  const bridge = new CatalogPlaybackBridge({
    uiManager: { audioPlayer: player },
    service,
    sequenceClient
  });
  await bridge.start({
    clientRequestId: 'request-recovered',
    operationKind: 'play',
    selectionDescriptor: {},
    expectedTargetVersion: 2,
    options: {}
  });
  assert.equal(calls[0][0], 'restore');
  assert.equal(calls[0][1].itemCount, 2);
  assert.equal(calls[0][2].currentOrdinal, 0);
  assert.equal(player.playbackManager.transportVersion, 3);
});

test('startup restores the durable transport version, segments, current ordinal, and shuffle state', async () => {
  const loaded = [];
  const service = {
    async start() {},
    async getTransportState() {
      return {
        transportVersion: 9,
        descriptor: {
          segments: [{
            sequenceId: 'sequence-restored',
            startOrdinal: 2,
            endOrdinal: 7,
            shuffleSeed: 17,
            shuffleEpoch: 3,
            shuffleTransportOffset: 1
          }],
          currentOrdinal: 4
        }
      };
    }
  };
  const sequenceClient = {
    async readSequencePage({ sequenceId, ordinal, limit }) {
      return {
        sequence: { sequenceId, itemCount: 10 },
        items: Array.from({ length: limit }, (_, index) => ({
          ordinal: ordinal + index,
          entryInstanceId: `${sequenceId}:${ordinal + index}`,
          trackUid: `track-${ordinal + index}`
        }))
      };
    },
    async resolveSequenceEntrySource() { return {}; }
  };
  const playbackManager = {
    transportVersion: 0,
    durableTransportDescriptor: null,
    async loadCatalogSequence(sequence, options) { loaded.push({ sequence, options }); }
  };
  const bridge = new CatalogPlaybackBridge({
    uiManager: { audioPlayer: { playbackManager } },
    service,
    sequenceClient
  });
  assert.deepEqual(await bridge.restoreTransport(), { restored: true, transportVersion: 9 });
  assert.equal(playbackManager.transportVersion, 9);
  assert.equal(loaded[0].options.currentOrdinal, 4);
  assert.equal(loaded[0].sequence.itemCount, 5);
  assert.equal(loaded[0].sequence.segments[0].sequence.shuffleEpoch, 3);
  assert.equal(loaded[0].sequence.segments[0].sequence.shuffleTransportOffset, 1);
});

test('cancelled Play Undo restores the previous bounded descriptor and transport version', async () => {
  const calls = [];
  const descriptor = {
    segments: [{ sequenceId: 'sequence-previous', startOrdinal: 0, endOrdinal: 2 }],
    currentOrdinal: 1
  };
  const service = {
    async start() {},
    async applyTransportUndo(request) {
      calls.push(['undo', request]);
      return { kind: 'published', transportVersion: 12, descriptor };
    }
  };
  const sequenceClient = {
    async readSequencePage() {
      return { sequence: { itemCount: 2 }, items: [] };
    },
    async resolveSequenceEntrySource() { return {}; }
  };
  const playbackManager = {
    transportVersion: 11,
    durableTransportDescriptor: null,
    activeBulkPlay: { operationId: 'cancelled' },
    async loadCatalogSequence(sequence, options) { calls.push(['load', sequence, options]); }
  };
  const bridge = new CatalogPlaybackBridge({
    uiManager: { audioPlayer: { playbackManager } },
    service,
    sequenceClient
  });
  const result = await bridge.undoCancelledPlay({
    undoId: 'transport:cancelled', expectedTransportVersion: 11
  });
  assert.equal(result.kind, 'published');
  assert.deepEqual(calls[0], ['undo', {
    undoId: 'transport:cancelled', expectedTransportVersion: 11
  }]);
  assert.equal(calls[1][0], 'load');
  assert.equal(calls[1][1].itemCount, 2);
  assert.equal(calls[1][2].currentOrdinal, 1);
  assert.equal(calls[1][2].autoPlay, true);
  assert.equal(playbackManager.transportVersion, 12);
  assert.equal(playbackManager.activeBulkPlay, null);
});

test('Save Queue uses four-verb start with stable idempotency IDs and normalized sequence segments', async () => {
  const starts = [];
  const service = {
    async start(request) {
      starts.push(request);
      return starts.length === 1
        ? { kind: 'started', operationId: 'save-operation' }
        : { kind: 'active', operationId: 'save-operation' };
    }
  };
  const sequenceClient = {
    async readSequencePage() {},
    async resolveSequenceEntrySource() {}
  };
  const bridge = new CatalogPlaybackBridge({
    uiManager: { audioPlayer: {} },
    service,
    sequenceClient
  });
  const catalogSave = {
    name: ' Whole Queue ',
    playlistId: 'playlist-catalog',
    clientRequestId: 'save-request-catalog',
    saveId: 'save-catalog',
    sequenceDescriptor: { kind: 'catalog', sequenceId: 'sequence-a', itemCount: 1_000_000 }
  };
  await bridge.saveActiveSequenceAsPlaylist(catalogSave);
  await bridge.saveActiveSequenceAsPlaylist(catalogSave);
  await bridge.saveQueueAsPlaylist({
    name: 'Composite Queue',
    playlistId: 'playlist-composite',
    clientRequestId: 'save-request-composite',
    saveId: 'save-composite',
    sequenceDescriptor: {
      kind: 'composite',
      itemCount: 7,
      shuffleEnabled: true,
      shuffleSeed: 29,
      shuffleEpoch: 4,
      shuffleTransportOffset: 2,
      segments: [
        {
          startOrdinal: 2,
          itemCount: 3,
          source: { kind: 'catalog', sequenceId: 'sequence-a', itemCount: 10 }
        },
        {
          startOrdinal: 0,
          itemCount: 4,
          source: {
            kind: 'composite',
            itemCount: 4,
            segments: [
              {
                startOrdinal: 5,
                itemCount: 2,
                source: { kind: 'catalog', sequenceId: 'sequence-b', itemCount: 20 }
              },
              {
                startOrdinal: 7,
                itemCount: 2,
                source: { kind: 'catalog', sequenceId: 'sequence-b', itemCount: 20 }
              }
            ]
          }
        }
      ]
    }
  });
  await bridge.saveQueueAsPlaylist({
    name: 'Shuffled Queue',
    playlistId: 'playlist-shuffle',
    clientRequestId: 'save-request-shuffle',
    saveId: 'save-shuffle',
    sequenceDescriptor: {
      kind: 'catalog',
      sequenceId: 'sequence-shuffle',
      itemCount: 8,
      shuffleEnabled: true,
      shuffleSeed: 17,
      shuffleEpoch: 2,
      shuffleTransportOffset: 1
    }
  });
  assert.deepEqual(starts, [
    {
      clientRequestId: 'save-request-catalog',
      operationKind: 'addToPlaylist',
      selectionDescriptor: null,
      target: { playlistId: 'playlist-catalog' },
      expectedTargetVersion: 0,
      options: {
        saveId: 'save-catalog',
        name: 'Whole Queue',
        sourceSequenceDescriptor: {
          segments: [{ sequenceId: 'sequence-a', startOrdinal: 0, endOrdinal: 1_000_000 }]
        }
      }
    },
    {
      clientRequestId: 'save-request-catalog',
      operationKind: 'addToPlaylist',
      selectionDescriptor: null,
      target: { playlistId: 'playlist-catalog' },
      expectedTargetVersion: 0,
      options: {
        saveId: 'save-catalog',
        name: 'Whole Queue',
        sourceSequenceDescriptor: {
          segments: [{ sequenceId: 'sequence-a', startOrdinal: 0, endOrdinal: 1_000_000 }]
        }
      }
    },
    {
      clientRequestId: 'save-request-composite',
      operationKind: 'addToPlaylist',
      selectionDescriptor: null,
      target: { playlistId: 'playlist-composite' },
      expectedTargetVersion: 0,
      options: {
        saveId: 'save-composite',
        name: 'Composite Queue',
        sourceSequenceDescriptor: {
          shuffleSeed: 29,
          shuffleEpoch: 4,
          shuffleTransportOffset: 2,
          segments: [
            { sequenceId: 'sequence-a', startOrdinal: 2, endOrdinal: 5 },
            { sequenceId: 'sequence-b', startOrdinal: 5, endOrdinal: 9 }
          ]
        }
      }
    },
    {
      clientRequestId: 'save-request-shuffle',
      operationKind: 'addToPlaylist',
      selectionDescriptor: null,
      target: { playlistId: 'playlist-shuffle' },
      expectedTargetVersion: 0,
      options: {
        saveId: 'save-shuffle',
        name: 'Shuffled Queue',
        sourceSequenceDescriptor: {
          segments: [{
            sequenceId: 'sequence-shuffle',
            startOrdinal: 0,
            endOrdinal: 8,
            shuffleSeed: 17,
            shuffleEpoch: 2,
            shuffleTransportOffset: 1
          }]
        }
      }
    }
  ]);
  assert.deepEqual(starts[0], starts[1]);
  assert.equal('savePlaybackSequenceAsPlaylist' in sequenceClient, false);
});

test('Save Queue rejects more than 256 source segments before LibraryService.start', async () => {
  let startCount = 0;
  const bridge = new CatalogPlaybackBridge({
    uiManager: { audioPlayer: {} },
    service: { async start() { startCount += 1; } },
    sequenceClient: { async readSequencePage() {}, async resolveSequenceEntrySource() {} }
  });
  await assert.rejects(bridge.saveQueueAsPlaylist({
    name: 'Too many',
    playlistId: 'playlist-limit',
    clientRequestId: 'save-request-limit',
    sequenceDescriptor: {
      kind: 'composite',
      itemCount: 257,
      segments: Array.from({ length: 257 }, (_, index) => ({
        startOrdinal: 0,
        itemCount: 1,
        source: { kind: 'catalog', sequenceId: `sequence-${index}`, itemCount: 1 }
      }))
    }
  }), error => error.code === 'sequenceSegmentLimitExceeded');
  assert.equal(startCount, 0);
});
