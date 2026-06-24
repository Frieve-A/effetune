/**
 * Main UI Manager for handling UI components and interactions
 */

import dataStorage from '../dataStorage.js';
import measurementController from '../measurementController.js';
import audioUtils from '../audioUtils.js';
import MeasurementDisplay from './measurement-display.js';
import GraphRenderer from './graph-renderer.js';
import CorrectionHandler from './correction-handler.js';
import DialogController from './dialog-controller.js';
import i18n from '../i18n.js';

class UIManager {
    constructor() {
        this.currentScreen = 'resultsDisplayScreen';
        this.selectedMeasurementId = null;
        this.hasUnsavedChanges = false;
        this.doNotWarnOnDelete = false;
        this.pendingAction = null;
        this.pendingDeleteId = null;
        this.pendingDeleteType = null;
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

    /**
     * Initialize all event listeners
     */
    initializeEventListeners() {
        // Navigation buttons
        document.getElementById('newMeasurementBtn').addEventListener('click', () => this.startNewMeasurement());
        document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importInput').click());
        document.getElementById('importInput').addEventListener('change', (e) => this.handleImport(e));

        // Setup data storage event listeners
        document.addEventListener(dataStorage.EVENTS.MEASUREMENT_ADDED, () => this.updateMeasurementList());
        document.addEventListener(dataStorage.EVENTS.MEASUREMENT_UPDATED, () => this.updateMeasurementList());
        document.addEventListener(dataStorage.EVENTS.MEASUREMENT_DELETED, () => this.updateMeasurementList());
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
            // Recalculate PEQ parameters once when drag is complete
            const spinner = document.getElementById('loading-spinner-results');
            spinner.style.display = 'block';
            
            setTimeout(async () => {
                await this.correctionHandler.updateCorrection();
                spinner.style.display = 'none';
            }, 50);
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
            // Recalculate PEQ parameters once when drag is complete
            const spinner = document.getElementById('loading-spinner-results');
            spinner.style.display = 'block';
            
            setTimeout(async () => {
                await this.correctionHandler.updateCorrection();
                spinner.style.display = 'none';
            }, 50);
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
            const spinner = document.getElementById('loading-spinner-results');
            spinner.style.display = 'block';
            
            // Show spinner and update asynchronously
            setTimeout(async () => {
                await this.correctionHandler.updateCorrection();
                spinner.style.display = 'none';
            }, 50);
        });
        
        // Add event listeners for EQ settings
        document.querySelectorAll('input[name="eqType"]').forEach(radio => {
            radio.addEventListener('change', () => {
                const spinner = document.getElementById('loading-spinner-results');
                spinner.style.display = 'block';
                
                // Show spinner and update asynchronously
                setTimeout(async () => {
                    await this.correctionHandler.updateCorrection();
                    spinner.style.display = 'none';
                }, 50);
            });
        });
        
        document.getElementById('eqBandCount').addEventListener('input', (e) => {
            document.getElementById('eqBandCountValue').textContent = e.target.value;
            this.updateResultsGraph();
        });
        
        document.getElementById('eqBandCount').addEventListener('change', () => {
            const spinner = document.getElementById('loading-spinner-results');
            spinner.style.display = 'block';
            
            // Show spinner and update asynchronously
            setTimeout(async () => {
                await this.correctionHandler.updateCorrection();
                spinner.style.display = 'none';
            }, 50);
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
        // Define measurement related screens that use audio
        const measurementScreens = ['levelAdjustmentScreen', 'sweepMeasurementScreen', 'configurationScreen'];
        const movingToMeasurementScreen = measurementScreens.includes(screenId);
        
        // Check if we're leaving a measurement screen to a non-measurement screen
        if (measurementScreens.includes(this.currentScreen) && !movingToMeasurementScreen) {
            this.cleanupAudioBeforeNavigation();
        }
        
        // Show requested screen, hide others
        document.querySelectorAll('.screen').forEach(screen => {
            screen.style.display = screen.id === screenId ? 'block' : 'none';
        });
        
        this.currentScreen = screenId;
    }
    
    /**
     * Clean up audio resources before navigation
     */
    cleanupAudioBeforeNavigation() {
        // Stop any ongoing measurement
        if (measurementController.isRunningMeasurement) {
            measurementController.cancelMeasurement();
        }
        
        // Stop white noise if it's playing
        if (audioUtils.isWhiteNoiseActive) {
            audioUtils.stopWhiteNoise();
            document.getElementById('noiseToggleBtn').textContent = i18n.t('button:playbackTestSignal') || 'Playback test signal for checking volume';
        }
        
        // Stop level meter
        measurementController.stopLevelMeter();
        
        // Stop microphone input
        audioUtils.stopMicrophoneInput();
        
        // Full measurement controller cleanup
        measurementController.cleanup();
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
                this.hasUnsavedChanges = false;
                this.startNewMeasurement(); // Re-call the function after confirmation
            };
            return;
        }

        try {
            // Initialize audio context on first user gesture.
            await window.app.initializeAudio();

            // Clean up any existing audio resources before starting
            this.cleanupAudioBeforeNavigation();
            
            // Proceed with measurement setup by preparing the config screen
            this.prepareConfigScreen();
        } catch (error) {
            console.error('Could not start new measurement due to audio initialization failure:', error);
            this.showNotification(i18n.t('error:audioInitFailed', { message: error.message }), 'error');
        }
    }

    /**
     * Prepare the measurement configuration screen
     */
    prepareConfigScreen() {
        // Clear previous values
        document.getElementById('measurementName').value = '';
        
        // Show the configuration screen
        this.showScreen('measurementConfigScreen');

        // Set focus on the measurement name field
        document.getElementById('measurementName').focus();
    }

    /**
     * Handle the import button click
     * @param {Event} event - Change event from the file input
     */
    handleImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const jsonString = e.target.result;
                const measurementId = await dataStorage.importMeasurementFromJSON(jsonString);

                if (measurementId) {
                    this.updateMeasurementList();
                    await this.selectMeasurement(measurementId);
                } else {
                    alert('Error importing measurement. Invalid format.');
                }
            } catch (error) {
                console.error('Error importing measurement:', error);
                alert('Error importing measurement. Invalid format.');
            }
        };
        reader.onerror = () => {
            console.error('Error reading measurement import file:', reader.error);
            alert('Error importing measurement. Invalid format.');
        };
        
        reader.readAsText(file);
        event.target.value = ''; // Reset file input
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

    /**
     * Save changes to a measurement
     */
    saveChanges() {
        const measurement = dataStorage.getMeasurementById(this.selectedMeasurementId);
        if (!measurement) return;
        
        // Save changes to storage
        dataStorage.updateMeasurement(this.selectedMeasurementId, measurement);
        
        // Update state
        this.hasUnsavedChanges = false;
        document.getElementById('editActions').style.display = 'none';
    }

    /**
     * Discard changes to a measurement
     */
    discardChanges() {
        // Reload the measurement from storage
        this.measurementDisplay.displayMeasurementDetails(this.selectedMeasurementId);
        
        // Update state
        this.hasUnsavedChanges = false;
        document.getElementById('editActions').style.display = 'none';
    }
}

// Create and export singleton instance
const uiManager = new UIManager();
export default uiManager;
