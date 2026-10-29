import { AudioManager } from '../audio-manager.js';
import { getAndroidBridge, base64ToBytes } from './bridge.js';
import { prepareAndroidPipeline } from './pipeline.js';
import { applySerializedState } from '../utils/serialization-utils.js';
import { AndroidAssets } from './assets.js';
import { NO_AUDIO_INPUT_DEVICE_ID } from '../audio/audio-device-constants.js';

function assetTopology(payload) {
    return JSON.stringify([payload.descriptor, payload.plugins.map(plugin => plugin.type)]);
}

// Reuse editing, history and offline rendering; the Service owns live audio.
export class AndroidAudioManager extends AudioManager {
    constructor(pipelineManager, { bridge = getAndroidBridge() } = {}) {
        super(pipelineManager, { externalInput: true });
        this.isAndroid = true;
        this.bridge = bridge;
        this.nativeAssets = new AndroidAssets(bridge);
        this.snapshot = null;
        this.pendingMutation = Promise.resolve();
        this.hydrating = false;
        this.externalPipelineEpoch = 0;
        this.nativeRuntimeEvents = new Map();
        this.bridge.on('snapshot', snapshot => this.acceptSnapshot(snapshot));
        this.bridge.on('pipeline-changed', snapshot => {
            this.externalPipelineEpoch++;
            if (!this.acceptSnapshot(snapshot) || !this.pluginManager) return;
            void this.restoreNativePipeline().catch(error => console.error('Android pipeline refresh failed:', error));
        });
        this.bridge.on('telemetry', data => {
            if (data?.revision !== this.snapshot?.revision || typeof data.packet !== 'string') return;
            const packet = base64ToBytes(data.packet);
            this.telemetryHub.handleMessage({ ...data, type: 'dspTelemetry', packet,
                bytes: packet.byteLength, recycle: false });
        });
        this.bridge.on('dsp-runtime-event', data => this.acceptRuntimeEvent(data));
    }

    acceptRuntimeEvent(data) {
        const adaptive = data?.type === 'adaptivePredictionFault';
        if (!adaptive && data?.type !== 'tubeSimulatorCircuitFault') return false;
        const pluginType = adaptive ? 'AdaptivePredictionEffectPlugin' : 'TubeSimulatorPlugin';
        const causes = adaptive ? ['none', 'numericalFailure'] : ['none', 'feedbackOscillation', 'processingSafetyFailure'];
        if (data.revision !== this.snapshot?.revision || data.pluginType !== pluginType ||
            !Number.isSafeInteger(data.pluginId) || !Number.isSafeInteger(data.instanceEpoch) || data.instanceEpoch < 0 ||
            !Number.isInteger(data.generation) || data.generation < 0 || data.generation > 0xffffffff ||
            typeof data.latched !== 'boolean' || !causes.includes(data.cause) ||
            (data.latched ? data.cause === 'none' : data.cause !== 'none')) return false;
        const plugin = this.pipeline.find(item => item.id === data.pluginId && item.constructor.name === pluginType);
        if (!plugin) return false;
        const previous = this.nativeRuntimeEvents.get(data.pluginId);
        if (previous && (data.instanceEpoch < previous.instanceEpoch ||
            (data.instanceEpoch === previous.instanceEpoch && data.generation <= previous.generation))) return false;
        this.nativeRuntimeEvents.set(data.pluginId, { instanceEpoch: data.instanceEpoch, generation: data.generation });
        const validated = { ...data, validated: true };
        plugin.onMessage?.(validated);
        this.dispatchEvent(data.type, validated);
        return true;
    }

    acceptSnapshot(snapshot) {
        if (!Number.isSafeInteger(snapshot?.revision) || snapshot.revision < 0 ||
            snapshot.revision < (this.snapshot?.revision ?? -1)) return false;
        this.snapshot = snapshot;
        this.snapshotTime = performance.now();
        this.contextManager.outputChannelCount = snapshot.channelCount;
        this.dispatchEvent('nativeSnapshot', snapshot);
        return true;
    }

    async initAudio() {
        const snapshot = await this.bridge.request('snapshot.get');
        this.startInitialOutput = snapshot.revision === 0;
        this.acceptSnapshot(snapshot);
        return '';
    }

    async hydratePipeline(pluginManager) {
        this.pluginManager = pluginManager;
        if (!this.catalogPublished) {
            await this.bridge.request('pipeline.catalog', { effects: Object.entries(pluginManager.pluginClasses)
                .map(([name, Plugin]) => ({ name, type: Plugin.name })) });
            this.catalogPublished = true;
        }
        if (!this.snapshot || this.snapshot.revision === 0) return false;
        this.hydrating = true;
        this.nativeAssets.suppressed = true;
        try {
            const existing = [...this.pipelineA || [], ...this.pipelineB || []];
            const currentSlot = this.snapshot.slot || 'A';
            const restore = (records, slotPipeline, slot) => records.map(record => {
                const references = slot === currentSlot ? Object.entries(this.snapshot.assetRefs || {})
                    .filter(([key]) => key.startsWith(`${record.type}:${record.id}:`)) : null;
                const signature = references && JSON.stringify(references);
                const plugin = slotPipeline?.find(item => item.id === record.id && item.constructor.name === record.type
                    && (signature === null || item.androidAssetSignature === signature || references.every(([key]) =>
                        item.getWasmAssets?.().get(Number(key.slice(key.lastIndexOf(':') + 1)))?.externalAssetSignature ===
                            this.snapshot.assetDefinitions?.[key]?.externalAssetSignature)))
                    || pluginManager.createPlugin(record.name);
                plugin.id = record.id;
                pluginManager.nextPluginId = Math.max(pluginManager.nextPluginId, plugin.id + 1);
                const { enabled: _enabled, inputBus, outputBus, channel, ...parameters } = record.parameters;
                const pendingAsset = plugin.externalAssetInfo?.pending && plugin.getExternalAssetParameters?.();
                if (pendingAsset) for (const key of Object.keys(pendingAsset)) delete parameters[key];
                const localAudio = plugin.hasLocalAudio;
                plugin.hasLocalAudio = false;
                try {
                    applySerializedState(plugin, { name: record.name, enabled: record.enabled,
                        parameters, inputBus, outputBus, channel: pendingAsset && Object.hasOwn(pendingAsset, 'channel')
                            ? plugin.channel : channel });
                } finally {
                    if (localAudio === undefined) delete plugin.hasLocalAudio;
                    else plugin.hasLocalAudio = localAudio;
                }
                if (signature !== null) plugin.androidAssetSignature = signature;
                return plugin;
            });
            this.pipelineA = restore(this.snapshot.pipelines?.A || this.snapshot.pipeline || [], this.pipelineA, 'A');
            this.pipelineB = this.snapshot.pipelines?.B ? restore(this.snapshot.pipelines.B, this.pipelineB, 'B') : null;
            this.currentPipeline = this.snapshot.slot || 'A';
            this.pipeline = this.currentPipeline === 'A' ? this.pipelineA : this.pipelineB || [];
            this.nativeAssets.synchronize(this.pipeline, () => this.commitPowerTopologyMutation());
            this.nativeAssets.adopt(this.pipeline, this.snapshot.assetRefs, this.snapshot.assetDefinitions);
            for (const plugin of existing) if (![...this.pipelineA, ...this.pipelineB || []].includes(plugin)) plugin.cleanup?.();
            this.masterBypass = this.snapshot.masterBypass === true;
            this.nativeAssetTopology = assetTopology(prepareAndroidPipeline(this.pipeline, {
                sampleRate: this.snapshot.sampleRate || 48000, channelCount: this.snapshot.channelCount || 2,
                masterBypass: this.masterBypass
            }));
            this.pipelineProcessor.setPipeline(this.pipeline);
            window.pipeline = this.pipeline;
        } finally {
            this.hydrating = false;
            this.nativeAssets.suppressed = false;
        }
        const preparations = [];
        for (const plugin of this.pipeline) {
            const prefix = `${plugin.constructor.name}:${plugin.id}:`;
            for (const [key, definition] of Object.entries(this.snapshot.assetDefinitions || {})) {
                if (!key.startsWith(prefix) || !plugin.hydrateExternalAsset || plugin.externalAssetInfo?.pending) continue;
                const slot = Number(key.slice(prefix.length));
                if (this.nativeAssets.resident.has(`${plugin.id}:${slot}`)) continue;
                const nativeHydration = { plugin, slot, id: definition.id, signature: definition.externalAssetSignature };
                const isCurrent = () => this.pipeline.includes(plugin) &&
                    this.nativeAssets.authoritative.get(`${plugin.id}:${slot}`) === definition.id;
                preparations.push(plugin.hydrateExternalAsset(definition, { nativeHydration, isCurrent }));
            }
        }
        await Promise.all(preparations);
        return true;
    }

    initializeAudioWorklet() { return Promise.resolve(''); }
    waitForDspActivationBeforeOutput() { return Promise.resolve(); }
    isDspReady() { return this.snapshot !== null; }
    registerPipelineProcessors() {}
    startPowerPolicyController() { return Promise.resolve(); }
    updateExposedProperties() {}
    syncPrimaryWasmAssetMembership() {
        this.nativeAssets.synchronize(this.pipeline, () => this.commitPowerTopologyMutation());
    }
    getOutputChannelCount() { return this.snapshot?.channelCount || 2; }
    getNativeSampleRate() { return this.snapshot?.sampleRate || 48000; }
    getPowerSnapshot() { return this.snapshot; }
    getAudiblePlaybackPosition(position) {
        const playback = this.snapshot?.playback;
        if (!playback) return position;
        const current = playback.position + (playback.playing
            ? (performance.now() - this.snapshotTime) / 1000 * (playback.speed || 1) : 0);
        return playback.duration > 0 ? Math.min(current, playback.duration) : current;
    }
    get needsSystemResumeRecovery() { return false; }
    handleSystemResume() { return this.initAudio(); }

    async rebuildPipeline() {
        if (this.hydrating || this.mutationOptions?.nativeHydration) return '';
        const options = this.mutationOptions;
        const assetClears = [...this.nativeAssets.pendingClears];
        this.nativeAssets.pendingClears.clear();
        const payload = prepareAndroidPipeline(this.pipeline, {
            sampleRate: this.getNativeSampleRate(), channelCount: this.getOutputChannelCount(),
            masterBypass: this.masterBypass
        });
        payload.slot = this.currentPipeline;
        if (options?.remoteRequestId) payload._remoteRequestId = options.remoteRequestId;
        const externalEpoch = this.externalPipelineEpoch;
        const pipeline = [...this.pipeline];
        this.nativeAssets.synchronize(pipeline, () => this.commitPowerTopologyMutation());
        const operation = this.pendingMutation.then(async () => {
            if (externalEpoch !== this.externalPipelineEpoch) return;
            await options?.beforeCommit?.();
            if (externalEpoch !== this.externalPipelineEpoch) return;
            const result = await this.bridge.request('pipeline.set', payload, this.snapshot?.revision);
            if (externalEpoch !== this.externalPipelineEpoch) return;
            if (!Number.isSafeInteger(result?.revision)) throw new Error('Invalid Android pipeline revision');
            this.acceptSnapshot(result);
            const topology = assetTopology(payload);
            if (topology !== this.nativeAssetTopology) this.nativeAssets.resident.clear();
            this.nativeAssetTopology = topology;
            await this.nativeAssets.transfer(pipeline, options, assetClears, result.revision);
        });
        this.mutationWrites?.push(operation);
        this.pendingMutation = operation.catch(error => {
            console.error('Android pipeline update failed:', error);
            this.dispatchEvent('nativeOperationFailed', { operation: 'pipeline' });
            if (error.code === 'revision-conflict' || options?.remoteRequestId) {
                void this.bridge.request('snapshot.get').then(snapshot => {
                    this.acceptSnapshot(snapshot);
                    return this.restoreNativePipeline();
                }).catch(failure => console.error('Android pipeline recovery failed:', failure));
            }
        });
        await operation;
        return '';
    }

    getMutationOptions() { return this.mutationOptions; }

    withMutationOptions(options, operation) {
        const previousOptions = this.mutationOptions, previousWrites = this.mutationWrites;
        const writes = [];
        let result;
        this.mutationOptions = options;
        this.mutationWrites = writes;
        try {
            result = operation();
            if (options?.nativeHydration && options.isCurrent()) this.nativeAssets.adoptHydrated(options.nativeHydration);
        }
        finally { this.mutationOptions = previousOptions; this.mutationWrites = previousWrites; }
        return Promise.resolve(result).then(async value => { await Promise.all(writes); return value; });
    }

    isExternalAssetInUse(kind, id) {
        const keys = kind === 'IR' ? ['ir'] : kind === 'SFZ' ? ['sf'] : !kind ? ['ir', 'sf'] : [];
        return Boolean(this.snapshot?.retainedAssetDefinitions?.some(
            definition => keys.some(key => definition.externalAssetParameters?.[key] === id)));
    }

    hasNativePluginAsset(plugin, slot) {
        return this.pipeline.includes(plugin) && Boolean(
            this.snapshot?.assetRefs?.[`${plugin.constructor.name}:${plugin.id}:${slot}`]);
    }

    commitPowerTopologyMutation(message, options) {
        if (options?.reason === 'sfz-note-preview') {
            const plugin = message?.plugin;
            if (plugin?.type !== 'SFZNotePlayerPlugin') return false;
            void this.bridge.request('pipeline.preview', { pluginId: plugin.id,
                pm: plugin.parameters.pm, pv: plugin.parameters.pv }).then(snapshot => this.acceptSnapshot(snapshot)).catch(error => {
                console.warn('Android note preview failed:', error);
                this.dispatchEvent('nativeOperationFailed', { operation: 'preview' });
            });
            return true;
        }
        void this.rebuildPipeline().catch(() => {});
        return true;
    }

    async nativePipelineCommand(command, payload = {}) {
        await this.pendingMutation;
        this.acceptSnapshot(await this.bridge.request(`pipeline.${command}`, payload, this.snapshot?.revision));
        await this.restoreNativePipeline();
    }

    async restoreNativePipeline() {
        await this.hydratePipeline(this.pluginManager);
        this.pipelineManager?.core.updatePipelineUI(true);
        this.dispatchEvent('pipelineChanged', { pipeline: this.currentPipeline });
        window.uiManager?.updateEditButtons?.();
        window.uiManager?.updatePipelineToggleButton?.();
    }

    setCurrentPipeline(name) {
        if (!this.snapshot || this.hydrating) return super.setCurrentPipeline(name, true);
        return this.nativePipelineCommand('slot', { slot: name });
    }
    setCurrentPipelineWithTransition(name) { return this.setCurrentPipeline(name); }
    togglePipeline() { return this.setCurrentPipeline(this.currentPipeline === 'A' ? 'B' : 'A'); }
    togglePipelineWithTransition() { return this.togglePipeline(); }
    async copyAToB() { await this.nativePipelineCommand('copySlot', { from: 'A', to: 'B' }); return this.setCurrentPipeline('B'); }
    async copyBToA() { await this.nativePipelineCommand('copySlot', { from: 'B', to: 'A' }); return this.setCurrentPipeline('A'); }

    setMasterBypass(bypass) {
        this.masterBypass = !!bypass;
        this.commitPowerTopologyMutation();
    }

    async reset(preferences = null) {
        const settings = { ...preferences };
        if (preferences?.outputDeviceId != null) settings.outputDeviceId = preferences.outputDeviceId === 'default' ? 0 : Number(preferences.outputDeviceId);
        if (preferences?.outputChannels != null) settings.channelCount = preferences.outputChannels;
        this.acceptSnapshot(await this.bridge.request('audio.configure', settings));
        if (preferences?.inputDeviceId != null) this.acceptSnapshot(await this.bridge.request('audio.input', {
            deviceId: preferences.inputDeviceId === NO_AUDIO_INPUT_DEVICE_ID ? -1 : preferences.inputDeviceId === 'default' ? 0 : Number(preferences.inputDeviceId)
        }));
        return '';
    }

    updateAudioConfig(preferences) { return this.reset(preferences); }
    async updatePowerSettings(powerSettings) {
        this.acceptSnapshot(await this.bridge.request('audio.configure', { powerSettings }));
    }
    applyPersistedPowerSettings(settings) { return this.updatePowerSettings(settings); }
    async fadeInOutputWhenReady() {
        if (!this.startInitialOutput) return;
        this.startInitialOutput = false;
        this.acceptSnapshot(await this.bridge.request('audio.start'));
    }
    fadeInOutput() { return Promise.resolve(); }
    fadeOutOutput() { return Promise.resolve(); }
    fadeOutOutputForTeardown() { return Promise.resolve(); }

    updateDspTelemetryRate() {
        if (!this.bridge) return;
        void this.bridge.request('telemetry.configure', {
            visible: globalThis.document?.visibilityState !== 'hidden'
        }).catch(error => console.warn('Android telemetry configuration failed:', error));
    }

    async processAudioFile(file, progressCallback, outputSettings) {
        // OfflineAudioContext decodes without creating a second live output.
        const context = new OfflineAudioContext(2, 1, this.getNativeSampleRate());
        const previous = this.contextManager.audioContext;
        this.contextManager.audioContext = context;
        try {
            return await super.processAudioFile(file, progressCallback, outputSettings);
        } finally {
            this.contextManager.audioContext = previous;
        }
    }
}
