import assert from 'node:assert/strict';
import test from 'node:test';
import { NetworkMusicController } from '../../js/network-music/controller.js';
import { NetworkMusicView } from '../../js/network-music/view.js';
import { NetworkPlaybackAdapter } from '../../js/network-music/playback-adapter.js';
import { CatalogPlaybackBridge } from '../../js/ui/audio-player/catalog-playback-bridge.js';
import { UIManager } from '../../js/ui-manager.js';
import { LibraryView } from '../../js/ui/library/library-view.js';
import { DurableActionController } from '../../js/ui/library/durable-action-controller.js';
import { exportPreset, importPreset, openMusicFile, openPresetFile } from '../../js/electron/presetIntegration.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('network seek converts the common seek bar position to nonnegative whole seconds', async () => {
  const commands = [];
  const controller = {
    playerStates: new Map(),
    command: async (...args) => { commands.push(args); },
    reportError: error => { throw error; }
  };
  const adapter = new NetworkPlaybackAdapter(controller, 'player-b', {});
  for (const seconds of [241 * 0.5, 0, -2]) await adapter.contextManager.seek(seconds);
  assert.deepEqual(commands, [
    ['seek', { seconds: 120 }, 'player-b'],
    ['seek', { seconds: 0 }, 'player-b'],
    ['seek', { seconds: 0 }, 'player-b']
  ]);
});

function fixture(overrides = {}) {
  const calls = [];
  const state = { libraries: [{ id: 'server-a', name: 'Library A' }], players: [{ id: 'player-b', name: 'Player B' }, { id: 'player-c', name: 'Player C' }], sharing: { enabled: false, folderIds: [], folders: [] } };
  const api = {
    networkMusicGetPlayerState: async request => { calls.push(['state', request]); return { queue: [], capabilities: {} }; },
    networkMusicPlayerCommand: async request => { calls.push(['command', request]); },
    networkMusicResolveTrack: async request => { calls.push(['resolve', request]); return { uri: 'http://127.0.0.1/openhome-media/audio', title: 'Song A' }; },
    ...overrides
  };
  const uiManager = {
    audioPlayer: { activateOpenHomePlaybackAdapter: () => ({ playNetworkTracks: async (...args) => calls.push(['networkQueue', ...args]) }) },
    beginPlaybackSelectionGestureResume: () => calls.push(['resume'])
  };
  const controller = new NetworkMusicController({ api, uiManager });
  controller.applyState(state);
  return { controller, api, uiManager, calls, state };
}

test('library and player selection remain independent and never issue transport commands', async () => {
  const { controller, calls, uiManager } = fixture();
  const menuTargets = [];
  uiManager.refreshApplicationMenu = () => menuTargets.push(controller.selectedPlayerId);
  const location = { objectId: 'album-4', start: 100, query: 'music', trail: [] };
  controller.libraryLocations.set('server-a', location);
  controller.selectLibrary('server-a');
  controller.selectPlayer('player-b');
  await controller.refreshPlayer();
  controller.selectLibrary('local');
  controller.selectLibrary('server-a');
  assert.equal(controller.selectedPlayerId, 'player-b');
  assert.equal(controller.libraryLocations.get('server-a'), location);
  controller.selectPlayer('local');
  assert.equal(controller.selectedLibraryId, 'server-a');
  assert.equal(calls.some(([kind]) => kind === 'command' || kind === 'loadFiles'), false);
  assert.deepEqual(menuTargets, ['player-b', 'local']);
});

test('native preset user entries cannot mutate or export the hidden local pipeline', async () => {
  const { controller, uiManager } = fixture();
  uiManager.networkMusic = controller;
  const calls = [];
  uiManager.pipelineManager = { loadPreset: preset => calls.push(['pipeline', preset]) };
  uiManager.loadPreset = preset => UIManager.prototype.loadPreset.call(uiManager, preset);
  uiManager.getCurrentPresetData = () => { calls.push(['preset']); return { name: 'Local', pipeline: [] }; };
  uiManager.showTransientMessage = (...args) => calls.push(['message', ...args]);
  uiManager.setError = (...args) => calls.push(['error', ...args]);
  const dialogResult = { filePaths: ['import.effetune_preset'], filePath: 'export.effetune_preset' };
  const readResult = { success: true, content: JSON.stringify({ pipeline: [] }) };
  let dialog;
  let read;
  const electronAPI = {
    showOpenDialog: () => { calls.push(['dialog']); return dialog?.promise ?? Promise.resolve(dialogResult); },
    showSaveDialog: () => { calls.push(['saveDialog']); return dialog?.promise ?? Promise.resolve(dialogResult); },
    readFile: () => { calls.push(['read']); return read?.promise ?? Promise.resolve(readResult); },
    saveFile: () => { calls.push(['save']); return Promise.resolve({ success: true }); }
  };
  await withGlobals({ window: { uiManager, electronAPI, isFirstLaunch: true } }, async () => {
    controller.selectPlayer('player-b');
    await importPreset(true);
    await openPresetFile(true, 'import.effetune_preset');
    await exportPreset(true);
    assert.deepEqual(calls, []);

    controller.selectPlayer('local');
    dialog = deferred();
    const pendingImport = importPreset(true);
    controller.selectPlayer('player-b');
    controller.selectPlayer('local');
    dialog.resolve(dialogResult);
    await pendingImport;
    assert.deepEqual(calls.splice(0), [['dialog']], 'returning to local cannot revive an old picker');
    dialog = null;

    for (const operation of [() => importPreset(true), () => openPresetFile(true, 'import.effetune_preset')]) {
      read = deferred();
      const pending = operation();
      await Promise.resolve();
      controller.selectPlayer('player-b');
      read.resolve(readResult);
      await pending;
      assert.equal(calls.some(([kind]) => ['pipeline', 'message'].includes(kind)), false);
      calls.length = 0;
      controller.selectPlayer('local');
    }
    read = null;

    dialog = deferred();
    const pendingExport = exportPreset(true);
    controller.selectPlayer('player-b');
    dialog.resolve(dialogResult);
    await pendingExport;
    assert.deepEqual(calls.splice(0).map(([kind]) => kind), ['preset', 'saveDialog']);
    dialog = null;
    controller.selectPlayer('local');

    for (const operation of [() => importPreset(true), () => openPresetFile(true, 'import.effetune_preset')]) {
      await operation();
      assert.equal(calls.filter(([kind]) => kind === 'pipeline').length, 1);
      assert.equal(calls.find(([kind]) => kind === 'pipeline')[1].name, 'import');
      assert.equal(calls.filter(([kind]) => kind === 'message').length, 1);
      calls.length = 0;
    }
    await exportPreset(true);
    assert.deepEqual(calls.map(([kind]) => kind), ['preset', 'saveDialog', 'save', 'message']);
  });
});

test('late state from a previous player cannot replace the newly selected queue', async () => {
  const first = deferred();
  const second = deferred();
  const { controller } = fixture({ networkMusicGetPlayerState: ({ playerId }) => playerId === 'player-b' ? first.promise : second.promise });
  controller.selectPlayer('player-b');
  controller.selectPlayer('player-c');
  second.resolve({ queue: [{ id: 33, title: 'C' }] });
  await Promise.resolve();
  first.resolve({ queue: [{ id: 22, title: 'B' }] });
  await Promise.resolve();
  assert.equal(controller.playerStates.get('player-c').queue[0].id, 33);
  assert.equal(controller.playerStates.has('player-b'), false);
});

test('a delayed local player cannot attach the previous network destination', async t => {
  const { controller, uiManager } = fixture();
  t.after(() => controller.dispose());
  const pending = deferred();
  const attached = [];
  uiManager.audioPlayer = null;
  uiManager.createAudioPlayer = async (files, replace) => {
    assert.deepEqual(files, []);
    assert.equal(replace, false);
    return pending.promise;
  };
  const player = { ui: { container: {}, setPlaybackTarget: target => attached.push(target) } };
  controller.selectPlayer('player-b');
  const view = new NetworkMusicView({ controller, uiManager });
  const binding = view.bindPlaybackTarget();
  controller.selectPlayer('player-c');
  pending.resolve(player);
  await binding;
  assert.deepEqual(attached, []);
  assert.equal(view.playbackAdapter, undefined);
  uiManager.audioPlayer = player;
  await view.bindPlaybackTarget();
  assert.equal(attached.length, 1);
  assert.equal(attached[0].playerId, 'player-c');
});

test('unavailable target keeps its identity and never falls back to local playback', async () => {
  const { controller, calls } = fixture({ networkMusicGetPlayerState: async () => { throw new Error('offline'); } });
  await withGlobals({ console: { warn() {} } }, async () => {
    controller.selectPlayer('player-b');
    await Promise.resolve();
  });
  controller.applyState({ libraries: [], players: [], sharing: {} });
  assert.equal(controller.selectedPlayerId, 'player-b');
  assert.equal(controller.selectedPlayer.name, 'Player B');
  assert.equal(controller.playerStates.get('player-b').available, false);
  assert.equal(calls.length, 0);
});

test('external queue commands preserve source identity and target the player captured at activation', async () => {
  const pending = deferred();
  const { controller, calls } = fixture({ networkMusicPlayerCommand: request => { calls.push(['command', request]); return pending.promise; } });
  controller.selectPlayer('player-b');
  await Promise.resolve();
  controller.playerStates.set('player-b', { currentId: 5, queue: [{ id: 5 }, { id: 8 }] });
  const operation = controller.playItems([{ serverId: 'server-a', trackId: 'song' }], 'queue');
  controller.selectPlayer('player-c');
  pending.resolve();
  await operation;
  assert.deepEqual(calls.find(([kind]) => kind === 'command')[1], {
    playerId: 'player-b', action: 'insert', items: [{ serverId: 'server-a', trackId: 'song' }], position: 'end', play: false
  });
  assert.equal(calls.some(([kind]) => kind === 'resolve' || kind === 'loadFiles'), false);
});

test('local playback resolves the gateway and cancels a delayed load after target selection changes', async () => {
  const source = deferred();
  const { controller, calls } = fixture({ networkMusicResolveTrack: () => source.promise });
  const operation = controller.playItems([{ serverId: 'server-a', trackId: 'song' }]);
  controller.selectPlayer('player-b');
  controller.selectPlayer('local');
  source.resolve({ uri: 'http://127.0.0.1/audio', title: 'Song' });
  await operation;
  assert.equal(calls.some(([kind]) => kind === 'networkQueue'), false);
});

test('local network songs use the authoritative OpenHome queue with the requested insertion intent', async () => {
  const { controller, calls } = fixture();
  await controller.playItems([{ serverId: 'server-a', trackId: 'song' }], 'playNext');
  const request = calls.find(([kind]) => kind === 'networkQueue');
  assert.equal(request[2], 'playNext');
  assert.equal(request[1][0].uri, 'http://127.0.0.1/openhome-media/audio');
  assert.equal(request[3](), true);
  controller.selectPlayer('player-b');
  assert.equal(request[3](), false);
});

test('local catalog play routes to the selected external player without creating or resuming a local player', async () => {
  const calls = [];
  const terminal = { kind: 'terminal', result: { state: 'succeeded', operationKind: 'play' } };
  const networkMusic = { selectedPlayerId: 'player-b', playSelection: async request => { calls.push(request); return terminal; } };
  const bridge = new CatalogPlaybackBridge({
    uiManager: { networkMusic, createAudioPlayer() { assert.fail('local player must stay untouched'); }, beginPlaybackSelectionGestureResume() { assert.fail('local audio must not resume'); } },
    service: { start() { assert.fail('local operation must not start'); }, readSequencePage() {}, resolveSequenceEntrySource() {} }
  });
  const request = { operationKind: 'play', selectionDescriptor: { mode: 'all', contextToken: 'context', exclusions: [] } };
  assert.equal(await bridge.start(request), terminal);
  assert.deepEqual(calls, [request]);
});

test('direct file entry targets the selected remote without replacing the local OpenHome player', async () => {
  const requests = [];
  const localPlayer = { loadFiles() { assert.fail('direct files must not start locally'); } };
  const ui = { networkMusic: { selectedPlayerId: 'remote', playerGeneration: 1, playFiles: async files => requests.push(files) }, audioPlayer: localPlayer };
  assert.equal(await UIManager.prototype.createAudioPlayer.call(ui, [{ path: 'song.flac' }]), localPlayer);
  assert.deepEqual(requests, [[{ path: 'song.flac' }]]);
  assert.equal(await UIManager.prototype.createAudioPlayer.call(ui, [], false), localPlayer);
});

test('sharing failures remain actionable in the actual durable Library action toast', async () => {
  for (const code of ['sharingRequired', 'folderNotShared']) {
    const failure = Object.assign(new Error('private backend diagnostic'), { code });
    const { controller } = fixture({ networkMusicPlaySelection: async () => { throw failure; } });
    controller.selectedPlayerId = 'player-b';
    const action = new DurableActionController({ service: {} });
    await withGlobals({ console: { error() {} } }, () => action.track({
      operationKind: 'play', start: () => controller.playSelection({ operationKind: 'play' })
    }));
    const region = { innerHTML: '', querySelector: () => null };
    const translations = {
      'networkMusic.sharingRequired': 'Enable library sharing in Settings > Network, then Save.',
      'networkMusic.folderNotShared': 'Select the music folder in Settings > Network, then Save.'
    };
    LibraryView.prototype.updatePagedActionToast.call({
      uiManager: { networkMusic: controller }, t: key => translations[key] ?? key
    }, region, action.state);
    assert.match(region.innerHTML, /Settings &gt; Network, then Save/);
    assert.ok(region.innerHTML.includes(code === 'sharingRequired' ? 'Enable library sharing' : 'Select the music folder'));
    assert.ok(!region.innerHTML.includes('private backend diagnostic'));
    assert.ok(!region.innerHTML.includes('library.job.terminal.failed'));
    action.close();
  }
});

test('selected files use the captured network destination independently of library sharing', async () => {
  const requests = [];
  const { controller } = fixture({ networkMusicPlayFiles: async request => requests.push(request) });
  controller.selectedPlayerId = 'player-c';
  assert.equal(await controller.playFiles([{ path: 'C:/Music/song.flac' }], 'player-b'), true);
  assert.deepEqual(requests, [{ playerId: 'player-b', filePaths: ['C:/Music/song.flac'], operationKind: 'play' }]);
});

test('Open music files uses the native picker and cancels a selection whose playback target changed', async () => {
  const { controller, uiManager, calls } = fixture({ networkMusicPlayFiles: async request => calls.push(['files', request]) });
  controller.selectedPlayerId = 'player-b';
  uiManager.networkMusic = controller;
  let picked = Promise.resolve({ accepted: true, kind: 'normal', descriptors: [{ path: 'C:/Music/song.flac' }] });
  await withGlobals({ window: { uiManager, electronAPI: { openPlaybackSelection: () => picked } } }, async () => {
    await openMusicFile(true);
    assert.deepEqual(calls.find(([kind]) => kind === 'files')[1], {
      playerId: 'player-b', filePaths: ['C:/Music/song.flac'], operationKind: 'play'
    });
    const pending = deferred();
    picked = pending.promise;
    const opening = openMusicFile(true);
    controller.selectPlayer('player-c');
    pending.resolve({ accepted: true, kind: 'normal', descriptors: [{ path: 'C:/Music/next.flac' }] });
    await opening;
    assert.equal(calls.filter(([kind]) => kind === 'files').length, 1);
  });
});

test('external insertions send fresh-position intent instead of a cached queue anchor', async () => {
  const { controller, calls } = fixture();
  controller.selectedPlayerId = 'player-b';
  controller.playerStates.set('player-b', { currentId: 5, queue: [{ id: 5 }] });
  for (const kind of ['queue', 'queue', 'playNext']) await controller.playItems([{ serverId: 'server-a', trackId: kind }], kind);
  const requests = calls.filter(([kind]) => kind === 'command').map(([, request]) => request);
  assert.deepEqual(requests.map(request => request.position), ['end', 'end', 'afterCurrent']);
  assert.equal(requests.some(request => Object.hasOwn(request, 'afterId')), false);
});

test('network play preserves the requested start index for the selected native destination', async () => {
  const { controller, calls } = fixture();
  controller.selectedPlayerId = 'player-b';
  const items = ['same', 'middle', 'same'].map(trackId => ({ serverId: 'server-a', trackId }));
  await controller.playItems(items, 'play', 2);
  assert.deepEqual(calls.find(([kind]) => kind === 'command')[1], {
    playerId: 'player-b', action: 'replace', items, position: 'end', play: true, startIndex: 2
  });
});

function libraryPlaybackFixture(items, { total = items.length, pageSize = 100 } = {}) {
  const requests = [], commands = [];
  const { controller, uiManager } = fixture({ networkMusicBrowse: async request => {
    requests.push(request);
    return { items: items.slice(request.start, request.start + Math.min(pageSize, request.count)), total };
  } });
  controller.selectLibrary('server-a');
  controller.playItems = async (...args) => commands.push(args);
  const view = new NetworkMusicView({ controller, uiManager });
  return { controller, view, requests, commands };
}

test('row playback preserves the complete paged search order and clicked occurrence after filtering', async () => {
  const items = Array.from({ length: 205 }, (_, index) => ({ id: index === 202 ? 'track-2' : `track-${index}` }));
  items[0] = { id: 'folder', isContainer: true };
  items[1].playable = false;
  const { view, requests, commands } = libraryPlaybackFixture(items, { total: 0, pageSize: 73 });
  await view.playLibraryContext({ objectId: 'album', query: 'Music', sort: 'title', direction: 'desc', start: 146 }, 202);
  assert.deepEqual(requests.map(request => request.start), [0, 73, 146, 205]);
  assert.ok(requests.every(request => request.objectId === '0' && request.query === 'Music' && request.sortCriteria === '-dc:title'));
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0], [items.slice(2).map(item => ({ serverId: 'server-a', trackId: item.id })), 'play', 200]);
});

test('collection playback accepts 301 tracks and stops at the shared queue capacity', async () => {
  const items = Array.from({ length: 4097 }, (_, index) => ({ id: `track-${index}` }));
  const collection = libraryPlaybackFixture(items.slice(0, 301));
  await collection.view.playLibraryContainer({ id: 'artist' });
  assert.equal(collection.commands[0][0].length, 301);
  assert.equal(collection.commands[0][2], 0);
  assert.ok(collection.requests.every(request => request.objectId === 'artist'));
  for (const maximum of [500, 4096]) {
    const limited = libraryPlaybackFixture(items);
    limited.controller.state.queueTracksMax = maximum;
    await assert.rejects(limited.view.playLibraryContainer({ id: 'artist' }), { code: 'queueTooLarge' });
    assert.equal(limited.commands.length, 0);
    assert.equal(limited.requests.at(-1).start + limited.requests.at(-1).count, maximum + 1);
    assert.equal(limited.controller.errorKey({ code: 'queueTooLarge' }), 'networkMusic.queueFull');
  }
});

test('selection playback, focused keyboard actions and repeated context-menu occurrences remain distinct', async () => {
  const items = [{ id: 'same' }, { id: 'middle' }, { id: 'same' }];
  const { view, commands } = libraryPlaybackFixture(items);
  view.libraryRows = items.map(item => ({ item }));
  view.librarySelection = new Set([0, 2]);
  await view.playLibrarySelection('server-a', 'play');
  await view.playLibrarySelection('server-a', 'play', 2);
  await view.playLibrarySelection('server-a', 'play', 2, true);
  await view.playLibrarySelection('server-a', 'playNext', 1, true);
  assert.deepEqual(commands.map(([tracks, action, startIndex]) => [tracks.map(track => track.trackId), action, startIndex]), [
    [['same', 'same'], 'play', 0], [['same', 'same'], 'play', 1],
    [['same'], 'play', 0], [['middle'], 'playNext', 0]
  ]);
});

test('context gathering cannot play after its library view or destination changes', async () => {
  for (const change of ['view', 'source', 'destination']) {
    const { controller, view, commands } = libraryPlaybackFixture([{ id: 'song' }]);
    const pending = deferred();
    controller.api.networkMusicBrowse = () => pending.promise;
    const operation = view.playLibraryContainer({ id: 'album' });
    if (change === 'view') view.libraryRenderToken += 1;
    else if (change === 'source') controller.selectLibrary('local');
    else controller.selectPlayer('player-b');
    pending.resolve({ items: [{ id: 'song' }], total: 1 });
    await operation;
    assert.equal(commands.length, 0);
  }
});

test('remote listening controls publish refreshed transport, modes and queue to the common player', async t => {
  const songs = [{ id: 5, title: 'First', artist: 'Artist', artwork: 'https://music.example/first.png' }, { id: 8, title: 'Second' }];
  let remote = { queue: songs, currentId: 5, transportState: 'Playing', position: 12, duration: 180,
    repeat: false, shuffle: false, volume: 30, volumeMax: 80, capabilities: { seek: true, volume: true } };
  const commands = [];
  const { controller, uiManager, calls } = fixture({
    networkMusicGetPlayerState: async () => structuredClone(remote),
    networkMusicPlayerCommand: async request => { commands.push(request); }
  });
  t.after(() => controller.dispose());
  controller.selectPlayer('player-b');
  await new Promise(resolve => setImmediate(resolve));
  const adapter = new NetworkPlaybackAdapter(controller, 'player-b', {});
  const unsubscribe = controller.subscribe(() => adapter.sync());
  t.after(unsubscribe);
  const state = () => adapter.contextManager.getCurrentState();
  assert.equal(state().currentTrackName, 'Artist - First');
  assert.equal(state().artworkUrl, songs[0].artwork);
  assert.equal(state().seekBarEnabled, true);
  assert.deepEqual([state().volume, state().volumeMax, state().currentTrackPosition], [30, 80, 12]);

  remote = { ...remote, transportState: 'Paused' };
  await adapter.togglePlayPause();
  assert.equal(state().isPaused, true);
  remote = { ...remote, transportState: 'Playing' };
  await adapter.togglePlayPause();
  assert.equal(state().isPlaying, true);
  remote = { ...remote, currentId: 8, position: 0 };
  await adapter.playNext();
  assert.equal(state().currentTrackName, 'Second');
  assert.equal(state().currentTrackIndex, 1);
  remote = { ...remote, repeat: true };
  await adapter.playbackManager.toggleRepeatMode();
  assert.equal(state().repeatMode, 'ALL');
  remote = { ...remote, shuffle: true };
  await adapter.playbackManager.toggleShuffleMode();
  assert.equal(state().shuffleMode, true);
  const removed = state().playlist[0];
  remote = { ...remote, queue: [songs[1]] };
  await adapter.playbackManager.removeQueueEntry(removed);
  assert.deepEqual(state().playlist.map(track => track.id), [8]);
  assert.equal(state().currentTrackIndex, 0);
  assert.deepEqual(commands, [
    { playerId: 'player-b', action: 'pause' }, { playerId: 'player-b', action: 'play' },
    { playerId: 'player-b', action: 'next' }, { playerId: 'player-b', action: 'repeat', value: true },
    { playerId: 'player-b', action: 'shuffle', value: true }, { playerId: 'player-b', action: 'delete', id: 5 }
  ]);

  const errors = [];
  uiManager.setError = (...args) => errors.push(args);
  controller.api.networkMusicGetPlayerState = async () => { throw new Error('offline'); };
  controller.api.networkMusicPlayerCommand = async request => {
    commands.push(request);
    throw Object.assign(new Error('private connection detail'), { code: 'connectionFailed' });
  };
  await withGlobals({ console: { warn() {}, error() {} } }, async () => {
    await controller.refreshPlayer();
    assert.equal(state().controlsEnabled, false);
    assert.equal(state().seekBarEnabled, false);
    assert.equal(state().isStopped, true);
    controller.selectPlayer('local');
    assert.equal(await adapter.playNext(), false);
  });
  assert.deepEqual(commands.at(-1), { playerId: 'player-b', action: 'next' });
  assert.equal(controller.selectedPlayerId, 'local');
  assert.deepEqual(errors, [['networkMusic.pwa.connectionFailed', true]]);
  assert.deepEqual(calls, [], 'remote controls must never activate the local audio engine');
});

test('network initialization subscribes before discovery and disposal retires events and pending refresh', async t => {
  const discovered = deferred();
  const pendingState = deferred();
  const lifecycle = [];
  let stateEvent;
  const { controller, state } = fixture({
    onNetworkMusicState: listener => {
      stateEvent = listener;
      lifecycle.push('subscribe');
      return () => lifecycle.push('unsubscribe');
    },
    networkMusicGetState: async () => { lifecycle.push('initial'); return { ...state, libraries: [] }; },
    networkMusicDiscover: () => { lifecycle.push('discover'); return discovered.promise; },
    networkMusicGetPlayerState: () => pendingState.promise,
    dispose: () => lifecycle.push('dispose')
  });
  t.after(() => { if (!controller.disposed) controller.dispose(); });
  const notifications = [];
  controller.subscribe(() => notifications.push(controller.state));
  const initializing = controller.initialize();
  await Promise.resolve();
  assert.deepEqual(lifecycle, ['subscribe', 'initial', 'discover']);
  assert.deepEqual(controller.state.libraries, []);
  discovered.resolve(state);
  await initializing;
  assert.equal(controller.state.libraries[0].id, 'server-a');
  const renamed = { ...state, players: [{ id: 'player-b', name: 'Renamed room' }] };
  stateEvent(renamed);
  assert.equal(controller.state, renamed);
  controller.selectPlayer('player-b');
  controller.dispose();
  assert.deepEqual(lifecycle, ['subscribe', 'initial', 'discover', 'unsubscribe', 'dispose']);
  const emitted = notifications.length;
  stateEvent(state);
  pendingState.resolve({ queue: [{ id: 9, title: 'Stale queue' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.state, renamed);
  assert.equal(controller.playerStates.size, 0);
  assert.equal(notifications.length, emitted);
  assert.equal(controller.listeners.size, 0);
});

test('an expired PWA destination cannot reclaim presentation after a pending command and refresh finish', async t => {
  const previousState = deferred();
  const previousCommand = deferred();
  const shown = [];
  const commands = [];
  const { controller, uiManager, state, calls } = fixture({
    isPwa: true,
    networkMusicGetPlayerState: ({ playerId }) => playerId === 'player-b' ? previousState.promise
      : Promise.resolve({ queue: [{ id: 33, title: 'Current room' }], transportState: 'Playing' }),
    networkMusicPlayerCommand: request => { commands.push(request); return previousCommand.promise; }
  });
  t.after(() => controller.dispose());
  uiManager.networkMusicView = { showPlayer: async () => shown.push(controller.selectedPlayerId) };
  controller.selectPlayer('player-b');
  const command = controller.command('play');
  assert.equal(commands[0].isCurrent(), true);
  controller.applyState({ ...state, players: state.players.map(player => player.id === 'player-b'
    ? { ...player, available: false, authorizationRequired: true } : player) });
  assert.equal(controller.selectedPlayerId, 'player-b', 'expiration must not silently choose local playback');
  controller.selectPlayer('player-c');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(commands[0].isCurrent(), false);
  previousState.resolve({ queue: [{ id: 22, title: 'Expired room' }], transportState: 'Playing' });
  previousCommand.resolve({ accepted: false });
  await command;
  assert.equal(controller.selectedPlayerId, 'player-c');
  assert.equal(controller.playerStates.has('player-b'), false);
  assert.equal(controller.playerStates.get('player-c').queue[0].title, 'Current room');
  assert.deepEqual(shown, []);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].playerId, 'player-b');
  assert.deepEqual(calls, []);
  controller.dispose();
  assert.equal(commands[0].isCurrent(), false);
});

test('switching catalog categories restores each search, page, sort and collection trail independently', async t => {
  const { controller, uiManager } = fixture();
  t.after(() => controller.dispose());
  controller.selectLibrary('server-a');
  controller.selectPlayer('player-b');
  const location = { viewId: 'tracks', objectId: 'tracks-root', title: 'Tracks', start: 100,
    pageStarts: [0], trail: [], query: 'Evening', sort: 'artist', direction: 'desc', container: null, scrollTop: 0 };
  controller.libraryLocations.set('server-a', location);
  const view = new NetworkMusicView({ controller, uiManager });
  view.libraryContent = { scrollTop: 240 };
  const requests = [];
  view.renderLibrary = async () => requests.push(view.libraryBrowseRequest('server-a', location));
  await view.navigateLibraryView({ id: 'albums', objectId: 'albums-root' });
  assert.equal(location.query, '');
  assert.deepEqual(location.pageStarts, []);
  assert.equal(location.scrollTop, 0);
  view.libraryContent.scrollTop = 80;
  const album = { id: 'album-1', title: 'Open Skies', isContainer: true, upnpClass: 'object.container.album.musicAlbum' };
  await view.openLibraryContainer(album);
  assert.equal(location.trail[0].objectId, 'albums-root');
  assert.equal(location.trail[0].scrollTop, 80);
  assert.equal(location.container, album);
  Object.assign(location, { query: 'Morning', start: 100, pageStarts: [0], scrollTop: 150 });
  await view.applyLibrarySort('title');
  assert.deepEqual(requests.at(-1), { serverId: 'server-a', objectId: '0', query: 'Morning', start: 0, count: 100, sortCriteria: '+dc:title' });
  assert.deepEqual(location.pageStarts, []);
  await view.applyLibrarySort('title');
  assert.equal(requests.at(-1).sortCriteria, '-dc:title');
  view.libraryContent.scrollTop = 65;
  await view.navigateLibraryView({ id: 'tracks', objectId: 'tracks-root' });
  assert.deepEqual([location.query, location.start, location.pageStarts, location.scrollTop], ['Evening', 100, [0], 240]);
  assert.equal(requests.at(-1).sortCriteria, '-upnp:artist');
  view.libraryContent.scrollTop = 240;
  await view.navigateLibraryView({ id: 'albums', objectId: 'albums-root' });
  assert.equal(location.container, album);
  assert.equal(location.query, 'Morning');
  assert.equal(location.scrollTop, 65);
  assert.deepEqual(location.trail.map(entry => [entry.objectId, entry.scrollTop]), [['albums-root', 80]]);
  assert.equal(controller.selectedPlayerId, 'player-b');
  assert.equal(controller.selectedLibraryId, 'server-a');
});
