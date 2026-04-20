/**
 * Sweep measurement functionality for the measurement controller
 */

import audioUtils from '../audioUtils.js';
import uiManager from '../uiManager.js';
import dataStorage from '../dataStorage.js';

const SweepMeasurement = {
    /**
     * Start the sweep measurement process
     */
    startSweepMeasurement() {
        // Stop level meter
        this.stopLevelMeter();
        
        // Stop white noise if it's playing
        if (audioUtils.isWhiteNoiseActive) {
            audioUtils.stopWhiteNoise();
        }
        
        // Reset measurement variables
        this.currentSweepIndex = 0;
        this.sweepMeasurements = [];
        this.isRunningMeasurement = true;
        
        // Show sweep measurement screen
        uiManager.showScreen('sweepMeasurementScreen');
        
        // Clear warning if exists
        const overloadWarning = document.getElementById('overloadWarning');
        if (overloadWarning) {
            overloadWarning.classList.remove('warning-visible');
        }
        
        // Clear previous measurement displays
        const levelCanvas = document.getElementById('levelGraph');
        const levelCtx = levelCanvas.getContext('2d');
        levelCtx.clearRect(0, 0, levelCanvas.width, levelCanvas.height);
        
        const freqCanvas = document.getElementById('frequencyResponseGraph');
        const freqCtx = freqCanvas.getContext('2d');
        freqCtx.clearRect(0, 0, freqCanvas.width, freqCanvas.height);
        
        // Start the measurement
        this.performSweepMeasurement();
    },

    /**
     * Perform a single sweep measurement
     */
    async performSweepMeasurement() {
        try {
            // Setup canvas for level display
            const canvas = document.getElementById('levelGraph');
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Initialize level graph data
            this.levelGraphData = [];
            this.startTime = Date.now();
            this.levelGraphInterval = setInterval(() => this.updateLevelGraph(), 50);
            
            // Hide measurement action buttons during the measurement
            document.getElementById('measurementActionsExplanation').style.display = 'none';
            document.getElementById('redoBtn').style.display = 'none';
            document.getElementById('saveAndContinueBtn').style.display = 'none';
            document.getElementById('saveAndFinishBtn').style.display = 'none';
            
            // Check if audio context is initialized and running
            if (!audioUtils.audioContext || audioUtils.audioContext.state !== 'running') {
                console.log('Audio context not running, attempting to resume...');
                await audioUtils.ensureAudioContextRunning();
            }
            
            // Check if the actual sample rate matches the requested rate
            const requestedSampleRate = parseInt(this.measurementConfig.sampleRate);
            const actualSampleRate = audioUtils.audioContext.sampleRate;
            
            if (requestedSampleRate !== actualSampleRate) {
                // Show warning to user
                const warningElement = document.getElementById('sampleRateWarning');
                if (warningElement) {
                    warningElement.textContent = `Warning: Requested sampling rate ${requestedSampleRate}Hz is not available. Using ${actualSampleRate}Hz instead.`;
                    warningElement.style.display = 'block';
                } else {
                    console.warn(`Requested sample rate ${requestedSampleRate}Hz but using ${actualSampleRate}Hz instead.`);
                }
            }
            
            // Check if microphone input is active
            if (!audioUtils.microphone) {
                console.log('Microphone input not initialized, attempting to restart...');
                try {
                    await audioUtils.startMicrophoneInput(
                        this.measurementConfig.audioInputId, 
                        this.measurementConfig.inputChannel
                    );
                } catch (error) {
                    console.error('Failed to restart microphone input:', error);
                    throw new Error('Failed to initialize microphone input. Please ensure microphone access is granted.');
                }
            }
            
            // Generate sweep signal with proper channel configuration
            // Convert legacy 'both' value to 'all' for backwards compatibility
            let outputChannel = this.measurementConfig.outputChannel;
            if (outputChannel === 'both') {
                outputChannel = 'all';
            }
            
            const sweepLength = parseInt(this.measurementConfig.sweepLength);
            const sampleRate = audioUtils.audioContext.sampleRate;
            const sweepMinFreq = this.currentMeasurement.sweepMinFreq;
            const sweepMaxFreq = this.currentMeasurement.sweepMaxFreq;
            const sweepBuffer = audioUtils.generateTSP(
                sweepLength,
                sampleRate,
                outputChannel,
                sweepMinFreq,
                sweepMaxFreq
            );
            
            // Update the graph to show the entire measurement duration
            this.drawLevelGraphGrid(ctx, canvas.width, canvas.height);
            
            // Play sweep and record input - single call that handles multiple sweeps internally
            const measurementResult = await this.playAndRecordSweep(sweepBuffer);
            
            // Stop level graph updates
            clearInterval(this.levelGraphInterval);
            
            // Update frequency response graph
            this.updateFrequencyResponseGraph(measurementResult.frequencyResponse, measurementResult.maxSignalLevel);
            
            // Create measurement point object
            const point = {
                name: `Point ${this.currentMeasurement.points.length + 1}`,
                frequencyResponse: measurementResult.frequencyResponse,
                maxSignalLevel: measurementResult.maxSignalLevel, // Record maximum signal level
                timestamp: new Date().toISOString()
            };
            
            // Store the point
            this.currentPoint = point;
            
            // Measurement is complete
            this.isRunningMeasurement = false;
            
            // Show measurement action buttons after the measurement is complete
            document.getElementById('measurementActionsExplanation').style.display = 'inline-block';
            document.getElementById('redoBtn').style.display = 'inline-block';
            document.getElementById('saveAndContinueBtn').style.display = 'inline-block';
            document.getElementById('saveAndFinishBtn').style.display = 'inline-block';
            
        } catch (error) {
            console.error('Error performing sweep measurement:', error);
            this.isRunningMeasurement = false;
            if (this.levelGraphInterval) {
                clearInterval(this.levelGraphInterval);
            }
            
            // Display error to user
            alert(`Error: Measurement error occurred: ${error.message}`);
        }
    },

    /**
     * Export recorded audio for debugging
     */
    exportDebugAudio() {
        if (!this.fullRecordBuffer) {
            console.error("No recorded audio available for export");
            return;
        }
        
        try {
            // Get sample rate from audio context
            const sampleRate = audioUtils.audioContext.sampleRate;
            
            // Export full recording
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            audioUtils.exportWAV(this.fullRecordBuffer, sampleRate, `full_recording_${timestamp}.wav`);
            
            console.log("Exported debug audio file");
        } catch (error) {
            console.error("Error exporting debug audio:", error);
        }
    },
    
    /**
     * Finalize the sweep measurement by averaging and calculating frequency response
     */
    finalizeSweepMeasurement() {
        if (!this.currentPoint) {
            console.error('No measurement point available');
            return;
        }
        
        // Export debug audio file if needed
        // this.exportDebugAudio();
    },

    /**
     * Save the current point and continue with measurement
     */
    saveAndContinueMeasurement() {
        if (!this.currentPoint) return;
        
        // Add point to measurement
        this.currentMeasurement.points.push(this.currentPoint);
        
        // Save progress
        if (this.currentMeasurement.points.length > 0) {
            // Calculate average response based on current points
            this.calculateAverageResponse();
            
            // Save measurement in progress and make sure it's selected in UI
            const measurementId = dataStorage.addMeasurement(this.currentMeasurement);
            uiManager.selectedMeasurementId = measurementId;
            uiManager.measurementDisplay.updateSelectedMeasurementHighlight();
        }
        
        // Reset for next point but stay on sweep measurement screen
        this.resetForNextSweepMeasurement();
    },
    
    /**
     * Save the current point and finish the measurement process
     * @returns {Promise<string|null>} Measurement ID or null if no data
     */
    async saveAndFinishMeasurement() {
        if (!this.currentPoint) return null;
        
        // Add final point to measurement
        this.currentMeasurement.points.push(this.currentPoint);
        
        // Calculate average frequency response
        this.calculateAverageResponse();
        
        // Save the complete measurement
        const measurementId = await dataStorage.addMeasurement(this.currentMeasurement);
        console.log(`Measurement saved with ID: ${measurementId}`);
        
        // Return the measurement ID for further processing by the UI
        return measurementId;
    },
    
    /**
     * Complete the measurement process
     * This is an async wrapper that handles saving and cleanup
     * @returns {Promise<string|null>} Measurement ID or null if no data
     */
    async finishMeasurement() {
        try {
            // Save and get the measurement ID
            const measurementId = await this.saveAndFinishMeasurement();
            
            if (!measurementId) {
                throw new Error('No measurement data available to save');
            }
            
            // Cleanup audio resources
            this.cleanup();

            // Return the ID for UI processing
            return measurementId;
        } catch (error) {
            console.error('Error finishing measurement:', error);
            // Ensure cleanup happens even in case of error
            this.cleanup();
            throw error;
        }
    },
    
    /**
     * Redo the current measurement
     */
    redoMeasurement() {
        // Reset and start a new measurement for the same point
        this.resetForNextSweepMeasurement();
    },
    
    /**
     * Reset state for the next measurement
     */
    resetForNextMeasurement() {
        // Reset variables
        this.currentSweepIndex = 0;
        this.sweepMeasurements = [];
        this.currentPoint = null;
        
        // Clear graphs
        const canvas = document.getElementById('frequencyResponseGraph');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Start level adjustment
        this.prepareForLevelAdjustment();
    },
    
    /**
     * Reset and prepare for a new sweep measurement without returning to level adjustment
     */
    resetForNextSweepMeasurement() {
        // Reset variables
        this.currentSweepIndex = 0;
        this.sweepMeasurements = [];
        this.currentPoint = null;
        
        // Clear graphs
        const canvas = document.getElementById('frequencyResponseGraph');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Stay on sweep measurement screen and start the next measurement directly
        this.performSweepMeasurement();
    },
    
    /**
     * Calculate average frequency response from all measurement points
     */
    calculateAverageResponse() {
        if (!this.currentMeasurement.points || this.currentMeasurement.points.length === 0) {
            return;
        }
        
        // Get all frequency responses
        const responses = this.currentMeasurement.points.map(point => point.frequencyResponse);
        
        // All measurement points should have the same frequency grid since they are created
        // with the same measurement process. We can directly average corresponding frequency points.
        
        // Use the first response's frequency grid as reference
        const referenceResponse = responses[0];
        const averageResponse = [];
        
        // For each frequency point in the reference response
        for (let i = 0; i < referenceResponse.length; i++) {
            const freq = referenceResponse[i][0]; // Frequency value
            let sum = 0;
            
            // Sum the magnitude values from all responses at this frequency index
            for (let j = 0; j < responses.length; j++) {
                // Ensure the index exists in this response
                if (i < responses[j].length) {
                    // Verify we're averaging the same frequency point
                    if (responses[j][i][0] === freq) {
                        sum += responses[j][i][1]; // Add magnitude
                    } else {
                        console.warn(`Frequency mismatch at index ${i}: expected ${freq}, found ${responses[j][i][0]}`);
                        // If different, use the value anyway as it's the corresponding index
                        sum += responses[j][i][1];
                    }
                }
            }
            
            // Calculate average magnitude for this frequency
            const avgMagnitude = sum / responses.length;
            
            // Add to average response
            averageResponse.push([freq, avgMagnitude]);
        }
        
        // Calculate average maxSignalLevel across all points
        let maxSignalLevelSum = 0;
        this.currentMeasurement.points.forEach(point => {
            if (point.maxSignalLevel !== undefined) {
                maxSignalLevelSum += point.maxSignalLevel;
            }
        });
        const avgMaxSignalLevel = this.currentMeasurement.points.length > 0 
            ? maxSignalLevelSum / this.currentMeasurement.points.length 
            : -100;
        
        // Set the average response and maxSignalLevel
        this.currentMeasurement.averageFrequencyResponse = averageResponse;
        this.currentMeasurement.maxSignalLevel = avgMaxSignalLevel;
    }
};

export default SweepMeasurement; 