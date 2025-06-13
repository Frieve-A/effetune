import { AudioContextManager } from './audio/audio-context-manager.js';
import { AudioIOManager } from './audio/audio-io-manager.js';
import { PipelineProcessor } from './audio/pipeline-processor.js';
import { OfflineProcessor } from './audio/offline-processor.js';
import { AudioEncoder } from './audio/audio-encoder.js';
import { EventManager } from './audio/event-manager.js';

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
        
        // Expose properties for backward compatibility
        this.audioContext = null;
        this.stream = null;
        this.sourceNode = null;
        this.workletNode = null;
        this.pipeline = [];
        this.masterBypass = false;
        this.offlineContext = null;
        this.offlineWorkletNode = null;
        this.isOfflineProcessing = false;
        this.isCancelled = false;
        this._skipAudioInitDuringSampleRateChange = false;
        this.isFirstLaunch = false;
        
        // Set global reference
        window.audioManager = this;
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
                        // Dispatch sleep mode changed event
                        this.dispatchEvent('sleepModeChanged', {
                            isSleepMode: data.isSleepMode,
                            sampleRate: this.audioContext.sampleRate
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
        
        // Debug logging removed for production
    }
    
    /**
     * Rebuild the audio processing pipeline
     * @param {boolean} isInitializing - Whether this is the initial build
     * @returns {Promise<string>} - Empty string on success, error message on failure
     */
    async rebuildPipeline(isInitializing = false) {
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
        
        // Initialize audio and rebuild pipeline
        await this.initAudio();
        
        // Make sure pipeline is rebuilt with the new audio context
        if (this.pipeline && this.pipeline.length > 0) {
            await this.rebuildPipeline(true);
        }
        
        return '';
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
