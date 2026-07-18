/**
 * Graph utilities for the measurement controller
 */

import audioUtils from '../audio-utils/index.js';
import i18n from '../i18n.js';

const GraphUtils = {
    /**
     * Update the level graph with current input level
     */
    updateLevelGraph() {
        const canvas = document.getElementById('levelGraph');
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Get current input level
        const inputLevel = audioUtils.getInputLevel();
        
        // Calculate elapsed time
        const elapsedTime = (Date.now() - this.startTime) / 1000; // seconds
        
        // Store point
        this.levelGraphData.push({
            time: elapsedTime,
            level: inputLevel
        });
        
        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
        
        // Draw grid
        this.drawLevelGraphGrid(ctx, width, height);
        
        // Draw level data
        this.drawLevelGraphData(ctx, width, height);
    },
    
    /**
     * Draw level graph grid
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     */
    drawLevelGraphGrid(ctx, width, height) {
        const padding = { top: 10, right: 10, bottom: 30, left: 60 };
        const graphWidth = width - padding.left - padding.right;
        const graphHeight = height - padding.top - padding.bottom;
        
        // Calculate max time based on sweep length and averaging
        const sweepLengthSamples = parseInt(this.measurementConfig.sweepLength);
        const averagingCount = parseInt(this.measurementConfig.averaging);
        const sampleRate = audioUtils.audioContext.sampleRate;
        const sweepTimeSeconds = sweepLengthSamples / sampleRate;
        const maxTime = 1 + (sweepTimeSeconds * averagingCount) + 1; // 1s delay + sweep time + 1s reserve
        
        // Draw axes
        ctx.strokeStyle = '#555';
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
        
        // Draw grid lines and labels for y-axis (levels)
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 0.5;
        ctx.fillStyle = '#aaa';
        ctx.font = '10px Arial';
        ctx.textAlign = 'right';
        
        for (let db = 0; db >= -60; db -= 10) {
            const y = padding.top + graphHeight * (1 - (db + 60) / 60);
            
            // Grid line
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
            
            // Label
            ctx.fillText(`${db} dB`, padding.left - 5, y + 3);
        }
        
        // Draw time labels for x-axis
        ctx.textAlign = 'center';
        
        for (let t = 0; t <= maxTime; t += 5) {
            const x = padding.left + (t / maxTime) * graphWidth;
            
            // Grid line
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, height - padding.bottom);
            ctx.stroke();
            
            // Label
            ctx.fillText(`${t}s`, x, height - padding.bottom + 15);
        }
        
        // Draw axes labels
        ctx.fillStyle = '#ccc';
        ctx.font = '12px Arial';
        
        // X-axis label
        ctx.textAlign = 'center';
        ctx.fillText('Time (s)', width / 2, height - 5);
        
        // Y-axis label
        ctx.save();
        ctx.translate(15, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText('Level (dB)', 0, 0);
        ctx.restore();
    },
    
    /**
     * Draw level data on graph
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     */
    drawLevelGraphData(ctx, width, height) {
        if (!this.levelGraphData || this.levelGraphData.length < 2) return;
        
        const padding = { top: 10, right: 10, bottom: 30, left: 60 };
        const graphWidth = width - padding.left - padding.right;
        const graphHeight = height - padding.top - padding.bottom;
        
        // Calculate max time based on sweep length and averaging
        const sweepLengthSamples = parseInt(this.measurementConfig.sweepLength);
        const averagingCount = parseInt(this.measurementConfig.averaging);
        const sampleRate = audioUtils.audioContext.sampleRate;
        const sweepTimeSeconds = sweepLengthSamples / sampleRate;
        const maxTime = 1 + (sweepTimeSeconds * averagingCount) + 1; // 1s delay + sweep time + 1s reserve
        
        // Draw level data
        ctx.strokeStyle = '#4e79a7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        let isFirstPoint = true;
        
        for (const point of this.levelGraphData) {
            // Skip points beyond the displayed time range
            if (point.time > maxTime) continue;
            
            // Calculate x position (time)
            const x = padding.left + (point.time / maxTime) * graphWidth;
            
            // Calculate y position (level) - clamp between -60dB and 0dB
            const clampedLevel = Math.max(-60, Math.min(0, point.level));
            const normalizedLevel = (clampedLevel + 60) / 60; // Map -60..0 to 0..1
            const y = padding.top + graphHeight * (1 - normalizedLevel);
            
            if (isFirstPoint) {
                ctx.moveTo(x, y);
                isFirstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
    },
    
    /**
     * Update the frequency response graph for the current measurement
     * @param {Array} frequencyResponse - Frequency response data
     * @param {number} maxSignalLevel - Maximum signal level in dB
     */
    updateFrequencyResponseGraph(frequencyResponse, maxSignalLevel) {
        const canvas = document.getElementById('frequencyResponseGraph');
        const ctx = canvas.getContext('2d');
        
        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw graph
        this.drawFrequencyResponseGraph(ctx, frequencyResponse, '#4e79a7');
        
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
    },
    
    /**
     * Draw frequency response graph on canvas
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Array} frequencyResponse - Frequency response data
     * @param {string} color - Line color
     */
    drawFrequencyResponseGraph(ctx, frequencyResponse, color) {
        if (!frequencyResponse || frequencyResponse.length === 0) return;
        
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
        
        // Normalize frequencyResponse to average 0dB
        const normalizedResponse = this.normalizeResponseToZeroDb([...frequencyResponse]);
        
        // Setup scales
        const scaleX = (freq) => {
            return padding.left + graphWidth * (Math.log10(freq) - Math.log10(minFreq)) / (Math.log10(maxFreq) - Math.log10(minFreq));
        };
        
        const scaleY = (db) => {
            return padding.top + graphHeight - graphHeight * (db - minDb) / (maxDb - minDb);
        };
        
        // Draw axes
        ctx.strokeStyle = '#555';
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
        
        // Draw frequency response
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        let firstPoint = true;
        
        for (const [freq, db] of normalizedResponse) {
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
        
        // Draw grid lines
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 0.5;
        
        // Frequency grid lines (decades)
        for (let freq = 20; freq <= 20000; freq *= 10) {
            const x = scaleX(freq);
            
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, height - padding.bottom);
            ctx.stroke();
            
            // Draw label
            ctx.fillStyle = '#aaa';
            ctx.font = '10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(this.formatFrequency(freq), x, height - padding.bottom + 15);
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
    },
    
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
    },
    
    /**
     * Format frequency for display (add k for kHz)
     * @param {number} freq - Frequency in Hz
     * @returns {string} Formatted frequency
     */
    formatFrequency(freq) {
        if (freq >= 1000) {
            return `${(freq / 1000).toFixed(0)}k`;
        }
        return freq.toString();
    }
};

export default GraphUtils;
