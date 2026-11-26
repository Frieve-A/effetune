/**
 * Sweep measurement functionality for the measurement controller
 */

import audioUtils from '../audio-utils/index.js';
import uiManager from '../ui/ui-manager.js';
import dataStorage from '../dataStorage.js';
import i18n from '../i18n.js';
import {
    channelDisplayLabel,
    isMultiChannelSelection,
    maxRequiredChannelCount,
    selectionFromConfig
} from '../audio-utils/channel-selection.js';
import {
    mergeChannelRedoResult,
    recalculateAverages,
    resolveSweepBand,
    resolveOutputSweepBands
} from '../measurement-model.js';
import { NativeMeasurementInterruptedError, SweepCancelledError } from './audio-processing.js';
import { MAX_REPLAYS } from '../../../js/utils/measurement-dsp/recording-gaps.js';
import { isAndroidHost } from '../../../js/android/bridge.js';

function setDisplay(id, display) {
    const element = globalThis.document?.getElementById(id);
    if (element) element.style.display = display;
}

function setRedoChannelControlsVisible(visible) {
    for (const id of ['redoChannelLabel', 'redoChannelSelect', 'redoChannelBtn']) {
        const element = globalThis.document?.getElementById(id);
        if (element) element.hidden = !visible;
    }
}

function measurementErrorMessage(controller) {
    return controller.interfaceCalibrationImpulseResponse
        ? i18n.t('error:interfaceCalibrationProcessingFailed') ||
            'The calibrated measurement could not be completed. Check the setup and measure this point again.'
        : i18n.t('error:measurementFailed') ||
            'The measurement could not be completed. Check the audio devices and try this point again.';
}

const SweepMeasurement = {
    startChannelLevelGraph(durationSeconds) {
        if (this.levelGraphInterval) clearInterval(this.levelGraphInterval);
        this.levelGraphData = [];
        this.levelGraphDurationSeconds = durationSeconds;
        this.startTime = Date.now();
        this.updateLevelGraph();
        this.levelGraphInterval = setInterval(() => this.updateLevelGraph(), 50);
    },

    generateChannelSweep(channel) {
        const sampleRate = audioUtils.audioContext.sampleRate;
        const length = Number(this.measurementConfig.sweepLength);
        const config = this.currentMeasurement;
        const nativeWidth = this.measurementConfig.effectPipeline ? undefined : isAndroidHost()
            ? this.measurementConfig.outputChannelCount : audioUtils.nativeMeasurement?.session?.outputChannels;
        const band = resolveSweepBand(config, channel, sampleRate, length, nativeWidth);
        const outputBands = channel === 'all' && config.sweepBand?.mode === 'perChannel'
            ? resolveOutputSweepBands(config, sampleRate, length, nativeWidth) : undefined;
        const sweep = audioUtils.generateESS(length, sampleRate, channel,
            band.minFreq, band.maxFreq, band.bandLimited, outputBands, nativeWidth);
        this.currentSweepBand = { ...band, minFreq: sweep.startFrequency ?? band.minFreq,
            maxFreq: sweep.endFrequency ?? band.maxFreq };
        if (sweep.method === 'ess') {
            config.requestedSweepLength = length;
            config.sweepLength = Math.max(config.sweepLength, sweep.length);
            if (!band.bandLimited) {
                config.sweepMinFreq = sweep.startFrequency;
                config.sweepMaxFreq = sweep.endFrequency;
            }
        }
        return sweep;
    },

    /** Record one channel's sweep, playing it again while too many repetitions are disturbed. */
    async recordChannelSweep(channel, routeWidth) {
        const run = this.sweepRun;
        if (audioUtils.nativeMeasurement && !this.sweepCancelRequested) {
            try {
                await audioUtils.nativeMeasurement.ensureOpen();
            } catch (error) {
                if (this.sweepCancelRequested || error.name === 'AbortError') throw new SweepCancelledError();
                throw error;
            }
        }
        if (this.sweepCancelRequested || this.sweepRun !== run) throw new SweepCancelledError();
        for (let play = 0; ; play += 1) {
            // Sweep generation and deconvolution share mutable inverse-filter state,
            // so each play generates its sweep after the previous analysis completed.
            const result = await this.playAndRecordSweep(this.generateChannelSweep(channel), channel, routeWidth);
            if (this.sweepCancelRequested || this.sweepRun !== run) throw new SweepCancelledError();
            if (result.recordingGaps !== 'interrupted' || play === MAX_REPLAYS) return result;
            console.info(`Sweep measurement: the recording of ${channel} was disturbed too often, playing the sweep again`);
        }
    },

    /**
     * Start the sweep measurement process
     */
    async startSweepMeasurement() {
        // Stop level meter
        this.stopLevelMeter();
        
        this.stopChannelRotation?.();
        audioUtils.stopWhiteNoise();
        
        // Reset measurement variables
        this.currentSweepIndex = 0;
        this.sweepMeasurements = [];
        this.isRunningMeasurement = true;
        this.sweepCancelRequested = false;
        const run = this.sweepRun = {};
        
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
        
        // A cancelled test-signal route may still be settling. Wait for it before
        // the sweep claims the shared output device and channel layout.
        await audioUtils.waitForWhiteNoiseRouteIdle?.();
        if (!this.sweepCancelRequested && this.sweepRun === run) return this.performSweepMeasurement(run);
    },

    /**
     * Perform a single sweep measurement
     */
    async performSweepMeasurement(run = this.sweepRun = {}) {
        try {
            // Setup canvas for level display
            const canvas = document.getElementById('levelGraph');
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Hide measurement action buttons during the measurement
            for (const id of ['measurementActionsExplanation', 'redoBtn',
                'saveAndContinueBtn', 'saveAndFinishBtn']) setDisplay(id, 'none');
            setRedoChannelControlsVisible(false);
            
            // Check if audio context is initialized and running
            if (!audioUtils.audioContext || audioUtils.audioContext.state !== 'running') {
                console.log('Audio context not running, attempting to resume...');
                await audioUtils.ensureAudioContextRunning();
                if (this.sweepCancelRequested || this.sweepRun !== run) throw new SweepCancelledError();
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
                        this.measurementConfig.inputChannel,
                        { outputDeviceId: this.measurementConfig.audioOutputId, outputChannelCount: this.measurementConfig.outputChannelCount }
                    );
                } catch (error) {
                    console.error('Failed to restart microphone input:', error);
                    throw new Error('Failed to initialize microphone input. Please ensure microphone access is granted.');
                }
                if (this.sweepCancelRequested || this.sweepRun !== run) throw new SweepCancelledError();
            }
            
            const selection = selectionFromConfig(this.measurementConfig);
            const multiChannel = isMultiChannelSelection(selection);
            const routeWidth = this.measurementConfig.outputChannelCount ?? (multiChannel
                ? maxRequiredChannelCount(selection) : this.currentMeasurement.outputChannelCount);
            const results = [];
            for (let index = 0; index < selection.length; index += 1) {
                const outputChannel = selection[index];
                if (this.sweepCancelRequested) throw new SweepCancelledError();
                if (this.interfaceCalibrationImpulseResponsesByChannel) {
                    this.interfaceCalibrationImpulseResponse =
                        this.interfaceCalibrationImpulseResponsesByChannel.get(outputChannel) || null;
                }
                const progress = document.getElementById('sweepChannelProgress');
                if (progress) {
                    progress.hidden = !multiChannel;
                    progress.textContent = multiChannel
                        ? i18n.t('status:measuringChannel', {
                            channel: channelDisplayLabel(outputChannel),
                            current: index + 1,
                            total: selection.length
                        }) || `Measuring ${channelDisplayLabel(outputChannel)} (${index + 1}/${selection.length})`
                        : '';
                }
                const measurementResult = await this.recordChannelSweep(outputChannel, routeWidth);
                if (this.sweepCancelRequested || this.sweepRun !== run) throw new SweepCancelledError();
                results.push({ channel: outputChannel, ...measurementResult });
                this.updateFrequencyResponseGraph(
                    multiChannel ? results : measurementResult.frequencyResponse,
                    multiChannel ? undefined : measurementResult.maxSignalLevel
                );
            }
            
            // Stop level graph updates
            clearInterval(this.levelGraphInterval);
            
            // Update frequency response graph
            this.acceptMeasurementResult(multiChannel ? results : results[0]);
            
            // Measurement is complete
            this.isRunningMeasurement = false;
            
            // Show measurement action buttons after the measurement is complete
            for (const id of ['measurementActionsExplanation', 'redoBtn', 'saveAndContinueBtn',
                'saveAndFinishBtn']) setDisplay(id, 'inline-block');
            setRedoChannelControlsVisible(multiChannel);
            
        } catch (error) {
            if (this.sweepRun !== run) return;
            console.error('Error performing sweep measurement:', error);
            this.isRunningMeasurement = false;
            if (this.levelGraphInterval) {
                clearInterval(this.levelGraphInterval);
            }
            if (error instanceof SweepCancelledError) return;
            if (audioUtils.nativeMeasurement) setDisplay('redoBtn', 'inline-block');
            if (this.interfaceCalibrationImpulseResponse) {
                this.currentPoint = null;
                this.currentImpulseResponse = null;
                this.currentImpulseResponses = null;
            }
            uiManager.showNotification(error instanceof NativeMeasurementInterruptedError
                ? error.message : measurementErrorMessage(this), 'error');
        }
    },

    acceptMeasurementResult(measurementResult) {
        const pointId = this.currentMeasurement.nextPointId || 0;
        this.currentMeasurement.nextPointId = pointId + 1;
        if (Array.isArray(measurementResult)) {
            const point = {
                pointId,
                name: `Point ${this.currentMeasurement.points.length + 1}`,
                timestamp: new Date().toISOString(),
                channels: []
            };
            this.currentImpulseResponses = [];
            for (const result of measurementResult) {
                const entry = {
                    channel: result.channel,
                    frequencyResponse: result.frequencyResponse,
                    maxSignalLevel: result.maxSignalLevel,
                    ...(result.recordingGaps ? { recordingGaps: result.recordingGaps } : {})
                };
                if (result.irValid && result.impulseResponse instanceof Float32Array) {
                    const irId = this.currentMeasurement.nextPointId;
                    this.currentMeasurement.nextPointId += 1;
                    entry.irId = irId;
                    entry.ir = {
                        stored: true,
                        length: result.impulseResponse.length,
                        sampleRate: result.sampleRate,
                        onsetIndex: result.onsetIndex,
                        trimStartSamples: result.trimStartSamples,
                        peakDb: result.peakDb,
                        sweepLimited: result.sweepLimited
                    };
                    this.currentImpulseResponses.push({
                        measurementId: this.currentMeasurement.id,
                        pointId: irId,
                        channel: result.channel,
                        sampleRate: result.sampleRate,
                        onsetIndex: result.onsetIndex,
                        prerollSamples: result.prerollSamples,
                        trimStartSamples: result.trimStartSamples,
                        outputTimeReference: result.outputTimeReference,
                        refScale: result.refScale,
                        peakDb: result.peakDb,
                        acquisitionMethod: result.acquisitionMethod,
                        harmonicAnalysis: result.harmonicAnalysis,
                        data: result.impulseResponse
                    });
                }
                point.channels.push(entry);
            }
            this.currentImpulseResponse = null;
            this.currentPoint = point;
            return;
        }
        const point = {
            pointId,
            name: `Point ${this.currentMeasurement.points.length + 1}`,
            frequencyResponse: measurementResult.frequencyResponse,
            maxSignalLevel: measurementResult.maxSignalLevel,
            ...(measurementResult.recordingGaps ? { recordingGaps: measurementResult.recordingGaps } : {}),
            timestamp: new Date().toISOString()
        };

        this.currentImpulseResponse = null;
        if (measurementResult.irValid && measurementResult.impulseResponse instanceof Float32Array) {
            point.ir = {
                stored: true,
                length: measurementResult.impulseResponse.length,
                sampleRate: measurementResult.sampleRate,
                onsetIndex: measurementResult.onsetIndex,
                trimStartSamples: measurementResult.trimStartSamples,
                peakDb: measurementResult.peakDb,
                sweepLimited: measurementResult.sweepLimited
            };
            this.currentImpulseResponse = {
                measurementId: this.currentMeasurement.id,
                pointId,
                sampleRate: measurementResult.sampleRate,
                onsetIndex: measurementResult.onsetIndex,
                prerollSamples: measurementResult.prerollSamples,
                trimStartSamples: measurementResult.trimStartSamples,
                outputTimeReference: measurementResult.outputTimeReference,
                refScale: measurementResult.refScale,
                peakDb: measurementResult.peakDb,
                acquisitionMethod: measurementResult.acquisitionMethod,
                harmonicAnalysis: measurementResult.harmonicAnalysis,
                data: measurementResult.impulseResponse
            };
        }
        this.currentPoint = point;
    },

    

    /**
     * Save the current point and continue with measurement
     * @returns {Promise<string|null>} Measurement ID or null if no data
     */
    async saveAndContinueMeasurement() {
        return this.runSaveAction(async () => {
            if (!this.currentPoint) return null;

            const measurementId = await this.saveCurrentPoint();
            uiManager.selectedMeasurementId = measurementId;
            uiManager.measurementDisplay.updateSelectedMeasurementHighlight();

            // Reset for next point but stay on sweep measurement screen
            this.resetForNextSweepMeasurement();

            return measurementId;
        });
    },
    
    /**
     * Save the current point and finish the measurement process
     * @returns {Promise<string|null>} Measurement ID or null if no data
     */
    async saveAndFinishMeasurement() {
        return this.runSaveAction(async () => {
            if (!this.currentPoint) return null;

            const measurementId = await this.saveCurrentPoint();
            console.log(`Measurement saved with ID: ${measurementId}`);

            // Return the measurement ID for further processing by the UI
            return measurementId;
        });
    },

    async runSaveAction(action) {
        if (this.saveActionPromise) return this.saveActionPromise;

        const operation = (async () => {
            for (const id of ['saveAndContinueBtn', 'saveAndFinishBtn']) {
                const button = globalThis.document?.getElementById(id);
                if (button) button.disabled = true;
            }
            try {
                return await action();
            } finally {
                for (const id of ['saveAndContinueBtn', 'saveAndFinishBtn']) {
                    const button = globalThis.document?.getElementById(id);
                    if (button) button.disabled = false;
                }
            }
        })();
        this.saveActionPromise = operation;
        try {
            return await operation;
        } finally {
            if (this.saveActionPromise === operation) this.saveActionPromise = null;
        }
    },

    /**
     * Persist a candidate containing the current point, then publish it as current state.
     * @returns {Promise<string>} Measurement ID
     */
    async saveCurrentPoint() {
        const candidate = {
            ...this.currentMeasurement,
            points: [...this.currentMeasurement.points, this.currentPoint]
        };
        this.calculateAverageResponse(candidate);

        try {
            const measurementId = await dataStorage.addMeasurement(
                candidate,
                isMultiChannelSelection(selectionFromConfig(this.measurementConfig))
                    ? this.currentImpulseResponses
                    : this.currentImpulseResponse
            );
            this.currentMeasurement = candidate;
            return measurementId;
        } catch (error) {
            console.error('Measurement point could not be saved:', error);
            uiManager.showNotification(i18n.t('message:saveFailed') ||
                'The measurement could not be saved. Check available storage and try again.', 'error');
            throw error;
        }
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
            
            // Return the ID for UI processing
            return measurementId;
        } catch (error) {
            console.error('Error finishing measurement:', error);
            throw error;
        }
    },
    
    /**
     * Redo the current measurement
     */
    redoMeasurement() {
        // Reset and start a new measurement for the same point
        return this.resetForNextSweepMeasurement();
    },

    async redoChannel(channelToken) {
        if (!this.currentPoint?.channels?.some(entry => entry.channel === channelToken)) return false;
        const selection = selectionFromConfig(this.measurementConfig);
        const routeWidth = this.measurementConfig.outputChannelCount ?? maxRequiredChannelCount(selection);
        this.sweepCancelRequested = false;
        const run = this.sweepRun = {};
        for (const id of ['measurementActionsExplanation', 'redoBtn',
            'saveAndContinueBtn', 'saveAndFinishBtn']) setDisplay(id, 'none');
        setRedoChannelControlsVisible(false);
        try {
            if (this.interfaceCalibrationImpulseResponsesByChannel) {
                this.interfaceCalibrationImpulseResponse =
                    this.interfaceCalibrationImpulseResponsesByChannel.get(channelToken) || null;
            }
            const result = await this.recordChannelSweep(channelToken, routeWidth);
            if (this.sweepCancelRequested || this.sweepRun !== run) throw new SweepCancelledError();
            let nextPointId = this.currentMeasurement.nextPointId;
            const merged = mergeChannelRedoResult(
                this.currentPoint,
                this.currentImpulseResponses,
                channelToken,
                result,
                () => {
                    const id = nextPointId;
                    nextPointId += 1;
                    return id;
                }
            );
            const records = merged.records.map(record => ({
                ...record,
                measurementId: this.currentMeasurement.id
            }));
            this.updateFrequencyResponseGraph(
                merged.point.channels.map(entry => ({ ...entry })),
                undefined
            );
            this.currentMeasurement.nextPointId = nextPointId;
            this.currentPoint = merged.point;
            this.currentImpulseResponses = records;
            return true;
        } catch (error) {
            if (this.sweepRun === run && !(error instanceof SweepCancelledError)) {
                console.error('Error redoing measurement channel:', error);
                uiManager.showNotification(error instanceof NativeMeasurementInterruptedError
                    ? error.message : measurementErrorMessage(this), 'error');
            }
            return false;
        } finally {
            if (this.sweepRun === run) {
                clearInterval(this.levelGraphInterval);
                this.levelGraphInterval = null;
                for (const id of ['measurementActionsExplanation', 'redoBtn', 'saveAndContinueBtn',
                    'saveAndFinishBtn']) setDisplay(id, 'inline-block');
                setRedoChannelControlsVisible(true);
            }
        }
    },
    
    /**
     * Reset state for the next measurement
     */
    async resetForNextMeasurement() {
        try {
            await this.prepareForLevelAdjustment();
        } catch (error) {
            console.error('Could not return to level adjustment:', error);
            uiManager.showScreen('sweepMeasurementScreen');
            uiManager.showNotification(
                i18n.t('error:levelAdjustmentFailed') ||
                'The audio input could not be prepared. Check the input device and try again.',
                'error'
            );
            return false;
        }

        // Reset variables only after the next level-adjustment session is ready.
        this.currentSweepIndex = 0;
        this.sweepMeasurements = [];
        this.currentPoint = null;
        this.currentImpulseResponse = null;
        this.currentImpulseResponses = null;

        const canvas = document.getElementById('frequencyResponseGraph');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return true;
    },
    
    /**
     * Reset and prepare for a new sweep measurement without returning to level adjustment
     */
    resetForNextSweepMeasurement() {
        // Reset variables
        this.currentSweepIndex = 0;
        this.sweepMeasurements = [];
        this.currentPoint = null;
        this.currentImpulseResponse = null;
        this.currentImpulseResponses = null;
        
        // Clear graphs
        const canvas = document.getElementById('frequencyResponseGraph');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Stay on sweep measurement screen and start the next measurement directly
        return this.performSweepMeasurement();
    },
    
    /**
     * Calculate average frequency response from all measurement points
     */
    calculateAverageResponse(measurement = this.currentMeasurement) {
        recalculateAverages(measurement);
    }
};

export default SweepMeasurement;
