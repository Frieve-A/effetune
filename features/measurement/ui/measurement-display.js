/**
 * Handles measurement display and management
 */

import dataStorage from '../dataStorage.js';
import i18n from '../i18n.js';

class MeasurementDisplay {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.selectedPointIndex = 'all';
    }

    /**
     * Update the measurement list in the left pane
     */
    updateMeasurementList() {
        const listElement = document.getElementById('measurementList');
        listElement.innerHTML = '';
        
        // Get fresh data from storage
        const measurements = dataStorage.getAllMeasurements();
        
        // No duplication logic - directly display what's in the database
        measurements.forEach(measurement => {
            const li = document.createElement('li');
            li.className = 'measurement-item';
            li.setAttribute('data-id', measurement.id); // Always set data-id attribute
            
            if (measurement.id === this.uiManager.selectedMeasurementId) {
                li.classList.add('selected');
            }
            
            const header = document.createElement('div');
            header.className = 'measurement-item-header';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'measurement-item-name';
            nameSpan.textContent = measurement.name;
            
            const dateSpan = document.createElement('span');
            dateSpan.className = 'measurement-item-date';
            const date = new Date(measurement.timestamp);
            
            // Calculate measurement size
            const sizeKB = this.calculateMeasurementSize(measurement);
            
            // Display date and size
            dateSpan.textContent = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${sizeKB} KB)`;
            
            const controls = document.createElement('div');
            controls.className = 'measurement-item-controls';
            
            const exportBtn = document.createElement('button');
            exportBtn.className = 'icon-btn save-button';
            exportBtn.innerHTML = '<img src="../../images/save_button.png" width="16" height="16">';
            exportBtn.title = 'Export measurement';
            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.exportMeasurement(measurement.id);
            });
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'icon-btn delete-button';
            deleteBtn.innerHTML = '✕';
            deleteBtn.title = 'Delete measurement';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.confirmDeleteMeasurement(measurement.id);
            });
            
            controls.appendChild(exportBtn);
            controls.appendChild(deleteBtn);
            
            header.appendChild(nameSpan);
            header.appendChild(controls);
            
            const previewGraph = document.createElement('div');
            previewGraph.className = 'measurement-item-preview';
            
            li.appendChild(header);
            li.appendChild(dateSpan);
            li.appendChild(previewGraph);
            
            li.addEventListener('click', () => {
                this.uiManager.selectMeasurement(measurement.id);
            });
            
            listElement.appendChild(li);
            
            // Draw preview graph if data is available
            if (measurement.averageFrequencyResponse) {
                this.uiManager.graphRenderer.drawPreviewGraph(previewGraph, measurement.averageFrequencyResponse);
            }
        });
        
        // After updating the list, make sure the selected item has the selected class
        this.updateSelectedMeasurementHighlight();
    }
    
    /**
     * Update the UI highlighting for the selected measurement
     */
    updateSelectedMeasurementHighlight() {
        if (!this.uiManager.selectedMeasurementId) return;
        
        // First remove selected class from all items
        const allItems = document.querySelectorAll('.measurement-item');
        allItems.forEach(item => {
            item.classList.remove('selected');
        });
        
        // Then add it to the correct item
        const selectedItems = document.querySelectorAll(`.measurement-item[data-id="${this.uiManager.selectedMeasurementId}"]`);
        selectedItems.forEach(item => {
            item.classList.add('selected');
        });
    }

    /**
     * Calculate approximate size of a measurement
     * @param {Object} measurement - Measurement object
     * @returns {number} Size in kilobytes
     */
    calculateMeasurementSize(measurement) {
        try {
            // Convert measurement to JSON string and get its length in bytes
            const jsonString = JSON.stringify(measurement);
            const bytes = new Blob([jsonString]).size;
            // Convert to KB and round to 1 decimal place
            return Math.round(bytes / 1024 * 10) / 10;
        } catch (error) {
            console.error("Error calculating measurement size:", error);
            return 0;
        }
    }

    /**
     * Select a measurement and display its details
     * @param {string} id - Measurement ID to select
     * @returns {boolean} Whether the selection was successful
     */
    async selectMeasurement(id) {
        // Stop any audio processing if we're navigating from an audio-active screen
        this.uiManager.cleanupAudioBeforeNavigation();
        
        // Check for unsaved changes
        if (this.uiManager.hasUnsavedChanges) {
            this.uiManager.dialogController.showConfirmation(
                i18n.t('confirm:discardChanges') || 'You have unsaved changes. Discard changes and continue?',
                false
            );
            this.uiManager.pendingAction = () => {
                this.uiManager.hasUnsavedChanges = false;
                this.selectMeasurement(id);
            };
            return false;
        }
        
        // Update selected item
        this.uiManager.selectedMeasurementId = id;
        
        // Update UI to highlight the selected measurement
        this.updateSelectedMeasurementHighlight();
        
        // First show the results screen immediately
        this.uiManager.showScreen('resultsDisplayScreen');
        
        // Display basic measurement details, but without PEQ calculation yet
        this.displayMeasurementDetails(id, true);
        
        // Show spinner while calculating PEQ parameters
        const spinner = document.getElementById('loading-spinner-results');
        spinner.style.display = 'block';
        
        // Calculate PEQ parameters asynchronously
        setTimeout(async () => {
            await this.uiManager.correctionHandler.updateCorrection();
            // Hide spinner when complete
            spinner.style.display = 'none';
        }, 50);
        
        // Clear unsaved changes flags
        this.uiManager.hasUnsavedChanges = false;
        
        return true;
    }

    /**
     * Display measurement details in the results screen
     * @param {string} id - Measurement ID to display
     * @param {boolean} [skipGraphUpdate=false] - Whether to skip graph update (for async loading)
     */
    displayMeasurementDetails(id, skipGraphUpdate = false) {
        const measurement = dataStorage.getMeasurementById(id);
        if (!measurement) {
            return;
        }
        
        // Reset UI
        document.getElementById('noMeasurementMessage').style.display = 'none';
        document.getElementById('measurementResults').style.display = 'block';
        document.getElementById('editActions').style.display = 'none';
        
        // Update title
        document.getElementById('resultTitle').textContent = measurement.name;
        
        // Format details
        const dateTime = new Date(measurement.timestamp);
        const dateString = dateTime.toLocaleDateString();
        const timeString = dateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Prepare channel information
        const inputChannelText = this.formatChannelInfo(measurement.inputChannel);
        const outputChannelText = this.formatChannelInfo(measurement.outputChannel);
        
        // Prepare max signal level information
        const maxSignalLevel = measurement.maxSignalLevel !== undefined 
            ? `${measurement.maxSignalLevel.toFixed(1)} dB` 
            : 'Not recorded';
        
        // Format metadata as table rows
        let html = `
            <tr>
                <th>Measurement Date</th>
                <td>${dateString} ${timeString}</td>
            </tr>
            <tr>
                <th>Input Device</th>
                <td>${measurement.audioInput}</td>
            </tr>
            <tr>
                <th>Input Channel</th>
                <td>${inputChannelText}</td>
            </tr>
            <tr>
                <th>Output Device</th>
                <td>${measurement.audioOutput}</td>
            </tr>
            <tr>
                <th>Output Channel</th>
                <td>${outputChannelText}</td>
            </tr>
            <tr>
                <th>Sampling Frequency</th>
                <td>${measurement.sampleRate ? (measurement.sampleRate / 1000).toFixed(1) + ' kHz' : '48 kHz'}</td>
            </tr>
            <tr>
                <th>Sweep Length</th>
                <td>${Number(measurement.sweepLength).toLocaleString()} samples</td>
            </tr>
            <tr>
                <th>Synchronous Averaging</th>
                <td>${measurement.averaging} times</td>
            </tr>
            <tr>
                <th>Max Signal Level</th>
                <td>${maxSignalLevel}</td>
            </tr>
            <tr>
                <th>Measurement Points</th>
                <td>${measurement.points.length}</td>
            </tr>
        `;
        
        document.getElementById('measurementDetails').innerHTML = html;
        
        // Display measurement points
        this.displayMeasurementPoints(measurement);
        
        // Load global PEQ settings if available
        const peqSettings = dataStorage.loadPEQSettings();
        
        // Determine values to use, prioritizing global settings over measurement-specific ones
        let lowFreq = (peqSettings && peqSettings.lowFreq) ? 
            this.uiManager.correctionHandler.logSliderToValue(peqSettings.lowFreq, 20, 1000) : 
            (measurement.correctionLowFreq || 20);
            
        let highFreq = (peqSettings && peqSettings.highFreq) ? 
            this.uiManager.correctionHandler.logSliderToValue(peqSettings.highFreq, 1000, 20000) : 
            (measurement.correctionHighFreq || 20000);
            
        let smoothing = (peqSettings && peqSettings.smoothing) ? 
            parseFloat(peqSettings.smoothing) : 
            (measurement.smoothing || 0.3);
            
        let eqBandCount = (peqSettings && peqSettings.eqBandCount) ? 
            parseInt(peqSettings.eqBandCount) : 
            (measurement.eqBandCount || 5);
        
        // Ensure smoothing value stays within the valid range
        smoothing = Math.max(0.01, Math.min(1.00, smoothing));
        
        // Set PEQ control values
        document.getElementById('targetLowFreqSlider').value = 
            this.uiManager.correctionHandler.valueToLogSlider(lowFreq, 20, 1000);
        document.getElementById('targetLowFreqValue').textContent = Math.round(lowFreq);
        
        document.getElementById('targetHighFreqSlider').value = 
            this.uiManager.correctionHandler.valueToLogSlider(highFreq, 1000, 20000);
        document.getElementById('targetHighFreqValue').textContent = Math.round(highFreq);
        
        document.getElementById('smoothing').value = smoothing;
        document.getElementById('smoothingValue').textContent = smoothing.toFixed(2);
        
        document.getElementById('eqBandCount').value = eqBandCount;
        document.getElementById('eqBandCountValue').textContent = eqBandCount;
        
        // Ensure 'All' is selected by default
        this.selectPoint('all');
        
        // Update frequency markers
        this.uiManager.correctionHandler.updateFrequencyMarkers();
        
        // If not skipGraphUpdate, calculate and draw initial correction
        if (!skipGraphUpdate) {
            this.uiManager.correctionHandler.updateCorrection();
        }
    }
    
    /**
     * Format channel information for display
     * @param {string} channelValue - Channel value from the measurement
     * @returns {string} Formatted channel text
     */
    formatChannelInfo(channelValue) {
        if (!channelValue || channelValue === 'both') {
            return 'Both Channels';
        } else if (channelValue === 'left') {
            return 'Left Channel';
        } else if (channelValue === 'right') {
            return 'Right Channel';
        }
        return channelValue;
    }

    /**
     * Display measurement points grid
     * @param {Object} measurement - Measurement object
     */
    displayMeasurementPoints(measurement) {
        const pointsGrid = document.getElementById('pointsGrid');
        pointsGrid.innerHTML = '';
        
        if (!measurement.points || measurement.points.length === 0) {
            pointsGrid.innerHTML = '<p>No measurement points available.</p>';
            return;
        }
        
        // Add 'All' option for average of all points
        const allPointElement = document.createElement('div');
        allPointElement.className = 'point-item selected'; // Default selected
        allPointElement.dataset.index = 'all';
        
        const allNameElement = document.createElement('div');
        allNameElement.textContent = 'All (Average)';
        
        allPointElement.appendChild(allNameElement);
        
        allPointElement.addEventListener('click', () => {
            this.selectPoint('all');
        });
        
        pointsGrid.appendChild(allPointElement);
        
        // Add individual measurement points
        measurement.points.forEach((point, index) => {
            const pointElement = document.createElement('div');
            pointElement.className = 'point-item';
            pointElement.dataset.index = index;
            
            const nameElement = document.createElement('div');
            nameElement.textContent = point.name || `Point ${index + 1}`;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-point delete-button';
            deleteBtn.innerHTML = '✕';
            deleteBtn.addEventListener('click', () => this.confirmDeletePoint(index));
            
            pointElement.appendChild(nameElement);
            pointElement.appendChild(deleteBtn);
            
            pointElement.addEventListener('click', (e) => {
                if (e.target !== deleteBtn) {
                    this.selectPoint(index);
                }
            });
            
            pointsGrid.appendChild(pointElement);
        });
    }

    /**
     * Select a specific measurement point
     * @param {number|string} index - Index of the point to select, or 'all' for average
     */
    selectPoint(index) {
        const measurement = dataStorage.getMeasurementById(this.uiManager.selectedMeasurementId);
        if (!measurement || !measurement.points || (index !== 'all' && index >= measurement.points.length)) {
            return;
        }
        
        // Update selection in UI
        const pointItems = document.querySelectorAll('.point-item');
        pointItems.forEach(item => item.classList.remove('selected'));
        
        const selectedItem = document.querySelector(`.point-item[data-index="${index}"]`);
        if (selectedItem) {
            selectedItem.classList.add('selected');
        }
        
        // Store selected point index
        this.selectedPointIndex = index;
        
        // Update graph to show selected point or average
        this.uiManager.updateResultsGraph(index);
    }

    /**
     * Export measurement as JSON file
     * @param {string} id - Measurement ID to export
     */
    exportMeasurement(id) {
        const jsonString = dataStorage.exportMeasurementToJSON(id);
        if (!jsonString) return;
        
        const measurement = dataStorage.getMeasurementById(id);
        const filename = `${measurement.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${new Date().toISOString().split('T')[0]}.json`;
        
        this.uiManager.downloadFile(jsonString, filename, 'application/json');
    }

    /**
     * Confirm deletion of a measurement
     * @param {string} id - Measurement ID to delete
     */
    confirmDeleteMeasurement(id) {
        console.log(`Confirming deletion for measurement ${id}, warning disabled: ${this.uiManager.doNotWarnOnDelete}`);
        
        // If "do not warn" setting is enabled, delete without confirmation
        if (this.uiManager.doNotWarnOnDelete === true) {
            console.log('Skipping confirmation because warnings are disabled');
            this.deleteMeasurement(id);
            return;
        }
        
        // Always show confirmation by default unless explicitly disabled
        // Set up pending delete
        this.uiManager.pendingDeleteId = id;
        this.uiManager.pendingDeleteType = 'measurement';
        
        // Show confirmation dialog
        this.uiManager.dialogController.showConfirmation(
            i18n.t('confirm:deleteMeasurement') || 'Are you sure you want to delete this measurement? This action cannot be undone.',
            true
        );
    }

    /**
     * Delete a measurement
     * @param {string} id - Measurement ID to delete
     */
    deleteMeasurement(id) {
        const wasSelected = id === this.uiManager.selectedMeasurementId;
        
        dataStorage.deleteMeasurement(id);
        this.updateMeasurementList();
        
        if (wasSelected) {
            // Select the latest measurement if available
            const latestMeasurement = dataStorage.getLatestMeasurement();
            if (latestMeasurement) {
                this.selectMeasurement(latestMeasurement.id);
            } else {
                this.uiManager.selectedMeasurementId = null;
                document.getElementById('noMeasurementMessage').style.display = 'block';
                document.getElementById('measurementResults').style.display = 'none';
            }
        }
    }

    /**
     * Confirm deletion of a measurement point
     * @param {number} index - Point index to delete
     */
    confirmDeletePoint(index) {
        console.log(`Confirming deletion for point ${index}, warning disabled: ${this.uiManager.doNotWarnOnDelete}`);
        
        // If "do not warn" setting is enabled, delete without confirmation
        if (this.uiManager.doNotWarnOnDelete === true) {
            console.log('Skipping confirmation because warnings are disabled');
            this.deletePoint(index);
            return;
        }
        
        // Always show confirmation by default unless explicitly disabled
        // Set up pending delete
        this.uiManager.pendingDeleteId = index;
        this.uiManager.pendingDeleteType = 'point';
        
        // Show confirmation dialog
        this.uiManager.dialogController.showConfirmation(
            i18n.t('confirm:deletePoint') || 'Are you sure you want to delete this measurement point? This action cannot be undone.',
            true
        );
    }

    /**
     * Delete a measurement point
     * @param {number} index - Point index to delete
     */
    deletePoint(index) {
        const measurement = dataStorage.getMeasurementById(this.uiManager.selectedMeasurementId);
        if (!measurement || !measurement.points || index >= measurement.points.length) {
            return;
        }
        
        // Create a copy of the points array and remove the specified point
        const updatedPoints = [...measurement.points];
        updatedPoints.splice(index, 1);
        
        // Mark as having unsaved changes
        this.uiManager.hasUnsavedChanges = true;
        
        // Update the measurement object temporarily (not saved to storage yet)
        measurement.points = updatedPoints;
        
        // Update the UI
        this.displayMeasurementPoints(measurement);
        this.uiManager.updateResultsGraph();
        
        // Show edit actions
        document.getElementById('editActions').style.display = 'flex';
    }

    /**
     * Refresh the measurement display with the latest data
     * This simulates the app startup sequence for measurement display
     * @param {string} [specificMeasurementId] Optional specific measurement ID to display
     * @returns {Promise<void>}
     */
    async refreshMeasurementDisplay(specificMeasurementId = null) {
        try {
            console.log('Refreshing measurement display with latest data');
            
            // Step 1: Refresh the data from database first
            await dataStorage.loadMeasurements();
            
            // Step 2: Update the measurement list in the UI
            this.updateMeasurementList();
            
            // Step 3: Determine which measurement to display
            let targetMeasurementId = specificMeasurementId;
            
            if (!targetMeasurementId) {
                // If no specific ID was provided, use the latest measurement
                const latestMeasurement = dataStorage.getLatestMeasurement();
                if (latestMeasurement) {
                    targetMeasurementId = latestMeasurement.id;
                    console.log(`Using latest measurement ID: ${targetMeasurementId}`);
                } else {
                    console.log('No measurements available');
                    this.uiManager.selectedMeasurementId = null;
                    document.getElementById('noMeasurementMessage').style.display = 'block';
                    document.getElementById('measurementResults').style.display = 'none';
                    return;
                }
            }
            
            // Step 4: Verify the measurement exists
            const measurement = dataStorage.getMeasurementById(targetMeasurementId);
            if (!measurement) {
                console.error(`Could not find measurement with ID: ${targetMeasurementId}`);
                document.getElementById('noMeasurementMessage').style.display = 'block';
                document.getElementById('measurementResults').style.display = 'none';
                return;
            }
            
            console.log(`Displaying measurement: ${measurement.name} (${targetMeasurementId})`);
            
            // Step 5: Set selected measurement and update UI
            this.uiManager.selectedMeasurementId = targetMeasurementId;
            this.updateSelectedMeasurementHighlight();
            
            // Step 6: Show results screen
            this.uiManager.showScreen('resultsDisplayScreen');
            
            // Step 7: Make sure results are visible
            document.getElementById('noMeasurementMessage').style.display = 'none';
            document.getElementById('measurementResults').style.display = 'block';
            
            // Step 8: Show spinner while loading details
            const spinner = document.getElementById('loading-spinner-results');
            spinner.style.display = 'block';
            
            // Step 9: Display measurement details
            this.displayMeasurementDetails(targetMeasurementId, true);
            
            // Step 10: Calculate PEQ parameters
            await this.uiManager.correctionHandler.updateCorrection();
            
            // Step 11: Hide spinner when complete
            spinner.style.display = 'none';
            
        } catch (error) {
            console.error('Error refreshing measurement display:', error);
            
            // Hide spinner in case of error
            document.getElementById('loading-spinner-results').style.display = 'none';
            
            // Show error notification
            this.uiManager.dialogController.showNotification(`Error occurred while updating measurement display: ${error.message}`);
        }
    }
}

export default MeasurementDisplay; 