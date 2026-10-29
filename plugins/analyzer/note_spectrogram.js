const MULTI_F0_TAP_FRAME = 24;
const MULTI_F0_TELEMETRY_VERSION = 6;
const MULTI_F0_PAYLOAD_HEADER_BYTES = 32;
// A frame may carry the revised confidences of the frame this many hops earlier.
const MULTI_F0_REVISION_AGE = 8;
const MULTI_F0_NOTE_COUNT = 88;
const MULTI_F0_FINE_DIVISIONS = 5;
const MULTI_F0_FINE_CENTER = Math.floor(MULTI_F0_FINE_DIVISIONS / 2);
const MULTI_F0_PITCH_COUNT = MULTI_F0_NOTE_COUNT * MULTI_F0_FINE_DIVISIONS;
const MULTI_F0_FIRST_MIDI = 21;
const MULTI_F0_LAST_MIDI = MULTI_F0_FIRST_MIDI + MULTI_F0_NOTE_COUNT - 1;
const MULTI_F0_DEFAULT_MIN_MIDI = 28;
const MULTI_F0_DEFAULT_MAX_MIDI = 91;
const MULTI_F0_LEVEL_OFFSET = MULTI_F0_PAYLOAD_HEADER_BYTES + MULTI_F0_PITCH_COUNT * 4;
const MULTI_F0_REVISED_OFFSET = MULTI_F0_LEVEL_OFFSET + MULTI_F0_PITCH_COUNT * 4;
const MULTI_F0_INTERMEDIATE_OFFSET = MULTI_F0_REVISED_OFFSET + MULTI_F0_PITCH_COUNT * 4;
const MULTI_F0_REVISION_BYTES = 4 + MULTI_F0_PITCH_COUNT * 4;
const MULTI_F0_INTERMEDIATE_AGES = [2, 4];
const MULTI_F0_CENTS_OFFSET = MULTI_F0_INTERMEDIATE_OFFSET + 2 * MULTI_F0_REVISION_BYTES;
const MULTI_F0_PAYLOAD_BYTES = MULTI_F0_CENTS_OFFSET + MULTI_F0_NOTE_COUNT * 4;
const MULTI_F0_REVISION_PLANES = MULTI_F0_INTERMEDIATE_AGES.map((age, index) => {
    const offset = MULTI_F0_INTERMEDIATE_OFFSET + index * MULTI_F0_REVISION_BYTES;
    return [age, offset, offset + 4];
});
MULTI_F0_REVISION_PLANES.push([MULTI_F0_REVISION_AGE, 28, MULTI_F0_REVISED_OFFSET]);
const MULTI_F0_LEVEL_FLOOR = -240;
const MULTI_F0_LEVEL_RANGE_DB = 24;
const MULTI_F0_LEVEL_CEILING_DB = -36;
const MULTI_F0_METER_RELEASE_DB_PER_SECOND = 20;
const MULTI_F0_RANGE_HOLD_SECONDS = 1;
const MULTI_F0_COLORS = [
    { value: 'Normal', label: 'Normal' },
    { value: 'Rainbow', label: 'Note Colors' },
    { value: 'Instrument3', label: 'Instrument (3)' },
    { value: 'Instrument9', label: 'Instrument (9)' }
];
const MULTI_F0_TIMBRE_FRAME = 31;
const MULTI_F0_CHORD_KEY_FRAME = 32;
const MULTI_F0_CHORD_CONFIRMED_LAG = 11;
const MULTI_F0_CHORD_LANE_HEIGHT = 36;
const MULTI_F0_CHORD_FONT_SIZE = 28;
const MULTI_F0_CHORD_SUFFIXES = ['', 'm', 'dim', 'aug', 'maj7', 'm7', '7', 'dim7', 'm7b5', 'sus2', 'sus4'];
const MULTI_F0_TIMBRE_CLASSES = ['Bass', 'Guitar', 'Piano', 'Strings', 'Wind', 'Synth', 'Organ', 'Other', 'Vocal'];
const MULTI_F0_TIMBRE_COLORS = [
    [76, 120, 184], [201, 154, 59], [143, 114, 199], [76, 155, 115], [70, 158, 168],
    [189, 111, 162], [166, 125, 96], [156, 156, 156], [214, 107, 94]
];
const MULTI_F0_TIMBRE_UNCLASSIFIED_COLOR = [116, 116, 116];
const MULTI_F0_TIMBRE_FADE_FRAMES = 3;
const MULTI_F0_HIGHLIGHTS = [
    { value: 'None', label: 'None' }, { value: 'Vocal', label: 'Vocal' },
    { value: 'Bass', label: 'Bass' }, { value: 'Other3', label: 'Other (3)' },
    ...MULTI_F0_TIMBRE_CLASSES.slice(1, 7).map(value => ({ value, label: value })),
    { value: 'Other9', label: 'Other (9)' }
];

function multiF0TimbreLabel(probabilities, colorMode) {
    if (!probabilities) return null;
    if (colorMode === 'Instrument3') {
        let other = 0;
        for (let i = 1; i < 8; i++) other += probabilities[i];
        if (probabilities[8] >= probabilities[0] && probabilities[8] >= other) return 'Vocal';
        return probabilities[0] >= other ? 'Bass' : 'Other';
    }
    let best = 0;
    for (let i = 1; i < 9; i++) if (probabilities[i] > probabilities[best]) best = i;
    return MULTI_F0_TIMBRE_CLASSES[best];
}

function multiF0HighlightProbability(probabilities, target) {
    if (!probabilities) return 0;
    if (target === 'Other3') {
        let other = 0;
        for (let i = 1; i < 8; i++) other += probabilities[i];
        return other;
    }
    return probabilities[MULTI_F0_TIMBRE_CLASSES.indexOf(target === 'Other9' ? 'Other' : target)] ?? 0;
}

function multiF0TimbreColor(probabilities, colorMode) {
    const color = [0, 0, 0];
    for (let category = 0; category < 9; category++) {
        const rgb = MULTI_F0_TIMBRE_COLORS[colorMode === 'Instrument3' && category > 0 && category < 8 ? 7 : category];
        for (let channel = 0; channel < 3; channel++) color[channel] += probabilities[category] * rgb[channel];
    }
    return color;
}
const MULTI_F0_RESOLUTIONS = [
    { value: 'Semitone', label: '1/12 Octave' },
    { value: 'High', label: 'High' }
];
const MULTI_F0_LAYOUTS = ['Vertical', 'Horizontal'];
const MULTI_F0_HISTORY_WIDTH = 1024;
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
// Choose the fewest key-signature accidentals; six-accidental ties use sharps.
const MULTI_F0_MAJOR_SIGNATURES = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
const MULTI_F0_KEY_NOTE_NAMES = Array.from({ length: 24 }, (_, key) => {
    const signature = MULTI_F0_MAJOR_SIGNATURES[(key % 12 + (key < 12 ? 0 : 3)) % 12];
    const flat = signature < 0;
    const names = flat ? ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']
        : [...MULTI_F0_NOTE_NAMES];
    const order = flat ? [11, 4, 9, 2, 7, 0, 5] : [5, 0, 7, 2, 9, 4, 11];
    for (let index = 0; index < Math.abs(signature); index++) {
        const natural = order[index];
        names[(natural + (flat ? -1 : 1) + 12) % 12] = MULTI_F0_NOTE_NAMES[natural] + (flat ? '♭' : '#');
    }
    return names;
});
const MULTI_F0_BLACK_KEY_BACKGROUND = 8;
// Smaller alpha values round to zero on the 8-bit history canvas.
const MULTI_F0_MIN_VISIBLE_ALPHA = 0.5 / 255;
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

function multiF0NoteColor(midi) {
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

function multiF0NoteName(midi, names = MULTI_F0_NOTE_NAMES) {
    return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function multiF0ChordName(root, quality, bass) {
    if (root === 255 && quality === 255 && bass === 255) return '';
    if (root > 11 || quality > 10 || bass > 11) return null;
    return MULTI_F0_NOTE_NAMES[root] + MULTI_F0_CHORD_SUFFIXES[quality] +
        (bass === root ? '' : `/${MULTI_F0_NOTE_NAMES[bass]}`);
}

function multiF0KeyName(key) {
    return key < 24 ? `${MULTI_F0_KEY_NOTE_NAMES[key][key % 12]} ${key < 12 ? 'major' : 'minor'}` : '—';
}

function multiF0DisplayChordName(chord, names) {
    // History stays canonical; only root and slash-bass names change, never quality suffixes.
    return chord.replace(/(^|\/)([A-G]#?)/g, (_, prefix, note) => prefix + names[MULTI_F0_NOTE_NAMES.indexOf(note)]);
}

class NoteSpectrogramPlugin extends PluginBase {
    // Switch to 'Winner' here to restore the strongest-class color without changing saved settings.
    static timbreColorMode = 'Probability';
    static noteColors = MULTI_F0_NOTE_COLORS;
    static noteColor = multiF0NoteColor;
    static noteNamesForKey = key => MULTI_F0_KEY_NOTE_NAMES[key] ?? MULTI_F0_NOTE_NAMES;
    static keyName = multiF0KeyName;
    static chordName = (chord, key) => multiF0DisplayChordName(chord, NoteSpectrogramPlugin.noteNamesForKey(key));
    static levelFloor = MULTI_F0_LEVEL_FLOOR;

    static normalizedLevel(level, reference, range = MULTI_F0_LEVEL_RANGE_DB,
        floor = MULTI_F0_LEVEL_CEILING_DB - MULTI_F0_LEVEL_RANGE_DB) {
        const trackedLower = reference - range;
        const lower = trackedLower > floor ? trackedLower : floor;
        const normalized = (level - lower) / range;
        return normalized < 0 ? 0 : (normalized > 1 ? 1 : normalized);
    }

    static updateLevelReference(state, framePeak, elapsed) {
        if (framePeak >= state.levelReference) {
            state.levelReference = framePeak;
            state.levelReferenceHold = MULTI_F0_RANGE_HOLD_SECONDS;
        } else {
            const decayTime = elapsed > state.levelReferenceHold
                ? elapsed - state.levelReferenceHold
                : 0;
            state.levelReferenceHold = elapsed < state.levelReferenceHold
                ? state.levelReferenceHold - elapsed
                : 0;
            const released = state.levelReference -
                MULTI_F0_METER_RELEASE_DB_PER_SECOND * decayTime;
            state.levelReference = framePeak > released ? framePeak : released;
        }
    }

    static executionCapabilities = Object.freeze({ requiresWasm: true });

    constructor() {
        super('Note Spectrogram', 'Multi-pitch piano roll');
        this.initializeDisplayState();
        this.registerProcessor(MULTI_F0_PASS_THROUGH_PROCESSOR);
    }

    initializeDisplayState() {
        this.cl = 'Normal';
        this.hl = 'None';
        this.pr = 'Semitone';
        this.ly = 'Horizontal';
        this.vl = true;
        this.os = false;
        this.ck = false;
        this.ts = 2;
        this.mn = MULTI_F0_DEFAULT_MIN_MIDI;
        this.mx = MULTI_F0_DEFAULT_MAX_MIDI;
        this.history = new Float32Array(MULTI_F0_HISTORY_WIDTH * MULTI_F0_PITCH_COUNT);
        this.pitchCentsHistory = new Float32Array(MULTI_F0_HISTORY_WIDTH * MULTI_F0_NOTE_COUNT);
        this.levelHistory = new Float32Array(MULTI_F0_HISTORY_WIDTH * MULTI_F0_PITCH_COUNT);
        // Preserve measured dB independently of the normalized bar thickness.
        this.volumeLevelHistory = new Float32Array(MULTI_F0_HISTORY_WIDTH * MULTI_F0_PITCH_COUNT).fill(NaN);
        // Marks the last column of each telemetry frame; the columns before it
        // up to the previous mark belong to the same frame.
        this.volumeFrameEnds = new Uint8Array(MULTI_F0_HISTORY_WIDTH).fill(1);
        // Recent frames and the absolute history columns they own, kept so a
        // later revision can rewrite exactly those columns (see handleTelemetry).
        this.frameRecords = [];
        this.columnFrames = new Uint32Array(MULTI_F0_HISTORY_WIDTH).fill(0xffffffff);
        this.confirmedChords = new Array(MULTI_F0_HISTORY_WIDTH).fill(null);
        this.localKey = 24;
        this.notationNames = MULTI_F0_NOTE_NAMES;
        this.overallKey = null;
        this.lastChordKeyFrameIndex = null;
        this.timbreNotes = new Map();
        this.timbreByPitch = Array.from({ length: MULTI_F0_NOTE_COUNT }, () => []);
        this.timbreDirtyRanges = [];
        this.columnSerial = 0;
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
        this._boundTimbreTelemetry = frame => this.handleTimbreTelemetry(frame);
        this._boundChordKeyTelemetry = frame => this.handleChordKeyTelemetry(frame);

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
        this._legendCanvas = null;
        this._legendRects = [];
        this._legendHighlight = null;
        this._timbreColorsDirty = false;
        this._legendDrawFrame = null;
        this._boundLegendMove = event => this._handleLegendPointer(event);
        this._boundLegendLeave = () => this._setLegendHighlight(null);
    }

    reset() {
        this._setLegendHighlight(null);
        this._legendRects = [];
        this.cl = 'Normal';
        this.hl = 'None';
        this.pr = 'Semitone';
        this.ly = 'Horizontal';
        this.vl = true;
        this.os = false;
        this.ck = false;
        this.ts = 2;
        this.mn = MULTI_F0_DEFAULT_MIN_MIDI;
        this.mx = MULTI_F0_DEFAULT_MAX_MIDI;
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
            hl: this.hl,
            pr: this.pr,
            ly: this.ly,
            vl: this.vl,
            os: this.os,
            ck: this.ck,
            ts: this.ts,
            mn: this.mn,
            mx: this.mx
        };
    }

    setParameters(params = {}) {
        const wereNoteEventsEnabled = this.noteEventsEnabled();
        if (params.ck !== undefined && (params.ck === true) !== this.ck) {
            this.ck = params.ck === true;
            this.clearChordKeyHistory();
            this._graphReadout?.clear();
            this.drawGraph();
        }
        if (params.enabled !== undefined) this.enabled = params.enabled !== false;
        const color = params.cl ?? (params.rb === undefined ? this.cl : (params.rb ? 'Rainbow' : 'Normal'));
        if (MULTI_F0_COLORS.some(option => option.value === color) && color !== this.cl) {
            this._setLegendHighlight(null);
            this._legendRects = [];
            this.cl = color;
            this.paintHistoryImage();
            this.volumeHistoryDirty = true;
            this.drawGraph();
        }
        if (MULTI_F0_HIGHLIGHTS.some(option => option.value === params.hl) && params.hl !== this.hl) {
            this.hl = params.hl;
            this.paintHistoryImage();
            this.volumeHistoryDirty = true;
            this.drawGraph();
        }
        if (params.os !== undefined && (params.os === true) !== this.os) {
            this.os = params.os === true;
            this.drawGraph();
        }
        if (wereNoteEventsEnabled && !this.noteEventsEnabled()) {
            for (const note of this.timbreNotes.values()) {
                if (note.endFrameIndex === 0xffffffff) {
                    note.endFrameIndex = ((this.lastFrameIndex ?? note.startFrameIndex) + 1) >>> 0;
                }
            }
        }
        if (MULTI_F0_RESOLUTIONS.some(option => option.value === params.pr) &&
            params.pr !== this.pr) {
            this.pr = params.pr;
            this.configureHistoryImage();
            this.volumeHistoryDirty = true;
            this._graphReadout?.clear();
            this.drawGraph();
        }
        if (MULTI_F0_LAYOUTS.includes(params.ly) && params.ly !== this.ly) {
            this._setLegendHighlight(null);
            this._legendRects = [];
            this.ly = params.ly;
            this._graphReadout?.clear();
            this.drawGraph();
        }
        if (params.vl !== undefined && (params.vl === true) !== this.vl) {
            this.vl = params.vl === true;
            if (!this.vl) this.paintHistoryImage();
            this.volumeHistoryDirty = true;
            this._graphReadout?.clear();
            this.drawGraph();
        }
        if (params.ts !== undefined) {
            const nextTimeSpan = this.parseFiniteNumber(params.ts, 1, 10, this.ts);
            if (nextTimeSpan !== this.ts) {
                this.ts = nextTimeSpan;
                this.columnPeriod = this.ts / MULTI_F0_HISTORY_WIDTH;
                this.clearHistory(true);
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
        if (this.mn !== previousMinMidi || this.mx !== previousMaxMidi) {
            this.volumeHistoryDirty = true;
            this.drawGraph();
        }
        this.updateParameters();
    }

    timbreEnabled() {
        return this.cl === 'Instrument3' || this.cl === 'Instrument9' || this.hl !== 'None';
    }

    noteEventsEnabled() {
        return this.os || this.timbreEnabled();
    }

    clearChordKeyHistory() {
        this.confirmedChords?.fill(null);
        this.localKey = 24;
        this.overallKey = null;
        this.lastChordKeyFrameIndex = null;
        this._setNotationKey(24);
    }

    _setNotationKey(key) {
        const names = NoteSpectrogramPlugin.noteNamesForKey(key);
        if (this.notationNames === names) return;
        this.notationNames = names;
        this.syncUIControls?.();
    }

    _noteReadout(midi) {
        const text = window.GraphReadout.format.note(440 * 2 ** ((midi - 69) / 12), 440);
        return text.replace(/^[A-G]#?-?\d+/, multiF0NoteName(Math.round(midi), this.notationNames));
    }

    parseChordKeyTelemetryFrame(frame) {
        if (frame?.frameType !== MULTI_F0_CHORD_KEY_FRAME || frame.formatVersion !== 1) return null;
        const payload = frame.payload;
        if (!payload || payload.byteLength !== 32 || typeof payload.getUint8 !== 'function') return null;
        const sampleRate = payload.getFloat32(0, true);
        const timeSeconds = payload.getFloat32(4, true);
        const hopSeconds = payload.getFloat32(8, true);
        if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(timeSeconds) ||
            timeSeconds < 0 || !Number.isFinite(hopSeconds) || hopSeconds <= 0) return null;
        const generation = payload.getUint32(12, true);
        const frameIndex = payload.getUint32(16, true);
        const readChord = offset => {
            const root = payload.getUint8(offset), quality = payload.getUint8(offset + 1), bass = payload.getUint8(offset + 2);
            const name = multiF0ChordName(root, quality, bass);
            return name === null ? null : { root, quality, bass, name };
        };
        const immediate = readChord(20), confirmed = readChord(23);
        const localKey = payload.getUint8(26);
        const overallKey = payload.getUint8(27);
        const confirmedProbability = payload.getFloat32(28, true);
        if (immediate === null || confirmed === null || (localKey > 24 && localKey !== 255) ||
            (overallKey > 23 && overallKey !== 255) || !Number.isFinite(confirmedProbability) ||
            confirmedProbability < 0 || confirmedProbability > 1) return null;
        return { sampleRate, timeSeconds, hopSeconds, generation, frameIndex, immediate, confirmed,
            localKey: localKey === 255 ? null : localKey,
            overallKey: overallKey === 255 ? null : overallKey, confirmedProbability };
    }

    handleChordKeyTelemetry(frame) {
        if (!this.ck || !this.enabled || !this._sectionEnabled || !this.columnFrames) return;
        const snapshot = this.parseChordKeyTelemetryFrame(frame);
        if (!snapshot || snapshot.generation !== this.activeGeneration ||
            (frame.source && frame.source !== this.telemetrySource)) return;
        const { frameIndex, confirmed, localKey, overallKey } = snapshot;
        if (this.lastChordKeyFrameIndex !== null &&
            !isNewerMultiF0Counter(frameIndex, this.lastChordKeyFrameIndex)) return;
        const confirmedFrame = (frameIndex - MULTI_F0_CHORD_CONFIRMED_LAG) >>> 0;
        for (let column = 0; column < MULTI_F0_HISTORY_WIDTH; column++) {
            const owner = this.columnFrames[column];
            if (owner === 0xffffffff) continue;
            if (owner === confirmedFrame) this.confirmedChords[column] = confirmed.name;
        }
        this.localKey = localKey;
        this.overallKey = overallKey;
        this._setNotationKey(overallKey);
        this.lastChordKeyFrameIndex = frameIndex;
    }

    _effectiveHighlight() {
        return this._legendHighlight ?? this.hl;
    }

    _setLegendHighlight(target) {
        if (target === this._legendHighlight) return;
        this._legendHighlight = target;
        this._timbreColorsDirty = true;
        // Active analyzers consume this on their existing animation frame. Paused
        // graphs need only one frame for a changed hover target, never per move.
        if (this.animationFrameId === null && this._legendDrawFrame === null &&
            typeof requestAnimationFrame === 'function') {
            this._legendDrawFrame = requestAnimationFrame(() => {
                this._legendDrawFrame = null;
                this.drawGraph();
            });
        }
    }

    _handleLegendPointer(event) {
        if (event.pointerType && event.pointerType !== 'mouse') return;
        const { x, y } = this.getGraphCoords(this._legendCanvas, event);
        const item = this._legendRects.find(rect => x >= rect.x && x < rect.x + rect.width &&
            y >= rect.y && y < rect.y + rect.height);
        this._setLegendHighlight(item?.target ?? null);
    }

    _bindLegendCanvas(canvas) {
        this._legendCanvas?.removeEventListener('pointermove', this._boundLegendMove);
        this._legendCanvas?.removeEventListener('pointerleave', this._boundLegendLeave);
        this._legendCanvas = canvas;
        canvas?.addEventListener('pointermove', this._boundLegendMove, { passive: true });
        canvas?.addEventListener('pointerleave', this._boundLegendLeave, { passive: true });
    }

    _layoutTimbreLegend(context, width, height) {
        const items = [];
        const labels = this.cl === 'Instrument3' ? ['Vocal', 'Bass', 'Other']
            : this.cl === 'Instrument9' ? [...MULTI_F0_TIMBRE_CLASSES] : [];
        const highlight = this._effectiveHighlight();
        if (highlight !== 'None') {
            labels.push(`Highlight: ${MULTI_F0_HIGHLIGHTS.find(option => option.value === highlight).label}`);
        }
        if (!labels.length || width <= 0 || height <= 0) return items;
        const dpr = this.graphDpr || 1, padding = 6 * dpr, lineHeight = 20 * dpr;
        context.save();
        context.font = `${12 * dpr}px Arial`;
        let x = padding, y = padding + (this.ck && this.ly === 'Vertical' ? MULTI_F0_CHORD_LANE_HEIGHT * dpr : 0);
        for (const label of labels) {
            const color = MULTI_F0_TIMBRE_COLORS[MULTI_F0_TIMBRE_CLASSES.indexOf(label)];
            const swatch = color ? 14 * dpr : 0;
            const itemWidth = context.measureText(label).width + swatch + 2 * padding;
            if (x > padding && x + itemWidth > width - padding) { x = padding; y += lineHeight; }
            if (y + lineHeight > height) break;
            items.push({ label, color, swatch, x, y, width: itemWidth, height: lineHeight });
            x += itemWidth;
        }
        context.restore();
        return items;
    }

    _drawTimbreLegend(context, width, height) {
        this._legendRects = [];
        const items = this._layoutTimbreLegend(context, width, height);
        if (!items.length) return;
        const dpr = this.graphDpr || 1, padding = 6 * dpr;
        const theme = this.displayOptions?.themePalette ?? window.ThemePalette;
        const highlight = this._effectiveHighlight();
        context.save();
        context.beginPath();
        context.rect(0, 0, width, height);
        context.clip();
        context.font = `${12 * dpr}px Arial`;
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        for (const { label, color, swatch, x, y, width: itemWidth, height: lineHeight } of items) {
            context.fillStyle = theme?.get('graph-bg-deep') ?? '';
            context.fillRect(x, y, itemWidth, lineHeight);
            if (color) {
                const target = label === 'Other' ? (this.cl === 'Instrument3' ? 'Other3' : 'Other9') : label;
                this._legendRects.push({ x, y, width: Math.min(itemWidth, width - x), height: lineHeight,
                    target });
                if (target === highlight) {
                    context.fillStyle = theme?.get('graph-label') ?? '';
                    context.fillRect(x, y, itemWidth, dpr);
                    context.fillRect(x, y + lineHeight - dpr, itemWidth, dpr);
                    context.fillRect(x, y, dpr, lineHeight);
                    context.fillRect(x + itemWidth - dpr, y, dpr, lineHeight);
                }
                context.fillStyle = `rgb(${color.join(', ')})`; // theme-allow: Fixed instrument colormap.
                context.fillRect(x + padding, y + 5 * dpr, 10 * dpr, 10 * dpr);
            }
            context.fillStyle = theme?.get('graph-label') ?? '';
            context.fillText(label, x + padding + swatch, y + lineHeight / 2);
        }
        context.restore();
    }

    _timbreForColumn(column, midi) {
        const frameIndex = this.columnFrames[column];
        if (frameIndex === 0xffffffff) return null;
        const notes = this.timbreByPitch[Math.round(midi) - MULTI_F0_FIRST_MIDI];
        if (!notes) return null;
        for (let i = notes.length - 1; i >= 0; i--) {
            const note = notes[i];
            const age = (frameIndex - note.startFrameIndex) >>> 0;
            if (age < 0x80000000 && (note.endFrameIndex === 0xffffffff ||
                age < ((note.endFrameIndex - note.startFrameIndex) >>> 0))) return note;
        }
        return null;
    }

    _noteDisplayColor(column, midi, value, palette, externalColor = null, applyHighlight = true, noteMidi = midi, fadeHistory = false) {
        const note = this.timbreEnabled() ? this._timbreForColumn(column, noteMidi) : null;
        const probabilities = note?.probabilities;
        const customColor = externalColor ?? this.displayOptions?.noteColor?.(midi, value);
        let color = customColor ??
            (this.cl === 'Rainbow' ? multiF0NoteColor(midi)
                : this.cl === 'Instrument3' || this.cl === 'Instrument9'
                    ? (probabilities ? (this.constructor.timbreColorMode === 'Probability' ? note.colors[this.cl]
                        : MULTI_F0_TIMBRE_COLORS[MULTI_F0_TIMBRE_CLASSES.indexOf(multiF0TimbreLabel(probabilities, this.cl))])
                        : MULTI_F0_TIMBRE_UNCLASSIFIED_COLOR) : palette.trace);
        const highlight = this._effectiveHighlight();
        const highlighted = highlight !== 'None' && applyHighlight;
        if (highlighted) {
            const probability = multiF0HighlightProbability(probabilities, highlight);
            color = color.map((channel, i) => probability * channel +
                (1 - probability) * MULTI_F0_TIMBRE_UNCLASSIFIED_COLOR[i]);
        }
        if (fadeHistory && note?.fadeFrame < MULTI_F0_TIMBRE_FADE_FRAMES) {
            const initial = highlighted ? MULTI_F0_TIMBRE_UNCLASSIFIED_COLOR
                : customColor ?? (this.cl === 'Instrument3' || this.cl === 'Instrument9'
                    ? MULTI_F0_TIMBRE_UNCLASSIFIED_COLOR : color);
            const progress = note.fadeFrame / MULTI_F0_TIMBRE_FADE_FRAMES;
            return color.map((channel, i) => initial[i] + (channel - initial[i]) * progress);
        }
        return color;
    }

    handleTimbreTelemetry(frame) {
        if (!this.enabled || !this._sectionEnabled || !this.noteEventsEnabled() ||
            frame?.frameType !== MULTI_F0_TIMBRE_FRAME || frame.formatVersion !== 1 ||
            frame.payload?.byteLength !== 80 || (frame.source && frame.source !== this.telemetrySource)) return;
        const payload = frame.payload;
        const generation = payload.getUint32(12, true);
        if (generation !== this.activeGeneration) return;
        const sampleRate = payload.getFloat32(0, true);
        const timeSeconds = payload.getFloat32(4, true);
        const hopSeconds = payload.getFloat32(8, true);
        const frameIndex = payload.getUint32(16, true);
        const noteId = payload.getUint32(20, true);
        const midi = payload.getUint32(24, true);
        const event = payload.getUint32(28, true);
        const startFrameIndex = payload.getUint32(32, true);
        const endFrameIndex = payload.getUint32(36, true);
        if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(timeSeconds) ||
            timeSeconds < 0 || !Number.isFinite(hopSeconds) || hopSeconds <= 0 || !noteId ||
            midi < 21 || midi > 108 || event < 1 || event > 3 || payload.getUint32(76, true) !== 0 ||
            ((frameIndex - startFrameIndex) >>> 0) >= 0x80000000) return;
        let probabilities = null;
        if (event === 2) {
            probabilities = new Float32Array(9);
            let sum = 0;
            for (let i = 0; i < 9; i++) {
                const value = payload.getFloat32(40 + i * 4, true);
                if (!Number.isFinite(value) || value < 0 || value > 1) return;
                probabilities[i] = value;
                sum += value;
            }
            if (Math.abs(sum - 1) > .001) return;
        }
        let note = this.timbreNotes.get(noteId);
        if (!note) {
            note = { noteId, midi, startFrameIndex, endFrameIndex, probabilities: null };
            this.timbreNotes.set(noteId, note);
            const notes = this.timbreByPitch[midi - MULTI_F0_FIRST_MIDI];
            // Retriggers end the previous note even if its end event was dropped.
            for (const previous of notes) {
                if (previous.endFrameIndex === 0xffffffff && isNewerMultiF0Counter(startFrameIndex, previous.startFrameIndex)) {
                    if (previous.probabilities) this.timbreDirtyRanges.push([startFrameIndex, 0xffffffff]);
                    previous.endFrameIndex = startFrameIndex;
                }
            }
            notes.push(note);
            notes.sort((a, b) => a.startFrameIndex - b.startFrameIndex);
        } else if (note.midi !== midi || note.startFrameIndex !== startFrameIndex) return;
        if (endFrameIndex !== 0xffffffff && note.endFrameIndex !== endFrameIndex) {
            // Closing a classified note only changes columns beyond its new end.
            if (note.probabilities) this.timbreDirtyRanges.push([endFrameIndex, note.endFrameIndex]);
            note.endFrameIndex = endFrameIndex;
        }
        if (probabilities) {
            if (!note.probabilities) note.fadeFrame = 0;
            note.probabilities = probabilities;
            note.colors = {
                Instrument3: multiF0TimbreColor(probabilities, 'Instrument3'),
                Instrument9: multiF0TimbreColor(probabilities, 'Instrument9')
            };
            this.timbreDirtyRanges.push([startFrameIndex, note.endFrameIndex]);
        }
    }

    flushTimbreHistory() {
        for (const note of this.timbreNotes.values()) {
            if (note.fadeFrame < MULTI_F0_TIMBRE_FADE_FRAMES) {
                note.fadeFrame++;
                this.timbreDirtyRanges.push([note.startFrameIndex, note.endFrameIndex]);
            }
        }
        if (!this.timbreDirtyRanges.length) return;
        const ranges = this.timbreDirtyRanges.splice(0);
        const oldest = Math.max(0, this.columnSerial - MULTI_F0_HISTORY_WIDTH);
        const dirty = new Uint8Array(this.columnSerial - oldest);
        for (let serial = oldest; serial < this.columnSerial; serial++) {
            const column = serial % MULTI_F0_HISTORY_WIDTH;
            const frame = this.columnFrames[column];
            if (frame === 0xffffffff) continue;
            for (const [start, end] of ranges) {
                const age = (frame - start) >>> 0;
                if (age < 0x80000000 && (end === 0xffffffff || age < ((end - start) >>> 0))) {
                    dirty[serial - oldest] = 1;
                    break;
                }
            }
        }
        if (this._usesBarHistory()) {
            // The next frame's gradient also uses the changed frame's color.
            let next = false;
            for (let i = 0; i < dirty.length; i++) {
                if (dirty[i]) next = true;
                else if (next) {
                    dirty[i] = 1;
                    if (this.volumeFrameEnds[(oldest + i) % MULTI_F0_HISTORY_WIDTH]) next = false;
                }
            }
        }
        for (let i = 0; i < dirty.length;) {
            if (!dirty[i]) { i++; continue; }
            const start = i++;
            while (i < dirty.length && dirty[i]) i++;
            const column = (oldest + start) % MULTI_F0_HISTORY_WIDTH;
            if (this._usesBarHistory()) this._paintVolumeColumns(column, i - start);
            else this.paintColumns(column, i - start);
        }
        this._graphReadout?.clear();
    }

    getWorkletPluginData(parameters = this.getParameters()) {
        return super.getWorkletPluginData({ ...parameters, te: this.noteEventsEnabled() });
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
        const subscriptions = [];
        try {
            for (const [type, handler] of [
                [MULTI_F0_TAP_FRAME, this._boundTelemetry],
                [MULTI_F0_TIMBRE_FRAME, this._boundTimbreTelemetry],
                [MULTI_F0_CHORD_KEY_FRAME, this._boundChordKeyTelemetry]
            ]) {
                const unsubscribe = hub.subscribe(tapId, type, handler);
                if (typeof unsubscribe !== 'function') {
                    hub.unsubscribe?.(tapId, type, handler);
                    throw new Error('Telemetry subscription unavailable');
                }
                subscriptions.push(unsubscribe);
            }
            this._dspTelemetryHub = hub;
            this._dspTelemetryTapId = tapId;
            this._dspTelemetryUnsubscribe = () => {
                for (const unsubscribe of subscriptions) {
                    try { unsubscribe(); } catch {
                        // A stale subscription must not prevent releasing the remaining streams.
                    }
                }
            };
            return true;
        } catch {
            for (const unsubscribe of subscriptions) {
                try { unsubscribe(); } catch {
                    // Release the subscriptions established before registration failed.
                }
            }
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
        const revisionAge = payload.getUint32(28, true);
        if (!Number.isFinite(sampleRate) || sampleRate <= 0 ||
            !Number.isFinite(timeSeconds) || timeSeconds < 0 ||
            pitchCount !== MULTI_F0_PITCH_COUNT || firstMidi !== MULTI_F0_FIRST_MIDI ||
            !Number.isFinite(hopSeconds) || hopSeconds <= 0 ||
            modeCode !== MULTI_F0_FINE_DIVISIONS || generation === 0 ||
            (revisionAge !== 0 && revisionAge !== MULTI_F0_REVISION_AGE)) {
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
        const pitchCents = new Float32Array(MULTI_F0_NOTE_COUNT);
        for (let note = 0; note < MULTI_F0_NOTE_COUNT; note++) {
            const cents = payload.getFloat32(MULTI_F0_CENTS_OFFSET + note * 4, true);
            if (!Number.isFinite(cents)) return null;
            pitchCents[note] = cents;
        }
        const revisions = [];
        for (const [expectedAge, ageOffset, levelsOffset] of MULTI_F0_REVISION_PLANES) {
            const age = payload.getUint32(ageOffset, true);
            if (age !== 0 && age !== expectedAge) return null;
            if (age === 0) continue;
            const revised = new Float32Array(MULTI_F0_PITCH_COUNT);
            for (let pitch = 0; pitch < MULTI_F0_PITCH_COUNT; pitch++) {
                const level = payload.getFloat32(levelsOffset + pitch * 4, true);
                if (!Number.isFinite(level) || level < 0 || level > 1) return null;
                revised[pitch] = level;
            }
            revisions.push({ age, levels: revised });
        }
        const revisedLevels = revisions.find(revision => revision.age === MULTI_F0_REVISION_AGE)?.levels ?? null;
        return {
            sampleRate,
            timeSeconds,
            hopSeconds,
            frameIndex,
            modeCode,
            generation,
            levels,
            volumeLevels,
            pitchCents,
            revisionAge,
            revisedLevels,
            revisions
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

    clearHistory(preserveActiveTimbre = false) {
        this.history?.fill(0);
        this.pitchCentsHistory?.fill(0);
        this.levelHistory?.fill(0);
        this.volumeLevelHistory?.fill(NaN);
        this.volumeFrameEnds?.fill(1);
        this.frameRecords = [];
        this.columnFrames?.fill(0xffffffff);
        this.clearChordKeyHistory();
        if (preserveActiveTimbre) {
            // Rebuilding the display does not restart the DSP or resend completed results.
            for (const notes of this.timbreByPitch ?? []) {
                for (let i = notes.length - 1; i >= 0; i--) {
                    if (notes[i].endFrameIndex === 0xffffffff) continue;
                    this.timbreNotes.delete(notes[i].noteId);
                    notes.splice(i, 1);
                }
            }
        } else {
            this.timbreNotes?.clear();
            this.timbreByPitch?.forEach(notes => { notes.length = 0; });
        }
        this.timbreDirtyRanges.length = 0;
        this.columnSerial = 0;
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
            ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get(name) ?? '').match(/[\d.]+/g)?.slice(0, 3).map(Number));
        if (colors.some(color => !color || color.length !== 3)) return null;
        const [background, soft, trace] = colors;
        const light = background.every(channel => channel > 127);
        return {
            trace,
            whiteKey: light ? 255 : 238,
            blackKey: 17,
            whiteBand: background,
            blackBand: light ? soft : background.map(channel => channel + MULTI_F0_BLACK_KEY_BACKGROUND),
            volumeCompositeOperation: light ? 'darken' : 'lighter'
        };
    }

    _writePixels(column, palette = this._displayPalette()) {
        if (!this.imageData || !this.history || !palette) return;
        const pixels = this.imageData.data;
        const historyOffset = column * MULTI_F0_PITCH_COUNT;
        const displayPitchCount = this.pr === 'High'
            ? MULTI_F0_PITCH_COUNT
            : MULTI_F0_NOTE_COUNT;
        const heatmap = this.displayOptions?.heatmapColorLut;
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
            const best = this.pr === 'High' ? pitch
                : this._bestBagPitch(historyOffset, MULTI_F0_FIRST_MIDI + pitch);
            const value = this.history[historyOffset + best];
            if (heatmap) {
                const offset = Math.round(value * 255) * 4;
                pixels[pixelOffset] = heatmap[offset];
                pixels[pixelOffset + 1] = heatmap[offset + 1];
                pixels[pixelOffset + 2] = heatmap[offset + 2];
                pixels[pixelOffset + 3] = heatmap[offset + 3];
                continue;
            }
            const midi = MULTI_F0_FIRST_MIDI + (this.pr === 'High' ? (pitch - MULTI_F0_FINE_CENTER) / MULTI_F0_FINE_DIVISIONS : pitch);
            const color = this._noteDisplayColor(column, midi, value, palette, null, true, midi, true);
            pixels[pixelOffset] = this.displayOptions?.transparent ? color[0] : Math.round(background[0] + (color[0] - background[0]) * value);
            pixels[pixelOffset + 1] = this.displayOptions?.transparent ? color[1] : Math.round(background[1] + (color[1] - background[1]) * value);
            pixels[pixelOffset + 2] = this.displayOptions?.transparent ? color[2] : Math.round(background[2] + (color[2] - background[2]) * value);
            pixels[pixelOffset + 3] = this.displayOptions?.transparent ? Math.round(value * 255) : 255;
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
        return NoteSpectrogramPlugin.normalizedLevel(level, this.levelReference);
    }

    _updateVolumeState(snapshot, elapsed) {
        let framePeak = MULTI_F0_LEVEL_FLOOR;
        for (let pitch = 0; pitch < MULTI_F0_PITCH_COUNT; pitch++) {
            if (snapshot.levels[pitch] >= 0.5 && snapshot.volumeLevels[pitch] > framePeak) {
                framePeak = snapshot.volumeLevels[pitch];
            }
        }
        NoteSpectrogramPlugin.updateLevelReference(this, framePeak, elapsed);
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
        if (frame.source && frame.source !== this.telemetrySource) {
            this.telemetrySource = frame.source;
            this.activeGeneration = null;
            this.generationFence = null;
            this.modeTimeFence = null;
            this.clearHistory();
        }

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
            this.frameRecords.length = 0;
        } else {
            delta = (snapshot.frameIndex - this.lastFrameIndex) >>> 0;
            if (delta === 0 || delta >= 0x80000000) return;
            this.columnPhase += delta * snapshot.hopSeconds / this.columnPeriod;
            advance = Math.floor(this.columnPhase);
            this.columnPhase -= advance;
        }

        if (advance >= MULTI_F0_HISTORY_WIDTH) {
            this.clearHistory(true);
            advance = 1;
        }

        this.intensity.set(snapshot.levels);
        this._updateVolumeState(snapshot, (this.lastFrameIndex === null ? 1 : delta) *
            snapshot.hopSeconds);

        if (advance === 0) {
            const column = (this.writeColumn + MULTI_F0_HISTORY_WIDTH - 1) %
                MULTI_F0_HISTORY_WIDTH;
            const historyOffset = column * MULTI_F0_PITCH_COUNT;
            this.columnFrames[column] = snapshot.frameIndex;
            this.confirmedChords[column] = null;
            this._mergeFramePitches(column, snapshot.levels, snapshot.pitchCents);
            for (let pitch = 0; pitch < MULTI_F0_PITCH_COUNT; pitch++) {
                if (this.levelIntensity[pitch] > this.levelHistory[historyOffset + pitch]) {
                    this.levelHistory[historyOffset + pitch] = this.levelIntensity[pitch];
                }
                const previousLevel = this.volumeLevelHistory[historyOffset + pitch];
                if (Number.isNaN(previousLevel) || snapshot.volumeLevels[pitch] > previousLevel) {
                    this.volumeLevelHistory[historyOffset + pitch] = snapshot.volumeLevels[pitch];
                }
            }
            this.paintColumns(column, 1);
            this._paintVolumeColumns(column, 1);
        } else {
            const startColumn = this.writeColumn;
            if (delta === 1) {
                // Gap columns repeat the newest column, so its owners own them too.
                for (const record of this.frameRecords) {
                    if (record.end === this.columnSerial - 1) record.end += advance - 1;
                }
            }
            for (let offset = 0; offset < advance - 1; offset++) {
                const destination = (startColumn + offset) % MULTI_F0_HISTORY_WIDTH;
                this.confirmedChords[destination] = null;
                this.volumeFrameEnds[destination] = delta === 1 ? 0 : 1;
                if (delta === 1) {
                    const source = (destination + MULTI_F0_HISTORY_WIDTH - 1) %
                        MULTI_F0_HISTORY_WIDTH;
                    this.columnFrames[destination] = this.columnFrames[source];
                    this.pitchCentsHistory.copyWithin(
                        destination * MULTI_F0_NOTE_COUNT,
                        source * MULTI_F0_NOTE_COUNT,
                        (source + 1) * MULTI_F0_NOTE_COUNT
                    );
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
                    this.volumeLevelHistory.copyWithin(
                        destination * MULTI_F0_PITCH_COUNT,
                        source * MULTI_F0_PITCH_COUNT,
                        (source + 1) * MULTI_F0_PITCH_COUNT
                    );
                } else {
                    this.columnFrames[destination] = 0xffffffff;
                    this.pitchCentsHistory.fill(0, destination * MULTI_F0_NOTE_COUNT,
                        (destination + 1) * MULTI_F0_NOTE_COUNT);
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
                    this.volumeLevelHistory.fill(
                        NaN,
                        destination * MULTI_F0_PITCH_COUNT,
                        (destination + 1) * MULTI_F0_PITCH_COUNT
                    );
                }
            }
            const latestColumn = (startColumn + advance - 1) % MULTI_F0_HISTORY_WIDTH;
            this.columnFrames[latestColumn] = snapshot.frameIndex;
            this.confirmedChords[latestColumn] = null;
            this.history.set(this.intensity, latestColumn * MULTI_F0_PITCH_COUNT);
            this.pitchCentsHistory.set(snapshot.pitchCents, latestColumn * MULTI_F0_NOTE_COUNT);
            this.levelHistory.set(this.levelIntensity, latestColumn * MULTI_F0_PITCH_COUNT);
            this.volumeLevelHistory.set(snapshot.volumeLevels, latestColumn * MULTI_F0_PITCH_COUNT);
            this.volumeFrameEnds[latestColumn] = 1;
            this.writeColumn = (startColumn + advance) % MULTI_F0_HISTORY_WIDTH;
            this.paintColumns(startColumn, advance);
            this._paintVolumeColumns(startColumn, advance);
            this.columnSerial += advance;
        }
        // The frame owns the newest column, alone or merged with earlier frames.
        const serial = this.columnSerial - 1;
        this.frameRecords.push({ frameIndex: snapshot.frameIndex, levels: snapshot.levels,
            pitchCents: snapshot.pitchCents, start: serial, end: serial });
        for (const revision of snapshot.revisions) {
            this._applyFrameRevision((snapshot.frameIndex - revision.age) >>> 0, revision.levels);
        }
        // Keep the frames that can still be revised and any older frame that
        // shares a column with them; frames own contiguous, ordered columns.
        const boundary = this.frameRecords.find(record =>
            ((snapshot.frameIndex - record.frameIndex) >>> 0) < MULTI_F0_REVISION_AGE).start;
        while (this.frameRecords[0].end < boundary) this.frameRecords.shift();
        this.lastFrameIndex = snapshot.frameIndex;
        this.latestHopSeconds = snapshot.hopSeconds;
        this.latestFrameTimeSeconds = snapshot.timeSeconds;
        this.updateScrollTime(snapshot.timeSeconds);
        const oldestFrame = this.columnFrames[this.writeColumn];
        if (oldestFrame !== 0xffffffff) {
            for (const notes of this.timbreByPitch) {
                while (notes.length && notes[0].endFrameIndex !== 0xffffffff &&
                    ((oldestFrame - notes[0].endFrameIndex) >>> 0) < 0x80000000) {
                    this.timbreNotes.delete(notes.shift().noteId);
                }
            }
        }
    }

    // Keep each note's unrounded estimate with the strongest frame in a merged column.
    _mergeFramePitches(column, levels, pitchCents) {
        const offset = column * MULTI_F0_PITCH_COUNT;
        for (let note = 0; note < MULTI_F0_NOTE_COUNT; note++) {
            const first = note * MULTI_F0_FINE_DIVISIONS;
            let previous = 0;
            let incoming = 0;
            for (let division = 0; division < MULTI_F0_FINE_DIVISIONS; division++) {
                const pitch = first + division;
                const value = this.history[offset + pitch];
                if (value > previous) previous = value;
                if (levels[pitch] > incoming) incoming = levels[pitch];
                if (levels[pitch] > value) this.history[offset + pitch] = levels[pitch];
            }
            if (incoming > previous) this.pitchCentsHistory[column * MULTI_F0_NOTE_COUNT + note] = pitchCents[note];
        }
    }

    // Rewrites the columns of a recorded frame with its revised confidences.
    // Each column is the max of the frames that merged into it. Recorded frames
    // span at most a few hundred milliseconds, so they are always displayed.
    // Frames that were dropped or are no longer recorded are ignored.
    _applyFrameRevision(frameIndex, levels) {
        const record = this.frameRecords.find(entry => entry.frameIndex === frameIndex);
        if (!record) return;
        record.levels = levels;
        for (let serial = record.start; serial <= record.end; serial++) {
            const offset = (serial % MULTI_F0_HISTORY_WIDTH) * MULTI_F0_PITCH_COUNT;
            this.history.fill(0, offset, offset + MULTI_F0_PITCH_COUNT);
            const column = serial % MULTI_F0_HISTORY_WIDTH;
            this.pitchCentsHistory.fill(0, column * MULTI_F0_NOTE_COUNT, (column + 1) * MULTI_F0_NOTE_COUNT);
            for (const entry of this.frameRecords) {
                if (serial < entry.start || serial > entry.end) continue;
                this._mergeFramePitches(column, entry.levels, entry.pitchCents);
            }
        }
        const startColumn = record.start % MULTI_F0_HISTORY_WIDTH;
        this.paintColumns(startColumn, record.end - record.start + 1);
        // The following volume frame links its bars to the revised one.
        let volumeEnd = record.end + 1;
        while (volumeEnd < this.columnSerial - 1 &&
            !this.volumeFrameEnds[volumeEnd % MULTI_F0_HISTORY_WIDTH]) {
            volumeEnd++;
        }
        if (volumeEnd >= this.columnSerial) volumeEnd = record.end;
        this._paintVolumeColumns(startColumn, volumeEnd - record.start + 1);
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
        valueInput.value = multiF0NoteName(value, this.notationNames);
        valueInput.autocomplete = 'off';
        valueInput.style.flexGrow = '0';
        valueInput.style.width = '80px';
        valueInput.style.boxSizing = 'border-box';

        slider.addEventListener('input', event => {
            const nextValue = Number(event.target.value);
            if (!Number.isFinite(nextValue)) return;
            setter(nextValue);
            valueInput.value = multiF0NoteName(this[modelKey], this.notationNames);
        });

        this._registerUIControl(modelKey, [slider], modelValue => {
            const midi = Math.round(Number(modelValue));
            if (!Number.isFinite(midi)) return;
            slider.value = midi;
            window.uiManager?.refreshRangeFillStyling?.(slider);
            valueInput.value = multiF0NoteName(midi, this.notationNames);
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
        const highlightRow = this.createSelectControl(
            'Highlight', MULTI_F0_HIGHLIGHTS, this.hl,
            value => this.setParameters({ hl: value }), 'hl'
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
        const onsetsRow = this.createCheckboxControl(
            'Onsets', this.os, value => this.setParameters({ os: value }), 'os'
        );
        const chordsRow = this.createCheckboxControl(
            'Chords & Key', this.ck, value => this.setParameters({ ck: value }), 'ck'
        );
        const timeSpanRow = this.createParameterControl(
            'Time Span', 1, 10, 1, this.ts,
            value => this.setParameters({ ts: value }), 's', 'ts'
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
        // Two columns on desktop, one on mobile (css/effetune.css and css/effetune-mobile.css).
        const parameters = document.createElement('div');
        parameters.className = 'analyzer-parameters';
        parameters.appendChild(colorRow);
        parameters.appendChild(highlightRow);
        parameters.appendChild(resolutionRow);
        parameters.appendChild(layoutRow);
        parameters.appendChild(volumeRow);
        parameters.appendChild(onsetsRow);
        parameters.appendChild(chordsRow);
        parameters.appendChild(timeSpanRow);
        parameters.appendChild(minNoteRow);
        parameters.appendChild(maxNoteRow);
        container.appendChild(parameters);

        const graph = this.createResponsiveGraph({
            className: 'local-audio-only',
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

        this.initializeDisplayCanvas(this.canvas);

        container.appendChild(graph.container);
        if (typeof IntersectionObserver === 'function') {
            this.observer = new IntersectionObserver(this.handleIntersect.bind(this));
            this.observer.observe(this.canvas);
        } else {
            this.drawGraph();
        }
        this._graphReadout = window.GraphReadout?.attach({
            mount: graph.container,
            surface: this.canvas,
            // The piano roll, or the keyboard gutter while the pointer is over it (canvas coordinates).
            plot: point => {
                const frame = this._readoutFrame;
                if (!frame?.valid) return null;
                const { horizontal, rollWidth, gutter, height } = frame;
                const onKeys = (horizontal ? point.y : point.x) >= rollWidth;
                const start = onKeys ? rollWidth : 0;
                const length = onKeys ? gutter : rollWidth;
                return horizontal
                    ? { left: 0, top: start, width: height, height: length }
                    : { left: start, top: 0, width: length, height };
            },
            read: (x, y) => this._readNote(x, y),
            crosshair: 'xy'
        });
        return container;
    }

    initializeDisplayCanvas(canvas) {
        this._bindLegendCanvas(canvas);
        this.canvas = canvas;
        this.canvasCtx = canvas.getContext('2d', { alpha: this.displayOptions?.transparent === true });
        this.tempCanvas = document.createElement('canvas');
        this.tempCanvas.width = MULTI_F0_HISTORY_WIDTH;
        this.configureHistoryImage();
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

    _usesBarHistory() {
        return this.vl || this.pr === 'High';
    }

    _estimatedMidi(column, midi) {
        return midi + this.pitchCentsHistory[column * MULTI_F0_NOTE_COUNT + midi - MULTI_F0_FIRST_MIDI] / 100;
    }

    _volumeBarsForColumn(historyOffset) {
        const bars = [];
        for (let midi = this.mn; midi <= this.mx; midi++) {
            const best = this._bestBagPitch(historyOffset, midi);
            const confidence = this.history[historyOffset + best];
            if (confidence > 0) bars.push({ midi, best, confidence });
        }
        return bars;
    }

    _volumeBarShape(historyOffset, bar, rowHeight, palette) {
        const { midi, best, confidence } = bar;
        const column = Math.floor(historyOffset / MULTI_F0_PITCH_COUNT);
        const pitch = this.pr === 'High' ? this._estimatedMidi(column, midi)
            : MULTI_F0_FIRST_MIDI + (best - MULTI_F0_FINE_CENTER) / MULTI_F0_FINE_DIVISIONS;
        const signalColor = this.displayOptions?.signalColor?.(pitch, confidence);
        const alpha = signalColor ? signalColor.alpha : confidence;
        if (alpha < MULTI_F0_MIN_VISIBLE_ALPHA) return null;
        const normalized = this.levelHistory[historyOffset + best];
        const color = this._noteDisplayColor(column, pitch, this.vl ? normalized : confidence,
            palette, signalColor?.rgb, true, midi, true);
        const red = Math.round(color[0]);
        const green = Math.round(color[1]);
        const blue = Math.round(color[2]);
        const nominalMinimum = rowHeight / MULTI_F0_FINE_DIVISIONS;
        const minimum = nominalMinimum > 1 ? nominalMinimum : 1;
        const nominalMaximum = rowHeight - 1;
        const maximum = nominalMaximum > minimum ? nominalMaximum : minimum;
        const thickness = this.vl ? minimum + (maximum - minimum) * normalized : minimum;
        const center = (this.mx - (this.pr === 'High' ? pitch : midi) + 0.5) * rowHeight;
        return {
            midi,
            center,
            half: thickness / 2,
            fill: `rgba(${red}, ${green}, ${blue}, ${alpha})` // theme-allow: Foreground colors use the active theme or selected colormap; alpha carries confidence.
        };
    }

    _volumeShapesForColumn(column, rowHeight, palette) {
        const historyOffset = column * MULTI_F0_PITCH_COUNT;
        return this._volumeBarsForColumn(historyOffset).map(bar =>
            this._volumeBarShape(historyOffset, bar, rowHeight, palette)).filter(Boolean);
    }

    _paintVolumeBackground(context, x, width, height, rowHeight, palette) {
        if (this.displayOptions?.transparent) context.clearRect(x, 0, width, height);
        else for (let midi = this.mn; midi <= this.mx; midi++) {
            const background = MULTI_F0_BLACK_KEY_CLASSES.has(midi % 12)
                ? palette.blackBand
                : palette.whiteBand;
            context.fillStyle = `rgb(${background[0]}, ${background[1]}, ${background[2]})`; // theme-allow: RGB channels come from the active theme's keyboard bands.
            context.fillRect(x, (this.mx - midi) * rowHeight, width, rowHeight);
        }
        this._paintVolumeGrid(context, x, width, rowHeight);
    }

    // Paints the columns of the telemetry frame ending at `end` as one span.
    // Continue the same note before matching remaining overlapping bars across
    // semitone boundaries. Each previous bar can continue only once.
    _paintVolumeFrame(context, end, height, rowHeight, palette, withBackground) {
        const newest = (this.writeColumn + MULTI_F0_HISTORY_WIDTH - 1) % MULTI_F0_HISTORY_WIDTH;
        let start = end;
        let previous = null;
        for (let step = 1; step < MULTI_F0_HISTORY_WIDTH; step++) {
            const column = (end - step + MULTI_F0_HISTORY_WIDTH) % MULTI_F0_HISTORY_WIDTH;
            if (column === newest) break;
            if (this.volumeFrameEnds[column]) {
                previous = column;
                break;
            }
            start = column;
        }
        const current = this._volumeShapesForColumn(end, rowHeight, palette);
        const before = previous === null ? [] : this._volumeShapesForColumn(previous, rowHeight, palette);
        if (!withBackground && current.length === 0 && before.length === 0) return;
        const links = current.map(shape => before.find(candidate => candidate.midi === shape.midi) ?? null);
        const used = new Set(links.filter(Boolean));
        current.forEach((shape, index) => {
            if (links[index]) return;
            let link = null;
            let linkDistance = Infinity;
            for (const candidate of before) {
                if (used.has(candidate)) continue;
                const distance = candidate.center > shape.center
                    ? candidate.center - shape.center
                    : shape.center - candidate.center;
                if (distance < candidate.half + shape.half && distance < linkDistance) {
                    link = candidate;
                    linkDistance = distance;
                }
            }
            if (link) {
                links[index] = link;
                used.add(link);
            }
        });
        const count = (end - start + MULTI_F0_HISTORY_WIDTH) % MULTI_F0_HISTORY_WIDTH + 1;
        const right = start + count;
        for (const shift of right > MULTI_F0_HISTORY_WIDTH ? [0, -MULTI_F0_HISTORY_WIDTH] : [0]) {
            context.save();
            context.translate(shift, 0);
            context.beginPath();
            context.rect(start, 0, count, height);
            context.clip();
            if (withBackground) this._paintVolumeBackground(context, start, count, height, rowHeight, palette);
            context.globalCompositeOperation = palette.volumeCompositeOperation;
            current.forEach((shape, index) => {
                const link = links[index];
                context.beginPath();
                if (link) {
                    const gradient = context.createLinearGradient(start, 0, right, 0);
                    gradient.addColorStop(0, link.fill);
                    gradient.addColorStop(1, shape.fill);
                    context.fillStyle = gradient;
                    context.moveTo(start, link.center - link.half);
                    context.lineTo(right, shape.center - shape.half);
                    context.lineTo(right, shape.center + shape.half);
                    context.lineTo(start, link.center + link.half);
                    context.closePath();
                } else {
                    context.fillStyle = shape.fill;
                    context.ellipse(right, shape.center, count, shape.half, 0, 0, Math.PI * 2);
                }
                context.fill();
            });
            for (const shape of before) {
                if (used.has(shape)) continue;
                context.fillStyle = shape.fill;
                context.beginPath();
                context.ellipse(start, shape.center, count, shape.half, 0, 0, Math.PI * 2);
                context.fill();
            }
            context.restore();
        }
    }

    _paintVolumeGrid(context, x, width, rowHeight) {
        if (this.displayOptions?.separateAnnotations && context !== this.canvasCtx) return;
        if (this.displayOptions?.showAxes === false) return;
        const lineWidth = this.graphDpr || 1;
        for (let midi = 24; midi <= MULTI_F0_LAST_MIDI; midi++) {
            const isC = midi % 12 === 0;
            if (!isC && midi % 12 !== 5) continue;
            if (midi < this.mn || midi > this.mx) continue;
            const boundaryY = (this.mx - midi + 1) * rowHeight;
            context.fillStyle = isC
                ? ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-grid-strong') ?? '')
                : ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-grid-subtle') ?? '');
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
        const rowHeight = height / (this.mx - this.mn + 1);
        this._paintVolumeBackground(context, 0, MULTI_F0_HISTORY_WIDTH, height, rowHeight, palette);
        for (let column = 0; column < MULTI_F0_HISTORY_WIDTH; column++) {
            if (this.volumeFrameEnds[column]) this._paintVolumeFrame(context, column, height, rowHeight, palette, false);
        }
        this.volumeHistoryDirty = false;
    }

    _paintVolumeColumns(startColumn, count) {
        if (!this._usesBarHistory() || this.volumeHistoryDirty || !this.volumeHistoryCanvas) {
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
            if (this.volumeFrameEnds[column]) this._paintVolumeFrame(context, column, height, rowHeight, palette, true);
        }
    }

    _drawVolumeMeters(context, rollWidth, rowHeight, palette) {
        if (!this.vl) return;
        for (let midi = this.mn; midi <= this.mx; midi++) {
            const note = midi - MULTI_F0_FIRST_MIDI;
            const centerY = (this.mx - midi + 0.5) * rowHeight;
            const normalized = this._normalizedLevel(this.meterCurrent[note]);
            const signalColor = this.displayOptions?.signalColor?.(midi, normalized);
            const color = this._noteDisplayColor((this.writeColumn + MULTI_F0_HISTORY_WIDTH - 1) % MULTI_F0_HISTORY_WIDTH,
                midi, normalized, palette, signalColor?.rgb);
            const currentRadius = rowHeight * normalized;
            if (currentRadius > 0) {
                const gradient = context.createRadialGradient(
                    rollWidth, centerY, 0, rollWidth, centerY, currentRadius
                );
                const opacity = .65 * (signalColor?.alpha ?? 1);
                const visible = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${opacity})`; // theme-allow: RGB channels use the active theme trace or fixed note colormap.
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

    _drawOnsets(context, rollWidth, rowHeight, columnWidth, scrollPhase, palette) {
        if (!this.os || !this.timbreNotes.size) return;
        const theme = this.displayOptions?.themePalette ?? window.ThemePalette;
        const dpr = this.graphDpr || 1;
        const markerHeight = Math.min(rowHeight * .75, 10 * dpr);
        context.save();
        context.beginPath();
        context.rect(0, 0, rollWidth, rowHeight * (this.mx - this.mn + 1));
        context.clip();
        context.strokeStyle = theme?.get('graph-bg-deep') ?? '';
        context.lineWidth = dpr;
        for (const note of this.timbreNotes.values()) {
            if (note.midi < this.mn || note.midi > this.mx) continue;
            // Search in display order so a frame spanning the ring boundary has one marker.
            let column = this.columnFrames.indexOf(note.startFrameIndex, this.writeColumn);
            if (column < 0) column = this.columnFrames.indexOf(note.startFrameIndex);
            if (column < 0) continue;
            const x = ((column - this.writeColumn + MULTI_F0_HISTORY_WIDTH) %
                MULTI_F0_HISTORY_WIDTH - scrollPhase) * columnWidth;
            const pitch = this.pr === 'High' ? this._estimatedMidi(column, note.midi) : note.midi;
            const y = (this.mx - pitch + .5) * rowHeight;
            const color = this._noteDisplayColor(column, note.midi, undefined, palette);
            // The horizontal layout rotates this right-pointing triangle downward.
            context.beginPath();
            context.moveTo(x, y - markerHeight / 2);
            context.lineTo(x, y + markerHeight / 2);
            context.lineTo(x + markerHeight, y);
            context.closePath();
            context.stroke();
            context.fillStyle = `rgb(${color.join(', ')})`; // theme-allow: Same Color and Highlight mapping as the note.
            context.fill();
        }
        context.restore();
    }

    _chordKeyColor(root) {
        const color = this.displayOptions?.chordKeyColor?.(root) ?? (this.cl === 'Rainbow' ? multiF0NoteColor(root) : null);
        return color ? `rgb(${color.join(', ')})` // theme-allow: Display palette or existing root-note colormap.
            : (this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-label') ?? '';
    }

    _drawChordKeyText(context, label, x, y, maxWidth, outline = context) {
        outline.save();
        if (outline !== context) {
            outline.setTransform(context.getTransform());
            for (const property of ['font', 'textAlign', 'textBaseline', 'globalAlpha']) outline[property] = context[property];
        }
        outline.strokeStyle = (this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-bg-deep') ?? '';
        outline.lineWidth = 2 * (this.graphDpr || 1);
        outline.lineJoin = 'round';
        outline.strokeText(label, x, y, maxWidth);
        outline.restore();
        context.fillText(label, x, y, maxWidth);
    }

    _drawChordLane(context, rollWidth, columnWidth, scrollPhase, horizontal, outline) {
        if (!this.ck) return;
        const legendItems = horizontal ? this._layoutTimbreLegend(context, this.canvas.width, rollWidth) : [];
        const keyLayout = horizontal ? this._layoutKey(context, this.canvas.width, rollWidth) : null;
        const obstacles = horizontal
            ? [...legendItems, ...(keyLayout ? [keyLayout.bounds] : [])].sort((a, b) => a.y - b.y)
            : [];
        const dpr = this.graphDpr || 1;
        const laneHeight = MULTI_F0_CHORD_LANE_HEIGHT * dpr;
        const padding = 6 * dpr;
        const targets = outline ? [context, outline] : [context];
        for (const target of targets) {
            target.save();
            target.beginPath();
            target.rect(0, 0, rollWidth, horizontal ? this.canvas.width : laneHeight);
            target.clip();
        }
        context.font = `bold ${MULTI_F0_CHORD_FONT_SIZE * dpr}px Arial`;
        context.textAlign = horizontal ? 'right' : 'left';
        context.textBaseline = 'middle';
        context.globalAlpha = 1;
        const labels = [];
        let previous = null, color;
        for (let position = 0; position < MULTI_F0_HISTORY_WIDTH; position++) {
            const column = (this.writeColumn + position) % MULTI_F0_HISTORY_WIDTH;
            const chord = this.confirmedChords[column];
            const x = (position - scrollPhase) * columnWidth;
            const width = (position === MULTI_F0_HISTORY_WIDTH - 1 ? 1 + scrollPhase : 1) * columnWidth;
            if (chord) {
                if (chord !== previous) {
                    const root = MULTI_F0_NOTE_NAMES.indexOf(chord.slice(0, chord[1] === '#' ? 2 : 1));
                    color = this._chordKeyColor(root);
                    labels.push({ chord: multiF0DisplayChordName(chord, this.notationNames),
                        x, end: x + width, color });
                } else {
                    labels[labels.length - 1].end = x + width;
                }
                context.fillStyle = color;
                context.fillRect(x, horizontal ? 0 : laneHeight - 2 * dpr, width, 2 * dpr);
            }
            previous = chord;
        }
        // Keep every label inside its own time interval, with newer labels taking priority.
        let nextStart = rollWidth;
        const maxTextWidth = Math.max(1, (horizontal ? this.canvas.width : rollWidth) - 2 * padding);
        for (let index = labels.length - 1; index >= 0; index--) {
            const label = labels[index];
            const metrics = context.measureText(label.chord);
            const scale = Math.min(1, maxTextWidth / metrics.width);
            const textLeft = -(metrics.actualBoundingBoxLeft ?? (horizontal ? metrics.width : 0)) * scale - dpr;
            const textRight = (metrics.actualBoundingBoxRight ?? (horizontal ? 0 : metrics.width)) * scale + dpr;
            const ascent = (metrics.actualBoundingBoxAscent ?? MULTI_F0_CHORD_FONT_SIZE * dpr / 2) + dpr;
            const descent = (metrics.actualBoundingBoxDescent ?? MULTI_F0_CHORD_FONT_SIZE * dpr / 2) + dpr;
            const extent = horizontal ? ascent + descent : textRight - textLeft + 2 * padding;
            // Match the outer top ink inset to the right inset without padding each chord interval.
            let start = Math.max(horizontal ? padding - textRight + dpr : 0, label.x);
            const end = Math.min(label.end, rollWidth, nextStart);
            if (horizontal) {
                const left = this.canvas.width - 1.5 * padding + textLeft;
                const right = this.canvas.width - padding / 2 + textRight;
                for (const item of obstacles) {
                    if (left < item.x + item.width && right > item.x &&
                        start < item.y + item.height && start + extent > item.y) {
                        start = item.y + item.height;
                    }
                }
            }
            if (start + extent > end) continue;
            nextStart = start;
            context.save();
            context.translate(horizontal ? start + ascent : start + padding - textLeft,
                horizontal ? padding + dpr : laneHeight / 2);
            if (horizontal) context.rotate(-Math.PI / 2);
            context.fillStyle = label.color;
            this._drawChordKeyText(context, label.chord, 0, 0, maxTextWidth, outline);
            context.restore();
        }
        for (const target of targets) target.restore();
    }

    _layoutKey(context, width, height) {
        if (!this.ck || !Number.isInteger(this.localKey) || this.localKey < 0 || this.localKey >= 24) return null;
        const dpr = this.graphDpr || 1;
        const padding = 6 * dpr, lineHeight = MULTI_F0_CHORD_LANE_HEIGHT * dpr;
        const label = `Key: ${multiF0KeyName(this.localKey)}`;
        const font = `bold ${MULTI_F0_CHORD_FONT_SIZE * dpr}px Arial`;
        const x = padding * 2, y = height - lineHeight / 2 - padding;
        const maxTextWidth = Math.max(1, width - 4 * padding);
        context.save();
        context.font = font;
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        const metrics = context.measureText(label);
        context.restore();
        const scale = Math.min(1, maxTextWidth / metrics.width);
        const left = x - (metrics.actualBoundingBoxLeft ?? 0) * scale;
        const right = x + (metrics.actualBoundingBoxRight ?? metrics.width) * scale;
        const ascent = metrics.actualBoundingBoxAscent ?? MULTI_F0_CHORD_FONT_SIZE * dpr / 2;
        const descent = metrics.actualBoundingBoxDescent ?? MULTI_F0_CHORD_FONT_SIZE * dpr / 2;
        return { label, font, x, y, maxTextWidth,
            bounds: { x: left - dpr, y: y - ascent - dpr, width: right - left + 2 * dpr, height: ascent + descent + 2 * dpr } };
    }

    _drawKeys(context, width = this.canvas.width, height = this.canvas.height, outline) {
        const layout = this._layoutKey(context, width, height);
        if (!layout) return;
        const { label, font, x, y, maxTextWidth } = layout;
        const targets = outline ? [context, outline] : [context];
        for (const target of targets) {
            target.save();
            target.beginPath();
            target.rect(0, 0, width, height);
            target.clip();
        }
        context.font = font;
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.fillStyle = this._chordKeyColor(this.localKey % 12);
        this._drawChordKeyText(context, label, x, y, maxTextWidth, outline);
        for (const target of targets) target.restore();
    }

    drawGraph(now = performance.now()) {
        if (this.displayOptions?.deferDraw) return;
        if (this._timbreColorsDirty) {
            this._timbreColorsDirty = false;
            if (this._usesBarHistory()) this.volumeHistoryDirty = true;
            else this.paintHistoryImage();
            this._graphReadout?.clear();
        }
        this.flushTimbreHistory();
        const frame = (this._readoutFrame ??= {});
        frame.valid = false;
        if (!this.canvasCtx || !this.imageData || !this.tempCtx || !this.tempCanvas ||
            !this.canvas) {
            this._graphReadout?.refresh();
            return;
        }
        const palette = this._displayPalette();
        if (!palette) {
            this._graphReadout?.refresh();
            return;
        }
        const context = this.canvasCtx;
        const horizontal = this.ly === 'Horizontal';
        const width = horizontal ? this.canvas.height : this.canvas.width;
        const height = horizontal ? this.canvas.width : this.canvas.height;
        const dpr = this.graphDpr || 1;
        const showKeyboard = this.displayOptions?.showKeyboard !== false;
        const visiblePitchCount = this.mx - this.mn + 1;
        const rowHeight = height / visiblePitchCount;
        const keyboard = window.FrequencyAxis.keyboardDepths(12 * rowHeight, width,
            this.displayOptions?.keyboardLength);
        const gutter = showKeyboard ? keyboard.gutter : 0;
        const blackKeyDepth = keyboard.blackDepth;
        const rollWidth = width - gutter;
        const drawKeyboard = (draw, boundary = false) => this.displayOptions?.drawKeyboard
            ? this.displayOptions.drawKeyboard(context, draw, { horizontal, width, height, rollWidth, boundary })
            : draw();
        const displayDivisions = this.pr === 'High' ? MULTI_F0_FINE_DIVISIONS : 1;
        const visibleDisplayPitchCount = visiblePitchCount * displayDivisions;
        const sourceY = (MULTI_F0_LAST_MIDI - this.mx) * displayDivisions;

        context.fillStyle = ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-bg-deep') ?? '');
        if (this.displayOptions?.transparent) context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        else context.fillRect(0, 0, this.canvas.width, this.canvas.height);
        if (rollWidth <= 0 || height <= 0) {
            this._graphReadout?.refresh();
            return;
        }

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
        if (!scaledContext) {
            this._graphReadout?.refresh();
            return;
        }
        if (horizontal) {
            context.save();
            context.translate(this.canvas.width, 0);
            context.rotate(Math.PI / 2);
        }
        if (this.displayOptions?.transparent) scaledContext.clearRect(0, 0, this.scaledHistoryCanvas.width, height);
        scaledContext.imageSmoothingEnabled = false;
        if (this._usesBarHistory()) {
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
        const drawHistory = context => {
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
            if (this._usesBarHistory()) {
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
        };
        if (this.displayOptions?.drawSignal) this.displayOptions.drawSignal(context, drawHistory, { width: rollWidth, height });
        else drawHistory(context);
        this._drawOnsets(context, rollWidth, rowHeight, columnWidth, scrollPhase, palette);

        Object.assign(frame, {
            valid: true, horizontal, canvasWidth: this.canvas.width, rollWidth, height, rowHeight,
            gutter, blackKeyDepth, scrollPhase, columnWidth, phaseOffset, split, palette
        });
        if (this._usesBarHistory() && this.displayOptions?.separateAnnotations) this._paintVolumeGrid(context, 0, rollWidth, rowHeight);
        context.lineWidth = dpr;
        if (showKeyboard) {
            drawKeyboard(() => {
                const applyHighlight = this.cl === 'Instrument3' || this.cl === 'Instrument9';
                const latestOffset = ((this.writeColumn + MULTI_F0_HISTORY_WIDTH - 1) %
                    MULTI_F0_HISTORY_WIDTH) * MULTI_F0_PITCH_COUNT;
                const whiteKeyHeight = 12 * rowHeight / 7;
                const whiteKeys = [];
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
                    const color = this._noteDisplayColor(latestOffset / MULTI_F0_PITCH_COUNT,
                        midi, undefined, palette, null, applyHighlight);
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
                    whiteKeys.push([height - end, height - start, confidence]);
                }
                context.strokeStyle = ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-label') ?? '');
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
                const blackKeys = [];
                const outlineTint = .2;
                for (let midi = this.mn; midi <= this.mx; midi++) {
                    const pitchClass = midi % 12;
                    if (!MULTI_F0_BLACK_KEY_CLASSES.has(pitchClass)) continue;
                    const row = this.mx - midi;
                    const confidence = this._bagConfidence(latestOffset, midi);
                    const color = this._noteDisplayColor(latestOffset / MULTI_F0_PITCH_COUNT,
                        midi, undefined, palette, null, applyHighlight);
                    const red = Math.round(palette.blackKey + (color[0] - palette.blackKey) * confidence);
                    const green = Math.round(palette.blackKey + (color[1] - palette.blackKey) * confidence);
                    const blue = Math.round(palette.blackKey + (color[2] - palette.blackKey) * confidence);
                    const outlineRed = Math.round(255 + (red - 255) * outlineTint);
                    const outlineGreen = Math.round(255 + (green - 255) * outlineTint);
                    const outlineBlue = Math.round(255 + (blue - 255) * outlineTint);
                    blackKeys.push([
                        row * rowHeight, (row + 1) * rowHeight, confidence,
                        `rgb(${red}, ${green}, ${blue})`, // theme-allow: Fixed signal-level or self-painted colormap color.
                        `rgba(${outlineRed}, ${outlineGreen}, ${outlineBlue}, ${confidence})` // theme-allow: White tinted toward the self-painted key fill.
                    ]);
                }
                window.FrequencyAxis.shadeKeyboard(context,
                    { along: 'y', edge: rollWidth, length: height, gutter, blackDepth: blackKeyDepth, dpr }, blackKeys, () => {
                        for (const [start, end, , color] of blackKeys) {
                            context.fillStyle = color;
                            context.fillRect(rollWidth, start, blackKeyDepth, end - start);
                        }
                    }, whiteKeys);
                // Leave the back edge open: top in Horizontal, right in Vertical.
                context.save();
                const outlineWidth = Math.min(rowHeight, blackKeyDepth) * .1;
                const inset = outlineWidth / 2;
                const backEdge = rollWidth + (horizontal ? inset : blackKeyDepth - inset);
                const frontEdge = rollWidth + (horizontal ? blackKeyDepth - inset : inset);
                context.lineWidth = outlineWidth;
                for (const [start, end, confidence, , outlineColor] of blackKeys) {
                    if (confidence <= 0) continue;
                    context.strokeStyle = outlineColor;
                    context.beginPath();
                    context.moveTo(backEdge, start + inset);
                    context.lineTo(frontEdge, start + inset);
                    context.lineTo(frontEdge, end - inset);
                    context.lineTo(backEdge, end - inset);
                    context.stroke();
                }
                context.restore();
            });
            // The meters and border sit on the roll boundary rather than inside the keys.
            drawKeyboard(() => {
                const drawMeters = target => this._drawVolumeMeters(target, rollWidth, rowHeight, palette);
                if (this.displayOptions?.drawSignal) this.displayOptions.drawSignal(context, drawMeters);
                else drawMeters(context);
                context.beginPath();
                context.moveTo(rollWidth, 0);
                context.lineTo(rollWidth, height);
                context.stroke();
            }, true);
        }

        context.fillStyle = showKeyboard ? '#111' : ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-label') ?? ''); // theme-allow: Fixed text color only on self-painted piano keys.
        const keyboardLabelLimit = showKeyboard ? this.displayOptions?.keyboardLabelFontSize : null;
        let labelFontSize = keyboardLabelLimit || 7 * dpr;
        if (keyboardLabelLimit) {
            context.font = `${labelFontSize}px Arial`;
            let labelWidth = 0, labelHeight = 0;
            for (let midi = Math.ceil(this.mn / 12) * 12; midi <= this.mx; midi += 12) {
                if (horizontal && midi > 96) continue;
                const metrics = context.measureText(multiF0NoteName(midi, this.notationNames));
                labelWidth = Math.max(labelWidth, metrics.width);
                labelHeight = Math.max(labelHeight, metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent);
            }
            const keySpan = 12 * rowHeight / 7 - 2 * dpr;
            const keyDepth = gutter - blackKeyDepth - 2 * dpr;
            const availableWidth = horizontal ? keySpan : keyDepth;
            const availableHeight = horizontal ? keyDepth : keySpan;
            labelFontSize = availableWidth > 0 && availableHeight > 0
                ? labelFontSize * Math.min(1, availableWidth / (labelWidth || 1), availableHeight / (labelHeight || 1))
                : 0;
        }
        context.font = `${labelFontSize}px Arial`;
        context.textAlign = showKeyboard || horizontal ? 'center' : 'right';
        context.textBaseline = 'middle';
        const showPitchLabels = labelFontSize > 0 && (showKeyboard || this.displayOptions?.showAxisNumbers !== false);
        // Labels sit on keys lit in the note colors or on the newest roll columns; a Visualizer
        // palette can match the text color, so outline them in the key or background color there.
        const labelOutline = !this.displayOptions?.visualizerAxisLabels ? null : showKeyboard
            ? `rgb(${palette.whiteKey}, ${palette.whiteKey}, ${palette.whiteKey})` // theme-allow: Self-painted white key color.
            : ((this.displayOptions.themePalette ?? window.ThemePalette)?.get('graph-bg-deep') ?? '');
        const pitchLabel = (label, x, y) => {
            const text = this.displayOptions?.textContext ?? context;
            if (labelOutline) {
                context.save();
                context.strokeStyle = labelOutline;
                context.lineWidth = (showKeyboard ? 1.5 : 2) * dpr;
                context.lineJoin = 'round';
                text.strokeText(label, x, y);
                context.restore();
            }
            text.fillText(label, x, y);
        };
        for (let midi = 24; midi <= MULTI_F0_LAST_MIDI; midi++) {
            const isC = midi % 12 === 0;
            if (!isC && midi % 12 !== 5) continue;
            if (midi < this.mn || midi > this.mx) continue;
            const row = this.mx - midi;
            const boundaryY = (row + 1) * rowHeight;
            if (!this._usesBarHistory() && this.displayOptions?.showAxes !== false) {
                context.strokeStyle = isC ? ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-grid-strong') ?? '') : ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-grid-subtle') ?? '');
                context.beginPath();
                context.moveTo(0, boundaryY);
                context.lineTo(horizontal || this.displayOptions?.drawKeyboard ? rollWidth : width, boundaryY);
                context.stroke();
            }
            const octave = midi / 12 - 1;
            if (showPitchLabels && isC && (!horizontal || octave <= 7)) {
                const drawLabel = () => {
                    const label = multiF0NoteName(midi, this.notationNames);
                    const x = showKeyboard ? rollWidth + blackKeyDepth + (gutter - blackKeyDepth) / 2 : width - 2 * dpr;
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
                            return;
                        }
                        context.save();
                        context.translate(width - 2 * dpr, y);
                        context.rotate(-Math.PI / 2);
                        context.textBaseline = 'bottom';
                        pitchLabel(label, 0, 0);
                        context.restore();
                    } else {
                        const metrics = context.measureText(label);
                        const ascent = metrics.actualBoundingBoxAscent;
                        const descent = metrics.actualBoundingBoxDescent;
                        const visualCenterOffset = Number.isFinite(ascent) && Number.isFinite(descent)
                            ? (ascent - descent) / 2
                            : 0;
                        pitchLabel(label, x, y + visualCenterOffset);
                    }
                };
                if (showKeyboard) drawKeyboard(drawLabel);
                else drawLabel();
            }
        }
        const drawChordLane = (target, outline) => this._drawChordLane(target, rollWidth, columnWidth, scrollPhase, horizontal, outline);
        if (this.displayOptions?.drawChordKey) this.displayOptions.drawChordKey(context, drawChordLane);
        else drawChordLane(context);
        if (horizontal) context.restore();
        const drawKey = (target, outline) => this._drawKeys(target, horizontal ? height : rollWidth, horizontal ? rollWidth : height, outline);
        if (this.displayOptions?.drawChordKey) this.displayOptions.drawChordKey(context, drawKey);
        else drawKey(context);
        this._drawTimbreLegend(context, horizontal ? height : rollWidth, horizontal ? rollWidth : height);
        this._graphReadout?.refresh();
    }

    // Reads the history cell at canvas pixel (x, y); u/v are the unrotated roll coordinates.
    _readNote(x, y) {
        const frame = this._readoutFrame;
        if (!frame?.valid || !this.history) return null;
        const { format } = window.GraphReadout;
        const { horizontal, canvasWidth, rollWidth, rowHeight, columnWidth, scrollPhase } = frame;
        const u = horizontal ? y : x;
        const v = horizontal ? canvasWidth - x : y;
        if (u >= rollWidth) {
            const axis = window.FrequencyAxis;
            const key = axis?.hitKey(axis.noteAxisKeys(this.mn, this.mx, frame.height),
                frame.height - v, u - rollWidth, frame.gutter, frame.blackKeyDepth);
            return key ? { cursor: this._noteReadout(key.midi), rows: [], crosshair: 'none' } : null;
        }
        const latestStart = rollWidth - (1 + scrollPhase) * columnWidth;
        const column = u >= latestStart
            ? (frame.split + MULTI_F0_HISTORY_WIDTH - 1) % MULTI_F0_HISTORY_WIDTH
            : (frame.split + Math.floor((u + frame.phaseOffset) / columnWidth)) % MULTI_F0_HISTORY_WIDTH;
        const rowIndex = Math.floor(v / rowHeight);
        let midi = this.mx - (rowIndex < 0 ? 0 : rowIndex);
        if (midi < this.mn) return null;
        const historyOffset = column * MULTI_F0_PITCH_COUNT;
        const high = this.pr === 'High';
        let cellMidi = midi;
        let matched = !high;
        if (high) {
            cellMidi = this.mx + 0.5 - v / rowHeight;
            let nearest = 0.5;
            for (let note = this.mn; note <= this.mx; note++) {
                if (this._bagConfidence(historyOffset, note) <= 0) continue;
                const estimate = this._estimatedMidi(column, note);
                const distance = Math.abs(estimate - (this.mx + 0.5 - v / rowHeight));
                if (distance < nearest) {
                    nearest = distance;
                    midi = note;
                    cellMidi = estimate;
                    matched = true;
                }
            }
        }
        const levelPitch = this._bestBagPitch(historyOffset, midi);
        const salience = matched ? this.history[historyOffset + levelPitch] : 0;
        const color = this._noteDisplayColor(column, cellMidi, salience, frame.palette, null, true, matched ? midi : NaN);
        const row = {
            label: 'Salience',
            color: `rgb(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])})`, // theme-allow: Same note or theme trace color as the drawn cell.
            value: format.percent(salience),
            y
        };
        const levelRow = {
            ...row,
            label: 'Level',
            value: format.db(matched ? this.volumeLevelHistory[historyOffset + levelPitch] : NaN)
        };
        const cursor = `${this._noteReadout(cellMidi)} · ${
            format.time(-(rollWidth - u) / columnWidth * this.columnPeriod * 1000)}`;
        const rows = [row, levelRow];
        if (this.ck) {
            const chord = this.confirmedChords[column];
            if (chord !== null) rows.push({ ...row, label: 'Chord',
                value: chord ? multiF0DisplayChordName(chord, this.notationNames) : 'No chord' });
        }
        const probabilities = matched && this.timbreEnabled() ? this._timbreForColumn(column, midi)?.probabilities : null;
        if (this.timbreEnabled() && !probabilities) {
            rows.push({ label: 'Instrument', color: `rgb(${MULTI_F0_TIMBRE_UNCLASSIFIED_COLOR.join(', ')})`, // theme-allow: Fixed neutral instrument color.
                value: 'Not classified' });
        } else if (probabilities) {
            if (this.cl === 'Instrument3' || this.cl === 'Instrument9') {
                rows.push({ ...row, label: 'Instrument', value: multiF0TimbreLabel(probabilities, this.cl) });
            }
            const targets = this.cl === 'Instrument3' ? ['Vocal', 'Bass', 'Other3']
                : MULTI_F0_TIMBRE_CLASSES.map(label => label === 'Other' ? 'Other9' : label);
            for (const target of targets) {
                const label = target === 'Other3' || target === 'Other9' ? 'Other' : target;
                const color = MULTI_F0_TIMBRE_COLORS[MULTI_F0_TIMBRE_CLASSES.indexOf(label)];
                rows.push({ label, color: `rgb(${color.join(', ')})`, // theme-allow: Fixed instrument colormap.
                    value: format.percent(multiF0HighlightProbability(probabilities, target)) });
            }
            const highlight = this._effectiveHighlight();
            if (highlight !== 'None' && !targets.includes(highlight)) {
                rows.push({ ...row, label: MULTI_F0_HIGHLIGHTS.find(option => option.value === highlight).label,
                    value: format.percent(multiF0HighlightProbability(probabilities, highlight)) });
            }
        }
        return { cursor, rows, at: { x, y } };
    }

    cleanup() {
        this.stopAnimation();
        this._bindLegendCanvas(null);
        if (this._legendDrawFrame !== null) cancelAnimationFrame(this._legendDrawFrame);
        this._legendDrawFrame = null;
        this._legendHighlight = null;
        this._legendRects = [];
        this._timbreColorsDirty = false;
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
        this.pitchCentsHistory = null;
        this.intensity = null;
        this.levelHistory = null;
        this.volumeLevelHistory = null;
        this.volumeFrameEnds = null;
        this.frameRecords = null;
        this.columnFrames = null;
        this.confirmedChords = null;
        this.timbreNotes?.clear();
        this.timbreByPitch = null;
        this.timbreDirtyRanges = null;
        this.levelIntensity = null;
        this.meterCurrent = null;
        super.cleanup();
    }
}

if (typeof window !== 'undefined' && typeof PluginBase !== 'undefined') {
    window.NoteSpectrogramPlugin = NoteSpectrogramPlugin;
}
