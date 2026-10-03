import assert from 'node:assert/strict';
import test from 'node:test';
import { startRemoteControl } from '../../js/remote/remote-control.js';
import { IrLibraryStore } from '../../js/ir-library/ir-library-store.js';

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

    setParameters(p) { Object.assign(this.parameters, p); }
    setEnabled(on) { this.enabled = on; }
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
