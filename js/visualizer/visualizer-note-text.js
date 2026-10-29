// Text-only views of Note Spectrogram telemetry, without allocating pitch histories.
const isNewer = (candidate, current) => {
    const delta = (candidate - current) >>> 0;
    return delta !== 0 && delta < 0x80000000;
};

export class NoteTextDisplay {
    initializeDisplayState() {
        this.telemetrySource = null;
        this.activeGeneration = null;
        this.snapshot = null;
    }

    handleTelemetry(frame) {
        const Note = window.NoteSpectrogramPlugin;
        if (frame?.frameType === 32) {
            const snapshot = Note?.prototype.parseChordKeyTelemetryFrame(frame);
            if (!snapshot || snapshot.generation !== this.activeGeneration || frame.source !== this.telemetrySource ||
                (this.snapshot && !isNewer(snapshot.frameIndex, this.snapshot.frameIndex))) return;
            this.snapshot = snapshot;
            return;
        }
        const snapshot = Note?.prototype.parseTelemetryFrame(frame);
        if (!snapshot) return;
        if (frame.source !== this.telemetrySource) {
            this.initializeDisplayState();
            this.telemetrySource = frame.source;
        }
        if (this.activeGeneration === null || isNewer(snapshot.generation, this.activeGeneration)) {
            this.activeGeneration = snapshot.generation;
            this.snapshot = null;
        }
    }

    drawGraph() {
        const { width, height } = this.canvas;
        this.ctx.clearRect(0, 0, width, height);
        if (!this.snapshot) return;
        const Note = window.NoteSpectrogramPlugin;
        const { localKey, overallKey, confirmed } = this.snapshot;
        const text = this.displayOptions.textType === 'key'
            ? Number.isInteger(localKey) && localKey >= 0 && localKey < 24 ? Note.keyName(localKey) : ''
            : Note.chordName(confirmed.name, overallKey);
        if (text) this.displayOptions.drawText(this.ctx, text);
    }
}
