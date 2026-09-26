import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { VisualizerPresetStore } from '../../js/visualizer/visualizer-preset-store.js';
import { createDefaultLayout, DEFAULT_THEME_COLORS, snapshotLayout, validateLayout } from '../../js/visualizer/visualizer-model.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

test('current layout persists on flush while named presets require explicit save', async () => {
    const stores = { current: new Map(), presets: new Map() };
    const store = new VisualizerPresetStore();
    store.request = async (name, _mode, action) => action({
        get: key => stores[name].get(key),
        put: (value, key) => stores[name].set(key, structuredClone(value)),
        getAllKeys: () => [...stores[name].keys()]
    });
    const layout = createDefaultLayout();
    layout.background.color = '#123456';
    store.saveCurrent(layout);
    assert.equal(stores.current.size, 0);
    assert.equal(stores.presets.size, 0);
    await store.flushCurrent();
    assert.deepEqual(await store.loadCurrent(), snapshotLayout(layout));
    assert.equal(stores.presets.size, 0);
    await store.saveUserPreset('Night', layout);
    assert.deepEqual(await store.getUserPreset('Night'), snapshotLayout(layout));
    assert.deepEqual(await store.listUserPresetNames(), ['Night']);
    layout.background.color = '#654321';
    store.saveCurrent(layout);
    await store.flushCurrent();
    assert.equal((await store.loadCurrent()).background.color, '#654321');
    assert.equal((await store.getUserPreset('Night')).background.color, '#123456');
    assert.deepEqual((await store.readBackupSnapshot()).map(item => item.name), ['Night']);
});

test('preset save and backup restore preserve effective theme colors including legacy sparse layouts', async () => {
    const presets = new Map();
    const store = new VisualizerPresetStore();
    store.request = async (_name, _mode, action) => action({
        get: key => presets.get(key),
        put: (value, key) => presets.set(key, structuredClone(value)),
        add: (value, key) => presets.set(key, structuredClone(value)),
        getAllKeys: () => [...presets.keys()]
    });
    const legacy = createDefaultLayout();
    legacy.background.themeColors = { 'graph-label': '#123456' };
    presets.set('Legacy', legacy);
    const layout = createDefaultLayout();
    layout.background.themeColors = { 'graph-grid-soft': '#abcdef33', 'text-primary': '#fedcba' };
    await withGlobals({ window: { ThemePalette: { get: () => 'rgb(255,255,255)' } } }, async () => {
        await store.saveUserPreset('Saved', layout);
        const saved = await store.getUserPreset('Saved');
        assert.deepEqual(saved.background.themeColors, { ...DEFAULT_THEME_COLORS, ...layout.background.themeColors });
        window.ThemePalette.get = () => 'rgb(0,0,0)';
        const snapshot = JSON.parse(JSON.stringify(await store.readBackupSnapshot()));
        for (const entry of snapshot) {
            assert.equal(validateLayout(entry.layout), true);
            assert.equal(Object.keys(entry.layout.background.themeColors).length, 8);
            await store.appendUserPreset(`${entry.name} restored`, entry.layout);
            assert.deepEqual(await store.getUserPreset(`${entry.name} restored`), entry.layout);
        }
        assert.deepEqual(snapshot.find(entry => entry.name === 'Saved').layout, saved);
        assert.deepEqual(snapshot.find(entry => entry.name === 'Legacy').layout.background.themeColors,
            { ...DEFAULT_THEME_COLORS, 'graph-label': '#123456' });
        await store.appendUserPreset('Legacy restored directly', legacy);
        assert.deepEqual((await store.getUserPreset('Legacy restored directly')).background.themeColors,
            { ...DEFAULT_THEME_COLORS, 'graph-label': '#123456' });
    });
});

test('system presets load once by aspect and never enter user storage', async () => {
    const requests = [];
    const store = new VisualizerPresetStore({ fetch: async url => {
        requests.push(String(url));
        return { ok: true, json: async () => JSON.parse(readFileSync(url, 'utf8')) };
    } });
    const presets = await store.loadSystemPresets();
    assert.deepEqual(Object.keys(presets), ['16:9', '21:9', '4:3', '1:1', '9:16']);
    assert.ok(Object.values(presets).every(group => Object.keys(group).length === 7));
    assert.equal(await store.loadSystemPresets(), presets);
    assert.equal(requests.length, 5);
});

test('default system preset fetch keeps the browser global as its receiver', async () => {
    const requests = [];
    await withGlobals({ fetch: async function (url) {
        assert.equal(this, globalThis);
        requests.push(String(url));
        return { ok: true, json: async () => JSON.parse(readFileSync(url, 'utf8')) };
    } }, async () => {
        const store = new VisualizerPresetStore();
        const presets = await store.loadSystemPresets();
        assert.equal(Object.keys(presets).length, 5);
    });
    assert.equal(requests.length, 5);
});
