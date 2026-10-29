import { bytesToBase64 } from './bridge.js';

export class AndroidAssets {
    constructor(bridge) {
        this.bridge = bridge;
        this.resident = new Map();
        this.subscriptions = new Map();
        this.authoritative = new Map();
        this.pendingClears = new Map();
        this.suppressed = false;
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

    async transfer(pipeline, options, clears = [], expectedRevision) {
        const request = async (command, payload) => {
            await options?.beforeCommit?.();
            const result = await this.bridge.request(command, { ...payload,
                ...(options?.remoteRequestId ? { _remoteRequestId: options.remoteRequestId } : {}) }, expectedRevision);
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
            for (const [slot, asset] of plugin.getWasmAssets?.() || []) {
                const key = `${plugin.id}:${slot}`;
                active.add(key);
                if (this.resident.get(key) === asset) continue;
                const { payload, ...metadata } = asset;
                const bytes = new Uint8Array(payload);
                try {
                    await request('pipeline.asset.begin', {
                        ...metadata, pluginId: plugin.id, slot, byteLength: bytes.byteLength
                    });
                    for (let offset = 0; offset < bytes.byteLength; offset += 256 * 1024) {
                        await request('pipeline.asset.chunk', { pluginId: plugin.id, slot, offset,
                            data: bytesToBase64(bytes.subarray(offset, offset + 256 * 1024)) });
                    }
                    await request('pipeline.asset.commit', { pluginId: plugin.id, slot });
                    this.resident.set(key, asset);
                    plugin.onWasmAssetState?.(slot, 3, asset.operationRevision);
                } catch (error) {
                    await this.bridge.request('pipeline.asset.abort', { pluginId: plugin.id, slot }, expectedRevision).catch(() => {});
                    plugin.onWasmAssetRejected?.(slot, 'prepare', asset.operationRevision);
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
