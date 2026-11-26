import { AudioManager } from '../audio-manager.js';
import { getAndroidBridge, base64ToBytes, bytesToBase64 } from './bridge.js';
import { prepareAndroidPipeline, ANDROID_PREVIEW_KEYS } from './pipeline.js';
import { unpackSpectrumOverlay } from '../native/engine-endpoint.js';
import { applySerializedState, getSerializablePluginStateLong } from '../utils/serialization-utils.js';
import { AndroidAssets } from './assets.js';
import { NO_AUDIO_INPUT_DEVICE_ID } from '../audio/audio-device-constants.js';
import { buildDspPipelineNodes } from '../audio/dsp-pipeline-descriptor.js';
import { mergePowerSavingSettings } from '../audio/power-policy.js';
import { mergeWebAudioPreferences } from '../electron/webSettingsStorage.js';
import { pickPlayerPreferences } from '../electron/audio-preference-store.js';
import { replayGainSettings } from '../ui/audio-player/replay-gain.js';
import { getReachableEnabledPlugins } from '../audio/power-topology.js';
import { MidiInputState } from '../midi/smf-timeline.js';
import { MIDI_DRUM_MODE, MIDI_SYSTEM_RESET } from '../midi/smf-scheduler.js';

// Service errors the listener can act on; every other code is logged only.
const HOST_ERROR_MESSAGES = {
    'source-unavailable': 'error.audioPlaybackFailed',
    'track-unavailable': 'status.libraryTracksSkippedOffline',
    'audio-unavailable': 'error.audioOutputStopped',
    'unsupported-format': 'dialog.audioConfig.driver.format',
    'audio-focus-denied': 'error.audioFocusDenied',
    'pipeline-failed': 'error.audioEffectFailed',
    'revision-conflict': 'error.pipelineEditFailed',
    'pipeline-too-large': 'error.pipelineTooLarge',
    'asset-restore-failed': 'externalAsset.missing.one',
    'input-unavailable': 'error.audioInputUnavailable',
    'permission-required': 'error.microphoneAccessDenied',
    'visible-start-required': 'error.controllerPlaybackBlocked'
};

const SFZ_ROUTES = {
    sfzGetPreparationContext: ['sfz.preparationContext', 'sfzPreparationContext'],
    sfzPollPages: ['sfz.poll', 'sfzStreamRequests'],
    sfzPublishPage: ['sfz.publish', 'sfzStreamPagesPublished'],
    sfzStreamFailed: ['sfz.failed']
};

function confirmedAudioPreferences(snapshot, requested, saved) {
    const deviceId = id => id > 0 ? String(id) : 'default';
    const actual = {
        inputDeviceId: snapshot.inputDeviceId < 0 ? NO_AUDIO_INPUT_DEVICE_ID : deviceId(snapshot.inputDeviceId),
        outputDeviceId: deviceId(snapshot.preferredOutputDeviceId),
        outputChannels: snapshot.channelCount, sampleRate: snapshot.sampleRate, latencyHint: snapshot.latencyHint,
        gaplessPlayback: snapshot.gaplessPlayback, useInputWithPlayer: snapshot.useInputWithPlayer
    };
    for (const device of ['input', 'output']) {
        const id = device + 'DeviceId', label = device + 'DeviceLabel';
        actual[label] = actual[id] === requested[id] ? requested[label] || ''
            : actual[id] === saved?.[id] ? saved[label] || '' : '';
    }
    return actual;
}

// Reuse editing, history and offline rendering; the Service owns live audio.
export class AndroidAudioManager extends AudioManager {
    get isAndroid() { return true; }

    constructor(pipelineManager, { bridge = getAndroidBridge() } = {}) {
        super(pipelineManager, { externalInput: true });
        this.bridge = bridge;
        this.nativeAssets = new AndroidAssets(bridge);
        this.sfzEndpoint = this.createSfzEndpoint(0);
        this.bridge.on('sfz-stream', data => this.acceptSfzEvent(data));
        this.snapshot = null;
        this.pendingMutation = Promise.resolve();
        this.hydrating = false;
        this.externalPipelineEpoch = 0;
        this.nativeRuntimeEvents = new Map();
        this.bridge.on('snapshot', snapshot => this.acceptSnapshot(snapshot));
        this.bridge.on('pipeline-changed', snapshot => {
            if (!this.acceptSnapshot(snapshot) || !this.pluginManager) return;
            this.externalPipelineEpoch++;
            this.setPipelineTransition(true);
            void this.restoreNativePipeline().catch(error => console.error('Android pipeline refresh failed:', error))
                .finally(() => this.setPipelineTransition(false));
        });
        // The desktop engine port contract: Spectrum Overlay posts tap commands and listens for frames.
        this.spectrumTaps = new Map();
        const spectrumPort = new EventTarget();
        spectrumPort.postMessage = message => this.postSpectrumTap(message);
        this.spectrumOverlayEndpoint = { port: spectrumPort };
        this.visualClock = null;
        this.visualClockOffsets = [];
        const resetMeasurements = this.telemetryHub.onVisualSyncReset;
        this.telemetryHub.onVisualSyncReset = () => {
            resetMeasurements();
            if (!this.telemetryHub.subscribers.size) return;
            // Android plugins have no worklet port to refresh their epoch-bound subscriptions.
            for (const plugin of this.pipeline) plugin.onMessage?.({ type: 'visualSyncReset', pluginId: plugin.id });
        };
        this.bridge.on('spectrum-overlay', data => this.acceptSpectrumOverlay(data));
        this.bridge.on('telemetry', data => {
            this.observeVisualClock(data);
            if (data?.revision !== this.snapshot?.revision || typeof data.packet !== 'string') return;
            const packet = base64ToBytes(data.packet);
            this.telemetryHub.handleMessage({ ...data, type: 'dspTelemetry', packet,
                bytes: packet.byteLength, recycle: false });
        });
        this.bridge.on('dsp-runtime-event', data => this.acceptRuntimeEvent(data));
        this.bridge.on('pipeline-stats', data => this.acceptPipelineStats(data));
        this.bridge.on('audio-overload', data => this.dispatchEvent('audioProcessingOverload', { active: data?.active === true }));
        this.bridge.on('dbt-invalidated', () => this.invalidateBlindTest());
        this.bridge.on('error', error => this.reportHostError(error));
    }

    reportHostError(error) {
        console.warn('Android audio service error:', error);
        const key = HOST_ERROR_MESSAGES[error?.code];
        if (error?.code === 'track-unavailable') {
            if (error.count > 0) window.uiManager?.showTransientMessage?.(key, false, { count: error.count });
            return;
        }
        if (key) window.uiManager?.setError(key, true);
    }

    acceptPipelineStats(data) {
        // New taps change the frames each display needs, as the worklet's dspLatency report does on Web.
        if (this.dspLatencyTaps !== this.visualSyncTaps) {
            this.visualSyncTaps = this.dspLatencyTaps;
            if (this.visualSyncEnabled || this.visualSyncDelayFrames) void this._updateVisualSyncDelay();
        }
        if (Number.isFinite(data?.cpuAverage) && data.cpuAverage >= 0) {
            this.dispatchEvent('pipelineCpuUsage', { average: data.cpuAverage });
        }
        const samples = Number.isSafeInteger(data?.latencySamples) && data.latencySamples >= 0 ? data.latencySamples : 0;
        const compensated = data?.compensated === true;
        // The Service sends latency with every CPU report; publish only changes.
        if (this.nativeLatencyPublished && samples === this.dspPipelineLatencySamples &&
            compensated === this.dspPipelineLatencyCompensated) return;
        this.nativeLatencyPublished = true;
        this.dspPipelineLatencySamples = samples;
        this.dspPipelineLatencyCompensated = compensated;
        this._publishDspLatency(data?.sampleRate > 0 ? data.sampleRate : this.getNativeSampleRate());
    }

    // As the desktop host reports: each enabled plugin runs unless its packed record carries a skip reason.
    publishExecutionStates(pipeline, generation, records = []) {
        const reasons = new Map(records.map(record => [record.id, record.reason ?? null]));
        for (const node of buildDspPipelineNodes(pipeline, { getInstanceId: plugin => plugin.id, omitInactive: true })) {
            const plugin = pipeline.find(plugin => plugin.id === node.instanceId);
            const pluginType = plugin?.constructor.name;
            if (!plugin || this._matchPrimaryDspExecutionPlugin(node.instanceId, pluginType) !== plugin) continue;
            const reason = reasons.get(node.instanceId) ?? null;
            this._acceptDspExecutionState(null, plugin, { type: 'dspExecutionState',
                pluginId: plugin.id, pluginType, generation, sampleRate: this.getNativeSampleRate(),
                state: reason ? 'bypassed' : 'active', reason });
        }
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
        const freshEngine = this.snapshot?.sampleRate !== snapshot.sampleRate || this.snapshot?.channelCount !== snapshot.channelCount;
        this.snapshot = snapshot;
        this.snapshotTime = performance.now();
        this.contextManager.outputChannelCount = snapshot.channelCount;
        // A new renderer or rate meets an engine whose clock and visual settings are not this renderer's.
        if (freshEngine) {
            this.nativeAssets.resident.clear();
            this.sfzEndpoint = this.createSfzEndpoint(0);
            this._pruneSfzRuntimeTargets();
            this.resetVisualClock();
            this._resendNativeVisualState();
        }
        this.dispatchEvent('nativeSnapshot', snapshot);
        return true;
    }

    async initAudio() {
        const snapshot = await this.bridge.request('snapshot.get');
        // A restarted process starts the output once; a living Service keeps the state the user left.
        this.startInitialOutput = !snapshot.outputStarted;
        this.acceptSnapshot(snapshot);
        // The Service keeps power settings in memory only; restore the persisted ones.
        await this.applyPersistedPowerSettings(window.appConfig?.powerSaving);
        // Equivalent of the worklet 'dspReady' resend: the Service may hold a fresh engine.
        this._postVisualizerSources();
        return '';
    }

    async readSlotRecords(slot, revision) {
        const records = [];
        let page;
        do {
            page = await this.bridge.request('pipeline.readSlot', { slot, offset: records.length }, revision);
            if (page.records === null) return null;
            records.push(...page.records);
        } while (page.more);
        return records;
    }

    async hydratePipeline(pluginManager, { inMutation = false } = {}) {
        this.pluginManager = pluginManager;
        const mode = globalThis.window?.appConfig?.pipelineStartup;
        const applyStartupConfig = mode === 'default' || mode === 'preset';
        let startup;
        if (!this.catalogPublished) {
            const effects = Object.entries(pluginManager.pluginClasses);
            startup = await this.bridge.request('pipeline.catalog', { effects: effects.map(([name, Plugin]) => ({ name, type: Plugin.name })),
                offered: effects.map(([name]) => name), applyStartupConfig });
            this.catalogPublished = true;
        }
        if (!this.snapshot || this.snapshot.revision === 0 || startup?.pipelineStartup === 'uninitialized') {
            this.initialPipelinePending = true;
            return false;
        }
        const useStartupConfig = startup?.pipelineStartup === 'startup' && applyStartupConfig;
        const snapshot = this.snapshot;
        const epoch = this.externalPipelineEpoch;
        const slots = snapshot.pipelines ?? {
            A: await this.readSlotRecords('A', snapshot.revision),
            B: await this.readSlotRecords('B', snapshot.revision)
        };
        const definitionsFor = slot => (slot === snapshot.slot ? snapshot.assetDefinitions : snapshot.otherAssetDefinitions) || {};
        if (epoch !== this.externalPipelineEpoch) return true;
        if (useStartupConfig) this.initialPipelinePending = true;
        this.hydrating = true;
        this.nativeAssets.suppressed = true;
        try {
            const existing = [...this.pipelineA || [], ...this.pipelineB || []];
            const restore = (records, slotPipeline, slot) => records.map(record => {
                const references = Object.entries(definitionsFor(slot)).filter(([key]) => key.startsWith(`${record.type}:${record.id}:`));
                const signature = JSON.stringify(references.map(([key, ref]) => [key, ref.id]));
                const stale = (slot === snapshot.slot ? snapshot.staleAssets || [] : snapshot.otherStaleAssets || [])
                    .some(key => key.startsWith(`${record.type}:${record.id}:`));
                const plugin = slotPipeline?.find(item => {
                    if (item.id !== record.id || item.constructor.name !== record.type) return false;
                    if (item.externalAssetInfo?.pending && (stale || !references.length || item.androidAssetSignature !== signature)) return false;
                    const assets = item.getWasmAssets?.();
                    for (const [assetSlot, asset] of assets || []) {
                        const saved = definitionsFor(slot)[`${record.type}:${record.id}:${assetSlot}`];
                        if (!saved || saved.externalAssetSignature !== asset.externalAssetSignature) return false;
                    }
                    return item.androidAssetSignature === signature || references.every(([key, ref]) =>
                        assets?.get(Number(key.slice(key.lastIndexOf(':') + 1)))?.externalAssetSignature === ref.externalAssetSignature);
                })
                    || pluginManager.createPlugin(record.name);
                plugin.id = record.id;
                plugin.audioHostActive = slot === (useStartupConfig ? 'A' : snapshot.slot);
                pluginManager.nextPluginId = Math.max(pluginManager.nextPluginId, plugin.id + 1);
                const { enabled: _enabled, inputBus, outputBus, channel, ...parameters } = record.parameters;
                const pendingAsset = plugin.externalAssetInfo?.pending && plugin.getExternalAssetParameters?.();
                if (pendingAsset) for (const key of Object.keys(pendingAsset)) delete parameters[key];
                // The Service holds the files, except one whose native copy was made for another rate:
                // the effect prepares that one here again.
                const localAudio = plugin.hasLocalAudio;
                if (references.length && !stale) plugin.hasLocalAudio = false;
                try {
                    applySerializedState(plugin, { name: record.name, enabled: record.enabled,
                        parameters, inputBus, outputBus,
                        channel: pendingAsset && Object.hasOwn(pendingAsset, 'channel') ? plugin.channel : channel });
                } finally {
                    if (localAudio === undefined) delete plugin.hasLocalAudio;
                    else plugin.hasLocalAudio = localAudio;
                }
                plugin.androidAssetSignature = signature;
                return plugin;
            });
            if (!useStartupConfig) {
                this.pipelineA = restore(slots.A, this.pipelineA, 'A');
            }
            this.pipelineB = slots.B ? restore(slots.B, this.pipelineB, 'B') : null;
            if (useStartupConfig) return false;
            this.currentPipeline = this.snapshot.slot || 'A';
            this.pipeline = this.currentPipeline === 'A' ? this.pipelineA : this.pipelineB || [];
            this.inactiveAssets?.synchronize([], () => {});
            this.nativeAssets.synchronize(this.pipeline, () => this.commitPowerTopologyMutation());
            this.nativeAssets.adopt(this.pipeline, this.snapshot.assetRefs, this.snapshot.assetDefinitions);
            this.bindInactiveSlot();
            for (const plugin of existing) if (![...this.pipelineA, ...this.pipelineB || []].includes(plugin)) plugin.cleanup?.();
            this.setMasterBypass(this.snapshot.masterBypass === true);
            this.pipelineProcessor.setPipeline(this.pipeline);
            window.pipeline = this.pipeline;
        } finally {
            this.hydrating = false;
            this.nativeAssets.suppressed = false;
        }
        const hydratedPipeline = this.pipeline;
        const { revision } = snapshot;
        const records = slots[this.currentPipeline];
        const preparations = [];
        for (const [name, chain] of [['A', this.pipelineA], ['B', this.pipelineB || []]]) for (const plugin of chain) {
            const selected = name === this.currentPipeline;
            const prefix = `${plugin.constructor.name}:${plugin.id}:`;
            for (const [key, definition] of Object.entries(definitionsFor(name))) {
                if (!selected && snapshot.otherStaleAssets?.includes(key)) continue;
                if (!key.startsWith(prefix) || !plugin.hydrateExternalAsset || plugin.externalAssetInfo?.pending) continue;
                const slot = Number(key.slice(prefix.length));
                if (selected ? this.nativeAssets.resident.has(`${plugin.id}:${slot}`)
                    : plugin.getWasmAssets?.().get(slot)?.externalAssetSignature === definition.externalAssetSignature) continue;
                const nativeHydration = { plugin, slot, id: definition.id, signature: definition.externalAssetSignature, inactive: !selected };
                const isCurrent = () => selected ? this.pipeline.includes(plugin) &&
                    this.nativeAssets.authoritative.get(`${plugin.id}:${slot}`) === definition.id :
                    (name === 'A' ? this.pipelineA : this.pipelineB)?.includes(plugin) &&
                    name !== this.currentPipeline && this.snapshot.otherAssetDefinitions?.[key]?.id === definition.id;
                preparations.push(plugin.hydrateExternalAsset(definition, { nativeHydration, isCurrent }));
            }
        }
        await Promise.all(preparations);
        await Promise.all(hydratedPipeline.filter(plugin => this.pipeline.includes(plugin) && plugin.sf && plugin.resolveOfflineDspAssetRequirement)
            .map(plugin => this.resumeSfzStream(plugin)));
        if (this.pipeline !== hydratedPipeline) return true;
        this.publishExecutionStates(hydratedPipeline, revision, records);
        // The Service keeps a chain packed for another rate out of the engine until it is packed for this one.
        // A remote edit made without the page lacks the page-derived parameters until it is packed here again.
        if (this.snapshot.pipelineRateMismatch || this.snapshot.pipelineRepack || this.nativeAssets.needsTransfer(hydratedPipeline))
            await this.rebuildPipeline(false, { restoring: true, inMutation });
        await this.syncInactiveSlot(inMutation);
        return true;
    }

    initializeAudioWorklet() { return Promise.resolve(''); }
    prefetchDspModule() { return Promise.resolve(); }
    waitForDspActivationBeforeOutput() { return Promise.resolve(); }
    isDspReady() { return this.snapshot !== null; }
    registerPipelineProcessors() {}
    startPowerPolicyController() { return Promise.resolve(); }
    updateExposedProperties() {}
    updateCurrentPipeline(plugins) {
        super.updateCurrentPipeline(plugins);
        this.pipelineProcessor.setPipeline(this.pipeline);
        window.pipeline = this.pipeline;
    }
    syncPrimaryWasmAssetMembership() {
        this.nativeAssets.synchronize(this.pipeline, () => this.commitPowerTopologyMutation());
    }

    bindInactiveSlot() {
        const plugins = this.currentPipeline === 'A' ? this.pipelineB : this.pipelineA;
        if (!plugins?.length && !this.inactiveAssets) return;
        this.inactiveAssets ??= new AndroidAssets(this.bridge, null);
        this.inactiveAssets.synchronize(plugins || [], () => {
            if (!this.hydrating && !this.pipelineTransitions && !this.mutationOptions?.nativeHydration)
                void this.syncInactiveSlot().catch(() => {});
        });
        const definitions = { ...this.snapshot.otherAssetDefinitions };
        for (const key of this.snapshot.otherStaleAssets || []) delete definitions[key];
        this.inactiveAssets.adopt(plugins || [], definitions, definitions);
    }

    async syncInactiveSlot(inMutation = false) {
        const name = this.currentPipeline === 'A' ? 'B' : 'A';
        const plugins = name === 'A' ? this.pipelineA : this.pipelineB;
        if (!plugins || !this.inactiveAssets?.needsTransfer(plugins)) return;
        const write = async () => {
            if (this.currentPipeline === name || plugins !== (name === 'A' ? this.pipelineA : this.pipelineB)) return;
            const clears = [...this.inactiveAssets.pendingClears];
            this.inactiveAssets.pendingClears.clear();
            await this.inactiveAssets.transfer(plugins, { inactiveSlot: name, channelCount: this.snapshot.channelCount },
                clears, this.snapshot.revision);
        };
        if (inMutation) await write();
        else await this.enqueuePipelineMutation(write);
    }
    getOutputChannelCount() { return this.snapshot?.channelCount || 2; }
    // Fixed-width host: expose the routing width as the remote host does.
    get outputChannelCount() { return this.getOutputChannelCount(); }
    getNativeSampleRate() { return this.snapshot?.sampleRate || 48000; }

    setLiveMidiInputSource(sourceKey) {
        if (sourceKey === this.getLiveMidiInputSource()) return;
        this.androidMidiInput = sourceKey ? { sourceKey, generation: this.nextMidiGeneration(),
            serial: 0, state: new MidiInputState() } : null;
        void this.bridge.request('midi.liveSource', { enabled: !!sourceKey })
            .catch(error => console.warn('Android MIDI input selection failed:', error));
    }

    getLiveMidiInputSource() { return this.androidMidiInput?.sourceKey ?? null; }

    enqueueLiveMidiInput({ data, sourceKey, timeStamp, systemReset = 0, drumMode }) {
        const input = this.androidMidiInput;
        if (!input || input.sourceKey !== sourceKey) return false;
        if (!input.notice && (this.masterBypass || !getReachableEnabledPlugins(this.pipeline).some(plugin =>
            plugin.constructor.name === 'SoundFontPlayerPlugin' && this.hasNativePluginAsset(plugin, 0)))) {
            input.notice = true;
            globalThis.window?.uiManager?.showTransientMessage?.('sfzPlayer.status.addPlayer', false, {}, 7000);
        }
        const [status, data1, data2 = 0] = data;
        const state = input.channelStateChanged ? input.state.hydration().flatMap(event => [
            event.status | event.data1 << 8 | event.data2 << 16, event.noteId || 0, event.flags || 0]) : undefined;
        input.channelStateChanged = (status & 0xe0) !== 0x80;
        input.state.apply({ status, data1, data2, systemReset, drumMode, seconds: timeStamp / 1000 });
        void this.bridge.request('midi.liveEvent', { message: status | data1 << 8 | data2 << 16,
            note: systemReset || ((status & 0xf0) === 0x90 && data2 ? ++input.serial : 0),
            flags: systemReset ? MIDI_SYSTEM_RESET : drumMode ? MIDI_DRUM_MODE : 0,
            delay: Math.max(0, Math.min(0.1, (timeStamp + 10 - performance.now()) / 1000)), state })
            .catch(error => console.warn('Android MIDI delivery failed:', error));
        return true;
    }

    getLiveMidiPresentation() {
        if (!this.androidMidiInput) return null;
        const { state, generation } = this.androidMidiInput;
        const position = performance.now() / 1000;
        state.prune(position);
        return { hasMidi: true, live: state, generation, position, speed: 1, playing: true, paused: false, preparing: false };
    }
    // Undefined until the Service has reported its format; the Analyzer waits for it.
    getReportedSampleRate() { return this.snapshot?.sampleRate || undefined; }
    getPowerSnapshot() { return this.snapshot; }
    getAudiblePlaybackPosition(position) {
        const playback = this.snapshot?.playback;
        if (!playback) return position;
        const speed = playback.speed || 1;
        const extrapolated = playback.position + (playback.playing && !playback.pcmStalled && !playback.scorePreparing
            ? (performance.now() - this.snapshotTime) / 1000 * speed : 0);
        const current = Math.max(0, extrapolated -
            (this.getTotalPipelineLatencySamples() + this._getDeviceLatencyFrames()) / this.getNativeSampleRate() * speed);
        return playback.duration > 0 ? Math.min(current, playback.duration) : current;
    }
    get needsSystemResumeRecovery() { return false; }
    handleSystemResume() { return this.initAudio(); }

    packPipeline(plugins) {
        const channelCount = this.getOutputChannelCount();
        return { ...prepareAndroidPipeline(plugins, { sampleRate: this.getNativeSampleRate(), channelCount,
            masterBypass: this.masterBypass }), channelCount };
    }

    async rebuildPipeline(isInitializing = false, { operationToken, restoring = false, inMutation = false } = {}) {
        if (this.hydrating || this.mutationOptions?.nativeHydration || (this.pipelineTransitions && !restoring)) return '';
        // Startup plugin edits are packed together by the explicit initial rebuild.
        if (this.initialPipelinePending) {
            if (!isInitializing) return '';
            this.initialPipelinePending = false;
        }
        if (this.pipelineBatch) {
            this.pipelineBatch.changed = true;
            return '';
        }
        const options = this.mutationOptions;
        const assetClears = [...this.nativeAssets.pendingClears];
        this.nativeAssets.pendingClears.clear();
        const externalEpoch = this.externalPipelineEpoch;
        let payload;
        try {
            payload = this.packPipeline(this.pipeline);
        } catch (error) {
            if (inMutation) throw error;
            return this.enqueuePipelineMutation(() => {
                if (externalEpoch === this.externalPipelineEpoch) throw error;
            });
        }
        payload.slot = this.currentPipeline;
        if (operationToken != null) {
            if (this.historyGesture?.token !== operationToken)
                this.historyGesture = { token: operationToken, id: crypto.randomUUID() };
            payload.operationToken = this.historyGesture.id;
        }
        if (options?.remoteRequestId) payload._remoteRequestId = options.remoteRequestId;
        const repacking = this.snapshot?.pipelineRateMismatch || this.snapshot?.pipelineRepack ? this.pipeline : null;
        const pipeline = [...this.pipeline];
        this.nativeAssets.synchronize(pipeline, () => this.commitPowerTopologyMutation());
        const write = async () => {
            if (externalEpoch !== this.externalPipelineEpoch) return;
            await options?.beforeCommit?.();
            if (externalEpoch !== this.externalPipelineEpoch) return;
            // A queued history or slot command can replace the chain that requested this repack.
            if (repacking && repacking !== this.pipeline) return;
            const restoreBanks = isInitializing || this.snapshot?.pipelineRateMismatch;
            const result = await this.bridge.request('pipeline.set', payload, this.snapshot?.revision);
            if (externalEpoch !== this.externalPipelineEpoch) return;
            if (!Number.isSafeInteger(result?.revision)) throw new Error('Invalid Android pipeline revision');
            this.acceptSnapshot(result);
            this.publishExecutionStates(pipeline, result.revision, payload.plugins);
            this.nativeAssets.reconcilePipeline(pipeline);
            if (restoreBanks) {
                // The Service has already reloaded the saved banks into the new graph.
                for (const plugin of pipeline) {
                    if (!plugin.sf || !plugin.getWasmAssets?.().get(0)?.sampleProviderFactory) continue;
                    const asset = await this.resumeSfzStream(plugin);
                    if (externalEpoch !== this.externalPipelineEpoch) return;
                    if (asset) this.nativeAssets.resident.set(`${plugin.id}:0`, asset);
                }
            }
            await this.nativeAssets.transfer(pipeline, { ...options, channelCount: result.channelCount }, assetClears, result.revision);
            if (isInitializing && this.pipelineB?.length) await this.hydratePipeline(this.pluginManager, { inMutation: true });
        };
        if (inMutation) await write();
        else await this.enqueuePipelineMutation(write);
        return '';
    }

    setPipelineTransition(pending) {
        this.pipelineTransitions = (this.pipelineTransitions || 0) + (pending ? 1 : -1);
        for (const id of ['pipeline', 'pluginList']) {
            const element = globalThis.document?.getElementById?.(id);
            if (element) element.inert = this.pipelineTransitions > 0;
        }
    }

    enqueuePipelineMutation(write, transition = false) {
        if (transition) this.setPipelineTransition(true);
        const operation = this.pendingMutation.then(write).catch(async error => {
            console.error('Android pipeline update failed:', error.code, error);
            if (Object.hasOwn(HOST_ERROR_MESSAGES, error.code)) this.reportHostError(error);
            else window.uiManager?.setError('error.pipelineEditFailed', true);
            this.dispatchEvent('nativeOperationFailed', { operation: 'pipeline' });
            this.externalPipelineEpoch++;
            this.setPipelineTransition(true);
            try {
                this.acceptSnapshot(await this.bridge.request('snapshot.get'));
                await this.restoreNativePipeline({ inMutation: true });
            } catch (failure) { console.error('Android pipeline recovery failed:', failure); }
            finally { this.setPipelineTransition(false); }
            throw error;
        }).finally(() => {
            if (transition) this.setPipelineTransition(false);
        });
        this.mutationWrites?.push(operation);
        this.pendingMutation = operation.catch(() => {});
        return operation;
    }

    getMutationOptions() { return this.mutationOptions; }

    batchPipelineMutations(callback) {
        const batch = { changed: false };
        this.pipelineBatch = batch;
        let result;
        try { result = callback(); }
        finally { this.pipelineBatch = null; }
        if (batch.changed) {
            const operationToken = this.pipelineManager.historyManager.activeOperationToken;
            void this.rebuildPipeline(false, { operationToken }).catch(() => {});
        }
        return result;
    }

    withMutationOptions(options, operation) {
        if (this.pipelineTransitions && options?.remoteRequestId && !options.nativeHydration)
            return Promise.reject(Object.assign(new Error('Pipeline is changing'), { code: 'revision-conflict' }));
        const previousOptions = this.mutationOptions, previousWrites = this.mutationWrites;
        const writes = [];
        let result;
        this.mutationOptions = options;
        this.mutationWrites = writes;
        try {
            result = operation();
            if (options?.nativeHydration && !options.nativeHydration.branch && options.isCurrent()) {
                const assets = options.nativeHydration.inactive ? this.inactiveAssets : this.nativeAssets;
                assets.adoptHydrated(options.nativeHydration);
            }
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
        if (this.pipelineTransitions) return true;
        if (options?.reason === 'sfz-note-preview') {
            const plugin = message?.plugin;
            const keys = ANDROID_PREVIEW_KEYS.get(plugin?.type);
            if (!keys) return false;
            const preview = Object.fromEntries(keys.map(key => [key, plugin.parameters[key]]));
            void this.bridge.request('pipeline.preview', { pluginId: plugin.id, ...preview })
                .then(snapshot => this.acceptSnapshot(snapshot)).catch(error => {
                console.warn('Android note preview failed:', error);
                this.dispatchEvent('nativeOperationFailed', { operation: 'preview' });
            });
            return true;
        }
        const handler = this.pipelineManager?.uiEventHandler;
        const plugin = handler?.parameterOperation?.plugin;
        const operationToken = plugin && plugin.id === message?.plugin?.id ? handler.getParameterOperationToken(plugin) : null;
        void this.rebuildPipeline(false, { operationToken }).catch(() => {});
        return true;
    }

    createSfzEndpoint(branch) {
        const node = { branch, context: { sampleRate: this.getNativeSampleRate() }, port: {
            directSampleSupply: false, samplePublishWindow: 16,
            postMessage: message => { void this.sendSfzMessage(message, node); }
        } };
        return node;
    }

    _isActiveDspWorklet(node) {
        return !!node && (node === this.sfzEndpoint || node === this.blindTest?.endpoint || super._isActiveDspWorklet(node));
    }

    _getSfzRuntimePlugin(node, id) {
        if (node && node === this.blindTest?.endpoint) {
            return this.blindTest.loaders.get(id) ?? this.blindTest.plugins.find(plugin => plugin.id === id) ?? null;
        }
        return node && node === this.sfzEndpoint ? this.pipeline.find(plugin => plugin.id === id) ?? null
            : super._getSfzRuntimePlugin(node, id);
    }

    _getSfzRuntimeAssetIdentity(node, id) {
        const assets = node === this.sfzEndpoint ? this.nativeAssets : node === this.blindTest?.endpoint ? this.blindTest?.assets : null;
        if (!node || !assets) return super._getSfzRuntimeAssetIdentity(node, id);
        const asset = assets.resident.get(`${id}:0`);
        return { token: asset?.operationRevision ??
            this._getSfzRuntimePlugin(node, id)?.getWasmAssetOperationRevision?.(0), replayEpoch: null };
    }

    hasSfzSampleStreaming() { return true; }

    getSfzPreparationContext(plugin, node, timeline) {
        node ??= this.blindTest?.endpoint && this._getSfzRuntimePlugin(this.blindTest.endpoint, plugin.id) === plugin
            ? this.blindTest.endpoint : this.sfzEndpoint;
        return super.getSfzPreparationContext(plugin, node, timeline);
    }

    getSfzSamplePreparation(plugin, node = this.sfzEndpoint) {
        return super.getSfzSamplePreparation(plugin, node);
    }

    getNativeMixerMetadata(plugin, node = this.sfzEndpoint) {
        const metadata = super.getNativeMixerMetadata(plugin, node);
        if (!metadata || node !== this.sfzEndpoint) return metadata;
        const nativeReady = plugin._activeAssetRevision != null &&
            plugin._activeAssetRevision === this._getSfzRuntimeAssetIdentity(node, plugin.id).token;
        return { ...metadata, nativeReady, ready: nativeReady && !metadata.preparing && !plugin._error };
    }

    setSoundFontMidiMetering(plugin, enabled) {
        if (plugin?.constructor?.name !== 'SoundFontPlayerPlugin' || typeof enabled !== 'boolean') return;
        super.setSoundFontMidiMetering(plugin, enabled);
        void this.bridge.request('sfz.midiMetering', { pluginId: plugin.id, enabled })
            .catch(error => console.warn('Android MIDI metering failed:', error));
    }

    acceptSfzEvent(data) {
        const node = data.branch === 1 ? this.blindTest?.endpoint : this.sfzEndpoint;
        if (!node) return;
        if (data.type === 'sfzStreamReady' && data.operationRevision < 0) {
            let plugin = this._getSfzRuntimePlugin(node, data.pluginId);
            if (node.branch && plugin?.sf) plugin = this.blindAssetLoader(this.blindTest, plugin);
            if (plugin?.sf && !this.hydrating) void this.resumeSfzStream(plugin, node)
                .catch(error => console.warn('Android sample stream restore failed:', error));
            return;
        }
        this._handleSfzRuntimeMessage(node, data.type === 'sfzStreamReady'
            ? { ...data, plugin: this._getSfzRuntimePlugin(node, data.pluginId) } : data);
    }

    async resumeSfzStream(plugin, node = this.sfzEndpoint) {
        const signature = plugin.sf;
        const routing = node.branch ? { branch: node.branch } : {};
        const current = () => this._getSfzRuntimePlugin(node, plugin.id) === plugin && plugin.sf === signature;
        const candidate = await this.bridge.request('sfz.resume', { ...routing, pluginId: plugin.id, signature });
        if (!candidate?.ok || !current()) return;
        const previous = this._sfzSampleStreams?.get(node)?.get(plugin.id);
        let asset = plugin.getWasmAssets().get(0);
        if (asset && previous?.plugin === plugin && previous.token === candidate.token &&
            previous.operationRevision === asset.operationRevision && asset.externalAssetSignature === signature) return asset;
        if (!asset) {
            const id = node.branch ? null : this.nativeAssets.authoritative.get(`${plugin.id}:0`) ?? null;
            if (!plugin._pending) plugin.hydrateExternalAsset(null, {
                nativeHydration: { plugin, slot: 0, id, signature, ...routing }, isCurrent: current
            });
            await plugin.resolveOfflineDspAssetRequirement();
            asset = plugin.getWasmAssets().get(0);
        }
        if (!current() || !asset?.sampleProviderFactory || asset.externalAssetSignature !== signature) return;
        const result = await this.bridge.request('sfz.resume', { ...routing, pluginId: plugin.id, signature, token: candidate.token,
            operationRevision: asset.operationRevision });
        if (!current() || !result?.ok || plugin.getWasmAssetOperationRevision(0) !== asset.operationRevision) return;
        if (!node.branch && !result.stream.preparing) plugin.onWasmAssetState?.(0, 3, asset.operationRevision);
        const active = this._sfzSampleStreams?.get(node)?.get(plugin.id);
        if (active?.plugin !== plugin || active.token !== result.stream.token ||
            active.operationRevision !== asset.operationRevision) this.acceptSfzEvent(result.stream);
        return asset;
    }

    _requestDspControl(node, type, replyType, payload, timeoutMs, transfer) {
        if (!node || (node !== this.sfzEndpoint && node !== this.blindTest?.endpoint) ||
            (type !== 'sfzPollPages' && type !== 'sfzPublishPage')) {
            return super._requestDspControl(node, type, replyType, payload, timeoutMs, transfer);
        }
        // Keep stream retirement cancellable. The Android bridge owns the request deadline.
        const requestId = ++this._dspControlRequestSequence;
        return new Promise(resolve => {
            this._pendingDspControlRequests.set(requestId, { workletNode: node, replyType, resolve, timer: null });
            void this.sendSfzMessage({ type, requestId, ...payload }, node);
        });
    }

    async sendSfzMessage({ type, requestId, pluginId, ...payload }, node = this.sfzEndpoint) {
        if (!Object.hasOwn(SFZ_ROUTES, type) || !this._isActiveDspWorklet(node)) return;
        const [command, responseType] = SFZ_ROUTES[type];
        const stream = this._sfzSampleStreams?.get(node)?.get(pluginId);
        let response = { ok: false };
        try {
            if (type !== 'sfzGetPreparationContext') {
                if (!stream || stream.generation !== payload.generation) return;
                payload.token = stream.token;
                payload.operationRevision ??= stream.operationRevision;
            }
            if (payload.page) {
                const { pcm } = payload.page;
                payload.page = { ...payload.page, pcm: bytesToBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)) };
            }
            response = await this.bridge.request(command, { pluginId, ...payload, ...(node.branch ? { branch: node.branch } : {}) });
            if (response.readiness && this._sfzSampleStreams?.get(node)?.get(pluginId) === stream)
                this._handleSfzRuntimeMessage(node, { ...payload, pluginId, type: 'sfzStreamReadiness',
                    readiness: response.readiness, limited: response.limited });
        } catch (error) {
            console.warn('Android sample stream request failed:', error);
        } finally {
            if (responseType) this._handleSfzRuntimeMessage(node, { ...response, type: responseType, requestId });
        }
    }

    async sendSoundFontMixerAction(plugin, action, reportAppliedFrame = false) {
        if (plugin?.constructor?.name !== 'SoundFontPlayerPlugin' || plugin._pending || !this.hasNativePluginAsset(plugin, 0)) {
            throw new Error('Wait until the SoundFont is ready, then try again.');
        }
        const snapshot = await this.bridge.request('pipeline.preview', { pluginId: plugin.id, action });
        const appliedFrame = snapshot?.appliedFrame;
        this.acceptSnapshot(snapshot);
        if (!Number.isSafeInteger(appliedFrame)) throw new Error('The channel could not be updated. Wait until the SoundFont is ready and try again.');
        return reportAppliedFrame ? appliedFrame : true;
    }

    setFrequencyPreview(frequency, sound = 'sine') {
        const active = Number.isFinite(frequency) && frequency > 0;
        void this.bridge.request('pipeline.frequencyPreview', { frequency: active ? frequency : 0,
            sound: sound === 'bandpassNoise' ? 'bandpassNoise' : 'sine' })
            .then(snapshot => this.acceptSnapshot(snapshot))
            .catch(error => console.warn('Android frequency preview failed:', error));
    }

    resetPluginState(pluginId) {
        void this.bridge.request('pipeline.resetPlugin', { pluginId })
            .catch(error => console.warn('Android effect reset failed:', error));
    }

    async nativePipelineCommand(command, payload = {}) {
        const options = this.mutationOptions;
        if (options?.remoteRequestId) payload._remoteRequestId = options.remoteRequestId;
        const epoch = this.externalPipelineEpoch;
        await this.enqueuePipelineMutation(async () => {
            if (command === 'ui' && epoch !== this.externalPipelineEpoch) return;
            await options?.beforeCommit?.();
            this.acceptSnapshot(await this.bridge.request(`pipeline.${command}`, payload, this.snapshot?.revision));
            if (command !== 'ui') await this.restoreNativePipeline({ inMutation: true });
        }, command !== 'ui');
    }

    savePipelineUIState() {
        if (this.hydrating || this.pipelineTransitions) return;
        const plugins = this.pipeline.map(({ id, _uiLocked, _uiCollapsed }) => ({ id, _uiLocked, _uiCollapsed }));
        void this.nativePipelineCommand('ui', { slot: this.currentPipeline, plugins }).catch(() => {});
    }

    async restoreNativePipeline(options) {
        await this.hydratePipeline(this.pluginManager, options);
        this.pipelineManager?.core.updatePipelineUI(true);
        this.dispatchEvent('pipelineChanged', { pipeline: this.currentPipeline });
        window.uiManager?.updateEditButtons?.();
        window.uiManager?.updatePipelineToggleButton?.();
    }

    setCurrentPipeline(name) {
        if (!this.snapshot || this.hydrating || this.initialPipelinePending) {
            if (name === 'B' && this.pipelineB === null) this.pipelineB = this._copyPipeline(this.pipelineA);
            super.setCurrentPipeline(name, true);
            this.pipelineProcessor.setPipeline(this.pipeline);
            window.pipeline = this.pipeline;
            return;
        }
        return this.nativePipelineCommand('slot', { slot: name });
    }
    setCurrentPipelineWithTransition(name) { return this.setCurrentPipeline(name); }
    togglePipeline() { return this.setCurrentPipeline(this.currentPipeline === 'A' ? 'B' : 'A'); }
    togglePipelineWithTransition() { return this.togglePipeline(); }
    copyAToB() { return this.nativePipelineCommand('copySlot', { from: 'A', to: 'B' }); }
    async copyBToA() {
        if (this.pipelineB === null) return;
        await this.nativePipelineCommand('copySlot', { from: 'B', to: 'A' });
    }

    setMasterBypass(bypass) {
        this.masterBypass = !!bypass;
        this.pipelineProcessor.setMasterBypass?.(this.masterBypass);
        if (this.hydrating) this.pipelineManager?.core.applyMasterBypass?.(this.masterBypass, { updateAudio: false });
        else this.commitPowerTopologyMutation();
    }

    async reset(preferences = null) {
        const previous = this.snapshot;
        const settings = {};
        for (const key of ['sampleRate', 'latencyHint', 'gaplessPlayback', 'useInputWithPlayer', 'powerSettings']) {
            if (preferences?.[key] !== undefined) settings[key] = preferences[key];
        }
        if (preferences?.outputDeviceId != null) settings.outputDeviceId = preferences.outputDeviceId === 'default' ? 0 : Number(preferences.outputDeviceId);
        if (preferences?.outputChannels != null) {
            settings.channelCount = preferences.outputChannels;
        }
        let failure;
        const configure = async changes => {
            try { this.acceptSnapshot(await this.bridge.request('audio.configure', changes)); }
            catch (error) {
                // Earlier settings may already be live. Read the Service's committed state before repacking or saving.
                this.acceptSnapshot(await this.bridge.request('snapshot.get'));
                failure = error;
            }
        };
        if (!preferences || Object.keys(settings).length) await configure(settings);
        if (previous && (this.snapshot.sampleRate !== previous.sampleRate || this.snapshot.channelCount !== previous.channelCount)) {
            // The Service waits for a chain packed for the newly opened format.
            const repack = async () => {
                this._postVisualizerSources();
                await this.rebuildPipeline(true);
                this.dispatchEvent('audioGraphRebuilt', { audioContext: this.audioContext, workletNode: this.workletNode, sourceNode: this.sourceNode });
            };
            try { await repack(); }
            catch (error) {
                const rollback = { sampleRate: previous.sampleRate };
                if (settings.channelCount !== undefined && this.snapshot.channelCount !== previous.channelCount) {
                    rollback.channelCount = previous.channelCount;
                }
                if (this.snapshot.preferredOutputDeviceId !== previous.preferredOutputDeviceId) rollback.outputDeviceId = previous.preferredOutputDeviceId;
                if (this.snapshot.latencyHint !== previous.latencyHint) rollback.latencyHint = previous.latencyHint;
                failure = error;
                await configure(rollback);
                try { await repack(); }
                catch (rollbackError) { failure = rollbackError; }
            }
        }
        if (!failure && preferences?.inputDeviceId != null) {
            // The input change advances the revision, so it waits its turn among the pipeline writes.
            const queued = this.pendingMutation;
            const input = (async () => {
                await queued;
                try {
                    this.acceptSnapshot(await this.bridge.request('audio.input', {
                        deviceId: preferences.inputDeviceId === NO_AUDIO_INPUT_DEVICE_ID ? -1 : preferences.inputDeviceId === 'default' ? 0 : Number(preferences.inputDeviceId)
                    }));
                } catch (error) {
                    if (error.code === 'permission-denied' && this.snapshot.inputDeviceId >= 0) {
                        this.acceptSnapshot(await this.bridge.request('audio.input', { deviceId: -1 }));
                    } else if (error.code !== 'cancelled') {
                        this.acceptSnapshot(await this.bridge.request('snapshot.get'));
                    }
                    throw error;
                }
            })();
            this.pendingMutation = input.catch(() => {});
            try { await input; }
            catch (error) {
                if (error.code === 'cancelled') throw error;
                failure = error;
            }
        }
        const changesAudio = preferences?.inputDeviceId != null || Object.keys(settings).some(key => key !== 'gaplessPlayback');
        const actual = changesAudio ? confirmedAudioPreferences(this.snapshot, preferences, window.audioPreferences) : {};
        if (settings.channelCount === undefined) delete actual.outputChannels;
        const player = globalThis.window?.uiManager?.audioPlayer;
        if (typeof this.snapshot?.gaplessPlayback === 'boolean') {
            if (player) player.gaplessPlayback = this.snapshot.gaplessPlayback;
            if (settings.gaplessPlayback !== undefined) actual.gaplessPlayback = this.snapshot.gaplessPlayback;
        }
        if (!failure && preferences?.replayGainMode !== undefined) {
            const merged = mergeWebAudioPreferences(window.audioPreferences, preferences);
            const gain = replayGainSettings(merged);
            try {
                if (player && Object.keys(gain).some(key => gain[key] !== player.replayGain?.[key])) {
                    await player.applyReplayGainPreference(gain);
                }
                const replay = pickPlayerPreferences(merged);
                delete replay.gaplessPlayback;
                Object.assign(actual, replay);
            } catch (error) { failure = error; }
        }
        if (!failure && preferences?.midiInputDeviceKey !== undefined) {
            try {
                await window.app?.applyMidiInputPreference?.(preferences.midiInputDeviceKey);
                actual.midiInputDeviceKey = preferences.midiInputDeviceKey;
            } catch (error) { failure = error; }
        }
        if (!failure && preferences?.midiOutputDeviceKey !== undefined) {
            let output;
            try { output = await this.bridge.request('midi.selectOutput', { key: preferences.midiOutputDeviceKey }); }
            catch (error) {
                failure = error;
                output = await this.bridge.request('midi.list');
            }
            actual.midiOutputDeviceKey = output.selectedOutputKey;
            try { await window.app?.applyMidiOutputPreference?.(output.selectedOutputKey); }
            catch (error) { failure ??= error; }
        }
        if (Object.keys(actual).length) {
            if (!await window.electronIntegration?.saveAudioPreferences?.(actual)) {
                console.warn('Failed to save Android audio preferences.', failure);
                if (failure) throw failure;
                return 'Audio Error: Failed to save audio preferences.';
            }
        }
        if (failure) throw failure;
        return '';
    }

    applyPlayerPreferences(preferences) { return this.reset(pickPlayerPreferences(preferences)); }

    updateAudioConfig(preferences) { return this.reset(preferences); }
    // The base updatePowerSettings persists the settings, then applies them here.
    async applyPersistedPowerSettings(settings) {
        const powerSettings = mergePowerSavingSettings({}, settings);
        this.acceptSnapshot(await this.bridge.request('audio.configure', { powerSettings }));
        return powerSettings;
    }
    async fadeInOutputWhenReady() {
        if (!this.startInitialOutput) return;
        this.startInitialOutput = false;
        try { this.acceptSnapshot(await this.bridge.request('audio.start')); }
        catch (error) {
            if (error.code !== 'audio-focus-denied') throw error;
            // The service published the stopped state. Initialization can finish with the player available.
        }
    }
    get outputErrorKey() {
        return this.snapshot?.outputStopReason === 'audio-focus-denied' ? HOST_ERROR_MESSAGES['audio-focus-denied'] : null;
    }
    async resumeStoppedOutput() {
        if (!this.snapshot?.outputStopReason) return;
        try { this.acceptSnapshot(await this.bridge.request('audio.start')); }
        catch (error) { this.reportHostError(error); }
    }
    restoreBlindTestPipelines(primary, secondary) {
        return this.enqueuePipelineMutation(async () => {
            const a = this.packPipeline(primary);
            const b = secondary && this.packPipeline(secondary);
            const result = await this.bridge.request('dbt.restore', { a, b }, this.snapshot?.revision);
            this.acceptSnapshot(result);
            this.pipelineA = primary;
            this.pipelineB = secondary;
            this.currentPipeline = 'A';
            this.pipeline = primary;
            this.pipelineProcessor.setPipeline(primary);
            window.pipeline = primary;
            for (const plugin of primary) plugin.audioHostActive = true;
            for (const plugin of secondary || []) plugin.audioHostActive = false;
            this.inactiveAssets?.synchronize([], () => {});
            this.nativeAssets.synchronize(primary, () => this.commitPowerTopologyMutation());
            this.nativeAssets.adopt(primary, result.assetRefs, result.assetDefinitions);
            this.bindInactiveSlot();
            await this.nativeAssets.transfer(primary, { channelCount: result.channelCount }, [], result.revision);
            await this.syncInactiveSlot(true);
        }, true);
    }

    async enableParallelPipelines(selection = 'A') {
        if (!this.snapshot || !Array.isArray(this.pipelineA) || !Array.isArray(this.pipelineB)) return false;
        if (this._parallelActive) return this.setBlindSelection(selection, 0);
        if (this._parallelPreparing) return false;
        const session = { primary: this.currentPipeline, a: this.pipelineA, b: this.pipelineB, loaders: new Map() };
        this.blindTest = session;
        this._parallelPreparing = true;
        let timer;
        try {
            const cancelled = new Promise(resolve => {
                session.cancel = () => resolve(false);
                timer = setTimeout(session.cancel, 15000);
            });
            if (await Promise.race([this.prepareBlindTest(session, selection), cancelled])) return true;
        } catch (error) {
            console.warn('Android blind test startup failed:', error);
        } finally {
            clearTimeout(timer);
            session.cancel = null;
        }
        if (this.blindTest === session) await this.disableParallelPipelines();
        return false;
    }

    blindAssetRequirements(plugins) {
        const assetMaps = new Map(), required = {}, stored = {};
        for (const plugin of plugins) {
            const info = plugin.externalAssetInfo;
            if (info?.missing) throw new Error('Branch asset unavailable');
            if (info?.pending) return null;
            const signature = info?.assetSignature ?? plugin._assetSignature?.();
            const assets = plugin.getWasmAssets?.() ?? new Map();
            const prefix = `${plugin.constructor.name}:${plugin.id}:`;
            for (const [slot, asset] of assets) {
                if (signature && asset.externalAssetSignature !== signature) return null;
                required[prefix + slot] = asset.externalAssetSignature ?? '';
            }
            assetMaps.set(plugin, assets);
            if (!assets.size && (plugin.offlineDspAssetRequired || info?.ids?.length)) {
                if (!signature) return null;
                required[prefix + 0] = signature;
                stored[prefix + 0] = signature;
            }
        }
        return { assetMaps, required, stored };
    }

    blindAssetLoader(session, plugin) {
        let loader = session.loaders.get(plugin.id);
        if (!loader) {
            loader = this.pluginManager.createPlugin(plugin.name, { audioHostActive: false });
            loader.id = plugin.id;
            loader.channel = plugin.channel;
            if (plugin.sf) loader.sf = plugin.sf;
            session.loaders.set(plugin.id, loader);
        }
        return loader;
    }

    async prepareBlindSampler(session, plugin, assetMaps) {
        const descriptor = assetMaps.get(plugin)?.get(0);
        if (!descriptor || !['SFZNotePlayerPlugin', 'SoundFontPlayerPlugin'].includes(plugin.constructor.name)) return;
        const source = session.loaders.get(plugin.id) ?? plugin;
        const timeline = globalThis.window?.uiManager?.audioPlayer?.contextManager?.midiTimeline ?? null;
        const context = await this.getSfzPreparationContext(source, session.endpoint, timeline);
        if (!context) throw new Error('Instrument preparation context unavailable');
        const { prepareSfzAssetForContext } = await import('../sfz/preparation-context.js');
        const { getSfzMaxBytes } = await import('../sfz/limits.js');
        const prepared = await prepareSfzAssetForContext(descriptor, context,
            getSfzMaxBytes(globalThis.window?.appConfig?.sfzMaxSizeMiB), this.estimateSfzEffectPreparation.bind(this));
        if (this.blindTest !== session || prepared === descriptor) return;
        // Keep the provider and the transferred bank on the same target geometry.
        const loader = this.blindAssetLoader(session, plugin);
        loader.setWasmAsset(0, prepared);
        assetMaps.set(plugin, loader.getWasmAssets());
    }

    async prepareBlindTest(session, selection) {
        await this.pendingMutation;
        if (this.blindTest !== session || this.currentPipeline !== session.primary ||
            this.pipelineA !== session.a || this.pipelineB !== session.b) return false;
        const other = session.primary === 'A' ? 'B' : 'A';
        const plugins = other === 'A' ? session.a : session.b;
        let pipeline = this.packPipeline(plugins);
        session.plugins = getReachableEnabledPlugins(plugins);
        const primaryPlugins = getReachableEnabledPlugins(session.primary === 'A' ? session.a : session.b);
        let primary, secondary;
        let waited = false;
        while (!(primary = this.blindAssetRequirements(primaryPlugins)) ||
                !(secondary = this.blindAssetRequirements(session.plugins))) {
            // A staged replacement in the current graph may need a render block before its descriptor settles.
            if (!waited && !primary && this.snapshot.powerState === 'SUSPENDED')
                this.acceptSnapshot(await this.bridge.request('audio.start'));
            await new Promise(resolve => setTimeout(resolve, 40));
            if (this.blindTest !== session) return false;
            waited = true;
        }
        if (waited) pipeline = this.packPipeline(plugins);
        const snapshot = this._createParallelBranchSnapshot(this._audioGraphGeneration, [], []);
        const plans = session.primary === 'A' ? [primary, secondary] : [secondary, primary];
        for (const [branch, plan] of [[snapshot.pipelineA, plans[0]], [snapshot.pipelineB, plans[1]]]) {
            for (const record of branch.records) {
                const key = `${record.plugin.constructor.name}:${record.id}:0`;
                if (!Object.hasOwn(plan.stored, key)) record.lockedRevision = record.plugin.getWasmAssetRevision?.() ?? 0;
            }
        }
        pipeline.slot = other;
        pipeline.storedAssets = secondary.stored;
        pipeline.prepareAssets = Object.keys(primary.required).length > 0 || Object.keys(secondary.required).length > 0;
        session.assets = new AndroidAssets(this.bridge, 1);
        session.endpoint = this.createSfzEndpoint(1);
        session.started = true;
        const result = await this.bridge.request('dbt.start', { pipeline }, this.snapshot.revision);
        if (this.blindTest !== session) return false;
        // A restored slot can have native coefficients but no renderer descriptor.
        for (const plugin of session.plugins) {
            const key = `${plugin.constructor.name}:${plugin.id}:0`;
            if (!secondary.stored[key] || result.assetDefinitions?.[key]) continue;
            const definition = { externalAssetSignature: secondary.stored[key],
                externalAssetParameters: plugin.getExternalAssetParameters?.() };
            const isCurrent = () => this.blindTest === session;
            const source = plugin.hydrateExternalAsset ? this.blindAssetLoader(session, plugin) : plugin;
            if (source.hydrateExternalAsset) {
                if (plugin.constructor.name === 'RoomEqPlugin') {
                    // The isolated loader must recreate the coefficients for the restored slot.
                    source.hasLocalAudio = false;
                    applySerializedState(source, getSerializablePluginStateLong(plugin));
                }
                await source.hydrateExternalAsset(definition, { isCurrent, nativeHydration: { branch: 1 } });
                if (source.sf && isCurrent()) await source.resolveOfflineDspAssetRequirement();
            }
            while (isCurrent() && !source.getWasmAssets?.().size) {
                if (source.externalAssetInfo?.missing) return false;
                await new Promise(resolve => setTimeout(resolve, 40));
            }
            if (!isCurrent()) return false;
            const assets = source.getWasmAssets();
            if (assets.get(0)?.externalAssetSignature !== secondary.stored[key]) return false;
            secondary.assetMaps.set(plugin, assets);
        }
        for (const plugin of session.plugins) {
            await this.prepareBlindSampler(session, plugin, secondary.assetMaps);
            if (this.blindTest !== session) return false;
        }
        await session.assets.transfer(session.plugins, { assetMaps: secondary.assetMaps, channelCount: pipeline.channelCount });
        while (this.blindTest === session) {
            const alignment = await this.bridge.request('dbt.align', { primary: primary.required, secondary: secondary.required });
            if (this.blindTest !== session) return false;
            if (alignment.ready) {
                if (!this._isParallelBranchSnapshotCurrent(snapshot)) return false;
                this._parallelPreparing = false;
                this._parallelActive = true;
                return this.setBlindSelection(selection, 0);
            }
            await new Promise(resolve => setTimeout(resolve, 40));
        }
        return false;
    }

    async blindTestCommand(command, payload) {
        const session = this.blindTest;
        if (!this._parallelActive || !session) return false;
        try {
            await this.bridge.request(command, payload);
            return this.blindTest === session;
        } catch (error) {
            if (this.blindTest === session) {
                console.warn('Android blind test control failed:', error);
                void this.disableParallelPipelines();
                this.dispatchEvent('parallelInvalidated', {});
            }
            return false;
        }
    }

    setBlindSelection(selection, seconds = .03) {
        return this.blindTestCommand('dbt.select', { branch: selection === this.blindTest?.primary ? 0 : 1, seconds });
    }

    fadeInOutput(seconds = .05) { return this.blindTestCommand('dbt.fade', { gain: 1, seconds }); }
    fadeOutOutput(seconds = .05) {
        const token = this._outputFadeToken = (this._outputFadeToken || 0) + 1;
        void this.blindTestCommand('dbt.fade', { gain: 0, seconds });
        return token;
    }

    invalidateBlindTest() {
        if (!this.blindTest) return;
        this.clearBlindTest();
        this.dispatchEvent('parallelInvalidated', {});
    }

    clearBlindTest() {
        this.blindTest?.cancel?.();
        this._disposeParallelBranchSnapshot(this._parallelBranchSnapshot);
        this.blindTest?.assets?.dispose();
        const loaders = this.blindTest?.loaders;
        this.blindTest = null;
        this._pruneSfzRuntimeTargets();
        for (const plugin of loaders?.values() ?? []) plugin.cleanup();
        this._parallelPreparing = this._parallelActive = false;
        this._outputFadeToken = (this._outputFadeToken || 0) + 1;
    }

    async disableParallelPipelines() {
        const started = this.blindTest?.started;
        this.clearBlindTest();
        if (started) {
            try { await this.bridge.request('dbt.stop'); }
            catch (error) { console.warn('Android blind test teardown failed:', error); return false; }
        }
        return true;
    }
    fadeOutOutputForTeardown() { return Promise.resolve(); }

    updateDspTelemetryRate() {
        if (!this.bridge) return;
        void this.bridge.request('telemetry.configure', {
            visible: globalThis.document?.visibilityState !== 'hidden',
            // Effect displays hidden by the UI (mini player, collapsed pipeline), as Web counts them.
            displayHidden: (this.powerPolicyController?.dspUiSuppressionReasons?.size ?? 0) !== 0
        }).catch(error => console.warn('Android telemetry configuration failed:', error));
    }

    // The Service forwards the common visualizer source message to the native engine.
    _postVisualizerSources() {
        if (!this.bridge) return;
        super._postVisualizerSources({ port: { postMessage: ({ sources }) => {
            void this.bridge.request('visualizer.sources', {
                sources: sources.map(source => ({ ...source, params: Array.from(source.params || []) }))
            }).catch(error => console.warn('Android visualizer configuration failed:', error));
        } } });
    }

    // Forwards the overlay's port commands as the desktop endpoint does, keeping them for a fresh engine.
    postSpectrumTap(message) {
        const { type, pluginId, enabled } = message || {};
        if (type === 'setSpectrumTapRoute') {
            if (enabled) this.spectrumTaps.set(pluginId, this.spectrumTaps.get(pluginId) ?? null);
            else this.spectrumTaps.delete(pluginId);
        } else if (type === 'setSpectrumTap') {
            if (this.spectrumTaps.has(pluginId)) this.spectrumTaps.set(pluginId, enabled ? message : null);
        } else return;
        this._sendSpectrumTap(message);
    }

    _sendSpectrumTap({ type, pluginId, enabled, mode, quality }) {
        void this.bridge.request('spectrum.tap', type === 'setSpectrumTapRoute' ? { pluginId, route: enabled === true }
            : { pluginId, enabled: enabled === true, mode, quality })
            .catch(error => console.warn('Android spectrum overlay configuration failed:', error));
    }

    _resendSpectrumTaps() {
        for (const [pluginId, tap] of this.spectrumTaps) {
            this._sendSpectrumTap({ type: 'setSpectrumTapRoute', pluginId, enabled: true });
            if (tap) this._sendSpectrumTap(tap);
        }
    }

    acceptSpectrumOverlay(data) {
        this.observeVisualClock(data);
        if (typeof data?.packet !== 'string') return;
        const message = unpackSpectrumOverlay({ ...data, packet: base64ToBytes(data.packet).buffer });
        if (message) this.spectrumOverlayEndpoint.port.dispatchEvent(new MessageEvent('message', { data: message }));
    }

    // The desktop engine clock: the newest callback frame and its time, with the least observed transit delay.
    observeVisualClock(data) {
        if (Number.isSafeInteger(data?.outputDelayFrames) && data.outputDelayFrames >= 0) {
            this._observeAppliedOutputDelay(data.outputDelayFrames);
        }
        const pipelineFrame = data?.clockPipelineFrame, timeNs = data?.clockTimeNs, latencyFrames = data?.outputLatencyFrames;
        if (!Number.isFinite(pipelineFrame) || !(timeNs > 0) || !(latencyFrames >= 0)) return;
        const now = performance.now(), engineMs = timeNs / 1e6;
        this.visualClockOffsets.push(now - engineMs);
        if (this.visualClockOffsets.length > 100) this.visualClockOffsets.shift();
        const first = !this.visualClock;
        // Deadlines follow the live latency; the delay is sized from one estimate per clock, as Web keeps one per context.
        this.visualClock = { pipelineFrame, time: engineMs + Math.min(...this.visualClockOffsets), latencyFrames,
            deviceLatencyFrames: this.visualClock?.deviceLatencyFrames ?? latencyFrames };
        // The output latency is known from now on, so the Visual Sync delay can be sized.
        if (first) this._scheduleVisualSyncUpdate();
    }

    resetVisualClock() {
        this.visualClock = null;
        this.visualClockOffsets.length = 0;
        this.telemetryHub.clearVisualSyncQueue();
    }

    // The Service reports the delay its output applies; a fresh or reset engine may no longer hold the requested one.
    _observeAppliedOutputDelay(frames) {
        if (this._pendingOutputDelayRequests.has(null) || this._appliedOutputDelayFrames.get(null) === frames) return;
        this._appliedOutputDelayFrames.set(null, frames);
        this.telemetryHub.clearVisualSyncQueue();
        this._publishDspLatency();
        void this._updateVisualSyncDelay();
    }

    // A render-context stand-in on the engine clock, read by the common Visual Sync timing.
    _visualClockContext() {
        const clock = this.visualClock;
        if (!clock) return null;
        const sampleRate = this.getNativeSampleRate();
        return { sampleRate, baseLatency: 0, outputLatency: clock.latencyFrames / sampleRate,
            currentTime: (clock.pipelineFrame + (performance.now() - clock.time) * sampleRate / 1000) / sampleRate };
    }

    _withVisualClock(read) {
        const previous = this.contextManager.audioContext;
        this.contextManager.audioContext = this._visualClockContext();
        try { return read(); }
        finally { this.contextManager.audioContext = previous; }
    }

    // Without a clock the output latency is unknown and frames are shown on arrival, as on Web.
    _visualSyncNow() { return this._withVisualClock(() => super._visualSyncNow()); }
    _resolveVisualSyncDue(...args) { return this._withVisualClock(() => super._resolveVisualSyncDue(...args)); }
    getTelemetryLeadSeconds(tapId) { return this._withVisualClock(() => super.getTelemetryLeadSeconds(tapId)); }
    _recomputeVisualSyncDelay() { return this._withVisualClock(() => super._recomputeVisualSyncDelay()); }
    _getDeviceLatencyFrames() { return this.visualClock?.deviceLatencyFrames ?? 0; }

    // The Service output stands in for the primary worklet, keyed null as _getPrimaryWorkletNode() reports.
    _updateVisualSyncDelay() {
        this._recomputeVisualSyncDelay();
        if (!this._pendingOutputDelayRequests.has(null) &&
            this._appliedOutputDelayFrames.get(null) === this.visualSyncDelayFrames) return Promise.resolve(true);
        return this._applyWorkletOutputDelays([null]);
    }

    _setWorkletOutputDelay(_node, samples) {
        return this.bridge.request('audio.outputDelay', { samples }).catch(error => {
            console.warn('Android output delay failed:', error);
            return null;
        });
    }

    setVisualSyncEnabled(enabled) {
        const result = super.setVisualSyncEnabled(enabled);
        void this.bridge.request('visualSync', { enabled: this.visualSyncEnabled })
            .catch(error => console.warn('Android visual sync configuration failed:', error));
        return result;
    }

    _publishDspLatency(sampleRate = this.getNativeSampleRate(), detail = {}) {
        super._publishDspLatency(sampleRate, detail);
    }

    // A fresh engine starts without the visual settings, as a recreated worklet does.
    _resendNativeVisualState() {
        this._appliedOutputDelayFrames.delete(null);
        this._pendingOutputDelayRequests.delete(null);
        void this.setVisualSyncEnabled(this.visualSyncEnabled);
        this._resendSpectrumTaps();
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

    // The Service owns live DSP. Renderer workers load the matching module on demand.
    getOfflineDspModuleInfo() { return this._loadEnabledDspModule(); }

    // Native assets are acknowledged by the Service, not by a worklet.
    async waitForEffectiveActiveWasmAssets(plugin, slots = null) {
        await this.pendingMutation;
        const requested = Array.isArray(slots) ? slots : [...(plugin?.getWasmAssets?.().keys?.() || [])];
        const assets = new Map(), revisions = new Map(), rejectedCandidates = new Map(), missingSlots = [];
        for (const slot of requested) {
            const rejection = plugin?.getWasmAssetLastRejection?.(slot);
            if (rejection) rejectedCandidates.set(slot, rejection);
            const asset = this.pipeline.includes(plugin) ? this.nativeAssets.resident.get(`${plugin.id}:${slot}`) : null;
            if (!(asset?.payload instanceof ArrayBuffer)) { missingSlots.push(slot); continue; }
            assets.set(slot, { ...asset, payload: asset.payload.slice(0) });
            revisions.set(slot, { operationRevision: asset.operationRevision, replayEpoch: null });
        }
        return { assets, revisions, rejectedCandidates, missingSlots, ready: missingSlots.length === 0, timedOut: false };
    }
}
