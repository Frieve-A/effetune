import assert from 'node:assert/strict';
import test from 'node:test';
import { startRemoteControl } from '../../js/remote/remote-control.js';
import { IrLibraryStore } from '../../js/ir-library/ir-library-store.js';
import { HistoryManager } from '../../js/ui/pipeline/history-manager.js';
import { PipelineItemBuilder } from '../../js/ui/pipeline/pipeline-item-builder.js';
import { getSerializablePluginStateShort } from '../../js/utils/serialization-utils.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class FakePlugin {
    constructor(name, id) {
        this.name = name;
        this.id = id;
        this.enabled = true;
        this.inputBus = null;
        this.outputBus = null;
        this.channel = null;
        this.parameters = { vl: 0 };
    }

    setParameters(p) { Object.assign(this.parameters, p); this.updateParameters(); }
    setEnabled(on) { this.enabled = on; this.updateParameters(); }
    updateParameters() {}
    setSerializedParameters(state) {
        const { nm, en, ib, ob, ch, ...rest } = state;
        this.parameters = { ...rest };
    }

    getSerializableParameters() { return { ...this.parameters }; }
    cleanup() {}
    syncUIControls() {}
}

async function setup({ presets = { Demo: { plugins: [{ nm: 'Volume', en: true, vl: -3 }] } } } = {}) {
    let nextId = 1;
    const published = [];
    const responses = [];
    const calls = [];
    const api = {
        onRequest(callback) { api.request = callback; return () => {}; },
        onStatus(callback) { api.status = callback; return () => {}; },
        rendererReady: async () => ({ enabled: true }),
        rendererUnavailable: async () => {},
        publishState: async snapshot => { published.push(snapshot); },
        respond: async response => { responses.push(response); },
        notifyPresets: async () => { calls.push('notifyPresets'); },
        notifyIrs: async () => { calls.push('notifyIrs'); }
    };
    const pipeline = [];
    const audioManager = {
        pipeline,
        currentPipeline: 'A',
        masterBypass: false,
        commitPowerTopologyMutation(message) { calls.push(`commit:${message.type}`); },
        setMasterBypass(on) { audioManager.masterBypass = on; }
    };
    let storedPresets = presets;
    const presetManager = {
        getPresets: async () => storedPresets,
        getLoadablePresets: async () => storedPresets,
        loadPreset: async name => {
            calls.push(`loadPreset:${name}`);
            if (!storedPresets[name]) return false;
            pipeline.length = 0;
            for (const state of storedPresets[name].plugins) {
                const plugin = new FakePlugin(state.nm, nextId++);
                plugin.setSerializedParameters(state);
                pipeline.push(plugin);
            }
            return true;
        },
        deletePreset: async name => {
            if (!storedPresets[name]) return false;
            const { [name]: _gone, ...rest } = storedPresets;
            storedPresets = rest;
            await presetManager.persistPresets(storedPresets);
            return true;
        },
        persistPresets: async () => {},
        enqueuePresetMutation: mutation => mutation(),
        presetMutationAttemptRevision: 0
    };
    const win = {
        electronAPI: { remoteV1: api },
        crypto: globalThis.crypto,
        document: { querySelector: () => null, getElementById: () => null },
        addEventListener() {},
        audioManager,
        pluginManager: {
            isPluginAvailable: nm => ['Volume', 'Mute'].includes(nm),
            createPlugin: nm => new FakePlugin(nm, nextId++)
        },
        uiManager: {
            updateURL: () => calls.push('updateURL'),
            togglePipeline: async () => { audioManager.currentPipeline = audioManager.currentPipeline === 'A' ? 'B' : 'A'; calls.push('toggle'); },
            copyAToB: () => calls.push('copyAToB'),
            copyBToA: () => calls.push('copyBToA')
        },
        pipelineManager: {
            expandedPlugins: new Set(),
            selectedPlugins: new Set(),
            presetManager,
            historyManager: {
                saveState: () => calls.push('saveState'),
                beginOperation() {},
                endOperation() {},
                withHistorySuppressed: callback => callback(),
                undo: () => calls.push('undo'),
                redo: () => calls.push('redo')
            },
            core: {
                enabled: true,
                workletSync: { updateMasterBypass: on => { audioManager.masterBypass = on; calls.push(`bypass:${on}`); } },
                updatePipelineUI: () => calls.push('ui'),
                updateWorkletPlugins: () => calls.push('worklets'),
                updateWorkletPlugin: plugin => calls.push(`worklet:${plugin.id}`),
                updateAllPluginDisplayState: () => {}
            }
        }
    };
    const controller = await startRemoteControl(win);
    // The safety poll would keep the test process alive; commits and requests are what is tested.
    clearInterval(controller.pollTimer);
    const ask = async message => {
        const before = responses.length;
        api.request({ requestId: `r${before}`, message });
        for (let i = 0; i < 50 && responses.length === before; i += 1) await new Promise(resolve => setImmediate(resolve));
        return responses[before];
    };
    return { controller, win, api, ask, published, calls, pipeline, audioManager, presetManager };
}

function usePipelineHistory(win) {
    const { audioManager, pipelineManager, pluginManager } = win;
    audioManager.pipelineA = audioManager.pipeline;
    audioManager.pipelineB = null;
    audioManager.getCurrentPipeline = () => audioManager.pipelineA;
    audioManager.dispatchEvent = () => {};
    audioManager.pipelineManager = pipelineManager;
    pipelineManager.audioManager = audioManager;
    pipelineManager.pluginManager = pluginManager;
    pipelineManager.core.audioManager = audioManager;
    pipelineManager.core.getSerializablePluginState = getSerializablePluginStateShort;
    win.uiManager.updatePipelineToggleButton = () => {};
    const history = new HistoryManager(pipelineManager);
    pipelineManager.historyManager = history;
    const builder = new PipelineItemBuilder(pipelineManager.core);
    for (const plugin of audioManager.pipeline) builder.setupParameterUpdateHandling(plugin);
    const createPlugin = pluginManager.createPlugin;
    pluginManager.createPlugin = name => {
        const plugin = createPlugin(name);
        builder.setupParameterUpdateHandling(plugin);
        return plugin;
    };
    history.saveState();
    return history;
}

test('remote parameter updates in one drag form one undo step even across a pause', async t => {
    const { controller, win, ask, pipeline } = await setup();
    pipeline.push(new FakePlugin('Volume', 1));
    const history = usePipelineHistory(win);
    const { ids, epoch } = controller.takeSnapshot();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await withGlobals({ window: win, document: win.document }, async () => {
        for (const vl of [-1, -2, -3]) {
            const response = await ask({
                op: 'edit', epoch, slot: 'A', operation: 'drag-1',
                ops: [{ t: 'set', id: ids[0], p: { vl } }]
            });
            assert.equal(response.ok, true);
            t.mock.timers.tick(1500);
        }
        await ask({ op: 'edit', epoch, slot: 'A', operation: 'drag-1', operationEnd: true, ops: [] });
        assert.equal(history.history.length, 2, 'initial state plus one complete drag');
        await ask({ op: 'history', dir: 'undo' });
        assert.equal(win.audioManager.pipeline[0].parameters.vl, 0);
        await ask({ op: 'history', dir: 'redo' });
        assert.equal(win.audioManager.pipeline[0].parameters.vl, -3);
    });
});

test('separate remote drags stay separate and a net unchanged drag preserves redo', async t => {
    const { controller, win, ask, pipeline } = await setup();
    pipeline.push(new FakePlugin('Volume', 1));
    const history = usePipelineHistory(win);
    const { ids, epoch } = controller.takeSnapshot();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const drag = async (operation, values) => {
        for (const vl of values) {
            assert.equal((await ask({
                op: 'edit', epoch, operation, ops: [{ t: 'set', id: ids[0], p: { vl } }]
            })).ok, true);
        }
        await ask({ op: 'edit', epoch, operation, operationEnd: true, ops: [] });
    };
    await withGlobals({ window: win, document: win.document }, async () => {
        await drag('drag-1', [-3, -6]);
        await drag('drag-2', [-8, -9]);
        assert.equal(history.history.length, 3);
        await ask({ op: 'history', dir: 'undo' });
        assert.equal(win.audioManager.pipeline[0].parameters.vl, -6);
        t.mock.timers.tick(1500);
        assert.equal(history.canRedo, true, 'no delayed save replaces the undo state');
        ids[0] = controller.takeSnapshot().ids[0];
        await drag('drag-3', [-4, -6]);
        assert.equal(history.history.length, 3);
        assert.equal(history.canRedo, true);
        await ask({ op: 'history', dir: 'redo' });
        assert.equal(win.audioManager.pipeline[0].parameters.vl, -9);
    });
});

test('remote parameter resets preserve the drag operation through serialized-state application', async () => {
    const { controller, win, ask, pipeline } = await setup();
    const plugin = new FakePlugin('Volume', 1);
    plugin.parameters.optional = true;
    pipeline.push(plugin);
    const history = usePipelineHistory(win);
    const { ids, epoch } = controller.takeSnapshot();
    await withGlobals({ window: win, document: win.document }, async () => {
        for (const vl of [-1, -2, -3]) {
            assert.equal((await ask({
                op: 'edit', epoch, operation: 'drag-reset',
                ops: [{ t: 'set', id: ids[0], p: { vl }, d: ['optional'] }]
            })).ok, true);
            assert.equal(history.isOperationActive('drag-reset'), true);
            assert.equal(history.history.length, 2);
        }
        await ask({ op: 'edit', epoch, operation: 'drag-reset', operationEnd: true, ops: [] });
        await ask({ op: 'history', dir: 'undo' });
        assert.deepEqual(win.audioManager.pipeline[0].parameters, { vl: 0, optional: true });
        await ask({ op: 'history', dir: 'redo' });
        assert.deepEqual(win.audioManager.pipeline[0].parameters, { vl: -3 });
    });
});

test('a remote drag end does not close a newer host operation', async () => {
    const { controller, win, ask, pipeline } = await setup();
    pipeline.push(new FakePlugin('Volume', 1));
    const history = usePipelineHistory(win);
    const { ids, epoch } = controller.takeSnapshot();
    await ask({ op: 'edit', epoch, operation: 'drag-1', ops: [{ t: 'set', id: ids[0], p: { vl: -3 } }] });
    const localToken = {};
    history.beginOperation(localToken);
    await ask({ op: 'edit', epoch, operation: 'drag-1', operationEnd: true, ops: [] });
    assert.equal(history.isOperationActive(localToken), true);
});

test('the snapshot carries ids, slot and an epoch that is stable for this window', async () => {
    const { controller, pipeline } = await setup();
    pipeline.push(new FakePlugin('Volume', 1), new FakePlugin('Mute', 2));
    const first = controller.takeSnapshot();
    assert.match(first.epoch, /^[0-9a-f]{8}$/);
    assert.deepEqual(first.ids, ['h.1', 'h.2']);
    assert.equal(first.slot, 'A');
    assert.deepEqual(first.pipeline.map(item => item.nm), ['Volume', 'Mute']);
    pipeline.unshift(new FakePlugin('Volume', 3));
    const second = controller.takeSnapshot();
    assert.deepEqual(second.ids, ['h.3', 'h.1', 'h.2']);
    assert.equal(second.epoch, first.epoch);
});

test('snapshots carry the host audio format and the host routing limit', async () => {
    const { controller, audioManager } = await setup();
    audioManager.audioContext = { sampleRate: 96000, destination: { channelCount: 8 } };
    assert.deepEqual(controller.takeSnapshot().audio, {
        sampleRate: 96000, channelCount: 8, routingChannelCount: 16
    });
    audioManager.outputChannelCount = 8;
    assert.equal(controller.takeSnapshot().audio.routingChannelCount, 8);
});

test('IR selection loads on the host and rejects stale or unrelated target stages', async () => {
    const { controller, ask, pipeline, win } = await setup();
    const entry = { irId: 'a'.repeat(24), fileLabel: 'Hall.wav' };
    const loaded = [];
    const plugin = new FakePlugin('IR Reverb', 1);
    plugin.loadLibraryEntry = async selected => { loaded.push(selected); plugin.parameters.ir = selected.irId; return true; };
    pipeline.push(plugin, new FakePlugin('Volume', 2));
    win.irLibraryService = { get: id => id === entry.irId ? entry : null };
    const { ids, epoch } = controller.takeSnapshot();
    const message = { op: 'selectIR', epoch, slot: 'A', id: ids[0], ir: entry.irId };
    const result = await ask(message);
    assert.equal(result.ok, true);
    assert.equal(result.snapshot.pipeline[0].ir, entry.irId);
    assert.deepEqual(loaded, [entry]);
    for (const invalid of [
        { epoch: 'old' }, { slot: 'B' }, { slot: undefined }, { id: ids[1] }, { id: 'removed' },
        { ir: 'not-an-id' }, { ir: 'b'.repeat(24) }
    ]) assert.equal((await ask({ ...message, ...invalid })).ok, false);
    assert.equal(loaded.length, 1);
});

test('selection can list true-stereo IR pairs without changing the file-sync list', async () => {
    const { ask, win } = await setup();
    const single = { irId: 'a'.repeat(24), composition: 'single', fileLabel: 'A.wav', channels: 1,
        topology: 'mono', originals: [{ fileName: 'A.wav', byteLength: 100 }] };
    const pair = { irId: 'b'.repeat(24), composition: 'pair', fileLabel: 'B L.wav + B R.wav', channels: 4,
        topology: 'true-stereo', originals: [{ fileName: 'B L.wav', byteLength: 100 }, { fileName: 'B R.wav', byteLength: 100 }] };
    win.irLibraryService = { list: () => [single, pair] };
    assert.deepEqual((await ask({ op: 'listIRs' })).items.map(entry => entry.id), [single.irId]);
    const selectable = (await ask({ op: 'listIRs', includePairs: true })).items;
    assert.deepEqual(selectable.map(entry => entry.id), [single.irId, pair.irId]);
    assert.equal(selectable[1].topology, 'true-stereo');
    assert.equal(selectable[1].bytes, 200);
});

test('an edit batch changes the pipeline by ids and reports skipped ops', async () => {
    const { controller, ask, pipeline, calls } = await setup();
    pipeline.push(new FakePlugin('Volume', 1));
    const { ids, epoch } = controller.takeSnapshot();
    const response = await ask({ op: 'edit', epoch, base: 1, ops: [
        { t: 'set', id: ids[0], p: { vl: -9 } },
        { t: 'ins', id: 'cabc.1', after: ids[0], at: 1, item: { nm: 'Mute', en: true } },
        { t: 'del', id: 'nope' }
    ] });
    assert.equal(response.ok, true);
    assert.deepEqual(response.skipped, [2]);
    assert.equal(response.snapshot.pipeline[0].vl, -9);
    assert.deepEqual(response.snapshot.ids, [ids[0], 'cabc.1']);
    assert.ok(calls.includes('ui') && calls.includes('worklets') && calls.includes('saveState'));
    const paramsOnly = await ask({ op: 'edit', epoch, base: 2, ops: [{ t: 'set', id: ids[0], p: { vl: -2 } }] });
    assert.equal(paramsOnly.ok, true);
    assert.equal(paramsOnly.skipped, undefined);
    assert.ok(calls.includes(`worklet:${pipeline[0].id}`));
});

test('an edit batch is refused for a stale epoch, a bad op, an unknown effect or a host-only id', async () => {
    const { controller, ask } = await setup();
    const { epoch } = controller.takeSnapshot();
    assert.equal((await ask({ op: 'edit', epoch: 'deadbeef', ops: [] })).error, 'stale-epoch');
    assert.equal((await ask({ op: 'edit', epoch, ops: [{ t: 'zap' }] })).error, 'invalid-op');
    assert.equal((await ask({ op: 'edit', epoch, ops: [{ t: 'ins', id: 'c1.1', after: null, at: 0, item: { nm: 'Nope' } }] })).error, 'unknown-effect');
    assert.equal((await ask({ op: 'edit', epoch, ops: [{ t: 'ins', id: 'h.9', after: null, at: 0, item: { nm: 'Volume' } }] })).error, 'invalid-op');
    assert.equal((await ask({ op: 'edit', epoch, operation: {}, ops: [] })).error, 'invalid-op');
    assert.equal((await ask({ op: 'edit', epoch, operation: 'bad id', ops: [] })).error, 'invalid-op');
    assert.equal((await ask({ op: 'edit', epoch, operationEnd: true, ops: [] })).error, 'invalid-op');
    assert.equal((await ask({ op: 'edit', epoch, operation: 'drag-1', operationEnd: 'yes', ops: [] })).error, 'invalid-op');
    assert.equal(controller.takeSnapshot().ids.length, 0);
});

test('an edit made against the other slot is refused with slot-mismatch and changes nothing', async () => {
    const { controller, ask, pipeline } = await setup();
    pipeline.push(new FakePlugin('Volume', 1));
    const { ids, epoch } = controller.takeSnapshot();
    const ins = { t: 'ins', id: 'cabc.1', after: ids[0], at: 1, item: { nm: 'Mute', en: true } };
    const refused = await ask({ op: 'edit', epoch, slot: 'B', ops: [ins] });
    assert.equal(refused.ok, false);
    assert.equal(refused.error, 'slot-mismatch');
    assert.equal(pipeline.length, 1);
    assert.equal((await ask({ op: 'edit', epoch, slot: 'X', ops: [ins] })).error, 'invalid-op');
    assert.equal((await ask({ op: 'edit', epoch, slot: 'A', ops: [ins] })).ok, true);
    assert.equal(pipeline.length, 2);
    await ask({ op: 'slot', slot: 'B' });
    assert.equal((await ask({ op: 'edit', epoch, slot: 'A', ops: [{ t: 'set', id: ids[0], p: { vl: -1 } }] })).error, 'slot-mismatch');
});

test('history, slot and copy requests drive the same paths as the host buttons', async () => {
    const { ask, calls, audioManager } = await setup();
    assert.equal((await ask({ op: 'history', dir: 'undo' })).ok, true);
    assert.equal((await ask({ op: 'history', dir: 'redo' })).ok, true);
    assert.equal((await ask({ op: 'history', dir: 'sideways' })).ok, false);
    assert.deepEqual(calls.filter(call => /^(un|re)do$/.test(call)), ['undo', 'redo']);
    const switched = await ask({ op: 'slot', slot: 'B' });
    assert.equal(switched.snapshot.slot, 'B');
    assert.equal(audioManager.currentPipeline, 'B');
    await ask({ op: 'slot', slot: 'B' });
    assert.equal(calls.filter(call => call === 'toggle').length, 1, 'already active: nothing to do');
    assert.equal((await ask({ op: 'slot', slot: 'C' })).ok, false);
    await ask({ op: 'copySlot', from: 'A', to: 'B' });
    await ask({ op: 'copySlot', from: 'B', to: 'A' });
    assert.equal((await ask({ op: 'copySlot', from: 'A', to: 'A' })).ok, false);
    assert.ok(calls.includes('copyAToB') && calls.includes('copyBToA'));
});

test('stored presets can be listed in bulk, loaded and deleted', async () => {
    const { ask, calls, pipeline } = await setup();
    const listed = await ask({ op: 'presets' });
    assert.deepEqual(Object.keys(listed.presets), ['Demo']);
    assert.equal((await ask({ op: 'loadPreset', name: 'Demo' })).ok, true);
    assert.equal(pipeline.length, 1);
    assert.equal((await ask({ op: 'loadPreset', name: 'Missing' })).ok, false);
    assert.equal((await ask({ op: 'loadPreset' })).ok, false);
    assert.equal((await ask({ op: 'deletePreset', name: 'Missing' })).ok, false);
    assert.equal((await ask({ op: 'deletePreset' })).ok, false);
    assert.equal((await ask({ op: 'deletePreset', name: 'Demo' })).ok, true);
    assert.ok(calls.includes('loadPreset:Demo'));
    assert.deepEqual((await ask({ op: 'presets' })).presets, {});
});

test('legacy params, bypass and chain keep working next to the sync ops', async () => {
    const { controller, ask, pipeline } = await setup();
    pipeline.push(new FakePlugin('Volume', 1));
    const params = await ask({ op: 'params', index: 0, params: { vl: -6, nm: 'ignored', en: false, ib: 2, ch: '' } });
    assert.equal(params.ok, true);
    assert.deepEqual([pipeline[0].parameters.vl, pipeline[0].enabled, pipeline[0].inputBus, pipeline[0].channel], [-6, false, 2, null]);
    assert.equal((await ask({ op: 'params', index: 5, params: {} })).ok, false);
    assert.equal((await ask({ op: 'params', index: 0, params: [] })).ok, false);
    const bypass = await ask({ op: 'bypass', on: true });
    assert.equal(bypass.snapshot.masterBypass, true);
    assert.equal((await ask({ op: 'bypass', on: 'yes' })).ok, false);
    assert.equal((await ask({ op: 'chain', pipeline: [{ nm: 'Nope' }] })).ok, false);
    assert.equal((await ask({ op: 'chain', pipeline: 'x' })).ok, false);
    assert.equal((await ask({ op: 'mystery' })).ok, false);
    assert.equal(controller.takeSnapshot().masterBypass, true);
});

test('worklet commits and preset saves are announced without waiting for the poll', async () => {
    const { controller, audioManager, presetManager, published, calls, api } = await setup();
    controller.setActive(true);
    await new Promise(resolve => setTimeout(resolve, 150));
    const before = published.length;
    audioManager.pipeline.push(new FakePlugin('Volume', 1));
    audioManager.commitPowerTopologyMutation({ type: 'updatePlugins' });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(published.length > before, 'a commit publishes a new snapshot');
    assert.equal(published.at(-1).slot, 'A');
    await presetManager.persistPresets({});
    assert.ok(calls.includes('notifyPresets'));
    api.status({ enabled: false });
    controller.setActive(false);
    clearTimeout(controller.publishTimer);
});

test('an IR library change is announced to the host', async () => {
    const { controller, calls } = await setup();
    const files = new Map();
    const backend = {
        read: async name => files.get(name) ?? null,
        exists: async name => files.has(name),
        writeAtomic: async (name, bytes) => { files.set(name, bytes); },
        remove: async name => { files.delete(name); },
        list: async () => [...files.keys()],
        cleanupTemporary: async () => {}
    };
    const store = await new IrLibraryStore(backend, { onDiagnostic() {} }).open();
    const imported = await store.importSingle({ bytes: new TextEncoder().encode('bridge IR'), fileName: 'A.wav', analysis: {} });
    assert.equal(calls.filter(call => call === 'notifyIrs').length, 1);
    await store.remove(imported.entry.irId);
    assert.equal(calls.filter(call => call === 'notifyIrs').length, 2);
    controller.disposeIrWatch?.();
});
