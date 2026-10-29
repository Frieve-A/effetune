import { DrumsRenderer } from './visualizer-drums-renderer.js';

const FADE_MS = 300;
const MAX_IDENTITIES = 2048;
const isNewer = (candidate, current) => {
    const delta = (candidate - current) >>> 0;
    return delta !== 0 && delta < 0x80000000;
};

// A display-only consumer of Rhythm Analyzer telemetry, including the tom lane.
export class DrumsDisplay {
    initializeDisplayState() {
        this.renderer = null;
        this.params = {};
        this.clearDetections();
    }

    clearDetections() {
        this.telemetrySource = null;
        this.activeGeneration = null;
        this.lastFrameCount = null;
        this.latestEventTime = -Infinity;
        this.identities = new Set();
        this.hits = Array.from({ length: 5 }, () => ({ time: -Infinity, strength: 0 }));
        this.levels = new Float32Array(5);
    }

    setParameters(changed) {
        Object.assign(this.params, changed);
    }

    handleTelemetry(frame) {
        const snapshot = window.RhythmAnalyzerPlugin?.prototype.parseTelemetryFrame(frame);
        if (!snapshot || snapshot.displayMode !== 'drums') return;
        if (frame.source !== this.telemetrySource) {
            this.clearDetections();
            this.telemetrySource = frame.source;
        }
        if (this.activeGeneration === null || isNewer(snapshot.generation, this.activeGeneration)) {
            const source = this.telemetrySource;
            this.clearDetections();
            this.telemetrySource = source;
            this.activeGeneration = snapshot.generation;
        } else if (snapshot.generation !== this.activeGeneration) return;
        if (this.lastFrameCount !== null && snapshot.frameCount !== this.lastFrameCount &&
            !isNewer(snapshot.frameCount, this.lastFrameCount)) return;
        this.lastFrameCount = snapshot.frameCount;

        const events = snapshot.events.filter(event => !this.identities.has(event.identity));
        for (const event of events) {
            this.identities.add(event.identity);
            this.latestEventTime = Math.max(this.latestEventTime, event.time);
        }
        while (this.identities.size > MAX_IDENTITIES) this.identities.delete(this.identities.values().next().value);
        // The hub has already aligned delivery to audible time. Subtract the
        // detector age only to age hits within a batch, never to add a second delay.
        // Unsupported beat-tracker rates report frameCount=0; drum timestamps
        // still order their events, independently of beat confidence or BPM.
        const audioTime = Math.max(this.latestEventTime,
            snapshot.frameCount * snapshot.hopSeconds - snapshot.drumLatencySeconds);
        const now = performance.now();
        for (const event of events) {
            const hit = this.hits[event.band];
            if (!hit) continue;
            const time = now - Math.max(0, audioTime - event.time) * 1000;
            if (time < hit.time) continue;
            hit.time = time;
            hit.strength = event.strength;
        }
    }

    stepLevels(now) {
        for (let lane = 0; lane < this.hits.length; lane++) {
            const hit = this.hits[lane];
            const remaining = Math.max(0, 1 - Math.max(0, now - hit.time) / FADE_MS);
            this.levels[lane] = hit.strength * remaining * remaining;
        }
        return this.levels;
    }

    drawGraph(now) {
        const context = this.ctx, width = this.canvas.width, height = this.canvas.height;
        context.clearRect(0, 0, width, height);
        this.renderer ||= new DrumsRenderer();
        const image = this.renderer.render(width, height, this.params, this.stepLevels(now), this.displayOptions.glowColor);
        if (image) {
            this.displayOptions.drawSignal(context, target => target.drawImage(image, 0, 0, width, height));
        } else {
            const key = 'visualizer.drumsUnavailable';
            const translated = window.uiManager?.t?.(key);
            const message = translated && translated !== key ? translated
                : '3D view is unavailable. Enable hardware acceleration in your browser and reopen this view.';
            context.fillStyle = this.displayOptions.themePalette.get('text-primary');
            context.font = `${Math.max(10, 13 * (this.graphDpr || 1))}px sans-serif`;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(message, width / 2, height / 2, width * .92);
        }
    }

    disposeDisplay() {
        this.renderer?.dispose();
        this.renderer = null;
    }
}
