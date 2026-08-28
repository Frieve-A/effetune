/**
 * Main UI Manager for handling UI components and interactions
 */

import dataStorage, { MeasurementImportError } from '../dataStorage.js';
import measurementController from '../measurement-controller/index.js';
import audioUtils from '../audio-utils/index.js';
import MeasurementDisplay, { hasDesignableChannelResponses } from './measurement-display.js';
import GraphRenderer from './graph-renderer.js';
import CorrectionHandler from './correction-handler.js';
import DialogController from './dialog-controller.js';
import i18n from '../i18n.js';
import { copyTextToClipboard } from '../../../js/utils/clipboard-utils.js';
import { copyPerChannelPEQClipboardPayload } from './peq-clipboard.js';
import { importImpulseResponseWav } from '../impulse-response-import.js';
import { channelDisplayLabel } from '../audio-utils/channel-selection.js';
import { collectCalibrationIrCandidates } from '../measurement-model.js';

const AUDIO_ACTIVE_SCREENS = new Set(['levelAdjustmentScreen', 'sweepMeasurementScreen']);

export class UIManager {
    constructor() {
        this.currentScreen = 'resultsDisplayScreen';
        this.selectedMeasurementId = null;
        this.hasUnsavedChanges = false;
        this.doNotWarnOnDelete = false;
        this.pendingAction = null;
        this.pendingDeleteId = null;
        this.pendingDeleteType = null;
        this.measurementStateGeneration = 0;
        this.graphColors = {
            original: '#4e79a7',
            correction: '#f28e2b',
            corrected: '#59a14f'
        };
        
        // Initialize sub-controllers
        this.measurementDisplay = new MeasurementDisplay(this);
        this.graphRenderer = new GraphRenderer(this);
        this.correctionHandler = new CorrectionHandler(this);
        this.dialogController = new DialogController(this);
        this.configControlDisabledStates = new Map();
    }

    /**
     * Initialize the UI manager
     */
    async initialize() {
        this.initializeEventListeners();
        
        // Make sure doNotWarnOnDelete starts as false (show warnings by default)
        this.doNotWarnOnDelete = false;
        
        try {
            // Get the setting asynchronously
            const doNotWarn = await dataStorage.getDoNotWarnSetting();
            this.doNotWarnOnDelete = doNotWarn;
        } catch (error) {
            console.error('Error loading delete warning setting:', error);
            // Keep default value (false) if there's an error
        }
        
        this.showScreen('resultsDisplayScreen');
        this.updateMeasurementList();
        await this.updateStorageUsage();
        const storageNotice = document.getElementById('impulseResponseStorageNotice');
        if (storageNotice) storageNotice.hidden = dataStorage.irPersistenceAvailable !== false;
        
        // Select latest measurement if available
        const latestMeasurement = dataStorage.getLatestMeasurement();
        if (latestMeasurement) {
            this.selectMeasurement(latestMeasurement.id);
        }
        
        // Set legend colors
        document.querySelector('.original-line').style.backgroundColor = this.graphColors.original;
        document.querySelector('.correction-line').style.backgroundColor = this.graphColors.correction;
        document.querySelector('.corrected-line').style.backgroundColor = this.graphColors.corrected;
    }

    logSliderToValue(sliderValue, minValue, maxValue) {
        return this.correctionHandler.logSliderToValue(sliderValue, minValue, maxValue);
    }

    valueToLogSlider(value, minValue, maxValue) {
        return this.correctionHandler.valueToLogSlider(value, minValue, maxValue);
    }

    /**
     * Initialize all event listeners
     */
    initializeEventListeners() {
        this.graphRenderer.initializeImpulseResponseGraph();

        // Navigation buttons
        document.getElementById('newMeasurementBtn').addEventListener('click', () => this.startNewMeasurement());
        document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importInput').click());
        document.getElementById('importInput').addEventListener('change', (e) => this.handleImport(e));

        // Setup data storage event listeners
        document.addEventListener(dataStorage.EVENTS.MEASUREMENT_ADDED, () => {
            this.updateMeasurementList();
            this.updateStorageUsage();
        });
        document.addEventListener(dataStorage.EVENTS.MEASUREMENT_UPDATED, () => {
            this.updateMeasurementList();
            this.updateStorageUsage();
        });
        document.addEventListener(dataStorage.EVENTS.MEASUREMENT_DELETED, () => {
            this.updateMeasurementList();
            this.updateStorageUsage();
        });
        document.addEventListener(dataStorage.EVENTS.MEASUREMENTS_LOADED, () => this.updateMeasurementList());

        // Results screen
        document.getElementById('showOriginal').addEventListener('change', () => this.updateResultsGraph());
        document.getElementById('showCorrection').addEventListener('change', () => this.updateResultsGraph());
        document.getElementById('showCorrected').addEventListener('change', () => this.updateResultsGraph());
        
        // Target frequency range sliders
        document.getElementById('targetLowFreqSlider').addEventListener('input', (e) => {
            // Update slider value display
            const value = e.target.value;
            const freq = this.logSliderToValue(value, 20, 1000);
            document.getElementById('targetLowFreqValue').textContent = Math.round(freq);
            // Show spinner
            document.getElementById('loading-spinner-results').style.display = 'block';
            // Update markers and graph immediately, but don't recalculate PEQ parameters
            this.correctionHandler.updateFrequencyMarkers(true);
            // Hide spinner after graph update
            document.getElementById('loading-spinner-results').style.display = 'none';
        });

        document.getElementById('targetLowFreqSlider').addEventListener('change', () => {
            this.correctionHandler.requestCorrectionUpdate();
        });

        document.getElementById('targetHighFreqSlider').addEventListener('input', (e) => {
            // Update slider value display
            const value = e.target.value;
            const freq = this.logSliderToValue(value, 1000, 20000);
            document.getElementById('targetHighFreqValue').textContent = Math.round(freq);
            // Show spinner
            document.getElementById('loading-spinner-results').style.display = 'block';
            // Update markers and graph immediately, but don't recalculate PEQ parameters
            this.correctionHandler.updateFrequencyMarkers(true);
            // Hide spinner after graph update
            document.getElementById('loading-spinner-results').style.display = 'none';
        });

        document.getElementById('targetHighFreqSlider').addEventListener('change', () => {
            this.correctionHandler.requestCorrectionUpdate();
        });
        
        // Smoothing slider updates the graph immediately
        document.getElementById('smoothing').addEventListener('input', (e) => {
            document.getElementById('smoothingValue').textContent = parseFloat(e.target.value).toFixed(2);
            
            // Smoothing changes only affect the visual appearance of the graph
            this.updateResultsGraph();
            
            // Store the smoothing value
            const measurement = dataStorage.getMeasurementById(this.selectedMeasurementId);
            if (measurement) {
                measurement.smoothing = parseFloat(e.target.value);
            }
        });
        
        document.getElementById('smoothing').addEventListener('change', () => {
            this.correctionHandler.requestCorrectionUpdate();
        });
        
        // Add event listeners for EQ settings
        document.querySelectorAll('input[name="eqType"]').forEach(radio => {
            radio.addEventListener('change', () => {
                this.correctionHandler.requestCorrectionUpdate();
            });
        });
        
        document.getElementById('eqBandCount').addEventListener('input', (e) => {
            document.getElementById('eqBandCountValue').textContent = e.target.value;
            this.updateResultsGraph();
        });
        
        document.getElementById('eqBandCount').addEventListener('change', () => {
            this.correctionHandler.requestCorrectionUpdate();
        });
        
        document.getElementById('exportCSVBtn').addEventListener('click', () => this.exportCSV());
        document.getElementById('exportTxtBtn').addEventListener('click', () => this.exportTXT());
        
        // Edit actions
        document.getElementById('saveChangesBtn').addEventListener('click', () => this.saveChanges());
        document.getElementById('discardChangesBtn').addEventListener('click', () => this.discardChanges());

        // Confirmation dialog
        document.getElementById('confirmBtn').addEventListener('click', () => this.dialogController.handleConfirmation(true));
        document.getElementById('cancelBtn').addEventListener('click', () => this.dialogController.handleConfirmation(false));
        document.getElementById('doNotWarnAgain').addEventListener('change', (e) => {
            this.doNotWarnOnDelete = e.target.checked;
            dataStorage.setDoNotWarnSetting(this.doNotWarnOnDelete);
        });

        // Notification dialog
        document.getElementById('notificationOkBtn').addEventListener('click', () => this.dialogController.closeNotification());
    }

    /**
     * Show a specific screen
     * @param {string} screenId - ID of the screen to show
     */
    showScreen(screenId) {
        if (AUDIO_ACTIVE_SCREENS.has(this.currentScreen) && !AUDIO_ACTIVE_SCREENS.has(screenId)) {
            this.cleanupAudioBeforeNavigation();
        }
        
        // Show requested screen, hide others
        document.querySelectorAll('.screen').forEach(screen => {
            screen.style.display = screen.id === screenId ? 'block' : 'none';
        });
        
        this.currentScreen = screenId;

        // On the stacked mobile layout the active screen sits below the history
        // pane; bring it into view so screen changes are visible.
        if (document.body.classList.contains('layout-mobile')) {
            document.querySelector('.main-content')?.scrollIntoView({ behavior: 'smooth' });
        }
    }

    setConfigFormBusy(form, busy) {
        if (busy) {
            if (this.configControlDisabledStates.size > 0) return;
            for (const control of form.elements) {
                this.configControlDisabledStates.set(control, control.disabled);
                control.disabled = true;
            }
            return;
        }

        for (const [control, wasDisabled] of this.configControlDisabledStates) {
            control.disabled = wasDisabled;
        }
        this.configControlDisabledStates.clear();
    }
    
    /**
     * Clean up audio resources before navigation
     */
    cleanupAudioBeforeNavigation() {
        if (measurementController.isRunningMeasurement || measurementController.activeSweepOperation) {
            measurementController.cancelMeasurement();
        } else {
            measurementController.cleanup();
        }

        this.resetNoiseToggleButton();
    }

    resetNoiseToggleButton() {
        const button = document.getElementById('noiseToggleBtn');
        if (button) {
            button.textContent = i18n.t('button:playbackTestSignal') ||
                'Playback test signal for checking volume';
        }
    }

    /**
     * Update the measurement list in the left pane
     */
    updateMeasurementList() {
        return this.measurementDisplay.updateMeasurementList();
    }
    
    /**
     * Select a measurement and display its details
     * @param {string} id - Measurement ID to select
     * @returns {boolean} Whether the selection was successful
     */
    async selectMeasurement(id) {
        return this.measurementDisplay.selectMeasurement(id);
    }

    /**
     * Update the results graph based on current settings
     * @param {number|string} [pointIndex] - Optional specific point index to display, or 'all' for average
     * @param {boolean} [skipPEQUpdate=false] - If true, don't recalculate PEQ parameters
     */
    updateResultsGraph(pointIndex, skipPEQUpdate = false) {
        return this.graphRenderer.updateResultsGraph(pointIndex, skipPEQUpdate);
    }

    /**
     * Start a new measurement workflow
     */
    async startNewMeasurement() {
        // Check for unsaved changes first
        if (this.hasUnsavedChanges) {
            this.dialogController.showConfirmation(
                i18n.t('confirm:discardChanges') || 'You have unsaved changes. Discard changes and continue?',
                false
            );
            // Set up a pending action to continue after user confirmation
            this.pendingAction = () => {
                this.rollbackMeasurementChanges();
                this.startNewMeasurement(); // Re-call the function after confirmation
            };
            return;
        }

        const noiseChannelMode = document.getElementById('noiseChannelMode');
        const autoNoiseChannelMode = noiseChannelMode?.querySelector('input[value="auto"]');
        if (autoNoiseChannelMode) autoNoiseChannelMode.checked = true;
        const calibrationAssignMode = document.getElementById('calibrationAssignMode');
        if (calibrationAssignMode) calibrationAssignMode.value = 'common';
        const perChannelCalibrationRows = document.getElementById('perChannelCalibrationRows');
        if (perChannelCalibrationRows) {
            perChannelCalibrationRows.replaceChildren();
            perChannelCalibrationRows.hidden = true;
        }
        const commonCalibration = document.getElementById('interfaceCalibration');
        if (commonCalibration) commonCalibration.hidden = false;
        measurementController.stopChannelRotation();

        try {
            // Initialize audio context on first user gesture.
            await window.app.initializeAudio();
            await window.app.populateAudioDevices();

            // Proceed with measurement setup by preparing the config screen
            this.prepareConfigScreen();
            window.app.selectSavedAudioDevices();
        } catch (error) {
            console.error('Could not start new measurement due to audio initialization failure:', error);
            this.showNotification(
                i18n.t('error:audioInitFailed') ||
                    'The audio devices could not be prepared. Check browser permissions and try again.',
                'error'
            );
        }
    }

    async copyChannelPEQToClipboard() {
        const measurement = dataStorage.getMeasurementById(this.selectedMeasurementId);
        if (!hasDesignableChannelResponses(measurement)) {
            this.showNotification(
                i18n.t('error:noPEQSettings') || 'No PEQ settings available for this measurement',
                'error'
            );
            return false;
        }

        try {
            const settings = this.correctionHandler.getTargetSettings();
            const perChannel = [];
            for (const channel of measurement.outputChannels) {
                const response = measurement.channelResponses.find(entry => entry.channel === channel);
                perChannel.push({
                    channel,
                    peqParams: await this.correctionHandler.calculatePEQParametersForResponse(
                        response.averageFrequencyResponse, settings, measurement, channel
                    )
                });
            }
            await copyPerChannelPEQClipboardPayload(
                perChannel,
                parseInt(document.getElementById('eqBandCount').value),
                copyTextToClipboard
            );
            this.showNotification(i18n.t('message:channelPeqCopied') ||
                'Channel PEQ settings copied to the clipboard.');
            return true;
        } catch (error) {
            console.error('Could not copy channel PEQ settings:', error);
            this.showNotification(i18n.t('error:clipboardWriteFailed') ||
                'The PEQ settings could not be copied. Check clipboard access and try again.', 'error');
            return false;
        }
    }

    /**
     * Prepare the measurement configuration screen
     */
    prepareConfigScreen() {
        // Clear previous values
        document.getElementById('measurementName').value = '';

        const calibrationSelect = document.getElementById('interfaceCalibration');
        const calibrationHelp = document.getElementById('interfaceCalibrationHelp');
        const noCalibrationOption = document.createElement('option');
        noCalibrationOption.value = '';
        noCalibrationOption.textContent = i18n.t('option:noInterfaceCalibration') ||
            'None (uncalibrated)';
        calibrationSelect.replaceChildren(noCalibrationOption);

        let candidateCount = 0;
        if (dataStorage.irPersistenceAvailable !== false) {
            for (const measurement of dataStorage.getAllMeasurements()) {
                if (measurement.interfaceCalibration !== undefined ||
                    measurement.interfaceCalibrations !== undefined ||
                    typeof measurement.id !== 'string' ||
                    !Number.isFinite(measurement.sampleRate) ||
                    !Array.isArray(measurement.points)) {
                    continue;
                }
                for (const candidate of collectCalibrationIrCandidates(measurement)) {
                    const point = measurement.points[candidate.pointIndex];
                    const option = document.createElement('option');
                    option.value = JSON.stringify(candidate.channel === null
                        ? [measurement.id, candidate.pointId]
                        : [measurement.id, candidate.pointId, candidate.channel]);
                    const timestamp = new Date(measurement.timestamp);
                    const date = Number.isFinite(timestamp.getTime())
                        ? timestamp.toLocaleDateString()
                        : '';
                    const sampleRate = `${measurement.sampleRate / 1000} kHz`;
                    option.textContent = i18n.t('option:interfaceCalibrationPoint', {
                        measurement: measurement.name,
                        point: `${point.name || `Point ${candidate.pointIndex + 1}`}${
                            candidate.channel === null ? '' : ` (${channelDisplayLabel(candidate.channel)})`
                        }`,
                        date,
                        sampleRate
                    }) || `${measurement.name} — ${point.name || `Point ${pointIndex + 1}`} (${date}, ${sampleRate})`;
                    calibrationSelect.appendChild(option);
                    candidateCount += 1;
                }
            }
        }

        calibrationSelect.disabled = candidateCount === 0;
        globalThis.window?.app?.syncMultichannelControls?.();
        if (dataStorage.irPersistenceAvailable === false) {
            calibrationHelp.textContent = i18n.t('help:interfaceCalibrationUnavailable') ||
                'Audio interface calibration is unavailable because impulse responses cannot be saved in this browser.';
        } else if (candidateCount === 0) {
            calibrationHelp.textContent = i18n.t('help:noInterfaceCalibrationCandidates') ||
                'Save an uncalibrated measurement point with an impulse response before using audio interface calibration.';
        } else {
            calibrationHelp.textContent = i18n.t('help:interfaceCalibration') ||
                'Use a saved loopback measurement to remove the audio interface response. Keep the same interface, input/output channels, sampling rate, and input/output gains, and do not change the gains after the calibration measurement.';
        }
        
        // Show the configuration screen
        this.showScreen('measurementConfigScreen');

        // Set focus on the measurement name field
        document.getElementById('measurementName').focus();
    }

    /**
     * Handle the import button click
     * @param {Event} event - Change event from the file input
     */
    async handleImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = '';

        if (/\.wav$/i.test(file.name) || file.type === 'audio/wav' || file.type === 'audio/x-wav') {
            return this.importImpulseResponseFile(file);
        }

        try {
            return await this.importMeasurementText(await file.text());
        } catch (error) {
            console.error('Error reading measurement import file:', error);
            this.showNotification(
                i18n.t('error:measurementImportFailed') ||
                    'The measurement file could not be opened. Choose a valid measurement JSON file.',
                'error'
            );
            return null;
        }
    }

    async importImpulseResponseFile(file) {
        try {
            const measurementId = await importImpulseResponseWav(file, dataStorage);
            this.updateMeasurementList();
            await this.selectMeasurement(measurementId);
            return measurementId;
        } catch (error) {
            console.error('Error importing impulse response WAV:', error);
            if (error instanceof MeasurementImportError && error.kind === 'storage') {
                this.showNotification(i18n.t('message:saveFailed') ||
                    'The measurement could not be saved. Check available storage and try again.', 'error');
            } else if (error instanceof MeasurementImportError && error.kind === 'size') {
                this.showNotification(i18n.t('error:impulseResponseImportTooLarge') ||
                    'The impulse-response WAV file is too large. Select a shorter or smaller impulse response.',
                    'error');
            } else {
                this.showNotification(
                    i18n.t('error:impulseResponseImportFailed') ||
                        'The WAV file could not be imported. Choose a valid impulse-response WAV file with 1 to 8 channels.',
                    'error'
                );
            }
            return null;
        }
    }

    async importMeasurementText(jsonString) {
        try {
            const measurementId = await dataStorage.importMeasurementFromJSON(jsonString);
            if (!measurementId) {
                this.showNotification(
                    i18n.t('error:measurementImportFailed') ||
                        'The measurement file is not valid. Choose a measurement JSON file exported by EffeTune.',
                    'error'
                );
                return null;
            }
            this.updateMeasurementList();
            await this.selectMeasurement(measurementId);
            return measurementId;
        } catch (error) {
            console.error('Error importing measurement:', error);
            if (error instanceof MeasurementImportError && error.kind === 'storage') {
                this.showNotification(i18n.t('message:saveFailed') ||
                    'The measurement could not be saved. Check available storage and try again.', 'error');
            } else {
                this.showNotification(
                    i18n.t('error:measurementImportFailed') ||
                        'The measurement file is not valid. Choose a measurement JSON file exported by EffeTune.',
                    'error'
                );
            }
            return null;
        }
    }

    /**
     * Export current PEQ settings as CSV
     */
    exportCSV() {
        const measurement = dataStorage.getMeasurementById(this.selectedMeasurementId);
        if (!measurement || !measurement.peqParameters) return;
        
        const csvContent = dataStorage.exportPEQtoCSV(measurement.peqParameters);
        const filename = `${measurement.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_peq_${new Date().toISOString().split('T')[0]}.csv`;
        
        this.downloadFile(csvContent, filename, 'text/csv');
    }
    
    /**
     * Export current PEQ settings as txt format text file
     */
    exportTXT() {
        const measurement = dataStorage.getMeasurementById(this.selectedMeasurementId);
        if (!measurement || !measurement.peqParameters) return;
        
        const txtContent = dataStorage.exportPEQtoTXT(measurement.peqParameters);
        const filename = `${measurement.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_peq_${new Date().toISOString().split('T')[0]}.txt`;
        
        this.downloadFile(txtContent, filename, 'text/plain');
    }

    /**
     * Helper to download a file
     * @param {string} content - File content
     * @param {string} filename - File name
     * @param {string} contentType - Content type
     */
    downloadFile(content, filename, contentType) {
        const blob = new Blob([content], { type: contentType });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }

    /**
     * Show a notification message to the user
     * @param {string} message - The message to display
     * @param {string} type - The type of notification (info, error, etc.)
     */
    showNotification(message, type = 'info') {
        this.dialogController.showNotification(message);
    }

    async updateStorageUsage() {
        const element = document.getElementById('measurementStorageUsage');
        const storageNotice = document.getElementById('impulseResponseStorageNotice');
        if (storageNotice) storageNotice.hidden = dataStorage.irPersistenceAvailable !== false;
        if (!element) return;
        const estimate = await dataStorage.getStorageEstimate();
        if (!estimate || !Number.isFinite(estimate.usage)) {
            element.textContent = '';
            return;
        }
        const megabytes = estimate.usage / (1024 * 1024);
        element.textContent = i18n.t('message:measurementStorageUsage', {
            megabytes: megabytes.toFixed(megabytes >= 10 ? 0 : 1)
        }) || `Measurements: ${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
    }

    /**
     * Save changes to a measurement
     */
    async saveChanges() {
        const measurement = dataStorage.getMeasurementById(this.selectedMeasurementId);
        if (!measurement) return;
        
        // Save changes to storage
        const saved = await dataStorage.updateMeasurement(this.selectedMeasurementId, measurement);
        if (!saved) {
            this.showNotification(i18n.t('message:saveFailed') ||
                'The measurement could not be saved. Check available storage and try again.', 'error');
            return;
        }
        
        // Update state
        this.hasUnsavedChanges = false;
        document.getElementById('editActions').style.display = 'none';
    }

    /**
     * Restore the selected measurement without touching the DOM.
     */
    rollbackMeasurementChanges() {
        const measurement = dataStorage.getMeasurementById(this.selectedMeasurementId);
        ++this.measurementStateGeneration;
        if (measurement?._editSnapshot) {
            const snapshot = measurement._editSnapshot;
            for (const key of Object.keys(measurement)) delete measurement[key];
            Object.assign(measurement, structuredClone(snapshot));
        }
        this.hasUnsavedChanges = false;
    }

    /**
     * Discard changes to a measurement
     */
    discardChanges() {
        this.rollbackMeasurementChanges();
        document.getElementById('loading-spinner-results').style.display = 'none';
        // Reload the measurement from storage
        this.measurementDisplay.displayMeasurementDetails(this.selectedMeasurementId);
        
        // Update state
        document.getElementById('editActions').style.display = 'none';
    }
}

// Create and export singleton instance
const uiManager = new UIManager();
export default uiManager;
