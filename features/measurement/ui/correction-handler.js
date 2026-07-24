/**
 * Handles correction curve calculation and PEQ parameter generation
 */

import dataStorage from '../dataStorage.js';

class CorrectionHandler {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.updateCorrectionTimeout = null;
    }

    /**
     * Update the correction settings and displayed graph
     */
    async updateCorrection(expectedGeneration = this.uiManager.measurementStateGeneration) {
        if (!this.uiManager.selectedMeasurementId) return;
        if (expectedGeneration !== this.uiManager.measurementStateGeneration) return;
        
        try {
            // Show spinner if not already displayed
            const spinner = document.getElementById('loading-spinner-results');
            if (spinner.style.display !== 'block') {
                spinner.style.display = 'block';
            }
            
            // Get settings from UI
            const settings = this.getTargetSettings();
            
            // Update graph with new settings
            this.uiManager.updateResultsGraph('all');
            
            // Update frequency markers
            this.updateFrequencyMarkers();
            
            // Calculate PEQ parameters
            await this.calculatePEQParameters(settings, expectedGeneration);

            if (expectedGeneration !== this.uiManager.measurementStateGeneration) return;

            // Hide spinner on success
            spinner.style.display = 'none';
        } catch (error) {
            console.error('Error updating correction:', error);
            // Hide spinner even in case of error
            document.getElementById('loading-spinner-results').style.display = 'none';
            throw error;
        }
    }
    
    /**
     * Get the current target settings from the UI
     * @returns {Object} Target settings object
     */
    getTargetSettings() {
        // Get current settings from sliders
        const lowFreqSlider = document.getElementById('targetLowFreqSlider');
        const highFreqSlider = document.getElementById('targetHighFreqSlider');
        const smoothingSlider = document.getElementById('smoothing');
        
        // Convert from slider values to actual values
        const lowFreq = this.logSliderToValue(lowFreqSlider.value, 20, 1000);
        const highFreq = this.logSliderToValue(highFreqSlider.value, 1000, 20000);
        const smoothing = parseFloat(smoothingSlider.value);
        
        const eqBandCount = parseInt(document.getElementById('eqBandCount').value);
        
        // Validate settings
        if (isNaN(lowFreq) || isNaN(highFreq) || isNaN(smoothing) || isNaN(eqBandCount)) {
            throw new Error('Invalid PEQ settings detected');
        }
        
        // Update UI display
        document.getElementById('targetLowFreqValue').textContent = Math.round(lowFreq);
        document.getElementById('targetHighFreqValue').textContent = Math.round(highFreq);
        document.getElementById('smoothingValue').textContent = smoothing.toFixed(2);
        
        return {
            lowFreq,
            highFreq,
            smoothing,
            eqBandCount
        };
    }

    /**
     * Generate an approximate correction curve from PEQ parameters
     * @param {Array} peqParams - PEQ parameters
     * @param {Array} frequencyGrid - Original frequency response to use as frequency grid
     * @returns {Array} Correction curve as [freq, db] pairs
     */
    generateCorrectionCurve(peqParams, frequencyGrid) {
        // Defensive check - return empty array for invalid peqParams
        if (!peqParams || !Array.isArray(peqParams) || peqParams.length === 0) {
            console.log('Warning: No valid PEQ parameters available');
            
            // Create empty correction (0dB at all frequencies)
            if (frequencyGrid && frequencyGrid.length > 0) {
                return frequencyGrid.map(point => [point[0], 0]);
            }
            return [];
        }
        
        // Extract frequency grid from response
        const frequencies = frequencyGrid.map(point => point[0]);
        
        // Calculate correction for each frequency
        const correctionCurve = [];
        
        // Sample rate (for calculations)
        const sampleRate = 96000;
        
        for (const frequency of frequencies) {
            let totalGainDb = 0;
            
            // Calculate the effect of each PEQ band at this frequency
            for (const band of peqParams) {
                const fc = band.frequency;  // Center frequency
                const gainDb = band.gain;   // Gain (dB)
                const Q = band.Q;           // Q factor
                const type = band.type || 'peaking'; // Filter type (default to peaking)
                
                // Parameter validation check
                if (fc <= 0 || Q <= 0) continue;
                
                // Calculate the exact response at the current frequency
                // Implementation based on Audio EQ Cookbook formulas (Robert Bristow-Johnson)
                // http://www.musicdsp.org/files/Audio-EQ-Cookbook.txt
                
                // Calculate normalized frequency parameters
                const w0 = 2 * Math.PI * fc / sampleRate;
                const cos_w0 = Math.cos(w0);
                const sin_w0 = Math.sin(w0);
                const alpha = sin_w0 / (2 * Q);
                
                // Convert dB gain to linear gain
                const A = Math.pow(10, gainDb / 40);
                
                let b0, b1, b2, a0, a1, a2;
                
                // Calculate coefficients based on filter type
                if (type === 'lowShelf') {
                    // Low shelf filter
                    const shelfSlope = 1.0; // Fixed shelf slope
                    const beta = Math.sqrt(A) / Q;
                    
                    b0 = A * ((A + 1) - (A - 1) * cos_w0 + beta * sin_w0);
                    b1 = 2 * A * ((A - 1) - (A + 1) * cos_w0);
                    b2 = A * ((A + 1) - (A - 1) * cos_w0 - beta * sin_w0);
                    a0 = (A + 1) + (A - 1) * cos_w0 + beta * sin_w0;
                    a1 = -2 * ((A - 1) + (A + 1) * cos_w0);
                    a2 = (A + 1) + (A - 1) * cos_w0 - beta * sin_w0;
                } else if (type === 'highShelf') {
                    // High shelf filter
                    const shelfSlope = 1.0; // Fixed shelf slope
                    const beta = Math.sqrt(A) / Q;
                    
                    b0 = A * ((A + 1) + (A - 1) * cos_w0 + beta * sin_w0);
                    b1 = -2 * A * ((A - 1) + (A + 1) * cos_w0);
                    b2 = A * ((A + 1) + (A - 1) * cos_w0 - beta * sin_w0);
                    a0 = (A + 1) - (A - 1) * cos_w0 + beta * sin_w0;
                    a1 = 2 * ((A - 1) - (A + 1) * cos_w0);
                    a2 = (A + 1) - (A - 1) * cos_w0 - beta * sin_w0;
                } else {
                    // Peaking filter (default)
                    b0 = 1 + alpha * A;
                    b1 = -2 * cos_w0;
                    b2 = 1 - alpha * A;
                    a0 = 1 + alpha / A;
                    a1 = -2 * cos_w0;
                    a2 = 1 - alpha / A;
                }
                
                // Normalize coefficients (divide by a0)
                const b0_n = b0 / a0;
                const b1_n = b1 / a0;
                const b2_n = b2 / a0;
                const a1_n = a1 / a0;
                const a2_n = a2 / a0;
                
                // Calculate response at the evaluation frequency
                const theta = 2 * Math.PI * frequency / sampleRate;
                
                // Expansion using Euler's formula for complex number calculations
                // When z = e^(j*theta)
                // z^-1 = e^(-j*theta) = cos(theta) - j*sin(theta)
                // z^-2 = e^(-j*2*theta) = cos(2*theta) - j*sin(2*theta)
                
                // Calculate frequency response (complex)
                // H(z) = (b0 + b1*z^-1 + b2*z^-2) / (1 + a1*z^-1 + a2*z^-2)
                const z1_re = Math.cos(-theta);
                const z1_im = Math.sin(-theta);
                
                const z2_re = Math.cos(-2 * theta);
                const z2_im = Math.sin(-2 * theta);
                
                // Calculate numerator
                const num_re = b0_n + b1_n * z1_re + b2_n * z2_re;
                const num_im = b1_n * z1_im + b2_n * z2_im;
                
                // Calculate denominator
                const den_re = 1.0 + a1_n * z1_re + a2_n * z2_re;
                const den_im = a1_n * z1_im + a2_n * z2_im;
                
                // Complex division: H = num/den
                const den_mag_squared = den_re * den_re + den_im * den_im;
                
                // Prevent division by zero
                if (den_mag_squared < 1e-50) continue;
                
                // Complex division: (num_re + j*num_im) / (den_re + j*den_im)
                const H_re = (num_re * den_re + num_im * den_im) / den_mag_squared;
                const H_im = (num_im * den_re - num_re * den_im) / den_mag_squared;
                
                // Calculate magnitude of frequency response (absolute value of complex number)
                const H_mag = Math.sqrt(H_re * H_re + H_im * H_im);
                
                // Convert to dB
                const H_db = 20 * Math.log10(H_mag);
                
                // Add to the total
                totalGainDb += H_db;
            }
            
            correctionCurve.push([frequency, totalGainDb]);
        }
        
        return correctionCurve;
    }

    /**
     * Linear slider value to logarithmic scale value conversion
     * @param {number} sliderValue - Slider value (linear)
     * @param {number} minValue - Minimum value
     * @param {number} maxValue - Maximum value
     * @returns {number} Logarithmic scale value
     */
    logSliderToValue(sliderValue, minValue, maxValue) {
        const minLog = Math.log10(minValue);
        const maxLog = Math.log10(maxValue);
        const scale = (maxLog - minLog) / (maxValue - minValue);
        
        return Math.pow(10, minLog + scale * (sliderValue - minValue));
    }
    
    /**
     * Logarithmic scale value to linear slider value conversion
     * @param {number} value - Logarithmic scale value
     * @param {number} minValue - Minimum value
     * @param {number} maxValue - Maximum value
     * @returns {number} Slider value (linear)
     */
    valueToLogSlider(value, minValue, maxValue) {
        const minLog = Math.log10(minValue);
        const maxLog = Math.log10(maxValue);
        const scale = (maxLog - minLog) / (maxValue - minValue);
        
        return minValue + (Math.log10(value) - minLog) / scale;
    }

    /**
     * Update the frequency markers to match slider positions
     * @param {boolean} [skipPEQUpdate=false] - If true, don't recalculate PEQ parameters
     */
    updateFrequencyMarkers(skipPEQUpdate = false) {
        try {
            // Call updateResultsGraph which will redraw everything including markers
            this.uiManager.updateResultsGraph(this.uiManager.measurementDisplay.selectedPointIndex, skipPEQUpdate);
        } catch (error) {
            console.error('Error updating frequency markers:', error);
        }
    }
    
    /**
     * Draw frequency marker lines directly on the canvas
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     */
    drawFrequencyMarkers(ctx) {
        try {
            const lowFreqSlider = document.getElementById('targetLowFreqSlider');
            const highFreqSlider = document.getElementById('targetHighFreqSlider');
            
            // Skip if sliders don't exist
            if (!lowFreqSlider || !highFreqSlider) {
                return;
            }
            
            // Get the current frequency values
            const lowFreq = this.logSliderToValue(lowFreqSlider.value, 20, 1000);
            const highFreq = this.logSliderToValue(highFreqSlider.value, 1000, 20000);
            
            const width = ctx.canvas.width;
            const height = ctx.canvas.height;
            const padding = { top: 20, right: 20, bottom: 30, left: 50 };
            
            const graphWidth = width - padding.left - padding.right;
            
            // Scale function for x-axis (copied from drawFrequencyGrid)
            const minFreq = 20;
            const maxFreq = 20000;
            const scaleX = (freq) => {
                return padding.left + graphWidth * (Math.log10(freq) - Math.log10(minFreq)) / (Math.log10(maxFreq) - Math.log10(minFreq));
            };
            
            // Calculate positions
            const lowFreqPos = scaleX(lowFreq);
            const highFreqPos = scaleX(highFreq);
            
            // Draw the marker lines directly on the canvas
            ctx.strokeStyle = '#ffffff'; // White color
            ctx.lineWidth = 1;
            
            // Draw low frequency marker
            ctx.beginPath();
            ctx.moveTo(lowFreqPos, padding.top);
            ctx.lineTo(lowFreqPos, height - padding.bottom);
            ctx.stroke();
            
            // Draw high frequency marker
            ctx.beginPath();
            ctx.moveTo(highFreqPos, padding.top);
            ctx.lineTo(highFreqPos, height - padding.bottom);
            ctx.stroke();
        } catch (error) {
            console.error('Error drawing frequency markers:', error);
        }
    }

    /**
     * Handle debounced updates (prevent too many consecutive updates)
     */
    debounceUpdateCorrection() {
        // Throttle continuous updates from slider operations
        if (this.updateCorrectionTimeout) {
            clearTimeout(this.updateCorrectionTimeout);
        }
        this.updateCorrectionTimeout = setTimeout(async () => {
            try {
                await this.updateCorrection();
                // Hide spinner when complete
                document.getElementById('loading-spinner-results').style.display = 'none';
            } catch (error) {
                console.error('Error updating correction:', error);
                // Hide spinner even in case of error
                document.getElementById('loading-spinner-results').style.display = 'none';
            }
        }, 300); // Wait 300ms to limit continuous updates
    }
    
    /**
     * Calculate PEQ parameters based on current settings
     * @param {Object} settings - Target settings object
     * @returns {Promise<Array>} - Promise resolving to PEQ parameters
     */
    async calculatePEQParameters(settings, expectedGeneration = this.uiManager.measurementStateGeneration) {
        const measurementId = this.uiManager.selectedMeasurementId;
        const measurement = dataStorage.getMeasurementById(measurementId);
        if (!measurement) return [];
        if (expectedGeneration !== this.uiManager.measurementStateGeneration) return [];
        
        // Get frequency response data
        const responseData = measurement.averageFrequencyResponse;
        if (!responseData || responseData.length === 0) return [];
        
        // Normalize the response to 0dB average before calculating PEQ parameters
        const normalizedResponse = this.uiManager.graphRenderer.normalizeResponseToZeroDb(responseData);
        
        // Apply smoothing to the normalized response before calculating PEQ parameters
        const smoothedResponse = window.app.audioUtils.smoothFrequencyResponse(
            normalizedResponse,
            settings.smoothing
        );
        
        // Calculate PEQ parameters
        const peqParameters = await window.app.audioUtils.calculatePEQParameters(
            smoothedResponse,
            settings.lowFreq,
            settings.highFreq,
            settings.eqBandCount,
            settings.smoothing
        );

        if (expectedGeneration !== this.uiManager.measurementStateGeneration ||
            measurementId !== this.uiManager.selectedMeasurementId ||
            measurement !== dataStorage.getMeasurementById(measurementId)) {
            return [];
        }

        // Commit settings and derived state together only if this calculation is current.
        measurement.correctionLowFreq = settings.lowFreq;
        measurement.correctionHighFreq = settings.highFreq;
        measurement.smoothing = settings.smoothing;
        measurement.eqBandCount = settings.eqBandCount;
        
        // Store PEQ parameters
        measurement.peqParameters = peqParameters;
        
        // Calculate corrected response
        const correctedResponse = window.app.audioUtils.applyCorrectionToResponse(
            responseData,
            peqParameters
        );
        
        // Store corrected response
        measurement.correctedResponse = correctedResponse;
        
        // Update graph
        this.uiManager.updateResultsGraph();
        
        return peqParameters;
    }
}

export default CorrectionHandler;
