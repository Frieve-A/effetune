import { bytesToBase64 } from './bridge.js';
import { getPluginExecutionChannelMode } from '../audio/plugin-execution-capabilities.js';

export class AndroidAssets {
    constructor(bridge, branch = 0) {
        this.bridge = bridge;
        this.branch = branch;
        this.resident = new Map();
        this.subscriptions = new Map();
        this.authoritative = new Map();
        this.nativeTypes = new Map();
        this.pendingClears = new Map();
        this.suppressed = false;
        if (branch !== null) this.unsubscribe = this.bridge.on?.('asset-state', notice => this.acceptAssetNotice(notice));
    }

    dispose() {
        this.closed = true;
        this.unsubscribe?.();
        this.synchronize([], () => {});
        this.resident.clear();
        this.authoritative.clear();
        this.pendingClears.clear();
    }

    reconcilePipeline(pipeline) {
        const types = new Map(pipeline.map(plugin => [String(plugin.id), plugin.constructor.name]));
        for (const assets of [this.resident, this.authoritative]) {
            for (const key of assets.keys()) {
                const id = key.split(':')[0];
                if (this.nativeTypes.get(id) !== types.get(id)) assets.delete(key);
            }
        }
        this.nativeTypes = types;
    }

    acceptAssetNotice({ branch = 0, pluginId, slot, state, rejected, operationRevision, reason = 'prepare' }) {
        if (branch !== this.branch || this.closed) return;
        const plugin = [...this.subscriptions.keys()].find(item => item.id === pluginId);
        if (!plugin) return;
        if (rejected) {
            const key = `${pluginId}:${slot}`;
            if (this.resident.get(key)?.operationRevision === operationRevision) {
                this.resident.delete(key);
            }
            plugin.onWasmAssetRejected?.(slot, reason, operationRevision);
        } else {
            plugin.onWasmAssetState?.(slot, state, operationRevision);
        }
    }

    synchronize(pipeline, changed) {
        for (const [plugin, unsubscribe] of this.subscriptions) {
            if (!pipeline.includes(plugin)) { unsubscribe(); this.subscriptions.delete(plugin); }
        }
        for (const plugin of pipeline) {
            if (!this.subscriptions.has(plugin)) {
                const unsubscribe = plugin.addWasmAssetChangeListener?.(changed) || (() => {});
                const clear = plugin.clearWasmAsset;
                const host = this;
                const wrapped = function(slot) {
                    const key = `${plugin.id}:${slot}`;
                    const nativeOnly = host.authoritative.has(key) && !plugin.getWasmAssets?.().has(slot);
                    const result = clear.call(plugin, slot);
                    if (nativeOnly && !host.suppressed) {
                        host.pendingClears.set(key, plugin.getExternalAssetParameters?.());
                        changed();
                    }
                    return result;
                };
                if (clear) plugin.clearWasmAsset = wrapped;
                this.subscriptions.set(plugin, () => {
                    unsubscribe();
                    if (plugin.clearWasmAsset === wrapped) plugin.clearWasmAsset = clear;
                });
            }
        }
    }

    adopt(pipeline, references = {}, definitions = {}) {
        this.reconcilePipeline(pipeline);
        this.resident.clear();
        this.authoritative.clear();
        this.pendingClears.clear();
        for (const plugin of pipeline) {
            const prefix = `${plugin.constructor.name}:${plugin.id}:`;
            for (const [reference, ref] of Object.entries(references)) if (reference.startsWith(prefix)) {
                const slot = Number(reference.slice(prefix.length)), key = `${plugin.id}:${slot}`;
                this.authoritative.set(key, ref.id);
                const asset = plugin.getWasmAssets?.().get(slot);
                if (asset && asset.externalAssetSignature === definitions[reference]?.externalAssetSignature) {
                    this.resident.set(key, asset);
                    if (plugin.externalAssetInfo?.pending) plugin.onWasmAssetState?.(slot, 3, asset.operationRevision);
                }
            }
        }
    }

    adoptHydrated({ plugin, slot, id, signature }) {
        const key = `${plugin.id}:${slot}`;
        const asset = plugin.getWasmAssets?.().get(slot);
        if (this.authoritative.get(key) !== id || asset?.externalAssetSignature !== signature) return;
        if (this.resident.get(key) === asset) return;
        this.resident.set(key, asset);
        plugin.onWasmAssetState?.(slot, 3, asset.operationRevision);
    }

    needsTransfer(pipeline) {
        let count = 0;
        for (const plugin of pipeline) for (const [slot, asset] of plugin.getWasmAssets?.() || []) {
            if (this.resident.get(`${plugin.id}:${slot}`) !== asset) return true;
            count++;
        }
        return count !== this.resident.size || this.pendingClears.size > 0;
    }

    async transfer(pipeline, options, clears = [], expectedRevision) {
        const routing = options?.inactiveSlot ? { inactiveSlot: options.inactiveSlot } : this.branch ? { branch: this.branch } : {};
        const batch = expectedRevision === undefined ? {} : { _assetBatch: crypto.randomUUID() };
        const remote = options?.remoteRequestId ? { _remoteRequestId: options.remoteRequestId } : {};
        const request = async (command, payload) => {
            await options?.beforeCommit?.();
            if (this.closed) throw new Error('Asset transfer cancelled');
            const result = await this.bridge.request(command, { ...payload, ...batch, ...remote, ...routing }, expectedRevision);
            if (this.closed) throw new Error('Asset transfer cancelled');
            if (expectedRevision !== undefined) {
                if (!Number.isSafeInteger(result?.revision)) throw new Error('Invalid Android asset revision');
                expectedRevision = result.revision;
            }
            return result;
        };
        const active = new Set();
        for (const [key, externalAssetParameters] of clears) {
            const [pluginId, slot] = key.split(':').map(Number);
            await request('pipeline.asset.clear', { pluginId, slot, externalAssetParameters });
            this.authoritative.delete(key);
        }
        for (const plugin of pipeline) {
            for (const [slot, asset] of options?.assetMaps?.get(plugin) ?? plugin.getWasmAssets?.() ?? []) {
                const key = `${plugin.id}:${slot}`;
                active.add(key);
                if (this.resident.get(key) === asset) continue;
                const { payload, ...metadata } = asset;
                const bytes = new Uint8Array(payload);
                try {
                    if (!metadata.preparationContext && ['SFZNotePlayerPlugin', 'SoundFontPlayerPlugin'].includes(plugin.constructor.name)) {
                        const width = options?.channelCount ?? 2;
                        // Keep the bank for a selected pair or channel even while its effect is skipped on a narrower device.
                        const mode = getPluginExecutionChannelMode(plugin.channel, 16);
                        if (!mode) throw new Error('Invalid Android instrument channel selection');
                        metadata.processingChannels = mode === 'all' ? width : mode === 'stereo-pair' ? 2 : 1;
                    }
                    await request('pipeline.asset.begin', {
                        ...metadata, pluginId: plugin.id, slot, byteLength: bytes.byteLength
                    });
                    for (let offset = 0; offset < bytes.byteLength; offset += 256 * 1024) {
                        await request('pipeline.asset.chunk', { pluginId: plugin.id, slot, offset,
                            data: bytesToBase64(bytes.subarray(offset, offset + 256 * 1024)) });
                    }
                    const result = await request('pipeline.asset.commit', { pluginId: plugin.id, slot });
                    this.resident.set(key, asset);
                    if (!this.branch && result?.state !== 'pending') {
                        plugin.onWasmAssetState?.(slot, 3, asset.operationRevision);
                    }
                } catch (error) {
                    if (!this.closed) await this.bridge.request('pipeline.asset.abort', { pluginId: plugin.id, slot, ...batch, ...remote, ...routing }, expectedRevision).catch(() => {});
                    if (!this.branch) plugin.onWasmAssetRejected?.(slot, 'prepare', asset.operationRevision);
                    throw error;
                }
            }
        }
        for (const key of this.resident.keys()) if (!active.has(key)) {
            const [pluginId, slot] = key.split(':').map(Number);
            const plugin = pipeline.find(item => item.id === pluginId);
            if (plugin) await request('pipeline.asset.clear', { pluginId, slot,
                externalAssetParameters: plugin.getExternalAssetParameters?.() });
            this.resident.delete(key);
        }
    }
}
