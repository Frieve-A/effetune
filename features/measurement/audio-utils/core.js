/**
 * Core audio utilities for frequency response measurements
 */

class AudioUtils {
    constructor() {
        this.audioContext = null;
        this.analyzer = null;
        this.whiteMicrophone = null;
        this.whiteNoiseNode = null;
        this.whiteNoiseGain = null;
        this.isWhiteNoiseActive = false;
        this.inputStream = null;
        this.initialized = false;
        this.devices = { inputs: [], outputs: [] };
        this.channelSplitter = null;
        this.selectedInputChannel = 'both';
        this.lastSweepFrequencyResponse = null; // Last generated sweep signal frequency response
        this.lastInverseFilter = null; // Inverse filter
        this.lastTspSignal = null; // Last generated TSP signal
        this.tspPeakOffset = 0; // TSP signal peak position
        this.audioWorkletSupported = false;
        this.currentInputLevel = -100;
    }

    /**
     * Initialize the WebAudio API context
     * @param {number} preferredSampleRate - Optional preferred sample rate in Hz
     */
    async initialize(preferredSampleRate = null) {
        if (this.initialized) {
            return;
        }

        try {
            // Close any existing audio context
            if (this.audioContext) {
                try {
                    await this.audioContext.close();
                } catch (e) {
                    console.warn('Error closing existing audio context:', e);
                }
            }
            
            // Create options object if preferred sample rate is provided
            let contextOptions = {latencyHint: 'playback'};
            if (preferredSampleRate) {
                contextOptions.sampleRate = preferredSampleRate;
            }
            
            // Create a new AudioContext with options
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)(contextOptions);
            
            // Check if the actual sample rate matches the preferred rate
            if (preferredSampleRate && this.audioContext.sampleRate !== preferredSampleRate) {
                console.warn(`Requested sample rate ${preferredSampleRate}Hz but got ${this.audioContext.sampleRate}Hz instead. Using actual rate for calculations.`);
            }
            
            // Set up analyzer for level metering
            this.analyzer = this.audioContext.createAnalyser();
            this.analyzer.fftSize = 2048;
            this.analyzer.smoothingTimeConstant = 0.2;
            
            // Resume the AudioContext if suspended
            // This must be triggered by user interaction on some browsers
            if (this.audioContext.state === 'suspended') {
                try {
                    await this.audioContext.resume();
                } catch (e) {
                    console.warn('Could not resume AudioContext during initialization:', e);
                }
            }
            
            // Load AudioWorklet processors - this is required for the application
            if (this.audioContext.audioWorklet) {
                try {
                    // Get the base URL for our worklet processors
                    const modulePath = `audioWorkletProcessors.js`;
                    
                    await this.audioContext.audioWorklet.addModule(modulePath);
                    this.audioWorkletSupported = true;
                } catch (error) {
                    console.error('Failed to load AudioWorklet processors:', error);
                    this.audioWorkletSupported = false;
                    throw new Error(`Failed to load AudioWorklet: ${error.message}`);
                }
            } else {
                console.error('AudioWorklet is not supported in this browser');
                this.audioWorkletSupported = false;
                throw new Error('This browser does not support AudioWorklet. Please use the latest Chrome or Edge browser.');
            }
            
            // Get available audio devices
            await this.enumerateDevices();
            
            this.initialized = true;
        } catch (error) {
            console.error('Failed to initialize AudioUtils:', error);
            throw error;
        }
    }

    /**
     * Reinitialize audio context and resources
     * This is a more aggressive reset than just ensureAudioContextRunning
     * @param {number} preferredSampleRate - Optional preferred sample rate in Hz
     */
    async reinitialize(preferredSampleRate = null) {
        // Stop and clean up any existing resources
        this.stopWhiteNoise();
        this.stopMicrophoneInput();
        
        // Close and reset the AudioContext
        if (this.audioContext) {
            try {
                await this.audioContext.close();
            } catch (e) {
                console.warn('Error closing audio context:', e);
            }
            this.audioContext = null;
        }
        
        // Reset worklet flags
        this.audioWorkletSupported = false;
        this.initialized = false;
        
        // Reinitialize everything with preferred sample rate
        await this.initialize(preferredSampleRate);
        
        return true;
    }

    /**
     * Ensure that audio context is running
     * @returns {Promise<boolean>} Whether the audio context was successfully resumed
     */
    async ensureAudioContextRunning() {
        if (!this.audioContext) {
            return false;
        }
        
        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                return true;
            } catch (error) {
                return false;
            }
        } else if (this.audioContext.state === 'running') {
            return true;
        } else if (this.audioContext.state === 'closed') {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            await this.audioContext.resume();
            return true;
        } else {
            return false;
        }
    }

    /**
     * Get current input level in dB
     * @returns {number} Input level in dB, range -Infinity to 0
     */
    getInputLevel() {
        // If we have a current level from the AudioWorklet, use that
        if (this.audioWorkletSupported && this.currentInputLevel !== undefined) {
            return this.currentInputLevel;
        }
        
        // Otherwise fall back to analyzer-based level detection
        if (!this.analyzer) return -Infinity;
        
        const dataArray = new Uint8Array(this.analyzer.frequencyBinCount);
        this.analyzer.getByteTimeDomainData(dataArray);
        
        // Calculate RMS of the audio samples
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            const amplitude = (dataArray[i] - 128) / 128;
            sum += amplitude * amplitude;
        }
        
        const rms = Math.sqrt(sum / dataArray.length);
        
        // Convert to dB (full scale where 1.0 RMS = 0 dB)
        if (rms < 0.0001) return -Infinity; // Avoid log(0)
        const db = 20 * Math.log10(rms);
        
        return db;
    }

    /**
     * Find the two nearest values in an array to a given frequency
     * @param {number} freq - Target frequency
     * @param {Array<number>} freqArray - Array of frequencies
     * @returns {Array<number>} The nearest 1 or 2 frequencies
     */
    findNearestFrequencies(freq, freqArray) {
        // Return empty array if no array is provided
        if (!freqArray || freqArray.length === 0) return [];
        
        // Return the exact match if it exists
        if (freqArray.includes(freq)) return [freq];
        
        // Sort the array in ascending order
        const sortedFreqs = [...freqArray].sort((a, b) => a - b);
        
        // Find the smallest and largest values
        let lowerIndex = -1;
        for (let i = 0; i < sortedFreqs.length; i++) {
            if (sortedFreqs[i] > freq) {
                lowerIndex = i - 1;
                break;
            }
        }
        
        // Check boundary conditions
        if (lowerIndex === -1) {
            // If all values are greater than freq, return the smallest value
            return [sortedFreqs[0]];
        } else if (lowerIndex === sortedFreqs.length - 1) {
            // If all values are less than freq, return the largest value
            return [sortedFreqs[sortedFreqs.length - 1]];
        } else {
            // Return both sides
            return [sortedFreqs[lowerIndex], sortedFreqs[lowerIndex + 1]];
        }
    }
}

export default AudioUtils; 