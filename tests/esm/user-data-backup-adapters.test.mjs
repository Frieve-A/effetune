import assert from 'node:assert/strict';
import test from 'node:test';
import { createUserDataBackupAdapter } from '../../js/user-data-backup/adapters.js';
import { PresetManager } from '../../js/ui/pipeline/preset-manager.js';
import { PluginPresetStore } from '../../js/ui/pipeline/plugin-preset-store.js';
import { ExtensionIrLibraryClient, ExtensionIrLibraryHost } from '../../extension/ir-library.js';
import { IrLibraryStore } from '../../js/ir-library/ir-library-store.js';
import { IrLibraryService } from '../../js/ir-library/service.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { createDefaultLayout } from '../../js/visualizer/visualizer-model.js';
import { prepareItems } from '../../js/user-data-backup/portable.js';
import { UserDataBackupService } from '../../js/user-data-backup/service.js';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';

const require = createRequire(import.meta.url);
const zipModule = { exports: {} };
runInThisContext(`(function(module, exports, require) {${readFileSync(new URL('../../js/vendor/jszip-3.10.2.min.js', import.meta.url), 'utf8')}\n})`)(zipModule, zipModule.exports, require);
const loadZip = async () => zipModule.exports;

function memoryBackend() {
    const files = new Map();
    return {
        read: async name => files.get(name)?.slice() || null,
        exists: async name => files.has(name),
        writeAtomic: async (name, bytes) => { files.set(name, bytes.slice()); },
        remove: async name => { files.delete(name); },
        list: async () => [...files.keys()],
        cleanupTemporary: async () => {}
    };
}

const emptyMeasurementStorage = { readBackupSnapshot: async () => [] };

test('visualizer backup carries user presets and inline background images only', async () => {
    const saved = new Map();
    const store = {
        readBackupSnapshot: async () => [...saved].map(([name, layout]) => ({ name, layout })),
        appendUserPreset: async (name, layout) => {
            if (saved.has(name)) throw new Error('Preset already exists');
            saved.set(name, structuredClone(layout));
        }
    };
    const layout = createDefaultLayout();
    layout.background.image = 'data:image/png;base64,aGVsbG8=';
    saved.set('Night', layout);
    const adapter = createUserDataBackupAdapter({ presetManager: { readBackupSnapshot: async () => ({}) },
        pluginPresetStore: { readBackupSnapshot: async () => ({}) },
        visualizerPresetStore: store, measurementStorage: emptyMeasurementStorage,
        irLibrary: { readBackupSnapshot: async () => [] } });
    const snapshot = await adapter.readSnapshot();
    assert.equal(snapshot.unavailable.length, 0);
    assert.deepEqual(snapshot.items.map(item => item.kind), ['visualizer']);
    assert.deepEqual(snapshot.items[0].data, layout);
    assert.equal((await prepareItems(snapshot.items))[0].available, true);
    const service = new UserDataBackupService({ adapter, appVersion: '2.11.0', loadZip });
    const catalog = await service.listBackup();
    const backup = await service.createBackup(catalog, [catalog.items[0].key]);
    const opened = await service.openBackup(backup.blob);
    assert.deepEqual(opened.items.map(item => item.data), [layout]);
    await adapter.appendItem({ ...snapshot.items[0], name: 'Night Copy' });
    assert.deepEqual(saved.get('Night Copy'), layout);
    await assert.rejects(adapter.appendItem({ ...snapshot.items[0], data: { ...layout, items: [null] } }));
    await assert.rejects(adapter.appendItem(snapshot.items[0]));
});

test('web and Electron adapters preserve raw presets, reject unsafe keys and isolate unreadable categories', async () => {
    const web = new Map([['effetune_presets', '{"Existing":{"plugins":[]}}']]);
    const files = new Map();
    const api = {
        getPath: async () => 'userData', joinPaths: async (...parts) => parts.join('/'),
        fileExists: async path => files.has(path),
        readFile: async path => ({ success: true, content: files.get(path) }),
        saveFile: async (path, content) => { files.set(path, content); return { success: true }; }
    };
    await withGlobals({ window: {}, document: { getElementById: () => null }, localStorage: {
        getItem: key => web.get(key) ?? null, setItem: (key, value) => web.set(key, value)
    } }, async () => {
        const manager = new PresetManager({ audioManager: {} });
        const store = new PluginPresetStore();
        const irLibrary = { store: { readBackupSnapshot: async () => [] } };
        const adapter = createUserDataBackupAdapter({ presetManager: manager, pluginPresetStore: store,
            measurementStorage: emptyMeasurementStorage, irLibrary });
        const item = { key: 'pipeline:Portable', id: 'Portable', kind: 'pipeline', name: 'Portable',
            data: { outputChannels: 8, plugins: [{ nm: 'Unknown', ch: 7, ib: 2, custom: [1, 2] }] } };
        await adapter.appendItem(item);
        await assert.rejects(adapter.appendItem(item));
        for (const name of ['__proto__', 'constructor', 'prototype']) {
            await assert.rejects(adapter.appendItem({ ...item, name }));
            await assert.rejects(adapter.appendItem({ kind: 'plugin', pluginName: 'Tone', name, data: {} }));
        }
        const snapshot = await adapter.readSnapshot();
        assert.equal(snapshot.unavailable.length, 0);
        assert.equal(snapshot.items.length, 2);
        assert.deepEqual(snapshot.items.find(value => value.name === item.name).data, item.data);
        assert.equal(manager.currentPresetName, '');
        window.electronAPI = api;
        window.electronIntegration = { isElectron: true };
        const desktop = createUserDataBackupAdapter({ presetManager: new PresetManager({ audioManager: {} }),
            measurementStorage: emptyMeasurementStorage, irLibrary });
        for (const value of snapshot.items) await desktop.appendItem(value);
        assert.deepEqual((await desktop.readSnapshot()).items, snapshot.items);
        files.set('userData/effetune_plugin_presets.json', 'broken');
        const partial = await desktop.readSnapshot();
        assert.deepEqual(partial.unavailable.map(value => value.kind), ['plugin']);
        assert.equal(partial.items.length, 2);
        files.set('userData/effetune_presets.json', 'broken');
        await assert.rejects(desktop.appendItem({ ...item, name: 'Another' }));
        assert.equal(files.get('userData/effetune_presets.json'), 'broken');
    });
});

test('extension IR backup transfers binary originals through the storage owner', async () => {
    const store = await new IrLibraryStore(memoryBackend()).open();
    const original = new Uint8Array([1, 5, 9, 12]);
    await store.importSingle({ bytes: original, fileName: 'Room.wav' });
    const host = new ExtensionIrLibraryHost(new IrLibraryService(store), {});
    const calls = [];
    const client = new ExtensionIrLibraryClient({ request: async (command, args) => {
        assert.equal(command, 'irLibrary');
        calls.push(args);
        return host.request(structuredClone(args), 'backup');
    } });
    const [data] = await client.readBackupSnapshot();
    assert.ok(data.originals[0].bytes instanceof Uint8Array);
    assert.deepEqual(data.originals[0].bytes, original);
    const destinationStore = await new IrLibraryStore(memoryBackend()).open();
    host.service = new IrLibraryService(destinationStore);
    const restored = await client.appendBackupItem(data, 'Room.wav');
    assert.equal(restored.entry.irId, data.entry.irId);
    assert.deepEqual(await destinationStore.readOriginal(restored.entry.irId), original);
    assert.equal(client.entries.length, 1);
    assert.ok(calls[1].data.originals[0].bytes instanceof Uint8Array);
});

test('measurement adapter remaps parent identifiers without changing point or channel keys', async () => {
    let saved;
    const storage = { appendBackupMeasurement: async (measurement, records) => {
        saved = { measurement, records }; return { mirrorWarning: true };
    } };
    const adapter = createUserDataBackupAdapter({ measurementStorage: storage });
    const result = await adapter.appendItem({ kind: 'measurement', name: 'Room', data: {
        measurement: { id: 'new', name: 'Room', points: [{ pointId: 4,
            frequencyResponse: [[100, 0]], ir: { stored: true } }] },
        impulseResponses: [{ measurementId: 'old', pointId: 4, sampleRate: 48000,
            onsetIndex: 0, data: new Float32Array([1]) }]
    } });
    assert.equal(result.id, 'new');
    assert.equal(result.mirrorWarning, true);
    assert.equal(saved.records[0].measurementId, 'new');
    assert.equal(saved.records[0].pointId, 4);
});
