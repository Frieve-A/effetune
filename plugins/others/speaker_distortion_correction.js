// Distortion Correction applies the static second-order pre-distorter
// fitted in Acoustic Measurement. The plugin only selects, stages and shows the
// stored speaker model; it never fits, re-decides or measures anything.

const SDC_CHANNELS = 16;
const SDC_WEIGHT_FRAMES = 1182;
const SDC_ODD_COUNT = 32;
const SDC_ODD_WEIGHT_FRAME = SDC_WEIGHT_FRAMES + 1;
const SDC_ODD_BOUND_FRAME = SDC_ODD_WEIGHT_FRAME + SDC_ODD_COUNT;
const SDC_FRAMES = SDC_ODD_BOUND_FRAME + SDC_ODD_COUNT;
const SDC_HEADER_BYTES = 32;
const SDC_ASSET_BYTES = SDC_HEADER_BYTES + SDC_CHANNELS * SDC_FRAMES * 4;
const SDC_ASSET_MAGIC = 0x31415445;
// Shared with the kernel: every staged weight must satisfy |w| < SDC_MAX_WEIGHT.
const SDC_MAX_WEIGHT = 1000;
const SDC_MIN_RATE = 44100;
const SDC_TAP_OVERLOAD = 1;
const SDC_TELEMETRY_VERSION = 1;
const SDC_OVERLOAD_HOLD_MS = 5000;
const SDC_LENGTH_KEYS = { Short: 'short', Long: 'long' };
const SDC_SOURCES = ['', 'check', 'user'];
// Room EQ's messages for the DSP engine's bypass reasons.
const SDC_BYPASS_MESSAGES = {
    unsupportedSampleRate: 'This sample rate is not supported. Distortion Correction is bypassed.',
    wasmUnavailable: 'WASM audio processing is unavailable. Distortion Correction is bypassed.',
    rolloutDisabled: 'DSP processing is disabled. Distortion Correction is bypassed.',
    runtimeFallback: 'Audio processing was interrupted. Distortion Correction is bypassed.'
};
// The effect UI stays in English, so its dates and lists are formatted in English too.
const SDC_UI_LANGUAGE = 'en';

/**
 * Decimation, delay in samples and processing per sample of the kernel at
 * sample rate `fs` for the model length `length` ('short' or 'long'); `odd`
 * adds the odd-order block.
 */
function speakerCorrectionTiming(fs, length, odd = false) {
    let decimation = 2;
    while (fs / (decimation * 2) >= 22050) decimation *= 2;
    const fitRate = 2 * fs / decimation;
    const delay = Math.round((length === 'long' ? 0.0025 : 0.000625) * fitRate);
    const filterRate = length === 'long' ? fitRate : (fs < 2 * fitRate ? fs : 2 * fitRate);
    let latencySamples = delay * fs / fitRate;
    let ops = 159 + 1154 / decimation + delay * filterRate / fs + (odd ? 80 / decimation + 1 : 0);
    let stages = 0;
    for (let rate = filterRate * 2; rate <= fs; rate *= 2) {
        const taps = Math.ceil(42.05 / (2.285 * 2 * Math.PI * (rate / 2 - 40000) / rate)) + 1;
        const blocks = Math.ceil((taps + 1) / 4);
        latencySamples += (4 * blocks - 2) * fs / rate;
        ops += 2 * blocks * rate / fs;
        stages++;
    }
    if (stages) ops += 0.5;
    return { decimation, latencySamples, ops };
}

/** Extra processing of Long over Short in percent, rounded to 5 %. */
function speakerCorrectionLongPercent(fs, odd = false) {
    const ratio = speakerCorrectionTiming(fs, 'long', odd).ops / speakerCorrectionTiming(fs, 'short', odd).ops;
    return Math.round(100 * (ratio - 1) / 5) * 5;
}

function speakerCorrectionHasFit(entry, length) {
    const reason = entry.reason?.[length];
    return entry.weights?.[length] != null && reason !== 'belowLimit' && reason !== 'noFit';
}

/** 'off', 'on' or 'auto' for channel `index`; a bit set in both masks means Off. */
function speakerCorrectionPosition(index, cn, co) {
    if ((co >>> index) & 1) return 'off';
    return (cn >>> index) & 1 ? 'on' : 'auto';
}

// The generic pipeline packs its selected physical channels from local channel 0.
function speakerCorrectionSelection(channel, outputChannelCount) {
    const pairs = ['34', '56', '78', '910', '1112', '1314', '1516'];
    const pair = pairs.indexOf(channel);
    const first = channel === 'R' ? 1 : pair >= 0 ? 2 + 2 * pair
        : channel === 'L' || channel === 'A' || channel == null ? 0 : Number(channel) - 1;
    const count = channel === 'A' ? outputChannelCount : channel == null
        ? (outputChannelCount === 1 ? 1 : 2) : pair >= 0 ? 2 : 1;
    return { first, count: Number.isInteger(first) && first >= 0 && first + count <= outputChannelCount ? count : 0 };
}

// The measurement's channel name, or the measurement app's generic name for output channel `index`.
function speakerCorrectionLabel(index, label) {
    return label || `Ch ${index + 1}`;
}

function speakerCorrectionCorrected(entry, length, cn, co, outputChannelCount) {
    if (entry.index >= outputChannelCount || !speakerCorrectionHasFit(entry, length)) return false;
    const position = speakerCorrectionPosition(entry.index, cn, co);
    return position === 'on' || (position === 'auto' && entry.on?.[length] === true);
}

/**
 * What plays on channel `entry` at Filter Length `length`: { even, c, odd }, where `even` tells whether
 * the even block plays, `c` is the odd configuration ('short', 'long' or 'alone') and `odd` is the
 * { plays, reason } of `oddDecision` (from the speaker-distortion module).
 */
function speakerCorrectionPlay(entry, length, { cn, co, cn3, co3 }, outputChannelCount, oddDecision) {
    const even = speakerCorrectionCorrected(entry, length, cn, co, outputChannelCount);
    const c = even ? length : 'alone';
    const odd = entry.index < outputChannelCount
        ? oddDecision(entry, c, speakerCorrectionPosition(entry.index, cn3, co3))
        : { plays: false, reason: null };
    return { even, c, odd };
}

// Copies `values` (expected length `count`) into the channel at `base` from frame `first`; returns
// { frame, value } of the first invalid value (value null for a wrong length) or null.
function packFrames(data, base, first, values, count, valid) {
    if (values?.length !== count) return { frame: first + (values?.length ?? 0), value: null };
    for (let i = 0; i < count; i++) {
        const value = values[i];
        if (!valid(value)) return { frame: first + i, value };
        data[base + first + i] = value;
    }
    return null;
}

const validWeight = value => value < SDC_MAX_WEIGHT && value > -SDC_MAX_WEIGHT;
const validBound = value => value > 0 && value < Infinity;

/**
 * Packs the slot-0 asset: the 32-byte header, then 16 channels x 1247 float32
 * frames, channel-major in physical speaker order. Frames 0-1181 carry the even weights where the even
 * block plays, frame 1182 the Filter Length step on every channel, frames
 * 1183-1214 the odd weights and 1215-1246 the odd bounds where the odd block
 * plays; everything else is zero. Returns { payload } or { error } describing
 * the first value that fails validation (`frame` counts from the channel start).
 */
function buildSpeakerCorrectionAsset(model, settings, outputChannelCount, oddDecision) {
    const length = SDC_LENGTH_KEYS[settings.fl];
    const payload = new ArrayBuffer(SDC_ASSET_BYTES);
    const header = new Uint32Array(payload, 0, SDC_HEADER_BYTES / 4);
    header[0] = SDC_ASSET_MAGIC;
    header[1] = SDC_CHANNELS;
    header[2] = SDC_FRAMES;
    header[4] = 2;
    const data = new Float32Array(payload, SDC_HEADER_BYTES);
    const step = length === 'long' ? 1 : 0;
    for (let channel = 0; channel < SDC_CHANNELS; channel++) {
        data[channel * SDC_FRAMES + SDC_WEIGHT_FRAMES] = step;
    }
    for (const entry of model.channels) {
        if (entry.index < 0 || entry.index >= SDC_CHANNELS) continue;
        const { even, odd } = speakerCorrectionPlay(entry, length, settings, outputChannelCount, oddDecision);
        const base = entry.index * SDC_FRAMES;
        const failed = (even && packFrames(data, base, 0, entry.weights[length], SDC_WEIGHT_FRAMES, validWeight)) ||
            (odd.plays && (packFrames(data, base, SDC_ODD_WEIGHT_FRAME, entry.odd.weights, SDC_ODD_COUNT, validWeight) ||
                packFrames(data, base, SDC_ODD_BOUND_FRAME, entry.odd.bounds, SDC_ODD_COUNT, validBound)));
        if (failed) return { error: { channel: entry.index, length, ...failed } };
    }
    return { payload, processingChannels: outputChannelCount };
}

function sameBytes(a, b) {
    if (!a || !b || a.byteLength !== b.byteLength) return false;
    const left = new Uint32Array(a);
    const right = new Uint32Array(b);
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}

function maskValue(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 && number <= 0xffff ? number : 0;
}

// ---- DOM helpers -------------------------------------------------------------

/** Fills the `{name}` placeholders of an English text. */
function fillText(template, params) {
    return Object.entries(params).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        template
    );
}

function textLine(text) {
    const line = document.createElement('p');
    line.className = 'sdc-line';
    line.textContent = text;
    return line;
}

function optionElement(text, value) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    return option;
}

class SpeakerDistortionCorrectionPlugin extends PluginBase {
    constructor() {
        super('Distortion Correction', 'Reduces the measured distortion of your speakers');
        this.dv = 0;
        this.md = 'Reduce';
        this.ms = '';
        this.mn = '';
        this.fl = 'Short';
        this.cn = 0;
        this.co = 0;
        this.cn3 = 0;
        this.co3 = 0;
        this.dvs = '';
        this.dc = 0;
        // When the effect asked for a new measurement; a measurement saved later is adopted.
        this.mr = 0;

        this._sampleRate = this._getEngineSampleRate();
        this._outputChannelCount = this._getEngineChannelCount();
        this._disposed = false;
        this._runtime = null;
        this._runtimePromise = null;
        this._measurementStore = null;
        this._lookupGeneration = 0;
        this._records = [];
        this._model = null;
        // 'none' (nothing looked up), 'loading', 'found' or 'missing'
        this._modelState = 'none';
        this._invalid = false;
        this._modelRevision = null;
        this._stagedBytes = null;
        this._stagedChannels = null;
        this._stagedSignature = null;
        this._candidateAssetRevision = null;
        this._effectiveAssetRevision = null;
        this._assetState = 0;
        this._updated = false;
        this._followedByAudioEffect = false;
        this._overloaded = false;
        this._overloadTimer = null;
        // The reason the DSP engine bypasses this effect, when it does.
        this._bypassReason = null;
        this._graphChannel = null;
        this._view = 'asSet';
        this._showOdd = false;
        this._selectedTab = 'measurement';
        this._ui = null;
        this._resizeObserver = null;
        this._graphReadout = null;
        this._chart = null;
        // Text of the legend entry under the pointer, and the undo of its curve emphasis.
        this._hoveredLegend = null;
        this._restoreLegendHover = null;

        this._visibilityHandler = () => {
            if (globalThis.document?.visibilityState === 'visible') this._refresh();
        };
        this._focusHandler = () => this._refresh();
        globalThis.document?.addEventListener?.('visibilitychange', this._visibilityHandler);
        globalThis.window?.addEventListener?.('focus', this._focusHandler);

        // The WASM kernel does the work; the JavaScript fallback passes audio through.
        this.registerProcessor('return data;');
    }

    process(context, data) {
        return data;
    }

    _list(labels) {
        return new Intl.ListFormat(SDC_UI_LANGUAGE, { type: 'conjunction' }).format(labels);
    }

    _getEngineSampleRate() {
        const value = this._sampleRate || window.workletNode?.context?.sampleRate ||
            window.audioContext?.sampleRate || window.uiManager?.audioManager?.audioContext?.sampleRate;
        return Number.isFinite(value) && value > 0 ? value : 48000;
    }

    _getEngineChannelCount() {
        const candidates = [
            this._outputChannelCount,
            window.workletNode?.channelCount,
            window.audioManager?.outputChannelCount,
            window.uiManager?.audioManager?.outputChannelCount
        ];
        return candidates.find(value => Number.isInteger(value) && value >= 1 && value <= 16) || 2;
    }

    // ---- Parameters -------------------------------------------------------

    getParameters(options = {}) {
        this.ensureDspTelemetrySubscription();
        const sampleRate = Number.isFinite(options.sampleRate) && options.sampleRate > 0
            ? options.sampleRate
            : this._sampleRate;
        const outputChannelCount = Number.isInteger(options.outputChannelCount) &&
            options.outputChannelCount >= 1 && options.outputChannelCount <= 16
            ? options.outputChannelCount
            : this._outputChannelCount;
        if (options.commitSampleRate &&
            (sampleRate !== this._sampleRate || outputChannelCount !== this._outputChannelCount)) {
            const channelsChanged = outputChannelCount !== this._outputChannelCount;
            this._sampleRate = sampleRate;
            this._outputChannelCount = outputChannelCount;
            Promise.resolve().then(() => {
                if (this._disposed) return;
                if (channelsChanged) this._stage();
                this._render();
            });
        }
        const selection = speakerCorrectionSelection(this.channel, outputChannelCount);
        return {
            ...super.getParameters(),
            _scf: selection.first,
            _scc: selection.count,
            dv: this.dv,
            md: this.md,
            ms: this.ms,
            mn: this.mn,
            fl: this.fl,
            cn: this.cn,
            co: this.co,
            cn3: this.cn3,
            co3: this.co3,
            dvs: this.dvs,
            dc: this.dc,
            mr: this.mr
        };
    }

    getSerializableParameters() {
        const serialized = super.getSerializableParameters();
        delete serialized._scf;
        delete serialized._scc;
        for (const key of ['ms', 'mn', 'dvs']) {
            if (!serialized[key]) delete serialized[key];
        }
        for (const key of ['cn', 'co', 'cn3', 'co3', 'dc', 'mr']) {
            if (serialized[key] === 0) delete serialized[key];
        }
        return serialized;
    }

    // Keys dropped by getSerializableParameters read as their defaults.
    setSerializedParameters(params) {
        super.setSerializedParameters({ ms: '', mn: '', dvs: '', cn: 0, co: 0, cn3: 0, co3: 0, dc: 0, mr: 0, ...params });
    }

    _structureKey() {
        return JSON.stringify([this.ms, this.mn, this.md, this.fl, this.cn, this.co, this.cn3, this.co3, this.channel]);
    }

    // Settings that change the staged asset.
    _stageKey() {
        return JSON.stringify([this.fl, this.cn, this.co, this.cn3, this.co3]);
    }

    setParameters(params = {}) {
        const previousStructure = this._structureKey();
        const previousDv = this.dv;
        const previousMs = this.ms;
        const previousStageKey = this._stageKey();
        super._setValidatedParameters(params);
        if (params.dv !== undefined) {
            this.dv = Math.round(this.parseFiniteNumber(params.dv, -24, 0, this.dv) * 2) / 2;
        }
        if (params.md !== undefined) this.md = params.md === 'Add' ? 'Add' : 'Reduce';
        if (params.ms !== undefined) this.ms = typeof params.ms === 'string' ? params.ms : '';
        if (params.mn !== undefined) this.mn = typeof params.mn === 'string' ? params.mn : '';
        if (params.fl !== undefined) this.fl = params.fl === 'Long' ? 'Long' : 'Short';
        if (params.cn !== undefined) this.cn = maskValue(params.cn);
        if (params.co !== undefined) this.co = maskValue(params.co);
        if (params.cn3 !== undefined) this.cn3 = maskValue(params.cn3);
        if (params.co3 !== undefined) this.co3 = maskValue(params.co3);
        for (const key of ['dc', 'mr']) {
            if (params[key] === undefined) continue;
            const time = Number(params[key]);
            this[key] = Number.isFinite(time) && time > 0 ? time : 0;
        }
        if (params.dvs !== undefined) {
            this.dvs = SDC_SOURCES.includes(params.dvs) ? params.dvs : '';
        } else if (params.dv !== undefined && this.dv !== previousDv) {
            this.dvs = 'user';
        }

        const structureChanged = this._structureKey() !== previousStructure;
        if (structureChanged || this.dv !== previousDv) this._updated = false;

        if (this.ms !== previousMs) {
            this._graphChannel = null;
            this._model = null;
            this._modelState = 'none';
            this._invalid = false;
            this._modelRevision = null;
            this._clearAsset();
            this._refresh();
        } else if (this._stageKey() !== previousStageKey) {
            this._stage();
        }
        this.updateParameters();
        this._render({ structure: structureChanged });
    }

    onChannelSelectionChanged() {
        // The route and its physical span travel together in the ordinary parameter update.
        this._updated = false;
        this._render({ structure: true });
    }

    /** The parameter values for a newly selected or adopted measurement. */
    _selectionParameters(record) {
        const model = record.speakerModel;
        const parameters = {
            ms: record.id,
            mn: this._runtime.measurementTitle(record, SDC_UI_LANGUAGE, 'Untitled'),
            dv: 0,
            md: 'Reduce',
            fl: model.recommendedLength === 'long' ? 'Long' : 'Short',
            cn: 0,
            co: 0,
            cn3: 0,
            co3: 0,
            dvs: '',
            dc: 0,
            mr: 0
        };
        const surround = model.channels.some(entry => entry.index >= 2 &&
            (speakerCorrectionHasFit(entry, 'short') || speakerCorrectionHasFit(entry, 'long') ||
                this._runtime.oddDecision(entry, 'alone', 'auto').plays));
        if (surround) parameters.channel = 'A';
        return parameters;
    }

    // ---- Measurement lookup -------------------------------------------------

    _getRuntime() {
        if (!this._runtimePromise) {
            this._runtimePromise = Promise.all([
                import('../../js/measurement-store/client.js'),
                import('../../features/measurement/speaker-distortion-figures.js'),
                import('../../features/measurement/speaker-distortion-chart.js'),
                import('../../js/utils/measurement-dsp/speaker-distortion/constants.js'),
                import('../../js/utils/measurement-dsp/speaker-distortion/check.js')
            ]).then(modules => Object.assign({}, ...modules));
        }
        return this._runtimePromise;
    }

    async _getMeasurementStore(refresh = false) {
        const runtime = await this._getRuntime();
        if (this._disposed) return null;
        if (!this._measurementStore) {
            const openedStore = await runtime.openMeasurementStore();
            if (this._disposed) {
                await openedStore?.close?.();
                return null;
            }
            if (this._measurementStore) await openedStore?.close?.();
            else this._measurementStore = openedStore;
        }
        if (refresh) {
            const store = this._measurementStore;
            await store?.refresh();
            if (this._disposed || store !== this._measurementStore) return null;
        }
        return this._measurementStore;
    }

    static _speakerRecords(store) {
        const time = record => record.savedAt ?? record.speakerModel.measuredAt;
        return (store?.measurements ?? [])
            .filter(record => record?.speakerModel)
            .sort((a, b) => time(b) - time(a));
    }

    /** Re-reads the store, adopts a newly saved measurement and applies the model of `ms`. */
    async _refresh() {
        if (this._disposed || this.hasLocalAudio === false) return;
        const generation = ++this._lookupGeneration;
        if (this.ms && this._modelState !== 'found') {
            this._modelState = 'loading';
            this._renderStatus();
        }
        let store = null;
        try {
            this._runtime = await this._getRuntime();
            store = await this._getMeasurementStore(true);
        } catch (error) {
            console.warn('Distortion Correction could not open the measurement store:', this.ms, error);
        }
        if (this._disposed || generation !== this._lookupGeneration) return;
        this._records = SpeakerDistortionCorrectionPlugin._speakerRecords(store);
        if (!this.ms) {
            const adopted = this.mr > 0 && this._records.find(record =>
                Number.isFinite(record.savedAt) && record.savedAt > this.mr);
            if (adopted) {
                this.setParameters(this._selectionParameters(adopted));
                return;
            }
            this._render({ structure: true });
            return;
        }
        const record = store ? this._records.find(item => item.id === this.ms) : null;
        if (!record) console.warn('Distortion Correction measurement not found:', this.ms);
        this._applyModel(record?.speakerModel ?? null);
    }

    _applyModel(model) {
        if (!model) {
            this._model = null;
            this._modelState = 'missing';
            this._modelRevision = null;
            this._clearAsset();
            this._render({ structure: true });
            return;
        }
        const revisionChanged = this._modelRevision !== null && model.revision !== this._modelRevision;
        this._model = model;
        this._modelState = 'found';
        this._modelRevision = model.revision;
        this._pickUpCheck(model.lastCheck);
        const staged = this._stage();
        if (revisionChanged && staged) this._updated = true;
        this._render({ structure: true });
    }

    /** Applies a newer Check again result without creating an undo step. */
    _pickUpCheck(lastCheck) {
        if (!lastCheck || !(lastCheck.at > this.dc)) return;
        if (['same', 'lower', 'louder'].includes(lastCheck.outcome)) {
            this.dv = this.parseFiniteNumber(lastCheck.dv, -24, 0, this.dv);
            this.dvs = 'check';
        }
        this.dc = lastCheck.at;
        const historyManager = this.audioManager?.pipelineManager?.historyManager ??
            window.uiManager?.pipelineManager?.historyManager;
        if (historyManager?.withHistorySuppressed) {
            historyManager.withHistorySuppressed(() => this.updateParameters());
        } else {
            this.updateParameters();
        }
    }

    // ---- Asset --------------------------------------------------------------

    _signature(model = this._model) {
        return JSON.stringify([this.ms, model?.revision ?? null, model?.lastCheck?.at ?? null,
            this.fl, this.cn, this.co, this.cn3, this.co3]);
    }

    _assetDescriptor(payload, processingChannels, signature) {
        return {
            payload,
            formatTag: 1,
            headBlock: 0,
            rateDivider: 1,
            pathCount: 0,
            inputCount: 0,
            processingChannels,
            footprintBytes: SDC_ASSET_BYTES,
            externalAssetSignature: signature
        };
    }

    _clearAsset() {
        this._stagedBytes = null;
        this._stagedChannels = null;
        this._stagedSignature = null;
        this._candidateAssetRevision = null;
        this._effectiveAssetRevision = null;
        this._assetState = 0;
        this.clearWasmAsset(0);
    }

    /** Builds and stages the asset of the current model; returns true when it staged. */
    _stage() {
        if (this._disposed || !this._model || this._modelState !== 'found') return false;
        const result = buildSpeakerCorrectionAsset(this._model, this, this._outputChannelCount,
            this._runtime.oddDecision);
        if (result.error) {
            console.warn('Distortion Correction weights failed validation:', result.error);
            this._invalid = true;
            this._clearAsset();
            return false;
        }
        this._invalid = false;
        const channels = result.processingChannels;
        if (sameBytes(result.payload, this._stagedBytes) && channels === this._stagedChannels) return false;
        this._stagedBytes = result.payload.slice(0);
        this._stagedChannels = channels;
        this._stagedSignature = this._signature();
        this._candidateAssetRevision = this.setWasmAsset(0,
            this._assetDescriptor(result.payload, channels, this._stagedSignature));
        this._assetState = 1;
        return true;
    }

    _rejectAsset() {
        this._invalid = true;
        this._stagedBytes = null;
        this._stagedChannels = null;
        this._candidateAssetRevision = null;
        this._effectiveAssetRevision = null;
        this._assetState = 4;
        this._render({ structure: true });
    }

    onWasmAssetState(slot, state, operationRevision) {
        if (this._disposed || slot !== 0 || !this._isCurrentWasmAssetOperation(slot, operationRevision)) {
            return;
        }
        const status = state & 0xff;
        const isCandidate = operationRevision === this._candidateAssetRevision;
        const isEffective = operationRevision === this._effectiveAssetRevision;
        if ((!isCandidate && status !== 4) || (!isCandidate && !isEffective)) return;
        this._assetState = status;
        if (status === 3) {
            this._effectiveAssetRevision = operationRevision;
            this._candidateAssetRevision = null;
            this._logTiming();
            this._renderStatus();
        } else if (status === 4) {
            console.warn('Distortion Correction asset was not activated.');
            this._rejectAsset();
        }
    }

    onWasmAssetRejected(slot, reason, operationRevision) {
        if (this._disposed || slot !== 0 || operationRevision !== this._candidateAssetRevision) return;
        console.warn('Distortion Correction asset rejected:', reason);
        this._rejectAsset();
    }

    _logTiming() {
        const rate = this._getEngineSampleRate();
        const odd = this._oddPlays();
        const short = speakerCorrectionTiming(rate, 'short', odd);
        const long = speakerCorrectionTiming(rate, 'long', odd);
        console.info('Distortion Correction active:', {
            sampleRate: rate,
            odd,
            decimation: short.decimation,
            delaySamples: { short: short.latencySamples, long: long.latencySamples },
            opsPerSample: { short: short.ops, long: long.ops }
        });
    }

    // ---- Offline render -----------------------------------------------------

    get offlineDspAssetErrorMessageKey() {
        return 'speakerDistortionCorrection.error.offline';
    }

    get externalAssetInfo() {
        if (!this.ms) return null;
        return {
            missing: this._modelState === 'missing' || this._invalid,
            pending: this._modelState !== 'found' && this._modelState !== 'missing',
            ids: [this.ms],
            names: [this.mn],
            kind: 'Measurement',
            assetSignature: this._stagedSignature ?? this._signature()
        };
    }

    get offlineDspAssetRequired() {
        return this.isOfflineDspAssetRequired();
    }

    isOfflineDspAssetRequired() {
        return Boolean(this.ms);
    }

    _offlineError(message) {
        const error = new Error(message);
        error.userMessageKey = this.offlineDspAssetErrorMessageKey;
        return error;
    }

    _offlineKey() {
        return JSON.stringify([this.ms, this.fl, this.cn, this.co, this.cn3, this.co3, this.channel]);
    }

    async resolveOfflineDspAssetRequirement({
        isCurrent = () => true,
        outputChannelCount = this._outputChannelCount
    } = {}) {
        const key = this._offlineKey();
        const operationCurrent = () => !this._disposed && isCurrent() && key === this._offlineKey();
        if (!this.ms) return { required: false, key, outputChannelCount, payload: null, signature: null };
        let runtime = null;
        let store = null;
        try {
            runtime = await this._getRuntime();
            store = await this._getMeasurementStore(true);
        } catch (error) {
            console.warn('Distortion Correction could not open the measurement store:', this.ms, error);
        }
        if (!operationCurrent()) {
            throw this._offlineError('Distortion Correction settings changed during export preparation.');
        }
        const model = SpeakerDistortionCorrectionPlugin._speakerRecords(store)
            .find(record => record.id === this.ms)?.speakerModel;
        if (!model) {
            console.warn('Distortion Correction measurement not found for export:', this.ms);
            throw this._offlineError('Distortion Correction measurement is not available.');
        }
        const result = buildSpeakerCorrectionAsset(model, this, outputChannelCount, runtime.oddDecision);
        if (result.error) {
            console.warn('Distortion Correction weights failed validation for export:', result.error);
            throw this._offlineError('Distortion Correction weights failed validation.');
        }
        return {
            required: true,
            key,
            outputChannelCount,
            processingChannels: result.processingChannels,
            payload: result.payload,
            signature: this._signature(model)
        };
    }

    async createOfflineDspState({
        outputChannelCount,
        isCurrent = () => true,
        offlineDspAssetRequirement = null
    } = {}) {
        const selection = speakerCorrectionSelection(this.channel, outputChannelCount ?? this._outputChannelCount);
        const parameters = { ...super.getParameters(), dv: this.dv, md: this.md,
            _scf: selection.first, _scc: selection.count };
        const key = this._offlineKey();
        const requirement = offlineDspAssetRequirement ||
            await this.resolveOfflineDspAssetRequirement({ isCurrent, outputChannelCount });
        if (this._disposed || !isCurrent() || requirement.key !== key ||
            requirement.outputChannelCount !== outputChannelCount) {
            throw this._offlineError('Distortion Correction settings changed during export preparation.');
        }
        if (requirement.required !== true) {
            return { parameters, assets: new Map(), offlineDspAssetRequired: false };
        }
        return {
            parameters,
            assets: new Map([[0, this._assetDescriptor(requirement.payload, requirement.processingChannels,
                requirement.signature)]]),
            offlineDspAssetRequired: true
        };
    }

    // ---- Pipeline position and overload telemetry ---------------------------

    onPipelinePositionChanged({ followedByAudioEffect } = {}) {
        const followed = followedByAudioEffect === true;
        if (followed === this._followedByAudioEffect) return;
        this._followedByAudioEffect = followed;
        this._renderBody();
        this._renderStatus();
    }

    _setupMessageHandler() {
        super._setupMessageHandler();
        this.ensureDspTelemetrySubscription?.();
    }

    // The base constructor can subscribe before this class's fields exist, so the
    // telemetry fields are created lazily and never reset in the constructor.
    ensureDspTelemetrySubscription() {
        const hub = window.dspTelemetryHub;
        const tapId = this.id;
        const validTapId = Number.isInteger(tapId) && tapId >= 0 && tapId <= 0xffffffff;
        if (!validTapId || !hub || typeof hub.subscribe !== 'function') {
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
        this._boundOverloadTelemetry ??= frame => this.handleOverloadTelemetry(frame);
        try {
            const unsubscribe = hub.subscribe(tapId, SDC_TAP_OVERLOAD, this._boundOverloadTelemetry);
            if (typeof unsubscribe !== 'function') {
                hub.unsubscribe?.(tapId, SDC_TAP_OVERLOAD, this._boundOverloadTelemetry);
                return false;
            }
            this._dspTelemetryHub = hub;
            this._dspTelemetryTapId = tapId;
            this._dspTelemetryUnsubscribe = unsubscribe;
            this._unknownTelemetryWarned = false;
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

    handleOverloadTelemetry(frame) {
        const payload = frame?.payload;
        if (frame?.frameType !== SDC_TAP_OVERLOAD || frame.formatVersion !== SDC_TELEMETRY_VERSION ||
            typeof payload?.getFloat32 !== 'function' || payload.byteLength !== 4) {
            if (!this._unknownTelemetryWarned) {
                this._unknownTelemetryWarned = true;
                console.warn('Distortion Correction ignored an unknown telemetry frame:',
                    frame?.frameType, frame?.formatVersion);
            }
            return;
        }
        if (!(payload.getFloat32(0, true) > 1)) return;
        if (this._overloadTimer !== null) clearTimeout(this._overloadTimer);
        this._overloadTimer = setTimeout(() => {
            this._overloadTimer = null;
            this._overloaded = false;
            this._renderStatus();
        }, SDC_OVERLOAD_HOLD_MS);
        if (!this._overloaded) {
            this._overloaded = true;
            this._renderStatus();
        }
    }

    onMessage(message) {
        this.ensureDspTelemetrySubscription();
        super.onMessage(message);
        if (this._disposed || message?.type !== 'dspExecutionState' || message.pluginId !== this.id ||
            message.validated !== true) return;
        this._bypassReason = message.state === 'bypassed' ? message.reason || null : null;
        this._renderStatus();
    }

    // ---- Derived state ----------------------------------------------------------

    _length() {
        return SDC_LENGTH_KEYS[this.fl];
    }

    /** 'empty', 'missing', 'rate', 'preparing' or 'ready'. */
    _state() {
        if (!this.ms) return 'empty';
        if (this._modelState === 'missing' || this._invalid) return 'missing';
        if (this._getEngineSampleRate() < SDC_MIN_RATE) return 'rate';
        if (this._modelState !== 'found' || this._candidateAssetRevision !== null) return 'preparing';
        return 'ready';
    }

    _channelInfos(length = this._length()) {
        const output = this._outputChannelCount;
        const selection = speakerCorrectionSelection(this.channel, output);
        return (this._model?.channels ?? []).map(entry => {
            const inOutput = entry.index >= selection.first && entry.index < selection.first + selection.count;
            const position = speakerCorrectionPosition(entry.index, this.cn, this.co);
            const modelOn = entry.on?.[length] === true;
            const { even: corrected, c, odd } =
                speakerCorrectionPlay(entry, length, this, inOutput ? output : 0, this._runtime.oddDecision);
            const oddPosition = speakerCorrectionPosition(entry.index, this.cn3, this.co3);
            const oddAuto = odd.plays && oddPosition === 'on' &&
                this._runtime.oddDecision(entry, c, 'auto').plays;
            return {
                entry,
                label: speakerCorrectionLabel(entry.index, entry.label),
                inOutput,
                fit: speakerCorrectionHasFit(entry, length),
                position,
                modelOn,
                // `corrected`: the even block plays; `playing`: the even or the odd block plays.
                corrected,
                forced: corrected && position === 'on' && !modelOn,
                c,
                odd,
                oddFit: entry.odd?.weights != null,
                oddPosition,
                oddForced: odd.plays && oddPosition === 'on' && !oddAuto,
                playing: corrected || odd.plays
            };
        });
    }

    /**
     * Rows of the Channels tab and the table: the measured `infos` plus an unmeasured placeholder
     * for each channel of the output selection the measurement lacks, in channel order.
     */
    _displayInfos(infos = this._channelInfos()) {
        const selection = speakerCorrectionSelection(this.channel, this._outputChannelCount);
        const rows = [...infos];
        for (let index = selection.first; index < selection.first + selection.count; index++) {
            if (infos.some(info => info.entry.index === index)) continue;
            rows.push({ entry: { index }, label: speakerCorrectionLabel(index), inOutput: true, unmeasured: true });
        }
        return rows.sort((a, b) => a.entry.index - b.entry.index);
    }

    /** Measured figures of what plays on a channel, or null. */
    _playedCheck(info) {
        return this._runtime.playedCheckFig(info.entry, info.corrected ? this._length() : null, info.odd.plays);
    }

    /** True when the odd block plays on any channel (adds its cost). */
    _oddPlays() {
        return this._channelInfos().some(info => info.odd.plays);
    }

    /**
     * Channels Check again records: those with a block playing, plus those whose odd block
     * waits for a check in Auto. `configurations` gives each channel's configuration c.
     */
    _checkAgainChannels() {
        const infos = this._channelInfos().filter(info => info.playing || info.odd.reason === 'notChecked');
        return {
            channels: infos.map(info => info.entry.index),
            oddChannels: infos.filter(info => info.odd.plays || info.odd.reason === 'notChecked')
                .map(info => info.entry.index),
            configurations: infos.map(info => info.c)
        };
    }

    /** Record set (L, L-6 or L-12) that matches the set Signal Level. */
    _recordSet() {
        if (this.dv > -3) return 'L';
        return this.dv > -9 ? 'L-6' : 'L-12';
    }

    _scaleFor(info) {
        if (!info.corrected) return this._runtime.SCALE_MEASURED;
        return this.md === 'Add' ? this._runtime.SCALE_ADD : this._runtime.SCALE_REDUCE;
    }

    /** True when the Total and Even-order figures are the measured ones. */
    _isMeasured(info) {
        const check = this._playedCheck(info);
        const outcome = this._model.lastCheck?.outcome;
        return info.playing && this.md === 'Reduce' && check != null && check.dv === this.dv &&
            (!this._model.lastCheck || outcome === 'same' || outcome === 'lower');
    }

    _evenChange(info) {
        const length = this._length();
        if (this._isMeasured(info)) {
            const index = this._runtime.CLASSES.findIndex(item => item.key === 'even8k');
            const value = this._playedCheck(info).fig[index];
            return Number.isFinite(value) ? value : null;
        }
        return this._runtime.classFigure(info.entry, length, this._recordSet(), 'even8k', this._scaleFor(info));
    }

    _defaultGraphChannel(infos) {
        return (infos.find(info => info.corrected) ?? infos.find(info => info.fit) ?? infos[0])?.entry.index ?? null;
    }

    _graphInfo(infos) {
        const chosen = infos.find(info => info.entry.index === this._graphChannel);
        if (chosen) return chosen;
        const index = this._defaultGraphChannel(infos);
        return infos.find(info => info.entry.index === index) ?? null;
    }

    // ---- Texts ------------------------------------------------------------------

    _lengthName(length) {
        return length === 'long' ? 'Long' : 'Short';
    }

    /** Why the measurement left the even-order correction of a channel off. */
    _reasonText(entry, length) {
        const reason = entry.reason?.[length];
        const worst = entry.worst?.[length]?.class;
        const band = {
            c1: 'below 100 Hz',
            c2: 'between 100 and 400 Hz',
            c3: 'between 400 Hz and 2 kHz',
            // Single tones are judged by fundamental, so their widest class is everything above 2 kHz.
            even8k: reason === 'worseForSingleTones' ? 'above 2 kHz' : 'between 50 Hz and 8 kHz'
        }[worst] ?? '';
        const texts = {
            belowLimit: () => 'The distortion this correction removes was too small to measure.',
            noFit: () => 'The measurement could not be analyzed.',
            littleGain: () => 'The correction check measured only a slight reduction.',
            worseInCheck: () => (worst === 'total'
                ? 'The correction check measured more overall distortion.'
                : fillText('The correction check measured more distortion {band}.', { band })),
            worseForSingleTones: () => fillText('The correction would add distortion to single tones {band}.', { band }),
            worseAtLowerVolume: () => 'The correction would add distortion at lower volume.',
            worseAtLoudPeaks: () => 'The correction would add distortion on loud peaks.'
        };
        return texts[reason]?.() ?? '';
    }

    _tooSmall() {
        return 'too small to measure';
    }

    /** A dB change, marked `worse` above +0.05 dB in Reduce. */
    _changeNode(value) {
        const span = document.createElement('span');
        span.textContent = this._runtime.formatDb(value, this._tooSmall());
        if (this.md === 'Reduce' && value !== null && value > 0.05) span.className = 'worse';
        return span;
    }

    /** State of a channel's even-order row, with the reason as its tooltip. */
    _channelState(info) {
        if (info.unmeasured) return { state: 'Not measured', title: 'This channel is not in the selected measurement.' };
        const reasonText = this._reasonText(info.entry, this._length());
        const add = this.md === 'Add';
        if (!info.inOutput) return { state: 'Not used', title: 'This channel is not in the current output.' };
        if (!info.fit) return { state: 'Off', title: reasonText };
        if (info.forced) return { state: add ? 'Adding (by you)' : 'On (by you)', title: reasonText };
        if (info.corrected) return { state: add ? 'Adding' : 'Corrected', title: '' };
        if (info.position === 'off' && info.modelOn) return { state: 'Off (by you)', title: '' };
        return { state: 'Off', title: reasonText };
    }

    /** State of a channel's odd-order row, with the reason as its tooltip. */
    _oddState(info) {
        if (!info.inOutput || info.unmeasured) return { state: '', title: '' };
        const { plays, reason } = info.odd;
        if (plays) {
            if (info.oddForced) {
                return { state: 'On (by you)', title: 'Distortion can be higher at high volume, and peaks rise.' };
            }
            const value = info.entry.odd.checkFig[info.c]?.odd[3] ?? null;
            return {
                state: fillText('Corrected · {change}', { change: this._runtime.formatDb(value, '—') }),
                title: 'Change in odd-order distortion, measured by the correction check.'
            };
        }
        if (reason === 'off') return { state: 'Off (by you)', title: '' };
        // Without an odd fit, or when its fit rule failed, `reason` is the fit reason.
        if (!info.oddFit || info.entry.odd.fitReason) {
            return {
                state: 'Off',
                title: {
                    belowLimit: 'Odd-order distortion was too small to measure.',
                    noFit: 'The measurement could not be analyzed.',
                    littleGain: 'Expected to reduce odd-order distortion by less than 1 dB.',
                    worseInCheck: 'Expected to raise odd-order distortion in part of the range.',
                    worseForSingleTones: 'Expected to raise odd-order distortion for single tones.',
                    worseAtLowerVolume: 'Expected to raise odd-order distortion at lower volume.'
                }[reason]
            };
        }
        const title = {
            littleGain: 'The correction check measured less than 1 dB reduction.',
            worseWhenLoud: 'The correction check measured more distortion at high volume.',
            worseOverall: 'Total distortion would not be lower.'
        }[reason];
        return title
            ? { state: 'Off', title }
            : { state: 'Off (not checked)', title: 'Check again on the Measurement tab lets Auto decide.' };
    }

    /** Room EQ's latency details: the added delay (none without a length) and the processing state. */
    _delayText(length) {
        const rate = this._getEngineSampleRate();
        const samples = length ? Math.round(speakerCorrectionTiming(rate, length).latencySamples) : 0;
        return fillText('{samples} samples / {ms} ms · {asset}', {
            samples,
            ms: (samples / rate * 1000).toFixed(1),
            asset: ['bypass', 'staged', 'preparing', 'active', 'error'][this._assetState] || 'bypass'
        });
    }

    _openMeasurement(request) {
        if (typeof window.openSpeakerDistortionMeasurement === 'function') {
            // The page change rebuilds this effect from its saved settings, so the request time
            // travels with them.
            if (!this.ms) this.mr = Date.now();
            window.openSpeakerDistortionMeasurement(request);
        } else {
            console.warn('Distortion Correction cannot open Acoustic Measurement here.');
        }
    }

    // ---- UI -------------------------------------------------------------------

    createUI() {
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
        this._graphReadout?.clear();
        this._hoveredLegend = null;
        this._restoreLegendHover = null;
        const instanceId = `sdc-tabs-${this.id}`;
        // Room EQ's layout: the tabbed settings panel, then the graph, then the status line.
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui speaker-distortion-correction-ui';
        const panel = document.createElement('div');
        panel.className = 'room-eq-panel';
        const tabList = document.createElement('div');
        tabList.className = 'room-eq-tabs';
        tabList.setAttribute('role', 'tablist');
        const contents = document.createElement('div');
        contents.className = 'room-eq-tab-contents';
        const tabs = {};
        const definitions = [
            ['measurement', 'Measurement', content => this._createMeasurementTab(content)],
            ['correction', 'Correction', content => this._createCorrectionTab(content)],
            ['channels', 'Channels', () => {}]
        ];
        for (const [id, label, create] of definitions) {
            const button = document.createElement('button');
            const content = document.createElement('div');
            button.type = 'button';
            button.id = `${instanceId}-${id}-tab`;
            button.className = 'room-eq-tab';
            button.setAttribute('data-parameter-control', 'view');
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-controls', `${instanceId}-${id}-panel`);
            button.textContent = label;
            button.addEventListener('click', () => this._selectTab(id));
            content.id = `${instanceId}-${id}-panel`;
            content.className = 'room-eq-tab-content plugin-parameter-ui';
            content.setAttribute('role', 'tabpanel');
            content.setAttribute('aria-labelledby', button.id);
            create(content);
            tabs[id] = { button, content };
            tabList.appendChild(button);
            contents.appendChild(content);
        }
        this._ui = { ...this._ui, tabs, channels: tabs.channels.content };
        panel.append(tabList, contents);
        container.append(panel, this._createBody(), this._createStatusLine());
        this._selectTab(this._selectedTab);
        this._render({ structure: true });
        this._refresh();
        return container;
    }

    _selectTab(id) {
        this._selectedTab = id;
        for (const [tabId, { button, content }] of Object.entries(this._ui?.tabs ?? {})) {
            const selected = tabId === id;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-selected', selected ? 'true' : 'false');
            content.classList.toggle('active', selected);
            content.hidden = !selected;
        }
    }

    _createMeasurementTab(content) {
        const row = document.createElement('div');
        row.className = 'parameter-row room-eq-measurement-row local-audio-only';
        const label = document.createElement('label');
        const select = document.createElement('select');
        select.id = `sdc-measurement-${this.id}`;
        label.htmlFor = select.id;
        label.textContent = `${'Measurement'}:`;
        select.addEventListener('change', () => {
            if (!select.value) {
                this.setParameters({ ms: '', mn: '', mr: 0 });
                return;
            }
            const record = this._records.find(item => item.id === select.value);
            if (record) this.setParameters(this._selectionParameters(record));
        });
        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.className = 'room-eq-refresh';
        refresh.textContent = 'Refresh measurements';
        refresh.addEventListener('click', () => this._refresh());
        row.append(label, select, refresh);

        const facts = document.createElement('div');
        facts.className = 'sdc-facts';

        const volume = document.createElement('div');
        volume.className = 'sdc-volume';
        const control = this.createParameterControl(
            'Amplifier Volume Change (dB)',
            -24, 0, 0.5, this.dv, value => this.setParameters({ dv: value }), '', 'dv');
        const checkAgain = document.createElement('button');
        checkAgain.type = 'button';
        checkAgain.className = 'sdc-check-again local-audio-only';
        checkAgain.textContent = 'Check again';
        checkAgain.addEventListener('click', () => {
            this._openMeasurement({
                view: 'checkAgain', measurementId: this.ms, ...this._checkAgainChannels(), length: this._length(),
                dv: this.dv
            });
        });
        control.appendChild(checkAgain);
        volume.appendChild(control);

        content.append(row, facts, volume);
        this._ui = { ...this._ui, select, facts, volume, checkAgain };
    }

    _createCorrectionTab(content) {
        const lengthRow = document.createElement('div');
        lengthRow.className = 'parameter-row';
        const lengthLabel = document.createElement('label');
        const lengthSelect = document.createElement('select');
        lengthSelect.id = `sdc-filter-length-${this.id}`;
        lengthLabel.htmlFor = lengthSelect.id;
        lengthLabel.textContent = `${'Filter Length'}:`;
        for (const value of ['Short', 'Long']) {
            const option = document.createElement('option');
            option.value = value;
            lengthSelect.appendChild(option);
        }
        lengthSelect.addEventListener('change', () => this.setParameters({ fl: lengthSelect.value }));
        lengthRow.append(lengthLabel, lengthSelect);

        const modeControl = this.createSelectControl('Mode', [
            { value: 'Reduce', label: 'Reduce' },
            { value: 'Add', label: 'Add' }
        ], this.md, value => this.setParameters({ md: value }), 'md');

        content.append(lengthRow, modeControl);
        this._ui = { ...this._ui, lengthSelect };
    }

    _createBody() {
        const body = document.createElement('div');
        body.className = 'sdc-body';

        const viewRow = this.createRadioGroup('Graph', [
            { value: 'asSet', label: 'As set' },
            { value: 'allLevels', label: 'All measured levels' }
        ], this._view, value => {
            this._view = value;
            this._renderBody();
        });
        viewRow.setAttribute('role', 'radiogroup');
        viewRow.setAttribute('aria-label', 'Distortion graph');
        const channelRow = this.createSelectControl('Graph Ch', [], '', value => {
            this._graphChannel = Number(value);
            this._renderBody();
        });
        const channelSelect = channelRow.querySelector('select');
        const oddRow = this.createCheckboxControl('Show Odd-order',this._showOdd, checked => {
            this._showOdd = checked;
            this._renderBody();
        });

        // A full-canvas graph like Tilt EQ's: the chart draws its tick values and axis titles over the plot.
        const graph = document.createElement('div');
        graph.className = 'sdc-graph';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        graph.appendChild(svg);
        const ResizeObserverClass = globalThis.ResizeObserver;
        if (typeof ResizeObserverClass === 'function') {
            let size = '';
            this._resizeObserver = new ResizeObserverClass(() => {
                const next = `${Math.round(svg.clientWidth)}x${Math.round(svg.clientHeight)}`;
                if (svg.clientWidth > 0 && next !== size) {
                    size = next;
                    this._drawGraph();
                }
            });
            this._resizeObserver.observe(graph);
        }
        this._graphReadout = window.GraphReadout?.attach({
            mount: graph,
            surface: svg,
            read: x => this._readGraph(x),
            onLegendHover: index => this._hoverLegend(index)
        });

        const table = document.createElement('table');
        table.className = 'figs';

        body.append(viewRow, channelRow, oddRow, graph, table);
        this._ui = { ...this._ui, body, channelSelect, graph, svg, table };
        return body;
    }

    /** Room EQ's status line: the state on the left, the added delay in the latency field. */
    _createStatusLine() {
        const line = document.createElement('div');
        line.className = 'room-eq-status-line local-audio-only';
        const status = document.createElement('div');
        status.className = 'room-eq-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        const latency = document.createElement('div');
        latency.className = 'room-eq-latency';
        line.append(status, latency);
        this._ui = { ...this._ui, status, latency };
        return line;
    }

    /**
     * Refreshes the UI. A structural change rebuilds the select options and facts;
     * a `dv` change alone never rebuilds the slider the user may be dragging.
     */
    _render({ structure = false } = {}) {
        if (!this._ui?.status || this._disposed) return;
        const state = this._state();
        if ((state === 'empty' || state === 'missing') && this._selectedTab !== 'measurement') {
            this._selectTab('measurement');
        }
        if (structure || this._renderedStructure !== this._structureKey()) {
            this._renderedStructure = this._structureKey();
            this._renderMeasurementTab();
            this._renderCorrectionTab();
        }
        this._ui.checkAgain.disabled = this.hasLocalAudio === false || !this._checkAgainChannels().channels.length;
        this._renderChannelsTab();
        this._renderBody();
        this._renderStatus();
    }

    _renderMeasurementTab() {
        const { select, facts, volume } = this._ui;
        select.replaceChildren(optionElement('None', ''));
        for (const record of this._records) {
            select.appendChild(optionElement(this._runtime.measurementTitle(record, SDC_UI_LANGUAGE, 'Untitled'), record.id));
        }
        if (this.ms && !this._records.some(record => record.id === this.ms)) {
            const option = optionElement(fillText('{name} (not available)',
                { name: this.mn || 'Untitled' }), this.ms);
            option.disabled = true;
            select.appendChild(option);
        }
        select.value = this.ms;

        facts.replaceChildren();
        const model = this._model;
        const state = this._state();
        if (state === 'empty') {
            // The call to action while no measurement is chosen.
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'sdc-measure local-audio-only';
            button.textContent = 'Measure speaker distortion';
            button.addEventListener('click', () => this._openMeasurement({ view: 'speakerDistortionSetup' }));
            facts.append(textLine('No distortion measurement yet.'), button);
        } else if (state === 'missing') {
            facts.appendChild(textLine('This measurement is not on this device.'));
        } else if (model) {
            facts.appendChild(textLine(this._facts(model)));
        }
        volume.hidden = !model || state === 'missing';
    }

    /** One line: when and how the measurement was made, and its last correction check. */
    _facts(model) {
        const runtime = this._runtime;
        const length = this._length();
        const check = model.lastCheck;
        const when = check ? runtime.formatMeasuredAt(check.at, SDC_UI_LANGUAGE) : '';
        let checked;
        if (model.channels.some(entry => entry.weights?.[length] != null && entry.checkFig?.[length] == null)) {
            checked = 'Not checked since the Upper Limit changed';
        } else if (!check) {
            checked = 'Checked with the measurement';
        } else {
            checked = fillText({
                same: 'Checked again {when}',
                lower: 'Checked again {when}: amplifier lower',
                louder: 'Checked again {when}: amplifier louder'
            }[check.outcome] ?? 'Checked again {when}: amplifier change unknown', { when });
        }
        return [
            fillText('Measured {date}', { date: runtime.formatMeasuredAt(model.measuredAt, SDC_UI_LANGUAGE) }),
            fillText('Signal Level {level} dBFS', { level: runtime.formatDbfs(model.levelDbfs) }),
            fillText('Upper Limit {hi} Hz', { hi: Math.round(model.upperLimitHz) }),
            checked
        ].join(' · ');
    }

    _renderCorrectionTab() {
        const { lengthSelect } = this._ui;
        const recommended = this._model?.recommendedLength;
        for (const option of lengthSelect.options) {
            const length = SDC_LENGTH_KEYS[option.value];
            const name = this._lengthName(length);
            option.textContent = length === recommended
                ? fillText('{length} (recommended)', { length: name })
                : name;
        }
        lengthSelect.value = this.fl;
        const rate = this._getEngineSampleRate();
        lengthSelect.title = fillText('Short: delay {short} ms · Long: delay {long} ms, about {percent} % more processing', {
            short: (speakerCorrectionTiming(rate, 'short').latencySamples / rate * 1000).toFixed(2),
            long: (speakerCorrectionTiming(rate, 'long').latencySamples / rate * 1000).toFixed(2),
            percent: speakerCorrectionLongPercent(rate, this._oddPlays())
        });
    }

    _renderChannelsTab() {
        const container = this._ui.channels;
        const focusedId = container.contains(document.activeElement) ? document.activeElement.id : '';
        container.replaceChildren();
        const state = this._state();
        if (!this._model || state === 'empty' || state === 'missing') {
            container.appendChild(textLine('No measurement loaded.'));
            return;
        }
        const options = [
            { value: 'auto', label: 'Auto' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' }
        ];
        // One Auto/On/Off radio row; the state it leads to follows the options.
        const row = (label, position, usable, state, setPosition) => {
            const element = this.createRadioGroup(label, options, usable ? position : 'auto', setPosition);
            for (const radio of element.querySelectorAll('input')) {
                radio.disabled = !usable && radio.value !== 'auto';
            }
            const text = document.createElement('span');
            text.textContent = state.state;
            if (state.title) text.title = state.title;
            if (state.change) text.append(' · ', state.change);
            element.querySelector('.radio-options').appendChild(text);
            return element;
        };
        for (const info of this._displayInfos()) {
            const index = info.entry.index;
            const even = this._channelState(info);
            if (info.corrected) {
                even.change = this._changeNode(this._evenChange(info));
                even.change.title = 'Change in even-order distortion, 50 Hz–8 kHz';
            }
            // An unmeasured channel's rows only show that it is not corrected; they change nothing.
            const setter = (onKey, offKey) => (info.unmeasured
                ? () => {}
                : position => this._setPosition(index, position, onKey, offKey));
            container.append(
                row(`${info.label} Even-order`, info.position, info.fit && info.inOutput, even, setter('cn', 'co')),
                row(`${info.label} Odd-order`, info.oddPosition, info.oddFit && info.inOutput, this._oddState(info),
                    setter('cn3', 'co3')));
        }
        // The rebuilt radios keep their ids, so keyboard focus stays on the chosen option.
        if (focusedId) [...container.querySelectorAll('input')].find(radio => radio.id === focusedId)?.focus();
    }

    /** Sets channel `index` to `position` in the On mask `onKey` and the Off mask `offKey`. */
    _setPosition(index, position, onKey, offKey) {
        const bit = 1 << index;
        this._graphChannel = index;
        this.setParameters({
            [onKey]: position === 'on' ? this[onKey] | bit : this[onKey] & ~bit,
            [offKey]: position === 'off' ? this[offKey] | bit : this[offKey] & ~bit
        });
        this._renderBody();
    }

    _renderBody() {
        if (!this._ui?.body || this._disposed) return;
        const { body, channelSelect } = this._ui;
        const state = this._state();
        body.hidden = !this._model || (state !== 'ready' && state !== 'preparing');
        if (body.hidden) return;

        const infos = this._channelInfos();
        const graphInfo = this._graphInfo(infos);
        channelSelect.replaceChildren(...infos.map(info => optionElement(info.label, String(info.entry.index))));
        channelSelect.value = String(graphInfo?.entry.index ?? '');
        this._drawGraph();
        this._renderTable(this._displayInfos(infos));
    }

    _chartTexts() {
        return {
            setNames: {
                L: 'At the set Signal Level',
                'L-6': 'At 6 dB lower Signal Level',
                'L-12': 'At 12 dB lower Signal Level',
                peaks: 'Loud peaks'
            },
            legendMeasured: '{set}: without the correction',
            legendPredicted: '{set}: with the correction (predicted)',
            legendWould: 'What the correction would do (not used)',
            legendOddOverlay: 'Odd-order (without correction)',
            legendLimit: 'Below the noise floor',
            upperLimitLabel: 'Upper Limit',
            noteAllBelowWith: 'With the correction, the distortion is below the noise floor in every band.',
            noteAllBelow: 'All values are below the noise floor.',
            xTitle: 'Frequency (Hz)',
            yTitle: 'Multitone Distortion (dB)'
        };
    }

    _drawGraph() {
        const ui = this._ui;
        if (!ui?.svg || ui.body.hidden || !this._model || !this._runtime) return;
        const info = this._graphInfo(this._channelInfos());
        if (!info) return;
        const runtime = this._runtime;
        const set = this._recordSet();
        const modeScale = this.md === 'Add' ? runtime.SCALE_ADD : runtime.SCALE_REDUCE;
        this._chart = runtime.drawDistortionChart(ui.svg, {
            bands: this._model.bands,
            resolution: 'third',
            channel: info.entry,
            length: this._length(),
            parity: 'even',
            sets: this._view === 'allLevels' ? [...runtime.SETS] : [set],
            emph: set,
            scale: info.corrected ? modeScale : null,
            wouldScale: info.fit && info.inOutput && !info.corrected ? modeScale : null,
            showOdd: this._showOdd,
            upperLimitHz: this._model.upperLimitHz,
            compare: null,
            inset: true,
            // The largest graph's size stands in until the graph is laid out.
            width: Math.round(ui.svg.clientWidth) || 1024,
            height: Math.round(ui.svg.clientHeight) || 480,
            texts: this._chartTexts()
        });
        // The redraw replaced the curves, so a hovered legend entry is emphasized again.
        this._restoreLegendHover = runtime.emphasizeChartLegend(ui.svg, this._chart, this._hoveredLegend);
        this._graphReadout?.setLegend(this._chart && runtime.chartReadoutLegend(this._chart));
        this._graphReadout?.refresh();
    }

    /** Room EQ's legend hover: the hovered entry's curves are drawn thick and on top. */
    _hoverLegend(index) {
        this._restoreLegendHover?.();
        this._hoveredLegend = index === null ? null : this._chart?.legend[index]?.text ?? null;
        this._restoreLegendHover = this._runtime?.emphasizeChartLegend(this._ui?.svg, this._chart, this._hoveredLegend);
    }

    /** Readout at chart x: each legend entry's value in dB, a dash where its curve has a gap. */
    _readGraph(x) {
        if (!this._chart || this._ui?.body.hidden) return null;
        return this._runtime.readChartAt(this._chart, x);
    }

    /** Graph x in percent of the plot width for frequency `f` (the FrequencyAxis contract). */
    freqToX(f) {
        return Math.log(f / 20) / Math.log(10000 / 20) * 100;
    }

    _renderTable(infos) {
        const runtime = this._runtime;
        const length = this._length();
        const set = this._recordSet();
        const reduce = this.md === 'Reduce';
        const headers = [
            'Channel',
            'State',
            'Total distortion',
            'Even-order distortion',
            'Loud peaks',
            'If volume is off by 3 dB'
        ];
        const tooSmall = this._tooSmall();
        const pairCell = (cell, before, after, measured) => {
            if (before === null || after === null) {
                cell.textContent = tooSmall;
                return;
            }
            const part = (className, text) => {
                const span = document.createElement('span');
                span.className = className;
                span.textContent = text;
                return span;
            };
            // One line per unit, so before and after compare side by side in the same unit.
            const line = (unit, open = '', close = '') => part('sdc-level',
                `${open}${runtime.formatLevel(before, unit)} → ${runtime.formatLevel(after, unit)}${close}`);
            const pair = document.createElement('span');
            pair.append(line('{db} dB'), line('{pct} %', '(', ')'), part('sdc-tag', measured ? 'measured' : 'predicted'));
            cell.append(pair);
        };
        const markWorse = (cell, ...values) => {
            if (reduce && values.some(value => value !== null && value > 0.05)) cell.classList.add('worse');
        };

        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const text of headers) {
            const th = document.createElement('th');
            th.textContent = text;
            headRow.appendChild(th);
        }
        head.appendChild(headRow);
        const body = document.createElement('tbody');
        for (const info of infos) {
            const row = document.createElement('tr');
            const cells = headers.map(label => {
                const td = document.createElement('td');
                td.dataset.l = label;
                row.appendChild(td);
                return td;
            });
            const channelState = this._channelState(info);
            cells[0].textContent = info.label;
            cells[1].textContent = channelState.state;
            if (channelState.title) cells[1].title = channelState.title;
            if (!info.corrected) {
                for (const cell of cells.slice(2)) cell.textContent = '—';
            } else {
                const scale = this._scaleFor(info);
                const entry = info.entry;
                if (this._isMeasured(info)) {
                    const level = this._playedCheck(info).level;
                    pairCell(cells[2], level[0], level[1], true);
                    pairCell(cells[3], level[2], level[3], true);
                } else {
                    const before = runtime.levelFigure(entry, length, set, runtime.SCALE_MEASURED);
                    const after = runtime.levelFigure(entry, length, set, scale);
                    pairCell(cells[2], before.total, after.total, false);
                    pairCell(cells[3], before.even, after.even, false);
                }
                const peaks = runtime.classFigure(entry, length, 'peaks', 'even8k', scale);
                cells[4].textContent = runtime.formatDb(peaks, tooSmall);
                markWorse(cells[4], peaks);
                if (reduce) {
                    const scaleIndex = key => runtime.SCALES.findIndex(item => item.key === key);
                    const quieter = runtime.classFigure(entry, length, set, 'even8k', scaleIndex('reduceQuieter3'));
                    const louder = runtime.classFigure(entry, length, set, 'even8k', scaleIndex('reduceLouder3'));
                    cells[5].textContent = runtime.formatDbRange(quieter, louder,
                        '{a} to {b} dB', tooSmall);
                    markWorse(cells[5], quieter, louder);
                } else {
                    cells[5].textContent = '—';
                }
            }
            body.appendChild(row);
        }
        this._ui.table.replaceChildren(head, body);
    }

    /** Room EQ's status line: one status message with its data-state, and the latency details. */
    _renderStatus() {
        const status = this._ui?.status;
        if (!status || this._disposed) return;
        const state = this._state();
        const infos = state === 'ready' ? this._channelInfos() : [];
        const corrected = infos.filter(info => info.playing);
        const [message, tone] = this._statusMessage(state, infos, corrected);
        status.textContent = message;
        status.dataset.state = tone;
        this._ui.latency.textContent = this._delayText(corrected.length ? this._length() : null);
    }

    /** The one message to show, by priority, and its data-state. */
    _statusMessage(state, infos, corrected) {
        const bypass = SDC_BYPASS_MESSAGES[this._bypassReason];
        if (bypass) return [bypass, 'error'];
        const off = {
            empty: ['Select a measurement to begin.', ''],
            missing: ['Measurement not available. The correction is off.', 'warning'],
            rate: ['Off: needs a sample rate of 44.1 kHz or higher.', 'warning'],
            preparing: ['Preparing the correction…', 'preparing']
        }[state];
        if (off) return off;
        if (corrected.length && this._overloaded) return ['Overload: lower the level before this effect.', 'warning'];
        if (this._followedByAudioEffect) return ['Not the last effect: the correction may be wrong.', 'warning'];
        if (this._updated) return ['Updated from the measurement.', 'ready'];
        return [this._summaryText(infos, corrected), this.md === 'Add' && corrected.length ? 'warning' : 'ready'];
    }

    _summaryText(infos, corrected) {
        const length = this._length();
        if (corrected.length) {
            const forced = corrected.filter(info => info.forced);
            const oddForced = corrected.filter(info => info.oddForced);
            const params = {
                channels: this._list(corrected.map(info => info.label)),
                forced: this._list(forced.map(info => info.label)),
                // The translation carries its own leading separator.
                odd: oddForced.length ? fillText(' ({forced} odd-order turned on by you)', {
                    forced: this._list(oddForced.map(info => info.label))
                }) : ''
            };
            if (this.md === 'Add') {
                return forced.length
                    ? fillText('Adding distortion on {channels} (Mode: Add) ({forced} turned on by you){odd}.', params)
                    : fillText('Adding distortion on {channels} (Mode: Add){odd}.', params);
            }
            return forced.length
                ? fillText('Correcting {channels} ({forced} turned on by you){odd}.', params)
                : fillText('Correcting {channels}{odd}.', params);
        }
        const usable = infos.filter(info => info.inOutput && info.fit);
        if (usable.length && usable.every(info => info.position === 'off')) {
            return 'All channels are turned off in this effect.';
        }
        if (this._channelInfos(length === 'long' ? 'short' : 'long').some(info => info.corrected)) {
            return fillText('No channel is corrected with the {length} filter.',
                { length: this._lengthName(length) });
        }
        if (infos.some(info => info.fit)) {
            return 'No channel is corrected.';
        }
        return 'No channel can be corrected with this measurement.';
    }

    cleanup() {
        this._disposed = true;
        this._lookupGeneration++;
        globalThis.document?.removeEventListener?.('visibilitychange', this._visibilityHandler);
        globalThis.window?.removeEventListener?.('focus', this._focusHandler);
        if (this._overloadTimer !== null) clearTimeout(this._overloadTimer);
        this._overloadTimer = null;
        this.disposeDspTelemetrySubscription();
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
        this._graphReadout?.clear();
        this._graphReadout = null;
        this._chart = null;
        this._hoveredLegend = null;
        this._restoreLegendHover = null;
        this._measurementStore?.close?.();
        this._measurementStore = null;
        this._ui = null;
        super.cleanup();
    }
}

window.SpeakerDistortionCorrectionPlugin = SpeakerDistortionCorrectionPlugin;
