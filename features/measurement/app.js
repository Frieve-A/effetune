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
import {
    channelDisplayLabel,
    INDIVIDUAL_CHANNELS,
    normalizeOutputChannelSelection,
    resolveCheckboxToggle
} from './audio-utils/channel-selection.js';

let isAudioInitialized = false;
let audioInitializationPromise = null;
let configSubmissionPromise = null;
let backFromSweepTransitionPromise = null;
const sweepBandChannelValues = new Map();

function getSweepBandEditorChannels(selection = getOutputChannelSelection()) {
    return selection.includes('all') ? INDIVIDUAL_CHANNELS : selection;
}

function getOutputChannelSelection() {
    return normalizeOutputChannelSelection(
        [...document.querySelectorAll('#outputChannel input:checked')].map(input => input.value)
    );
}

function applyOutputChannelSelection(selection) {
    const selected = new Set(normalizeOutputChannelSelection(selection));
    document.querySelectorAll('#outputChannel input[type="checkbox"]').forEach(input => {
        input.checked = selected.has(input.value);
    });
    syncMultichannelControls([...selected]);
}

function syncMultichannelControls(selection = getOutputChannelSelection()) {
    const multi = selection.length > 1;
    const calibrationControls = document.getElementById('calibrationAssignmentControls');
    if (calibrationControls) calibrationControls.hidden = !multi;
    const noiseControls = document.getElementById('noiseChannelControls');
    if (noiseControls) noiseControls.hidden = !multi;
    for (const id of ['redoChannelSelect']) {
        const select = document.getElementById(id);
        if (!select) continue;
        const current = select.value;
        select.replaceChildren(...selection.map(channel => {
            const option = document.createElement('option');
            option.value = channel;
            option.textContent = channelDisplayLabel(channel);
            return option;
        }));
        select.value = selection.includes(current) ? current : selection[0];
    }
    syncNoiseChannelChoices(selection, multi);
    syncSweepBandChannelChoices(selection);
    rebuildPerChannelCalibrationRows(selection);
}

function syncNoiseChannelChoices(selection) {
    const container = document.getElementById('noiseChannel');
    if (!container) return;
    const current = container.querySelector('input:checked')?.value;
    const selectedChannel = selection.includes(current) ? current : selection[0];
    container.replaceChildren(...selection.map(channel => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'noiseChannel';
        input.value = channel;
        input.checked = channel === selectedChannel;
        const text = document.createElement('span');
        text.textContent = channelDisplayLabel(channel);
        label.append(input, text);
        return label;
    }));
    measurementController.currentNoiseChannel = selectedChannel;
}

function sweepBandDefaultValues() {
    return {
        minFreq: Number(document.getElementById('sweepMinFreq')?.value) || 20,
        maxFreq: Number(document.getElementById('sweepMaxFreq')?.value) || 20000
    };
}

function saveSweepBandChannelEditor() {
    const container = document.getElementById('sweepBandChannel');
    const channel = container?.dataset.editingChannel;
    if (!channel) return;
    sweepBandChannelValues.set(channel, {
        minFreq: Number(document.getElementById('sweepBandChannelMinFreq').value),
        maxFreq: Number(document.getElementById('sweepBandChannelMaxFreq').value)
    });
}

function loadSweepBandChannelEditor(channel) {
    if (!channel) return;
    const values = sweepBandChannelValues.get(channel) || sweepBandDefaultValues();
    document.getElementById('sweepBandChannel').dataset.editingChannel = channel;
    document.getElementById('sweepBandChannelMinFreq').value = values.minFreq;
    document.getElementById('sweepBandChannelMaxFreq').value = values.maxFreq;
}

function syncSweepBandChannelChoices(selection = getOutputChannelSelection()) {
    const container = document.getElementById('sweepBandChannel');
    if (!container) return;
    saveSweepBandChannelEditor();
    const channels = getSweepBandEditorChannels(selection);
    const current = container.querySelector('input:checked')?.value;
    const selectedChannel = channels.includes(current) ? current : channels[0];
    container.replaceChildren(...channels.map(channel => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'sweepBandChannel';
        input.value = channel;
        input.checked = channel === selectedChannel;
        const text = document.createElement('span');
        text.textContent = channelDisplayLabel(channel);
        label.append(input, text);
        return label;
    }));
    loadSweepBandChannelEditor(selectedChannel);
}

function getSweepBandMode() {
    return document.querySelector('#sweepBandMode input:checked')?.value || 'common';
}

function getSweepBandConfiguration() {
    saveSweepBandChannelEditor();
    const common = {
        minFreq: Number(document.getElementById('sweepMinFreq').value),
        maxFreq: Number(document.getElementById('sweepMaxFreq').value)
    };
    return {
        mode: getSweepBandMode(),
        common,
        perChannel: INDIVIDUAL_CHANNELS.map(channel => {
            const values = sweepBandChannelValues.get(channel) || common;
            return { channel, minFreq: values.minFreq, maxFreq: values.maxFreq };
        })
    };
}

function loadSweepBandConfiguration(sweepBand) {
    if (!sweepBand) return;
    const mode = ['off', 'common', 'perChannel'].includes(sweepBand.mode) ? sweepBand.mode : 'common';
    const modeInput = document.querySelector(`#sweepBandMode input[value="${mode}"]`);
    if (modeInput) modeInput.checked = true;
    if (sweepBand.common) {
        document.getElementById('sweepMinFreq').value = sweepBand.common.minFreq;
        document.getElementById('sweepMaxFreq').value = sweepBand.common.maxFreq;
    }
    document.getElementById('sweepBandChannel').dataset.editingChannel = '';
    sweepBandChannelValues.clear();
    for (const values of sweepBand.perChannel || []) {
        if (!INDIVIDUAL_CHANNELS.includes(values.channel)) continue;
        sweepBandChannelValues.set(values.channel, {
            minFreq: Number(values.minFreq),
            maxFreq: Number(values.maxFreq)
        });
    }
    syncSweepBandChannelChoices();
}

function rebuildPerChannelCalibrationRows(selection = getOutputChannelSelection()) {
    const rows = document.getElementById('perChannelCalibrationRows');
    const common = document.getElementById('interfaceCalibration');
    if (!rows || !common) return;
    const previous = new Map([...rows.querySelectorAll('select')].map(select => [select.dataset.channel, select.value]));
    rows.replaceChildren();
    for (const channel of selection) {
        const row = document.createElement('label');
        row.className = 'per-channel-calibration-row';
        row.textContent = `${channelDisplayLabel(channel)}: `;
        const select = common.cloneNode(true);
        select.removeAttribute('id');
        select.className = 'channel-calibration-select';
        select.dataset.channel = channel;
        select.value = previous.get(channel) || '';
        row.appendChild(select);
        rows.appendChild(row);
    }
    const perChannel = selection.length > 1 &&
        document.getElementById('calibrationAssignMode')?.value === 'perChannel';
    rows.hidden = !perChannel;
    if (common) common.hidden = perChannel;
}

function parseCalibrationValue(value) {
    if (!value) return null;
    const [sourceMeasurementId, sourcePointId, sourceChannel] = JSON.parse(value);
    return {
        sourceMeasurementId,
        sourcePointId,
        ...(typeof sourceChannel === 'string' ? { sourceChannel } : {})
    };
}

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

        const outputChannels = getOutputChannelSelection();
        const calibrationSelect = document.getElementById('interfaceCalibration');
        let interfaceCalibration = null;
        let interfaceCalibrations = null;
        const perChannelCalibration = outputChannels.length > 1 &&
            document.getElementById('calibrationAssignMode')?.value === 'perChannel';
        if (perChannelCalibration) {
            try {
                interfaceCalibrations = [...document.querySelectorAll('.channel-calibration-select')]
                    .map(select => {
                        const calibration = parseCalibrationValue(select.value);
                        return calibration ? { channel: select.dataset.channel, ...calibration } : null;
                    })
                    .filter(Boolean);
            } catch (error) {
                console.error('Invalid per-channel calibration selection:', error);
                uiManager.showNotification(i18n.t('error:interfaceCalibrationUnavailable') ||
                    'The selected calibration is no longer available. Choose another measurement point.', 'error');
                return;
            }
        } else if (calibrationSelect?.value) {
            try {
                interfaceCalibration = parseCalibrationValue(calibrationSelect.value);
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
            sweepBand: getSweepBandConfiguration(),
            averaging: parseInt(document.getElementById('averaging').value),
            inputChannel: document.getElementById('inputChannel').value,
            outputChannel: outputChannels.length > 1 ? 'multi' : outputChannels[0],
            ...(outputChannels.length > 1 ? { outputChannels } : {}),
            ...(interfaceCalibration ? { interfaceCalibration } : {}),
            ...(interfaceCalibrations?.length ? { interfaceCalibrations } : {})
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

        // Validate each configured sweep frequency range: 1 <= min < max <= Nyquist - 1.
        const nyquistLimit = Math.max(2, Math.floor(config.sampleRate / 2) - 1);
        const sweepRanges = config.sweepBand.mode === 'perChannel'
            ? config.sweepBand.perChannel.filter(({ channel }) =>
                getSweepBandEditorChannels(outputChannels).includes(channel))
            : config.sweepBand.mode === 'common' ? [config.sweepBand.common] : [];
        if (sweepRanges.some(({ minFreq, maxFreq }) =>
            !Number.isFinite(minFreq) || !Number.isFinite(maxFreq) ||
            minFreq < 1 || maxFreq > nyquistLimit || minFreq >= maxFreq)) {
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
    document.getElementById('redoChannelBtn').addEventListener('click', async () => {
        await measurementController.redoChannel(document.getElementById('redoChannelSelect').value);
    });
    document.getElementById('noiseChannel').addEventListener('change', event => {
        if (event.target.matches('input[type="radio"]')) {
            measurementController.setNoiseChannel(event.target.value);
        }
    });
    document.getElementById('noiseChannelMode').addEventListener('change', event => {
        if (!event.target.matches('input[type="radio"]')) return;
        if (event.target.value === 'auto') measurementController.startChannelRotation();
        else {
            measurementController.stopChannelRotation();
            measurementController.syncWhiteNoiseUi();
        }
    });
    document.getElementById('calibrationAssignMode').addEventListener('change', () => {
        rebuildPerChannelCalibrationRows();
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

    document.getElementById('copyChannelPEQBtn').addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            await uiManager.copyChannelPEQToClipboard();
        } finally {
            button.disabled = false;
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
    
    await copyPEQClipboardPayload(
        measurement,
        bandCount,
        copyTextToClipboard,
        window.app.uiManager.measurementDisplay?.selectedChannel
    );
}

/**
 * Save current form settings to localStorage
 */
function saveUserSettings(event) {
    if (event?.target?.matches?.('#outputChannel input[type="checkbox"]')) {
        const target = event.target;
        const current = getOutputChannelSelection();
        const previous = target.checked
            ? current.filter(channel => channel !== target.value)
            : [...current, target.value];
        applyOutputChannelSelection(resolveCheckboxToggle(previous, target.value, target.checked));
    }
    const outputChannels = getOutputChannelSelection();
    // Get current settings
    const settings = {
        // Measurement config settings
        sampleRate: document.getElementById('sampleRate').value,
        inputChannel: document.getElementById('inputChannel').value,
        outputChannel: outputChannels.length > 1 ? 'multi' : outputChannels[0],
        ...(outputChannels.length > 1 ? { outputChannels } : {}),
        sweepLength: document.getElementById('sweepLength').value,
        sweepBand: getSweepBandConfiguration(),
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
        applyOutputChannelSelection(settings.outputChannels || settings.outputChannel || 'all');
        if (settings.sweepLength) document.getElementById('sweepLength').value = settings.sweepLength;
        const legacySweepBand = typeof settings.sweepBandLimited === 'boolean' ? {
            mode: settings.sweepBandLimited ? 'common' : 'off',
            common: {
                minFreq: settings.sweepMinFreq,
                maxFreq: settings.sweepMaxFreq
            },
            perChannel: []
        } : null;
        loadSweepBandConfiguration(Object.hasOwn(settings, 'sweepBand')
            ? settings.sweepBand : legacySweepBand);
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
    selectSavedAudioDevices,
    syncMultichannelControls
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

    saveSweepBandChannelEditor();
    const inputPairs = [
        ['sweepMinFreq', 'sweepMaxFreq'],
        ['sweepBandChannelMinFreq', 'sweepBandChannelMaxFreq']
    ];
    for (const [minId, maxId] of inputPairs) {
        const minInput = document.getElementById(minId);
        const maxInput = document.getElementById(maxId);
        if (!minInput || !maxInput) continue;
        minInput.max = String(maxAllowed - 1);
        maxInput.max = String(maxAllowed);
        const currentMax = Number(maxInput.value);
        const currentMin = Number(minInput.value);
        maxInput.value = !Number.isFinite(currentMax) || currentMax > maxAllowed ? maxAllowed : currentMax;
        minInput.value = !Number.isFinite(currentMin) || currentMin < 1
            ? 1
            : currentMin >= Number(maxInput.value) ? Math.max(1, Number(maxInput.value) - 1) : currentMin;
    }
    saveSweepBandChannelEditor();
    const common = sweepBandDefaultValues();
    for (const [channel, values] of sweepBandChannelValues) {
        const maxFreq = !Number.isFinite(values.maxFreq) || values.maxFreq > maxAllowed
            ? maxAllowed
            : values.maxFreq;
        const minFreq = !Number.isFinite(values.minFreq) || values.minFreq < 1
            ? 1
            : values.minFreq >= maxFreq ? Math.max(1, maxFreq - 1) : values.minFreq;
        sweepBandChannelValues.set(channel, { minFreq, maxFreq });
    }
    if (!sweepBandChannelValues.size) {
        for (const channel of INDIVIDUAL_CHANNELS) {
            sweepBandChannelValues.set(channel, { ...common });
        }
    }
    loadSweepBandChannelEditor(document.querySelector('#sweepBandChannel input:checked')?.value);
}

function updateSweepBandLimitControls() {
    const mode = getSweepBandMode();
    const common = document.getElementById('sweepBandCommonInputs');
    const perChannel = document.getElementById('sweepBandChannelInputs');
    if (common) common.hidden = mode !== 'common';
    if (perChannel) perChannel.hidden = mode !== 'perChannel';
    document.querySelectorAll('#sweepBandCommonInputs input').forEach(input => {
        input.disabled = mode !== 'common';
    });
    document.querySelectorAll('#sweepBandChannelInputs input').forEach(input => {
        input.disabled = mode !== 'perChannel';
    });
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    installRangePrecisionControl(document);
    initializeApp();

    // Load user settings when app starts
    loadUserSettings();
    syncMultichannelControls();

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
    document.getElementById('sweepBandMode').addEventListener('change', () => {
        updateSweepBandLimitControls();
        saveUserSettings();
    });
    document.getElementById('sweepMinFreq').addEventListener('change', saveUserSettings);
    document.getElementById('sweepMaxFreq').addEventListener('change', saveUserSettings);
    document.getElementById('sweepBandChannel').addEventListener('change', () => {
        saveSweepBandChannelEditor();
        loadSweepBandChannelEditor(document.querySelector('#sweepBandChannel input:checked')?.value);
    });
    for (const id of ['sweepBandChannelMinFreq', 'sweepBandChannelMaxFreq']) {
        document.getElementById(id).addEventListener('change', () => {
            saveSweepBandChannelEditor();
            saveUserSettings();
        });
    }
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
