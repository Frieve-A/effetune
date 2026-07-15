import { AudioContextManager } from './audio/audio-context-manager.js';
import {
    AudioIOManager,
    MIC_DENIED_PREFIX
} from './audio/audio-io-manager.js';
import { PipelineProcessor } from './audio/pipeline-processor.js';
import { OfflineProcessor } from './audio/offline-processor.js';
import { AudioEncoder } from './audio/audio-encoder.js';
import { EventManager } from './audio/event-manager.js';
import { loadDspModule } from './audio/dsp-wasm-loader.js';
import { getDspRolloutConfig } from './audio/dsp-rollout.js';
import { TelemetryHub } from './audio/telemetry-hub.js';
import { PowerPolicyController } from './audio/power-policy-controller.js';
import { PowerDiagnostics } from './audio/power-diagnostics.js';
import { AudioPowerState, mergePowerSavingSettings } from './audio/power-policy.js';
import { computeRuntimePipelineGraphBound } from './audio/power-topology.js';
import { AudioActivationCoordinator } from './audio/audio-activation-coordinator.js';
import {
    loadWebAudioPreferences,
    saveWebAudioPreferences,
    saveWebPowerSavingSettings,
    setWebPowerSettingsApplyHandler
} from './electron/webSettingsStorage.js';
import { NO_AUDIO_INPUT_DEVICE_ID } from './audio/audio-device-constants.js';
import { getSerializablePluginStateShort, applySerializedState } from './utils/serialization-utils.js';

const PIPELINE_SWITCH_FADE_SECONDS = 0.04;
const PIPELINE_SWITCH_SILENCE_SECONDS = 0.05;
const DSP_MODULE_LOAD_TIMEOUT_MS = 1000;
const DSP_MODULE_READY_TIMEOUT_MS = 1000;
const DSP_BYTES_READY_TIMEOUT_MS = 3000;

// Pipeline-content mutations describe the visible (primary) pipeline only.
// During a Double Blind Test the parallel worklet B holds its own dedicated
// pipeline (posted via _postBlindPlugins) and must never receive them.
const PIPELINE_CONTENT_MUTATION_TYPES = new Set([
    'updatePlugins',
    'updatePlugin',
    'batchUpdatePlugins',
    'addPlugin',
    'removePlugin',
    'reorderPlugin',
    'reset'
]);

function waitForPipelineSwitch(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function audioPreferencesEqual(left, right) {
    if (left === right) return true;
    if (!left || !right) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length &&
        leftKeys.every(key => Object.hasOwn(right, key) && Object.is(left[key], right[key]));
}

function audioPipelineConfigurationEqual(left, right) {
    if (!left || !right) return false;
    const defaults = {
        outputDeviceId: 'default',
        sampleRate: 96000,
        useInputWithPlayer: false,
        lowLatencyOutput: false,
        useWasmDsp: true,
        outputChannels: 2,
        latencyHint: 'interactive'
    };
    return Object.entries(defaults).every(([key, fallback]) =>
        Object.is(left[key] ?? fallback, right[key] ?? fallback));
}

/**
 * AudioManager - Main class for audio processing
 * Acts as a facade for the various audio modules
 */
export class AudioManager {
    /**
     * Create a new AudioManager instance
     * @param {Object} pipelineManager - Reference to the UI pipeline manager
     */
    constructor(pipelineManager) {
        // Initialize modules
        this.contextManager = new AudioContextManager();
        this.audioEncoder = new AudioEncoder();
        this.ioManager = new AudioIOManager(this.contextManager);
        this.pipelineProcessor = new PipelineProcessor(
            this.contextManager,
            this.ioManager,
            () => this.registerPipelineProcessors(),
            node => this.connectSourceToPipeline(node)
        );
        this.offlineProcessor = new OfflineProcessor(this.contextManager, this.audioEncoder);
        this.eventManager = new EventManager(this);
        this.telemetryHub = new TelemetryHub();
        window.dspTelemetryHub = this.telemetryHub;
        this.dspModuleInfo = null;
        this.dspCapabilities = null;
        this.dspPipelineLatencySamples = 0;
        this._dspReadyFallbacks = new Map();
        this._dspCapabilitiesByNode = new Map();
        this._dspReadyTokens = new Map();
        this._pendingDspActivationRequests = new Map();
        this._dspReadyTransitionPromise = null;
        this._dspTransitionGeneration = -1;
        this._audioGraphGeneration = 0;
        this._topologyRevision = 0;
        this._workletGraphGeneration = 0;
        this._primaryWorkletEpoch = 0;
        this._outputFadeToken = 0;
        this._parallelDspBarrier = null;
        this._parallelPreparing = false;
        this._connectedPipelineSources = new Set();
        this._dspModuleLoadPromise = null;
        this._dspModuleLoadRequest = null;
        this._dspModuleLoadRequestSequence = 0;
        this._boundDspVisibilityChange = () => this.updateDspTelemetryRate();
        globalThis.document?.addEventListener?.('visibilitychange', this._boundDspVisibilityChange);
        
        // Store reference to pipeline manager
        this.pipelineManager = pipelineManager;
        
        // Dual pipeline management
        this.pipelineA = [];
        this.pipelineB = null; // Initially null, will be created when needed
        this.currentPipeline = 'A'; // 'A' or 'B'
        
        // Expose properties for backward compatibility
        this.audioContext = null;
        this.stream = null;
        this.sourceNode = null;
        this.workletNode = null;
        this.pipeline = this.pipelineA; // Reference to current pipeline
        this.masterBypass = false;
        this.offlineContext = null;
        this.offlineWorkletNode = null;
        this.isOfflineProcessing = false;
        this._resetInProgress = false;
        this._activeResetPrefs = null;
        this._hasPendingReset = false;
        this._pendingResetPrefs = null;
        this.isCancelled = false;
        this._skipAudioInitDuringSampleRateChange = false;
        this.isFirstLaunch = false;
        this._pipelineSwitchSeq = 0;
        this.powerDiagnostics = new PowerDiagnostics();
        this.powerPolicyController = new PowerPolicyController(this, {
            settings: window.appConfig?.powerSaving
        });
        this.audioActivationCoordinator = new AudioActivationCoordinator({
            getGraphSnapshot: () => ({
                audioGraphGeneration: this._audioGraphGeneration,
                workletGraphGeneration: this._workletGraphGeneration,
                topologyRevision: this._topologyRevision
            }),
            getActiveWorklets: () => this.getActivePowerWorklets(),
            broadcast: message => this.broadcastToActiveWorklets(message)
        });
        this._audioConfigIntentSequence = 0;
        this._activeAudioConfigRevision = 0;
        if (!window.electronAPI) {
            setWebPowerSettingsApplyHandler(settings =>
                this.applyPersistedPowerSettings(settings));
        }
        // Set global reference
        window.audioManager = this;
    }

    /**
     * Get current pipeline (A or B)
     * @returns {Array} Current pipeline array
     */
    getCurrentPipeline() {
        return this.currentPipeline === 'A' ? this.pipelineA : (this.pipelineB || []);
    }

    /**
     * Set current pipeline (A or B)
     * @param {string} pipeline - 'A' or 'B'
     * @param {boolean} skipHistorySave - Skip saving to history (for internal operations)
     */
    setCurrentPipeline(pipeline, skipHistorySave = false) {
        if (pipeline !== 'A' && pipeline !== 'B') {
            throw new Error('Pipeline must be "A" or "B"');
        }
        
        this.currentPipeline = pipeline;
        this.pipeline = this.getCurrentPipeline();
        
        // Rebuild audio pipeline if worklet is initialized
        if (this.workletNode) {
            this.rebuildPipeline();
        }
        
        // Dispatch event for UI updates
        this.dispatchEvent('pipelineChanged', { pipeline: this.currentPipeline });
        
        // Save state to history for undo/redo (unless explicitly skipped)
        if (!skipHistorySave && this.pipelineManager && this.pipelineManager.historyManager) {
            this.pipelineManager.historyManager.saveState();
        }
    }

    /**
     * Switch between pipeline A and B
     * If B doesn't exist, copy A to B first
     */
    togglePipeline() {
        if (this.currentPipeline === 'A') {
            if (this.pipelineB === null) {
                // Copy A to B if B doesn't exist
                this.pipelineB = this._copyPipeline(this.pipelineA);
            }
            this.setCurrentPipeline('B');
        } else {
            this.setCurrentPipeline('A');
        }
    }

    /**
     * Switch between pipeline A and B with an output dip for user-triggered A/B switching.
     * If B doesn't exist, copy A to B first.
     * @returns {Promise<boolean>} Whether the transition completed
     */
    async togglePipelineWithTransition() {
        if (this.currentPipeline === 'A') {
            if (this.pipelineB === null) {
                // Copy A to B if B doesn't exist
                this.pipelineB = this._copyPipeline(this.pipelineA);
            }
            return this.setCurrentPipelineWithTransition('B');
        }
        return this.setCurrentPipelineWithTransition('A');
    }

    /**
     * Set current pipeline after fade-out, keep a short silent interval, then fade in.
     * This is for user-facing A/B switches; internal restore paths should use setCurrentPipeline().
     * @param {string} pipeline - 'A' or 'B'
     * @param {boolean} skipHistorySave - Skip saving to history (for internal operations)
     * @param {Object} options - Optional fade/silence durations in seconds
     * @returns {Promise<boolean>} Whether the transition completed
     */
    async setCurrentPipelineWithTransition(pipeline, skipHistorySave = false, options = {}) {
        if (pipeline !== 'A' && pipeline !== 'B') {
            throw new Error('Pipeline must be "A" or "B"');
        }

        if (pipeline === this.currentPipeline) {
            return true;
        }

        const gainNode = this.ioManager?.outputGainNode;
        const ctx = this.contextManager?.audioContext;
        if (!gainNode || !ctx) {
            this.setCurrentPipeline(pipeline, skipHistorySave);
            return true;
        }

        const fadeDuration = typeof options.fadeDuration === 'number'
            ? options.fadeDuration
            : PIPELINE_SWITCH_FADE_SECONDS;
        const silenceDuration = typeof options.silenceDuration === 'number'
            ? options.silenceDuration
            : PIPELINE_SWITCH_SILENCE_SECONDS;
        const seq = ++this._pipelineSwitchSeq;
        let outputOwner = this._captureOutputOwner();
        const isCurrent = () => seq === this._pipelineSwitchSeq &&
            this._isOutputOwnerCurrent(outputOwner);

        try {
            this.fadeOutOutput(fadeDuration);
            outputOwner = this._captureOutputOwner();
            await waitForPipelineSwitch(fadeDuration);
            if (!isCurrent()) return false;

            this.currentPipeline = pipeline;
            this.pipeline = this.getCurrentPipeline();

            if (this.workletNode) {
                const result = await this.rebuildPipeline();
                if (!isCurrent()) return false;
                if (result) {
                    console.warn('[AudioManager] Pipeline switch rebuild reported:', result);
                }
            }

            this.dispatchEvent('pipelineChanged', { pipeline: this.currentPipeline });
            if (!isCurrent()) return false;

            if (!skipHistorySave && this.pipelineManager && this.pipelineManager.historyManager) {
                this.pipelineManager.historyManager.saveState();
            }

            await waitForPipelineSwitch(silenceDuration);
            if (!isCurrent()) return false;

            this._fadeInOutputIfOwned(outputOwner, fadeDuration);
            return true;
        } catch (error) {
            if (!isCurrent()) return false;
            console.warn('[AudioManager] setCurrentPipelineWithTransition failed, falling back to immediate switch:', error);
            this.setCurrentPipeline(pipeline, skipHistorySave);
            this._fadeInOutputIfOwned(outputOwner, fadeDuration);
            return false;
        }
    }

    /**
     * Copy pipeline A to B and switch to B
     */
    copyAToB() {
        this.pipelineB = this._copyPipeline(this.pipelineA);
        this.setCurrentPipeline('B');
    }

    /**
     * Copy pipeline B to A and switch to A
     */
    copyBToA() {
        if (this.pipelineB !== null) {
            this.pipelineA = this._copyPipeline(this.pipelineB);
            this.setCurrentPipeline('A');
        }
    }

    /**
     * Create a deep copy of pipeline without circular references
     * @param {Array} pipeline - Pipeline to copy
     * @returns {Array} Copied pipeline
     */
    _copyPipeline(pipeline) {
        if (!pipeline || !Array.isArray(pipeline)) {
            return [];
        }

        // Use plugin manager to recreate plugins from serialized state
        const pluginManager = this.pipelineManager?.pluginManager || window.pluginManager;
        if (!pluginManager) {
            console.warn('Plugin manager not available for pipeline copy');
            return [];
        }

        // Get expanded plugins state from pipeline manager
        const expandedPlugins = this.pipelineManager?.expandedPlugins || new Set();
        
        // Create a map of plugin positions to their expanded state
        const expandedPositions = new Set();
        pipeline.forEach((plugin, index) => {
            if (expandedPlugins.has(plugin)) {
                expandedPositions.add(index);
            }
        });

        const copiedPlugins = pipeline.map((plugin, index) => {
            try {
                // Get serialized state using utility function
                const serializedState = getSerializablePluginStateShort(plugin);
                
                // Create new plugin instance
                const newPlugin = pluginManager.createPlugin(serializedState.nm);
                if (!newPlugin) {
                    console.warn(`Failed to create plugin: ${serializedState.nm}`);
                    return null;
                }

                // Apply serialized state
                applySerializedState(newPlugin, serializedState);
                
                // Preserve expanded state if the original plugin at this position was expanded
                if (expandedPositions.has(index)) {
                    expandedPlugins.add(newPlugin);
                }
                
                return newPlugin;
            } catch (error) {
                console.warn(`Failed to copy plugin ${plugin.name}:`, error);
                return null;
            }
        }).filter(plugin => plugin !== null);

        return copiedPlugins;
    }

    /**
     * Update current pipeline with new plugins
     * @param {Array} plugins - Array of plugins to set
     */
    updateCurrentPipeline(plugins) {
        const nextPlugins = Array.isArray(plugins) ? plugins : [];
        if (this.currentPipeline === 'A') {
            this.pipelineA = nextPlugins;
        } else if (this.currentPipeline === 'B') {
            this.pipelineB = nextPlugins;
        }
        this.pipeline = this.getCurrentPipeline();
    }

    /**
     * Get pipeline state for serialization
     * @returns {Object} Pipeline state object
     */
    getPipelineState() {
        return {
            pipelineA: this.pipelineA,
            pipelineB: this.pipelineB,
            currentPipeline: this.currentPipeline
        };
    }

    /**
     * Set pipeline state from serialization
     * @param {Object} state - Pipeline state object
     */
    setPipelineState(state) {
        if (state.pipelineA) {
            this.pipelineA = state.pipelineA;
        }
        if (state.pipelineB) {
            this.pipelineB = state.pipelineB;
        }
        if (state.currentPipeline) {
            this.setCurrentPipeline(state.currentPipeline);
        } else {
            this.pipeline = this.pipelineA; // Default to A
        }
    }
    /**
     * Initialize audio system (without AudioWorklet)
     * This is the first phase of audio initialization that can happen before GUI is fully rendered
     * @param {Object|null} audioPreferences - Preferences already selected for this reset
     * @returns {Promise<string>} - Empty string on success, error message on failure
     */
    async initAudio(audioPreferences = null) {
        try {
            const isElectron = !!(window.electronAPI ||
                window.electronIntegration?.isElectron ||
                window.electronIntegration?.isElectronEnvironment?.());
            // Initialize audio context (without AudioWorklet)
            const contextResult = await this.contextManager.initAudioContext(audioPreferences);
            if (contextResult) {
                return contextResult;
            }
            
            // Initialize audio input. Layout mode must never affect the audio
            // path: mobile and desktop both request the input device here (a
            // denied permission falls back to the silent source inside
            // initAudioInput).
            const inputResult = audioPreferences
                ? await this.ioManager.initAudioInput(audioPreferences)
                : await this.ioManager.initAudioInput();
            // No need to log input result
            
            // Initialize audio output
            const outputResult = await this.ioManager.initAudioOutput();
            if (outputResult) {
                return outputResult;
            }
            // Note: We don't build the pipeline here anymore
            // That will be done in initializeAudioWorklet after GUI is fully rendered
            
            // Resume context if suspended. On the web the context may
            // legitimately stay suspended until a user gesture (autoplay
            // policy), and resumeAudioContext() would block startup for its
            // full timeout — attempt it without awaiting there; the gesture
            // hook and the playback path resume it later.
            if (isElectron) {
                await this.contextManager.resumeAudioContext();
            } else if (this.powerPolicyController?.started &&
                typeof this.contextManager.resumeForPowerPolicy === 'function') {
                this.contextManager.resumeForPowerPolicy('unexpected-recovery').catch(() => {});
            } else {
                this.contextManager.resumeAudioContext().catch(() => {});
            }
            
            // Update exposed properties for backward compatibility
            // Note: workletNode will be null at this point
            this.updateExposedProperties();
            
            // Return any input error (like microphone access denied)
            // This allows the app to continue with file playback even if mic access is denied
            return inputResult || '';
        } catch (error) {
            return `Audio Error: ${error.message}`;
        }
    }

    /**
     * Initialize AudioWorklet and create worklet node
     * This is the second phase of audio initialization that happens after GUI is fully rendered
     * @returns {Promise<string>} - Empty string on success, error message on failure
     */
    async initializeAudioWorklet() {
        try {
            // WASM is optional. Bound its load so startup can fall back to the
            // JavaScript path instead of waiting indefinitely.
            let dspLoadTimer = null;
            const dspModulePromise = Promise.race([
                Promise.resolve().then(() => this.loadDspForWorklet()),
                new Promise(resolve => {
                    dspLoadTimer = setTimeout(() => resolve(null), DSP_MODULE_LOAD_TIMEOUT_MS);
                })
            ])
                .catch(error => {
                    console.warn(
                        `[dsp-wasm] Load failed: ${error?.message || String(error)}; ` +
                        'continuing with JavaScript DSP.'
                    );
                    return null;
                })
                .finally(() => {
                    if (dspLoadTimer !== null) clearTimeout(dspLoadTimer);
                });
            // Load AudioWorklet and create worklet node
            const workletResult = await this.contextManager.loadAudioWorklet();
            if (workletResult) {
                return workletResult;
            }
            
            // Update exposed properties for backward compatibility
            this.updateExposedProperties();
            this._primaryWorkletEpoch++;
            this._advanceAudioGraphGeneration();

            // A recreated AudioWorklet starts with an empty processor registry.
            // Existing plugin instances do not run their constructors again, so
            // their processor code must be sent before any updatePlugins message.
            this.registerPipelineProcessors();
            
            // Setup worklet message handler
            if (this.workletNode) {
                const sourceWorkletNode = this.workletNode;
                this.telemetryHub.setPort(sourceWorkletNode.port);
                sourceWorkletNode.port.onmessage = event => this.handleWorkletMessage(event, sourceWorkletNode);
            }
            this._pruneInactiveDspWorklets();
            this.dspModuleInfo = null;
            this.dspCapabilities = null;
            window.dspCapabilities = undefined;

            const workletNode = this.workletNode;
            const workletEpoch = this._primaryWorkletEpoch;
            void this._requestDspModuleLoad({
                primaryWorklet: workletNode,
                primaryEpoch: workletEpoch,
                loadPromise: dspModulePromise,
                startupFailureLabel: 'Worklet startup failed',
                // App and _doReset keep the new output gain at zero until this
                // request settles.
                muteOutput: false
            });
            
            return '';
        } catch (error) {
            return `Audio Error: ${error.message}`;
        }
    }

    async loadDspForWorklet() {
        const pathname = window.location?.pathname || '';
        const basePath = pathname.substring(0, pathname.lastIndexOf('/'));
        const preference = window.audioPreferences || window.electronIntegration?.audioPreferences || {};
        const rollout = getDspRolloutConfig({ preference, location: window.location });
        if (rollout.forceOff || preference.useWasmDsp === false) return null;
        return loadDspModule({ basePath });
    }

    getEnabledDspTypes(preferenceOverride = null) {
        if (!this.dspModuleInfo) return [];
        const preference = preferenceOverride ||
            window.audioPreferences || window.electronIntegration?.audioPreferences || {};
        return getDspRolloutConfig({
            meta: this.dspModuleInfo.meta,
            paramPackers: this.dspModuleInfo.paramPackers,
            preference,
            location: window.location
        }).enabledTypes;
    }

    _getPrimaryWorkletNode() {
        return this.contextManager?.workletNode || this.workletNode || null;
    }

    _isDspModuleLoadRequestCurrent(request) {
        return this._dspModuleLoadRequest === request &&
            this._getPrimaryWorkletNode() === request.primaryWorklet &&
            this._primaryWorkletEpoch === request.primaryEpoch;
    }

    _requestDspModuleLoad(options = {}) {
        const primaryWorklet = options.primaryWorklet ?? this._getPrimaryWorkletNode();
        const primaryEpoch = options.primaryEpoch ?? this._primaryWorkletEpoch;
        if (!primaryWorklet?.port) return Promise.resolve(false);

        const activeRequest = this._dspModuleLoadRequest;
        if (activeRequest && !activeRequest.settled &&
            activeRequest.primaryWorklet === primaryWorklet &&
            activeRequest.primaryEpoch === primaryEpoch) {
            return activeRequest.promise;
        }

        const request = {
            id: ++this._dspModuleLoadRequestSequence,
            primaryWorklet,
            primaryEpoch,
            settled: false,
            promise: null
        };
        const loadPromise = options.loadPromise ?? Promise.resolve().then(() => this.loadDspForWorklet());
        const failureLabel = options.failureLabel || 'Preference reload failed';
        const startupFailureLabel = options.startupFailureLabel || 'Worklet startup failed';
        const muteOutput = options.muteOutput !== false;
        const completion = Promise.resolve(loadPromise).then(async info => {
            if (!this._isDspModuleLoadRequestCurrent(request)) return false;
            if (!info) {
                this._completeParallelDspWithoutModule();
                return false;
            }
            this.dspModuleInfo = info;
            try {
                const workletNodes = [...this._getActiveDspWorklets()];
                if (workletNodes.length === 0) return false;
                const targetTypes = this.getEnabledDspTypes();
                const results = await Promise.all(workletNodes.map(workletNode =>
                    this._reinitializeDspWorklet(workletNode, targetTypes, { muteOutput })
                ));
                return results.every(Boolean);
            } catch (error) {
                console.warn(
                    `[dsp-wasm] ${startupFailureLabel}: ${error?.message || String(error)}; ` +
                    'continuing with JavaScript DSP.'
                );
                this._completeParallelDspWithoutModule();
                return false;
            }
        }).catch(error => {
            if (!this._isDspModuleLoadRequestCurrent(request)) return false;
            console.warn(`[dsp-wasm] ${failureLabel}: ${error?.message || String(error)}`);
            this._completeParallelDspWithoutModule();
            return false;
        }).finally(() => {
            request.settled = true;
            if (this._dspModuleLoadRequest === request) {
                this._dspModuleLoadRequest = null;
                this._dspModuleLoadPromise = null;
            }
        });
        request.promise = completion;
        this._dspModuleLoadRequest = request;
        this._dspModuleLoadPromise = completion;
        return completion;
    }

    async waitForDspActivationBeforeOutput() {
        const pending = this._dspModuleLoadPromise;
        if (!pending) return false;
        return (await pending) === true;
    }

    _invalidateDspModuleLoadRequest() {
        this._dspModuleLoadRequest = null;
        this._dspModuleLoadPromise = null;
    }

    _getActiveDspWorklets() {
        const nodes = new Set();
        const primary = this._getPrimaryWorkletNode();
        if (primary?.port) nodes.add(primary);
        if ((this._parallelActive || this._parallelPreparing) && this._parallelWorkletB?.port) {
            nodes.add(this._parallelWorkletB);
        }
        return nodes;
    }

    // DSP initialization must see a preparing branch, while power and staged
    // activation proofs may include it only after its downstream route is live.
    _getActivePowerWorklets() {
        const nodes = new Set();
        const primary = this._getPrimaryWorkletNode();
        if (primary?.port) nodes.add(primary);
        if (this._parallelActive && this._parallelWorkletB?.port) {
            nodes.add(this._parallelWorkletB);
        }
        return nodes;
    }

    _isActiveDspWorklet(workletNode) {
        return !!workletNode && this._getActiveDspWorklets().has(workletNode);
    }

    _isActivePowerWorklet(workletNode) {
        return !!workletNode && this._getActivePowerWorklets().has(workletNode);
    }

    _nextDspReadyToken(workletNode) {
        const token = (this._dspReadyTokens?.get(workletNode) || 0) + 1;
        this._dspReadyTokens.set(workletNode, token);
        return token;
    }

    _completeDspActivationRequest(workletNode, result) {
        const request = this._pendingDspActivationRequests?.get(workletNode);
        if (!request) return;
        if (request.timer !== null) clearTimeout(request.timer);
        this._pendingDspActivationRequests.delete(workletNode);
        request.resolve(result);
    }

    _invalidateDspReadyState(workletNode) {
        if (!workletNode) return;
        this._nextDspReadyToken(workletNode);
        this._completeDspActivationRequest(workletNode, false);
    }

    _reinitializeDspWorklet(workletNode, targetTypes, { muteOutput = true } = {}) {
        if (!workletNode?.port || !this.dspModuleInfo) return Promise.resolve(false);
        this._completeDspActivationRequest(workletNode, false);
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        const posted = this.startDspOnWorklet(workletNode);
        if (!posted) {
            resolve(false);
            return promise;
        }
        const request = {
            token: this._dspReadyTokens.get(workletNode),
            targetTypes: [...targetTypes],
            muteOutput,
            timer: null,
            resolve,
            promise
        };
        request.timer = setTimeout(() => {
            if (this._pendingDspActivationRequests.get(workletNode) !== request) return;
            this._handleDspReadyTimeout(workletNode);
        }, DSP_MODULE_READY_TIMEOUT_MS + DSP_BYTES_READY_TIMEOUT_MS);
        this._pendingDspActivationRequests.set(workletNode, request);
        return promise;
    }

    _advanceAudioGraphGeneration() {
        this._audioGraphGeneration = (this._audioGraphGeneration || 0) + 1;
        const barrier = this._parallelDspBarrier;
        if (barrier && !barrier.settled) {
            barrier.settled = true;
            barrier.mode = 'cancelled';
            if (barrier.timer !== null) clearTimeout(barrier.timer);
            barrier.timer = null;
            barrier.resolve('cancelled');
        }
        this._parallelDspBarrier = null;
        this._advancePowerWorkletGraphGeneration();
        return this._audioGraphGeneration;
    }

    _advancePowerWorkletGraphGeneration() {
        this._topologyRevision = (this._topologyRevision || 0) + 1;
        this._workletGraphGeneration = (this._workletGraphGeneration || 0) + 1;
        this.powerPolicyController?.handleWorkletGraphReplacement?.({
            topologyRevision: this._topologyRevision,
            workletGraphGeneration: this._workletGraphGeneration
        });
        return this._workletGraphGeneration;
    }

    getPowerWorkletGraphGeneration() {
        return this._workletGraphGeneration;
    }

    getPowerTopologyRevision() {
        return this._topologyRevision;
    }

    getActivePowerWorklets() {
        return [...this._getActivePowerWorklets()];
    }

    broadcastToActiveWorklets(message) {
        for (const node of this._getActivePowerWorklets()) {
            node?.port?.postMessage?.(message);
        }
    }

    /**
     * Apply one logical same-node topology mutation to every live worklet and
     * advance the power-policy topology identity exactly once.
     * @param {Object} message - Worklet mutation message
     * @param {Object} options - Mutation metadata
     * @returns {{ mutation: Object|null, postedNodeCount: number }} Commit result
     */
    commitPowerTopologyMutation(message, { reason = 'pipeline-topology-update' } = {}) {
        if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
            throw new TypeError('A topology mutation worklet message is required');
        }

        // Any parameter, routing, ordering, enable, or bypass change invalidates
        // a proof derived from the previous immutable topology immediately.
        this._structuralZeroOutputProof = null;

        // Pipeline-content mutations target the primary worklet only: during a
        // Double Blind Test the parallel worklet B keeps its own dedicated
        // pipeline (posted via _postBlindPlugins) and must not be overwritten
        // by UI-driven sync. Power/config commands still reach every live worklet.
        let targetNodes;
        if (PIPELINE_CONTENT_MUTATION_TYPES.has(message.type)) {
            const primary = this._getPrimaryWorkletNode();
            targetNodes = primary?.port ? [primary] : [];
        } else {
            targetNodes = this._getActiveDspWorklets();
        }

        let postedNodeCount = 0;
        let firstPostError = null;
        for (const node of targetNodes) {
            try {
                node.port.postMessage(message);
                postedNodeCount++;
            } catch (error) {
                firstPostError ??= error;
            }
        }

        // Worklets invalidate their local skip state when the mutation message
        // arrives. Commit the new revision afterwards so the controller's new
        // power configuration is derived from, and follows, that mutation.
        const mutation = this.powerPolicyController?.notifyTopologyChanged?.(reason, {
            // Every message committed through this method is handled by the
            // worklet as a processing mutation and clears its local skip state.
            // Clear the matching controller lineage in the same transaction.
            resetWorkletTemporalState: true
        }) ?? null;
        if (firstPostError) throw firstPostError;
        return { mutation, postedNodeCount };
    }

    incrementPowerDiagnostic(key, delta = 1) {
        return this.powerDiagnostics.increment(key, delta);
    }

    getPowerDiagnostics() {
        return this.powerDiagnostics.getSnapshot();
    }

    getPowerSnapshot() {
        return this.powerPolicyController?.getSnapshot?.() || null;
    }

    setPlayerPowerUiEnabled(enabled) {
        window.uiManager?.audioPlayer?.ui?.setPowerUiEnabled?.(enabled);
    }

    getPowerChannelFanInBound() {
        const channels = this.audioContext?.destination?.channelCount || 1;
        return Number.isInteger(channels) && channels > 0 ? channels : 1;
    }

    getPowerGraphAmplitudeBound(pipeline = this.getCurrentPipeline()) {
        const physicalOutputCount = this.audioContext?.destination?.channelCount || 1;
        const outputGainValue = this.ioManager?.outputGainNode?.gain?.value;
        const outputGainUpperBound = Number.isFinite(outputGainValue) && outputGainValue > 1
            ? outputGainValue
            : 1;
        return computeRuntimePipelineGraphBound({
            plugins: pipeline,
            masterBypass: this.masterBypass === true,
            outputGainUpperBound,
            physicalOutputCount: Number.isSafeInteger(physicalOutputCount) &&
                physicalOutputCount > 0 ? physicalOutputCount : 1
        });
    }

    getStructuralZeroOutputProof() {
        return this._structuralZeroOutputProof || null;
    }

    adoptPowerMutation(mutation) {
        this._lastPowerMutation = mutation;
        this._topologyRevision = mutation.receipt.afterTokens.topologyRevision;
        this._workletGraphGeneration = mutation.receipt.afterTokens.workletGraphGeneration;
        this.updateExposedProperties();
    }

    async startPowerPolicyController() {
        return this.powerPolicyController?.start?.();
    }

    async updatePowerSettings(partialPowerSaving = {}) {
        if (!window.electronAPI) {
            return saveWebPowerSavingSettings(partialPowerSaving, {
                applyPowerSettings: settings => this.applyPersistedPowerSettings(settings)
            });
        }

        const current = window.appConfig?.powerSaving || this.powerPolicyController?.settings || {};
        const powerSaving = mergePowerSavingSettings(current, partialPowerSaving);
        window.appConfig = { ...(window.appConfig || {}), powerSaving };
        await this.applyPersistedPowerSettings(powerSaving);
        return powerSaving;
    }

    async applyPersistedPowerSettings(powerSaving) {
        const normalized = mergePowerSavingSettings({}, powerSaving);
        await this.powerPolicyController?.updateSettings?.(normalized);
        return normalized;
    }

    _pruneInactiveDspWorklets() {
        const active = this._getActiveDspWorklets();
        if (this._dspReadyFallbacks instanceof Map) {
            for (const workletNode of this._dspReadyFallbacks.keys()) {
                if (!active.has(workletNode)) this.clearDspReadyFallback(workletNode);
            }
        }
        if (this._dspCapabilitiesByNode instanceof Map) {
            for (const workletNode of this._dspCapabilitiesByNode.keys()) {
                if (!active.has(workletNode)) this._dspCapabilitiesByNode.delete(workletNode);
            }
        }
        if (this._dspReadyTokens instanceof Map) {
            for (const workletNode of this._dspReadyTokens.keys()) {
                if (!active.has(workletNode)) this._dspReadyTokens.delete(workletNode);
            }
        }
        if (this._pendingDspActivationRequests instanceof Map) {
            for (const workletNode of this._pendingDspActivationRequests.keys()) {
                if (!active.has(workletNode)) this._completeDspActivationRequest(workletNode, false);
            }
        }
    }

    startDspOnActiveWorklets() {
        let posted = false;
        let firstError = null;
        for (const workletNode of this._getActiveDspWorklets()) {
            if (this._parallelPreparing && workletNode === this._getPrimaryWorkletNode() &&
                this._dspCapabilitiesByNode?.has(workletNode)) {
                continue;
            }
            try {
                posted = this.startDspOnWorklet(workletNode) || posted;
            } catch (error) {
                firstError ??= error;
            }
        }
        if (firstError) throw firstError;
        return posted;
    }

    _waitForDspTransition(seconds) {
        return waitForPipelineSwitch(seconds);
    }

    _applyDspReadyPipeline(workletNode, enabledTypes = this.getEnabledDspTypes()) {
        workletNode.port.postMessage({
            type: 'dspEnableTypes',
            types: enabledTypes
        });
        if (this._parallelActive) {
            if (workletNode === this._getPrimaryWorkletNode()) {
                this._postBlindPlugins(workletNode, this.pipelineA);
                return;
            }
            if (workletNode === this._parallelWorkletB) {
                this._postBlindPlugins(workletNode, this.pipelineB || []);
                return;
            }
        }

        const plugins = this.pipelineProcessor.prepareSectionAwarePluginData();
        workletNode.port.postMessage({
            type: 'updatePlugins',
            plugins,
            masterBypass: this.masterBypass
        });
    }

    _isDspTransitionSnapshotCurrent(snapshot) {
        if (this._audioGraphGeneration !== snapshot.generation ||
            (this.contextManager?.audioContext || null) !== snapshot.context ||
            (this.ioManager?.outputGainNode || null) !== snapshot.outputGainNode) {
            return false;
        }
        for (const workletNode of snapshot.workletNodes) {
            if (!this._isActiveDspWorklet(workletNode)) return false;
        }
        return true;
    }

    _runDspOutputTransition(
        workletNodes,
        apply,
        generation = this._audioGraphGeneration,
        { muteOutput = true } = {}
    ) {
        const snapshot = {
            generation,
            context: this.contextManager?.audioContext || null,
            outputGainNode: this.ioManager?.outputGainNode || null,
            workletNodes: new Set([...workletNodes].filter(node => node?.port))
        };
        const previous = this._dspReadyTransitionPromise && this._dspTransitionGeneration === generation
            ? this._dspReadyTransitionPromise
            : null;
        let transitionPromise;
        const execute = async () => {
            if (previous) {
                await previous;
                if (!this._isDspTransitionSnapshotCurrent(snapshot)) return false;
            } else if (!muteOutput) {
                // Defer publication by one microtask so a synchronous fatal-DSP
                // notification or graph replacement can invalidate this candidate.
                await Promise.resolve();
            }
            if (!this._isDspTransitionSnapshotCurrent(snapshot)) return false;

            // Startup can publish a prepared backend while the output is still
            // private. Runtime backend changes retain the bounded mute because
            // JS and WASM do not share stateful plugin memory.
            const useOutputTransition = muteOutput === true &&
                !!(snapshot.context && snapshot.outputGainNode);
            let faded = false;
            let fadeToken = null;
            try {
                if (useOutputTransition) {
                    fadeToken = this.fadeOutOutput(PIPELINE_SWITCH_FADE_SECONDS);
                    faded = true;
                    await this._waitForDspTransition(PIPELINE_SWITCH_FADE_SECONDS);
                    if (!this._isDspTransitionSnapshotCurrent(snapshot)) return false;
                }

                const applied = await apply(snapshot);
                if (!this._isDspTransitionSnapshotCurrent(snapshot) || applied === false) return false;

                if (useOutputTransition) {
                    await this._waitForDspTransition(PIPELINE_SWITCH_SILENCE_SECONDS);
                    if (!this._isDspTransitionSnapshotCurrent(snapshot)) return false;
                }
                return true;
            } finally {
                if (faded && this._isDspTransitionSnapshotCurrent(snapshot)) {
                    this.fadeInOutputForToken(fadeToken, PIPELINE_SWITCH_FADE_SECONDS);
                }
            }
        };
        transitionPromise = execute().catch(error => {
            console.warn(`[dsp-wasm] DSP transition failed: ${error?.message || String(error)}`);
            return false;
        });
        this._dspReadyTransitionPromise = transitionPromise;
        this._dspTransitionGeneration = generation;
        const clearIfCurrent = () => {
            if (this._dspReadyTransitionPromise === transitionPromise) {
                this._dspReadyTransitionPromise = null;
                this._dspTransitionGeneration = -1;
            }
        };
        transitionPromise.then(clearIfCurrent, clearIfCurrent);
        return transitionPromise;
    }

    _createParallelDspBarrier(workletNodes) {
        const previous = this._parallelDspBarrier;
        if (previous && !previous.settled) {
            previous.settled = true;
            previous.mode = 'cancelled';
            if (previous.timer !== null) clearTimeout(previous.timer);
            previous.timer = null;
            previous.resolve('cancelled');
        }
        let resolve;
        const barrier = {
            generation: this._audioGraphGeneration,
            workletNodes: new Set(workletNodes),
            ready: new Map(),
            readyTokens: new Map(),
            dispatchedReady: new Set(),
            settled: false,
            mode: 'pending',
            timer: null,
            requestVersion: 0,
            requestedMode: null,
            targetTypes: [],
            desiredTypes: null,
            activationPromise: null,
            promise: new Promise(done => { resolve = done; }),
            resolve
        };
        this._parallelDspBarrier = barrier;
        return barrier;
    }

    _isParallelDspBarrierCurrent(barrier) {
        return this._parallelDspBarrier === barrier &&
            this._audioGraphGeneration === barrier.generation &&
            (this._parallelPreparing || this._parallelActive);
    }

    _armParallelDspBarrierTimeout(barrier) {
        if (!this._isParallelDspBarrierCurrent(barrier) || barrier.settled || barrier.timer !== null) return;
        barrier.timer = setTimeout(() => {
            barrier.timer = null;
            if (!this._isParallelDspBarrierCurrent(barrier) || barrier.settled) return;
            console.warn('[dsp-wasm] Parallel worklets did not become ready together; using JavaScript DSP.');
            this._finalizeParallelDspBarrier(barrier, [], 'js');
        }, DSP_MODULE_READY_TIMEOUT_MS + DSP_BYTES_READY_TIMEOUT_MS);
    }

    _settleParallelDspBarrier(barrier, mode) {
        if (barrier.timer !== null) clearTimeout(barrier.timer);
        barrier.timer = null;
        barrier.mode = mode;
        if (!barrier.settled) {
            barrier.settled = true;
            barrier.resolve(mode);
        }
    }

    _finalizeParallelDspBarrier(barrier, targetTypes, mode) {
        if (!this._isParallelDspBarrierCurrent(barrier)) {
            this._settleParallelDspBarrier(barrier, 'cancelled');
            return Promise.resolve(false);
        }
        barrier.targetTypes = [...targetTypes];
        barrier.requestedMode = mode;
        barrier.requestVersion++;
        if (barrier.activationPromise) return barrier.activationPromise;

        const startTransition = () => {
            let appliedRequest = null;
            const transition = this._runDspOutputTransition(
                barrier.workletNodes,
                () => {
                    if (!this._isParallelDspBarrierCurrent(barrier)) return false;
                    appliedRequest = {
                        version: barrier.requestVersion,
                        mode: barrier.requestedMode,
                        targetTypes: [...barrier.targetTypes]
                    };
                    if (appliedRequest.targetTypes.length > 0) {
                        for (const workletNode of barrier.workletNodes) {
                            const readyData = barrier.ready.get(workletNode);
                            if (!readyData || this._dspCapabilitiesByNode?.get(workletNode) !== readyData ||
                                (this._dspReadyTokens?.get(workletNode) || 0) !==
                                    barrier.readyTokens.get(workletNode)) {
                                return false;
                            }
                        }
                    }
                    const [workletA, workletB] = barrier.workletNodes;
                    for (const workletNode of barrier.workletNodes) {
                        workletNode.port.postMessage({ type: 'dspEnableTypes', types: [] });
                    }
                    this._postBlindPlugins(workletA, this.pipelineA);
                    this._postBlindPlugins(workletB, this.pipelineB || []);
                    if (appliedRequest.targetTypes.length > 0) {
                        for (const workletNode of barrier.workletNodes) {
                            workletNode.port.postMessage({
                                type: 'dspEnableTypes',
                                types: appliedRequest.targetTypes
                            });
                        }
                        this._postBlindPlugins(workletA, this.pipelineA);
                        this._postBlindPlugins(workletB, this.pipelineB || []);
                    }
                    if (!this._applyParallelRouting()) return false;
                    return true;
                },
                barrier.generation
            ).then(applied => {
                barrier.activationPromise = null;
                if (!applied || !this._isParallelDspBarrierCurrent(barrier)) {
                    this._settleParallelDspBarrier(barrier, 'cancelled');
                    return false;
                }
                if (!appliedRequest || appliedRequest.version !== barrier.requestVersion) {
                    return startTransition();
                }
                this._parallelPreparing = false;
                this._parallelActive = true;
                this._advancePowerWorkletGraphGeneration();
                for (const [node, readyData] of barrier.ready) {
                    if (barrier.dispatchedReady.has(node)) continue;
                    barrier.dispatchedReady.add(node);
                    this.dispatchEvent('dspReady', readyData);
                }
                for (const workletNode of barrier.workletNodes) {
                    this.clearDspReadyFallback(workletNode);
                }
                this._settleParallelDspBarrier(barrier, appliedRequest.mode);
                return true;
            });
            barrier.activationPromise = transition;
            return transition;
        };
        return startTransition();
    }

    _completeParallelDspWithoutModule() {
        const barrier = this._parallelDspBarrier;
        if (!barrier || barrier.settled || !this._isParallelDspBarrierCurrent(barrier)) return;
        this._finalizeParallelDspBarrier(barrier, [], 'js');
    }

    _handleParallelDspReady(workletNode, data, token) {
        let barrier = this._parallelDspBarrier;
        if (!barrier && (this._parallelPreparing || this._parallelActive)) {
            barrier = this._createParallelDspBarrier(this._getActiveDspWorklets());
        }
        if (!barrier || !this._isParallelDspBarrierCurrent(barrier) ||
            !barrier.workletNodes.has(workletNode)) return false;

        if (barrier.settled) {
            if (barrier.mode === 'js') {
                workletNode.port.postMessage({ type: 'dspEnableTypes', types: [] });
                if (!barrier.dispatchedReady.has(workletNode)) {
                    barrier.dispatchedReady.add(workletNode);
                    this.dispatchEvent('dspReady', data);
                }
            } else if (barrier.mode === 'wasm') {
                const replacement = this._createParallelDspBarrier(this._getActiveDspWorklets());
                for (const node of replacement.workletNodes) {
                    const capabilities = this._dspCapabilitiesByNode?.get(node);
                    if (!capabilities) continue;
                    replacement.ready.set(node, capabilities);
                    replacement.readyTokens.set(node, this._dspReadyTokens?.get(node) || 0);
                    if (node !== workletNode) replacement.dispatchedReady.add(node);
                }
                const allReady = [...replacement.workletNodes].every(node => replacement.ready.has(node));
                if (allReady) {
                    const targetTypes = this.getEnabledDspTypes();
                    this._finalizeParallelDspBarrier(
                        replacement,
                        targetTypes,
                        targetTypes.length > 0 ? 'wasm' : 'js'
                    );
                } else {
                    this._armParallelDspBarrierTimeout(replacement);
                }
            }
            return true;
        }
        barrier.ready.set(workletNode, data);
        barrier.readyTokens.set(workletNode, token);
        const allReady = [...barrier.workletNodes].every(node => barrier.ready.has(node));
        if (allReady) {
            const targetTypes = barrier.desiredTypes ?? this.getEnabledDspTypes();
            this._finalizeParallelDspBarrier(
                barrier,
                targetTypes,
                targetTypes.length > 0 ? 'wasm' : 'js'
            );
        }
        return true;
    }

    _queueDspReadyTransition(workletNode, data, options = {}) {
        if (!this._isActiveDspWorklet(workletNode)) return Promise.resolve(false);
        const token = options.token ?? this._dspReadyTokens?.get(workletNode) ?? 0;
        if (this._parallelPreparing || this._parallelActive) {
            if (this._handleParallelDspReady(workletNode, data, token)) {
                const barrierPromise = this._parallelDspBarrier?.promise;
                return barrierPromise
                    ? barrierPromise.then(mode => mode === 'wasm')
                    : Promise.resolve(true);
            }
        }
        return this._runDspOutputTransition(
            [workletNode],
            () => {
                if (!this._isActiveDspWorklet(workletNode) ||
                    (this._dspReadyTokens?.get(workletNode) || 0) !== token ||
                    this._dspCapabilitiesByNode?.get(workletNode) !== data) return false;
                this._applyDspReadyPipeline(workletNode, options.enabledTypes ?? this.getEnabledDspTypes());
                this.dispatchEvent('dspReady', data);
                return true;
            },
            this._audioGraphGeneration,
            { muteOutput: options.muteOutput !== false }
        );
    }

    postDspModuleToWorklet(workletNode) {
        if (!workletNode?.port || !this.dspModuleInfo) return false;
        const info = this.dspModuleInfo;
        let modulePosted = false;
        if (info.module && info.moduleCloneable !== false) {
            try {
                workletNode.port.postMessage({ type: 'dspModule', module: info.module, simd: info.simd });
                modulePosted = true;
            } catch (error) {
                if (error?.name !== 'DataCloneError') throw error;
                info.moduleCloneable = false;
            }
        }
        if (!modulePosted) {
            if (!(info.bytes instanceof ArrayBuffer)) return false;
            workletNode.port.postMessage({
                type: 'dspModule',
                bytes: info.bytes.slice(0),
                simd: info.simd
            });
        }
        // Keep the freshly initialized engine inactive until the main thread
        // can publish it within the private startup graph or a protected
        // runtime transition.
        workletNode.port.postMessage({ type: 'dspEnableTypes', types: [] });
        workletNode.port.postMessage({ type: 'dspSetTelemetryRate', hz: globalThis.document?.hidden ? 15 : 60 });
        return true;
    }

    startDspOnWorklet(workletNode) {
        if (!(this._dspCapabilitiesByNode instanceof Map)) {
            this._dspCapabilitiesByNode = new Map();
        }
        this._nextDspReadyToken(workletNode);
        this._dspCapabilitiesByNode.delete(workletNode);
        if (workletNode === this._getPrimaryWorkletNode()) {
            this.dspCapabilities = null;
            window.dspCapabilities = undefined;
        }
        const posted = this.postDspModuleToWorklet(workletNode);
        if (posted) this.armDspReadyFallback(workletNode);
        return posted;
    }

    clearDspReadyFallback(workletNode = null) {
        if (!(this._dspReadyFallbacks instanceof Map)) {
            this._dspReadyFallbacks = new Map();
            return;
        }
        const nodes = workletNode ? [workletNode] : [...this._dspReadyFallbacks.keys()];
        for (const node of nodes) {
            const state = this._dspReadyFallbacks.get(node);
            if (!state) continue;
            if (state.moduleTimer !== null) clearTimeout(state.moduleTimer);
            if (state.failureTimer !== null) clearTimeout(state.failureTimer);
            this._dspReadyFallbacks.delete(node);
        }
    }

    armDspReadyFallback(workletNode) {
        this.clearDspReadyFallback(workletNode);
        const info = this.dspModuleInfo;
        if (!workletNode?.port || !info || !(info.bytes instanceof ArrayBuffer)) return;

        const state = { info, moduleTimer: null, failureTimer: null };
        this._dspReadyFallbacks.set(workletNode, state);
        const scheduleBytesFailure = () => {
            state.failureTimer = setTimeout(() => {
                state.failureTimer = null;
                if (this._dspReadyFallbacks.get(workletNode) !== state ||
                    this._dspCapabilitiesByNode?.has(workletNode)) return;
                this._dspReadyFallbacks.delete(workletNode);
                console.warn('[dsp-wasm] Worklet did not acknowledge the bytes payload; continuing with JavaScript DSP.');
                this._handleDspReadyTimeout(workletNode);
            }, DSP_BYTES_READY_TIMEOUT_MS);
        };
        if (!info.module || info.moduleCloneable === false) {
            scheduleBytesFailure();
            return;
        }
        state.moduleTimer = setTimeout(() => {
            state.moduleTimer = null;
            if (this._dspReadyFallbacks.get(workletNode) !== state ||
                this._dspCapabilitiesByNode?.has(workletNode) || this.dspModuleInfo !== info) {
                return;
            }
            info.moduleCloneable = false;
            console.info('[dsp-wasm] Worklet did not acknowledge the compiled module; using bytes for this session.');
            try {
                workletNode.port.postMessage({
                    type: 'dspModule',
                    bytes: info.bytes.slice(0),
                    simd: info.simd
                });
                workletNode.port.postMessage({ type: 'dspEnableTypes', types: [] });
            } catch (error) {
                this._dspReadyFallbacks.delete(workletNode);
                console.warn(`[dsp-wasm] Worklet bytes retry failed: ${error?.message || String(error)}`);
                return;
            }
            scheduleBytesFailure();
        }, DSP_MODULE_READY_TIMEOUT_MS);
    }

    _handleDspReadyTimeout(workletNode) {
        this._completeDspActivationRequest(workletNode, false);
        this.dspModuleInfo = null;
        const barrier = this._parallelDspBarrier;
        if (!barrier || barrier.settled || !this._isParallelDspBarrierCurrent(barrier) ||
            !barrier.workletNodes.has(workletNode)) return;
        this._finalizeParallelDspBarrier(barrier, [], 'js');
    }

    updateDspTelemetryRate() {
        const hz = globalThis.document?.hidden ? 15 : 60;
        const nodes = new Set([
            this.contextManager?.workletNode,
            this.workletNode,
            this._parallelWorkletB
        ]);
        for (const node of nodes) {
            node?.port?.postMessage({ type: 'dspSetTelemetryRate', hz });
        }
    }

    _isFatalDspFailure(data) {
        return data?.stage === 'instantiate' || data?.stage === 'runtime' ||
            data?.stage === 'reconcile' || data?.stage === 'destroy';
    }

    _coordinateParallelDspFailure() {
        const barrier = this._parallelDspBarrier;
        if (!barrier || !this._isParallelDspBarrierCurrent(barrier)) return;
        this._finalizeParallelDspBarrier(barrier, [], 'js');
    }

    handleWorkletMessage(event, workletNode = this.workletNode) {
        const data = event?.data || {};
        if (!this._isActiveDspWorklet(workletNode)) return;
        if (data.type === 'powerStateAck' || data.type === 'powerObservation' ||
            data.type === 'powerFirstRender' || data.type === 'powerHeartbeat' ||
            data.type === 'temporalStatePrepared') {
            if (!this._isActivePowerWorklet(workletNode)) return;
            this.audioActivationCoordinator?.recordWorkletEvent?.(data, workletNode);
            this.powerPolicyController?.handleWorkletPowerEvent?.(data, workletNode);
        } else if (data.type === 'sleepModeChanged') {
            this.dispatchEvent('sleepModeChanged', {
                isSleepMode: data.isSleepMode,
                sampleRate: this.audioContext.sampleRate
            });
        } else if (data.type === 'processorMissing') {
            console.warn(`[AudioManager] Worklet reported missing processor for ${data.pluginType}; re-registering processors.`);
            this.registerPipelineProcessors();
            this.rebuildPipeline(false).catch(error => {
                console.error('[AudioManager] Failed to rebuild after missing processor report:', error);
            });
        } else if (data.type === 'dspReady') {
            this.clearDspReadyFallback(workletNode);
            if (!this.dspModuleInfo) {
                this._completeDspActivationRequest(workletNode, false);
                return;
            }
            if (!(this._dspCapabilitiesByNode instanceof Map)) {
                this._dspCapabilitiesByNode = new Map();
            }
            const token = this._dspReadyTokens?.get(workletNode) || 0;
            this._dspCapabilitiesByNode.set(workletNode, data);
            if (workletNode === this._getPrimaryWorkletNode()) {
                this.dspCapabilities = data;
                window.dspCapabilities = data;
            }
            console.info(
                `[dsp-wasm] Ready: ${Array.isArray(data.kernels) ? data.kernels.length : 0} kernels ` +
                `(${data.simd ? 'SIMD' : 'baseline'}).`
            );
            const activationRequest = this._pendingDspActivationRequests?.get(workletNode);
            const transition = this._queueDspReadyTransition(workletNode, data, {
                token,
                enabledTypes: activationRequest?.token === token
                    ? activationRequest.targetTypes
                    : undefined,
                muteOutput: activationRequest?.token === token
                    ? activationRequest.muteOutput
                    : true
            });
            if (activationRequest?.token === token) {
                void transition.then(result => {
                    if (this._pendingDspActivationRequests.get(workletNode) === activationRequest) {
                        this._completeDspActivationRequest(workletNode, result === true);
                    }
                });
            }
        } else if (data.type === 'dspFailed') {
            this.clearDspReadyFallback(workletNode);
            if (this._isFatalDspFailure(data)) {
                this._invalidateDspReadyState(workletNode);
                this._dspCapabilitiesByNode?.delete(workletNode);
                this._parallelDspBarrier?.ready.delete(workletNode);
                this._parallelDspBarrier?.readyTokens.delete(workletNode);
                if (workletNode === this._getPrimaryWorkletNode()) {
                    this.dspCapabilities = null;
                    window.dspCapabilities = undefined;
                }
            }
            if (this._parallelActive) {
                this.dispatchEvent('parallelInvalidated', {
                    reason: 'dspFailed',
                    restorePrimaryDsp: true,
                    failure: data
                });
                if (this._parallelActive) {
                    void Promise.resolve(this.disableParallelPipelines()).catch(() => {});
                }
            } else if (this._parallelPreparing) {
                this._coordinateParallelDspFailure();
            }
            console.warn(`[dsp-wasm] Worklet ${data.stage || 'runtime'} failure: ${data.error || 'unknown error'}`);
            workletNode?.port?.postMessage({ type: 'dspCleanupFailed' });
            this.dispatchEvent('dspFailed', data);
        } else if (data.type === 'dspLatency') {
            const samples = Number.isInteger(data.samples) && data.samples > 0 ? data.samples : 0;
            const sampleRate = typeof data.sampleRate === 'number' && data.sampleRate > 0
                ? data.sampleRate
                : this.audioContext?.sampleRate;
            this.dspPipelineLatencySamples = samples;
            if (samples > 0) {
                const milliseconds = sampleRate > 0 ? samples * 1000 / sampleRate : 0;
                console.info(
                    `[dsp-wasm] Pipeline latency: ${samples} samples (${milliseconds.toFixed(2)} ms); ` +
                    'delay compensation is not applied.'
                );
            }
            this.dispatchEvent('dspLatency', { ...data, samples, sampleRate });
        } else if (data.type === 'dspCleanupNeeded') {
            workletNode?.port?.postMessage({ type: 'dspCleanupFailed' });
        } else if (data.type === 'dspTelemetry') {
            this.telemetryHub.handleMessage(data);
        }
    }
    
    /**
     * Update properties exposed for backward compatibility
     */
    updateExposedProperties() {
        this.audioContext = this.contextManager.audioContext;
        this.stream = this.ioManager.inputStream || this.ioManager.stream;
        this.sourceNode = this.ioManager.sourceNode;
        this.workletNode = this.contextManager.workletNode;
        this.offlineContext = this.offlineProcessor.offlineContext;
        this.offlineWorkletNode = this.offlineProcessor.offlineWorkletNode;
        this.isOfflineProcessing = this.offlineProcessor.isOfflineProcessing;
        this.isCancelled = this.offlineProcessor.isCancelled;
        this._skipAudioInitDuringSampleRateChange = this.contextManager.getSkipAudioInitDuringSampleRateChange();
        this.isFirstLaunch = this.contextManager.isFirstLaunch;
        
        // Update global references
        window.audioManager = this;
        window.pipeline = this.pipeline;
        
        // Update pipeline in pipelineProcessor
        this.pipelineProcessor.setPipeline(this.pipeline);
        this.pipelineProcessor.setMasterBypass(this.masterBypass);
        
        // Debug logging removed for production
    }

    /**
     * Register processor functions for every plugin type currently present in
     * either A/B pipeline. AudioWorkletNode instances do not retain processors
     * across graph resets, while plugin instances are intentionally reused.
     * @param {Array|Object|null} pluginsOrPlugin - Optional plugin(s) to register.
     */
    registerPipelineProcessors(pluginsOrPlugin = null) {
        const workletNodes = [...this._getActiveDspWorklets()];
        if (workletNodes.length === 0) {
            const fallbackNode = this.contextManager?.workletNode || this.workletNode || window.workletNode;
            if (fallbackNode?.port) workletNodes.push(fallbackNode);
        }
        if (workletNodes.length === 0) return;

        const pipelines = pluginsOrPlugin
            ? [Array.isArray(pluginsOrPlugin) ? pluginsOrPlugin : [pluginsOrPlugin]]
            : [this.pipelineA, this.pipelineB, this.pipeline];
        const registeredTypes = new Set();

        for (const pipeline of pipelines) {
            if (!Array.isArray(pipeline)) continue;

            for (const plugin of pipeline) {
                if (!plugin?.constructor) continue;

                if (typeof plugin._setupMessageHandler === 'function') {
                    plugin._setupMessageHandler();
                }

                const pluginType = plugin.constructor.name;
                if (registeredTypes.has(pluginType)) continue;

                if (typeof plugin.processorString !== 'string' || plugin.processorString.length === 0) {
                    if (plugin.enabled !== false && pluginType !== 'SectionPlugin') {
                        console.warn(`[AudioManager] Processor string missing for ${pluginType}; plugin cannot be registered with the worklet.`);
                    }
                    continue;
                }

                for (const workletNode of workletNodes) {
                    workletNode.port.postMessage({
                        type: 'registerProcessor',
                        pluginType,
                        processor: plugin.processorString,
                        process: typeof plugin.process === 'function' ? plugin.process.toString() : ''
                    });
                }
                registeredTypes.add(pluginType);
            }
        }
    }
    
    /**
     * Rebuild the audio processing pipeline
     * @param {boolean} isInitializing - Whether this is the initial build
     * @returns {Promise<string>} - Empty string on success, error message on failure
     */
    async rebuildPipeline(isInitializing = false) {
        const releasePowerLease = this.powerPolicyController?.started
            ? this.powerPolicyController.acquireLease('pipeline-rebuild', { mode: 'force-active' })
            : null;
        try {
        // Propagate each Section's ON/OFF state to the inner plugins'
        // _sectionEnabled flag so analyzer redraw loops stay paused inside
        // OFF sections after preset/URL load, paste, undo and A<->B copy.
        // Per-plugin setEnabled() during deserialization can't do this on
        // its own because the section's children may not exist yet at that
        // point. Idempotent: _setSectionEnabled only acts on state change.
        if (!Array.isArray(this.pipeline)) {
            this.pipeline = [];
        }

        if (Array.isArray(this.pipeline)) {
            let sectionOn = true;
            for (let i = 0; i < this.pipeline.length; i++) {
                const p = this.pipeline[i];
                if (p && p.constructor && p.constructor.name === 'SectionPlugin') {
                    sectionOn = p.enabled !== false;
                } else if (p && typeof p._setSectionEnabled === 'function') {
                    p._setSectionEnabled(sectionOn);
                }
            }
        }

        // Make sure the pipeline is synchronized with the PipelineProcessor
        this.pipelineProcessor.setPipeline(this.pipeline);
        this.pipelineProcessor.setMasterBypass(this.masterBypass);
        
        // Update global reference
        window.pipeline = this.pipeline;

        // Ensure processor code exists in the current worklet before plugin
        // configs are posted by PipelineProcessor.rebuildPipeline().
        this.registerPipelineProcessors();
        
        const result = await this.pipelineProcessor.rebuildPipeline(isInitializing);
        this.updateExposedProperties();
        this.powerPolicyController?.notifyTopologyChanged?.('pipeline-rebuild', {
            resetWorkletTemporalState: true
        });

        // If a rebuild happens while the Double Blind Test is running its two
        // pipelines in parallel (e.g. an audio-device change), the standard
        // rebuild reconnects only the main worklet; re-establish the parallel
        // branches so the blind test keeps working.
        if (this._parallelActive && !this._applyParallelRouting()) {
            this.dispatchEvent('parallelInvalidated', {
                reason: 'pipeline-routing-failed',
                restorePrimaryDsp: true
            });
            await this.disableParallelPipelines();
            throw new Error('parallel-pipeline-routing-failed');
        }

            return result;
        } finally {
            releasePowerLease?.();
        }
    }
    
    _transitionDspConfiguration(workletNodes, targetTypes) {
        const nodes = new Set([...workletNodes].filter(node => node?.port));
        if (nodes.size === 0) return Promise.resolve(false);
        if (this._parallelPreparing || this._parallelActive) {
            let barrier = this._parallelDspBarrier;
            if (!barrier || !this._isParallelDspBarrierCurrent(barrier)) {
                barrier = this._createParallelDspBarrier(nodes);
            }
            barrier.desiredTypes = [...targetTypes];
            if (targetTypes.length > 0) {
                const missing = [...nodes].filter(node => !this._dspCapabilitiesByNode?.has(node));
                if (missing.length > 0) {
                    if (barrier.settled) {
                        barrier = this._createParallelDspBarrier(nodes);
                        barrier.desiredTypes = [...targetTypes];
                    }
                    for (const node of nodes) {
                        const capabilities = this._dspCapabilitiesByNode?.get(node);
                        if (capabilities) {
                            barrier.ready.set(node, capabilities);
                            barrier.readyTokens.set(node, this._dspReadyTokens?.get(node) || 0);
                            barrier.dispatchedReady.add(node);
                        }
                    }
                    for (const node of missing) {
                        if (!this._dspReadyFallbacks?.has(node)) this.startDspOnWorklet(node);
                    }
                    this._armParallelDspBarrierTimeout(barrier);
                    return barrier.promise;
                }
            }
            if (this._parallelPreparing && targetTypes.length > 0) {
                const allReady = [...barrier.workletNodes].every(node => barrier.ready.has(node));
                if (!allReady) {
                    this._armParallelDspBarrierTimeout(barrier);
                    return barrier.promise;
                }
            }
            for (const node of nodes) {
                const capabilities = this._dspCapabilitiesByNode?.get(node);
                if (!capabilities) continue;
                barrier.ready.set(node, capabilities);
                barrier.readyTokens.set(node, this._dspReadyTokens?.get(node) || 0);
                barrier.dispatchedReady.add(node);
            }
            return this._finalizeParallelDspBarrier(
                barrier,
                targetTypes,
                targetTypes.length > 0 ? 'wasm' : 'js'
            );
        }
        if (targetTypes.length > 0) {
            const missing = [...nodes].filter(node => !this._dspCapabilitiesByNode?.has(node));
            if (missing.length > 0) {
                return Promise.all(missing.map(node => this._reinitializeDspWorklet(node, targetTypes)))
                    .then(results => results.every(Boolean));
            }
        }
        return this._runDspOutputTransition(nodes, () => {
            for (const workletNode of nodes) {
                this._applyDspReadyPipeline(workletNode, targetTypes);
            }
            return true;
        });
    }

    /**
     * Update audio configuration in every active worklet node.
     * @param {Object} audioPreferences - Audio preferences object
     * @returns {Promise<boolean>|undefined} DSP transition result when applicable
     */
    updateAudioConfig(audioPreferences) {
        const nodes = this._getActiveDspWorklets();
        if (nodes.size === 0) return undefined;

        // Electron persists these settings and reloads the renderer. Keep the
        // current graph unchanged until the replacement graph is ready.
        if (window.electronAPI) return true;

        const outputChannels = audioPreferences.outputChannels || 2;
        this.commitPowerTopologyMutation({
            type: 'updateAudioConfig',
            outputChannels,
            lowLatencyMode: !!audioPreferences.lowLatencyOutput,
            ...(this.audioContext?.sampleRate !== undefined && {
                sampleRate: this.audioContext.sampleRate
            })
        }, { reason: 'audio-config-update' });
        if (this.dspModuleInfo) {
            return this._transitionDspConfiguration(
                nodes,
                this.getEnabledDspTypes(audioPreferences)
            );
        }
        if (audioPreferences.useWasmDsp !== true) return undefined;

        return this._requestDspModuleLoad();
    }

    /**
     * Reset the audio system
     * @param {Object} audioPreferences - Audio preferences to save
     * @returns {Promise<string>} - Empty string on success, error message on failure
     */
    async reset(audioPreferences = null) {
        if (this._resetInProgress) {
            const matchesPendingReset = this._hasPendingReset &&
                audioPreferencesEqual(audioPreferences, this._pendingResetPrefs);
            const matchesActiveReset = !this._hasPendingReset &&
                audioPreferencesEqual(audioPreferences, this._activeResetPrefs);
            if (matchesPendingReset || matchesActiveReset) {
                console.log('[AudioManager] reset coalesced — matching reset already pending');
                return '';
            }
            // Queue the latest prefs so we retry after current reset finishes.
            // Use a separate boolean flag so that audioPreferences === null is a
            // valid queued payload (not confused with "no queued reset").
            console.log('[AudioManager] reset queued — already in progress');
            this._pendingResetPrefs = audioPreferences;
            this._hasPendingReset = true;
            return '';
        }
        this._resetInProgress = true;
        const releasePowerLease = this.powerPolicyController?.started
            ? this.powerPolicyController.acquireLease('audio-reset', {
                mode: 'hold-current',
                scope: 'resource-mutation'
            })
            : null;
        this._hasPendingReset = false;
        this._pendingResetPrefs = null;
        try {
            let nextPreferences = audioPreferences;
            let resetResult = '';
            while (true) {
                this._activeResetPrefs = nextPreferences;
                resetResult = await this._executeReset(nextPreferences) || '';
                if (!this._hasPendingReset) break;
                nextPreferences = this._pendingResetPrefs;
                this._hasPendingReset = false;
                this._pendingResetPrefs = null;
                console.log('[AudioManager] running queued reset');
            }
            return resetResult;
        } finally {
            this._activeResetPrefs = null;
            this._resetInProgress = false;
            releasePowerLease?.();
        }
    }

    _canApplySilentWebInputInPlace(previousPreferences, nextPreferences) {
        return !window.electronAPI &&
            nextPreferences?.inputDeviceId === NO_AUDIO_INPUT_DEVICE_ID &&
            previousPreferences?.inputDeviceId !== NO_AUDIO_INPUT_DEVICE_ID &&
            audioPipelineConfigurationEqual(previousPreferences, nextPreferences) &&
            !!this.contextManager?.audioContext && !!this.contextManager?.workletNode;
    }

    _setWebAudioPreferencesMirror(preferences) {
        window.audioPreferences = preferences;
        if (window.electronIntegration) {
            window.electronIntegration.audioPreferences = preferences;
        }
    }

    _isSilentWebInputApplied() {
        const silentSource = this.ioManager.silentInputGainNode;
        return !!silentSource && !this.ioManager.inputSourceNode &&
            this.isSourceConnectedToPipeline(silentSource) &&
            this.ioManager.getInputSnapshot?.().state === 'not-configured';
    }

    async _applySilentWebInputInPlace(preferences, previousPreferences) {
        if (!saveWebAudioPreferences(preferences)) {
            return 'Audio Error: Failed to save audio preferences.';
        }
        this._setWebAudioPreferencesMirror(preferences);
        const currentRevision = this.powerPolicyController.getInputConfigRevision();
        const nextRevision = currentRevision + 1;
        const releaseApplied = await this.powerPolicyController
            .requestSilentInputSelection(nextRevision);
        if (releaseApplied !== true) {
            if (this._isSilentWebInputApplied()) {
                console.warn(
                    '[AudioManager] Silent input was applied physically; preserving the matching preference.'
                );
                this.powerPolicyController.requestReconcile?.('silent-input-applied').catch(() => {});
                return '';
            }
            saveWebAudioPreferences(previousPreferences);
            this._setWebAudioPreferencesMirror(previousPreferences);
            const reason = this.powerPolicyController.transitionError?.message ||
                'audio input could not be switched to silence';
            return `Audio Error: ${reason}`;
        }
        if (!this._isSilentWebInputApplied()) {
            saveWebAudioPreferences(previousPreferences);
            this._setWebAudioPreferencesMirror(previousPreferences);
            return 'Audio Error: silent audio input handoff failed.';
        }
        return '';
    }

    async _executeReset(audioPreferences = null) {
        const previousPreferences = loadWebAudioPreferences() ||
            window.electronIntegration?.audioPreferences || { inputDeviceId: 'default' };
        if (audioPreferences &&
            this._canApplySilentWebInputInPlace(previousPreferences, audioPreferences)) {
            const result = await this._applySilentWebInputInPlace(
                audioPreferences,
                previousPreferences
            );
            if (result) {
                this._setWebAudioPreferencesMirror(previousPreferences);
            }
            return result;
        }
        return this._doReset(audioPreferences);
    }

    /**
     * Internal reset implementation — serialised by reset()'s in-progress guard.
     * Tears down the current audio graph, optionally persists new preferences,
     * then rebuilds context → worklet → pipeline.
     */
    async _doReset(audioPreferences = null) {
        const inputSnapshot = this.ioManager.getInputSnapshot?.();
        if (this.ioManager.inputSourceNode || inputSnapshot?.state === 'live' ||
            inputSnapshot?.state === 'acquiring') {
            const released = await this.powerPolicyController
                ?.requestAudioReconfigurationInputRelease?.({
                    handoffToSilent: true,
                    disconnectInput: true
                });
            if (released !== true) {
                return 'Audio Error: Failed to release the current audio input safely.';
            }
        }
        this._primaryWorkletEpoch++;
        this._invalidateDspModuleLoadRequest();
        const invalidatedParallel = this._parallelPreparing || this._parallelActive;
        if (invalidatedParallel) {
            this.dispatchEvent('parallelInvalidated', {
                reason: 'audioReset',
                restorePrimaryDsp: false
            });
        }
        if (this._parallelPreparing || this._parallelActive || this._hasParallelResources()) {
            this.disableParallelPipelines({ restorePrimaryDsp: false });
        } else {
            this._advanceAudioGraphGeneration();
        }
        this._connectedPipelineSources.clear();
        // Clean up audio I/O
        this.ioManager.cleanupAudio();

        // Close audio context
        await this.contextManager.closeAudioContext();

        // If audio preferences were provided, save them first
        if (audioPreferences &&
            typeof window.electronIntegration?.saveAudioPreferences === 'function') {
            await window.electronIntegration.saveAudioPreferences(audioPreferences);
        }

        // Skip initialization if we're being called from the sample rate adjustment code
        if (this.contextManager.getSkipAudioInitDuringSampleRateChange()) {
            this.contextManager.setSkipAudioInitDuringSampleRateChange(false);
            return '';
        }

        // Initialize audio (context + input + output)
        const audioErr = await this.initAudio(audioPreferences);
        if (audioErr) {
            // initAudio() can return either a fatal context/output failure or a
            // non-fatal mic-denied warning (file playback still works).  Only the
            // mic-denied path is non-fatal — recognised via the shared MIC_DENIED_PREFIX
            // constant so this stays in sync if the message is ever rephrased.
            const isMicDenied = audioErr.startsWith(MIC_DENIED_PREFIX);
            if (!isMicDenied) {
                console.error('[AudioManager._doReset] initAudio failed:', audioErr);
                return audioErr;
            }
            console.warn('[AudioManager._doReset] initAudio non-fatal warning:', audioErr);
        }

        // Set up the AudioWorklet that hosts the plugin chain
        const workletErr = await this.initializeAudioWorklet();
        if (workletErr) {
            console.error('[AudioManager._doReset] initializeAudioWorklet failed:', workletErr);
            return workletErr;
        }

        // Resume in case the new context started suspended (autoplay policy, HDMI race, etc.).
        // Exception: when the power policy controller intentionally suspended the
        // context (effective state SUSPENDED with a recorded suspend cause),
        // forcing a resume here would diverge from the controller's intended
        // state — leave recovery to the controller's reconcile pass instead.
        const intentionallySuspended = this.powerPolicyController?.enabled &&
            this.powerPolicyController.getEffectiveState?.() === AudioPowerState.SUSPENDED &&
            this.powerPolicyController.suspendCause != null;
        if (intentionallySuspended) {
            // The controller's reconcile owns resumption. But if the new
            // context was created already 'running' (user-activation reset),
            // no statechange event fires, so notify the controller directly;
            // its directive-resend path reconciles the divergence. A context
            // created 'suspended' stays a no-op as before.
            if (this.contextManager.audioContext?.state === 'running') {
                this.powerPolicyController.handleContextStateChange({ state: 'running' });
            }
        } else if (this.powerPolicyController?.enabled &&
            typeof this.contextManager.resumeForPowerPolicy === 'function') {
            await this.contextManager.resumeForPowerPolicy('unexpected-recovery');
        } else {
            await this.contextManager.resumeAudioContext();
        }

        // Make sure pipeline is rebuilt with the new audio context
        const pipelineErr = await this.rebuildPipeline(true);
        if (pipelineErr) {
            console.error('[AudioManager._doReset] rebuildPipeline failed:', pipelineErr);
            return pipelineErr;
        }

        await this.waitForDspActivationBeforeOutput();
        await this._notifyAudioGraphRebuilt();

        // After a reset the new outputGainNode starts at 0; ramp it up now that
        // the pipeline is in place. Same primitive as the startup path in App.
        this.fadeInOutput();

        return '';
    }

    /**
     * Let long-lived UI playback sources rebind to the newly-created audio graph.
     * Hardware reconnect recovery intentionally keeps the page alive, so objects
     * that captured the previous AudioContext must refresh before output unmutes.
     */
    async _notifyAudioGraphRebuilt() {
        const playerContextManager = window.uiManager?.audioPlayer?.contextManager;
        if (playerContextManager && typeof playerContextManager.handleAudioGraphRebuilt === 'function') {
            try {
                await playerContextManager.handleAudioGraphRebuilt({
                    audioContext: this.audioContext,
                    workletNode: this.workletNode
                });
            } catch (error) {
                console.error('[AudioManager] Failed to rebind audio player after graph rebuild:', error);
            }
        }

        this.dispatchEvent('audioGraphRebuilt', {
            audioContext: this.audioContext,
            workletNode: this.workletNode,
            sourceNode: this.sourceNode
        });
    }

    /**
     * Ramp the output gain from its current value to 1.
     * Called once per audio-context lifecycle, after every updatePlugins from
     * the startup sequence (or _doReset) has settled into the worklet. Keeps
     * speakers silent until the configured pipeline is actually running, then
     * fades in smoothly to avoid any click on transition.
     * @param {number} duration - fade duration in seconds (default 50 ms)
     */
    fadeInOutput(duration = 0.05) {
        const gainNode = this.ioManager?.outputGainNode;
        const ctx = this.contextManager?.audioContext;
        if (!gainNode || !ctx) return;
        this.ioManager.powerOutputStructurallyZero = false;

        try {
            const now = ctx.currentTime;
            const param = gainNode.gain;
            param.cancelScheduledValues(now);
            param.setValueAtTime(param.value, now);
            param.linearRampToValueAtTime(1, now + duration);
        } catch (err) {
            console.warn('[AudioManager] fadeInOutput failed, applying immediate unmute:', err);
            try { gainNode.gain.value = 1; } catch (_) { /* ignore */ }
        }
    }

    /**
     * Fade in only if no newer fade-out has claimed the output.
     * @param {number} token - Token returned by fadeOutOutput()
     * @param {number} duration - fade duration in seconds
     * @returns {boolean} whether this fade-in still owned the output
     */
    fadeInOutputForToken(token, duration = 0.05) {
        if (token !== this._outputFadeToken) return false;
        this.fadeInOutput(duration);
        return true;
    }

    /**
     * Fade out and capture the graph identity that owns the mute.
     * @param {number} duration - fade duration in seconds
     * @returns {Object} graph-bound output owner
     */
    fadeOutOutputWithOwner(duration = 0.05) {
        this.fadeOutOutput(duration);
        return this._captureOutputOwner();
    }

    /**
     * Fade in only when the same graph still owns the mute.
     * @param {Object} owner - owner returned by fadeOutOutputWithOwner()
     * @param {number} duration - fade duration in seconds
     * @returns {boolean} whether the owner restored the output
     */
    fadeInOutputForOwner(owner, duration = 0.05) {
        return this._fadeInOutputIfOwned(owner, duration);
    }

    /**
     * Ramp the output gain down to 0 (mute) without tearing down the graph.
     * Mirror of fadeInOutput(); used when A/B switching needs to fade out,
     * swap silently, then fade back in.
     * @param {number} duration - fade duration in seconds (default 50 ms)
     * @returns {number} ownership token required by the corresponding fade-in
     */
    fadeOutOutput(duration = 0.05) {
        this._outputFadeToken = (this._outputFadeToken || 0) + 1;
        const token = this._outputFadeToken;
        const gainNode = this.ioManager?.outputGainNode;
        const ctx = this.contextManager?.audioContext;
        if (!gainNode || !ctx) return token;

        try {
            const now = ctx.currentTime;
            const param = gainNode.gain;
            param.cancelScheduledValues(now);
            param.setValueAtTime(param.value, now);
            param.linearRampToValueAtTime(0, now + duration);
        } catch (err) {
            console.warn('[AudioManager] fadeOutOutput failed, applying immediate mute:', err);
            try { gainNode.gain.value = 0; } catch (_) { /* ignore */ }
        }
        return token;
    }

    // ================================================================== //
    //  Double Blind Test: parallel A/B pipeline execution                //
    //                                                                    //
    //  Runs pipeline A and pipeline B at the same time through two       //
    //  worklet nodes summed into the master output via per-branch        //
    //  selector gains:                                                   //
    //                                                                    //
    //      source -> workletA -> selA \                                  //
    //                                   >-> outputGainNode -> sink       //
    //      source -> workletB -> selB /                                  //
    //                                                                    //
    //  Both branches always process, so CPU load is independent of the   //
    //  selection and time-varying (dynamics) effects never reset their   //
    //  state. Switching only cross-fades the selector gains, which keeps  //
    //  the swap inaudible. Used while the Double Blind Test is open.      //
    // ================================================================== //

    isParallelActive() {
        return !!this._parallelActive;
    }

    isParallelProcessing() {
        return !!(this._parallelPreparing || this._parallelActive);
    }

    _hasParallelResources() {
        return !!(this._parallelPreparing || this._parallelActive || this._parallelWorkletB ||
            this._parallelSelA || this._parallelSelB || this._parallelInputTap ||
            this._parallelDspBarrier);
    }

    _captureOutputOwner() {
        return {
            generation: this._audioGraphGeneration,
            primaryEpoch: this._primaryWorkletEpoch,
            primaryWorklet: this._getPrimaryWorkletNode(),
            context: this.contextManager?.audioContext || null,
            outputGainNode: this.ioManager?.outputGainNode || null,
            fadeToken: this._outputFadeToken
        };
    }

    _isOutputOwnerCurrent(owner) {
        return !!owner && this._audioGraphGeneration === owner.generation &&
            this._primaryWorkletEpoch === owner.primaryEpoch &&
            this._getPrimaryWorkletNode() === owner.primaryWorklet &&
            (this.contextManager?.audioContext || null) === owner.context &&
            (this.ioManager?.outputGainNode || null) === owner.outputGainNode &&
            this._outputFadeToken === owner.fadeToken;
    }

    _fadeInOutputIfOwned(owner, duration) {
        if (!this._isOutputOwnerCurrent(owner)) return false;
        return this.fadeInOutputForToken(owner.fadeToken, duration);
    }

    /** Build worklet plugin data for an arbitrary pipeline (section-aware). */
    _buildBlindPluginData(pipeline) {
        if (!Array.isArray(pipeline)) return [];
        const sampleRate = this.contextManager?.audioContext?.sampleRate ?? null;
        let sectionOn = true;
        for (let i = 0; i < pipeline.length; i++) {
            const p = pipeline[i];
            if (p && p.constructor && p.constructor.name === 'SectionPlugin') {
                sectionOn = p.enabled !== false;
            } else if (p && typeof p._setSectionEnabled === 'function') {
                p._setSectionEnabled(sectionOn);
            }
        }
        return pipeline.map(plugin => {
            const parameters = plugin.getParameters({ sampleRate, commitSampleRate: true });
            if (typeof plugin.getWorkletPluginData === 'function') {
                return plugin.getWorkletPluginData(parameters);
            }
            return {
                id: plugin.id,
                type: plugin.constructor.name,
                enabled: plugin.enabled,
                parameters,
                inputBus: plugin.inputBus,
                outputBus: plugin.outputBus,
                channel: plugin.channel
            };
        });
    }

    /** Post the processor code for the given pipelines onto a worklet node. */
    _registerProcessorsOnWorklet(workletNode, pipelines) {
        if (!workletNode?.port) return;
        const seen = new Set();
        for (const pipeline of pipelines) {
            if (!Array.isArray(pipeline)) continue;
            for (const plugin of pipeline) {
                if (!plugin?.constructor) continue;
                const type = plugin.constructor.name;
                if (seen.has(type)) continue;
                if (typeof plugin.processorString !== 'string' || plugin.processorString.length === 0) continue;
                workletNode.port.postMessage({
                    type: 'registerProcessor',
                    pluginType: type,
                    processor: plugin.processorString,
                    process: typeof plugin.process === 'function' ? plugin.process.toString() : ''
                });
                seen.add(type);
            }
        }
    }

    _postBlindPlugins(workletNode, pipeline) {
        if (!workletNode?.port) return;
        workletNode.port.postMessage({
            type: 'updatePlugins',
            plugins: this._buildBlindPluginData(pipeline),
            masterBypass: false
        });
    }

    /**
     * Begin running pipelines A and B in parallel.
     * @param {string} initialSelection - 'A' or 'B' (which branch starts audible)
     * @returns {Promise<boolean>} true if the parallel graph was established
     */
    async enableParallelPipelines(initialSelection = 'A') {
        const ctx = this.contextManager?.audioContext;
        const wA = this.contextManager?.workletNode;
        const out = this.ioManager?.outputGainNode;
        if (!ctx || !wA || !out) return false;
        if (this._parallelActive) {
            this.setBlindSelection(initialSelection, 0);
            await this._parallelDspBarrier?.activationPromise;
            return true;
        }
        if (this._parallelPreparing && this._parallelDspBarrier) {
            const mode = await this._parallelDspBarrier.promise;
            if (mode === 'cancelled' || !this._parallelActive) return false;
            this.setBlindSelection(initialSelection, 0);
            return true;
        }

        this._advanceAudioGraphGeneration();
        const failureOutputOwner = this._captureOutputOwner();
        try {
            const ch = ctx.destination.channelCount || 2;
            const lowLatency = !!this.contextManager.lowLatencyMode;
            const wB = new AudioWorkletNode(ctx, 'plugin-processor', {
                channelCount: ch,
                outputChannelCount: [ch],
                processorOptions: { initialOutputChannelCount: ch, lowLatencyMode: lowLatency },
                channelCountMode: 'explicit',
                channelInterpretation: 'discrete'
            });
            // The parallel branch's analyzers are hidden during the test, so we
            // simply drop any messages it posts back to the main thread.
            wB.port.onmessage = event => {
                const data = event?.data;
                if (data?.type === 'dspTelemetry' && data.packet instanceof ArrayBuffer) {
                    wB.port.postMessage({ type: 'dspTelemetryReturn', packet: data.packet }, [data.packet]);
                } else if (data?.type === 'dspReady' || data?.type === 'dspFailed' ||
                    data?.type === 'dspCleanupNeeded' || data?.type === 'powerStateAck' ||
                    data?.type === 'powerObservation' || data?.type === 'powerFirstRender' ||
                    data?.type === 'powerHeartbeat' || data?.type === 'temporalStatePrepared') {
                    this.handleWorkletMessage(event, wB);
                }
            };
            wB.port.postMessage({ type: 'setLowLatencyMode', enabled: lowLatency });

            const selA = ctx.createGain();
            const selB = ctx.createGain();
            const aOn = initialSelection === 'A' ? 1 : 0;
            selA.gain.value = aOn;
            selB.gain.value = 1 - aOn;

            // Single tap node that every pipeline input source feeds; it fans the
            // input into branch B. Sources connect to workletA (branch A) directly
            // and to this tap (branch B) via connectSourceToPipeline(), so any
            // source - including new player tracks created mid-test - reaches both.
            const inputTap = ctx.createGain();
            inputTap.gain.value = 1;

            this._parallelWorkletB = wB;
            this._parallelSelA = selA;
            this._parallelSelB = selB;
            this._parallelInputTap = inputTap;
            this._parallelSelection = initialSelection;
            this._parallelPreparing = true;
            this._parallelActive = false;

            // Both worklets must know every plugin type used by either pipeline.
            this._registerProcessorsOnWorklet(wA, [this.pipelineA, this.pipelineB]);
            this._registerProcessorsOnWorklet(wB, [this.pipelineA, this.pipelineB]);
            this._postBlindPlugins(wB, this.pipelineB || []);

            const barrier = this._createParallelDspBarrier([wA, wB]);
            const preferredTypes = this.getEnabledDspTypes();
            barrier.desiredTypes = this.dspModuleInfo ? [...preferredTypes] : null;
            const preference = window.audioPreferences || window.electronIntegration?.audioPreferences || {};
            const dspRequested = preference.useWasmDsp !== false &&
                !getDspRolloutConfig({ location: window.location }).forceOff;
            const primaryCapabilities = this._dspCapabilitiesByNode?.get(wA);
            if (primaryCapabilities) {
                barrier.ready.set(wA, primaryCapabilities);
                barrier.readyTokens.set(wA, this._dspReadyTokens?.get(wA) || 0);
                barrier.dispatchedReady.add(wA);
            }

            // A remains on its current direct path while B initializes. The
            // transition that resolves this barrier performs the first A/B
            // state reset and graph routing under the master output mute.
            this.fadeInOutput(PIPELINE_SWITCH_FADE_SECONDS);
            if (!dspRequested || (this.dspModuleInfo && preferredTypes.length === 0)) {
                this._completeParallelDspWithoutModule();
            } else if (this.dspModuleInfo) {
                if (!primaryCapabilities && !this._dspReadyFallbacks?.has(wA)) {
                    this.startDspOnWorklet(wA);
                }
                this.startDspOnWorklet(wB);
                this._armParallelDspBarrierTimeout(barrier);
            } else if (this._dspModuleLoadPromise) {
                this._armParallelDspBarrierTimeout(barrier);
            } else {
                this._completeParallelDspWithoutModule();
            }

            const mode = await barrier.promise;
            if (mode === 'cancelled' && this._parallelDspBarrier === barrier &&
                this._hasParallelResources()) {
                await this.disableParallelPipelines();
            }
            return mode !== 'cancelled' && this._parallelActive;
        } catch (err) {
            console.error('[AudioManager] enableParallelPipelines failed:', err);
            this.disableParallelPipelines();
            this._fadeInOutputIfOwned(failureOutputOwner, PIPELINE_SWITCH_FADE_SECONDS);
            return false;
        }
    }

    _getPipelineInputSources() {
        const sources = new Set(this._connectedPipelineSources);
        const liveInput = this.ioManager?.sourceNode;
        if (liveInput) sources.add(liveInput);
        return sources;
    }

    _connectSourceOnce(node, target) {
        if (!node || !target) return false;
        try { node.disconnect(target); } catch (_) { /* not connected */ }
        try {
            if (window.originalConnectMethod && this.contextManager?.isFirstLaunch) {
                window.originalConnectMethod.call(node, target);
            } else {
                node.connect(target);
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    /** (Re)wire the parallel branches and (re)post both pipelines. Idempotent. */
    _applyParallelRouting() {
        if (!this._parallelPreparing && !this._parallelActive) return false;
        const wA = this.contextManager?.workletNode;
        const wB = this._parallelWorkletB;
        const out = this.ioManager?.outputGainNode;
        const selA = this._parallelSelA;
        const selB = this._parallelSelB;
        const tap = this._parallelInputTap;
        if (!wA || !wB || !out || !selA || !selB || !tap) return false;
        const sources = [...this._getPipelineInputSources()];

        // Full disconnect of each node first guarantees exactly one connection
        // per edge even if a prior rebuild already wired wA -> out.
        try { wA.disconnect(); } catch (_) { /* ignore */ }
        try { selA.disconnect(); } catch (_) { /* ignore */ }
        try { wB.disconnect(); } catch (_) { /* ignore */ }
        try { selB.disconnect(); } catch (_) { /* ignore */ }
        try { tap.disconnect(); } catch (_) { /* ignore */ }

        try {
            wA.connect(selA); selA.connect(out);
            wB.connect(selB); selB.connect(out);
            tap.connect(wB);
            // Live input is managed by the IO manager, while player sources enter
            // through connectSourceToPipeline(). Feed every currently known source
            // into branch B, including sources connected before parallel mode began.
            for (const source of sources) {
                if (!this._connectSourceOnce(source, tap)) {
                    throw new Error('parallel-input-connect-failed');
                }
            }

            this._postBlindPlugins(wA, this.pipelineA);
            this._postBlindPlugins(wB, this.pipelineB || []);
            return true;
        } catch (error) {
            for (const source of sources) {
                try { source.disconnect(tap); } catch (_) { /* not connected */ }
            }
            try { tap.disconnect(); } catch (_) { /* ignore */ }
            try { wB.disconnect(); } catch (_) { /* ignore */ }
            try { selA.disconnect(); } catch (_) { /* ignore */ }
            try { selB.disconnect(); } catch (_) { /* ignore */ }
            try { wA.disconnect(); } catch (_) { /* ignore */ }
            try { wA.connect(out); } catch (_) { /* primary route unavailable */ }
            return false;
        }
    }

    /**
     * Connect an input source node to the pipeline input(s). Normally this is
     * just the main worklet; while the Double Blind Test runs both pipelines in
     * parallel it also feeds the branch-B input tap. The audio player uses this
     * for every source it creates so new tracks reach both pipelines.
     * @param {AudioNode} node
     * @returns {boolean} true only when every active pipeline input is connected
     */
    connectSourceToPipeline(node) {
        if (!node) return false;
        const wA = this.contextManager?.workletNode || this.workletNode;
        if (!wA) return false;
        const targets = [wA];
        if (this._parallelActive && this._parallelInputTap) targets.push(this._parallelInputTap);
        const connectedTargets = [];
        for (const target of targets) {
            if (this._connectSourceOnce(node, target)) {
                connectedTargets.push(target);
                continue;
            }
            for (const connectedTarget of connectedTargets) {
                try { node.disconnect(connectedTarget); } catch (_) { /* not connected */ }
            }
            this._connectedPipelineSources.delete(node);
            if (node === this.ioManager?.inputSourceNode) {
                this.ioManager.inputRouteConnected = false;
            }
            return false;
        }
        this._connectedPipelineSources.add(node);
        if (node === this.ioManager?.inputSourceNode) {
            this.ioManager.inputRouteConnected = true;
        }
        return true;
    }

    ensureSourceConnectedToPipeline(node) {
        if (this.isSourceConnectedToPipeline(node)) return true;
        return this.connectSourceToPipeline(node) === true &&
            this.isSourceConnectedToPipeline(node);
    }

    isSourceConnectedToPipeline(node) {
        if (!node) return false;
        if (this._connectedPipelineSources.has(node)) return true;
        return node === this.ioManager?.inputSourceNode &&
            this.ioManager.inputRouteConnected === true;
    }

    /** Stop routing a source through edges owned by this manager. */
    disconnectSourceFromPipeline(node) {
        if (!node) return;
        this._connectedPipelineSources.delete(node);
        if (node === this.ioManager?.inputSourceNode) {
            this.ioManager.inputRouteConnected = false;
        }
        const wA = this.contextManager?.workletNode || this.workletNode;
        const targets = new Set([wA, this._parallelInputTap].filter(Boolean));
        for (const target of targets) {
            try { node.disconnect(target); } catch (_) { /* not connected */ }
        }
    }

    /**
     * Cross-fade which parallel branch is audible.
     * @param {string} which - 'A' or 'B'
     * @param {number} fade - cross-fade time in seconds (default 30 ms)
     */
    setBlindSelection(which, fade = 0.03) {
        if (!this._parallelActive) return;
        const ctx = this.contextManager?.audioContext;
        if (!ctx || !this._parallelSelA || !this._parallelSelB) return;
        const now = ctx.currentTime;
        const aTarget = which === 'A' ? 1 : 0;
        const ramp = (param, target) => {
            try {
                param.cancelScheduledValues(now);
                param.setValueAtTime(param.value, now);
                param.linearRampToValueAtTime(target, now + fade);
            } catch (_) {
                try { param.value = target; } catch (__) { void __; }
            }
        };
        ramp(this._parallelSelA.gain, aTarget);
        ramp(this._parallelSelB.gain, 1 - aTarget);
        this._parallelSelection = which;
    }

    /**
     * Tear down the parallel graph and restore the direct worklet output.
     * @param {Object} options
     * @returns {Promise<boolean>|boolean} primary DSP restoration result, or false for a no-op
     */
    disableParallelPipelines(options = {}) {
        if (!this._hasParallelResources()) return false;
        const wA = this.contextManager?.workletNode;
        const out = this.ioManager?.outputGainNode;
        const wB = this._parallelWorkletB;
        const selA = this._parallelSelA;
        const selB = this._parallelSelB;
        const tap = this._parallelInputTap;

        this._parallelPreparing = false;
        this._parallelActive = false;
        this._advanceAudioGraphGeneration();
        const outputOwner = this._captureOutputOwner();

        // Disconnect the input tap first so branch B loses all its input edges
        // (player sources connect through the tap), letting wB be released.
        for (const source of this._getPipelineInputSources()) {
            try { source.disconnect(tap); } catch (_) { /* ignore */ }
        }
        try { tap?.disconnect(); } catch (_) { /* ignore */ }
        try { wB?.disconnect(); } catch (_) { /* ignore */ }
        try { selA?.disconnect(); } catch (_) { /* ignore */ }
        try { selB?.disconnect(); } catch (_) { /* ignore */ }
        // Full disconnect then single reconnect avoids any duplicate wA -> out edge.
        try { wA?.disconnect(); } catch (_) { /* ignore */ }
        try { if (wA && out) wA.connect(out); } catch (_) { /* ignore */ }

        if (wB) {
            this.clearDspReadyFallback(wB);
            this._completeDspActivationRequest(wB, false);
            this._dspCapabilitiesByNode?.delete(wB);
            this._dspReadyTokens?.delete(wB);
            if (wB.port) wB.port.onmessage = null;
        }

        this._parallelWorkletB = null;
        this._parallelSelA = null;
        this._parallelSelB = null;
        this._parallelInputTap = null;
        if (options.restorePrimaryDsp === false || !wA?.port) {
            this._fadeInOutputIfOwned(outputOwner, PIPELINE_SWITCH_FADE_SECONDS);
            return Promise.resolve(true);
        }

        let restoration;
        try {
            const preferredTypes = this.getEnabledDspTypes();
            if (preferredTypes.length === 0) {
                wA.port.postMessage({ type: 'dspEnableTypes', types: [] });
                this._fadeInOutputIfOwned(outputOwner, PIPELINE_SWITCH_FADE_SECONDS);
                return Promise.resolve(true);
            }
            if (this._dspCapabilitiesByNode?.has(wA)) {
                return this._transitionDspConfiguration(new Set([wA]), preferredTypes);
            }
            restoration = this._reinitializeDspWorklet(wA, preferredTypes);
        } catch (error) {
            this._fadeInOutputIfOwned(outputOwner, PIPELINE_SWITCH_FADE_SECONDS);
            throw error;
        }
        return Promise.resolve(restoration).then(
            restored => {
                if (!restored) {
                    this._fadeInOutputIfOwned(outputOwner, PIPELINE_SWITCH_FADE_SECONDS);
                }
                return restored;
            },
            error => {
                this._fadeInOutputIfOwned(outputOwner, PIPELINE_SWITCH_FADE_SECONDS);
                throw error;
            }
        );
    }

    /**
     * Set the pipeline of audio plugins
     * @param {Array} pipeline - Array of plugin instances
     * @returns {Promise<void>}
     */
    setPipeline(pipeline) {
        if (!Array.isArray(pipeline)) {
            pipeline = [];
        }
        const currentPipeline = Array.isArray(this.pipeline) ? this.pipeline : [];
        // Check if pipeline structure has changed
        const needsRebuild = currentPipeline.length !== pipeline.length ||
            pipeline.some((plugin, index) =>
                currentPipeline[index]?.id !== plugin.id ||
                currentPipeline[index]?.enabled !== plugin.enabled
            );
        
        this.pipeline = pipeline;
        window.pipeline = pipeline; // Update global reference
        
        // Only rebuild if necessary
        if (needsRebuild) {
            return this.rebuildPipeline();
        } else {
            // Just update parameters without rebuilding
            if (this.workletNode) {
                this.registerPipelineProcessors();
                const sampleRate = this.contextManager?.audioContext?.sampleRate ?? null;
                const pluginData = this.pipeline.map(plugin => ({
                    id: plugin.id,
                    type: plugin.constructor.name,
                    enabled: plugin.enabled,
                    parameters: plugin.getParameters({ sampleRate, commitSampleRate: true })
                }));
                
                this.commitPowerTopologyMutation({
                    type: 'updatePlugins',
                    plugins: pluginData,
                    masterBypass: this.masterBypass
                }, { reason: 'pipeline-state-parameter-update' });
            }
            return Promise.resolve();
        }
    }

    isStagedAudioActivationEnabled() {
        return this.powerPolicyController?.enabled === true &&
            this.powerPolicyController?.started === true &&
            this.audioActivationCoordinator?.isSupported?.() === true &&
            this.getActivePowerWorklets().length > 0;
    }

    stageAudioActivation(intent) {
        if (!this.isStagedAudioActivationEnabled()) return Promise.resolve(null);
        return this.audioActivationCoordinator.stageIntent(intent);
    }

    activateStagedAudioCandidate(stage, callbacks) {
        if (!stage || !this.isStagedAudioActivationEnabled()) {
            return Promise.resolve({ activated: false, stage, error: Object.assign(
                new Error('Staged audio activation is unavailable.'),
                { code: 'activation-protocol-unavailable' }
            ) });
        }
        return this.audioActivationCoordinator.activate(stage, callbacks);
    }

    getActiveAudioActivationDescriptor() {
        return this.audioActivationCoordinator?.getActiveDescriptor?.() || null;
    }

    async applyStagedAudioConfig(audioPreferences, options = {}) {
        const expectedRevision = options.expectedConfigRevision ?? this._activeAudioConfigRevision;
        if (expectedRevision !== this._activeAudioConfigRevision) {
            return {
                activated: false,
                error: Object.assign(new Error('The active audio config revision changed.'), {
                    code: 'activation-config-revision-stale'
                })
            };
        }
        if (!this.isStagedAudioActivationEnabled()) {
            await this.updateAudioConfig(audioPreferences);
            const value = options.publish?.(audioPreferences, this._activeAudioConfigRevision + 1);
            if (value && typeof value.then === 'function') {
                throw new TypeError('The audio config publication callback must be synchronous');
            }
            this._activeAudioConfigRevision++;
            return { activated: true, value };
        }

        const configIntentSequence = ++this._audioConfigIntentSequence;
        const stage = await this.stageAudioActivation({
            intentKind: 'config',
            intentIdentity: {
                audioSessionId: this.powerPolicyController?.sessionJournal?.getStatus?.().sessionId ||
                    'session-local',
                clientId: this.powerPolicyController?.sessionJournal?.getStatus?.().clientId ||
                    'client-local',
                configIntentSequence,
                expectedAppConfigRevision: expectedRevision
            },
            resumeKind: 'none',
            backend: 'none',
            requiredResourceKeys: [],
            activationAffectingConfig: audioPreferences || {}
        });
        return this.activateStagedAudioCandidate(stage, {
            acquire: async () => {
                if (expectedRevision !== this._activeAudioConfigRevision) {
                    throw Object.assign(new Error('The active audio config revision changed.'), {
                        code: 'activation-config-revision-stale'
                    });
                }
                const updateResult = await this.updateAudioConfig(audioPreferences);
                if (updateResult === false) {
                    throw Object.assign(new Error('The audio config resource update failed.'), {
                        code: 'activation-config-resource-failed'
                    });
                }
                return { audioPreferences, configIntentSequence };
            },
            isCandidateCurrent: candidate => candidate?.configIntentSequence === configIntentSequence &&
                expectedRevision === this._activeAudioConfigRevision,
            commit: candidate => {
                const nextRevision = this._activeAudioConfigRevision + 1;
                const value = options.publish?.(candidate.audioPreferences, nextRevision);
                if (value && typeof value.then === 'function') {
                    throw new TypeError('The audio config publication callback must be synchronous');
                }
                this._activeAudioConfigRevision = nextRevision;
                return { configRevision: nextRevision, audioPreferences: candidate.audioPreferences, value };
            }
        });
    }
    
    /**
     * Set the master bypass state
     * @param {boolean} bypass - Whether to bypass all plugins
     * @returns {Promise<void>}
     */
    setMasterBypass(bypass) {
        if (this.masterBypass !== bypass) {
            this.masterBypass = bypass;
            this.pipelineProcessor.setMasterBypass(this.masterBypass);
            return this.rebuildPipeline();
        }
        return Promise.resolve();
    }
    
    /**
     * Process an audio file offline
     * @param {File} file - The audio file to process
     * @param {Function} progressCallback - Callback for progress updates
     * @returns {Promise<Blob>} - Processed audio as a WAV blob
     */
    async processAudioFile(file, progressCallback = null) {
        const releasePowerLease = this.powerPolicyController?.started
            ? this.powerPolicyController.acquireLease('offline-processing', {
                mode: 'hold-current',
                scope: 'resource-neutral'
            })
            : null;
        try {
            return await this.offlineProcessor.processAudioFile(file, this.pipeline, progressCallback);
        } finally {
            this.updateExposedProperties();
            releasePowerLease?.();
        }
    }

    /**
     * Cancel the current offline audio processing operation.
     */
    cancelProcessing() {
        this.offlineProcessor.cancelProcessing();
        this.updateExposedProperties();
    }
    
    /**
     * Encode audio buffer to WAV format
     * @param {AudioBuffer} audioBuffer - The audio buffer to encode
     * @returns {Blob} - WAV file as a Blob
     */
    encodeWAV(audioBuffer) {
        return this.audioEncoder.encodeWAV(audioBuffer);
    }
    
    /**
     * Add an event listener
     * @param {string} eventName - Name of the event
     * @param {Function} callback - Callback function
     */
    addEventListener(eventName, callback) {
        this.eventManager.addEventListener(eventName, callback);
    }
    
    /**
     * Remove an event listener
     * @param {string} eventName - Name of the event
     * @param {Function} callback - Callback function to remove
     */
    removeEventListener(eventName, callback) {
        this.eventManager.removeEventListener(eventName, callback);
    }
    
    /**
     * Dispatch an event to all registered listeners
     * @param {string} eventName - Name of the event
     * @param {Object} data - Event data
     */
    dispatchEvent(eventName, data) {
        this.eventManager.dispatchEvent(eventName, data);
    }
}
