/**
 * Handles rendering of graphs and visualizations
 */

import dataStorage from '../dataStorage.js';
import audioUtils from '../audio-utils/index.js';
import i18n from '../i18n.js';
import {
    normalizeResponseToZeroDb as normalizeFrequencyResponseToZeroDb
} from '../response-normalization.js';
import {
    clampImpulseView,
    createDefaultImpulseView,
    findImpulsePeak,
    getImpulseTimeBounds,
    getNiceTimeTickInterval,
    isValidImpulseResponse,
    sampleImpulseEnvelope
} from './impulse-response-plot.js';

class GraphRenderer {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.impulseResponse = null;
        this.impulseResponsePeak = 1;
        this.impulseResponseView = null;
        this.impulseResponseBounds = null;
        this.impulseResponseLoadGeneration = 0;
        this.impulseResponseDrag = null;
        this.impulseResponseGraphInitialized = false;
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
            
            // Normalize to the median level inside the measured audible band
            const normalizedFrequencyResponse = this.normalizeResponseToZeroDb(
                [...frequencyResponse],
                measurement.sweepMinFreq,
                measurement.sweepMaxFreq
            );
            
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

    initializeImpulseResponseGraph() {
        if (this.impulseResponseGraphInitialized) return;
        const canvas = document.getElementById('impulseResponseGraph');
        const scroll = document.getElementById('impulseResponseScroll');
        const zoomIn = document.getElementById('impulseResponseZoomIn');
        const zoomOut = document.getElementById('impulseResponseZoomOut');
        const reset = document.getElementById('impulseResponseReset');
        const exportWav = document.getElementById('exportImpulseResponseWav');
        if (!canvas || !scroll || !zoomIn || !zoomOut || !reset || !exportWav) return;

        zoomIn.addEventListener('click', () => this.zoomImpulseResponse(0.5));
        zoomOut.addEventListener('click', () => this.zoomImpulseResponse(2));
        reset.addEventListener('click', () => this.resetImpulseResponseView());
        exportWav.addEventListener('click', () => this.exportImpulseResponseWav());
        scroll.addEventListener('input', event => {
            if (!this.impulseResponseView || !this.impulseResponseBounds) return;
            const availableScroll = this.impulseResponseBounds.maxMs -
                this.impulseResponseBounds.minMs -
                this.impulseResponseView.durationMs;
            const startMs = this.impulseResponseBounds.minMs +
                availableScroll * Number(event.target.value) / 1000;
            this.setImpulseResponseView(startMs, this.impulseResponseView.durationMs);
        });

        canvas.addEventListener('wheel', event => {
            if (!this.impulseResponseView) return;
            event.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const anchor = rect.width > 0
                ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
                : 0.5;
            this.zoomImpulseResponse(event.deltaY < 0 ? 0.8 : 1.25, anchor);
        }, { passive: false });
        canvas.addEventListener('pointerdown', event => {
            if (!this.impulseResponseView || event.button !== 0) return;
            canvas.setPointerCapture?.(event.pointerId);
            this.impulseResponseDrag = {
                pointerId: event.pointerId,
                clientX: event.clientX,
                startMs: this.impulseResponseView.startMs
            };
            canvas.classList.add('is-panning');
        });
        canvas.addEventListener('pointermove', event => {
            const drag = this.impulseResponseDrag;
            if (!drag || drag.pointerId !== event.pointerId || !this.impulseResponseView) return;
            const width = canvas.getBoundingClientRect().width;
            if (width <= 0) return;
            const offsetMs = (event.clientX - drag.clientX) / width *
                this.impulseResponseView.durationMs;
            this.setImpulseResponseView(
                drag.startMs - offsetMs,
                this.impulseResponseView.durationMs
            );
        });
        const endPan = event => {
            if (this.impulseResponseDrag?.pointerId !== event.pointerId) return;
            this.impulseResponseDrag = null;
            canvas.classList.remove('is-panning');
            canvas.releasePointerCapture?.(event.pointerId);
        };
        canvas.addEventListener('pointerup', endPan);
        canvas.addEventListener('pointercancel', endPan);
        canvas.addEventListener('keydown', event => {
            if (!this.impulseResponseView) return;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                const direction = event.key === 'ArrowLeft' ? -1 : 1;
                this.panImpulseResponse(direction * this.impulseResponseView.durationMs * 0.1);
            } else if (event.key === '+' || event.key === '=') {
                event.preventDefault();
                this.zoomImpulseResponse(0.5);
            } else if (event.key === '-' || event.key === '_') {
                event.preventDefault();
                this.zoomImpulseResponse(2);
            } else if (event.key === 'Home') {
                event.preventDefault();
                this.resetImpulseResponseView();
            }
        });
        this.impulseResponseGraphInitialized = true;
    }

    async updateImpulseResponseGraph(pointIndex = 'all') {
        const generation = ++this.impulseResponseLoadGeneration;
        const measurementId = this.uiManager.selectedMeasurementId;
        const measurement = dataStorage.getMeasurementById(measurementId);
        const section = document.getElementById('impulseResponseSection');
        if (!section) return;
        section.hidden = true;

        const point = pointIndex === 'all'
            ? measurement?.points?.find(candidate => candidate.ir?.stored === true)
            : measurement?.points?.[pointIndex];
        if (!measurement || !Number.isSafeInteger(point?.pointId) ||
            point.ir?.stored !== true) {
            this.clearImpulseResponseGraph();
            return;
        }

        const record = await dataStorage.getImpulseResponse(measurementId, point.pointId);
        if (generation !== this.impulseResponseLoadGeneration ||
            measurementId !== this.uiManager.selectedMeasurementId ||
            pointIndex !== this.uiManager.measurementDisplay.selectedPointIndex) {
            return;
        }
        if (!isValidImpulseResponse(record)) {
            this.clearImpulseResponseGraph();
            return;
        }

        this.impulseResponse = record;
        this.impulseResponsePeak = findImpulsePeak(record.data);
        this.impulseResponseBounds = getImpulseTimeBounds(record);
        this.impulseResponseView = createDefaultImpulseView(record);
        const pointName = point.name || `Point ${measurement.points.indexOf(point) + 1}`;
        const pointNameElement = document.getElementById('impulseResponsePointName');
        if (pointNameElement) pointNameElement.textContent = pointName;
        document.getElementById('impulseResponseGraph')?.setAttribute(
            'aria-label',
            `${i18n.t('title:impulseResponse') || 'Impulse Response'}: ${pointName}`
        );
        section.hidden = false;
        this.drawImpulseResponseGraph();
    }

    exportImpulseResponseWav() {
        const record = this.impulseResponse;
        if (!isValidImpulseResponse(record)) return;

        const measurement = dataStorage.getMeasurementById(this.uiManager.selectedMeasurementId);
        const pointIndex = measurement?.points?.findIndex(point => point.pointId === record.pointId);
        if (!measurement || !Number.isSafeInteger(pointIndex) || pointIndex < 0) return;

        const point = measurement.points[pointIndex];
        const filenamePrefix = `${measurement.name}_${point.name || `Point ${pointIndex + 1}`}`
            .trim()
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .toLowerCase();
        const date = new Date().toISOString().split('T')[0];
        audioUtils.exportWAV(
            record.data,
            record.sampleRate,
            `${filenamePrefix}_impulse_response_${date}.wav`
        );
    }

    clearImpulseResponseGraph() {
        this.impulseResponseLoadGeneration += 1;
        this.impulseResponse = null;
        this.impulseResponseView = null;
        this.impulseResponseBounds = null;
        this.impulseResponseDrag = null;
        document.getElementById('impulseResponseGraph')?.classList.remove('is-panning');
        const section = document.getElementById('impulseResponseSection');
        if (section) section.hidden = true;
    }

    resetImpulseResponseView() {
        if (!this.impulseResponse) return;
        this.impulseResponseView = createDefaultImpulseView(this.impulseResponse);
        this.drawImpulseResponseGraph();
    }

    setImpulseResponseView(startMs, durationMs) {
        const view = clampImpulseView(startMs, durationMs, this.impulseResponseBounds);
        if (!view) return;
        this.impulseResponseView = view;
        this.drawImpulseResponseGraph();
    }

    zoomImpulseResponse(factor, anchor = 0.5) {
        const view = this.impulseResponseView;
        if (!view || !Number.isFinite(factor) || factor <= 0) return;
        const clampedAnchor = Math.min(1, Math.max(0, anchor));
        const anchorTimeMs = view.startMs + view.durationMs * clampedAnchor;
        const durationMs = view.durationMs * factor;
        this.setImpulseResponseView(
            anchorTimeMs - durationMs * clampedAnchor,
            durationMs
        );
    }

    panImpulseResponse(offsetMs) {
        if (!this.impulseResponseView) return;
        this.setImpulseResponseView(
            this.impulseResponseView.startMs + offsetMs,
            this.impulseResponseView.durationMs
        );
    }

    updateImpulseResponseControls() {
        const view = this.impulseResponseView;
        const bounds = this.impulseResponseBounds;
        if (!view || !bounds) return;
        const availableScroll = bounds.maxMs - bounds.minMs - view.durationMs;
        const scroll = document.getElementById('impulseResponseScroll');
        if (scroll) {
            scroll.disabled = availableScroll <= bounds.samplePeriodMs / 2;
            scroll.value = availableScroll > 0
                ? Math.round((view.startMs - bounds.minMs) / availableScroll * 1000)
                : 0;
        }
        const range = document.getElementById('impulseResponseRange');
        if (range) {
            const endMs = view.startMs + view.durationMs;
            const digits = view.durationMs < 1 ? 3 : view.durationMs < 20 ? 2 : 1;
            range.textContent = `${view.startMs.toFixed(digits)}–${endMs.toFixed(digits)} ms`;
        }
    }

    drawImpulseResponseGraph() {
        const canvas = document.getElementById('impulseResponseGraph');
        const record = this.impulseResponse;
        const view = this.impulseResponseView;
        if (!canvas || !record || !view) return;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const padding = { top: 20, right: 20, bottom: 35, left: 55 };
        const graphWidth = width - padding.left - padding.right;
        const graphHeight = height - padding.top - padding.bottom;
        const endMs = view.startMs + view.durationMs;
        const timeToX = timeMs =>
            padding.left + (timeMs - view.startMs) / view.durationMs * graphWidth;
        const amplitudeToY = value =>
            padding.top + graphHeight * (0.5 - value / 2);

        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
        this.drawImpulseResponseGrid(
            ctx,
            padding,
            graphWidth,
            graphHeight,
            view,
            timeToX,
            amplitudeToY
        );
        if (view.startMs <= 0 && endMs >= 0) {
            const zeroX = timeToX(0);
            ctx.strokeStyle = '#aaa';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(zeroX, padding.top);
            ctx.lineTo(zeroX, padding.top + graphHeight);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        const envelope = sampleImpulseEnvelope(record, view, graphWidth);
        ctx.save();
        ctx.beginPath();
        ctx.rect(padding.left, padding.top, graphWidth, graphHeight);
        ctx.clip();
        ctx.strokeStyle = this.uiManager.graphColors.original;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let firstPoint = true;
        for (const bucket of envelope) {
            const ordered = bucket.minimumIndex <= bucket.maximumIndex
                ? [
                    [bucket.minimumIndex, bucket.minimum],
                    [bucket.maximumIndex, bucket.maximum]
                ]
                : [
                    [bucket.maximumIndex, bucket.maximum],
                    [bucket.minimumIndex, bucket.minimum]
                ];
            if (bucket.minimumIndex === bucket.maximumIndex) ordered.length = 1;
            for (const [sampleIndex, sample] of ordered) {
                const timeMs = (sampleIndex - record.onsetIndex) /
                    record.sampleRate * 1000;
                const x = timeToX(timeMs);
                const normalized = sample / this.impulseResponsePeak;
                const y = amplitudeToY(Math.min(1, Math.max(-1, normalized)));
                if (firstPoint) {
                    ctx.moveTo(x, y);
                    firstPoint = false;
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.stroke();
        ctx.restore();
        this.updateImpulseResponseControls();
    }

    drawImpulseResponseGrid(
        ctx,
        padding,
        graphWidth,
        graphHeight,
        view,
        timeToX,
        amplitudeToY
    ) {
        ctx.strokeStyle = '#555';
        ctx.fillStyle = '#aaa';
        ctx.lineWidth = 0.5;
        ctx.font = '10px Arial';
        const interval = getNiceTimeTickInterval(view.durationMs);
        const endMs = view.startMs + view.durationMs;
        const digits = interval < 0.01 ? 3 : interval < 0.1 ? 2 : interval < 1 ? 1 : 0;
        let tick = Math.ceil(view.startMs / interval) * interval;
        for (let count = 0; tick <= endMs && count < 100; count += 1, tick += interval) {
            const x = timeToX(tick);
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, padding.top + graphHeight);
            ctx.stroke();
            ctx.textAlign = 'center';
            ctx.fillText(tick.toFixed(digits), x, padding.top + graphHeight + 15);
        }

        for (const amplitude of [-1, -0.5, 0, 0.5, 1]) {
            const y = amplitudeToY(amplitude);
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + graphWidth, y);
            ctx.stroke();
            ctx.textAlign = 'right';
            ctx.fillText(String(amplitude), padding.left - 6, y + 3);
        }

        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1;
        ctx.strokeRect(padding.left, padding.top, graphWidth, graphHeight);
        ctx.fillStyle = '#ccc';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(
            i18n.t('axis:impulseTime') || 'Time (ms)',
            padding.left + graphWidth / 2,
            padding.top + graphHeight + 31
        );
        ctx.save();
        ctx.translate(14, padding.top + graphHeight / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(i18n.t('axis:normalizedAmplitude') || 'Normalized amplitude', 0, 0);
        ctx.restore();
    }

    /**
     * Draw a frequency response graph on canvas
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Array} data - Frequency response data [[freq, db], ...]
     * @param {string} color - Line color
     * @param {boolean} [normalize=false] - Whether to normalize to the audible-band median
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
     * Normalize frequency response to the measured audible-band median
     * @param {Array} response - Frequency response data as [[freq, db], ...]
     * @param {number} minFrequency - Measured lower frequency limit
     * @param {number} maxFrequency - Measured upper frequency limit
     * @returns {Array} Normalized frequency response
     */
    normalizeResponseToZeroDb(response, minFrequency, maxFrequency) {
        return normalizeFrequencyResponseToZeroDb(
            response,
            minFrequency,
            maxFrequency
        );
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
