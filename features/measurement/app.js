/**
 * Main application entry point
 * Initializes and connects all components
 */

import audioUtils from './audio-utils/index.js';
import dataStorage from './dataStorage.js';
import uiManager from './ui/ui-manager.js';
import measurementController, {
    MeasurementSetupError
} from './measurement-controller/index.js';
import i18n from './i18n.js'; // Import the i18n module
import { startRendererWatchdogHeartbeat } from '../../js/electron-watchdog.js';
import { copyTextToClipboard } from '../../js/utils/clipboard-utils.js';
import { installRangePrecisionControl } from '../../js/ui/range-precision-controller.js';
import { copyPEQClipboardPayload } from './ui/peq-clipboard.js';

let isAudioInitialized = false;
let audioInitializationPromise = null;
let configSubmissionPromise = null;
let backFromSweepTransitionPromise = null;

startRendererWatchdogHeartbeat('measurement-page');

/**
 * Initialize all application components
 */
async function initializeApp() {
    try {
        // Initialize internationalization first
        await i18n.initI18n();
        
        // Initialize data storage first
        await dataStorage.initialize();
        
        // Check browser audio support and limitations
        checkBrowserAudioSupport();
        
        // Initialize UI last (after data is loaded)
        await uiManager.initialize();
        
        // Connect UI events to measurement controller
        setupEventConnections();
    } catch (error) {
        console.error('Error initializing application:', error);
        uiManager.showNotification(
            i18n.t('error:measurementSetupFailed') ||
                'The measurement tool could not be prepared. Reload the page and try again.',
            'error'
        );
    }
}

/**
 * Initialize audio components on user gesture
 */
async function initializeAudio() {
    if (isAudioInitialized) {
        return;
    }

    if (!audioInitializationPromise) {
        audioInitializationPromise = (async () => {
            try {
                await measurementController.initialize();
                isAudioInitialized = true;
            } catch (error) {
                console.error('Error initializing audio:', error);
                throw error;
            } finally {
                audioInitializationPromise = null;
            }
        })();
    }

    return audioInitializationPromise;
}

/**
 * Check browser audio support and limitations
 */
function checkBrowserAudioSupport() {
    // Check if AudioContext is supported
    if (!(window.AudioContext || window.webkitAudioContext)) {
        console.error('AudioContext is not supported in this browser');
        uiManager.showNotification(
            i18n.t('error:audioUnsupported') ||
                'This browser cannot run audio measurements. Use the latest Chrome or Edge.',
            'error'
        );
        return;
    }
    
    // Check if AudioWorklet is supported
    const tempContext = new (window.AudioContext || window.webkitAudioContext)();
    if (!tempContext.audioWorklet) {
        console.warn('AudioWorklet is not supported in this browser, will use fallback');
    }
    
    // Suspend the temporary context to avoid resource leak
    tempContext.close().catch(e => console.error('Error closing temp context:', e));
}

/**
 * Connect UI events to measurement controller functions
 */
function setupEventConnections() {
    // Configuration form submission
    document.getElementById('configForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (configSubmissionPromise) return;

        const calibrationSelect = document.getElementById('interfaceCalibration');
        let interfaceCalibration = null;
        if (calibrationSelect?.value) {
            try {
                const [sourceMeasurementId, sourcePointId] = JSON.parse(calibrationSelect.value);
                interfaceCalibration = { sourceMeasurementId, sourcePointId };
            } catch (error) {
                console.error('Invalid interface calibration selection:', error);
                uiManager.showNotification(
                    i18n.t('error:interfaceCalibrationUnavailable') ||
                    'The selected calibration is no longer available. Choose another measurement point.',
                    'error'
                );
                return;
            }
        }
        
        // Get form values
        const config = {
            name: document.getElementById('measurementName').value.trim(),
            audioInput: document.getElementById('audioInput').options[document.getElementById('audioInput').selectedIndex].text,
            audioInputId: document.getElementById('audioInput').value,
            audioOutput: document.getElementById('audioOutput').options[document.getElementById('audioOutput').selectedIndex].text,
            audioOutputId: document.getElementById('audioOutput').value,
            sampleRate: parseInt(document.getElementById('sampleRate').value),
            sweepLength: document.getElementById('sweepLength').value,
            sweepBandLimited: document.getElementById('sweepBandLimited').checked,
            sweepMinFreq: parseFloat(document.getElementById('sweepMinFreq').value),
            sweepMaxFreq: parseFloat(document.getElementById('sweepMaxFreq').value),
            averaging: parseInt(document.getElementById('averaging').value),
            inputChannel: document.getElementById('inputChannel').value,
            outputChannel: document.getElementById('outputChannel').value,
            ...(interfaceCalibration ? { interfaceCalibration } : {})
        };

        // Validate form
        if (!config.name) {
            uiManager.showNotification(
                i18n.t('error:measurementNameRequired') ||
                    'Enter a name for this measurement before continuing.',
                'error'
            );
            return;
        }

        // Validate sweep frequency range: 1 <= min < max <= Nyquist - 1
        const nyquistLimit = Math.max(2, Math.floor(config.sampleRate / 2) - 1);
        if (config.sweepBandLimited &&
            (!isFinite(config.sweepMinFreq) || !isFinite(config.sweepMaxFreq) ||
            config.sweepMinFreq < 1 || config.sweepMaxFreq > nyquistLimit ||
            config.sweepMinFreq >= config.sweepMaxFreq)) {
            uiManager.showNotification(
                i18n.t('error:invalidSweepRange', { max: nyquistLimit }) ||
                    `Set the sweep range between 1 Hz and ${nyquistLimit} Hz, with the lower value first.`,
                'error'
            );
            return;
        }
        
        const configForm = e.currentTarget;
        const operation = measurementController.startNewMeasurement(config);
        configSubmissionPromise = operation;
        uiManager.setConfigFormBusy(configForm, true);
        try {
            await operation;
        } catch (error) {
            console.error('Could not start measurement:', error);
            uiManager.showScreen('measurementConfigScreen');
            const errorKey = error instanceof MeasurementSetupError
                ? `error:${error.code}`
                : 'error:measurementSetupFailed';
            uiManager.showNotification(
                i18n.t(errorKey) ||
                'The measurement could not be prepared. Check the audio devices and try again.',
                'error'
            );
        } finally {
            if (configSubmissionPromise === operation) configSubmissionPromise = null;
            uiManager.setConfigFormBusy(configForm, false);
        }
    });
    
    // White noise toggle button
    document.getElementById('noiseToggleBtn').addEventListener('click', async () => {
        try {
            await measurementController.toggleWhiteNoise();
        } catch (error) {
            console.error('Error in noise toggle handler:', error);
            uiManager.showNotification(
                i18n.t('error:testSignalFailed') ||
                    'The test signal could not be controlled. Check the audio output and try again.',
                'error'
            );
        }
    });
    
    // Noise level slider
    document.getElementById('noiseLevel').addEventListener('input', (e) => {
        measurementController.updateNoiseLevel(e.target.value);
    });
    
    // Start measurement button
    document.getElementById('startMeasurementBtn').addEventListener('click', () => {
        measurementController.startSweepMeasurement();
    });
    
    // Redo button
    document.getElementById('redoBtn').addEventListener('click', () => {
        measurementController.redoMeasurement();
    });
    
    // Save and continue button
    document.getElementById('saveAndContinueBtn').addEventListener('click', async () => {
        try {
            await measurementController.saveAndContinueMeasurement();
        } catch (error) {
            console.error('Error saving measurement progress:', error);
        }
    });
    
    // Save and finish button
    document.getElementById('saveAndFinishBtn').addEventListener('click', async () => {
        try {
            // Call the measurement controller's method to save and finish
            const measurementId = await measurementController.finishMeasurement();
            
            if (measurementId) {
                // Navigate to results screen
                uiManager.showScreen('resultsDisplayScreen');
                // Select the newly saved measurement
                await uiManager.selectMeasurement(measurementId);
            }
        } catch (error) {
            console.error('Error finishing measurement:', error);
        }
    });

    // Return to the configuration screen. Screen transitions own audio cleanup.
    document.getElementById('backFromLevelBtn').addEventListener('click', () => {
        uiManager.showScreen('measurementConfigScreen');
    });
    
    const backFromSweepButton = document.getElementById('backFromSweepBtn');
    backFromSweepButton.addEventListener('click', () => {
        if (backFromSweepTransitionPromise) return;

        backFromSweepButton.disabled = true;
        const operation = Promise.resolve().then(async () => {
            try {
                measurementController.cancelMeasurement();
                if (audioUtils.audioContext?.state === 'running') {
                    await audioUtils.audioContext.suspend();
                }
                await measurementController.prepareForLevelAdjustment();
            } catch (error) {
                console.error('Could not return to level adjustment:', error);
                uiManager.showScreen('sweepMeasurementScreen');
                uiManager.showNotification(
                    i18n.t('error:levelAdjustmentFailed') ||
                    'The audio input could not be prepared. Check the input device and try again.',
                    'error'
                );
            } finally {
                if (backFromSweepTransitionPromise === operation) {
                    backFromSweepTransitionPromise = null;
                }
                backFromSweepButton.disabled = false;
            }
        });
        backFromSweepTransitionPromise = operation;
    });
    
    // Add window beforeunload event to clean up audio
    window.addEventListener('beforeunload', () => {
        uiManager.cleanupAudioBeforeNavigation();
    });
    
    // Copy PEQ settings to clipboard button
    document.getElementById('copyPEQBtn').addEventListener('click', async () => {
        const measurement = window.app.dataStorage.getMeasurementById(window.app.uiManager.selectedMeasurementId);
        if (!measurement || !measurement.peqParameters) {
            // Replace hardcoded message with i18n call
            const errorMessage = i18n.t('error:noPEQSettings') || 'No PEQ settings available for this measurement';
            uiManager.showNotification(errorMessage, 'error');
            return;
        }

        try {
            await copyPEQToClipboard();
            const successMessage = i18n.t('message:peqCopied') ||
                'PEQ settings copied to the clipboard. Paste them into EffeTune\'s Effect Pipeline with Ctrl+V.';
            uiManager.showNotification(successMessage);
        } catch (error) {
            console.error('Could not copy PEQ settings:', error);
            uiManager.showNotification(
                i18n.t('error:clipboardWriteFailed') ||
                    'The PEQ settings could not be copied. Check clipboard access and try again.',
                'error'
            );
        }
    });

}

/**
 * Populate audio device select elements
 */
async function populateAudioDevices() {
    try {
        // Wait for audio to be initialized
        if (!audioUtils.initialized) {
            await audioUtils.initialize();
        }
        
        // Get devices
        const devices = audioUtils.devices;
        
        // Populate input devices
        const inputSelect = document.getElementById('audioInput');
        inputSelect.innerHTML = '';
        
        devices.inputs.forEach(device => {
            const option = document.createElement('option');
            option.value = device.id;
            option.text = device.label;
            inputSelect.appendChild(option);
        });
        
        // Populate output devices
        const outputSelect = document.getElementById('audioOutput');
        outputSelect.innerHTML = '';
        
        devices.outputs.forEach(device => {
            const option = document.createElement('option');
            option.value = device.id;
            option.text = device.label;
            outputSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error populating audio devices:', error);
    }
}

/**
 * Copy PEQ settings to clipboard
 */
async function copyPEQToClipboard() {
    // Get the current measurement
    const measurement = window.app.dataStorage.getMeasurementById(window.app.uiManager.selectedMeasurementId);
    if (!measurement || !measurement.peqParameters) {
        throw new Error('No PEQ settings are available');
    }
    
    // Get the EQ band count
    const bandCount = parseInt(document.getElementById('eqBandCount').value);
    
    await copyPEQClipboardPayload(measurement, bandCount, copyTextToClipboard);
}

/**
 * Save current form settings to localStorage
 */
function saveUserSettings() {
    // Get current settings
    const settings = {
        // Measurement config settings
        sampleRate: document.getElementById('sampleRate').value,
        inputChannel: document.getElementById('inputChannel').value,
        outputChannel: document.getElementById('outputChannel').value,
        sweepLength: document.getElementById('sweepLength').value,
        sweepBandLimited: document.getElementById('sweepBandLimited').checked,
        sweepMinFreq: document.getElementById('sweepMinFreq').value,
        sweepMaxFreq: document.getElementById('sweepMaxFreq').value,
        averaging: document.getElementById('averaging').value,
    };
    
    // Save audio devices if available
    const audioInput = document.getElementById('audioInput');
    const audioOutput = document.getElementById('audioOutput');
    
    if (audioInput && audioInput.value) {
        settings.audioInputId = audioInput.value;
        const selectedOption = audioInput.options[audioInput.selectedIndex];
        if (selectedOption) {
            settings.audioInputLabel = selectedOption.text;
        }
    }
    
    if (audioOutput && audioOutput.value) {
        settings.audioOutputId = audioOutput.value;
        const selectedOption = audioOutput.options[audioOutput.selectedIndex];
        if (selectedOption) {
            settings.audioOutputLabel = selectedOption.text;
        }
    }
    
    window.app.dataStorage.saveUserSettings(settings);
}

/**
 * Save current PEQ parameters to global settings
 * These are shared across all measurements
 */
function savePEQSettings() {
    const peqSettings = {
        // PEQ settings
        smoothing: document.getElementById('smoothing').value,
        lowFreq: document.getElementById('targetLowFreqSlider').value,
        highFreq: document.getElementById('targetHighFreqSlider').value,
        eqBandCount: document.getElementById('eqBandCount').value
    };
    
    window.app.dataStorage.savePEQSettings(peqSettings);
}

/**
 * Load user settings from localStorage and apply them
 */
function loadUserSettings() {
    const settings = window.app.dataStorage.loadUserSettings();
    
    // Apply settings if they exist
    if (settings) {
        // Measurement config settings
        if (settings.sampleRate) document.getElementById('sampleRate').value = settings.sampleRate;
        if (settings.inputChannel) document.getElementById('inputChannel').value = settings.inputChannel;
        if (settings.outputChannel) document.getElementById('outputChannel').value = settings.outputChannel;
        if (settings.sweepLength) document.getElementById('sweepLength').value = settings.sweepLength;
        if (typeof settings.sweepBandLimited === 'boolean') {
            document.getElementById('sweepBandLimited').checked = settings.sweepBandLimited;
        }
        if (settings.sweepMinFreq) document.getElementById('sweepMinFreq').value = settings.sweepMinFreq;
        if (settings.sweepMaxFreq) document.getElementById('sweepMaxFreq').value = settings.sweepMaxFreq;
        if (settings.averaging) document.getElementById('averaging').value = settings.averaging;
    }
}

/**
 * Load PEQ settings and apply them to the UI
 */
function loadPEQSettings() {
    const peqSettings = window.app.dataStorage.loadPEQSettings();
    
    if (peqSettings) {
        // PEQ settings
        if (peqSettings.smoothing) {
            const smoothingSlider = document.getElementById('smoothing');
            const smoothingValue = document.getElementById('smoothingValue');
            if (smoothingSlider && smoothingValue) {
                smoothingSlider.value = peqSettings.smoothing;
                smoothingValue.textContent = parseFloat(peqSettings.smoothing).toFixed(2);
            }
        }
        
        if (peqSettings.lowFreq) {
            const lowFreqSlider = document.getElementById('targetLowFreqSlider');
            const lowFreqValue = document.getElementById('targetLowFreqValue');
            if (lowFreqSlider && lowFreqValue) {
                lowFreqSlider.value = peqSettings.lowFreq;
                lowFreqValue.textContent = Math.round(window.app.uiManager.logSliderToValue(peqSettings.lowFreq, 20, 1000));
            }
        }
        
        if (peqSettings.highFreq) {
            const highFreqSlider = document.getElementById('targetHighFreqSlider');
            const highFreqValue = document.getElementById('targetHighFreqValue');
            if (highFreqSlider && highFreqValue) {
                highFreqSlider.value = peqSettings.highFreq;
                highFreqValue.textContent = Math.round(window.app.uiManager.logSliderToValue(peqSettings.highFreq, 1000, 20000));
            }
        }
        
        if (peqSettings.eqBandCount) {
            const eqBandCountSlider = document.getElementById('eqBandCount');
            const eqBandCountValue = document.getElementById('eqBandCountValue');
            if (eqBandCountSlider && eqBandCountValue) {
                eqBandCountSlider.value = peqSettings.eqBandCount;
                eqBandCountValue.textContent = peqSettings.eqBandCount;
            }
        }
        
        // Apply settings to current measurement display if any
        if (window.app.uiManager.selectedMeasurementId) {
            window.app.uiManager.updateResultsGraph();
            window.app.uiManager.correctionHandler.requestCorrectionUpdate();
        }
    }
}

/**
 * Select saved audio devices if available
 */
function selectSavedAudioDevices() {
    const settings = window.app.dataStorage.loadUserSettings();
    
    if (settings) {
        const audioInput = document.getElementById('audioInput');
        const audioOutput = document.getElementById('audioOutput');
        
        // Select saved input device if available
        if (settings.audioInputId && audioInput) {
            for (let i = 0; i < audioInput.options.length; i++) {
                if (audioInput.options[i].value === settings.audioInputId) {
                    audioInput.selectedIndex = i;
                    break;
                }
            }
        }
        
        // Select saved output device if available
        if (settings.audioOutputId && audioOutput) {
            for (let i = 0; i < audioOutput.options.length; i++) {
                if (audioOutput.options[i].value === settings.audioOutputId) {
                    audioOutput.selectedIndex = i;
                    break;
                }
            }
        }
    }
}

// Expose necessary functions to the global scope to be called from other modules
window.app = {
    audioUtils,
    dataStorage,
    uiManager,
    measurementController,
    initializeApp,
    initializeAudio,
    populateAudioDevices,
    copyPEQToClipboard,
    loadUserSettings,
    saveUserSettings,
    loadPEQSettings,
    savePEQSettings,
    selectSavedAudioDevices
};

/**
 * Update min/max attributes of the sweep frequency inputs based on current
 * sampling rate. The usable range is [1, Nyquist - 1] Hz. Existing values are
 * clamped into range so the UI never presents an invalid configuration.
 */
function updateSweepFreqLimits() {
    const sampleRate = parseInt(document.getElementById('sampleRate').value) || 48000;
    const nyquist = Math.floor(sampleRate / 2);
    const maxAllowed = Math.max(2, nyquist - 1);

    const minInput = document.getElementById('sweepMinFreq');
    const maxInput = document.getElementById('sweepMaxFreq');
    if (!minInput || !maxInput) return;

    minInput.max = String(maxAllowed - 1);
    maxInput.max = String(maxAllowed);

    const currentMin = parseFloat(minInput.value);
    const currentMax = parseFloat(maxInput.value);

    if (!isFinite(currentMax) || currentMax > maxAllowed) {
        maxInput.value = maxAllowed;
    }
    if (!isFinite(currentMin) || currentMin < 1) {
        minInput.value = 1;
    } else if (currentMin >= parseFloat(maxInput.value)) {
        minInput.value = Math.max(1, parseFloat(maxInput.value) - 1);
    }
}

function updateSweepBandLimitControls() {
    const bandLimitedInput = document.getElementById('sweepBandLimited');
    const minInput = document.getElementById('sweepMinFreq');
    const maxInput = document.getElementById('sweepMaxFreq');
    if (!bandLimitedInput || !minInput || !maxInput) return;

    const disabled = !bandLimitedInput.checked;
    minInput.disabled = disabled;
    maxInput.disabled = disabled;
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    installRangePrecisionControl(document);
    initializeApp();

    // Load user settings when app starts
    loadUserSettings();

    // Apply Nyquist limits to the sweep frequency inputs based on current sample rate
    updateSweepFreqLimits();
    updateSweepBandLimitControls();

    // Load PEQ settings when app starts
    loadPEQSettings();

    // Save measurement settings when values change
    document.getElementById('sampleRate').addEventListener('change', () => {
        updateSweepFreqLimits();
        saveUserSettings();
    });
    document.getElementById('inputChannel').addEventListener('change', saveUserSettings);
    document.getElementById('outputChannel').addEventListener('change', saveUserSettings);
    document.getElementById('sweepLength').addEventListener('change', saveUserSettings);
    document.getElementById('sweepBandLimited').addEventListener('change', () => {
        updateSweepBandLimitControls();
        saveUserSettings();
    });
    document.getElementById('sweepMinFreq').addEventListener('change', saveUserSettings);
    document.getElementById('sweepMaxFreq').addEventListener('change', saveUserSettings);
    document.getElementById('averaging').addEventListener('change', saveUserSettings);
    document.getElementById('audioInput').addEventListener('change', saveUserSettings);
    document.getElementById('audioOutput').addEventListener('change', saveUserSettings);
    
    // Save PEQ settings when values change
    document.getElementById('smoothing').addEventListener('change', savePEQSettings);
    document.getElementById('targetLowFreqSlider').addEventListener('change', savePEQSettings);
    document.getElementById('targetHighFreqSlider').addEventListener('change', savePEQSettings);
    document.getElementById('eqBandCount').addEventListener('change', savePEQSettings);
    
    // Add input handlers to update the display immediately
    document.getElementById('smoothing').addEventListener('input', () => {
        const value = document.getElementById('smoothing').value;
        document.getElementById('smoothingValue').textContent = parseFloat(value).toFixed(2);
    });
    
    document.getElementById('targetLowFreqSlider').addEventListener('input', () => {
        const value = document.getElementById('targetLowFreqSlider').value;
        const freq = window.app.uiManager.logSliderToValue(value, 20, 1000);
        document.getElementById('targetLowFreqValue').textContent = Math.round(freq);
    });
    
    document.getElementById('targetHighFreqSlider').addEventListener('input', () => {
        const value = document.getElementById('targetHighFreqSlider').value;
        const freq = window.app.uiManager.logSliderToValue(value, 1000, 20000);
        document.getElementById('targetHighFreqValue').textContent = Math.round(freq);
    });
    
    document.getElementById('eqBandCount').addEventListener('input', () => {
        const value = document.getElementById('eqBandCount').value;
        document.getElementById('eqBandCountValue').textContent = value;
    });
});

// Handle errors
window.addEventListener('error', (e) => {
    console.error('Global error:', e.error);
});
