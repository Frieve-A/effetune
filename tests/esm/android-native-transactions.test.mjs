import assert from 'node:assert/strict';
import test from 'node:test';
import { withGlobals, createConsoleHarness } from '../helpers/global-test-utils.mjs';
import { AndroidAudioManager } from '../../js/android/audio-manager.js';
import { HistoryManager } from '../../js/ui/pipeline/history-manager.js';
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

test('Android applies startup settings once and restores the chain on renderer reconnection', async () => {
    const { App } = await withGlobals({
        window: { __EFFECTUNE_DISABLE_APP_AUTO_START__: true },
        document: { addEventListener() {} }
    }, () => import('../../js/app.js'));
    class LevelMeterPlugin extends VolumePlugin {
        constructor() { super(); this.name = 'Level Meter'; }
    }
    const cases = [
        ['uninitialized', 'last', ['Volume', 'Level Meter'], -6, 1],
        ['startup', 'default', ['Volume', 'Level Meter'], -6, 1],
        ['startup', 'preset', ['Volume'], -3, 1],
        ['startup', 'last', ['Volume'], -12, 0],
        ['running', 'preset', ['Volume'], -12, 0]
    ];
    for (const [phase, mode, names, gain, writes] of cases) {
        const config = { pipelineStartup: mode, startupPreset: 'Quiet' };
        await withGlobals({ window: { location: { search: '' }, appConfig: config, electronIntegration: {} } }, async () => {
            const commands = [];
            let native = { ...snapshot(2, -12), pipelineStartup: phase };
            if (phase === 'uninitialized') native.pipelines = { A: [], B: null };
            else native.pipelines.B = null;
            if (mode === 'default') {
                native.slot = 'B';
                native.pipelines.B = snapshot(2, -15).pipelines.A;
            }
            native.pipeline = native.pipelines[native.slot];
            const pluginManager = {
                pluginClasses: { Volume: VolumePlugin, 'Level Meter': LevelMeterPlugin },
                nextPluginId: 1,
                createPlugin(name) {
                    const plugin = new this.pluginClasses[name]();
                    plugin.id = this.nextPluginId++;
                    plugin.setVl = value => { plugin.vl = value; };
                    return plugin;
                }
            };
            const manager = new AndroidAudioManager(null, { bridge: { on() {}, async request(command, payload) {
                if (command === 'pipeline.catalog') assert.equal(payload.applyStartupConfig, mode !== 'last');
                if (command === 'pipeline.slot' || command === 'pipeline.set') commands.push({ command, payload });
                if (command === 'pipeline.set') {
                    native = { ...native, revision: native.revision + 1, pipelineStartup: 'running', slot: payload.slot,
                        pipeline: payload.plugins, pipelines: { ...native.pipelines, [payload.slot]: payload.plugins } };
                }
                return native;
            } } });
            await manager.initAudio();
            const presetManager = {
                getPresets: async () => ({ Quiet: {} }),
                async loadPreset() {
                    const plugin = pluginManager.createPlugin('Volume');
                    plugin.setVl(-3);
                    manager.updateCurrentPipeline([plugin]);
                    manager.commitPowerTopologyMutation();
                    manager.setMasterBypass(false);
                }
            };
            const built = await App.prototype.initializeAndBuildPipeline.call({
                audioManager: manager, pluginManager, startupConfig: config,
                restoreDoubleBlindTestFromUrl() {},
                uiManager: { expandedPlugins: new Set(), updatePipelineUI() {}, updateURL() {},
                    updatePipelineToggleButton() {}, parsePipelineState: () => null, pipelineManager: { presetManager } }
            });
            assert.equal(built, true, `${phase} / ${mode}`);
            assert.deepEqual(manager.pipeline.map(plugin => plugin.name), names);
            assert.equal(manager.pipeline[0].vl, gain);
            assert.deepEqual(commands.map(({ command }) => command), writes ? ['pipeline.set'] : []);
            if (writes) {
                assert.equal(commands[0].payload.slot, 'A');
                assert.deepEqual(commands[0].payload.plugins.map(({ name }) => name), names);
                assert.equal(commands[0].payload.plugins[0].parameters.vl, gain);
            }
            if (mode === 'default') assert.equal(manager.pipelineB[0].vl, -15);
        });
    }
});

test('a replacement Android pipeline receives its own execution notices', async () => {
    class TubeSimulatorPlugin extends VolumePlugin {
        static executionCapabilities = { requiresWasm: true, supportedChannelModes: ['stereo-pair'] };
        constructor() { super(); this.name = 'Tube Simulator'; this.id = 2; this.channel = 'L'; }
    }
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const { manager } = await audioFixture();
        const tube = new TubeSimulatorPlugin();
        manager.pipeline.length = 0;
        manager.updateCurrentPipeline([tube]);
        await manager.rebuildPipeline();
        assert.deepEqual(manager.getDspExecutionStateSnapshot().states.map(({ pluginId, state, reason }) =>
            [pluginId, state, reason]), [[tube.id, 'bypassed', 'unsupportedChannelMode']]);
    });
});

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

test('rapid native history and slot commands take turns with display saves', async () => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const started = deferred(), release = deferred();
        const { manager, requests } = await audioFixture(async (command, payload, revision) => {
            if (command === 'pipeline.undo' && revision === 1) { started.resolve(); await release.promise; }
            if (command === 'pipeline.slot') {
                if (payload.slot === 'A') await new Promise(resolve => setImmediate(resolve));
                return { ...snapshot(revision + 1), slot: payload.slot, pipelineRateMismatch: payload.slot === 'B' };
            }
            if (revision !== undefined) return snapshot(revision + 1);
        });
        const first = manager.nativePipelineCommand('undo');
        const second = manager.nativePipelineCommand('undo');
        const third = manager.nativePipelineCommand('redo');
        const switchSlot = manager.nativePipelineCommand('slot', { slot: 'B' });
        const switchBack = manager.nativePipelineCommand('slot', { slot: 'A' });
        await started.promise;
        manager.pipeline[0].vl = -31;
        await manager.rebuildPipeline();
        manager.savePipelineUIState();
        assert.equal(requests.filter(r => r.command === 'pipeline.undo').length, 1);
        release.resolve();
        await Promise.all([first, second, third, switchSlot, switchBack]);
        Object.assign(manager.pipeline[0], { _uiCollapsed: true, _uiLocked: true });
        manager.savePipelineUIState();
        await manager.pendingMutation;
        assert.deepEqual(requests.filter(r => r.revision !== undefined).map(r => [r.command, r.revision]), [
            ['pipeline.undo', 1], ['pipeline.undo', 2], ['pipeline.redo', 3],
            ['pipeline.slot', 4], ['pipeline.set', 5], ['pipeline.slot', 6], ['pipeline.ui', 7]
        ]);
        assert.deepEqual(requests.at(-1).payload.plugins, [{ id: 1, _uiLocked: true, _uiCollapsed: true }]);
    });
});

test('native parameter writes keep the gesture identity and send only the completed preset', async () => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const { manager, requests } = await audioFixture();
        const plugin = manager.pipeline[0];
        let token = {};
        manager.pipelineManager.uiEventHandler = { parameterOperation: { plugin }, getParameterOperationToken: () => token };
        const edit = value => { plugin.vl = value; manager.commitPowerTopologyMutation({ plugin }); };
        edit(-1); edit(-2);
        token = {};
        edit(-3);
        manager.pipelineManager.audioManager = manager;
        const history = manager.pipelineManager.historyManager = new HistoryManager(manager.pipelineManager);
        await manager.withMutationOptions({}, () => history.withHistorySuppressed(() => { edit(-4); edit(-5); }));
        const writes = requests.filter(r => r.command === 'pipeline.set').map(r => r.payload);
        assert.deepEqual(writes.map(write => write.plugins[0].parameters.vl), [-1, -2, -3, -5]);
        assert.equal(typeof writes[0].operationToken, 'string');
        assert.equal(writes[0].operationToken, writes[1].operationToken);
        assert.notEqual(writes[0].operationToken, writes[2].operationToken);
        assert.equal(writes[3].operationToken, undefined);
    });
});

test('a rejected native revision restores the authoritative pipeline and leaves later edits usable', async () => {
    const diagnostics = [];
    const errors = [];
    await withGlobals({ window: { electronAPI: {}, uiManager: { setError: (...args) => errors.push(args) } },
        console: createConsoleHarness({ error: (...args) => diagnostics.push(args) }) }, async () => {
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
        assert.deepEqual(errors, [['error.pipelineEditFailed', true]]);
        assert.deepEqual(updates, [true]);
        manager.pipeline[0].vl = -9;
        await manager.rebuildPipeline();
        assert.deepEqual(requests.filter(item => item.command === 'pipeline.set').map(item => item.revision), [1, 7]);
        assert.equal(manager.snapshot.revision, 8);
        assert.equal(diagnostics.length, 1);
    });
});

test('Android DBT restore waits for the service and restored asset errors use the asset notice', async () => {
    const errors = [];
    const gate = deferred(), requested = deferred();
    await withGlobals({ window: { electronAPI: {}, uiManager: { setError: (...args) => errors.push(args) } },
        console: createConsoleHarness() }, async () => {
        const { manager, listeners } = await audioFixture(async (command, payload) => {
            if (command === 'dbt.restore') {
                requested.resolve();
                await gate.promise;
                return { ...snapshot(2), pipelines: { A: payload.a.plugins, B: payload.b.plugins } };
            }
        });
        const previous = manager.pipelineA;
        const primary = [new VolumePlugin()];
        const secondary = [new VolumePlugin()];
        const restore = manager.restoreBlindTestPipelines(primary, secondary);
        await requested.promise;
        assert.equal(manager.pipelineA, previous);
        gate.resolve();
        await restore;
        assert.equal(manager.pipelineA, primary);
        assert.equal(manager.pipelineB, secondary);
        listeners.get('error')({ code: 'asset-restore-failed' });
        assert.deepEqual(errors, [['externalAsset.missing.one', true]]);
    });
});

test('an oversized edit restores the confirmed chain before accepting new edits', async () => {
    const messages = [];
    await withGlobals({ window: { electronAPI: {}, uiManager: { setError: key => messages.push(key) } } }, async () => {
        const { manager, requests } = await audioFixture(command => {
            if (command === 'pipeline.set') throw Object.assign(new Error('too many effects'), { code: 'pipeline-too-large' });
            if (command === 'snapshot.get') return snapshot(5, -12);
        });
        manager.pipeline.push(Object.assign(new VolumePlugin(), { id: 2 }));
        const rejected = manager.rebuildPipeline();
        const stale = manager.rebuildPipeline();
        await assert.rejects(rejected, { code: 'pipeline-too-large' });
        await stale;
        assert.deepEqual(messages, ['error.pipelineTooLarge']);
        assert.deepEqual(manager.pipeline.map(plugin => plugin.vl), [-12]);
        assert.equal(requests.filter(item => item.command === 'pipeline.set').length, 1);
        for (let id = 2; id <= 129; id++) manager.pipeline.push(Object.assign(new VolumePlugin(), { id }));
        await assert.rejects(manager.rebuildPipeline(), { code: 'pipeline-too-large' });
        assert.deepEqual(manager.pipeline.map(plugin => plugin.vl), [-12]);
        assert.equal(requests.filter(item => item.command === 'pipeline.set').length, 1);
    });
});

test('inactive files with the same effect ID are delivered only to the stored slot', async () => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const { manager, requests } = await audioFixture(command => {
            if (command.startsWith('pipeline.asset.')) return { revision: 1, state: 'stored' };
        });
        const active = manager.pipelineA[0], inactive = new VolumePlugin();
        manager.pipelineB = [inactive];
        manager.bindInactiveSlot();
        inactive.assets.set(0, { payload: new ArrayBuffer(32), operationRevision: 7 });
        for (const notify of inactive.listeners) notify();
        await manager.pendingMutation;
        const writes = requests.filter(item => item.command.startsWith('pipeline.asset.'));
        assert.deepEqual(writes.map(item => item.command), ['pipeline.asset.begin', 'pipeline.asset.chunk', 'pipeline.asset.commit']);
        assert.ok(writes.every(item => item.payload.inactiveSlot === 'B'));
        assert.deepEqual(inactive.assetStates, [[0, 3, 7]]);
        assert.deepEqual(active.assetStates, []);
        inactive.clearWasmAsset(0);
        for (const notify of inactive.listeners) notify();
        await manager.pendingMutation;
        assert.equal(requests.at(-1).command, 'pipeline.asset.clear');
        assert.equal(requests.at(-1).payload.inactiveSlot, 'B');
    });
});

test('large Android snapshots read both slots in pages at the original revision', async () => {
    await withGlobals({ window: { electronAPI: {} } }, async () => {
        const { manager, requests } = await audioFixture((command, payload) => {
            if (command !== 'pipeline.readSlot') return;
            if (payload.slot === 'B') return { records: null };
            return { records: [{ ...snapshot(5).pipelines.A[0], id: payload.offset + 1 }], more: payload.offset === 0 };
        });
        manager.acceptSnapshot({ ...snapshot(5), pipelines: undefined });
        await manager.restoreNativePipeline();
        assert.deepEqual(manager.pipelineA.map(plugin => plugin.id), [1, 2]);
        assert.equal(manager.pipelineB, null);
        assert.deepEqual(requests.filter(item => item.command === 'pipeline.readSlot').map(
            ({ payload, revision }) => [payload.slot, payload.offset, revision]), [['A', 0, 5], ['A', 1, 5], ['B', 0, 5]]);
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
        const options = { signal: new AbortController().signal, bulkPlayId: 'library-play' };
        const loading = context.seamlessTransition(track, 0, true, options);
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
            ['playback.queue.begin', 'playback.queue.append', 'playback.queue.commit', 'playback.play']);
        assert.equal(requests.find(item => item.command === 'playback.queue.begin').payload.bulkPlayId, options.bulkPlayId);
        assert.deepEqual(requests.find(item => item.command === 'playback.queue.append').payload.items, [{ ...source, replayGainFactor: 1 }]);
        assert.equal(player.stateManager.getStateSnapshot().currentTrack, track);
        context.disconnect();
    });
});

test('native queue selection accepts shared load arguments and respects cancellation', async () => {
    await withGlobals({ window: {} }, async () => {
        const { context, requests } = playerFixture();
        const track = { nativeQueueIndex: 7 };
        await context.loadTrack(track, 1, null, {});
        await assert.rejects(context.seamlessTransition(track, 1, true, { signal: AbortSignal.abort() }), { name: 'AbortError' });
        assert.deepEqual(requests.map(({ command, payload }) => [command, payload]), [['playback.select', { index: 7 }]]);
        context.disconnect();
    });
});

test('Android resolves local and network DSD sources with their original URI and tags', async () => {
    await withGlobals({ window: {} }, async () => {
        const { context, requests } = playerFixture();
        for (const track of [
            { name: 'song.dsf', uri: 'content://music/song.dsf' },
            { name: 'other.DFF', uri: 'content://music/other.DFF' },
            { name: 'Album title', uri: 'https://example.test/music/song.dsf?token=abc' },
            { name: 'Album title', url: 'https://example.test/music/song.DFF?token=abc' }
        ]) {
            const metadata = { title: 'Tagged title', artist: 'Artist', album: 'Album' };
            const item = await context.resolveNativeSource({ ...track, meta: metadata });
            assert.equal(item.uri, track.uri || track.url);
            assert.deepEqual(item.metadata, metadata);
        }
        assert.deepEqual(requests, []);
        context.disconnect();
    });
});

test('Android prepares MIDI and MusicXML scores for the native queue and physical output', async () => {
    const midi = Uint8Array.of(77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
        77, 84, 114, 107, 0, 0, 0, 12, 0, 144, 60, 100, 96, 128, 60, 0, 0, 255, 47, 0);
    const xml = new TextEncoder().encode('<score-partwise version="3.1"><part-list><score-part id="P1">' +
        '<part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1">' +
        '<attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch>' +
        '<duration>1</duration></note></measure></part></score-partwise>');
    await withGlobals({ window: {} }, async () => {
        for (const [name, bytes] of [['song.mid', midi], ['song.musicxml', xml]]) {
            const { context, manager } = playerFixture(command => {
                if (command === 'playback.close') return {};
                assert.equal(command, 'documents.createTemporary');
                return { uri: 'content://test/score.bin' };
            });
            manager.getNativeSampleRate = () => 48000;
            context.documents.read = async () => bytes;
            let packed;
            context.documents.write = async (uri, buffer) => { packed = new DataView(buffer); };
            const track = { name, uri: 'content://test/original' };
            const source = await context.resolveNativeSource(track);
            assert.equal(source.scoreUri, 'content://test/score.bin');
            assert.equal(source.scoreName, name);
            assert.equal(source.metadata.duration, packed.getFloat64(8, true));
            const events = packed.getUint32(0, true), points = packed.getUint32(4, true);
            assert.ok(events >= 2 && points >= 1);
            const wire = 16 + 20 * events + 40 * points;
            assert.ok(packed.byteLength > wire);
            if (name === 'song.mid') {
                assert.equal(packed.getFloat64(wire, true), 0);
                assert.equal(packed.getUint32(wire + 8, true), 3);
                assert.deepEqual([...new Uint8Array(packed.buffer, wire + 12, 3)], [144, 60, 100]);
            }
            assert.equal(await context.resolveNativeSource(track), source);
            context.disconnect();
        }
    });
});

test('native insertion resolves a lazy sequence in bounded pages at the requested ordinals', async () => {
    await withGlobals({ window: {} }, async () => {
        const { context, requests } = playerFixture();
        context.nativeQueue.accept({ queueLength: 3, shuffle: true, shuffleSeed: 0 });
        const ordinals = [];
        const sequence = { itemCount: 65,
            async getEntry(ordinal) { ordinals.push(ordinal); return { ordinal, title: `Song ${ordinal}` }; },
            async resolveEntrySource(entry) { return { uri: `content://music/${entry.ordinal}` }; } };
        assert.deepEqual(await context.insertNativeQueue({ sequence, index: 1 }), { accepted: true, preserved: true });
        assert.deepEqual(ordinals, Array.from({ length: 65 }, (_, index) => index));
        assert.deepEqual(requests.map(({ command, payload }) => [command, payload.index, payload.items.length, payload.transportOrder]),
            [['playback.insert', 1, 64, true], ['playback.insert', 65, 1, true]]);
        assert.equal(requests[1].payload.items[0].title, 'Song 64');
        context.disconnect();
    });
});

test('Android commits the catalog shuffle even when provisional playback is preserved', async () => {
    await withGlobals({ window: {} }, async () => {
        const { context, requests } = playerFixture();
        const sequence = { kind: 'catalog', itemCount: 3, shuffleEnabled: true, permutation: { seed: 0 },
            toCanonicalOrdinal: ordinal => [1, 0, 2][ordinal],
            toTransportOrdinal: ordinal => [1, 0, 2][ordinal],
            async getEntry(ordinal) { return { ordinal, title: String(ordinal) }; },
            async resolveEntrySource({ ordinal }) { return { uri: `content://music/${ordinal}` }; } };
        try {
            await context.replaceNativeQueue({ sequence, preservePlayback: true, bulkPlayId: 'shuffle' });
            const [begin, append, commit] = requests;
            assert.equal(begin.payload.bulkPlayId, 'shuffle');
            assert.equal(begin.payload.index, 1);
            assert.equal(begin.payload.startOrdinal, 0);
            assert.equal(begin.payload.shuffle, true);
            assert.equal(begin.payload.shuffleSeed, 0);
            assert.deepEqual(append.payload.items.map(item => item.title), ['1', '0', '2']);
            assert.equal(commit.payload.preservePlayback, true);
            assert.equal(requests.some(item => item.command === 'playback.play'), false);
            await context.restoreNativeQueue('shuffle');
            assert.deepEqual(requests.at(-1), { command: 'playback.queue.restore', payload: { operationId: 'shuffle' } });
        } finally { context.disconnect(); }
    });
});

test('Android stages only available catalog tracks and remaps the selected ordinal', async t => {
    t.mock.method(console, 'warn', () => {});
    const messages = [];
    await withGlobals({ window: { uiManager: { showTransientMessage: (...args) => messages.push(args) } } }, async () => {
        const { context, requests } = playerFixture();
        const sequence = { kind: 'catalog', itemCount: 4,
            async getEntry(ordinal) { return { ordinal, title: `Song ${ordinal}`, durationSec: 5 }; },
            async resolveEntrySource({ ordinal }) {
                if (ordinal % 2 === 0) throw Object.assign(new Error('Missing file'), { code: 'document-not-found' });
                return { uri: `content://music/${ordinal}` };
            } };
        try {
            await context.replaceNativeQueue({ sequence, index: 2, play: true });
            const [, append, commit, play] = requests;
            assert.deepEqual(append.payload.items.map(item => item.uri), ['content://music/1', 'content://music/3']);
            assert.deepEqual(append.payload.items[1].metadata, { title: 'Song 3', duration: 5 });
            assert.equal(commit.payload.index, 1);
            assert.equal(play.command, 'playback.play');
            assert.deepEqual(messages, [['status.libraryTracksSkippedMissing', false, { count: 2 }]]);
        } finally { context.disconnect(); }
    });
});

test('catalog insertion skips missing documents across empty pages and keeps surviving tracks together', async t => {
    t.mock.method(console, 'warn', () => {});
    const messages = [];
    await withGlobals({ window: { uiManager: { showTransientMessage: (...args) => messages.push(args) } } }, async () => {
        const { context, requests } = playerFixture();
        const sequence = { kind: 'catalog', itemCount: 130,
            getEntry: async ordinal => ({ ordinal, title: String(ordinal) }),
            async resolveEntrySource({ ordinal }) {
                if (!ordinal || (ordinal >= 63 && ordinal < 128)) {
                    throw Object.assign(new Error('Missing file'), { code: 'document-not-found' });
                }
                return { uri: `content://music/${ordinal}` };
            } };
        try {
            await context.insertNativeQueue({ sequence, index: 3 });
            assert.deepEqual(requests.map(({ command, payload }) => [command, payload.index, payload.items.length]),
                [['playback.insert', 3, 62], ['playback.insert', 65, 2]]);
            assert.deepEqual(requests.flatMap(({ payload }) => payload.items.map(item => Number(item.title))),
                [...Array.from({ length: 62 }, (_, index) => index + 1), 128, 129]);
            assert.deepEqual(messages, [['status.libraryTracksSkippedMissing', false, { count: 66 }]]);
            await assert.rejects(context.insertNativeQueue({ sequence: { ...sequence, itemCount: 1 }, index: 3 }),
                { code: 'library-files-missing' });
            assert.deepEqual(messages[1], ['status.libraryTracksSkippedMissing', false, { count: 1 }]);
            const denied = Object.assign(new Error('Access denied'), { code: 'permission-denied' });
            await assert.rejects(context.insertNativeQueue({ sequence: { ...sequence,
                resolveEntrySource: async () => { throw denied; } }, index: 3 }), error => error === denied);
            assert.equal(requests.length, 2);
            assert.equal(messages.length, 2);
        } finally { context.disconnect(); }
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
            if (command === 'playback.close') return {};
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
        player.stateManager.updateState({ currentTrackName: 'Old' });
        await context.rebindCurrentPlayback();
        assert.equal(player.stateManager.getStateSnapshot().currentTrackName, 'New');
        context.disconnect();
    });
});

test('closing the native player revokes artwork and prevents late metadata from replacing it', async () => {
    await withGlobals({ window: {} }, async () => {
        const stat = deferred();
        const { context, listeners } = playerFixture(command => command === 'documents.stat' ? stat.promise : {});
        const url = URL.createObjectURL(new Blob(['artwork']));
        context.currentArtworkURL = url;
        context.loadMetadata = () => assert.fail('Closed player must ignore late metadata');
        listeners.get('snapshot')({ revision: 2, playback: { index: 0, queueLength: 1,
            source: { uri: 'content://music/track', title: 'Song', metadata: { title: 'Song' } } } });
        context.disconnect();
        stat.resolve({ name: 'Song.wav', size: 3 });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(context.currentArtworkURL, null);
        await assert.rejects(fetch(url), TypeError);
    });
});

test('Android remote renderer lifecycle preserves publication payloads and releases status subscriptions', async () => {
    const listeners = new Map(), requests = [], notifications = [];
    const status = { running: true, clients: 2, port: 47319 };
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
    assert.deepEqual(notifications, [status]);
    const state = { revision: 4, pipeline: [{ nm: 'Volume', vl: -6 }] };
    const response = { requestId: 'request-4', ok: true, data: { revision: 4 } };
    await api.publishState(state);
    await api.respond(response);
    await api.rendererUnavailable();
    detach();
    assert.equal(listeners.size, 0);
    assert.deepEqual(requests, [
        { command: 'remote.rendererReady', payload: undefined },
        { command: 'remote.getStatus', payload: undefined },
        { command: 'remote.publishState', payload: state },
        { command: 'remote.respond', payload: response },
        { command: 'remote.rendererUnavailable', payload: undefined }
    ]);
    assert.equal(requests[2].payload, state);
    assert.equal(requests[3].payload, response);
});


test('Android instrument transfers send descriptor footprints and execution channels', async () => {
    await withGlobals({ window: {} }, async () => {
        class SFZNotePlayerPlugin extends VolumePlugin {}
        class SoundFontPlayerPlugin extends VolumePlugin {}
        const requests = [];
        const assets = new AndroidAssets({ async request(command, payload) {
            requests.push({ command, payload });
        } });
        const plugins = [new SFZNotePlayerPlugin(), new SoundFontPlayerPlugin(), new VolumePlugin()];
        plugins.forEach((plugin, index) => {
            plugin.id = index + 1;
            plugin.assets.set(0, { payload: new ArrayBuffer(4), footprintBytes: 4, processingChannels: 1 });
        });
        plugins[0].channel = 'L';
        plugins[1].channel = 'A';
        await assets.transfer(plugins);
        const begin = requests.filter(item => item.command === 'pipeline.asset.begin').map(item => item.payload);
        assert.deepEqual(begin.map(item => [item.footprintBytes, item.processingChannels]),
            [[4, 1], [4, 2], [4, 1]]);
        assert.ok(plugins.every(plugin => plugin.assetStates.length === 1));
    });
});

test('Android startup skips the web DSP module prefetch because native audio owns processing', async () => {
    const attempts = [];
    await withGlobals({
        window: { location: { pathname: '/effetune.html', search: '' } },
        fetch: url => { attempts.push(url); throw new Error('unexpected fetch'); },
        console: createConsoleHarness({ warn: (...args) => attempts.push(args) })
    }, async () => {
        const { manager } = await audioFixture();
        await manager.prefetchDspModule();
    });
    assert.deepEqual(attempts, []);
});
