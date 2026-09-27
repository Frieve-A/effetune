import { PluginPresetStore } from '../ui/pipeline/plugin-preset-store.js';
import measurementStorage, { validateMeasurementBackup } from '../../features/measurement/dataStorage.js';
import { getDefaultIrLibraryService } from '../ir-library/service.js';
import { VisualizerPresetStore } from '../visualizer/visualizer-preset-store.js';
import { validateLayout } from '../visualizer/visualizer-model.js';

const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const irName = entry => entry.originals.map(original => original.fileName).join(' + ');

export function createUserDataBackupAdapter(options = {}) {
    const presets = options.presetManager;
    const pluginPresets = options.pluginPresetStore || presets?.pipelineManager?.core?.pluginPresetDialog?.store || new PluginPresetStore();
    const visualizerPresets = options.visualizerPresetStore || (globalThis.indexedDB ? new VisualizerPresetStore() : null);
    const measurements = options.measurementStorage || measurementStorage;
    const client = options.extensionClient;
    const irLibrary = async () => options.irLibrary || globalThis.window?.irLibraryService || getDefaultIrLibraryService();
    const irOwner = async () => {
        const library = await irLibrary();
        return typeof library.readBackupSnapshot === 'function' ? library : library.store;
    };

    return {
        async readSnapshot() {
            const items = [];
            const unavailable = [];
            const read = async (kind, operation) => {
                try { items.push(...await operation()); }
                catch (error) {
                    console.error(`User data backup ${kind} read failed:`, error);
                    unavailable.push({ kind, reason: 'Saved data could not be read. Check your storage and try again.' });
                }
            };
            await read('pipeline', async () => {
                const saved = client ? await client.request('readBackupPresets') : await presets.readBackupSnapshot();
                if (!isRecord(saved)) throw new TypeError('Invalid pipeline preset storage');
                return Object.entries(saved).map(([name, data]) => ({ key: `pipeline:${name}`, id: name, kind: 'pipeline', name, data }));
            });
            await read('plugin', async () => {
                const saved = await pluginPresets.readBackupSnapshot();
                const result = [];
                for (const [pluginName, group] of Object.entries(saved)) {
                    if (!isRecord(group)) throw new TypeError('Invalid plugin preset group');
                    for (const [name, data] of Object.entries(group)) {
                        if (!isRecord(data)) throw new TypeError('Invalid plugin preset');
                        result.push({ key: `plugin:${pluginName}:${name}`, id: name, kind: 'plugin', pluginName, name, data });
                    }
                }
                return result;
            });
            if (visualizerPresets) await read('visualizer', async () => (await visualizerPresets.readBackupSnapshot()).map(({ name, layout }) => ({
                key: `visualizer:${name}`, id: name, kind: 'visualizer', name, data: layout
            })));
            await read('ir', async () => (await (await irOwner()).readBackupSnapshot()).map(data => ({
                key: `ir:${data.entry.irId}`, id: data.entry.irId, kind: 'ir', name: irName(data.entry), data
            })));
            await read('measurement', async () => (await measurements.readBackupSnapshot()).map(data => ({
                key: `measurement:${data.measurement.id}`, id: data.measurement.id, kind: 'measurement', name: data.measurement.name, data
            })));
            return { items, unavailable };
        },

        validateItem(item) {
            if (typeof item.name !== 'string' || !item.name.trim()) return 'Enter a name for this item.';
            if (item.kind === 'visualizer' && !visualizerPresets) return 'Visualizer presets are unavailable in this environment.';
            if ((item.kind === 'pipeline' || item.kind === 'plugin' || item.kind === 'visualizer') && RESERVED_NAMES.has(item.name)) {
                return 'This preset name cannot be used. Rename it before creating a backup.';
            }
            if (item.kind === 'visualizer' && !validateLayout(item.data)) {
                return 'The visualizer preset is incomplete. Create a new backup from the original data.';
            }
            if (item.kind === 'plugin' && (typeof item.pluginName !== 'string' || !item.pluginName.trim() || RESERVED_NAMES.has(item.pluginName))) {
                return 'This effect name cannot be used.';
            }
            if (client && item.kind === 'pipeline' && item.name.length > 160) return 'Preset names can contain up to 160 characters in the extension.';
            if (item.kind === 'measurement' && item.data) {
                try { validateMeasurementBackup(item.data.measurement, item.data.impulseResponses); }
                catch { return 'The measurement or its impulse responses are incomplete. Create a new backup from the original data.'; }
            }
            return null;
        },

        canApplyPreset(item) {
            if (options.canApplyPreset) return options.canApplyPreset(item);
            if (item.kind === 'pipeline' && presets?.isPresetLoadable && !presets.isPresetLoadable(item.data)) {
                return 'Some effects are unavailable on this device. The preset can still be saved.';
            }
            return true;
        },

        async appendItem(item, { name = item.name, data = item.data } = {}) {
            if (item.kind === 'measurement') {
                data = { ...data, impulseResponses: data.impulseResponses.map(record => ({
                    ...record, measurementId: data.measurement.id
                })) };
            }
            const reason = this.validateItem({ ...item, name, data });
            if (reason) throw new Error(reason);
            if (item.kind === 'pipeline') {
                if (client) await client.request('appendBackupPreset', { name, preset: data });
                else await presets.appendPreset(name, data);
                return { id: name, name };
            }
            if (item.kind === 'plugin') {
                await pluginPresets.appendPreset(item.pluginName, name, data);
                return { id: name, name };
            }
            if (item.kind === 'visualizer') {
                await visualizerPresets.appendUserPreset(name, data);
                return { id: name, name };
            }
            if (item.kind === 'ir') {
                const result = await (await irOwner()).appendBackupItem(data, name);
                return { id: result.entry.irId, name: irName(result.entry) };
            }
            if (item.kind === 'measurement') {
                const measurement = { ...data.measurement, name };
                const records = data.impulseResponses.map(record => ({ ...record, measurementId: measurement.id }));
                const result = await measurements.appendBackupMeasurement(measurement, records);
                return { id: measurement.id, name, ...result };
            }
            throw new TypeError('Unknown backup item kind');
        }
    };
}
