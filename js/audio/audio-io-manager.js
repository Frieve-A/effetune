/**
 * Prefix used to identify the non-fatal mic-denied warning returned by initAudioInput().
 * Callers (e.g. AudioManager._doReset) test against this prefix to distinguish a
 * recoverable mic-permission failure from a fatal context/output failure.  Keep this
 * exported so the prefix and the message stay coupled.
 */
export const MIC_DENIED_PREFIX = 'Audio Error: Microphone access denied';

/**
 * AudioIOManager - Manages audio input and output devices
 */
export class AudioIOManager {
    /**
     * Create a new AudioIOManager instance
     * @param {Object} contextManager - Reference to the AudioContextManager
     */
    constructor(contextManager) {
        this.contextManager = contextManager;
        this.stream = null;
        this.sourceNode = null;
        this.destinationNode = null;
        this.audioElement = null;
        this.defaultDestinationConnection = null;
        this.silenceNode = null;
        // GainNode inserted between worklet and the final destination (audioContext
        // .destination or MediaStreamDestination). Starts at 0 so nothing reaches
        // the speakers until the host calls fadeInOutput() at the end of the
        // startup sequence — i.e. after every updatePlugins (saved state, startup
        // preset, pending tray/CLI preset, etc.) has settled into the worklet.
        this.outputGainNode = null;
        // When true, connect worklet output directly to AudioContext.destination
        // Used for multichannel and low-latency stereo modes
        this.directOutputMode = false;
        // When true, output is routed via AudioContext.setSinkId() directly.
        // This bypasses the MediaStream/audioElement path and uses the WebAudio
        // engine's own CoreAudio renderer, which may be more reliable for HDMI.
        this.audioContextSinkMode = false;
        this.currentOutputDeviceId = null;
        this._devicePollIntervalId = null;
        this._pollDeviceWasAbsent = false;
        // Guard against overlapping poll tick executions
        this._pollRunning = false;
    }
    
    /**
     * Initialize audio input (microphone)
     * @returns {Promise<string>} - Empty string on success, error message on failure
     */
    async initAudioInput({ deferInput = false } = {}) {
        try {
            if (deferInput) {
                this.createSilentSourceFallback();
                return '';
            }

            // Variable to store microphone error message
            let microphoneError = null;
            
            // Flag to track if we're using microphone input
            let usingMicrophoneInput = true;
            
            // Check if we're running in Electron and have audio preferences
            let audioConstraints = {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            };

            // If running in Electron, try to use saved audio preferences
            if (window.electronAPI && window.electronIntegration) {
                const preferences = await window.electronIntegration.loadAudioPreferences();
                if (preferences && preferences.inputDeviceId) {
                    audioConstraints.deviceId = { exact: preferences.inputDeviceId };
                } else {
                    console.log('No audio preferences found or no input device specified, using default audio input');
                    // Use default input device by not specifying deviceId
                }
            }

            // On macOS, trigger TCC permission dialog from the main process before getUserMedia.
            // We ignore the return value and let getUserMedia() be the final arbiter —
            // askForMediaAccess can return false for ad-hoc signed builds even when
            // System Settings shows the permission as allowed.
            if (window.electronAPI && window.electronAPI.requestMicrophoneAccess) {
                await window.electronAPI.requestMicrophoneAccess();
            }

            // Try to get user media with audio constraints
            let lastMicError = null;
            try {
                this.stream = await this._getUserMediaWithTimeout({
                    audio: audioConstraints
                });
            } catch (error) {
                lastMicError = error;
                // If failed with saved device, try again with default device
                if (audioConstraints.deviceId) {
                    console.warn('Failed to use saved audio input device, falling back to default:', error.name, error.message);
                    delete audioConstraints.deviceId;
                    try {
                        this.stream = await this._getUserMediaWithTimeout({
                            audio: audioConstraints
                        });
                        lastMicError = null;
                    } catch (innerError) {
                        // If permission is denied, try to clear permission overrides and ask again.
                        // This recovers cases where Chromium's permission cache rejects despite
                        // the user actually having granted access (commonly seen on Windows/Linux,
                        // and on macOS ad-hoc signed builds where requestMicrophoneAccess returns false).
                        if (innerError.name === 'NotAllowedError' || innerError.name === 'PermissionDeniedError') {
                            if (window.electronAPI && window.electronAPI.clearMicrophonePermission) {
                                console.log('Microphone permission denied, attempting to clear permission overrides');
                                try {
                                    await window.electronAPI.clearMicrophonePermission();
                                    // Try one more time after clearing permissions
                                    this.stream = await this._getUserMediaWithTimeout({
                                        audio: audioConstraints
                                    });
                                    lastMicError = null;
                                } catch (finalError) {
                                    lastMicError = finalError;
                                    console.warn('Failed to get microphone access after clearing permissions:', finalError);
                                    usingMicrophoneInput = false;
                                }
                            } else {
                                console.warn('Microphone permission denied:', innerError);
                                usingMicrophoneInput = false;
                            }
                        } else {
                            console.warn('Failed to get microphone access:', innerError);
                            usingMicrophoneInput = false;
                        }
                    }
                } else if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                    // If permission is denied on first attempt, try to clear permission overrides and ask again
                    if (window.electronAPI && window.electronAPI.clearMicrophonePermission) {
                        console.log('Microphone permission denied, attempting to clear permission overrides');
                        try {
                            await window.electronAPI.clearMicrophonePermission();
                            // Try one more time after clearing permissions
                            this.stream = await this._getUserMediaWithTimeout({
                                audio: audioConstraints
                            });
                            lastMicError = null;
                        } catch (finalError) {
                            lastMicError = finalError;
                            console.warn('Failed to get microphone access after clearing permissions:', finalError);
                            usingMicrophoneInput = false;
                        }
                    } else {
                        console.warn('Microphone permission denied:', error);
                        usingMicrophoneInput = false;
                    }
                } else {
                    console.warn('Failed to get microphone access:', error.name, error.message);
                    usingMicrophoneInput = false;
                }
            }

            // If we have microphone access, create source from stream
            if (usingMicrophoneInput && this.stream) {
                this.sourceNode = this.contextManager.audioContext.createMediaStreamSource(this.stream);
            } else {
                this.createSilentSourceFallback();
                
                // Log message for Electron users
                if (window.electronAPI && window.electronIntegration) {
                    console.log('Microphone access not available. Music file playback mode will still work.');
                }
                
                // Store the error message if microphone access was denied, but don't return it yet
                // This allows us to continue setting up the audio nodes for playback
                if (!usingMicrophoneInput) {
                    // Use the same error format as before so app.js can detect it properly.
                    // The MIC_DENIED_PREFIX shared constant guarantees the prefix stays in
                    // sync with AudioManager._doReset's startsWith() check.
                    microphoneError = `${MIC_DENIED_PREFIX}. Music file playback mode will still work.`;
                }
            }
            
            // Return microphone error if there was one
            return microphoneError || '';
        } catch (error) {
            console.error('Audio input initialization error:', error);
            return `Audio Error: ${error.message}`;
        }
    }

    createSilentSourceFallback() {
        console.log('Creating stereo-compatible silent source as fallback');
        const bufferSize = this.contextManager.audioContext.sampleRate * 2;
        const silentBuffer = this.contextManager.audioContext.createBuffer(
            2,
            bufferSize,
            this.contextManager.audioContext.sampleRate
        );
        const bufferSource = this.contextManager.audioContext.createBufferSource();
        bufferSource.buffer = silentBuffer;
        bufferSource.loop = true;
        const gainNode = this.contextManager.audioContext.createGain();
        gainNode.gain.value = 0;
        bufferSource.connect(gainNode);
        bufferSource.start();
        this.sourceNode = gainNode;
    }
    
    /**
     * Initialize audio output
     * @returns {Promise<string>} - Empty string on success, error message on failure
     */
    async initAudioOutput() {
        try {
            // Create the output gain node up front so every connect path below
            // can route worklet output through it. Starts muted (gain=0); the host
            // ramps to 1 via AudioManager.fadeInOutput() once the full startup
            // pipeline chain (including any pending preset loads) is in place.
            this.outputGainNode = this.contextManager.audioContext.createGain();
            this.outputGainNode.gain.value = 0;

            // For Electron, check if we're using multichannel output
            const preferences = window.electronAPI && window.electronIntegration ?
                await window.electronIntegration.loadAudioPreferences() : null;
            const isMultiChannel = preferences && preferences.outputChannels && preferences.outputChannels > 2;
            const lowLatencyStereo = preferences && preferences.outputChannels === 2 && preferences.lowLatencyOutput;
            
            // For multichannel mode, we'll use direct connection to AudioContext.destination
            // rather than MediaStreamDestination which only supports stereo
            if (isMultiChannel || lowLatencyStereo) {
                console.log(`Using direct connection for ${preferences.outputChannels} channel output${lowLatencyStereo ? ' (low latency)' : ''}`);
                // Skip MediaStreamDestination for multichannel mode
                this.destinationNode = null;
                this.directOutputMode = true;
                return '';
            }
            
            // For standard stereo mode, use MediaStreamDestination
            try {
                if (typeof this.contextManager.audioContext.createMediaStreamDestination === 'function') {
                    this.destinationNode = this.contextManager.audioContext.createMediaStreamDestination();
                } else {
                    console.warn('createMediaStreamDestination is not supported in this browser');
                    // Fall back to default destination only
                    this.destinationNode = null;
                }
            } catch (error) {
                console.error('Error creating MediaStreamDestination:', error);
                // Fall back to default destination only
                this.destinationNode = null;
                return `Audio Error: Failed to create audio destination: ${error.message}`;
            }
            
            // For Electron, prepare audio output device (only in stereo mode)
            if (!isMultiChannel && window.electronAPI && window.electronIntegration) {
                // Route output through AudioContext.setSinkId() if the API is available.
                // This uses Chromium's WebAudio CoreAudio renderer instead of the
                // HTMLMediaElement renderer.  On macOS, these are separate code paths and
                // the WebAudio path is more reliable for HDMI reconnect recovery.
                if (preferences?.outputDeviceId &&
                    typeof this.contextManager.audioContext?.setSinkId === 'function') {
                    this.audioContextSinkMode = true;
                    this.destinationNode = null; // use audioContext.destination via connectAudioNodes fallback
                    this.currentOutputDeviceId = preferences.outputDeviceId;
                    try {
                        // 3 s timeout instead of the default 10 s — on macOS HDMI flux,
                        // setSinkId can hang and we want to fail fast and continue with
                        // a usable (default-sink) audio context.
                        await this._setSinkIdWithTimeout(this.contextManager.audioContext, preferences.outputDeviceId, 3000);
                    } catch (e) {
                        console.warn('[audioCtxSink] setSinkId failed:', e.message);
                    }
                    if (window.electronIntegration?.isElectronEnvironment?.()) {
                        this.startDevicePoll(
                            () => window.electronIntegration.loadAudioPreferences(),
                            // On macOS HDMI (audioContextSinkMode), reset(null) cannot recover —
                            // CoreAudio renderer needs full process restart.  Defer to App's
                            // macOS relaunch handler (which is gated by cooldown + startup grace).
                            // Otherwise pass null so _doReset does not call saveAudioPreferences,
                            // which would schedule a mainWindow.reload() and undo the recovery.
                            () => {
                                if (window.electronAPI?.platform === 'darwin' && window.app?._doMacosRelaunch) {
                                    return window.app._doMacosRelaunch();
                                }
                                return window.audioManager?.reset(null) ?? Promise.resolve();
                            },
                            false
                        );
                    }
                    return '';
                }

                // Rest of function continues for stereo output with device selection...
                if (preferences && preferences.outputDeviceId) {
                    try {
                        // Create a new audio element for actual use
                        if (this.audioElement) {
                            this.audioElement.pause();
                            this.audioElement.srcObject = null;
                        }
                        
                        this.audioElement = new Audio();
                        this.audioElement.autoplay = true;
                        this.audioElement.volume = 1.0;
                        this.audioElement.muted = false;
                        
                        // Check for Audio Output Devices API support
                        // The setSinkId method is part of the Audio Output Devices API
                        const hasSinkIdSupport =
                            typeof this.audioElement.setSinkId === 'function';
                        
                        if (hasSinkIdSupport) {
                            try {
                                // Get available devices - this doesn't require microphone permission
                                let outputDevice = null;
                                
                                try {
                                    // Try to enumerate devices - this works even without microphone permission
                                    if (typeof navigator.mediaDevices !== 'undefined' &&
                                        typeof navigator.mediaDevices.enumerateDevices === 'function') {
                                        const devices = await navigator.mediaDevices.enumerateDevices();
                                        outputDevice = devices.find(device =>
                                            device.kind === 'audiooutput' &&
                                            device.deviceId === preferences.outputDeviceId
                                        );
                                    }
                                } catch (enumError) {
                                    console.warn('Failed to enumerate devices:', enumError);
                                    // Continue with the saved device ID even if we can't verify it exists
                                }
                                
                                if (outputDevice) {
                                    await this.audioElement.setSinkId(preferences.outputDeviceId);
                                    this.currentOutputDeviceId = preferences.outputDeviceId;
                                } else {
                                    // Try to use the saved device ID directly even if we couldn't verify it
                                    try {
                                        await this.audioElement.setSinkId(preferences.outputDeviceId);
                                        this.currentOutputDeviceId = preferences.outputDeviceId;
                                    } catch (directSinkError) {
                                        console.warn('Failed to set audio output to saved device, using default:', directSinkError);
                                        // Fall back to default device
                                        await this.audioElement.setSinkId('default');
                                        this.currentOutputDeviceId = 'default';
                                    }
                                }
                                
                                // Now set the srcObject after sinkId is set
                                if (this.destinationNode && this.destinationNode.stream) {
                                    this.audioElement.srcObject = this.destinationNode.stream;
                                } else {
                                    console.warn('No destination stream available');
                                    // We already have a default connection from above
                                }
                                
                                // Explicitly call play()
                                try {
                                    await this.audioElement.play();
                                } catch (playError) {
                                    console.warn('Failed to play audio:', playError);
                                    // We already have a default connection from above
                                }
                            } catch (sinkError) {
                                console.warn('Failed to set audio output device:', sinkError);
                                // We already have a default connection from above
                                
                                // Still try to use the audio element as a fallback
                                if (this.destinationNode && this.destinationNode.stream) {
                                    this.audioElement.srcObject = this.destinationNode.stream;
                                }
                            }
                        } else {
                            console.warn('Audio Output Devices API not supported in this browser');
                            // We already have a default connection from above
                            
                            // Still try to use the audio element as a fallback
                            if (this.destinationNode && this.destinationNode.stream) {
                                this.audioElement.srcObject = this.destinationNode.stream;
                            }
                        }
                        
                        // Add event listeners for debugging
                        this.audioElement.addEventListener('error', (e) => {
                            // If there's an error with the audio element, make sure we're using the default output
                            // We already have a default connection from above
                        });
                    } catch (error) {
                        console.warn('Error setting up audio element with preferences:', error);
                        // We already have a default connection from above
                    }
                } else {
                    console.log('No audio preferences found or no output device specified, using default audio output');
                    
                    // Create a new audio element for the default device
                    try {
                        if (this.audioElement) {
                            this.audioElement.pause();
                            this.audioElement.srcObject = null;
                        }
                        
                        this.audioElement = new Audio();
                        this.audioElement.autoplay = true;
                        this.audioElement.volume = 1.0;
                        this.audioElement.muted = false;
                        
                        // Check for Audio Output Devices API support
                        const hasSinkIdSupport = typeof this.audioElement.setSinkId === 'function';
                        
                        if (hasSinkIdSupport) {
                            // Set to default device explicitly
                            try {
                                await this.audioElement.setSinkId('default');
                                console.log('Audio output set to default device');
                                this.currentOutputDeviceId = 'default';
                            } catch (sinkError) {
                                console.warn('Failed to set audio output to default device:', sinkError);
                            }
                        }
                        
                        // Connect to destination if available
                        if (this.destinationNode && this.destinationNode.stream) {
                            this.audioElement.srcObject = this.destinationNode.stream;
                            
                            // Explicitly call play()
                            try {
                                await this.audioElement.play();
                            } catch (playError) {
                                console.warn('Failed to play audio:', playError);
                                // Fall back to default output
                                this.defaultDestinationConnection = this.contextManager.workletNode.connect(this.contextManager.audioContext.destination);
                            }
                        } else {
                            // If no destination stream, connect worklet to default destination
                            this.defaultDestinationConnection = this.contextManager.workletNode.connect(this.contextManager.audioContext.destination);
                        }
                        
                        // Ensure proper multichannel configuration for the destination connection
                        if (this.contextManager.audioContext.destination.channelCount > 2) {
                            this.contextManager.audioContext.destination.channelCountMode = 'explicit';
                            this.contextManager.audioContext.destination.channelInterpretation = 'discrete';
                        }
                        
                        // Add event listeners for debugging
                        this.audioElement.addEventListener('error', (e) => {
                            // If there's an error with the audio element, make sure we're using the default output
                            if (!this.defaultDestinationConnection) {
                                this.defaultDestinationConnection = this.contextManager.workletNode.connect(this.contextManager.audioContext.destination);
                            }
                        });
                    } catch (error) {
                        console.warn('Error setting up default audio device:', error);
                        // Ensure we have audio output in case of error
                        if (!this.defaultDestinationConnection) {
                            this.defaultDestinationConnection = this.contextManager.workletNode.connect(this.contextManager.audioContext.destination);
                        }
                    }
                }
            }
            
            // If this is the first launch, set up a processor to mute audio output
            if (this.contextManager.isFirstLaunch && window.electronIntegration && window.electronIntegration.isElectron) {
                // Create a script processor node to zero-fill audio output
                const bufferSize = 4096;
                // Handle vendor prefixes for ScriptProcessorNode (deprecated but still used)
                let silenceNode;
                if (typeof this.contextManager.audioContext.createScriptProcessor === 'function') {
                    silenceNode = this.contextManager.audioContext.createScriptProcessor(bufferSize, 2, 2);
                } else if (typeof this.contextManager.audioContext.createJavaScriptNode === 'function') {
                    // Older browsers used createJavaScriptNode
                    silenceNode = this.contextManager.audioContext.createJavaScriptNode(bufferSize, 2, 2);
                } else {
                    console.warn('ScriptProcessorNode is not supported in this browser');
                    // Skip silence node creation and continue with normal audio output
                    return '';
                }
                
                silenceNode.onaudioprocess = (e) => {
                    // Get output buffer
                    const outputL = e.outputBuffer.getChannelData(0);
                    const outputR = e.outputBuffer.getChannelData(1);
                    
                    // Fill with zeros (silence)
                    for (let i = 0; i < outputL.length; i++) {
                        outputL[i] = 0;
                        outputR[i] = 0;
                    }
                };
                
                // Insert the silence node between worklet and destination
                try {
                    // Only disconnect if connected
                    if (this.destinationNode) {
                        this.contextManager.workletNode.disconnect(this.destinationNode);
                    }
                    this.contextManager.workletNode.connect(silenceNode);
                    silenceNode.connect(this.destinationNode);
                } catch (error) {
                    console.warn('Error connecting silence node:', error);
                    // Fall back to direct connection if there's an error
                    if (this.destinationNode) {
                        this.contextManager.workletNode.connect(this.destinationNode);
                    }
                }
                
                // Store reference to remove on cleanup
                this.silenceNode = silenceNode;
            }
            
            // Start polling fallback for HDMI reconnection (macOS devicechange unreliable)
            if (window.electronIntegration?.isElectronEnvironment?.() && this.audioElement) {
                // If the audio element ended up on a different device than preferred (fallback after
                // disconnect), treat the preferred device as absent so the first poll tick that finds
                // it back triggers a full reset rather than a reapply.
                const pollInitiallyAbsent = preferences?.outputDeviceId
                    ? this.audioElement.sinkId !== preferences.outputDeviceId
                    : false;
                this.startDevicePoll(
                    () => window.electronIntegration.loadAudioPreferences(),
                    // On macOS, reset(null) cannot recover from stuck CoreAudio state —
                    // route to App's macOS relaunch handler instead (gated by cooldown +
                    // startup grace).  Otherwise pass null so _doReset does not call
                    // saveAudioPreferences, which would schedule a mainWindow.reload().
                    () => {
                        if (window.electronAPI?.platform === 'darwin' && window.app?._doMacosRelaunch) {
                            return window.app._doMacosRelaunch();
                        }
                        return window.audioManager?.reset(null) ?? Promise.resolve();
                    },
                    pollInitiallyAbsent
                );
            }

            return '';
        } catch (error) {
            console.error('Audio output initialization error:', error);
            return `Audio Error: ${error.message}`;
        }
    }
    
    /**
     * Connect audio nodes
     * @returns {Promise<string>} - Empty string on success, error message on failure
     */
    async connectAudioNodes() {
        try {
            // Connect source to worklet
            try {
                // Make sure both nodes exist
                if (!this.sourceNode || !this.contextManager.workletNode || !this.outputGainNode) {
                    console.error('Source, worklet, or outputGain node is missing');
                    return `Audio Error: Audio initialization incomplete - missing audio nodes`;
                }

                // Use the original connect method to avoid any overridden connect methods
                if (window.originalConnectMethod && this.contextManager.isFirstLaunch) {
                    window.originalConnectMethod.call(this.sourceNode, this.contextManager.workletNode);
                } else {
                    this.sourceNode.connect(this.contextManager.workletNode);
                }
            } catch (error) {
                console.error('Error connecting source to worklet:', error);
                return `Audio Error: Failed to connect audio nodes: ${error.message}`;
            }

            // Insert outputGainNode between the worklet and the physical sink.
            // gain=0 here keeps the path silent during startup/reset; the host
            // ramps to 1 after the pipeline chain has fully settled.
            try {
                this.contextManager.workletNode.connect(this.outputGainNode);
            } catch (error) {
                console.error('Error connecting worklet to output gain:', error);
                return `Audio Error: Failed to connect output gain: ${error.message}`;
            }

            // Connect outputGainNode to the actual sink based on our mode.
            if (this.directOutputMode) {
                try {
                    this.defaultDestinationConnection = this.outputGainNode.connect(this.contextManager.audioContext.destination);

                    // Ensure proper multichannel configuration
                    this.contextManager.audioContext.destination.channelCountMode = 'explicit';
                    this.contextManager.audioContext.destination.channelInterpretation = 'discrete';
                } catch (error) {
                    console.error('Error connecting direct output:', error);
                    return `Audio Error: Failed to connect direct output: ${error.message}`;
                }
            } else if (this.destinationNode) {
                try {
                    this.outputGainNode.connect(this.destinationNode);
                } catch (error) {
                    console.error('Error connecting outputGain to destination:', error);
                    return `Audio Error: Failed to connect to audio destination: ${error.message}`;
                }
            } else {
                try {
                    this.defaultDestinationConnection = this.outputGainNode.connect(this.contextManager.audioContext.destination);
                } catch (error) {
                    console.error('Error connecting to default audio destination:', error);
                    return `Audio Error: Failed to connect to default audio destination: ${error.message}`;
                }
            }

            // For web app (non-Electron), always route to default destination.
            if (!window.electronAPI || !window.electronIntegration) {
                try {
                    this.outputGainNode.disconnect();
                } catch (e) { /* ignore */ }

                try {
                    this.defaultDestinationConnection = this.outputGainNode.connect(this.contextManager.audioContext.destination);

                    // Ensure proper multichannel configuration for the destination
                    if (this.contextManager.audioContext.destination.channelCount > 2) {
                        this.contextManager.audioContext.destination.channelCountMode = 'explicit';
                        this.contextManager.audioContext.destination.channelInterpretation = 'discrete';
                    }
                } catch (error) {
                    console.error('Error connecting to default audio destination:', error);
                    return `Audio Error: Failed to connect to default audio destination: ${error.message}`;
                }
            }
            
            return '';
        } catch (error) {
            console.error('Error connecting audio nodes:', error);
            return `Audio Error: ${error.message}`;
        }
    }
    
    /**
     * Create a fallback silent source node
     * @returns {AudioNode} - The created source node
     */
    createFallbackSilentSource() {
        console.warn('Source node missing, creating fallback silent source');
        // Create a silent source node as fallback
        const bufferSize = this.contextManager.audioContext.sampleRate * 2;
        const silentBuffer = this.contextManager.audioContext.createBuffer(2, bufferSize, this.contextManager.audioContext.sampleRate);
        const bufferSource = this.contextManager.audioContext.createBufferSource();
        bufferSource.buffer = silentBuffer;
        bufferSource.loop = true;
        
        const gainNode = this.contextManager.audioContext.createGain();
        gainNode.gain.value = 0;
        
        bufferSource.connect(gainNode);
        bufferSource.start();

        return gainNode;
    }

    /**
     * Reapply the currently saved output device to the audio element
     * @param {string} deviceId - Output device ID
     * @returns {Promise<boolean>} Success status
     */
    async reapplyOutputDevice(deviceId) {
        // Use a shorter timeout (3 s) for runtime reapply than the 10 s used at init,
        // so that macOS HDMI stuck states fail fast and route to the relaunch fallback
        // instead of leaving the UI unresponsive for 10 s during multi-display flux.
        const RUNTIME_SETSINK_TIMEOUT_MS = 3000;
        const ctx = this.contextManager?.audioContext;
        if (this.audioContextSinkMode && typeof ctx?.setSinkId === 'function') {
            try {
                // setSinkId can hang indefinitely on macOS when HDMI is in a
                // re-re-connect / multi-display flux state — use the timeout wrapper.
                await this._setSinkIdWithTimeout(ctx, deviceId, RUNTIME_SETSINK_TIMEOUT_MS);
                this.currentOutputDeviceId = deviceId;
                console.log('Reapplied output device (ctx):', deviceId);
                return true;
            } catch (error) {
                console.warn('Failed to reapply output device (ctx):', error);
                return false;
            }
        }
        if (!this.audioElement || typeof this.audioElement.setSinkId !== 'function') {
            return false;
        }
        try {
            // Same hang risk on the audio-element renderer path — wrap with timeout.
            await this._setSinkIdWithTimeout(this.audioElement, deviceId, RUNTIME_SETSINK_TIMEOUT_MS);
            this.currentOutputDeviceId = deviceId;
            if (this.destinationNode && this.destinationNode.stream) {
                this.audioElement.srcObject = this.destinationNode.stream;
            }
            try {
                await this.audioElement.play();
            } catch (e) {
                // Ignore play errors
            }
            console.log('Reapplied output device (el):', deviceId);
            return true;
        } catch (error) {
            console.warn('Failed to reapply output device (el):', error);
            return false;
        }
    }
    
    /**
     * Start periodic polling to verify audio output device is active.
     * Fallback for macOS where HDMI reconnection may not trigger devicechange.
     * @param {Function} getPrefs - async function returning saved preferences
     * @param {Function} onReset  - async function(prefs) for full reinit
     */
    startDevicePoll(getPrefs, onReset, initiallyAbsent = false) {
        this.stopDevicePoll();
        this._pollDeviceWasAbsent = initiallyAbsent;
        this._devicePollIntervalId = setInterval(async () => {
            if (!window.electronIntegration?.isElectronEnvironment?.()) return;
            // Skip if a previous poll tick is still running (avoids stacking)
            if (this._pollRunning) return;
            this._pollRunning = true;
            try { await this._pollTick(getPrefs, onReset); } finally { this._pollRunning = false; }
        }, 4000);
    }

    async _pollTick(getPrefs, onReset) {
        // On macOS, skip the poll's recovery actions during the 10 s startup grace
        // (was 30 s — kept in sync with App._doMacosRelaunch's grace window).
        if (window.electronAPI?.platform === 'darwin' && window.app?._appStartTime) {
            const elapsed = Date.now() - window.app._appStartTime;
            if (elapsed < 10000) {
                return;
            }
        }

        let prefs;
        try { prefs = await getPrefs(); } catch (e) {
            console.warn('[_pollTick] Failed to load audio preferences:', e.message);
            return;
        }
        if (!prefs || !prefs.outputDeviceId) return;

        let devices;
        try { devices = await navigator.mediaDevices.enumerateDevices(); } catch (e) {
            console.warn('[_pollTick] Failed to enumerate devices:', e.message);
            return;
        }

        const outputs = devices.filter(d => d.kind === 'audiooutput');

        // Try exact ID match first; fall back to label match (HDMI may get new ID on reconnect)
        let foundDevice = outputs.find(d => d.deviceId === prefs.outputDeviceId);
        let foundByLabel = false;
        if (!foundDevice && prefs.outputDeviceLabel) {
            foundDevice = outputs.find(d => d.label === prefs.outputDeviceLabel);
            foundByLabel = !!foundDevice;
        }

        const wasAbsent = this._pollDeviceWasAbsent;
        this._pollDeviceWasAbsent = !foundDevice;

        // Current sinkId: use AudioContext or audioElement depending on mode
        const ctx = this.contextManager?.audioContext;
        const el = this.audioContextSinkMode ? null : this.audioElement;
        const currentSinkId = this.audioContextSinkMode
            ? (ctx?.sinkId ?? 'no-ctx')
            : (el?.sinkId ?? 'no-element');

        if (!foundDevice) return;
        if (!this.audioContextSinkMode && !el) return;

        const activeDeviceId = foundDevice.deviceId;
        const updatedPrefs = foundByLabel ? { ...prefs, outputDeviceId: activeDeviceId } : prefs;


        // Stuck non-'running' AudioContext check.
        // Even when sinkId already matches and the device is present, the underlying
        // CoreAudio renderer can stay in a 'suspended' state after macOS HDMI flux
        // (the user perceives this as audio is dead but UI is alive — the original
        // freeze report).  Recovery: try a quick resume; if it does not bring the
        // ctx back to 'running', defer to onReset (= _doMacosRelaunch on macOS).
        if (this.audioContextSinkMode && ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
            try {
                await Promise.race([
                    ctx.resume(),
                    new Promise(resolve => setTimeout(resolve, 3000))
                ]);
            } catch (e) {
            }
            if (ctx.state !== 'running') {
                try {
                    await onReset(updatedPrefs);
                } catch (e) {
                }
                return;
            }
            return;
        }

        if (currentSinkId !== activeDeviceId || foundByLabel) {
            // sinkId mismatch or device got a new ID — full reset needed
            if (wasAbsent || foundByLabel) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            try {
                await onReset(updatedPrefs);
            } catch (e) {
                console.error('[_pollTick] onReset failed (sinkId mismatch path):', e.message ?? e);
            }
        } else if (wasAbsent) {
            // sinkId is already correct after reconnect.
            // If the context is already running, the devicechange handler handled
            // the reconnect — don't interfere with another toggle.
            if (this.audioContextSinkMode && ctx?.state === 'running') return;

            // Context is not running — do a light toggle + resume.
            try {
                if (this.audioContextSinkMode && ctx) {
                    await this._setSinkIdWithTimeout(ctx, '');
                    await new Promise(r => setTimeout(r, 1000));
                    await this._setSinkIdWithTimeout(ctx, activeDeviceId);
                    await Promise.race([
                        ctx.resume(),
                        new Promise(resolve => setTimeout(resolve, 15000))
                    ]).catch(() => {});
                    if (ctx.state === 'running') {
                        await window.audioManager?.rebuildPipeline(false).catch(() => {});
                    }
                } else if (el) {
                    await this._setSinkIdWithTimeout(el, 'default');
                    await new Promise(r => setTimeout(r, 300));
                    await this._setSinkIdWithTimeout(el, activeDeviceId);
                    if (this.destinationNode?.stream) el.srcObject = this.destinationNode.stream;
                    await el.play().catch(() => {});
                }
            } catch (e) {
                console.warn('[_pollTick] toggle+resume failed, falling back to full reset:', e.message ?? e);
                await onReset(updatedPrefs);
            }
        } else if (!this.audioContextSinkMode && (el.paused || el.readyState < 2)) {
            try { await el.play(); } catch (e) {
                console.warn('[_pollTick] el.play() failed, falling back to full reset:', e.message ?? e);
                await onReset(prefs);
            }
        }
    }

    _setSinkIdWithTimeout(target, sinkId, ms = 10000) {
        let timerId;
        return Promise.race([
            target.setSinkId(sinkId).finally(() => clearTimeout(timerId)),
            new Promise((_, reject) => {
                timerId = setTimeout(
                    () => reject(new Error(`setSinkId('${sinkId}') timed out after ${ms}ms`)),
                    ms
                );
            })
        ]);
    }

    /**
     * getUserMedia with timeout — on macOS, getUserMedia can hang indefinitely when
     * the audio system is in flux (HDMI re-re-connect, multi-display).  Apply a 5 s
     * timeout so the renderer can fall back to silent-source mode and proceed instead
     * of freezing.
     */
    _getUserMediaWithTimeout(constraints, ms = 5000) {
        let timerId;
        return Promise.race([
            navigator.mediaDevices.getUserMedia(constraints).finally(() => clearTimeout(timerId)),
            new Promise((_, reject) => {
                timerId = setTimeout(
                    () => reject(new Error(`getUserMedia timed out after ${ms}ms`)),
                    ms
                );
            })
        ]);
    }

    /**
     * Stop periodic device polling
     */
    stopDevicePoll() {
        if (this._devicePollIntervalId !== null) {
            clearInterval(this._devicePollIntervalId);
            this._devicePollIntervalId = null;
        }
        this._pollRunning = false;
    }

    /**
     * Clean up audio input and output
     */
    cleanupAudio() {
        // Stop polling before teardown to prevent race conditions
        this.stopDevicePoll();

        // Reset audioContextSinkMode so next initAudioOutput() re-evaluates it
        this.audioContextSinkMode = false;

        // Stop audio element if it exists
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.srcObject = null;
            this.audioElement = null;
        }
        
        // Disconnect output gain node (which now sits between worklet and the
        // physical destination). Disconnecting it implicitly unhooks the path
        // to audioContext.destination / destinationNode.
        if (this.outputGainNode) {
            try {
                this.outputGainNode.disconnect();
            } catch (error) {
                console.warn('Error disconnecting output gain node:', error);
            }
            this.outputGainNode = null;
        }

        // Disconnect silence node if it exists
        if (this.silenceNode && this.contextManager.audioContext) {
            try {
                this.silenceNode.disconnect();
                this.silenceNode = null;
            } catch (error) {
                console.warn('Error disconnecting silence node:', error);
            }
        }

        // Stop all media tracks
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        // Clear nodes
        this.sourceNode = null;
        this.destinationNode = null;
        this.defaultDestinationConnection = null;
    }
}
