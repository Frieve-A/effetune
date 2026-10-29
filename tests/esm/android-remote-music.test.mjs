import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { createAndroidMusicService } from '../../js/android/remote-music-service.js';
import { createAndroidRemoteApi } from '../../js/android/remote.js';
import { withGlobals, createConsoleHarness } from '../helpers/global-test-utils.mjs';
const require = createRequire(import.meta.url);
const { dispatchMusic } = require('../../electron/remote-music-dispatcher.cjs');
const local = { controlId: 'local', name: 'EffeTune', available: true };

// Android packages this shared dispatcher as ESM beside remote.js.
const protocolHook = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === './remote-music-protocol.js' && context.parentURL === new URL('../../js/android/remote.js', import.meta.url).href) {
        return nextResolve(new URL('../../electron/remote-music-dispatcher.cjs', import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
} });
after(() => protocolHook.deregister());

function remoteFixture(handle) {
    const listeners = new Map(), requests = [];
    const api = createAndroidRemoteApi({
        on(name, listener) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(listener);
            return () => listeners.get(name).delete(listener);
        },
        async request(command, payload) {
            requests.push({ command, payload });
            return await handle?.(command, payload) ?? {};
        }
    });
    return { api, requests,
        count: name => listeners.get(name)?.size || 0,
        emit: (name, value) => Promise.all([...(listeners.get(name) || [])].map(listener => listener(value))) };
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

test('Android remote request entry dispatches music and replies with its request ID and current public state', async () => {
    const networkCalls = [];
    const network = {
        async networkMusicResolveTrack(request) {
            networkCalls.push(request);
            return { uri: 'https://music.example/song', title: 'Song' };
        },
        async networkMusicGetPlayerState(request) { return { playerId: request.playerId, queue: [], transportState: 'Stopped' }; },
        async networkMusicPlayerCommand(request) {
            assert.equal(request.playerId, 'remote-player');
            assert.equal(request.action, 'insert');
            return { playerId: request.playerId, queue: [], transportState: 'Stopped' };
        },
        async networkMusicBrowse() { throw Object.assign(new Error('Private provider failure'), { code: 'unavailable' }); }
    };
    await withGlobals({ window: { uiManager: { networkMusic: { api: network } } },
        console: createConsoleHarness({ debug() {} }) }, async () => {
        for (const message of [
            { op: 'playMusic', items: [{ serverId: 'server', trackId: 'song' }] },
            { op: 'queueMusic', items: [{ serverId: 'server', trackId: 'song' }] },
            { op: 'queueMusic', playerId: 'remote-player', items: [{ serverId: 'server', trackId: 'song' }] },
            { op: 'getPlayback', playerId: 'remote-player' },
            { op: 'playMusic', items: [] },
            { op: 'browseMusic', serverId: 'server' }
        ]) {
            let publicState;
            const fixture = remoteFixture(command => {
                if (command === 'snapshot.get') return { playback: { index: 0, queueLength: 1 } };
                if (command === 'playback.getPublic') {
                    publicState = { playerId: 'local', queue: [], transportState: 'Playing', nativeRevision: (publicState?.nativeRevision || 0) + 1 };
                    return publicState;
                }
            });
            const off = fixture.api.onRequest(() => assert.fail('Music must use its dispatcher'));
            const requestId = `request-${message.op}`;
            try {
                await fixture.emit('remote-request', { requestId, message });
                assert.ok(fixture.requests.every(item => item.payload._remoteRequestId === requestId));
                const responses = fixture.requests.filter(item => item.command === 'remote.respond');
                assert.equal(responses.length, 1);
                const response = responses[0].payload;
                assert.equal(response.requestId, requestId);
                if (message.items?.length && !message.playerId) {
                    assert.equal(response.ok, true);
                    assert.equal(response.data, publicState);
                    assert.equal(publicState.nativeRevision, 2);
                    assert.equal(fixture.requests.some(item => item.command === (message.op === 'playMusic' ? 'playback.queue.commit' : 'playback.insert')), true);
                } else if (message.playerId === 'remote-player') {
                    assert.equal(response.ok, true);
                    assert.equal(response.data.playerId, 'remote-player');
                    assert.equal(fixture.requests.some(item => item.command.startsWith('playback.')), false);
                } else {
                    assert.deepEqual(response, { requestId, _remoteRequestId: requestId, ok: false,
                        error: message.op === 'browseMusic' ? 'unavailable' : 'invalidSelection' });
                }
                assert.equal(fixture.count('remote-cancelled'), 0);
            } finally { off(); }
            assert.equal(fixture.count('remote-request'), 0);
        }
        assert.equal(networkCalls.length, 2);
    });
});

test('Android remote authorization denial and cancellation during authorization prevent execution and detach watchers', async () => {
    let browsed = 0;
    await withGlobals({ window: { uiManager: { networkMusic: { api: {
        async networkMusicBrowse() { browsed++; return { items: [], total: 0 }; }
    } } } } }, async () => {
        for (const mode of ['initial-denial', 'commit-denial', 'cancel-during-authorization']) {
            const entered = deferred(), release = deferred();
            let authorizations = 0, delivered = 0, writes = 0, options;
            const fixture = remoteFixture(async command => {
                assert.equal(command, 'remote.authorize');
                authorizations++;
                if (mode === 'cancel-during-authorization') { entered.resolve(); await release.promise; }
                if (mode === 'initial-denial' || (mode === 'commit-denial' && authorizations === 2)) {
                    throw Object.assign(new Error('Denied'), { code: 'unauthorized' });
                }
            });
            const off = fixture.api.onRequest(async request => {
                delivered++;
                options = request.mutationOptions;
                assert.equal(options.remoteRequestId, mode);
                await options.beforeCommit();
                writes++;
            });
            const message = mode === 'initial-denial' ? { op: 'browseMusic', serverId: 'server' }
                : { op: 'params', index: 0, params: { vl: -6 } };
            const pending = fixture.emit('remote-request', { requestId: mode, message });
            try {
                if (mode === 'cancel-during-authorization') {
                    await entered.promise;
                    await fixture.emit('remote-cancelled', { requestId: mode });
                    release.resolve();
                }
                await pending;
                assert.equal(delivered, mode === 'commit-denial' ? 1 : 0);
                assert.equal(writes, 0);
                assert.equal(browsed, 0);
                assert.equal(authorizations, mode === 'commit-denial' ? 2 : 1);
                assert.equal(fixture.count('remote-cancelled'), 0);
                if (options) assert.equal(options.isCurrent(), false);
            } finally { release.resolve(); await pending; off(); }
        }
    });
});

test('Android remote cancellation affects only its request and releases watchers after completion or failure', async () => {
    await withGlobals({ window: { uiManager: {} }, console: createConsoleHarness({ debug() {} }) }, async () => {
        const fixture = remoteFixture();
        const gates = { a: deferred(), b: deferred() }, entered = { a: deferred(), b: deferred() };
        const received = new Map();
        const off = fixture.api.onRequest(async request => {
            received.set(request.requestId, request);
            entered[request.requestId].resolve();
            await gates[request.requestId].promise;
            if (request.requestId === 'b') throw new Error('Renderer failed');
        });
        const a = fixture.emit('remote-request', { requestId: 'a', message: { op: 'params', index: 0, params: { vl: -1 } } });
        const b = fixture.emit('remote-request', { requestId: 'b', message: { op: 'params', index: 0, params: { vl: -2 } } });
        try {
            await Promise.all([entered.a.promise, entered.b.promise]);
            assert.equal(fixture.count('remote-cancelled'), 2);
            assert.equal(received.get('a').message.params.vl, -1);
            assert.equal(received.get('b').message.params.vl, -2);
            await fixture.emit('remote-cancelled', { requestId: 'unrelated' });
            assert.equal(received.get('a').mutationOptions.isCurrent(), true);
            assert.equal(received.get('b').mutationOptions.isCurrent(), true);
            await fixture.emit('remote-cancelled', { requestId: 'a' });
            assert.equal(received.get('a').mutationOptions.isCurrent(), false);
            assert.equal(received.get('b').mutationOptions.isCurrent(), true);
            gates.a.resolve(); await a;
            assert.equal(fixture.count('remote-cancelled'), 1);
            gates.b.resolve(); await b;
            assert.equal(received.get('b').mutationOptions.isCurrent(), false);
            assert.equal(fixture.count('remote-cancelled'), 0);
        } finally {
            gates.a.resolve(); gates.b.resolve();
            await Promise.all([a, b]); off();
        }
        assert.equal(fixture.count('remote-request'), 0);
    });
});

test('Android remote uses bounded catalog pages and projects no private source fields', async () => {
    const calls = [];
    const rows = Array.from({ length: 16 }, (_, i) => ({ trackUid: `t${i}`, title: `Track ${i}`, durationSec: 1, path: '/private', uri: 'content://private' }));
    const catalog = {
        init: async () => {}, createContext: async request => { assert.equal(request.query, 'Track'); return 'context'; },
        readContextPageAtOrdinal: async ({ ordinal, limit }) => { calls.push({ ordinal, limit }); const start = Math.floor(ordinal / limit) * limit; return { rows: rows.slice(start, start + limit), pageStartOrdinal: start, totalCount: rows.length }; },
        releaseContext: async token => calls.push(token)
    };
    const service = createAndroidMusicService({}, { libraryManager: catalog, uiManager: {} });
    const result = await dispatchMusic(service, local, { op: 'browseMusic', query: 'Track', start: 3, count: 5 }, () => true);
    assert.equal(result.ok, true);
    assert.deepEqual(result.result.items.map(item => item.trackId), ['t3', 't4', 't5', 't6', 't7']);
    assert.equal(result.result.total, 16); assert.equal(result.result.numberReturned, 5);
    assert.equal(calls.at(-1), 'context'); assert.equal(result.result.items[0].uri, undefined); assert.equal(result.result.items[0].path, undefined);
});

test('Android remote gateway and Subsonic resolutions preserve auth only inside native queue chunks', async () => {
    const commands = [];
    const api = { networkMusicResolveTrack: async ({ serverId, trackId, localPlayback }) => {
        assert.equal(localPlayback, true);
        return { uri: `https://music.example/${serverId}/${trackId}`, title: trackId, headers: { Authorization: 'Bearer private' } };
    } };
    const bridge = { request: async (name, payload = {}) => {
        commands.push({ name, payload });
        return name === 'playback.getPublic' ? { playerId: 'local', queue: [], transportState: 'Playing' } : {};
    } };
    const service = createAndroidMusicService(bridge, { uiManager: { networkMusic: { api } } });
    const items = Array.from({ length: 130 }, (_, i) => ({ serverId: i % 2 ? 'subsonic' : 'pwa:gateway', trackId: `t${i}` }));
    const result = await dispatchMusic(service, local, { op: 'playMusic', items, startIndex: 70 }, () => true);
    assert.equal(result.ok, true);
    const batches = commands.filter(item => item.name === 'playback.queue.append');
    assert.deepEqual(batches.map(item => item.payload.items.length), [64, 64, 2]);
    assert.equal(commands[0].payload.index, 70);
    assert.equal(batches[0].payload.items[0].headers.Authorization, 'Bearer private');
    assert.deepEqual(commands.slice(-3).map(item => item.name), ['playback.queue.commit', 'playback.play', 'playback.getPublic']);
    assert.equal(JSON.stringify(result).includes('Bearer private'), false);
});

test('Android remote uses existing SAF source resolver for local CUE tracks', async () => {
    const commands = [];
    const catalog = { init: async () => {}, getTrack: async () => ({ title: 'Cue', durationSec: 1 }),
        client: { resolveSequenceEntrySource: async ({ trackUid }) => { assert.equal(trackUid, 'cue'); return { uri: 'content://library/audio', startFrame: 75, endFrame: 150 }; } } };
    const bridge = { request: async (name, payload) => {
        commands.push({ name, payload });
        return name === 'snapshot.get' ? { playback: { index: 2, queueLength: 5 } } : { queue: [] };
    } };
    const service = createAndroidMusicService(bridge, { uiManager: {}, libraryManager: catalog });
    const result = await dispatchMusic(service, local, { op: 'queueMusic', position: 'afterCurrent', items: [{ serverId: 'local', trackId: 'cue' }] }, () => true);
    assert.equal(result.ok, true);
    const insert = commands.find(item => item.name === 'playback.insert').payload;
    assert.equal(insert.index, 3); assert.deepEqual(insert.items[0].region, { start: 1, end: 2, durationSec: 1 });
    assert.equal(insert.items[0].libraryTrackId, 'cue');
});

test('Revoked remote request cannot publish a queue after delayed provider resolution', async () => {
    let resolveTrack, entered, current = true;
    const waiting = new Promise(resolve => { entered = resolve; });
    const commands = [];
    const api = { networkMusicResolveTrack: () => new Promise(resolve => { resolveTrack = resolve; entered(); }) };
    const bridge = { request: async (name, payload) => { commands.push({ name, payload }); return {}; } };
    const service = createAndroidMusicService(bridge, { uiManager: { networkMusic: { api } } }, async () => current);
    const pending = dispatchMusic(service, local, { op: 'playMusic', items: [{ serverId: 'subsonic', trackId: 'delayed' }] }, () => current);
    await waiting;
    current = false;
    resolveTrack({ uri: 'https://music.example/delayed', title: 'Delayed' });
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'unauthorized');
    assert.deepEqual(commands.map(item => item.name), ['playback.queue.begin']);
});
