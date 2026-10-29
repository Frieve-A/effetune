'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { RemoteControlHost } = require('../../electron/remote-control-host.cjs');
const { NetworkMusicHost } = require('../../electron/network-music-host.cjs');
const { dispatchMusic } = require('../../electron/remote-music-dispatcher.cjs');
const { PWA_ORIGIN } = require('../../electron/pwa-network-host.cjs');

const current = () => true;
const state = () => ({ playerId: 'target', transportState: 'Playing', currentId: 7, position: 3,
  duration: 40, repeat: false, shuffle: true, volume: null, volumeMax: null,
  capabilities: { play: true, volume: false }, queue: [{ id: 7, title: 'Song', artist: 'Artist',
    album: 'Album', duration: 40, uri: 'http://private/music', artwork: 'file:///private', metadata: '<secret/>' }] });

function music() {
  const calls = [];
  return { calls, discovery: { socket: {}, loading: new Set() }, onDiagnostic() {},
    async getState() { calls.push('getState'); return { libraries: [], players: [], sharing: { folderIds: ['secret'] } }; },
    async discover() { calls.push('discover'); return this.getState(); },
    async browse(request) { calls.push(['browse', request]); return { start: request.start, total: null,
      updateId: 2, items: [{ serverId: request.serverId, trackId: 'track', id: 'track', parentId: '0',
        title: 'Song', uri: 'http://private/music', metadata: '<secret/>', artwork: 'file:///private',
        resources: [{ uri: 'http://private/music' }], playable: true }] }; },
    async getPlayerState(request) { calls.push(['getPlayerState', request]); return state(); },
    async playerCommand(request) { calls.push(['playerCommand', request]); return state(); }
  };
}

test('music hello and replies work without a renderer and do not change pipeline revision', async () => {
  const networkMusic = music();
  const host = new RemoteControlHost({ app: { getVersion: () => '1.0' }, getMainWindow: () => null,
    networkMusic, env: { EFFETUNE_REMOTE_TOKEN: 'music-token' }, argv: [], log: () => {} });
  const sent = [];
  const ws = new EventEmitter();
  ws.readyState = 1; ws.send = value => sent.push(JSON.parse(value)); ws.close = () => {};
  host.wss = { clients: new Set([ws]) }; host.listening = true;
  host.onConnection(ws, { url: '/?t=music-token', socket: { remoteAddress: '127.0.0.1' } });
  await host.onMessage(ws, JSON.stringify({ op: 'hello', v: 1, seq: 1 }));
  assert.equal(sent.find(reply => reply.op === 'ack' && reply.seq === 1)?.ok, true);
  assert.ok(sent.find(reply => reply.op === 'state' && reply.seq === 1)?.features.includes('music1'));
  await host.onMessage(ws, JSON.stringify({ op: 'listMusicDevices', seq: 2 }));
  assert.equal(sent.find(reply => reply.op === 'ack' && reply.seq === 2)?.ok, true);
  assert.equal(sent.find(reply => reply.op === 'musicResult' && reply.seq === 2)?.ok, true);
  assert.equal(host.rev, 0);
  assert.equal(host.requestSeq, 0);
  host.token = 'revoked';
  await host.onMessage(ws, JSON.stringify({ op: 'listMusicDevices', seq: 3 }));
  assert.equal(sent.find(reply => reply.op === 'musicResult' && reply.seq === 3)?.error.code, 'unauthorized');
  assert.equal(networkMusic.calls.filter(call => call === 'getState').length, 1);
});

test('music1 queue authorization survives controller disconnect but expires when the token changes', async () => {
  const networkMusic = music();
  const host = new RemoteControlHost({ app: { getVersion: () => '1.0' }, getMainWindow: () => null,
    networkMusic, env: { EFFETUNE_REMOTE_TOKEN: 'queue-token' }, argv: [], log() {} });
  const ws = new EventEmitter(); ws.readyState = 1; ws.send = () => {}; ws.close = () => {};
  host.wss = { clients: new Set([ws]) }; host.listening = true;
  host.onConnection(ws, { url: '/?t=queue-token', socket: { remoteAddress: '127.0.0.1' } });
  await host.onMessage(ws, JSON.stringify({ op: 'playMusic', seq: 1, playerId: 'target', items: [{ serverId: 'source', trackId: 'track' }] }));
  const command = networkMusic.calls.find(call => call[0] === 'playerCommand')[1];
  assert.equal(command.isCurrent(), true); assert.equal(command.isAuthorized(), true);
  ws.readyState = 3;
  assert.equal(command.isCurrent(), false); assert.equal(command.isAuthorized(), true);
  host.token = 'revoked'; assert.equal(command.isAuthorized(), false);
});

test('PWA effects sockets deny music1 before dispatch when gateway access is absent or revoked while native music1 remains available', async t => {
  for (const initiallyAllowed of [false, true]) await t.test(initiallyAllowed ? 'gateway permission revoked' : 'gateway permission never granted', async t => {
    const networkMusic = Object.assign(new EventEmitter(), music());
    networkMusic.gatewayPermissions = { libraries: initiallyAllowed, players: initiallyAllowed };
    const localPlayer = { id: 'local', controlId: 'local:local', name: 'Local player',
      host: { setLocalControlEnabled() {}, cancelStaleLocalActions() {} } };
    const host = new RemoteControlHost({ app: { getVersion: () => 'test' }, getMainWindow: () => null,
      networkMusic, localPlayer, env: { EFFETUNE_REMOTE_TOKEN: 'effects-token' }, argv: [], log() {} });
    const effectCalls = [];
    host.enqueue = async request => { effectCalls.push(request.op); return { ok: true, effects: [] }; };
    t.after(async () => { host.wss = null; await host.dispose(); });
    const connect = url => {
      const sent = [];
      const ws = new EventEmitter();
      ws.readyState = 1; ws.send = value => sent.push(JSON.parse(value)); ws.close = () => {};
      const request = { url, headers: { host: '127.0.0.1', origin: PWA_ORIGIN }, socket: { remoteAddress: '127.0.0.1' } };
      return { ws, sent, request };
    };
    const pwa = connect('/pwa/v1/effects?t=effects-token');
    host.wss = { clients: new Set([pwa.ws]) }; host.listening = true;
    assert.equal(host.pwa.acceptsUpgrade(pwa.request), true, 'The real PWA upgrade accepts this effects endpoint');
    host.onConnection(pwa.ws, pwa.request);
    for (const rendererReady of [false, true]) {
      host.rendererReady = rendererReady;
      await host.onMessage(pwa.ws, JSON.stringify({ op: 'hello', v: 1, seq: rendererReady ? 2 : 1 }));
      const greeting = pwa.sent.filter(reply => reply.op === 'state').at(-1);
      assert.ok(greeting.features.includes('describe1'));
      assert.equal(greeting.features.includes('music1'), false);
    }
    if (initiallyAllowed) {
      networkMusic.gatewayPermissions = { libraries: false, players: false };
      networkMusic.emit('state');
    }
    const operations = [
      { op: 'listMusicDevices' },
      { op: 'browseMusic', serverId: 'third-party-library' },
      { op: 'getPlayback', playerId: 'third-party-player' },
      { op: 'playMusic', playerId: 'third-party-player', items: [{ serverId: 'third-party-library', trackId: 'song' }] },
      { op: 'queueMusic', playerId: 'third-party-player', items: [{ serverId: 'third-party-library', trackId: 'song' }] },
      { op: 'controlPlayback', playerId: 'third-party-player', action: 'stop' },
      { op: 'editPlaybackQueue', playerId: 'third-party-player', action: 'clear' }
    ];
    for (const [index, operation] of operations.entries()) {
      const seq = index + 10;
      await host.onMessage(pwa.ws, JSON.stringify({ ...operation, seq }));
      assert.deepEqual(pwa.sent.at(-1), { op: 'ack', seq, ok: false, error: 'unauthorized' });
    }
    assert.deepEqual(networkMusic.calls, [], 'No music request from the effects socket reaches a host operation');
    await host.onMessage(pwa.ws, JSON.stringify({ op: 'params', seq: 20, index: 0, params: { vl: -6 } }));
    assert.equal(pwa.sent.at(-1).ok, true);
    assert.ok(effectCalls.includes('params'), 'The PWA effects protocol remains available');
    const native = connect('/?t=effects-token');
    delete native.request.headers.origin;
    host.wss.clients.add(native.ws); host.onConnection(native.ws, native.request);
    await host.onMessage(native.ws, JSON.stringify({ op: 'hello', v: 1, seq: 30 }));
    assert.equal(native.sent.find(reply => reply.op === 'state').features.includes('music1'), true);
    for (const [index, operation] of [operations[1], operations[5]].entries()) {
      const seq = index + 31;
      await host.onMessage(native.ws, JSON.stringify({ ...operation, seq }));
      assert.equal(native.sent.find(reply => reply.op === 'musicResult' && reply.seq === seq).ok, true);
    }
    assert.ok(networkMusic.calls.some(call => call[0] === 'browse' && call[1].serverId === 'third-party-library'));
    assert.ok(networkMusic.calls.some(call => call[0] === 'playerCommand' && call[1].playerId === 'third-party-player' && call[1].action === 'stop'));
    host.token = 'rotated-token';
    assert.equal(pwa.ws.isCurrentPwaSession(), false);
    const frameCount = pwa.sent.length; const callCount = networkMusic.calls.length;
    pwa.ws.emit('message', Buffer.from(JSON.stringify({ ...operations[5], seq: 40 })), false);
    assert.equal(pwa.sent.length, frameCount, 'The existing stale-session frame guard drops the message');
    await host.onMessage(pwa.ws, JSON.stringify({ ...operations[5], seq: 41 }));
    assert.deepEqual(pwa.sent.at(-1), { op: 'ack', seq: 41, ok: false, error: 'unauthorized' });
    assert.equal(networkMusic.calls.length, callCount, 'An expired PWA session never falls back to native music1');
  });
});

test('host validation rejects unknown fields, wrong values and arbitrary track payloads before effects', async () => {
  const networkMusic = music();
  const invalid = [
    { op: 'browseMusic', serverId: 'source', count: 501 },
    { op: 'browseMusic', serverId: 'source', query: 'x'.repeat(513) },
    { op: 'playMusic', playerId: 'target', items: [{ serverId: 'source', trackId: 'track', uri: 'http://x' }] },
    { op: 'queueMusic', playerId: 'target', items: [{ serverId: 'source', trackId: 'track' }], position: 'front' },
    { op: 'controlPlayback', playerId: 'target', action: 'pause', value: true },
    { op: 'controlPlayback', playerId: 'target', action: 'volume', value: 1001 },
    { op: 'editPlaybackQueue', playerId: 'target', action: 'clear', id: 7 },
    { op: 'getPlayback', playerId: '', count: 1 }
  ];
  for (const request of invalid) {
    const reply = await dispatchMusic(networkMusic, null, request, current);
    assert.equal(reply.error.code, 'invalidRequest');
  }
  assert.deepEqual(networkMusic.calls, []);
});

test('browse and playback projections strip private transport fields and bound pages', async () => {
  const networkMusic = music();
  const page = await dispatchMusic(networkMusic, null, { op: 'browseMusic', serverId: 'source', count: 1 }, current);
  assert.equal(page.result.items[0].serverId, 'source');
  assert.equal(page.result.total, null);
  assert.equal(page.result.numberReturned, 1);
  assert.ok(!JSON.stringify(page).includes('http://private'));
  const playback = await dispatchMusic(networkMusic, null, { op: 'getPlayback', playerId: 'target', start: 1, count: 1 }, current);
  assert.deepEqual(playback.result.queue, []);
  assert.equal(playback.result.total, 1);
  assert.equal(playback.result.currentTrack.id, 7);
  assert.equal(playback.result.capabilities.volume, false);
  assert.ok(!JSON.stringify(playback).includes('private'));
});

test('device results use the real local control ID and omit sharing settings', async () => {
  const networkMusic = music();
  networkMusic.getState = async () => ({ libraries: [{ id: 'source', name: 'L'.repeat(1000), available: true,
    searchSupported: true, sortCaps: ['dc:title'], browseViews: [{ id: 'tracks', objectId: 'view:tracks' }] }],
  players: [{ id: 'remote', name: 'Living room', available: false, isEffeTune: true }], sharing: { folderIds: ['secret'] } });
  const localPlayer = { id: 'uuid:local', controlId: 'local:uuid:local', name: 'This EffeTune', available: false };
  const reply = await dispatchMusic(networkMusic, localPlayer, { op: 'listMusicDevices' }, current);
  assert.equal(reply.result.libraries[0].serverId, 'local');
  assert.equal(reply.result.libraries[1].serverId, 'source');
  assert.equal(reply.result.libraries[1].name.length, 512);
  assert.equal(reply.result.players[1].playerId, localPlayer.controlId);
  assert.equal(reply.result.players[1].available, false);
  assert.equal(Object.hasOwn(reply.result, 'discoveryPending'), false);
  assert.equal(reply.result.queueTracksMax, 4096);
  assert.ok(!JSON.stringify(reply).includes('secret'));
});

test('serialized Unicode music replies remain below the remote frame cap', async () => {
  const networkMusic = music();
  const longText = 'あ'.repeat(512);
  const longId = 'x'.repeat(1024);
  networkMusic.browse = async () => ({ start: 0, total: 480, updateId: 1,
    items: Array.from({ length: 480 }, () => ({ serverId: longId, trackId: longId, id: longId,
      parentId: longId, title: longText, artist: longText, album: longText, genre: longText,
      playable: true })) });
  const host = new RemoteControlHost({ app: { getVersion: () => '1.0' }, getMainWindow: () => null,
    networkMusic, env: { EFFETUNE_REMOTE_TOKEN: 'music-token' }, argv: [], log: () => {} });
  const frames = [];
  const ws = { readyState: 1, isCurrentMusicSession: current,
    send(value) { frames.push(value); } };
  await host.onMessage(ws, JSON.stringify({ op: 'browseMusic', seq: 7, serverId: 'source', count: 480 }));
  const reply = JSON.parse(frames.find(frame => JSON.parse(frame).op === 'musicResult'));
  assert.equal(reply.ok, false);
  assert.equal(reply.error.code, 'responseTooLarge');
  assert.ok(frames.every(frame => Buffer.byteLength(frame) < 4 * 1024 * 1024));
});

test('source references and explicit target pass unchanged to the serialized command owner', async () => {
  const networkMusic = music();
  const items = [{ serverId: 'source', trackId: 'same' }, { serverId: 'source', trackId: 'same' }];
  const reply = await dispatchMusic(networkMusic, null, { op: 'playMusic', playerId: 'target', items, startIndex: 1 }, current);
  assert.equal(reply.ok, true);
  const command = networkMusic.calls.find(call => Array.isArray(call) && call[0] === 'playerCommand')[1];
  assert.equal(command.playerId, 'target');
  assert.deepEqual(command.items, items);
  assert.equal(command.action, 'replace');
  assert.equal(command.play, true);
  assert.equal(command.startIndex, 1);
  assert.equal(command.isCurrent(), true);
  assert.equal(reply.result.queue.length, 1);
  const queued = await dispatchMusic(networkMusic, null, { op: 'queueMusic', playerId: 'target', items, position: 'afterCurrent' }, current);
  assert.equal(queued.ok, true);
  const next = networkMusic.calls.filter(call => Array.isArray(call) && call[0] === 'playerCommand').at(-1)[1];
  assert.equal(next.action, 'insert');
  assert.equal(next.position, 'afterCurrent');
  assert.equal(next.play, false);
});

test('omitted browse source searches local first and falls back only after zero local matches', async () => {
  const networkMusic = music();
  networkMusic.getState = async () => ({ libraries: [
    { id: 'remote-b', available: true, searchSupported: true },
    { id: 'remote-a', available: false, searchSupported: true }
  ], players: [] });
  networkMusic.browse = async request => {
    networkMusic.calls.push(request.serverId);
    return { start: request.start, total: request.serverId === 'remote-b' ? 1 : 0,
      items: request.serverId === 'remote-b' ? [{ serverId: 'remote-b', trackId: 'hit', id: 'hit', title: 'Hit', playable: true }] : [] };
  };
  const found = await dispatchMusic(networkMusic, null, { op: 'browseMusic', query: 'Hit' }, current);
  assert.equal(found.result.serverId, 'remote-b');
  assert.deepEqual(networkMusic.calls, ['local', 'remote-b']);
  assert.deepEqual(found.result.searchedSources.map(source => source.outcome), ['noMatches', 'unavailable', 'matched']);
  networkMusic.calls.length = 0;
  await dispatchMusic(networkMusic, null, { op: 'browseMusic', serverId: 'local', query: 'Hit' }, current);
  await dispatchMusic(networkMusic, null, { op: 'browseMusic' }, current);
  assert.deepEqual(networkMusic.calls, ['local', 'local']);
  networkMusic.calls.length = 0;
  networkMusic.browse = async request => { networkMusic.calls.push(request.serverId); return { start: 20, total: 3, items: [] }; };
  const laterPage = await dispatchMusic(networkMusic, null, { op: 'browseMusic', query: 'Hit', start: 20 }, current);
  assert.equal(laterPage.result.serverId, 'local');
  assert.deepEqual(networkMusic.calls, ['local']);
  networkMusic.calls.length = 0;
  networkMusic.browse = async request => { networkMusic.calls.push(request.serverId); throw new Error('private catalog failure'); };
  const failed = await dispatchMusic(networkMusic, null, { op: 'browseMusic', query: 'Hit' }, current);
  assert.equal(failed.ok, false);
  assert.deepEqual(networkMusic.calls, ['local'], 'A local catalog failure is not a zero-match result');
});

test('omitted player uses the actual available local control ID for reads and commands', async () => {
  const networkMusic = music();
  const localPlayer = { controlId: 'local:uuid:real', available: true };
  const playback = await dispatchMusic(networkMusic, localPlayer, { op: 'getPlayback' }, current);
  assert.equal(playback.ok, true);
  assert.equal(networkMusic.calls[0][1].playerId, localPlayer.controlId);
  const command = await dispatchMusic(networkMusic, localPlayer, { op: 'controlPlayback', action: 'pause' }, current);
  assert.equal(command.ok, true);
  assert.equal(networkMusic.calls.at(-1)[1].playerId, localPlayer.controlId);
  localPlayer.available = false;
  const unavailable = await dispatchMusic(networkMusic, localPlayer, { op: 'getPlayback' }, current);
  assert.equal(unavailable.error.code, 'unavailable');
});

test('preflight failure stays definite, while post-mutation failures preserve unknown outcome without retry', async () => {
  const networkMusic = music();
  let attempts = 0;
  networkMusic.playerCommand = async command => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error('Queue full'), { code: 'queueFull' });
    command.mutationStarted = true;
    throw Object.assign(new Error('Queue changed'), { code: 'queueChanged' });
  };
  const request = { op: 'playMusic', playerId: 'target', items: [{ serverId: 'source', trackId: 'track' }] };
  const preflight = await dispatchMusic(networkMusic, null, request, current);
  assert.equal(preflight.error.code, 'queueFull');
  assert.equal(preflight.outcome, undefined);
  const partial = await dispatchMusic(networkMusic, null, request, current);
  assert.equal(partial.error.code, 'queueChanged');
  assert.equal(partial.outcome, 'unknown');
  assert.equal(partial.playback.queue[0].id, 7);
  assert.equal(attempts, 2);
  networkMusic.getPlayerState = async () => { throw new Error('private read detail'); };
  const unreadable = await dispatchMusic(networkMusic, null, request, current);
  assert.equal(unreadable.outcome, 'unknown');
  assert.equal(unreadable.playback, undefined);
  assert.equal(attempts, 3);
});

test('NetworkMusicHost checks revocation after asynchronous preflight and before mutation', async () => {
  const host = Object.create(NetworkMusicHost.prototype);
  host.queues = new Map(); host.playerGenerations = new Map(); host.fileSources = new Map();
  host.pruneFiles = () => {};
  host.device = () => ({ address: '127.0.0.1', services: new Map() });
  const actions = [];
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  host.invoke = async (_endpoint, action) => { actions.push(action); if (action === 'TracksMax') { await gate; return { Value: 10 }; } return {}; };
  host.getPlayerState = async () => ({ queue: [], currentId: 0, protocolInfo: 'http-get:*:audio/flac:*' });
  host.getRouteAddress = async () => '127.0.0.1';
  host.resolveTrack = async () => ({ uri: 'http://127.0.0.1/a', metadata: '<item/>', resources: [{ uri: 'http://127.0.0.1/a', protocolInfo: 'http-get:*:audio/flac:*' }] });
  let authorized = true;
  const command = { playerId: 'target', action: 'replace', items: [{ serverId: 'source', trackId: 'track' }], play: true, isCurrent: () => authorized };
  const operation = host.playerCommand(command);
  await new Promise(resolve => setImmediate(resolve));
  authorized = false;
  resume();
  await assert.rejects(operation, { code: 'unauthorized' });
  assert.equal(command.mutationStarted, undefined);
  assert.equal(actions.includes('DeleteAll'), false);
});

test('NetworkMusicHost passes the session predicate to a local endpoint mutation', async () => {
  const host = Object.create(NetworkMusicHost.prototype);
  let receivedPredicate;
  const endpoint = { invoke: async (_action, _args, isCurrent) => { receivedPredicate = isCurrent; return {}; } };
  host.device = () => ({ services: new Map([['urn:av-openhome-org:service:Playlist', endpoint]]) });
  host.invoke = (target, action, args, isCurrent) => target.invoke(action, args, isCurrent);
  host.getPlayerState = async () => state();
  host.pruneFiles = () => {};
  const isCurrent = () => true;
  const request = { playerId: 'local:uuid:local', action: 'play', isCurrent };
  await host.executeCommand(request);
  assert.equal(receivedPredicate, isCurrent);
  assert.equal(request.mutationStarted, true);
});
