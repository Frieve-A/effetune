const TONAL_BALANCE_EQ_FRAME_TYPE = 29;
const TONAL_BALANCE_EQ_TELEMETRY_VERSION = 1;
const TONAL_BALANCE_EQ_PAYLOAD_BYTES = 1564;
const TONAL_BALANCE_EQ_BANDS = 41;
const TONAL_BALANCE_EQ_GRID = 128;
// Target enum of the kernel parameters, in kernel index order (append-only).
const TONAL_BALANCE_EQ_TARGETS = Object.freeze(['All', 'Classical', 'Electronic', 'Pop', 'Rock', 'Tilt']);
// Target adjust bands: flat keys ea/ta/fa/ga/qa + band index (enabled, type, frequency, gain, Q).
const TONAL_BALANCE_EQ_ADJUST_FREQUENCIES = Object.freeze([100, 316, 1000, 3160, 10000]);
const TONAL_BALANCE_EQ_ADJUST_TYPES = Object.freeze(['pk', 'ls', 'hs']);
const TONAL_BALANCE_EQ_DEFAULTS = Object.freeze({
    tg: 'All', am: 100, rg: 6, sm: 0.5, at: 30, lo: 20, hi: 16000, sp: 83, ts: -6, tc: 250,
    ...Object.fromEntries(TONAL_BALANCE_EQ_ADJUST_FREQUENCIES.flatMap((frequency, band) => [
        ['ea' + band, true], ['ta' + band, 'pk'], ['fa' + band, frequency], ['ga' + band, 0], ['qa' + band, 0.7]
    ]))
});
const TONAL_BALANCE_EQ_RANGES = Object.freeze({
    am: [0, 100], rg: [0, 12], sm: [0.1667, 2], at: [0.1, 100], lo: [20, 200], hi: [2000, 20000], sp: [60, 96],
    ts: [-18, 0], tc: [20, 1000],
    ...Object.fromEntries(TONAL_BALANCE_EQ_ADJUST_FREQUENCIES.flatMap((_, band) => [
        ['fa' + band, [20, 20000]], ['ga' + band, [-20, 20]]
    ]))
});
// The top Averaging Time value is the infinite time constant (growing mean since reset).
const TONAL_BALANCE_EQ_AVERAGING_TIME_INFINITE = 100;
const TONAL_BALANCE_EQ_AVERAGING_TIME_MIN = 0.1;
const TONAL_BALANCE_EQ_HAS_TARGET = 4;
const TONAL_BALANCE_EQ_HAS_LEVEL = 8;
const TONAL_BALANCE_EQ_IN_RANGE = 16;
const TONAL_BALANCE_EQ_LOUDNESS_VALID = 4;
// ERB-rate band centres (Cam b + 1) and the 128-point response grid of frame 29 (20 Hz to 20 kHz).
const TONAL_BALANCE_EQ_BAND_CENTRES = Float64Array.from({ length: TONAL_BALANCE_EQ_BANDS },
    (_, band) => (10 ** ((band + 1) / 21.4) - 1) * 1000 / 4.37);
const TONAL_BALANCE_EQ_BAND_LOG_FREQS = TONAL_BALANCE_EQ_BAND_CENTRES.map(Math.log10);
const TONAL_BALANCE_EQ_GRID_LOG_MIN = Math.log10(20);
const TONAL_BALANCE_EQ_GRID_LOG_SPAN = Math.log10(20000) - TONAL_BALANCE_EQ_GRID_LOG_MIN;
const TONAL_BALANCE_EQ_GRID_LOG_FREQS = Float64Array.from({ length: TONAL_BALANCE_EQ_GRID },
    (_, index) => TONAL_BALANCE_EQ_GRID_LOG_MIN + TONAL_BALANCE_EQ_GRID_LOG_SPAN * index / (TONAL_BALANCE_EQ_GRID - 1));
// The graph's frequency axis spans the band centres over the whole canvas width, so the per-band
// curves reach both edges; the response grid is drawn clipped to it.
const TONAL_BALANCE_EQ_LOG_MIN = TONAL_BALANCE_EQ_BAND_LOG_FREQS[0];
const TONAL_BALANCE_EQ_LOG_SPAN = TONAL_BALANCE_EQ_BAND_LOG_FREQS[TONAL_BALANCE_EQ_BANDS - 1] - TONAL_BALANCE_EQ_LOG_MIN;
// Samples of the drawn Target adjust curve across the axis.
const TONAL_BALANCE_EQ_ADJUST_LOG_FREQS = Float64Array.from({ length: 512 },
    (_, index) => TONAL_BALANCE_EQ_LOG_MIN + TONAL_BALANCE_EQ_LOG_SPAN * index / 511);
// Samples of the drawn per-band curves: the response grid merged with the band centres, so the
// curves pass through every band value.
const TONAL_BALANCE_EQ_CURVE_LOG_FREQS = Float64Array.from(
    [...TONAL_BALANCE_EQ_GRID_LOG_FREQS, ...TONAL_BALANCE_EQ_BAND_LOG_FREQS]).sort();
const TONAL_BALANCE_EQ_FREQ_TICKS = Object.freeze([20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]);
const TONAL_BALANCE_EQ_DEFAULT_DB_RANGE = 12;

function averagingTimeToSliderPosition(averagingTime) {
    return 100 * Math.log(averagingTime / TONAL_BALANCE_EQ_AVERAGING_TIME_MIN) /
        Math.log(TONAL_BALANCE_EQ_AVERAGING_TIME_INFINITE / TONAL_BALANCE_EQ_AVERAGING_TIME_MIN);
}

function sliderPositionToAveragingTime(position) {
    const averagingTime = TONAL_BALANCE_EQ_AVERAGING_TIME_MIN *
        (TONAL_BALANCE_EQ_AVERAGING_TIME_INFINITE / TONAL_BALANCE_EQ_AVERAGING_TIME_MIN) ** (position / 100);
    const rounded = Math.round(averagingTime * 10) / 10;
    return rounded < TONAL_BALANCE_EQ_AVERAGING_TIME_MIN ? TONAL_BALANCE_EQ_AVERAGING_TIME_MIN
        : rounded > TONAL_BALANCE_EQ_AVERAGING_TIME_INFINITE ? TONAL_BALANCE_EQ_AVERAGING_TIME_INFINITE : rounded;
}

function formatAveragingTime(averagingTime) {
    return averagingTime >= TONAL_BALANCE_EQ_AVERAGING_TIME_INFINITE ? '∞' : averagingTime.toFixed(1);
}

function parseTonalBalanceEqFrame(frame) {
    if (frame?.frameType !== TONAL_BALANCE_EQ_FRAME_TYPE ||
        frame.formatVersion !== TONAL_BALANCE_EQ_TELEMETRY_VERSION) return null;
    const payload = frame.payload;
    if (!payload || typeof payload.getFloat32 !== 'function' ||
        payload.byteLength !== TONAL_BALANCE_EQ_PAYLOAD_BYTES ||
        payload.getUint16(4, true) !== TONAL_BALANCE_EQ_BANDS ||
        payload.getUint16(6, true) !== TONAL_BALANCE_EQ_GRID) return null;
    const floats = (offset, count) => {
        const values = new Float64Array(count);
        for (let index = 0; index < count; index++) {
            values[index] = payload.getFloat32(offset + 4 * index, true);
            if (!Number.isFinite(values[index])) return null;
        }
        return values;
    };
    const bandFlags = new Uint8Array(TONAL_BALANCE_EQ_BANDS);
    for (let band = 0; band < TONAL_BALANCE_EQ_BANDS; band++) bandFlags[band] = payload.getUint8(1008 + band);
    const reading = {
        sampleRate: payload.getFloat32(0, true),
        stateFlags: payload.getUint8(8),
        targetIndex: payload.getUint8(9),
        loudness: payload.getFloat32(12, true),
        makeup: payload.getFloat32(16, true),
        levelDb: floats(24, TONAL_BALANCE_EQ_BANDS),
        persistence: floats(188, TONAL_BALANCE_EQ_BANDS),
        presence: floats(352, TONAL_BALANCE_EQ_BANDS),
        mu: floats(680, TONAL_BALANCE_EQ_BANDS),
        sigma: floats(844, TONAL_BALANCE_EQ_BANDS),
        bandFlags,
        response: floats(1052, TONAL_BALANCE_EQ_GRID)
    };
    if (!(reading.sampleRate > 0) || !Number.isFinite(reading.loudness) || !Number.isFinite(reading.makeup)) return null;
    for (const key of ['levelDb', 'persistence', 'presence', 'mu', 'sigma', 'response']) {
        if (!reading[key]) return null;
    }
    return reading;
}

// Monotone cubic (Fritsch-Carlson, PCHIP slopes) interpolation in log-frequency of per-band
// values at the curve samples: exact at every band centre, never beyond the two neighbouring
// band values, and NaN outside runs of finite bands.
function interpolateBands(values) {
    const xs = TONAL_BALANCE_EQ_BAND_LOG_FREQS;
    const last = TONAL_BALANCE_EQ_BANDS - 1;
    const secant = band => (values[band + 1] - values[band]) / (xs[band + 1] - xs[band]);
    const slopes = new Float64Array(TONAL_BALANCE_EQ_BANDS);
    for (let band = 0; band <= last; band++) {
        const left = band > 0 ? secant(band - 1) : NaN;
        const right = band < last ? secant(band) : NaN;
        if (!Number.isFinite(left)) slopes[band] = right;
        else if (!Number.isFinite(right)) slopes[band] = left;
        else if (left * right <= 0) slopes[band] = 0;
        else {
            const leftWidth = xs[band] - xs[band - 1];
            const rightWidth = xs[band + 1] - xs[band];
            slopes[band] = 3 * (leftWidth + rightWidth) /
                ((2 * rightWidth + leftWidth) / left + (rightWidth + 2 * leftWidth) / right);
        }
    }
    const curve = new Float64Array(TONAL_BALANCE_EQ_CURVE_LOG_FREQS.length).fill(NaN);
    let band = 0;
    TONAL_BALANCE_EQ_CURVE_LOG_FREQS.forEach((x, index) => {
        while (band < last && xs[band + 1] <= x) band++;
        const y0 = values[band];
        if (x === xs[band]) {
            curve[index] = y0;
            return;
        }
        const y1 = values[band + 1];
        if (!(x > xs[band]) || !Number.isFinite(y0) || !Number.isFinite(y1)) return;
        const width = xs[band + 1] - xs[band];
        const t = (x - xs[band]) / width;
        const t2 = t * t;
        const t3 = t2 * t;
        curve[index] = (2 * t3 - 3 * t2 + 1) * y0 + (3 * t2 - 2 * t3) * y1 +
            ((t3 - 2 * t2 + t) * slopes[band] + (t3 - t2) * slopes[band + 1]) * width;
    });
    return curve;
}

// A band level is the power summed over the band's FFT bins, so it reads 10 log10(bandwidth) above
// the per-hertz density. These are those offsets for a sample rate, from the kernel's analysis
// geometry: N = 2^round(log2(0.085 fs)) clamped to 2^6..2^16, and band b sums the bins from
// ceil((c - w/2) / (fs/N)) up to ceil((c + w/2) / (fs/N)) (at most N/2 + 1), with c its centre
// and w its ERB width. NaN for a band without bins. The last result is cached.
let tonalBalanceEqDensity = { sampleRate: NaN, offsets: null };
function tonalBalanceEqDensityOffsets(sampleRate) {
    if (tonalBalanceEqDensity.sampleRate === sampleRate) return tonalBalanceEqDensity.offsets;
    const exponent = Math.floor(Math.log2(0.085 * sampleRate) + 0.5);
    const fftSize = 2 ** (exponent < 6 ? 6 : exponent > 16 ? 16 : exponent);
    const binHz = sampleRate / fftSize;
    const binCount = fftSize / 2 + 1;
    const offsets = TONAL_BALANCE_EQ_BAND_CENTRES.map(centre => {
        const halfWidth = 0.5 * 24.7 * (4.37 * centre / 1000 + 1);
        const begin = Math.ceil((centre - halfWidth) / binHz);
        const end = Math.ceil((centre + halfWidth) / binHz);
        const bins = (end < binCount ? end : binCount) - begin;
        return bins > 0 ? 10 * Math.log10(bins * binHz) : NaN;
    });
    tonalBalanceEqDensity = { sampleRate, offsets };
    return offsets;
}

// Display curves of one reading, as per-hertz density in dB relative to the mean target density
// (the deficit and lifts are differences, so the density offsets cancel in them). The measured
// spectrum is aligned to the target as the correction law does (alignment weighted by
// presence and persistence over the corrected bands). The withheld lift of a corrected band
// is Amount x (1 - presence) x the positive part of the deficit clipped to +-Range: the lift
// held back because presence is low (approximate; the cut-side shift, make-up gain and
// smoothing are not in it). amount is 0..1. Per-band values are NaN where absent; curves holds
// them interpolated at the curve samples, with the withheld lift rising from the EQ response.
function computeTonalBalanceEqView(reading, range, amount) {
    const { levelDb, persistence, presence, mu, sigma, bandFlags, response } = reading;
    const density = tonalBalanceEqDensityOffsets(reading.sampleRate);
    const bands = TONAL_BALANCE_EQ_BANDS;
    const used = TONAL_BALANCE_EQ_HAS_TARGET | TONAL_BALANCE_EQ_HAS_LEVEL | TONAL_BALANCE_EQ_IN_RANGE;
    let referenceSum = 0;
    let referenceCount = 0;
    let presenceSum = 0;
    let persistenceSum = 0;
    for (let band = 0; band < bands; band++) {
        if ((bandFlags[band] & TONAL_BALANCE_EQ_HAS_TARGET) && Number.isFinite(density[band])) {
            referenceSum += mu[band] - density[band];
            referenceCount++;
        }
        if ((bandFlags[band] & used) === used) {
            presenceSum += presence[band];
            persistenceSum += persistence[band];
        }
    }
    const reference = referenceCount > 0 ? referenceSum / referenceCount : 0;
    const contentShare = persistenceSum > 0 ? presenceSum / persistenceSum : 0;
    let weightSum = 0;
    let offsetSum = 0;
    for (let band = 0; band < bands; band++) {
        if ((bandFlags[band] & used) !== used) continue;
        const weight = persistenceSum > 0 ? presence[band] + (1 - contentShare) * persistence[band] : 1;
        weightSum += weight;
        offsetSum += weight * (mu[band] - levelDb[band]);
    }
    const aligned = weightSum > 0;
    const offset = aligned ? offsetSum / weightSum : 0;
    const view = {
        target: new Float64Array(bands).fill(NaN),
        targetLow: new Float64Array(bands).fill(NaN),
        targetHigh: new Float64Array(bands).fill(NaN),
        measured: new Float64Array(bands).fill(NaN),
        presence: new Float64Array(bands).fill(NaN),
        lift: new Float64Array(bands).fill(NaN),
        response,
        curves: null
    };
    for (let band = 0; band < bands; band++) {
        const flags = bandFlags[band];
        if (flags & TONAL_BALANCE_EQ_HAS_TARGET) {
            view.target[band] = mu[band] - density[band] - reference;
            view.targetLow[band] = view.target[band] - sigma[band];
            view.targetHigh[band] = view.target[band] + sigma[band];
        }
        if (!(flags & TONAL_BALANCE_EQ_HAS_LEVEL)) continue;
        view.presence[band] = presence[band];
        if (!aligned) continue;
        view.measured[band] = levelDb[band] + offset - density[band] - reference;
        if ((flags & used) !== used) continue;
        let deficit = mu[band] - levelDb[band] - offset;
        deficit = deficit > range ? range : deficit < -range ? -range : deficit;
        view.lift[band] = amount * (1 - presence[band]) * (deficit > 0 ? deficit : 0);
    }
    // The withheld fill spans from the drawn (linear) EQ response to that plus the lift; its top
    // edge is drawn only where the lift is above zero, not along the response.
    const lift = interpolateBands(view.lift);
    const samples = lift.length;
    const withheldLow = new Float64Array(samples).fill(NaN);
    const withheldHigh = new Float64Array(samples).fill(NaN);
    const withheldEdge = new Float64Array(samples).fill(NaN);
    for (let sample = 0; sample < samples; sample++) {
        if (!Number.isFinite(lift[sample])) continue;
        const position = (TONAL_BALANCE_EQ_CURVE_LOG_FREQS[sample] - TONAL_BALANCE_EQ_GRID_LOG_MIN) /
            TONAL_BALANCE_EQ_GRID_LOG_SPAN * (TONAL_BALANCE_EQ_GRID - 1);
        const index = Math.floor(position);
        withheldLow[sample] = response[index] + (position - index) * (response[index + 1] - response[index]);
        withheldHigh[sample] = withheldLow[sample] + lift[sample];
        if (lift[sample] > 0) withheldEdge[sample] = withheldHigh[sample];
    }
    view.curves = {
        target: interpolateBands(view.target),
        targetLow: interpolateBands(view.targetLow),
        targetHigh: interpolateBands(view.targetHigh),
        measured: interpolateBands(view.measured),
        withheldLow,
        withheldHigh,
        withheldEdge
    };
    return view;
}

class TonalBalanceEQPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({ requiresWasm: true });
    static parseTelemetryFrame = parseTonalBalanceEqFrame;

    constructor() {
        super('Tonal Balance EQ', 'Gradually steers the tonal balance toward a learned target curve');
        Object.assign(this, TONAL_BALANCE_EQ_DEFAULTS);
        // The kernel's statistics describe the audio heard before a stop; a resume starts afresh.
        this.temporalCapability = 'reset-on-resume';

        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundTelemetry = frame => this.handleTelemetry(frame);

        this.reading = null;
        this.dbTop = TONAL_BALANCE_EQ_DEFAULT_DB_RANGE;
        this.dbBottom = -TONAL_BALANCE_EQ_DEFAULT_DB_RANGE;
        this.canvas = null;
        this.canvasCtx = null;
        this.graphCssWidth = 0;
        this.resizeGraphDisposer = null;
        this.parameterRows = {};
        this.copyPeqButton = null;
        this._peqRuntime = null;
        this._graphReadout = null;
        this._readoutFrame = null;
        this._adjustEditor = null;

        this.registerProcessor('return data;');
    }

    reset() {
        this.setParameters({ ...TONAL_BALANCE_EQ_DEFAULTS });
    }

    getParameters() {
        this.ensureDspTelemetrySubscription();
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            ...Object.fromEntries(Object.keys(TONAL_BALANCE_EQ_DEFAULTS).map(key => [key, this[key]]))
        };
    }

    setParameters(params = {}) {
        if (params.enabled !== undefined) this.enabled = params.enabled !== false;
        const target = this.isAllowedEnum(params.tg, TONAL_BALANCE_EQ_TARGETS, this.tg);
        if (target !== this.tg) {
            this.tg = target;
            this.clearReading();
        }
        for (const [key, [min, max]] of Object.entries(TONAL_BALANCE_EQ_RANGES)) {
            if (params[key] !== undefined) this[key] = this.parseFiniteNumber(params[key], min, max, this[key]);
        }
        for (let band = 0; band < TONAL_BALANCE_EQ_ADJUST_FREQUENCIES.length; band++) {
            if (params['ea' + band] !== undefined) this['ea' + band] = Boolean(params['ea' + band]);
            const type = this['ta' + band] =
                this.isAllowedEnum(params['ta' + band], TONAL_BALANCE_EQ_ADJUST_TYPES, this['ta' + band]);
            // Shelves cap Q at 2, as the editor and the kernel do; a type change re-clamps it.
            this['qa' + band] = this.parseFiniteNumber(
                params['qa' + band] ?? this['qa' + band], 0.1, type === 'pk' ? 10 : 2, this['qa' + band]);
        }
        this.syncControlStates();
        this.drawGraph();
        this.updateParameters();
    }

    _adjustBands() {
        return TONAL_BALANCE_EQ_ADJUST_FREQUENCIES.map((_, band) => ({
            enabled: this['ea' + band],
            type: this['ta' + band],
            frequency: this['fa' + band],
            gain: this['ga' + band],
            q: this['qa' + band]
        }));
    }

    _engineSampleRate() {
        const value = this.reading?.sampleRate || window.workletNode?.context?.sampleRate ||
            window.audioContext?.sampleRate;
        return value > 0 ? value : 48000;
    }

    clearReading() {
        this.reading = null;
        this.dbTop = TONAL_BALANCE_EQ_DEFAULT_DB_RANGE;
        this.dbBottom = -TONAL_BALANCE_EQ_DEFAULT_DB_RANGE;
    }

    // Sends the worklet-side reset over the same port that carries parameter updates.
    resetMeasurement() {
        if (this.audioHostActive !== false) {
            window.workletNode?.port?.postMessage({ type: 'resetPluginState', pluginId: this.id });
        }
        this.clearReading();
        this.syncControlStates();
        this.drawGraph();
    }

    // The measurement feature's PEQ fitter and clipboard payload, loaded on first use.
    _loadPeqRuntime() {
        this._peqRuntime ??= Promise.all([
            import('../../features/measurement/peq-calculator/peq-calculator.js'),
            import('../../features/measurement/ui/peq-clipboard.js'),
            import('../../js/utils/clipboard-utils.js')
        ]).then(([calculator, clipboard, utils]) => ({ ...calculator, ...clipboard, ...utils }));
        return this._peqRuntime;
    }

    // Fits the graphed EQ response over Low-High with a 5Band PEQ and copies it in the pipeline's
    // paste format. The fitter designs the correction of a measured response, so it gets the
    // inverted curve; peaking bands cannot hold a flat offset, so the PEQ follows the curve's
    // shape around its average level over Low-High.
    async copyAsPeq() {
        const response = this.reading?.response;
        if (!response) return;
        try {
            const { PEQCalculator, copyPEQClipboardPayload, copyTextToClipboard } = await this._loadPeqRuntime();
            const inverse = Array.from(response, (db, index) => [10 ** TONAL_BALANCE_EQ_GRID_LOG_FREQS[index], -db]);
            const bands = new PEQCalculator().calculatePEQParameters(inverse, this.lo, this.hi, 5);
            if (bands.length === 0) throw new Error('The PEQ fit returned no bands');
            await copyPEQClipboardPayload({ peqParameters: bands }, 5, copyTextToClipboard);
            window.uiManager?.showTransientMessage('success.settingsCopied', false, {}, 3000);
        } catch (error) {
            console.error('Tonal Balance EQ: Copy as PEQ failed', error);
            window.uiManager?.setError('error.failedToCopySettings', true);
        }
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
            const unsubscribe = hub.subscribe(tapId, TONAL_BALANCE_EQ_FRAME_TYPE, this._boundTelemetry);
            if (typeof unsubscribe !== 'function') {
                hub.unsubscribe?.(tapId, TONAL_BALANCE_EQ_FRAME_TYPE, this._boundTelemetry);
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
        const reading = parseTonalBalanceEqFrame(frame);
        // Frames still describing the previous Target are dropped until the kernel follows.
        if (!reading || reading.targetIndex !== TONAL_BALANCE_EQ_TARGETS.indexOf(this.tg)) return;
        if (reading.sampleRate !== this.reading?.sampleRate) {
            this._adjustEditor?.syncFrom(this._adjustBands(), reading.sampleRate);
        }
        const first = !this.reading;
        this.reading = reading;
        if (first) this.syncControlStates();
        this.drawGraph();
    }

    // Range, Smoothing, Low and High only shape the correction, which Amount 0 turns off.
    // Copy as PEQ needs a measured EQ curve as well. Slope and Corner shape only the Tilt target.
    syncControlStates() {
        for (const key of ['ts', 'tc']) {
            if (this.parameterRows[key]) this.parameterRows[key].style.display = this.tg === 'Tilt' ? '' : 'none';
        }
        const disabled = this.am === 0;
        for (const key of ['rg', 'sm', 'lo', 'hi']) {
            const row = this.parameterRows[key];
            if (!row) continue;
            row.classList.toggle('parameter-disabled', disabled);
            row.querySelectorAll('input').forEach(input => { input.disabled = disabled; });
        }
        if (this.copyPeqButton) this.copyPeqButton.disabled = disabled || !this.reading;
    }

    // Averaging Time is a log slider whose top position is the infinite time constant, shown as "∞".
    createAveragingTimeControl() {
        const row = document.createElement('div');
        row.className = 'parameter-row';
        const sliderId = `${this.id}-${this.name}-averaging-time-slider`;
        const valueId = `${this.id}-${this.name}-averaging-time-value`;

        const labelEl = document.createElement('label');
        labelEl.textContent = 'Averaging Time (s):';
        labelEl.htmlFor = sliderId;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = sliderId;
        slider.name = sliderId;
        slider.min = 0;
        slider.max = 100;
        slider.step = 0.1;
        slider.value = averagingTimeToSliderPosition(this.at);
        slider.autocomplete = 'off';

        const valueEl = document.createElement('input');
        valueEl.type = 'text';
        valueEl.id = valueId;
        valueEl.name = valueId;
        valueEl.className = 'tonal-balance-eq-averaging-time-value';
        valueEl.value = formatAveragingTime(this.at);
        valueEl.autocomplete = 'off';
        valueEl.inputMode = 'decimal';
        valueEl.title = 'Seconds; the right end of the slider (∞) averages everything since the last reset';

        slider.addEventListener('input', event => {
            this.setParameters({ at: sliderPositionToAveragingTime(parseFloat(event.target.value)) });
            valueEl.value = formatAveragingTime(this.at);
        });
        // The change event fires on Enter and on blur.
        valueEl.addEventListener('change', () => {
            const text = valueEl.value.trim();
            const infinite = text === '∞' || /^inf/i.test(text);
            this.setParameters({ at: infinite ? TONAL_BALANCE_EQ_AVERAGING_TIME_INFINITE : text });
            valueEl.value = formatAveragingTime(this.at);
            slider.value = averagingTimeToSliderPosition(this.at);
            window.uiManager?.refreshRangeFillStyling?.(slider);
        });

        this.registerUIRefresh(() => {
            if (!this.isHeldByUser(slider)) {
                slider.value = averagingTimeToSliderPosition(this.at);
                window.uiManager?.refreshRangeFillStyling?.(slider);
            }
            if (!this.isHeldByUser(valueEl)) valueEl.value = formatAveragingTime(this.at);
        });

        row.appendChild(labelEl);
        row.appendChild(slider);
        row.appendChild(valueEl);
        return row;
    }

    createUI() {
        this.ensureDspTelemetrySubscription();
        this.resizeGraphDisposer?.();
        this.resizeGraphDisposer = null;
        this._graphReadout?.dispose?.();
        this._graphReadout = null;
        this._adjustEditor?.dispose();
        this._adjustEditor = null;
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui tonal-balance-eq-plugin-ui';
        const rows = this.parameterRows = {};
        const setter = key => value => this.setParameters({ [key]: value });

        // Two columns on desktop, one on mobile (css/effetune.css and css/effetune-mobile.css).
        const parameters = document.createElement('div');
        parameters.className = 'analyzer-parameters';
        parameters.appendChild(this.createSelectControl(
            'Target', TONAL_BALANCE_EQ_TARGETS, this.tg, setter('tg'), 'tg'));
        rows.ts = this.createParameterControl('Slope', ...TONAL_BALANCE_EQ_RANGES.ts, 0.1, this.ts, setter('ts'), 'dB/oct', 'ts');
        rows.tc = this.createParameterControl('Corner', ...TONAL_BALANCE_EQ_RANGES.tc, 1, this.tc, setter('tc'), 'Hz', 'tc', null, true);
        parameters.append(rows.ts, rows.tc);
        parameters.appendChild(this.createParameterControl(
            'Amount', 0, 100, 1, this.am, setter('am'), '%', 'am'));
        rows.rg = this.createParameterControl('Range', 0, 12, 0.5, this.rg, setter('rg'), 'dB', 'rg');
        rows.sm = this.createParameterControl(
            'Smoothing', 0.1667, 2, 0.01, this.sm, setter('sm'), 'oct', 'sm', null, true);
        rows.lo = this.createParameterControl('Low', 20, 200, 1, this.lo, setter('lo'), 'Hz', 'lo', null, true);
        rows.hi = this.createParameterControl('High', 2000, 20000, 1, this.hi, setter('hi'), 'Hz', 'hi', null, true);
        parameters.append(rows.rg, rows.sm, this.createAveragingTimeControl(), rows.lo, rows.hi);
        parameters.appendChild(this.createParameterControl(
            'Average SPL', 60, 96, 0.1, this.sp, setter('sp'), 'dB', 'sp'));
        container.appendChild(parameters);

        const graph = this.createResponsiveGraph({
            maxWidth: 1024,
            aspectRatio: '2.5 / 1',
            mobileAspectRatio: '4 / 3',
            className: 'tonal-balance-eq-graph',
            onResize: ({ canvas, cssWidth }) => {
                this.canvas = canvas;
                this.graphCssWidth = cssWidth;
                this.canvasCtx = canvas.getContext('2d', { alpha: false });
                this.drawGraph();
            }
        });
        this.canvas = graph.canvas;
        this.canvasCtx = this.canvas.getContext('2d', { alpha: false });
        this.resizeGraphDisposer = graph.dispose;
        this.canvas.setAttribute('aria-label', 'Target curve, measured spectrum, and EQ response');
        container.appendChild(graph.container);
        this._graphReadout = window.GraphReadout?.attach({
            mount: graph.container,
            surface: this.canvas,
            read: x => this._readGraph(x),
            legend: this._graphSeries()
        }) ?? null;

        // Target adjust handles on the graph (the editor's plot maps the canvas axes, in percent)
        // and their band controls under it.
        const span = () => this.dbTop - this.dbBottom;
        this._adjustEditor = window.RoomEqPlugin.createAdditionalEqEditor({
            host: this,
            id: this.id,
            sampleRate: this._engineSampleRate(),
            bands: this._adjustBands(),
            onChange: bands => this.setParameters(Object.fromEntries(bands.flatMap((band, index) => [
                ['ea' + index, band.enabled], ['ta' + index, band.type], ['fa' + index, band.frequency],
                ['ga' + index, band.gain], ['qa' + index, band.q]
            ]))),
            plot: {
                element: graph.container,
                freqToX: frequency => (Math.log10(frequency) - TONAL_BALANCE_EQ_LOG_MIN) / TONAL_BALANCE_EQ_LOG_SPAN * 100,
                xToFreq: x => 10 ** (TONAL_BALANCE_EQ_LOG_MIN + x / 100 * TONAL_BALANCE_EQ_LOG_SPAN),
                gainToY: gain => (this.dbTop - gain) / span() * 100,
                yToGain: y => this.dbTop - y / 100 * span()
            }
        });
        container.appendChild(this._adjustEditor.createUI());
        // The dB range is not refitted during a drag; refit once the pointer is released.
        for (const type of ['pointerup', 'pointercancel']) {
            graph.container.addEventListener(type, () => this.drawGraph());
        }

        const resetButton = document.createElement('button');
        resetButton.className = 'analog-meter-reset-button';
        resetButton.textContent = 'Reset';
        resetButton.title = 'Restart the measurement from the current audio';
        resetButton.addEventListener('click', () => this.resetMeasurement());

        const copyPeqButton = this.copyPeqButton = document.createElement('button');
        copyPeqButton.className = 'analog-meter-reset-button tonal-balance-eq-copy-peq-button';
        copyPeqButton.textContent = 'Copy as PEQ';
        copyPeqButton.title = 'Copy the EQ curve as 5Band PEQ settings to paste into the Effect Pipeline ' +
            '(available once the graph shows an EQ curve)';
        copyPeqButton.addEventListener('click', () => this.copyAsPeq());
        const buttons = document.createElement('div');
        buttons.className = 'tonal-balance-eq-buttons';
        buttons.append(resetButton, copyPeqButton);
        container.appendChild(buttons);

        this.registerUIRefresh(() => {
            this.syncControlStates();
            this._adjustEditor?.syncFrom(this._adjustBands(), this._engineSampleRate());
        });
        this.syncControlStates();
        this.drawGraph();
        return container;
    }

    // Plotted series, the presence behind the withheld lift and the two program values, in legend order.
    // The line swatch of Withheld lift shows the edge colour of its faint fill.
    _graphSeries() {
        return [
            { label: 'Target', color: 'var(--et-graph-overlay-compare)' },
            { label: 'Target adjust', color: 'var(--et-graph-trace-secondary)' },
            { label: 'Measured', color: 'var(--et-graph-overlay-after)' },
            { label: 'EQ response', color: 'var(--et-graph-trace)' },
            { label: 'Withheld lift', color: 'var(--et-graph-handle)' },
            { label: 'Presence', color: 'transparent' },
            { label: 'Make-up gain', color: 'transparent' },
            { label: 'Loudness', color: 'transparent' }
        ];
    }

    // Reads the drawn curves at canvas pixel x, interpolating between the plotted points.
    _readGraph(x) {
        const frame = this._readoutFrame;
        if (!frame?.valid) return null;
        const { format, seriesValueAt } = window.GraphReadout;
        const logFrequency = TONAL_BALANCE_EQ_LOG_MIN + x / frame.width * TONAL_BALANCE_EQ_LOG_SPAN;
        const cursor = format.frequency(10 ** logFrequency);
        const [target, adjust, measured, response, withheld, presence, makeup, loudness] = this._graphSeries();
        const curve = (series, xs, values) => {
            const value = seriesValueAt(xs, values, logFrequency) ?? NaN;
            return { ...series, value: format.db(value, { signed: true }), y: frame.toY(value) };
        };
        const adjustRow = curve(adjust, TONAL_BALANCE_EQ_ADJUST_LOG_FREQS, frame.adjust);
        const view = frame.view;
        if (!view) return { cursor, rows: [adjustRow] };
        const sampled = values => seriesValueAt(TONAL_BALANCE_EQ_CURVE_LOG_FREQS, values, logFrequency) ?? NaN;
        const band = values => seriesValueAt(TONAL_BALANCE_EQ_BAND_LOG_FREQS, values, logFrequency) ?? NaN;
        const reading = this.reading;
        const { curves } = view;
        const withheldLift = sampled(curves.withheldHigh) - sampled(curves.withheldLow);
        return {
            cursor,
            rows: [
                curve(target, TONAL_BALANCE_EQ_CURVE_LOG_FREQS, curves.target),
                adjustRow,
                curve(measured, TONAL_BALANCE_EQ_CURVE_LOG_FREQS, curves.measured),
                curve(response, TONAL_BALANCE_EQ_GRID_LOG_FREQS, view.response),
                // Approximate: marked with a leading '≈'.
                { ...withheld, value: Number.isFinite(withheldLift) ? `≈${format.db(withheldLift)}` : format.db(NaN) },
                { ...presence, value: format.percent(band(view.presence)) },
                { ...makeup, value: format.db(reading.makeup, { signed: true }) },
                {
                    ...loudness,
                    value: reading.stateFlags & TONAL_BALANCE_EQ_LOUDNESS_VALID
                        ? `${format.number(reading.loudness, 1)} LKFS` : format.number(NaN)
                }
            ]
        };
    }

    // The requested Target adjust (dB) at the adjust-curve samples: the product of the enabled
    // bands' responses, from the editor's own filter response at the engine sample rate.
    _adjustCurve() {
        const editor = this._adjustEditor;
        const bands = TONAL_BALANCE_EQ_ADJUST_FREQUENCIES.map((_, band) => band).filter(band =>
            this['ea' + band] && (this['ga' + band] >= 0.01 || this['ga' + band] <= -0.01));
        return TONAL_BALANCE_EQ_ADJUST_LOG_FREQS.map(logFrequency => {
            let total = 0;
            for (const band of bands) {
                total += editor.calculateBandResponse(10 ** logFrequency, this['fa' + band], this['ga' + band],
                    this['qa' + band], this['ta' + band]);
            }
            return total;
        });
    }

    // Grows the dB range (6 dB steps) to hold the Target adjust handles and curve and, with a
    // reading, the target band, the EQ response and the measured level of the corrected bands
    // (the bands with a withheld lift). A corrected band can still lack content (absent
    // sub-bass, a lossy cutoff below High), so its level counts at most the widest Range beyond
    // its target band, where the correction clips anyway; other values, including the withheld
    // lift tops, clip at the canvas edge.
    // The range shrinks only on Reset or a Target change.
    _fitDbRange(view, adjust) {
        let top = this.dbTop;
        let bottom = this.dbBottom;
        const fit = value => {
            if (!Number.isFinite(value)) return;
            if (value + 1.5 > top) top = 6 * Math.ceil((value + 1.5) / 6);
            if (value - 1.5 < bottom) bottom = 6 * Math.floor((value - 1.5) / 6);
        };
        TONAL_BALANCE_EQ_ADJUST_FREQUENCIES.forEach((_, band) => {
            if (this['ea' + band]) fit(this['ga' + band]);
        });
        adjust.forEach(fit);
        if (view) {
            const margin = TONAL_BALANCE_EQ_RANGES.rg[1];
            for (let band = 0; band < TONAL_BALANCE_EQ_BANDS; band++) {
                fit(view.targetLow[band]);
                fit(view.targetHigh[band]);
                if (!Number.isFinite(view.lift[band])) continue;
                const floor = view.targetLow[band] - margin;
                const ceiling = view.targetHigh[band] + margin;
                const measured = view.measured[band];
                fit(measured < floor ? floor : measured > ceiling ? ceiling : measured);
            }
            view.response.forEach(fit);
        }
        this.dbTop = top;
        this.dbBottom = bottom;
    }

    drawGraph() {
        const canvas = this.canvas;
        const ctx = this.canvasCtx;
        if (!canvas || !ctx) return;
        const { width, height } = canvas;
        if (!width || !height) return;
        const dpr = this.graphCssWidth > 0 ? width / this.graphCssWidth : 1;
        const color = role => window.ThemePalette?.get(role) ?? '';
        const view = this.reading ? computeTonalBalanceEqView(this.reading, this.rg, this.am / 100) : null;
        const adjust = this._adjustEditor ? this._adjustCurve() : null;
        // A refit during a drag would move the plot under the pointer; the release redraws.
        if (adjust && !this.isGraphPointerActive()) this._fitDbRange(view, adjust);
        const top = this.dbTop;
        const span = top - this.dbBottom;
        const toX = logFrequency => (logFrequency - TONAL_BALANCE_EQ_LOG_MIN) / TONAL_BALANCE_EQ_LOG_SPAN * width;
        const toY = db => (Number.isFinite(db) ? (top - db) / span * height : NaN);
        const labelFont = `${Math.round(12 * dpr)}px Arial`;
        const titleFont = `${Math.round(13 * dpr)}px Arial`;
        const labelZone = height - 38 * dpr;

        ctx.fillStyle = color('graph-bg-deep');
        ctx.fillRect(0, 0, width, height);

        // Bands outside Low-High hold the edge correction; veil them.
        ctx.fillStyle = color('graph-base-veil');
        const lowX = toX(Math.log10(this.lo));
        const highX = toX(Math.log10(this.hi));
        ctx.fillRect(0, 0, lowX, height);
        ctx.fillRect(highX, 0, width - highX, height);

        ctx.strokeStyle = color('graph-grid');
        ctx.lineWidth = dpr > 1 ? dpr : 1;
        ctx.fillStyle = color('graph-label');
        ctx.font = labelFont;
        ctx.textAlign = 'center';
        for (const frequency of TONAL_BALANCE_EQ_FREQ_TICKS) {
            const x = toX(Math.log10(frequency));
            if (x < 0 || x > width) continue;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
            const label = frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`;
            const half = ctx.measureText(label).width / 2;
            if (x - half >= 0 && x + half <= width) ctx.fillText(label, x, height - 25 * dpr);
        }
        const step = span <= 36 ? 6 : span <= 72 ? 12 : 24;
        ctx.textAlign = 'right';
        for (let db = Math.ceil(this.dbBottom / step) * step; db <= top; db += step) {
            const y = toY(db);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            if (y - 6 * dpr >= 0 && y + 6 * dpr <= labelZone) ctx.fillText(`${db}`, 40 * dpr, y + 4 * dpr);
        }

        const strokeCurve = (logFrequencies, values) => {
            ctx.beginPath();
            let drawing = false;
            for (let index = 0; index < values.length; index++) {
                if (!Number.isFinite(values[index])) {
                    drawing = false;
                    continue;
                }
                const x = toX(logFrequencies[index]);
                const y = toY(values[index]);
                if (drawing) ctx.lineTo(x, y);
                else ctx.moveTo(x, y);
                drawing = true;
            }
            ctx.stroke();
        };
        if (view) {
            const { curves } = view;
            const xs = TONAL_BALANCE_EQ_CURVE_LOG_FREQS;
            const fillRuns = (low, high) => {
                for (let start = 0; start < xs.length;) {
                    if (!Number.isFinite(low[start])) {
                        start++;
                        continue;
                    }
                    let end = start;
                    while (end + 1 < xs.length && Number.isFinite(low[end + 1])) end++;
                    ctx.beginPath();
                    for (let index = start; index <= end; index++) ctx.lineTo(toX(xs[index]), toY(high[index]));
                    for (let index = end; index >= start; index--) ctx.lineTo(toX(xs[index]), toY(low[index]));
                    ctx.closePath();
                    ctx.fill();
                    start = end + 1;
                }
            };

            ctx.fillStyle = color('graph-grid-soft');
            fillRuns(curves.targetLow, curves.targetHigh);
            // The withheld fill is faint on dark themes; a 1 px edge marks its top.
            ctx.fillStyle = color('graph-trace-soft');
            fillRuns(curves.withheldLow, curves.withheldHigh);
            ctx.lineWidth = dpr > 1 ? dpr : 1;
            ctx.strokeStyle = color('graph-handle');
            strokeCurve(xs, curves.withheldEdge);

            ctx.lineWidth = 1.5 * dpr;
            ctx.strokeStyle = color('graph-overlay-compare');
            strokeCurve(xs, curves.target);
            ctx.strokeStyle = color('graph-overlay-after');
            ctx.fillStyle = ctx.strokeStyle;
            strokeCurve(xs, curves.measured);
            for (let band = 0; band < TONAL_BALANCE_EQ_BANDS; band++) {
                if (!Number.isFinite(view.measured[band])) continue;
                ctx.beginPath();
                ctx.arc(toX(TONAL_BALANCE_EQ_BAND_LOG_FREQS[band]), toY(view.measured[band]), 2 * dpr, 0, 2 * Math.PI);
                ctx.fill();
            }
            ctx.lineWidth = 2 * dpr;
            ctx.strokeStyle = color('graph-trace');
            strokeCurve(TONAL_BALANCE_EQ_GRID_LOG_FREQS, view.response);
        } else {
            ctx.fillStyle = color('graph-label');
            ctx.font = titleFont;
            ctx.textAlign = 'center';
            // Above the 0 dB line, where the default handles and the adjust curve sit.
            ctx.fillText('Play audio to start measuring', width / 2, height / 4);
        }
        if (adjust) {
            ctx.lineWidth = dpr > 1 ? dpr : 1;
            ctx.strokeStyle = color('graph-trace-secondary');
            strokeCurve(TONAL_BALANCE_EQ_ADJUST_LOG_FREQS, adjust);
        }

        ctx.fillStyle = color('graph-axis-title');
        ctx.font = titleFont;
        ctx.textAlign = 'center';
        ctx.fillText('Frequency (Hz)', width / 2, height - 5 * dpr);
        ctx.save();
        ctx.translate(12 * dpr, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Level (dB)', 0, 4 * dpr);
        ctx.restore();

        this._readoutFrame = { valid: true, width, view, adjust, toY };
        this._graphReadout?.refresh();
        this._adjustEditor?.updateMarkers();
    }

    cleanup() {
        this.disposeDspTelemetrySubscription();
        this._graphReadout?.dispose?.();
        this._graphReadout = null;
        this._adjustEditor?.dispose();
        this._adjustEditor = null;
        this.resizeGraphDisposer?.();
        this.resizeGraphDisposer = null;
        this.canvas = null;
        this.canvasCtx = null;
        this.parameterRows = {};
        this.copyPeqButton = null;
        this._readoutFrame = null;
        super.cleanup();
    }
}

window.TonalBalanceEQPlugin = TonalBalanceEQPlugin;
