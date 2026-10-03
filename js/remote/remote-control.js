// Renderer side of the LAN remote control ("remote-v1").
// The WebSocket server lives in the main process (electron/remote-control-host.cjs).
// Here we answer forwarded client operations against the live pipeline and publish
// pipeline snapshots (throttled to <= 10 Hz) whenever it changes.

import {
    convertLongToShortFormat,
    getSerializablePluginStateShort
} from '../utils/serialization-utils.js';
import { identifySingleIr } from '../ir-library/ir-library-id.js';
import { isSupportedIrFileName } from '../ir-library/audio-header-metadata.js';
import { subscribeIrLibraryChanges } from '../ir-library/ir-library-store.js';
import { initRemoteControlButton } from './remote-control-button.js';
import {
    applyMasterBypass,
    applyOpsToPipeline,
    applyParamsToPlugin,
    createIdRegistry,
    finishBatch,
    validateEdit
} from './pipeline-apply.js';

const STATE_MIN_INTERVAL_MS = 100;
const SAFETY_POLL_MS = 1000;
const HISTORY_SAVE_DEBOUNCE_MS = 1000;
const MAX_CHAIN_ITEMS = 256;
const MAX_PRESET_NAME_LENGTH = 256;
const FORBIDDEN_PRESET_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const IR_ID_PATTERN = /^[a-f0-9]{24}$/;

function createEpoch(cryptoRef) {
    const bytes = new Uint8Array(4);
    cryptoRef.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function extensionOf(fileName) {
    const match = String(fileName || '').toLowerCase().match(/\.([a-z0-9]{1,10})$/);
    return match ? match[1] : '';
}

export async function startRemoteControl(win = window) {
    const api = win.electronAPI?.remoteV1;
    if (!api || win.remoteControlController) return win.remoteControlController || null;
    const controller = new RemoteControl(win, api);
    win.remoteControlController = controller;
    const started = await controller.start();
    if (!started) win.remoteControlController = null;
    return started ? controller : null;
}

class RemoteControl {
    constructor(win, api) {
        this.win = win;
        this.api = api;
        this.lastSentJson = null;
        this.lastSentAt = 0;
        this.publishTimer = null;
        this.pollTimer = null;
        this.historyTimer = null;
        this.disposeRequestListener = null;
        this.disposeStatusListener = null;
        this.disposeIrWatch = null;
        // Snapshots are only published while the server in main is running.
        this.active = false;
        // Stage ids and the epoch live in this renderer: ids are only comparable
        // within one epoch, which changes when the renderer (or the app) restarts.
        this.epoch = createEpoch(win.crypto);
        this.ids = createIdRegistry('h');
    }

    async start() {
        this.disposeRequestListener = this.api.onRequest(request => {
            void this.handleRequest(request);
        });
        let status;
        try {
            status = await this.api.rendererReady();
        } catch (error) {
            console.warn('[remote] renderer-ready failed:', error);
            status = null;
        }
        if (!status || typeof status !== 'object') {
            this.disposeRequestListener?.();
            this.disposeRequestListener = null;
            return false;
        }
        // The server can be switched on and off at runtime (Settings > Remote Control).
        this.disposeStatusListener = this.api.onStatus?.(next => this.setActive(next?.enabled === true)) || null;
        this.installHooks();
        try { this.disposeButton = initRemoteControlButton(this.api, this.win.document); } catch (_) { /* icon is optional */ }
        this.win.addEventListener('pagehide', () => {
            this.api.rendererUnavailable().catch(() => {});
        }, { once: true });
        console.log('[remote] renderer bridge ready; server ' + (status.enabled ? 'running' : 'off'));
        this.setActive(status.enabled === true);
        return true;
    }

    setActive(active) {
        const wasActive = this.active;
        this.active = active;
        if (active && !wasActive) {
            // The host dropped its snapshot; publish a fresh one.
            this.lastSentJson = null;
            this.schedulePublish();
        }
    }

    // ---- state -----------------------------------------------------------

    takeSnapshot() {
        const audioManager = this.win.audioManager;
        const pipeline = (audioManager?.pipeline || []).map(plugin =>
            getSerializablePluginStateShort(plugin)
        );
        const plugins = audioManager?.pipeline || [];
        return {
            masterBypass: !!audioManager?.masterBypass,
            pipeline,
            ids: plugins.map(plugin => this.ids.idOf(plugin)),
            slot: audioManager?.currentPipeline === 'B' ? 'B' : 'A',
            epoch: this.epoch
        };
    }

    installHooks() {
        const self = this;
        const uiManager = this.win.uiManager;
        if (uiManager && typeof uiManager.updateURL === 'function') {
            const original = uiManager.updateURL;
            // Hook before the Double Blind Test early return inside updateURL.
            uiManager.updateURL = function (...args) {
                try { self.schedulePublish(); } catch (_) { /* never break the app */ }
                return original.apply(this, args);
            };
        }
        const audioManager = this.win.audioManager;
        if (audioManager && typeof audioManager.setMasterBypass === 'function') {
            const original = audioManager.setMasterBypass;
            audioManager.setMasterBypass = function (...args) {
                const result = original.apply(this, args);
                try { self.schedulePublish(); } catch (_) { /* ignore */ }
                return result;
            };
        }
        // Every worklet commit (A/B switch, routing, bypass, preset load) is a pipeline
        // change; publishing from here keeps clients live without waiting for the poll.
        if (audioManager && typeof audioManager.commitPowerTopologyMutation === 'function') {
            const original = audioManager.commitPowerTopologyMutation;
            audioManager.commitPowerTopologyMutation = function (...args) {
                const result = original.apply(this, args);
                try { self.schedulePublish(); } catch (_) { /* ignore */ }
                return result;
            };
        }
        // Clients with a preset list are told when the stored presets change.
        const presetManager = this.win.pipelineManager?.presetManager;
        if (presetManager && typeof presetManager.persistPresets === 'function') {
            const original = presetManager.persistPresets;
            presetManager.persistPresets = async function (...args) {
                const result = await original.apply(this, args);
                try { self.api.notifyPresets?.()?.catch?.(() => {}); } catch (_) { /* ignore */ }
                return result;
            };
        }
        // Clients that keep an IR copy are told when the IR library gains or loses an entry
        // (imports from the app, from any client, from a backup restore).
        this.disposeIrWatch = subscribeIrLibraryChanges(() => {
            try { self.api.notifyIrs?.()?.catch?.(() => {}); } catch (_) { /* ignore */ }
        });
        // Safety net for mutations that do not reach updateURL.
        this.pollTimer = setInterval(() => this.schedulePublish(), SAFETY_POLL_MS);
    }

    schedulePublish() {
        if (!this.active || this.publishTimer) return;
        const wait = Math.max(0, STATE_MIN_INTERVAL_MS - (Date.now() - this.lastSentAt));
        this.publishTimer = setTimeout(() => {
            this.publishTimer = null;
            this.publishNow();
        }, wait);
    }

    publishNow() {
        let snapshot;
        try {
            snapshot = this.takeSnapshot();
        } catch (error) {
            console.warn('[remote] snapshot failed:', error);
            return;
        }
        const json = JSON.stringify(snapshot);
        if (json === this.lastSentJson) return;
        this.lastSentJson = json;
        this.lastSentAt = Date.now();
        this.api.publishState(snapshot).catch(() => {
            this.lastSentJson = null;
        });
    }

    // ---- requests --------------------------------------------------------

    async handleRequest(request) {
        const requestId = request?.requestId;
        if (typeof requestId !== 'string') return;
        let response;
        try {
            const result = await this.execute(request.message || {});
            response = { requestId, ok: true, ...result };
        } catch (error) {
            response = { requestId, ok: false, error: String(error?.message || error) };
        }
        try {
            response.snapshot = this.takeSnapshot();
            this.lastSentJson = JSON.stringify(response.snapshot);
            this.lastSentAt = Date.now();
        } catch (_) { /* snapshot is best effort */ }
        try {
            await this.api.respond(response);
        } catch (error) {
            console.warn('[remote] respond failed:', error);
        }
    }

    async execute(msg) {
        switch (msg.op) {
            case 'hello':
                // The effects this app can load (nm), so a client can tell what it must not send.
                return { effects: Object.keys(this.win.pluginManager?.pluginClasses || {}) };
            case 'get':
                return {};
            case 'chain':
                return this.opChain(msg);
            case 'params':
                return this.opParams(msg);
            case 'bypass':
                return this.opBypass(msg);
            case 'edit':
                return this.opEdit(msg);
            case 'history':
                return this.opHistory(msg);
            case 'slot':
                return this.opSlot(msg);
            case 'copySlot':
                return this.opCopySlot(msg);
            case 'presets':
                return this.opPresets();
            case 'loadPreset':
                return this.opLoadPreset(msg);
            case 'deletePreset':
                return this.opDeletePreset(msg);
            case 'listPresets':
                return this.opListPresets();
            case 'getPreset':
                return this.opGetPreset(msg);
            case 'savePreset':
                return this.opSavePreset(msg);
            case 'listIRs':
                return this.opListIRs();
            case 'getIR':
                return this.opGetIR(msg);
            case 'putIR':
                return this.opPutIR(msg);
            default:
                throw new Error('unknown-op: ' + msg.op);
        }
    }

    requireApp() {
        const { audioManager, pipelineManager, pluginManager } = this.win;
        if (!audioManager || !pipelineManager || !pluginManager) throw new Error('app-not-ready');
        return { audioManager, pipelineManager, pluginManager };
    }

    validatePipelineItems(items) {
        const { pluginManager } = this.requireApp();
        if (!Array.isArray(items)) throw new Error('pipeline must be an array');
        if (items.length > MAX_CHAIN_ITEMS) throw new Error('pipeline too long');
        for (const [i, item] of items.entries()) {
            if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.nm !== 'string') {
                throw new Error('invalid item at ' + i);
            }
            if (!pluginManager.isPluginAvailable(item.nm)) {
                throw new Error('unknown effect: ' + item.nm);
            }
        }
        return items;
    }

    async opChain(msg) {
        const { audioManager, pipelineManager } = this.requireApp();
        const items = this.validatePipelineItems(msg.pipeline);
        const previousBypass = !!audioManager.masterBypass;
        const ok = await pipelineManager.presetManager.loadPreset({
            name: 'Remote Control',
            plugins: items.map(item => ({ ...item }))
        });
        if (ok === false) throw new Error('chain rejected by preset loader');
        // loadPreset forces master bypass OFF; put the previous state back.
        if (previousBypass) this.setBypass(true);
        return {};
    }

    setBypass(on) {
        this.requireApp();
        applyMasterBypass(this.win, on);
    }

    opBypass(msg) {
        if (typeof msg.on !== 'boolean') throw new Error('on must be boolean');
        this.setBypass(msg.on);
        return {};
    }

    opParams(msg) {
        const { audioManager, pipelineManager } = this.requireApp();
        const index = msg.index;
        const pipeline = audioManager.pipeline;
        if (!Number.isInteger(index) || index < 0 || index >= pipeline.length) {
            throw new Error('index out of range: ' + index);
        }
        const params = msg.params;
        if (!params || typeof params !== 'object' || Array.isArray(params)) {
            throw new Error('params must be an object');
        }
        const plugin = pipeline[index];
        applyParamsToPlugin(plugin, params);
        pipelineManager.core.updateWorkletPlugin(plugin);
        plugin.syncUIControls?.();
        pipelineManager.core.updateAllPluginDisplayState?.();
        this.win.uiManager?.updateURL?.();
        this.scheduleHistorySave();
        return {};
    }

    // Id-addressed batch from a sync1 client; see sync-ops.mjs for the semantics.
    opEdit(msg) {
        this.requireApp();
        if (msg.epoch !== this.epoch) throw new Error('stale-epoch');
        // Stage ids belong to the pipeline the client was looking at; an edit made
        // against the other slot must not land in the active one.
        if (msg.slot !== undefined) {
            if (msg.slot !== 'A' && msg.slot !== 'B') throw new Error('invalid-op');
            const active = this.win.audioManager?.currentPipeline === 'B' ? 'B' : 'A';
            if (msg.slot !== active) throw new Error('slot-mismatch');
        }
        const checked = validateEdit(this.win, msg.ops, { isHost: true });
        if (!checked.ok) throw new Error(checked.error);
        const result = applyOpsToPipeline(this.win, msg.ops, { registry: this.ids });
        finishBatch(this.win, result, {
            saveHistory: () => this.win.pipelineManager.historyManager.saveState(),
            scheduleHistorySave: () => this.scheduleHistorySave()
        });
        return result.skipped.length ? { skipped: result.skipped } : {};
    }

    // Global undo/redo: reverts the last change by anyone, like the host's own buttons.
    opHistory(msg) {
        const { pipelineManager } = this.requireApp();
        if (msg.dir === 'undo') pipelineManager.historyManager.undo();
        else if (msg.dir === 'redo') pipelineManager.historyManager.redo();
        else throw new Error('dir must be undo or redo');
        return {};
    }

    async opSlot(msg) {
        const { audioManager } = this.requireApp();
        if (msg.slot !== 'A' && msg.slot !== 'B') throw new Error('slot must be A or B');
        if (audioManager.currentPipeline === msg.slot) return {};
        const uiManager = this.win.uiManager;
        if (!uiManager?.togglePipeline) throw new Error('app-not-ready');
        await uiManager.togglePipeline();
        return {};
    }

    opCopySlot(msg) {
        this.requireApp();
        const uiManager = this.win.uiManager;
        if (!uiManager) throw new Error('app-not-ready');
        if (msg.from === 'A' && msg.to === 'B') uiManager.copyAToB();
        else if (msg.from === 'B' && msg.to === 'A') uiManager.copyBToA();
        else throw new Error('copySlot must be A to B or B to A');
        return {};
    }

    async opPresets() {
        const { pipelineManager } = this.requireApp();
        const presetManager = pipelineManager.presetManager;
        const presets = typeof presetManager.getLoadablePresets === 'function'
            ? await presetManager.getLoadablePresets()
            : await presetManager.getPresets();
        return { presets: JSON.parse(JSON.stringify(presets || {})) };
    }

    // As if the host user picked the preset: toast, preset name, history entry.
    async opLoadPreset(msg) {
        const { pipelineManager } = this.requireApp();
        if (typeof msg.name !== 'string' || !msg.name) throw new Error('name must be a string');
        const ok = await pipelineManager.presetManager.loadPreset(msg.name);
        if (ok === false) throw new Error('preset load failed: ' + msg.name);
        return {};
    }

    async opDeletePreset(msg) {
        const { pipelineManager } = this.requireApp();
        if (typeof msg.name !== 'string' || !msg.name) throw new Error('name must be a string');
        const ok = await pipelineManager.presetManager.deletePreset(msg.name);
        if (ok === false) throw new Error('preset not found: ' + msg.name);
        return {};
    }

    scheduleHistorySave() {
        if (this.historyTimer) clearTimeout(this.historyTimer);
        this.historyTimer = setTimeout(() => {
            this.historyTimer = null;
            this.win.pipelineManager?.historyManager?.saveState?.();
        }, HISTORY_SAVE_DEBOUNCE_MS);
    }

    async opListPresets() {
        const { pipelineManager } = this.requireApp();
        // Same list the preset combo box shows: hide presets whose effects are missing.
        const presetManager = pipelineManager.presetManager;
        const presets = typeof presetManager.getLoadablePresets === 'function'
            ? await presetManager.getLoadablePresets()
            : await presetManager.getPresets();
        return { names: Object.keys(presets || {}) };
    }

    async opGetPreset(msg) {
        const { pipelineManager } = this.requireApp();
        if (typeof msg.name !== 'string') throw new Error('name must be a string');
        const presets = await pipelineManager.presetManager.getPresets();
        const preset = Object.prototype.hasOwnProperty.call(presets || {}, msg.name)
            ? presets[msg.name]
            : null;
        if (!preset) throw new Error('preset not found: ' + msg.name);
        let pipeline;
        if (Array.isArray(preset.pipeline)) {
            pipeline = preset.pipeline.map(convertLongToShortFormat);
        } else if (Array.isArray(preset.plugins)) {
            pipeline = preset.plugins;
        } else {
            throw new Error('unrecognized preset format');
        }
        return { name: msg.name, pipeline };
    }
    // Same storage and format as the preset dialog's save ({ plugins: [short items] }),
    // but with the pipeline supplied by the client instead of the live one.
    async opSavePreset(msg) {
        const { pipelineManager } = this.requireApp();
        const presetManager = pipelineManager.presetManager;
        if (presetManager.externalHost) throw new Error('preset storage unavailable');
        const name = typeof msg.name === 'string' ? msg.name.trim() : '';
        if (!name) throw new Error('name must be a non-empty string');
        if (name.length > MAX_PRESET_NAME_LENGTH) throw new Error('name too long');
        if (FORBIDDEN_PRESET_NAMES.has(name)) throw new Error('invalid preset name');
        const items = this.validatePipelineItems(msg.pipeline);
        const plugins = JSON.parse(JSON.stringify(items));
        await presetManager.enqueuePresetMutation(async () => {
            const presets = await presetManager.getPresets({ strict: true });
            Object.defineProperty(presets, name, {
                value: { plugins }, enumerable: true, configurable: true, writable: true
            });
            await presetManager.persistPresets(presets);
        });
        try {
            const revision = ++presetManager.presetMutationAttemptRevision;
            await presetManager.refreshPresetConsumers?.(revision);
        } catch (error) {
            console.warn('[remote] preset list refresh failed:', error);
        }
        return {};
    }

    async irLibrary() {
        if (this.win.irLibraryService) return this.win.irLibraryService;
        const module = await import('../ir-library/service.js');
        return module.getDefaultIrLibraryService();
    }

    // Single-file entries only: a true-stereo pair is two files with a combined id.
    async opListIRs() {
        const service = await this.irLibrary();
        const items = service.list()
            .filter(entry => entry.composition === 'single' && entry.originals?.length === 1)
            .map(entry => {
                const original = entry.originals[0];
                return {
                    id: entry.irId,
                    name: original.fileName,
                    bytes: original.byteLength,
                    ext: extensionOf(original.fileName) || extensionOf(original.storageName) || 'bin',
                    channels: entry.channels,
                    sampleRate: entry.sampleRate,
                    frames: entry.frames
                };
            });
        return { items };
    }

    async opGetIR(msg) {
        if (typeof msg.id !== 'string' || !IR_ID_PATTERN.test(msg.id)) throw new Error('invalid id');
        const service = await this.irLibrary();
        const entry = service.get(msg.id);
        if (!entry) throw new Error('ir not found: ' + msg.id);
        if (entry.composition !== 'single') throw new Error('pair entries are not supported');
        const bytes = await service.store.readOriginal(msg.id, 'single');
        if (!bytes) throw new Error('ir unreadable');
        const original = entry.originals[0];
        return {
            data: bytes,
            name: original.fileName,
            ext: extensionOf(original.fileName) || extensionOf(original.storageName) || 'bin'
        };
    }

    // Imports through the same service call as the library's "Import files" button.
    async opPutIR(msg) {
        if (typeof msg.id !== 'string' || !IR_ID_PATTERN.test(msg.id)) throw new Error('invalid id');
        const bytes = msg.data;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('missing data');
        const identity = await identifySingleIr(bytes);
        if (identity.irId !== msg.id) throw new Error('id mismatch: data hashes to ' + identity.irId);
        const ext = String(msg.ext || '').toLowerCase();
        const baseName = String(msg.name || '').trim() || msg.id;
        const fileName = extensionOf(baseName) === ext ? baseName : `${baseName}.${ext}`;
        if (!isSupportedIrFileName(fileName)) throw new Error('unsupported file type: ' + ext);
        const service = await this.irLibrary();
        const file = new File([bytes], fileName);
        const result = await service.importFiles([file]);
        const entry = result.imported.find(candidate => candidate.irId === msg.id);
        if (!entry) {
            const codes = result.failureCodes?.length ? ' (' + result.failureCodes.join(', ') + ')' : '';
            throw new Error('import failed' + codes);
        }
        return {};
    }
}
