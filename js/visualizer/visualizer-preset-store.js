import { ASPECTS, ASPECT_FILES, isRecord, snapshotLayout, validateLayout } from './visualizer-model.js';

const DATABASE_NAME = 'effetune-visualizer';
const CURRENT_STORE = 'current';
const PRESET_STORE = 'presets';
const CURRENT_KEY = 'layout';

function validName(name) {
    return typeof name === 'string' && !!name.trim() && name.length <= 4096 &&
        !['__proto__', 'constructor', 'prototype'].includes(name.trim());
}

export class VisualizerPresetStore {
    constructor({ indexedDB = globalThis.indexedDB, fetch: fetcher = url => globalThis.fetch(url), onError = null } = {}) {
        this.indexedDB = indexedDB;
        this.fetcher = fetcher;
        this.onError = onError;
        this.databasePromise = null;
        this.systemPresets = null;
        this.pendingCurrent = null;
        this.currentTimer = null;
        this.currentWrite = Promise.resolve();
    }

    initialize() {
        if (!this.databasePromise) {
            this.databasePromise = new Promise((resolve, reject) => {
                if (!this.indexedDB) {
                    reject(new Error('IndexedDB is unavailable'));
                    return;
                }
                const request = this.indexedDB.open(DATABASE_NAME, 1);
                request.onupgradeneeded = () => {
                    const database = request.result;
                    if (!database.objectStoreNames.contains(CURRENT_STORE)) database.createObjectStore(CURRENT_STORE);
                    if (!database.objectStoreNames.contains(PRESET_STORE)) database.createObjectStore(PRESET_STORE);
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            }).catch(error => {
                this.databasePromise = null;
                throw error;
            });
        }
        return this.databasePromise;
    }

    async request(storeName, mode, action) {
        const database = await this.initialize();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction(storeName, mode);
            const request = action(transaction.objectStore(storeName));
            let result;
            request.onsuccess = () => { result = request.result; };
            request.onerror = () => reject(request.error);
            transaction.oncomplete = () => resolve(result);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    }

    async loadCurrent() {
        const layout = await this.request(CURRENT_STORE, 'readonly', store => store.get(CURRENT_KEY));
        if (layout === undefined || layout === null) return null;
        // Local state is recovered by normalizeLayout, not the strict import validator.
        // Missing new fields or one unsupported item must not discard the whole scene.
        if (!isRecord(layout) || !Array.isArray(layout.items)) throw new TypeError('Invalid saved visualizer layout');
        return layout;
    }

    saveCurrent(layout) {
        this.pendingCurrent = snapshotLayout(layout);
        if (this.currentTimer) clearTimeout(this.currentTimer);
        this.currentTimer = setTimeout(() => {
            this.currentTimer = null;
            this.flushCurrent().catch(error => {
                console.error('Failed to save visualizer layout:', error);
                this.onError?.(error);
            });
        }, 250);
    }

    flushCurrent() {
        if (this.currentTimer) clearTimeout(this.currentTimer);
        this.currentTimer = null;
        if (this.pendingCurrent) {
            const layout = this.pendingCurrent;
            this.pendingCurrent = null;
            this.currentWrite = this.currentWrite.catch(() => {}).then(() =>
                this.request(CURRENT_STORE, 'readwrite', store => store.put(layout, CURRENT_KEY)));
        }
        return this.currentWrite;
    }

    async listUserPresetNames() {
        return this.request(PRESET_STORE, 'readonly', store => store.getAllKeys());
    }

    async getUserPreset(name) {
        if (!validName(name)) return null;
        return (await this.request(PRESET_STORE, 'readonly', store => store.get(name))) || null;
    }

    async saveUserPreset(name, layout) {
        if (!validName(name)) throw new TypeError('Invalid visualizer preset name');
        const normalized = snapshotLayout(layout);
        await this.request(PRESET_STORE, 'readwrite', store => store.put(normalized, name));
        return true;
    }

    async appendUserPreset(name, layout) {
        if (!validName(name) || !validateLayout(layout)) throw new TypeError('Invalid visualizer preset');
        await this.request(PRESET_STORE, 'readwrite', store => store.add(snapshotLayout(layout), name));
        return true;
    }

    async renameUserPreset(oldName, newName) {
        if (!validName(oldName) || !validName(newName)) throw new TypeError('Invalid visualizer preset name');
        if (oldName === newName) return true;
        const database = await this.initialize();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction(PRESET_STORE, 'readwrite');
            const store = transaction.objectStore(PRESET_STORE);
            const source = store.get(oldName);
            source.onsuccess = () => {
                if (!source.result) { transaction.abort(); return; }
                const target = store.get(newName);
                target.onsuccess = () => {
                    if (target.result) { transaction.abort(); return; }
                    store.add(source.result, newName);
                    store.delete(oldName);
                };
            };
            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => resolve(false);
        });
    }

    async deleteUserPresets(names) {
        const database = await this.initialize();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction(PRESET_STORE, 'readwrite');
            const store = transaction.objectStore(PRESET_STORE);
            for (const name of names) if (validName(name)) store.delete(name);
            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async readBackupSnapshot() {
        const names = await this.listUserPresetNames();
        const result = [];
        for (const name of names) {
            const layout = await this.getUserPreset(name);
            result.push({ name, layout: layout && validateLayout(layout) ? snapshotLayout(layout) : layout });
        }
        return result;
    }

    async loadSystemPresets() {
        if (!this.systemPresets) {
            this.systemPresets = Promise.all(ASPECTS.map(async aspect => {
                const url = new URL(`../../presets/visualizer/${ASPECT_FILES[aspect]}`, import.meta.url);
                const response = await this.fetcher(url);
                if (!response.ok) throw new Error(`Could not load visualizer presets for ${aspect}`);
                const presets = await response.json();
                if (!presets || typeof presets !== 'object' || Array.isArray(presets) ||
                    Object.values(presets).some(layout => !validateLayout(layout) || layout.aspect !== aspect)) {
                    throw new TypeError(`Invalid visualizer presets for ${aspect}`);
                }
                return [aspect, presets];
            })).then(Object.fromEntries).catch(error => {
                this.systemPresets = null;
                throw error;
            });
        }
        return this.systemPresets;
    }
}
