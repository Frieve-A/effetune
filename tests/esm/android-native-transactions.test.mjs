import assert from 'node:assert/strict';
import test from 'node:test';
import { withGlobals, createConsoleHarness } from '../helpers/global-test-utils.mjs';
import { AndroidAudioManager } from '../../js/android/audio-manager.js';
import { AndroidPlayerContext } from '../../js/android/player-context.js';
import { bytesToBase64, base64ToBytes } from '../../js/android/bridge.js';
import { StateManager } from '../../js/ui/audio-player/state-manager.js';
import { attachLyricsFiles } from '../../js/ui/audio-player/lyrics-file-links.js';
import { createAndroidRemoteApi } from '../../js/android/remote.js';
import { AndroidAssets } from '../../js/android/assets.js';

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

class VolumePlugin {
    constructor() {
        this.id = 1; this.name = 'Volume'; this.enabled = true; this.vl = 0;
        this.assets = new Map(); this.listeners = new Set(); this.assetStates = [];
    }
    getParameters() { return { vl: this.vl }; }
    setParameters(parameters) { Object.assign(this, parameters); }
    setEnabled(enabled) { this.enabled = enabled; }
    getWasmAssets() { return this.assets; }
    addWasmAssetChangeListener(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    clearWasmAsset(slot) { this.assets.delete(slot); }
    onWasmAssetState(...state) { this.assetStates.push(state); }
    onWasmAssetRejected(...state) { this.assetRejection = state; }
    cleanup() { this.cleaned = true; }
}

function snapshot(revision, volume = -6) {
    return { revision, sampleRate: 48000, channelCount: 2, slot: 'A', pipelines: {
        A: [{ id: 1, name: 'Volume', type: 'VolumePlugin', enabled: true, parameters: { vl: volume } }], B: []
    } };
}

async function audioFixture(handle) {
    const listeners = new Map(), requests = [], updates = [];
    let manager;
    const bridge = {
        on(name, listener) { listeners.set(name, listener); },
        async request(command, payload, revision) {
            requests.push({ command, payload, revision });
            const result = await handle?.(command, payload, revision);
            if (result !== undefined) return result;
            if (command === 'pipeline.set') return { ...manager.snapshot, revision: manager.snapshot.revision + 1,
                pipelines: { A: payload.plugins, B: [] } };
            return manager.snapshot;
        }
    };
    manager = new AndroidAudioManager({ core: { updatePipelineUI: value => updates.push(value) } }, { bridge });
    manager.acceptSnapshot(snapshot(1));
    await manager.hydratePipeline({ pluginClasses: { Volume: VolumePlugin }, nextPluginId: 1,
        createPlugin: () => new VolumePlugin() });
    return { manager, listeners, requests, updates };
}

function playerFixture(handle) {
    const listeners = new Map(), requests = [];
    const manager = { snapshot: { revision: 1 }, acceptSnapshot(value) { this.snapshot = value; } };
    manager.bridge = {
        on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name); },
        async request(command, payload) {
            requests.push({ command, payload });
            return await handle?.(command, payload) ?? { revision: manager.snapshot.revision + 1 };
        }
    };
    const player = { playbackManager: { playlist: [], installCatalogSequence(sequence) { this.catalogSequence = sequence; } } };
    player.stateManager = new StateManager(player);
    return { context: new AndroidPlayerContext(player, manager), player, manager, listeners, requests };
}

test('external pipeline snapshots hydrate the UI and revision-filter native telemetry and runtime events', async () => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const { manager, listeners, updates } = await audioFixture();
        const refreshed = new Promise(resolve => manager.addEventListener('pipelineChanged', resolve));
        listeners.get('pipeline-changed')(snapshot(4, -12));
        await refreshed;
        assert.equal(manager.pipeline[0].vl, -12);
        assert.equal(manager.externalPipelineEpoch, 1);
        assert.deepEqual(updates, [true]);
        const packets = [];
        manager.telemetryHub.handleMessage = message => packets.push(message);
        const packet = bytesToBase64(new Uint8Array([1, 2, 3]));
        listeners.get('telemetry')({ revision: 3, packet });
        listeners.get('telemetry')({ revision: 4, packet: null });
        listeners.get('telemetry')({ revision: 4, packet });
        assert.equal(packets.length, 1);
        assert.deepEqual([...packets[0].packet], [1, 2, 3]);
        assert.equal(packets[0].recycle, false);
        class TubeSimulatorPlugin { constructor() { this.id = 7; this.messages = []; } onMessage(value) { this.messages.push(value); } }
        const tube = new TubeSimulatorPlugin(), events = [];
        manager.pipeline.push(tube);
        manager.addEventListener('tubeSimulatorCircuitFault', value => events.push(value));
        const fault = { type: 'tubeSimulatorCircuitFault', pluginType: 'TubeSimulatorPlugin', pluginId: 7,
            instanceEpoch: 2, generation: 3, revision: 4, latched: true, cause: 'feedbackOscillation' };
        listeners.get('dsp-runtime-event')({ ...fault, revision: 3 });
        listeners.get('dsp-runtime-event')(fault);
        listeners.get('dsp-runtime-event')(fault);
        listeners.get('dsp-runtime-event')({ ...fault, instanceEpoch: 1, generation: 100 });
        listeners.get('dsp-runtime-event')({ ...fault, generation: 4, latched: false, cause: 'none' });
        assert.deepEqual(events.map(event => [event.generation, event.latched, event.validated]), [[3, true, true], [4, false, true]]);
        assert.deepEqual(tube.messages, events);
    });
});

test('a rejected native revision restores the authoritative pipeline and leaves later edits usable', async () => {
    const diagnostics = [];
    await withGlobals({ window: { electronAPI: {} }, console: createConsoleHarness({ error: (...args) => diagnostics.push(args) }) }, async () => {
        let conflict = true;
        const { manager, requests, updates } = await audioFixture(command => {
            if (command === 'pipeline.set' && conflict) {
                conflict = false;
                throw Object.assign(new Error('stale revision'), { code: 'revision-conflict' });
            }
            if (command === 'snapshot.get') return snapshot(7, -3);
        });
        const failures = [];
        manager.addEventListener('nativeOperationFailed', event => failures.push(event));
        const restored = new Promise(resolve => manager.addEventListener('pipelineChanged', resolve));
        manager.pipeline[0].vl = -18;
        await assert.rejects(manager.rebuildPipeline(), { code: 'revision-conflict' });
        await restored;
        assert.equal(manager.pipeline[0].vl, -3);
        assert.equal(manager.snapshot.revision, 7);
        assert.deepEqual(failures, [{ operation: 'pipeline' }]);
        assert.deepEqual(updates, [true]);
        manager.pipeline[0].vl = -9;
        await manager.rebuildPipeline();
        assert.deepEqual(requests.filter(item => item.command === 'pipeline.set').map(item => item.revision), [1, 7]);
        assert.equal(manager.snapshot.revision, 8);
        assert.equal(diagnostics.length, 1);
    });
});

test('guarded native writes retain their captured parameters and serialize revision checks', async () => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const entered = deferred(), release = deferred(), order = [];
        let delayedSet;
        const { manager, listeners, requests } = await audioFixture((command, payload) => {
            if (command === 'pipeline.set') {
                order.push(`set:${payload.plugins[0].parameters.vl}`);
                if (delayedSet) { delayedSet.entered.resolve(); return delayedSet.reply.promise; }
            }
        });
        manager.pipeline[0].vl = -3;
        const first = manager.withMutationOptions({ remoteRequestId: 'first', beforeCommit: async () => {
            order.push('guard:first'); entered.resolve(); await release.promise;
        } }, () => manager.rebuildPipeline());
        await entered.promise;
        manager.pipeline[0].vl = -9;
        const second = manager.withMutationOptions({ remoteRequestId: 'second', beforeCommit: () => order.push('guard:second') },
            () => manager.rebuildPipeline());
        assert.equal(manager.getMutationOptions(), undefined);
        assert.deepEqual(order, ['guard:first']);
        release.resolve();
        await Promise.all([first, second]);
        assert.deepEqual(order, ['guard:first', 'set:-3', 'guard:second', 'set:-9']);
        assert.deepEqual(requests.filter(item => item.command === 'pipeline.set').map(item =>
            [item.payload._remoteRequestId, item.revision]), [['first', 1], ['second', 2]]);
        const authorizing = deferred(), authorized = deferred();
        manager.pipeline[0].vl = -18;
        const superseded = manager.withMutationOptions({ remoteRequestId: 'superseded', beforeCommit: async () => {
            authorizing.resolve(); await authorized.promise;
        } }, () => manager.rebuildPipeline());
        await authorizing.promise;
        const refreshed = new Promise(resolve => manager.addEventListener('pipelineChanged', resolve));
        listeners.get('pipeline-changed')(snapshot(7, -1));
        await refreshed;
        authorized.resolve();
        await superseded;
        assert.equal(manager.snapshot.revision, 7);
        assert.equal(manager.pipeline[0].vl, -1);
        assert.equal(requests.filter(item => item.command === 'pipeline.set').length, 2);
        delayedSet = { entered: deferred(), reply: deferred() };
        manager.pipeline[0].assets.set(0, { payload: new ArrayBuffer(4), formatTag: 1, operationRevision: 1 });
        const obsolete = manager.rebuildPipeline();
        await delayedSet.entered.promise;
        const replaced = new Promise(resolve => manager.addEventListener('pipelineChanged', resolve));
        listeners.get('pipeline-changed')(snapshot(9, -2));
        await replaced;
        delayedSet.reply.resolve(snapshot(8, -1));
        await obsolete;
        assert.equal(manager.snapshot.revision, 9);
        assert.equal(manager.pipeline[0].vl, -2);
        assert.equal(requests.some(item => item.command.startsWith('pipeline.asset.')), false);
    });
});

test('native asset ownership survives reuse and discards hydration and queued edits after replacement', async () => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const { manager, listeners, requests } = await audioFixture();
        const assetSnapshot = (revision, id, signature) => ({ ...snapshot(revision, -2),
            assetRefs: { 'VolumePlugin:1:0': { id } },
            assetDefinitions: { 'VolumePlugin:1:0': { id, externalAssetSignature: signature } } });
        const original = manager.pipeline[0];
        original.assets.set(0, { externalAssetSignature: 'same', operationRevision: 1 });
        const reused = new Promise(resolve => manager.addEventListener('pipelineChanged', resolve));
        listeners.get('pipeline-changed')(assetSnapshot(9, 'retained', 'same'));
        await reused;
        assert.equal(manager.pipeline[0], original);
        assert.equal(manager.nativeAssets.resident.get('1:0'), original.assets.get(0));
        const pending = deferred();
        manager.pendingMutation = pending.promise;
        manager.pipeline[0].vl = -20;
        const edit = manager.rebuildPipeline();
        const hydrations = [];
        manager.pluginManager.createPlugin = () => {
            const plugin = new VolumePlugin();
            plugin.hydrateExternalAsset = async (definition, options) => {
                const gate = deferred(), done = deferred();
                hydrations.push({ plugin, definition, options, gate, done });
                await gate.promise;
                if (options.isCurrent()) {
                    plugin.assets.set(0, { externalAssetSignature: definition.externalAssetSignature, operationRevision: 2 });
                    await manager.withMutationOptions(options,
                        () => { plugin.hydratedId = definition.id; });
                }
                done.resolve();
            };
            return plugin;
        };
        listeners.get('pipeline-changed')(assetSnapshot(10, 'replaced', 'different'));
        const stale = hydrations[0];
        assert.notEqual(stale.plugin, original);
        assert.equal(original.cleaned, true);
        assert.equal(original.listeners.size, 0);
        assert.equal(original.clearWasmAsset, VolumePlugin.prototype.clearWasmAsset);
        const removed = new Promise(resolve => manager.addEventListener('pipelineChanged', resolve));
        listeners.get('pipeline-changed')({ ...snapshot(11), pipelines: { A: [], B: [] } });
        await removed;
        assert.equal(stale.options.isCurrent(), false);
        assert.equal(stale.plugin.listeners.size, 0);
        assert.equal(stale.plugin.clearWasmAsset, VolumePlugin.prototype.clearWasmAsset);
        stale.gate.resolve();
        await stale.done.promise;
        assert.deepEqual(stale.plugin.assetStates, []);
        assert.equal(stale.plugin.hydratedId, undefined);
        await new Promise(resolve => setImmediate(resolve));
        const hydrated = new Promise(resolve => manager.addEventListener('pipelineChanged', resolve));
        listeners.get('pipeline-changed')(assetSnapshot(12, 'current', 'new'));
        const current = hydrations[1];
        assert.equal(current.options.isCurrent(), true);
        current.gate.resolve();
        await hydrated;
        assert.equal(current.plugin.hydratedId, 'current');
        assert.deepEqual(current.plugin.assetStates, [[0, 3, 2]]);
        assert.equal(manager.nativeAssets.resident.get('1:0'), current.plugin.assets.get(0));
        pending.resolve();
        await edit;
        assert.equal(manager.pipeline[0].vl, -2);
        assert.equal(manager.snapshot.revision, 12);
        assert.equal(requests.some(item => item.command === 'pipeline.set'), false);
        const guarded = deferred(), released = deferred(), transfers = [];
        let nativeRevision = 20;
        const nativePending = new Set(['1:0']);
        const assets = new AndroidAssets({ async request(command, payload, revision) {
            transfers.push({ command, payload, revision });
            if (revision !== nativeRevision) throw Object.assign(new Error('stale asset owner'), { code: 'revision-conflict' });
            const key = `${payload.pluginId}:${payload.slot}`;
            if (command.endsWith('.begin')) nativePending.add(key);
            if (command.endsWith('.abort') || command.endsWith('.commit') || command.endsWith('.clear')) nativePending.delete(key);
            if (command.endsWith('.commit') || command.endsWith('.clear')) nativeRevision++;
            return { revision: nativeRevision };
        } });
        const upload = new VolumePlugin();
        upload.assets.set(0, { payload: new ArrayBuffer(4), formatTag: 1, operationRevision: 3 });
        const outdated = assets.transfer([upload], { remoteRequestId: 'old-owner', beforeCommit: async () => {
            guarded.resolve(); await released.promise;
        } }, [], 20);
        const rejected = assert.rejects(outdated, { code: 'revision-conflict' });
        await guarded.promise;
        nativeRevision = 21;
        released.resolve();
        await rejected;
        assert.deepEqual(transfers.map(item => [item.command, item.revision]),
            [['pipeline.asset.begin', 20], ['pipeline.asset.abort', 20]]);
        assert.equal(nativePending.has('1:0'), true);
        assert.deepEqual(upload.assetRejection, [0, 'prepare', 3]);
        assert.equal(assets.resident.size, 0);
        transfers.length = 0;
        assets.authoritative.set('1:2', 'removed');
        assets.resident.set('1:3', { obsolete: true });
        upload.assets.set(1, { payload: new ArrayBuffer(4), formatTag: 1, operationRevision: 4 });
        await assets.transfer([upload], { remoteRequestId: 'new-owner' }, [['1:2', { ir: '' }]], 21);
        assert.deepEqual(transfers.map(item => [item.command, item.revision]), [
            ['pipeline.asset.clear', 21], ['pipeline.asset.begin', 22], ['pipeline.asset.chunk', 22],
            ['pipeline.asset.commit', 22], ['pipeline.asset.begin', 23], ['pipeline.asset.chunk', 23],
            ['pipeline.asset.commit', 23], ['pipeline.asset.clear', 24]
        ]);
        assert.ok(transfers.every(item => item.payload._remoteRequestId === 'new-owner'));
        assert.deepEqual(upload.assetStates, [[0, 3, 3], [1, 3, 4]]);
        assert.equal(assets.authoritative.has('1:2'), false);
        assert.equal(assets.resident.has('1:3'), false);
        assert.equal(nativeRevision, 25);
    });
});

test('loading a Blob awaits native import and retains its sidecar while reusing the content source', async () => {
    await withGlobals({ window: {} }, async () => {
        const writing = deferred(), release = deferred(), chunks = [];
        const { context, player, requests } = playerFixture(async (command, payload) => {
            if (command === 'documents.createTemporary') return { uri: 'content://imports/song' };
            if (command === 'documents.write') {
                chunks.push(...base64ToBytes(payload.data));
                writing.resolve();
                await release.promise;
            }
        });
        const file = new File([new Uint8Array([10, 20, 30])], 'song.wav', { type: 'audio/wav' });
        attachLyricsFiles([file], [{ androidUri: 'content://lyrics/song', name: 'song.lrc', size: 12, type: 'text/plain' }]);
        const track = { file, name: 'Song', meta: { title: 'Song' } };
        player.playbackManager.playlist = [track];
        const loading = context.loadTrack(track, 0);
        await writing.promise;
        assert.equal(requests.some(item => item.command.startsWith('playback.')), false);
        release.resolve();
        await loading;
        const source = await context.resolveNativeSource(track);
        assert.equal(source.uri, 'content://imports/song');
        assert.deepEqual(source.lyricsFile, { uri: 'content://lyrics/song', name: 'song.lrc', size: 12, mimeType: 'text/plain' });
        assert.deepEqual(chunks, [10, 20, 30]);
        assert.equal(requests.filter(item => item.command === 'documents.createTemporary').length, 1);
        assert.deepEqual(requests.filter(item => item.command.startsWith('playback.')).map(item => item.command),
            ['playback.queue.begin', 'playback.queue.append', 'playback.queue.commit']);
        assert.deepEqual(requests.find(item => item.command === 'playback.queue.append').payload.items, [source]);
        assert.equal(player.stateManager.getStateSnapshot().currentTrack, track);
        context.disconnect();
    });
});

test('native insertion resolves a lazy sequence in bounded pages at the requested ordinals', async () => {
    await withGlobals({ window: {} }, async () => {
        const { context, requests } = playerFixture();
        const ordinals = [];
        const sequence = { itemCount: 65,
            async getEntry(ordinal) { ordinals.push(ordinal); return { ordinal, title: `Song ${ordinal}` }; },
            async resolveEntrySource(entry) { return { uri: `content://music/${entry.ordinal}` }; } };
        assert.deepEqual(await context.insertNativeQueue({ sequence, index: 7 }), { accepted: true, preserved: true });
        assert.deepEqual(ordinals, Array.from({ length: 65 }, (_, index) => index));
        assert.deepEqual(requests.map(item => [item.command, item.payload.index, item.payload.items.length]),
            [['playback.insert', 7, 64], ['playback.insert', 71, 1]]);
        assert.equal(requests[1].payload.items[0].title, 'Song 64');
        context.disconnect();
    });
});

test('stopping during queue source resolution aborts the transaction without publishing its pending page', async () => {
    await withGlobals({ window: {} }, async () => {
        const resolving = deferred(), source = deferred();
        const { context, requests } = playerFixture();
        const sequence = { itemCount: 1, getEntry: async () => ({ title: 'Pending' }),
            resolveEntrySource(_entry, _options, signal) {
                resolving.resolve(signal);
                return source.promise;
            } };
        const replacement = context.replaceNativeQueue({ sequence });
        const rejected = assert.rejects(replacement, { name: 'AbortError' });
        const signal = await resolving.promise;
        await context.stop();
        assert.equal(signal.aborted, true);
        source.resolve({ uri: 'content://music/pending' });
        await rejected;
        assert.equal(context.queueWriting, false);
        assert.deepEqual(requests.map(item => item.command), ['playback.queue.begin', 'playback.stop', 'playback.queue.abort']);
        assert.equal(requests[0].payload.transactionId, requests[2].payload.transactionId);
        context.disconnect();
    });
});

test('failed native queue append or commit aborts only its transaction and permits the next replacement', async () => {
    await withGlobals({ window: {} }, async () => {
        for (const failedCommand of ['playback.queue.append', 'playback.queue.commit']) {
            let fail = true;
            const failure = new Error('Native queue write failed');
            const { context, requests } = playerFixture(command => {
                if (fail && command === failedCommand) throw failure;
            });
            try {
                const tracks = [{ uri: 'content://music/next', name: 'Next' }];
                await assert.rejects(context.replaceNativeQueue({ tracks }), error => error === failure);
                const transactionId = requests[0].payload.transactionId;
                assert.deepEqual(requests.at(-1), { command: 'playback.queue.abort', payload: { transactionId } });
                assert.equal(context.queueWriting, false);
                if (failedCommand.endsWith('append')) {
                    assert.equal(requests.some(item => item.command === 'playback.queue.commit'), false);
                }
                fail = false;
                requests.length = 0;
                assert.deepEqual(await context.replaceNativeQueue({ tracks }), { accepted: true, preserved: false });
                assert.notEqual(requests[0].payload.transactionId, transactionId);
                assert.deepEqual(requests.map(item => item.command),
                    ['playback.queue.begin', 'playback.queue.append', 'playback.queue.commit']);
                assert.equal(context.queueWriting, false);
            } finally { context.disconnect(); }
        }
    });
});

test('superseded queue resolution cannot release a newer queue writer or publish old tracks', async () => {
    await withGlobals({ window: {} }, async () => {
        for (const oldFinishesFirst of [true, false]) {
            const oldEntered = deferred(), newEntered = deferred(), oldSource = deferred(), newSource = deferred();
            const { context, requests } = playerFixture();
            const pending = [];
            const sequence = (entered, source) => ({ itemCount: 1,
                getEntry: async () => ({ title: 'Pending' }),
                resolveEntrySource(_entry, _options, signal) { entered.resolve(signal); return source.promise; } });
            try {
                const old = context.replaceNativeQueue({ sequence: sequence(oldEntered, oldSource) });
                const oldRejected = assert.rejects(old, { name: 'AbortError' });
                pending.push(oldRejected);
                const oldSignal = await oldEntered.promise;
                const next = context.replaceNativeQueue({ sequence: sequence(newEntered, newSource) });
                pending.push(next);
                const newSignal = await newEntered.promise;
                assert.equal(oldSignal.aborted, true);
                assert.equal(newSignal.aborted, false);
                if (oldFinishesFirst) {
                    oldSource.resolve({ uri: 'content://music/old' });
                    await oldRejected;
                    assert.equal(context.queueWriting, true);
                    newSource.resolve({ uri: 'content://music/new' });
                    await next;
                } else {
                    newSource.resolve({ uri: 'content://music/new' });
                    await next;
                    oldSource.resolve({ uri: 'content://music/old' });
                    await oldRejected;
                }
                const begins = requests.filter(item => item.command === 'playback.queue.begin');
                const appended = requests.filter(item => item.command === 'playback.queue.append');
                assert.equal(appended.length, 1);
                assert.equal(appended[0].payload.items[0].uri, 'content://music/new');
                assert.equal(appended[0].payload.transactionId, begins[1].payload.transactionId);
                assert.deepEqual(requests.filter(item => item.command === 'playback.queue.abort').map(item => item.payload.transactionId),
                    [begins[0].payload.transactionId]);
                assert.deepEqual(requests.filter(item => item.command === 'playback.queue.commit').map(item => item.payload.transactionId),
                    [begins[1].payload.transactionId]);
                assert.equal(context.queueWriting, false);
            } finally {
                oldSource.resolve({ uri: 'content://music/old' });
                newSource.resolve({ uri: 'content://music/new' });
                await Promise.allSettled(pending);
                context.disconnect();
            }
        }
    });
});

test('a delayed native track presentation cannot replace a newer selection', async () => {
    await withGlobals({ window: {} }, async () => {
        const oldMetadata = deferred(), presented = deferred(), metadata = [];
        const { context, manager, listeners, player } = playerFixture((command, payload) => {
            assert.equal(command, 'documents.stat');
            return payload.uri === 'content://music/old' ? oldMetadata.promise : { name: 'New.wav', size: 3 };
        });
        context.loadMetadata = track => { metadata.push(track.name); presented.resolve(); };
        const select = (revision, name) => {
            const value = { revision, playback: { index: 0, queueLength: 1,
                source: { uri: `content://music/${name.toLowerCase()}`, title: name, metadata: { title: name } } } };
            manager.acceptSnapshot(value);
            listeners.get('snapshot')(value);
        };
        select(2, 'Old');
        select(3, 'New');
        await presented.promise;
        oldMetadata.resolve({ name: 'Old.wav', size: 3 });
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(metadata, ['New']);
        assert.equal(context.presentedTrack.name, 'New');
        assert.equal(player.stateManager.getStateSnapshot().currentTrack.name, 'New');
        context.disconnect();
    });
});

test('Android remote renderer lifecycle preserves publication payloads and releases status subscriptions', async () => {
    const listeners = new Map(), requests = [], notifications = [];
    const status = { running: true, clientCount: 2, port: 47319 };
    const api = createAndroidRemoteApi({
        on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name); },
        async request(command, payload) {
            requests.push({ command, payload });
            return command === 'remote.getStatus' ? status : { accepted: true };
        }
    });
    const detach = api.onStatus(value => notifications.push(value));
    assert.deepEqual(await api.rendererReady(), { accepted: true });
    assert.equal(await api.getStatus(), status);
    listeners.get('remote-status')(status);
    assert.deepEqual(notifications, [{ ...status, clients: 2 }]);
    const state = { revision: 4, pipeline: [{ nm: 'Volume', vl: -6 }] };
    const response = { requestId: 'request-4', ok: true, data: { revision: 4 } };
    await api.publishState(state);
    await api.respond(response);
    await api.openPanel();
    await api.rendererUnavailable();
    detach();
    assert.equal(listeners.size, 0);
    assert.deepEqual(requests, [
        { command: 'remote.rendererReady', payload: undefined },
        { command: 'remote.getStatus', payload: undefined },
        { command: 'remote.publishState', payload: state },
        { command: 'remote.respond', payload: response },
        { command: 'remote.openPanel', payload: undefined },
        { command: 'remote.rendererUnavailable', payload: undefined }
    ]);
    assert.equal(requests[2].payload, state);
    assert.equal(requests[3].payload, response);
});
