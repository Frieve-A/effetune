import { WaterfallSurface } from './waterfall-surface.js';
import { sampleImpulseEnvelope, findImpulsePeak } from './impulse-response-plot.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const palette = name => window.ThemePalette?.get(name) || '#888'; // theme-allow: Neutral fallback only when ThemePalette is unavailable; the theme palette remains authoritative.
const seriesLabel = (series, unit) => `${series.label} (${unit})`;

// Standard dry air at 15 °C and 1 atm (NASA SP-367 standard atmosphere).
const SOUND_SPEED_METERS_PER_SECOND = 340.3;
const frequencyReadout = frequency => `${frequency.toFixed(1)} Hz · λ ${Number((SOUND_SPEED_METERS_PER_SECOND / frequency).toPrecision(3))} m`;

export function interpolateCurve(points, x, logarithmic = true) {
    if (!points?.length || x < points[0][0] || x > points.at(-1)[0]) return null;
    let low = 0;
    let high = points.length - 1;
    while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (points[middle][0] <= x) low = middle;
        else high = middle;
    }
    const [x0, y0] = points[low];
    const [x1, y1] = points[high];
    if (!finite(y0) || (!finite(y1) && x !== x0)) return null;
    if (x === x0 || x1 === x0) return y0;
    const ratio = logarithmic ? Math.log(x / x0) / Math.log(x1 / x0) : (x - x0) / (x1 - x0);
    return y0 + (y1 - y0) * ratio;
}

export function distortionValue(ratio, unit) {
    if (!finite(ratio) || ratio < 0) return null;
    return unit === 'dBr' ? (ratio > 0 ? 20 * Math.log10(ratio) : null) : ratio * 100;
}

export class AnalysisPlot {
    constructor(canvas, output, onViewChange) {
        this.canvas = canvas;
        this.output = output;
        this.mount = canvas.parentElement;
        this.state = null;
        this.keyboardPosition = 0.5;
        this.surface = new WaterfallSurface(canvas, { onViewChange: view => {
            this.readout?.clear(); this.output.textContent = ''; onViewChange?.(view);
        } });
        this.surface.setEnabled(false);
        if (!output) return;
        this.readout = window.GraphReadout?.attach({
            mount: this.mount, surface: canvas,
            plot: () => this.plot && Object.fromEntries(Object.entries(this.state?.type === 'waterfall' ?
                { left: 0, top: 0, width: this.width, height: this.height } : this.plot).map(([key, value]) => [key, value * this.dpr])),
            read: (x, y) => this.read(x / this.dpr, y / this.dpr),
            legend: []
        });
        canvas.addEventListener('keydown', event => {
            if (event.shiftKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const direction = ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1;
            this.keyboardPosition = event.key === 'Home' ? 0 : event.key === 'End' ? 1 :
                Math.max(0, Math.min(1, this.keyboardPosition + direction * 0.01));
            if (!this.plot) return;
            let x = this.plot.left + this.plot.width * this.keyboardPosition;
            let y = this.plot.top + this.plot.height / 2;
            if (this.state?.type === 'waterfall') {
                const point = this.surface.keyboardPoint(this.keyboardPosition);
                if (!point) { this.output.textContent = ''; this.readout?.clear(); return; }
                x = point.x; y = point.y;
            }
            const rect = canvas.getBoundingClientRect();
            this.mount.dispatchEvent(new PointerEvent('pointermove', {
                clientX: rect.left + x, clientY: rect.top + y, pointerType: 'mouse', bubbles: true
            }));
            const value = this.read(x, y);
            this.output.textContent = value ? `${value.cursor}: ${value.rows.map(row => `${row.label} ${row.value}`).join('; ')}` : '';
        });
    }

    clear() {
        this.state = null;
        this.surface.setEnabled(false);
        this.readout?.clear();
        this.readout?.setLegend([]);
        this.output.textContent = '';
        this.canvas.getContext('2d').clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    prepare(dimensions) {
        const rect = dimensions || this.canvas.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return null;
        this.dpr = dimensions?.dpr || window.devicePixelRatio || 1;
        this.canvas.width = Math.round(rect.width * this.dpr);
        this.canvas.height = Math.round(rect.height * this.dpr);
        this.width = rect.width;
        this.height = rect.height;
        const ctx = this.canvas.getContext('2d');
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = palette('graph-base');
        ctx.fillRect(0, 0, this.width, this.height);
        this.plot = { left: 60, top: 28, width: Math.max(1, this.width - 82), height: Math.max(1, this.height - 76) };
        ctx.font = '12px Arial';
        return ctx;
    }

    draw(state, dimensions) {
        if (this.output) this.output.textContent = '';
        this.state = state;
        const ctx = this.prepare(dimensions);
        if (!ctx) return;
        this.surface.setEnabled(state.type === 'waterfall' && !dimensions?.exporting);
        const { xMin, xMax, yMin, yMax, logX = true } = state;
        const p = this.plot;
        this.scaleX = x => p.left + p.width * (logX ? Math.log(x / xMin) / Math.log(xMax / xMin) : (x - xMin) / (xMax - xMin));
        this.scaleY = y => p.top + p.height * (1 - (y - yMin) / (yMax - yMin));
        this.inverseX = x => logX ? xMin * (xMax / xMin) ** ((x - p.left) / p.width) : xMin + (x - p.left) / p.width * (xMax - xMin);
        if (state.type === 'waterfall') {
            this.surface.draw(ctx, state, this.plot, { width: this.width, height: this.height, dpr: this.dpr, exporting: dimensions?.exporting });
        } else {
            this.grid(ctx, state);
            ctx.save();
            ctx.beginPath();
            ctx.rect(p.left, p.top, p.width, p.height);
            ctx.clip();
            if (state.type === 'impulse') this.drawImpulse(ctx, state);
            else state.series.forEach((series, index) => {
                ctx.strokeStyle = series.color;
                ctx.lineWidth = 1.6;
                ctx.setLineDash(index % 3 === 0 ? [] : index % 3 === 1 ? [6, 3] : [2, 3]);
                ctx.beginPath();
                let connected = false;
                for (const [x, y] of series.points) {
                    if (!finite(y) || !(x > 0)) { connected = false; continue; }
                    const px = this.scaleX(x);
                    const py = this.scaleY(y);
                    if (connected) ctx.lineTo(px, py); else ctx.moveTo(px, py);
                    connected = true;
                }
                ctx.stroke();
            });
            if (state.type === 'frequency' && state.frequencyMarkers) {
                ctx.strokeStyle = palette('text-primary');
                ctx.lineWidth = 1;
                ctx.setLineDash([]);
                for (const frequency of state.frequencyMarkers) {
                    if (!finite(frequency) || frequency < xMin || frequency > xMax) continue;
                    const x = this.scaleX(frequency);
                    ctx.beginPath(); ctx.moveTo(x, p.top); ctx.lineTo(x, p.top + p.height); ctx.stroke();
                }
            }
            ctx.restore();
        }
        this.readout?.setLegend(state.type === 'waterfall' ? [] : state.series.map(series => ({ label: seriesLabel(series, state.unit), color: series.color })));
        this.readout?.refresh();
    }

    renderImage({ title, subtitle = '' }) {
        if (!this.state || !this.width || !this.height) throw new Error('No plotted data to copy');
        const dpr = Math.min(4096 / Math.max(this.width, this.height), Math.max(2, 1600 / this.width));
        const graph = document.createElement('canvas');
        const renderer = new AnalysisPlot(graph, null);
        try { renderer.draw(this.state, { width: this.width, height: this.height, dpr, exporting: true }); }
        finally { renderer.surface.destroy(); }
        const image = document.createElement('canvas');
        const measure = graph.getContext('2d'); measure.font = '12px Arial';
        const subtitleLines = [''];
        for (const character of subtitle) {
            const index = subtitleLines.length - 1;
            if (measure.measureText(subtitleLines[index] + character).width > this.width - 40) subtitleLines.push(character);
            else subtitleLines[index] += character;
        }
        const legend = this.state.type === 'waterfall' ? [] : this.state.series;
        let x = 20; let line = 0;
        const entries = legend.map((series, index) => {
            const text = seriesLabel(series, this.state.unit);
            const width = 42 + measure.measureText(text).width;
            if (x > 20 && x + width > this.width - 20) { x = 20; line++; }
            const entry = { series, index, text, x, line }; x += width; return entry;
        });
        const legendTop = 48 + subtitleLines.length * 16;
        const headerHeight = legendTop + (entries.length ? (line + 1) * 22 : 0);
        image.width = graph.width; image.height = graph.height + Math.round(headerHeight * dpr);
        const ctx = image.getContext('2d'); ctx.scale(dpr, dpr);
        ctx.fillStyle = palette('graph-base'); ctx.fillRect(0, 0, this.width, this.height + headerHeight);
        ctx.fillStyle = palette('graph-label-strong'); ctx.font = 'bold 19px Arial';
        ctx.fillText(title, 20, 26, this.width - 40);
        ctx.fillStyle = palette('graph-label'); ctx.font = '12px Arial';
        subtitleLines.forEach((text, index) => ctx.fillText(text, 20, 47 + index * 16));
        for (const { series, index, text, x, line } of entries) {
            const y = legendTop + line * 22;
            ctx.strokeStyle = series.color; ctx.lineWidth = 2;
            ctx.setLineDash(index % 3 === 0 ? [] : index % 3 === 1 ? [6, 3] : [2, 3]);
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 18, y); ctx.stroke();
            ctx.fillStyle = palette('graph-label'); ctx.fillText(text, x + 24, y + 4);
        }
        ctx.drawImage(graph, 0, headerHeight, this.width, this.height);
        return image;
    }

    grid(ctx, state) {
        const p = this.plot;
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        for (let i = 0; i <= 6; i++) {
            const yValue = state.yMin + (state.yMax - state.yMin) * i / 6;
            const y = this.scaleY(yValue);
            ctx.strokeStyle = palette('graph-grid');
            ctx.beginPath(); ctx.moveTo(p.left, y); ctx.lineTo(p.left + p.width, y); ctx.stroke();
            ctx.fillStyle = palette('graph-label');
            ctx.textAlign = 'right';
            ctx.fillText(Number(yValue.toPrecision(3)).toString(), p.left - 8, y + 4);
        }
        const tickCount = this.width < 500 ? 4 : 8;
        for (let i = 0; i <= tickCount; i++) {
            const x = p.left + p.width * i / tickCount;
            const value = this.inverseX(x);
            ctx.strokeStyle = palette('graph-grid');
            ctx.beginPath(); ctx.moveTo(x, p.top); ctx.lineTo(x, p.top + p.height); ctx.stroke();
            ctx.fillStyle = palette('graph-label');
            ctx.textAlign = 'center';
            ctx.fillText(state.logX === false ? Number(value.toPrecision(3)).toString() :
                value >= 1000 ? `${Number((value / 1000).toPrecision(2))}k` : `${Math.round(value)}`, x, p.top + p.height + 18);
        }
        ctx.textAlign = 'left';
        ctx.fillText(state.unit, p.left, 17);
        ctx.textAlign = 'center';
        ctx.fillText(state.logX === false ? 'ms' : 'Hz', p.left + p.width / 2, this.height - 8);
    }

    drawImpulse(ctx, state) {
        const { record, origin = 0, peakNormalized, db, windowBefore, windowAfter } = state;
        this.envelope = sampleImpulseEnvelope(record, {
            startMs: state.xMin + origin, durationMs: state.xMax - state.xMin
        }, this.plot.width);
        const reference = peakNormalized ? findImpulsePeak(record.data) : (record.refScale > 0 ? record.refScale : 1);
        this.amplitude = value => db ? 20 * Math.log10(Math.max(Math.abs(value / reference), 1e-15)) : value / reference;
        const start = this.scaleX(-windowBefore - origin);
        const end = this.scaleX(windowAfter - origin);
        // Keep the window guide separate from the waveform's amplitude scale.
        const guideTop = this.plot.top + 4;
        const guideHeight = 14;
        ctx.strokeStyle = palette('graph-label');
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(start, guideTop, end - start, guideHeight);
        ctx.beginPath();
        const rise = windowBefore / (windowBefore + windowAfter || 1);
        for (let i = 0; i <= 100; i++) {
            const t = i / 100;
            const weight = state.window === 'rectangular' ? 1 : state.window === 'hann' ?
                0.5 - 0.5 * Math.cos(2 * Math.PI * t) : t < rise ?
                    0.5 - 0.5 * Math.cos(Math.PI * t / rise) : t > 0.9 ?
                        0.5 - 0.5 * Math.cos(Math.PI * (1 - t) / 0.1) : 1;
            const x = start + (end - start) * t;
            const y = guideTop + guideHeight * (1 - weight);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = state.series[0].color;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        let connected = false;
        for (const bucket of this.envelope) {
            const indices = [bucket.minimumIndex, bucket.maximumIndex].sort((a, b) => a - b);
            for (const index of indices) {
                const x = this.scaleX((index - record.onsetIndex) * 1000 / record.sampleRate - origin);
                const y = this.scaleY(this.amplitude(record.data[index]));
                if (connected) ctx.lineTo(x, y); else ctx.moveTo(x, y);
                connected = true;
            }
        }
        ctx.stroke();
    }

    read(x, y) {
        const state = this.state;
        if (!state || !this.plot) return null;
        if (state.type === 'waterfall') {
            const point = this.surface.read(x, y);
            if (!point) return null;
            return { cursor: `${frequencyReadout(point.frequency)} · ${(point.time * 1000).toFixed(2)} ms${state.depthUnit === 'cycles' ? ` · ${point.cycles.toFixed(2)} cycles` : ''}`,
                rows: [{ label: state.series[0].label, color: state.series[0].color, value: `${point.level.toFixed(2)} dB` }],
                at: { x: point.x * this.dpr, y: point.y * this.dpr }, crosshair: 'none' };
        }
        const coordinate = this.inverseX(x);
        if (state.type === 'impulse') {
            const record = state.record;
            const index = record.onsetIndex + (coordinate + state.origin) * record.sampleRate / 1000;
            if (index < 0 || index > record.data.length - 1) return null;
            const bucket = this.envelope?.find(value => index >= Math.min(value.minimumIndex, value.maximumIndex) - 1 &&
                index <= Math.max(value.minimumIndex, value.maximumIndex) + 1) ||
                this.envelope?.reduce((closest, value) => !closest || Math.abs(value.minimumIndex - index) < Math.abs(closest.minimumIndex - index) ? value : closest, null);
            if (!bucket) return null;
            const values = [this.amplitude(bucket.minimum), this.amplitude(bucket.maximum)].sort((a, b) => a - b);
            const time = (bucket.minimumIndex - record.onsetIndex) * 1000 / record.sampleRate - state.origin;
            return { cursor: `${time.toFixed(3)} ms`, rows: [{ label: seriesLabel(state.series[0], state.unit), color: state.series[0].color,
                value: `${values[0].toPrecision(4)} … ${values[1].toPrecision(4)} ${state.unit}` }],
                at: { x: this.scaleX(time) * this.dpr, y: this.scaleY(this.amplitude(bucket.minimum)) * this.dpr } };
        }
        const rows = state.series.map(series => {
            const value = interpolateCurve(series.points, coordinate);
            return { label: seriesLabel(series, state.unit), color: series.color,
                value: value === null ? '—' : `${state.type === 'distortion' ? Number(value.toPrecision(4)) : value.toFixed(2)} ${state.unit}`,
                y: value === null ? undefined : this.scaleY(value) * this.dpr };
        });
        return { cursor: frequencyReadout(coordinate), rows };
    }
}
