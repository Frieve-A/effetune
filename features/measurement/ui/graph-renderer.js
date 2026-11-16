/** History preview, correction normalization and unmodified IR export. */
import dataStorage from '../dataStorage.js';
import audioUtils from '../audio-utils/index.js';
import { normalizeResponseToZeroDb as normalizeFrequencyResponseToZeroDb } from '../response-normalization.js';
import { resolveIrRecordTarget } from '../measurement-model.js';
import { isValidImpulseResponse } from './impulse-response-plot.js';

const RESPONSE_PREVIEW_FRAME = { xMin: 20, xMax: 20000, yMin: -24, yMax: 24 };

class GraphRenderer {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.impulseResponse = null;
    }

    exportImpulseResponseWav() {
        const record = this.impulseResponse;
        if (!isValidImpulseResponse(record)) return;

        const measurement = dataStorage.getMeasurementById(this.uiManager.selectedMeasurementId);
        const target = resolveIrRecordTarget(measurement, record.pointId);
        if (!measurement || !target) return;

        const point = measurement.points[target.pointIndex];
        const channelSuffix = target.channel ? `_${target.channel}` : '';
        const filenamePrefix = `${measurement.name}_${point.name || `Point ${target.pointIndex + 1}`}${channelSuffix}`
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

    normalizeResponseToZeroDb(response, minFrequency, maxFrequency) {
        return normalizeFrequencyResponseToZeroDb(
            response,
            minFrequency,
            maxFrequency
        );
    }

    /**
     * Draws a [[Hz, dB]] curve in a history item. The default frame is the normalized frequency
     * response; `frame` gives another fixed frame, drawn without normalization. A null or non-finite dB is a gap.
     */
    drawPreviewGraph(container, data, frame = null) {
        // Create canvas if it doesn't exist
        let canvas = container.querySelector('canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;
            container.appendChild(canvas);
        }
        
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = window.ThemePalette?.get('graph-base') ?? '';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        if (!data || data.length === 0) return;
        
        const width = canvas.width;
        const height = canvas.height;
        const padding = { top: 2, right: 2, bottom: 2, left: 2 };
        
        const graphWidth = width - padding.left - padding.right;
        const graphHeight = height - padding.top - padding.bottom;
        
        // Setup scales (logarithmic for frequency)
        const { xMin: minFreq, xMax: maxFreq, yMin: minDb, yMax: maxDb } = frame ?? RESPONSE_PREVIEW_FRAME;
        const processedData = frame ? data : this.normalizeResponseToZeroDb([...data]);
        
        const scaleX = (freq) => {
            return padding.left + graphWidth * (Math.log10(freq) - Math.log10(minFreq)) / (Math.log10(maxFreq) - Math.log10(minFreq));
        };
        
        const scaleY = (db) => {
            return padding.top + graphHeight - graphHeight * (db - minDb) / (maxDb - minDb);
        };
        
        // Draw the frequency response line; out-of-range values run out through the plot border
        ctx.save();
        ctx.beginPath();
        ctx.rect(padding.left, padding.top, graphWidth, graphHeight);
        ctx.clip();
        ctx.strokeStyle = this.uiManager.graphColors.original;
        ctx.lineWidth = 1;
        ctx.beginPath();

        let firstPoint = true;

        for (const [freq, db] of processedData) {
            if (freq < minFreq || freq > maxFreq) continue;
            if (!Number.isFinite(db)) {
                firstPoint = true;
                continue;
            }

            const x = scaleX(freq);
            const y = scaleY(db);
            
            if (firstPoint) {
                ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.stroke();
        ctx.restore();
    }
}

export default GraphRenderer;
