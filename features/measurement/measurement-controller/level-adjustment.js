/**
 * Level adjustment functionality for the measurement controller
 */

import audioUtils from '../audioUtils.js';
import uiManager from '../uiManager.js';
import i18n from '../i18n.js';

const LevelAdjustment = {
    /**
     * Prepare for the level adjustment screen
     */
    async prepareForLevelAdjustment() {
        try {
            // Ensure audio context is available and running
            if (!audioUtils.audioContext) {
                console.error('Audio context not initialized');
                alert('Error: Audio context is not initialized. Please refresh the browser and try again.');
                return;
            }
            
            // Ensure audio context is running
            if (audioUtils.audioContext.state !== 'running') {
                try {
                    await audioUtils.audioContext.resume();
                } catch (error) {
                    console.error('Failed to resume audio context:', error);
                }
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
            alert(`Failed to access audio device: ${error.message}`);
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
            if (audioUtils.isWhiteNoiseActive) {
                console.log('Toggling white noise OFF');
                audioUtils.stopWhiteNoise();
                document.getElementById('noiseToggleBtn').textContent = i18n.t('button:playbackTestSignal') || 'Playback test signal for checking volume';
                document.getElementById('levelWarning').classList.remove('warning-visible');
                return false;
            } else {
                console.log('Toggling white noise ON');
                if (!this.measurementConfig) {
                    console.error('No measurement configuration available');
                    alert('Error: Measurement configuration is not available. Please start from the beginning.');
                    return false;
                }
                
                // Convert legacy 'both' value to 'all' for backwards compatibility
                let outputChannel = this.measurementConfig.outputChannel;
                if (outputChannel === 'both') {
                    outputChannel = 'all';
                }
                
                console.log(`Measurement config: ${JSON.stringify({
                    outputId: this.measurementConfig.audioOutputId,
                    outputChannel: outputChannel,
                })}`);
                
                const noiseLevel = parseFloat(document.getElementById('noiseLevel').value);
                console.log(`Starting white noise with level: ${noiseLevel}dB`);
                
                // Use the band limits from the current measurement (already clamped to
                // the usable [1, Nyquist - 1] range) so the test signal is band-limited
                // to match the sweep configuration.
                const bandMin = this.currentMeasurement ? this.currentMeasurement.sweepMinFreq : undefined;
                const bandMax = this.currentMeasurement ? this.currentMeasurement.sweepMaxFreq : undefined;

                const result = await audioUtils.startWhiteNoise(
                    noiseLevel,
                    this.measurementConfig.audioOutputId,
                    outputChannel,
                    bandMin,
                    bandMax
                );
                
                if (result) {
                    console.log('White noise started successfully, updating button text');
                    document.getElementById('noiseToggleBtn').textContent = i18n.t('button:stopTestSignal') || 'Stop test signal';
                } else {
                    console.error('Failed to start white noise');
                    alert('Error: Failed to start test signal playback. Please check browser settings.');
                }
                
                return result;
            }
        } catch (error) {
            console.error('Error toggling white noise:', error);
            alert(`Error: Error controlling test signal: ${error.message}`);
            return false;
        }
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