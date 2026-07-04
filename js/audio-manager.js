import { AudioContextManager } from './audio/audio-context-manager.js';
import { AudioIOManager, MIC_DENIED_PREFIX } from './audio/audio-io-manager.js';
import { PipelineProcessor } from './audio/pipeline-processor.js';
import { OfflineProcessor } from './audio/offline-processor.js';
import { AudioEncoder } from './audio/audio-encoder.js';
import { EventManager } from './audio/event-manager.js';
import { getSerializablePluginStateShort, applySerializedState } from './utils/serialization-utils.js';

const PIPELINE_SWITCH_FADE_SECONDS = 0.04;
const PIPELINE_SWITCH_SILENCE_SECONDS = 0.05;

function waitForPipelineSwitch(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
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
            () => this.registerPipelineProcessors()
        );
        this.offlineProcessor = new OfflineProcessor(this.contextManager, this.audioEncoder);
        this.eventManager = new EventManager(this);
        
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
        this._hasPendingReset = false;
        this._pendingResetPrefs = null;
        this.isCancelled = false;
        this._skipAudioInitDuringSampleRateChange = false;
        this.isFirstLaunch = false;
        this._pipelineSwitchSeq = 0;
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

        try {
            this.fadeOutOutput(fadeDuration);
            await waitForPipelineSwitch(fadeDuration);
            if (seq !== this._pipelineSwitchSeq) return false;

            this.currentPipeline = pipeline;
            this.pipeline = this.getCurrentPipeline();

            if (this.workletNode) {
                const result = await this.rebuildPipeline();
                if (result) {
                    console.warn('[AudioManager] Pipeline switch rebuild reported:', result);
                }
            }

            this.dispatchEvent('pipelineChanged', { pipeline: this.currentPipeline });

            if (!skipHistorySave && this.pipelineManager && this.pipelineManager.historyManager) {
                this.pipelineManager.historyManager.saveState();
            }

            await waitForPipelineSwitch(silenceDuration);
            if (seq !== this._pipelineSwitchSeq) return false;

            this.fadeInOutput(fadeDuration);
            return true;
        } catch (error) {
            console.warn('[AudioManager] setCurrentPipelineWithTransition failed, falling back to immediate switch:', error);
            this.setCurrentPipeline(pipeline, skipHistorySave);
            this.fadeInOutput(fadeDuration);
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
     * @returns {Promise<string>} - Empty string on success, error message on failure
     */
    async initAudio() {
        try {
            // Initialize audio context (without AudioWorklet)
            const contextResult = await this.contextManager.initAudioContext();
            if (contextResult) {
                return contextResult;
            }
            
            // Initialize audio input. Layout mode must never affect the audio
            // path: mobile and desktop both request the input device here (a
            // denied permission falls back to the silent source inside
            // initAudioInput).
            const isElectron = !!(window.electronAPI ||
                window.electronIntegration?.isElectron ||
                window.electronIntegration?.isElectronEnvironment?.());
            const inputResult = await this.ioManager.initAudioInput();
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
            // Load AudioWorklet and create worklet node
            const workletResult = await this.contextManager.loadAudioWorklet();
            if (workletResult) {
                return workletResult;
            }
            
            // Update exposed properties for backward compatibility
            this.updateExposedProperties();

            // A recreated AudioWorklet starts with an empty processor registry.
            // Existing plugin instances do not run their constructors again, so
            // their processor code must be sent before any updatePlugins message.
            this.registerPipelineProcessors();
            
            // Setup worklet message handler
            if (this.workletNode) {
                this.workletNode.port.onmessage = (event) => {
                    const data = event.data;
                    if (data.type === 'sleepModeChanged') {
                        // Dispatch sleep mode changed event
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
                    }
                };
            }
            
            return '';
        } catch (error) {
            return `Audio Error: ${error.message}`;
        }
    }
    
    /**
     * Update properties exposed for backward compatibility
     */
    updateExposedProperties() {
        this.audioContext = this.contextManager.audioContext;
        this.stream = this.ioManager.stream;
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
        const workletNode = this.contextManager?.workletNode || this.workletNode || window.workletNode;
        if (!workletNode?.port) return;

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

                workletNode.port.postMessage({
                    type: 'registerProcessor',
                    pluginType,
                    processor: plugin.processorString,
                    process: typeof plugin.process === 'function' ? plugin.process.toString() : ''
                });
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

        // If a rebuild happens while the Double Blind Test is running its two
        // pipelines in parallel (e.g. an audio-device change), the standard
        // rebuild reconnects only the main worklet; re-establish the parallel
        // branches so the blind test keeps working.
        if (this._parallelActive) {
            this._applyParallelRouting();
        }

        return result;
    }
    
    /**
     * Update audio configuration in the worklet node
     * @param {Object} audioPreferences - Audio preferences object
     */
    updateAudioConfig(audioPreferences) {
        if (!this.workletNode) return;

        const outputChannels = audioPreferences.outputChannels || 2;
        this.workletNode.port.postMessage({
            type: 'updateAudioConfig',
            outputChannels,
            lowLatencyMode: !!audioPreferences.lowLatencyOutput
        });
    }
    
    /**
     * Reset the audio system
     * @param {Object} audioPreferences - Audio preferences to save
     * @returns {Promise<string>} - Empty string on success, error message on failure
     */
    async reset(audioPreferences = null) {
        if (this._resetInProgress) {
            // Queue the latest prefs so we retry after current reset finishes.
            // Use a separate boolean flag so that audioPreferences === null is a
            // valid queued payload (not confused with "no queued reset").
            console.log('[AudioManager] reset queued — already in progress');
            this._pendingResetPrefs = audioPreferences;
            this._hasPendingReset = true;
            return '';
        }
        this._resetInProgress = true;
        this._hasPendingReset = false;
        this._pendingResetPrefs = null;
        try {
            let resetResult = await this._doReset(audioPreferences);
            // Run any reset that was queued while we were busy
            if (this._hasPendingReset) {
                const pending = this._pendingResetPrefs;
                this._hasPendingReset = false;
                this._pendingResetPrefs = null;
                console.log('[AudioManager] running queued reset');
                const pendingResult = await this._doReset(pending);
                if (pendingResult) {
                    resetResult = pendingResult;
                }
            }
            return resetResult || '';
        } finally {
            this._resetInProgress = false;
        }
    }

    /**
     * Internal reset implementation — serialised by reset()'s in-progress guard.
     * Tears down the current audio graph, optionally persists new preferences,
     * then rebuilds context → worklet → pipeline.
     */
    async _doReset(audioPreferences = null) {
        // Clean up audio I/O
        this.ioManager.cleanupAudio();

        // Close audio context
        await this.contextManager.closeAudioContext();

        // If audio preferences were provided, save them first
        if (audioPreferences && typeof window.electronIntegration?.saveAudioPreferences === 'function') {
            await window.electronIntegration.saveAudioPreferences(audioPreferences);
        }

        // Skip initialization if we're being called from the sample rate adjustment code
        if (this.contextManager.getSkipAudioInitDuringSampleRateChange()) {
            this.contextManager.setSkipAudioInitDuringSampleRateChange(false);
            return '';
        }

        // Initialize audio (context + input + output)
        const audioErr = await this.initAudio();
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

        // Resume in case the new context started suspended (autoplay policy, HDMI race, etc.)
        await this.contextManager.resumeAudioContext();

        // Make sure pipeline is rebuilt with the new audio context
        const pipelineErr = await this.rebuildPipeline(true);
        if (pipelineErr) {
            console.error('[AudioManager._doReset] rebuildPipeline failed:', pipelineErr);
            return pipelineErr;
        }

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
     * Ramp the output gain down to 0 (mute) without tearing down the graph.
     * Mirror of fadeInOutput(); used when A/B switching needs to fade out,
     * swap silently, then fade back in.
     * @param {number} duration - fade duration in seconds (default 50 ms)
     */
    fadeOutOutput(duration = 0.05) {
        const gainNode = this.ioManager?.outputGainNode;
        const ctx = this.contextManager?.audioContext;
        if (!gainNode || !ctx) return;

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
        return pipeline.map(plugin => ({
            id: plugin.id,
            type: plugin.constructor.name,
            enabled: plugin.enabled,
            parameters: plugin.getParameters({ sampleRate, commitSampleRate: true }),
            inputBus: plugin.inputBus,
            outputBus: plugin.outputBus,
            channel: plugin.channel
        }));
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
            return true;
        }

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
            wB.port.onmessage = () => {};
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
            this._parallelActive = true;

            // Both worklets must know every plugin type used by either pipeline.
            this._registerProcessorsOnWorklet(wA, [this.pipelineA, this.pipelineB]);
            this._registerProcessorsOnWorklet(wB, [this.pipelineA, this.pipelineB]);

            this._applyParallelRouting();
            return true;
        } catch (err) {
            console.error('[AudioManager] enableParallelPipelines failed:', err);
            this.disableParallelPipelines();
            return false;
        }
    }

    /** (Re)wire the parallel branches and (re)post both pipelines. Idempotent. */
    _applyParallelRouting() {
        if (!this._parallelActive) return;
        const wA = this.contextManager?.workletNode;
        const wB = this._parallelWorkletB;
        const out = this.ioManager?.outputGainNode;
        const src = this.ioManager?.sourceNode;
        const selA = this._parallelSelA;
        const selB = this._parallelSelB;
        const tap = this._parallelInputTap;
        if (!wA || !wB || !out || !selA || !selB || !tap) return;

        // Full disconnect of each node first guarantees exactly one connection
        // per edge even if a prior rebuild already wired wA -> out.
        try { wA.disconnect(); } catch (_) { /* ignore */ }
        try { selA.disconnect(); } catch (_) { /* ignore */ }
        try { wB.disconnect(); } catch (_) { /* ignore */ }
        try { selB.disconnect(); } catch (_) { /* ignore */ }
        try { tap.disconnect(); } catch (_) { /* ignore */ }

        wA.connect(selA); selA.connect(out);
        wB.connect(selB); selB.connect(out);
        tap.connect(wB);
        // Live input (mic/stream) is wired straight to workletA by the IO manager;
        // also feed it into the tap so branch B receives it. Player sources route
        // through connectSourceToPipeline() instead. Disconnect-then-connect keeps
        // this to a single edge if the source was already tapped.
        if (src) {
            try { src.disconnect(tap); } catch (_) { /* not connected */ }
            try { src.connect(tap); } catch (_) { /* ignore */ }
        }

        this._postBlindPlugins(wA, this.pipelineA);
        this._postBlindPlugins(wB, this.pipelineB || []);
    }

    /**
     * Connect an input source node to the pipeline input(s). Normally this is
     * just the main worklet; while the Double Blind Test runs both pipelines in
     * parallel it also feeds the branch-B input tap. The audio player uses this
     * for every source it creates so new tracks reach both pipelines.
     * @param {AudioNode} node
     */
    connectSourceToPipeline(node) {
        if (!node) return;
        const wA = this.contextManager?.workletNode || this.workletNode;
        try { if (wA) node.connect(wA); } catch (_) { /* ignore */ }
        if (this._parallelActive && this._parallelInputTap) {
            try { node.connect(this._parallelInputTap); } catch (_) { /* ignore */ }
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

    /** Tear down the parallel graph and restore the direct worklet output. */
    disableParallelPipelines() {
        const wA = this.contextManager?.workletNode;
        const out = this.ioManager?.outputGainNode;
        const src = this.ioManager?.sourceNode;
        const wB = this._parallelWorkletB;
        const selA = this._parallelSelA;
        const selB = this._parallelSelB;
        const tap = this._parallelInputTap;

        // Disconnect the input tap first so branch B loses all its input edges
        // (player sources connect through the tap), letting wB be released.
        try { src?.disconnect(tap); } catch (_) { /* ignore */ }
        try { tap?.disconnect(); } catch (_) { /* ignore */ }
        try { wB?.disconnect(); } catch (_) { /* ignore */ }
        try { selA?.disconnect(); } catch (_) { /* ignore */ }
        try { selB?.disconnect(); } catch (_) { /* ignore */ }
        // Full disconnect then single reconnect avoids any duplicate wA -> out edge.
        try { wA?.disconnect(); } catch (_) { /* ignore */ }
        try { if (wA && out) wA.connect(out); } catch (_) { /* ignore */ }

        this._parallelWorkletB = null;
        this._parallelSelA = null;
        this._parallelSelB = null;
        this._parallelInputTap = null;
        this._parallelActive = false;
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
                
                this.workletNode.port.postMessage({
                    type: 'updatePlugins',
                    plugins: pluginData,
                    masterBypass: this.masterBypass
                });
            }
            return Promise.resolve();
        }
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
        try {
            return await this.offlineProcessor.processAudioFile(file, this.pipeline, progressCallback);
        } finally {
            this.updateExposedProperties();
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
