import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioPlayer } from '../../js/ui/audio-player.js';
import { OpenHomePlaybackAdapter } from '../../js/ui/audio-player/openhome-playback-adapter.js';
import { PlaybackSessionStore, snapshotPlaybackSessionQueue } from '../../js/ui/audio-player/playback-session.js';
import { CatalogSequence, CompositeCatalogSequence, MaterializedSequence } from '../../js/ui/audio-player/playback-sequence.js';
import { getPlaybackRegion } from '../../js/ui/audio-player/playback-region.js';
import { getPlaybackFilePath } from '../../js/ui/audio-player/playback-source-policy.js';
import { CatalogPlaybackBridge } from '../../js/ui/audio-player/catalog-playback-bridge.js';
import { canonicalOrdinalForTransport } from '../../js/library/repository/transport-shuffle.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function makeState(changes = {}) {
  return {
    kind: 'materialized',
    itemCount: 1,
    currentOrdinal: 0,
    position: 0,
    duration: null,
    repeatMode: 'OFF',
    shuffleMode: false,
    shuffleState: null,
    ...changes
  };
}

function makeStore(request, writeMarker = async () => {}) {
  return new PlaybackSessionStore({
    getBridge: async () => ({ runtime: 'electron', requestPlaybackSession: request }),
    writeMarker
  });
}

test('session writes coalesce, defer while blocked, retry whole queues, and order deletion before a later save', async () => {
  let position = 0;
  let blocked = true;
  let failCommit = true;
  const actions = [];
  const player = {
    playbackManager: {
      isPlaybackSessionWriteBlocked: () => blocked,
      capturePlaybackSession: full => ({
        state: makeState({ position }),
        ...(full ? { queue: [{ ordinal: 0, trackUid: 'a' }] } : {})
      })
    }
  };
  const store = makeStore(request => {
    actions.push(request.state ? [request.action, request.state.position] : request.action);
    if (request.action === 'commit' && failCommit) {
      failCommit = false;
      throw new Error('Staged queue was not committed');
    }
  }, async present => { actions.push(present); });
  await withGlobals({ console: { ...console, warn() {} } }, async () => {
    store.request(player, { full: true });
    await store.tail;
    assert.deepEqual(actions, []);
    blocked = false;
    store.resume();
    position = 4;
    store.request(player);
    await store.tail;
    assert.deepEqual(actions.splice(0), [true, ['begin', 4], 'append', 'commit']);

    position = 8;
    store.request(player);
    await store.tail;
    assert.deepEqual(actions.splice(0), [true, ['begin', 8], 'append', 'commit']);
    position = 9;
    store.request(player);
    await store.tail;
    assert.deepEqual(actions.splice(0), [['update', 9]]);

    store.request(player);
    void store.remove();
    position = 1;
    store.request(player, { full: true });
    await store.tail;
    assert.deepEqual(actions, ['delete', false, true, ['begin', 1], 'append', 'commit']);
    assert.equal(await store.remove({ onlyIfUnscheduled: true }), false);
  });
});

function makeCatalog(sequenceId, uids) {
  return new CatalogSequence({
    sequenceId,
    itemCount: uids.length,
    readPage: ({ startOrdinal, limit }) => uids.slice(startOrdinal, startOrdinal + limit).map((trackUid, index) => ({
      trackUid,
      entryInstanceId: `${sequenceId}:${startOrdinal + index}`,
      title: trackUid
    })),
    resolveSource: ({ trackUid }) => ({ path: `/${trackUid}.flac` })
  });
}

test('a shuffled nested catalog saves its canonical composite with each child in transport order', async () => {
  const a = makeCatalog('a', ['a0', 'a1', 'a2', 'a3']);
  const b = makeCatalog('b', ['b0', 'b1']);
  a.setShuffle(true, { seed: 36 });
  const child = new CompositeCatalogSequence({ sequenceId: 'child', segments: [
    { sequence: a }, { sequence: b }
  ] });
  child.setShuffle(true, { seed: 14 });
  const root = new CompositeCatalogSequence({ sequenceId: 'root', segments: [
    { sequence: child, itemCount: 2 },
    { sequence: new MaterializedSequence([{ libraryTrackId: 'inserted' }]) },
    { sequence: child, startOrdinal: 2 }
  ] });
  root.setShuffle(true, { seed: 42 });
  const expected = [];
  for (let ordinal = 0; ordinal < root.itemCount; ordinal += 1) {
    const entry = await root.getEntry(root.toTransportOrdinal(ordinal));
    expected.push(entry.trackUid ?? entry.libraryTrackId);
    if (entry.trackUid) {
      assert.equal((await root.resolveEntrySource(entry)).path, `/${entry.trackUid}.flac`);
    }
  }

  const stored = [];
  const sources = new Map([[a.sequenceId, a], [b.sequenceId, b]]);
  const state = makeState({ kind: 'catalog', itemCount: root.itemCount, shuffleMode: true,
    currentOrdinal: root.toCanonicalOrdinal(2), shuffleState: { enabled: true, seed: 42, epoch: 0, transportOffset: 0 } });
  let savedQueue;
  const bridge = new CatalogPlaybackBridge({
    uiManager: {}, service: { start(request) { savedQueue = request.options.sourceSequenceDescriptor; } },
    sequenceClient: {
      readSequencePage: ({ ordinal, limit }) => ({ items: stored.slice(ordinal, ordinal + limit).map(
        (trackUid, index) => ({ trackUid, entryInstanceId: String(ordinal + index) })) }),
      resolveSequenceEntrySource() {}
    },
    sessionClient: {
      async playbackSession(request) {
        if (request.action === 'copy') {
          const source = sources.get(request.sequenceId);
          for (const [index, ordinal] of request.sourceOrdinals.entries()) {
            stored[request.destinationOrdinals[index]] = (await source.getCanonicalEntry(ordinal)).trackUid;
          }
        } else if (request.action === 'append') {
          for (const row of request.rows) stored[row.ordinal] = row.trackUid;
        } else if (request.action === 'read') {
          return { state, restoredCount: stored.length, currentOrdinal: state.currentOrdinal, currentPreserved: true,
            currentTrack: { trackUid: stored[state.currentOrdinal], libraryOrdinal: state.currentOrdinal },
            catalogSequence: { sequenceId: 'restored', itemCount: stored.length } };
        }
      }
    }
  });
  const store = new PlaybackSessionStore({ getBridge: () => bridge, writeMarker() {} });
  const queue = snapshotPlaybackSessionQueue(root);
  store.request({ playbackManager: {
    isPlaybackSessionWriteBlocked: () => false,
    capturePlaybackSession: () => ({ state, queue })
  } }, { full: true });
  await store.tail;
  assert.deepEqual(stored, expected);
  const restored = await store.load();
  assert.equal(restored.currentOrdinal, 2);
  await bridge.saveActiveSequenceAsPlaylist({ name: 'Restored queue', sequenceDescriptor: restored.sequence.getDescriptor() });
  const [segment] = savedQueue.segments;
  assert.equal(segment.sequenceId, 'restored');
  assert.equal(segment.endOrdinal, root.itemCount);
  for (let ordinal = 0; ordinal < root.itemCount; ordinal++) {
    const before = await root.getEntry(ordinal);
    const uid = before.trackUid ?? before.libraryTrackId;
    assert.equal((await restored.sequence.getEntry(ordinal)).trackUid, uid);
    assert.equal(stored[canonicalOrdinalForTransport(segment, ordinal, root.itemCount)], uid);
  }
});

test('materialized restore preserves duplicate occurrences, original shuffle order and library resolution on demand', async () => {
  const rows = [
    { ordinal: 0, originalOrdinal: 1, trackUid: 'B', entryInstanceId: 'b', title: 'B' },
    { ordinal: 1, originalOrdinal: 0, trackUid: 'A', entryInstanceId: 'a-first', title: 'A' },
    { ordinal: 2, originalOrdinal: 2, trackUid: 'A', entryInstanceId: 'a-last', title: 'A' }
  ];
  const resolutions = [];
  const bridge = new CatalogPlaybackBridge({
    uiManager: {}, service: { start() {} },
    sessionClient: { playbackSession: async ({ action }) => action === 'read'
        ? { state: makeState({ itemCount: 3, position: 12, shuffleMode: true }),
            currentOrdinal: 2, restoredCount: 3, currentPreserved: true }
        : { rows, nextOrdinal: null } },
    sequenceClient: {
      readSequencePage() {},
      resolveSequenceEntrySource({ trackUid }) {
        resolutions.push(trackUid);
        if (resolutions.length === 1) throw Object.assign(new Error('Folder needs permission'), {
          code: 'folderPermissionRequired', details: { folderId: 'music', lifecycleVersion: 1 }
        });
        return { path: 'A.flac' };
      }
    },
    requestFolderAccess(folderId) {
      resolutions.push(folderId);
      return { folder: { id: folderId, status: 'ok', lifecycleVersion: 1 } };
    }
  });
  const store = new PlaybackSessionStore({ getBridge: () => bridge });
  const session = await store.load();
  assert.deepEqual(session.playlist.map(track => track.entryInstanceId), ['b', 'a-first', 'a-last']);
  assert.deepEqual(session.originalPlaylist.map(track => track.entryInstanceId), ['a-first', 'b', 'a-last']);
  assert.equal(session.currentTrack.entryInstanceId, 'a-last');
  assert.equal(session.position, 12);
  assert.deepEqual(resolutions, []);
  assert.equal((await session.currentTrack.provider()).path, 'A.flac');
  assert.deepEqual(resolutions, ['A', 'music', 'A']);
});

test('an unloaded session can seek and survive a graph rebuild before the first playback opens a source', async () => {
  await withGlobals({ window: {}, document: { addEventListener() {}, removeEventListener() {} } }, async () => {
    const calls = [];
    const positions = [];
    const playbackSession = {
      request(player) {
        if (!player.playbackManager.isPlaybackSessionWriteBlocked()) {
          positions.push(player.playbackManager.capturePlaybackSession(false).state.position);
        }
      },
      resume() {},
      cancelPending() {}
    };
    const audioManager = { audioContext: {} };
    const player = new AudioPlayer(audioManager, { playbackSession });
    try {
      const context = player.contextManager;
      const manager = player.playbackManager;
      await player.stateRestored;
      const track = { name: 'Song', path: '/song.wav' };
      manager.installPlaybackSession({
        playlist: [track], originalPlaylist: [track], currentOrdinal: 0,
        position: 4, duration: 30, repeatMode: 'ALL', shuffleMode: false
      });
      player.resumeAudioContextInGesture = () => true;
      context.loadTrack = async entry => {
        calls.push(['load', entry.path]);
        context.updateState({ currentTrack: entry, currentTrackPosition: 0, currentTrackDuration: 30 });
        return true;
      };
      context.dispatchPlaybackBackend = async (_operation, position) => {
        calls.push(['media seek', position]);
        context.updateState({ currentTrackPosition: position });
      };
      context.play = async () => { calls.push(['play']); return true; };

      assert.equal(context.canSeekCurrentTrack(), true);
      await context.seek(7);
      audioManager.audioContext = { rebuilt: true };
      await context.handleAudioGraphRebuilt();
      assert.equal(player.audioContext, audioManager.audioContext);
      assert.equal(context.getCurrentPlaybackTime(), 7);
      assert.deepEqual(calls, []);
      await player.play();
      assert.deepEqual(calls, [['load', '/song.wav'], ['media seek', 7], ['play']]);
      assert.deepEqual(positions, [4, 7, 7]);
    } finally {
      player.playbackManager.dispose();
    }
  });
});

test('a dropped file grants its path once and keeps the expected size and last CUE region', async () => {
  let pathReads = 0;
  const electronAPI = { getPathForFile() { pathReads += 1; return '/music/audio.flac'; } };
  await withGlobals({ window: { electronAPI }, document: { addEventListener() {}, removeEventListener() {} } }, async () => {
    const playbackSession = { request() {}, cancelPending() {} };
    const player = new AudioPlayer({ audioContext: {} }, { playbackSession });
    try {
      const file = new File(['123456'], 'audio.flac');
      const track = player.playbackManager.createTrackEntry({
        file, name: 'Last region', startFrame: 75, endFrame: null, durationSec: 2,
        physicalSourceKey: 'album', meta: { title: 'Last region', picture: new Uint8Array([1]) }
      });
      assert.equal(getPlaybackFilePath(track, electronAPI), '/music/audio.flac');
      assert.equal(getPlaybackFilePath(track, electronAPI), '/music/audio.flac');
      const [{ track: saved }] = snapshotPlaybackSessionQueue(new MaterializedSequence([track]), [track], [track]);
      assert.equal(pathReads, 1);
      assert.equal(saved.byteLength, 6);
      assert.equal(saved.physicalSourceKey, 'album');
      assert.equal(Object.hasOwn(saved.meta, 'picture'), false);
      assert.equal(getPlaybackRegion(saved).endFrame, null);
    } finally {
      player.playbackManager.dispose();
      await player.stateRestored;
    }
  });
});

test('persistent mute reaches the first playback and a volume changed during loading survives', async () => {
  const settings = Promise.withResolvers();
  const saved = [];
  const window = {
    electronIntegration: {},
    electronAPI: {
      getPath: async () => '/settings',
      joinPaths: async (...parts) => parts.join('/'),
      fileExists: async () => true,
      readFile: () => settings.promise,
      saveFile: async (_path, value) => { saved.push(JSON.parse(value)); }
    }
  };
  await withGlobals({ window, document: { addEventListener() {}, removeEventListener() {} } }, async () => {
    const player = new AudioPlayer({ audioContext: {} });
    try {
      let resumeCount = 0;
      let firstGain;
      player.contextManager.resumePlaybackAudioContext = async () => { resumeCount += 1; return true; };
      player.contextManager.dispatchPlaybackBackend = async () => {
        firstGain = player.contextManager.getPlayerGain({}, null);
        return true;
      };
      const started = player.contextManager.play();
      player.setVolume(35);
      assert.equal(player.contextManager.getPlayerVolume(), 35);
      assert.equal(resumeCount, 1);
      assert.deepEqual(saved, []);
      assert.equal(firstGain, undefined);

      settings.resolve({ success: true, content: '{"playerVolume":80,"playerMute":true}' });
      assert.equal(await started, true);
      await player.playbackManager.playerStateWrites;
      assert.equal(firstGain, 0);
      assert.equal(player.contextManager.getPlayerVolume(), 35);
      assert.equal(player.contextManager.getPlayerMute(), true);
      assert.deepEqual(saved, [{ repeatMode: 'OFF', shuffleMode: false, playerVolume: 35, playerMute: true }]);
    } finally {
      player.playbackManager.dispose();
    }
  });
});

test('undoing a committed Library Play back to an empty queue deletes the session and clears its marker', async () => {
  await withGlobals({ window: {}, document: { addEventListener() {}, removeEventListener() {} } }, async () => {
    const actions = [];
    const playbackSession = makeStore(async ({ action }) => { actions.push(action); }, async present => {
      actions.push(present);
    });
    const player = new AudioPlayer({ audioContext: {} }, { playbackSession });
    try {
      const manager = player.playbackManager;
      await player.stateRestored;
      player.contextManager.seamlessTransition = async () => true;
      player.contextManager.stop = async () => {};
      const sequence = makeCatalog('published', ['a', 'b']);
      const provisionalEntry = { ...await sequence.getEntry(0), path: '/a.flac' };
      await manager.installBulkPlayProvisional({
        receipt: { operationId: 'library-play', provisionalEntry },
        resolveSource: async () => ({ path: '/a.flac' })
      });
      await manager.publishBulkPlaySequence({ operationId: 'library-play', sequence });
      await playbackSession.tail;
      assert.deepEqual(actions, [true, 'begin', 'copy', 'commit']);
      assert.deepEqual(await manager.undoSessionTransport(), { kind: 'published' });
      await playbackSession.tail;
      assert.equal(manager.sequence.itemCount, 0);
      assert.deepEqual(actions.slice(4), ['delete', false]);
    } finally {
      player.playbackManager.dispose();
    }
  });
});

test('OpenHome only blocks writes while transport can change and preserves local commands submitted while blocked', async () => {
  await withGlobals({ window: {}, document: { addEventListener() {}, removeEventListener() {} } }, async () => {
    const requests = [];
    const playbackSession = makeStore(async request => { requests.push(request); });
    const player = new AudioPlayer({ audioContext: {} }, { playbackSession });
    const readReply = Promise.withResolvers();
    const mutationReply = Promise.withResolvers();
    const responseReady = Promise.withResolvers();
    const mutationReady = Promise.withResolvers();
    const adapter = new OpenHomePlaybackAdapter(player, {
      bridge: {
        respond(response) {
          assert.equal(response.ok, true);
          if (response.requestId === 'read') {
            responseReady.resolve();
            return readReply.promise;
          }
          mutationReady.resolve();
          return mutationReply.promise;
        }
      }
    });
    try {
      const manager = player.playbackManager;
      await player.stateRestored;
      const first = { name: 'One', path: '/one.wav' };
      const second = { name: 'Two', path: '/two.wav' };
      manager.installPlaybackSession({
        playlist: [first, second], originalPlaylist: [first, second], currentOrdinal: 0,
        position: 4, duration: 30, repeatMode: 'ALL', shuffleMode: false
      });
      await playbackSession.tail;
      requests.length = 0;

      adapter.enqueueAction({ requestId: 'read', service: 'Volume', action: 'Snapshot',
        args: {}, deadlineEpochMs: Date.now() + 10_000 });
      await responseReady.promise;
      await player.contextManager.seek(7);
      await playbackSession.tail;
      assert.equal(requests.at(-1)?.action, 'update');
      assert.equal(requests.at(-1)?.state.position, 7);
      await manager.setShuffleMode(true);
      await playbackSession.tail;
      assert.equal(requests.findLast(request => request.action === 'begin')?.state.shuffleMode, true);
      assert.equal(requests.at(-1)?.action, 'commit');
      readReply.resolve(true);
      await adapter.commandChain;
      requests.length = 0;

      adapter.enqueueAction({ requestId: 'write', service: 'Playlist', action: 'SetRepeat',
        args: { repeat: false }, deadlineEpochMs: Date.now() + 10_000 });
      await mutationReady.promise;
      assert.equal(manager.isPlaybackSessionWriteBlocked(), true);
      assert.equal(playbackSession.pendingPlayer, null);
      await player.contextManager.seek(10);
      await manager.setShuffleMode(false);
      await playbackSession.tail;
      assert.deepEqual(requests, []);
      mutationReply.resolve(true);
      await adapter.commandChain;
      await playbackSession.tail;
      assert.equal(requests[0]?.action, 'begin');
      assert.equal(requests[0]?.state.position, 10);
      assert.equal(requests[0]?.state.repeatMode, 'OFF');
      assert.equal(requests[0]?.state.shuffleMode, false);
      assert.equal(requests.at(-1)?.action, 'commit');
    } finally {
      adapter.dispose();
      readReply.resolve(false);
      mutationReply.resolve(false);
      await adapter.commandChain;
      player.playbackManager.dispose();
    }
  });
});

test('OpenHome removes the playback session only when the host accepts deleting the final track', async () => {
  await withGlobals({ window: {}, document: { addEventListener() {}, removeEventListener() {} } }, async () => {
    const actions = [];
    const playbackSession = makeStore(async ({ action }) => { actions.push(action); }, async present => {
      actions.push(present);
    });
    const player = new AudioPlayer({ audioContext: {} }, { playbackSession });
    let acceptsResponse = false;
    const responses = [];
    const adapter = new OpenHomePlaybackAdapter(player, {
      bridge: { respond(response) { responses.push(response); return acceptsResponse; } }
    });
    try {
      await player.stateRestored;
      player.contextManager.stop = async () => {};
      const manager = player.playbackManager;
      manager.replaceMaterializedPlaylist([{ name: 'One', path: '/one.wav' }], 0);
      await playbackSession.tail;
      assert.deepEqual(actions, [true, 'begin', 'append', 'commit']);
      actions.length = 0;

      const deleteTrack = async requestId => {
        adapter.enqueueAction({ requestId, service: 'Playlist', action: 'DeleteId', args: { id: 1 },
          localControl: true, deadlineEpochMs: Date.now() + 10_000 });
        await adapter.commandChain;
        await playbackSession.tail;
        assert.equal(responses.at(-1)?.ok, true);
      };
      await deleteTrack('reject-delete');
      assert.equal(manager.sequence.itemCount, 1);
      assert.deepEqual(actions, []);

      acceptsResponse = true;
      await deleteTrack('accept-delete');
      assert.equal(manager.sequence.itemCount, 0);
      assert.deepEqual(actions, ['delete', false]);
    } finally {
      adapter.dispose();
      player.playbackManager.dispose();
    }
  });
});

test('Undo restores a previously unloaded queue and leaves opening its media to the next Play', async () => {
  await withGlobals({ window: {}, document: { addEventListener() {}, removeEventListener() {} } }, async () => {
    for (const kind of ['materialized', 'catalog']) {
      const writes = [];
      const playbackSession = makeStore(async request => { writes.push(request); });
      const player = new AudioPlayer({ audioContext: {} }, { playbackSession });
      try {
        const manager = player.playbackManager;
        const context = player.contextManager;
        const opened = [];
        const calls = [];
        await player.stateRestored;
        player.resumeAudioContextInGesture = () => true;
        let restoredQueue;
        if (kind === 'catalog') {
          const sequence = makeCatalog('restored', ['first', 'current']);
          sequence.resolveSource = async ({ trackUid }) => {
            opened.push(trackUid);
            return { path: `/${trackUid}.flac` };
          };
          sequence.setShuffle(true, { seed: 42 });
          restoredQueue = { sequence, currentTrack: await sequence.getEntry(1) };
        } else {
          const first = { name: 'First', path: '/first.flac' };
          const current = { name: 'Current', path: '/current.flac' };
          restoredQueue = { playlist: [first, current], originalPlaylist: [current, first] };
        }
        manager.installPlaybackSession({
          ...restoredQueue, currentOrdinal: 1, position: 17, duration: 61, repeatMode: 'ALL', shuffleMode: true
        });
        const initial = player.stateManager.getStateSnapshot();
        context.seamlessTransition = async track => {
          context.updateState({
            currentTrack: track, currentTrackName: 'Bulk track',
            currentTrackPosition: 0, currentTrackDuration: 24,
            isPlaying: true, isPaused: false, isStopped: false, playbackMode: 'bufferSource'
          });
          return true;
        };
        context.stop = async () => { calls.push('stop'); };
        context.rebindCurrentPlayback = async () => { calls.push('rebind'); };
        const sequence = makeCatalog('bulk', ['different']);
        await manager.installBulkPlayProvisional({
          receipt: { operationId: 'bulk', provisionalEntry: await sequence.getEntry(0) },
          resolveSource: async () => ({ path: '/different.flac' })
        });
        await manager.publishBulkPlaySequence({ operationId: 'bulk', sequence });
        assert.deepEqual(await manager.undoSessionTransport(), { kind: 'published' });
        await playbackSession.tail;
        const restored = player.stateManager.getStateSnapshot();
        assert.equal(manager.isUnloadedPlaybackSession(restored), true);
        assert.equal(restored.currentTrack.entryInstanceId, initial.currentTrack.entryInstanceId);
        assert.equal(restored.currentTrackName, initial.currentTrackName);
        assert.equal(restored.currentTrackDuration, 61);
        assert.equal(restored.currentTrackPosition, 17);
        assert.equal(restored.playbackMode, initial.playbackMode);
        assert.equal(restored.isPlaying, false);
        assert.equal(restored.isPaused, true);
        assert.equal(context.canSeekCurrentTrack(), true);
        assert.equal(writes.findLast(request => request.action === 'begin').state.position, 17);
        assert.deepEqual(opened, []);
        assert.deepEqual(calls, ['stop']);

        context.loadTrack = async track => {
          calls.push(['load', track.entryInstanceId]);
          context.updateState({ currentTrack: track, currentTrackPosition: 0, currentTrackDuration: 61 });
          return true;
        };
        context.dispatchPlaybackBackend = async (_operation, position) => { calls.push(['seek', position]); };
        context.play = async () => { calls.push('play'); return true; };
        assert.equal(await player.play(), true);
        assert.deepEqual(calls, ['stop', ['load', initial.currentTrack.entryInstanceId], ['seek', 17], 'play']);
        assert.deepEqual(opened, kind === 'catalog' ? [initial.currentTrack.trackUid] : []);
      } finally {
        player.playbackManager.dispose();
        await playbackSession.tail;
      }
    }
  });
});

test('Previous uses the restored position and plays the first occurrence from its beginning at the queue boundary', async () => {
  await withGlobals({ window: {}, document: { addEventListener() {}, removeEventListener() {} } }, async () => {
    for (const { currentOrdinal, position, expectedPath, restart } of [
      { currentOrdinal: 1, position: 3.1, expectedPath: '/second.wav', restart: true },
      { currentOrdinal: 0, position: 1, expectedPath: '/first.wav', restart: true },
      { currentOrdinal: 1, position: 3, expectedPath: '/first.wav', restart: false }
    ]) {
      const playbackSession = makeStore(async () => {});
      const player = new AudioPlayer({ audioContext: {} }, { playbackSession });
      try {
        const context = player.contextManager;
        const calls = [];
        const playlist = [{ name: 'First', path: '/first.wav' }, { name: 'Second', path: '/second.wav' }];
        await player.stateRestored;
        player.resumeAudioContextInGesture = () => true;
        player.playbackManager.installPlaybackSession({
          playlist, originalPlaylist: playlist, currentOrdinal, position, duration: 30,
          repeatMode: 'OFF', shuffleMode: false
        });
        context.loadTrack = async track => { calls.push(['load', track.path]); return true; };
        context.seek = async value => { calls.push(['seek', value]); };
        context.play = async () => { calls.push(['play']); return true; };
        context.transitionToNextTrack = async track => { calls.push(['transition', track.path]); return true; };
        assert.equal(player.audioElement, null);
        assert.equal(await player.playPrevious(), true);
        assert.deepEqual(calls, restart ? [['load', expectedPath], ['play']] : [['transition', expectedPath]]);
      } finally {
        player.playbackManager.dispose();
        await playbackSession.tail;
      }
    }
  });
});

test('seeking after Stop in an unloaded session pauses at the saved position for the next Play', async () => {
  await withGlobals({ window: {}, document: { addEventListener() {}, removeEventListener() {} } }, async () => {
    const writes = [];
    const playbackSession = makeStore(async request => { writes.push(request); });
    const player = new AudioPlayer({ audioContext: {} }, { playbackSession });
    try {
      const context = player.contextManager;
      const track = { name: 'Song', path: '/song.wav' };
      const opened = [];
      await player.stateRestored;
      player.resumeAudioContextInGesture = () => true;
      context.maintainSilentSource = () => {};
      player.playbackManager.installPlaybackSession({
        playlist: [track], originalPlaylist: [track], currentOrdinal: 0,
        position: 7, duration: 30, repeatMode: 'OFF', shuffleMode: false
      });
      await player.stop();
      assert.equal(context.getCurrentState().isStopped, true);
      assert.equal(context.getCurrentState().currentTrackPosition, 0);
      await context.seek(20);
      await playbackSession.tail;
      assert.equal(context.getCurrentState().isPaused, true);
      assert.equal(context.getCurrentState().isStopped, false);
      assert.equal(context.getCurrentState().currentTrackPosition, 20);
      assert.equal(writes.findLast(request => request.state).state.position, 20);
      assert.equal(player.audioElement, null);

      context.loadTrack = async entry => {
        opened.push(entry.path);
        player.audioElement = { currentTime: 0, duration: 30, pause() {} };
        context.updateState({ currentTrack: entry, currentTrackPosition: 0, currentTrackDuration: 30 });
        return true;
      };
      context.play = async () => {
        assert.equal(player.audioElement.currentTime, 20);
        return true;
      };
      assert.equal(await player.play(), true);
      assert.deepEqual(opened, ['/song.wav']);
    } finally {
      player.playbackManager.dispose();
      await playbackSession.tail;
    }
  });
});
