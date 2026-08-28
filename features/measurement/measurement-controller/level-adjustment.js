/**
 * Level adjustment functionality for the measurement controller
 */

import audioUtils from '../audio-utils/index.js';
import uiManager from '../ui/ui-manager.js';
import i18n from '../i18n.js';
import { MeasurementOutputError } from '../audio-utils/output-routing.js';
import {
    isMultiChannelSelection,
    nextRotationChannel,
    selectionFromConfig
} from '../audio-utils/channel-selection.js';
import { resolveSweepBand, resolveOutputSweepBands } from '../measurement-model.js';

const ROTATION_INTERVAL_MS = 3000;

function checkedNoiseOption(id) {
    return document.getElementById(id)?.querySelector('input:checked')?.value;
}

function testSignalErrorMessage(error) {
    return error instanceof MeasurementOutputError
        ? error.message
        : i18n.t('error:testSignalFailed') ||
            'The test signal could not be played. Check the audio output and try again.';
}

const LevelAdjustment = {
    /**
     * Prepare for the level adjustment screen
     */
    async prepareForLevelAdjustment() {
        try {
            // Ensure audio context is available and running
            if (!audioUtils.audioContext) {
                throw new Error('Audio context is not initialized');
            }
            
            // Ensure audio context is running
            if (audioUtils.audioContext.state !== 'running') {
                await audioUtils.audioContext.resume();
            }
            
            // Start input monitoring
            await audioUtils.startMicrophoneInput(this.measurementConfig.audioInputId, this.measurementConfig.inputChannel);
            
            // Start level meter updates
            this.startLevelMeter();
            
            // Show level adjustment screen
            uiManager.showScreen('levelAdjustmentScreen');
            
            // Reset noise toggle button text state regardless of previous state
            document.getElementById('noiseToggleBtn').textContent = i18n.t('button:playbackTestSignal') || 'Playback test signal for checking volume';
        } catch (error) {
            console.error('Error preparing level adjustment:', error);
            this.stopLevelMeter();
            try {
                audioUtils.stopMicrophoneInput();
            } catch (cleanupError) {
                console.warn('Error stopping microphone input after setup failure:', cleanupError);
            }
            throw error;
        }
    },

    /**
     * Start the level meter updates
     */
    startLevelMeter() {
        // Clear any existing interval
        this.stopLevelMeter();
        
        const levelBar = document.getElementById('levelBar');
        const levelWarning = document.getElementById('levelWarning');
        
        // Clear any previous warning message
        levelWarning.classList.remove('warning-visible');
        
        this.levelMeterInterval = setInterval(() => {
            const inputLevel = audioUtils.getInputLevel();
            
            // Update level meter (convert dB to percentage)
            const levelPercent = this.dbToPercent(inputLevel);
            levelBar.style.width = `${levelPercent}%`;
            
            // Check noise level if white noise is playing
            if (audioUtils.isWhiteNoiseActive) {
                const noiseLevel = parseFloat(document.getElementById('noiseLevel').value);
                
                // Update warning message
                if (inputLevel >= -6) {
                    levelWarning.textContent = i18n.t('warning:inputTooHigh') || 'Input too high! Reduce microphone gain or speaker volume.';
                    levelWarning.classList.add('warning-visible');
                } else if (inputLevel < -36) {
                    levelWarning.textContent = i18n.t('warning:inputTooLow') || 'Input too low. Increase microphone gain or speaker volume.';
                    levelWarning.classList.add('warning-visible');
                } else {
                    levelWarning.classList.remove('warning-visible');
                }
            }
        }, 100); // Update every 100ms
    },
    
    /**
     * Stop the level meter updates
     */
    stopLevelMeter() {
        if (this.levelMeterInterval) {
            clearInterval(this.levelMeterInterval);
            this.levelMeterInterval = null;
        }
    },
    
    /**
     * Toggle white noise playback
     * @returns {Promise<boolean>} New white noise state
     */
    async toggleWhiteNoise() {
        try {
            if (audioUtils.isWhiteNoiseActive || audioUtils.isWhiteNoisePending ||
                audioUtils.whiteNoiseDesiredActive) {
                console.log('Toggling white noise OFF');
                this.stopChannelRotation();
                audioUtils.stopWhiteNoise();
                this.syncWhiteNoiseUi();
                document.getElementById('levelWarning').classList.remove('warning-visible');
                return false;
            } else {
                console.log('Toggling white noise ON');
                if (!this.measurementConfig) {
                    console.error('No measurement configuration available');
                    uiManager.showNotification(
                        i18n.t('error:measurementConfigUnavailable') ||
                            'The measurement settings are no longer available. Start a new measurement.',
                        'error'
                    );
                    return false;
                }
                
                const selection = selectionFromConfig(this.measurementConfig);
                const multiChannel = isMultiChannelSelection(selection);
                let outputChannel = multiChannel
                    ? checkedNoiseOption('noiseChannel') || this.currentNoiseChannel || selection[0]
                    : selection[0];
                if (!selection.includes(outputChannel)) outputChannel = selection[0];
                this.currentNoiseChannel = outputChannel;
                
                console.log(`Measurement config: ${JSON.stringify({
                    outputId: this.measurementConfig.audioOutputId,
                    outputChannel: outputChannel,
                })}`);
                
                const startOperation = this.restartWhiteNoiseForChannel(outputChannel);
                const startToken = audioUtils.whiteNoiseOperationToken;
                this.syncWhiteNoiseUi();
                const result = await startOperation;
                
                const active = this.syncWhiteNoiseUi();
                if (result && active) {
                    console.log('White noise started successfully, updating button text');
                    if (multiChannel && (checkedNoiseOption('noiseChannelMode') || 'auto') === 'auto') {
                        this.startChannelRotation();
                    }
                } else if (!active && startToken === audioUtils.whiteNoiseOperationToken) {
                    console.error('Failed to start white noise');
                    uiManager.showNotification(
                        i18n.t('error:testSignalFailed') ||
                            'The test signal could not be played. Check the audio output and try again.',
                        'error'
                    );
                }
                
                return active;
            }
        } catch (error) {
            console.error('Error toggling white noise:', error);
            this.stopChannelRotation();
            const active = this.syncWhiteNoiseUi();
            if (!active) uiManager.showNotification(testSignalErrorMessage(error), 'error');
            return active;
        }
    },

    syncWhiteNoiseUi() {
        const active = Boolean(audioUtils.isWhiteNoiseActive);
        const desired = active || Boolean(audioUtils.isWhiteNoisePending) ||
            Boolean(audioUtils.whiteNoiseDesiredActive);
        const button = document.getElementById('noiseToggleBtn');
        if (button) {
            button.textContent = desired
                ? i18n.t('button:stopTestSignal') || 'Stop test signal'
                : i18n.t('button:playbackTestSignal') || 'Playback test signal for checking volume';
        }
        if (active && audioUtils.whiteNoiseChannel) {
            this.updateNoiseChannelDisplay(audioUtils.whiteNoiseChannel);
        }
        return active;
    },

    updateNoiseChannelDisplay(channel) {
        this.currentNoiseChannel = channel;
        for (const radio of document.getElementById('noiseChannel')?.querySelectorAll('input[type="radio"]') || []) {
            radio.checked = radio.value === channel;
        }
    },

    async restartWhiteNoiseForChannel(channel) {
        const noiseLevel = parseFloat(document.getElementById('noiseLevel').value);
        const config = this.currentMeasurement || this.measurementConfig;
        const sampleRate = audioUtils.audioContext?.sampleRate || Number(this.measurementConfig.sampleRate) || 48000;
        const length = this.measurementConfig.sweepLength;
        const band = resolveSweepBand(config, channel, sampleRate, length);
        const outputBands = channel === 'all' && config.sweepBand?.mode === 'perChannel'
            ? resolveOutputSweepBands(config, sampleRate, length) : undefined;
        return audioUtils.startWhiteNoise(
            noiseLevel,
            this.measurementConfig.audioOutputId,
            channel,
            band.minFreq,
            band.maxFreq,
            outputBands
        );
    },

    async setNoiseChannel(channel) {
        this.currentNoiseChannel = channel;
        this.updateNoiseChannelDisplay(channel);
        if (!audioUtils.isWhiteNoiseActive && !audioUtils.isWhiteNoisePending &&
            !audioUtils.whiteNoiseDesiredActive) return true;
        let startToken = null;
        try {
            const operation = this.restartWhiteNoiseForChannel(channel);
            startToken = audioUtils.whiteNoiseOperationToken;
            const result = await operation;
            const active = this.syncWhiteNoiseUi();
            if (startToken !== audioUtils.whiteNoiseOperationToken) return false;
            if (!result) throw new Error('Test signal could not be started');
            return active;
        } catch (error) {
            if (startToken !== null && startToken !== audioUtils.whiteNoiseOperationToken) {
                this.syncWhiteNoiseUi();
                return false;
            }
            this.stopChannelRotation();
            this.syncWhiteNoiseUi();
            uiManager.showNotification(testSignalErrorMessage(error), 'error');
            return false;
        }
    },

    startChannelRotation() {
        this.invalidateChannelRotationTimer();
        const selection = selectionFromConfig(this.measurementConfig);
        if (!audioUtils.isWhiteNoiseActive || !isMultiChannelSelection(selection) ||
            (checkedNoiseOption('noiseChannelMode') || 'auto') !== 'auto') return;
        const epoch = ++this.channelRotationEpoch;
        this.channelRotationTimer = setInterval(async () => {
            if (this.channelRotationTickInFlight || epoch !== this.channelRotationEpoch) return;
            this.channelRotationTickInFlight = true;
            try {
                const next = nextRotationChannel(selection, this.currentNoiseChannel);
                let result;
                let startToken = null;
                try {
                    const operation = this.restartWhiteNoiseForChannel(next);
                    startToken = audioUtils.whiteNoiseOperationToken;
                    result = await operation;
                } catch (error) {
                    if (epoch !== this.channelRotationEpoch ||
                        (startToken !== null && startToken !== audioUtils.whiteNoiseOperationToken)) {
                        this.syncWhiteNoiseUi();
                        return;
                    }
                    throw error;
                }
                if (epoch !== this.channelRotationEpoch ||
                    startToken !== audioUtils.whiteNoiseOperationToken) {
                    this.syncWhiteNoiseUi();
                    return;
                }
                this.syncWhiteNoiseUi();
                if (!result) throw new Error('Test signal could not be started');
            } catch (error) {
                this.stopChannelRotation();
                this.syncWhiteNoiseUi();
                uiManager.showNotification(testSignalErrorMessage(error), 'error');
            } finally {
                this.channelRotationTickInFlight = false;
            }
        }, ROTATION_INTERVAL_MS);
    },

    invalidateChannelRotationTimer() {
        if (!Number.isSafeInteger(this.channelRotationEpoch)) this.channelRotationEpoch = 0;
        this.channelRotationEpoch += 1;
        if (this.channelRotationTimer) clearInterval(this.channelRotationTimer);
        this.channelRotationTimer = null;
    },

    stopChannelRotation() {
        this.invalidateChannelRotationTimer();
        audioUtils.cancelPendingWhiteNoiseStart?.();
    },
    
    /**
     * Update the white noise level
     * @param {number} level - Noise level in dB
     */
    updateNoiseLevel(level) {
        document.getElementById('noiseLevelValue').textContent = `${level} dB`;
        
        if (audioUtils.isWhiteNoiseActive) {
            audioUtils.setNoiseLevel(level);
        }
    },
    
    /**
     * Convert dB value to percentage for level meter
     * @param {number} db - dB value
     * @returns {number} Percentage (0-100)
     */
    dbToPercent(db) {
        // Convert dB to percentage (0-100)
        // Map -60dB to 0% and 0dB to 100%
        return Math.max(0, Math.min(100, (db + 60) * (100 / 60)));
    }
};

export default LevelAdjustment;
