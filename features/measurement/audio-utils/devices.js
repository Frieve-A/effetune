/**
 * Audio device management functions
 */

/**
 * Get available audio input and output devices
 * @param {AudioUtils} audioUtils - AudioUtils instance 
 * @returns {Promise<Object>} - Object with inputs and outputs arrays
 */
async function enumerateDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        this.devices.inputs = devices
            .filter(device => device.kind === 'audioinput')
            .map(device => ({
                id: device.deviceId,
                label: device.label || `Microphone ${this.devices.inputs.length + 1}`
            }));
            
        this.devices.outputs = devices
            .filter(device => device.kind === 'audiooutput')
            .map(device => ({
                id: device.deviceId,
                label: device.label || `Speaker ${this.devices.outputs.length + 1}`
            }));
            
        return this.devices;
    } catch (error) {
        console.error('Error enumerating audio devices:', error);
        throw error;
    }
}

/**
 * Start microphone input
 * @param {string} deviceId - The input device ID, or null for default
 * @param {string} channel - The input channel to use ('left', 'right', 'both')
 */
async function startMicrophoneInput(deviceId = null, channel = 'left') {
    try {
        // Stop any existing microphone input
        this.stopMicrophoneInput();
        
        // Make sure audio context exists and is running
        if (!this.audioContext) {
            await this.reinitialize();
        } else if (this.audioContext.state !== 'running') {
            await this.ensureAudioContextRunning();
        }
        
        // Get microphone stream
        const constraints = {
            audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.inputStream = stream;
        
        // Log track information
        const tracks = stream.getAudioTracks();
        
        if (tracks.length === 0) {
            throw new Error('Could not get microphone audio track');
        }
        
        // Create source from stream
        const micSource = this.audioContext.createMediaStreamSource(stream);
        this.microphone = micSource;
        
        if (!this.microphone) {
            throw new Error('Failed to create microphone source');
        }
        
        // Store the selected input channel
        this.selectedInputChannel = channel;
        
        // Create channel splitter to handle specific channels
        this.channelSplitter = this.audioContext.createChannelSplitter(2);
        this.microphone.connect(this.channelSplitter);
        
        // Create a gain node to route only the selected channel
        this.channelGain = this.audioContext.createGain();
        
        // Connect based on channel selection
        if (channel === 'left' || channel === 0) {
            // Route only left channel
            this.channelSplitter.connect(this.channelGain, 0);
        } else if (channel === 'right' || channel === 1) {
            // Route only right channel
            this.channelSplitter.connect(this.channelGain, 1);
        } else {
            // Both channels (mix to mono)
            const leftGain = this.audioContext.createGain();
            const rightGain = this.audioContext.createGain();
            this.channelSplitter.connect(leftGain, 0);
            this.channelSplitter.connect(rightGain, 1);
            leftGain.connect(this.channelGain);
            rightGain.connect(this.channelGain);
        }
        
        // Connect to analyzer
        this.channelGain.connect(this.analyzer);
        
        // Setup level meter with AudioWorklet
        try {
            this.levelMeterNode = await this.createLevelMeterWorkletNode(this.selectedInputChannel);
            
            // Handle level meter messages
            this.levelMeterNode.port.onmessage = (event) => {
                if (event.data.level !== undefined) {
                    this.currentInputLevel = event.data.level;
                }
            };
            
            // Connect channel gain to level meter node
            this.channelGain.connect(this.levelMeterNode);
            
            // Connect to output (necessary for AudioWorkletNode to process)
            this.levelMeterNode.connect(this.audioContext.destination);
        } catch (error) {
            console.error('Failed to create level meter worklet:', error);
            throw new Error(`Failed to create level meter: ${error.message}`);
        }
        
        return true;
    } catch (error) {
        console.error('Error starting microphone input:', error);
        
        // If there's a permissions error, provide a more user-friendly message
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            throw new Error('Microphone access is not allowed. Please allow microphone access in your browser settings.');
        }
        
        // Ensure microphone resources are cleaned up on error
        this.stopMicrophoneInput();
        
        throw error;
    }
}

/**
 * Stop microphone input
 */
function stopMicrophoneInput() {
    // Disconnect microphone
    if (this.microphone) {
        try {
            this.microphone.disconnect();
        } catch (e) {
            // Ignore disconnection errors
            console.warn('Error disconnecting microphone:', e);
        }
        this.microphone = null;
    }
    
    // Disconnect channel splitter
    if (this.channelSplitter) {
        try {
            this.channelSplitter.disconnect();
        } catch (e) {
            // Ignore disconnection errors
            console.warn('Error disconnecting channel splitter:', e);
        }
        this.channelSplitter = null;
    }
    
    // Disconnect channel gain
    if (this.channelGain) {
        try {
            this.channelGain.disconnect();
        } catch (e) {
            // Ignore disconnection errors
            console.warn('Error disconnecting channel gain:', e);
        }
        this.channelGain = null;
    }
    
    // Disconnect level meter node
    if (this.levelMeterNode) {
        try {
            // Send stop message to the AudioWorklet if it's a worklet node
            if (this.levelMeterNode.port && this.levelMeterNode.port.postMessage) {
                try {
                    this.levelMeterNode.port.postMessage({ message: 'stop' });
                } catch (e) {
                    console.warn('Error sending stop message to level meter worklet:', e);
                }
            }
            this.levelMeterNode.disconnect();
        } catch (e) {
            // Ignore disconnection errors
            console.warn('Error disconnecting level meter node:', e);
        }
        this.levelMeterNode = null;
    }
    
    // Stop all tracks in the input stream
    if (this.inputStream) {
        try {
            this.inputStream.getTracks().forEach(track => track.stop());
        } catch (e) {
            console.warn('Error stopping media tracks:', e);
        }
        this.inputStream = null;
    }
    
    // Reset current input level
    this.currentInputLevel = -100;
    
    return true;
}

/**
 * Create an AudioWorkletNode for level meter
 * @param {string} channel - Input channel ('left', 'right', 'both')
 * @returns {Promise<AudioWorkletNode>} AudioWorkletNode for level meter
 */
async function createLevelMeterWorkletNode(channel = 'left') {
    // Ensure AudioContext is running
    if (!this.audioContext) {
        throw new Error('AudioContext is not initialized');
    }
    
    // Make sure AudioContext is in the running state
    await this.ensureAudioContextRunning();
    
    if (!this.audioWorkletSupported) {
        throw new Error('AudioWorklet is not supported in this browser');
    }
    
    try {
        // Check if AudioWorklet module is loaded
        if (!this.audioContext.audioWorklet) {
            throw new Error('AudioWorklet not available in this AudioContext');
        }
        
        // Create level meter AudioWorkletNode
        const levelMeterNode = new AudioWorkletNode(this.audioContext, 'level-meter-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            processorOptions: {
                channel: channel
            }
        });
        
        return levelMeterNode;
    } catch (error) {
        throw new Error(`Failed to create level meter worklet: ${error.message}`);
    }
}

/**
 * Create an AudioWorkletNode for recording
 * @param {string} deviceId - Device ID to use (null for default)
 * @param {string} channel - Input channel ('left', 'right', 'both')
 * @returns {Promise<AudioWorkletNode>} Created AudioWorkletNode
 */
async function createRecorderWorkletNode(deviceId = null, channel = 'left') {
    // Ensure AudioContext is running
    if (!this.audioContext) {
        throw new Error('AudioContext is not initialized');
    }
    
    // Make sure AudioContext is in the running state
    await this.ensureAudioContextRunning();
    
    if (!this.audioWorkletSupported) {
        throw new Error('AudioWorklet is not supported in this browser');
    }
    
    try {
        // Check if AudioWorklet module is loaded
        if (!this.audioContext.audioWorklet) {
            throw new Error('AudioWorklet not available in this AudioContext');
        }
        
        // Create recorder AudioWorkletNode
        const recorderNode = new AudioWorkletNode(this.audioContext, 'recorder-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            processorOptions: {
                channel: channel
            }
        });
        
        // Verify the node was created successfully
        if (!recorderNode) {
            throw new Error('Failed to create recorder node');
        }
        
        return recorderNode;
    } catch (error) {
        throw new Error(`Failed to create recorder node: ${error.message}`);
    }
}

export {
    enumerateDevices,
    startMicrophoneInput,
    stopMicrophoneInput,
    createLevelMeterWorkletNode,
    createRecorderWorkletNode
};
