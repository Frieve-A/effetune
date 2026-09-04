const CROSSTALK_CANCELLATION_PASS_THROUGH_PROCESSOR = 'return data;';
const CROSSTALK_CANCELLATION_SAMPLE_RATES = Object.freeze([
    44100, 48000, 88200, 96000, 176400, 192000
]);
const CROSSTALK_CANCELLATION_CHANNEL_MODES = Object.freeze(['stereo-pair']);
const CROSSTALK_CANCELLATION_TAPS = Object.freeze([1024, 2048, 4096, 8192, 16384]);
const CROSSTALK_CANCELLATION_LATENCIES = Object.freeze(['0', '128', '256', '512', '1024']);
const CROSSTALK_CANCELLATION_SLOT_KEYS = Object.freeze(['ll', 'lr', 'rl', 'rr']);
const CROSSTALK_CANCELLATION_SLOT_LABELS = Object.freeze({
    ll: 'L Speaker → Left Ear',
    lr: 'L Speaker → Right Ear',
    rl: 'R Speaker → Left Ear',
    rr: 'R Speaker → Right Ear'
});
// One measurement session is a single microphone position swept over the output
// channels, so the two responses that reach the same ear are always two channels
// of one measurement. The UI groups the slots that way and keeps each group on a
// single measurement; assigning across sessions destroys the inter-channel timing
// the design depends on.
const CROSSTALK_CANCELLATION_MEASUREMENT_GROUPS = Object.freeze([
    Object.freeze({ title: 'Left-ear measurement', slots: Object.freeze(['ll', 'rl']) }),
    Object.freeze({ title: 'Right-ear measurement', slots: Object.freeze(['lr', 'rr']) })
]);
const CROSSTALK_CANCELLATION_SLOT_PARTNERS = Object.freeze(Object.fromEntries(
    CROSSTALK_CANCELLATION_MEASUREMENT_GROUPS.flatMap(group => [
        [group.slots[0], group.slots[1]],
        [group.slots[1], group.slots[0]]
    ])
));
// Slots for the left speaker take the lower output channel of their measurement.
const CROSSTALK_CANCELLATION_LEFT_SPEAKER_SLOTS = Object.freeze(['ll', 'lr']);
const CROSSTALK_CANCELLATION_VIRTUAL_CHANNEL_SEPARATOR = '::ch=';
const CROSSTALK_CANCELLATION_DESIGN_DEBOUNCE_MS = 150;
const CROSSTALK_CANCELLATION_MAX_ID_LENGTH = 160;

class CrosstalkCancellationPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({
        requiresWasm: true,
        supportedSampleRates: CROSSTALK_CANCELLATION_SAMPLE_RATES,
        supportedChannelModes: CROSSTALK_CANCELLATION_CHANNEL_MODES
    });

    constructor() {
        super('Crosstalk Cancellation',
            'Cancels stereo-speaker crosstalk using four saved in-ear measurements');
        this.ll = '';
        this.lr = '';
        this.rl = '';
        this.rr = '';
        this.tp = 4096;
        this.rg = 50;
        this.mg = 12;
        this.fl = 200;
        this.fh = 6000;
        this.wl = 8;
        this.st = 70;
        this.og = 0;
        this.lt = '128';
        this.fd = this.tp / 2;
        this.temporalCapability = 'reset-on-resume';
        this.offlineDspAssetErrorMessageKey = 'crosstalkCancellation.error.design';
        this._sampleRate = this._getEngineSampleRate();
        this._runtimePromise = null;
        this._designer = null;
        this._measurementStore = null;
        this._measurementStorePromise = null;
        this._measurementEntries = [];
        this._measurementsLoaded = false;
        this._measurementSelects = new Map();
        this._designTimer = null;
        this._designGeneration = 0;
        this._designPending = false;
        this._designStaged = false;
        this._candidateAssetRevision = null;
        this._effectiveAssetRevision = null;
        this._lastDesign = null;
        this._assetState = 0;
        this._disposed = false;
        this._statusMessage = 'Assign all four measurements to begin.';
        this._statusState = '';
        this._statusElement = null;
        this._detailsElement = null;
        this.executionState = { state: 'pending', reason: null };
        this._visibilityHandler = () => {
            if (!this._disposed && globalThis.document?.visibilityState === 'visible') {
                this._refreshMeasurements(true);
            }
        };
        globalThis.document?.addEventListener?.('visibilitychange', this._visibilityHandler);
        this.registerProcessor(CROSSTALK_CANCELLATION_PASS_THROUGH_PROCESSOR);
    }

    getTemporalCapability() {
        return 'reset-on-resume';
    }

    process(_context, data) {
        return data;
    }

    _getEngineSampleRate() {
        const app = globalThis.window || globalThis;
        const value = this._sampleRate || app.workletNode?.context?.sampleRate ||
            app.audioContext?.sampleRate || app.uiManager?.audioManager?.audioContext?.sampleRate;
        return Number.isFinite(value) && value > 0 ? value : 48000;
    }

    _runtimeParameters() {
        return {
            ...super.getParameters(),
            lt: this.lt,
            fd: this.tp / 2,
            st: this.st,
            og: this.og
        };
    }

    getParameters(options = {}) {
        const sampleRate = Number.isFinite(options.sampleRate) && options.sampleRate > 0
            ? options.sampleRate
            : this._sampleRate;
        if (options.commitSampleRate && sampleRate !== this._sampleRate) {
            this._sampleRate = sampleRate;
            this._scheduleDesign(0);
        }
        this.fd = this.tp / 2;
        return {
            ...this._runtimeParameters(),
            ll: this.ll,
            lr: this.lr,
            rl: this.rl,
            rr: this.rr,
            tp: this.tp,
            rg: this.rg,
            mg: this.mg,
            fl: this.fl,
            fh: this.fh,
            wl: this.wl
        };
    }

    setParameters(params = {}) {
        if (!params || typeof params !== 'object') return;
        const previousDesign = this._designSignature();
        const previousLatency = this.lt;
        super._setValidatedParameters(params);
        for (const key of CROSSTALK_CANCELLATION_SLOT_KEYS) {
            if (typeof params[key] === 'string') {
                this[key] = params[key].slice(0, CROSSTALK_CANCELLATION_MAX_ID_LENGTH);
            }
        }
        const taps = Number(params.tp);
        if (CROSSTALK_CANCELLATION_TAPS.includes(taps)) this.tp = taps;
        if (params.rg !== undefined) this.rg = this.parseFiniteNumber(params.rg, 0, 100, this.rg);
        if (params.mg !== undefined) this.mg = this.parseFiniteNumber(params.mg, 0, 24, this.mg);
        if (params.fl !== undefined) this.fl = this.parseFiniteNumber(params.fl, 20, 2000, this.fl);
        if (params.fh !== undefined) this.fh = this.parseFiniteNumber(params.fh, 1000, 20000, this.fh);
        if (params.wl !== undefined) this.wl = this.parseFiniteNumber(params.wl, 2, 50, this.wl);
        if (params.st !== undefined) this.st = this.parseFiniteNumber(params.st, 0, 100, this.st);
        if (params.og !== undefined) this.og = this.parseFiniteNumber(params.og, -24, 24, this.og);
        if (CROSSTALK_CANCELLATION_LATENCIES.includes(String(params.lt))) {
            this.lt = String(params.lt);
        }
        // fd is derived on every path. Serialized or host-supplied fd values never win over Taps.
        this.fd = this.tp / 2;
        this.updateParameters();
        const nextDesign = this._designSignature();
        if (previousDesign !== nextDesign) this._scheduleDesign(CROSSTALK_CANCELLATION_DESIGN_DEBOUNCE_MS);
        else if (previousLatency !== this.lt && this._lastDesign) this._stageDesign(this._lastDesign);
        this._syncMeasurementSelects();
        this._renderStatus();
    }

    _slotIds() {
        return CROSSTALK_CANCELLATION_SLOT_KEYS.map(key => this[key]);
    }

    _allSlotsAssigned(ids = this._slotIds()) {
        return ids.every(Boolean);
    }

    _designConfig(sampleRate = this._sampleRate) {
        return {
            sampleRate,
            taps: this.tp,
            regularization: this.rg,
            maxGainDb: this.mg,
            lowFrequency: this.fl,
            highFrequency: this.fh,
            directWindowMs: this.wl
        };
    }

    _designSignature(sampleRate = this._sampleRate) {
        return JSON.stringify([this._slotIds(), this._designConfig(sampleRate)]);
    }

    _externalAssetSignature({
        ids = this._slotIds(),
        config = this._designConfig(),
        latency = this.lt
    } = {}) {
        return JSON.stringify([1, ids, config, String(latency)]);
    }

    async _getRuntime() {
        if (!this._runtimePromise) {
            this._runtimePromise = Promise.all([
                import('../../js/measurement-store/client.js'),
                import('../../js/crosstalk-cancellation/designer.js'),
                import('../../js/ir-library/ir-asset-payload.js'),
                import('../../js/ir-library/ir-plugin-contract.js')
            ]).then(([store, designer, payload, contract]) => ({
                ...store,
                ...designer,
                ...payload,
                ...contract
            }));
        }
        return this._runtimePromise;
    }

    async _getMeasurementStore(refresh = false) {
        const runtime = await this._getRuntime();
        if (this._disposed) return null;
        if (!this._measurementStore) {
            // The option list and the filter design both reach here while the other
            // is still opening, so the open has to be shared. Two opens would leave
            // the loser holding a store the plugin no longer caches, and it would
            // then discard its own result as stale: at startup that is the option
            // list, which keeps showing every assignment as "not found".
            if (!this._measurementStorePromise) {
                this._measurementStorePromise = Promise.resolve()
                    .then(() => runtime.openMeasurementStore());
            }
            let opened = null;
            try {
                opened = await this._measurementStorePromise;
            } finally {
                // Caching before the promise is cleared keeps later callers on the
                // one store; a failed or absent open is retried by the next caller.
                if (!this._disposed && !this._measurementStore) this._measurementStore = opened;
                this._measurementStorePromise = null;
            }
            if (this._disposed || this._measurementStore !== opened) {
                await opened?.close?.();
                return this._disposed ? null : this._measurementStore;
            }
        }
        if (refresh) {
            await this._measurementStore?.refresh?.();
            if (this._disposed) return null;
        }
        return this._measurementStore;
    }

    async _sourcesFor(store, ids = this._slotIds(), isCurrent = () => !this._disposed) {
        if (!this._allSlotsAssigned(ids)) return null;
        const sources = {};
        for (let index = 0; index < CROSSTALK_CANCELLATION_SLOT_KEYS.length; index += 1) {
            const key = CROSSTALK_CANCELLATION_SLOT_KEYS[index];
            const id = ids[index];
            const measurement = await store?.getMeasurement(id);
            if (!isCurrent()) return null;
            const impulses = measurement ? await store.getImpulseResponses(id) : [];
            if (!isCurrent()) return null;
            if (!measurement || !Array.isArray(impulses) || impulses.length === 0) return null;
            sources[key] = { id, measurement, impulses };
        }
        return sources;
    }

    _scheduleDesign(delay = CROSSTALK_CANCELLATION_DESIGN_DEBOUNCE_MS) {
        if (this._disposed) return;
        if (this._designTimer !== null) clearTimeout(this._designTimer);
        const generation = ++this._designGeneration;
        this._designPending = true;
        this._designStaged = false;
        this._candidateAssetRevision = null;
        if (!this._allSlotsAssigned()) {
            this._designPending = false;
            this._lastDesign = null;
            this._assetState = 0;
            this.clearWasmAsset(0);
            this._setStatus('Assign all four measurements to begin.', '');
            this._renderStatus();
            return;
        }
        this._setStatus('Designing crosstalk cancellation filters…', 'preparing');
        this._designTimer = setTimeout(() => {
            if (this._disposed || generation !== this._designGeneration) return;
            this._designTimer = null;
            this._designAndStage(generation);
        }, delay);
    }

    _settleMissingMeasurement(generation) {
        if (this._disposed || generation !== this._designGeneration) return false;
        this._designPending = false;
        this._designStaged = false;
        this._candidateAssetRevision = null;
        this._effectiveAssetRevision = null;
        this._lastDesign = null;
        this._assetState = 0;
        this.clearWasmAsset(0);
        this.updateParameters();
        this._setStatus('One or more assigned measurements could not be found. Reselect the measurements.',
            'warning');
        this._renderStatus();
        return false;
    }

    _designErrorMessage(error) {
        const messages = {
            'media-element-time-reference':
                'This measurement used an unsupported output route. Use the default or direct audio output, then measure again.',
            'unknown-output-time-reference':
                'This measurement has no supported output timing reference. Use the default or direct audio output, then measure again.',
            'old-measurement-format':
                'This measurement uses an old format. Please measure again.',
            'multiple-measurement-points':
                'This measurement has multiple points. Assign a single-point measurement.',
            'duplicate-measurement-assignment':
                'Assign a different measurement channel to each slot.',
            'left-ear-session-mismatch':
                'LL and RL must be two different channels of one measurement made with the microphone at your left ear.',
            'right-ear-session-mismatch':
                'LR and RR must be two different channels of one measurement made with the microphone at your right ear.',
            'sample-rate-mismatch':
                'All four measurements must use the same sample rate.',
            'designer-closed':
                'The design engine was reset. Try again; if this keeps happening, remove and re-add the effect.',
            'worker-failed':
                'The design engine failed and was reset. Try again; if this keeps happening, remove and re-add the effect.'
        };
        return messages[error?.code] ||
            'The crosstalk cancellation filters could not be designed. Reselect the measurements or adjust the design settings.';
    }

    async _designAndStage(generation) {
        try {
            if (this._disposed || generation !== this._designGeneration) return false;
            const runtime = await this._getRuntime();
            const store = await this._getMeasurementStore(true);
            if (this._disposed || generation !== this._designGeneration) return false;
            if (!store) return this._settleMissingMeasurement(generation);
            const sources = await this._sourcesFor(
                store, this._slotIds(),
                () => !this._disposed && generation === this._designGeneration
            );
            if (this._disposed || generation !== this._designGeneration) return false;
            if (!sources) return this._settleMissingMeasurement(generation);
            if (!this._designer) {
                const designer = runtime.createCrosstalkCancellationDesigner();
                if (this._disposed || generation !== this._designGeneration) {
                    designer.close();
                    return false;
                }
                this._designer = designer;
            }
            const config = this._designConfig();
            const result = await this._designer.design(config, sources);
            if (this._disposed || generation !== this._designGeneration) return false;
            this.fd = result.config.filterDelaySamples;
            this._lastDesign = result;
            if (!await this._stageDesign(result, generation)) return false;
            this._setStatus('Designing crosstalk cancellation filters…', 'preparing');
            return true;
        } catch (error) {
            if (this._disposed || generation !== this._designGeneration ||
                error?.code === 'design-superseded') return false;
            console.error('Crosstalk Cancellation design failed:', error);
            // The designer worker cannot recover once closed or crashed; drop the
            // cached instance so the next design request creates a fresh worker.
            if (error?.code === 'designer-closed' || error?.code === 'worker-failed' ||
                this._designer?.closed === true) {
                this._designer = null;
            }
            this._designPending = false;
            this._designStaged = false;
            this._candidateAssetRevision = null;
            this._effectiveAssetRevision = null;
            this._lastDesign = null;
            this._assetState = 0;
            this.clearWasmAsset(0);
            this.updateParameters();
            this._setStatus(this._designErrorMessage(error), 'error');
            this._renderStatus();
            return false;
        }
    }

    async _stageDesign(result, generation = this._designGeneration) {
        try {
            if (this._disposed || generation !== this._designGeneration || result !== this._lastDesign) {
                return false;
            }
            const runtime = await this._getRuntime();
            if (this._disposed || generation !== this._designGeneration || result !== this._lastDesign) {
                return false;
            }
            const footprintBytes = runtime.estimateIrKernelCommitFootprint({
                frames: result.config.taps,
                assetChannels: 4,
                topology: runtime.IR_ASSET_TOPOLOGY.trueStereo,
                processingChannels: 2,
                headBlock: Number(this.lt)
            });
            const operationRevision = this.setWasmAsset(0, {
                payload: result.payload,
                formatTag: 1,
                headBlock: Number(this.lt),
                rateDivider: 1,
                pathCount: 0,
                inputCount: 0,
                processingChannels: 2,
                footprintBytes,
                externalAssetSignature: this._externalAssetSignature()
            });
            if (this._disposed || generation !== this._designGeneration) return false;
            this._candidateAssetRevision = operationRevision;
            this._designPending = true;
            this._designStaged = false;
            this._assetState = 1;
            this.updateParameters();
            this._renderStatus();
            return true;
        } catch (error) {
            if (this._disposed || generation !== this._designGeneration) return false;
            console.error('Crosstalk Cancellation asset staging failed:', error);
            this._designPending = false;
            this._designStaged = false;
            this._candidateAssetRevision = null;
            this._setStatus('The crosstalk cancellation filters could not be prepared. Try fewer taps or a higher latency.',
                'error');
            this._renderStatus();
            return false;
        }
    }

    _readyStatus(result = this._lastDesign) {
        const diagnostics = result?.diagnostics || {};
        const gain = Number.isFinite(diagnostics.maxGainDb)
            ? ` Maximum filter gain: ${diagnostics.maxGainDb.toFixed(1)} dB.`
            : '';
        const warnings = [];
        if (diagnostics.tapsWarning) {
            warnings.push('Increase Taps or Regularization; the filter tail may be truncated.');
        }
        if (diagnostics.lowFrequencyClamped) {
            warnings.push(`Direct Window raised the effective low frequency to ${Math.round(
                diagnostics.effectiveLowFrequency)} Hz.`);
        }
        return {
            message: `Crosstalk cancellation filters are ready.${gain}${warnings.length ? ` ${warnings.join(' ')}` : ''}`,
            state: warnings.length ? 'warning' : 'ready'
        };
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
            this._designPending = false;
            this._designStaged = true;
            this._effectiveAssetRevision = operationRevision;
            this._candidateAssetRevision = null;
            const ready = this._readyStatus();
            this._setStatus(ready.message, ready.state);
        } else if (status === 4) {
            this._designPending = false;
            this._designStaged = false;
            this._candidateAssetRevision = null;
            this._effectiveAssetRevision = null;
            this._setStatus('The crosstalk cancellation filters could not be prepared. Try fewer taps or a higher latency.',
                'error');
        }
        this.updateParameters();
        this._renderStatus();
    }

    onWasmAssetRejected(slot, reason, operationRevision) {
        if (this._disposed || slot !== 0 || operationRevision !== this._candidateAssetRevision) return;
        console.warn('Crosstalk Cancellation asset admission rejected:', reason);
        this._designPending = false;
        this._designStaged = false;
        this._candidateAssetRevision = null;
        this._effectiveAssetRevision = null;
        this._assetState = 4;
        this.updateParameters();
        this._setStatus('The crosstalk cancellation filters could not be prepared. Try fewer taps or a higher latency.',
            'error');
        this._renderStatus();
    }

    onMessage(message) {
        if (this._disposed || message?.type !== 'dspExecutionState' || message.pluginId !== this.id ||
            message.pluginType !== this.constructor.name || message.validated !== true) return;
        this.executionState = { state: message.state, reason: message.reason || null };
        this._renderStatusMessage();
    }

    _executionStatusText() {
        if (this.executionState.state !== 'bypassed') return '';
        const messages = {
            unsupportedSampleRate:
                'This sample rate is not supported. Crosstalk Cancellation is bypassed.',
            unsupportedChannelMode:
                'Crosstalk Cancellation requires a stereo channel pair and is bypassed.',
            wasmUnavailable:
                'WASM audio processing is unavailable. Crosstalk Cancellation is bypassed.',
            rolloutDisabled:
                'DSP processing is disabled. Crosstalk Cancellation is bypassed.',
            runtimeFallback:
                'Audio processing was interrupted. Crosstalk Cancellation is bypassed.',
            engineStopped:
                'Audio processing has stopped. Crosstalk Cancellation is bypassed.'
        };
        return messages[this.executionState.reason] ||
            'Crosstalk Cancellation is bypassed. Audio remains unchanged.';
    }

    _setStatus(message, state = '') {
        if (this._disposed) return;
        this._statusMessage = message;
        this._statusState = state;
        this._renderStatusMessage();
    }

    _renderStatusMessage() {
        if (!this._statusElement) return;
        // While execution is bypassed, always show the bypass reason instead of the
        // design-status text, even for a reason this plugin does not recognize yet.
        // Otherwise a stale "filters are ready" message keeps implying the effect is active.
        if (this.executionState.state === 'bypassed') {
            this._statusElement.textContent = this._executionStatusText();
            this._statusElement.dataset.state = 'error';
            return;
        }
        this._statusElement.textContent = this._statusMessage || '';
        this._statusElement.dataset.state = this._statusState;
    }

    _renderStatus() {
        this._renderStatusMessage();
        if (!this._detailsElement) return;
        const hasFilter = Boolean(this._lastDesign);
        const samples = hasFilter ? Number(this.lt) + this.tp / 2 : 0;
        const milliseconds = samples * 1000 / this._sampleRate;
        const assetLabels = ['bypass', 'staged', 'preparing', 'active', 'error'];
        this._detailsElement.textContent =
            `${samples} samples / ${milliseconds.toFixed(1)} ms · ${assetLabels[this._assetState] || 'bypass'}`;
    }

    _measurementOptionLabel(entry) {
        const name = entry?.name || entry?.label || entry?.id || 'Measurement';
        const points = Number(entry?.pointCount);
        return Number.isFinite(points) && points > 1 ? `${name} (${points} points)` : name;
    }

    _baseMeasurementId(id) {
        const text = String(id || '');
        const separator = text.lastIndexOf(CROSSTALK_CANCELLATION_VIRTUAL_CHANNEL_SEPARATOR);
        return separator > 0 ? text.slice(0, separator) : text;
    }

    /**
     * Groups the listed channels by measurement and keeps only the measurements
     * that can fill a whole ear group. A single-channel measurement can never do
     * so, so offering it would only lead to a design error after the fact.
     */
    _assignableChannelGroups() {
        const groups = new Map();
        for (const entry of this._measurementEntries) {
            if (typeof entry?.id !== 'string' || entry.hasIr === false) continue;
            const base = this._baseMeasurementId(entry.id);
            if (base === entry.id) continue;
            if (!groups.has(base)) groups.set(base, []);
            groups.get(base).push(entry);
        }
        for (const [base, entries] of groups) {
            if (entries.length < 2) groups.delete(base);
        }
        return groups;
    }

    /**
     * Keeps the partner slot of an ear group on the measurement just assigned,
     * picking the neighbouring output channel so the left-speaker slot takes the
     * lower channel of the pair. Returns the extra parameters to apply, if any.
     */
    _partnerSlotAssignment(key, value) {
        const partner = CROSSTALK_CANCELLATION_SLOT_PARTNERS[key];
        if (!partner || !value) return null;
        const base = this._baseMeasurementId(value);
        const current = this[partner];
        if (current && current !== value && this._baseMeasurementId(current) === base) return null;
        const entries = this._assignableChannelGroups().get(base);
        if (!entries) return null;
        const index = entries.findIndex(entry => entry.id === value);
        if (index < 0) return null;
        const forward = CROSSTALK_CANCELLATION_LEFT_SPEAKER_SLOTS.includes(key);
        const candidate = (forward ? entries[index + 1] : entries[index - 1]) ||
            entries.find(entry => entry.id !== value);
        return candidate ? { [partner]: candidate.id } : null;
    }

    _renderMeasurementOptions() {
        const groups = this._assignableChannelGroups();
        for (const [key, select] of this._measurementSelects) {
            if (!select) continue;
            const selected = this[key];
            const entries = this._measurementEntries.filter(entry =>
                typeof entry?.id === 'string' && entry.hasIr !== false &&
                groups.has(this._baseMeasurementId(entry.id)));
            select.replaceChildren();
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = 'Select a measurement';
            select.appendChild(empty);
            let found = !selected;
            for (const entry of entries) {
                if (typeof entry?.id !== 'string') continue;
                const option = document.createElement('option');
                option.value = entry.id;
                option.textContent = this._measurementOptionLabel(entry);
                select.appendChild(option);
                if (entry.id === selected) found = true;
            }
            if (selected && !found) {
                // A measurement that exists but was filtered out is unusable, not
                // missing: saying "not found" would send the user looking for it.
                const unusable = this._measurementEntries.find(entry => entry?.id === selected);
                const missing = document.createElement('option');
                missing.value = selected;
                // Before the first list arrives every assignment is absent, so
                // calling it missing would accuse the store of losing measurements
                // that are only still loading.
                missing.textContent = unusable
                    ? `${this._measurementOptionLabel(unusable)} (no usable channel pair)`
                    : (this._measurementsLoaded
                        ? `Measurement not found: ${selected}`
                        : 'Loading measurements…');
                select.appendChild(missing);
            }
            select.value = selected;
        }
    }

    _syncMeasurementSelects() {
        for (const [key, select] of this._measurementSelects) {
            if (!select || select.value === this[key]) continue;
            select.value = this[key];
            // An assignment the option list does not carry leaves the select on the
            // empty option, which reads as "nothing assigned". Rebuilding the options
            // restores the placeholder that names the assignment.
            if (select.value !== this[key]) {
                this._renderMeasurementOptions();
                return;
            }
        }
    }

    async _refreshMeasurements(scheduleDesign = false) {
        try {
            const store = await this._getMeasurementStore(true);
            if (this._disposed) return;
            // No store at all means no measurement database, which the design also
            // settles as missing assignments. The list has to say the same instead
            // of staying on "loading" for good.
            const entries = store ? await store.listMeasurements() : [];
            if (this._disposed || store !== this._measurementStore) return;
            this._measurementEntries = Array.isArray(entries) ? entries : [];
            this._measurementsLoaded = true;
            this._renderMeasurementOptions();
            if (store && scheduleDesign && this._slotIds().some(Boolean)) this._scheduleDesign(0);
        } catch (error) {
            if (!this._disposed) console.error('Could not refresh Crosstalk Cancellation measurements:', error);
        }
    }

    _createMeasurementGrid() {
        const section = document.createElement('section');
        section.className = 'crosstalk-cancellation-measurements';
        const heading = document.createElement('div');
        heading.className = 'crosstalk-cancellation-section-title';
        heading.textContent = 'Measurements';
        const grid = document.createElement('div');
        grid.className = 'crosstalk-cancellation-measurement-grid';
        for (const group of CROSSTALK_CANCELLATION_MEASUREMENT_GROUPS) {
            const column = document.createElement('div');
            column.className = 'crosstalk-cancellation-measurement-group';
            const title = document.createElement('div');
            title.className = 'crosstalk-cancellation-group-title';
            title.textContent = group.title;
            column.appendChild(title);
            for (const key of group.slots) {
                const row = document.createElement('div');
                row.className = 'parameter-row crosstalk-cancellation-measurement';
                const label = document.createElement('label');
                const select = document.createElement('select');
                select.id = `crosstalk-cancellation-${key}-${this.id}`;
                label.htmlFor = select.id;
                label.textContent = `${key.toUpperCase()}: ${CROSSTALK_CANCELLATION_SLOT_LABELS[key]}`;
                select.addEventListener('change', () => this.setParameters({
                    [key]: select.value,
                    ...this._partnerSlotAssignment(key, select.value)
                }));
                row.append(label, select);
                column.appendChild(row);
                this._measurementSelects.set(key, select);
            }
            grid.appendChild(column);
        }
        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.className = 'crosstalk-cancellation-refresh';
        refresh.textContent = 'Refresh measurements';
        refresh.addEventListener('click', () => this._refreshMeasurements(true));
        section.append(heading, grid, refresh);
        this._renderMeasurementOptions();
        return section;
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui crosstalk-cancellation-ui';
        container.appendChild(this._createMeasurementGrid());
        const design = document.createElement('section');
        design.className = 'crosstalk-cancellation-controls';
        design.appendChild(this.createSelectControl('Taps', CROSSTALK_CANCELLATION_TAPS.map(value => ({
            value: String(value), label: String(value)
        })), String(this.tp), value => this.setParameters({ tp: Number(value) }), 'tp'));
        design.appendChild(this.createParameterControl('Regularization',
            0, 100, 1, this.rg, value => this.setParameters({ rg: value }), '%', 'rg'));
        design.appendChild(this.createParameterControl('Max Gain',
            0, 24, 0.1, this.mg, value => this.setParameters({ mg: value }), 'dB', 'mg'));
        design.appendChild(this.createParameterControl('Freq Low',
            20, 2000, 1, this.fl, value => this.setParameters({ fl: value }), 'Hz', 'fl'));
        design.appendChild(this.createParameterControl('Freq High',
            1000, 20000, 10, this.fh, value => this.setParameters({ fh: value }), 'Hz', 'fh'));
        design.appendChild(this.createParameterControl('Direct Window',
            2, 50, 0.1, this.wl, value => this.setParameters({ wl: value }), 'ms', 'wl'));
        design.appendChild(this.createParameterControl('Strength',
            0, 100, 1, this.st, value => this.setParameters({ st: value }), '%', 'st'));
        design.appendChild(this.createParameterControl('Output Gain',
            -24, 24, 0.1, this.og, value => this.setParameters({ og: value }), 'dB', 'og'));
        design.appendChild(this.createSelectControl('Latency', CROSSTALK_CANCELLATION_LATENCIES.map(value => ({
            value, label: `${value} samples`
        })), this.lt, value => this.setParameters({ lt: value }), 'lt'));
        container.appendChild(design);

        const statusLine = document.createElement('div');
        statusLine.className = 'crosstalk-cancellation-status-line';
        const status = document.createElement('div');
        status.className = 'crosstalk-cancellation-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        const details = document.createElement('div');
        details.className = 'crosstalk-cancellation-details';
        statusLine.append(status, details);
        container.appendChild(statusLine);
        this._statusElement = status;
        this._detailsElement = details;
        this._renderStatus();
        this._refreshMeasurements(false);
        return container;
    }

    get externalAssetInfo() {
        const ids = this._slotIds().filter(Boolean);
        if (!ids.length) return null;
        return {
            missing: !this._lastDesign,
            pending: this._designPending,
            ids,
            names: ids,
            kind: 'Measurement',
            assetSignature: this._externalAssetSignature()
        };
    }

    get offlineDspAssetRequired() {
        return this.isOfflineDspAssetRequired();
    }

    isOfflineDspAssetRequired() {
        return this._slotIds().some(Boolean);
    }

    _offlineStaleError() {
        const error = new Error('Crosstalk Cancellation settings changed during offline preparation.');
        error.userMessageKey = this.offlineDspAssetErrorMessageKey;
        return error;
    }

    async resolveOfflineDspAssetRequirement({ isCurrent = () => true } = {}) {
        const snapshot = {
            generation: this._designGeneration,
            ids: this._slotIds(),
            config: this._designConfig()
        };
        const operationCurrent = () => !this._disposed && isCurrent() &&
            snapshot.generation === this._designGeneration;
        if (!operationCurrent()) throw this._offlineStaleError();
        if (!this._allSlotsAssigned(snapshot.ids)) {
            return { required: false, ...snapshot, sources: null };
        }
        const store = await this._getMeasurementStore(true);
        if (!operationCurrent()) throw this._offlineStaleError();
        if (!store) return { required: false, ...snapshot, sources: null };
        const sources = await this._sourcesFor(store, snapshot.ids, operationCurrent);
        if (!operationCurrent()) throw this._offlineStaleError();
        return { required: Boolean(sources), ...snapshot, sources };
    }

    async createOfflineDspState({
        sampleRate,
        isCurrent = () => true,
        offlineDspAssetRequirement = null
    } = {}) {
        const snapshot = {
            generation: this._designGeneration,
            ids: this._slotIds(),
            config: this._designConfig(sampleRate),
            latency: this.lt,
            strength: this.st,
            outputGain: this.og,
            baseParameters: { ...super.getParameters() }
        };
        const operationCurrent = () => !this._disposed && isCurrent() &&
            snapshot.generation === this._designGeneration;
        const parameters = () => ({
            ...snapshot.baseParameters,
            lt: snapshot.latency,
            fd: snapshot.config.taps / 2,
            st: snapshot.strength,
            og: snapshot.outputGain
        });
        const bypass = () => ({
            parameters: parameters(),
            assets: new Map(),
            offlineDspAssetRequired: false
        });
        if (!operationCurrent()) throw this._offlineStaleError();
        const requirement = offlineDspAssetRequirement ||
            await this.resolveOfflineDspAssetRequirement({ isCurrent: operationCurrent });
        if (!operationCurrent() || requirement.generation !== snapshot.generation ||
            JSON.stringify(requirement.ids) !== JSON.stringify(snapshot.ids)) {
            throw this._offlineStaleError();
        }
        if (requirement.required !== true) return bypass();
        const runtime = await this._getRuntime();
        if (!operationCurrent()) throw this._offlineStaleError();
        const designer = runtime.createCrosstalkCancellationDesigner();
        let result;
        try {
            result = await designer.design(snapshot.config, requirement.sources);
        } catch (error) {
            error.userMessageKey = this.offlineDspAssetErrorMessageKey;
            throw error;
        } finally {
            designer.close();
        }
        if (!operationCurrent()) throw this._offlineStaleError();
        const footprintBytes = runtime.estimateIrKernelCommitFootprint({
            frames: result.config.taps,
            assetChannels: 4,
            topology: runtime.IR_ASSET_TOPOLOGY.trueStereo,
            processingChannels: 2,
            headBlock: Number(snapshot.latency)
        });
        return {
            parameters: parameters(),
            assets: new Map([[0, {
                payload: result.payload,
                formatTag: 1,
                headBlock: Number(snapshot.latency),
                rateDivider: 1,
                pathCount: 0,
                inputCount: 0,
                processingChannels: 2,
                footprintBytes,
                warmupSamples: Number(snapshot.latency) + snapshot.config.taps / 2,
                externalAssetSignature: this._externalAssetSignature({
                    ids: snapshot.ids,
                    config: snapshot.config,
                    latency: snapshot.latency
                })
            }]]),
            offlineDspAssetRequired: true
        };
    }

    cleanup() {
        if (this._disposed) return;
        this._disposed = true;
        ++this._designGeneration;
        if (this._designTimer !== null) clearTimeout(this._designTimer);
        this._designTimer = null;
        this._designer?.close?.();
        this._measurementStore?.close?.();
        this._designer = null;
        this._measurementStore = null;
        this._measurementStorePromise = null;
        this._measurementEntries = [];
        this._measurementsLoaded = false;
        this._measurementSelects.clear();
        this._statusElement = null;
        this._detailsElement = null;
        globalThis.document?.removeEventListener?.('visibilitychange', this._visibilityHandler);
        this.clearWasmAsset(0);
        super.cleanup();
    }
}

globalThis.window.CrosstalkCancellationPlugin = CrosstalkCancellationPlugin;
