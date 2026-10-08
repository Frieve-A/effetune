const RHYTHM_ANALYZER_FRAME_TYPE = 28;
const RHYTHM_ANALYZER_TELEMETRY_VERSION = 4;
const RHYTHM_ANALYZER_PAYLOAD_BYTES = 1496;
const RHYTHM_ANALYZER_TEMPOGRAM_BINS = 192;
const RHYTHM_ANALYZER_MAX_EVENTS = 16;
const RHYTHM_ANALYZER_TEMPOGRAM_OFFSET = 64;
const RHYTHM_ANALYZER_EVENTS_OFFSET = 832;
const RHYTHM_ANALYZER_EVENT_BYTES = 32;
// Beats per row of the Groove view (JS-only display key sp).
const RHYTHM_ANALYZER_SPANS = [4, 6, 8, 12, 16];
// ck is the kernel's Metronome Click; vt/vm/ve/vl show the tempogram, timing lanes, echo rows and beat lens.
const RHYTHM_ANALYZER_DEFAULTS = Object.freeze({ mn: 40, mx: 240, ck: false, sp: 8, vt: false, vm: true, ve: false, vl: true });
const RHYTHM_ANALYZER_PANEL_KEYS = ['vt', 'vm', 've', 'vl'];
// Allowed ranges of Min BPM (mn) and Max BPM (mx).
const RHYTHM_ANALYZER_MN_RANGE = [40, 192];
const RHYTHM_ANALYZER_MX_RANGE = [50, 240];
// Tempogram grid: 48 bins per octave over 30-480 BPM (contract section 4).
const RHYTHM_ANALYZER_MIN_BPM = 30;
const RHYTHM_ANALYZER_OCTAVES = 4;
// Octave ticks first so they keep their labels when a short strip has room for only some.
const RHYTHM_ANALYZER_BPM_TICKS = [30, 60, 120, 240, 480, 90, 180];
// Tempogram history: 160 columns of 0.125 s (20 s).
const RHYTHM_ANALYZER_TEMPOGRAM_COLUMNS = 160;
const RHYTHM_ANALYZER_COLUMN_SECONDS = 0.125;
// Between telemetry frames the tempogram scrolls on with wall-clock time for at most two columns (0.25 s), enough
// to ride out ordinary delivery gaps while still stopping when telemetry stops.
const RHYTHM_ANALYZER_SCROLL_LIMIT_COLUMNS = 2;
// Committed history and ungated forward events share the displayed beat clock.
const RHYTHM_ANALYZER_CLOCK_CAPACITY = 512;
const RHYTHM_ANALYZER_MAX_SEGMENTS = 64;
const RHYTHM_ANALYZER_EVENT_CAPACITY = 4096;
// Timing: lane half-range and lens scale ticks (ms), reference window, pattern match tolerance, lens window (beats).
const RHYTHM_ANALYZER_DEVIATION_MS = 30;
const RHYTHM_ANALYZER_GUIDE_MS = 20;
const RHYTHM_ANALYZER_REFERENCE_BEATS = 16;
const RHYTHM_ANALYZER_MATCH_BEATS = 0.08;
const RHYTHM_ANALYZER_LENS_BEATS = 32;
// Display-only exponential easing: about 95% of a lens change settles within 0.6 s.
const RHYTHM_ANALYZER_LENS_SMOOTHING_MS = 200;
const RHYTHM_ANALYZER_MIN_EVENTS = 4;
const RHYTHM_ANALYZER_LABEL_MIN_MS = 3;
// Snap grids in a beat (the last point wraps to slot 0) and the lens slot of each point.
const RHYTHM_ANALYZER_STRAIGHT_GRID = { points: [0, 1 / 4, 1 / 2, 3 / 4, 1], slots: [0, 1, 3, 5, 0] };
const RHYTHM_ANALYZER_TRIPLET_GRID = { points: [0, 1 / 3, 2 / 3, 1], slots: [0, 2, 4, 0] };
const RHYTHM_ANALYZER_SLOT_LABELS = ['1', 'e', '⅓', '&', '⅔', 'a'];
const RHYTHM_ANALYZER_BAND_NAMES = ['Low', 'Mid', 'High'];
// Bands from top to bottom (High on top) in lanes, echo rows, lens and readout, and each band's row.
const RHYTHM_ANALYZER_BAND_ORDER = [2, 1, 0];
const RHYTHM_ANALYZER_BAND_ROWS = RHYTHM_ANALYZER_BAND_NAMES.map((name, band) => RHYTHM_ANALYZER_BAND_ORDER.indexOf(band));
// Lens row height, in font sizes, from which a band label fits above its row's marks (0.35 row >= 1.25 font sizes).
const RHYTHM_ANALYZER_LENS_LABEL_ROW = 1.25 / 0.35;
// Beat LED fade after each shown event, in seconds.
const RHYTHM_ANALYZER_LED_FADE_SECONDS = 0.09;
// Ease corrections to the displayed clock and onset positions, not their audio timestamps.
const RHYTHM_ANALYZER_POSITION_SMOOTHING_MS = 100;
const RHYTHM_ANALYZER_MINUS = '−';
const RHYTHM_ANALYZER_DASH = '—';

function isNewerRhythmAnalyzerCounter(candidate, current) {
    const delta = (candidate - current) >>> 0;
    return delta !== 0 && delta < 0x80000000;
}

// Signed text following the rounded value, so values rounding to zero read '+0'.
function rhythmAnalyzerSigned(value, digits) {
    const text = (value < 0 ? -value : value).toFixed(digits);
    return `${value < 0 && Number(text) !== 0 ? RHYTHM_ANALYZER_MINUS : '+'}${text}`;
}

// Median of a numeric array (sorted in place); the mean of the middle pair for even lengths.
function rhythmAnalyzerMedian(values) {
    values.sort((a, b) => a - b);
    const middle = values.length >> 1;
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function rhythmAnalyzerRgb(color) {
    const text = String(color ?? '').trim();
    if (text[0] === '#') {
        const hex = text.length === 4 ? text.slice(1).replace(/./g, digit => digit + digit) : text.slice(1, 7);
        const value = Number.parseInt(hex, 16);
        if (hex.length === 6 && Number.isFinite(value)) return [value >> 16, (value >> 8) & 255, value & 255];
    }
    const channels = text.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    return channels?.length === 3 && channels.every(Number.isFinite) ? channels : [128, 128, 128];
}

// Position of a tempo on the 30-480 BPM axis, 0 (bottom) to 1 (top).
function rhythmAnalyzerBpmPosition(bpm) {
    const position = Math.log2(bpm / RHYTHM_ANALYZER_MIN_BPM) / RHYTHM_ANALYZER_OCTAVES;
    return position < 0 ? 0 : position > 1 ? 1 : position;
}

class RhythmAnalyzerPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({ requiresWasm: true });

    constructor() {
        super('Rhythm Analyzer', 'Shows tempo, beat grid and groove timing');
        this.initializeDisplayState();

        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundTelemetry = frame => this.handleTelemetry(frame);

        this.canvas = null;
        this.canvasCtx = null;
        this.observer = null;
        this.resizeGraphDisposer = null;
        this.isVisible = false;
        this.animationFrameId = null;
        this._onDocumentVisibility = () => this._refreshAnimationState();
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._onDocumentVisibility);

        this.registerProcessor('return data;');
    }

    // Display state shared by the effect UI and the Visualizer (which builds the
    // plugin with Object.create and never runs the constructor).
    initializeDisplayState() {
        for (const [key, value] of Object.entries(RHYTHM_ANALYZER_DEFAULTS)) this[key] ??= value;
        this.graphDpr ??= 1;
        this.activeGeneration = null;
        this.generationFence = null;
        this.timeFence = null;
        this.lastObservedTimeSeconds = null;
        this.invalidFrameReported = false;
        const columns = RHYTHM_ANALYZER_TEMPOGRAM_COLUMNS;
        this.tempogram = new Float32Array(columns * RHYTHM_ANALYZER_TEMPOGRAM_BINS);
        this.tempogramAdopted = new Float32Array(columns);
        this.tempogramConfidence = new Float32Array(columns);
        this.clockTimes = new Float64Array(RHYTHM_ANALYZER_CLOCK_CAPACITY);
        this.clockValues = new Float64Array(RHYTHM_ANALYZER_CLOCK_CAPACITY);
        const capacity = RHYTHM_ANALYZER_EVENT_CAPACITY;
        this.eventU = new Float64Array(capacity);
        this.eventTime = new Float64Array(capacity);
        this.eventLocated = new Uint8Array(capacity);
        this.eventOffsetU = new Float64Array(capacity);
        this.eventTimelineOffset = new Float64Array(capacity);
        this.eventOffsetDeviation = new Float64Array(capacity);
        this.eventCorrectionTime = new Float64Array(capacity);
        this.eventReference = new Array(capacity);
        this.eventPreviewPeriod = new Float64Array(capacity);
        this.eventPreviewTriplet = new Uint8Array(capacity);
        this.eventKeys = new Array(capacity);
        this.eventBand = new Uint8Array(capacity);
        this.eventStrength = new Float32Array(capacity);
        this.eventEpoch = new Float64Array(capacity);
        this.eventTimed = new Uint8Array(capacity);
        this.eventNovel = new Uint8Array(capacity);
        this.eventSlot = new Uint8Array(capacity);
        this.eventFraction = new Float32Array(capacity);
        this.eventRawDeviation = new Float32Array(capacity);
        this.eventDeviation = new Float32Array(capacity);
        this.clearHistory();
    }

    reset() {
        Object.assign(this, RHYTHM_ANALYZER_DEFAULTS);
        this.beginTelemetryEpoch();
        this.updateParameters();
    }

    getParameters() {
        this.ensureDspTelemetrySubscription();
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            mn: this.mn,
            mx: this.mx,
            ck: this.ck,
            sp: this.sp,
            vt: this.vt,
            vm: this.vm,
            ve: this.ve,
            vl: this.vl
        };
    }

    setParameters(params = {}) {
        if (params.enabled !== undefined) this.enabled = params.enabled !== false;
        const previous = { mn: this.mn, mx: this.mx, sp: this.sp, ck: this.ck };
        // The tempo search needs Max BPM >= 1.25 x Min BPM (same rule as the kernel and the
        // library bindings). Editing only Max BPM to a value inside its range lowers Min BPM;
        // otherwise Max BPM rises. The number box sends each typed prefix ('1' of '180'), which
        // is clamped and must not lower Min BPM.
        if (params.mn !== undefined) this.mn = this.parseFiniteNumber(params.mn, ...RHYTHM_ANALYZER_MN_RANGE, this.mn);
        if (params.mx !== undefined) {
            this.mx = this.parseFiniteNumber(params.mx, ...RHYTHM_ANALYZER_MX_RANGE, this.mx);
            const requested = Number(params.mx);
            const inRange = requested >= RHYTHM_ANALYZER_MX_RANGE[0] && requested <= RHYTHM_ANALYZER_MX_RANGE[1];
            if (params.mn === undefined && inRange && this.mx < this.mn * 1.25) this.mn = Math.floor(this.mx / 1.25);
        }
        if (this.mx < this.mn * 1.25) this.mx = Math.ceil(this.mn * 1.25);
        if (params.sp !== undefined) {
            const requested = Number(params.sp);
            if (Number.isFinite(requested)) {
                this.sp = RHYTHM_ANALYZER_SPANS.reduce((best, span) =>
                    Math.abs(span - requested) < Math.abs(best - requested) ? span : best);
            }
        }
        // The click and the panel toggles keep the analysis history.
        if (params.ck !== undefined) this.ck = Boolean(params.ck);
        if (previous.ck && !this.ck) this.clearBeatLed();
        let panelsChanged = false;
        for (const key of RHYTHM_ANALYZER_PANEL_KEYS) {
            if (params[key] === undefined) continue;
            const visible = Boolean(params[key]);
            panelsChanged ||= visible !== this[key];
            this[key] = visible;
        }
        if (this.mn !== previous.mn || this.mx !== previous.mx) this.beginTelemetryEpoch();
        else if (this.sp !== previous.sp) this.refreshNovelty();
        if (this.mn !== previous.mn || this.mx !== previous.mx || this.sp !== previous.sp || panelsChanged) this.drawGraph();
        if (panelsChanged && this.isVisible) this._refreshAnimationState();
        this.updateParameters();
    }

    _setupMessageHandler() {
        const previousWorkletNode = this._messageHandlerWorkletNode;
        super._setupMessageHandler();
        if (this.tempogram && this._messageHandlerWorkletNode !== previousWorkletNode) {
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
        if (this._dspTelemetryUnsubscribe && hub === this._dspTelemetryHub &&
            tapId === this._dspTelemetryTapId) {
            return true;
        }
        this.disposeDspTelemetrySubscription();
        try {
            const unsubscribe = hub.subscribe(tapId, RHYTHM_ANALYZER_FRAME_TYPE, this._boundTelemetry);
            if (typeof unsubscribe !== 'function') {
                hub.unsubscribe?.(tapId, RHYTHM_ANALYZER_FRAME_TYPE, this._boundTelemetry);
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
        if (frame?.frameType !== RHYTHM_ANALYZER_FRAME_TYPE ||
            ![3, RHYTHM_ANALYZER_TELEMETRY_VERSION].includes(frame.formatVersion)) return null;
        const payload = frame.payload;
        const snapshot = payload && typeof payload.getFloat32 === 'function' &&
            typeof payload.getUint32 === 'function' && typeof payload.getInt32 === 'function' &&
            typeof payload.getUint16 === 'function' && typeof payload.getUint8 === 'function' &&
            payload.byteLength === (frame.formatVersion === 3 ? 1344 : RHYTHM_ANALYZER_PAYLOAD_BYTES)
            ? this.readSnapshot(payload) : null;
        if (!snapshot && !this.invalidFrameReported) {
            this.invalidFrameReported = true;
            console.warn('Rhythm Analyzer: ignored an invalid telemetry frame', frame);
        }
        return snapshot;
    }

    readSnapshot(payload) {
        const f32 = offset => payload.getFloat32(offset, true);
        const u32 = offset => payload.getUint32(offset, true);
        const snapshot = {
            sampleRate: f32(0),
            generation: u32(4),
            hop: u32(8),
            frameCount: u32(12),
            timeSeconds: f32(16),
            latencySeconds: f32(20),
            droppedEvents: u32(24),
            eventCount: u32(28),
            trackerFlags: u32(32),
            analysisEpoch: u32(36),
            confidence: f32(40),
            periodSeconds: f32(44),
            anchorFrame: u32(48),
            anchorFraction: f32(52),
            anchorIndex: u32(56),
            strongestBpm: f32(60),
            tempogram: new Float32Array(RHYTHM_ANALYZER_TEMPOGRAM_BINS),
            events: [],
            shownBeats: [],
            forwardBeats: [],
            analysisBeats: [],
            previewBeats: null,
            previewPeriodSeconds: 0
        };
        snapshot.tickGateOpen = snapshot.trackerFlags === 1;
        snapshot.analysisValid = snapshot.periodSeconds > 0;
        snapshot.analysisAvailable = [48000, 96000, 192000].includes(snapshot.sampleRate);
        snapshot.hopSeconds = snapshot.hop / snapshot.sampleRate;
        if (!Number.isFinite(snapshot.sampleRate) || snapshot.sampleRate <= 0 || snapshot.hop === 0 ||
            snapshot.generation === 0 || !Number.isFinite(snapshot.timeSeconds) || snapshot.timeSeconds < 0 ||
            !Number.isFinite(snapshot.latencySeconds) || snapshot.latencySeconds < 0 ||
            snapshot.eventCount > RHYTHM_ANALYZER_MAX_EVENTS || snapshot.trackerFlags > 1 ||
            !Number.isFinite(snapshot.confidence) || snapshot.confidence < 0 || snapshot.confidence > 1 ||
            !Number.isFinite(snapshot.periodSeconds) || snapshot.periodSeconds < 0 ||
            !(snapshot.anchorFraction >= 0 && snapshot.anchorFraction < 1) ||
            !Number.isFinite(snapshot.strongestBpm) || snapshot.strongestBpm < 0) return null;
        for (let bin = 0; bin < RHYTHM_ANALYZER_TEMPOGRAM_BINS; bin++) {
            const value = f32(RHYTHM_ANALYZER_TEMPOGRAM_OFFSET + 4 * bin);
            if (!(value >= 0 && value <= 1)) return null;
            snapshot.tempogram[bin] = value;
        }
        for (let slot = 0; slot < snapshot.eventCount; slot++) {
            const base = RHYTHM_ANALYZER_EVENTS_OFFSET + RHYTHM_ANALYZER_EVENT_BYTES * slot;
            const beatFraction = f32(base + 16);
            const period = f32(base + 20);
            const strength = f32(base + 24);
            const band = payload.getUint8(base + 28);
            const flags = payload.getUint8(base + 29);
            const fraction = f32(base + 4);
            const annotated = flags === 0;
            const shownBeat = flags === 2;
            const forwardBeat = shownBeat || flags === 4;
            const analysisBeat = flags === 5;
            const beatSlot = forwardBeat || analysisBeat;
            if ((beatSlot ? band !== 0 : band > 2) || flags > 5 || payload.getUint16(base + 30, true) !== 0 ||
                !(fraction >= 0 && fraction < 1) || !(beatFraction >= 0 && beatFraction < 1) ||
                !Number.isFinite(period) || period < 0 || ((annotated || flags === 3 || forwardBeat) && period === 0) ||
                (beatSlot && beatFraction !== 0) || !Number.isFinite(strength) || strength > 1 ||
                (beatSlot ? strength < 0 : strength <= 0)) return null;
            const event = {
                annotated, provisional: flags === 3,
                // Analysed time of the onset (contract section 5), in seconds since the generation start.
                time: ((analysisBeat ? payload.getInt32(base, true) : u32(base)) + fraction) * snapshot.hopSeconds,
                identity: `${snapshot.generation}:${u32(base)}:${u32(base + 4)}:${band}`,
                epoch: u32(base + 8),
                index: payload.getInt32(base + 12, true),
                position: payload.getInt32(base + 12, true) + beatFraction,
                beatFraction,
                periodSeconds: period,
                strength,
                band
            };
            if (analysisBeat) snapshot.analysisBeats.push(event);
            else if (forwardBeat) {
                snapshot.forwardBeats.push(event);
                if (shownBeat) snapshot.shownBeats.push(event);
            } else snapshot.events.push(event);
        }
        if (payload.byteLength === RHYTHM_ANALYZER_PAYLOAD_BYTES) {
            const count = u32(1344);
            snapshot.previewPeriodSeconds = f32(1348);
            if (count > 12 || !Number.isFinite(snapshot.previewPeriodSeconds) || snapshot.previewPeriodSeconds < 0 ||
                (count > 0 && snapshot.previewPeriodSeconds === 0)) return null;
            snapshot.previewBeats = [];
            for (let i = 0; i < count; i++) {
                const base = 1352 + 12 * i;
                const fraction = f32(base + 4);
                if (!(fraction >= 0 && fraction < 1)) return null;
                const beat = { time: (payload.getInt32(base, true) + fraction) * snapshot.hopSeconds,
                    index: payload.getInt32(base + 8, true), epoch: snapshot.analysisEpoch,
                    periodSeconds: snapshot.previewPeriodSeconds };
                const previous = snapshot.previewBeats.at(-1);
                if (previous && (beat.time <= previous.time || beat.index !== previous.index + 1)) return null;
                snapshot.previewBeats.push(beat);
            }
        }
        return snapshot;
    }

    beginTelemetryEpoch() {
        const audioTime = window.audioContext?.currentTime;
        this.timeFence = Number.isFinite(audioTime) && audioTime >= 0
            ? Math.fround(audioTime)
            : this.lastObservedTimeSeconds;
        if (this.activeGeneration !== null) this.generationFence = this.activeGeneration;
        this.activeGeneration = null;
        this.clearHistory();
    }

    clearHistory() {
        this.tempogram.fill(0);
        this.tempogramAdopted.fill(0);
        this.tempogramConfidence.fill(0);
        this.tempogramHead = RHYTHM_ANALYZER_TEMPOGRAM_COLUMNS - 1;
        this.tempogramDirty = true;
        this.columnPhase = 0;
        this.columnOriginTime = null;
        this.columnIndex = 0;
        this.columnFrameTime = null;
        this.lastAdoptedAnchor = null;
        this.adoptedEpoch = null;
        this.lastFrameCount = null;
        this.beatClock = 0;
        this.heldPeriod = null;
        this.clockHead = RHYTHM_ANALYZER_CLOCK_CAPACITY - 1;
        this.clockCount = 0;
        this.clockAnchor = null;
        this.forwardBeats = [];
        this.forwardEpoch = null;
        this.forwardOffset = 0;
        this.forwardTail = [];
        this.previewEpoch = null;
        this.previewPeriod = 0;
        this.displayU = null;
        this.displayOffsetU = 0;
        this.displayChangeTime = 0;
        this.displayPeriod = 0;
        this.idleStartU = 0;
        this.displayTimelineOffset = 0;
        this.idleScroll = false;
        this.renderWallTime = performance.now();
        this.onsetIndices = new Map();
        this.pendingOnsets = new Set();
        this.referenceRevision = 0;
        this.eventReference.fill(null);
        // Lock segments by epoch, in arrival order: clock offset, clock range, grid vote.
        this.segments = new Map();
        this.openSegment = null;
        this.lensDisplay = null;
        this.eventSerial = 0;
        this.snapshot = null;
        this.frameBase = 0;
        this.epochBase = 0;
        this.clearBeatLed();
    }

    clearBeatLed() {
        this.pendingBeats = [];
        this.shownBeatIndices = new Map();
        this.ledBeat = null;
        this.ledLevel = 0;
        this.ledStrength = 0;
    }

    // A kernel-side reset (a track boundary of the player, a power resume) restarts the analysis with a newer
    // generation but keeps the display: the new generation's frames and lock epochs continue after the previous ones.
    spliceGeneration(generation) {
        this.pendingOnsets.clear();
        this.activeGeneration = generation;
        if (this.lastFrameCount !== null) this.frameBase = this.lastFrameCount;
        this.epochBase += 2 ** 32;
        this.lastFrameCount = null;
        this.openSegment = null;
        this.clockAnchor = null;
        this.forwardBeats = [];
        this.forwardEpoch = null;
        this.forwardOffset = this.beatClock;
        this.forwardTail = [];
        this.clearBeatLed();
    }

    rebaseSnapshot(snapshot) {
        snapshot.frameCount += this.frameBase;
        snapshot.anchorFrame += this.frameBase;
        snapshot.analysisEpoch += this.epochBase;
        for (const event of [...snapshot.events, ...snapshot.forwardBeats, ...snapshot.analysisBeats,
            ...(snapshot.previewBeats ?? [])]) {
            event.time += this.frameBase * snapshot.hopSeconds;
            event.epoch += this.epochBase;
        }
    }

    handleTelemetry(frame) {
        if (!frame || !this.enabled || !this._sectionEnabled) return;
        const snapshot = this.parseTelemetryFrame(frame);
        if (!snapshot) return;
        // A new telemetry source (Visualizer resume, worklet restart) restarts its generations.
        if (frame.source && frame.source !== this.telemetrySource) {
            this.telemetrySource = frame.source;
            this.activeGeneration = null;
            this.generationFence = null;
            this.timeFence = null;
            this.clearHistory();
        }
        const now = performance.now();
        const previousU = this.displayU === null ? null : this.displayClock(this.audioNow(now), now);
        const generationChanged = this.activeGeneration !== null && snapshot.generation !== this.activeGeneration;
        if (this.activeGeneration === null) {
            const afterTimeFence = this.timeFence === null || snapshot.timeSeconds > this.timeFence;
            const afterGenerationFence = this.generationFence !== null &&
                isNewerRhythmAnalyzerCounter(snapshot.generation, this.generationFence);
            if (!afterTimeFence && !afterGenerationFence) return;
            this.activeGeneration = snapshot.generation;
            this.generationFence = null;
            this.timeFence = null;
        } else if (snapshot.generation !== this.activeGeneration) {
            if (!isNewerRhythmAnalyzerCounter(snapshot.generation, this.activeGeneration)) return;
            this.spliceGeneration(snapshot.generation);
        }
        this.rebaseSnapshot(snapshot);
        // A stopped producer may resume at its old audio frame. Keep the elapsed display interval,
        // allowing ordinary delivery jitter within the existing two-column receipt budget.
        const interrupted = this.idleScroll || (this.snapshot && now - this.columnFrameTime -
            Math.max(0, snapshot.frameCount - this.snapshot.frameCount) * snapshot.hopSeconds * 1000 >
            RHYTHM_ANALYZER_SCROLL_LIMIT_COLUMNS * RHYTHM_ANALYZER_COLUMN_SECONDS * 1000);
        if (!this.writeTempogram(snapshot, now)) return;
        // Committed anchors come first, so lane annotations find their analysis epoch.
        this.advanceClock(snapshot);
        this.updateBeatLed(snapshot);
        const target = this.clockPosition(snapshot.frameCount * snapshot.hopSeconds);
        const period = target.period || snapshot.periodSeconds;
        if (period > 0) this.displayPeriod = period;
        const idle = (snapshot.confidence === 0 && snapshot.strongestBpm === 0) ||
            !(period > 0) || this._powerUiEnabled === false;
        if (previousU !== null && (interrupted || generationChanged)) {
            this.displayTimelineOffset = previousU - target.position;
        }
        for (const event of snapshot.events) this.storeEvent(event, now);
        this.refreshProvisionalEvents(snapshot, now);
        this.snapshot = snapshot;
        const position = target.position + this.displayTimelineOffset;
        this.displayOffsetU = idle || previousU === null ? 0 : previousU - position;
        this.displayChangeTime = now;
        this.displayU = previousU ?? position;
        this.idleStartU = this.displayU;
        this.idleScroll = idle;
        if (snapshot.analysisValid && this.openSegment) this.openSegment.displayOffset = this.displayTimelineOffset;
        this.lastObservedTimeSeconds = snapshot.timeSeconds;
    }

    handleVisualizerTelemetry(frame) {
        this.handleTelemetry(frame);
    }

    // Writes the frame's tempogram column; columns advance with analysed time, and the newest one holds the latest
    // frame. The display scrolls smoothly between frames (tempogramScroll).
    writeTempogram(snapshot, wallTime = performance.now()) {
        const columns = RHYTHM_ANALYZER_TEMPOGRAM_COLUMNS;
        const now = snapshot.frameCount * snapshot.hopSeconds;
        let advance = 1;
        if (this.lastFrameCount !== null) {
            const delta = (snapshot.frameCount - this.lastFrameCount) >>> 0;
            if (delta >= 0x80000000) return false;
        }
        if (this.columnOriginTime === null) this.columnOriginTime = now;
        else {
            const position = (now - this.columnOriginTime) / RHYTHM_ANALYZER_COLUMN_SECONDS;
            const columnIndex = Math.floor(position);
            advance = columnIndex - this.columnIndex;
            this.columnPhase = position - columnIndex;
            this.columnIndex = columnIndex;
        }
        if (advance >= columns) {
            this.tempogram.fill(0);
            this.tempogramAdopted.fill(0);
            this.tempogramConfidence.fill(0);
            advance = 1;
        }
        const first = advance === 0 ? 0 : 1;
        for (let step = first; step <= advance; step++) {
            const column = (this.tempogramHead + step) % columns;
            this.tempogram.set(snapshot.tempogram, column * RHYTHM_ANALYZER_TEMPOGRAM_BINS);
            if (advance > 0) this.tempogramAdopted[column] = 0;
            // Confidence shades analysis independently of whether new ticks are shown.
            this.tempogramConfidence[column] = snapshot.confidence;
        }
        this.tempogramHead = (this.tempogramHead + advance) % columns;
        if (snapshot.analysisValid) {
            const anchor = (snapshot.anchorFrame + snapshot.anchorFraction) * snapshot.hopSeconds;
            if (this.adoptedEpoch !== snapshot.analysisEpoch) this.lastAdoptedAnchor = null;
            if (this.lastAdoptedAnchor === null || anchor > this.lastAdoptedAnchor) {
                const age = this.columnIndex - Math.floor((anchor - this.columnOriginTime) / RHYTHM_ANALYZER_COLUMN_SECONDS);
                const previousAge = this.lastAdoptedAnchor === null ? age
                    : this.columnIndex - Math.floor((this.lastAdoptedAnchor - this.columnOriginTime) / RHYTHM_ANALYZER_COLUMN_SECONDS);
                // Fill newly committed history at its audio time, leaving older committed columns untouched.
                for (let distance = Math.max(0, age); distance <= previousAge && distance < columns; distance++) {
                    const column = (this.tempogramHead + columns - distance) % columns;
                    if (this.tempogramAdopted[column] > 0) continue;
                    this.tempogramAdopted[column] = 60 / snapshot.periodSeconds;
                    this.tempogramConfidence[column] = snapshot.confidence;
                }
                this.lastAdoptedAnchor = anchor;
                this.adoptedEpoch = snapshot.analysisEpoch;
            }
        }
        this.tempogramDirty = true;
        this.columnFrameTime = wallTime;
        this.lastFrameCount = snapshot.frameCount;
        return true;
    }

    // How far the tempogram is drawn left of its column slots, in columns: the newest column's analysed age plus the
    // capped wall-clock time since its frame arrived. A head advance lowers it by the columns advanced, so the
    // content never jumps.
    tempogramScroll() {
        if (this.columnFrameTime === null) return this.columnPhase;
        const elapsed = (performance.now() - this.columnFrameTime) / 1000 / RHYTHM_ANALYZER_COLUMN_SECONDS;
        return this.columnPhase + (elapsed < RHYTHM_ANALYZER_SCROLL_LIMIT_COLUMNS ? elapsed : RHYTHM_ANALYZER_SCROLL_LIMIT_COLUMNS);
    }

    // Committed beats define immutable history; ungated forward beats continue its newest clock.
    advanceClock(snapshot) {
        for (const beat of snapshot.forwardBeats) {
            if (this.forwardEpoch !== beat.epoch) {
                if (this.forwardEpoch !== null) this.forwardOffset = this.beatClock;
                this.forwardEpoch = beat.epoch;
                this.forwardBeats = [];
                this.clockAnchor = null;
            }
            if (!this.forwardBeats.some(previous => previous.index === beat.index)) this.forwardBeats.push(beat);
        }
        this.forwardBeats.sort((a, b) => a.time - b.time || a.index - b.index);
        if (this.forwardBeats.length > RHYTHM_ANALYZER_CLOCK_CAPACITY) {
            this.forwardBeats.splice(0, this.forwardBeats.length - RHYTHM_ANALYZER_CLOCK_CAPACITY);
        }
        for (const beat of snapshot.analysisBeats) {
            const segment = this.analysisSegment(beat.epoch, beat.index);
            if (!this.clockCount || beat.time > this.clockTimes[this.clockHead]) {
                this.clockHead = (this.clockHead + 1) % RHYTHM_ANALYZER_CLOCK_CAPACITY;
                this.clockTimes[this.clockHead] = beat.time;
                this.clockValues[this.clockHead] = beat.index + segment.offset;
                if (this.clockCount < RHYTHM_ANALYZER_CLOCK_CAPACITY) this.clockCount++;
            }
            if (beat.epoch === snapshot.analysisEpoch &&
                (!this.clockAnchor || beat.epoch !== this.clockAnchor.epoch || beat.time > this.clockAnchor.time)) this.clockAnchor = beat;
            segment.endU = beat.index + segment.offset;
            this.beatClock = segment.endU;
        }
        if (snapshot.analysisValid) {
            const time = (snapshot.anchorFrame + snapshot.anchorFraction) * snapshot.hopSeconds;
            const segment = this.analysisSegment(snapshot.analysisEpoch, snapshot.anchorIndex);
            if (!this.clockAnchor || time >= this.clockAnchor.time) this.clockAnchor = {
                time, index: snapshot.anchorIndex, epoch: snapshot.analysisEpoch, periodSeconds: snapshot.periodSeconds
            };
            this.beatClock = snapshot.anchorIndex + segment.offset;
            segment.endU = this.beatClock;
            this.openSegment = segment;
            this.heldPeriod = snapshot.periodSeconds;
        } else {
            if (this.clockAnchor && this.clockAnchor.epoch !== snapshot.analysisEpoch) {
                this.clockAnchor = null;
                this.forwardBeats = [];
            }
            this.openSegment = null;
        }
        const anchor = this.clockAnchor;
        let matched = null;
        let distance = Infinity;
        for (const beat of this.forwardBeats) {
            if (!anchor) break;
            const period = anchor.periodSeconds > 0 ? Math.min(anchor.periodSeconds, beat.periodSeconds) : beat.periodSeconds;
            const delta = Math.abs(beat.time - anchor.time);
            if (delta <= 0.5 * period && delta < distance) {
                matched = beat;
                distance = delta;
            }
        }
        this.forwardTail = [];
        for (const beat of this.forwardBeats) {
            if ((anchor && (beat.time <= anchor.time || beat === matched)) ||
                this.forwardTail.at(-1)?.time === beat.time) continue;
            this.forwardTail.push({ ...beat, position: anchor ? anchor.index + 1 + this.forwardTail.length
                : this.forwardBeats[0].index + this.forwardTail.length });
        }
        this.previewPeriod = snapshot.previewPeriodSeconds;
        this.previewEpoch = snapshot.previewBeats?.length ? snapshot.analysisEpoch : null;
        if (this.previewEpoch !== null) {
            const segment = this.analysisSegment(this.previewEpoch, snapshot.previewBeats[0].index);
            if (!anchor) this.forwardOffset = segment.offset;
            this.forwardTail = snapshot.previewBeats.filter(beat => !anchor || beat.time > anchor.time)
                .map(beat => ({ ...beat, position: beat.index }));
        }
    }

    analysisSegment(epoch, index) {
        let segment = this.segments.get(epoch);
        if (segment) return segment;
        segment = { epoch, offset: this.beatClock - index, startU: this.beatClock, endU: this.beatClock,
            reanchor: this.openSegment !== null, straight: 0, triplet: 0 };
        this.segments.set(epoch, segment);
        if (this.segments.size > RHYTHM_ANALYZER_MAX_SEGMENTS) this.segments.delete(this.segments.keys().next().value);
        return segment;
    }

    // Receive immutable shown events immediately; future beats wait until their audio time arrives.
    updateBeatLed(snapshot) {
        if (snapshot.confidence === 0 && snapshot.strongestBpm === 0) {
            this.clearBeatLed();
        }
        const now = snapshot.frameCount * snapshot.hopSeconds;
        for (const event of snapshot.shownBeats) {
            const previous = this.shownBeatIndices.get(event.epoch);
            if (previous !== undefined && event.index <= previous) continue;
            this.shownBeatIndices.set(event.epoch, event.index);
            if (this.shownBeatIndices.size > RHYTHM_ANALYZER_MAX_SEGMENTS) {
                this.shownBeatIndices.delete(this.shownBeatIndices.keys().next().value);
            }
            this.pendingBeats.push({ time: event.time > now ? event.time : now, strength: event.strength });
        }
        this.pendingBeats.sort((a, b) => a.time - b.time);
        this.advanceBeatLed(now);
    }

    advanceBeatLed(now) {
        while (this.pendingBeats.length && this.pendingBeats[0].time <= now) {
            const event = this.pendingBeats.shift();
            this.ledBeat = event.time;
            this.ledStrength = event.strength;
        }
        const level = this.ledBeat === null ? 0 : 1 - (now - this.ledBeat) / RHYTHM_ANALYZER_LED_FADE_SECONDS;
        this.ledLevel = (level > 0 ? level : 0) * this.ledStrength;
    }

    // Same target mapping as the producer, before any display-only correction.
    clockPosition(time) {
        const anchor = this.clockAnchor;
        const offset = anchor ? this.segments.get(anchor.epoch)?.offset ?? 0 : this.forwardOffset;
        if (anchor && time <= anchor.time && this.clockCount) {
            let index = this.clockHead;
            if (time >= this.clockTimes[index]) {
                const left = this.clockTimes[index];
                const period = anchor.time - left;
                return { position: period > 0 ? this.clockValues[index] + (time - left) / period *
                    (anchor.index + offset - this.clockValues[index]) : anchor.index + offset, period };
            }
            for (let step = 1; step < this.clockCount; step++) {
                const older = (index + RHYTHM_ANALYZER_CLOCK_CAPACITY - 1) % RHYTHM_ANALYZER_CLOCK_CAPACITY;
                const period = this.clockTimes[index] - this.clockTimes[older];
                if (time >= this.clockTimes[older]) return {
                    position: this.clockValues[older] + (time - this.clockTimes[older]) / period *
                        (this.clockValues[index] - this.clockValues[older]), period
                };
                index = older;
            }
            return { position: this.clockValues[index], period: 0 };
        }
        let left = anchor ? { time: anchor.time, position: anchor.index + offset,
            periodSeconds: this.previewPeriod || anchor.periodSeconds } : null;
        for (const beat of this.forwardTail) {
            const right = { ...beat, position: beat.position + offset };
            if (time <= right.time) {
                if (!left) return { position: right.position + (time - right.time) / right.periodSeconds,
                    period: right.periodSeconds };
                const period = right.time - left.time;
                return { position: left.position + (time - left.time) / period, period };
            }
            left = right;
        }
        return left?.periodSeconds > 0 ? { position: left.position + (time - left.time) / left.periodSeconds,
            period: left.periodSeconds } : { position: left?.position ?? this.beatClock, period: 0 };
    }

    clockAt(time) {
        return this.clockPosition(time).position;
    }

    audioNow(wallTime = performance.now()) {
        return this.snapshot ? this.snapshot.frameCount * this.snapshot.hopSeconds +
            Math.max(0, wallTime - this.columnFrameTime) / 1000 : 0;
    }

    displayClock(audioTime, wallTime) {
        if (this.idleScroll || this._powerUiEnabled === false) {
            return this.idleStartU + (this.displayPeriod > 0
                ? Math.max(0, wallTime - this.displayChangeTime) / 1000 / this.displayPeriod : 0);
        }
        const weight = Math.exp(-Math.max(0, wallTime - this.displayChangeTime) / RHYTHM_ANALYZER_POSITION_SMOOTHING_MS);
        return this.clockAt(audioTime) + this.displayTimelineOffset + this.displayOffsetU * weight;
    }

    displayedEvent(index, wallTime = this.renderWallTime) {
        const weight = Math.exp(-Math.max(0, wallTime - this.eventCorrectionTime[index]) / RHYTHM_ANALYZER_POSITION_SMOOTHING_MS);
        return { u: this.eventU[index] + this.eventTimelineOffset[index] + this.eventOffsetU[index] * weight,
            deviation: this.eventDeviation[index] + this.eventOffsetDeviation[index] * weight };
    }

    // Preserve the onset's wire identity when provisional positions are replaced with committed annotations.
    storeEvent(event, now = performance.now()) {
        const previousSerial = this.onsetIndices.get(event.identity);
        const serial = previousSerial ?? this.eventSerial++;
        const index = serial % RHYTHM_ANALYZER_EVENT_CAPACITY;
        if (previousSerial !== undefined && this.eventTimed[index]) return;
        const previous = previousSerial === undefined ? null : this.displayedEvent(index, now);
        if (previousSerial === undefined) {
            this.pendingOnsets.delete(serial - RHYTHM_ANALYZER_EVENT_CAPACITY);
            this.eventReference[index] = null;
            this.onsetIndices.delete(this.eventKeys[index]);
            this.eventKeys[index] = event.identity;
            this.onsetIndices.set(event.identity, serial);
            this.eventTimelineOffset[index] = this.displayTimelineOffset;
        }
        const segment = event.annotated || event.provisional ? this.segments.get(event.epoch) : undefined;
        const u = segment ? event.position + segment.offset : this.clockAt(event.time);
        this.eventU[index] = u;
        this.eventTime[index] = event.time;
        this.eventBand[index] = event.band;
        this.eventStrength[index] = event.strength;
        this.eventEpoch[index] = event.epoch;
        const wasTimed = this.eventTimed[index];
        this.eventTimed[index] = event.annotated && segment ? 1 : 0;
        if (wasTimed || this.eventTimed[index]) this.referenceRevision++;
        if (event.annotated || (previousSerial !== undefined && !event.provisional)) this.pendingOnsets.delete(serial);
        else this.pendingOnsets.add(serial);
        this.eventLocated[index] = event.annotated || event.provisional ? 1 : 0;
        this.eventNovel[index] = 0;
        this.eventDeviation[index] = 0;
        if (event.annotated || event.provisional) this.annotateEvent(event, segment, serial, u);
        this.eventOffsetU[index] = previous ? previous.u - u - this.eventTimelineOffset[index] : 0;
        this.eventOffsetDeviation[index] = previous ? previous.deviation - this.eventDeviation[index] : 0;
        this.eventCorrectionTime[index] = now;
    }

    // Each fresh path corrects recent onsets at their original audio timestamps.
    refreshProvisionalEvents(snapshot, now) {
        if (!snapshot.previewBeats?.length) return;
        const epoch = snapshot.analysisEpoch;
        const segment = this.segments.get(epoch);
        for (const serial of this.pendingOnsets) {
            const index = serial % RHYTHM_ANALYZER_EVENT_CAPACITY;
            if (this.eventEpoch[index] !== this.epochBase && this.eventEpoch[index] !== epoch) {
                this.pendingOnsets.delete(serial);
                continue;
            }
            const target = this.clockPosition(this.eventTime[index]);
            if (!(target.period > 0)) continue;
            const position = target.position - segment.offset;
            const fraction = position - Math.floor(position);
            if (this.eventLocated[index] && this.eventEpoch[index] === epoch && this.eventU[index] === target.position &&
                this.eventPreviewPeriod[index] === target.period &&
                this.eventPreviewTriplet[index] === (segment.triplet > segment.straight ? 1 : 0) &&
                this.eventReference[index]?.revision === this.referenceRevision) continue;
            const previous = this.displayedEvent(index, now);
            this.eventPreviewPeriod[index] = target.period;
            this.eventPreviewTriplet[index] = segment.triplet > segment.straight ? 1 : 0;
            this.eventU[index] = target.position;
            this.eventEpoch[index] = epoch;
            this.eventLocated[index] = 1;
            this.annotateEvent({ beatFraction: fraction, periodSeconds: target.period, epoch, annotated: false },
                segment, serial, target.position);
            if (previous.u !== target.position + this.eventTimelineOffset[index] || previous.deviation !== this.eventDeviation[index]) {
                this.eventOffsetU[index] = previous.u - target.position - this.eventTimelineOffset[index];
                this.eventOffsetDeviation[index] = previous.deviation - this.eventDeviation[index];
                this.eventCorrectionTime[index] = now;
            }
        }
    }

    annotateEvent(event, segment, serial, u) {
        const index = serial % RHYTHM_ANALYZER_EVENT_CAPACITY;
        const fraction = event.beatFraction;
        const nearest = grid => {
            let best = 0;
            for (let point = 1; point < grid.points.length; point++) {
                const distance = fraction - grid.points[point];
                const bestDistance = fraction - grid.points[best];
                if ((distance < 0 ? -distance : distance) < (bestDistance < 0 ? -bestDistance : bestDistance)) best = point;
            }
            return best;
        };
        // Per-epoch vote between straight 16ths and triplet 8ths decides the snap grid.
        const straight = nearest(RHYTHM_ANALYZER_STRAIGHT_GRID);
        const triplet = nearest(RHYTHM_ANALYZER_TRIPLET_GRID);
        const straightDistance = fraction - RHYTHM_ANALYZER_STRAIGHT_GRID.points[straight];
        const tripletDistance = fraction - RHYTHM_ANALYZER_TRIPLET_GRID.points[triplet];
        const straightError = straightDistance < 0 ? -straightDistance : straightDistance;
        const tripletError = tripletDistance < 0 ? -tripletDistance : tripletDistance;
        if (event.annotated && segment) {
            if (straightError < tripletError) segment.straight++;
            else if (tripletError < straightError) segment.triplet++;
        }
        const useTriplet = segment && segment.triplet > segment.straight;
        const grid = useTriplet ? RHYTHM_ANALYZER_TRIPLET_GRID : RHYTHM_ANALYZER_STRAIGHT_GRID;
        const point = useTriplet ? triplet : straight;
        const raw = (fraction - grid.points[point]) * event.periodSeconds * 1000;
        this.eventSlot[index] = grid.slots[point];
        this.eventFraction[index] = fraction;
        this.eventRawDeviation[index] = raw;
        // Relative timing: the median offset of the epoch's previous 16 beats is common latency, not groove.
        this.eventDeviation[index] = raw - this.referenceDeviation(serial, u, event.epoch);
        this.eventNovel[index] = this.eventTimed[index] && this.isNovel(serial) ? 1 : 0;
    }

    // First ring serial that has not been overwritten yet.
    oldestSerial() {
        const oldest = this.eventSerial - RHYTHM_ANALYZER_EVENT_CAPACITY;
        return oldest > 0 ? oldest : 0;
    }

    // Visits stored onsets with from <= u <= to, newest first. The ring is in arrival order, which is
    // close to clock order, so the scan stops one beat below the range.
    forEachEvent(from, to, visit, beforeSerial = this.eventSerial, displayed = false) {
        const oldest = this.oldestSerial();
        for (let serial = beforeSerial - 1; serial >= oldest; serial--) {
            const index = serial % RHYTHM_ANALYZER_EVENT_CAPACITY;
            const u = displayed ? this.displayedEvent(index).u : this.eventU[index];
            if (!displayed && u < from - 1) break;
            if (u >= from && u <= to) visit(index);
        }
    }

    // Cache both the reference members and the coordinate range in which those members stay unchanged.
    referenceDeviation(serial, u, epoch) {
        const index = serial % RHYTHM_ANALYZER_EVENT_CAPACITY;
        const cached = this.eventReference[index];
        const sameEvent = cached?.serial === serial && cached.epoch === epoch;
        if (sameEvent && cached.revision === this.referenceRevision && u >= cached.lower && u < cached.upper) return cached.median;
        const values = [];
        const members = [];
        let lower = -Infinity;
        let upper = Infinity;
        for (let previous = serial - 1; previous >= this.oldestSerial(); previous--) {
            const other = previous % RHYTHM_ANALYZER_EVENT_CAPACITY;
            if (!this.eventTimed[other] || this.eventEpoch[other] !== epoch) continue;
            const position = this.eventU[other];
            if (position > u) upper = Math.min(upper, position);
            else if (position <= u - RHYTHM_ANALYZER_REFERENCE_BEATS) lower = Math.max(lower, position + RHYTHM_ANALYZER_REFERENCE_BEATS);
            else {
                lower = Math.max(lower, position);
                upper = Math.min(upper, position + RHYTHM_ANALYZER_REFERENCE_BEATS);
                members.push(previous);
                values.push(this.eventRawDeviation[other]);
            }
        }
        const unchanged = sameEvent && members.length === cached.members.length &&
            members.every((member, i) => member === cached.members[i]);
        const median = unchanged ? cached.median : values.length >= RHYTHM_ANALYZER_MIN_EVENTS ? rhythmAnalyzerMedian(values) : 0;
        this.eventReference[index] = { serial, epoch, revision: this.referenceRevision, lower, upper, members, median };
        return median;
    }

    // A timed onset is new when the same band had no timed onset one or two spans earlier in its epoch.
    isNovel(serial) {
        const index = serial % RHYTHM_ANALYZER_EVENT_CAPACITY;
        const segment = this.segments.get(this.eventEpoch[index]);
        const span = this.sp;
        const u = this.eventU[index];
        if (!segment || u - span < segment.startU + 0.5) return false;
        const band = this.eventBand[index];
        const epoch = this.eventEpoch[index];
        const matches = target => {
            let hit = false;
            this.forEachEvent(target - RHYTHM_ANALYZER_MATCH_BEATS, target + RHYTHM_ANALYZER_MATCH_BEATS, other => {
                if (this.eventTimed[other] && this.eventBand[other] === band && this.eventEpoch[other] === epoch &&
                    this.eventU[other] > target - RHYTHM_ANALYZER_MATCH_BEATS &&
                    this.eventU[other] < target + RHYTHM_ANALYZER_MATCH_BEATS) hit = true;
            }, serial);
            return hit;
        };
        return !(matches(u - span) || (u - 2 * span >= segment.startU && matches(u - 2 * span)));
    }

    // Re-evaluates the novelty rings for a new span.
    refreshNovelty() {
        for (let serial = this.oldestSerial(); serial < this.eventSerial; serial++) {
            const index = serial % RHYTHM_ANALYZER_EVENT_CAPACITY;
            this.eventNovel[index] = this.eventTimed[index] && this.isNovel(serial) ? 1 : 0;
        }
    }

    // Beat lens of the current epoch over the last 32 beats: per band and slot, the offset from the
    // weighted-median slot and the spread, plus swing and jitter. Requires a committed analysis anchor.
    lensSummary() {
        const segment = this.snapshot?.analysisValid ? this.openSegment : null;
        if (!segment) return null;
        const count = new Float64Array(18);
        const sum = new Float64Array(18);
        const squareSum = new Float64Array(18);
        const fractions = [];
        this.forEachEvent(this.beatClock - RHYTHM_ANALYZER_LENS_BEATS, Infinity, index => {
            if (!this.eventTimed[index] || this.eventEpoch[index] !== segment.epoch ||
                this.eventU[index] <= this.beatClock - RHYTHM_ANALYZER_LENS_BEATS) return;
            const cell = this.eventBand[index] * 6 + this.eventSlot[index];
            const deviation = this.eventDeviation[index];
            count[cell]++;
            sum[cell] += deviation;
            squareSum[cell] += deviation * deviation;
            const fraction = this.eventFraction[index];
            if (fraction > 0.4 && fraction < 0.8) fractions.push(fraction);
        });
        const rows = [];
        let total = 0;
        let spread = 0;
        for (let cell = 0; cell < 18; cell++) {
            if (count[cell] < RHYTHM_ANALYZER_MIN_EVENTS) continue;
            const mean = sum[cell] / count[cell];
            const variance = squareSum[cell] / count[cell] - mean * mean;
            const sd = Math.sqrt(variance > 0 ? variance : 0);
            rows.push({ band: Math.floor(cell / 6), slot: cell % 6, mean, sd, count: count[cell] });
            total += count[cell];
            spread += count[cell] * sd * sd;
        }
        if (rows.length) {
            const sorted = [...rows].sort((a, b) => a.mean - b.mean);
            let cumulative = 0;
            const reference = sorted.find(row => (cumulative += row.count) >= 0.5 * total).mean;
            for (const row of rows) row.offset = row.mean - reference;
        }
        const swing = fractions.length >= RHYTHM_ANALYZER_MIN_EVENTS ? rhythmAnalyzerMedian(fractions) : NaN;
        return {
            rows,
            swing: swing / (1 - swing),
            jitter: rows.length ? Math.sqrt(spread / total) : NaN
        };
    }

    // Ease each band's slot independently in wall-clock time, keeping the analysis unchanged.
    displayedLensSummary(lens) {
        if (!lens) {
            this.lensDisplay = null;
            return null;
        }
        const now = performance.now();
        const epoch = this.openSegment?.epoch;
        const previous = this.lensDisplay?.epoch === epoch ? this.lensDisplay : null;
        const weight = previous ? 1 - Math.exp(-(now - previous.time) / RHYTHM_ANALYZER_LENS_SMOOTHING_MS) : 1;
        const cells = new Array(18);
        const rows = lens.rows.map(row => {
            const cell = row.band * 6 + row.slot;
            const from = previous?.cells[cell];
            const displayed = {
                ...row,
                offset: from ? from.offset + weight * (row.offset - from.offset) : row.offset,
                sd: from ? from.sd + weight * (row.sd - from.sd) : row.sd
            };
            cells[cell] = displayed;
            return displayed;
        });
        this.lensDisplay = { epoch, time: now, cells };
        return { ...lens, rows };
    }

    createUI() {
        this.ensureDspTelemetrySubscription();
        this.observer?.disconnect();
        this.resizeGraphDisposer?.();
        this.resizeGraphDisposer = null;
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';
        // Two columns on desktop, one on mobile (css/effetune.css and css/effetune-mobile.css).
        const parameters = document.createElement('div');
        parameters.className = 'analyzer-parameters';
        parameters.appendChild(this.createParameterControl(
            'Min BPM', ...RHYTHM_ANALYZER_MN_RANGE, 1, this.mn,
            value => {
                this.setParameters({ mn: value });
                this.syncUIControls?.();
            }, 'BPM', 'mn'
        ));
        parameters.appendChild(this.createParameterControl(
            'Max BPM', ...RHYTHM_ANALYZER_MX_RANGE, 1, this.mx,
            value => {
                this.setParameters({ mx: value });
                this.syncUIControls?.();
            }, 'BPM', 'mx'
        ));
        parameters.appendChild(this.createCheckboxControl(
            'Metronome Click', this.ck, value => this.setParameters({ ck: value }), 'ck'
        ));
        parameters.appendChild(this.createSelectControl(
            'Span (beats)', RHYTHM_ANALYZER_SPANS.map(String), String(this.sp),
            value => this.setParameters({ sp: value }), 'sp'
        ));
        [['Tempogram', 'vt'], ['Timing lanes', 'vm'], ['Echo rows', 've'], ['Beat lens', 'vl']].forEach(([label, key]) => {
            parameters.appendChild(this.createCheckboxControl(
                label, this[key], value => this.setParameters({ [key]: value }), key
            ));
        });
        container.appendChild(parameters);
        const graph = this.createResponsiveGraph({
            maxWidth: 1024,
            aspectRatio: '3 / 2',
            mobileAspectRatio: '3 / 4',
            onResize: ({ canvas, cssWidth, dpr }) => {
                this.canvas = canvas;
                this.graphCssWidth = cssWidth;
                this.graphDpr = dpr;
                this.canvasCtx = canvas.getContext('2d', { alpha: false });
                this.drawGraph();
            }
        });
        this.canvas = graph.canvas;
        this.canvasCtx = this.canvas.getContext('2d', { alpha: false });
        this.resizeGraphDisposer = graph.dispose;
        this.canvas.setAttribute('aria-label', 'Tempo history, beat timing and groove');
        container.appendChild(graph.container);
        const resetButton = document.createElement('button');
        resetButton.className = 'analog-meter-reset-button';
        resetButton.textContent = 'Reset';
        resetButton.title = 'Restart the rhythm analysis';
        resetButton.addEventListener('click', () => this.resetAnalysis());
        container.appendChild(resetButton);
        if (typeof IntersectionObserver === 'function') {
            this.observer = new IntersectionObserver(this.handleIntersect.bind(this));
            this.observer.observe(this.canvas);
        } else {
            this.drawGraph();
        }
        this._graphReadout = window.GraphReadout?.attach({
            mount: graph.container,
            surface: this.canvas,
            plot: point => this._readoutPanel(point),
            read: (x, y) => this._readRhythm(x, y),
            avoid: () => this._readoutFrame?.header ?? [],
            crosshair: 'xy'
        });
        return container;
    }

    // Sends the worklet-side reset over the same port that carries parameter updates.
    resetAnalysis() {
        if (this.audioHostActive !== false) {
            window.workletNode?.port?.postMessage({ type: 'resetPluginState', pluginId: this.id });
        }
        this.beginTelemetryEpoch();
        this.drawGraph();
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

    // Only this visible display keeps moving while DSP/UI telemetry is idle; audio remains asleep.
    canRunAnimation() {
        if (typeof document !== 'undefined' && document.hidden) return false;
        return super.canRunAnimation() || (this.enabled !== false && this._sectionEnabled !== false &&
            this.isVisible && (this.vm || this.ve) && this.displayPeriod > 0);
    }

    setPowerUiEnabled(enabled) {
        if (enabled === false && this._powerUiEnabled !== false && this.displayU !== null) {
            const now = performance.now();
            this.displayU = this.displayClock(this.audioNow(now), now);
            this.idleStartU = this.displayU;
            this.displayChangeTime = now;
            this.idleScroll = true;
        }
        super.setPowerUiEnabled(enabled);
    }

    startAnimation() {
        if (this.animationFrameId !== null || !this.enabled || !this._sectionEnabled) return;
        const animate = () => {
            if (!this.isVisible) {
                this.stopAnimation();
                return;
            }
            this.drawGraph();
            this.animationFrameId = this.requestPowerAnimationFrame(animate, 'analyzer');
        };
        animate();
    }

    stopAnimation() {
        if (this.animationFrameId === null) return;
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
    }

    drawGraph() {
        if (!this.canvas || !this.canvasCtx) {
            this._graphReadout?.refresh();
            return;
        }
        const context = this.canvasCtx;
        const read = role => window.ThemePalette?.get(role) ?? '';
        const trace = read('graph-trace');
        context.fillStyle = read('graph-bg-deep');
        context.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawGroove(context, {
            width: this.canvas.width,
            height: this.canvas.height,
            palette: this._structurePalette(read),
            showText: true,
            showAxes: true,
            text: context,
            drawSignal: (target, draw) => draw(target),
            markerColor: () => trace
        });
        this._graphReadout?.refresh();
    }

    drawVisualizerRhythm() {
        const canvas = this.canvas;
        const context = this.ctx;
        if (!canvas || !context) return;
        const options = this.displayOptions || {};
        const read = role => options.themePalette?.get(role) ?? '';
        context.clearRect(0, 0, canvas.width, canvas.height);
        this.drawGroove(context, {
            width: canvas.width,
            height: canvas.height,
            palette: this._structurePalette(read),
            showText: options.showAxisNumbers !== false,
            showAxes: options.showAxes !== false,
            visualizer: true,
            text: options.textContext ?? context,
            drawSignal: options.drawSignal ?? ((target, draw) => draw(target)),
            positionColor: options.markerColor,
            tempogramColor: options.tempogramColor,
            markerColor: options.markerColor
                ? bpm => options.markerColor(rhythmAnalyzerBpmPosition(bpm)) : () => read('graph-trace')
        });
        const gateOpen = this.snapshot?.tickGateOpen === true;
        const period = this.snapshot?.periodSeconds;
        const bpm = period > 0 ? 60 / period : NaN;
        const color = options.markerColor
            ? options.markerColor(rhythmAnalyzerBpmPosition(Number.isFinite(bpm) ? bpm : 120)) : read('graph-trace');
        const style = options.beatStyle;
        const scale = options.textScale ?? this.graphDpr ?? 1;
        const lineWidth = style ? style.beatLineWidth * scale : this.graphDpr || 1;
        const diameter = (style ? style.beatSize / 100 : 0.608) * Math.min(canvas.width, canvas.height);
        const radius = Math.max(0, (diameter - lineWidth) / 2);
        if (options.showBeat !== false) {
            // Continue the fade between telemetry frames, but only a detected beat
            // can start a new pulse. Paused telemetry therefore fades to transparency.
            const ageMs = this.ledBeat !== null
                ? Math.max(0, (this.snapshot.frameCount * this.snapshot.hopSeconds - this.ledBeat) * 1000 +
                    (this.columnFrameTime === null ? 0 : performance.now() - this.columnFrameTime)) : Infinity;
            const decayMs = Math.max(0, ageMs - (style?.beatHoldTime ?? 0));
            const level = this.ledStrength * Math.exp(-decayMs / (style?.beatDecayTime ?? RHYTHM_ANALYZER_LED_FADE_SECONDS * 1000));
            const size = radius / 0.38;
            const draw = options.drawSignal ?? ((target, paint) => paint(target));
            draw(context, target => {
                target.save();
                this._drawBeatLed(target, { level: gateOpen || level > 0 ? level : null, minimumLevel: 0,
                    color: style && !style.beatUsePalette ? style.beatFillColor : color,
                    strokeColor: style && !style.beatUsePalette ? style.beatStrokeColor : color,
                    fillOpacity: style?.beatFillOpacity ?? 0.3, strokeOpacity: style?.beatStrokeOpacity ?? 1 },
                    (canvas.width - size) / 2, canvas.height / 2, size, lineWidth);
                target.restore();
            }, { palette: style?.beatUsePalette !== false });
        }
        if (options.showBpm !== false) {
            const value = Number.isFinite(bpm) ? bpm.toFixed(1) : RHYTHM_ANALYZER_DASH;
            const fit = options.showBeat !== false && style?.beatFitBpm &&
                style.align === 'center' && (style.verticalAlign ?? 'middle') === 'middle';
            context.save();
            context.globalAlpha = this.snapshot?.confidence ?? 0;
            options.drawBpm?.(context, `${value} BPM`, color, fit ? Math.max(1, radius - lineWidth / 2 - 6 * scale) : undefined);
            context.restore();
        }
    }

    _structurePalette(read) {
        return {
            label: read('graph-label'),
            axis: read('text-primary'),
            background: read('graph-bg-deep'),
            strongGrid: read('graph-grid-strong'),
            subtleGrid: read('graph-grid-subtle')
        };
    }

    // Header items flow left to right and wrap; an item wider than a line is scaled down to fit. A part with a
    // live value reserves the width of its worst-case `slot` text, so changing values never reflow the header.
    _layoutHeader(context, items, width, pad, fontSize) {
        const gap = 1.5 * fontSize;
        const partGap = 0.8 * fontSize;
        const lineHeight = 1.35 * fontSize;
        const available = width - 2 * pad;
        context.font = `${fontSize}px Arial`;
        let x = pad;
        let top = pad;
        const placed = [];
        for (const item of items) {
            const widths = item.map(part => (part.lamp ? fontSize : context.measureText(part.slot ?? part.text).width));
            const naturalWidth = widths.reduce((sum, value) => sum + value, 0) + partGap * (item.length - 1);
            const scale = naturalWidth > available ? available / naturalWidth : 1;
            const itemWidth = naturalWidth * scale;
            if (x > pad && x + itemWidth > width - pad) {
                x = pad;
                top += lineHeight;
            }
            placed.push({ item, widths, scale, left: x, top, width: itemWidth, height: 1.2 * fontSize * scale });
            x += itemWidth + gap;
        }
        return { placed, bottom: top + lineHeight };
    }

    _headerItems(lens, palette, markerColor) {
        const snapshot = this.snapshot;
        const gateOpen = snapshot?.tickGateOpen === true;
        const period = snapshot?.periodSeconds;
        const bpm = period > 0 ? 60 / period : NaN;
        const value = (number, text) => (Number.isFinite(number) ? text : RHYTHM_ANALYZER_DASH);
        const tempo = snapshot?.analysisAvailable === false ? 'Analysis unavailable at this sample rate'
            : `${Number.isFinite(bpm) ? `${bpm.toFixed(1)} BPM  ` : ''}${gateOpen ? 'LOCKED' : 'searching'}`;
        const comb = snapshot?.strongestBpm > 0 ? snapshot.strongestBpm : NaN;
        const span = this.sp;
        return [
            [
                // A closed gate has a hollow lamp; a previously shown pending event may still flash.
                { lamp: true, level: gateOpen || this.ledLevel > 0 ? this.ledLevel : null,
                    minimumLevel: 0, color: gateOpen ? markerColor(Number.isFinite(bpm) ? bpm : 120) : palette.strongGrid },
                { text: tempo, slot: snapshot?.analysisAvailable === false ? tempo : '000.0 BPM  searching',
                    opacity: Number.isFinite(bpm) ? snapshot.confidence : 1,
                    color: Number.isFinite(bpm) ? markerColor(bpm) : palette.label }
            ],
            [
                // Tempos stay below 480 BPM, so halves have 3 digits and doubles at most 4.
                { text: `×½ ${value(bpm, (bpm / 2).toFixed(0))}`, slot: '×½ 000', color: palette.label },
                { text: `×2 ${value(bpm, (bpm * 2).toFixed(0))}`, slot: '×2 0000', color: palette.label }
            ],
            [{ text: `strongest ${value(comb, `${comb.toFixed(0)} BPM`)}`, slot: 'strongest 000 BPM', color: palette.label }],
            // Swing fractions below 0.8 keep the ratio under 4:1; deviations stay well below a second.
            [{ text: `swing ${value(lens?.swing, `${lens?.swing.toFixed(2)}:1`)}`, slot: 'swing 0.00:1',
                opacity: snapshot?.confidence ?? 0, color: palette.label }],
            [{ text: `jitter ${value(lens?.jitter, `${lens?.jitter.toFixed(1)} ms`)}`, slot: 'jitter 000.0 ms',
                opacity: snapshot?.confidence ?? 0, color: palette.label }],
            [
                { text: '○ timing unavailable', color: palette.label },
                { text: `◎ new vs ${span} / ${2 * span} beats ago`, color: palette.label },
                { text: '┆ beat re-aligned', color: markerColor(Number.isFinite(bpm) ? bpm : 120) }
            ]
        ];
    }

    // Shared renderer of the Groove view: the header, then whichever of the tempogram strip, beat-clock timing
    // row, echo rows of the previous spans and beat lens are enabled, reflowed into the remaining height.
    // Panels span the full width; tick labels and axis names are drawn over the plot, as in the other graphs.
    drawGroove(context, { width, height, palette, showText, showAxes, text, drawSignal, markerColor, positionColor, tempogramColor, visualizer = false }) {
        this.renderWallTime = performance.now();
        if (this.snapshot) {
            const now = this.audioNow(this.renderWallTime);
            this.advanceBeatLed(now);
            this.displayU = this.displayClock(now, this.renderWallTime);
        }
        const dpr = this.graphDpr || 1;
        const cssWidth = this.graphCssWidth > 0 ? this.graphCssWidth : width / dpr;
        const isNarrow = cssWidth < 500;
        const fontSize = (isNarrow ? 11 : 12) * dpr;
        const axisFont = (isNarrow ? 13 : 14) * dpr;
        const pad = 6 * dpr;
        const span = this.sp;
        const lens = this.displayedLensSummary(this.lensSummary());
        // Native graphs use the theme trace; Visualizer samples its palette at each mark's position.
        const signalColor = markerColor(this.heldPeriod > 0 ? 60 / this.heldPeriod : 120);
        const frame = { valid: false, header: [] };
        this._readoutFrame = frame;
        // Text keeps a background-colored outline so it stays legible where it overlaps the plot; a rotated line
        // reads bottom to top.
        const drawText = (value, x, y, color, align, baseline, size, rotated = false) => {
            context.save();
            context.font = `${size}px Arial`;
            context.textAlign = align;
            context.textBaseline = baseline;
            context.strokeStyle = palette.background;
            context.lineWidth = 2 * dpr;
            context.lineJoin = 'round';
            if (rotated) {
                context.translate(x, y);
                context.rotate(-Math.PI / 2);
                x = 0;
                y = 0;
            }
            text.strokeText(value, x, y);
            context.fillStyle = color;
            text.fillText(value, x, y);
            context.restore();
        };
        // Every text item over the graph (captions, axis names, row labels, tick and guide values, status text)
        // is left out when it would be drawn below a legible size or would touch an item already written, so
        // the draw order sets the precedence. Its box is its width plus 0.1 em at each end (glyph overhang and
        // outline) by 1.05 em around the middle of the line. A group of items (a lane's guide pair) is written
        // whole or not at all.
        const labelGap = 1.05 * fontSize;
        const written = [];
        const item = (value, x, y, color, align = 'left', baseline = 'middle', size = fontSize, rotated = false) => (
            { value, x, y, color, align, baseline, size, rotated }
        );
        const boxOf = ({ value, x, y, align, baseline, size, rotated }) => {
            context.font = `${size}px Arial`;
            const length = context.measureText(value).width;
            const start = (align === 'center' ? -length / 2 : align === 'right' ? -length : 0) - 0.1 * size;
            const end = start + length + 0.2 * size;
            const middle = baseline === 'alphabetic' ? -0.35 * size : 0;
            const half = labelGap / fontSize * size / 2;
            return rotated
                ? { left: x + middle - half, right: x + middle + half, top: y - end, bottom: y - start }
                : { left: x + start, right: x + end, top: y + middle - half, bottom: y + middle + half };
        };
        const writeAll = items => {
            const boxes = items.map(boxOf);
            const blocked = items.some((entry, index) => entry.size < 0.8 * fontSize ||
                written.some(other => boxes[index].left < other.right && other.left < boxes[index].right &&
                    boxes[index].top < other.bottom && other.top < boxes[index].bottom));
            if (blocked) return;
            written.push(...boxes);
            for (const { value, x, y, color, align, baseline, size, rotated } of items) drawText(value, x, y, color, align, baseline, size, rotated);
        };
        const write = (...args) => writeAll([item(...args)]);
        // The font size that fits a text line into its room.
        const fitted = (value, size, room) => {
            context.font = `${size}px Arial`;
            const natural = context.measureText(value).width;
            return natural > room ? size * room / natural : size;
        };
        const caption = (value, x, y, room) => write(value, x, y, palette.label, 'left', 'middle', fitted(value, fontSize, room));
        // Axis names as in the other analyzer graphs: centered, rotated for a vertical axis.
        const axisName = (value, x, y, room, rotated = false) => {
            write(value, x, y, palette.axis, 'center', 'alphabetic', fitted(value, axisFont, room), rotated);
        };
        // Vertical axis names sit 18-20 px from the left edge as in the spectrogram; tick values are right-aligned
        // in a column beside them, whose right edge fits the widest of the given labels.
        const nameX = (isNarrow ? 18 : 20) * dpr;
        const tickRight = (left, labels) => {
            context.font = `${fontSize}px Arial`;
            return left + nameX + 0.25 * axisFont + pad + Math.max(...labels.map(label => context.measureText(label).width));
        };
        // Solid separators between the rows of a panel.
        const separate = (rect, rows) => {
            context.strokeStyle = palette.label;
            context.lineWidth = dpr;
            context.beginPath();
            for (let row = 1; row < rows; row++) {
                const rowY = rect.top + row * rect.height / rows;
                context.moveTo(rect.left, rowY);
                context.lineTo(rect.left + rect.width, rowY);
            }
            context.stroke();
        };
        // High/Mid/Low row labels at the left edge of a panel, from the y of each row (0 = top).
        const bandLabels = (left, yOf) => {
            RHYTHM_ANALYZER_BAND_ORDER.forEach((band, row) => {
                write(RHYTHM_ANALYZER_BAND_NAMES[band], left + pad, yOf(row), palette.label);
            });
        };
        let top = pad;
        if (showText && (!visualizer || this.vt || this.vm || this.ve || this.vl)) {
            const items = this._headerItems(lens, palette, markerColor);
            const header = this._layoutHeader(context, visualizer ? items.slice(1) : items, width, pad, fontSize);
            for (const entry of header.placed) {
                let x = entry.left;
                const size = fontSize * entry.scale;
                entry.item.forEach((part, index) => {
                    if (part.lamp) {
                        context.save();
                        context.font = `${size}px Arial`;
                        context.textBaseline = 'top';
                        // Keep the lamp at the same height in locked and searching states.
                        const metrics = context.measureText('BPM LOCKED');
                        const centerY = entry.top + (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2;
                        context.restore();
                        this._drawBeatLed(context, part, x, centerY, size, dpr);
                    } else {
                        context.save();
                        context.globalAlpha = part.opacity ?? 1;
                        drawText(part.text, x, entry.top, part.color, 'left', 'top', size);
                        context.restore();
                    }
                    x += (entry.widths[index] + 0.8 * fontSize) * entry.scale;
                });
                frame.header.push({ left: entry.left, top: entry.top, width: entry.width, height: entry.height });
            }
            top = header.bottom + pad;
        }
        const captionRow = showText ? 1.3 * fontSize : 0;
        // The lens height from which its band labels fit above their rows' marks; the narrow layout keeps it as the
        // lens minimum.
        const lensLabelHeight = 3 * RHYTHM_ANALYZER_LENS_LABEL_ROW * fontSize;
        const stacked = width < height;
        // Enabled panels top to bottom with their height shares. On landscape canvases the lens sits beside
        // the lanes and echo rows; without them, and on portrait canvases, it takes a row of its own.
        const besideLens = !stacked && this.vl && (this.vm || this.ve);
        const laneRight = besideLens ? 0.72 * width : width;
        const column = [
            this.vt && { key: 'strip', share: stacked ? 0.15 : 0.2, right: width, caption: false, minimum: showText ? 90 * dpr : 0 },
            this.vm && { key: 'main', share: stacked ? 0.25 : 0.3, right: laneRight, caption: true },
            this.ve && { key: 'echo', share: stacked ? 0.33 : 0.5, right: laneRight, caption: true },
            this.vl && !besideLens && {
                key: 'lens', share: stacked ? 0.27 : 0.8, right: width, caption: true,
                minimum: showText ? lensLabelHeight : 0
            }
        ].filter(Boolean);
        let free = height - pad - top;
        let shares = 0;
        column.forEach((panel, index) => {
            free -= (index ? pad : 0) + (panel.caption ? captionRow : 0);
            shares += panel.share;
        });
        if (free <= 0) return;
        // On narrow canvases the tempogram keeps about 90 CSS px, so its tick labels and axis names do not crowd
        // the plot, and the lens enough body for its band labels and offset values to clear the marks. Each keeps
        // its minimum (at most half the room) while another panel is left to share the rest. On small canvases the
        // minimums shrink together to two thirds of the room, so the beat panels always keep a real share.
        const minimums = column.reduce((sum, panel) => sum + (panel.minimum ?? 0), 0);
        const minimumScale = minimums > 2 / 3 * free ? 2 / 3 * free / minimums : 1;
        let rest = free;
        let restShares = shares;
        let sharing = column.length;
        for (let fixed = isNarrow; fixed;) {
            fixed = false;
            for (const panel of column) {
                const minimum = Math.min((panel.minimum ?? 0) * minimumScale, free / 2);
                if (!panel.height && sharing > 1 && rest * panel.share / restShares < minimum) {
                    panel.height = minimum;
                    rest -= minimum;
                    restShares -= panel.share;
                    sharing--;
                    fixed = true;
                }
            }
        }
        const rects = {};
        let y = top;
        column.forEach((panel, index) => {
            y += (index ? pad : 0) + (panel.caption ? captionRow : 0);
            const rect = { left: 0, top: y, width: panel.right, height: panel.height || rest * panel.share / restShares };
            rects[panel.key] = rect;
            y += rect.height;
        });
        if (besideLens) {
            const first = rects.main ?? rects.echo;
            const last = rects.echo ?? rects.main;
            rects.lens = {
                left: laneRight + 2 * pad, top: first.top, width: width - 2 * pad - laneRight, height: last.top + last.height - first.top
            };
        }
        const { strip, main, echo, lens: lensRect } = rects;
        const views = [];
        const displayU = this.displayU ?? this.beatClock;
        if (main) views.push({ ...main, uRight: displayU, span, echo: false, dpr });
        const rowCount = echo ? Math.floor(echo.height / (22 * dpr)) : 0;
        const rows = !echo ? 0 : rowCount < 4 ? 4 : rowCount > 6 ? 6 : rowCount;
        // The timing lanes already show the newest window, so the echo rows then start one window back.
        const firstWindow = main ? 1 : 0;
        for (let row = 0; row < rows; row++) {
            views.push({
                left: echo.left, top: echo.top + row * echo.height / rows, width: echo.width, height: echo.height / rows,
                uRight: displayU - (row + firstWindow) * span, span, echo: true, dpr
            });
        }
        // Only the shown panels take part in the cursor readout.
        const panels = [strip, main, echo, lensRect].filter(Boolean);
        const scroll = this.tempogramScroll();
        Object.assign(frame, { strip, main, echo, lens: lensRect, panels, views, lensSummary: lens, palette, signalColor, scroll, displayU });

        const style = {
            palette, showText, showAxes, write, axisName, nameX, tickRight, bandLabels, drawSignal, markerColor, signalColor, positionColor, tempogramColor,
            fontSize, axisFont, captionRow, pad, dpr
        };
        if (strip) this._drawTempogram(context, strip, scroll, style);
        for (const view of views) this._drawLane(context, view, style);
        if (showAxes && main) separate(main, 3);
        if (showAxes && echo) separate(echo, rows);
        if (showAxes && lensRect) separate(lensRect, 3);
        // Beside the lanes alone the lens rows continue the lanes' rows, whose band labels then name both.
        if (lensRect) this._drawLens(context, lensRect, lens, { ...style, bandLabels: besideLens && !echo ? null : bandLabels });
        if (showText && main) {
            caption(`Last ${span} beats`, main.left + pad, main.top - captionRow / 2, main.width - 2 * pad);
            axisName('Timing (ms)', main.left + nameX, main.top + main.height / 2, main.height - pad, true);
            axisName('Beats', main.left + main.width / 2, main.top + main.height - 8 * dpr, main.width);
            // The band names, and right of them a column of the guide values (up = late). A lane's +20/−20 pair is
            // shown or skipped as a unit: skipped when the lane is too short for the two to clear each other or when
            // either would touch another text, so where neighbouring lanes' values touch the middle lane's pair goes.
            const lane = main.height / 3;
            const guide = RHYTHM_ANALYZER_GUIDE_MS / RHYTHM_ANALYZER_DEVIATION_MS * 0.45 * lane;
            const late = rhythmAnalyzerSigned(RHYTHM_ANALYZER_GUIDE_MS, 0);
            const early = rhythmAnalyzerSigned(-RHYTHM_ANALYZER_GUIDE_MS, 0);
            // tickRight leaves the label font set for measuring the values.
            const nameRight = tickRight(main.left, RHYTHM_ANALYZER_BAND_NAMES);
            const valueRight = nameRight + pad + Math.max(context.measureText(late).width, context.measureText(early).width);
            RHYTHM_ANALYZER_BAND_ORDER.forEach((band, row) => {
                write(RHYTHM_ANALYZER_BAND_NAMES[band], nameRight, main.top + (row + 0.5) * lane, palette.label, 'right');
            });
            for (const row of 2 * guide < labelGap ? [] : [0, 2, 1]) {
                const center = main.top + (row + 0.5) * lane;
                writeAll([
                    item(late, valueRight, center - guide, palette.label, 'right'),
                    item(early, valueRight, center + guide, palette.label, 'right')
                ]);
            }
        }
        if (showText && echo) {
            caption(`${main ? 'Previous' : 'Recent'} ${span}-beat cycles, newest on top`,
                echo.left + pad, echo.top - captionRow / 2, echo.width - 2 * pad);
            axisName('Cycles ago', echo.left + nameX, echo.top + echo.height / 2, echo.height - pad, true);
            axisName('Beats', echo.left + echo.width / 2, echo.top + echo.height - 8 * dpr, echo.width);
            // Each row is labelled with how many cycles ago it was.
            const echoViews = views.filter(view => view.echo);
            const x = tickRight(echo.left, [String(rows - 1 + firstWindow)]);
            echoViews.forEach((view, row) => write(String(row + firstWindow), x, view.top + view.height / 2, palette.label, 'right'));
            // Without the lanes, the newest row carries the band labels, right of its cycle value.
            const newest = echoViews[0];
            if (!main) bandLabels(x, row => newest.top + (0.5 + (row - 1) * 0.28) * newest.height);
        }
        if (showText && lensRect) {
            caption(`Beat lens: offset ± spread, last ${RHYTHM_ANALYZER_LENS_BEATS} beats`,
                lensRect.left + pad, lensRect.top - captionRow / 2, lensRect.width - 2 * pad);
        }
        frame.valid = true;
    }

    // The beat LED centered at the given height: filled by its level, or a hollow ring.
    _drawBeatLed(context, part, left, centerY, size, lineWidth) {
        context.beginPath();
        context.arc(left + size / 2, centerY, 0.38 * size, 0, 2 * Math.PI);
        if (part.level !== null) {
            const minimumLevel = part.minimumLevel ?? 0.15;
            context.globalAlpha = (part.fillOpacity ?? 1) * (minimumLevel + (1 - minimumLevel) * part.level);
            context.fillStyle = part.color;
            context.fill();
            context.globalAlpha = 1;
        }
        if (lineWidth > 0) {
            context.globalAlpha = part.strokeOpacity ?? 1;
            context.strokeStyle = part.strokeColor ?? part.color;
            context.lineWidth = lineWidth;
            context.stroke();
            context.globalAlpha = 1;
        }
    }

    // Canvas position and radius of a stored onset in a lane view; the radius shows the detection certainty.
    _eventPoint(index, view) {
        const strength = this.eventStrength[index] > 1 ? 1 : this.eventStrength[index];
        const displayed = this.displayedEvent(index);
        const x = view.left + (displayed.u - view.uRight + view.span) / view.span * view.width;
        const band = this.eventBand[index];
        let y;
        let radius;
        if (view.echo) {
            y = view.top + (0.5 + (RHYTHM_ANALYZER_BAND_ROWS[band] - 1) * 0.28) * view.height;
            radius = (0.025 + 0.035 * strength) * view.height;
        } else {
            const lane = view.height / 3;
            const deviation = displayed.deviation;
            const limit = RHYTHM_ANALYZER_DEVIATION_MS;
            const clipped = deviation < -limit ? -limit : deviation > limit ? limit : deviation;
            y = view.top + (RHYTHM_ANALYZER_BAND_ROWS[band] + 0.5) * lane -
                (this.eventLocated[index] ? clipped / limit * 0.45 * lane : 0);
            radius = (0.025 + 0.04 * strength) * lane;
        }
        const minimum = 1.5 * view.dpr;
        const maximum = 3.5 * view.dpr;
        return { x, y, radius: radius < minimum ? minimum : radius > maximum ? maximum : radius };
    }

    // One beat-clock window: searching shade, beat grid over locked stretches, re-align marks and onsets.
    _drawLane(context, view, { palette, showText, showAxes, write, drawSignal, signalColor, positionColor, dpr }) {
        const confidence = this.snapshot?.confidence ?? 0;
        const from = view.uRight - view.span;
        const to = view.uRight;
        const xOf = u => view.left + (u - from) / view.span * view.width;
        // Stretches without a lock segment were searching.
        let cursor = from;
        let widest = null;
        context.fillStyle = palette.subtleGrid;
        context.globalAlpha = 0.45;
        const shade = (start, end) => {
            if (!(end > start + 1e-6)) return;
            context.fillRect(xOf(start), view.top, xOf(end) - xOf(start), view.height);
            if (!widest || end - start > widest.end - widest.start) widest = { start, end };
        };
        const segments = Array.from(this.segments.values(), segment => {
            const offset = segment.displayOffset ?? 0;
            return { ...segment, startU: segment.startU + offset, offset: segment.offset + offset,
                endU: segment.epoch === this.clockAnchor?.epoch && this.snapshot?.analysisValid
                    ? Math.max(segment.endU + offset, this.displayU ?? segment.endU + offset) : segment.endU + offset };
        });
        if (!this.clockAnchor && this.forwardTail.length) segments.push({ startU: from, endU: to,
            offset: this.forwardOffset + this.displayTimelineOffset, reanchor: false });
        for (const segment of segments) {
            if (segment.endU <= cursor) continue;
            if (segment.startU >= to) break;
            shade(cursor, segment.startU);
            cursor = segment.endU;
        }
        shade(cursor, to);
        context.globalAlpha = 1;
        if (!view.echo && showText && widest && widest.end - widest.start > 0.12 * view.span) {
            write('searching', xOf((widest.start + widest.end) / 2), view.top + view.height / 2, palette.label, 'center');
        }
        const step = view.echo ? 1 : 0.5;
        for (const segment of segments) {
            const low = segment.startU > from ? segment.startU : from;
            const high = segment.endU < to ? segment.endU : to;
            if (high < low) continue;
            if (showAxes) {
                for (let q = Math.ceil((low - segment.offset) / step); q * step + segment.offset <= high; q++) {
                    const beat = q * step === Math.floor(q * step);
                    const x = xOf(q * step + segment.offset);
                    context.strokeStyle = beat ? palette.strongGrid : palette.subtleGrid;
                    context.lineWidth = (beat ? 1 : 0.5) * dpr;
                    context.beginPath();
                    context.moveTo(x, view.top);
                    context.lineTo(x, view.top + view.height);
                    context.stroke();
                }
            }
            if (segment.reanchor && segment.startU >= from && segment.startU <= to) {
                const x = xOf(segment.startU);
                context.strokeStyle = signalColor;
                context.lineWidth = dpr;
                context.setLineDash([2 * dpr, 2 * dpr]);
                context.beginPath();
                context.moveTo(x, view.top);
                context.lineTo(x, view.top + view.height);
                context.stroke();
                context.setLineDash([]);
            }
        }
        // Dotted guides at +-20 ms around each lane's centre line (0 ms).
        const lane = view.height / 3;
        if (!view.echo && showAxes) {
            const guide = RHYTHM_ANALYZER_GUIDE_MS / RHYTHM_ANALYZER_DEVIATION_MS * 0.45 * lane;
            context.strokeStyle = signalColor;
            context.globalAlpha = 0.6;
            context.lineWidth = dpr;
            context.setLineDash([dpr, 3 * dpr]);
            context.beginPath();
            for (let row = 0; row < 3; row++) {
                const center = view.top + (row + 0.5) * lane;
                for (const y of [center - guide, center + guide]) {
                    context.moveTo(view.left, y);
                    context.lineTo(view.left + view.width, y);
                }
            }
            context.stroke();
            context.setLineDash([]);
            context.globalAlpha = 1;
        }
        drawSignal(context, target => {
            target.save();
            target.beginPath();
            target.rect(view.left, view.top, view.width, view.height);
            target.clip();
            this.forEachEvent(from - 0.2, to + 0.2, index => {
                const point = this._eventPoint(index, view);
                const color = positionColor ? positionColor(Math.max(0, Math.min(1, (point.x - view.left) / view.width))) : signalColor;
                if (!this.eventLocated[index]) {
                    target.globalAlpha = 0.75 * confidence;
                    target.strokeStyle = color;
                    target.lineWidth = 0.9 * dpr;
                    target.beginPath();
                    target.arc(point.x, point.y, point.radius, 0, 2 * Math.PI);
                    target.stroke();
                    return;
                }
                if (!view.echo) {
                    // Stem from the lane centre (0 ms) makes the timing offset readable at a glance.
                    target.globalAlpha = 0.6 * confidence;
                    target.strokeStyle = color;
                    target.lineWidth = dpr;
                    target.beginPath();
                    target.moveTo(point.x, view.top + (RHYTHM_ANALYZER_BAND_ROWS[this.eventBand[index]] + 0.5) * lane);
                    target.lineTo(point.x, point.y);
                    target.stroke();
                }
                target.globalAlpha = 0.95 * confidence;
                target.fillStyle = color;
                target.beginPath();
                target.arc(point.x, point.y, point.radius, 0, 2 * Math.PI);
                target.fill();
                if (this.eventNovel[index]) {
                    target.globalAlpha = confidence;
                    target.strokeStyle = palette.label;
                    target.lineWidth = dpr;
                    target.beginPath();
                    target.arc(point.x, point.y, point.radius + 2 * dpr, 0, 2 * Math.PI);
                    target.stroke();
                }
            }, this.eventSerial, true);
            target.globalAlpha = 1;
            target.restore();
        });
    }

    // Columns are drawn scroll columns left of their slots, so the strip's right edge is the present; the newest
    // column is held from there to the right edge.
    _drawTempogram(context, strip, scroll, { palette, showText, showAxes, write, axisName, nameX, tickRight, drawSignal, markerColor, tempogramColor, fontSize, pad, dpr }) {
        const columns = RHYTHM_ANALYZER_TEMPOGRAM_COLUMNS;
        const yOf = bpm => strip.top + (1 - rhythmAnalyzerBpmPosition(bpm)) * strip.height;
        const xOf = step => strip.left + (step + 0.5 - scroll) / columns * strip.width;
        const clampY = y => (y < strip.top + fontSize / 2 ? strip.top + fontSize / 2
            : y > strip.top + strip.height - fontSize / 2 ? strip.top + strip.height - fontSize / 2 : y);
        if (showAxes) {
            context.strokeStyle = palette.subtleGrid;
            context.lineWidth = 0.5 * dpr;
            context.beginPath();
            for (const bpm of RHYTHM_ANALYZER_BPM_TICKS) {
                context.moveTo(strip.left, yOf(bpm));
                context.lineTo(strip.left + strip.width, yOf(bpm));
            }
            context.stroke();
        }
        const image = this._tempogramImage(palette.label, tempogramColor);
        const head = this.tempogramHead;
        const columnAt = step => (head + 1 + step) % columns;
        const right = strip.left + strip.width;
        let last = columns - 1;
        while (last >= 0 && !(this.tempogramAdopted[columnAt(last)] > 0)) last--;
        const adopted = this.snapshot?.periodSeconds > 0 ? 60 / this.snapshot.periodSeconds
            : last < 0 ? 0 : this.tempogramAdopted[columnAt(last)];
        drawSignal(context, target => {
            target.save();
            target.beginPath();
            target.rect(strip.left, strip.top, strip.width, strip.height);
            target.clip();
            if (image) {
                target.imageSmoothingEnabled = false;
                // The history is clipped at a whole-pixel edge and the newest column is held from there, so the
                // two draws neither overlap (doubling that column's alpha) nor leave an antialiased seam.
                const edge = Math.floor(right - scroll / columns * strip.width);
                target.save();
                target.beginPath();
                target.rect(strip.left, strip.top, edge - strip.left, strip.height);
                target.clip();
                target.drawImage(image, strip.left - scroll / columns * strip.width, strip.top, strip.width, strip.height);
                target.restore();
                target.drawImage(image, columns - 1, 0, 1, image.height, edge, strip.top, right - edge, strip.height);
            }
            // Adopted tempo, and its half and double as dashed candidates.
            for (const [factor, lineWidth, opacity] of [[1, 2, 1], [2, 0.8, 0.6], [0.5, 0.8, 0.6]]) {
                target.lineWidth = lineWidth * dpr;
                target.setLineDash(factor === 1 ? [] : [2 * dpr, 2 * dpr]);
                for (let step = 1; step < columns; step++) {
                    const column = columnAt(step);
                    const previous = this.tempogramAdopted[columnAt(step - 1)] * factor;
                    const current = this.tempogramAdopted[column] * factor;
                    if (!(previous > 0 && current > 0)) continue;
                    target.globalAlpha = opacity * this.tempogramConfidence[column];
                    target.strokeStyle = markerColor(current);
                    target.beginPath();
                    target.moveTo(xOf(step - 1), yOf(previous));
                    target.lineTo(xOf(step), yOf(current));
                    target.stroke();
                }
                // Extend the latest committed tempo at draw time only; the stored audio-time buckets stay intact.
                if (adopted > 0) {
                    target.globalAlpha = opacity * (this.snapshot?.confidence ?? 0);
                    target.strokeStyle = markerColor(adopted * factor);
                    target.beginPath();
                    target.moveTo(last < 0 ? strip.left : xOf(last), yOf(adopted * factor));
                    target.lineTo(right, yOf(adopted * factor));
                    target.stroke();
                }
            }
            target.setLineDash([]);
            target.globalAlpha = 1;
            target.restore();
        });
        if (!showText) return;
        // Axis names as in the spectrogram: 'Time' centered 8 px above the bottom edge, the vertical name rotated.
        axisName('Time', strip.left + strip.width / 2, strip.top + strip.height - 8 * dpr, strip.width);
        axisName('Tempo (BPM)', strip.left + nameX, strip.top + strip.height / 2, strip.height - pad, true);
        const tickX = tickRight(strip.left, ['480']);
        for (const bpm of RHYTHM_ANALYZER_BPM_TICKS) write(String(bpm), tickX, clampY(yOf(bpm)), palette.label, 'right');
        // Labels follow the draw-only extension to the right edge.
        if (!(adopted > 0)) return;
        for (const [bpm, label] of [[adopted, 'adopted'], [adopted * 2, '×2'], [adopted / 2, '×½']]) {
            if (bpm > RHYTHM_ANALYZER_MIN_BPM && bpm < 480) {
                context.save();
                context.globalAlpha = this.snapshot?.confidence ?? 0;
                write(label, right - pad, clampY(yOf(bpm) - 0.6 * fontSize), markerColor(bpm), 'right');
                context.restore();
            }
        }
    }

    // The tempogram history as a columns x bins image, alpha = salience^1.5.
    _tempogramImage(color, positionColor) {
        if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
        const columns = RHYTHM_ANALYZER_TEMPOGRAM_COLUMNS;
        const bins = RHYTHM_ANALYZER_TEMPOGRAM_BINS;
        if (!this.tempogramCanvas) {
            const canvas = document.createElement('canvas');
            canvas.width = columns;
            canvas.height = bins;
            const imageContext = canvas.getContext?.('2d');
            if (!imageContext) return null;
            this.tempogramCanvas = canvas;
            this.tempogramImageContext = imageContext;
            this.tempogramImageData = imageContext.createImageData(columns, bins);
        }
        if (!this.tempogramDirty && this.tempogramImageColor === color && this.tempogramPositionColor === positionColor) return this.tempogramCanvas;
        const [red, green, blue] = rhythmAnalyzerRgb(color);
        const colors = positionColor ? Array.from({ length: bins }, (_, bin) => rhythmAnalyzerRgb(positionColor(bin / bins))) : null;
        const pixels = this.tempogramImageData.data;
        const head = this.tempogramHead;
        for (let step = 0; step < columns; step++) {
            const base = ((head + 1 + step) % columns) * bins;
            for (let bin = 0; bin < bins; bin++) {
                const value = this.tempogram[base + bin];
                const pixel = ((bins - 1 - bin) * columns + step) * 4;
                pixels[pixel] = colors ? colors[bin][0] : red;
                pixels[pixel + 1] = colors ? colors[bin][1] : green;
                pixels[pixel + 2] = colors ? colors[bin][2] : blue;
                pixels[pixel + 3] = value * Math.sqrt(value) * 255;
            }
        }
        this.tempogramImageContext.putImageData(this.tempogramImageData, 0, 0);
        this.tempogramDirty = false;
        this.tempogramImageColor = color;
        this.tempogramPositionColor = positionColor;
        return this.tempogramCanvas;
    }

    // Beat lens: one column per slot in the beat; per band, the offset tick and a ± spread bar. Its three band
    // rows match the timing lanes' rows, so beside the lanes each band reads across one line. The scale line runs
    // along the top, and the slot labels and axis name along the bottom, drawn over the plot as in the lanes.
    _drawLens(context, rect, lens, {
        palette, showText, showAxes, write, axisName, bandLabels, drawSignal, signalColor, positionColor, fontSize, axisFont, dpr
    }) {
        const columns = RHYTHM_ANALYZER_SLOT_LABELS.length;
        const columnWidth = rect.width / columns;
        const rowHeight = rect.height / 3;
        if (rowHeight <= 0) return;
        const centerX = slot => rect.left + (slot + 0.5) * columnWidth;
        const msScale = 0.42 * columnWidth / RHYTHM_ANALYZER_DEVIATION_MS;
        // The scale line keeps its tick half-height (2 px) below the rect top.
        const scaleY = rect.top + 3 * dpr;
        const rowY = index => rect.top + (index + 0.5) * rowHeight;
        const markHeight = 0.15 * rowHeight;
        if (showAxes) {
            for (let slot = 0; slot < columns; slot++) {
                const x = centerX(slot);
                context.strokeStyle = palette.subtleGrid;
                context.lineWidth = 0.5 * dpr;
                context.beginPath();
                context.moveTo(x, scaleY);
                context.lineTo(x, rect.top + rect.height);
                context.stroke();
                context.strokeStyle = palette.strongGrid;
                context.lineWidth = 0.8 * dpr;
                context.beginPath();
                context.moveTo(x - RHYTHM_ANALYZER_DEVIATION_MS * msScale, scaleY);
                context.lineTo(x + RHYTHM_ANALYZER_DEVIATION_MS * msScale, scaleY);
                for (const tick of [-RHYTHM_ANALYZER_GUIDE_MS, RHYTHM_ANALYZER_GUIDE_MS]) {
                    context.moveTo(x + tick * msScale, scaleY - 2 * dpr);
                    context.lineTo(x + tick * msScale, scaleY + 2 * dpr);
                }
                context.stroke();
            }
        }
        if (showText) {
            // The axis name's baseline sits 8 px above the bottom edge, and the slot labels just above it. A short
            // lens drops the axis name first, then the slot labels, so no text is drawn outside it.
            const bottom = rect.top + rect.height;
            const nameRow = axisFont + 8 * dpr;
            const named = rect.height > nameRow + 1.2 * fontSize;
            const slotY = bottom - (named ? nameRow : 0) - 0.6 * fontSize;
            if (slotY >= rect.top) {
                RHYTHM_ANALYZER_SLOT_LABELS.forEach((label, slot) => write(label, centerX(slot), slotY, palette.label, 'center'));
            }
            if (named) axisName('Position in beat', rect.left + rect.width / 2, bottom - 8 * dpr, rect.width);
        }
        // The band labels sit above their row's marks where the rows leave room, else on the row; taller rows lift
        // them further from the marks, up to a gap of 0.6 font sizes. They are drawn before the marks.
        const labelLift = 0.35 * rowHeight - 0.55 * fontSize;
        const labelOffset = markHeight + (labelLift < 1.1 * fontSize ? labelLift : 1.1 * fontSize);
        const labelY = rowHeight >= RHYTHM_ANALYZER_LENS_LABEL_ROW * fontSize ? index => rowY(index) - labelOffset : rowY;
        if (showText && bandLabels) bandLabels(rect.left, labelY);
        if (showText && !lens) write('waiting for a steady beat', rect.left + rect.width / 2, rowY(1), palette.label, 'center');
        if (lens?.rows.length) {
            const maxCount = lens.rows.reduce((max, row) => (row.count > max ? row.count : max), 0);
            const limit = RHYTHM_ANALYZER_DEVIATION_MS;
            // The offset values sit below their marks. On short lenses a value that would touch its mark is left
            // out, as is one that would touch a label.
            const valueSize = 0.85 * fontSize;
            const valueClearsMark = markHeight >= 0.5 * valueSize;
            context.save();
            context.beginPath();
            context.rect(rect.left, rect.top, rect.width, rect.height);
            context.clip();
            drawSignal(context, target => {
                target.save();
                target.beginPath();
                target.rect(rect.left, rect.top, rect.width, rect.height);
                target.clip();
                for (const row of lens.rows) {
                    const y = rowY(RHYTHM_ANALYZER_BAND_ROWS[row.band]);
                    const offset = row.offset < -limit ? -limit : row.offset > limit ? limit : row.offset;
                    const x = centerX(row.slot) + offset * msScale;
                    const color = positionColor ? positionColor((x - rect.left) / rect.width) : signalColor;
                    const alpha = (0.35 + 0.65 * row.count / maxCount) * (this.snapshot?.confidence ?? 0);
                    target.globalAlpha = 0.3 * alpha;
                    target.fillStyle = color;
                    target.fillRect(x - row.sd * msScale, y - markHeight / 2, 2 * row.sd * msScale, markHeight);
                    target.globalAlpha = alpha;
                    target.strokeStyle = color;
                    target.lineWidth = 2 * dpr;
                    target.beginPath();
                    target.moveTo(x, y - markHeight);
                    target.lineTo(x, y + markHeight);
                    target.stroke();
                }
                target.globalAlpha = 1;
                target.restore();
            });
            for (const row of lens.rows) {
                const y = rowY(RHYTHM_ANALYZER_BAND_ROWS[row.band]);
                const offset = row.offset < -limit ? -limit : row.offset > limit ? limit : row.offset;
                const x = centerX(row.slot) + offset * msScale;
                const value = rhythmAnalyzerSigned(row.offset, 0);
                const valueY = y + 2 * markHeight;
                if (showText && valueClearsMark && (row.offset < 0 ? -row.offset : row.offset) >= RHYTHM_ANALYZER_LABEL_MIN_MS) {
                    write(value, x, valueY, signalColor, 'center', 'middle', valueSize);
                }
            }
            context.restore();
        }
    }

    // The panel under a canvas point, for the cursor readout.
    _readoutPanel(point) {
        const frame = this._readoutFrame;
        if (!frame?.valid) return null;
        return frame.panels.find(panel =>
            point.x >= panel.left && point.x <= panel.left + panel.width &&
            point.y >= panel.top && point.y <= panel.top + panel.height) ?? null;
    }

    _readRhythm(x, y) {
        const frame = this._readoutFrame;
        const panel = frame?.valid ? this._readoutPanel({ x, y }) : null;
        if (!panel) return null;
        const { format } = window.GraphReadout;
        if (panel === frame.strip) {
            const columns = RHYTHM_ANALYZER_TEMPOGRAM_COLUMNS;
            const position = (panel.top + panel.height - y) / panel.height;
            const bpm = RHYTHM_ANALYZER_MIN_BPM * 2 ** (RHYTHM_ANALYZER_OCTAVES * position);
            // Same scroll as drawn; the held area right of the newest column reads as that column.
            let step = Math.floor((x - panel.left) / panel.width * columns + frame.scroll);
            step = step < 0 ? 0 : step > columns - 1 ? columns - 1 : step;
            const column = (this.tempogramHead + 1 + step) % columns;
            let bin = Math.floor(48 * Math.log2(bpm / RHYTHM_ANALYZER_MIN_BPM));
            bin = bin < 0 ? 0 : bin > RHYTHM_ANALYZER_TEMPOGRAM_BINS - 1 ? RHYTHM_ANALYZER_TEMPOGRAM_BINS - 1 : bin;
            const adopted = this.tempogramAdopted[column];
            return {
                cursor: `${format.number(bpm, 1)} BPM · ${format.time(-(columns - 1 - step + frame.scroll) * RHYTHM_ANALYZER_COLUMN_SECONDS * 1000)}`,
                rows: [
                    { label: 'Tempo support', color: frame.palette.label, value: format.percent(this.tempogram[column * RHYTHM_ANALYZER_TEMPOGRAM_BINS + bin]) },
                    { label: 'Adopted', color: frame.signalColor, value: adopted > 0 ? `${format.number(adopted, 1)} BPM` : RHYTHM_ANALYZER_DASH }
                ]
            };
        }
        if (panel === frame.lens) {
            if (!frame.lensSummary) return null;
            let slot = Math.floor((x - panel.left) / panel.width * RHYTHM_ANALYZER_SLOT_LABELS.length);
            slot = slot < 0 ? 0 : slot > RHYTHM_ANALYZER_SLOT_LABELS.length - 1 ? RHYTHM_ANALYZER_SLOT_LABELS.length - 1 : slot;
            return {
                cursor: `Beat position ${RHYTHM_ANALYZER_SLOT_LABELS[slot]}`,
                plainCursor: true,
                rows: frame.lensSummary.rows.filter(row => row.slot === slot)
                    .sort((a, b) => RHYTHM_ANALYZER_BAND_ROWS[a.band] - RHYTHM_ANALYZER_BAND_ROWS[b.band])
                    .map(row => ({
                        label: RHYTHM_ANALYZER_BAND_NAMES[row.band],
                        color: frame.signalColor,
                        value: `${rhythmAnalyzerSigned(row.offset, 1)} ms ± ${format.number(row.sd, 1)} ms`
                    }))
            };
        }
        const view = frame.views.find(item => y >= item.top && y <= item.top + item.height &&
            (panel === frame.main) === !item.echo);
        if (!view) return null;
        const u = view.uRight - view.span + (x - view.left) / view.width * view.span;
        let nearest = null;
        let nearestDistance = (12 * view.dpr) ** 2;
        this.forEachEvent(view.uRight - view.span, view.uRight, index => {
            const point = this._eventPoint(index, view);
            const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = index;
            }
        }, this.eventSerial, true);
        const cursor = `${format.number(frame.displayU - u, 1)} beats ago`;
        if (nearest === null) return { cursor, rows: [] };
        const band = this.eventBand[nearest];
        return {
            cursor,
            rows: [{
                label: RHYTHM_ANALYZER_BAND_NAMES[band],
                color: frame.signalColor,
                value: this.eventTimed[nearest] ? `${rhythmAnalyzerSigned(this.eventDeviation[nearest], 1)} ms` : RHYTHM_ANALYZER_DASH
            }]
        };
    }

    cleanup() {
        this.stopAnimation();
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onDocumentVisibility);
        this.disposeDspTelemetrySubscription();
        if (this.observer) {
            if (this.canvas) this.observer.unobserve(this.canvas);
            this.observer.disconnect();
        }
        this.resizeGraphDisposer?.();
        this.resizeGraphDisposer = null;
        this.canvas = null;
        this.canvasCtx = null;
        this.observer = null;
        super.cleanup();
    }
}

window.RhythmAnalyzerPlugin = RhythmAnalyzerPlugin;
