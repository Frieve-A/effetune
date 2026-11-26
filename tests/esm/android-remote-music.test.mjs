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
        async networkMusicGetState() {
            return { gatewayPermissions: { libraries: true, players: true },
                libraries: [{ id: 'server', available: true }], players: [{ id: 'remote-player', available: true }] };
        },
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
        async networkMusicBrowse() { throw Object.assign(new Error('The library is unavailable.'), { code: 'unavailable' }); }
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
                        error: message.op === 'browseMusic' ? { code: 'unavailable', message: 'The library is unavailable.' }
                            : { code: 'invalidSelection', message: 'Choose between 1 and 4096 tracks.' } });
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
        getContextCount: async () => rows.length,
        releaseContext: async token => calls.push(token)
    };
    const service = createAndroidMusicService({}, { libraryManager: catalog, uiManager: {} });
    const result = await dispatchMusic(service, local, { op: 'browseMusic', query: 'Track', start: 3, count: 5 }, () => true);
    assert.equal(result.ok, true);
    assert.deepEqual(result.result.items.map(item => item.trackId), ['t3', 't4', 't5', 't6', 't7']);
    assert.equal(result.result.total, 16); assert.equal(result.result.numberReturned, 5);
    assert.equal(calls.at(-1), 'context'); assert.equal(result.result.items[0].uri, undefined); assert.equal(result.result.items[0].path, undefined);
});

test('Android remote browse of an empty library reads no page and releases the context', async () => {
    const released = [];
    const catalog = {
        init: async () => {}, createContext: async () => 'context', getContextCount: async () => 0,
        readContextPageAtOrdinal: async () => { throw new Error('no page expected'); },
        releaseContext: async token => released.push(token)
    };
    const service = createAndroidMusicService({}, { libraryManager: catalog, uiManager: {} });
    const result = await dispatchMusic(service, local, { op: 'browseMusic', query: '', start: 0, count: 5 }, () => true);
    assert.equal(result.ok, true);
    assert.deepEqual(result.result.items, []);
    assert.equal(result.result.total, 0);
    assert.deepEqual(released, ['context']);
});

test('Android remote gateway and Subsonic resolutions preserve auth only inside native queue chunks', async () => {
    const commands = [];
    const api = { networkMusicGetState: async () => ({ gatewayPermissions: { libraries: true, players: false },
        libraries: [{ id: 'subsonic', available: true }, { id: 'pwa:gateway', available: true }], players: [] }),
    networkMusicResolveTrack: async ({ serverId, trackId, localPlayback }) => {
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
        return name === 'snapshot.get' ? { playback: { index: 2, ordinal: 0, queueLength: 5 } } : { queue: [] };
    } };
    const service = createAndroidMusicService(bridge, { uiManager: {}, libraryManager: catalog });
    const result = await dispatchMusic(service, local, { op: 'queueMusic', position: 'afterCurrent', items: [{ serverId: 'local', trackId: 'cue' }] }, () => true);
    assert.equal(result.ok, true);
    const insert = commands.find(item => item.name === 'playback.insert').payload;
    assert.equal(insert.index, 1); assert.equal(insert.transportOrder, true);
    assert.deepEqual(insert.items[0].region, { start: 1, end: 2, durationSec: 1 });
    assert.equal(insert.items[0].libraryTrackId, 'cue');
});

test('Revoked remote request cannot publish a queue after delayed provider resolution', async () => {
    let resolveTrack, entered, current = true;
    const waiting = new Promise(resolve => { entered = resolve; });
    const commands = [];
    const api = { networkMusicGetState: async () => ({ gatewayPermissions: { libraries: true, players: false },
        libraries: [{ id: 'subsonic', available: true }], players: [] }),
    networkMusicResolveTrack: () => new Promise(resolve => { resolveTrack = resolve; entered(); }) };
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

test('Android remote IR transfers cross the bridge in 512 KiB parts and sync notices reach the Service', async () => {
    const part = 512 * 1024, upload = Uint8Array.from({ length: part + 3 }, (_, i) => i & 255);
    const { api, emit, requests } = remoteFixture((command, payload) => command === 'remote.irRead'
        ? { data: Buffer.from(upload.subarray(payload.offset, payload.offset + part)).toString('base64') } : {});
    let received;
    api.onRequest(async request => { received = request.message; });
    await emit('remote-request', { requestId: 'put-1', message: { op: 'putIR', id: 'x', bytes: upload.byteLength } });
    assert.deepEqual(received.data, upload);
    assert.deepEqual(requests.filter(item => item.command === 'remote.irRead').map(item => item.payload.offset), [0, part]);

    requests.length = 0;
    await api.respond({ requestId: 'get-1', ok: true, data: upload, name: 'hall.wav', ext: 'wav', snapshot: { pipeline: [] } });
    const chunks = requests.filter(item => item.command === 'remote.irChunk').map(item => item.payload);
    assert.deepEqual(chunks.map(item => [item.index, item.total, item.bytes, item.name, item.ext]), [[0, 2, part + 3, 'hall.wav', 'wav'], [1, 2, part + 3, 'hall.wav', 'wav']]);
    assert.deepEqual(Buffer.concat(chunks.map(item => Buffer.from(item.data, 'base64'))), Buffer.from(upload));
    assert.deepEqual(requests.at(-1), { command: 'remote.respond', payload: { requestId: 'get-1', ok: true, name: 'hall.wav', ext: 'wav', snapshot: { pipeline: [] } } });

    requests.length = 0;
    await api.notifyPresets();
    await api.notifyIrs();
    assert.deepEqual(requests.map(item => item.command), ['remote.presetsChanged', 'remote.irsChanged']);
});

test('Android remote playMusic prepares local SAF scores and keeps catalog queue metadata', async () => {
    const { AndroidPlayerContext } = await import('../../js/android/player-context.js');
    const midi = Uint8Array.of(77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
        77, 84, 114, 107, 0, 0, 0, 12, 0, 144, 60, 100, 96, 128, 60, 0, 0, 255, 47, 0);
    const xml = new TextEncoder().encode('<score-partwise version="3.1"><part-list><score-part id="P1">' +
        '<part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1">' +
        '<attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch>' +
        '<duration>1</duration></note></measure></part></score-partwise>');
    const uri = 'content://library/document/123', scoreUri = 'content://app.files/score.bin';
    const tags = { title: 'Catalog title', artist: 'Catalog artist', album: 'Catalog album', duration: 12 };
    await withGlobals({ window: {} }, async () => {
        for (const [fileName, bytes] of [['song.mid', midi], ['song.musicxml', xml]]) {
            const commands = [];
            const bridge = { async request(name, payload) {
                commands.push({ name, payload });
                if (name === 'documents.createTemporary') return { uri: scoreUri };
                if (name === 'playback.getPublic') return { queue: [] };
                return {};
            } };
            const contextManager = Object.assign(Object.create(AndroidPlayerContext.prototype), {
                bridge, sourceCache: new WeakMap(), audioPlayer: {},
                audioManager: { getNativeSampleRate: () => 48000 },
                documents: {
                    async read(sourceUri) { assert.equal(sourceUri, uri); return bytes; },
                    async write(preparedUri, packed) { assert.equal(preparedUri, scoreUri); assert.ok(packed.byteLength > 16); }
                }
            });
            const catalog = { init: async () => {},
                getTrack: async () => ({ fileName, ...tags, duration: undefined, durationSec: tags.duration }),
                client: { resolveSequenceEntrySource: async () => ({ uri }) } };
            const service = createAndroidMusicService(bridge, { uiManager: { audioPlayer: { contextManager } }, libraryManager: catalog });
            const result = await dispatchMusic(service, local,
                { op: 'playMusic', items: [{ serverId: 'local', trackId: 'score' }] }, () => true);
            assert.equal(result.ok, true, JSON.stringify(result.error));
            const [entry] = commands.find(({ name }) => name === 'playback.queue.append').payload.items;
            assert.equal(entry.uri, uri);
            assert.equal(entry.scoreUri, scoreUri);
            assert.equal(entry.scoreName, fileName);
            assert.equal(entry.libraryTrackId, 'score');
            const { title, artist, album, duration } = entry;
            assert.deepEqual({ title, artist, album, duration }, tags);
        }
    });
});

async function partialQueueInsert(queue, currentIndex) {
    const catalog = { init: async () => {},
        getTrack: async trackId => ({ title: trackId }),
        client: { async resolveSequenceEntrySource({ trackUid }) {
            if (trackUid === 'song-65') throw Object.assign(new Error('The track is unavailable.'), { code: 'trackUnavailable' });
            return { uri: `content://library/${trackUid}` };
        } } };
    const { api, requests, emit } = remoteFixture((command, payload) => {
        if (command === 'snapshot.get') return { playback: { index: currentIndex, queueLength: queue.length } };
        if (command === 'playback.insert') {
            for (const { title } of payload.items) queue.push({ id: queue.length + 1, title });
        }
        if (command === 'playback.getPublic') return { playerId: 'local', queue: queue.slice(0, 100), total: queue.length,
            currentId: queue[currentIndex]?.id ?? 0, currentTrack: queue[currentIndex] ?? null };
    });
    const items = Array.from({ length: 66 }, (_, index) => ({ serverId: 'local', trackId: `song-${index}` }));
    await withGlobals({ window: { uiManager: {}, libraryManager: catalog } }, async () => {
        const off = api.onRequest(() => assert.fail('Music must use its dispatcher'));
        try { await emit('remote-request', { requestId: 'partial-insert', message: { op: 'queueMusic', items } }); }
        finally { off(); }
    });
    assert.deepEqual(requests.filter(({ command }) => command === 'playback.insert').map(({ payload }) => payload.items.length), [64]);
    const { ok, error, outcome, playback } = requests.find(({ command }) => command === 'remote.respond').payload;
    assert.equal(ok, false);
    assert.deepEqual(error, { code: 'trackUnavailable', message: 'The track is unavailable.' });
    assert.equal(outcome, 'unknown');
    assert.equal(playback.playerId, 'local');
    return playback;
}

test('Android remote bridges the public error and observed playback after a partial queue insert', async () => {
    const playback = await partialQueueInsert([], -1);
    assert.equal(playback.total, 64);
    assert.equal(playback.queue.at(-1).title, 'song-63');
});

test('Android partial queue insert keeps the total and current track beyond the first public page', async () => {
    const queue = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, title: `Track ${i + 1}` }));
    const playback = await partialQueueInsert(queue, 120);
    assert.equal(playback.total, 214);
    assert.equal(playback.queue.length, 100);
    assert.deepEqual(playback.currentTrack, { id: 121, title: 'Track 121' });
});
