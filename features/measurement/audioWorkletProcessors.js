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
        this.maxRecordLength = 0; // Set to > 0 to limit recording length
        this.bufferThreshold = 4096; // Send data in chunks to prevent memory issues
        
        // Message port for communication with main thread
        this.port.onmessage = (event) => this.handleMessage(event.data);
    }
    
    handleMessage(data) {
        if (data.command === 'start') {
            this.recordBuffer = [];
            this.isRecording = true;
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

// LevelMeterProcessor for measuring input levels
class LevelMeterProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        
        // RMS calculation
        this.smoothingFactor = 0.95; // Higher value = more smoothing
        this.currentLevel = 0;
        this.counter = 0;
        this.updateInterval = 5; // Update every 5 blocks (~ 50ms at 48kHz)
    }
    
    process(inputs, outputs, parameters) {
        // Check if we have inputs
        if (!inputs || !inputs[0] || !inputs[0].length) {
            return true; // Keep processor alive
        }
        
        // Get input channels
        const input = inputs[0];
        // Calculate RMS level
        let sum = 0;
        let count = 0;

        for (let i = 0; i < input[0].length; i++) {
            sum += input[0][i] * input[0][i];
            count++;
        }
        
        // Update the level with smoothing
        if (count > 0) {
            const blockRMS = Math.sqrt(sum / count);
            this.currentLevel = this.smoothingFactor * this.currentLevel + 
                                (1 - this.smoothingFactor) * blockRMS;
        }
        
        // Periodically send level back to main thread
        this.counter++;
        if (this.counter >= this.updateInterval) {
            this.counter = 0;
            
            // Convert to dB
            let levelDb = -100; // Noise floor
            if (this.currentLevel > 0) {
                levelDb = 20 * Math.log10(this.currentLevel);
                // Limit to reasonable range
                levelDb = Math.max(-100, Math.min(0, levelDb));
            }
            
            this.port.postMessage({ level: levelDb });
        }
        
        return true; // Keep processor alive
    }
}

// Register processors
registerProcessor('recorder-processor', RecorderProcessor);
registerProcessor('level-meter-processor', LevelMeterProcessor);
