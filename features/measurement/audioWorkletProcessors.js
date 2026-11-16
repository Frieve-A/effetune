/**
 * AudioWorklet processors for the frequency response measurement app
 */

// RecorderProcessor for recording audio
class RecorderProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        
        // Buffer to store recorded audio
        this.recordBuffer = [];
        this.isRecording = false;
        this.captureStartFrame = null;
        this.maxRecordLength = 0; // Set to > 0 to limit recording length
        this.bufferThreshold = 4096; // Send data in chunks to prevent memory issues
        
        // Message port for communication with main thread
        this.port.onmessage = (event) => this.handleMessage(event.data);
    }
    
    handleMessage(data) {
        if (data.command === 'start') {
            this.recordBuffer = [];
            this.isRecording = true;
            this.captureStartFrame = null;
            this.maxRecordLength = data.maxLength || 0;
            this.port.postMessage({ status: 'started' });
        } else if (data.command === 'stop') {
            this.isRecording = false;
            const flatBuffer = this.recordBuffer.flat();
            this.port.postMessage({
                status: 'stopped',
                buffer: new Float32Array(flatBuffer)
            });
            this.recordBuffer = [];
        }
    }
    
    process(inputs, outputs, parameters) {
        // Check if we have inputs
        if (!inputs || !inputs[0] || !inputs[0].length) {
            return true; // Keep processor alive
        }
        
        // Get input channels
        const input = inputs[0];
        // Validate input stability
        if (!input[0] || input[0].length === 0) {
            console.warn('Empty input buffer detected');
            return true;
        }
        
        // Record if active
        if (this.isRecording) {
            const sample = Array.from(input[0]);
            
            // Add to recording buffer
            if (sample.length > 0) {
                if (this.captureStartFrame === null) {
                    this.captureStartFrame = currentFrame;
                    this.port.postMessage({
                        status: 'capture-frame',
                        startFrame: this.captureStartFrame
                    });
                }
                this.recordBuffer.push(sample);
                
                // Send data in chunks to prevent memory issues
                const totalSamples = this.recordBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
                
                if (totalSamples >= this.bufferThreshold) {
                    try {
                        // Send current buffer chunk
                        const flatBuffer = this.recordBuffer.flat();
                        this.port.postMessage({
                            buffer: new Float32Array(flatBuffer)
                        });
                        this.recordBuffer = []; // Clear buffer after sending
                    } catch (error) {
                        console.error('Error sending audio buffer:', error);
                        // Continue recording even if send fails
                    }
                }
                
                // Check if we've reached the maximum length
                if (this.maxRecordLength > 0 && totalSamples >= this.maxRecordLength) {
                    // Stop recording
                    this.isRecording = false;
                    this.port.postMessage({
                        status: 'complete'
                    });
                }
            }
        }
        
        return true; // Keep processor alive
    }
}

// Time constant of the peak reading's exponential fall, the one the meter always had.
const PEAK_FALL_TIME_CONSTANT_SECONDS = 0.05;

// LevelMeterProcessor for measuring input levels: `level` is the sample peak in dBFS, which rises
// at once and falls with PEAK_FALL_TIME_CONSTANT_SECONDS, so the level graph still shows the noise
// between signals.
class LevelMeterProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        this.currentPeak = 0;
        // Natural-log fall of the peak per sample
        this.peakFallPerSample = -1 / (PEAK_FALL_TIME_CONSTANT_SECONDS * sampleRate);
        this.counter = 0;
        this.updateInterval = 5; // Update every 5 blocks (~ 50ms at 48kHz)
    }

    process(inputs, outputs, parameters) {
        // Check if we have inputs
        if (!inputs || !inputs[0] || !inputs[0].length) {
            return true; // Keep processor alive
        }

        const samples = inputs[0][0];
        const count = samples.length;
        let blockPeak = 0;
        for (let i = 0; i < count; i++) {
            const sample = samples[i];
            const magnitude = sample < 0 ? -sample : sample;
            if (magnitude > blockPeak) blockPeak = magnitude;
        }

        // Immediate rise, exponential fall
        const fallen = this.currentPeak * Math.exp(this.peakFallPerSample * count);
        this.currentPeak = blockPeak > fallen ? blockPeak : fallen;

        // Periodically send level back to main thread
        this.counter++;
        if (this.counter >= this.updateInterval) {
            this.counter = 0;
            // dB limited to the -100 dB noise floor and 0 dB
            let levelDb = -100;
            if (this.currentPeak > 0) {
                levelDb = 20 * Math.log10(this.currentPeak);
                levelDb = levelDb < -100 ? -100 : levelDb > 0 ? 0 : levelDb;
            }
            this.port.postMessage({ level: levelDb });
        }
        
        return true; // Keep processor alive
    }
}

// Register processors
registerProcessor('recorder-processor', RecorderProcessor);
registerProcessor('level-meter-processor', LevelMeterProcessor);
