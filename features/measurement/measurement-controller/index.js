/**
 * Measurement Controller handles the measurement process workflow
 */

import audioUtils from '../audioUtils.js';
import dataStorage from '../dataStorage.js';
import uiManager from '../uiManager.js';
import i18n from '../i18n.js';

// Import controller components
import LevelAdjustment from './level-adjustment.js';
import SweepMeasurement from './sweep-measurement.js';
import AudioProcessing from './audio-processing.js';
import GraphUtils from './graph-utils.js';

class MeasurementController {
    constructor() {
        this.currentMeasurement = null;
        this.measurementConfig = null;
        this.currentSweepIndex = 0;
        this.sweepMeasurements = [];
        this.levelMeterInterval = null;
        this.isRunningMeasurement = false;
        this.levelGraphData = [];
        this.startTime = null;
        this.levelGraphInterval = null;
        this.fullRecordBuffer = null;
        this.syncedBuffer = null;
        this.recorderNode = null;
        
        // Mix in functionality from other modules
        Object.assign(this, LevelAdjustment);
        Object.assign(this, SweepMeasurement);
        Object.assign(this, AudioProcessing);
        Object.assign(this, GraphUtils);
    }

    /**
     * Initialize the measurement controller
     */
    async initialize() {
        try {
            await audioUtils.initialize();
            
            // Setup back button event listeners
            document.getElementById('backFromLevelBtn').addEventListener('click', () => {
                this.returnToConfigScreen();
            });
            
            document.getElementById('backFromSweepBtn').addEventListener('click', () => {
                this.cancelMeasurement();
                this.returnToLevelAdjustmentScreen();
            });
        } catch (error) {
            console.error('Failed to initialize audio:', error);
        }
    }

    /**
     * Return to configuration screen from level adjustment
     */
    returnToConfigScreen() {
        // Stop any audio processes
        if (audioUtils.isWhiteNoiseActive) {
            audioUtils.stopWhiteNoise();
            document.getElementById('noiseToggleBtn').textContent = i18n.t('button:playbackTestSignal') || 'Playback test signal for checking volume';
        }
        
        this.stopLevelMeter();
        audioUtils.stopMicrophoneInput();
        
        // Clear any ongoing measurement state
        this.cleanup();
    }
    
    /**
     * Return to level adjustment screen from sweep measurement
     */
    returnToLevelAdjustmentScreen() {
        // Reset measurement state
        this.currentSweepIndex = 0;
        this.sweepMeasurements = [];
        
        // Clean up all audio resources
        this.cleanup();
    }

    /**
     * Start a new measurement with the given configuration
     * @param {Object} config - Measurement configuration
     */
    async startNewMeasurement(config) {
        if (this.isRunningMeasurement) {
            this.cancelMeasurement();
        }
        
        this.measurementConfig = config;
        
        // Get preferred sample rate from config
        const preferredSampleRate = parseInt(config.sampleRate);
        
        // Reinitialize audio context with preferred sample rate
        if (audioUtils.audioContext && audioUtils.audioContext.sampleRate !== preferredSampleRate) {
            console.log(`Reinitializing audio context with preferred sample rate: ${preferredSampleRate}Hz`);
            try {
                await audioUtils.reinitialize(preferredSampleRate);
            } catch (error) {
                console.warn(`Could not reinitialize audio context with sample rate ${preferredSampleRate}Hz:`, error);
            }
        } else if (!audioUtils.audioContext) {
            try {
                await audioUtils.initialize(preferredSampleRate);
            } catch (error) {
                console.warn(`Could not initialize audio context with sample rate ${preferredSampleRate}Hz:`, error);
            }
        }
        
        // Get actual sample rate that will be used
        const actualSampleRate = audioUtils.audioContext ? audioUtils.audioContext.sampleRate : preferredSampleRate;
        
        // Clamp sweep min/max frequency to [1, Nyquist - 1] of the actual sample rate
        const nyquistLimit = Math.max(2, Math.floor(actualSampleRate / 2) - 1);
        const sweepMinFreq = Math.max(1, Math.min(parseFloat(config.sweepMinFreq) || 20, nyquistLimit - 1));
        const requestedMax = parseFloat(config.sweepMaxFreq) || 20000;
        const sweepMaxFreq = Math.max(sweepMinFreq + 1, Math.min(requestedMax, nyquistLimit));

        // Create new measurement object with actual sample rate
        this.currentMeasurement = {
            id: dataStorage.generateId(),
            name: config.name,
            timestamp: new Date().toISOString(),
            audioInput: config.audioInput,
            inputChannel: config.inputChannel,
            audioOutput: config.audioOutput,
            outputChannel: config.outputChannel,
            requestedSampleRate: preferredSampleRate, // Store the requested rate
            sampleRate: actualSampleRate, // Store the actual rate used
            sweepLength: config.sweepLength,
            sweepMinFreq: sweepMinFreq,
            sweepMaxFreq: sweepMaxFreq,
            averaging: config.averaging,
            points: [],
            correctionLowFreq: 20,
            correctionHighFreq: 20000,
            smoothing: 0.3,
            eqBandCount: 5
        };
        
        // Clear any previous measurement display
        if (document.getElementById('measurementResults')) {
            document.getElementById('measurementResults').style.display = 'none';
        }
        if (document.getElementById('noMeasurementMessage')) {
            document.getElementById('noMeasurementMessage').style.display = 'block';
        }
        
        // Prepare for level adjustment
        this.prepareForLevelAdjustment();
    }

    /**
     * Clean up all measurement resources
     */
    cleanup() {
        console.log('MeasurementController cleanup starting');
        
        // Stop any ongoing measurement
        this.isRunningMeasurement = false;
        
        // Stop level meter
        this.stopLevelMeter();
        console.log('Level meter stopped');
        
        // Clear intervals and timeouts
        if (this.levelGraphInterval) {
            clearInterval(this.levelGraphInterval);
            this.levelGraphInterval = null;
            console.log('Level graph interval cleared');
        }
        
        // Stop and disconnect recorder node if it exists
        if (this.recorderNode) {
            try {
                console.log('Stopping and disconnecting recorder node');
                this.recorderNode.port.postMessage({ message: 'stop' });
                this.recorderNode.disconnect();
            } catch (e) {
                console.warn('Error cleaning up recorder node:', e);
            }
            this.recorderNode = null;
        }
        
        // Clear any record buffers
        this.fullRecordBuffer = null;
        this.syncedBuffer = null;
        console.log('Record buffers cleared');
        
        // Stop audio through audioUtils - always try to stop both white noise and microphone
        // regardless of their reported state, to ensure cleanup is thorough
        try {
            console.log('Stopping white noise from cleanup method');
            audioUtils.stopWhiteNoise();
        } catch (e) {
            console.warn('Error stopping white noise:', e);
        }
        
        try {
            console.log('Stopping microphone input from cleanup method');
            audioUtils.stopMicrophoneInput();
        } catch (e) {
            console.warn('Error stopping microphone input:', e);
        }
        
        // Reset audio context if necessary
        if (audioUtils.audioContext && audioUtils.audioContext.state !== 'closed') {
            try {
                console.log(`Audio context state before cleanup: ${audioUtils.audioContext.state}`);
                // Suspend the audio context to stop audio processing
                // Don't close the context as it might be needed later
                if (audioUtils.audioContext.state === 'running') {
                    console.log('Suspending audio context');
                    audioUtils.audioContext.suspend().catch(e => console.warn('Error suspending audio context:', e));
                }
            } catch (e) {
                console.warn('Error handling audio context state:', e);
            }
        }
        
        console.log('Measurement resources cleanup completed');
    }

    /**
     * Cancel the current measurement
     */
    cancelMeasurement() {
        console.log('Cancelling measurement');
        
        // Explicitly stop any active sweep playback
        if (this.stopSweepPlayback) {
            this.stopSweepPlayback();
        }
        
        this.currentSweepIndex = 0;
        this.sweepMeasurements = [];
        this.isRunningMeasurement = false;
        
        // Ensure all audio resources are properly cleaned up
        this.cleanup();
    }
}

// Create singleton instance
const measurementController = new MeasurementController();
export default measurementController; 