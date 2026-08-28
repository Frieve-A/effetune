const STORAGE_KEY = 'effetune_plugin_presets';
const STORAGE_FILE = 'effetune_plugin_presets.json';
const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeName(value) {
    if (typeof value !== 'string') return '';
    const name = value.trim();
    return name && !RESERVED_NAMES.has(name) ? name : '';
}

function setOwn(target, key, value) {
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value
    });
}

export class PluginPresetStore {
    constructor() {
        this.mutationQueue = Promise.resolve();
    }

    async readPresets({ strict = false } = {}) {
        let serialized;
        try {
            if (window.electronAPI && window.electronIntegration && window.electronIntegration.isElectron) {
                const appPath = await window.electronAPI.getPath('userData');
                const filePath = await window.electronAPI.joinPaths(appPath, STORAGE_FILE);
                if (!await window.electronAPI.fileExists(filePath)) return {};
                const result = await window.electronAPI.readFile(filePath);
                if (!result?.success) throw new Error(result?.error || 'Preset file read failed');
                serialized = result.content;
            } else {
                serialized = localStorage.getItem(STORAGE_KEY);
                if (!serialized) return {};
            }
        } catch (error) {
            console.warn('Failed to load plugin presets:', error);
            if (strict) throw error;
            return {};
        }

        try {
            const value = JSON.parse(serialized);
            if (!isRecord(value)) {
                console.warn('Ignoring invalid plugin preset data.');
                return {};
            }
            return value;
        } catch (error) {
            console.warn('Failed to load plugin presets:', error);
            return {};
        }
    }

    async persistPresets(presets) {
        if (window.electronAPI && window.electronIntegration && window.electronIntegration.isElectron) {
            const appPath = await window.electronAPI.getPath('userData');
            const filePath = await window.electronAPI.joinPaths(appPath, STORAGE_FILE);
            const result = await window.electronAPI.saveFile(filePath, JSON.stringify(presets, null, 2));
            if (!result?.success) throw new Error(result?.error || 'Preset file write failed');
            return;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    }

    enqueueMutation(mutation) {
        const result = this.mutationQueue.then(mutation);
        this.mutationQueue = result.catch(() => {});
        return result;
    }

    async getForPlugin(pluginName) {
        const name = normalizeName(pluginName);
        if (!name) return {};
        const presets = await this.readPresets();
        const pluginPresets = Object.hasOwn(presets, name) && isRecord(presets[name])
            ? presets[name]
            : {};
        return clone(pluginPresets);
    }

    async save(pluginName, presetName, params) {
        const pluginKey = normalizeName(pluginName);
        const presetKey = normalizeName(presetName);
        if (!pluginKey || !presetKey || !isRecord(params)) return false;

        try {
            return await this.enqueueMutation(async () => {
                const presets = await this.readPresets({ strict: true });
                const pluginPresets = Object.hasOwn(presets, pluginKey) && isRecord(presets[pluginKey])
                    ? presets[pluginKey]
                    : {};
                setOwn(pluginPresets, presetKey, clone(params));
                setOwn(presets, pluginKey, pluginPresets);
                await this.persistPresets(presets);
                return true;
            });
        } catch (error) {
            console.error('Failed to save plugin preset:', error);
            return false;
        }
    }

    async rename(pluginName, oldName, newName) {
        const pluginKey = normalizeName(pluginName);
        const oldKey = normalizeName(oldName);
        const newKey = normalizeName(newName);
        if (!pluginKey || !oldKey || !newKey) return false;

        try {
            return await this.enqueueMutation(async () => {
                const presets = await this.readPresets({ strict: true });
                const pluginPresets = Object.hasOwn(presets, pluginKey) && isRecord(presets[pluginKey])
                    ? presets[pluginKey]
                    : null;
                if (!pluginPresets || !Object.hasOwn(pluginPresets, oldKey)) return false;
                setOwn(pluginPresets, newKey, clone(pluginPresets[oldKey]));
                if (oldKey !== newKey) delete pluginPresets[oldKey];
                await this.persistPresets(presets);
                return true;
            });
        } catch (error) {
            console.error('Failed to rename plugin preset:', error);
            return false;
        }
    }

    async remove(pluginName, names) {
        const pluginKey = normalizeName(pluginName);
        const presetNames = [...new Set(Array.isArray(names) ? names.map(normalizeName).filter(Boolean) : [])];
        if (!pluginKey || presetNames.length === 0) return false;

        try {
            return await this.enqueueMutation(async () => {
                const presets = await this.readPresets({ strict: true });
                const pluginPresets = Object.hasOwn(presets, pluginKey) && isRecord(presets[pluginKey])
                    ? presets[pluginKey]
                    : null;
                if (!pluginPresets) return false;
                let removed = false;
                for (const name of presetNames) {
                    if (Object.hasOwn(pluginPresets, name)) {
                        delete pluginPresets[name];
                        removed = true;
                    }
                }
                if (!removed) return false;
                if (Object.keys(pluginPresets).length === 0) delete presets[pluginKey];
                await this.persistPresets(presets);
                return true;
            });
        } catch (error) {
            console.error('Failed to delete plugin presets:', error);
            return false;
        }
    }
}
