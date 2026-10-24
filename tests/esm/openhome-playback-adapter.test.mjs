import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate as delay } from 'node:timers/promises';
import test from 'node:test';

import {
  OpenHomePlaybackAdapter,
  encodeIdArray
} from '../../js/ui/audio-player/openhome-playback-adapter.js';
import { AudioPlayer } from '../../js/ui/audio-player.js';
import { PlaybackManager } from '../../js/ui/audio-player/playback-manager.js';
import { CatalogSequence } from '../../js/ui/audio-player/playback-sequence.js';
import { NetworkMusicController } from '../../js/network-music/controller.js';
import { playPwaNetworkItems } from '../../js/network-music/pwa-playback-provider.js';

test('OpenHome gateway artwork is allowed by the renderer image policy', async () => {
  const html = await readFile(new URL('../../effetune.html', import.meta.url), 'utf8');
  assert.match(html, /img-src[^;]*http:\/\/127\.0\.0\.1:\*/);
});

function createStateManager(initial = {}) {
  const listeners = new Map();
  const state = {
    currentTrack: null,
    currentTrackDuration: 0,
    currentTrackPosition: 0,
    currentTrackIndex: 0,
    isPaused: false,
    isPlaying: false,
    isPlaybackPending: false,
    isStopped: true,
    isTransitioning: false,
    playlist: [],
    playlistLength: 0,
    repeatMode: 'OFF',
    shuffleMode: false,
    ...initial
  };
  const notify = updates => {
    for (const [key, value] of Object.entries(updates)) {
      for (const callback of listeners.get(key) || []) callback(value, key, 'test');
      for (const callback of listeners.get('*') || []) callback(value, key, 'test');
    }
  };
  return {
    state,
    addListener(key, callback) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(callback);
    },
    removeListener(key, callback) {
      listeners.get(key)?.delete(callback);
    },
    getStateSnapshot() {
      return { ...state };
    },
    getCurrentTrackIndex() {
      return state.currentTrackIndex;
    },
    updateState(updates) {
      Object.assign(state, updates);
      notify(updates);
    },
    updatePlaylist(playlist, currentIndex = 0) {
      const index = playlist.length > 0
        ? Math.max(0, Math.min(currentIndex, playlist.length - 1))
        : 0;
      const updates = {
        playlist: [...playlist],
        playlistLength: playlist.length,
        currentTrackIndex: index,
        currentTrack: playlist[index] || null
      };
      Object.assign(state, updates);
      notify(updates);
    },
    updateCatalogSequence(update) {
      const updates = {
        sequenceKind: 'catalog',
        sequenceId: update.sequenceId,
        playlistLength: update.itemCount,
        currentTrackIndex: update.currentOrdinal,
        currentTrack: update.currentTrack,
        playbackGeneration: update.playbackGeneration
      };
      Object.assign(state, updates);
      notify(updates);
    },
    updateQueueWindow() {
    }
  };
}

function createHarness(initialState = {}, adapterOptions = {}) {
  const calls = [];
  const responses = [];
  const snapshots = [];
  const resetAcks = [];
  const resetEvents = [];
  const stateManager = createStateManager(initialState);
  const playbackManager = {
    playlist: [],
    originalPlaylist: [],
    trackCommandGeneration: 0,
    activePlayRequest: null,
    repeatModeNormalizer: null,
    replaceMaterializedPlaylist(files, currentIndex) {
      calls.push(['replaceMaterializedPlaylist', files.map(track => track.sourceKey), currentIndex]);
      this.playlist = files.map(track => ({ ...track }));
      this.originalPlaylist = this.playlist.map(track => ({ ...track }));
      this.trackCommandGeneration += 1;
      stateManager.updatePlaylist(this.playlist, currentIndex);
    },
    capturePlaybackQueueSnapshot() {
      return {
        playlist: this.playlist.map(track => ({ ...track })),
        originalPlaylist: this.originalPlaylist.map(track => ({ ...track }))
      };
    },
    restorePlaybackQueueSnapshot(snapshot) {
      this.playlist = snapshot.playlist.map(track => ({ ...track }));
      this.originalPlaylist = snapshot.originalPlaylist.map(track => ({ ...track }));
      return true;
    },
    syncPlaylistState(currentIndex) {
      stateManager.updatePlaylist(this.playlist, currentIndex);
    },
    async setShuffleMode(enabled, options) {
      calls.push(['setShuffleMode', enabled, options]);
      stateManager.updateState({ shuffleMode: enabled });
    },
    async selectQueueOrdinal(index, options) {
      calls.push(['selectQueueOrdinal', index, options]);
      stateManager.updatePlaylist(this.playlist, index);
      return { accepted: true };
    },
    async playNext(userInitiated, options) {
      calls.push(['playNext', userInitiated, options]);
      return true;
    },
    async playPrevious(userInitiated, options) {
      calls.push(['playPrevious', userInitiated, options]);
      return true;
    },
    async setRepeatMode(repeatMode) {
      repeatMode = this.repeatModeNormalizer?.(repeatMode) ?? repeatMode;
      calls.push(['setRepeatMode', repeatMode]);
      stateManager.updateState({
        repeatMode,
        ...(repeatMode === 'ONE' ? { shuffleMode: false } : {})
      });
    },
    setRepeatModeNormalizer(normalizer) {
      this.repeatModeNormalizer = normalizer;
      return () => {
        if (this.repeatModeNormalizer === normalizer) this.repeatModeNormalizer = null;
      };
    }
  };
  const audioPlayer = {
    playbackManager,
    playResult: true,
    remoteResumeResult: true,
    stateManager,
    contextManager: {
      async seek(seconds) {
        calls.push(['seek', seconds]);
        stateManager.updateState({ currentTrackPosition: seconds });
      },
      isUsingBufferPlayback() {
        return true;
      },
      getCurrentBufferTime() {
        return stateManager.state.currentTrackPosition;
      },
      async transitionToNextTrack(track, index, userInitiated) {
        calls.push(['transitionToNextTrack', track?.sourceKey, index, userInitiated]);
        if (this.transitionResult === false) return false;
        stateManager.updateState({
          currentTrack: track,
          currentTrackIndex: index,
          currentTrackPosition: 0,
          isPlaying: true,
          isPaused: false,
          isStopped: false
        });
        return true;
      }
    },
    async resumeAudioContextForRemotePlayback() {
      calls.push(['resumeAudioContextForRemotePlayback']);
      return this.remoteResumeResult;
    },
    async play(userInitiated) {
      calls.push(['play', userInitiated]);
      stateManager.updateState({ isPlaying: true, isPaused: false, isStopped: false });
      return this.playResult;
    },
    async pause() {
      calls.push(['pause']);
      stateManager.updateState({ isPlaying: false, isPaused: true, isStopped: false });
    },
    async stop() {
      calls.push(['stop']);
      stateManager.updateState({
        isPlaying: false,
        isPaused: false,
        isStopped: true,
        currentTrackPosition: 0
      });
    },
    async playNext(userInitiated) {
      calls.push(['audioPlayerPlayNext', userInitiated]);
    },
    async playPrevious(userInitiated) {
      calls.push(['audioPlayerPlayPrevious', userInitiated]);
    }
  };
  let actionListener = null;
  let cancelListener = null;
  let resetListener = null;
  const bridge = {
    acceptResponses: true,
    rendererReadyCalls: 0,
    rendererUnavailableCalls: 0,
    rendererReady() {
      this.rendererReadyCalls += 1;
      return Promise.resolve();
    },
    rendererUnavailable() {
      this.rendererUnavailableCalls += 1;
      return Promise.resolve();
    },
    respond(response) {
      responses.push(response);
      return Promise.resolve(this.acceptResponses);
    },
    resetComplete(ack) {
      resetAcks.push(ack);
      resetEvents.push(['ack', ack]);
      return Promise.resolve(true);
    },
    publishState(snapshot) {
      snapshots.push(snapshot);
      resetEvents.push(['publish', snapshot]);
      return Promise.resolve();
    },
    onAction(callback) {
      actionListener = callback;
      return () => { actionListener = null; };
    },
    onCancel(callback) {
      cancelListener = callback;
      return () => { cancelListener = null; };
    },
    onReset(callback) {
      resetListener = callback;
      return () => { resetListener = null; };
    },
    emitAction(action) {
      actionListener({ deadlineEpochMs: Date.now() + 10000, ...action });
    },
    emitCancel(cancel) {
      cancelListener(cancel);
    },
    emitReset(reset) {
      resetListener(reset);
    }
  };
  const adapter = new OpenHomePlaybackAdapter(audioPlayer, {
    bridge,
    domParserCtor: null,
    ...adapterOptions
  });
  return {
    adapter,
    audioPlayer,
    bridge,
    calls,
    resetAcks,
    resetEvents,
    responses,
    snapshots,
    stateManager
  };
}

function createPlaybackManager(audioPlayer) {
  const previousDocument = globalThis.document;
  globalThis.document = previousDocument || { addEventListener() {}, removeEventListener() {} };
  try {
    return new PlaybackManager(audioPlayer);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

function installRealPlaybackManager(harness) {
  harness.adapter.dispose();
  const manager = createPlaybackManager(harness.audioPlayer);
  manager.savePlayerState = () => {};
  harness.audioPlayer.playbackManager = manager;
  harness.adapter = new OpenHomePlaybackAdapter(harness.audioPlayer, {
    bridge: harness.bridge
  });
  return manager;
}

async function runAction(harness, requestId, action, args = {}) {
  harness.bridge.emitAction({ requestId, service: 'Playlist', action, args });
  await harness.adapter.commandChain;
  return harness.responses.at(-1);
}

function captureQueueContract(harness) {
  const snapshot = harness.adapter.getSnapshot();
  return {
    queueIds: harness.adapter.queue.map(track => track.id),
    playlistIds: harness.audioPlayer.playbackManager.playlist.map(track => track.sourceKey),
    originalPlaylistIds: harness.audioPlayer.playbackManager.originalPlaylist.map(track => track.sourceKey),
    shuffleMode: harness.stateManager.state.shuffleMode,
    idArray: snapshot.idArray,
    idArrayToken: snapshot.idArrayToken,
    transportToken: snapshot.transportToken,
    trackToken: snapshot.trackToken,
    detailsToken: snapshot.detailsToken
  };
}

function networkTrack(name) {
  return {
    resources: [{ uri: `http://media.test/${name}.flac`, protocolInfo: 'http-get:*:audio/flac:*' }],
    uri: `http://127.0.0.1:43123/openhome-media/${name}`,
    metadata: `<DIDL-Lite><item><title>${name}</title><res protocolInfo="http-get:*:audio/flac:*">http://media.test/${name}.flac</res></item></DIDL-Lite>`,
    title: name, artist: 'Artist', album: 'Album'
  };
}

test('trusted Catalog action uses one queue owner for local CUE and remote refs in order', async () => {
  const resolved = [];
  const manager = {
    async getTrack(trackUid) { return { trackUid, title: trackUid, artist: 'Local artist', durationSec: 12 }; },
    async resolvePlaybackSource(trackUid) {
      resolved.push(trackUid);
      return { kind: 'electron-file', path: `C:/music/${trackUid}.flac`, sourceKind: 'cue-track', startFrame: 100, endFrame: 200 };
    }
  };
  const harness = createHarness({}, {
    getLibraryManager: async () => manager,
    resolveNetworkTrack: async () => networkTrack('remote')
  });
  const items = [{ serverId: 'local', trackId: 'song' }, { serverId: 'remote', trackId: 'other' },
    { serverId: 'local', trackId: 'song' }];
  harness.bridge.emitAction({ requestId: 'catalog-play', service: 'Catalog', action: 'PlayItems',
    args: { items, operationKind: 'play', startIndex: 2 } });
  await harness.adapter.commandChain;
  assert.equal(harness.responses.at(-1).ok, true);
  assert.equal(harness.adapter.queue.length, 3);
  assert.equal(harness.adapter.getSnapshot().currentId, harness.adapter.queue[2].id);
  assert.deepEqual(harness.adapter.queue.map(entry => entry.playerTrack ? 'local' : 'remote'), ['local', 'remote', 'local']);
  assert.deepEqual(harness.audioPlayer.playbackManager.playlist.map(track => track.libraryTrackId),
    ['song', undefined, 'song']);
  assert.equal(harness.stateManager.state.currentTrack.libraryTrackId, 'song');
  assert.deepEqual(await harness.adapter.queue[0].playerTrack.provider(),
    { kind: 'electron-file', path: 'C:/music/song.flac', sourceKind: 'cue-track', startFrame: 100, endFrame: 200 });
  assert.ok(resolved.length >= 3);
  const plays = harness.calls.filter(call => call[0] === 'play').length;
  harness.bridge.emitAction({ requestId: 'catalog-queue', service: 'Catalog', action: 'PlayItems',
    args: { items: [{ serverId: 'local', trackId: 'next' }], operationKind: 'queue' } });
  await harness.adapter.commandChain;
  assert.equal(harness.responses.at(-1).ok, true);
  assert.equal(harness.adapter.queue.length, 4);
  assert.deepEqual(harness.audioPlayer.playbackManager.playlist.map(track => track.libraryTrackId),
    ['song', undefined, 'song', 'next']);
  assert.equal(harness.stateManager.state.currentTrack.libraryTrackId, 'song');
  assert.equal(harness.calls.filter(call => call[0] === 'play').length, plays);
  harness.adapter.dispose();
});

test('Catalog preparation cancellation leaves the current queue untouched', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const harness = createHarness({}, { getLibraryManager: async () => ({
    async getTrack() { await gate; return { title: 'Late' }; },
    async resolvePlaybackSource() { return { kind: 'electron-file', path: 'C:/music/late.flac' }; }
  }) });
  harness.bridge.emitAction({ requestId: 'catalog-late', service: 'Catalog', action: 'PlayItems',
    args: { items: [{ serverId: 'local', trackId: 'late' }], operationKind: 'play', startIndex: 0 } });
  await delay();
  harness.bridge.emitCancel({ requestId: 'catalog-late' });
  release();
  await harness.adapter.commandChain;
  assert.deepEqual(harness.adapter.queue, []);
  assert.equal(harness.responses.some(response => response.requestId === 'catalog-late' && response.ok === true), false);
  harness.adapter.dispose();
});

test('Catalog source loss reports a definite preflight failure before queue mutation', async () => {
  const harness = createHarness({}, { getLibraryManager: async () => ({ getTrack: async () => null }) });
  harness.bridge.emitAction({ requestId: 'catalog-missing', service: 'Catalog', action: 'PlayItems',
    args: { items: [{ serverId: 'local', trackId: 'missing' }], operationKind: 'play', startIndex: 0 } });
  await harness.adapter.commandChain;
  assert.deepEqual(harness.responses.at(-1).error, { code: 'trackUnavailable', phase: 'preflight' });
  assert.deepEqual(harness.adapter.queue, []);
  harness.adapter.dispose();
});

test('PWA provider tracks join the existing queue without turning streaming URLs into stable track identities', async () => {
  const harness = createHarness();
  const manager = installRealPlaybackManager(harness);
  const provider = name => ({ name, meta: { title: name }, sourceKind: 'pwa-network',
    provider: async () => ({ mediaSource: `http://192.168.1.10:47300/pwa/v1/media/${name.padEnd(16, 'x')}` }) });
  await harness.adapter.playProviderTracks([provider('first'), provider('last')]);
  const firstId = harness.adapter.getSnapshot().currentId;
  await harness.adapter.playProviderTracks([provider('next')], 'playNext');
  assert.deepEqual(manager.playlist.map(track => track.name), ['first', 'next', 'last']);
  assert.equal(harness.adapter.getSnapshot().currentId, firstId);
  assert.ok(harness.adapter.queue.every(track => track.uri === '' && track.playerTrack.provider));
  const resolved = await manager.playlist[1].provider();
  assert.equal(resolved.mediaSource, 'http://192.168.1.10:47300/pwa/v1/media/nextxxxxxxxxxxxx');
  assert.equal(resolved.sourceKey, manager.playlist[1].sourceKey);
  harness.adapter.dispose();
});

function installPwaPlayback(harness, resolveSource) {
  const manager = installRealPlaybackManager(harness);
  const player = harness.audioPlayer;
  player.activateOpenHomePlaybackAdapter = () => harness.adapter;
  player.play = AudioPlayer.prototype.play;
  player.stop = () => manager.stop();
  player.contextManager.stop = async () => harness.stateManager.updateState({ isPlaying: false, isPaused: false, isStopped: true });
  player.contextManager.loadTrack = async (track, index) => {
    harness.calls.push(['loadTrack', track.name]);
    await track.provider?.();
    harness.stateManager.updateState({ currentTrack: track, currentTrackIndex: index });
    return true;
  };
  const transition = player.contextManager.transitionToNextTrack;
  player.contextManager.transitionToNextTrack = async (...args) => {
    await args[0].provider?.();
    return transition.apply(player.contextManager, args);
  };
  player.contextManager.play = async () => {
    harness.calls.push(['activate']);
    harness.stateManager.updateState({ isPlaying: true, isPaused: false, isStopped: false });
    return true;
  };
  const api = {
    playLocalItems: request => playPwaNetworkItems(api, request),
    networkMusicResolveTrack: resolveSource,
    networkMusicGetPlayerState: async () => ({ queue: [] })
  };
  const controller = new NetworkMusicController({ api, uiManager: { audioPlayer: player } });
  return { manager, controller };
}

for (const startIndex of [0, 1]) {
  test(`PWA target changes during initial provider resolution cancel activation and restore the queue at index ${startIndex}`, async () => {
    const harness = createHarness();
    let release;
    let resolving;
    const started = new Promise(resolve => { resolving = resolve; });
    const pendingSource = new Promise(resolve => { release = resolve; });
    const { manager, controller } = installPwaPlayback(harness, async ({ trackId }) => {
      resolving();
      await pendingSource;
      return { uri: `http://192.168.1.10:47300/pwa/v1/media/${trackId.padEnd(16, 'x')}` };
    });
    harness.adapter.followsPlayerQueue = true;
    manager.replaceMaterializedPlaylist([{ name: 'Previous queue', sourceKey: 'previous' }], 0);
    await harness.adapter.commandChain;
    const previous = captureQueueContract(harness);
    try {
      const pending = controller.playItems(['first', 'second'].map(trackId => ({ serverId: 'a', trackId, title: trackId })), 'play', startIndex);
      const rejected = assert.rejects(pending, { code: 'action-cancelled' });
      await started;
      controller.selectPlayer('other-player');
      release();
      await rejected;
      await harness.adapter.commandChain;
      assert.equal(harness.calls.some(([name]) => name === 'activate'), false);
      assert.equal(harness.stateManager.state.isPlaying, false);
      assert.equal(harness.stateManager.state.currentTrack.name, 'Previous queue');
      assert.deepEqual(captureQueueContract(harness), previous);
      assert.equal(manager.activePlayRequest, null);
    } finally { controller.dispose(); harness.adapter.dispose(); }
  });
}

test('started PWA playback and its next provider remain independent of later target selection', async () => {
  const harness = createHarness();
  const resolved = [];
  const { manager, controller } = installPwaPlayback(harness, async ({ trackId }) => {
    resolved.push(trackId);
    return { uri: `http://192.168.1.10:47300/pwa/v1/media/${trackId.padEnd(16, 'x')}` };
  });
  try {
    assert.deepEqual(await controller.playItems(['first', 'second'].map(trackId => ({ serverId: 'a', trackId, title: trackId }))), { accepted: true });
    controller.selectPlayer('other-player');
    assert.equal(harness.stateManager.state.isPlaying, true);
    assert.equal(harness.stateManager.state.currentTrack.name, 'first');
    assert.equal(await manager.playNext(false, { forceQueueMove: true }), true);
    assert.equal(harness.stateManager.state.isPlaying, true);
    assert.equal(harness.stateManager.state.currentTrack.name, 'second');
    assert.deepEqual(resolved, ['first', 'second']);
  } finally { controller.dispose(); harness.adapter.dispose(); }
});

test('local network playback replaces the exported queue and all controllers observe and control the same stable IDs', async () => {
  const harness = createHarness();
  const manager = installRealPlaybackManager(harness);
  harness.adapter.nextTrackId = 7;
  await runAction(harness, 'old-network-queue', 'Insert', {
    uri: 'http://media.test/old.flac', playbackUrl: 'http://127.0.0.1:43123/openhome-media/old', metadata: 'old'
  });
  harness.audioPlayer.activateOpenHomePlaybackAdapter = () => harness.adapter;
  const controller = new NetworkMusicController({
    api: { networkMusicResolveTrack: async ({ trackId }) => networkTrack(trackId) },
    uiManager: { audioPlayer: harness.audioPlayer }
  });
  await controller.playItems([{ serverId: 'server-a', trackId: 'new' }]);
  const firstId = harness.adapter.getSnapshot().currentId;
  assert.notEqual(firstId, 0);
  assert.notEqual(firstId, 7);
  assert.equal(harness.adapter.getSnapshot().uri, networkTrack('new').resources[0].uri);
  assert.equal(harness.adapter.getSnapshot().metadata, networkTrack('new').metadata);
  assert.equal(harness.adapter.getSnapshot().transportState, 'Playing');
  assert.equal(harness.adapter.getSnapshot().idArray, encodeIdArray([firstId]));
  await controller.playItems([{ serverId: 'server-b', trackId: 'last' }], 'queue');
  await controller.playItems([{ serverId: 'server-c', trackId: 'next' }], 'playNext');
  const queue = harness.adapter.queue;
  assert.deepEqual(queue.map(entry => entry.uri), ['new', 'next', 'last'].map(name => networkTrack(name).resources[0].uri));
  assert.equal(harness.adapter.getSnapshot().currentId, firstId);
  assert.equal((await runAction(harness, 'read-network', 'Read', { id: firstId })).result.metadata, networkTrack('new').metadata);
  assert.equal((await runAction(harness, 'next-network', 'Next')).ok, true);
  assert.equal(harness.adapter.getSnapshot().currentId, queue[1].id);
  assert.equal(manager.playlist[harness.stateManager.state.currentTrackIndex].path, networkTrack('next').uri);
  assert.equal((await runAction(harness, 'play-network', 'Play')).ok, true);
  assert.equal((await runAction(harness, 'read-obsolete', 'Read', { id: 7 })).ok, false);
  harness.adapter.dispose();
});

test('local network playback starts at the requested repeated occurrence in the original queue order', async () => {
  const harness = createHarness();
  const manager = installRealPlaybackManager(harness);
  harness.audioPlayer.contextManager.loadTrack = async (track, index) => {
    harness.calls.push(['loadTrack', track.sourceKey]);
    harness.stateManager.updateState({ currentTrack: track, currentTrackIndex: index, currentTrackPosition: 0 });
    return true;
  };
  harness.audioPlayer.contextManager.play = () => harness.audioPlayer.play(false);
  harness.audioPlayer.activateOpenHomePlaybackAdapter = () => harness.adapter;
  const controller = new NetworkMusicController({
    api: { networkMusicResolveTrack: async ({ trackId }) => networkTrack(trackId) },
    uiManager: { audioPlayer: harness.audioPlayer }
  });
  try {
    const items = ['same', 'middle', 'same', 'last'].map(trackId => ({ serverId: 'server', trackId }));
    await controller.playItems(items, 'play', 2);
    const queue = harness.adapter.queue;
    assert.deepEqual(queue.map(entry => entry.meta.title), ['same', 'middle', 'same', 'last']);
    assert.notEqual(queue[0].id, queue[2].id);
    assert.equal(harness.adapter.getSnapshot().currentId, queue[2].id);
    assert.equal(harness.adapter.getSnapshot().transportState, 'Playing');
    assert.equal(manager.playlist[harness.stateManager.state.currentTrackIndex].sourceKey, `openhome:${queue[2].id}`);
    assert.deepEqual(harness.calls.filter(([action]) => action === 'loadTrack'), [['loadTrack', `openhome:${queue[2].id}`]]);
    assert.equal((await runAction(harness, 'next-after-occurrence', 'Next')).ok, true);
    assert.equal(harness.adapter.getSnapshot().currentId, queue[3].id);
    const before = captureQueueContract(harness);
    for (const startIndex of [-1, 4, 1.5]) {
      await assert.rejects(controller.playItems(items, 'play', startIndex), { code: 'invalid-index' });
      assert.deepEqual(captureQueueContract(harness), before);
    }
  } finally { harness.adapter.dispose(); }
});

test('network append imports a paused local catalog queue without publishing its private sources or restarting playback', async () => {
  const harness = createHarness();
  const manager = installRealPlaybackManager(harness);
  const resolutions = [];
  const sequence = new CatalogSequence({
    sequenceId: 'local-private-queue', itemCount: 2,
    readPage: async () => [{ trackUid: 'private-1', title: 'First & local' }, { trackUid: 'private-2', title: 'Second local' }],
    resolveSource: async ({ trackUid }) => { resolutions.push(trackUid); return { path: `C:/private/${trackUid}.flac`, kind: 'electron-file' }; }
  });
  const currentTrack = { ...await sequence.getEntry(0), path: 'C:/private/private-1.flac', meta: { title: 'First & local' }, sourceKind: 'electron-file' };
  manager.installCatalogSequence(sequence, { currentOrdinal: 0, currentTrack, resolvedEntries: new Map([[0, currentTrack]]) });
  harness.stateManager.updateState({ isPaused: true, isStopped: false, currentTrackPosition: 37 });
  const callStart = harness.calls.length;
  await harness.adapter.playNetworkTracks([networkTrack('added')], 'playNext');
  assert.equal(harness.stateManager.state.isPaused, true);
  assert.equal(harness.stateManager.state.currentTrackPosition, 37);
  assert.equal(harness.calls.slice(callStart).some(([name]) => ['play', 'pause', 'stop'].includes(name)), false);
  assert.deepEqual(harness.adapter.queue.map(entry => entry.meta.title), ['First & local', 'added', 'Second local']);
  const localId = harness.adapter.getSnapshot().currentId;
  const read = (await runAction(harness, 'read-private', 'Read', { id: localId })).result;
  assert.equal(read.uri, '');
  assert.match(read.metadata, /First &amp; local/);
  assert.doesNotMatch(read.metadata, /private-|C:|<res/);
  assert.deepEqual(resolutions, [], 'catalog sources are resolved only when played');
  const source = await manager.playlist[2].provider();
  assert.equal(source.path, 'C:/private/private-2.flac');
  assert.equal(source.sourceKey, `openhome:${harness.adapter.queue[2].id}`);
  assert.equal((await runAction(harness, 'next-mixed', 'Next')).ok, true);
  assert.equal(harness.adapter.getSnapshot().uri, networkTrack('added').resources[0].uri);
  assert.equal((await runAction(harness, 'delete-mixed', 'DeleteId', { id: harness.adapter.queue[2].id })).ok, true);
  assert.equal(harness.adapter.queue[0].id, localId);
  harness.adapter.dispose();
});

test('network queue import rejects the existing OpenHome size limit before reading or changing a local queue', async () => {
  const harness = createHarness();
  const manager = installRealPlaybackManager(harness);
  const sequence = new CatalogSequence({
    sequenceId: 'large-local-queue', itemCount: 4096,
    readPage: async ({ startOrdinal, limit }) => Array.from({ length: limit }, (_, index) => ({ trackUid: `local-${startOrdinal + index}` })),
    resolveSource: async () => { assert.fail('size validation must not access a source'); }
  });
  manager.installCatalogSequence(sequence, { currentTrack: { name: 'Current' } });
  const callStart = harness.calls.length;
  await assert.rejects(harness.adapter.playNetworkTracks([networkTrack('overflow')], 'queue'), { code: 'queue-full' });
  assert.equal(manager.catalogSequence, sequence);
  assert.equal(harness.adapter.queue.length, 0);
  assert.equal(harness.calls.length, callStart);
  harness.adapter.dispose();
});

test('local network queue waits for renderer registration and its reset before taking ownership', async () => {
  const harness = createHarness();
  harness.adapter.dispose();
  let finishRegistration;
  harness.bridge.rendererReady = () => new Promise(resolve => { finishRegistration = resolve; });
  harness.adapter = new OpenHomePlaybackAdapter(harness.audioPlayer, { bridge: harness.bridge });
  const operation = harness.adapter.playNetworkTracks([networkTrack('after-ready')]);
  harness.bridge.emitReset({ resetId: 'initial-reset' });
  await harness.adapter.commandChain;
  assert.equal(harness.adapter.queue.length, 0);
  assert.deepEqual(harness.resetAcks.at(-1), { resetId: 'initial-reset', ok: true });
  finishRegistration();
  await operation;
  assert.equal(harness.adapter.getSnapshot().uri, networkTrack('after-ready').resources[0].uri);
  assert.equal(harness.adapter.getSnapshot().transportState, 'Playing');
  harness.adapter.dispose();
});

for (const [queueOrigin, operationKind] of [
  ['local', 'queue'], ['local', 'playNext'], ['incoming', 'queue'], ['incoming', 'playNext'],
  ['incoming-local-play', 'queue'], ['incoming-stopped-seek', 'queue']
]) {
  test(`ordinary catalog ${operationKind} joins the ${queueOrigin} network queue for external observation and transport`, async () => {
    const harness = createHarness();
    const manager = installRealPlaybackManager(harness);
    if (queueOrigin === 'local') {
      await harness.adapter.playNetworkTracks([networkTrack('first'), networkTrack('tail')]);
    } else {
      let afterId = 0;
      for (const name of ['first', 'tail']) {
        const track = networkTrack(name);
        const response = await runAction(harness, `insert-${name}`, 'Insert', {
          afterId, uri: track.resources[0].uri, playbackUrl: track.uri, metadata: track.metadata
        });
        assert.equal(response.ok, true);
        afterId = response.result.newId;
      }
      if (queueOrigin === 'incoming-local-play') {
        assert.equal(await harness.audioPlayer.play(true), true);
      } else if (queueOrigin === 'incoming-stopped-seek') {
        assert.equal((await runAction(harness, 'seek-incoming', 'SeekSecondAbsolute', { seconds: 11 })).ok, true);
      } else {
        assert.equal((await runAction(harness, 'start-incoming', 'Play')).ok, true);
      }
    }
    const originalIds = harness.adapter.queue.map(entry => entry.id);
    const firstTrack = harness.stateManager.state.currentTrack;
    harness.stateManager.updateState({ isPlaying: false, isPaused: true, currentTrackPosition: 29 });
    const sequence = new CatalogSequence({
      sequenceId: `local-after-network-${operationKind}`, itemCount: 1,
      readPage: async () => [{ trackUid: 'private-local', title: 'Local song' }],
      resolveSource: async () => ({ path: 'C:/private/local.flac', kind: 'electron-file' })
    });
    const callStart = harness.calls.length;
    await manager.commitCatalogDestination({ operationId: `append-${operationKind}`, operationKind, sequence });
    const actualSequence = manager.sequence;
    const response = await runAction(harness, `readlist-${operationKind}`, 'ReadList', {
      idList: [originalIds[0], originalIds[1], originalIds[1] + 1]
    });
    assert.equal(response.ok, true);
    assert.equal(response.result.tracks.length, 3);
    assert.equal(manager.sequence, actualSequence, 'export mirrors the catalog without replacing its playback sequence');
    assert.equal(harness.stateManager.state.currentTrack, firstTrack);
    assert.equal(harness.stateManager.state.isPaused, true);
    assert.equal(harness.stateManager.state.currentTrackPosition, 29);
    assert.equal(harness.calls.slice(callStart).some(([name]) => ['play', 'stop', 'pause'].includes(name)), false);
    assert.equal(harness.adapter.playerOwnsRemoteQueue(), true);
    const localEntry = harness.adapter.queue.find(entry => entry.meta.title === 'Local song');
    assert.equal(localEntry.uri, '');
    assert.doesNotMatch(localEntry.metadata, /C:|<res|private-local/);
    assert.deepEqual(harness.adapter.queue.filter(entry => entry.uri).map(entry => entry.id), originalIds);
    assert.equal(harness.adapter.getSnapshot().currentId, originalIds[0]);
    assert.equal((await runAction(harness, `play-${operationKind}`, 'Play')).ok, true);
    assert.equal((await runAction(harness, `next-${operationKind}`, 'Next')).ok, true);
    if (operationKind === 'queue') assert.equal((await runAction(harness, 'next-local-tail', 'Next')).ok, true);
    assert.equal(harness.adapter.getSnapshot().currentId, localEntry.id);
    assert.equal(harness.stateManager.state.currentTrack.path, 'C:/private/local.flac');
    assert.equal(manager.sequence, actualSequence);
    harness.adapter.dispose();
    assert.equal(manager.queueChangeListener, null);
  });
}

test('trusted local control observes and controls the first ordinary Player queue without replacing it', async t => {
  const harness = createHarness();
  const manager = installRealPlaybackManager(harness);
  t.after(() => harness.adapter.dispose());
  manager.loadFiles([
    { path: 'C:/private/first.flac', meta: { title: 'First' } },
    { path: 'C:/private/second.flac', meta: { title: 'Second' } }
  ]);
  harness.stateManager.updateState({ currentTrack: manager.playlist[0], currentTrackIndex: 0,
    isPlaying: true, isStopped: false, currentTrackDuration: 90 });
  const sequence = manager.sequence;
  const paths = manager.playlist.map(track => track.path);
  const act = async (action, args = {}) => {
    harness.bridge.emitAction({ requestId: `local-${action}`, service: 'Playlist', action, args, localControl: true });
    await harness.adapter.commandChain;
    const response = harness.responses.at(-1);
    assert.equal(response.ok, true, action);
    return response.result;
  };
  const snapshot = await act('Snapshot');
  assert.deepEqual(harness.adapter.queue.map(entry => entry.meta.title), ['First', 'Second']);
  assert.notEqual(snapshot.currentId, 0);
  assert.notEqual(snapshot.idArray, '');
  assert.equal(manager.sequence, sequence);
  await manager.setRepeatMode('ONE');
  assert.equal(harness.stateManager.state.repeatMode, 'ONE');
  await manager.setRepeatMode('OFF');
  harness.stateManager.updateState({ currentTrackPosition: 7 });
  harness.bridge.emitReset({ resetId: 'reset-after-observation' });
  await harness.adapter.commandChain;
  assert.equal(manager.sequence, sequence);
  assert.deepEqual(manager.playlist.map(track => track.path), paths);
  assert.equal(harness.stateManager.state.isPlaying, true);
  assert.equal(harness.stateManager.state.currentTrackPosition, 7);
  await act('Snapshot');
  await act('Pause');
  assert.equal(harness.adapter.getSnapshot().transportState, 'Paused');
  await act('Play');
  assert.equal(harness.adapter.getSnapshot().transportState, 'Playing');
  await act('Next');
  assert.equal(harness.stateManager.state.currentTrack.path, paths[1]);
  await act('SeekSecondAbsolute', { seconds: 12 });
  assert.equal(harness.stateManager.state.currentTrackPosition, 12);
  assert.deepEqual(manager.playlist.map(track => track.path), paths);
  assert.equal(manager.sequence, sequence);
  manager.loadFiles([{ path: 'C:/private/replacement.flac', meta: { title: 'Replacement' } }]);
  harness.stateManager.updateState({ currentTrack: manager.playlist[0], currentTrackIndex: 0,
    isPlaying: true, isStopped: false, currentTrackPosition: 17 });
  await harness.adapter.commandChain;
  const replacementSequence = manager.sequence;
  harness.bridge.emitReset({ resetId: 'reset-after-replacement' });
  await harness.adapter.commandChain;
  assert.equal(manager.sequence, replacementSequence);
  harness.adapter.dispose();
  assert.equal(harness.stateManager.state.isPlaying, true);
  assert.equal(harness.stateManager.state.currentTrackPosition, 17);
  assert.deepEqual(manager.playlist.map(track => track.path), ['C:/private/replacement.flac']);
});

test('trusted local observation preserves an incoming OpenHome queue while ordinary Player playback owns transport', async t => {
  const harness = createHarness();
  const manager = installRealPlaybackManager(harness);
  t.after(() => harness.adapter.dispose());
  await runAction(harness, 'staged-incoming', 'Insert', {
    afterId: 0, uri: 'http://media.test/incoming.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/34343434343434343434343434343434', metadata: ''
  });
  const pendingIds = harness.adapter.getSnapshot().idArray;
  manager.loadFiles([{ path: 'C:/private/ordinary.flac', meta: { title: 'Ordinary' } }]);
  harness.stateManager.updateState({ currentTrack: manager.playlist[0], currentTrackIndex: 0,
    isPlaying: true, isStopped: false });
  const sequence = manager.sequence;
  harness.bridge.emitAction({ requestId: 'observe-staged', service: 'Playlist', action: 'Snapshot', args: {}, localControl: true });
  await harness.adapter.commandChain;
  assert.equal(harness.responses.at(-1).ok, true);
  assert.equal(harness.responses.at(-1).result.idArray, pendingIds);
  assert.equal(harness.adapter.queue[0].uri, 'http://media.test/incoming.flac');
  assert.equal(harness.adapter.followsPlayerQueue, false);
  assert.equal(manager.sequence, sequence);
  assert.equal(manager.playlist[0].path, 'C:/private/ordinary.flac');
});

test('the shared sequence boundary mirrors ordinary file append, replacement, shuffle and clear', async () => {
  const harness = createHarness();
  const manager = installRealPlaybackManager(harness);
  await harness.adapter.playNetworkTracks([networkTrack('network')]);
  const networkId = harness.adapter.queue[0].id;
  const originalQueue = manager.capturePlaybackQueueSnapshot();
  manager.loadFiles([{ path: 'C:/private/added.flac', meta: { title: 'Added local' } }], true);
  await harness.adapter.commandChain;
  assert.deepEqual(harness.adapter.queue.map(entry => entry.meta.title), ['network', 'Added local']);
  assert.equal(harness.adapter.queue[0].id, networkId);
  const ids = harness.adapter.queue.map(entry => entry.id);
  await manager.setShuffleMode(true, { preserveTransport: true, userInitiated: false });
  await harness.adapter.commandChain;
  assert.deepEqual(harness.adapter.queue.map(entry => entry.id), ids, 'shuffle retains canonical queue IDs and order');
  manager.replaceMaterializedPlaylist([{ path: 'C:/private/replaced.flac', meta: { title: 'Replacement' } }]);
  await harness.adapter.commandChain;
  assert.equal(harness.adapter.queue.length, 1);
  assert.equal(harness.adapter.queue[0].meta.title, 'Replacement');
  assert.notEqual(harness.adapter.queue[0].id, networkId);
  manager.restorePlaybackQueueSnapshot(originalQueue);
  manager.syncPlaylistState(0);
  await harness.adapter.commandChain;
  assert.equal(harness.adapter.queue[0].id, networkId);
  assert.equal(harness.adapter.queue[0].uri, networkTrack('network').resources[0].uri);
  assert.equal(harness.adapter.queue[0].metadata, networkTrack('network').metadata);
  harness.audioPlayer.contextManager.clearNextTrackBuffer = () => {};
  manager.clear();
  await harness.adapter.commandChain;
  assert.equal(harness.adapter.queue.length, 0);
  assert.equal(harness.adapter.getSnapshot().idArray, '');
  assert.equal((await runAction(harness, 'next-empty-shared', 'Next')).ok, false);
  assert.equal(manager.sequence.itemCount, 0);
  harness.adapter.dispose();
});

test('catalog projection waits to publish and leaves oversized local queues intact', async () => {
  const harness = createHarness();
  const manager = installRealPlaybackManager(harness);
  await harness.adapter.playNetworkTracks([networkTrack('before-projection')]);
  let finishPage;
  const page = new Promise(resolve => { finishPage = resolve; });
  const pendingSequence = new CatalogSequence({
    sequenceId: 'delayed-local', itemCount: 1, readPage: () => page,
    resolveSource: async () => ({ path: 'C:/private/delayed.flac' })
  });
  const snapshotsBefore = harness.snapshots.length;
  const next = runAction(harness, 'next-queued-before-projection', 'Next');
  await manager.commitCatalogDestination({ operationId: 'delayed-append', operationKind: 'queue', sequence: pendingSequence });
  await delay();
  assert.equal(harness.snapshots.length, snapshotsBefore, 'no stale queue state is published while entries are pending');
  finishPage([{ trackUid: 'delayed', title: 'Delayed local' }]);
  assert.equal((await next).ok, true);
  assert.equal(harness.stateManager.state.currentTrack.path, 'C:/private/delayed.flac');
  await harness.adapter.commandChain;
  assert.equal(harness.adapter.queue.length, 2);
  assert.equal(harness.snapshots.at(-1).idArray, encodeIdArray(harness.adapter.queue.map(entry => entry.id)));
  const largeSequence = new CatalogSequence({
    sequenceId: 'too-large-to-export', itemCount: 4097,
    readPage: async ({ limit }) => Array.from({ length: limit }, (_, index) => ({ trackUid: `large-${index}` })),
    resolveSource: async () => ({ path: 'C:/private/large.flac' })
  });
  manager.installCatalogSequence(largeSequence, { currentTrack: harness.stateManager.state.currentTrack });
  await harness.adapter.commandChain;
  assert.equal(harness.adapter.getSnapshot().idArray, '');
  assert.equal(harness.adapter.getSnapshot().currentId, 0);
  assert.deepEqual((await runAction(harness, 'next-too-large', 'Next')).error, { code: 'queue-full' });
  assert.equal(manager.sequence, largeSequence);
  assert.equal(manager.sequence.itemCount, 4097);
  manager.replaceMaterializedPlaylist([{ path: 'C:/private/recovered.flac', name: 'Recovered' }]);
  await harness.adapter.commandChain;
  assert.equal(harness.adapter.queue.length, 1);
  assert.equal(harness.adapter.queueProjectionError, null);
  harness.adapter.dispose();
});

test('OpenHome adapter invokes its state publisher scheduler without a receiver binding', async () => {
  let schedulerReceiver = null;
  let scheduledCallback = null;
  const harness = createHarness({}, {
    schedule: function schedule(callback) {
      schedulerReceiver = this;
      scheduledCallback = callback;
    }
  });
  await delay();
  const snapshotCount = harness.snapshots.length;

  harness.stateManager.updateState({ isPlaying: true, isStopped: false });

  assert.equal(schedulerReceiver, undefined);
  assert.equal(typeof scheduledCallback, 'function');
  scheduledCallback();
  assert.equal(harness.snapshots.length, snapshotCount + 1);
  assert.equal(harness.snapshots.at(-1).transportState, 'Playing');
  harness.adapter.dispose();
});

test('remote playback uses explicit power activation instead of automatic playback resume', async () => {
  const calls = [];
  const player = {
    audioManager: {
      powerPolicyController: {
        enabled: true,
        ensureActive(resumeKind) {
          calls.push(resumeKind);
          return Promise.resolve(true);
        }
      }
    },
    contextManager: {
      getPlaybackResumeKind() {
        return 'player-only-play';
      }
    }
  };

  const resumed = await AudioPlayer.prototype.resumeAudioContextForRemotePlayback.call(player);

  assert.equal(resumed, true);
  assert.deepEqual(calls, ['player-only-play']);
});

test('OpenHome adapter keeps stable uint32 queue IDs and publishes an atomic IdArray', async () => {
  const harness = createHarness();
  await delay();

  assert.deepEqual(await runAction(harness, 'insert-1', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/one.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    metadata: ''
  }), { requestId: 'insert-1', ok: true, result: { newId: 1 } });
  assert.deepEqual(await runAction(harness, 'insert-2', 'Insert', {
    afterId: 1,
    uri: 'https://media.test/two.mp3',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    artworkUrl: 'http://127.0.0.1:43123/openhome-media/dddddddddddddddddddddddddddddddd',
    metadata: '<DIDL-Lite><item><title>Two</title></item></DIDL-Lite>'
  }), { requestId: 'insert-2', ok: true, result: { newId: 2 } });

  const idArray = await runAction(harness, 'ids', 'IdArray');
  assert.deepEqual(idArray.result, { token: 2, array: encodeIdArray([1, 2]) });
  assert.deepEqual((await runAction(harness, 'read', 'Read', { id: 2 })).result, {
    id: 2,
    uri: 'https://media.test/two.mp3',
    metadata: '<DIDL-Lite><item><title>Two</title></item></DIDL-Lite>'
  });
  assert.equal(harness.audioPlayer.playbackManager.playlist[0].path.startsWith('http://127.0.0.1:'), true);
  assert.equal(harness.audioPlayer.playbackManager.playlist.some(track => track.path === 'https://media.test/two.mp3'), false);
  assert.equal(
    harness.audioPlayer.playbackManager.playlist[1].meta.artworkUrl,
    'http://127.0.0.1:43123/openhome-media/dddddddddddddddddddddddddddddddd'
  );

  await runAction(harness, 'delete', 'DeleteId', { id: 1 });
  assert.deepEqual((await runAction(harness, 'ids-2', 'IdArray')).result, {
    token: 3,
    array: encodeIdArray([2])
  });
  assert.deepEqual((await runAction(harness, 'insert-3', 'Insert', {
    afterId: 2,
    uri: 'http://media.test/three.wav',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/cccccccccccccccccccccccccccccccc',
    metadata: ''
  })).result, { newId: 3 });
  harness.adapter.dispose();
});

test('OpenHome ReadList preserves valid order while skipping stale IDs', async () => {
  const harness = createHarness();
  await runAction(harness, 'insert-1', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/one.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/11111111111111111111111111111111',
    metadata: 'one'
  });
  await runAction(harness, 'insert-2', 'Insert', {
    afterId: 1,
    uri: 'http://media.test/two.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/22222222222222222222222222222222',
    metadata: 'two'
  });

  const mixed = await runAction(harness, 'read-list-mixed', 'ReadList', {
    idList: '2, 99\n1'
  });
  assert.deepEqual(mixed.result.tracks.map(track => track.id), [2, 1]);
  assert.deepEqual((await runAction(harness, 'read-list-stale', 'ReadList', {
    idList: '98 99'
  })).result, { tracks: [] });

  const malformed = await runAction(harness, 'read-list-malformed', 'ReadList', {
    idList: '1 invalid 2'
  });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, 'invalid-id');
  const tooMany = await runAction(harness, 'read-list-too-many', 'ReadList', {
    idList: Array.from({ length: 4097 }, () => 1)
  });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.error.code, 'invalid-id-list');
  const staleRead = await runAction(harness, 'read-stale', 'Read', { id: 99 });
  assert.equal(staleRead.ok, false);
  assert.equal(staleRead.error.code, 'track-not-found');
  harness.adapter.dispose();
});

test('OpenHome ReadList rejects a UTF-8 response that exceeds the protocol frame budget', async () => {
  const harness = createHarness();
  const metadata = '界'.repeat(23000);
  await runAction(harness, 'large-read-insert-1', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/large-one.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/56565656565656565656565656565601',
    metadata
  });
  await runAction(harness, 'large-read-insert-2', 'Insert', {
    afterId: 1,
    uri: 'http://media.test/large-two.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/56565656565656565656565656565602',
    metadata
  });

  assert.equal((await runAction(harness, 'large-read-one', 'ReadList', {
    idList: [1]
  })).ok, true);
  assert.deepEqual(await runAction(harness, 'large-read-overflow', 'ReadList', {
    idList: [1, 2]
  }), {
    requestId: 'large-read-overflow',
    ok: false,
    error: { code: 'response-too-large' }
  });
  harness.adapter.dispose();
});

test('OpenHome SeekId starts the selected track from a stopped transport', async () => {
  const harness = createHarness({ isPlaying: false, isPaused: false, isStopped: true });
  await runAction(harness, 'insert-1', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/one.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/eeeeeeeeeeeeeeeeeeeeeeeeeeeeee01',
    metadata: ''
  });
  await runAction(harness, 'insert-2', 'Insert', {
    afterId: 1,
    uri: 'http://media.test/two.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/eeeeeeeeeeeeeeeeeeeeeeeeeeeeee02',
    metadata: ''
  });

  assert.deepEqual(await runAction(harness, 'seek-id', 'SeekId', { id: 2 }), {
    requestId: 'seek-id', ok: true, result: {}
  });
  assert.ok(harness.calls.some(([name]) => name === 'resumeAudioContextForRemotePlayback'));
  assert.deepEqual(
    harness.calls.findLast(([name]) => name === 'selectQueueOrdinal'),
    ['selectQueueOrdinal', 1, { play: true, userInitiated: false, playbackReady: true }]
  );
  harness.adapter.dispose();
});

test('OpenHome adapter maps transport actions to non-user player commands and normalizes Repeat ONE', async () => {
  const harness = createHarness({ repeatMode: 'ONE' });
  harness.audioPlayer.ui = {
    container: null,
    createPlayerUI() {
      harness.calls.push(['createPlayerUI']);
      this.container = {};
    }
  };
  await runAction(harness, 'insert', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/one.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/dddddddddddddddddddddddddddddddd',
    metadata: ''
  });

  await runAction(harness, 'play', 'Play');
  await runAction(harness, 'next', 'Next');
  await runAction(harness, 'previous', 'Previous');
  harness.stateManager.updateState({ currentTrackPosition: 10 });
  await runAction(harness, 'seek', 'SeekSecondRelative', { seconds: -3 });
  await runAction(harness, 'shuffle', 'SetShuffle', { shuffle: true });

  assert.ok(harness.calls.some(call => call[0] === 'play' && call[1] === false));
  assert.ok(harness.calls.some(call => call[0] === 'resumeAudioContextForRemotePlayback'));
  assert.equal(harness.calls.filter(call => call[0] === 'createPlayerUI').length, 1);
  assert.ok(harness.calls.some(call => call[0] === 'playNext' && call[1] === false));
  assert.ok(harness.calls.some(call => call[0] === 'playPrevious' && call[1] === false));
  assert.ok(harness.calls.some(call => call[0] === 'seek' && call[1] === 7));
  assert.ok(harness.calls.some(call => call[0] === 'setShuffleMode' && call[1] === true &&
    call[2]?.userInitiated === false && call[2]?.preserveTransport === true));
  assert.ok(harness.calls.some(call => call[0] === 'setRepeatMode' && call[1] === 'ALL'));
  assert.equal(harness.stateManager.state.repeatMode, 'ALL');
  assert.equal(harness.stateManager.state.shuffleMode, true);
  harness.adapter.dispose();
  await delay();
  assert.equal(harness.bridge.rendererUnavailableCalls, 1);
});

test('OpenHome shuffle and shuffled queue mutations preserve the active entry and transport', async () => {
  const harness = createHarness();
  await runAction(harness, 'preserve-insert-1', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/one.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/12121212121212121212121212121201',
    metadata: 'one'
  });
  await runAction(harness, 'preserve-insert-2', 'Insert', {
    afterId: 1,
    uri: 'http://media.test/two.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/12121212121212121212121212121202',
    metadata: 'two'
  });
  harness.stateManager.updateState({
    currentTrackIndex: 1,
    currentTrack: harness.audioPlayer.playbackManager.playlist[1],
    currentTrackPosition: 37,
    isPlaying: true,
    isPaused: false,
    isStopped: false
  });

  await runAction(harness, 'preserve-shuffle', 'SetShuffle', { shuffle: true });
  assert.equal(harness.adapter.getSnapshot().currentId, 2);
  assert.equal(harness.stateManager.state.currentTrackPosition, 37);
  assert.equal(harness.stateManager.state.isPlaying, true);

  await runAction(harness, 'preserve-insert-3', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/three.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/12121212121212121212121212121203',
    metadata: 'three'
  });
  assert.equal(harness.adapter.getSnapshot().currentId, 2);
  assert.equal(harness.stateManager.state.currentTrackPosition, 37);
  assert.equal(harness.stateManager.state.isPlaying, true);

  harness.stateManager.updateState({
    currentTrackPosition: 41,
    isPlaying: false,
    isPaused: true,
    isStopped: false
  });
  await runAction(harness, 'preserve-delete-1', 'DeleteId', { id: 1 });
  assert.equal(harness.adapter.getSnapshot().currentId, 2);
  assert.equal(harness.stateManager.state.currentTrackPosition, 41);
  assert.equal(harness.stateManager.state.isPlaying, false);
  assert.equal(harness.stateManager.state.isPaused, true);
  assert.ok(harness.calls.filter(call => call[0] === 'setShuffleMode').every(call =>
    call[2]?.userInitiated === false && call[2]?.preserveTransport === true));
  harness.adapter.dispose();
});

test('OpenHome mutations stop a playing or paused local source before installing the retained remote queue', async () => {
  const harness = createHarness();
  const manager = installRealPlaybackManager(harness);
  await runAction(harness, 'ownership-insert-1', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/remote-one.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/78787878787878787878787878787801',
    metadata: 'remote one'
  });
  await runAction(harness, 'ownership-insert-2', 'Insert', {
    afterId: 1,
    uri: 'http://media.test/remote-two.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/78787878787878787878787878787802',
    metadata: 'remote two'
  });

  const installLocalSource = transport => {
    manager.replaceMaterializedPlaylist([{
      path: 'local.flac', name: 'Local', sourceKind: 'local', sourceKey: 'local:owned'
    }], 0);
    harness.stateManager.updateState({
      currentTrackPosition: 19,
      isPlaying: transport === 'playing',
      isPaused: transport === 'paused',
      isStopped: false
    });
  };

  installLocalSource('playing');
  let stopCount = harness.calls.filter(([name]) => name === 'stop').length;
  await runAction(harness, 'ownership-insert-3', 'Insert', {
    afterId: 2,
    uri: 'http://media.test/remote-three.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/78787878787878787878787878787803',
    metadata: 'remote three'
  });
  assert.equal(harness.calls.filter(([name]) => name === 'stop').length, stopCount + 1);
  assert.match(harness.stateManager.state.currentTrack.sourceKey, /^openhome:/);
  assert.equal(harness.stateManager.state.isStopped, true);
  assert.equal(harness.adapter.getSnapshot().currentId, 1);

  installLocalSource('paused');
  stopCount = harness.calls.filter(([name]) => name === 'stop').length;
  await runAction(harness, 'ownership-delete-2', 'DeleteId', { id: 2 });
  assert.equal(harness.calls.filter(([name]) => name === 'stop').length, stopCount + 1);
  assert.match(harness.stateManager.state.currentTrack.sourceKey, /^openhome:/);
  assert.equal(harness.stateManager.state.isStopped, true);

  harness.stateManager.updateState({
    currentTrack: {
      path: 'local.flac', name: 'Local', sourceKind: 'local', sourceKey: 'local:active-source'
    },
    currentTrackPosition: 23,
    isPlaying: true,
    isPaused: false,
    isStopped: false
  });
  stopCount = harness.calls.filter(([name]) => name === 'stop').length;
  await runAction(harness, 'ownership-shuffle', 'SetShuffle', { shuffle: true });
  assert.equal(harness.calls.filter(([name]) => name === 'stop').length, stopCount + 1);
  assert.match(harness.stateManager.state.currentTrack.sourceKey, /^openhome:/);
  assert.equal(harness.stateManager.state.isStopped, true);
  assert.equal(harness.stateManager.state.shuffleMode, true);
  harness.adapter.dispose();
});

for (const action of ['Play', 'SetShuffle']) {
  test(`remote ${action} applies an existing local shuffle mode to the staged queue`, async () => {
    const harness = createHarness();
    const manager = installRealPlaybackManager(harness);
    for (let index = 1; index <= 2; index += 1) {
      await runAction(harness, `ownership-shuffle-insert-${index}`, 'Insert', {
        afterId: index - 1,
        uri: `http://media.test/ownership-shuffle-${index}.flac`,
        playbackUrl: `http://127.0.0.1:43123/openhome-media/5656565656565656565656565656560${index}`,
        metadata: `ownership shuffle ${index}`
      });
    }

    manager.replaceMaterializedPlaylist([{
      path: 'local.flac', name: 'Local', sourceKind: 'local', sourceKey: 'local:shuffle-owner'
    }], 0);
    harness.stateManager.updateState({
      currentTrackPosition: 17,
      shuffleMode: true,
      isPlaying: action === 'Play',
      isPaused: action === 'SetShuffle',
      isStopped: false
    });
    const canonicalOrder = ['openhome:1', 'openhome:2'];
    const shuffledOrder = ['openhome:2', 'openhome:1'];
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      assert.equal((await runAction(harness, 'ownership-shuffle', action, { shuffle: true })).ok, true);
      assert.deepEqual(manager.originalPlaylist.map(track => track.sourceKey), canonicalOrder);
      assert.deepEqual(manager.playlist.map(track => track.sourceKey), shuffledOrder);
      assert.equal(harness.stateManager.state.shuffleMode, true);
      assert.equal(harness.adapter.getSnapshot().currentId, 1);
      assert.equal(harness.stateManager.state.isPlaying, action === 'Play');
      assert.equal(harness.stateManager.state.isStopped, action === 'SetShuffle');

      await runAction(harness, 'ownership-shuffle-disable', 'SetShuffle', { shuffle: false });
      assert.deepEqual(manager.playlist.map(track => track.sourceKey), canonicalOrder);
      assert.equal(harness.stateManager.state.shuffleMode, false);
      assert.equal(harness.adapter.getSnapshot().currentId, 1);
      assert.equal(harness.stateManager.state.isStopped, action === 'SetShuffle');
    } finally {
      Math.random = originalRandom;
      harness.adapter.dispose();
    }
  });
}

test('remote Next and Previous explicitly move the queue after audio activation', async () => {
  const harness = createHarness();
  const manager = installRealPlaybackManager(harness);
  for (let index = 1; index <= 3; index += 1) {
    await runAction(harness, `transport-insert-${index}`, 'Insert', {
      afterId: index - 1,
      uri: `http://media.test/transport-${index}.flac`,
      playbackUrl: `http://127.0.0.1:43123/openhome-media/6767676767676767676767676767670${index}`,
      metadata: `transport ${index}`
    });
  }
  harness.stateManager.updateState({
    currentTrack: manager.playlist[2],
    currentTrackIndex: 2,
    currentTrackPosition: 9,
    isPlaying: true,
    isPaused: false,
    isStopped: false
  });

  assert.deepEqual(await runAction(harness, 'transport-previous-playing', 'Previous'), {
    requestId: 'transport-previous-playing', ok: true, result: {}
  });
  assert.equal(harness.adapter.getSnapshot().currentId, 2);
  assert.equal(harness.stateManager.state.currentTrackPosition, 0);
  assert.ok(
    harness.calls.findLastIndex(([name]) => name === 'resumeAudioContextForRemotePlayback') <
    harness.calls.findLastIndex(([name]) => name === 'transitionToNextTrack')
  );

  harness.stateManager.updateState({
    isPlaying: false,
    isPaused: false,
    isStopped: true
  });
  assert.equal((await runAction(harness, 'transport-next-stopped', 'Next')).ok, true);
  assert.equal(harness.adapter.getSnapshot().currentId, 3);
  assert.equal(harness.stateManager.state.isPlaying, true);

  harness.stateManager.updateState({
    currentTrackPosition: 12,
    isPlaying: false,
    isPaused: false,
    isStopped: true
  });
  assert.equal((await runAction(harness, 'transport-previous-stopped', 'Previous')).ok, true);
  assert.equal(harness.adapter.getSnapshot().currentId, 2);
  assert.equal(harness.stateManager.state.isPlaying, true);

  harness.audioPlayer.remoteResumeResult = false;
  assert.deepEqual(await runAction(harness, 'transport-next-resume-failed', 'Next'), {
    requestId: 'transport-next-resume-failed',
    ok: false,
    error: { code: 'next-failed' }
  });
  harness.audioPlayer.remoteResumeResult = true;
  harness.audioPlayer.contextManager.transitionResult = false;
  assert.deepEqual(await runAction(harness, 'transport-previous-transition-failed', 'Previous'), {
    requestId: 'transport-previous-transition-failed',
    ok: false,
    error: { code: 'previous-failed' }
  });
  harness.adapter.dispose();
});

test('OpenHome shuffle repeat boundaries do not immediately replay the prior entry', async () => {
  const harness = createHarness();
  const manager = installRealPlaybackManager(harness);
  for (let index = 1; index <= 2; index += 1) {
    await runAction(harness, `boundary-insert-${index}`, 'Insert', {
      afterId: index - 1,
      uri: `http://media.test/boundary-${index}.flac`,
      playbackUrl: `http://127.0.0.1:43123/openhome-media/6868686868686868686868686868680${index}`,
      metadata: `boundary ${index}`
    });
  }
  harness.stateManager.updateState({
    currentTrack: manager.playlist[1],
    currentTrackIndex: 1,
    currentTrackPosition: 4,
    repeatMode: 'ALL',
    shuffleMode: true,
    isPlaying: true,
    isPaused: false,
    isStopped: false
  });

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    assert.equal((await runAction(harness, 'boundary-next', 'Next')).ok, true);
    assert.equal(harness.adapter.getSnapshot().currentId, 1);

    assert.equal((await runAction(harness, 'boundary-previous', 'Previous')).ok, true);
    assert.equal(harness.adapter.getSnapshot().currentId, 2);
  } finally {
    Math.random = originalRandom;
    harness.adapter.dispose();
  }
});

test('local repeat button turns Repeat ALL off while preserving shuffled OpenHome order and transport', async () => {
  const harness = createHarness();
  const manager = installRealPlaybackManager(harness);
  for (let index = 1; index <= 3; index += 1) {
    await runAction(harness, `repeat-shuffle-insert-${index}`, 'Insert', {
      afterId: index - 1,
      uri: `http://media.test/repeat-${index}.flac`,
      playbackUrl: `http://127.0.0.1:43123/openhome-media/9090909090909090909090909090900${index}`,
      metadata: `repeat ${index}`
    });
  }
  harness.stateManager.updateState({
    currentTrackIndex: 1,
    currentTrack: manager.playlist[1],
    currentTrackPosition: 29,
    isPlaying: true,
    isPaused: false,
    isStopped: false
  });
  await manager.setRepeatMode('ALL');
  await manager.setShuffleMode(true, { userInitiated: false, preserveTransport: true });
  const order = manager.playlist.map(track => track.sourceKey);
  const currentId = harness.adapter.getSnapshot().currentId;

  await manager.toggleRepeatMode();

  assert.equal(harness.stateManager.state.repeatMode, 'OFF');
  assert.equal(harness.stateManager.state.shuffleMode, true);
  assert.deepEqual(manager.playlist.map(track => track.sourceKey), order);
  assert.equal(harness.adapter.getSnapshot().currentId, currentId);
  assert.equal(harness.stateManager.state.currentTrackPosition, 29);
  assert.equal(harness.stateManager.state.isPlaying, true);
  assert.equal(harness.stateManager.state.isPaused, false);
  harness.adapter.dispose();
});

test('local Repeat ONE is normalized only while the OpenHome queue owns playback', async () => {
  const harness = createHarness();
  await runAction(harness, 'repeat-owner-insert', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/owned.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/34343434343434343434343434343434',
    metadata: ''
  });
  const snapshotCount = harness.snapshots.length;

  harness.stateManager.updateState({ repeatMode: 'ONE' });
  await delay();

  assert.equal(harness.stateManager.state.repeatMode, 'ALL');
  assert.deepEqual(harness.calls.findLast(call => call[0] === 'setRepeatMode'), [
    'setRepeatMode', 'ALL'
  ]);
  assert.ok(harness.snapshots.slice(snapshotCount).every(snapshot => snapshot.repeat === true));
  harness.adapter.dispose();

  const localHarness = createHarness();
  localHarness.stateManager.updateState({ repeatMode: 'ONE' });
  assert.equal(localHarness.stateManager.state.repeatMode, 'ONE');
  assert.equal(localHarness.calls.some(call => call[0] === 'setRepeatMode'), false);
  localHarness.adapter.dispose();
});

test('OpenHome Play reports play-failed when playback does not start', async () => {
  const harness = createHarness();
  await runAction(harness, 'insert', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/one.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/ffffffffffffffffffffffffffffffff',
    metadata: ''
  });

  harness.audioPlayer.playResult = false;
  assert.deepEqual(await runAction(harness, 'play-failed', 'Play'), {
    requestId: 'play-failed',
    ok: false,
    error: { code: 'play-failed' }
  });
  harness.adapter.dispose();
});

test('OpenHome Play reports play-failed when remote playback activation is denied', async () => {
  const harness = createHarness();
  await runAction(harness, 'insert', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/one.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/abababababababababababababababab',
    metadata: ''
  });

  harness.audioPlayer.remoteResumeResult = false;
  assert.deepEqual(await runAction(harness, 'play-resume-failed', 'Play'), {
    requestId: 'play-resume-failed',
    ok: false,
    error: { code: 'play-failed' }
  });
  assert.equal(harness.calls.filter(([name]) => name === 'play').length, 0);
  harness.adapter.dispose();
});

test('cancelling a deferred OpenHome Play stops its playback request', async () => {
  const harness = createHarness();
  await runAction(harness, 'insert', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/one.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/33333333333333333333333333333333',
    metadata: ''
  });

  const remotePlayRequest = {};
  let releasePlay;
  harness.audioPlayer.play = userInitiated => {
    harness.calls.push(['play', userInitiated]);
    harness.audioPlayer.playbackManager.activePlayRequest = remotePlayRequest;
    return new Promise(resolve => {
      releasePlay = () => {
        if (harness.audioPlayer.playbackManager.activePlayRequest === remotePlayRequest) {
          harness.stateManager.updateState({ isPlaying: true, isStopped: false });
        }
        resolve(true);
      };
    });
  };
  harness.audioPlayer.stop = async () => {
    harness.calls.push(['stop']);
    if (harness.audioPlayer.playbackManager.activePlayRequest === remotePlayRequest) {
      harness.audioPlayer.playbackManager.activePlayRequest = null;
    }
    harness.stateManager.updateState({ isPlaying: false, isStopped: true });
  };

  harness.bridge.emitAction({
    requestId: 'play-cancelled', service: 'Playlist', action: 'Play', args: {}
  });
  await delay();
  assert.equal(typeof releasePlay, 'function');
  harness.bridge.emitCancel({ requestId: 'play-cancelled' });
  releasePlay();
  await harness.adapter.commandChain;

  assert.equal(harness.calls.filter(([name]) => name === 'stop').length, 1);
  assert.equal(harness.stateManager.state.isPlaying, false);
  assert.equal(harness.responses.some(response => response.requestId === 'play-cancelled'), false);
  harness.adapter.dispose();
});

test('cancelling OpenHome Play does not stop playback after ownership changes', async () => {
  const harness = createHarness();
  await runAction(harness, 'insert', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/one.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/44444444444444444444444444444444',
    metadata: ''
  });

  const remotePlayRequest = {};
  const localPlayRequest = {};
  let releasePlay;
  harness.audioPlayer.play = userInitiated => {
    harness.calls.push(['play', userInitiated]);
    harness.audioPlayer.playbackManager.activePlayRequest = remotePlayRequest;
    return new Promise(resolve => { releasePlay = () => resolve(true); });
  };

  harness.bridge.emitAction({
    requestId: 'play-old-owner', service: 'Playlist', action: 'Play', args: {}
  });
  await delay();
  harness.audioPlayer.playbackManager.activePlayRequest = localPlayRequest;
  harness.stateManager.updateState({ isPlaying: true, isStopped: false });
  harness.bridge.emitCancel({ requestId: 'play-old-owner' });
  releasePlay();
  await harness.adapter.commandChain;

  assert.equal(harness.calls.some(([name]) => name === 'stop'), false);
  assert.equal(harness.audioPlayer.playbackManager.activePlayRequest, localPlayRequest);
  assert.equal(harness.stateManager.state.isPlaying, true);
  harness.adapter.dispose();
});

test('cancelling OpenHome Insert before its commit does not splice the queue', async () => {
  const harness = createHarness({ shuffleMode: true });
  let markShuffleStarted;
  let releaseShuffle;
  const shuffleStarted = new Promise(resolve => { markShuffleStarted = resolve; });
  const shuffleBlocked = new Promise(resolve => { releaseShuffle = resolve; });
  harness.audioPlayer.playbackManager.setShuffleMode = async (enabled, options) => {
    harness.calls.push(['setShuffleMode', enabled, options]);
    markShuffleStarted();
    await shuffleBlocked;
    harness.stateManager.updateState({ shuffleMode: enabled });
  };

  harness.bridge.emitAction({
    requestId: 'insert-cancelled',
    service: 'Playlist',
    action: 'Insert',
    args: {
      afterId: 0,
      uri: 'http://media.test/cancelled.flac',
      playbackUrl: 'http://127.0.0.1:43123/openhome-media/55555555555555555555555555555555',
      metadata: ''
    }
  });
  await shuffleStarted;
  harness.bridge.emitCancel({ requestId: 'insert-cancelled' });
  releaseShuffle();
  await harness.adapter.commandChain;

  assert.equal(harness.adapter.queue.length, 0);
  assert.equal(harness.calls.some(([name]) => name === 'replaceMaterializedPlaylist'), false);
  assert.equal(harness.responses.some(response => response.requestId === 'insert-cancelled'), false);
  harness.adapter.dispose();
});

test('post-commit cancellation rolls back OpenHome Insert as one queue mutation', async () => {
  const harness = createHarness({ shuffleMode: true });
  await runAction(harness, 'insert-existing', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/existing.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/66666666666666666666666666666666',
    metadata: ''
  });
  const before = captureQueueContract(harness);
  const responseCount = harness.responses.length;
  let toggleCount = 0;
  let markRestoreStarted;
  let releaseRestore;
  const restoreStarted = new Promise(resolve => { markRestoreStarted = resolve; });
  const restoreBlocked = new Promise(resolve => { releaseRestore = resolve; });
  harness.audioPlayer.playbackManager.setShuffleMode = async (enabled, options) => {
    harness.calls.push(['setShuffleMode', enabled, options]);
    toggleCount += 1;
    harness.stateManager.updateState({ shuffleMode: enabled });
    if (toggleCount === 2) {
      markRestoreStarted();
      await restoreBlocked;
    }
  };

  harness.bridge.emitAction({
    requestId: 'insert-post-commit',
    service: 'Playlist',
    action: 'Insert',
    args: {
      afterId: 1,
      uri: 'http://media.test/new.flac',
      playbackUrl: 'http://127.0.0.1:43123/openhome-media/77777777777777777777777777777777',
      metadata: ''
    }
  });
  await restoreStarted;
  assert.deepEqual(harness.adapter.queue.map(track => track.id), [1, 2]);
  harness.bridge.emitCancel({ requestId: 'insert-post-commit' });
  releaseRestore();
  await harness.adapter.commandChain;

  assert.deepEqual(captureQueueContract(harness), before);
  assert.equal(harness.responses.length, responseCount);
  assert.equal(harness.responses.some(response => response.requestId === 'insert-post-commit'), false);
  assert.equal((await runAction(harness, 'read-after-insert-rollback', 'Read', { id: 1 })).ok, true);
  harness.adapter.dispose();
});

test('post-commit cancellation rolls back OpenHome DeleteId as one queue mutation', async () => {
  const harness = createHarness({ shuffleMode: true });
  await runAction(harness, 'insert-delete-1', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/one.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/88888888888888888888888888888888',
    metadata: ''
  });
  await runAction(harness, 'insert-delete-2', 'Insert', {
    afterId: 1,
    uri: 'http://media.test/two.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/99999999999999999999999999999999',
    metadata: ''
  });
  const before = captureQueueContract(harness);
  const responseCount = harness.responses.length;
  let toggleCount = 0;
  let markRestoreStarted;
  let releaseRestore;
  const restoreStarted = new Promise(resolve => { markRestoreStarted = resolve; });
  const restoreBlocked = new Promise(resolve => { releaseRestore = resolve; });
  harness.audioPlayer.playbackManager.setShuffleMode = async (enabled, options) => {
    harness.calls.push(['setShuffleMode', enabled, options]);
    toggleCount += 1;
    harness.stateManager.updateState({ shuffleMode: enabled });
    if (toggleCount === 2) {
      markRestoreStarted();
      await restoreBlocked;
    }
  };

  harness.bridge.emitAction({
    requestId: 'delete-post-commit',
    service: 'Playlist',
    action: 'DeleteId',
    args: { id: 2 }
  });
  await restoreStarted;
  assert.deepEqual(harness.adapter.queue.map(track => track.id), [1]);
  harness.bridge.emitCancel({ requestId: 'delete-post-commit' });
  releaseRestore();
  await harness.adapter.commandChain;

  assert.deepEqual(captureQueueContract(harness), before);
  assert.equal(harness.responses.length, responseCount);
  assert.equal(harness.responses.some(response => response.requestId === 'delete-post-commit'), false);
  assert.equal((await runAction(harness, 'read-after-delete-rollback', 'Read', { id: 2 })).ok, true);
  harness.adapter.dispose();
});

test('OpenHome queue rollback does not overwrite a new local playback owner', async () => {
  const harness = createHarness({ shuffleMode: true });
  await runAction(harness, 'insert-owner-existing', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/existing.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01',
    metadata: ''
  });
  let toggleCount = 0;
  let markRestoreStarted;
  let releaseRestore;
  const restoreStarted = new Promise(resolve => { markRestoreStarted = resolve; });
  const restoreBlocked = new Promise(resolve => { releaseRestore = resolve; });
  harness.audioPlayer.playbackManager.setShuffleMode = async enabled => {
    toggleCount += 1;
    harness.stateManager.updateState({ shuffleMode: enabled });
    if (toggleCount === 2) {
      markRestoreStarted();
      await restoreBlocked;
    }
  };

  harness.bridge.emitAction({
    requestId: 'insert-owner-change',
    service: 'Playlist',
    action: 'Insert',
    args: {
      afterId: 1,
      uri: 'http://media.test/new.flac',
      playbackUrl: 'http://127.0.0.1:43123/openhome-media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa02',
      metadata: ''
    }
  });
  await restoreStarted;
  const localPlayRequest = {};
  harness.audioPlayer.playbackManager.replaceMaterializedPlaylist([{
    path: 'local.flac',
    name: 'Local',
    sourceKind: 'local',
    sourceKey: 'local:new-owner'
  }], 0);
  harness.audioPlayer.playbackManager.activePlayRequest = localPlayRequest;
  harness.stateManager.updateState({ isPlaying: true, isStopped: false });
  harness.bridge.emitCancel({ requestId: 'insert-owner-change' });
  releaseRestore();
  await harness.adapter.commandChain;

  assert.deepEqual(harness.adapter.queue.map(track => track.id), [1]);
  assert.deepEqual(harness.audioPlayer.playbackManager.playlist.map(track => track.sourceKey), [
    'local:new-owner'
  ]);
  assert.equal(harness.audioPlayer.playbackManager.activePlayRequest, localPlayRequest);
  assert.equal(harness.stateManager.state.isPlaying, true);
  harness.adapter.dispose();
});

test('OpenHome queue mutation rolls back when the host no longer accepts its response', async () => {
  const harness = createHarness();
  const before = captureQueueContract(harness);
  harness.bridge.acceptResponses = false;

  await runAction(harness, 'insert-late-response', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/late.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb01',
    metadata: ''
  });

  assert.deepEqual(captureQueueContract(harness), before);
  harness.bridge.acceptResponses = true;
  assert.equal((await runAction(harness, 'snapshot-after-late', 'Snapshot')).ok, true);
  harness.adapter.dispose();
});

test('OpenHome queue rollback restores a real shuffled catalog descriptor and canonical track', async t => {
  const previousFile = globalThis.File;
  globalThis.File = class TestFile {};
  t.after(() => {
    if (previousFile === undefined) delete globalThis.File;
    else globalThis.File = previousFile;
  });
  const harness = createHarness();
  harness.audioPlayer.contextManager = {
    clearNextTrackBuffer() {},
    invalidatePendingPlaybackOperations() {},
    refreshActiveRegionTransportPlan() {},
    loadTrack() { return Promise.resolve(true); },
    stop() { return Promise.resolve(); }
  };
  const manager = createPlaybackManager(harness.audioPlayer);
  manager.savePlayerState = () => {};
  harness.audioPlayer.playbackManager = manager;
  const sequence = new CatalogSequence({
    sequenceId: 'openhome-catalog-rollback',
    itemCount: 5,
    readPage: async ({ startOrdinal, limit }) => Array.from({ length: limit }, (_value, index) => ({
      trackUid: `catalog-${startOrdinal + index}`,
      name: `Catalog ${startOrdinal + index}`
    })),
    resolveSource: async () => ({ path: 'catalog.flac' }),
    shuffleSeed: 73,
    shuffleEpoch: 2,
    shuffleEnabled: true,
    shuffleTransportOffset: 1
  });
  const currentOrdinal = 3;
  const catalogTrack = { path: 'catalog-current.flac', name: 'Catalog current' };
  manager.installCatalogSequence(sequence, {
    currentOrdinal,
    currentTrack: catalogTrack,
    resolvedEntries: new Map([[currentOrdinal, catalogTrack]])
  });
  harness.stateManager.updateState({ shuffleMode: true });
  const descriptor = sequence.getDescriptor();
  const canonicalOrder = Array.from({ length: sequence.itemCount }, (_value, ordinal) => (
    sequence.toCanonicalOrdinal(ordinal)
  ));
  const currentCanonical = sequence.toCanonicalOrdinal(currentOrdinal);
  const assertCatalogRestored = () => {
    assert.deepEqual(sequence.getDescriptor(), descriptor);
    assert.deepEqual(Array.from({ length: sequence.itemCount }, (_value, ordinal) => (
      sequence.toCanonicalOrdinal(ordinal)
    )), canonicalOrder);
    assert.equal(sequence.toCanonicalOrdinal(harness.stateManager.state.currentTrackIndex), currentCanonical);
    assert.equal(harness.stateManager.state.currentTrack, catalogTrack);
    assert.equal(harness.stateManager.state.shuffleMode, true);
    assert.equal(manager.catalogSequence, sequence);
    assert.equal(manager.resolvedCatalogEntries.get(currentOrdinal), catalogTrack);
  };

  harness.bridge.acceptResponses = false;
  const ackFalseResponse = await runAction(harness, 'catalog-ack-false', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/catalog-false.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/eeeeeeeeeeeeeeeeeeeeeeeeeeeeee01',
    metadata: ''
  });
  assert.equal(ackFalseResponse.ok, true);
  assertCatalogRestored();

  harness.bridge.acceptResponses = true;
  let releaseResponse;
  harness.bridge.respond = () => new Promise(resolve => { releaseResponse = resolve; });
  harness.bridge.emitAction({
    requestId: 'catalog-cancel',
    service: 'Playlist',
    action: 'Insert',
    args: {
      afterId: 0,
      uri: 'http://media.test/catalog-cancel.flac',
      playbackUrl: 'http://127.0.0.1:43123/openhome-media/eeeeeeeeeeeeeeeeeeeeeeeeeeeeee02',
      metadata: ''
    }
  });
  await delay();
  assert.equal(manager.catalogSequence, null);
  harness.bridge.emitCancel({ requestId: 'catalog-cancel' });
  releaseResponse(true);
  await harness.adapter.commandChain;
  assertCatalogRestored();
  harness.adapter.dispose();
});

test('OpenHome DeleteId and DeleteAll commit only when the host accepts their responses', async () => {
  const harness = createHarness();
  await runAction(harness, 'insert-commit-1', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/one.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/cccccccccccccccccccccccccccccc01',
    metadata: ''
  });
  await runAction(harness, 'insert-commit-2', 'Insert', {
    afterId: 1,
    uri: 'http://media.test/two.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/cccccccccccccccccccccccccccccc02',
    metadata: ''
  });
  const beforeDelete = captureQueueContract(harness);

  harness.bridge.acceptResponses = false;
  await runAction(harness, 'delete-not-accepted', 'DeleteId', { id: 2 });
  assert.deepEqual(captureQueueContract(harness), beforeDelete);

  harness.bridge.acceptResponses = true;
  await runAction(harness, 'delete-accepted', 'DeleteId', { id: 2 });
  assert.deepEqual(harness.adapter.queue.map(track => track.id), [1]);
  const beforeDeleteAll = captureQueueContract(harness);

  harness.bridge.acceptResponses = false;
  await runAction(harness, 'delete-all-not-accepted', 'DeleteAll');
  assert.deepEqual(captureQueueContract(harness), beforeDeleteAll);

  harness.bridge.acceptResponses = true;
  await runAction(harness, 'delete-all-accepted', 'DeleteAll');
  assert.deepEqual(harness.adapter.queue, []);
  assert.deepEqual(harness.audioPlayer.playbackManager.playlist, []);
  harness.adapter.dispose();
});

test('OpenHome reset cancels active remote work and acknowledges only after publishing an empty queue', async () => {
  const harness = createHarness();
  await runAction(harness, 'insert-before-reset', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/reset.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/dddddddddddddddddddddddddddddd01',
    metadata: ''
  });
  harness.adapter.idArrayToken = 4;
  harness.adapter.transportToken = 5;
  harness.adapter.trackToken = 6;
  harness.adapter.detailsToken = 7;
  let finishPlay;
  harness.audioPlayer.play = () => {
    const request = {};
    harness.audioPlayer.playbackManager.activePlayRequest = request;
    return new Promise(resolve => { finishPlay = resolve; });
  };
  harness.bridge.emitAction({
    requestId: 'play-during-reset', service: 'Playlist', action: 'Play', args: {}
  });
  await delay();
  harness.resetEvents.length = 0;
  harness.bridge.emitReset({ resetId: 'reset-active' });
  finishPlay(false);
  await harness.adapter.commandChain;

  assert.deepEqual(harness.adapter.queue, []);
  assert.deepEqual(harness.audioPlayer.playbackManager.playlist, []);
  assert.equal(harness.adapter.nextTrackId, 1);
  assert.deepEqual([
    harness.adapter.idArrayToken,
    harness.adapter.transportToken,
    harness.adapter.trackToken,
    harness.adapter.detailsToken
  ], [0, 0, 0, 0]);
  assert.deepEqual(
    harness.responses.find(response => response.requestId === 'play-during-reset'),
    undefined
  );
  assert.deepEqual(harness.resetAcks.at(-1), { resetId: 'reset-active', ok: true });
  assert.equal(harness.resetEvents.at(-2)[0], 'publish');
  assert.equal(harness.resetEvents.at(-2)[1].idArray, '');
  assert.deepEqual(harness.resetEvents.at(-1), ['ack', { resetId: 'reset-active', ok: true }]);
  harness.adapter.dispose();
});

test('OpenHome reset does not stop or clear a newer local playback owner', async () => {
  const harness = createHarness();
  await runAction(harness, 'insert-before-local-reset', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/remote.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/dddddddddddddddddddddddddddddd02',
    metadata: ''
  });
  harness.audioPlayer.playbackManager.replaceMaterializedPlaylist([{
    path: 'local.flac', name: 'Local', sourceKind: 'local', sourceKey: 'local:owner'
  }], 0);
  const stopCount = harness.calls.filter(([name]) => name === 'stop').length;
  harness.bridge.emitReset({ resetId: 'reset-local-owner' });
  await harness.adapter.commandChain;

  assert.deepEqual(harness.adapter.queue, []);
  assert.deepEqual(harness.audioPlayer.playbackManager.playlist.map(track => track.sourceKey), [
    'local:owner'
  ]);
  assert.equal(harness.calls.filter(([name]) => name === 'stop').length, stopCount);
  assert.deepEqual(harness.resetAcks.at(-1), { resetId: 'reset-local-owner', ok: true });
  harness.adapter.dispose();
});

test('OpenHome deadline expiry before queue commit leaves the prior queue intact', async () => {
  let now = 0;
  const harness = createHarness({ shuffleMode: true }, { now: () => now });
  const before = captureQueueContract(harness);
  let markShuffleStarted;
  let releaseShuffle;
  const shuffleStarted = new Promise(resolve => { markShuffleStarted = resolve; });
  const shuffleBlocked = new Promise(resolve => { releaseShuffle = resolve; });
  harness.audioPlayer.playbackManager.setShuffleMode = async enabled => {
    markShuffleStarted();
    await shuffleBlocked;
    harness.stateManager.updateState({ shuffleMode: enabled });
  };

  harness.bridge.emitAction({
    requestId: 'insert-deadline',
    deadlineEpochMs: 100,
    service: 'Playlist',
    action: 'Insert',
    args: {
      afterId: 0,
      uri: 'http://media.test/deadline.flac',
      playbackUrl: 'http://127.0.0.1:43123/openhome-media/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb02',
      metadata: ''
    }
  });
  await shuffleStarted;
  now = 100;
  releaseShuffle();
  await harness.adapter.commandChain;

  assert.deepEqual(captureQueueContract(harness), before);
  assert.equal(harness.responses.at(-1).error.code, 'action-timeout');
  harness.adapter.dispose();
});

test('materialized queue replacement invalidates a deferred transition before it can commit', async () => {
  const calls = [];
  const stateManager = createStateManager();
  let playbackOperationGeneration = 0;
  let releaseTransition;
  let markTransitionStarted;
  const transitionStarted = new Promise(resolve => { markTransitionStarted = resolve; });
  const contextManager = {
    clearNextTrackBuffer() {},
    invalidatePendingPlaybackOperations() {
      playbackOperationGeneration += 1;
      calls.push(['invalidatePendingPlaybackOperations']);
    },
    transitionToNextTrack(track, index) {
      const generation = playbackOperationGeneration;
      markTransitionStarted();
      return new Promise(resolve => {
        releaseTransition = () => {
          if (generation !== playbackOperationGeneration) {
            resolve(false);
            return;
          }
          stateManager.updateState({ currentTrack: track, currentTrackIndex: index });
          resolve(true);
        };
      });
    }
  };
  const audioPlayer = { contextManager, stateManager };
  const manager = createPlaybackManager(audioPlayer);
  audioPlayer.playbackManager = manager;
  manager.loadFiles(['old-one.flac', 'old-two.flac'], false, null, { deferInitialLoad: true });
  stateManager.updateState({ isPlaying: true, isStopped: false });

  const deferredTransition = manager.selectQueueOrdinal(1, { play: true, userInitiated: false });
  await transitionStarted;
  manager.replaceMaterializedPlaylist(['replacement.flac'], 0);
  releaseTransition();

  assert.deepEqual(await deferredTransition, { accepted: false, reason: 'stale' });
  assert.deepEqual(calls, [['invalidatePendingPlaybackOperations']]);
  assert.equal(stateManager.state.currentTrack?.path, 'replacement.flac');
});

test('explicit shuffle can preserve the active materialized entry and transport state', async () => {
  const harness = createHarness({
    currentTrackIndex: 1,
    currentTrackPosition: 37,
    isPlaying: true,
    isPaused: false,
    isStopped: false
  });
  harness.audioPlayer.contextManager = {
    clearNextTrackBuffer() {
      harness.calls.push(['clearNextTrackBuffer']);
    },
    stop() {
      harness.calls.push(['contextStop']);
    },
    refreshActiveRegionTransportPlan() {
      harness.calls.push(['refreshActiveRegionTransportPlan']);
    }
  };
  const manager = createPlaybackManager(harness.audioPlayer);
  manager.savePlayerState = () => { harness.calls.push(['savePlayerState']); };
  manager.loadFiles(['one.flac', 'two.flac', 'three.flac'], false, null, {
    deferInitialLoad: true
  });
  harness.stateManager.updateState({
    currentTrackIndex: 1,
    currentTrack: manager.playlist[1]
  });
  const activeEntryId = manager.playbackEntryIds.get(manager.playlist[1]);

  assert.equal(await manager.setShuffleMode(true, {
    userInitiated: false,
    preserveTransport: true
  }), true);

  assert.equal(harness.stateManager.state.shuffleMode, true);
  assert.equal(harness.stateManager.state.currentTrackPosition, 37);
  assert.equal(harness.stateManager.state.isPlaying, true);
  assert.equal(harness.stateManager.state.isPaused, false);
  assert.equal(harness.stateManager.state.isStopped, false);
  assert.equal(
    manager.playbackEntryIds.get(manager.playlist[harness.stateManager.state.currentTrackIndex]),
    activeEntryId
  );
  assert.equal(harness.calls.some(call => call[0] === 'contextStop'), false);
  assert.equal(harness.calls.some(call => call[0] === 'resumeAudioContextInGesture'), false);
  harness.adapter.dispose();
});

test('explicit and toggled repeat modes share player state, UI, transport, and persistence updates', async () => {
  const calls = [];
  const stateManager = createStateManager();
  const audioPlayer = {
    stateManager,
    contextManager: {
      refreshActiveRegionTransportPlan() {
        calls.push(['refreshActiveRegionTransportPlan']);
      }
    },
    ui: {
      updatePlayerUIState() {
        calls.push(['updatePlayerUIState']);
      }
    }
  };
  const manager = createPlaybackManager(audioPlayer);
  audioPlayer.playbackManager = manager;
  manager.savePlayerState = () => { calls.push(['savePlayerState']); };

  await manager.setRepeatMode('ALL');
  assert.equal(stateManager.state.repeatMode, 'ALL');
  await manager.toggleRepeatMode();
  assert.equal(stateManager.state.repeatMode, 'ONE');
  assert.deepEqual(calls, [
    ['refreshActiveRegionTransportPlan'],
    ['updatePlayerUIState'],
    ['savePlayerState'],
    ['refreshActiveRegionTransportPlan'],
    ['updatePlayerUIState'],
    ['savePlayerState']
  ]);
});

test('OpenHome adapter rejects non-HTTP source URIs and non-gateway playback URLs', async () => {
  const harness = createHarness();
  const sourceFailure = await runAction(harness, 'bad-source', 'Insert', {
    afterId: 0,
    uri: 'file:///secret.flac',
    playbackUrl: 'http://127.0.0.1:43123/openhome-media/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    metadata: ''
  });
  assert.equal(sourceFailure.ok, false);
  assert.equal(sourceFailure.error.code, 'invalid-uri');

  const gatewayFailure = await runAction(harness, 'bad-gateway', 'Insert', {
    afterId: 0,
    uri: 'http://media.test/song.flac',
    playbackUrl: 'http://media.test/song.flac',
    metadata: ''
  });
  assert.equal(gatewayFailure.ok, false);
  assert.equal(gatewayFailure.error.code, 'invalid-playback-url');
  assert.equal(harness.adapter.queue.length, 0);
  harness.adapter.dispose();
});
