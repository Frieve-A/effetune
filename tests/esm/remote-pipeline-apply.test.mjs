import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyOpsToPipeline, applyParamsToPlugin, createIdRegistry, finishBatch, randomClientPrefix, validateEdit
} from '../../js/remote/pipeline-apply.js';

class FakePlugin {
    constructor(name, id) {
        this.name = name;
        this.id = id;
        this.enabled = true;
        this.inputBus = null;
        this.outputBus = null;
        this.channel = null;
        this.parameters = {};
        this.cleaned = false;
    }

    setParameters(p) { Object.assign(this.parameters, p); }
    setEnabled(on) { this.enabled = on; }
    setSerializedParameters(state) {
        const { nm, en, ib, ob, ch, ...rest } = state;
        this.parameters = { ...rest };
    }

    getSerializableParameters() { return { ...this.parameters }; }
    cleanup() { this.cleaned = true; }
    syncUIControls() { this.synced = true; }
}

function makeWin() {
    let nextId = 1;
    const calls = [];
    const pipeline = [];
    const win = {
        document: { querySelector: () => null },
        audioManager: { pipeline, masterBypass: false },
        pluginManager: {
            isPluginAvailable: nm => ['Volume', 'Mute', 'Limiter'].includes(nm),
            createPlugin: nm => new FakePlugin(nm, nextId++)
        },
        uiManager: { updateURL: () => calls.push('url') },
        pipelineManager: {
            expandedPlugins: new Set(),
            selectedPlugins: new Set(),
            historyManager: { saveState: () => calls.push('history') },
            core: {
                enabled: true,
                workletSync: { updateMasterBypass: on => { win.audioManager.masterBypass = on; calls.push(`bypass:${on}`); } },
                updatePipelineUI: () => calls.push('ui'),
                updateWorkletPlugins: () => calls.push('worklets'),
                updateWorkletPlugin: plugin => calls.push(`worklet:${plugin.id}`),
                updateAllPluginDisplayState: () => calls.push('display')
            }
        }
    };
    return { win, calls, pipeline };
}

function seed(win, registry, names) {
    for (const name of names) {
        const plugin = win.pluginManager.createPlugin(name);
        win.audioManager.pipeline.push(plugin);
        win.pipelineManager.expandedPlugins.add(plugin);
    }
    return win.audioManager.pipeline.map(plugin => registry.idOf(plugin));
}

test('ids are stable per instance and distinct between participants', () => {
    const a = createIdRegistry('h');
    const plugin = new FakePlugin('Volume', 1);
    assert.equal(a.idOf(plugin), 'h.1');
    assert.equal(a.idOf(plugin), 'h.1');
    assert.equal(a.idOf(new FakePlugin('Mute', 2)), 'h.2');
    a.setId(plugin, 'cabc.7');
    assert.equal(a.idOf(plugin), 'cabc.7');
    const prefix = randomClientPrefix({ getRandomValues: bytes => bytes.fill(35) });
    assert.match(prefix, /^c[0-9a-z]{6}$/);
});

test('set, insert, move and delete change the live pipeline in place', () => {
    const { win, pipeline } = makeWin();
    const registry = createIdRegistry('h');
    const [a, b] = seed(win, registry, ['Volume', 'Mute']);
    const original = pipeline;
    const result = applyOpsToPipeline(win, [
        { t: 'set', id: a, p: { vl: -3, en: false, ib: 2 } },
        { t: 'ins', id: 'c1.1', after: a, at: 1, item: { nm: 'Limiter', en: true, th: -6 } },
        { t: 'mov', id: b, after: null, at: 0 },
        { t: 'del', id: 'nope' }
    ], { registry });
    assert.equal(pipeline, original);
    assert.deepEqual(pipeline.map(plugin => registry.idOf(plugin)), [b, a, 'c1.1']);
    assert.equal(pipeline[1].parameters.vl, -3);
    assert.equal(pipeline[1].enabled, false);
    assert.equal(pipeline[1].inputBus, 2);
    assert.equal(pipeline[2].parameters.th, -6);
    assert.deepEqual(result.skipped, [3]);
    assert.equal(result.structural, true);
    assert.ok(win.pipelineManager.expandedPlugins.has(pipeline[2]));
});

test('deleting a stage cleans it up and forgets its selection', () => {
    const { win, pipeline } = makeWin();
    const registry = createIdRegistry('h');
    const [a] = seed(win, registry, ['Volume']);
    const plugin = pipeline[0];
    win.pipelineManager.selectedPlugins.add(plugin);
    applyOpsToPipeline(win, [{ t: 'del', id: a }], { registry });
    assert.equal(plugin.cleaned, true);
    assert.equal(pipeline.length, 0);
    assert.equal(win.pipelineManager.expandedPlugins.has(plugin), false);
    assert.equal(win.pipelineManager.selectedPlugins.has(plugin), false);
});

test('recycling keeps the plugin instance when a stage is replaced by the same effect', () => {
    const { win, pipeline } = makeWin();
    const registry = createIdRegistry('h');
    const [a, b] = seed(win, registry, ['Volume', 'Mute']);
    const keep = pipeline[0];
    const gone = pipeline[1];
    applyOpsToPipeline(win, [
        { t: 'del', id: a },
        { t: 'del', id: b },
        { t: 'ins', id: 'h.new1', after: null, at: 0, item: { nm: 'Volume', en: true, vl: -9 } }
    ], { registry, recycle: true });
    assert.equal(pipeline.length, 1);
    assert.equal(pipeline[0], keep);
    assert.equal(registry.idOf(keep), 'h.new1');
    assert.equal(keep.parameters.vl, -9);
    assert.equal(keep.cleaned, false);
    assert.equal(gone.cleaned, true);
    assert.ok(win.pipelineManager.expandedPlugins.has(keep));
});

test('a recycled stage does not keep the buses, channel or enabled flag of the old instance', () => {
    const { win, pipeline } = makeWin();
    const registry = createIdRegistry('h');
    const [a] = seed(win, registry, ['Volume']);
    const old = pipeline[0];
    old.inputBus = 3;
    old.outputBus = 4;
    old.channel = 'L';
    old.enabled = false;
    applyOpsToPipeline(win, [
        { t: 'del', id: a },
        { t: 'ins', id: 'h.new1', after: null, at: 0, item: { nm: 'Volume', vl: -3 } }
    ], { registry, recycle: true });
    assert.equal(pipeline[0], old);
    assert.equal(old.inputBus, null);
    assert.equal(old.outputBus, null);
    assert.equal(old.channel, null);
    assert.equal(old.enabled, true);
    assert.equal(old.parameters.vl, -3);
});

test('a recycled stage still takes the buses its new item carries', () => {
    const { win, pipeline } = makeWin();
    const registry = createIdRegistry('h');
    const [a] = seed(win, registry, ['Volume']);
    pipeline[0].inputBus = 3;
    applyOpsToPipeline(win, [
        { t: 'del', id: a },
        { t: 'ins', id: 'h.new1', after: null, at: 0, item: { nm: 'Volume', en: false, ib: 2, ch: 'R' } }
    ], { registry, recycle: true });
    assert.equal(pipeline[0].inputBus, 2);
    assert.equal(pipeline[0].outputBus, null);
    assert.equal(pipeline[0].channel, 'R');
    assert.equal(pipeline[0].enabled, false);
});

test('without recycling a replaced stage is rebuilt from scratch', () => {
    const { win, pipeline } = makeWin();
    const registry = createIdRegistry('h');
    const [a] = seed(win, registry, ['Volume']);
    const before = pipeline[0];
    applyOpsToPipeline(win, [
        { t: 'del', id: a },
        { t: 'ins', id: 'h.new1', after: null, at: 0, item: { nm: 'Volume', en: true } }
    ], { registry });
    assert.notEqual(pipeline[0], before);
    assert.equal(before.cleaned, true);
});

test('an insert that is skipped does not leak its recycled plugin', () => {
    const { win, pipeline } = makeWin();
    const registry = createIdRegistry('h');
    const [a, b] = seed(win, registry, ['Volume', 'Mute']);
    const doomed = pipeline[0];
    applyOpsToPipeline(win, [
        { t: 'del', id: a },
        { t: 'ins', id: b, after: null, at: 0, item: { nm: 'Volume' } }
    ], { registry, recycle: true });
    assert.equal(doomed.cleaned, true);
    assert.equal(pipeline.length, 1);
});

test('master bypass goes through the master toggle path', () => {
    const { win, calls } = makeWin();
    const registry = createIdRegistry('h');
    applyOpsToPipeline(win, [{ t: 'bypass', on: true }], { registry });
    assert.equal(win.audioManager.masterBypass, true);
    assert.equal(win.pipelineManager.core.enabled, false);
    assert.deepEqual(calls, ['bypass:true', 'display']);
});

test('parameter edits understand unset bus keys and the legacy empty channel', () => {
    const plugin = new FakePlugin('Volume', 1);
    plugin.inputBus = 1;
    plugin.outputBus = 2;
    plugin.channel = 'L';
    applyParamsToPlugin(plugin, { vl: 1, ch: '' }, ['ib', 'ob']);
    assert.deepEqual([plugin.inputBus, plugin.outputBus, plugin.channel, plugin.parameters.vl], [null, null, null, 1]);
    applyParamsToPlugin(plugin, { ch: 'R' }, ['ch']);
    assert.equal(plugin.channel, null);
});

test('validation rejects host-reserved ids from clients and unknown effects', () => {
    const { win } = makeWin();
    const insert = (id, nm = 'Volume') => [{ t: 'ins', id, after: null, at: 0, item: { nm } }];
    assert.equal(validateEdit(win, insert('h.5'), { isHost: true }).error, 'invalid-op');
    assert.equal(validateEdit(win, insert('h.5')).ok, true);
    assert.equal(validateEdit(win, insert('c1.1', 'Nope'), { isHost: true }).error, 'unknown-effect');
    assert.equal(validateEdit(win, insert('c1.1'), { isHost: true }).ok, true);
    assert.throws(() => validateEdit({}, []), /app-not-ready/);
});

test('unsetting effect parameters preserves other settings and the plugin instance', () => {
    const { win, pipeline } = makeWin();
    const registry = createIdRegistry('h');
    const [id] = seed(win, registry, ['Volume']);
    const plugin = pipeline[0];
    plugin.parameters = { vl: -3, ms0: 'left', mn0: 'Left seat', ms1: 'right' };
    plugin.enabled = false;
    plugin.inputBus = 2;
    plugin.outputBus = 3;
    plugin.channel = 'R';
    const result = applyOpsToPipeline(win, [
        { t: 'set', id, p: { vl: -1 }, d: ['ms0', 'mn0', 'ib'] }
    ], { registry });
    assert.equal(pipeline[0], plugin);
    assert.equal(registry.idOf(plugin), id);
    assert.equal(result.structural, false);
    assert.deepEqual(plugin.parameters, { vl: -1, ms1: 'right' });
    assert.deepEqual([plugin.enabled, plugin.inputBus, plugin.outputBus, plugin.channel], [false, null, 3, 'R']);
});

test('finishing a structural batch redraws, republishes and records history once', () => {
    const { win, calls } = makeWin();
    const hooks = { saveHistory: () => calls.push('save'), scheduleHistorySave: () => calls.push('schedule') };
    finishBatch(win, { structural: true, touched: new Set() }, hooks);
    assert.deepEqual(calls, ['ui', 'worklets', 'save', 'url']);
});

test('finishing a parameter-only batch updates each touched plugin without a redraw', () => {
    const { win, calls } = makeWin();
    const plugin = new FakePlugin('Volume', 7);
    finishBatch(win, { structural: false, touched: new Set([plugin]) }, {
        scheduleHistorySave: () => calls.push('schedule')
    });
    assert.deepEqual(calls, ['worklet:7', 'display', 'url', 'schedule']);
    assert.equal(plugin.synced, true);
    calls.length = 0;
    finishBatch(win, { structural: false, touched: new Set() });
    assert.deepEqual(calls, []);
});
