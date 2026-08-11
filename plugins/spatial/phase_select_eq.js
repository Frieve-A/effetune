const PHASE_SELECT_EQ_TAP_MAP = 20;
const PHASE_SELECT_EQ_TELEMETRY_VERSION = 1;
const PHASE_SELECT_EQ_BAND_COUNT = 5;
const PHASE_SELECT_EQ_MIN_FREQUENCY = 20;
const PHASE_SELECT_EQ_MAX_FREQUENCY = 40000;
const PHASE_SELECT_EQ_MIN_CORE_HZ = 1;
const PHASE_SELECT_EQ_MIN_CORE_DEGREES = 1;
const PHASE_SELECT_EQ_MIN_CORE_CSS_PIXELS = 12;
const PHASE_SELECT_EQ_ZERO_TRANSITION_HANDLE_OFFSET = 10;
const PHASE_SELECT_EQ_FALLBACK_SAMPLE_RATE = 48000;
const PHASE_SELECT_EQ_FALLBACK_FFT_SIZE = 4096;
const PHASE_SELECT_EQ_HISTORY_MS = 500;
const PHASE_SELECT_EQ_PASS_THROUGH_PROCESSOR = 'return data;';
const PHASE_SELECT_EQ_ACTIVE_COLOR = '#00ff00';
const PHASE_SELECT_EQ_INACTIVE_COLOR = 'rgba(120, 220, 120, 0.8)';

const PHASE_SELECT_EQ_DEFAULT_REGION = Object.freeze({
    en: false,
    ofl: 80,
    fl: 100,
    fh: 10000,
    ofh: 12000,
    opl: 0,
    pl: 0,
    ph: 30,
    oph: 45,
    gn: 100
});

function phaseSelectEqClamp(value, minimum, maximum) {
    return value < minimum ? minimum : (value > maximum ? maximum : value);
}

function phaseSelectEqFinite(value, fallback) {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function phaseSelectEqCoreConstraints({
    plotWidth,
    plotHeight,
    maximumFrequency,
    sampleRate,
    fftSize
} = {}) {
    const width = Math.max(1, phaseSelectEqFinite(plotWidth, 652));
    const height = Math.max(1, phaseSelectEqFinite(plotHeight, 347));
    const displayMaximum = phaseSelectEqClamp(
        phaseSelectEqFinite(maximumFrequency, PHASE_SELECT_EQ_MAX_FREQUENCY),
        PHASE_SELECT_EQ_MIN_FREQUENCY + 1, PHASE_SELECT_EQ_MAX_FREQUENCY);
    const validSampleRate = Number.isFinite(sampleRate) && sampleRate > 0
        ? sampleRate : PHASE_SELECT_EQ_FALLBACK_SAMPLE_RATE;
    const validFftSize = Number.isInteger(fftSize) && fftSize >= 2
        ? fftSize : PHASE_SELECT_EQ_FALLBACK_FFT_SIZE;
    const logFrequencyRange = Math.log2(displayMaximum / PHASE_SELECT_EQ_MIN_FREQUENCY);
    return {
        minimumPhaseDegrees: Math.max(PHASE_SELECT_EQ_MIN_CORE_DEGREES,
            PHASE_SELECT_EQ_MIN_CORE_CSS_PIXELS / width * 360),
        minimumFrequencyHz: Math.max(PHASE_SELECT_EQ_MIN_CORE_HZ,
            validSampleRate / validFftSize),
        minimumFrequencyRatio: 2 **
            (PHASE_SELECT_EQ_MIN_CORE_CSS_PIXELS / height * logFrequencyRange)
    };
}

function phaseSelectEqNormalizeRegion(
    source = {}, fallback = PHASE_SELECT_EQ_DEFAULT_REGION, constraints = {}
) {
    const input = source && typeof source === 'object' ? source : {};
    const base = fallback && typeof fallback === 'object' ? fallback : PHASE_SELECT_EQ_DEFAULT_REGION;
    const region = {
        en: input.en === undefined ? base.en === true : input.en === true,
        ofl: phaseSelectEqClamp(phaseSelectEqFinite(input.ofl, base.ofl),
            PHASE_SELECT_EQ_MIN_FREQUENCY, PHASE_SELECT_EQ_MAX_FREQUENCY),
        fl: phaseSelectEqClamp(phaseSelectEqFinite(input.fl, base.fl),
            PHASE_SELECT_EQ_MIN_FREQUENCY, PHASE_SELECT_EQ_MAX_FREQUENCY),
        fh: phaseSelectEqClamp(phaseSelectEqFinite(input.fh, base.fh),
            PHASE_SELECT_EQ_MIN_FREQUENCY, PHASE_SELECT_EQ_MAX_FREQUENCY),
        ofh: phaseSelectEqClamp(phaseSelectEqFinite(input.ofh, base.ofh),
            PHASE_SELECT_EQ_MIN_FREQUENCY, PHASE_SELECT_EQ_MAX_FREQUENCY),
        opl: phaseSelectEqClamp(phaseSelectEqFinite(input.opl, base.opl), 0, 180),
        pl: phaseSelectEqClamp(phaseSelectEqFinite(input.pl, base.pl), 0, 180),
        ph: phaseSelectEqClamp(phaseSelectEqFinite(input.ph, base.ph), 0, 180),
        oph: phaseSelectEqClamp(phaseSelectEqFinite(input.oph, base.oph), 0, 180),
        gn: phaseSelectEqClamp(phaseSelectEqFinite(input.gn, base.gn), 0, 200)
    };

    const minimumFrequencyHz = phaseSelectEqClamp(
        phaseSelectEqFinite(constraints.minimumFrequencyHz, PHASE_SELECT_EQ_MIN_CORE_HZ),
        PHASE_SELECT_EQ_MIN_CORE_HZ,
        PHASE_SELECT_EQ_MAX_FREQUENCY - PHASE_SELECT_EQ_MIN_FREQUENCY);
    const minimumFrequencyRatio = phaseSelectEqClamp(
        phaseSelectEqFinite(constraints.minimumFrequencyRatio, 1),
        1, PHASE_SELECT_EQ_MAX_FREQUENCY / PHASE_SELECT_EQ_MIN_FREQUENCY);
    const maximumCoreLow = Math.min(
        PHASE_SELECT_EQ_MAX_FREQUENCY - minimumFrequencyHz,
        PHASE_SELECT_EQ_MAX_FREQUENCY / minimumFrequencyRatio);
    region.fl = phaseSelectEqClamp(region.fl, PHASE_SELECT_EQ_MIN_FREQUENCY, maximumCoreLow);
    region.fh = phaseSelectEqClamp(region.fh,
        Math.max(region.fl + minimumFrequencyHz, region.fl * minimumFrequencyRatio),
        PHASE_SELECT_EQ_MAX_FREQUENCY);
    region.ofl = phaseSelectEqClamp(region.ofl, PHASE_SELECT_EQ_MIN_FREQUENCY, region.fl);
    region.ofh = phaseSelectEqClamp(region.ofh, region.fh, PHASE_SELECT_EQ_MAX_FREQUENCY);

    const minimumPhaseDegrees = phaseSelectEqClamp(
        phaseSelectEqFinite(constraints.minimumPhaseDegrees, PHASE_SELECT_EQ_MIN_CORE_DEGREES),
        PHASE_SELECT_EQ_MIN_CORE_DEGREES, 180);
    region.pl = phaseSelectEqClamp(region.pl, 0, 180 - minimumPhaseDegrees);
    region.ph = phaseSelectEqClamp(region.ph,
        region.pl + minimumPhaseDegrees, 180);
    region.opl = phaseSelectEqClamp(region.opl, 0, region.pl);
    region.oph = phaseSelectEqClamp(region.oph, region.ph, 180);
    return region;
}

function phaseSelectEqDisplaySegments(low, high) {
    const normalizedLow = phaseSelectEqClamp(phaseSelectEqFinite(low, 0), 0, 180);
    const normalizedHigh = phaseSelectEqClamp(
        phaseSelectEqFinite(high, normalizedLow), normalizedLow, 180);
    if (normalizedLow === 0) {
        return [{ low: -normalizedHigh, high: normalizedHigh, joinedAtCenter: true, wrapped: false }];
    }
    const wrapped = normalizedHigh === 180;
    return [
        { low: -normalizedHigh, high: -normalizedLow, joinedAtCenter: false, wrapped },
        { low: normalizedLow, high: normalizedHigh, joinedAtCenter: false, wrapped }
    ];
}

function phaseSelectEqSmooth01(value) {
    const clamped = phaseSelectEqClamp(value, 0, 1);
    return 0.5 - 0.5 * Math.cos(Math.PI * clamped);
}

function phaseSelectEqAxisWeight(value, outerLow, coreLow, coreHigh, outerHigh) {
    if (value < outerLow || value > outerHigh) return 0;
    if (value >= coreLow && value <= coreHigh) return 1;
    if (value < coreLow) {
        if (coreLow === outerLow) return 1;
        return phaseSelectEqSmooth01((value - outerLow) / (coreLow - outerLow));
    }
    if (outerHigh === coreHigh) return 1;
    return phaseSelectEqSmooth01((outerHigh - value) / (outerHigh - coreHigh));
}

function phaseSelectEqRegionWeight(region, frequency, absolutePhase) {
    if (!region?.en || frequency <= 0) return 0;
    const logFrequency = Math.log2(frequency);
    const frequencyWeight = phaseSelectEqAxisWeight(
        logFrequency, Math.log2(region.ofl), Math.log2(region.fl),
        Math.log2(region.fh), Math.log2(region.ofh));
    if (frequencyWeight === 0) return 0;
    return frequencyWeight * phaseSelectEqAxisWeight(
        absolutePhase, region.opl, region.pl, region.ph, region.oph);
}

function phaseSelectEqCompositeGain(regions, frequency, signedPhase) {
    const absolutePhase = Math.abs(signedPhase);
    let result = 1;
    for (const region of regions) {
        if (region?.en && region.gn !== 100) {
            const weight = phaseSelectEqRegionWeight(region, frequency, absolutePhase);
            result *= 1 + (region.gn / 100 - 1) * weight;
        }
    }
    return result;
}

class PhaseSelectEqPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({ requiresWasm: true });
    static normalizeRegion = phaseSelectEqNormalizeRegion;
    static displaySegments = phaseSelectEqDisplaySegments;
    static regionWeight = phaseSelectEqRegionWeight;
    static compositeGain = phaseSelectEqCompositeGain;

    constructor() {
        super('Phase Select EQ',
            'Boosts or cuts frequency components selected by L/R phase difference');
        this.temporalCapability = 'reset-on-resume';
        this.regions = Array.from({ length: PHASE_SELECT_EQ_BAND_COUNT }, (_, index) => ({
            ...PHASE_SELECT_EQ_DEFAULT_REGION,
            en: index === 0
        }));
        this.selectedRegionIndex = 0;
        this.sampleRate = PHASE_SELECT_EQ_FALLBACK_SAMPLE_RATE;
        this.fftSize = PHASE_SELECT_EQ_FALLBACK_FFT_SIZE;
        this.phaseMapFrames = [];
        this.lastTelemetrySequence = null;
        this.isVisible = false;
        this.animationFrameId = null;
        this.canvas = null;
        this._graphCssWidth = 720;
        this._graphCssHeight = 405;
        this._graphDpr = 1;
        this._graphDisposer = null;
        this._intersectionObserver = null;
        this._pointerState = null;
        this._pendingPointerMove = null;
        this._pointerMoveFrame = null;
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundTelemetry = frame => this.handleDspTelemetry(frame);
        this._boundKeyDown = event => this._handleKeyDown(event);
        this._formInputs = new Map();
        this._regionTabs = [];
        this._bandEnableInputs = [];
        this._editor = null;
        this.registerProcessor(PHASE_SELECT_EQ_PASS_THROUGH_PROCESSOR);
    }

    getTemporalCapability() {
        return 'reset-on-resume';
    }

    getParameters() {
        this.ensureDspTelemetrySubscription();
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            regions: this.regions.map(region => ({ ...region }))
        };
    }

    setParameters(params = {}) {
        if (!params || typeof params !== 'object') return;
        if (params.enabled !== undefined) this.enabled = params.enabled !== false;
        if (Array.isArray(params.regions)) {
            this.regions = Array.from({ length: PHASE_SELECT_EQ_BAND_COUNT }, (_, index) =>
                phaseSelectEqNormalizeRegion(params.regions[index],
                    this.regions[index] || {
                        ...PHASE_SELECT_EQ_DEFAULT_REGION,
                        en: index === 0
                    }));
        }
        this.updateParameters();
        this._refreshUi();
        this.drawGraph();
    }

    _commitRegion(index, source, update = true) {
        if (index < 0 || index >= PHASE_SELECT_EQ_BAND_COUNT) return false;
        this.regions[index] = phaseSelectEqNormalizeRegion(
            source, this.regions[index], this._coreNormalizationConstraints());
        if (update) this.updateParameters();
        this._refreshUi();
        this.drawGraph();
        return true;
    }

    selectRegion(index) {
        if (!this.regions[index]) return false;
        this.selectedRegionIndex = index;
        this._refreshUi();
        this.drawGraph();
        return true;
    }

    _setupMessageHandler() {
        super._setupMessageHandler();
        this.ensureDspTelemetrySubscription();
    }

    ensureDspTelemetrySubscription() {
        const hub = typeof window !== 'undefined' ? window.dspTelemetryHub : null;
        const tapId = this.id;
        const validTapId = Number.isInteger(tapId) && tapId >= 0 && tapId <= 0xffffffff;
        if (!validTapId || !hub || typeof hub.subscribe !== 'function') return false;
        if (this._dspTelemetryUnsubscribe && hub === this._dspTelemetryHub &&
            tapId === this._dspTelemetryTapId) return true;
        this.disposeDspTelemetrySubscription();
        try {
            const unsubscribe = hub.subscribe(tapId, PHASE_SELECT_EQ_TAP_MAP, this._boundTelemetry);
            if (typeof unsubscribe !== 'function') return false;
            this._dspTelemetryHub = hub;
            this._dspTelemetryTapId = tapId;
            this._dspTelemetryUnsubscribe = unsubscribe;
            return true;
        } catch (error) {
            console.warn('[Phase Select EQ] Unable to subscribe to DSP telemetry:', error);
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

    parseDspTelemetryFrame(frame) {
        if (frame?.frameType !== PHASE_SELECT_EQ_TAP_MAP ||
            frame.formatVersion !== PHASE_SELECT_EQ_TELEMETRY_VERSION) return null;
        const payload = frame.payload;
        if (!payload || typeof payload.getFloat32 !== 'function' ||
            typeof payload.getUint16 !== 'function' || typeof payload.getUint32 !== 'function' ||
            !Number.isInteger(payload.byteLength) || payload.byteLength < 16) return null;
        const sampleRate = payload.getFloat32(0, true);
        const pointCount = payload.getUint16(4, true);
        const flags = payload.getUint16(6, true);
        const fftSize = payload.getUint32(8, true);
        const frameMaximumDb = payload.getFloat32(12, true);
        if (!Number.isFinite(sampleRate) || sampleRate <= 0 || pointCount > 512 ||
            payload.byteLength !== 16 + pointCount * 12 || fftSize < 2 ||
            (fftSize & (fftSize - 1)) !== 0 || !Number.isFinite(frameMaximumDb)) return null;
        const maximumFrequency = Math.min(PHASE_SELECT_EQ_MAX_FREQUENCY, sampleRate * 0.49);
        const points = new Array(pointCount);
        for (let index = 0; index < pointCount; index++) {
            const offset = 16 + index * 12;
            const frequency = payload.getFloat32(offset, true);
            const phase = payload.getFloat32(offset + 4, true);
            const relativeLevelDb = payload.getFloat32(offset + 8, true);
            if (!Number.isFinite(frequency) || frequency < PHASE_SELECT_EQ_MIN_FREQUENCY ||
                frequency > maximumFrequency || !Number.isFinite(phase) || phase < -180 ||
                phase > 180 || !Number.isFinite(relativeLevelDb) || relativeLevelDb > 0) return null;
            points[index] = { frequency, phase, relativeLevelDb };
        }
        return { sampleRate, pointCount, flags, fftSize, frameMaximumDb, points };
    }

    handleDspTelemetry(frame) {
        const snapshot = this.parseDspTelemetryFrame(frame);
        if (!snapshot) return;
        const sequence = frame.sequence >>> 0;
        const expected = this.lastTelemetrySequence === null
            ? null : (this.lastTelemetrySequence + 1) >>> 0;
        if (expected === null || sequence !== expected || (frame.flags & 1) !== 0) {
            this.phaseMapFrames.length = 0;
        }
        this.lastTelemetrySequence = sequence;
        this.sampleRate = snapshot.sampleRate;
        this.fftSize = snapshot.fftSize;
        if (!this.enabled || !this._sectionEnabled || !this.isVisible) return;
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.phaseMapFrames.push({ time: now, points: snapshot.points });
        this._discardOldMapFrames(now);
    }

    _discardOldMapFrames(now) {
        while (this.phaseMapFrames.length &&
            now - this.phaseMapFrames[0].time > PHASE_SELECT_EQ_HISTORY_MS) {
            this.phaseMapFrames.shift();
        }
    }

    _maximumDisplayFrequency() {
        return Math.max(PHASE_SELECT_EQ_MIN_FREQUENCY + 1,
            Math.min(PHASE_SELECT_EQ_MAX_FREQUENCY, this.sampleRate * 0.49));
    }

    _plotRect(width = this._graphCssWidth, height = this._graphCssHeight) {
        return { left: 0, top: 0, right: Math.max(1, width), bottom: Math.max(1, height) };
    }

    _coreNormalizationConstraints() {
        const canvasRect = this.canvas?.getBoundingClientRect?.();
        const width = Number.isFinite(canvasRect?.width) && canvasRect.width > 0
            ? canvasRect.width : this._graphCssWidth;
        const height = Number.isFinite(canvasRect?.height) && canvasRect.height > 0
            ? canvasRect.height : this._graphCssHeight;
        const plot = this._plotRect(width, height);
        return phaseSelectEqCoreConstraints({
            plotWidth: plot.right - plot.left,
            plotHeight: plot.bottom - plot.top,
            maximumFrequency: this._maximumDisplayFrequency(),
            sampleRate: this.sampleRate,
            fftSize: this.fftSize
        });
    }

    _phaseToX(phase) {
        const plot = this._plotRect();
        return plot.left + (phase + 180) / 360 * (plot.right - plot.left);
    }

    _xToPhase(x) {
        const plot = this._plotRect();
        return phaseSelectEqClamp((x - plot.left) / (plot.right - plot.left) * 360 - 180,
            -180, 180);
    }

    _frequencyToY(frequency) {
        const plot = this._plotRect();
        const minimum = Math.log2(PHASE_SELECT_EQ_MIN_FREQUENCY);
        const maximum = Math.log2(this._maximumDisplayFrequency());
        const normalized = (Math.log2(phaseSelectEqClamp(frequency,
            PHASE_SELECT_EQ_MIN_FREQUENCY, this._maximumDisplayFrequency())) - minimum) /
            (maximum - minimum);
        return plot.bottom - normalized * (plot.bottom - plot.top);
    }

    _yToFrequency(y) {
        const plot = this._plotRect();
        const normalized = phaseSelectEqClamp((plot.bottom - y) / (plot.bottom - plot.top), 0, 1);
        return 2 ** (Math.log2(PHASE_SELECT_EQ_MIN_FREQUENCY) + normalized *
            (Math.log2(this._maximumDisplayFrequency()) - Math.log2(PHASE_SELECT_EQ_MIN_FREQUENCY)));
    }

    _eventPoint(event) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    _regionGeometry(region) {
        const make = (low, high, frequencyLow, frequencyHigh) =>
            phaseSelectEqDisplaySegments(low, high).map(segment => ({
                ...segment,
                left: this._phaseToX(segment.low),
                right: this._phaseToX(segment.high),
                top: this._frequencyToY(frequencyHigh),
                bottom: this._frequencyToY(frequencyLow)
            }));
        return {
            outer: make(region.opl, region.oph, region.ofl, region.ofh),
            core: make(region.pl, region.ph, region.fl, region.fh)
        };
    }

    _createNumberField(parent, key, label, min, max, step, valueGetter, setter, unit,
        scale = 'linear') {
        const row = document.createElement('div');
        row.className = 'parameter-row phase-select-eq-field';
        const id = `${this.id}-phase-select-eq-${key}`;
        const labelElement = document.createElement('label');
        labelElement.htmlFor = id;
        labelElement.textContent = `${label}${unit ? ` (${unit})` : ''}`;
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = `${id}-slider`;
        slider.min = scale === 'log' ? '0' : String(min);
        slider.max = scale === 'log' ? '1000' : String(max);
        slider.step = scale === 'log' ? '1' : String(step);
        slider.autocomplete = 'off';
        const input = document.createElement('input');
        input.type = 'number';
        input.id = id;
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.autocomplete = 'off';
        const toSlider = value => scale === 'log'
            ? Math.log(value / min) / Math.log(max / min) * 1000
            : value;
        const fromSlider = value => scale === 'log'
            ? min * ((max / min) ** (value / 1000))
            : value;
        slider.addEventListener('input', () => {
            setter(fromSlider(Number(slider.value)));
            const canonicalValue = valueGetter();
            input.value = Number.isFinite(canonicalValue)
                ? String(Math.round(canonicalValue * 100) / 100) : '';
            slider.value = String(toSlider(canonicalValue));
        });
        input.addEventListener('input', () => {
            const value = Number(input.value);
            if (Number.isFinite(value)) {
                setter(value);
                slider.value = String(toSlider(valueGetter()));
            }
        });
        const commitAndReflect = () => {
            const value = Number(input.value);
            if (Number.isFinite(value)) setter(value);
            const canonicalValue = valueGetter();
            input.value = Number.isFinite(canonicalValue)
                ? String(Math.round(canonicalValue * 100) / 100)
                : '';
        };
        input.addEventListener('change', commitAndReflect);
        input.addEventListener('blur', commitAndReflect);
        row.append(labelElement, slider, input);
        parent.appendChild(row);
        this._formInputs.set(key, { input, slider, valueGetter, toSlider });
        return input;
    }

    _setSelectedRegionValue(key, value) {
        if (!this.regions[this.selectedRegionIndex]) return;
        const coreBoundary = {
            fl: ['frequency', 'low'],
            fh: ['frequency', 'high'],
            pl: ['phase', 'low'],
            ph: ['phase', 'high']
        }[key];
        if (coreBoundary) {
            this._setSelectedCoreBoundary(coreBoundary[0], coreBoundary[1], value);
            return;
        }
        const region = { ...this.regions[this.selectedRegionIndex], [key]: value };
        this._commitRegion(this.selectedRegionIndex, region);
    }

    _applyCoreBoundary(region, original, axis, direction, value) {
        const constraints = this._coreNormalizationConstraints();
        if (axis === 'frequency') {
            const minimumHz = constraints.minimumFrequencyHz;
            const minimumRatio = constraints.minimumFrequencyRatio;
            if (direction === 'low') {
                const exactMaximumLow = Math.min(
                    original.fh - minimumHz, original.fh / minimumRatio);
                const maximumLow = exactMaximumLow -
                    Math.abs(exactMaximumLow) * Number.EPSILON * 4;
                const next = phaseSelectEqClamp(
                    phaseSelectEqFinite(value, original.fl),
                    PHASE_SELECT_EQ_MIN_FREQUENCY, maximumLow);
                const transitionRatio = original.fl / original.ofl;
                region.fl = next;
                region.ofl = next / transitionRatio;
            } else {
                const minimumHigh = Math.max(
                    original.fl + minimumHz, original.fl * minimumRatio);
                const next = phaseSelectEqClamp(
                    phaseSelectEqFinite(value, original.fh),
                    minimumHigh, PHASE_SELECT_EQ_MAX_FREQUENCY);
                const transitionRatio = original.ofh / original.fh;
                region.fh = next;
                region.ofh = next * transitionRatio;
            }
            return;
        }

        const minimumDegrees = constraints.minimumPhaseDegrees;
        if (direction === 'low') {
            const exactMaximumLow = original.ph - minimumDegrees;
            const maximumLow = exactMaximumLow -
                Math.abs(exactMaximumLow) * Number.EPSILON * 4;
            const next = phaseSelectEqClamp(
                phaseSelectEqFinite(value, original.pl), 0, maximumLow);
            const transitionDegrees = original.pl - original.opl;
            region.pl = next;
            region.opl = next - transitionDegrees;
        } else {
            const next = phaseSelectEqClamp(
                phaseSelectEqFinite(value, original.ph), original.pl + minimumDegrees, 180);
            const transitionDegrees = original.oph - original.ph;
            region.ph = next;
            region.oph = next + transitionDegrees;
        }
    }

    _setSelectedCoreBoundary(axis, direction, value) {
        const original = this.regions[this.selectedRegionIndex];
        const region = { ...original };
        this._applyCoreBoundary(region, original, axis, direction, value);
        this._commitRegion(this.selectedRegionIndex, region);
    }

    _setTransitionOctaves(direction, value) {
        if (!this.regions[this.selectedRegionIndex]) return;
        const region = { ...this.regions[this.selectedRegionIndex] };
        const octaves = phaseSelectEqClamp(phaseSelectEqFinite(value, 0), 0, 10);
        if (direction === 'low') region.ofl = region.fl / (2 ** octaves);
        else region.ofh = region.fh * (2 ** octaves);
        this._commitRegion(this.selectedRegionIndex, region);
    }

    _setPhaseTransition(direction, value) {
        if (!this.regions[this.selectedRegionIndex]) return;
        const region = { ...this.regions[this.selectedRegionIndex] };
        const degrees = phaseSelectEqClamp(phaseSelectEqFinite(value, 0), 0, 180);
        if (direction === 'low') region.opl = region.pl - degrees;
        else region.oph = region.ph + degrees;
        this._commitRegion(this.selectedRegionIndex, region);
    }

    createUI() {
        this.ensureDspTelemetrySubscription();
        this.stopAnimation();
        this._intersectionObserver?.disconnect();
        this._intersectionObserver = null;
        this._unbindCanvasPointerEvents();
        this._graphDisposer?.();
        this._graphDisposer = null;
        this._formInputs.clear();
        this._regionTabs.length = 0;
        this._bandEnableInputs.length = 0;
        const container = document.createElement('div');
        container.className = 'phase-select-eq-plugin-ui plugin-parameter-ui';

        const tabs = document.createElement('div');
        tabs.className = 'phase-select-eq-region-tabs';
        tabs.setAttribute('role', 'tablist');
        for (let index = 0; index < PHASE_SELECT_EQ_BAND_COUNT; index++) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'phase-select-eq-region-tab';
            button.setAttribute('role', 'tab');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'phase-select-eq-band-checkbox';
            checkbox.setAttribute('aria-label', `Enable Band ${index + 1}`);
            checkbox.autocomplete = 'off';
            checkbox.addEventListener('click', event => event.stopPropagation());
            checkbox.addEventListener('change', event => {
                event.stopPropagation();
                this._commitRegion(index, { ...this.regions[index], en: checkbox.checked });
            });
            const text = document.createElement('span');
            text.textContent = `Band ${index + 1}`;
            button.append(checkbox, text);
            button.addEventListener('click', () => this.selectRegion(index));
            tabs.appendChild(button);
            this._regionTabs.push(button);
            this._bandEnableInputs.push(checkbox);
        }
        container.appendChild(tabs);

        this._editor = document.createElement('div');
        this._editor.className = 'phase-select-eq-editor';

        const fields = document.createElement('div');
        fields.className = 'phase-select-eq-fields';
        const selected = () => this.regions[this.selectedRegionIndex];
        this._createNumberField(fields, 'gn', 'Gain', 0, 200, 1,
            () => selected().gn, value => this._setSelectedRegionValue('gn', value), '%');
        this._createNumberField(fields, 'fl', 'Core Low Frequency', 20, 40000, 1,
            () => selected().fl, value => this._setSelectedRegionValue('fl', value), 'Hz', 'log');
        this._createNumberField(fields, 'fh', 'Core High Frequency', 20, 40000, 1,
            () => selected().fh, value => this._setSelectedRegionValue('fh', value), 'Hz', 'log');
        this._createNumberField(fields, 'pl', 'Core Low Phase', 0, 179, 1,
            () => selected().pl, value => this._setSelectedRegionValue('pl', value), '°');
        this._createNumberField(fields, 'ph', 'Core High Phase', 1, 180, 1,
            () => selected().ph, value => this._setSelectedRegionValue('ph', value), '°');
        this._createNumberField(fields, 'lowFrequencyTransition', 'Low Frequency Transition', 0, 10, 0.01,
            () => Math.log2(selected().fl / selected().ofl),
            value => this._setTransitionOctaves('low', value), 'oct');
        this._createNumberField(fields, 'highFrequencyTransition', 'High Frequency Transition', 0, 10, 0.01,
            () => Math.log2(selected().ofh / selected().fh),
            value => this._setTransitionOctaves('high', value), 'oct');
        this._createNumberField(fields, 'lowPhaseTransition', 'Low Phase Transition', 0, 180, 1,
            () => selected().pl - selected().opl,
            value => this._setPhaseTransition('low', value), '°');
        this._createNumberField(fields, 'highPhaseTransition', 'High Phase Transition', 0, 180, 1,
            () => selected().oph - selected().ph,
            value => this._setPhaseTransition('high', value), '°');
        this._editor.appendChild(fields);
        container.appendChild(this._editor);

        const graph = this.createResponsiveGraph({
            maxWidth: 720,
            aspectRatio: '16 / 9',
            mobileAspectRatio: '4 / 3',
            className: 'phase-select-eq-map',
            onResize: ({ cssWidth, cssHeight, dpr }) => {
                this._graphCssWidth = cssWidth;
                this._graphCssHeight = cssHeight;
                this._graphDpr = dpr;
                this.drawGraph();
            }
        });
        this.canvas = graph.canvas;
        this._graphDisposer = graph.dispose;
        this.canvas.setAttribute('aria-label',
            'Phase Select EQ frequency and left-right phase difference map');
        this.canvas.tabIndex = 0;
        this.canvas.style.touchAction = 'none';
        this._bindCanvasPointerEvents();
        container.appendChild(graph.container);

        if (typeof IntersectionObserver === 'function') {
            this._intersectionObserver = new IntersectionObserver(entries => {
                const visible = entries.some(entry => entry.isIntersecting);
                this.isVisible = visible;
                if (visible) this.startAnimation();
                else {
                    this.stopAnimation();
                    this.phaseMapFrames.length = 0;
                    this.lastTelemetrySequence = null;
                }
            });
            this._intersectionObserver.observe(this.canvas);
        } else {
            this.isVisible = true;
            this.startAnimation();
        }
        document.addEventListener('keydown', this._boundKeyDown);
        this._refreshUi();
        this.drawGraph();
        return container;
    }

    _refreshUi() {
        for (let index = 0; index < this._regionTabs.length; index++) {
            const tab = this._regionTabs[index];
            const selected = index === this.selectedRegionIndex;
            tab.setAttribute('aria-selected', String(selected));
            tab.classList.toggle('disabled', !this.regions[index].en);
            if (this._bandEnableInputs[index]) {
                this._bandEnableInputs[index].checked = this.regions[index].en;
            }
        }
        const selected = this.regions[this.selectedRegionIndex];
        for (const { input, slider, valueGetter, toSlider } of this._formInputs.values()) {
            if (document.activeElement !== input) {
                const value = valueGetter();
                input.value = Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '';
            }
            const value = valueGetter();
            slider.value = Number.isFinite(value) ? String(toSlider(value)) : '';
        }
    }

    _bindCanvasPointerEvents() {
        this._onPointerDown = event => this._handlePointerDown(event);
        this._onPointerMove = event => this._handlePointerMove(event);
        this._onPointerUp = event => this._finishPointer(event, false);
        this._onPointerCancel = event => this._finishPointer(event, true);
        this.canvas.addEventListener('pointerdown', this._onPointerDown);
        this.canvas.addEventListener('pointermove', this._onPointerMove);
        this.canvas.addEventListener('pointerup', this._onPointerUp);
        this.canvas.addEventListener('pointercancel', this._onPointerCancel);
    }

    _unbindCanvasPointerEvents() {
        if (!this.canvas) return;
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        this.canvas.removeEventListener('pointermove', this._onPointerMove);
        this.canvas.removeEventListener('pointerup', this._onPointerUp);
        this.canvas.removeEventListener('pointercancel', this._onPointerCancel);
    }

    _handlePointerDown(event) {
        if (this._pointerState || event.isPrimary === false) return;
        const point = this._eventPoint(event);
        const hit = this._hitTest(point.x, point.y);
        if (!hit) return;
        if (hit.index !== this.selectedRegionIndex) this.selectRegion(hit.index);
        const signedPhase = this._xToPhase(point.x);
        const originalRegion = { ...this.regions[hit.index] };
        const logicalPoint = hit.mode === 'handle'
            ? this._logicalHandlePoint(hit, originalRegion)
            : point;
        const logicalPhase = this._xToPhase(logicalPoint.x);
        this._pointerState = {
            pointerId: event.pointerId,
            hit,
            startPoint: point,
            startPhase: signedPhase,
            side: hit.split ? 0 : (logicalPhase < 0 ? -1 : (logicalPhase > 0 ? 1 : 0)),
            startFrequency: this._yToFrequency(point.y),
            originalRegion,
            grabOffset: {
                x: point.x - logicalPoint.x,
                y: point.y - logicalPoint.y
            }
        };
        this.canvas.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    }

    _handlePointerMove(event) {
        const point = this._eventPoint(event);
        if (!this._pointerState || this._pointerState.pointerId !== event.pointerId) return;
        this._pendingPointerMove = point;
        if (this._pointerMoveFrame === null) {
            const schedule = typeof requestAnimationFrame === 'function'
                ? requestAnimationFrame : callback => setTimeout(callback, 0);
            this._pointerMoveFrame = schedule(() => {
                this._pointerMoveFrame = null;
                const pending = this._pendingPointerMove;
                this._pendingPointerMove = null;
                if (pending) this._applyPointerMove(pending);
            });
        }
        event.preventDefault();
    }

    _applyPointerMove(point) {
        const state = this._pointerState;
        if (!state) return;
        const original = state.originalRegion;
        const region = { ...original };
        const grabOffset = state.grabOffset || { x: 0, y: 0 };
        const currentPhase = this._xToPhase(point.x - grabOffset.x);
        const currentFrequency = this._yToFrequency(point.y - grabOffset.y);
        const mode = state.hit.mode;

        if (mode === 'move') {
            if (state.side === 0 && Math.abs(point.x - state.startPoint.x) > 1) {
                state.side = point.x >= state.startPoint.x ? 1 : -1;
            }
            const side = state.side || 1;
            const phaseDelta = side * (currentPhase - state.startPhase);
            const phaseMinimumDelta = -original.opl;
            const phaseMaximumDelta = 180 - original.oph;
            const fittedPhaseDelta = phaseSelectEqClamp(phaseDelta, phaseMinimumDelta, phaseMaximumDelta);
            region.opl += fittedPhaseDelta;
            region.pl += fittedPhaseDelta;
            region.ph += fittedPhaseDelta;
            region.oph += fittedPhaseDelta;
            const ratio = currentFrequency / state.startFrequency;
            const fittedRatio = phaseSelectEqClamp(ratio,
                PHASE_SELECT_EQ_MIN_FREQUENCY / original.ofl,
                PHASE_SELECT_EQ_MAX_FREQUENCY / original.ofh);
            region.ofl *= fittedRatio;
            region.fl *= fittedRatio;
            region.fh *= fittedRatio;
            region.ofh *= fittedRatio;
        } else {
            if (state.hit.phaseEdge) {
                if (state.side === 0 && Math.abs(point.x - state.startPoint.x) > 1) {
                    state.side = point.x >= state.startPoint.x ? 1 : -1;
                }
                const phaseOnOriginalSide = state.side < 0
                    ? Math.min(currentPhase, 0)
                    : (state.side > 0 ? Math.max(currentPhase, 0) : 0);
                const absolutePhase = Math.abs(phaseOnOriginalSide);
                if (state.hit.outer) {
                    if (state.hit.phaseEdge === 'low') region.opl = absolutePhase;
                    else region.oph = absolutePhase;
                } else {
                    this._applyCoreBoundary(
                        region, original, 'phase', state.hit.phaseEdge, absolutePhase);
                }
            }
            if (state.hit.frequencyEdge) {
                if (state.hit.outer) {
                    if (state.hit.frequencyEdge === 'low') region.ofl = currentFrequency;
                    else region.ofh = currentFrequency;
                } else {
                    this._applyCoreBoundary(
                        region, original, 'frequency', state.hit.frequencyEdge, currentFrequency);
                }
            }
        }
        this._commitRegion(state.hit.index, region);
    }

    _finishPointer(event, cancel) {
        const state = this._pointerState;
        if (!state || state.pointerId !== event.pointerId) return;
        if (this._pendingPointerMove && !cancel) this._applyPointerMove(this._pendingPointerMove);
        this._pendingPointerMove = null;
        if (cancel) this._commitRegion(state.hit.index, state.originalRegion);
        this.canvas.releasePointerCapture?.(event.pointerId);
        this._pointerState = null;
        event.preventDefault();
    }

    _handleKeyDown(event) {
        if (event.key === 'Escape' && this._pointerState) {
            const state = this._pointerState;
            this._commitRegion(state.hit.index, state.originalRegion);
            this.canvas?.releasePointerCapture?.(state.pointerId);
            this._pointerState = null;
            this._pendingPointerMove = null;
            event.preventDefault();
        }
    }

    _logicalHandlePoint(hit, region) {
        const point = { x: hit.x, y: hit.y };
        if (hit.phaseEdge) {
            const key = hit.outer
                ? (hit.phaseEdge === 'low' ? 'opl' : 'oph')
                : (hit.phaseEdge === 'low' ? 'pl' : 'ph');
            const side = hit.x < this._phaseToX(0) ? -1 : 1;
            point.x = this._phaseToX(side * region[key]);
        }
        if (hit.frequencyEdge) {
            const key = hit.outer
                ? (hit.frequencyEdge === 'low' ? 'ofl' : 'ofh')
                : (hit.frequencyEdge === 'low' ? 'fl' : 'fh');
            point.y = this._frequencyToY(region[key]);
        }
        return point;
    }

    _selectedHandles() {
        const index = this.selectedRegionIndex;
        const region = this.regions[index];
        if (!region?.en) return [];
        const geometry = this._regionGeometry(region);
        const handles = [];
        for (const rectangle of geometry.core) {
            const centerX = (rectangle.left + rectangle.right) * 0.5;
            const centerY = (rectangle.top + rectangle.bottom) * 0.5;
            const leftPhaseEdge = rectangle.high <= 0 ? 'high' : (rectangle.low < 0 ? 'high' : 'low');
            const rightPhaseEdge = rectangle.low >= 0 ? 'high' : (rectangle.high > 0 ? 'high' : 'low');
            handles.push(
                { x: centerX, y: rectangle.top, index, mode: 'handle', frequencyEdge: 'high' },
                { x: centerX, y: rectangle.bottom, index, mode: 'handle', frequencyEdge: 'low' },
                { x: rectangle.left, y: centerY, index, mode: 'handle', phaseEdge: leftPhaseEdge },
                { x: rectangle.right, y: centerY, index, mode: 'handle', phaseEdge: rightPhaseEdge },
                { x: rectangle.left, y: rectangle.top, index, mode: 'handle', phaseEdge: leftPhaseEdge, frequencyEdge: 'high' },
                { x: rectangle.right, y: rectangle.top, index, mode: 'handle', phaseEdge: rightPhaseEdge, frequencyEdge: 'high' },
                { x: rectangle.left, y: rectangle.bottom, index, mode: 'handle', phaseEdge: leftPhaseEdge, frequencyEdge: 'low' },
                { x: rectangle.right, y: rectangle.bottom, index, mode: 'handle', phaseEdge: rightPhaseEdge, frequencyEdge: 'low' }
            );
        }
        if (region.pl === 0) {
            const centerY = (this._frequencyToY(region.fh) + this._frequencyToY(region.fl)) * 0.5;
            handles.push({ x: this._phaseToX(0), y: centerY, index, mode: 'handle', phaseEdge: 'low', split: true });
        }
        for (const rectangle of geometry.outer) {
            const centerX = (rectangle.left + rectangle.right) * 0.5;
            const centerY = (rectangle.top + rectangle.bottom) * 0.5;
            handles.push(
                {
                    x: centerX,
                    y: rectangle.top - (region.ofh === region.fh
                        ? PHASE_SELECT_EQ_ZERO_TRANSITION_HANDLE_OFFSET : 0),
                    index, mode: 'handle', outer: true, frequencyEdge: 'high'
                },
                {
                    x: centerX,
                    y: rectangle.bottom + (region.ofl === region.fl
                        ? PHASE_SELECT_EQ_ZERO_TRANSITION_HANDLE_OFFSET : 0),
                    index, mode: 'handle', outer: true, frequencyEdge: 'low'
                }
            );
            if (region.opl > 0) {
                const negativeSide = rectangle.high <= 0;
                handles.push({
                    x: (negativeSide ? rectangle.right : rectangle.left) +
                        (region.opl === region.pl
                            ? (negativeSide ? PHASE_SELECT_EQ_ZERO_TRANSITION_HANDLE_OFFSET
                                : -PHASE_SELECT_EQ_ZERO_TRANSITION_HANDLE_OFFSET)
                            : 0),
                    y: centerY, index, mode: 'handle', outer: true, phaseEdge: 'low'
                });
            }
            if (region.oph < 180) {
                const negativeSide = rectangle.high <= 0;
                handles.push({
                    x: (negativeSide ? rectangle.left : rectangle.right) +
                        (region.oph === region.ph
                            ? (negativeSide ? -PHASE_SELECT_EQ_ZERO_TRANSITION_HANDLE_OFFSET
                                : PHASE_SELECT_EQ_ZERO_TRANSITION_HANDLE_OFFSET)
                            : 0),
                    y: centerY, index, mode: 'handle', outer: true, phaseEdge: 'high'
                });
            }
        }
        return handles;
    }

    _hitTest(x, y) {
        const handles = this._selectedHandles();
        let nearest = null;
        let nearestDistance = Infinity;
        for (const handle of handles) {
            const distance = Math.hypot(handle.x - x, handle.y - y);
            if (distance <= 22 && distance < nearestDistance) {
                nearest = handle;
                nearestDistance = distance;
            }
        }
        if (nearest) return nearest;

        const order = [];
        if (this.regions[this.selectedRegionIndex]?.en) order.push(this.selectedRegionIndex);
        for (let index = PHASE_SELECT_EQ_BAND_COUNT - 1; index >= 0; index--) {
            if (index !== this.selectedRegionIndex && this.regions[index].en) order.push(index);
        }
        for (const index of order) {
            const geometry = this._regionGeometry(this.regions[index]);
            for (const rectangle of geometry.outer) {
                if (x >= rectangle.left && x <= rectangle.right &&
                    y >= rectangle.top && y <= rectangle.bottom) {
                    return { index, mode: 'move' };
                }
            }
            for (const rectangle of geometry.outer) {
                const nearVertical = y >= rectangle.top - 8 && y <= rectangle.bottom + 8 &&
                    (Math.abs(x - rectangle.left) <= 8 || Math.abs(x - rectangle.right) <= 8);
                const nearHorizontal = x >= rectangle.left - 8 && x <= rectangle.right + 8 &&
                    (Math.abs(y - rectangle.top) <= 8 || Math.abs(y - rectangle.bottom) <= 8);
                if (nearVertical || nearHorizontal) return { index, mode: 'move' };
            }
        }
        return null;
    }

    startAnimation() {
        if (this.animationFrameId || !this.isVisible || !this.canRunAnimation()) return;
        const animate = () => {
            if (!this.isVisible || !this.canRunAnimation()) {
                this.animationFrameId = null;
                return;
            }
            this.drawGraph();
            this.animationFrameId = this.requestPowerAnimationFrame(animate, 'plugin');
        };
        this.animationFrameId = this.requestPowerAnimationFrame(animate, 'plugin');
    }

    stopAnimation() {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    _drawRectangle(ctx, rectangle, color, dashed) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash(dashed ? [5, 4] : []);
        ctx.strokeRect(rectangle.left, rectangle.top,
            rectangle.right - rectangle.left, rectangle.bottom - rectangle.top);
        ctx.restore();
    }

    drawGraph() {
        if (!this.canvas) return;
        const context = this.canvas.getContext('2d');
        if (!context) return;
        const width = this._graphCssWidth;
        const height = this._graphCssHeight;
        const dpr = this._graphDpr || 1;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);
        context.fillStyle = '#1a1a1a';
        context.fillRect(0, 0, width, height);
        const plot = this._plotRect();

        context.font = '12px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'bottom';
        for (let phase = -135; phase <= 135; phase += 45) {
            const x = this._phaseToX(phase);
            context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
            context.lineWidth = phase === 0 ? 1.5 : 1;
            context.beginPath();
            context.moveTo(x, plot.top);
            context.lineTo(x, plot.bottom);
            context.stroke();
            context.fillStyle = '#888';
            context.fillText(`${phase > 0 ? '+' : ''}${phase}°`, x, plot.bottom - 25);
        }
        const frequencies = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
            .filter(frequency => frequency < this._maximumDisplayFrequency());
        context.textAlign = 'right';
        context.textBaseline = 'middle';
        for (const frequency of frequencies) {
            const y = this._frequencyToY(frequency);
            context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(plot.left, y);
            context.lineTo(plot.right, y);
            context.stroke();
            context.fillStyle = '#888';
            context.fillText(frequency >= 1000 ? `${frequency / 1000}k` : String(frequency),
                plot.left + 40, y);
        }

        const geometry = this.regions.map(region => this._regionGeometry(region));
        for (let index = 0; index < this.regions.length; index++) {
            if (!this.regions[index].en) continue;
            const color = index === this.selectedRegionIndex
                ? PHASE_SELECT_EQ_ACTIVE_COLOR : PHASE_SELECT_EQ_INACTIVE_COLOR;
            for (const rectangle of geometry[index].outer) {
                this._drawRectangle(context, rectangle, color, true);
            }
            for (const rectangle of geometry[index].core) {
                this._drawRectangle(context, rectangle, color, false);
            }
        }

        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this._discardOldMapFrames(now);
        for (const frame of this.phaseMapFrames) {
            const ageOpacity = Math.exp(-(now - frame.time) / 220);
            for (const point of frame.points) {
                if (point.relativeLevelDb < -72) continue;
                const level = phaseSelectEqClamp((point.relativeLevelDb + 72) / 72, 0, 1);
                context.globalAlpha = ageOpacity * (0.15 + 0.75 * level);
                context.fillStyle = '#ffffff';
                context.beginPath();
                context.arc(this._phaseToX(point.phase), this._frequencyToY(point.frequency),
                    0.6 + 1.1 * level, 0, Math.PI * 2);
                context.fill();
            }
        }
        context.globalAlpha = 1;

        context.font = 'bold 11px Arial';
        context.textAlign = 'left';
        context.textBaseline = 'top';
        for (let index = 0; index < this.regions.length; index++) {
            const region = this.regions[index];
            if (!region.en) continue;
            for (const rectangle of geometry[index].core) {
                context.fillStyle = index === this.selectedRegionIndex
                    ? PHASE_SELECT_EQ_ACTIVE_COLOR : PHASE_SELECT_EQ_INACTIVE_COLOR;
                context.fillText(String(index + 1), rectangle.left + 4, rectangle.top + 4);
            }
        }

        for (const handle of this._selectedHandles()) {
            context.save();
            context.translate(handle.x, handle.y);
            context.fillStyle = handle.outer ? '#1a1a1a' : PHASE_SELECT_EQ_ACTIVE_COLOR;
            context.strokeStyle = PHASE_SELECT_EQ_ACTIVE_COLOR;
            context.lineWidth = 2;
            if (handle.outer) {
                context.strokeRect(-5, -5, 10, 10);
            } else if (handle.split) {
                context.rotate(Math.PI / 4);
                context.fillRect(-5, -5, 10, 10);
                context.strokeRect(-5, -5, 10, 10);
            } else {
                context.beginPath();
                context.arc(0, 0, 5, 0, Math.PI * 2);
                context.fill();
                context.stroke();
            }
            context.restore();
        }
    }

    cleanup() {
        this.stopAnimation();
        this.disposeDspTelemetrySubscription();
        this._intersectionObserver?.disconnect();
        this._intersectionObserver = null;
        document.removeEventListener('keydown', this._boundKeyDown);
        this._unbindCanvasPointerEvents();
        this._graphDisposer?.();
        this._graphDisposer = null;
        this._editor = null;
        this.canvas = null;
        this.phaseMapFrames.length = 0;
        this.lastTelemetrySequence = null;
        super.cleanup();
    }
}

if (typeof window !== 'undefined') window.PhaseSelectEqPlugin = PhaseSelectEqPlugin;
