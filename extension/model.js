import { PluginManager } from '../js/plugin-manager.js';
import { publishDspParamPackers } from '../js/audio/dsp-wasm-loader.js';
import * as generatedParams from '../js/audio/dsp-params.generated.js';
import { getSerializablePluginStateShort, convertLongToShortFormat, applySerializedState } from '../js/utils/serialization-utils.js';
import { getPluginExecutionChannelMode, getPluginExecutionUnsupportedReason } from '../js/audio/plugin-execution-capabilities.js';

export async function initializePluginModel() {
    publishDspParamPackers(generatedParams);
    const manager = new PluginManager();
    await manager.loadPlugins();
    return manager;
}

export function getPresetPluginStates(preset) {
    if (Array.isArray(preset)) return preset;
    if (Array.isArray(preset?.plugins)) return preset.plugins;
    if (Array.isArray(preset?.pipeline)) return preset.pipeline.map(convertLongToShortFormat);
    throw new Error('This file does not contain an EffeTune preset.');
}

export function serializePipeline(plugins) {
    return plugins.map(plugin => ({ ...getSerializablePluginStateShort(plugin), id: plugin.id }));
}

export function validatePreset(preset, pluginManager, sampleRate = 48000) {
    const states = getPresetPluginStates(preset);
    if (states.length > 128) throw new Error('This preset has too many effects. Use up to 128 effects.');
    if (preset?.outputChannels !== undefined && preset.outputChannels !== 2) {
        throw new Error('This preset needs a different output layout. The extension supports stereo.');
    }
    for (const state of states) {
        if (!state || typeof state !== 'object' || !pluginManager.isPluginAvailable(state.nm)) {
            throw new Error('This preset contains an unavailable effect. Your current pipeline has been kept.');
        }
        const type = pluginManager.pluginClasses[state.nm].name;
        if (type !== 'SectionPlugin' && !window.dspParamPackers?.has(type)) {
            throw new Error('This effect is unavailable in the extension. Your current pipeline has been kept.');
        }
        if (![state.ib, state.ob, state.inputBus, state.outputBus].every(bus => bus == null || bus === 0)) {
            throw new Error('This preset uses audio buses. The extension supports one serial stereo pipeline.');
        }
        const channel = state.ch ?? state.channel;
        const mode = getPluginExecutionChannelMode(channel, 2);
        if (!mode || getPluginExecutionUnsupportedReason({ constructor: pluginManager.pluginClasses[state.nm] }, { sampleRate, channelMode: mode })) {
            throw new Error('This preset needs a different channel layout or sample rate. Your current pipeline has been kept.');
        }
    }
    return states;
}

export async function createPipelineModels(preset, manager, sampleRate = 48000) {
    const states = validatePreset(preset, manager, sampleRate);
    const models = [];
    const ids = new Set();
    try {
        for (const state of states) {
            // Constructors must not register candidate assets on the active pipeline.
            const worklet = window.workletNode;
            let plugin;
            try {
                window.workletNode = null;
                plugin = manager.createPlugin(state.nm);
            } finally { window.workletNode = worklet; }
            models.push(plugin);
            plugin.audioHostActive = false;
            plugin.setPowerUiEnabled(false);
            const id = Number.isInteger(state.id) && state.id > 0 ? state.id : plugin.id;
            if (ids.has(id)) throw new Error('This preset has repeated effects with invalid identifiers.');
            ids.add(id);
            plugin.id = id;
            manager.nextPluginId = Math.max(manager.nextPluginId, id + 1);
            applySerializedState(plugin, state);
            const parameters = plugin.getParameters({ sampleRate, outputChannelCount: 2, commitSampleRate: true });
            const prepared = typeof plugin.createOfflineDspState === 'function'
                ? await plugin.createOfflineDspState({ sampleRate, outputChannelCount: 2 }) : null;
            if (plugin.externalAssetInfo?.missing || (plugin.externalAssetInfo?.ids?.length && !prepared?.assets?.size)) {
                throw new Error('An impulse response is missing. Import its file in IR Reverb, then load this preset again.');
            }
            if (prepared?.assets) {
                for (const [slot, descriptor] of prepared.assets) plugin.setWasmAsset(slot, descriptor);
            }
            plugin.extensionInitialParameters = prepared?.parameters || parameters;
        }
        return models;
    } catch (error) {
        for (const plugin of models) plugin.cleanup?.();
        throw error;
    }
}
