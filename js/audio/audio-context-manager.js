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
        this._resumeGestureHandler = null;
        
        // Initialize global variable if not already set
        if (typeof window.originalConnectMethod === 'undefined') {
            window.originalConnectMethod = null;
        }
    }

    async _loadAudioPreferences() {
        if (window.electronIntegration && typeof window.electronIntegration.loadAudioPreferences === 'function') {
            const preferences = await window.electronIntegration.loadAudioPreferences();
            if (preferences) {
                this._setEffectiveAudioPreferences(preferences);
                return preferences;
            }
        }
        return window.audioPreferences || null;
    }

    _setEffectiveAudioPreferences(preferences) {
        if (!preferences) return null;
        window.audioPreferences = preferences;
        if (window.electronIntegration) {
            window.electronIntegration.audioPreferences = preferences;
        }
        return preferences;
    }

    _isElectronEnvironment() {
        return !!(window.electronAPI ||
            window.electronIntegration?.isElectron ||
            window.electronIntegration?.isElectronEnvironment?.());
    }

    _createAudioContextWithFallback(AudioContext, audioContextOptions) {
        const fallbackOrder = ['sampleRate', 'latencyHint', 'sinkId'];
        const options = { ...audioContextOptions };
        const removedOptions = [];

        while (true) {
            try {
                return {
                    audioContext: new AudioContext(options),
                    options,
                    removedOptions
                };
            } catch (error) {
                const removableOptions = fallbackOrder.filter(option => Object.prototype.hasOwnProperty.call(options, option));
                if (!removableOptions.length) {
                    throw error;
                }

                for (const optionToRemove of removableOptions) {
                    const candidateOptions = { ...options };
                    delete candidateOptions[optionToRemove];
                    try {
                        const audioContext = new AudioContext(candidateOptions);
                        console.warn(`AudioContext rejected ${optionToRemove}; retrying without it:`, error);
                        removedOptions.push(optionToRemove);
                        return {
                            audioContext,
                            options: candidateOptions,
                            removedOptions
                        };
                    } catch {
                        // Try the next single-option fallback before removing a valid preference.
                    }
                }

                const optionToRemove = removableOptions[0];
                console.warn(`AudioContext rejected ${optionToRemove}; retrying without it:`, error);
                delete options[optionToRemove];
                removedOptions.push(optionToRemove);
            }
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
            } else {
                // For web version, default to false
                this.isFirstLaunch = false;
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
                
                const preferences = await this._loadAudioPreferences();

                // Default audio context options
                let audioContextOptions = { };
                
                if (preferences?.sampleRate) {
                    audioContextOptions.sampleRate = preferences.sampleRate;
                }

                // Add latencyHint from preferences if available
                if (preferences?.latencyHint) {
                    audioContextOptions.latencyHint = preferences.latencyHint;
                } else {
                    // Default to interactive if not specified
                    audioContextOptions.latencyHint = 'interactive';
                }

                // Try to set sinkId if available (experimental Chrome/Chromium feature)
                if (preferences?.outputDeviceId && preferences.outputDeviceId !== 'default') {
                    audioContextOptions.sinkId = preferences.outputDeviceId;
                    console.log('Attempting to use sinkId in AudioContext:', preferences.outputDeviceId);
                }
                
                // Create audio context with options
                const contextResult = this._isElectronEnvironment()
                    ? {
                        audioContext: new AudioContext(audioContextOptions),
                        options: audioContextOptions,
                        removedOptions: []
                    }
                    : this._createAudioContextWithFallback(AudioContext, audioContextOptions);
                this.audioContext = contextResult.audioContext;
                console.log('AudioContext created with options:', contextResult.options);
                window.audioContext = this.audioContext; // Global reference
                this.resumeOnUserGesture();
                if (preferences) {
                    this._setEffectiveAudioPreferences({
                        ...preferences,
                        sampleRate: this.audioContext.sampleRate,
                        ...(contextResult.removedOptions.includes('sinkId') ? { outputDeviceId: 'default', outputDeviceLabel: '' } : {})
                    });
                }

                // Detect AudioContext interruption caused by audio device changes on macOS
                this.audioContext.onstatechange = () => {
                    const state = this.audioContext?.state;
                    if (state === 'suspended') {
                        this.audioContext.resume().catch(err =>
                            console.warn('[AudioContext] resume after suspended failed:', err)
                        );
                    } else if (state === 'closed') {
                        console.warn('[AudioContext] closed unexpectedly');
                        // On macOS, ctx going to 'closed' typically means HDMI failed.
                        // reset(null) cannot recover — CoreAudio renderer needs a full
                        // process restart — and reset(null) → closeAudioContext can
                        // itself hang on the same stuck state, looping.  Defer to App's
                        // macOS relaunch handler (gated by cooldown + startup grace).
                        if (window.electronAPI?.platform === 'darwin' && window.app?._doMacosRelaunch) {
                            window.app._doMacosRelaunch().catch(err =>
                                console.error('[AudioContext] _doMacosRelaunch from closed-state failed:', err)
                            );
                        } else if (window.audioManager) {
                            // Other platforms: full reinit. Pass null so _doReset does not call
                            // saveAudioPreferences (which would schedule mainWindow.reload()).
                            window.audioManager.reset(null).catch(err =>
                                console.error('[AudioContext] reset after closed-state failed:', err)
                            );
                        }
                    }
                };
                
                // Set audio context destination channel count based on preferences
                {
                    const activePreferences = window.audioPreferences || preferences;
                    if (activePreferences && activePreferences.outputChannels) {
                        // Check if requested channel count doesn't exceed the maximum supported
                        const maxChannels = this.audioContext.destination.maxChannelCount || 2;
                        const requestedChannels = activePreferences.outputChannels;
                        const actualChannels = requestedChannels > maxChannels ? maxChannels : requestedChannels;
                        
                        // Log channel count information
                        console.log(`Audio output: requested=${requestedChannels}, maximum=${maxChannels}, actual=${actualChannels}`);
                        
                        // Set the channel count to the appropriate value
                        this.audioContext.destination.channelCount = actualChannels;
                        this.audioContext.destination.channelInterpretation = 'discrete';
                        this.audioContext.destination.channelCountMode = 'explicit';
                        
                        // Update global audio preferences for AudioWorklet context
                        activePreferences.outputChannels = actualChannels;
                        activePreferences.sampleRate = this.audioContext.sampleRate;
                        this._setEffectiveAudioPreferences(activePreferences);
                        
                        // Notify the worklet about audio config update
                        // (Will be applied after the worklet is created)
                        this._pendingAudioConfig = {
                            outputChannels: actualChannels
                        };
                    } else {
                        // Default to stereo (2ch)
                        this.audioContext.destination.channelCount = 2;
                        this.audioContext.destination.channelInterpretation = 'discrete';
                        this.audioContext.destination.channelCountMode = 'explicit';
                        this._setEffectiveAudioPreferences({
                            ...(activePreferences || {}),
                            sampleRate: this.audioContext.sampleRate,
                            outputChannels: 2
                        });
                        this._pendingAudioConfig = {
                            outputChannels: 2
                        };
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

    async _addAudioWorkletModule(moduleUrl) {
        let addModuleTimerId;
        await Promise.race([
            this.audioContext.audioWorklet
                .addModule(moduleUrl)
                .finally(() => clearTimeout(addModuleTimerId)),
            new Promise((_, reject) => {
                addModuleTimerId = setTimeout(
                    () => reject(new Error('audioWorklet.addModule timed out after 5000ms')),
                    5000
                );
            })
        ]);
    }

    async _addAudioWorkletModuleFromBlob(moduleUrl) {
        if (typeof fetch !== 'function' ||
            typeof Blob === 'undefined' ||
            typeof URL === 'undefined' ||
            typeof URL.createObjectURL !== 'function') {
            throw new Error('AudioWorklet Blob fallback is not available');
        }

        const response = await fetch(moduleUrl, { cache: 'no-store' });
        if (!response?.ok) {
            throw new Error(`AudioWorklet Blob fallback fetch failed: ${response?.status ?? 'unknown'}`);
        }

        const source = await response.text();
        const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        try {
            await this._addAudioWorkletModule(blobUrl);
        } finally {
            if (typeof URL.revokeObjectURL === 'function') {
                URL.revokeObjectURL(blobUrl);
            }
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
                    const moduleUrl = `${basePath}/plugins/audio-processor.js`;
                    try {
                        // addModule can hang on macOS audio-system flux; apply a 5 s timeout
                        // so the recovery path does not stall here.
                        await this._addAudioWorkletModule(moduleUrl);
                    } catch (moduleError) {
                        if (moduleError.message?.includes('already')) {
                            throw moduleError;
                        }
                        if (!moduleError.message) {
                            throw moduleError;
                        }
                        try {
                            await this._addAudioWorkletModuleFromBlob(moduleUrl);
                        } catch (fallbackError) {
                            if (fallbackError.message?.includes('not available') ||
                                moduleError.message?.includes('timed out')) {
                                throw moduleError;
                            }
                            throw fallbackError;
                        }
                    }
                } catch (error) {
                    // If module is already registered (reconnect recovery), ignore and continue
                    if (!error.message?.includes('already')) {
                        console.error('Failed to load audio worklet module:', error);
                        throw new Error(`AudioWorklet failed to load: ${error.message}`);
                    }
                }
            } else {
                throw new Error('AudioWorklet is not supported in this browser. Please use a modern browser.');
            }
            
            // Determine low latency mode from preferences
            let preferences = window.audioPreferences;
            if (!preferences) {
                preferences = await this._loadAudioPreferences();
            }
            const lowLatency = preferences?.lowLatencyOutput || false;

            // Create worklet node
            this.workletNode = new AudioWorkletNode(this.audioContext, 'plugin-processor', {
                channelCount: this.audioContext.destination.channelCount,
                outputChannelCount: [this.audioContext.destination.channelCount],
                processorOptions: {
                    initialOutputChannelCount: this.audioContext.destination.channelCount,
                    lowLatencyMode: lowLatency
                },
                channelCountMode: 'explicit',
                channelInterpretation: 'discrete'
            });
            window.workletNode = this.workletNode;
            // Remember the low-latency mode so any auxiliary worklet (e.g. the
            // Double Blind Test parallel pipeline) can be created to match.
            this.lowLatencyMode = lowLatency;

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
        this.stopResumeOnUserGesture();

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
            // Detach handler before close to prevent spurious 'closed' state trigger
            this.audioContext.onstatechange = null;
            // close() can hang indefinitely on macOS when HDMI is in a stuck CoreAudio
            // state (the renderer cannot release the device).  Apply a 5 s timeout and
            // continue regardless so the app does not freeze.  Any leaked resources are
            // reclaimed when the new context is created or when app.relaunch() runs.
            let closeTimerId;
            try {
                await Promise.race([
                    this.audioContext.close().finally(() => clearTimeout(closeTimerId)),
                    new Promise((_, reject) => {
                        closeTimerId = setTimeout(
                            () => reject(new Error('audioContext.close timed out after 5 s')),
                            5000
                        );
                    })
                ]);
            } catch (err) {
                console.warn('[closeAudioContext] close() failed or timed out:', err.message);
            }
            this.audioContext = null;
            window.audioContext = null;
        }
        
        // Clear worklet node
        if (window.workletNode && (!this.workletNode || window.workletNode === this.workletNode)) {
            window.workletNode = null;
        }
        this.workletNode = null;
    }
    
    /**
     * Resume the audio context if suspended
     * @returns {Promise<void>}
     */
    async resumeAudioContext() {
        if (this.audioContext && this.audioContext.state === 'running') {
            this.stopResumeOnUserGesture();
            return;
        }

        if (this.audioContext && this.audioContext.state === 'suspended') {
            // resume() can hang when the AudioContext's sinkId points to an HDMI device
            // that CoreAudio hasn't finished initialising yet.  Use a timeout so that
            // a reconnect-triggered reset never freezes the app.  The HDMI retry
            // mechanism will restore audio once the device is ready.
            let timerId;
            await Promise.race([
                this.audioContext.resume().finally(() => clearTimeout(timerId)),
                new Promise(resolve => { timerId = setTimeout(resolve, 10000); })
            ]).catch(() => {});
            if (this.audioContext?.state !== 'running') {
                console.warn('[AudioContext] resumeAudioContext: context not running after resume attempt, state:', this.audioContext?.state);
            } else {
                this.stopResumeOnUserGesture();
            }
        }
    }

    /**
     * Register a web gesture hook that unlocks suspended AudioContexts.
     * Touch input grants user activation at pointerup/touchend, not at
     * pointerdown (which activates only for mouse), so listen on the
     * activation-granting events and keep the hook armed until the context
     * is actually running: resumeAudioContext() deregisters it on success.
     */
    resumeOnUserGesture() {
        if (this._isElectronEnvironment() ||
            this._resumeGestureHandler ||
            !this.audioContext ||
            this.audioContext.state !== 'suspended' ||
            typeof document === 'undefined' ||
            typeof document.addEventListener !== 'function') {
            return;
        }

        const handler = () => {
            this.resumeAudioContext().catch(error => {
                console.warn('[AudioContext] resume on user gesture failed:', error);
            });
        };

        this._resumeGestureHandler = handler;
        document.addEventListener('pointerup', handler, { passive: true });
        document.addEventListener('touchend', handler, { passive: true });
        document.addEventListener('keydown', handler);
    }

    /**
     * Remove the pending gesture resume hook (called once resume succeeds).
     */
    stopResumeOnUserGesture() {
        if (!this._resumeGestureHandler ||
            typeof document === 'undefined' ||
            typeof document.removeEventListener !== 'function') {
            this._resumeGestureHandler = null;
            return;
        }

        document.removeEventListener('pointerup', this._resumeGestureHandler);
        document.removeEventListener('touchend', this._resumeGestureHandler);
        document.removeEventListener('keydown', this._resumeGestureHandler);
        this._resumeGestureHandler = null;
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
