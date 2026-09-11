const MULTI_F0_TAP_FRAME = 24;
const MULTI_F0_TELEMETRY_VERSION = 3;
const MULTI_F0_PAYLOAD_HEADER_BYTES = 28;
const MULTI_F0_NOTE_COUNT = 88;
const MULTI_F0_FINE_DIVISIONS = 5;
const MULTI_F0_FINE_CENTER = Math.floor(MULTI_F0_FINE_DIVISIONS / 2);
const MULTI_F0_PITCH_COUNT = MULTI_F0_NOTE_COUNT * MULTI_F0_FINE_DIVISIONS;
const MULTI_F0_FIRST_MIDI = 21;
const MULTI_F0_LAST_MIDI = MULTI_F0_FIRST_MIDI + MULTI_F0_NOTE_COUNT - 1;
const MULTI_F0_DEFAULT_MIN_MIDI = 28;
const MULTI_F0_DEFAULT_MAX_MIDI = 91;
const MULTI_F0_DEFAULT_REGULAR_CANDIDATES = 8;
const MULTI_F0_LEVEL_OFFSET = MULTI_F0_PAYLOAD_HEADER_BYTES + MULTI_F0_PITCH_COUNT * 4;
const MULTI_F0_PAYLOAD_BYTES = MULTI_F0_LEVEL_OFFSET + MULTI_F0_PITCH_COUNT * 4;
const MULTI_F0_LEVEL_FLOOR = -240;
const MULTI_F0_LEVEL_RANGE_DB = 24;
const MULTI_F0_LEVEL_CEILING_DB = -36;
const MULTI_F0_METER_RELEASE_DB_PER_SECOND = 20;
const MULTI_F0_RANGE_HOLD_SECONDS = 1;
const MULTI_F0_COLORS = [
    { value: 'Normal', label: 'Normal' },
    { value: 'Rainbow', label: 'Note Colors' }
];
const MULTI_F0_RESOLUTIONS = [
    { value: 'Semitone', label: '1/12 Octave' },
    { value: 'High', label: 'High (1/60 Octave)' }
];
const MULTI_F0_LAYOUTS = ['Vertical', 'Horizontal'];
const MULTI_F0_HISTORY_WIDTH = 1024;
const MULTI_F0_KEY_GUTTER_CSS_PX = 28;
const MULTI_F0_HORIZONTAL_KEY_GUTTER_CSS_PX = MULTI_F0_KEY_GUTTER_CSS_PX * 1.6;
const MULTI_F0_PASS_THROUGH_PROCESSOR = 'return data;';
const MULTI_F0_BLACK_KEY_CLASSES = new Set([1, 3, 6, 8, 10]);
const MULTI_F0_WHITE_KEY_CLASSES = [0, 2, 4, 5, 7, 9, 11];
const MULTI_F0_WHITE_KEY_MIDIS = Array.from(
    { length: MULTI_F0_NOTE_COUNT },
    (_, pitch) => MULTI_F0_FIRST_MIDI + pitch
).filter(midi => !MULTI_F0_BLACK_KEY_CLASSES.has(midi % 12));
const MULTI_F0_NOTE_NAMES = [
    'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'
];
const MULTI_F0_BLACK_KEY_BACKGROUND = 8;
const MULTI_F0_NOTE_COLORS = [
    [170, 98, 86],     // C
    [161, 105, 57],    // C#
    [140, 115, 42],    // D
    [109, 124, 55],    // D#
    [69, 130, 84],     // E
    [19, 132, 116],    // F
    [0, 130, 146],     // F#
    [56, 123, 167],    // G
    [96, 115, 175],    // G#
    [129, 107, 168],   // A
    [153, 99, 148],    // A#
    [167, 96, 119]     // B
];

function multiF0InterpolatedNoteColor(pitch) {
    const midi = MULTI_F0_FIRST_MIDI +
        (pitch - MULTI_F0_FINE_CENTER) / MULTI_F0_FINE_DIVISIONS;
    const lowerMidi = Math.floor(midi);
    const fraction = midi - lowerMidi;
    const lower = MULTI_F0_NOTE_COLORS[((lowerMidi % 12) + 12) % 12];
    const upper = MULTI_F0_NOTE_COLORS[(((lowerMidi + 1) % 12) + 12) % 12];
    return [
        lower[0] + (upper[0] - lower[0]) * fraction,
        lower[1] + (upper[1] - lower[1]) * fraction,
        lower[2] + (upper[2] - lower[2]) * fraction
    ];
}

function isNewerMultiF0Counter(candidate, current) {
    const delta = (candidate - current) >>> 0;
    return delta !== 0 && delta < 0x80000000;
}

function multiF0NoteName(midi) {
    return `${MULTI_F0_NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

class NoteSpectrogramPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({ requiresWasm: true });

    constructor() {
        super('Note Spectrogram', 'Multi-pitch piano roll');
        this.cl = 'Normal';
        this.pr = 'Semitone';
        this.ly = 'Horizontal';
        this.vl = true;
        this.ts = 2;
        this.mn = MULTI_F0_DEFAULT_MIN_MIDI;
        this.mx = MULTI_F0_DEFAULT_MAX_MIDI;
        this.nc = MULTI_F0_DEFAULT_REGULAR_CANDIDATES;
        this.history = new Float32Array(MULTI_F0_HISTORY_WIDTH * MULTI_F0_PITCH_COUNT);
        this.levelHistory = new Float32Array(MULTI_F0_HISTORY_WIDTH * MULTI_F0_PITCH_COUNT);
        this.writeColumn = 0;
        this.columnPhase = 0;
        this.columnPeriod = this.ts / MULTI_F0_HISTORY_WIDTH;
        this.scrollTime = null;
        this.scrollWallTime = null;
        this.scrollPaused = false;
        this.scrollAnchorPending = true;
        this.latestHopSeconds = 0;
        this.latestFrameTimeSeconds = null;
        this.lastFrameIndex = null;
        this.activeGeneration = null;
        this.generationFence = null;
        this.modeTimeFence = null;
        this.lastObservedTimeSeconds = null;
        this.intensity = new Float32Array(MULTI_F0_PITCH_COUNT);
        this.levelIntensity = new Float32Array(MULTI_F0_PITCH_COUNT);
        this.levelReference = MULTI_F0_LEVEL_FLOOR;
        this.levelReferenceHold = 0;
        this.meterCurrent = new Float32Array(MULTI_F0_NOTE_COUNT);
        this.meterCurrent.fill(MULTI_F0_LEVEL_FLOOR);

        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundTelemetry = frame => this.handleTelemetry(frame);

        this.imageData = null;
        this.tempCanvas = null;
        this.scaledHistoryCanvas = null;
        this.volumeHistoryCanvas = null;
        this.volumeHistoryDirty = true;
        this.tempCtx = null;
        this.canvas = null;
        this.canvasCtx = null;
        this.observer = null;
        this.resizeGraphDisposer = null;
        this.graphDpr = 1;
        this.graphCssWidth = 1024;
        this.isVisible = false;
        this.animationFrameId = null;

        this.registerProcessor(MULTI_F0_PASS_THROUGH_PROCESSOR);
    }

    reset() {
        this.cl = 'Normal';
        this.pr = 'Semitone';
        this.ly = 'Horizontal';
        this.vl = true;
        this.ts = 2;
        this.mn = MULTI_F0_DEFAULT_MIN_MIDI;
        this.mx = MULTI_F0_DEFAULT_MAX_MIDI;
        this.nc = MULTI_F0_DEFAULT_REGULAR_CANDIDATES;
        this.columnPeriod = this.ts / MULTI_F0_HISTORY_WIDTH;
        this.configureHistoryImage();
        this.beginTelemetryEpoch();
        this.updateParameters();
    }

    getParameters() {
        this.ensureDspTelemetrySubscription();
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            cl: this.cl,
            pr: this.pr,
            ly: this.ly,
            vl: this.vl,
            ts: this.ts,
            mn: this.mn,
            mx: this.mx,
            nc: this.nc
        };
    }

    setParameters(params = {}) {
        if (params.enabled !== undefined) this.enabled = params.enabled !== false;
        const color = params.cl ?? (params.rb === undefined ? this.cl : (params.rb ? 'Rainbow' : 'Normal'));
        if (MULTI_F0_COLORS.some(option => option.value === color) && color !== this.cl) {
            this.cl = color;
            this.paintHistoryImage();
            this.volumeHistoryDirty = true;
        }
        if (MULTI_F0_RESOLUTIONS.some(option => option.value === params.pr) &&
            params.pr !== this.pr) {
            this.pr = params.pr;
            this.configureHistoryImage();
            this.volumeHistoryDirty = true;
            this.drawGraph();
        }
        if (MULTI_F0_LAYOUTS.includes(params.ly) && params.ly !== this.ly) {
            this.ly = params.ly;
            this.drawGraph();
        }
        if (params.vl !== undefined && (params.vl === true) !== this.vl) {
            this.vl = params.vl === true;
            this.volumeHistoryDirty = true;
            this.drawGraph();
        }
        if (params.ts !== undefined) {
            const nextTimeSpan = this.parseFiniteNumber(params.ts, 1, 10, this.ts);
            if (nextTimeSpan !== this.ts) {
                this.ts = nextTimeSpan;
                this.columnPeriod = this.ts / MULTI_F0_HISTORY_WIDTH;
                this.clearHistory();
            }
        }
        const previousMinMidi = this.mn;
        const previousMaxMidi = this.mx;
        if (params.mn !== undefined) {
            this.mn = Math.round(this.parseFiniteNumber(
                params.mn, MULTI_F0_FIRST_MIDI, MULTI_F0_LAST_MIDI, this.mn
            ));
            if (this.mn > this.mx) this.mx = this.mn;
        }
        if (params.mx !== undefined) {
            this.mx = Math.round(this.parseFiniteNumber(
                params.mx, MULTI_F0_FIRST_MIDI, MULTI_F0_LAST_MIDI, this.mx
            ));
            if (this.mx < this.mn) this.mn = this.mx;
        }
        if (params.nc !== undefined) {
            this.nc = Math.round(this.parseFiniteNumber(params.nc, 1, 16, this.nc));
        }
        if (this.mn !== previousMinMidi || this.mx !== previousMaxMidi) {
            this.volumeHistoryDirty = true;
            this.drawGraph();
        }
        this.updateParameters();
    }

    _setupMessageHandler() {
        const previousWorkletNode = this._messageHandlerWorkletNode;
        super._setupMessageHandler();
        if (this.history && this._messageHandlerWorkletNode !== previousWorkletNode) {
            this.beginTelemetryEpoch();
        }
        this.ensureDspTelemetrySubscription();
    }

    onMessage(message) {
        this.ensureDspTelemetrySubscription();
        super.onMessage(message);
    }

    ensureDspTelemetrySubscription() {
        const hub = window.dspTelemetryHub;
        const tapId = this.id;
        const validTapId = Number.isInteger(tapId) && tapId >= 0 && tapId <= 0xffffffff;
        const validHub = hub && typeof hub.subscribe === 'function';

        if (!validTapId || !validHub) {
            if (this._dspTelemetryUnsubscribe &&
                (hub !== this._dspTelemetryHub || tapId !== this._dspTelemetryTapId)) {
                this.disposeDspTelemetrySubscription();
            }
            return false;
        }
        if (this._dspTelemetryUnsubscribe &&
            hub === this._dspTelemetryHub && tapId === this._dspTelemetryTapId) {
            return true;
        }

        this.disposeDspTelemetrySubscription();
        try {
            const unsubscribe = hub.subscribe(
                tapId,
                MULTI_F0_TAP_FRAME,
                this._boundTelemetry
            );
            if (typeof unsubscribe !== 'function') {
                hub.unsubscribe?.(tapId, MULTI_F0_TAP_FRAME, this._boundTelemetry);
                return false;
            }
            this._dspTelemetryHub = hub;
            this._dspTelemetryTapId = tapId;
            this._dspTelemetryUnsubscribe = unsubscribe;
            return true;
        } catch (error) {
            return false;
        }
    }

    disposeDspTelemetrySubscription() {
        const unsubscribe = this._dspTelemetryUnsubscribe;
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        if (!unsubscribe) return;
        try {
            unsubscribe();
        } catch (error) {
            // Ignore stale telemetry subscription cleanup failures.
        }
    }

    parseTelemetryFrame(frame) {
        if (frame?.frameType !== MULTI_F0_TAP_FRAME ||
            frame.formatVersion !== MULTI_F0_TELEMETRY_VERSION) {
            return null;
        }
        const payload = frame.payload;
        if (!payload || typeof payload.getFloat32 !== 'function' ||
            typeof payload.getUint16 !== 'function' ||
            typeof payload.getUint32 !== 'function' ||
            payload.byteLength !== MULTI_F0_PAYLOAD_BYTES) {
            return null;
        }

        const sampleRate = payload.getFloat32(0, true);
        const timeSeconds = payload.getFloat32(4, true);
        const pitchCount = payload.getUint16(8, true);
        const firstMidi = payload.getUint16(10, true);
        const hopSeconds = payload.getFloat32(12, true);
        const frameIndex = payload.getUint32(16, true);
        const modeCode = payload.getUint32(20, true);
        const generation = payload.getUint32(24, true);
        if (!Number.isFinite(sampleRate) || sampleRate <= 0 ||
            !Number.isFinite(timeSeconds) || timeSeconds < 0 ||
            pitchCount !== MULTI_F0_PITCH_COUNT || firstMidi !== MULTI_F0_FIRST_MIDI ||
            !Number.isFinite(hopSeconds) || hopSeconds <= 0 ||
            modeCode !== MULTI_F0_FINE_DIVISIONS || generation === 0) {
            return null;
        }

        const levels = new Float32Array(MULTI_F0_PITCH_COUNT);
        const volumeLevels = new Float32Array(MULTI_F0_PITCH_COUNT);
        for (let pitch = 0; pitch < MULTI_F0_PITCH_COUNT; pitch++) {
            const level = payload.getFloat32(MULTI_F0_PAYLOAD_HEADER_BYTES + pitch * 4, true);
            if (!Number.isFinite(level) ||
                level < 0 || level > 1) {
                return null;
            }
            levels[pitch] = level;
            const volumeLevel = payload.getFloat32(MULTI_F0_LEVEL_OFFSET + pitch * 4, true);
            if (!Number.isFinite(volumeLevel)) return null;
            volumeLevels[pitch] = volumeLevel;
        }
        return {
            sampleRate,
            timeSeconds,
            hopSeconds,
            frameIndex,
            modeCode,
            generation,
            levels,
            volumeLevels
        };
    }

    beginTelemetryEpoch() {
        const audioTime = window.audioContext?.currentTime;
        this.modeTimeFence = Number.isFinite(audioTime) && audioTime >= 0
            ? Math.fround(audioTime)
            : this.lastObservedTimeSeconds;
        if (this.activeGeneration !== null) {
            this.generationFence = this.activeGeneration;
        }
        this.activeGeneration = null;
        this.clearHistory();
    }

    clearHistory() {
        this.history?.fill(0);
        this.levelHistory?.fill(0);
        this.writeColumn = 0;
        this.columnPhase = 0;
        this.scrollTime = null;
        this.scrollWallTime = null;
        this.scrollAnchorPending = true;
        this.latestHopSeconds = 0;
        this.latestFrameTimeSeconds = null;
        this.lastFrameIndex = null;
        this.levelReference = MULTI_F0_LEVEL_FLOOR;
        this.levelReferenceHold = 0;
        this.meterCurrent?.fill(MULTI_F0_LEVEL_FLOOR);
        this.volumeHistoryDirty = true;
        this.paintHistoryImage();
    }

    updateScrollTime(timeSeconds) {
        // Keep the render clock continuous across telemetry deliveries. Resetting
        // it for every frame makes delayed or batched analysis visibly stutter.
        if (this.scrollWallTime === null || this.scrollAnchorPending) {
            this.scrollTime = timeSeconds;
            if (!this.scrollPaused) this.scrollWallTime = performance.now();
        }
    }

    getDisplayTime(now = performance.now()) {
        if (this.scrollTime === null || this.scrollWallTime === null) return this.scrollTime;
        const predictedTime = this.scrollTime + Math.max(0, now - this.scrollWallTime) / 1000;
        // Follow the Spectrogram clock: stay between the newest measurement and
        // the next expected hop while rendering continuously between them.
        const displayTime = Math.max(
            this.latestFrameTimeSeconds,
            Math.min(this.latestFrameTimeSeconds + this.latestHopSeconds, predictedTime)
        );
        if (displayTime !== predictedTime) {
            this.scrollTime = displayTime;
            this.scrollWallTime = now;
        }
        return displayTime;
    }

    _scrollPhase(now = performance.now()) {
        const displayTime = this.getDisplayTime(now);
        if (displayTime === null || this.latestFrameTimeSeconds === null) return this.columnPhase;
        return this.columnPhase +
            (displayTime - this.latestFrameTimeSeconds) / this.columnPeriod;
    }

    _displayPalette() {
        const colors = ['graph-bg-deep', 'graph-base-soft', 'graph-trace'].map(name =>
            (window.ThemePalette?.get(name) ?? '').match(/[\d.]+/g)?.slice(0, 3).map(Number));
        if (colors.some(color => !color || color.length !== 3)) return null;
        const [background, soft, trace] = colors;
        const light = background.every(channel => channel > 127);
        return {
            trace,
            whiteKey: light ? 255 : 221,
            whiteBand: background,
            blackBand: light ? soft : background.map(channel => channel + MULTI_F0_BLACK_KEY_BACKGROUND)
        };
    }

    _writePixels(column, palette = this._displayPalette()) {
        if (!this.imageData || !this.history || !palette) return;
        const pixels = this.imageData.data;
        const historyOffset = column * MULTI_F0_PITCH_COUNT;
        const displayPitchCount = this.pr === 'High'
            ? MULTI_F0_PITCH_COUNT
            : MULTI_F0_NOTE_COUNT;
        for (let pitch = 0; pitch < displayPitchCount; pitch++) {
            const row = displayPitchCount - 1 - pitch;
            const pixelOffset = (row * MULTI_F0_HISTORY_WIDTH + column) * 4;
            const notePitch = this.pr === 'High'
                ? Math.floor(pitch / MULTI_F0_FINE_DIVISIONS)
                : pitch;
            const pitchClass = (MULTI_F0_FIRST_MIDI + notePitch) % 12;
            const background = MULTI_F0_BLACK_KEY_CLASSES.has(pitchClass)
                ? palette.blackBand
                : palette.whiteBand;
            const value = this.pr === 'High'
                ? this.history[historyOffset + pitch]
                : this._bagConfidence(historyOffset, MULTI_F0_FIRST_MIDI + pitch);
            const color = this.cl === 'Rainbow'
                ? (this.pr === 'High'
                    ? multiF0InterpolatedNoteColor(pitch)
                    : MULTI_F0_NOTE_COLORS[pitchClass])
                : palette.trace;
            pixels[pixelOffset] = Math.round(background[0] + (color[0] - background[0]) * value);
            pixels[pixelOffset + 1] = Math.round(background[1] + (color[1] - background[1]) * value);
            pixels[pixelOffset + 2] = Math.round(background[2] + (color[2] - background[2]) * value);
            pixels[pixelOffset + 3] = 255;
        }
    }

    paintHistoryImage() {
        if (!this.imageData || !this.tempCtx) return;
        const palette = this._displayPalette();
        for (let column = 0; column < MULTI_F0_HISTORY_WIDTH; column++) {
            this._writePixels(column, palette);
        }
        this.tempCtx.putImageData(this.imageData, 0, 0);
    }

    paintColumns(startColumn, count) {
        if (!this.imageData || !this.tempCtx) return;
        const palette = this._displayPalette();
        for (let offset = 0; offset < count; offset++) {
            this._writePixels((startColumn + offset) % MULTI_F0_HISTORY_WIDTH, palette);
        }
        const firstCount = Math.min(count, MULTI_F0_HISTORY_WIDTH - startColumn);
        this.tempCtx.putImageData(
            this.imageData,
            0,
            0,
            startColumn,
            0,
            firstCount,
            this.imageData.data.length / (MULTI_F0_HISTORY_WIDTH * 4)
        );
        if (count > firstCount) {
            this.tempCtx.putImageData(
                this.imageData,
                0,
                0,
                0,
                0,
                count - firstCount,
                this.imageData.data.length / (MULTI_F0_HISTORY_WIDTH * 4)
            );
        }
    }

    _normalizedLevel(level) {
        const upper = this.levelReference > MULTI_F0_LEVEL_CEILING_DB
            ? this.levelReference
            : MULTI_F0_LEVEL_CEILING_DB;
        const normalized = (level - (upper - MULTI_F0_LEVEL_RANGE_DB)) /
            MULTI_F0_LEVEL_RANGE_DB;
        return normalized < 0 ? 0 : (normalized > 1 ? 1 : normalized);
    }

    _updateVolumeState(snapshot, elapsed) {
        let framePeak = MULTI_F0_LEVEL_FLOOR;
        for (let pitch = 0; pitch < MULTI_F0_PITCH_COUNT; pitch++) {
            if (snapshot.levels[pitch] >= 0.5 && snapshot.volumeLevels[pitch] > framePeak) {
                framePeak = snapshot.volumeLevels[pitch];
            }
        }
        if (framePeak >= this.levelReference) {
            this.levelReference = framePeak;
            this.levelReferenceHold = MULTI_F0_RANGE_HOLD_SECONDS;
        } else {
            const decayTime = elapsed > this.levelReferenceHold
                ? elapsed - this.levelReferenceHold
                : 0;
            this.levelReferenceHold = elapsed < this.levelReferenceHold
                ? this.levelReferenceHold - elapsed
                : 0;
            const released = this.levelReference -
                MULTI_F0_METER_RELEASE_DB_PER_SECOND * decayTime;
            this.levelReference = framePeak > released ? framePeak : released;
        }
        for (let note = 0; note < MULTI_F0_NOTE_COUNT; note++) {
            const first = note * MULTI_F0_FINE_DIVISIONS;
            let best = first;
            for (let division = 1; division < MULTI_F0_FINE_DIVISIONS; division++) {
                const pitch = first + division;
                if (snapshot.levels[pitch] > snapshot.levels[best]) best = pitch;
            }
            const input = snapshot.levels[best] >= 0.5
                ? snapshot.volumeLevels[best]
                : MULTI_F0_LEVEL_FLOOR;
            const released = this.meterCurrent[note] -
                MULTI_F0_METER_RELEASE_DB_PER_SECOND * elapsed;
            this.meterCurrent[note] = input > released ? input : released;
        }
        for (let pitch = 0; pitch < MULTI_F0_PITCH_COUNT; pitch++) {
            this.levelIntensity[pitch] = this._normalizedLevel(snapshot.volumeLevels[pitch]);
        }
    }

    handleTelemetry(frame) {
        if (!frame || !this.enabled || !this._sectionEnabled) {
            this.scrollTime = this.getDisplayTime();
            this.scrollWallTime = null;
            this.scrollAnchorPending = true;
            this.lastFrameIndex = null;
            return;
        }
        const snapshot = this.parseTelemetryFrame(frame);
        if (!snapshot || !this.history || !this.intensity) return;

        if (this.activeGeneration === null) {
            const afterTimeFence = this.modeTimeFence === null ||
                snapshot.timeSeconds > this.modeTimeFence;
            const afterGenerationFence = this.generationFence !== null &&
                isNewerMultiF0Counter(snapshot.generation, this.generationFence);
            if (!afterTimeFence && !afterGenerationFence) return;
            this.activeGeneration = snapshot.generation;
            this.generationFence = null;
            this.modeTimeFence = null;
            this.lastFrameIndex = null;
        } else if (snapshot.generation !== this.activeGeneration) {
            if (!isNewerMultiF0Counter(snapshot.generation, this.activeGeneration)) return;
            this.clearHistory();
            this.activeGeneration = snapshot.generation;
        }
        this.lastObservedTimeSeconds = snapshot.timeSeconds;

        let advance;
        let delta = 0;
        if (this.lastFrameIndex === null) {
            advance = 1;
            this.columnPhase = 0;
        } else {
            delta = (snapshot.frameIndex - this.lastFrameIndex) >>> 0;
            if (delta === 0 || delta >= 0x80000000) return;
            this.columnPhase += delta * snapshot.hopSeconds / this.columnPeriod;
            advance = Math.floor(this.columnPhase);
            this.columnPhase -= advance;
        }

        if (advance >= MULTI_F0_HISTORY_WIDTH) {
            this.clearHistory();
            advance = 1;
        }

        this.intensity.set(snapshot.levels);
        this._updateVolumeState(snapshot, (this.lastFrameIndex === null ? 1 : delta) *
            snapshot.hopSeconds);

        if (advance === 0) {
            const column = (this.writeColumn + MULTI_F0_HISTORY_WIDTH - 1) %
                MULTI_F0_HISTORY_WIDTH;
            const historyOffset = column * MULTI_F0_PITCH_COUNT;
            for (let pitch = 0; pitch < MULTI_F0_PITCH_COUNT; pitch++) {
                if (this.intensity[pitch] > this.history[historyOffset + pitch]) {
                    this.history[historyOffset + pitch] = this.intensity[pitch];
                }
                if (this.levelIntensity[pitch] > this.levelHistory[historyOffset + pitch]) {
                    this.levelHistory[historyOffset + pitch] = this.levelIntensity[pitch];
                }
            }
            this.paintColumns(column, 1);
            this._paintVolumeColumns(column, 1);
        } else {
            const startColumn = this.writeColumn;
            for (let offset = 0; offset < advance - 1; offset++) {
                const destination = (startColumn + offset) % MULTI_F0_HISTORY_WIDTH;
                if (delta === 1) {
                    const source = (destination + MULTI_F0_HISTORY_WIDTH - 1) %
                        MULTI_F0_HISTORY_WIDTH;
                    this.history.copyWithin(
                        destination * MULTI_F0_PITCH_COUNT,
                        source * MULTI_F0_PITCH_COUNT,
                        (source + 1) * MULTI_F0_PITCH_COUNT
                    );
                    this.levelHistory.copyWithin(
                        destination * MULTI_F0_PITCH_COUNT,
                        source * MULTI_F0_PITCH_COUNT,
                        (source + 1) * MULTI_F0_PITCH_COUNT
                    );
                } else {
                    this.history.fill(
                        0,
                        destination * MULTI_F0_PITCH_COUNT,
                        (destination + 1) * MULTI_F0_PITCH_COUNT
                    );
                    this.levelHistory.fill(
                        0,
                        destination * MULTI_F0_PITCH_COUNT,
                        (destination + 1) * MULTI_F0_PITCH_COUNT
                    );
                }
            }
            const latestColumn = (startColumn + advance - 1) % MULTI_F0_HISTORY_WIDTH;
            this.history.set(this.intensity, latestColumn * MULTI_F0_PITCH_COUNT);
            this.levelHistory.set(this.levelIntensity, latestColumn * MULTI_F0_PITCH_COUNT);
            this.writeColumn = (startColumn + advance) % MULTI_F0_HISTORY_WIDTH;
            this.paintColumns(startColumn, advance);
            this._paintVolumeColumns(startColumn, advance);
        }
        this.lastFrameIndex = snapshot.frameIndex;
        this.latestHopSeconds = snapshot.hopSeconds;
        this.latestFrameTimeSeconds = snapshot.timeSeconds;
        this.updateScrollTime(snapshot.timeSeconds);
    }

    createNoteRangeControl(label, value, setter, modelKey) {
        const row = document.createElement('div');
        row.className = 'parameter-row';

        const paramName = label.toLowerCase().replace(/\s+/g, '-');
        const sliderId = `${this.id}-${this.name}-${paramName}-slider`;
        const valueId = `${this.id}-${this.name}-${paramName}-value`;

        const labelEl = document.createElement('label');
        labelEl.textContent = `${label}:`;
        labelEl.htmlFor = sliderId;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = sliderId;
        slider.name = sliderId;
        slider.min = MULTI_F0_FIRST_MIDI;
        slider.max = MULTI_F0_LAST_MIDI;
        slider.step = 1;
        slider.value = value;
        slider.autocomplete = 'off';

        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.id = valueId;
        valueInput.name = valueId;
        valueInput.readOnly = true;
        valueInput.value = multiF0NoteName(value);
        valueInput.autocomplete = 'off';
        valueInput.style.flexGrow = '0';
        valueInput.style.width = '80px';
        valueInput.style.boxSizing = 'border-box';

        slider.addEventListener('input', event => {
            const nextValue = Number(event.target.value);
            if (!Number.isFinite(nextValue)) return;
            setter(nextValue);
            valueInput.value = multiF0NoteName(this[modelKey]);
        });

        this._registerUIControl(modelKey, [slider], modelValue => {
            const midi = Math.round(Number(modelValue));
            if (!Number.isFinite(midi)) return;
            slider.value = midi;
            window.uiManager?.refreshRangeFillStyling?.(slider);
            valueInput.value = multiF0NoteName(midi);
        });

        row.appendChild(labelEl);
        row.appendChild(slider);
        row.appendChild(valueInput);
        return row;
    }

    createUI() {
        this.ensureDspTelemetrySubscription();
        this.observer?.disconnect();
        this.resizeGraphDisposer?.();
        this.resizeGraphDisposer = null;
        this.volumeHistoryDirty = true;

        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';
        const colorRow = this.createRadioGroup(
            'Color', MULTI_F0_COLORS, this.cl,
            value => this.setParameters({ cl: value }), 'cl'
        );
        const resolutionRow = this.createRadioGroup(
            'Pitch Resolution', MULTI_F0_RESOLUTIONS, this.pr,
            value => this.setParameters({ pr: value }), 'pr'
        );
        const layoutRow = this.createRadioGroup(
            'Layout', MULTI_F0_LAYOUTS, this.ly,
            value => this.setParameters({ ly: value }), 'ly'
        );
        const volumeRow = this.createCheckboxControl(
            'Volume', this.vl, value => this.setParameters({ vl: value }), 'vl'
        );
        const timeSpanRow = this.createParameterControl(
            'Time Span', 1, 10, 1, this.ts,
            value => this.setParameters({ ts: value }), 's', 'ts'
        );
        const regularCandidatesRow = this.createParameterControl(
            'Regular Note Limit', 1, 16, 1, this.nc,
            value => this.setParameters({ nc: value }), 'notes', 'nc'
        );
        const minNoteRow = this.createNoteRangeControl(
            'Lowest Note', this.mn,
            value => {
                this.setParameters({ mn: value });
                this.syncUIControls?.();
            }, 'mn'
        );
        const maxNoteRow = this.createNoteRangeControl(
            'Highest Note', this.mx,
            value => {
                this.setParameters({ mx: value });
                this.syncUIControls?.();
            }, 'mx'
        );
        container.appendChild(colorRow);
        container.appendChild(resolutionRow);
        container.appendChild(layoutRow);
        container.appendChild(volumeRow);
        container.appendChild(timeSpanRow);
        container.appendChild(regularCandidatesRow);
        container.appendChild(minNoteRow);
        container.appendChild(maxNoteRow);

        const graph = this.createResponsiveGraph({
            maxWidth: 1024,
            aspectRatio: '32 / 15',
            mobileAspectRatio: '4 / 3',
            onResize: ({ canvas, cssWidth, dpr }) => {
                this.canvas = canvas;
                this.graphCssWidth = cssWidth;
                this.graphDpr = dpr;
                this.canvasCtx = canvas.getContext('2d', { alpha: false });
                this.drawGraph();
            }
        });
        this.canvas = graph.canvas;
        this.resizeGraphDisposer = graph.dispose;
        this.canvasCtx = this.canvas.getContext('2d', { alpha: false });
        this.canvas.setAttribute('aria-label', 'Multi-pitch piano roll');

        this.tempCanvas = document.createElement('canvas');
        this.tempCanvas.width = MULTI_F0_HISTORY_WIDTH;
        this.configureHistoryImage();

        container.appendChild(graph.container);
        if (typeof IntersectionObserver === 'function') {
            this.observer = new IntersectionObserver(this.handleIntersect.bind(this));
            this.observer.observe(this.canvas);
        } else {
            this.drawGraph();
        }
        return container;
    }

    handleIntersect(entries) {
        entries.forEach(entry => {
            this.isVisible = entry.isIntersecting;
            if (this.isVisible) {
                if (this.canRunAnimation()) this.startAnimation();
                else this.renderPowerUiOnce(() => this.drawGraph());
            } else {
                this.stopAnimation();
            }
        });
    }

    startAnimation() {
        if (this.animationFrameId !== null || !this.enabled || !this._sectionEnabled) return;
        this.scrollPaused = false;
        if (this.scrollWallTime === null && this.scrollTime !== null) {
            this.scrollWallTime = performance.now();
        }
        const animate = now => {
            if (!this.isVisible) {
                this.stopAnimation();
                return;
            }
            this.drawGraph(now);
            this.animationFrameId = this.requestPowerAnimationFrame(animate, 'analyzer');
        };
        animate();
    }

    stopAnimation() {
        this.scrollTime = this.getDisplayTime();
        this.scrollWallTime = null;
        this.scrollPaused = true;
        this.scrollAnchorPending = true;
        if (this.animationFrameId === null) return;
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
    }

    _bagConfidence(historyOffset, midi) {
        const first = (midi - MULTI_F0_FIRST_MIDI) * MULTI_F0_FINE_DIVISIONS;
        let confidence = 0;
        for (let division = 0; division < MULTI_F0_FINE_DIVISIONS; division++) {
            const value = this.history[historyOffset + first + division];
            if (value > confidence) confidence = value;
        }
        return confidence;
    }

    _bestBagPitch(historyOffset, midi) {
        const first = (midi - MULTI_F0_FIRST_MIDI) * MULTI_F0_FINE_DIVISIONS;
        let best = first;
        for (let division = 1; division < MULTI_F0_FINE_DIVISIONS; division++) {
            const pitch = first + division;
            if (this.history[historyOffset + pitch] > this.history[historyOffset + best]) {
                best = pitch;
            }
        }
        return best;
    }

    _volumeBarsForColumn(historyOffset) {
        const bars = [];
        for (let midi = this.mn; midi <= this.mx; midi++) {
            const best = this._bestBagPitch(historyOffset, midi);
            const confidence = this.history[historyOffset + best];
            if (confidence > 0) bars.push({ midi, best, confidence });
        }
        bars.sort((a, b) => a.confidence - b.confidence || a.midi - b.midi);
        return bars;
    }

    _paintVolumeBar(context, column, historyOffset, bar, rowHeight, palette) {
        const { midi, best, confidence } = bar;
        const pitchClass = midi % 12;
        const background = MULTI_F0_BLACK_KEY_CLASSES.has(pitchClass)
            ? palette.blackBand
            : palette.whiteBand;
        const color = this.cl === 'Rainbow'
            ? multiF0InterpolatedNoteColor(best)
            : palette.trace;
        const red = Math.round(background[0] + (color[0] - background[0]) * confidence);
        const green = Math.round(background[1] + (color[1] - background[1]) * confidence);
        const blue = Math.round(background[2] + (color[2] - background[2]) * confidence);
        const normalized = this.levelHistory[historyOffset + best];
        const nominalMinimum = rowHeight / MULTI_F0_FINE_DIVISIONS;
        const minimum = nominalMinimum > 1 ? nominalMinimum : 1;
        const nominalMaximum = rowHeight - 1;
        const maximum = nominalMaximum > minimum ? nominalMaximum : minimum;
        const thickness = minimum + (maximum - minimum) * normalized;
        const rowTop = (this.mx - midi) * rowHeight;
        const division = best % MULTI_F0_FINE_DIVISIONS;
        const center = this.pr === 'High'
            ? rowTop + (MULTI_F0_FINE_DIVISIONS - 1 - division + 0.5) *
                rowHeight / MULTI_F0_FINE_DIVISIONS
            : rowTop + rowHeight / 2;
        const fade = rowHeight / (MULTI_F0_FINE_DIVISIONS * 2);
        const top = center - thickness / 2;
        const bottom = center + thickness / 2;
        const gradient = context.createLinearGradient(0, top - fade, 0, bottom + fade);
        const opaque = `rgba(${red}, ${green}, ${blue}, 1)`; // theme-allow: RGB channels blend the active theme background and trace colors.
        const transparent = `rgba(${red}, ${green}, ${blue}, 0)`; // theme-allow: RGB channels blend the active theme background and trace colors.
        const fadeRatio = fade / (thickness + 2 * fade);
        gradient.addColorStop(0, transparent);
        gradient.addColorStop(fadeRatio, opaque);
        gradient.addColorStop(1 - fadeRatio, opaque);
        gradient.addColorStop(1, transparent);
        context.fillStyle = gradient;
        context.fillRect(column, top - fade, 1, thickness + 2 * fade);
    }

    _paintVolumeGrid(context, x, width, rowHeight) {
        const lineWidth = this.graphDpr || 1;
        for (let midi = 24; midi <= MULTI_F0_LAST_MIDI; midi++) {
            const isC = midi % 12 === 0;
            if (!isC && midi % 12 !== 5) continue;
            if (midi < this.mn || midi > this.mx) continue;
            const boundaryY = (this.mx - midi + 1) * rowHeight;
            context.fillStyle = isC
                ? (window.ThemePalette?.get('graph-grid-strong') ?? '')
                : (window.ThemePalette?.get('graph-grid-subtle') ?? '');
            context.fillRect(x, boundaryY - lineWidth / 2, width, lineWidth);
        }
    }

    _paintVolumeHistory(height, palette) {
        if (!this.volumeHistoryCanvas) {
            this.volumeHistoryCanvas = document.createElement('canvas');
            this.volumeHistoryCanvas.width = MULTI_F0_HISTORY_WIDTH;
        }
        if (this.volumeHistoryCanvas.height !== height) {
            this.volumeHistoryCanvas.height = height;
            this.volumeHistoryDirty = true;
        }
        if (!this.volumeHistoryDirty) return;
        const context = this.volumeHistoryCanvas.getContext('2d');
        if (!context) return;
        const visiblePitchCount = this.mx - this.mn + 1;
        const rowHeight = height / visiblePitchCount;
        for (let midi = this.mn; midi <= this.mx; midi++) {
            const row = this.mx - midi;
            const background = MULTI_F0_BLACK_KEY_CLASSES.has(midi % 12)
                ? palette.blackBand
                : palette.whiteBand;
            context.fillStyle = `rgb(${background[0]}, ${background[1]}, ${background[2]})`; // theme-allow: RGB channels come from the active theme's keyboard bands.
            context.fillRect(0, row * rowHeight, MULTI_F0_HISTORY_WIDTH, rowHeight);
        }
        this._paintVolumeGrid(context, 0, MULTI_F0_HISTORY_WIDTH, rowHeight);
        for (let column = 0; column < MULTI_F0_HISTORY_WIDTH; column++) {
            const historyOffset = column * MULTI_F0_PITCH_COUNT;
            for (const bar of this._volumeBarsForColumn(historyOffset)) {
                this._paintVolumeBar(context, column, historyOffset, bar, rowHeight, palette);
            }
        }
        this.volumeHistoryDirty = false;
    }

    _paintVolumeColumns(startColumn, count) {
        if (!this.vl || this.volumeHistoryDirty || !this.volumeHistoryCanvas) {
            this.volumeHistoryDirty = true;
            return;
        }
        const context = this.volumeHistoryCanvas.getContext('2d');
        const palette = this._displayPalette();
        if (!context || !palette) {
            this.volumeHistoryDirty = true;
            return;
        }
        const height = this.volumeHistoryCanvas.height;
        const rowHeight = height / (this.mx - this.mn + 1);
        for (let offset = 0; offset < count; offset++) {
            const column = (startColumn + offset) % MULTI_F0_HISTORY_WIDTH;
            const historyOffset = column * MULTI_F0_PITCH_COUNT;
            for (let midi = this.mn; midi <= this.mx; midi++) {
                const pitchClass = midi % 12;
                const background = MULTI_F0_BLACK_KEY_CLASSES.has(pitchClass)
                    ? palette.blackBand
                    : palette.whiteBand;
                const rowTop = (this.mx - midi) * rowHeight;
                context.fillStyle = `rgb(${background[0]}, ${background[1]}, ${background[2]})`; // theme-allow: RGB channels come from the active theme's keyboard bands.
                context.fillRect(column, rowTop, 1, rowHeight);
            }
            this._paintVolumeGrid(context, column, 1, rowHeight);
            for (const bar of this._volumeBarsForColumn(historyOffset)) {
                this._paintVolumeBar(context, column, historyOffset, bar, rowHeight, palette);
            }
        }
    }

    _drawVolumeMeters(context, rollWidth, rowHeight, palette) {
        if (!this.vl) return;
        for (let midi = this.mn; midi <= this.mx; midi++) {
            const note = midi - MULTI_F0_FIRST_MIDI;
            const centerY = (this.mx - midi + 0.5) * rowHeight;
            const color = this.cl === 'Rainbow'
                ? MULTI_F0_NOTE_COLORS[midi % 12]
                : palette.trace;
            const currentRadius = rowHeight * this._normalizedLevel(this.meterCurrent[note]);
            if (currentRadius > 0) {
                const gradient = context.createRadialGradient(
                    rollWidth, centerY, 0, rollWidth, centerY, currentRadius
                );
                const visible = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.5)`; // theme-allow: RGB channels use the active theme trace or fixed note colormap.
                const transparent = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0)`; // theme-allow: RGB channels use the active theme trace or fixed note colormap.
                gradient.addColorStop(0, visible);
                gradient.addColorStop(0.75, visible);
                gradient.addColorStop(1, transparent);
                context.fillStyle = gradient;
                context.beginPath();
                context.moveTo(rollWidth, centerY + currentRadius);
                context.arc(rollWidth, centerY, currentRadius, Math.PI / 2, Math.PI * 1.5);
                context.closePath();
                context.fill();
            }
        }
    }

    configureHistoryImage() {
        if (!this.tempCanvas) return;
        const displayPitchCount = this.pr === 'High'
            ? MULTI_F0_PITCH_COUNT
            : MULTI_F0_NOTE_COUNT;
        this.tempCanvas.height = displayPitchCount;
        this.tempCtx = this.tempCanvas.getContext('2d');
        this.imageData = this.tempCtx?.createImageData(
            MULTI_F0_HISTORY_WIDTH,
            displayPitchCount
        ) || null;
        this.paintHistoryImage();
    }

    drawGraph(now = performance.now()) {
        if (!this.canvasCtx || !this.imageData || !this.tempCtx || !this.tempCanvas ||
            !this.canvas) {
            return;
        }
        const palette = this._displayPalette();
        if (!palette) return;
        const context = this.canvasCtx;
        const horizontal = this.ly === 'Horizontal';
        const width = horizontal ? this.canvas.height : this.canvas.width;
        const height = horizontal ? this.canvas.width : this.canvas.height;
        const dpr = this.graphDpr || 1;
        const gutter = MULTI_F0_HORIZONTAL_KEY_GUTTER_CSS_PX * dpr;
        const blackKeyDepth = MULTI_F0_KEY_GUTTER_CSS_PX * dpr;
        const rollWidth = width - gutter;
        const visiblePitchCount = this.mx - this.mn + 1;
        const displayDivisions = this.pr === 'High' ? MULTI_F0_FINE_DIVISIONS : 1;
        const visibleDisplayPitchCount = visiblePitchCount * displayDivisions;
        const sourceY = (MULTI_F0_LAST_MIDI - this.mx) * displayDivisions;

        context.fillStyle = (window.ThemePalette?.get('graph-bg-deep') ?? '');
        context.fillRect(0, 0, this.canvas.width, this.canvas.height);
        if (rollWidth <= 0 || height <= 0) return;

        const scrollPhase = this._scrollPhase(now);
        this.scrollAnchorPending = false;
        const columnWidth = rollWidth / MULTI_F0_HISTORY_WIDTH;
        const phaseOffset = scrollPhase * columnWidth;
        const split = this.writeColumn;
        const latestColumn = (split + MULTI_F0_HISTORY_WIDTH - 1) %
            MULTI_F0_HISTORY_WIDTH;
        const firstCount = MULTI_F0_HISTORY_WIDTH - split - (split === 0 ? 1 : 0);
        const secondCount = split === 0 ? 0 : split - 1;
        const historyDestinationX = -phaseOffset;
        // Scale pitch rows without interpolation first. Horizontal smoothing of
        // a cropped source row would otherwise sample its neighboring pitches.
        if (!this.scaledHistoryCanvas) {
            this.scaledHistoryCanvas = document.createElement('canvas');
            this.scaledHistoryCanvas.width = MULTI_F0_HISTORY_WIDTH;
        }
        if (this.scaledHistoryCanvas.height !== height) this.scaledHistoryCanvas.height = height;
        const scaledContext = this.scaledHistoryCanvas.getContext('2d');
        if (!scaledContext) return;
        if (horizontal) {
            context.save();
            context.translate(this.canvas.width, 0);
            context.rotate(Math.PI / 2);
        }
        scaledContext.imageSmoothingEnabled = false;
        if (this.vl) {
            this._paintVolumeHistory(height, palette);
            scaledContext.drawImage(this.volumeHistoryCanvas, 0, 0);
        } else {
            scaledContext.drawImage(
                this.tempCanvas,
                0,
                sourceY,
                MULTI_F0_HISTORY_WIDTH,
                visibleDisplayPitchCount,
                0,
                0,
                MULTI_F0_HISTORY_WIDTH,
                height
            );
        }
        context.imageSmoothingEnabled = true;
        if (firstCount > 0) {
            context.drawImage(this.scaledHistoryCanvas, split, 0, firstCount, height,
                historyDestinationX, 0, firstCount * columnWidth, height);
        }
        if (secondCount > 0) {
            context.drawImage(this.scaledHistoryCanvas, 0, 0, secondCount, height,
                historyDestinationX + firstCount * columnWidth, 0,
                secondCount * columnWidth, height);
        }
        context.imageSmoothingEnabled = false;
        if (this.vl) {
            context.drawImage(
                this.volumeHistoryCanvas,
                latestColumn,
                0,
                1,
                height,
                rollWidth - (1 + scrollPhase) * columnWidth,
                0,
                (1 + scrollPhase) * columnWidth,
                height
            );
        } else {
            context.drawImage(
                this.tempCanvas,
                latestColumn,
                sourceY,
                1,
                visibleDisplayPitchCount,
                rollWidth - (1 + scrollPhase) * columnWidth,
                0,
                (1 + scrollPhase) * columnWidth,
                height
            );
        }

        const rowHeight = height / visiblePitchCount;
        const latestOffset = ((this.writeColumn + MULTI_F0_HISTORY_WIDTH - 1) %
            MULTI_F0_HISTORY_WIDTH) * MULTI_F0_PITCH_COUNT;
        context.lineWidth = dpr;
        const whiteKeyHeight = 12 * rowHeight / 7;
        for (const midi of MULTI_F0_WHITE_KEY_MIDIS) {
            const pitchClass = midi % 12;
            const whiteIndex = MULTI_F0_WHITE_KEY_CLASSES.indexOf(pitchClass);
            const octaveC = midi - pitchClass;
            const cBoundary = (octaveC - this.mn) * rowHeight;
            const center = cBoundary + (whiteIndex + 0.5) * whiteKeyHeight;
            const start = center - whiteKeyHeight / 2;
            const end = center + whiteKeyHeight / 2;
            const clippedStart = start < 0 ? 0 : start;
            const clippedEnd = end > height ? height : end;
            if (clippedStart >= clippedEnd) continue;
            const confidence = this._bagConfidence(latestOffset, midi);
            const color = this.cl === 'Rainbow'
                ? MULTI_F0_NOTE_COLORS[pitchClass]
                : palette.trace;
            const red = Math.round(palette.whiteKey + (color[0] - palette.whiteKey) * confidence);
            const green = Math.round(palette.whiteKey + (color[1] - palette.whiteKey) * confidence);
            const blue = Math.round(palette.whiteKey + (color[2] - palette.whiteKey) * confidence);
            context.fillStyle = `rgb(${red}, ${green}, ${blue})`; // theme-allow: Fixed signal-level or self-painted colormap color.
            context.fillRect(
                rollWidth,
                height - clippedEnd,
                gutter,
                clippedEnd - clippedStart
            );
        }
        context.strokeStyle = (window.ThemePalette?.get('graph-label') ?? '');
        for (const midi of MULTI_F0_WHITE_KEY_MIDIS) {
            const pitchClass = midi % 12;
            const whiteIndex = MULTI_F0_WHITE_KEY_CLASSES.indexOf(pitchClass);
            const octaveC = midi - pitchClass;
            const cBoundary = (octaveC - this.mn) * rowHeight;
            const boundary = cBoundary + whiteIndex * whiteKeyHeight;
            if (boundary <= 0 || boundary >= height) continue;
            const y = height - boundary;
            context.beginPath();
            context.moveTo(rollWidth, y);
            context.lineTo(width, y);
            context.stroke();
        }
        for (let midi = this.mn; midi <= this.mx; midi++) {
            const pitchClass = midi % 12;
            if (!MULTI_F0_BLACK_KEY_CLASSES.has(pitchClass)) continue;
            const row = this.mx - midi;
            const confidence = this._bagConfidence(latestOffset, midi);
            const color = this.cl === 'Rainbow'
                ? MULTI_F0_NOTE_COLORS[pitchClass]
                : palette.trace;
            const red = Math.round(34 + (color[0] - 34) * confidence);
            const green = Math.round(34 + (color[1] - 34) * confidence);
            const blue = Math.round(34 + (color[2] - 34) * confidence);
            context.fillStyle = `rgb(${red}, ${green}, ${blue})`; // theme-allow: Fixed signal-level or self-painted colormap color.
            context.fillRect(rollWidth, row * rowHeight, blackKeyDepth, rowHeight);
        }
        this._drawVolumeMeters(context, rollWidth, rowHeight, palette);
        context.beginPath();
        context.moveTo(rollWidth, 0);
        context.lineTo(rollWidth, height);
        context.stroke();

        context.fillStyle = '#111'; // theme-allow: Fixed signal-level or self-painted colormap color.
        context.font = `${7 * dpr}px Arial`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        for (let midi = 24; midi <= MULTI_F0_LAST_MIDI; midi++) {
            const isC = midi % 12 === 0;
            if (!isC && midi % 12 !== 5) continue;
            if (midi < this.mn || midi > this.mx) continue;
            const row = this.mx - midi;
            const boundaryY = (row + 1) * rowHeight;
            if (!this.vl) {
                context.strokeStyle = isC ? (window.ThemePalette?.get('graph-grid-strong') ?? '') : (window.ThemePalette?.get('graph-grid-subtle') ?? '');
                context.beginPath();
                context.moveTo(0, boundaryY);
                context.lineTo(horizontal ? rollWidth : width, boundaryY);
                context.stroke();
            }
            const octave = midi / 12 - 1;
            if (isC && (!horizontal || octave <= 7)) {
                const label = `C${octave}`;
                const x = rollWidth + blackKeyDepth + (gutter - blackKeyDepth) / 2;
                const y = height - ((midi - this.mn) * rowHeight +
                    0.5 * 12 * rowHeight / 7);
                if (horizontal) {
                    const metrics = context.measureText(label);
                    const labelCenterX = this.canvas.width - y;
                    const leftExtent = Number.isFinite(metrics.actualBoundingBoxLeft)
                        ? metrics.actualBoundingBoxLeft
                        : metrics.width / 2;
                    const rightExtent = Number.isFinite(metrics.actualBoundingBoxRight)
                        ? metrics.actualBoundingBoxRight
                        : metrics.width / 2;
                    if (labelCenterX - leftExtent < 0 ||
                        labelCenterX + rightExtent > this.canvas.width) {
                        continue;
                    }
                    context.save();
                    context.translate(width - 2 * dpr, y);
                    context.rotate(-Math.PI / 2);
                    context.textBaseline = 'bottom';
                    context.fillText(label, 0, 0);
                    context.restore();
                } else {
                    const metrics = context.measureText(label);
                    const ascent = metrics.actualBoundingBoxAscent;
                    const descent = metrics.actualBoundingBoxDescent;
                    const visualCenterOffset = Number.isFinite(ascent) && Number.isFinite(descent)
                        ? (ascent - descent) / 2
                        : 0;
                    context.fillText(label, x, y + visualCenterOffset);
                }
            }
        }
        if (horizontal) context.restore();
    }

    cleanup() {
        this.stopAnimation();
        this.disposeDspTelemetrySubscription();
        if (this.observer) {
            if (this.canvas) this.observer.unobserve(this.canvas);
            this.observer.disconnect();
        }
        this.resizeGraphDisposer?.();
        this.resizeGraphDisposer = null;
        this.imageData = null;
        this.tempCanvas = null;
        this.scaledHistoryCanvas = null;
        this.volumeHistoryCanvas = null;
        this.tempCtx = null;
        this.canvas = null;
        this.canvasCtx = null;
        this.observer = null;
        this.history = null;
        this.intensity = null;
        this.levelHistory = null;
        this.levelIntensity = null;
        this.meterCurrent = null;
        super.cleanup();
    }
}

if (typeof window !== 'undefined' && typeof PluginBase !== 'undefined') {
    window.NoteSpectrogramPlugin = NoteSpectrogramPlugin;
}
