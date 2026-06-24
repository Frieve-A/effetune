/**
 * Handles rendering of graphs and visualizations
 */

import dataStorage from '../dataStorage.js';
import i18n from '../i18n.js';

class GraphRenderer {
    constructor(uiManager) {
        this.uiManager = uiManager;
    }

    /**
     * Update the results graph based on current settings
     * @param {number|string} [pointIndex] - Optional specific point index to display, or 'all' for average
     * @param {boolean} [skipPEQUpdate=false] - If true, don't recalculate PEQ parameters
     */
    updateResultsGraph(pointIndex, skipPEQUpdate = false) {
        try {
            const canvas = document.getElementById('resultsGraph');
            if (!canvas) {
                return;
            }
            const ctx = canvas.getContext('2d');
            
            // Clear canvas before any early return so deleted points do not leave stale traces.
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const measurement = dataStorage.getMeasurementById(this.uiManager.selectedMeasurementId);
            if (!measurement || !measurement.points || measurement.points.length === 0) {
                return;
            }
            
            // Draw grid
            this.drawFrequencyGrid(ctx);
            
            // Get display options
            const showOriginal = document.getElementById('showOriginal').checked;
            const showCorrection = document.getElementById('showCorrection').checked;
            const showCorrected = document.getElementById('showCorrected').checked;
            
            // Get smoothing value
            const smoothing = parseFloat(document.getElementById('smoothing').value);
            
            // Get frequency response data
            let frequencyResponse;
            let maxSignalLevel;
            
            if (pointIndex !== 'all' && pointIndex !== undefined && pointIndex >= 0 && pointIndex < measurement.points.length) {
                // Show specific point
                frequencyResponse = measurement.points[pointIndex].frequencyResponse;
                maxSignalLevel = measurement.points[pointIndex].maxSignalLevel;
            } else {
                // Show average
                frequencyResponse = measurement.averageFrequencyResponse;
                maxSignalLevel = measurement.maxSignalLevel;
            }
            
            if (!frequencyResponse || frequencyResponse.length === 0) {
                return;
            }
            
            // Normalize frequency response to average 0dB at the beginning
            const normalizedFrequencyResponse = this.normalizeResponseToZeroDb([...frequencyResponse]);
            
            // Draw original frequency response with smoothing
            if (showOriginal) {
                try {
                    // Apply smoothing to the normalized response
                    const smoothedResponse = window.app.audioUtils.smoothFrequencyResponse(
                        normalizedFrequencyResponse,
                        smoothing
                    );
                    this.drawGraph(ctx, smoothedResponse, this.uiManager.graphColors.original);
                } catch (error) {
                    console.error("Error smoothing original response:", error);
                    // Fallback: draw without smoothing
                    this.drawGraph(ctx, normalizedFrequencyResponse, this.uiManager.graphColors.original);
                }
            }
            
            // Only show correction/corrected response if we have PEQ parameters or are skipping updates
            // This ensures we can still display the graph during slider dragging without recalculating
            if (measurement.peqParameters && measurement.peqParameters.length > 0) {
                // Draw correction curve if available
                if (showCorrection) {
                    try {
                        // Get correction curve from PEQ parameters - this is independent of the selected measurement point
                        const correctionCurve = this.uiManager.correctionHandler.generateCorrectionCurve(measurement.peqParameters, measurement.averageFrequencyResponse);
                        this.drawGraph(ctx, correctionCurve, this.uiManager.graphColors.correction);
                    } catch (error) {
                        console.error("Error generating correction curve:", error);
                    }
                }
                
                // Draw corrected response if available
                if (showCorrected) {
                    try {
                        // Get the smoothed original response (same as what we display for "Original")
                        let smoothedOriginalResponse;
                        try {
                            smoothedOriginalResponse = window.app.audioUtils.smoothFrequencyResponse(
                                normalizedFrequencyResponse,
                                smoothing
                            );
                        } catch (error) {
                            // Fallback if smoothing fails
                            smoothedOriginalResponse = normalizedFrequencyResponse;
                        }
                        
                        // Generate correction curve using the current frequency response grid
                        const correctionCurve = this.uiManager.correctionHandler.generateCorrectionCurve(
                            measurement.peqParameters, 
                            frequencyResponse
                        );
                        
                        // Combine smoothed original response with correction curve
                        const combinedResponse = smoothedOriginalResponse.map(([freq, db]) => {
                            // Find the matching frequency in the correction curve
                            const correctionPoint = correctionCurve.find(point => point[0] === freq);
                            if (correctionPoint) {
                                return [freq, db + correctionPoint[1]];
                            }
                            return [freq, db];
                        });
                        
                        // Draw the corrected response
                        this.drawGraph(ctx, combinedResponse, this.uiManager.graphColors.corrected);
                    } catch (error) {
                        console.error("Error calculating corrected response:", error);
                    }
                }
            }
            
            // Display warning message if signal level is too low
            if (maxSignalLevel !== undefined && maxSignalLevel <= -36) {
                // Show low signal level warning on graph
                ctx.font = '14px Arial';
                ctx.fillStyle = '#ff3333';
                ctx.textAlign = 'center';
                ctx.fillText(i18n.t('warning:signalTooLow') || 'The measurement signal was too low to give accurate results', canvas.width / 2, 40);
            }
            
            // Display warning message if signal level is too high
            if (maxSignalLevel !== undefined && maxSignalLevel > -1) {
                // Show high signal level warning on graph
                ctx.font = '14px Arial';
                ctx.fillStyle = '#ff3333';
                ctx.textAlign = 'center';
                ctx.fillText(i18n.t('warning:signalTooHigh') || 'The measurement signal was too high to give accurate results', canvas.width / 2, 40);
            }
            
            // Draw frequency marker lines directly on the canvas
            this.uiManager.correctionHandler.drawFrequencyMarkers(ctx);
        } catch (error) {
            console.error("Error updating results graph:", error);
        }
    }

    /**
     * Draw a frequency response graph on canvas
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Array} data - Frequency response data [[freq, db], ...]
     * @param {string} color - Line color
     * @param {boolean} [normalize=false] - Whether to normalize data to average 0dB
     */
    drawGraph(ctx, data, color, normalize = false) {
        if (!data || data.length === 0) return;
        
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        const padding = { top: 20, right: 20, bottom: 30, left: 50 };
        
        const graphWidth = width - padding.left - padding.right;
        const graphHeight = height - padding.top - padding.bottom;
        
        // Find min/max values
        const minFreq = 20;
        const maxFreq = 20000;
        const minDb = -24;
        const maxDb = 24;
        
        // Process data
        const processedData = normalize ? this.normalizeResponseToZeroDb([...data]) : [...data];
        
        // Setup scales
        const scaleX = (freq) => {
            return padding.left + graphWidth * (Math.log10(freq) - Math.log10(minFreq)) / (Math.log10(maxFreq) - Math.log10(minFreq));
        };
        
        const scaleY = (db) => {
            return padding.top + graphHeight - graphHeight * (db - minDb) / (maxDb - minDb);
        };
        
        // Draw frequency response
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        let firstPoint = true;
        
        for (const [freq, db] of processedData) {
            if (freq < minFreq || freq > maxFreq) continue;
            
            const x = scaleX(freq);
            const y = scaleY(Math.max(minDb, Math.min(maxDb, db)));
            
            if (firstPoint) {
                ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
    }

    /**
     * Normalize frequency response curve to have an average of 0dB
     * @param {Array} response - Frequency response data as [[freq, db], ...]
     * @returns {Array} Normalized frequency response
     */
    normalizeResponseToZeroDb(response) {
        if (!response || response.length === 0) return response;
        
        // Calculate the average dB value across all frequencies
        let sum = 0;
        for (const [_, db] of response) {
            sum += db;
        }
        const avgDb = sum / response.length;
        
        // Normalize by shifting all values by the negative of the average
        return response.map(([freq, db]) => [freq, db - avgDb]);
    }

    /**
     * Draw frequency response grid on canvas
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     */
    drawFrequencyGrid(ctx) {
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        const padding = { top: 20, right: 20, bottom: 30, left: 50 };
        
        const graphWidth = width - padding.left - padding.right;
        const graphHeight = height - padding.top - padding.bottom;
        
        // Frequency and dB ranges
        const minFreq = 20;
        const maxFreq = 20000;
        const minDb = -24;
        const maxDb = 24;
        
        // Setup scales
        const scaleX = (freq) => {
            return padding.left + graphWidth * (Math.log10(freq) - Math.log10(minFreq)) / (Math.log10(maxFreq) - Math.log10(minFreq));
        };
        
        const scaleY = (db) => {
            return padding.top + graphHeight - graphHeight * (db - minDb) / (maxDb - minDb);
        };
        
        // Draw axes
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1;
        
        // X-axis
        ctx.beginPath();
        ctx.moveTo(padding.left, height - padding.bottom);
        ctx.lineTo(width - padding.right, height - padding.bottom);
        ctx.stroke();
        
        // Y-axis
        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top);
        ctx.lineTo(padding.left, height - padding.bottom);
        ctx.stroke();
        
        // Draw grid lines
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 0.5;
        
        // Frequency grid lines (decades and octaves)
        const frequencies = [20, 30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000];
        
        for (const freq of frequencies) {
            const x = scaleX(freq);
            
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, height - padding.bottom);
            ctx.stroke();
            
            // Add label for main frequencies
            if ([20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].includes(freq)) {
                ctx.fillStyle = '#aaa';
                ctx.font = '10px Arial';
                ctx.textAlign = 'center';
                
                let label = freq.toString();
                if (freq >= 1000) {
                    label = `${freq/1000}k`;
                }
                
                ctx.fillText(label, x, height - padding.bottom + 15);
            }
        }
        
        // dB grid lines
        for (let db = minDb; db <= maxDb; db += 6) {
            const y = scaleY(db);
            
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
            
            // Draw label
            ctx.fillStyle = '#aaa';
            ctx.font = '10px Arial';
            ctx.textAlign = 'right';
            ctx.fillText(`${db} dB`, padding.left - 5, y + 3);
        }
        
        // Draw 0dB reference line with enhanced visibility
        const zeroDbY = scaleY(0);
        ctx.beginPath();
        ctx.strokeStyle = '#aaa'; // Brighter color for better visibility
        ctx.lineWidth = 1.5; // Thicker line
        ctx.setLineDash([5, 3]); // Dashed line
        ctx.moveTo(padding.left, zeroDbY);
        ctx.lineTo(width - padding.right, zeroDbY);
        ctx.stroke();
        ctx.setLineDash([]); // Reset line style
        
        // Draw axis labels
        ctx.fillStyle = '#ccc';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Frequency (Hz)', width / 2, height - 5);
        
        ctx.save();
        ctx.translate(15, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText('Amplitude (dB)', 0, 0);
        ctx.restore();
    }

    /**
     * Draw a small preview graph in measurement history item
     * @param {HTMLElement} container - Container element
     * @param {Array} data - Frequency response data
     */
    drawPreviewGraph(container, data) {
        // Create canvas if it doesn't exist
        let canvas = container.querySelector('canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;
            container.appendChild(canvas);
        }
        
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        if (!data || data.length === 0) return;
        
        const width = canvas.width;
        const height = canvas.height;
        const padding = { top: 2, right: 2, bottom: 2, left: 2 };
        
        const graphWidth = width - padding.left - padding.right;
        const graphHeight = height - padding.top - padding.bottom;
        
        // Setup scales (logarithmic for frequency)
        const minFreq = 20;
        const maxFreq = 20000;
        const minDb = -24;
        const maxDb = 24;
        
        // Process data - always normalize for preview graphs
        const processedData = this.normalizeResponseToZeroDb([...data]);
        
        const scaleX = (freq) => {
            return padding.left + graphWidth * (Math.log10(freq) - Math.log10(minFreq)) / (Math.log10(maxFreq) - Math.log10(minFreq));
        };
        
        const scaleY = (db) => {
            return padding.top + graphHeight - graphHeight * (db - minDb) / (maxDb - minDb);
        };
        
        // Draw the frequency response line
        ctx.strokeStyle = this.uiManager.graphColors.original;
        ctx.lineWidth = 1;
        ctx.beginPath();
        
        let firstPoint = true;
        
        for (const [freq, db] of processedData) {
            if (freq < minFreq || freq > maxFreq) continue;
            
            const x = scaleX(freq);
            const y = scaleY(Math.max(minDb, Math.min(maxDb, db)));
            
            if (firstPoint) {
                ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
    }
}

export default GraphRenderer;
