import { AudioContextManager } from './audio/audio-context-manager.js';
import { AudioIOManager, MIC_DENIED_PREFIX } from './audio/audio-io-manager.js';
import { PipelineProcessor } from './audio/pipeline-processor.js';
import { OfflineProcessor } from './audio/offline-processor.js';
import { AudioEncoder } from './audio/audio-encoder.js';
import { EventManager } from './audio/event-manager.js';
import { InputActivityWatcher } from './audio/input-activity-watcher.js';
import { getSerializablePluginStateShort, applySerializedState } from './utils/serialization-utils.js';

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
        this.pipelineProcessor = new PipelineProcessor(this.contextManager, this.ioManager);
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

        // Sleep-mode output power saving (see _enterSleepPowerSave). True
        // while the AudioContext is intentionally suspended so the output
        // device (and DAC/Amp) can power down during idle sleep.
        this._sleepSuspended = false;
        this._inputActivityWatcher = null;

        // Set global reference
        window.audioManager = this;
    }

    /**
     * Get current pipeline (A or B)
     * @returns {Array} Current pipeline array
     */
    getCurrentPipeline() {
        return this.currentPipeline === 'A' ? this.pipelineA : this.pipelineB;
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
        if (this.currentPipeline === 'A') {
            this.pipelineA = plugins;
        } else if (this.currentPipeline === 'B') {
            this.pipelineB = plugins;
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
            
            // Initialize audio input
            const inputResult = await this.ioManager.initAudioInput();
            // No need to log input result
            
            // Initialize audio output
            const outputResult = await this.ioManager.initAudioOutput();
            if (outputResult) {
                return outputResult;
            }
            
            // Note: We don't build the pipeline here anymore
            // That will be done in initializeAudioWorklet after GUI is fully rendered
            
            // Resume context if suspended
            await this.contextManager.resumeAudioContext();
            
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
            
            // Setup worklet message handler
            if (this.workletNode) {
                this.workletNode.port.onmessage = (event) => {
                    const data = event.data;
                    if (data.type === 'sleepModeChanged') {
                        // Propagate sleep state to every plugin so that
                        // analyzer-style plugins can pause their main-thread
                        // redraw loop while the audio path is idle. Plugins
                        // that don't expose _setSleepMode are unaffected.
                        if (this.pipeline) {
                            for (const plugin of this.pipeline) {
                                if (typeof plugin._setSleepMode === 'function') {
                                    plugin._setSleepMode(data.isSleepMode);
                                }
                            }
                        }
                        // Dispatch sleep mode changed event
                        this.dispatchEvent('sleepModeChanged', {
                            isSleepMode: data.isSleepMode,
                            sampleRate: this.audioContext.sampleRate
                        });

                        // Release the output device while idle so the DAC/Amp
                        // can power down (non-macOS only; see methods below).
                        if (data.isSleepMode) {
                            this._enterSleepPowerSave();
                        } else if (this._sleepSuspended) {
                            // A wake reported by the worklet (only possible
                            // after we already resumed it) - make sure our
                            // power-save state is torn down.
                            this.wakeFromSleep();
                        }
                    }
                };
            }
            
            return '';
        } catch (error) {
            return `Audio Error: ${error.message}`;
        }
    }

    /**
     * Whether sleep-mode output power saving may run.
     *
     * Intentionally a no-op on macOS: there, EffeTune carries a
     * carefully-tuned audio-device recovery path for HDMI hotplug /
     * CoreAudio behavior which, of necessity, treats AudioContext
     * suspend/close transitions as failure signals. A deliberate suspend
     * would collide with that hard-won machinery for little gain, since
     * the power-saving target is a low-power always-on Linux host (Pi +
     * DAC). So we simply don't engage it on macOS.
     * @returns {boolean}
     */
    _sleepPowerSaveSupported() {
        if (window.electronAPI?.platform === 'darwin') return false;
        return !!this.audioContext;
    }

    /**
     * Called when the worklet enters sleep mode. Suspends the AudioContext
     * so the OS output device - and the downstream DAC/Amp - can power
     * down. Auto-wake on returning input is preserved by watching the
     * input track with a device-free MediaStreamTrackProcessor (the
     * suspended worklet can no longer do it). If that watcher can't be
     * established, we keep the context running rather than lose wake-on-input.
     */
    async _enterSleepPowerSave() {
        if (this._sleepSuspended) return;
        if (!this._sleepPowerSaveSupported()) return;

        const track = this.stream?.getAudioTracks?.()[0] ?? null;
        if (!track || !InputActivityWatcher.isSupported()) {
            // No device-free way to detect input returning (e.g. file
            // playback, or API unavailable) - leave the context running so
            // the worklet keeps handling wake-on-input (status quo).
            return;
        }

        this._sleepSuspended = true;
        // Mark the suspend as deliberate so the context manager's
        // onstatechange handler does not immediately auto-resume it.
        this.contextManager.setIntentionalSuspend(true);
        try {
            await this.audioContext.suspend();
        } catch (e) {
            console.warn('[AudioManager] sleep-mode suspend failed:', e);
        }

        // We may have been woken (user activity) during the await above.
        if (!this._sleepSuspended) {
            this.contextManager.setIntentionalSuspend(false);
            await this.audioContext.resume().catch(() => {});
            return;
        }

        // In HTMLMediaElement output mode the <audio> element holds its own
        // sink open, so pause it too. Context-sink / direct modes route
        // through audioContext.destination, which suspend() already released.
        const io = this.ioManager;
        if (io?.audioElement && !io.audioContextSinkMode && !io.directOutputMode) {
            try { io.audioElement.pause(); } catch { /* ignore */ }
        }

        if (!this._inputActivityWatcher) {
            // Mirror the worklet's silence test: AC peak-to-peak above
            // 2x the -84 dB amplitude threshold counts as signal.
            const acThreshold = 2 * Math.pow(10, -84 / 20);
            this._inputActivityWatcher = new InputActivityWatcher(acThreshold);
        }
        const watching = this._inputActivityWatcher.start(track, () => this.wakeFromSleep());
        if (!watching) {
            // Lost our only wake-on-input mechanism - resume rather than
            // risk staying asleep with no audio path.
            this.wakeFromSleep();
            return;
        }
        const mode = io?.directOutputMode ? 'direct'
            : io?.audioContextSinkMode ? 'audioContextSink'
            : io?.audioElement ? 'mediaElement' : 'default';
        console.log(`[AudioManager] sleep power-save active (output mode: ${mode}); output device released`);
    }

    /**
     * Resume from sleep-mode power saving: re-open the output device and
     * nudge the worklet awake. Safe to call repeatedly. Driven by the input
     * watcher, by user activity, and by window-visibility changes.
     */
    async wakeFromSleep() {
        if (!this._sleepSuspended) return;
        this._sleepSuspended = false;

        if (this._inputActivityWatcher) this._inputActivityWatcher.stop();
        this.contextManager.setIntentionalSuspend(false);

        try {
            await this.audioContext.resume();
        } catch (e) {
            console.warn('[AudioManager] sleep-mode resume failed:', e);
        }

        const io = this.ioManager;
        if (io?.audioElement && !io.audioContextSinkMode && !io.directOutputMode) {
            try { await io.audioElement.play(); } catch { /* ignore */ }
        }

        // Nudge the worklet: clears its cached sleep state, resets the
        // inactivity timers, and makes it emit sleepModeChanged:false so the
        // UI and analyzer redraw loops resume normally.
        if (this.workletNode) {
            this.workletNode.port.postMessage({ type: 'userActivity' });
        }
        console.log('[AudioManager] sleep power-save: woke; output device resumed');
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
        
        // Debug logging removed for production
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
        
        // Update global reference
        window.pipeline = this.pipeline;
        
        const result = await this.pipelineProcessor.rebuildPipeline(isInitializing);
        this.updateExposedProperties();
        return result;
    }
    
    /**
     * Update audio configuration in the worklet node
     * @param {Object} audioPreferences - Audio preferences object
     */
    updateAudioConfig(audioPreferences) {
        if (!this.workletNode) return;

        this.workletNode.port.postMessage({
            type: 'updateAudioConfig',
            outputChannels: audioPreferences.outputChannels || 2,
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
            await this._doReset(audioPreferences);
            // Run any reset that was queued while we were busy
            if (this._hasPendingReset) {
                const pending = this._pendingResetPrefs;
                this._hasPendingReset = false;
                this._pendingResetPrefs = null;
                console.log('[AudioManager] running queued reset');
                await this._doReset(pending);
            }
            return '';
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
        // Tear down any sleep-mode power-save state before rebuilding the
        // audio graph: the watcher holds a clone of the old input track, and
        // a lingering intentional-suspend flag would otherwise suppress
        // legitimate auto-resume on the freshly created context.
        if (this._sleepSuspended) {
            this._sleepSuspended = false;
            if (this._inputActivityWatcher) this._inputActivityWatcher.stop();
            this.contextManager.setIntentionalSuspend(false);
        }

        // Clean up audio I/O
        this.ioManager.cleanupAudio();

        // Close audio context
        await this.contextManager.closeAudioContext();

        // If audio preferences were provided, save them first
        if (audioPreferences && window.electronAPI && window.electronIntegration) {
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
                return '';
            }
            console.warn('[AudioManager._doReset] initAudio non-fatal warning:', audioErr);
        }

        // Set up the AudioWorklet that hosts the plugin chain
        const workletErr = await this.initializeAudioWorklet();
        if (workletErr) console.error('[AudioManager._doReset] initializeAudioWorklet failed:', workletErr);

        // Resume in case the new context started suspended (autoplay policy, HDMI race, etc.)
        await this.contextManager.resumeAudioContext();

        // Make sure pipeline is rebuilt with the new audio context
        const pipelineErr = await this.rebuildPipeline(true);
        if (pipelineErr) console.error('[AudioManager._doReset] rebuildPipeline failed:', pipelineErr);

        // After a reset the new outputGainNode starts at 0; ramp it up now that
        // the pipeline is in place. Same primitive as the startup path in App.
        this.fadeInOutput();

        return '';
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
     * Set the pipeline of audio plugins
     * @param {Array} pipeline - Array of plugin instances
     * @returns {Promise<void>}
     */
    setPipeline(pipeline) {
        // Check if pipeline structure has changed
        const needsRebuild = this.pipeline.length !== pipeline.length ||
            pipeline.some((plugin, index) =>
                this.pipeline[index]?.id !== plugin.id ||
                this.pipeline[index]?.enabled !== plugin.enabled
            );
        
        this.pipeline = pipeline;
        window.pipeline = pipeline; // Update global reference
        
        // Only rebuild if necessary
        if (needsRebuild) {
            return this.rebuildPipeline();
        } else {
            // Just update parameters without rebuilding
            if (this.workletNode) {
                const pluginData = this.pipeline.map(plugin => ({
                    id: plugin.id,
                    type: plugin.constructor.name,
                    enabled: plugin.enabled,
                    parameters: plugin.getParameters()
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
        return this.offlineProcessor.processAudioFile(file, this.pipeline, progressCallback);
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
