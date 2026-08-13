/**
 * Measurement Controller handles the measurement process workflow
 */

import audioUtils from '../audio-utils/index.js';
import dataStorage from '../dataStorage.js';
import uiManager from '../ui/ui-manager.js';

// Import controller components
import LevelAdjustment from './level-adjustment.js';
import SweepMeasurement from './sweep-measurement.js';
import AudioProcessing from './audio-processing.js';
import GraphUtils from './graph-utils.js';

export class MeasurementSetupError extends Error {
    constructor(code) {
        super(code);
        this.name = 'MeasurementSetupError';
        this.code = code;
    }
}

function isValidCalibrationImpulseResponse(record) {
    return record &&
        record.data instanceof Float32Array &&
        record.data.length > 0 &&
        record.data.every(sample => Number.isFinite(sample)) &&
        Number.isFinite(record.sampleRate) &&
        record.sampleRate > 0 &&
        Number.isSafeInteger(record.onsetIndex) &&
        record.onsetIndex >= 0 &&
        record.onsetIndex < record.data.length;
}

export class MeasurementController {
    constructor() {
        this.currentMeasurement = null;
        this.measurementConfig = null;
        this.interfaceCalibrationImpulseResponse = null;
        this.startMeasurementPromise = null;
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
            
        } catch (error) {
            console.error('Failed to initialize audio:', error);
        }
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
    startNewMeasurement(config) {
        if (this.startMeasurementPromise) return this.startMeasurementPromise;

        const operation = (async () => {
            try {
                return await this.startNewMeasurementOperation(config);
            } finally {
                if (this.startMeasurementPromise === operation) {
                    this.startMeasurementPromise = null;
                }
            }
        })();
        this.startMeasurementPromise = operation;
        return operation;
    }

    async startNewMeasurementOperation(config) {
        const previousState = {
            measurementConfig: this.measurementConfig,
            currentMeasurement: this.currentMeasurement,
            interfaceCalibrationImpulseResponse: this.interfaceCalibrationImpulseResponse
        };
        if (this.isRunningMeasurement) {
            this.cancelMeasurement();
        }

        const configSnapshot = structuredClone(config);
        
        // Get preferred sample rate from config
        const preferredSampleRate = parseInt(configSnapshot.sampleRate);
        
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
        
        // Clamp a limited sweep to the configured band. An unlimited sweep uses
        // every representable non-DC FFT bin for the selected sweep length.
        const nyquistLimit = Math.max(2, Math.floor(actualSampleRate / 2) - 1);
        const sweepBandLimited = configSnapshot.sweepBandLimited !== false;
        const requestedSweepLength = parseInt(configSnapshot.sweepLength);
        const sweepFftLength = 1 << Math.ceil(Math.log2(requestedSweepLength));
        let sweepMinFreq;
        let sweepMaxFreq;
        if (sweepBandLimited) {
            sweepMinFreq = Math.max(1, Math.min(
                parseFloat(configSnapshot.sweepMinFreq) || 20,
                nyquistLimit - 1
            ));
            const requestedMax = parseFloat(configSnapshot.sweepMaxFreq) || 20000;
            sweepMaxFreq = Math.max(sweepMinFreq + 1, Math.min(requestedMax, nyquistLimit));
        } else {
            sweepMinFreq = actualSampleRate / sweepFftLength;
            sweepMaxFreq = (sweepFftLength / 2 - 1) *
                actualSampleRate / sweepFftLength;
        }

        let calibrationImpulseResponse = null;
        let interfaceCalibration = null;
        if (configSnapshot.interfaceCalibration) {
            const {
                sourceMeasurementId,
                sourcePointId
            } = configSnapshot.interfaceCalibration;
            const sourceMeasurement = typeof sourceMeasurementId === 'string'
                ? dataStorage.getMeasurementById(sourceMeasurementId)
                : null;
            const sourcePoint = sourceMeasurement?.points?.find(
                point => point.pointId === sourcePointId
            );
            if (!sourceMeasurement ||
                sourceMeasurement.interfaceCalibration !== undefined ||
                !Number.isFinite(sourceMeasurement.sampleRate) ||
                !Number.isSafeInteger(sourcePointId) ||
                !sourcePoint?.ir?.stored) {
                throw new MeasurementSetupError('interfaceCalibrationUnavailable');
            }

            const storedImpulseResponse = await dataStorage.getImpulseResponse(
                sourceMeasurementId,
                sourcePointId
            );
            if (!isValidCalibrationImpulseResponse(storedImpulseResponse)) {
                throw new MeasurementSetupError('interfaceCalibrationUnavailable');
            }
            if (sourceMeasurement.sampleRate !== actualSampleRate ||
                storedImpulseResponse.sampleRate !== actualSampleRate) {
                throw new MeasurementSetupError('interfaceCalibrationSampleRateMismatch');
            }

            const sourceNyquistLimit = Math.max(
                2,
                Math.floor(sourceMeasurement.sampleRate / 2) - 1
            );
            const sourceSweepMin = Number.isFinite(sourceMeasurement.sweepMinFreq)
                ? sourceMeasurement.sweepMinFreq
                : 20;
            const sourceSweepMax = Number.isFinite(sourceMeasurement.sweepMaxFreq)
                ? sourceMeasurement.sweepMaxFreq
                : Math.min(20000, sourceNyquistLimit);
            if (sourceSweepMin > sweepMinFreq || sourceSweepMax < sweepMaxFreq) {
                throw new MeasurementSetupError('interfaceCalibrationSweepRangeMismatch');
            }

            calibrationImpulseResponse = {
                ...storedImpulseResponse,
                data: Float32Array.from(storedImpulseResponse.data)
            };
            interfaceCalibration = {
                sourceMeasurementId,
                sourcePointId,
                sourceMeasurementName: sourceMeasurement.name,
                sourcePointName: sourcePoint.name ||
                    `Point ${sourceMeasurement.points.indexOf(sourcePoint) + 1}`,
                sourceTimestamp: sourceMeasurement.timestamp || '',
                sampleRate: actualSampleRate
            };
        }

        // Create new measurement object with actual sample rate
        const measurement = {
            id: dataStorage.generateId(),
            name: configSnapshot.name,
            timestamp: new Date().toISOString(),
            audioInput: configSnapshot.audioInput,
            inputChannel: configSnapshot.inputChannel,
            audioOutput: configSnapshot.audioOutput,
            outputChannel: configSnapshot.outputChannel,
            requestedSampleRate: preferredSampleRate, // Store the requested rate
            sampleRate: actualSampleRate, // Store the actual rate used
            sweepLength: configSnapshot.sweepLength,
            sweepBandLimited,
            sweepMinFreq: sweepMinFreq,
            sweepMaxFreq: sweepMaxFreq,
            averaging: configSnapshot.averaging,
            points: [],
            nextPointId: 0,
            correctionLowFreq: 20,
            correctionHighFreq: 20000,
            smoothing: 0.3,
            eqBandCount: 5
        };
        if (interfaceCalibration) measurement.interfaceCalibration = interfaceCalibration;

        this.measurementConfig = configSnapshot;
        this.currentMeasurement = measurement;
        this.interfaceCalibrationImpulseResponse = calibrationImpulseResponse;
        
        try {
            await this.prepareForLevelAdjustment();
        } catch (error) {
            this.cleanup();
            this.measurementConfig = previousState.measurementConfig;
            this.currentMeasurement = previousState.currentMeasurement;
            this.interfaceCalibrationImpulseResponse =
                previousState.interfaceCalibrationImpulseResponse;
            throw error;
        }

        // Clear any previous measurement display only after setup succeeds.
        const measurementResults = document.getElementById('measurementResults');
        if (measurementResults) measurementResults.style.display = 'none';
        const noMeasurementMessage = document.getElementById('noMeasurementMessage');
        if (noMeasurementMessage) noMeasurementMessage.style.display = 'block';
        return measurement;
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
