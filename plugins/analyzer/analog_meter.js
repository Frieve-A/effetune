const ANALOG_METER_FRAME_TYPE = 27;
const ANALOG_METER_TELEMETRY_VERSION = 1;
const ANALOG_METER_MODES = Object.freeze([
    'VU', 'PPM', 'RMS', 'Sample Peak', 'True Peak', 'Loudness'
]);
const ANALOG_METER_LOUDNESS_MODE = 5;
const ANALOG_METER_PPM_SCALES = Object.freeze(['DIN', 'BBC', 'dB']);
const ANALOG_METER_PPM_BBC = 1;
const ANALOG_METER_MAX_CHANNELS = 16;
const ANALOG_METER_MAX_COLUMNS = 4;
const ANALOG_METER_MOBILE_COLUMNS = 2;
const ANALOG_METER_SILENCE_DB = -200;
const ANALOG_METER_ARC_DEGREES = 50;
const ANALOG_METER_DANGER_COLOR = '#b91c1c'; // theme-allow: Fallback before the theme stylesheet resolves.
const ANALOG_METER_DEFAULTS = Object.freeze({
    md: 'VU', it: 0.3, at: 5, rt: 1.5, rl: -14, rg: 40, sc: 0, ph: 1, ln: 0, tg: -23, ls: 0
});
// Each system preset is a complete record: keys it does not name keep their defaults.
const analogMeterPreset = (id, label, params) =>
    Object.freeze({ id, label, params: Object.freeze({ ...ANALOG_METER_DEFAULTS, ...params }) });
const ANALOG_METER_SYSTEM_PRESETS = Object.freeze([
    analogMeterPreset('studio-vu', 'Studio VU (-18 dBFS)', { rl: -18 }),
    analogMeterPreset('smpte-vu', 'SMPTE VU (-20 dBFS)', { rl: -20 }),
    analogMeterPreset('hot-vu', 'Hot VU (-14 dBFS)', { rl: -14 }),
    analogMeterPreset('loud-master-vu', 'Loud Master VU (-8 dBFS)', { rl: -8 }),
    analogMeterPreset('din-ppm', 'DIN PPM', { md: 'PPM', rl: -18, rg: 50, ph: 0 }),
    analogMeterPreset('bbc-ppm', 'BBC PPM', { md: 'PPM', at: 10, rt: 2.33, rl: -18, sc: 1, ph: 0 }),
    analogMeterPreset('nagra-modulometer', 'Nagra Modulometer', { md: 'PPM', at: 7.5, rl: -18, sc: 2, rg: 30, ph: 0 }),
    // RMS dials span rl - rg to 0 dBFS, so these ranges put the bottom at -60 dBFS.
    analogMeterPreset('k-20', 'K-20', { md: 'RMS', rl: -20, rg: 40 }),
    analogMeterPreset('k-14', 'K-14', { md: 'RMS', rl: -14, rg: 46 }),
    analogMeterPreset('k-12', 'K-12', { md: 'RMS', rl: -12, rg: 48 }),
    analogMeterPreset('digital-peak', 'Digital Peak', { md: 'Sample Peak', rg: 60, ph: 2 }),
    analogMeterPreset('true-peak-clip-watch', 'True Peak Clip Watch', { md: 'True Peak', rg: 20, ph: 10 }),
    analogMeterPreset('ebu-r128', 'EBU R128 (-23 LUFS)', { md: 'Loudness' }),
    analogMeterPreset('ebu-r128-wide', 'EBU R128 +18 Scale', { md: 'Loudness', ls: 1 }),
    analogMeterPreset('tv-24-lkfs', 'TV (-24 LKFS)', { md: 'Loudness', tg: -24 }),
    analogMeterPreset('streaming-14-lufs', 'Streaming (-14 LUFS)', { md: 'Loudness', tg: -14, ln: 1 }),
    analogMeterPreset('streaming-16-lufs', 'Streaming (-16 LUFS)', { md: 'Loudness', tg: -16, ln: 1 })
]);
// Modes in which each parameter changes the reading or the display.
const ANALOG_METER_ACTIVE_MODES = Object.freeze({
    it: ['RMS'],
    at: ['PPM'],
    rt: ['PPM', 'Sample Peak', 'True Peak'],
    rl: ['VU', 'PPM', 'RMS'],
    rg: ['PPM', 'RMS', 'Sample Peak', 'True Peak'],
    sc: ['PPM'],
    ph: ['PPM', 'RMS', 'Sample Peak', 'True Peak'],
    ln: ['Loudness'],
    tg: ['Loudness'],
    ls: ['Loudness']
});

function isAnalogMeterParameterActive(key, params) {
    // The BBC dial has fixed marks 1 to 7, so Range has nothing to set there.
    if (key === 'rg' && params.md === 'PPM' && params.sc === ANALOG_METER_PPM_BBC) return false;
    return ANALOG_METER_ACTIVE_MODES[key].includes(params.md);
}

function analogMeterLinearTicks(min, max, step, extra = [], unlabeled = []) {
    const values = new Set(extra);
    for (let value = Math.ceil(min / step) * step; value <= max + 1e-9; value += step) values.add(value);
    return [...values].filter(value => value >= min - 1e-9 && value <= max + 1e-9)
        .sort((a, b) => a - b)
        .map(value => ({ value, label: unlabeled.includes(value) ? '' : String(value) }));
}

function analogMeterSigned(value) {
    return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}

// Maps detector dB readings onto the dial of each mode (plan section 2.4).
function analogMeterScale(mode, params = ANALOG_METER_DEFAULTS) {
    const rl = params.rl;
    const rg = params.rg;
    const base = { reference: null, redFrom: null, toLabel: db => db, position: null };
    let scale;
    if (mode === 'VU') {
        const full = 10 ** (3 / 20);
        scale = {
            ...base, unit: 'VU', min: -20, max: 3, reference: 0, redFrom: 0,
            toLabel: db => db - rl,
            // A VU dial is linear in voltage.
            position: vu => 10 ** (vu / 20) / full,
            ticks: [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3]
                .map(value => ({ value, label: value === -1 || value === 1 ? '' : String(value) })),
            format: vu => `${analogMeterSigned(vu)} VU`
        };
    } else if (mode === 'PPM' && params.sc === 2) {
        scale = {
            ...base, unit: 'dB', min: -rg, max: 5, reference: 0, redFrom: 0,
            toLabel: db => db - rl,
            ticks: analogMeterLinearTicks(-rg, 5, rg > 30 ? 10 : 5, [0, 5]),
            format: value => `${analogMeterSigned(value)} dB`
        };
    } else if (mode === 'PPM' && params.sc !== ANALOG_METER_PPM_BBC) {
        scale = {
            ...base, unit: 'dB', min: -rg, max: 5, reference: -9, redFrom: 0,
            toLabel: db => db - (rl + 9),
            ticks: analogMeterLinearTicks(-rg, 5, 10, [-9, -5, 0, 5], [-10]),
            format: value => `${analogMeterSigned(value)} dB`
        };
    } else if (mode === 'PPM') {
        scale = {
            ...base, unit: '', min: 1, max: 7, reference: 4, redFrom: 6,
            // Marks 2 to 7 are 4 dB apart and mark 1 is 6 dB below mark 2.
            toLabel: db => {
                const relative = db - rl;
                return relative >= -8 ? 4 + relative / 4 : 2 + (relative + 8) / 6;
            },
            ticks: [1, 2, 3, 4, 5, 6, 7].map(value => ({ value, label: String(value) })),
            format: mark => `Mark ${mark < 0 ? '0.0' : mark.toFixed(1)}`
        };
    } else if (mode === 'RMS') {
        scale = {
            ...base, unit: 'dB', min: -rg, max: -rl, reference: 0,
            toLabel: db => db - rl,
            ticks: analogMeterLinearTicks(-rg, -rl, 10, [0]),
            format: value => `${analogMeterSigned(value)} dB`
        };
    } else if (mode === 'Sample Peak' || mode === 'True Peak') {
        const unit = mode === 'True Peak' ? 'dBTP' : 'dBFS';
        scale = {
            ...base, unit, min: -rg, max: 0,
            ticks: analogMeterLinearTicks(-rg, 0, rg > 30 ? 10 : 5),
            format: value => `${analogMeterSigned(value)} ${unit}`
        };
    } else {
        const wide = params.ls === 1;
        const tg = params.tg;
        const low = wide ? -36 : -18;
        const high = wide ? 18 : 9;
        scale = {
            ...base, unit: 'LUFS', min: tg + low, max: tg + high,
            reference: tg,
            // Ticks are counted from Target so it never collides with a neighbouring mark.
            ticks: analogMeterLinearTicks(low, high, wide ? 6 : 3)
                .map(({ value }) => ({ value: value + tg, label: String(value + tg) })),
            format: value => `${value.toFixed(1)} LUFS`
        };
    }
    const linear = value => (value - scale.min) / (scale.max - scale.min);
    const position = scale.position ?? linear;
    scale.valuePosition = value => {
        const result = position(value);
        return result < 0 ? 0 : (result > 1 ? 1 : result);
    };
    scale.dbPosition = db => scale.valuePosition(scale.toLabel(db));
    scale.readout = db => db <= ANALOG_METER_SILENCE_DB ? '-∞' : scale.format(scale.toLabel(db));
    return scale;
}

// Labels kept on a crowded dial: every other label counted from the reference (0 without one).
function analogMeterSparseLabels(scale) {
    const labeled = scale.ticks.filter(tick => tick.label !== '');
    const anchor = Math.max(0, labeled.findIndex(tick => tick.value === (scale.reference ?? 0)));
    return new Set(labeled.filter((tick, index) => (index - anchor) % 2 === 0));
}

function analogMeterGrid(cellCount, maxColumns = ANALOG_METER_MAX_COLUMNS) {
    const cells = cellCount < 1 ? 1 : cellCount;
    const columns = cells < maxColumns ? cells : maxColumns;
    return { cells, columns, rows: Math.ceil(cells / columns) };
}

function analogMeterAspect(grid) {
    // Each meter cell keeps a 4:3 face so the dial stays legible.
    return `${grid.columns * 4} / ${grid.rows * 3}`;
}

function parseAnalogMeterFrame(frame) {
    if (frame?.frameType !== ANALOG_METER_FRAME_TYPE ||
        frame.formatVersion !== ANALOG_METER_TELEMETRY_VERSION) return null;
    const payload = frame.payload;
    if (!payload || typeof payload.getFloat32 !== 'function' || payload.byteLength < 4) return null;
    const mode = payload.getUint8(0);
    const channelCount = payload.getUint8(1);
    const flags = payload.getUint16(2, true);
    if (mode >= ANALOG_METER_MODES.length || channelCount < 1 ||
        channelCount > ANALOG_METER_MAX_CHANNELS || flags > 3) return null;
    const loudness = mode === ANALOG_METER_LOUDNESS_MODE;
    if (payload.byteLength !== 4 + 8 * channelCount + (loudness ? 24 : 0)) return null;
    const channels = [];
    for (let channel = 0; channel < channelCount; channel++) {
        const needleDb = payload.getFloat32(4 + 8 * channel, true);
        const maxDb = payload.getFloat32(8 + 8 * channel, true);
        if (!Number.isFinite(needleDb) || !Number.isFinite(maxDb)) return null;
        channels.push({ needleDb, maxDb });
    }
    let program = null;
    if (loudness) {
        const offset = 4 + 8 * channelCount;
        const values = [];
        for (let index = 0; index < 6; index++) {
            const value = payload.getFloat32(offset + 4 * index, true);
            if (!Number.isFinite(value)) return null;
            values.push(value);
        }
        const [momentary, shortTerm, integrated, lra, maxTruePeak, integratedSeconds] = values;
        program = { momentary, shortTerm, integrated, lra, maxTruePeak, integratedSeconds };
    }
    return {
        mode,
        channelCount,
        integratedValid: (flags & 1) !== 0,
        lraValid: (flags & 2) !== 0,
        channels,
        program
    };
}

// Holds the highest detector reading for holdSeconds, then follows the detector again.
// The over time is recorded regardless of Peak Hold so the lamp works with a hold of 0.
function updateAnalogMeterHold(state, db, nowMs, holdSeconds) {
    if (!(holdSeconds > 0) || !Number.isFinite(state.db) || db >= state.db ||
        nowMs - state.time >= holdSeconds * 1000) {
        state.db = db;
        state.time = nowMs;
    }
    if (db > 0) state.overTime = nowMs;
    return state;
}

// The over lamp stays lit for the Peak Hold time, or for 1 second when Peak Hold is 0.
function isAnalogMeterOverLit(state, nowMs, holdSeconds) {
    const litMs = (holdSeconds > 0 ? holdSeconds : 1) * 1000;
    return state?.overTime != null && nowMs - state.overTime < litMs;
}

function formatAnalogMeterDuration(seconds) {
    const total = Math.floor(seconds > 0 ? seconds : 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    const rest = String(total % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

class AnalogMeterPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({ requiresWasm: true });
    static MODES = ANALOG_METER_MODES;
    static scale = analogMeterScale;
    static sparseLabels = analogMeterSparseLabels;
    static grid = analogMeterGrid;
    static aspect = analogMeterAspect;
    static parseTelemetryFrame = parseAnalogMeterFrame;
    static updateHold = updateAnalogMeterHold;
    static isOverLit = isAnalogMeterOverLit;
    static isParameterActive = isAnalogMeterParameterActive;

    static getSystemPresetGroups() {
        return [{ label: '', presets: ANALOG_METER_SYSTEM_PRESETS.map(preset => ({ ...preset })) }];
    }

    constructor() {
        super('Analog Meter', 'Classic needle meter with VU, PPM, peak, and loudness ballistics');
        Object.assign(this, ANALOG_METER_DEFAULTS);
        // Stopped intervals are excluded from the measurement by design, so power-state
        // transitions must not reset the kernel: Integrated, LRA, maximum True Peak, the
        // needle, and the windows carry over and resume from where processing stopped.
        this.temporalCapability = 'stateless';
        this.initializeDisplayState();

        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundTelemetry = frame => this.handleTelemetry(frame);

        this.canvas = null;
        this.canvasCtx = null;
        this.graphContainer = null;
        this.observer = null;
        this.resizeGraphDisposer = null;
        this.isVisible = false;
        this.animationFrameId = null;

        this.registerProcessor('return data;');
    }

    // Display state only; the Visualizer item host shares it on an uninitialized instance
    // and keeps the parameters it has already applied (plan section 2.4).
    initializeDisplayState() {
        this.channelCount = 2;
        this.reading = null;
        this.holds = [];
        this.resetButton = null;
        this.parameterRows = {};
        this.graphDpr = 1;
    }

    reset() {
        this.setParameters({ ...ANALOG_METER_DEFAULTS });
    }

    getParameters() {
        this.ensureDspTelemetrySubscription();
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            md: this.md,
            it: this.it,
            at: this.at,
            rt: this.rt,
            rl: this.rl,
            rg: this.rg,
            sc: this.sc,
            ph: this.ph,
            ln: this.ln,
            tg: this.tg,
            ls: this.ls
        };
    }

    setParameters(params = {}) {
        if (params.enabled !== undefined) this.enabled = params.enabled !== false;
        let modeChanged = false;
        if (ANALOG_METER_MODES.includes(params.md) && params.md !== this.md) {
            this.md = params.md;
            this.clearReading();
            modeChanged = true;
        }
        if (params.it !== undefined) this.it = this.parseFiniteNumber(params.it, 0.05, 3, this.it);
        if (params.at !== undefined) this.at = this.parseFiniteNumber(params.at, 1, 20, this.at);
        if (params.rt !== undefined) this.rt = this.parseFiniteNumber(params.rt, 0.1, 5, this.rt);
        if (params.rl !== undefined) this.rl = this.parseFiniteNumber(params.rl, -30, 0, this.rl);
        if (params.rg !== undefined) this.rg = this.parseFiniteNumber(params.rg, 20, 60, this.rg);
        if (params.ph !== undefined) this.ph = this.parseFiniteNumber(params.ph, 0, 10, this.ph);
        if (params.tg !== undefined) this.tg = this.parseFiniteNumber(params.tg, -36, -10, this.tg);
        for (const key of ['ln', 'ls']) {
            const value = params[key] === undefined ? null : Number(params[key]);
            if (value === 0 || value === 1) this[key] = value;
        }
        const scaleValue = params.sc === undefined ? null : Number(params.sc);
        const scaleChanged = Number.isInteger(scaleValue) && scaleValue >= 0 &&
            scaleValue < ANALOG_METER_PPM_SCALES.length && scaleValue !== this.sc;
        if (scaleChanged) this.sc = scaleValue;
        if (modeChanged) this.updateGraphLayout();
        if (modeChanged || scaleChanged) this.syncControlStates();
        this.drawGraph();
        this.updateParameters();
    }

    clearReading() {
        this.reading = null;
        this.holds = [];
    }

    // Sends the worklet-side reset over the same port that carries parameter updates.
    resetMeasurement() {
        if (this.audioHostActive !== false) {
            window.workletNode?.port?.postMessage({ type: 'resetPluginState', pluginId: this.id });
        }
        this.clearReading();
        this.drawGraph();
    }

    _setupMessageHandler() {
        super._setupMessageHandler();
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
            const unsubscribe = hub.subscribe(tapId, ANALOG_METER_FRAME_TYPE, this._boundTelemetry);
            if (typeof unsubscribe !== 'function') {
                hub.unsubscribe?.(tapId, ANALOG_METER_FRAME_TYPE, this._boundTelemetry);
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

    handleTelemetry(frame) {
        if (!frame || !this.enabled || !this._sectionEnabled) return;
        this.applyReading(parseAnalogMeterFrame(frame));
    }

    // The Visualizer drives a two-channel scratch; a single selected channel arrives twice.
    handleVisualizerTelemetry(frame) {
        const reading = parseAnalogMeterFrame(frame);
        if (reading && this.displayOptions?.channelLabels?.length === 1) {
            reading.channels.length = 1;
            reading.channelCount = 1;
            const program = reading.program;
            if (program) {
                // Summing the duplicated channel raises the program loudness by 3.01 dB.
                const doubled = 10 * Math.log10(2);
                program.momentary -= doubled;
                program.shortTerm -= doubled;
                program.integrated -= doubled;
            }
        }
        this.applyReading(reading);
    }

    applyReading(reading) {
        // Frames still in flight from the previous mode are dropped.
        if (!reading || ANALOG_METER_MODES[reading.mode] !== this.md) return;
        if (reading.channelCount !== this.channelCount) {
            this.channelCount = reading.channelCount;
            this.holds = [];
            this.updateGraphLayout();
        }
        if (ANALOG_METER_ACTIVE_MODES.ph.includes(this.md)) {
            const now = performance.now();
            reading.channels.forEach((channel, index) => {
                this.holds[index] = updateAnalogMeterHold(
                    this.holds[index] ?? { db: NaN, time: now, overTime: null },
                    channel.maxDb, now, this.ph
                );
            });
        }
        this.reading = reading;
    }

    cellCount() {
        return this.channelCount + (this.md === 'Loudness' ? 1 : 0);
    }

    updateGraphLayout() {
        const container = this.graphContainer;
        if (!container) return;
        const cells = this.cellCount();
        const desktop = analogMeterGrid(cells);
        container.style.aspectRatio = analogMeterAspect(desktop);
        container.style.maxWidth = `${desktop.columns * 320 < 1024 ? desktop.columns * 320 : 1024}px`;
        const mobile = analogMeterAspect(analogMeterGrid(cells, ANALOG_METER_MOBILE_COLUMNS));
        if (typeof container.style.setProperty === 'function') {
            container.style.setProperty('--mobile-aspect-ratio', mobile);
        } else {
            container.style['--mobile-aspect-ratio'] = mobile;
        }
    }

    syncControlStates() {
        if (this.resetButton) this.resetButton.style.display = this.md === 'Loudness' ? '' : 'none';
        // Parameters that do nothing in the current mode are hidden, so the panel height follows the mode.
        for (const [key, row] of Object.entries(this.parameterRows)) {
            row.style.display = isAnalogMeterParameterActive(key, this) ? '' : 'none';
        }
    }

    createUI() {
        this.ensureDspTelemetrySubscription();
        this.observer?.disconnect();
        this.resizeGraphDisposer?.();
        this.resizeGraphDisposer = null;
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';
        const rows = this.parameterRows = {};
        // Two columns on desktop, one on mobile (css/effetune.css and css/effetune-mobile.css).
        const parameters = document.createElement('div');
        parameters.className = 'analog-meter-parameters';
        parameters.appendChild(this.createSelectControl(
            'Mode', ANALOG_METER_MODES, this.md, value => this.setParameters({ md: value }), 'md'
        ));
        rows.it = this.createParameterControl(
            'Integration', 0.05, 3, 0.01, this.it, value => this.setParameters({ it: value }), 's', 'it');
        rows.at = this.createParameterControl(
            'Attack', 1, 20, 0.1, this.at, value => this.setParameters({ at: value }), 'ms', 'at');
        rows.rt = this.createParameterControl(
            'Release', 0.1, 5, 0.01, this.rt, value => this.setParameters({ rt: value }), 's', 'rt');
        rows.rl = this.createParameterControl(
            'Reference', -30, 0, 1, this.rl, value => this.setParameters({ rl: value }), 'dBFS', 'rl');
        rows.rg = this.createParameterControl(
            'Range', 20, 60, 1, this.rg, value => this.setParameters({ rg: value }), 'dB', 'rg');
        rows.sc = this.createRadioGroup('PPM Scale',
            ANALOG_METER_PPM_SCALES.map((label, index) => ({ value: String(index), label })),
            String(this.sc), value => this.setParameters({ sc: value }), 'sc');
        rows.ph = this.createParameterControl(
            'Peak Hold', 0, 10, 0.1, this.ph, value => this.setParameters({ ph: value }), 's', 'ph');
        rows.ln = this.createRadioGroup('Needle',
            [{ value: '0', label: 'Momentary' }, { value: '1', label: 'Short-term' }],
            String(this.ln), value => this.setParameters({ ln: value }), 'ln');
        rows.tg = this.createParameterControl(
            'Target', -36, -10, 1, this.tg, value => this.setParameters({ tg: value }), 'LUFS', 'tg');
        rows.ls = this.createRadioGroup('Scale',
            [{ value: '0', label: 'EBU +9' }, { value: '1', label: 'EBU +18' }],
            String(this.ls), value => this.setParameters({ ls: value }), 'ls');
        for (const row of Object.values(rows)) parameters.appendChild(row);
        container.appendChild(parameters);

        const graph = this.createResponsiveGraph({
            maxWidth: 1024,
            aspectRatio: analogMeterAspect(analogMeterGrid(this.cellCount())),
            mobileAspectRatio: analogMeterAspect(analogMeterGrid(this.cellCount(), ANALOG_METER_MOBILE_COLUMNS)),
            onResize: ({ canvas, dpr }) => {
                this.canvas = canvas;
                this.graphDpr = dpr;
                this.canvasCtx = canvas.getContext('2d', { alpha: false });
                this.drawGraph();
            }
        });
        this.canvas = graph.canvas;
        this.canvasCtx = this.canvas.getContext('2d', { alpha: false });
        this.graphContainer = graph.container;
        this.graphContainer.style.marginInline = 'auto';
        this.resizeGraphDisposer = graph.dispose;
        this.canvas.setAttribute('aria-label', 'Analog meter readings');
        container.appendChild(graph.container);
        this.updateGraphLayout();

        // Placed in normal flow right below the graph (S-12), so it stays next to the
        // Loudness program meter's Integrated/LRA/max True Peak readouts drawn there,
        // instead of floating over the common effect header like the shared Analyzer
        // reset button class does.
        const resetButton = document.createElement('button');
        resetButton.className = 'analog-meter-reset-button';
        resetButton.textContent = 'Reset';
        resetButton.title = 'Restart the Integrated, LRA, and maximum True Peak measurement';
        resetButton.addEventListener('click', () => this.resetMeasurement());
        this.resetButton = resetButton;
        container.appendChild(resetButton);

        this.registerUIRefresh?.(() => this.syncControlStates());
        this.syncControlStates();

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

    _displayPalette() {
        const read = name => window.ThemePalette?.get(name) ?? '';
        return {
            background: read('graph-bg-deep'),
            grid: read('graph-grid-soft'),
            label: read('graph-label-soft'),
            text: read('text-primary'),
            danger: (this.canvas && window.getComputedStyle?.(this.canvas)
                ?.getPropertyValue('--et-danger').trim()) || ANALOG_METER_DANGER_COLOR
        };
    }

    drawGraph() {
        if (!this.canvas || !this.canvasCtx) return;
        const context = this.canvasCtx;
        const palette = this._displayPalette();
        const width = this.canvas.width;
        const height = this.canvas.height;
        context.fillStyle = palette.background;
        context.fillRect(0, 0, width, height);
        const cells = this.cellCount();
        // Follow whichever aspect ratio the current layout applied to the container.
        this.drawMeterCells(context, palette, width, height,
            [analogMeterGrid(cells), analogMeterGrid(cells, ANALOG_METER_MOBILE_COLUMNS)]);
    }

    // Visualizer item: drawn with the host's theme colors, palette, and flip transform (plan section 2.4).
    drawVisualizerMeter() {
        const canvas = this.canvas;
        const context = this.ctx;
        if (!canvas || !context) return;
        const options = this.displayOptions || {};
        const theme = role => options.themePalette?.get(role) ?? '';
        const palette = {
            grid: theme('graph-grid-soft'),
            label: theme('graph-label'),
            text: theme('text-primary'),
            danger: ANALOG_METER_DANGER_COLOR
        };
        context.clearRect(0, 0, canvas.width, canvas.height);
        const cells = this.cellCount();
        const grids = Array.from({ length: cells }, (_, index) => analogMeterGrid(cells, index + 1));
        // The host options supply textContext, drawSignal, needleColor, showAxes, and showAxisNumbers.
        this.drawMeterCells(context, palette, canvas.width, canvas.height, grids, {
            ...options,
            // Text scales with the cell's 4:3 face instead of the effect graph's fixed clamp.
            fontSize: (width, height) => (width < height * 4 / 3 ? width : height * 4 / 3) / 22
        });
    }

    // Lays the meters out on the candidate grid closest to the canvas aspect ratio.
    drawMeterCells(context, palette, width, height, grids, options = {}) {
        const actual = width / (height || 1);
        const distance = candidate => Math.abs(candidate.columns * 4 / (candidate.rows * 3) - actual);
        let grid = grids[0];
        for (const candidate of grids) if (distance(candidate) < distance(grid)) grid = candidate;
        const cellWidth = width / grid.columns;
        const cellHeight = height / grid.rows;
        const scale = analogMeterScale(this.md, this);
        const loudness = this.md === 'Loudness';
        const now = performance.now();
        for (let cell = 0; cell < grid.cells; cell++) {
            const x = (cell % grid.columns) * cellWidth;
            const y = Math.floor(cell / grid.columns) * cellHeight;
            const channel = loudness ? cell - 1 : cell;
            this.drawCell(context, palette, scale, x, y, cellWidth, cellHeight, channel, now, options);
        }
    }

    cellReading(channel) {
        const reading = this.reading;
        const loudness = this.md === 'Loudness';
        if (channel < 0) {
            const program = reading?.program;
            return program ? (this.ln === 1 ? program.shortTerm : program.momentary) : null;
        }
        const values = reading?.channels[channel];
        if (!values) return null;
        return loudness && this.ln === 1 ? values.maxDb : values.needleDb;
    }

    cellTitle(channel) {
        if (channel >= 0) {
            // The Visualizer names the input channels its scratch channels were taken from.
            const number = this.displayOptions?.channelLabels?.[channel] ?? channel + 1;
            return this.md === 'Loudness' ? `Ch ${number} (reference)` : `Ch ${number}`;
        }
        // BS.1770 defines channel weights for mono, stereo, and 5.1 only.
        const standard = this.channelCount === 1 || this.channelCount === 2 || this.channelCount === 6;
        return standard ? 'Program' : 'Program (reference)';
    }

    // options: showAxes (frame, dial, and ticks), showAxisNumbers (all text), textContext,
    // drawSignal and needleColor for the needle and hub, and fontSize(width, height).
    drawCell(context, palette, scale, x, y, width, height, channel, now, options = {}) {
        const axes = options.showAxes !== false;
        const numbers = options.showAxisNumbers !== false;
        const text = options.textContext ?? context;
        const dpr = this.graphDpr || 1;
        const inset = 4 * dpr;
        if (axes) {
            context.strokeStyle = palette.grid;
            context.lineWidth = dpr;
            context.strokeRect(x + inset, y + inset, width - 2 * inset, height - 2 * inset);
        }

        const program = channel < 0;
        const textLines = program ? 3 : 1;
        const fontSize = options.fontSize ? options.fontSize(width, height)
            : Math.max(9, Math.min(14, width / dpr / 22)) * dpr;
        const bottomSpace = (textLines + 0.8) * fontSize * 1.25;
        const radians = ANALOG_METER_ARC_DEGREES * Math.PI / 180;
        const pivotX = x + width / 2;
        const pivotY = y + height - inset - bottomSpace;
        const topSpace = fontSize * 3.2;
        const radius = Math.max(8 * dpr, Math.min(
            (width / 2 - inset - fontSize * 1.5) / Math.sin(radians),
            pivotY - (y + inset + topSpace)
        ));
        const angleAt = position => -radians + 2 * radians * position;
        const pointAt = (position, distance) => {
            const angle = angleAt(position);
            return [pivotX + Math.sin(angle) * distance, pivotY - Math.cos(angle) * distance];
        };

        // Dial arc, red zone, and ticks.
        if (axes) {
            context.strokeStyle = palette.label;
            context.lineWidth = dpr;
            context.beginPath();
            context.arc(pivotX, pivotY, radius, -Math.PI / 2 - radians, -Math.PI / 2 + radians);
            context.stroke();
        }
        if (axes && scale.redFrom !== null) {
            context.strokeStyle = palette.danger;
            context.lineWidth = 3 * dpr;
            context.beginPath();
            context.arc(pivotX, pivotY, radius + 2 * dpr,
                -Math.PI / 2 + angleAt(scale.valuePosition(scale.redFrom)), -Math.PI / 2 + radians);
            context.stroke();
        }
        context.font = `${fontSize * 0.85}px Arial`;
        context.textAlign = 'center';
        context.textBaseline = 'bottom';
        // Ruling S-16: thin the labels when adjacent ones would overlap along the label arc.
        const labelRadius = radius + 9 * dpr;
        const labeled = scale.ticks.filter(tick => tick.label !== '');
        let widest = 0;
        let spacing = Infinity;
        for (let i = 0; i < labeled.length; i++) {
            const labelWidth = context.measureText(labeled[i].label).width;
            if (labelWidth > widest) widest = labelWidth;
            if (i === 0) continue;
            const arc = 2 * radians * labelRadius
                * Math.abs(scale.valuePosition(labeled[i].value) - scale.valuePosition(labeled[i - 1].value));
            if (arc < spacing) spacing = arc;
        }
        const kept = spacing < widest + fontSize * 0.3 ? analogMeterSparseLabels(scale) : null;
        for (const tick of scale.ticks) {
            const position = scale.valuePosition(tick.value);
            const major = tick.label !== '';
            const reference = tick.value === scale.reference;
            if (axes) {
                const [x0, y0] = pointAt(position, radius);
                const [x1, y1] = pointAt(position, radius + (major ? 7 : 4) * dpr);
                context.strokeStyle = reference ? palette.text : palette.label;
                context.lineWidth = (reference ? 2 : 1) * dpr;
                context.beginPath();
                context.moveTo(x0, y0);
                context.lineTo(x1, y1);
                context.stroke();
            }
            if (!numbers || !major || (kept && !kept.has(tick))) continue;
            const [labelX, labelY] = pointAt(position, labelRadius);
            context.fillStyle = reference ? palette.text : palette.label;
            text.fillText(tick.label, labelX, labelY);
        }

        // Title and unit.
        const holdMode = ANALOG_METER_ACTIVE_MODES.ph.includes(this.md);
        if (numbers) {
            context.fillStyle = palette.text;
            context.font = `bold ${fontSize}px Arial`;
            context.textAlign = 'left';
            context.textBaseline = 'top';
            text.fillText(this.cellTitle(channel), x + inset * 2, y + inset * 2);
            context.fillStyle = palette.label;
            context.font = `${fontSize * 0.85}px Arial`;
            context.textAlign = 'right';
            const modeLabel = this.md === 'Loudness' ? (this.ln === 1 ? 'Short-term' : 'Momentary')
                : (this.md === 'PPM' ? `PPM ${ANALOG_METER_PPM_SCALES[this.sc]}` : this.md);
            text.fillText(modeLabel, x + width - inset * 2 - (holdMode ? fontSize * 1.2 : 0), y + inset * 2);
        }

        // Peak hold and the 0 dBFS over lamp.
        const hold = channel >= 0 ? this.holds[channel] : null;
        if (holdMode) {
            const lampRadius = fontSize * 0.4;
            const lampX = x + width - inset * 2 - lampRadius;
            const lampY = y + inset * 2 + fontSize * 0.5;
            context.beginPath();
            context.arc(lampX, lampY, lampRadius, 0, Math.PI * 2);
            if (isAnalogMeterOverLit(hold, now, this.ph)) {
                context.fillStyle = palette.danger;
                context.fill();
            } else {
                context.strokeStyle = palette.grid;
                context.lineWidth = dpr;
                context.stroke();
            }
            if (this.ph > 0 && hold && Number.isFinite(hold.db) && hold.db > ANALOG_METER_SILENCE_DB) {
                const position = scale.dbPosition(hold.db);
                const [x0, y0] = pointAt(position, radius * 0.86);
                const [x1, y1] = pointAt(position, radius);
                context.strokeStyle = palette.danger;
                context.lineWidth = 3 * dpr;
                context.beginPath();
                context.moveTo(x0, y0);
                context.lineTo(x1, y1);
                context.stroke();
            }
        }

        // The needle shows the received ballistic reading as is.
        const db = this.cellReading(channel);
        const needlePosition = db === null ? 0 : scale.dbPosition(db);
        const [tipX, tipY] = pointAt(needlePosition, radius * 1.02);
        const needleColor = options.needleColor ? options.needleColor(needlePosition) : palette.text;
        const drawNeedle = target => {
            target.strokeStyle = needleColor;
            target.lineWidth = 2 * dpr;
            target.beginPath();
            target.moveTo(pivotX, pivotY);
            target.lineTo(tipX, tipY);
            target.stroke();
            target.fillStyle = needleColor;
            target.beginPath();
            target.arc(pivotX, pivotY, 3 * dpr, 0, Math.PI * 2);
            target.fill();
        };
        if (options.drawSignal) options.drawSignal(context, drawNeedle);
        else drawNeedle(context);

        // Numeric readings.
        if (!numbers) return;
        context.fillStyle = palette.text;
        context.textAlign = 'center';
        context.textBaseline = 'top';
        context.font = `${fontSize}px monospace`;
        let lineY = pivotY + fontSize * 0.8;
        text.fillText(db === null ? '---' : scale.readout(db), pivotX, lineY);
        if (!program || !this.reading?.program) return;
        const values = this.reading.program;
        const lufs = value => value <= ANALOG_METER_SILENCE_DB ? '-∞' : value.toFixed(1);
        context.font = `${fontSize * 0.85}px monospace`;
        context.fillStyle = palette.label;
        lineY += fontSize * 1.25;
        text.fillText(`M ${lufs(values.momentary)}  S ${lufs(values.shortTerm)}  ` +
            `I ${this.reading.integratedValid ? lufs(values.integrated) : '---'} LUFS`, pivotX, lineY);
        lineY += fontSize * 1.1;
        text.fillText(`LRA ${this.reading.lraValid ? values.lra.toFixed(1) : '---'} LU  ` +
            `TP ${lufs(values.maxTruePeak)} dBTP  ${formatAnalogMeterDuration(values.integratedSeconds)}`,
        pivotX, lineY);
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
        this.canvas = null;
        this.canvasCtx = null;
        this.graphContainer = null;
        this.resetButton = null;
        this.parameterRows = {};
        this.observer = null;
        super.cleanup();
    }
}

window.AnalogMeterPlugin = AnalogMeterPlugin;
