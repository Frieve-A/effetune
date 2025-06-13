/**
 * AudioContextManager - Manages the Web Audio API context
 */
export class AudioContextManager {
    /**
     * Create a new AudioContextManager instance
     */
    constructor() {
        this.audioContext = null;
        this.offlineContext = null;
        this.workletNode = null;
        this.silenceGain = null;
        this.isFirstLaunch = false;
        this._skipAudioInitDuringSampleRateChange = false;
        
        // Initialize global variable if not already set
        if (typeof window.originalConnectMethod === 'undefined') {
            window.originalConnectMethod = null;
        }
    }
    
    /**
     * Initialize the audio context
     * @returns {Promise<string>} - Empty string on success, error message on failure
     */
    async initAudioContext() {
        try {
            // Check if this is the first launch
            if (window.electronAPI && window.electronAPI.isFirstLaunch) {
                try {
                    const firstLaunchPromise = window.electronAPI.isFirstLaunch();
                    if (firstLaunchPromise && typeof firstLaunchPromise.then === 'function') {
                        this.isFirstLaunch = await firstLaunchPromise;
                    } else {
                        this.isFirstLaunch = false;
                    }
                } catch (error) {
                    this.isFirstLaunch = false;
                }
            } else if (window.isFirstLaunchConfirmed !== undefined) {
                this.isFirstLaunch = window.isFirstLaunchConfirmed;
            }
            
            // Create audio context if not exists
            if (!this.audioContext) {
                // Enhanced browser compatibility for AudioContext
                const AudioContext = window.AudioContext ||
                                    window.webkitAudioContext ||
                                    window.mozAudioContext ||
                                    window.msAudioContext;
                
                if (!AudioContext) {
                    throw new Error('Web Audio API is not supported in this browser');
                }
                
                // Default audio context options
                let audioContextOptions = { };
                
                // If running in Electron, try to use saved audio preferences
                if (window.electronAPI && window.electronIntegration) {
                    const preferences = await window.electronIntegration.loadAudioPreferences();
                    if (preferences && preferences.sampleRate) {
                        audioContextOptions.sampleRate = preferences.sampleRate;
                    }
                    
                    // Add latencyHint from preferences if available
                    if (preferences && preferences.latencyHint) {
                        audioContextOptions.latencyHint = preferences.latencyHint;
                    } else {
                        // Default to interactive if not specified
                        audioContextOptions.latencyHint = 'interactive';
                    }
                    
                    // Try to set sinkId if available (experimental Chrome/Chromium feature)
                    if (preferences && preferences.outputDeviceId) {
                        // This is an experimental feature in Chrome/Chromium
                        audioContextOptions.sinkId = preferences.outputDeviceId;
                        console.log('Attempting to use sinkId in AudioContext:', preferences.outputDeviceId);
                    }
                }
                
                // Create audio context with options
                this.audioContext = new AudioContext(audioContextOptions);
                console.log('AudioContext created with options:', audioContextOptions);
                window.audioContext = this.audioContext; // Global reference
                
                // Set audio context destination channel count based on preferences
                if (window.electronAPI && window.electronIntegration) {
                    const preferences = await window.electronIntegration.loadAudioPreferences();
                    if (preferences && preferences.outputChannels) {
                        // Check if requested channel count doesn't exceed the maximum supported
                        const maxChannels = this.audioContext.destination.maxChannelCount || 2;
                        const requestedChannels = preferences.outputChannels;
                        const actualChannels = Math.min(requestedChannels, maxChannels);
                        
                        // Log channel count information
                        console.log(`Audio output: requested=${requestedChannels}, maximum=${maxChannels}, actual=${actualChannels}`);
                        
                        // Set the channel count to the appropriate value
                        this.audioContext.destination.channelCount = actualChannels;
                        this.audioContext.destination.channelInterpretation = 'discrete';
                        this.audioContext.destination.channelCountMode = 'explicit';
                        
                        // Update global audio preferences for AudioWorklet context
                        preferences.outputChannels = actualChannels;
                        window.audioPreferences = preferences;
                        
                        // Notify the worklet about audio config update
                        // (Will be applied after the worklet is created)
                        this._pendingAudioConfig = {
                            outputChannels: actualChannels
                        };
                    } else {
                        // Default to stereo (2ch)
                        this.audioContext.destination.channelCount = 2;
                        this.audioContext.destination.channelInterpretation = 'discrete';
                    }
                }
                
                // If this is the first launch, create a gain node with zero gain to ensure silence
                if (this.isFirstLaunch) {
                    // Create a gain node with zero gain
                    const silenceGain = this.audioContext.createGain();
                    silenceGain.gain.value = 0;
                    this.silenceGain = silenceGain;
                    
                    // Store original connect method
                    window.originalConnectMethod = AudioNode.prototype.connect;
                    
                    // Override connect method to force all connections through the silence gain
                    // Handle all possible overloads of the connect method
                    AudioNode.prototype.connect = function(destination, outputIndex, inputIndex) {
                        // Connect to silence gain instead, preserving all arguments
                        if (arguments.length === 1) {
                            return window.originalConnectMethod.call(this, silenceGain);
                        } else if (arguments.length === 2) {
                            return window.originalConnectMethod.call(this, silenceGain, outputIndex);
                        } else {
                            return window.originalConnectMethod.call(this, silenceGain, outputIndex, inputIndex);
                        }
                    };
                    
                    // Connect silence gain to destination
                    window.originalConnectMethod.call(silenceGain, this.audioContext.destination);
                }
            }
            
            // Note: AudioWorklet loading is now deferred to loadAudioWorklet method
            // This allows GUI to be fully rendered before AudioWorklet is created
            
            return '';
        } catch (error) {
            console.error('Audio context initialization error:', error);
            return `Audio Error: ${error.message}`;
        }
    }
    
    /**
     * Load audio worklet and create worklet node
     * This is separated from initAudioContext to allow GUI to be fully rendered first
     * @returns {Promise<string>} - Empty string on success, error message on failure
     */
    async loadAudioWorklet() {
        try {
            if (!this.audioContext) {
                throw new Error('Audio context not initialized');
            }
            
            // Load audio worklet with absolute path
            const currentPath = window.location.pathname;
            const basePath = currentPath.substring(0, currentPath.lastIndexOf('/'));
            
            // Check if AudioWorklet is supported
            if (this.audioContext.audioWorklet) {
                try {
                    await this.audioContext.audioWorklet.addModule(`${basePath}/plugins/audio-processor.js`);
                } catch (error) {
                    console.error('Failed to load audio worklet module:', error);
                    throw new Error(`AudioWorklet failed to load: ${error.message}`);
                }
            } else {
                throw new Error('AudioWorklet is not supported in this browser. Please use a modern browser.');
            }
            
            // Determine low latency mode from preferences
            let preferences = window.audioPreferences;
            if (!preferences && window.electronAPI && window.electronIntegration) {
                preferences = await window.electronIntegration.loadAudioPreferences();
            }
            const lowLatency = preferences?.lowLatencyOutput || false;

            // Create worklet node
            this.workletNode = new AudioWorkletNode(this.audioContext, 'plugin-processor', {
                outputChannelCount: [this.audioContext.destination.channelCount],
                processorOptions: {
                    initialOutputChannelCount: this.audioContext.destination.channelCount,
                    lowLatencyMode: lowLatency
                },
                channelCountMode: 'explicit',
                channelInterpretation: 'discrete'
            });
            window.workletNode = this.workletNode;
            
            // Apply pending audio configuration if exists
            if (this._pendingAudioConfig) {
                this.workletNode.port.postMessage({
                    type: 'updateAudioConfig',
                    outputChannels: this._pendingAudioConfig.outputChannels
                });
                this._pendingAudioConfig = null;
            }

            // Inform processor about low latency mode
            this.workletNode.port.postMessage({
                type: 'setLowLatencyMode',
                enabled: lowLatency
            });
            
            // We'll set up the message handler in the AudioManager class
            // to ensure proper event dispatching
            
            return '';
        } catch (error) {
            console.error('Failed to load audio worklet:', error);
            return `Audio Error: ${error.message}`;
        }
    }
    
    /**
     * Create an offline audio context for rendering
     * @param {number} numberOfChannels - Number of audio channels
     * @param {number} length - Buffer length in samples
     * @param {number} sampleRate - Sample rate in Hz
     * @returns {OfflineAudioContext} - The created offline audio context
     */
    createOfflineContext(numberOfChannels, length, sampleRate) {
        // Handle browser compatibility for OfflineAudioContext
        const OfflineAudioCtx = window.OfflineAudioContext ||
                               window.webkitOfflineAudioContext ||
                               window.mozOfflineAudioContext;
        
        if (!OfflineAudioCtx) {
            throw new Error('OfflineAudioContext is not supported in this browser');
        }
        
        // Create offline context for final rendering
        // Different browsers may have different constructor signatures
        try {
            // Modern constructor with options object
            return new OfflineAudioCtx({
                numberOfChannels,
                length,
                sampleRate
            });
        } catch (error) {
            try {
                // Legacy constructor with separate arguments
                return new OfflineAudioCtx(numberOfChannels, length, sampleRate);
            } catch (legacyError) {
                throw new Error(`Failed to create OfflineAudioContext: ${legacyError.message}`);
            }
        }
    }
    
    /**
     * Close and clean up the audio context
     * @returns {Promise<void>}
     */
    async closeAudioContext() {
        // Restore original connect method if it was overridden
        if (window.originalConnectMethod) {
            try {
                // Restore original connect method
                AudioNode.prototype.connect = window.originalConnectMethod;
                window.originalConnectMethod = null;
            } catch (error) {
                console.warn('Error restoring original connect method:', error);
            }
        }
        
        // Disconnect silence gain if it exists
        if (this.silenceGain) {
            try {
                this.silenceGain.disconnect();
                this.silenceGain = null;
            } catch (error) {
                console.warn('Error disconnecting silence gain:', error);
            }
        }
        
        // Close audio context and clear global reference
        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
            window.audioContext = null;
        }
        
        // Clear worklet node
        this.workletNode = null;
    }
    
    /**
     * Resume the audio context if suspended
     * @returns {Promise<void>}
     */
    async resumeAudioContext() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }
    
    /**
     * Set the flag to skip audio initialization during sample rate change
     * @param {boolean} skip - Whether to skip initialization
     */
    setSkipAudioInitDuringSampleRateChange(skip) {
        this._skipAudioInitDuringSampleRateChange = skip;
    }
    
    /**
     * Get the flag to skip audio initialization during sample rate change
     * @returns {boolean} - Whether to skip initialization
     */
    getSkipAudioInitDuringSampleRateChange() {
        return this._skipAudioInitDuringSampleRateChange;
    }
}