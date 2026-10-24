// End to end through the app's real WebSocket host (electron/remote-control-host.cjs)
// with a stand-in renderer, so a protocol change in the app breaks this test.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { WebSocketServer } from 'ws';
import { EffeTuneClient, toWebSocketUrl } from '../src/client.mjs';
import { createServer } from '../src/server.mjs';
import { applyOps } from '../../js/remote/sync-ops.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { RemoteControlHost, CHANNELS } = require(path.join(repoRoot, 'electron', 'remote-control-host.cjs'));

const TOKEN = 'tok-mcp';
const EFFECTS = [
    { nm: 'Mute', category: 'Basics', params: [] },
    { nm: 'Volume', category: 'Basics', params: [{ key: 'vl', type: 'number', default: 0, min: -60, max: 24 }] }
];

// Applies forwarded requests to a tiny pipeline model, like js/remote/remote-control.js.
function createRenderer() {
    const model = { epoch: 'feed0001', slot: 'A', masterBypass: false, pipeline: [{ nm: 'Volume', en: true, vl: 0 }], ids: ['h.1'] };
    const presets = { Quiet: [{ nm: 'Volume', en: true, vl: -20 }] };
    const requests = [];
    let next = 1;
    const run = message => {
        switch (message.op) {
            case 'hello': return { effects: EFFECTS.map(e => e.nm) };
            case 'describeEffects': return { effects: EFFECTS };
            case 'params': Object.assign(model.pipeline[message.index], message.params); return {};
            case 'chain': model.pipeline = message.pipeline; model.ids = message.pipeline.map(() => `h.${++next}`); return {};
            case 'bypass': model.masterBypass = message.on; return {};
            case 'listPresets': return { names: Object.keys(presets) };
            case 'getPreset': return { name: message.name, pipeline: presets[message.name] };
            case 'edit': {
                if (message.epoch !== model.epoch) return { ok: false, error: 'stale-epoch' };
                for (const op of message.ops) {
                    if (op.t === 'ins') {
                        model.pipeline.splice(op.at, 0, op.item);
                        model.ids.splice(op.at, 0, op.id);
                    } else if (op.t === 'del') {
                        const i = model.ids.indexOf(op.id);
                        model.pipeline.splice(i, 1);
                        model.ids.splice(i, 1);
                    } else if (op.t === 'mov') {
                        const i = model.ids.indexOf(op.id);
                        const [item] = model.pipeline.splice(i, 1);
                        model.ids.splice(i, 1);
                        model.pipeline.splice(op.at, 0, item);
                        model.ids.splice(op.at, 0, op.id);
                    }
                }
                return {};
            }
            default: return {};
        }
    };
    let host = null;
    const window = {
        isDestroyed: () => false,
        webContents: {
            send(channel, { requestId, message }) {
                if (channel !== CHANNELS.request) return;
                requests.push(message);
                setImmediate(() => {
                    const result = run(message);
                    host.handleRendererResponse({ requestId, ok: true, ...result, snapshot: JSON.parse(JSON.stringify(model)) });
                });
            }
        }
    };
    return { model, requests, window, attach: h => { host = h; } };
}

async function setup(t, serverOptions = {}, networkMusic = null, localPlayer = null) {
    const renderer = createRenderer();
    const host = new RemoteControlHost({
        app: { getAppPath: () => repoRoot, getVersion: () => '9.9.9', isPackaged: true },
        getMainWindow: () => renderer.window,
        networkMusic,
        env: { EFFETUNE_REMOTE: '1', EFFETUNE_REMOTE_TOKEN: TOKEN },
        argv: [],
        log: () => {}
    });
    renderer.attach(host);
    // Keep the PWA fixture out of this remote-v1 test while exercising its local target.
    host.localPlayer = localPlayer;
    host.bindWithFallback = server => new Promise((resolve, reject) => {
        const onError = error => reject(error);
        server.once('error', onError);
        server.listen(0, '127.0.0.1', () => {
            server.removeListener('error', onError);
            resolve(server.address().port);
        });
    });
    assert.equal(await host.start(), true);
    host.setRendererReady();
    const effetune = new EffeTuneClient({ url: `http://127.0.0.1:${host.port}/?t=${TOKEN}` });
    const server = createServer(effetune, serverOptions);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const mcp = new Client({ name: 'test', version: '0.0.0' });
    await mcp.connect(clientTransport);
    t.after(async () => {
        await mcp.close();
        await server.close();
        effetune.close();
        await host.dispose();
    });
    const call = async (name, args = {}) => {
        const result = await mcp.callTool({ name, arguments: args });
        const body = result.content[0].text;
        if (result.isError) return { error: body };
        try { return JSON.parse(body); } catch (_) { return body; }
    };
    return { renderer, call, mcp };
}

test('the pairing link becomes the WebSocket URL', () => {
    assert.equal(toWebSocketUrl('http://192.168.1.2:47300/?t=abc'), 'ws://192.168.1.2:47300/?t=abc');
    assert.throws(() => toWebSocketUrl('http://192.168.1.2:47300/'), /token/);
    assert.throws(() => toWebSocketUrl('not a url'), /pairing link/);
});

test('tools read the pipeline and the effect descriptions from the app', async t => {
    const { call } = await setup(t);
    const info = await call('connection_info');
    assert.ok(info.features.includes('describe1'));
    const pipeline = await call('get_pipeline');
    assert.deepEqual(pipeline.stages, [{ index: 0, id: 'h.1', nm: 'Volume', en: true, vl: 0 }]);
    assert.deepEqual(await call('list_effects'), [{ nm: 'Mute', category: 'Basics' }, { nm: 'Volume', category: 'Basics' }]);
    const [volume, unknown] = await call('describe_effects', { names: ['Volume', 'Nope'] });
    assert.equal(volume.params[0].key, 'vl');
    assert.equal(unknown.error, 'unknown effect');
});

test('tools edit the pipeline through params, edit and chain', async t => {
    const { call, renderer } = await setup(t);
    await call('set_params', { index: 0, params: { vl: -6 } });
    assert.equal(renderer.model.pipeline[0].vl, -6);

    let state = await call('add_effect', { name: 'Mute', position: 0 });
    assert.deepEqual(state.stages.map(s => s.nm), ['Mute', 'Volume']);
    state = await call('move_effect', { from: 0, to: 1 });
    assert.deepEqual(state.stages.map(s => s.nm), ['Volume', 'Mute']);
    state = await call('remove_effect', { index: 1 });
    assert.deepEqual(state.stages.map(s => s.nm), ['Volume']);
    assert.match((await call('remove_effect', { index: 5 })).error, /no stage at index 5/);

    state = await call('set_pipeline', { pipeline: [{ nm: 'Mute', en: true }] });
    assert.deepEqual(state.stages.map(s => s.nm), ['Mute']);
    state = await call('set_master_bypass', { on: true });
    assert.equal(state.masterBypass, true);
});

for (const { name, args, change, error } of [
    { name: 'add_effect', args: { name: 'Mute' }, change: { slot: 'B' }, error: 'slot-mismatch' },
    { name: 'move_effect', args: { from: 0, to: 1 }, change: { slot: 'B' }, error: 'slot-mismatch' },
    { name: 'remove_effect', args: { index: 0 }, change: { epoch: 'new-epoch' }, error: 'stale-epoch' }
]) {
    test(`${name} keeps the epoch and slot from the state used to choose its target`, async t => {
        const before = {
            epoch: 'old-epoch', rev: 1, slot: 'A',
            pipeline: [{ nm: 'Volume', en: true }, { nm: 'Mute', en: true }], ids: ['h.1', 'h.2']
        };
        const after = { ...before, ...change, pipeline: [{ nm: 'Compressor', en: true }], ids: ['h.1'] };
        let model = structuredClone(before);
        const remote = {
            connect: async () => ({}),
            hasFeature: () => true,
            async request(message) {
                if (message.op === 'get') {
                    const data = structuredClone(model);
                    // The user switches slots or the renderer restarts after this read.
                    model = structuredClone(after);
                    return { data };
                }
                assert.equal(message.op, 'edit');
                if (message.epoch !== model.epoch) throw new Error('stale-epoch');
                if (message.slot !== model.slot) throw new Error('slot-mismatch');
                const result = applyOps(model, message.ops);
                model = result.snapshot;
                return { ack: { ok: true, skipped: result.skipped } };
            }
        };
        const server = createServer(remote);
        const mcp = new Client({ name: 'test', version: '0.0.0' });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        t.after(async () => { await mcp.close(); await server.close(); });
        await server.connect(serverTransport);
        await mcp.connect(clientTransport);
        const result = await mcp.callTool({ name, arguments: args });
        assert.equal(result.isError, true);
        assert.equal(result.content[0].text, error);
        assert.deepEqual(model, after);
    });
}

test('preset tools, raw requests and app errors', async t => {
    const { call, renderer } = await setup(t, { allowRaw: true });
    assert.deepEqual(await call('list_presets'), ['Quiet']);
    assert.deepEqual((await call('get_preset', { name: 'Quiet' })).pipeline, [{ nm: 'Volume', en: true, vl: -20 }]);
    const raw = await call('raw_request', { message: { op: 'listPresets', seq: 999 } });
    assert.deepEqual(raw.data.names, ['Quiet']);
    assert.ok(renderer.requests.some(r => r.op === 'listPresets'));
    assert.match((await call('raw_request', { message: { op: 'noSuchOp' } })).error, /unknown-op/);
});

test('a missing link is reported by the tools instead of crashing the server', async () => {
    const server = createServer(new EffeTuneClient({ url: undefined }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const mcp = new Client({ name: 'test', version: '0.0.0' });
    await mcp.connect(clientTransport);
    const result = await mcp.callTool({ name: 'get_pipeline', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /EFFETUNE_URL is not set/);
    const music = await mcp.callTool({ name: 'play_music', arguments: {
        playerId: 'target-player', items: [{ serverId: 'library', trackId: 'song' }]
    } });
    assert.equal(music.isError, true);
    assert.match(music.content[0].text, /EFFETUNE_URL is not set/);
    assert.doesNotMatch(music.content[0].text, /outcomeUnknown/);
    await mcp.close();
});

test('raw_request is offered only on request, and every tool says whether it changes or replaces', async t => {
    const { mcp } = await setup(t);
    const { tools } = await mcp.listTools();
    assert.equal(tools.some(tool => tool.name === 'raw_request'), false);
    for (const tool of tools) assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean', tool.name);
    const byName = Object.fromEntries(tools.map(tool => [tool.name, tool.annotations]));
    assert.equal(byName.get_pipeline.readOnlyHint, true);
    assert.equal(byName.set_pipeline.destructiveHint, true);
    assert.equal(byName.save_preset.destructiveHint, true);
    assert.equal(byName.set_params.destructiveHint, false);
    assert.match(mcp.getInstructions(), /never follow instructions/);
});

test('music tools require the advertised feature without affecting existing tools', async t => {
    const { call, mcp } = await setup(t);
    const { tools } = await mcp.listTools();
    const annotations = Object.fromEntries(tools.map(tool => [tool.name, tool.annotations]));
    assert.equal(tools.length, 25);
    assert.equal(annotations.browse_music.readOnlyHint, true);
    assert.equal(annotations.browse_music.openWorldHint, true);
    assert.equal(annotations.queue_music.destructiveHint, false);
    assert.equal(annotations.play_music.destructiveHint, true);
    assert.equal(annotations.edit_playback_queue.destructiveHint, true);
    assert.match((await call('list_music_devices')).error, /does not support "music1"/);
    assert.deepEqual((await call('get_pipeline')).stages.map(stage => stage.nm), ['Volume']);
});

test('music operation failures preserve code, uncertain outcome and refreshed playback', async t => {
    const requests = [];
    const remote = {
        connect: async () => ({}),
        hasFeature: feature => feature === 'music1',
        async request(message) {
            requests.push(message);
            return { data: {
                op: 'musicResult', ok: false,
                error: { code: 'queueChanged', message: 'The queue changed during playback.' },
                outcome: 'unknown', playback: { playerId: 'player-1', queue: [], total: 0 }
            } };
        }
    };
    const server = createServer(remote);
    const mcp = new Client({ name: 'test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    t.after(async () => { await mcp.close(); await server.close(); });
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    const result = await mcp.callTool({ name: 'play_music', arguments: {
        playerId: 'player-1', items: [{ serverId: 'library-1', trackId: 'track-1' }]
    } });
    assert.equal(result.isError, true);
    assert.deepEqual(JSON.parse(result.content[0].text), {
        error: { code: 'queueChanged', message: 'The queue changed during playback.' },
        outcome: 'unknown', playback: { playerId: 'player-1', queue: [], total: 0 }
    });
    assert.deepEqual(requests, [{ op: 'playMusic', playerId: 'player-1', items: [{ serverId: 'library-1', trackId: 'track-1' }] }]);
    const invalid = await mcp.callTool({ name: 'control_playback', arguments: { playerId: 'player-1', action: 'pause', seconds: 5 } });
    assert.equal(invalid.isError, true);
    assert.equal(requests.length, 1, 'action-specific invalid input never reaches the app');
});

test('omitted music source and player pass through to host local defaults', async t => {
    const requests = [];
    const options = [];
    const remote = {
        connect: async () => ({}),
        hasFeature: feature => feature === 'music1',
        async request(message, requestOptions) {
            requests.push(message);
            options.push(requestOptions);
            return { data: { op: 'musicResult', ok: true, result: message.op === 'browseMusic'
                ? { serverId: 'local', items: [{ serverId: 'local', trackId: 'native-track' }], total: 1 }
                : { playerId: 'local:device', queue: [] } } };
        }
    };
    const server = createServer(remote);
    const mcp = new Client({ name: 'test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    t.after(async () => { await mcp.close(); await server.close(); });
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    const call = (name, args) => mcp.callTool({ name, arguments: args });
    const browse = await call('browse_music', { query: 'Blue' });
    assert.equal(JSON.parse(browse.content[0].text).serverId, 'local');
    await call('get_playback', {});
    await call('play_music', { items: [{ serverId: 'local', trackId: 'native-track' }] });
    await call('queue_music', { items: [{ serverId: 'local', trackId: 'native-track' }] });
    await call('control_playback', { action: 'pause' });
    await call('edit_playback_queue', { action: 'clear' });
    assert.deepEqual(requests.map(request => request.op), [
        'browseMusic', 'getPlayback', 'playMusic', 'queueMusic', 'controlPlayback', 'editPlaybackQueue'
    ]);
    for (const request of requests) assert.equal(Object.hasOwn(request, 'playerId'), false);
    assert.equal(Object.hasOwn(requests[0], 'serverId'), false);
    assert.deepEqual(requests[2].items, [{ serverId: 'local', trackId: 'native-track' }]);
    assert.deepEqual(options, [
        undefined, undefined, { timeoutMs: 150000 }, { timeoutMs: 150000 }, undefined, undefined
    ]);
});

async function setupDelayedMusic(t, mode) {
    const sent = [];
    const requests = [];
    class MusicSocket extends EventEmitter {
        static OPEN = 1;
        static CLOSING = 2;
        constructor() {
            super();
            this.readyState = 0;
            queueMicrotask(() => { this.readyState = 1; this.emit('open'); });
        }
        send(payload, callback) {
            const message = JSON.parse(payload);
            sent.push(message.op);
            requests.push(message);
            callback?.();
            const reply = (op, fields = {}) => this.emit('message', JSON.stringify({ op, seq: message.seq, ...fields }));
            if (message.op === 'hello') queueMicrotask(() => {
                reply('ack', { ok: true });
                reply('state', { features: ['music1'], epoch: 'test', rev: 1 });
            });
            else if (message.op === 'playMusic' && mode === 'closed') queueMicrotask(() => {
                reply('ack', { ok: true });
                this.readyState = 3;
                this.emit('close', 1006);
            });
            else if (message.op === 'playMusic') queueMicrotask(() => reply('ack', { ok: true }));
            else if (message.op === 'getPlayback' && mode !== 'readTimeout') queueMicrotask(() => {
                reply('ack', { ok: true });
                reply('musicResult', { ok: true, result: { playerId: 'target-player', transportState: 'Playing', queue: [], total: 0 } });
            });
        }
        close() { this.readyState = 3; this.emit('close', 1000); }
        terminate() { this.close(); }
    }
    const remote = new EffeTuneClient({ url: 'http://localhost/?t=test', WebSocketImpl: MusicSocket, requestTimeoutMs: 40 });
    const request = remote.request.bind(remote);
    remote.request = (message, options) => request(message, { ...options, timeoutMs: 40 });
    const server = createServer(remote);
    const mcp = new Client({ name: 'test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    t.after(async () => { await mcp.close(); await server.close(); remote.close(); });
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    return { mcp, sent, requests };
}

test('timed-out music mutations report uncertainty and read state on the same socket once', async t => {
    const { mcp, sent } = await setupDelayedMusic(t, 'timeout');
    const result = await mcp.callTool({ name: 'play_music', arguments: {
        playerId: 'target-player', items: [{ serverId: 'library', trackId: 'song' }]
    } });
    assert.equal(result.isError, true);
    assert.deepEqual(JSON.parse(result.content[0].text), {
        error: { code: 'outcomeUnknown', message: 'The playback command may have changed this player. Read get_playback for this playerId before retrying.' },
        playerId: 'target-player', outcome: 'unknown',
        playback: { playerId: 'target-player', transportState: 'Playing', queue: [], total: 0 }
    });
    assert.deepEqual(sent, ['hello', 'playMusic', 'getPlayback']);
});

test('uncertain local-default playback reads the same omitted target', async t => {
    const { mcp, sent, requests } = await setupDelayedMusic(t, 'timeout');
    const result = await mcp.callTool({ name: 'play_music', arguments: {
        items: [{ serverId: 'local', trackId: 'native-track' }]
    } });
    assert.equal(result.isError, true);
    const details = JSON.parse(result.content[0].text);
    assert.equal(details.outcome, 'unknown');
    assert.equal(details.playerId, undefined);
    assert.match(details.error.message, /get_playback without playerId/);
    assert.equal(details.playback.playerId, 'target-player');
    assert.equal(Object.hasOwn(requests[1], 'playerId'), false);
    assert.equal(Object.hasOwn(requests[2], 'playerId'), false);
    assert.deepEqual(sent, ['hello', 'playMusic', 'getPlayback']);
});

test('socket loss after a music mutation stays uncertain without reconnecting', async t => {
    const { mcp, sent } = await setupDelayedMusic(t, 'closed');
    const result = await mcp.callTool({ name: 'play_music', arguments: {
        playerId: 'target-player', items: [{ serverId: 'library', trackId: 'song' }]
    } });
    assert.equal(result.isError, true);
    const details = JSON.parse(result.content[0].text);
    assert.equal(details.outcome, 'unknown');
    assert.equal(details.playerId, 'target-player');
    assert.equal(details.playback, undefined);
    assert.deepEqual(sent, ['hello', 'playMusic']);
});

test('timed-out playback reads remain ordinary failures', async t => {
    const { mcp, sent } = await setupDelayedMusic(t, 'readTimeout');
    const result = await mcp.callTool({ name: 'get_playback', arguments: { playerId: 'target-player' } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /timeout waiting for getPlayback/);
    assert.doesNotMatch(result.content[0].text, /outcomeUnknown/);
    assert.deepEqual(sent, ['hello', 'getPlayback']);
});

test('music tools browse one source and control a different player through the app host', async t => {
    const commands = [];
    let queue = [];
    let currentId = 0;
    let transportState = 'Stopped';
    let nextId = 10;
    const state = () => ({
        playerId: 'target-player', transportState, currentId, position: 0, duration: 90,
        repeat: false, shuffle: false, volume: null, volumeMax: null,
        capabilities: { play: true, pause: true, volume: false },
        queue: queue.map(item => ({ ...item, uri: 'http://private.example/audio', metadata: '<private-path>D:\\Music</private-path>' }))
    });
    const networkMusic = {
        discovery: { socket: {}, loading: new Set() },
        onDiagnostic() {},
        async getState() {
            return {
                libraries: [{ id: 'source-library', name: 'Living room library', available: true, searchSupported: true, searchCaps: ['dc:title'], sortCaps: [], browseViews: [] }],
                players: [{ id: 'target-player', name: 'Bedroom EffeTune', available: true, isEffeTune: true }],
                sharing: { folderIds: ['private-folder'] }
            };
        },
        async discover() { return this.getState(); },
        async browse(request) {
            assert.equal(request.serverId, 'source-library');
            assert.equal(request.query, 'Blue');
            return {
                start: request.start, total: 2, numberReturned: 2, updateId: 9,
                items: [
                    { id: 'song-a', trackId: 'song-a', serverId: 'source-library', title: 'Blue A', artist: 'Artist', playable: true, uri: 'http://private.example/a', metadata: '<secret/>' },
                    { id: 'song-b', trackId: 'song-b', serverId: 'source-library', title: 'Blue B', artist: 'Artist', playable: true, uri: 'http://private.example/b', metadata: '<secret/>' }
                ]
            };
        },
        async getPlayerState({ playerId }) { assert.equal(playerId, 'target-player'); return state(); },
        async playerCommand(command) {
            assert.equal(command.playerId, 'target-player');
            commands.push(command);
            if (command.action === 'replace') {
                queue = command.items.map(item => ({ id: ++nextId, title: item.trackId }));
                currentId = queue[command.startIndex].id;
                transportState = command.play ? 'Playing' : 'Stopped';
            } else if (command.action === 'insert') {
                queue.push(...command.items.map(item => ({ id: ++nextId, title: item.trackId })));
            } else if (command.action === 'pause') transportState = 'Paused';
            return state();
        }
    };
    const { call, renderer } = await setup(t, {}, networkMusic);
    assert.ok((await call('connection_info')).features.includes('music1'));
    const devices = await call('list_music_devices');
    assert.ok(devices.libraries.some(library => library.serverId === 'source-library'));
    assert.equal(devices.players[0].playerId, 'target-player');
    assert.equal(devices.sharing, undefined);
    const page = await call('browse_music', { serverId: 'source-library', query: 'Blue' });
    assert.deepEqual(page.items.map(item => item.trackId), ['song-a', 'song-b']);
    assert.equal(page.items[0].uri, undefined);
    const selected = [{ serverId: 'source-library', trackId: 'song-a' }, { serverId: 'source-library', trackId: 'song-a' }];
    const playing = await call('play_music', { playerId: 'target-player', items: selected, startIndex: 1 });
    assert.equal(playing.transportState, 'Playing');
    assert.deepEqual(playing.queue.map(item => item.title), ['song-a', 'song-a']);
    assert.equal(playing.currentId, playing.queue[1].id);
    assert.equal(playing.queue[0].uri, undefined);
    await call('queue_music', { playerId: 'target-player', items: [{ serverId: 'source-library', trackId: 'song-b' }], position: 'afterCurrent' });
    assert.equal(commands[1].action, 'insert');
    assert.equal(commands[1].position, 'afterCurrent');
    assert.equal(commands[1].play, false);
    const paused = await call('control_playback', { playerId: 'target-player', action: 'pause' });
    assert.equal(paused.transportState, 'Paused');
    const playback = await call('get_playback', { playerId: 'target-player', start: 1, count: 1 });
    assert.equal(playback.total, 3);
    assert.equal(playback.numberReturned, 1);
    assert.equal(playback.queue[0].title, 'song-a');
    assert.deepEqual(renderer.requests.map(request => request.op), ['hello']);
});

test('music tools use the private local library and local player by default', async t => {
    const operations = [];
    const localPlayer = { controlId: 'local:device', name: 'This EffeTune', available: true };
    const networkMusic = {
        sharing: { enabled: false, folderIds: [] },
        onDiagnostic() {},
        async localLibraryAvailable() { return true; },
        async getState() {
            return { libraries: [{ id: 'network-library', name: 'LAN library', available: true, searchSupported: true }], players: [], sharing: this.sharing };
        },
        async discover() { return this.getState(); },
        async browse({ serverId, query = '', start = 0 }) {
            operations.push({ kind: 'browse', serverId, query });
            const items = serverId === 'local' && (!query || query === 'Local')
                ? [{ serverId: 'local', trackId: 'private-track', id: 'private-track', title: 'Local song', playable: true }]
                : serverId === 'network-library'
                    ? [{ serverId: 'network-library', trackId: 'remote-track', id: 'remote-track', title: 'Remote song', playable: true }]
                    : [];
            return { start, total: items.length, numberReturned: items.length, updateId: 1, items };
        },
        async getPlayerState({ playerId }) {
            operations.push({ kind: 'state', playerId });
            return { playerId, transportState: 'Playing', currentId: 1, queue: [{ id: 1, title: 'Local song' }] };
        },
        async playerCommand(command) {
            operations.push({ kind: 'command', playerId: command.playerId, items: command.items });
            return this.getPlayerState({ playerId: command.playerId });
        }
    };
    const { call } = await setup(t, {}, networkMusic, localPlayer);
    const devices = await call('list_music_devices');
    assert.equal(devices.libraries[0].serverId, 'local');
    assert.equal(devices.players.at(-1).playerId, 'local:device');
    const localPage = await call('browse_music');
    assert.equal(localPage.serverId, 'local');
    assert.equal(localPage.items[0].trackId, 'private-track');
    assert.equal((await call('browse_music', { query: 'Local' })).serverId, 'local');
    const playing = await call('play_music', { items: [{ serverId: localPage.serverId, trackId: localPage.items[0].trackId }] });
    assert.equal(playing.playerId, 'local:device');
    assert.equal(networkMusic.sharing.enabled, false);
    assert.deepEqual(operations.find(operation => operation.kind === 'command'), {
        kind: 'command', playerId: 'local:device', items: [{ serverId: 'local', trackId: 'private-track' }]
    });
    const fallback = await call('browse_music', { query: 'Remote' });
    assert.equal(fallback.serverId, 'network-library');
    assert.equal(fallback.items[0].serverId, 'network-library');
    assert.deepEqual(operations.filter(operation => operation.kind === 'browse').map(({ serverId }) => serverId), [
        'local', 'local', 'local', 'network-library'
    ]);
});

// A stand-in endpoint on another port: closes like the app does, or sends a frame.
async function fakeEndpoint(t, onConnection) {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise(resolve => wss.once('listening', resolve));
    wss.on('connection', onConnection);
    t.after(() => new Promise(resolve => wss.close(resolve)));
    return `http://127.0.0.1:${wss.address().port}/?t=${TOKEN}`;
}

test('a token the app refuses is reported as such', async t => {
    const url = await fakeEndpoint(t, ws => ws.close(4401));
    await assert.rejects(new EffeTuneClient({ url }).connect(), /refused the token \(4401\)/);
});

test('frames larger than the app ever sends are refused', async t => {
    const url = await fakeEndpoint(t, ws => ws.once('message', () => ws.send('x'.repeat(4 * 1024 * 1024 + 1))));
    await assert.rejects(new EffeTuneClient({ url }).connect(), /1009/);
});
